#!/usr/bin/env python3
"""Compare frozen original/offset Eynollah grids and test bounded fusion rules."""

from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

from analyze_eynollah_missing_ink import distance_to_boundaries, stitch_boundaries


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_array(array: np.ndarray) -> str:
    return hashlib.sha256(np.ascontiguousarray(array).tobytes()).hexdigest()


def black_mask(path: Path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("L")) < 128


def save_mask(mask: np.ndarray, path: Path) -> None:
    Image.fromarray(np.where(mask, 0, 255).astype(np.uint8), "L").save(path, optimize=True)


def mask_metrics(
    mask: np.ndarray,
    baseline: np.ndarray,
    shifted: np.ndarray,
    source_candidate: np.ndarray,
    baseline_seam_distance: np.ndarray,
) -> dict[str, object]:
    count, _, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    sizes = stats[1:, cv2.CC_STAT_AREA] if count > 1 else np.zeros(0, dtype=np.int32)
    gained = mask & ~baseline
    lost = baseline & ~mask
    return {
        "pixels": int(mask.sum()),
        "components": int(len(sizes)),
        "components_ge_8px": int((sizes >= 8).sum()),
        "baseline_retention": float((mask & baseline).sum() / max(1, baseline.sum())),
        "shifted_retention": float((mask & shifted).sum() / max(1, shifted.sum())),
        "gained_vs_baseline": int(gained.sum()),
        "lost_vs_baseline": int(lost.sum()),
        "source_candidate_selected": int((mask & source_candidate).sum()),
        "source_candidate_recall": float((mask & source_candidate).sum() / max(1, source_candidate.sum())),
        "gained_source_candidate": int((gained & source_candidate).sum()),
        "gained_outside_source_candidate": int((gained & ~source_candidate).sum()),
        "gained_within_8px_baseline_seam": int((gained & (baseline_seam_distance <= 8)).sum()),
        "gained_within_16px_baseline_seam": int((gained & (baseline_seam_distance <= 16)).sum()),
        "gained_within_32px_baseline_seam": int((gained & (baseline_seam_distance <= 32)).sum()),
        "mask_uint8_pixel_sha256": sha256_array(mask.astype(np.uint8)),
    }


def probability_tier_overlay(source: np.ndarray, probability: np.ndarray) -> Image.Image:
    canvas = source.astype(np.float32) * 0.55 + 255 * 0.45
    canvas[probability >= 0.50] = (0, 174, 188)
    canvas[(probability >= 0.20) & (probability < 0.50)] = (42, 157, 85)
    canvas[(probability >= 0.01) & (probability < 0.20)] = (235, 157, 34)
    canvas[probability < 0.01] = canvas[probability < 0.01]
    return Image.fromarray(np.uint8(canvas), "RGB")


def difference_overlay(source: np.ndarray, baseline: np.ndarray, shifted: np.ndarray) -> Image.Image:
    canvas = source.astype(np.float32) * 0.52 + 255 * 0.48
    canvas[baseline & shifted] = (0, 174, 188)
    canvas[shifted & ~baseline] = (42, 157, 85)
    canvas[baseline & ~shifted] = (235, 157, 34)
    return Image.fromarray(np.uint8(canvas), "RGB")


def mask_on_white(mask: np.ndarray) -> Image.Image:
    return Image.fromarray(np.where(mask, 18, 255).astype(np.uint8), "L").convert("RGB")


def resized(image: Image.Image, width: int = 720, maximum_height: int = 900) -> Image.Image:
    scale = min(width / image.width, maximum_height / image.height)
    return image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)


def render_full_page(
    source: np.ndarray,
    baseline_probability: np.ndarray,
    shifted_probability: np.ndarray,
    methods: dict[str, np.ndarray],
    output: Path,
) -> None:
    baseline = methods["original-grid"]
    shifted = methods["half-stride-grid"]
    panels = [
        ("original source", Image.fromarray(source, "RGB"), "source pixels unchanged"),
        ("original-grid probability", probability_tier_overlay(source, baseline_probability), "cyan >=.50 · green .20-.50 · orange .01-.20"),
        ("half-stride probability", probability_tier_overlay(source, shifted_probability), "same source; tile grid moved 180 px"),
        ("grid disagreement", difference_overlay(source, baseline, shifted), "cyan shared · green recovered · gold newly lost"),
        ("blind union", mask_on_white(methods["blind-union"]), "maximum recall; includes every disagreement"),
        ("center-preferred fusion", mask_on_white(methods["center-preferred"]), "choose grid farther from its nearest seam"),
    ]
    panels = [(title, resized(image), subtitle) for title, image, subtitle in panels]
    panel_width = 720
    panel_height = max(image.height for _, image, _ in panels)
    title_height = 72
    board = Image.new("RGB", (panel_width * 3, (panel_height + title_height) * 2), "#f3eee4")
    draw = ImageDraw.Draw(board)
    for index, (title, image, subtitle) in enumerate(panels):
        x = index % 3 * panel_width
        y = index // 3 * (panel_height + title_height)
        draw.text((x + 9, y + 8), title, fill="#222222")
        draw.text((x + 9, y + 36), subtitle, fill="#555555")
        board.paste(image, (x + (panel_width - image.width) // 2, y + title_height))
    board.save(output, quality=90, optimize=True)


def render_window(
    source: np.ndarray,
    baseline_probability: np.ndarray,
    shifted_probability: np.ndarray,
    methods: dict[str, np.ndarray],
    bbox: list[int],
    title: str,
    output: Path,
) -> None:
    x0, y0, x1, y1 = bbox
    local_source = source[y0:y1, x0:x1]
    baseline = methods["original-grid"][y0:y1, x0:x1]
    shifted = methods["half-stride-grid"][y0:y1, x0:x1]
    panels = [
        ("source", Image.fromarray(local_source, "RGB"), "unaltered"),
        ("original grid", probability_tier_overlay(local_source, baseline_probability[y0:y1, x0:x1]), "released alignment"),
        ("half-stride grid", probability_tier_overlay(local_source, shifted_probability[y0:y1, x0:x1]), "180 px shifted alignment"),
        ("difference", difference_overlay(local_source, baseline, shifted), "green recovered · gold lost"),
        ("blind union", mask_on_white(methods["blind-union"][y0:y1, x0:x1]), "accept either grid"),
        ("center-preferred", mask_on_white(methods["center-preferred"][y0:y1, x0:x1]), "prefer farther-from-seam prediction"),
    ]
    panel_width, panel_height = x1 - x0, y1 - y0
    title_height = 66
    board = Image.new("RGB", (panel_width * 3, (panel_height + title_height) * 2), "#f3eee4")
    draw = ImageDraw.Draw(board)
    for index, (name, panel, subtitle) in enumerate(panels):
        x = index % 3 * panel_width
        y = index // 3 * (panel_height + title_height)
        draw.text((x + 8, y + 7), f"{title} · {name}", fill="#222222")
        draw.text((x + 8, y + 34), subtitle, fill="#555555")
        board.paste(panel, (x, y + title_height))
    board.save(output, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--baseline-probability", type=Path, required=True)
    parser.add_argument("--shifted-probability", type=Path, required=True)
    parser.add_argument("--anatomy-root", type=Path, required=True)
    parser.add_argument("--offset-x", type=int, default=180)
    parser.add_argument("--offset-y", type=int, default=180)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()

    source_bgr = cv2.imread(str(args.source), cv2.IMREAD_COLOR)
    source = cv2.cvtColor(source_bgr, cv2.COLOR_BGR2RGB)
    baseline_probability = np.load(args.baseline_probability, allow_pickle=False).astype(np.float32)
    shifted_probability = np.load(args.shifted_probability, allow_pickle=False).astype(np.float32)
    if baseline_probability.shape != shifted_probability.shape or source.shape[:2] != baseline_probability.shape:
        raise ValueError("Source and probability shapes differ")
    height, width = baseline_probability.shape
    baseline = baseline_probability >= 0.50
    shifted = shifted_probability >= 0.50

    category_names = [
        "selected_source_candidate_p_ge_0.50",
        "uncertain_source_candidate_p_0.20_0.50",
        "missed_source_candidate_p_0.01_0.20",
        "missed_source_candidate_p_lt_0.01",
    ]
    category_masks = {name: black_mask(args.anatomy_root / f"{name}.mask.png") for name in category_names}
    source_candidate = np.logical_or.reduce(list(category_masks.values()))

    baseline_x = stitch_boundaries(width)
    baseline_y = stitch_boundaries(height)
    shifted_x = [v - args.offset_x for v in stitch_boundaries(width + 2 * args.offset_x) if 0 < v - args.offset_x < width]
    shifted_y = [v - args.offset_y for v in stitch_boundaries(height + 2 * args.offset_y) if 0 < v - args.offset_y < height]
    baseline_distance = np.minimum(
        distance_to_boundaries(height, baseline_y)[:, None],
        distance_to_boundaries(width, baseline_x)[None, :],
    )
    shifted_distance = np.minimum(
        distance_to_boundaries(height, shifted_y)[:, None],
        distance_to_boundaries(width, shifted_x)[None, :],
    )

    choose_baseline = baseline_distance >= shifted_distance
    center_preferred_probability = np.where(choose_baseline, baseline_probability, shifted_probability)
    cap = 180.0
    baseline_weight = np.clip(baseline_distance.astype(np.float32), 4.0, cap)
    shifted_weight = np.clip(shifted_distance.astype(np.float32), 4.0, cap)
    distance_weighted_probability = (
        baseline_probability * baseline_weight + shifted_probability * shifted_weight
    ) / (baseline_weight + shifted_weight)

    methods = {
        "original-grid": baseline,
        "half-stride-grid": shifted,
        "agreement": baseline & shifted,
        "blind-union": baseline | shifted,
        "arithmetic-mean": ((baseline_probability + shifted_probability) / 2.0) >= 0.50,
        "distance-weighted": distance_weighted_probability >= 0.50,
        "center-preferred": center_preferred_probability >= 0.50,
        "seam-aware-source-recovery": baseline | (
            shifted
            & ~baseline
            & source_candidate
            & (baseline_distance <= 32)
            & (shifted_distance > baseline_distance)
        ),
    }
    metrics = {
        name: mask_metrics(mask, baseline, shifted, source_candidate, baseline_distance)
        for name, mask in methods.items()
    }

    baseline_missed = category_masks["missed_source_candidate_p_0.01_0.20"] | category_masks["missed_source_candidate_p_lt_0.01"]
    recovery = shifted & baseline_missed
    category_recovery = {}
    for name, mask in category_masks.items():
        category_recovery[name] = {
            "pixels": int(mask.sum()),
            "shifted_p0.50_selected": int((mask & shifted).sum()),
            "shifted_p0.50_rate": float((mask & shifted).sum() / max(1, mask.sum())),
            "shifted_probability_median": float(np.median(shifted_probability[mask])) if mask.any() else 0.0,
        }
    recovery_seam = {
        "pixels": int(recovery.sum()),
        "within_8px_original_seam": int((recovery & (baseline_distance <= 8)).sum()),
        "within_16px_original_seam": int((recovery & (baseline_distance <= 16)).sum()),
        "within_32px_original_seam": int((recovery & (baseline_distance <= 32)).sum()),
        "farther_from_shifted_seam": int((recovery & (shifted_distance > baseline_distance)).sum()),
    }
    recovery_seam.update(
        {
            f"{key}_fraction": float(value / max(1, recovery_seam["pixels"]))
            for key, value in list(recovery_seam.items())
            if key != "pixels"
        }
    )

    outputs = {}
    for name, mask in methods.items():
        path = args.output / f"{name}.mask.png"
        save_mask(mask, path)
        outputs[name] = {"file": path.name, "file_sha256": sha256_file(path)}
    full_board = args.output / "full-page-offset-grid-comparison.jpg"
    render_full_page(source, baseline_probability, shifted_probability, methods, full_board)

    anatomy = json.loads((args.anatomy_root / "experiment.json").read_text())
    window_outputs = []
    for index, window in enumerate(anatomy["missed_windows"], start=1):
        path = args.output / f"window-{index:02d}-offset-comparison.png"
        render_window(
            source,
            baseline_probability,
            shifted_probability,
            methods,
            window["bbox_xyxy"],
            f"window {index}",
            path,
        )
        window_outputs.append({"bbox_xyxy": window["bbox_xyxy"], "file": path.name, "file_sha256": sha256_file(path)})

    record = {
        "schema_version": "eynollah-offset-grid-comparison.v1",
        "evidence_visibility": "acting-safe-source-and-frozen-model-output-only",
        "sealed_human_evidence_used": False,
        "inputs": {
            "source_sha256": sha256_file(args.source),
            "baseline_probability_sha256": sha256_file(args.baseline_probability),
            "shifted_probability_sha256": sha256_file(args.shifted_probability),
            "anatomy_manifest_sha256": sha256_file(args.anatomy_root / "experiment.json"),
        },
        "grid_geometry": {
            "offset_xy": [args.offset_x, args.offset_y],
            "baseline_x_boundaries": baseline_x,
            "baseline_y_boundaries": baseline_y,
            "shifted_x_boundaries_source_coordinates": shifted_x,
            "shifted_y_boundaries_source_coordinates": shifted_y,
        },
        "category_recovery": category_recovery,
        "baseline_missed_recovery": recovery_seam,
        "method_metrics": metrics,
        "method_guardrails": {
            "agreement": "precision-oriented diagnostic; expected to lose legitimate alignment-specific ink",
            "blind-union": "recall upper bound; must not be promoted without contamination evidence",
            "arithmetic-mean": "requires both probabilities to support a pixel on average",
            "distance-weighted": "softly favors the alignment farther from a stitch",
            "center-preferred": "uses the single alignment farther from its nearest stitch",
            "seam-aware-source-recovery": "keeps baseline and adds only shifted source-consensus pixels near an original seam that moved farther from the shifted seam",
        },
        "outputs": outputs,
        "full_page_board": {"file": full_board.name, "file_sha256": sha256_file(full_board)},
        "window_boards": window_outputs,
        "runtime_seconds": time.perf_counter() - started,
    }
    record_path = args.output / "experiment.json"
    record_path.write_text(json.dumps(record, indent=2) + "\n")
    print(json.dumps({
        "category_recovery": category_recovery,
        "baseline_missed_recovery": recovery_seam,
        "method_metrics": metrics,
        "manifest_sha256": sha256_file(record_path),
    }))


if __name__ == "__main__":
    main()
