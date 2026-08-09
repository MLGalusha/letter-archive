#!/usr/bin/env python3
"""Learn a local ink-appearance direction from Eynollah pseudo-labels.

This is a bounded acting-safe diagnostic.  Eynollah's confident pixels are used
as page-specific ink references and its very-low-probability pixels as paper
references.  Candidate additions remain a review tier, never ground truth.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

from experiment_best_ink_pipeline_cohort import line_corridors, save_mask
from experiment_body_corridor_recovery import inherited_body_corridor
from experiment_page_boundary_guard import detect_page


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_array(array: np.ndarray) -> str:
    return hashlib.sha256(np.ascontiguousarray(array).tobytes()).hexdigest()


def local_features(source_bgr: np.ndarray) -> tuple[np.ndarray, list[str]]:
    lab = cv2.cvtColor(source_bgr, cv2.COLOR_BGR2LAB).astype(np.float32) / 255.0
    gray = cv2.cvtColor(source_bgr, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0
    layers: list[np.ndarray] = []
    names: list[str] = []

    # Ink is represented as a change from nearby paper, not an absolute colour.
    for sigma in (12.0, 32.0):
        for channel, label in enumerate(("L", "a", "b")):
            background = cv2.GaussianBlur(lab[..., channel], (0, 0), sigma)
            layers.append(background - lab[..., channel])
            names.append(f"local_lab_{label}_residual_sigma_{sigma:g}")

    gray_u8 = np.round(gray * 255).astype(np.uint8)
    for diameter in (7, 13, 25):
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (diameter, diameter))
        response = cv2.morphologyEx(gray_u8, cv2.MORPH_BLACKHAT, kernel).astype(np.float32) / 255.0
        layers.append(response)
        names.append(f"blackhat_diameter_{diameter}")

    ridge_max = np.zeros_like(gray)
    for sigma in (0.8, 1.4, 2.4, 4.0):
        smooth = cv2.GaussianBlur(gray, (0, 0), sigma)
        ridge = np.maximum(cv2.Laplacian(smooth, cv2.CV_32F, ksize=3), 0.0) * sigma * sigma
        layers.append(ridge)
        names.append(f"dark_ridge_sigma_{sigma:g}")
        ridge_max = np.maximum(ridge_max, ridge)

    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    jxx = cv2.GaussianBlur(gx * gx, (0, 0), 2.0)
    jyy = cv2.GaussianBlur(gy * gy, (0, 0), 2.0)
    jxy = cv2.GaussianBlur(gx * gy, (0, 0), 2.0)
    coherence = np.sqrt(np.maximum((jxx - jyy) ** 2 + 4 * jxy * jxy, 0.0)) / (jxx + jyy + 1e-6)
    layers.append(coherence * np.sqrt(np.maximum(jxx + jyy, 0.0)))
    names.append("oriented_edge_coherence")
    layers.append(ridge_max)
    names.append("multiscale_dark_ridge_max")
    return np.stack(layers, axis=-1).astype(np.float32), names


def deterministic_rows(values: np.ndarray, maximum: int) -> np.ndarray:
    if len(values) <= maximum:
        return values
    indices = np.linspace(0, len(values) - 1, maximum, dtype=np.int64)
    return values[indices]


def learn_lda_score(
    features: np.ndarray,
    ink_seed: np.ndarray,
    paper_seed: np.ndarray,
) -> tuple[np.ndarray, dict[str, object]]:
    ink = deterministic_rows(features[ink_seed], 180_000).astype(np.float64)
    paper = deterministic_rows(features[paper_seed], 220_000).astype(np.float64)
    if len(ink) < 500 or len(paper) < 500:
        raise ValueError("Insufficient local ink or paper seeds")
    paper_median = np.median(paper, axis=0)
    paper_mad = np.median(np.abs(paper - paper_median), axis=0)
    scale = np.maximum(1.4826 * paper_mad, 1e-4)
    ink_z = (ink - paper_median) / scale
    paper_z = (paper - paper_median) / scale
    ink_center = np.median(ink_z, axis=0)
    paper_center = np.median(paper_z, axis=0)
    pooled = np.cov(np.vstack((deterministic_rows(ink_z, 60_000), deterministic_rows(paper_z, 90_000))), rowvar=False)
    shrinkage = 0.12
    pooled = (1.0 - shrinkage) * pooled + shrinkage * np.diag(np.diag(pooled)) + np.eye(pooled.shape[0]) * 0.08
    direction = np.linalg.solve(pooled, ink_center - paper_center)
    direction /= max(np.linalg.norm(direction), 1e-9)
    flat = (features.reshape(-1, features.shape[-1]).astype(np.float64) - paper_median) / scale
    score = (flat @ direction).reshape(features.shape[:2]).astype(np.float32)
    ink_score = score[ink_seed]
    paper_score = score[paper_seed]
    return score, {
        "ink_seed_pixels": int(ink_seed.sum()),
        "paper_seed_pixels": int(paper_seed.sum()),
        "sampled_ink_pixels": len(ink),
        "sampled_paper_pixels": len(paper),
        "paper_feature_median": [float(value) for value in paper_median],
        "paper_feature_robust_scale": [float(value) for value in scale],
        "lda_direction": [float(value) for value in direction],
        "covariance_shrinkage": shrinkage,
        "ink_score_quantiles": {
            str(q): float(np.quantile(ink_score, q)) for q in (0.01, 0.10, 0.50, 0.90, 0.99)
        },
        "paper_score_quantiles": {
            str(q): float(np.quantile(paper_score, q)) for q in (0.90, 0.95, 0.99, 0.995, 0.999)
        },
    }


def remove_singletons(mask: np.ndarray) -> np.ndarray:
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    keep_ids = np.flatnonzero(stats[:, cv2.CC_STAT_AREA] >= 2)
    keep_ids = keep_ids[keep_ids != 0]
    return np.isin(labels, keep_ids)


def white_mask(mask: np.ndarray) -> Image.Image:
    return Image.fromarray(np.where(mask, 15, 255).astype(np.uint8), "L").convert("RGB")


def score_heat(score: np.ndarray, low: float, high: float) -> Image.Image:
    scaled = np.clip((score - low) / max(1e-6, high - low), 0.0, 1.0)
    # Dark means more ink-like, matching the extraction panels.
    return Image.fromarray(np.uint8(255 * (1.0 - scaled)), "L").convert("RGB")


def addition_overlay(source: np.ndarray, core: np.ndarray, addition: np.ndarray) -> Image.Image:
    canvas = source.astype(np.float32) * 0.52 + 255.0 * 0.48
    canvas[core] = (0, 174, 188)
    canvas[addition] = (206, 77, 146)
    return Image.fromarray(np.uint8(canvas), "RGB")


def render_board(
    source: np.ndarray,
    core: np.ndarray,
    score: np.ndarray,
    masks: dict[str, np.ndarray],
    thresholds: dict[str, float],
    output: Path,
) -> None:
    low, high = thresholds["paper_q950"], thresholds["paper_q999"]
    panels = [
        ("source", Image.fromarray(source, "RGB"), "unaltered top-left crop"),
        ("Eynollah core", white_mask(core), "trusted page-specific ink examples"),
        ("learned ink-likeness", score_heat(score, low, high), "local-paper residual + stroke features"),
        ("strict candidate", white_mask(masks["paper_q999"]), "paper-proxy tail: 0.1%"),
        ("balanced candidate", white_mask(masks["paper_q995"]), "paper-proxy tail: 0.5%"),
        (
            "anchor + balanced additions",
            addition_overlay(source, core, masks["paper_q995"] & ~core),
            "cyan Eynollah · magenta review-only additions",
        ),
    ]
    height, width = core.shape
    title_height = 66
    board = Image.new("RGB", (3 * width, 2 * (height + title_height)), "#f3eee4")
    draw = ImageDraw.Draw(board)
    for index, (title, panel, subtitle) in enumerate(panels):
        x = index % 3 * width
        y = index // 3 * (height + title_height)
        draw.text((x + 8, y + 7), title, fill="#222222")
        draw.text((x + 8, y + 34), subtitle, fill="#555555")
        board.paste(panel, (x, y + title_height))
    board.save(output, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--probability", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--crop", type=int, nargs=4, default=[180, 80, 1700, 760])
    parser.add_argument(
        "--paper-seed-mode",
        choices=("all-low-probability", "clean-low-response", "interline-hard-paper"),
        default="all-low-probability",
    )
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()

    source_page = cv2.imread(str(args.source), cv2.IMREAD_COLOR)
    probability_page = np.load(args.probability, allow_pickle=False).astype(np.float32)
    if source_page is None or source_page.shape[:2] != probability_page.shape:
        raise ValueError("Source/probability shape mismatch")
    core_page = probability_page >= 0.50
    original_corridor, bands = line_corridors(core_page)
    expanded_corridor, corridor_record = inherited_body_corridor(original_corridor, bands)
    x0, y0, x1, y1 = args.crop
    source_bgr = source_page[y0:y1, x0:x1]
    source = cv2.cvtColor(source_bgr, cv2.COLOR_BGR2RGB)
    probability = probability_page[y0:y1, x0:x1]
    corridor = expanded_corridor[y0:y1, x0:x1]
    core = probability >= 0.50

    features, feature_names = local_features(source_bgr)
    far_from_core = cv2.dilate(core.astype(np.uint8), np.ones((11, 11), np.uint8)) == 0
    ink_seed = corridor & (probability >= 0.95)
    unresolved_low_probability = corridor & far_from_core & (probability <= 0.0001)
    paper_seed_rule: dict[str, object] = {"mode": args.paper_seed_mode}
    if args.paper_seed_mode == "clean-low-response":
        blackhat = features[..., feature_names.index("blackhat_diameter_25")]
        ridge = features[..., feature_names.index("multiscale_dark_ridge_max")]
        blackhat_limit = float(np.quantile(blackhat[unresolved_low_probability], 0.60))
        ridge_limit = float(np.quantile(ridge[unresolved_low_probability], 0.60))
        paper_seed = unresolved_low_probability & (blackhat <= blackhat_limit) & (ridge <= ridge_limit)
        paper_seed_rule.update(
            {
                "base": "corridor AND >=5px from Eynollah core AND probability <=0.0001",
                "blackhat_diameter_25_max": blackhat_limit,
                "multiscale_dark_ridge_max": ridge_limit,
                "response_quantile": 0.60,
                "unresolved_low_probability_pixels": int(unresolved_low_probability.sum()),
                "excluded_from_clean_paper_seed": int((unresolved_low_probability & ~paper_seed).sum()),
            }
        )
    elif args.paper_seed_mode == "interline-hard-paper":
        page_mask, page_distance, page_detection = detect_page(source_page)
        local_page = page_mask[y0:y1, x0:x1]
        local_page_distance = page_distance[y0:y1, x0:x1]
        row_density = core.sum(axis=1).astype(np.float32)
        smooth_row_density = cv2.GaussianBlur(row_density[:, None], (1, 0), 5.0).ravel()
        corridor_rows = corridor.any(axis=1)
        row_limit = float(np.quantile(smooth_row_density[corridor_rows], 0.25))
        interline_rows = smooth_row_density <= row_limit
        paper_seed = (
            unresolved_low_probability
            & interline_rows[:, None]
            & local_page
            & (local_page_distance >= 24.0)
        )
        transitions = np.diff(np.pad(interline_rows.astype(np.int8), (1, 1)))
        starts = np.flatnonzero(transitions == 1)
        ends = np.flatnonzero(transitions == -1)
        paper_seed_rule.update(
            {
                "base": "corridor AND >=5px from Eynollah core AND probability <=0.0001",
                "row_density_gaussian_sigma": 5.0,
                "row_density_quantile": 0.25,
                "row_density_limit": row_limit,
                "minimum_page_edge_distance": 24.0,
                "interline_row_ranges_global_y": [
                    [int(start + y0), int(end + y0)] for start, end in zip(starts, ends)
                ],
                "unresolved_low_probability_pixels": int(unresolved_low_probability.sum()),
                "page_detection": page_detection,
            }
        )
    else:
        paper_seed = unresolved_low_probability
        paper_seed_rule["base"] = "corridor AND >=5px from Eynollah core AND probability <=0.0001"
    score, learned = learn_lda_score(features, ink_seed, paper_seed)
    thresholds = {
        f"paper_q{int(q * 1000):03d}": float(np.quantile(score[paper_seed], q))
        for q in (0.95, 0.99, 0.995, 0.999)
    }
    raw_masks = {name: corridor & (score >= threshold) for name, threshold in thresholds.items()}
    masks = {name: remove_singletons(mask) for name, mask in raw_masks.items()}

    outputs = {}
    for name, mask in masks.items():
        path = args.output / f"local-reference-{name}.mask.png"
        save_mask(mask, path)
        outputs[path.name] = sha256_file(path)
    score_path = args.output / "local-reference-score.float16.npy"
    np.save(score_path, score.astype(np.float16), allow_pickle=False)
    outputs[score_path.name] = sha256_file(score_path)
    board = args.output / "top-left-local-ink-reference.png"
    render_board(source, core, score, masks, thresholds, board)
    outputs[board.name] = sha256_file(board)

    mask_metrics = {}
    for name, mask in masks.items():
        count, _, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
        additions = mask & ~core
        mask_metrics[name] = {
            "pixels": int(mask.sum()),
            "components": int(count - 1),
            "components_ge_8px": int((stats[1:, cv2.CC_STAT_AREA] >= 8).sum()),
            "Eynollah_core_pixels_retained": int((mask & core).sum()),
            "Eynollah_core_recall": float((mask & core).sum() / max(1, core.sum())),
            "review_addition_pixels": int(additions.sum()),
            "addition_by_Eynollah_probability": {
                "p_0.20_0.50": int((additions & (probability >= 0.20)).sum()),
                "p_0.01_0.20": int((additions & (probability >= 0.01) & (probability < 0.20)).sum()),
                "p_lt_0.01": int((additions & (probability < 0.01)).sum()),
            },
            "mask_uint8_pixel_sha256": sha256_array(mask.astype(np.uint8)),
        }

    record = {
        "schema_version": "page-specific-local-ink-reference.v1",
        "evidence_visibility": "acting-safe-source-and-frozen-model-output-only",
        "sealed_human_evidence_used": False,
        "hypothesis": "trusted Eynollah ink can teach a local source-space ink direction that transfers to faint missed strokes",
        "inputs": {
            "source": str(args.source),
            "source_sha256": sha256_file(args.source),
            "probability": str(args.probability),
            "probability_file_sha256": sha256_file(args.probability),
            "crop_bbox_xyxy": args.crop,
        },
        "feature_names": feature_names,
        "paper_seed_rule": paper_seed_rule,
        "learned_reference": learned,
        "thresholds": thresholds,
        "corridor": corridor_record,
        "metrics": mask_metrics,
        "guardrails": [
            "Thresholds are calibrated against an automatic paper proxy, not human truth.",
            "Excluded low-probability pixels remain unresolved, not relabeled as ink.",
            "Candidates are exact source pixels; no morphology-generated bridge pixels are labels.",
            "Singleton removal is presentation cleanup and may remove legitimate isolated ink.",
            "All additions remain review-only until independent evaluation.",
        ],
        "outputs": outputs,
        "runtime_seconds": time.perf_counter() - started,
    }
    manifest = args.output / "experiment.json"
    manifest.write_text(json.dumps(record, indent=2) + "\n")
    print(json.dumps({"thresholds": thresholds, "learned": learned, "metrics": mask_metrics, "manifest_sha256": sha256_file(manifest)}))


if __name__ == "__main__":
    main()
