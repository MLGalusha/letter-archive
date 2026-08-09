#!/usr/bin/env python3
"""Compose one Eynollah pass with source enhancement, recovery, and graph grouping.

The enhanced image is used to score source pixels. The final evidence mask always
contains exact source-coordinate pixels; temporary grouping support never becomes ink.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from skimage import color, filters

from experiment_natural_faint_word_enhancement import ink_vector_boost
from experiment_vector_fragment_grouping import KERNELS, colour_groups, group_exact_pixels


FROZEN_CROPS = (
    ("folded-write-to-you", 1700, 1875, 1000, 350, "fold/rule contamination and faint writing"),
    ("enough-tight", 2050, 2100, 600, 300, "extremely faint word tail"),
    ("acknowledgement-tight", 1750, 3100, 900, 300, "long faint continuation"),
)
TIER_COLOURS = {
    "eynollah core": np.asarray((0, 174, 188), dtype=np.uint8),
    "local source recovery": np.asarray((42, 157, 85), dtype=np.uint8),
    "dark-vector agreement": np.asarray((235, 157, 34), dtype=np.uint8),
    "exploratory vector": np.asarray((206, 77, 146), dtype=np.uint8),
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_array(array: np.ndarray) -> str:
    return hashlib.sha256(np.ascontiguousarray(array).tobytes()).hexdigest()


def component_count(mask: np.ndarray) -> int:
    return int(ndimage.label(mask, structure=np.ones((3, 3), dtype=np.uint8))[1])


def valley_bounded_groups(
    evidence: np.ndarray,
    kernel_hw: tuple[int, int] = (5, 15),
    smoothing_sigma: float = 5.0,
    low_quantile: float = 0.10,
    minimum_valley_width: int = 10,
) -> tuple[np.ndarray, dict[str, object]]:
    """Group inside low-density column spans so faint pixels cannot bridge words."""
    density = evidence.sum(axis=0).astype(np.float32)
    smoothed = ndimage.gaussian_filter1d(density, smoothing_sigma)
    threshold = float(np.quantile(smoothed, low_quantile))
    low_labels, low_count = ndimage.label(smoothed <= threshold)
    valleys: list[dict[str, int | float]] = []
    boundaries: list[int] = []
    for valley_id in range(1, low_count + 1):
        xs = np.flatnonzero(low_labels == valley_id)
        if len(xs) < minimum_valley_width or xs[0] <= 10 or xs[-1] >= evidence.shape[1] - 11:
            continue
        midpoint = int(round((int(xs[0]) + int(xs[-1]) + 1) / 2))
        boundaries.append(midpoint)
        valleys.append(
            {
                "x0": int(xs[0]),
                "x1": int(xs[-1]) + 1,
                "width": int(len(xs)),
                "boundary_x": midpoint,
                "minimum_smoothed_density": float(smoothed[xs].min()),
            }
        )

    labels = np.zeros(evidence.shape, dtype=np.int32)
    group_offset = 0
    starts = [0, *boundaries]
    ends = [*boundaries, evidence.shape[1]]
    for start, end in zip(starts, ends):
        local_labels, _ = group_exact_pixels(evidence[:, start:end], kernel_hw)
        local_labels = np.where(local_labels > 0, local_labels + group_offset, 0)
        labels[:, start:end] = local_labels
        group_offset = int(labels.max())

    group_records: list[dict[str, int | float]] = []
    for group_id in range(1, int(labels.max()) + 1):
        ys, xs = np.nonzero(labels == group_id)
        group_records.append(
            {
                "group_id": group_id,
                "pixels": int(len(xs)),
                "bbox_xyxy": [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1],
                "width_fraction": float((xs.max() - xs.min() + 1) / evidence.shape[1]),
            }
        )
    raw_components = component_count(evidence)
    return labels, {
        "kernel_hw": list(kernel_hw),
        "column_density_smoothing_sigma": smoothing_sigma,
        "low_density_quantile": low_quantile,
        "low_density_threshold": threshold,
        "minimum_valley_width": minimum_valley_width,
        "valleys": valleys,
        "raw_evidence_components": raw_components,
        "review_groups": len(group_records),
        "component_to_group_reduction_fraction": float(1.0 - len(group_records) / max(1, raw_components)),
        "largest_group_width_fraction": max((record["width_fraction"] for record in group_records), default=0.0),
        "groups": group_records,
        "exact_evidence_pixel_count": int(evidence.sum()),
        "labels_int32_pixel_sha256": sha256_array(labels),
    }


def tier_overlay(source: np.ndarray, tiers: dict[str, np.ndarray]) -> Image.Image:
    result = source.astype(np.float32) * 0.55 + 255.0 * 0.45
    for name, mask in tiers.items():
        result[mask] = TIER_COLOURS[name]
    return Image.fromarray(np.clip(result, 0, 255).astype(np.uint8), "RGB")


def mask_overlay(source: np.ndarray, mask: np.ndarray, colour_rgb: tuple[int, int, int]) -> Image.Image:
    result = source.astype(np.float32) * 0.60 + 255.0 * 0.40
    result[mask] = colour_rgb
    return Image.fromarray(np.clip(result, 0, 255).astype(np.uint8), "RGB")


def render_composition_board(
    crop_name: str,
    source: np.ndarray,
    enhanced: np.ndarray,
    core: np.ndarray,
    tiers: dict[str, np.ndarray],
    tier_stats: dict[str, object],
    output: Path,
) -> None:
    panels = [
        ("original source", Image.fromarray(source, "RGB"), "unaltered acting-safe crop"),
        ("page-ink vector darkening", Image.fromarray(enhanced, "RGB"), "display/scoring transform; never label truth"),
        ("one-pass Eynollah core", mask_overlay(source, core, (0, 174, 188)), f"{core.sum():,} exact source pixels"),
        (
            "composed exact-source tiers",
            tier_overlay(source, tiers),
            " · ".join(f"{name} {tier_stats[name]['pixels']:,}" for name in tiers),
        ),
    ]
    panel_width = source.shape[1]
    panel_height = source.shape[0]
    title_height = 72
    board = Image.new("RGB", (panel_width * 2, (panel_height + title_height) * 2), "#f3eee4")
    draw = ImageDraw.Draw(board)
    for index, (name, panel, subtitle) in enumerate(panels):
        x = (index % 2) * panel_width
        y = (index // 2) * (panel_height + title_height)
        draw.text((x + 10, y + 8), f"{crop_name}: {name}", fill="#222222")
        draw.text((x + 10, y + 36), subtitle, fill="#555555")
        board.paste(panel, (x, y + title_height))
    board.save(output, optimize=True)


def render_group_board(
    crop_name: str,
    source: np.ndarray,
    tier_image: Image.Image,
    grouped: dict[str, tuple[np.ndarray, dict[str, object]]],
    output: Path,
) -> None:
    panels: list[tuple[str, Image.Image]] = [("evidence tiers", tier_image)]
    for name, (labels, stats) in grouped.items():
        panels.append((f"{name}: {stats['review_groups']} groups", colour_groups(source, labels)))
    panel_width = source.shape[1]
    panel_height = source.shape[0]
    title_height = 66
    board = Image.new("RGB", (panel_width * 2, (panel_height + title_height) * 2), "#f3eee4")
    draw = ImageDraw.Draw(board)
    for index, (name, panel) in enumerate(panels):
        x = (index % 2) * panel_width
        y = (index // 2) * (panel_height + title_height)
        draw.text((x + 10, y + 8), f"{crop_name}: exact pixels unchanged", fill="#222222")
        draw.text((x + 10, y + 36), name, fill="#555555")
        board.paste(panel, (x, y + title_height))
    board.save(output, optimize=True)


def render_valley_board(
    crop_name: str,
    source: np.ndarray,
    tier_image: Image.Image,
    global_labels: np.ndarray,
    valley_labels: np.ndarray,
    valley_stats: dict[str, object],
    output: Path,
) -> None:
    boundary_panel = tier_image.copy()
    boundary_draw = ImageDraw.Draw(boundary_panel)
    for valley in valley_stats["valleys"]:
        boundary_draw.rectangle(
            (valley["x0"], 0, valley["x1"] - 1, source.shape[0] - 1),
            outline=(220, 40, 45),
            width=2,
        )
    panels = [
        ("tier evidence", tier_image),
        (f"detected valleys: {len(valley_stats['valleys'])}", boundary_panel),
        ("global balanced grouping", colour_groups(source, global_labels)),
        (f"valley-bounded: {valley_stats['review_groups']} groups", colour_groups(source, valley_labels)),
    ]
    panel_width = source.shape[1]
    panel_height = source.shape[0]
    title_height = 66
    board = Image.new("RGB", (panel_width * 2, (panel_height + title_height) * 2), "#f3eee4")
    draw = ImageDraw.Draw(board)
    for index, (name, panel) in enumerate(panels):
        x = (index % 2) * panel_width
        y = (index // 2) * (panel_height + title_height)
        draw.text((x + 10, y + 8), f"{crop_name}: exact pixels unchanged", fill="#222222")
        draw.text((x + 10, y + 36), name, fill="#555555")
        board.paste(panel, (x, y + title_height))
    board.save(output, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--hybrid-probability", required=True, type=Path)
    parser.add_argument("--vector-root", required=True, type=Path)
    parser.add_argument("--local-recovery-root", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    source_page = np.asarray(Image.open(args.source).convert("RGB"))
    full_probability = np.load(args.hybrid_probability, allow_pickle=False).astype(np.float32)
    crop_records: dict[str, object] = {}

    for crop_name, x, y, width, height, role in FROZEN_CROPS:
        crop_started = time.perf_counter()
        source = source_page[y : y + height, x : x + width]
        probability = full_probability[y : y + height, x : x + width]
        corridor = np.zeros((height, width), dtype=bool)
        corridor[round(0.22 * height) : round(0.78 * height), :] = True
        core = (probability >= 0.50) & corridor
        source_lab = color.rgb2lab(source)
        local_std = ndimage.generic_filter(source_lab[..., 0], np.std, size=9, mode="nearest")
        paper = (probability <= 0.0001) & (local_std <= np.quantile(local_std, 0.45))
        enhanced = ink_vector_boost(source, core, paper, ridge_gated=False)
        original_gray = color.rgb2gray(source)
        enhanced_gray = color.rgb2gray(enhanced)
        darkening_response = np.maximum(original_gray - enhanced_gray, 0.0)
        ridge = filters.sato(original_gray, sigmas=(1, 2, 3), black_ridges=True)

        vector_score_path = args.vector_root / crop_name / "prototype-classifier-agreement.score.float16.npy"
        vector_score = np.load(vector_score_path, allow_pickle=False).astype(np.float32)
        vector = (vector_score >= 0.80) & corridor
        local_path = args.local_recovery_root / crop_name / "conservative.mask.png"
        local = (np.asarray(Image.open(local_path)) == 0) & corridor

        dark_floor = float(np.quantile(darkening_response[paper], 0.995))
        ridge_floor = float(np.quantile(ridge[paper], 0.95))
        dark_vector = vector & (darkening_response > dark_floor) & (ridge > ridge_floor)

        tiers = {
            "eynollah core": core,
            "local source recovery": local & ~core,
            "dark-vector agreement": dark_vector & ~local & ~core,
            "exploratory vector": vector & ~dark_vector & ~local & ~core,
        }
        evidence = np.zeros_like(core)
        tier_stats: dict[str, object] = {}
        for name, mask in tiers.items():
            evidence |= mask
            tier_stats[name] = {
                "pixels": int(mask.sum()),
                "components": component_count(mask),
                "paper_proxy_pixels": int((mask & paper).sum()),
                "mask_pixel_sha256": sha256_array(mask.astype(np.uint8)),
            }

        crop_dir = args.output / crop_name
        crop_dir.mkdir(parents=True, exist_ok=True)
        enhanced_path = crop_dir / "page-ink-vector-darkened.png"
        Image.fromarray(enhanced, "RGB").save(enhanced_path, optimize=True)
        evidence_path = crop_dir / "composed-exact-source-evidence.png"
        Image.fromarray(np.where(evidence, 0, 255).astype(np.uint8), "L").save(evidence_path)
        tier_labels = np.zeros((height, width), dtype=np.uint8)
        for tier_id, mask in enumerate(tiers.values(), start=1):
            tier_labels[mask] = tier_id
        tier_path = crop_dir / "evidence-tier-labels.uint8.png"
        Image.fromarray(tier_labels, "L").save(tier_path)

        grouped: dict[str, tuple[np.ndarray, dict[str, object]]] = {}
        grouping_records: dict[str, object] = {}
        for name, kernel in KERNELS.items():
            labels, stats = group_exact_pixels(evidence, kernel)
            grouped[name] = (labels, stats)
            labels_path = crop_dir / f"{name}.labels.uint16.png"
            Image.fromarray(labels.astype(np.uint16)).save(labels_path)
            grouping_records[name] = {
                **stats,
                "labels_file": labels_path.name,
                "labels_file_sha256": sha256_file(labels_path),
                "ink_pixel_identity_preserved": bool(np.array_equal(labels > 0, evidence)),
            }
        valley_labels, valley_stats = valley_bounded_groups(evidence)
        valley_labels_path = crop_dir / "valley-bounded-balanced.labels.uint16.png"
        Image.fromarray(valley_labels.astype(np.uint16)).save(valley_labels_path)
        grouping_records["valley-bounded-balanced-5x15"] = {
            **valley_stats,
            "labels_file": valley_labels_path.name,
            "labels_file_sha256": sha256_file(valley_labels_path),
            "ink_pixel_identity_preserved": bool(np.array_equal(valley_labels > 0, evidence)),
        }

        composition_board = crop_dir / "one-pass-composite-review.png"
        tier_image = tier_overlay(source, tiers)
        render_composition_board(crop_name, source, enhanced, core, tiers, tier_stats, composition_board)
        group_board = crop_dir / "one-pass-composite-grouping-review.png"
        render_group_board(crop_name, source, tier_image, grouped, group_board)
        valley_board = crop_dir / "one-pass-valley-bounded-grouping-review.png"
        render_valley_board(
            crop_name,
            source,
            tier_image,
            grouped["balanced-5x15"][0],
            valley_labels,
            valley_stats,
            valley_board,
        )

        crop_records[crop_name] = {
            "role": role,
            "bbox_xywh": [x, y, width, height],
            "corridor_y_fraction": [0.22, 0.78],
            "thresholds_frozen_before_output_review": {
                "eynollah_core": 0.50,
                "vector_score": 0.80,
                "darkening_response_paper_quantile": 0.995,
                "ridge_paper_quantile": 0.95,
            },
            "inputs": {
                "vector_score": {"path": str(vector_score_path), "file_sha256": sha256_file(vector_score_path)},
                "local_recovery": {"path": str(local_path), "file_sha256": sha256_file(local_path)},
            },
            "enhancement": {
                "darkening_response_floor": dark_floor,
                "ridge_floor": ridge_floor,
                "file": enhanced_path.name,
                "file_sha256": sha256_file(enhanced_path),
                "rgb_pixel_sha256": sha256_array(enhanced),
            },
            "tiers": tier_stats,
            "evidence": {
                "pixels": int(evidence.sum()),
                "components": component_count(evidence),
                "mask_pixel_sha256": sha256_array(evidence.astype(np.uint8)),
                "file": evidence_path.name,
                "file_sha256": sha256_file(evidence_path),
                "tier_labels_file": tier_path.name,
                "tier_labels_file_sha256": sha256_file(tier_path),
            },
            "grouping": grouping_records,
            "review_boards": {
                "composition": {"file": composition_board.name, "file_sha256": sha256_file(composition_board)},
                "grouping": {"file": group_board.name, "file_sha256": sha256_file(group_board)},
                "valley_bounded": {"file": valley_board.name, "file_sha256": sha256_file(valley_board)},
            },
            "runtime_seconds": time.perf_counter() - crop_started,
        }

    manifest = {
        "schema_version": "one-pass-composite-ink.v1",
        "experiment_status": "measurement_complete_visual_review_pending",
        "sealed_human_evidence_used": False,
        "selection_rule": "Run no new model inference. Reuse one frozen full-page Eynollah probability as core/noise teacher; combine conservative source recovery with positive-unknown page-ink vector evidence gated by measured darkening and ridge response; preserve lower-confidence vector evidence as an exploratory tier; group exact pixels with three previously frozen anisotropic kernels. Also challenge global balanced grouping with a predeclared projection-valley rule: Gaussian sigma 5, lowest 10% smoothed column density, minimum 10-pixel interior valley, and no grouping across the valley midpoint.",
        "interpretation_guardrail": "The union is a review surface, not an automatic word mask. Fewer components or more recovered pixels is not inherently better. Temporary grouping changes labels only and can never create final ink pixels.",
        "source": {"path": str(args.source), "file_sha256": sha256_file(args.source)},
        "hybrid_probability": {
            "path": str(args.hybrid_probability),
            "file_sha256": sha256_file(args.hybrid_probability),
        },
        "crops": crop_records,
        "runtime_seconds": time.perf_counter() - started,
    }
    manifest_path = args.output / "experiment.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"manifest": str(manifest_path), "runtime_seconds": manifest["runtime_seconds"]}, indent=2))


if __name__ == "__main__":
    main()
