#!/usr/bin/env python3
"""Run one model pass plus source-only faint-ink recovery on a frozen page cohort.

The model probability is the clean anchor.  All additions are exact source pixels and
remain visibly tiered; enhancement pixels and morphology never become ink labels.
This is an acting-safe experiment and never reads human-completed masks.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from skimage.filters import threshold_sauvola
MODEL_RELEASE = "2022-08-16"
MODEL_SOURCE = (
    "https://huggingface.co/SBB/sbb_binarization/resolve/"
    "cfdf4446f8e33b2c743a66bf7c1a4686515442ae/saved_model/2022-08-16"
)
TIERS = {
    "model_core": (0, 174, 188),
    "model_support": (42, 157, 85),
    "conservative_source_recovery": (235, 157, 34),
    "exploratory_source_recovery": (206, 77, 146),
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_array(array: np.ndarray) -> str:
    return hashlib.sha256(np.ascontiguousarray(array).tobytes()).hexdigest()


def save_mask(mask: np.ndarray, path: Path) -> None:
    Image.fromarray(np.where(mask, 0, 255).astype(np.uint8), "L").save(path, optimize=True)


def mask_metrics(mask: np.ndarray) -> dict[str, int | float | str]:
    count, _, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    sizes = stats[1:, cv2.CC_STAT_AREA] if count > 1 else np.zeros(0, dtype=np.int32)
    return {
        "pixels": int(mask.sum()),
        "fraction": float(mask.mean()),
        "components": int(len(sizes)),
        "components_ge_3px": int((sizes >= 3).sum()),
        "components_ge_12px": int((sizes >= 12).sum()),
        "median_component_pixels": float(np.median(sizes)) if len(sizes) else 0.0,
        "mask_uint8_pixel_sha256": sha256_array(mask.astype(np.uint8)),
    }


def deterministic_sample(values: np.ndarray, maximum: int) -> np.ndarray:
    if len(values) <= maximum:
        return values
    indices = np.linspace(0, len(values) - 1, maximum, dtype=np.int64)
    return values[indices]


def component_sanitized_projection(core: np.ndarray) -> np.ndarray:
    """Remove shapes that cannot help estimate horizontal text-line rhythm."""
    height, width = core.shape
    count, labels, stats, _ = cv2.connectedComponentsWithStats(core.astype(np.uint8), 8)
    keep = np.zeros_like(core)
    for component_id in range(1, count):
        x, y, w, h, area = (int(v) for v in stats[component_id])
        if area < 3:
            continue
        if h > 0.13 * height or w > 0.96 * width:
            continue
        if area > 0.025 * height * width:
            continue
        keep[labels == component_id] = True
    return keep


def line_corridors(core: np.ndarray) -> tuple[np.ndarray, list[dict[str, int | float]]]:
    """Infer broad recovery corridors from model-core row rhythm, with x bounds."""
    height, width = core.shape
    projection_source = component_sanitized_projection(core)
    density = projection_source.sum(axis=1).astype(np.float32)
    sigma = max(3.0, height / 850.0)
    smooth = ndimage.gaussian_filter1d(density, sigma=sigma)
    positive = smooth[smooth > 0.25]
    threshold = max(1.0, float(np.quantile(positive, 0.18))) if len(positive) else 1.0
    active = smooth >= threshold
    active = ndimage.binary_closing(active, structure=np.ones(max(3, round(height / 400))))
    labels, count = ndimage.label(active)
    corridor = np.zeros_like(core)
    bands: list[dict[str, int | float]] = []
    y_padding = max(14, round(height * 0.008))
    x_padding = max(20, round(width * 0.025))
    for band_id in range(1, count + 1):
        ys = np.flatnonzero(labels == band_id)
        if len(ys) < 2:
            continue
        y0 = max(0, int(ys[0]) - y_padding)
        y1 = min(height, int(ys[-1]) + 1 + y_padding)
        band_ys, band_xs = np.nonzero(projection_source[y0:y1])
        if len(band_xs) < 8:
            continue
        x0 = max(0, int(np.quantile(band_xs, 0.005)) - x_padding)
        x1 = min(width, int(np.quantile(band_xs, 0.995)) + 1 + x_padding)
        if x1 - x0 < max(30, 0.035 * width):
            continue
        corridor[y0:y1, x0:x1] = True
        bands.append(
            {
                "bbox_xyxy": [x0, y0, x1, y1],
                "height": y1 - y0,
                "width": x1 - x0,
                "peak_row_density": float(smooth[ys].max()),
            }
        )
    return corridor, bands


def whitened_ink_score(
    lab: np.ndarray,
    core: np.ndarray,
    probability: np.ndarray,
    reflectance: np.ndarray,
) -> tuple[np.ndarray, dict[str, object], np.ndarray]:
    """Paper-covariance-whitened color projection learned from model pseudo-seeds."""
    ink_seed = core & (probability >= 0.80)
    paper_seed = (probability <= 0.0001) & (reflectance <= np.quantile(reflectance, 0.55))
    ink_values = deterministic_sample(lab[ink_seed], 120_000).astype(np.float64)
    paper_values = deterministic_sample(lab[paper_seed], 180_000).astype(np.float64)
    if len(ink_values) < 100 or len(paper_values) < 100:
        raise ValueError("Insufficient automatic ink/paper pseudo-seeds")
    paper_center = np.median(paper_values, axis=0)
    ink_center = np.median(ink_values, axis=0)
    centered_paper = paper_values - paper_center
    covariance = np.cov(centered_paper, rowvar=False) + np.eye(3) * 3.0
    inverse_covariance = np.linalg.inv(covariance)
    direction = paper_center - ink_center
    discriminant = inverse_covariance @ direction
    raw = np.tensordot(lab.astype(np.float64) - paper_center, discriminant, axes=([2], [0]))
    paper_raw = raw[paper_seed]
    ink_raw = raw[ink_seed]
    paper_q995 = float(np.quantile(paper_raw, 0.995))
    ink_median = float(np.median(ink_raw))
    scale = max(1e-6, ink_median - paper_q995)
    normalized = ((raw - paper_q995) / scale).astype(np.float32)
    return normalized, {
        "ink_seed_pixels": int(ink_seed.sum()),
        "paper_seed_pixels": int(paper_seed.sum()),
        "paper_lab_median": [float(v) for v in paper_center],
        "ink_lab_median": [float(v) for v in ink_center],
        "paper_covariance": [[float(v) for v in row] for row in covariance],
        "discriminant": [float(v) for v in discriminant],
        "paper_raw_q995": paper_q995,
        "ink_raw_median": ink_median,
        "normalization_scale": scale,
    }, paper_seed


def source_evidence(source_bgr: np.ndarray, core: np.ndarray, probability: np.ndarray) -> dict[str, object]:
    gray = cv2.cvtColor(source_bgr, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0
    lab = cv2.cvtColor(source_bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    height, width = gray.shape

    # Homomorphic/Retinex-style reflectance: local paper illumination minus source.
    sigma = max(12.0, min(height, width) / 115.0)
    background = cv2.GaussianBlur(gray, (0, 0), sigmaX=sigma, sigmaY=sigma)
    reflectance = np.log(np.clip(background, 1e-3, 1.0)) - np.log(np.clip(gray, 1e-3, 1.0))
    reflectance = np.maximum(reflectance, 0.0).astype(np.float32)

    whitened, whiten_stats, paper_seed = whitened_ink_score(lab, core, probability, reflectance)

    # Multi-window local threshold voting follows the SauvolaNet insight without
    # pretending these fixed windows are a learned model.
    votes = np.zeros(gray.shape, dtype=np.uint8)
    sauvola_windows = []
    base = max(15, int(round(min(height, width) / 120)) | 1)
    for multiplier in (1, 2, 4):
        window = max(15, base * multiplier)
        if window % 2 == 0:
            window += 1
        threshold = threshold_sauvola(gray, window_size=window, k=0.18, r=0.5)
        votes += gray < threshold
        sauvola_windows.append(window)

    # Scale-normalized dark-ridge energy; maxima across stroke widths preserve
    # thin and broad faint strokes without inserting bridge pixels.
    ridge = np.zeros_like(gray)
    ridge_sigmas = (0.8, 1.4, 2.4, 4.0)
    for ridge_sigma in ridge_sigmas:
        smooth = cv2.GaussianBlur(gray, (0, 0), ridge_sigma)
        laplacian = cv2.Laplacian(smooth, cv2.CV_32F, ksize=3)
        ridge = np.maximum(ridge, np.maximum(laplacian, 0.0) * ridge_sigma * ridge_sigma)

    paper_reflectance = reflectance[paper_seed]
    paper_ridge = ridge[paper_seed]
    reflect_q99 = float(np.quantile(paper_reflectance, 0.99))
    reflect_q975 = float(np.quantile(paper_reflectance, 0.975))
    ridge_q995 = float(np.quantile(paper_ridge, 0.995))
    ridge_q98 = float(np.quantile(paper_ridge, 0.98))
    return {
        "gray": gray,
        "background": background,
        "reflectance": reflectance,
        "whitened": whitened,
        "votes": votes,
        "ridge": ridge,
        "paper_seed": paper_seed,
        "stats": {
            "illumination_gaussian_sigma": sigma,
            "sauvola_windows": sauvola_windows,
            "sauvola_k": 0.18,
            "reflectance_paper_q99": reflect_q99,
            "reflectance_paper_q975": reflect_q975,
            "ridge_paper_q995": ridge_q995,
            "ridge_paper_q98": ridge_q98,
            "whitened_color": whiten_stats,
        },
    }


def compose_tiers(
    probability: np.ndarray,
    corridor: np.ndarray,
    evidence: dict[str, object],
) -> dict[str, np.ndarray]:
    core = probability >= 0.50
    relaxed = probability >= 0.20
    reflectance = evidence["reflectance"]
    whitened = evidence["whitened"]
    votes = evidence["votes"]
    ridge = evidence["ridge"]
    stats = evidence["stats"]

    near_core = cv2.dilate(core.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    model_support = relaxed & ~core & (near_core | corridor)

    conservative = (
        corridor
        & ~relaxed
        & (whitened >= 0.10)
        & (reflectance >= stats["reflectance_paper_q99"])
        & ((votes >= 2) | (ridge >= stats["ridge_paper_q995"]))
    )
    exploratory = (
        corridor
        & ~relaxed
        & ~conservative
        & (whitened >= -0.12)
        & (reflectance >= stats["reflectance_paper_q975"])
        & (votes >= 1)
        & (ridge >= stats["ridge_paper_q98"])
    )

    # Exact-source graph repair: include a conservative component if it touches
    # model support after a small geometric reach.  No synthetic reach pixels are kept.
    support_reach = cv2.dilate((core | model_support).astype(np.uint8), np.ones((7, 7), np.uint8)) > 0
    count, labels, component_stats, _ = cv2.connectedComponentsWithStats(conservative.astype(np.uint8), 8)
    admitted = np.zeros_like(conservative)
    for component_id in range(1, count):
        component = labels == component_id
        area = int(component_stats[component_id, cv2.CC_STAT_AREA])
        if area < 2:
            continue
        touches = bool((component & support_reach).any())
        strong_standalone = area >= 4 and float(np.median(whitened[component])) >= 0.42
        if touches or strong_standalone:
            admitted |= component

    return {
        "model_core": core,
        "model_support": model_support,
        "conservative_source_recovery": admitted,
        "exploratory_source_recovery": exploratory,
    }


def enhanced_preview(source_bgr: np.ndarray, evidence: dict[str, object]) -> np.ndarray:
    """Natural visibility view; never used as a label or saved at full resolution."""
    lab = cv2.cvtColor(source_bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    whitened = evidence["whitened"]
    boost = np.clip((whitened + 0.15) / 1.15, 0.0, 1.0)
    lab[..., 0] -= 38.0 * boost
    return cv2.cvtColor(np.clip(lab, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR)


def to_white_mask(mask: np.ndarray) -> Image.Image:
    return Image.fromarray(np.where(mask, 18, 255).astype(np.uint8), "L").convert("RGB")


def tier_overlay(source_rgb: np.ndarray, tiers: dict[str, np.ndarray]) -> Image.Image:
    canvas = source_rgb.astype(np.float32) * 0.50 + 255.0 * 0.50
    for name, colour in TIERS.items():
        canvas[tiers[name]] = colour
    return Image.fromarray(np.clip(canvas, 0, 255).astype(np.uint8), "RGB")


def resize_panel(image: Image.Image, panel_width: int = 760, maximum_height: int = 920) -> Image.Image:
    scale = min(panel_width / image.width, maximum_height / image.height)
    return image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)


def render_board(
    page_id: str,
    source_rgb: np.ndarray,
    enhanced_bgr: np.ndarray,
    tiers: dict[str, np.ndarray],
    output: Path,
) -> None:
    clean = tiers["model_core"] | tiers["model_support"] | tiers["conservative_source_recovery"]
    review = clean | tiers["exploratory_source_recovery"]
    panels = [
        ("Original source", Image.fromarray(source_rgb, "RGB"), "unaltered acting-safe page"),
        (
            "Ink-visibility enhancement",
            Image.fromarray(cv2.cvtColor(enhanced_bgr, cv2.COLOR_BGR2RGB), "RGB"),
            "whitened page-color boost; display only",
        ),
        ("One-pass Eynollah core", to_white_mask(tiers["model_core"]), f"{tiers['model_core'].sum():,} pixels"),
        ("Composed clean extraction", to_white_mask(clean), f"{clean.sum():,} exact source pixels"),
        (
            "Evidence tiers on source",
            tier_overlay(source_rgb, tiers),
            "cyan model · green support · orange recovered · magenta exploratory",
        ),
        ("High-recall review extraction", to_white_mask(review), f"{review.sum():,} exact source pixels; not auto-truth"),
    ]
    resized = [(title, resize_panel(image), subtitle) for title, image, subtitle in panels]
    panel_width = 760
    panel_height = max(image.height for _, image, _ in resized)
    title_height = 76
    board = Image.new("RGB", (panel_width * 3, (panel_height + title_height) * 2), "#f3eee4")
    draw = ImageDraw.Draw(board)
    for index, (title, image, subtitle) in enumerate(resized):
        x = (index % 3) * panel_width
        y = (index // 3) * (panel_height + title_height)
        draw.text((x + 10, y + 8), f"{page_id} · {title}", fill="#222222")
        draw.text((x + 10, y + 36), subtitle, fill="#555555")
        board.paste(image, (x + (panel_width - image.width) // 2, y + title_height))
    board.save(output, quality=88, optimize=True)


def save_score_preview(score: np.ndarray, path: Path) -> None:
    low, high = np.quantile(score, (0.01, 0.99))
    scaled = np.clip((score - low) / max(1e-6, high - low), 0, 1)
    Image.fromarray(np.round(255 * scaled).astype(np.uint8), "L").save(path, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cohort", type=Path, required=True)
    parser.add_argument("--probability-root", type=Path, action="append", required=True)
    parser.add_argument("--page-id")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    cohort = json.loads(args.cohort.read_text())
    if cohort.get("sealed_human_evidence_opened") is not False:
        raise ValueError("Cohort must explicitly attest that sealed evidence was not opened")

    page_records = []
    total_started = time.perf_counter()
    for page in cohort["pages"]:
        if args.page_id and page["page_id"] != args.page_id:
            continue
        page_started = time.perf_counter()
        page_id = page["page_id"]
        source_path = Path(page["source"])
        if sha256_file(source_path) != page["source_sha256"]:
            raise ValueError(f"Source hash drift for {page_id}")
        source_bgr = cv2.imread(str(source_path), cv2.IMREAD_COLOR)
        if source_bgr is None:
            raise ValueError(f"Could not read {source_path}")

        existing = None
        for probability_root in args.probability_root:
            candidate = probability_root / page_id / "foreground-probability.float16.npy"
            if candidate.exists():
                existing = candidate
                break
        if existing is None:
            raise ValueError(f"No frozen probability found for {page_id}")
        probability = np.load(existing, allow_pickle=False).astype(np.float32)
        probability_source = "frozen-2022-hybrid-probability"
        inference_seconds = 0.0
        if probability.shape != source_bgr.shape[:2]:
            raise ValueError(f"Probability shape mismatch for {page_id}")

        core = probability >= 0.50
        corridor, bands = line_corridors(core)
        evidence_started = time.perf_counter()
        evidence = source_evidence(source_bgr, core, probability)
        tiers = compose_tiers(probability, corridor, evidence)
        evidence_seconds = time.perf_counter() - evidence_started
        clean = tiers["model_core"] | tiers["model_support"] | tiers["conservative_source_recovery"]
        review = clean | tiers["exploratory_source_recovery"]
        page_dir = args.output / page_id
        page_dir.mkdir(parents=True, exist_ok=True)
        for name, mask in tiers.items():
            save_mask(mask, page_dir / f"{name.replace('_', '-')}.mask.png")
        save_mask(corridor, page_dir / "automatic-line-corridors.mask.png")
        save_mask(clean, page_dir / "composed-clean.mask.png")
        save_mask(review, page_dir / "high-recall-review.mask.png")
        save_score_preview(evidence["whitened"], page_dir / "whitened-color-score.preview.png")
        render_board(
            page_id,
            cv2.cvtColor(source_bgr, cv2.COLOR_BGR2RGB),
            enhanced_preview(source_bgr, evidence),
            tiers,
            page_dir / "full-page-comparison.jpg",
        )
        output_files = sorted(path for path in page_dir.iterdir() if path.is_file())
        record = {
            "page_id": page_id,
            "difficulty_role": page["difficulty_role"],
            "source": str(source_path),
            "source_sha256": page["source_sha256"],
            "shape_hw": list(probability.shape),
            "probability_source": probability_source,
            "probability_float32_pixel_sha256": sha256_array(probability.astype(np.float32)),
            "probability_input_file": str(existing) if existing else None,
            "probability_input_file_sha256": sha256_file(existing) if existing else None,
            "line_corridors": {
                "bands": bands,
                "pixels": int(corridor.sum()),
                "mask_uint8_pixel_sha256": sha256_array(corridor.astype(np.uint8)),
            },
            "source_evidence": evidence["stats"],
            "metrics": {
                **{name: mask_metrics(mask) for name, mask in tiers.items()},
                "composed_clean": mask_metrics(clean),
                "high_recall_review": mask_metrics(review),
                "clean_addition_vs_core": int((clean & ~tiers["model_core"]).sum()),
                "review_addition_vs_clean": int((review & ~clean).sum()),
                "clean_paper_proxy_selected": int((clean & evidence["paper_seed"]).sum()),
                "review_paper_proxy_selected": int((review & evidence["paper_seed"]).sum()),
            },
            "runtime": {
                "model_inference_seconds": inference_seconds,
                "source_evidence_and_composition_seconds": evidence_seconds,
                "page_total_seconds": time.perf_counter() - page_started,
            },
            "outputs": {path.name: sha256_file(path) for path in output_files},
        }
        (page_dir / "result.json").write_text(json.dumps(record, indent=2) + "\n")
        record["result_json_sha256"] = sha256_file(page_dir / "result.json")
        page_records.append(record)
        print(json.dumps({"page": page_id, "runtime": record["runtime"], "metrics": record["metrics"]}))
        del source_bgr, probability, evidence, tiers, clean, review

    # Aggregate every completed page record, including earlier bounded processes.
    completed_records = []
    for page in cohort["pages"]:
        result_path = args.output / page["page_id"] / "result.json"
        if result_path.exists():
            completed_records.append(json.loads(result_path.read_text()))
    manifest = {
        "schema_version": 1,
        "experiment_id": "best-ink-pipeline-cohort-v1",
        "evidence_visibility": "acting-safe-source-only",
        "sealed_human_evidence_opened": False,
        "cohort": {
            "path": str(args.cohort),
            "sha256": sha256_file(args.cohort),
            "pages_frozen": len(cohort["pages"]),
            "pages_completed": len(completed_records),
        },
        "model": {
            "release": MODEL_RELEASE,
            "source": MODEL_SOURCE,
            "saved_model_pb_sha256": "63cfe676b63569e7cbebf05567448834945e9be9c35bcf3dbce59312ca0d1902",
            "keras_metadata_pb_sha256": "ca18795a986844bf1c147950ddca70975df736f87994477252f0088f4c65882e",
            "variables_data_sha256": "965b62227ce6e572203662a67c1d0d232b996acdc68bbaae26f93cc15ce40458",
            "variables_index_sha256": "17de8e34f380d0b7c631dff48e1ac21660bc9503f7da7ecff72d36156f8dd87d",
        },
        "pipeline": {
            "order": [
                "one Eynollah hybrid probability pass or exact frozen reuse",
                "automatic model-core line corridors",
                "paper-covariance-whitened LAB ink projection",
                "homomorphic local reflectance",
                "three-window Sauvola vote",
                "four-scale dark-ridge energy",
                "source-only component admission",
                "separate clean and exploratory review masks",
            ],
            "synthetic_pixels_in_final_masks": 0,
            "human_or_sealed_inputs": 0,
        },
        "runtime": {
            "wall_seconds": time.perf_counter() - total_started,
            "platform": platform.platform(),
            "opencv": cv2.__version__,
            "numpy": np.__version__,
        },
        "pages": completed_records,
    }
    manifest_path = args.output / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({"manifest": str(manifest_path), "sha256": sha256_file(manifest_path)}))


if __name__ == "__main__":
    main()
