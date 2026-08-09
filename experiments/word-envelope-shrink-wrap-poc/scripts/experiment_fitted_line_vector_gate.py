#!/usr/bin/env python3
"""Gate page-adaptive vector ink with a line fitted from confident fragments."""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from sklearn.linear_model import LinearRegression, RANSACRegressor

from experiment_page_adaptive_vector_ink import component_count, load_source, sha256_array, sha256_file


POLICIES = ("fitted-line", "minimum-area-2", "minimum-area-4", "directional-group")


def fit_line_band(anchor: np.ndarray, rough_bbox: list[int]) -> tuple[np.ndarray, np.ndarray, dict[str, object]]:
    _x, rough_y, width, rough_height = rough_bbox
    rough_bottom = rough_y + rough_height
    row_density = ndimage.gaussian_filter1d(anchor.sum(axis=1).astype(np.float32), sigma=7.0)
    peak_y = int(rough_y + np.argmax(row_density[rough_y:rough_bottom]))
    initial_half_height = max(36, int(round(anchor.shape[0] * 0.18)))
    ys, xs = np.nonzero(
        anchor
        & (np.indices(anchor.shape)[0] >= peak_y - initial_half_height)
        & (np.indices(anchor.shape)[0] <= peak_y + initial_half_height)
    )
    if len(xs) < 50:
        raise ValueError("Insufficient confident anchor pixels to fit a line")

    bin_width = max(24, width // 24)
    bin_x: list[float] = []
    bin_y: list[float] = []
    for left in range(0, width, bin_width):
        in_bin = (xs >= left) & (xs < min(width, left + bin_width))
        if int(in_bin.sum()) >= 8:
            bin_x.append(float(np.median(xs[in_bin])))
            bin_y.append(float(np.median(ys[in_bin])))
    if len(bin_x) < 3:
        raise ValueError("Insufficient occupied x bins to fit a line")
    x_samples = np.asarray(bin_x, dtype=np.float64)[:, None]
    y_samples = np.asarray(bin_y, dtype=np.float64)
    line_model = RANSACRegressor(
        estimator=LinearRegression(),
        min_samples=max(2, int(np.ceil(len(bin_x) * 0.45))),
        residual_threshold=10.0,
        max_trials=100,
        random_state=20260809,
    ).fit(x_samples, y_samples)
    x_axis = np.arange(width, dtype=np.float64)
    centerline = line_model.predict(x_axis[:, None]).astype(np.float32)
    point_residual = ys.astype(np.float32) - centerline[xs]
    lower = float(np.quantile(point_residual, 0.01) - 7.0)
    upper = float(np.quantile(point_residual, 0.99) + 7.0)
    lower = max(lower, -float(anchor.shape[0] * 0.24))
    upper = min(upper, float(anchor.shape[0] * 0.24))
    yy = np.indices(anchor.shape)[0]
    band = (yy >= centerline[None, :] + lower) & (yy <= centerline[None, :] + upper)
    estimator = line_model.estimator_
    return band, centerline, {
        "rough_row_density_peak_y": peak_y,
        "initial_anchor_half_height": initial_half_height,
        "x_bin_width": bin_width,
        "occupied_bins": len(bin_x),
        "inlier_bins": int(np.asarray(line_model.inlier_mask_).sum()),
        "slope": float(estimator.coef_[0]),
        "intercept": float(estimator.intercept_),
        "residual_lower": lower,
        "residual_upper": upper,
        "band_median_height": int(round(upper - lower + 1)),
        "anchor_pixels_inside_band": int((anchor & band).sum()),
        "anchor_retention": float((anchor & band).sum() / max(1, anchor.sum())),
        "band_mask_pixel_sha256": sha256_array(band.astype(np.uint8)),
    }


def filter_minimum_area(mask: np.ndarray, minimum_area: int) -> tuple[np.ndarray, list[dict[str, object]]]:
    labels, count = ndimage.label(mask, structure=np.ones((3, 3), dtype=np.uint8))
    sizes = np.bincount(labels.ravel(), minlength=count + 1)
    keep = sizes >= minimum_area
    keep[0] = False
    records = [
        {"component_id": component_id, "pixels": int(sizes[component_id]), "accepted": bool(keep[component_id])}
        for component_id in range(1, count + 1)
    ]
    return keep[labels], records


def directional_group(mask: np.ndarray) -> tuple[np.ndarray, list[dict[str, object]]]:
    grouped = ndimage.binary_closing(mask, structure=np.ones((3, 11), dtype=bool))
    labels, count = ndimage.label(grouped, structure=np.ones((3, 3), dtype=np.uint8))
    retained = np.zeros_like(mask)
    records: list[dict[str, object]] = []
    for component_id in range(1, count + 1):
        group = labels == component_id
        ys, xs = np.nonzero(group)
        original_pixels = int((mask & group).sum())
        width = int(xs.max() - xs.min() + 1)
        height = int(ys.max() - ys.min() + 1)
        accepted = original_pixels >= 10 and width >= 7 and height >= 2
        if accepted:
            retained |= mask & group
        records.append(
            {
                "component_id": component_id,
                "original_pixels": original_pixels,
                "bbox_xywh": [int(xs.min()), int(ys.min()), width, height],
                "accepted": accepted,
            }
        )
    return retained, records


def metrics(mask: np.ndarray, ungated: np.ndarray, probability: np.ndarray) -> dict[str, object]:
    return {
        "pixels": int(mask.sum()),
        "components": component_count(mask),
        "retained_fraction_of_ungated": float(mask.sum() / max(1, ungated.sum())),
        "removed_pixels": int((ungated & ~mask).sum()),
        "hybrid_probability_bands": {
            "p_ge_0.20": int((mask & (probability >= 0.20)).sum()),
            "p_0.05_to_0.20": int((mask & (probability >= 0.05) & (probability < 0.20)).sum()),
            "p_0.01_to_0.05": int((mask & (probability >= 0.01) & (probability < 0.05)).sum()),
            "p_lt_0.01": int((mask & (probability < 0.01)).sum()),
        },
        "mask_pixel_sha256": sha256_array(mask.astype(np.uint8)),
    }


def overlay(source: np.ndarray, anchor: np.ndarray, additions: np.ndarray) -> Image.Image:
    result = source.astype(np.float32) * 0.62 + 255.0 * 0.38
    result[anchor] = (0, 190, 205)
    result[additions] = (235, 55, 45)
    return Image.fromarray(np.clip(result, 0, 255).astype(np.uint8), "RGB")


def render_board(
    label: str,
    source: np.ndarray,
    anchor: np.ndarray,
    ungated: np.ndarray,
    masks: dict[str, np.ndarray],
    centerline: np.ndarray,
    fit_record: dict[str, object],
    output: Path,
) -> None:
    ordered: list[tuple[str, np.ndarray | None]] = [
        ("source + fitted band", None),
        ("ungated vector agreement", ungated),
        *[(policy, masks[policy]) for policy in POLICIES],
    ]
    panel_width = 600
    panel_height = round(source.shape[0] * panel_width / source.shape[1])
    title_height = 72
    board = Image.new("RGB", (panel_width * 3, (panel_height + title_height) * 2), "#f3eee4")
    draw = ImageDraw.Draw(board)
    lower = float(fit_record["residual_lower"])
    upper = float(fit_record["residual_upper"])
    for index, (name, additions) in enumerate(ordered):
        x0 = (index % 3) * panel_width
        y0 = (index // 3) * (panel_height + title_height)
        if additions is None:
            panel = Image.fromarray(source, "RGB")
            panel_draw = ImageDraw.Draw(panel)
            line_points = [(int(x), int(round(y))) for x, y in enumerate(centerline)]
            upper_points = [(int(x), int(round(y + upper))) for x, y in enumerate(centerline)]
            lower_points = [(int(x), int(round(y + lower))) for x, y in enumerate(centerline)]
            panel_draw.line(line_points, fill=(220, 50, 40), width=2)
            panel_draw.line(upper_points, fill=(0, 165, 185), width=2)
            panel_draw.line(lower_points, fill=(0, 165, 185), width=2)
            subtitle = f"red center; cyan band; slope {fit_record['slope']:.4f}"
        else:
            panel = overlay(source, anchor, additions)
            subtitle = f"red additions {additions.sum():,} px | {component_count(additions):,} comps"
        panel = panel.resize((panel_width, panel_height), Image.Resampling.LANCZOS)
        draw.text((x0 + 10, y0 + 8), f"{label}: {name}", fill="#222222")
        draw.text((x0 + 10, y0 + 37), subtitle, fill="#8a2820" if additions is not None else "#555555")
        board.paste(panel, (x0, y0 + title_height))
    board.save(output, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--hybrid-probability", required=True, type=Path)
    parser.add_argument("--vector-root", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--page-id", required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    source = load_source(args.source)
    probability = np.load(args.hybrid_probability, allow_pickle=False).astype(np.float32)
    vector_manifest_path = args.vector_root / "experiment.json"
    vector_manifest = json.loads(vector_manifest_path.read_text())
    started = time.perf_counter()
    crop_records: dict[str, object] = {}
    for label, record in vector_manifest["crops"].items():
        x, y, width, height = record["bbox_xywh"]
        local_source = source[y : y + height, x : x + width]
        local_probability = probability[y : y + height, x : x + width]
        anchor = local_probability >= 0.50
        score_path = args.vector_root / label / "prototype-classifier-agreement.score.float16.npy"
        ungated = np.load(score_path, allow_pickle=False).astype(np.float32) >= 0.80
        ungated_additions = ungated & ~anchor
        band, centerline, fit_record = fit_line_band(anchor, record["rough_line_corridor_local_bbox_xywh"])
        fitted = ungated_additions & band
        area2, area2_components = filter_minimum_area(fitted, 2)
        area4, area4_components = filter_minimum_area(fitted, 4)
        grouped, grouped_components = directional_group(fitted)
        masks = {
            "fitted-line": fitted,
            "minimum-area-2": area2,
            "minimum-area-4": area4,
            "directional-group": grouped,
        }
        crop_dir = args.output / label
        crop_dir.mkdir(parents=True, exist_ok=True)
        output_records: dict[str, object] = {}
        policy_metrics: dict[str, object] = {}
        for policy, mask in masks.items():
            path = crop_dir / f"{policy}.additions.png"
            Image.fromarray(np.where(mask, 0, 255).astype(np.uint8), "L").save(path)
            output_records[policy] = {"file": path.name, "file_sha256": sha256_file(path)}
            policy_metrics[policy] = metrics(mask, ungated_additions, local_probability)
        board_path = crop_dir / "fitted-line-vector-gate-review.png"
        render_board(label, local_source, anchor, ungated_additions, masks, centerline, fit_record, board_path)
        crop_records[label] = {
            "bbox_xywh": record["bbox_xywh"],
            "rough_line_corridor_local_bbox_xywh": record["rough_line_corridor_local_bbox_xywh"],
            "input_score_file": str(score_path),
            "input_score_file_sha256": sha256_file(score_path),
            "ungated_addition_pixels": int(ungated_additions.sum()),
            "ungated_addition_components": component_count(ungated_additions),
            "line_fit": fit_record,
            "policies": policy_metrics,
            "component_decisions": {
                "minimum-area-2": area2_components,
                "minimum-area-4": area4_components,
                "directional-group": grouped_components,
            },
            "outputs": output_records,
            "review_board": {"file": board_path.name, "file_sha256": sha256_file(board_path)},
        }
    manifest = {
        "schema_version": "fitted-line-vector-gate.v1",
        "experiment_status": "measurement_complete_visual_review_pending",
        "page_id": args.page_id,
        "sealed_human_evidence_used": False,
        "selection_rule": "Use all three previously frozen acting-safe crops and the frozen v2 prototype-classifier agreement; fit line only from full-page hybrid anchor pixels.",
        "interpretation_guardrail": "Line-fit and component policies are proposal gates, not ownership truth. Judge target continuity, foreign/off-line ink, fragmentation, and likely correction effort together.",
        "source": {"path": str(args.source), "file_sha256": sha256_file(args.source)},
        "hybrid_probability": {"path": str(args.hybrid_probability), "file_sha256": sha256_file(args.hybrid_probability)},
        "upstream_vector_manifest": {"path": str(vector_manifest_path), "file_sha256": sha256_file(vector_manifest_path)},
        "line_algorithm": "Smoothed anchor row-density peak inside rough corridor; median-y x bins; RANSAC linear fit; asymmetric 1%-99% anchor residual band plus 7px margin.",
        "policies": list(POLICIES),
        "crops": crop_records,
        "runtime_seconds": time.perf_counter() - started,
    }
    manifest_path = args.output / "experiment.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print(json.dumps(manifest, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
