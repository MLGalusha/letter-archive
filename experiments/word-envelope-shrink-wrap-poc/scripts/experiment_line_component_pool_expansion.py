#!/usr/bin/env python3
"""Freeze and evaluate fitted-line component pools with along-line expansion."""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
from typing import Any

import numpy as np

from experiment_disjoint_component_ownership import load_human_partition, load_mask, score_component_locators
from word_envelope.io_utils import canonical_json_bytes, read_json, sha256_file, sha256_mask_pixels, write_json
from word_envelope.line_word_assignment import assign_components_to_lines, build_line_frames
from word_envelope.semantic_binding_validation import validate_semantic_binding


MARGINS = (0.0, 0.15, 0.30, 0.45, 0.60, 0.80)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--experiment", type=Path, required=True)
    parser.add_argument("--clean-mask", type=Path, required=True)
    parser.add_argument("--centerlines", type=Path, required=True)
    parser.add_argument("--human-run", type=Path, required=True)
    parser.add_argument("--binding-ledger", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    if args.output_dir.exists():
        raise SystemExit("Output directory exists; refusing overwrite")
    args.output_dir.mkdir(parents=True)

    experiment = read_json(args.experiment)
    centerline_record = read_json(args.centerlines)
    clean = load_mask(args.clean_mask)
    scored = score_component_locators(
        clean, [{"unit_id": "whole", "bbox_xywh": [0, 0, clean.shape[1], clean.shape[0]]}]
    )
    components = scored["components"]
    labels = scored["labels"]

    global_configs = {
        config["locator"]: config
        for config in experiment["configurations"]
        if config["policy"] == "global_exclusive"
        and config["locator"] in {"transcript_bbox_xywh", "reviewed_bbox_xywh"}
    }
    if set(global_configs) != {"transcript_bbox_xywh", "reviewed_bbox_xywh"}:
        raise SystemExit("Expected both frozen global locator configurations")
    by_locator = {
        locator: {item["unit_id"]: item for item in config["items"]}
        for locator, config in global_configs.items()
    }
    units: list[dict[str, Any]] = []
    for unit_id, transcript in by_locator["transcript_bbox_xywh"].items():
        reviewed = by_locator["reviewed_bbox_xywh"][unit_id]
        boxes = [transcript["proposal_bbox_xywh"], reviewed["proposal_bbox_xywh"]]
        left = min(box[0] for box in boxes)
        top = min(box[1] for box in boxes)
        right = max(box[0] + box[2] for box in boxes)
        bottom = max(box[1] + box[3] for box in boxes)
        units.append(
            {
                "unit_id": unit_id,
                "line_id": transcript["line_id"],
                "word_order": transcript["word_order"],
                "bbox_xywh": [left, top, right - left, bottom - top],
                "text": transcript["text"],
                "source_bboxes": {
                    "transcript_bbox_xywh": transcript["proposal_bbox_xywh"],
                    "reviewed_bbox_xywh": reviewed["proposal_bbox_xywh"],
                },
            }
        )

    framed = build_line_frames(components, units, centerline_record["centerlines"])
    line_assignment = assign_components_to_lines(framed)
    unit_metadata = {unit["unit_id"]: unit for unit in units}
    pools: dict[str, dict[str, list[int]]] = {}
    for margin in MARGINS:
        margin_key = f"{margin:.2f}"
        pools[margin_key] = {}
        for line_id, frame in framed["frames"].items():
            line_component_ids = line_assignment["component_ids_by_line"][line_id]
            for unit in frame["units"]:
                lo, hi = (float(value) for value in unit["locator_u_interval"])
                padding = (hi - lo) * margin
                pool = [
                    int(component_id)
                    for component_id in line_component_ids
                    if lo - padding
                    <= float(framed["components"][component_id]["by_line"][line_id]["center_u"])
                    <= hi + padding
                ]
                pools[margin_key][unit["unit_id"]] = sorted(pool)

    frozen: dict[str, Any] = {
        "schema_version": "line-component-pool-expansion.v1",
        "evidence_role": "acting_candidates_only_no_human_data",
        "inputs": {
            "experiment": {"path": str(args.experiment.resolve()), "file_sha256": sha256_file(args.experiment), "experiment_sha256": experiment["experiment_sha256"]},
            "clean_mask": {"path": str(args.clean_mask.resolve()), "file_sha256": sha256_file(args.clean_mask), "pixel_sha256": sha256_mask_pixels(clean)},
            "centerlines": {"path": str(args.centerlines.resolve()), "file_sha256": sha256_file(args.centerlines), "record_sha256": centerline_record.get("centerline_record_sha256")},
        },
        "policy": {
            "line_assignment": line_assignment["policy"],
            "locator_fusion": "axis-aligned union of transcript and reviewed/Kraken rough boxes",
            "pool_rule": "component assigned to fitted line and component center_u inside fused locator interval expanded by margin times interval width on both sides",
            "along_line_margin_fractions": list(MARGINS),
            "ownership_rule": "pool only; selecting components remains a separate decision",
        },
        "units": unit_metadata,
        "component_pools": pools,
    }
    frozen["frozen_pool_set_sha256"] = hashlib.sha256(canonical_json_bytes(frozen)).hexdigest()
    frozen_path = args.output_dir / "frozen-pools.json"
    write_json(frozen_path, frozen)

    # Sealed evaluation begins only after the acting-safe pools are frozen above.
    validation = validate_semantic_binding(args.binding_ledger)
    if not validation["passed"]:
        raise SystemExit("Binding ledger failed strict validation")
    ledger = read_json(args.binding_ledger)
    binding = {
        unit["unit_id"]: [int(value) for value in unit["target_human_word_numbers"]]
        for line in ledger["lines"]
        for unit in line["units"]
        if unit["status"] == "assigned"
    }
    _, ownership = load_human_partition(args.human_run)
    component_count = int(labels.max())
    component_pixels = np.bincount(labels.ravel(), minlength=component_count + 1)
    results: list[dict[str, Any]] = []
    for margin in MARGINS:
        margin_key = f"{margin:.2f}"
        rows: list[dict[str, Any]] = []
        for unit_id, target_numbers in sorted(binding.items()):
            target = np.isin(ownership, np.asarray(target_numbers, dtype=ownership.dtype))
            target_component_pixels = np.bincount(
                labels[target & (labels > 0)].ravel(), minlength=component_count + 1
            )
            target_clean_total = int(target_component_pixels.sum())
            target_component_ids = set(np.flatnonzero(target_component_pixels).tolist()) - {0}
            pool_ids = pools[margin_key][unit_id]
            pool_target = int(target_component_pixels[pool_ids].sum()) if pool_ids else 0
            pool_total = int(component_pixels[pool_ids].sum()) if pool_ids else 0
            rows.append(
                {
                    "unit_id": unit_id,
                    "text": unit_metadata[unit_id]["text"],
                    "pool_component_ids": pool_ids,
                    "pool_component_count": len(pool_ids),
                    "target_component_ids": sorted(target_component_ids),
                    "missing_target_component_ids": sorted(target_component_ids - set(pool_ids)),
                    "target_clean_pixels": target_clean_total,
                    "pool_target_clean_pixels": pool_target,
                    "pool_foreign_or_unlabelled_pixels_if_all_selected": pool_total - pool_target,
                    "target_clean_pixel_recall": round(pool_target / max(1, target_clean_total), 6),
                    "whole_component_target_available": target_component_ids <= set(pool_ids),
                }
            )
        recalls = [row["target_clean_pixel_recall"] for row in rows]
        pool_counts = [row["pool_component_count"] for row in rows]
        results.append(
            {
                "margin_fraction": margin,
                "summary": {
                    "scorable_unit_count": len(rows),
                    "whole_component_target_available_count": sum(row["whole_component_target_available"] for row in rows),
                    "target_clean_recall_at_least_95_count": sum(row["target_clean_pixel_recall"] >= 0.95 for row in rows),
                    "median_target_clean_pixel_recall": round(float(np.median(recalls)), 6),
                    "median_pool_component_count": round(float(np.median(pool_counts)), 3),
                    "p90_pool_component_count": round(float(np.percentile(pool_counts, 90)), 3),
                    "total_foreign_or_unlabelled_pixels_if_all_selected": sum(row["pool_foreign_or_unlabelled_pixels_if_all_selected"] for row in rows),
                },
                "units": rows,
            }
        )

    latest_state = sorted((args.human_run / "revisions").glob("r*/state.json"))[-1]
    evaluation: dict[str, Any] = {
        "schema_version": "line-component-pool-expansion-evaluation.v1",
        "evidence_role": "sealed_post_freeze_evaluation_only_never_acting_input",
        "frozen_pools": {"path": str(frozen_path.resolve()), "file_sha256": sha256_file(frozen_path), "frozen_pool_set_sha256": frozen["frozen_pool_set_sha256"]},
        "semantic_binding": {"path": str(args.binding_ledger.resolve()), "file_sha256": sha256_file(args.binding_ledger), "adjudication_sha256": ledger["adjudication_sha256"]},
        "sealed_human_partition": {"path": str(args.human_run.resolve()), "latest_state_path": str(latest_state.resolve()), "latest_state_file_sha256": sha256_file(latest_state), "ownership_uint16_sha256": hashlib.sha256(ownership.tobytes()).hexdigest()},
        "guardrails": [
            "Candidate pools were hashed before the completed partition and semantic ledger were opened.",
            "Pool availability is not selection accuracy and does not authorize selecting every component.",
            "Target availability, pool size, and foreign-or-unlabelled distraction are reported separately.",
        ],
        "margins": results,
    }
    evaluation["analysis_sha256"] = hashlib.sha256(canonical_json_bytes(evaluation)).hexdigest()
    evaluation_path = args.output_dir / "evaluation.json"
    write_json(evaluation_path, evaluation)
    for result in results:
        print(result["margin_fraction"], result["summary"])
    print(f"frozen_pool_set_sha256={frozen['frozen_pool_set_sha256']}")
    print(f"frozen_file_sha256={sha256_file(frozen_path)}")
    print(f"analysis_sha256={evaluation['analysis_sha256']}")
    print(f"evaluation_file_sha256={sha256_file(evaluation_path)}")


if __name__ == "__main__":
    main()
