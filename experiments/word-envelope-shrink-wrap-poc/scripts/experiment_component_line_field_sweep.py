#!/usr/bin/env python3
"""Use high-confidence ink to estimate line fields before component assignment."""

from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

from experiment_component_score_weight_sweep import (
    evaluate,
    font,
    line_held_out,
    load_scored,
    pareto_front,
    ranking_key,
)
from experiment_disjoint_component_ownership import (
    bind_human_numbers,
    load_human_partition,
    load_mask,
    reviewed_units,
    transcript_boxes,
)
from word_envelope.component_assignment import (
    add_group_centerline_support,
    estimate_group_centerlines,
    exclusive_component_assignment,
)
from word_envelope.io_utils import canonical_json_bytes, sha256_file, sha256_mask_pixels


POLICIES = [(0.0, 2.5)] + [
    (weight, scale)
    for weight in (0.10, 0.20, 0.30, 0.40, 0.50, 0.65)
    for scale in (1.5, 2.5)
]


def freeze_candidates(
    scored: dict[str, Any],
    clean: np.ndarray,
    labels: np.ndarray,
    units: list[dict[str, Any]],
    centerlines: dict[str, dict[str, Any]],
    *,
    cross_group_only: bool,
    minimum_support_component_area_px: int,
) -> list[dict[str, Any]]:
    groups = {unit["unit_id"]: unit["line_id"] for unit in units}
    configurations: list[dict[str, Any]] = []
    for weight, scale in POLICIES:
        started = time.perf_counter()
        adjusted = add_group_centerline_support(
            scored,
            centerlines,
            groups,
            weight=weight,
            scale_multiplier=scale,
            cross_group_only=cross_group_only,
            minimum_component_area_px=minimum_support_component_area_px,
        )
        assigned = exclusive_component_assignment(
            adjusted,
            minimum_score=0.12,
            minimum_score_margin=0.08,
        )
        items: list[dict[str, Any]] = []
        claimed = np.zeros_like(clean)
        ambiguous_ids = {
            int(row["component_id"]) for row in assigned["ambiguous_components"]
        }
        for unit in units:
            component_ids = list(assigned["component_ids_by_unit"][unit["unit_id"]])
            selected = np.isin(labels, np.asarray(component_ids, dtype=labels.dtype))
            claimed |= selected
            touched = scored["touched_component_ids_by_unit"][unit["unit_id"]]
            items.append(
                {
                    "unit_id": unit["unit_id"],
                    "line_id": unit["line_id"],
                    "text": unit["text"],
                    "selected_component_ids": component_ids,
                    "selected_pixels": int(selected.sum()),
                    "selected_pixel_sha256": sha256_mask_pixels(selected),
                    "ambiguous_touched_component_ids": sorted(
                        component_id for component_id in touched if component_id in ambiguous_ids
                    ),
                }
            )
        configurations.append(
            {
                "config_id": f"{'cross-' if cross_group_only else ''}line-weight-{weight:.2f}--scale-{scale:.1f}",
                "weight_profile": "current_plus_acting_ink_line_field",
                "cross_group_only": cross_group_only,
                "minimum_support_component_area_px": minimum_support_component_area_px,
                "line_support_weight": weight,
                "line_scale_multiplier": scale,
                "minimum_score_margin": 0.08,
                "assignment_wall_time_ms": round((time.perf_counter() - started) * 1000.0, 3),
                "ambiguous_component_count": len(ambiguous_ids),
                "ambiguous_component_pixels": int(
                    sum(scored["components"][component_id - 1]["area_px"] for component_id in ambiguous_ids)
                ),
                "claimed_union_pixels": int(claimed.sum()),
                "clean_residual_pixels": int(np.count_nonzero(clean & ~claimed)),
                "items": items,
            }
        )
    return configurations


def render_acting_centerlines(
    clean: np.ndarray,
    scored: dict[str, Any],
    units: list[dict[str, Any]],
    centerlines: dict[str, dict[str, Any]],
    path: Path,
) -> None:
    scale = 0.4
    height, width = clean.shape
    values = np.full((height, width, 3), (250, 246, 237), dtype=np.uint8)
    values[clean] = (45, 48, 52)
    image = Image.fromarray(values, mode="RGB").resize(
        (round(width * scale), round(height * scale)), Image.Resampling.LANCZOS
    )
    draw = ImageDraw.Draw(image)
    locators = {row["unit_id"]: row["bbox_xywh"] for row in scored["locators"]}
    colors = ((202, 48, 49), (0, 135, 160), (178, 64, 153), (222, 143, 30))
    for index, (group_id, line) in enumerate(sorted(centerlines.items())):
        boxes = [locators[unit["unit_id"]] for unit in units if unit["line_id"] == group_id]
        if not boxes:
            continue
        x0 = min(box[0] for box in boxes)
        x1 = max(box[0] + box[2] for box in boxes)
        y0 = float(line["slope"]) * x0 + float(line["intercept"])
        y1 = float(line["slope"]) * x1 + float(line["intercept"])
        color = colors[index % len(colors)]
        draw.line((x0 * scale, y0 * scale, x1 * scale, y1 * scale), fill=color, width=3)
        draw.text((x0 * scale + 4, y0 * scale - 18), group_id, fill=color, font=font(13, bold=True))
    image.save(path, format="JPEG", quality=93, subsampling=0, optimize=True)


def render_sealed_grid(configurations: list[dict[str, Any]], path: Path) -> None:
    columns, cell_w, cell_h = 7, 200, 170
    rows = (len(configurations) + columns - 1) // columns
    image = Image.new("RGB", (columns * cell_w + 38, rows * cell_h + 108), (250, 246, 237))
    draw = ImageDraw.Draw(image)
    draw.text((20, 16), "ACTING INK LINE-FIELD SWEEP — SEALED POST-FREEZE", fill=(38, 34, 29), font=font(25, bold=True))
    draw.text((20, 52), "base locator score blended with distance to robust line fitted from high-confidence components", fill=(75, 65, 55), font=font(15))
    for index, config in enumerate(configurations):
        x = 20 + (index % columns) * cell_w
        y = 88 + (index // columns) * cell_h
        summary = config["summary"]
        quality = summary["high_quality_count"]
        fill = (121, 171, 139) if quality >= 56 else (184, 178, 134)
        draw.rounded_rectangle((x, y, x + 184, y + 150), radius=8, fill=fill, outline=(75, 75, 65))
        draw.text((x + 10, y + 10), f"w {config['line_support_weight']:.2f} / s {config['line_scale_multiplier']:.1f}", fill=(30, 38, 30), font=font(16, bold=True))
        draw.text((x + 10, y + 42), f"HQ {quality}/77", fill=(25, 35, 26), font=font(20, bold=True))
        draw.text((x + 10, y + 76), f"foreign {summary['foreign_error_word_count']} · missed {summary['missed_error_word_count']}", fill=(38, 42, 36), font=font(14))
        draw.text((x + 10, y + 103), f"ambiguous {config['ambiguous_component_count']}", fill=(38, 42, 36), font=font(14))
        draw.text((x + 10, y + 126), f"residual {config['clean_residual_pixels']:,}", fill=(38, 42, 36), font=font(13))
    image.save(path, format="JPEG", quality=94, subsampling=0, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--score-record", type=Path, required=True)
    parser.add_argument("--reviewed-decision", type=Path, required=True)
    parser.add_argument("--transcript-localization", type=Path, required=True)
    parser.add_argument("--clean-mask", type=Path, required=True)
    parser.add_argument("--human-run", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--cross-group-only", action="store_true")
    parser.add_argument("--minimum-support-component-area-px", type=int, default=1)
    args = parser.parse_args()
    if args.output_dir.exists():
        raise SystemExit("Output exists; refusing overwrite")
    args.output_dir.mkdir(parents=True)

    clean = load_mask(args.clean_mask)
    labels, component_count = ndimage.label(clean, structure=np.ones((3, 3), dtype=np.uint8))
    scored = load_scored(args.score_record)
    if component_count != len(scored["components"]):
        raise RuntimeError("Frozen component record does not match Clean mask")
    units = reviewed_units(args.reviewed_decision)
    transcript = transcript_boxes(args.transcript_localization)
    for unit in units:
        key = (unit["line_order"], unit["word_order"])
        if key in transcript:
            unit["transcript_bbox_xywh"] = transcript[key]
    units = [unit for unit in units if "transcript_bbox_xywh" in unit]
    groups = {unit["unit_id"]: unit["line_id"] for unit in units}

    seed = exclusive_component_assignment(
        scored,
        minimum_score=0.12,
        minimum_score_margin=0.30,
    )
    centerlines = estimate_group_centerlines(
        scored,
        seed["component_ids_by_unit"],
        groups,
        minimum_component_area_px=50,
    )
    acting_board = args.output_dir / "acting-ink-centerlines.jpg"
    render_acting_centerlines(clean, scored, units, centerlines, acting_board)
    centerline_path = args.output_dir / "acting-centerlines.json"
    centerline_record = {
        "schema_version": "acting-ink-centerlines.v1",
        "evidence_role": "acting_visible_no_human_data",
        "seed_policy": {"minimum_score": 0.12, "minimum_score_margin": 0.30, "minimum_component_area_px": 50},
        "centerlines": centerlines,
        "board": {"path": acting_board.name, "file_sha256": sha256_file(acting_board)},
    }
    centerline_record["centerline_record_sha256"] = hashlib.sha256(canonical_json_bytes(centerline_record)).hexdigest()
    centerline_path.write_bytes(canonical_json_bytes(centerline_record) + b"\n")

    started = time.perf_counter()
    configurations = freeze_candidates(
        scored,
        clean,
        labels,
        units,
        centerlines,
        cross_group_only=args.cross_group_only,
        minimum_support_component_area_px=args.minimum_support_component_area_px,
    )
    frozen: dict[str, Any] = {
        "schema_version": "component-line-field-sweep-frozen.v1",
        "evidence_role": "acting_candidates_only_no_human_data",
        "sealed_evaluation_loaded": False,
        "cross_group_only": args.cross_group_only,
        "minimum_support_component_area_px": args.minimum_support_component_area_px,
        "inputs": {
            "score_record": {"path": str(args.score_record), "file_sha256": sha256_file(args.score_record)},
            "centerlines": {"path": centerline_path.name, "file_sha256": sha256_file(centerline_path), "record_sha256": centerline_record["centerline_record_sha256"]},
            "clean_mask": {"path": str(args.clean_mask), "file_sha256": sha256_file(args.clean_mask), "pixel_sha256": sha256_mask_pixels(clean), "pixels": int(clean.sum())},
        },
        "unit_ids": [unit["unit_id"] for unit in units],
        "candidate_freeze_wall_time_ms": round((time.perf_counter() - started) * 1000.0, 3),
        "configurations": configurations,
    }
    frozen["frozen_candidate_set_sha256"] = hashlib.sha256(canonical_json_bytes(frozen)).hexdigest()
    frozen_path = args.output_dir / "frozen-candidates.json"
    frozen_path.write_bytes(canonical_json_bytes(frozen) + b"\n")

    human, ownership = load_human_partition(args.human_run)
    binding = bind_human_numbers(units, human, "transcript_bbox_xywh")
    evaluate(configurations, labels, human, ownership, binding)
    held_out = line_held_out(configurations)
    ranked = sorted(configurations, key=lambda value: (ranking_key(value["summary"]), value["config_id"]), reverse=True)
    sealed_board = args.output_dir / "sealed-line-field-grid.jpg"
    render_sealed_grid(configurations, sealed_board)
    record: dict[str, Any] = {
        "schema_version": "component-line-field-sweep-experiment.v1",
        "evidence_role": "page_007_development_with_post_freeze_sealed_evaluation",
        "acting_centerlines": {"path": centerline_path.name, "file_sha256": sha256_file(centerline_path), "record_sha256": centerline_record["centerline_record_sha256"], "board_path": acting_board.name, "board_file_sha256": sha256_file(acting_board)},
        "frozen_candidate_set": {"path": frozen_path.name, "file_sha256": sha256_file(frozen_path), "candidate_set_sha256": frozen["frozen_candidate_set_sha256"], "candidate_freeze_wall_time_ms": frozen["candidate_freeze_wall_time_ms"], "sealed_evaluation_loaded_after_file_written": True},
        "configuration_count": len(configurations),
        "cross_group_only": args.cross_group_only,
        "minimum_support_component_area_px": args.minimum_support_component_area_px,
        "pareto_config_ids": pareto_front(configurations),
        "line_held_out": held_out,
        "ranked_configurations": [
            {
                "config_id": config["config_id"],
                "line_support_weight": config["line_support_weight"],
                "line_scale_multiplier": config["line_scale_multiplier"],
                "ambiguous_component_count": config["ambiguous_component_count"],
                "ambiguous_component_pixels": config["ambiguous_component_pixels"],
                "claimed_union_pixels": config["claimed_union_pixels"],
                "clean_residual_pixels": config["clean_residual_pixels"],
                "summary": config["summary"],
            }
            for config in ranked
        ],
        "configurations": configurations,
        "sealed_board": {"path": sealed_board.name, "file_sha256": sha256_file(sealed_board), "evidence_role": "post_freeze_sealed_evaluation_only"},
        "metric_warning": "Centerlines are inferred from initial machine assignments and can reinforce a wrong seed. Treat line-field gains as suggestions; inspect changed components, misses, residual, and line-held-out stability.",
    }
    record["experiment_sha256"] = hashlib.sha256(canonical_json_bytes(record)).hexdigest()
    experiment_path = args.output_dir / "experiment.json"
    experiment_path.write_bytes(canonical_json_bytes(record) + b"\n")
    print(json.dumps({"output": str(args.output_dir), "experiment_sha256": record["experiment_sha256"], "top": record["ranked_configurations"][:5], "line_held_out": held_out["combined_held_out_summary"]}, indent=2))


if __name__ == "__main__":
    main()
