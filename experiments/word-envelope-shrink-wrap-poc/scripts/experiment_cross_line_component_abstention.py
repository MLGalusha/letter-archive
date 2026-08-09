#!/usr/bin/env python3
"""Test stricter abstention when a component is disputed across lines."""

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
from word_envelope.component_assignment import exclusive_component_assignment
from word_envelope.io_utils import canonical_json_bytes, sha256_file, sha256_mask_pixels


CROSS_LINE_MARGINS = (0.08, 0.15, 0.20, 0.22, 0.25, 0.30, 0.40, 0.60)


def freeze_candidates(
    scored: dict[str, Any],
    clean: np.ndarray,
    labels: np.ndarray,
    units: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    unit_groups = {unit["unit_id"]: unit["line_id"] for unit in units}
    by_unit = {unit["unit_id"]: unit for unit in units}
    configurations: list[dict[str, Any]] = []
    for cross_margin in CROSS_LINE_MARGINS:
        started = time.perf_counter()
        assigned = exclusive_component_assignment(
            scored,
            minimum_score=0.12,
            minimum_score_margin=0.08,
            unit_groups=unit_groups,
            cross_group_minimum_score_margin=cross_margin,
        )
        ambiguity_by_id = {
            int(row["component_id"]): row for row in assigned["ambiguous_components"]
        }
        items: list[dict[str, Any]] = []
        claimed = np.zeros_like(clean)
        for unit in units:
            unit_id = unit["unit_id"]
            component_ids = list(assigned["component_ids_by_unit"][unit_id])
            selected = np.isin(labels, np.asarray(component_ids, dtype=labels.dtype))
            claimed |= selected
            touched = scored["touched_component_ids_by_unit"][unit_id]
            items.append(
                {
                    "unit_id": unit_id,
                    "line_id": unit["line_id"],
                    "text": unit["text"],
                    "selected_component_ids": component_ids,
                    "selected_pixels": int(selected.sum()),
                    "selected_pixel_sha256": sha256_mask_pixels(selected),
                    "ambiguous_touched_component_ids": sorted(
                        component_id for component_id in touched if component_id in ambiguity_by_id
                    ),
                }
            )
        cross_ambiguities = [
            row for row in assigned["ambiguous_components"]
            if row["competition_scope"] == "cross_group"
        ]
        configurations.append(
            {
                "config_id": f"cross-line-margin-{cross_margin:.2f}",
                "weight_profile": "current",
                "minimum_score_margin": 0.08,
                "cross_line_minimum_score_margin": cross_margin,
                "assignment_wall_time_ms": round((time.perf_counter() - started) * 1000.0, 3),
                "ambiguous_component_count": len(assigned["ambiguous_components"]),
                "cross_line_ambiguous_component_ids": [int(row["component_id"]) for row in cross_ambiguities],
                "cross_line_ambiguous_component_pixels": int(
                    sum(scored["components"][int(row["component_id"]) - 1]["area_px"] for row in cross_ambiguities)
                ),
                "claimed_union_pixels": int(claimed.sum()),
                "clean_residual_pixels": int(np.count_nonzero(clean & ~claimed)),
                "items": items,
            }
        )
    return configurations


def render(configurations: list[dict[str, Any]], path: Path) -> None:
    width, height = 1460, 390
    image = Image.new("RGB", (width, height), (250, 246, 237))
    draw = ImageDraw.Draw(image)
    draw.text((22, 18), "CROSS-LINE COMPONENT ABSTENTION — SEALED POST-FREEZE", fill=(38, 34, 29), font=font(25, bold=True))
    draw.text((22, 55), "within-line margin fixed at 0.08 · every cell reports ownership, contamination, misses, and residual", fill=(75, 65, 55), font=font(15))
    cell_w = 174
    for index, config in enumerate(configurations):
        x, y = 22 + index * cell_w, 100
        summary = config["summary"]
        quality = summary["high_quality_count"]
        fill = (121, 171, 139) if quality >= 56 else (183, 177, 133)
        draw.rounded_rectangle((x, y, x + 158, y + 245), radius=9, fill=fill, outline=(75, 75, 65), width=1)
        draw.text((x + 12, y + 12), f"cross {config['cross_line_minimum_score_margin']:.2f}", fill=(30, 38, 30), font=font(17, bold=True))
        draw.text((x + 12, y + 50), f"HQ {quality}/77", fill=(25, 35, 26), font=font(20, bold=True))
        draw.text((x + 12, y + 87), f"foreign {summary['foreign_error_word_count']}", fill=(38, 42, 36), font=font(15))
        draw.text((x + 12, y + 114), f"missed {summary['missed_error_word_count']}", fill=(38, 42, 36), font=font(15))
        draw.text((x + 12, y + 141), f"cross abstain {len(config['cross_line_ambiguous_component_ids'])}", fill=(38, 42, 36), font=font(15))
        draw.text((x + 12, y + 168), f"abstain px {config['cross_line_ambiguous_component_pixels']:,}", fill=(38, 42, 36), font=font(14))
        draw.text((x + 12, y + 195), f"residual {config['clean_residual_pixels']:,}", fill=(38, 42, 36), font=font(14))
    image.save(path, format="JPEG", quality=94, subsampling=0, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--score-record", type=Path, required=True)
    parser.add_argument("--reviewed-decision", type=Path, required=True)
    parser.add_argument("--transcript-localization", type=Path, required=True)
    parser.add_argument("--clean-mask", type=Path, required=True)
    parser.add_argument("--human-run", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
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

    started = time.perf_counter()
    configurations = freeze_candidates(scored, clean, labels, units)
    frozen: dict[str, Any] = {
        "schema_version": "cross-line-component-abstention-frozen.v1",
        "evidence_role": "acting_candidates_only_no_human_data",
        "sealed_evaluation_loaded": False,
        "inputs": {
            "score_record": {"path": str(args.score_record), "file_sha256": sha256_file(args.score_record)},
            "reviewed_decision": {"path": str(args.reviewed_decision), "file_sha256": sha256_file(args.reviewed_decision)},
            "transcript_localization": {"path": str(args.transcript_localization), "file_sha256": sha256_file(args.transcript_localization)},
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
    board_path = args.output_dir / "sealed-cross-line-margin.jpg"
    render(configurations, board_path)
    record: dict[str, Any] = {
        "schema_version": "cross-line-component-abstention-experiment.v1",
        "evidence_role": "page_007_development_with_post_freeze_sealed_evaluation",
        "frozen_candidate_set": {
            "path": frozen_path.name,
            "file_sha256": sha256_file(frozen_path),
            "candidate_set_sha256": frozen["frozen_candidate_set_sha256"],
            "candidate_freeze_wall_time_ms": frozen["candidate_freeze_wall_time_ms"],
            "sealed_evaluation_loaded_after_file_written": True,
        },
        "configuration_count": len(configurations),
        "pareto_config_ids": pareto_front(configurations),
        "line_held_out": held_out,
        "ranked_configurations": [
            {
                "config_id": config["config_id"],
                "cross_line_minimum_score_margin": config["cross_line_minimum_score_margin"],
                "cross_line_ambiguous_component_ids": config["cross_line_ambiguous_component_ids"],
                "cross_line_ambiguous_component_pixels": config["cross_line_ambiguous_component_pixels"],
                "claimed_union_pixels": config["claimed_union_pixels"],
                "clean_residual_pixels": config["clean_residual_pixels"],
                "summary": config["summary"],
            }
            for config in ranked
        ],
        "configurations": configurations,
        "board": {"path": board_path.name, "file_sha256": sha256_file(board_path), "evidence_role": "post_freeze_sealed_evaluation_only"},
        "metric_warning": "A cross-line guard can remove true target components as well as foreign ones. Read high-quality count, foreign errors, missed errors, abstained pixels, residual, and line-held-out selection together.",
    }
    record["experiment_sha256"] = hashlib.sha256(canonical_json_bytes(record)).hexdigest()
    experiment_path = args.output_dir / "experiment.json"
    experiment_path.write_bytes(canonical_json_bytes(record) + b"\n")
    print(json.dumps({
        "output": str(args.output_dir),
        "experiment_sha256": record["experiment_sha256"],
        "top": record["ranked_configurations"][:4],
        "line_held_out": held_out["combined_held_out_summary"],
    }, indent=2))


if __name__ == "__main__":
    main()
