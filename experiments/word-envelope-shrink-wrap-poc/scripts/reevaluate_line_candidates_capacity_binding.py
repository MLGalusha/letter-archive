#!/usr/bin/env python3
"""Re-evaluate frozen candidates with capacity-constrained fitted-line binding."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

import numpy as np
from scipy.optimize import linear_sum_assignment

from experiment_disjoint_component_ownership import load_human_partition, load_mask, score_component_locators
from reevaluate_line_candidates_canonical_binding import LOCATORS, POLICIES, BASELINE, evaluate, identifier, summary
from word_envelope.io_utils import canonical_json_bytes, sha256_file, sha256_mask_pixels


def line_cost(word: dict[str, Any], line_id: str, line: dict[str, Any], extents: dict[str, tuple[float, float]]) -> float:
    x, y, width, height = word["bbox_xywh"]
    center_x = x + width / 2.0
    center_y = y + height / 2.0
    line_y = float(line["slope"]) * center_x + float(line["intercept"])
    perpendicular = abs(center_y - line_y) / float(np.hypot(1.0, float(line["slope"])))
    x0, x1 = extents[line_id]
    outside = max(0.0, x0 - center_x, center_x - x1)
    return perpendicular + 0.35 * outside


def assign_window_to_lines(
    words: list[dict[str, Any]],
    line_ids: list[str],
    centerlines: dict[str, dict[str, Any]],
    extents: dict[str, tuple[float, float]],
) -> tuple[float, dict[str, list[dict[str, Any]]]]:
    costs = np.zeros((len(words), len(line_ids)), dtype=np.float64)
    for row, word in enumerate(words):
        for column, line_id in enumerate(line_ids):
            costs[row, column] = line_cost(word, line_id, centerlines[line_id], extents)
    rows, columns = linear_sum_assignment(costs)
    grouped: dict[str, list[dict[str, Any]]] = {line_id: [] for line_id in sorted(set(line_ids))}
    for row, column in zip(rows, columns):
        grouped[line_ids[int(column)]].append(words[int(row)])
    return float(costs[rows, columns].sum()), grouped


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--experiment", type=Path, required=True)
    parser.add_argument("--clean-mask", type=Path, required=True)
    parser.add_argument("--human-run", type=Path, required=True)
    parser.add_argument("--centerlines", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    experiment = json.loads(args.experiment.read_text(encoding="utf-8"))
    configurations = [
        config
        for config in experiment["configurations"]
        if config["locator"] in LOCATORS and config["policy"] in POLICIES
    ]
    baseline = next(config for config in configurations if identifier(config) == BASELINE)
    units = sorted(
        baseline["items"],
        key=lambda item: (int(item["line_order"]), int(item["word_order"]), item["unit_id"]),
    )
    if len(configurations) != 8 or len(units) != 77:
        raise SystemExit("Expected eight configurations and 77 units")
    centerline_record = json.loads(args.centerlines.read_text(encoding="utf-8"))
    centerlines = centerline_record["centerlines"]
    counts: dict[str, int] = {}
    extents: dict[str, tuple[float, float]] = {}
    for unit in units:
        line_id = str(unit["line_id"])
        counts[line_id] = counts.get(line_id, 0) + 1
        x, _, width, _ = unit["proposal_bbox_xywh"]
        old = extents.get(line_id, (float(x), float(x + width)))
        extents[line_id] = (min(old[0], float(x)), max(old[1], float(x + width)))
    line_slots = [line_id for line_id in sorted(counts) for _ in range(counts[line_id])]

    clean = load_mask(args.clean_mask)
    labels = score_component_locators(
        clean,
        [{"unit_id": "whole", "bbox_xywh": [0, 0, clean.shape[1], clean.shape[0]]}],
    )["labels"]
    human, ownership = load_human_partition(args.human_run)
    human_by_number = {int(word["word_number"]): word for word in human}
    ordered_human = sorted(human, key=lambda word: int(word["word_number"]))

    windows: list[dict[str, Any]] = []
    grouped_by_window: dict[tuple[int, int], dict[str, list[dict[str, Any]]]] = {}
    for start in range(0, len(ordered_human) - len(units) + 1):
        window = ordered_human[start : start + len(units)]
        cost, grouped = assign_window_to_lines(window, line_slots, centerlines, extents)
        key = (int(window[0]["word_number"]), int(window[-1]["word_number"]))
        grouped_by_window[key] = grouped
        windows.append(
            {
                "start_word_number": key[0],
                "end_word_number": key[1],
                "line_assignment_cost_px": round(cost, 6),
            }
        )
    windows.sort(key=lambda row: (row["line_assignment_cost_px"], row["start_word_number"]))
    best, runner_up = windows[0], windows[1]
    grouped = grouped_by_window[(best["start_word_number"], best["end_word_number"])]

    canonical_binding: dict[str, int] = {}
    line_receipts: list[dict[str, Any]] = []
    for line_id in sorted(grouped):
        line = centerlines[line_id]
        direction = np.asarray([1.0, float(line["slope"])], dtype=np.float64)
        direction /= np.linalg.norm(direction)
        origin = np.asarray([0.0, float(line["intercept"])], dtype=np.float64)
        line_words = sorted(
            grouped[line_id],
            key=lambda word: float(
                np.dot(
                    np.asarray(
                        [
                            word["bbox_xywh"][0] + word["bbox_xywh"][2] / 2.0,
                            word["bbox_xywh"][1] + word["bbox_xywh"][3] / 2.0,
                        ]
                    )
                    - origin,
                    direction,
                )
            ),
        )
        line_units = [unit for unit in units if unit["line_id"] == line_id]
        if len(line_words) != len(line_units):
            raise RuntimeError(f"Capacity mismatch for {line_id}")
        pairs = []
        for unit, word in zip(line_units, line_words):
            canonical_binding[str(unit["unit_id"])] = int(word["word_number"])
            pairs.append(
                {
                    "unit_id": unit["unit_id"],
                    "text": unit["text"],
                    "word_order": unit["word_order"],
                    "human_word_number": int(word["word_number"]),
                    "human_bbox_xywh": word["bbox_xywh"],
                    "unit_bbox_xywh": unit["proposal_bbox_xywh"],
                }
            )
        line_receipts.append({"line_id": line_id, "capacity": len(line_units), "pairs": pairs})

    original_transcript_binding = {
        str(item["unit_id"]): int(item["evaluation_human_word_number"])
        for item in baseline["items"]
    }
    mismatches: list[dict[str, Any]] = []
    reevaluated: list[dict[str, Any]] = []
    by_unit: dict[str, list[dict[str, Any]]] = {}
    for config in configurations:
        config_id = identifier(config)
        items: list[dict[str, Any]] = []
        for item in config["items"]:
            unit_id = str(item["unit_id"])
            number = canonical_binding[unit_id]
            original_number = int(item["evaluation_human_word_number"])
            if original_number != number:
                mismatches.append(
                    {
                        "proposal_id": config_id,
                        "unit_id": unit_id,
                        "text": item["text"],
                        "original_human_word_number": original_number,
                        "capacity_binding_human_word_number": number,
                    }
                )
            selected = np.isin(labels, np.asarray(item["selected_component_ids"], dtype=labels.dtype))
            if int(selected.sum()) != int(item["selected_pixels"]) or sha256_mask_pixels(selected) != item["selected_pixel_sha256"]:
                raise RuntimeError(f"Frozen selection mismatch for {config_id} {unit_id}")
            human_word = human_by_number[number]
            value = evaluate(selected, ownership == number, ownership, int(human_word["pixels"]))
            row = {
                "unit_id": unit_id,
                "text": item["text"],
                "line_id": item["line_id"],
                "proposal_id": config_id,
                "selected_component_ids": item["selected_component_ids"],
                "selected_pixel_sha256": item["selected_pixel_sha256"],
                "capacity_binding_human_word_number": number,
                "capacity_binding_human_pixel_sha256": human_word["pixel_sha256"],
                "original_human_word_number": original_number,
                "capacity_binding_evaluation": value,
            }
            items.append(row)
            by_unit.setdefault(unit_id, []).append(row)
        adapted = [{"canonical_evaluation": row["capacity_binding_evaluation"]} for row in items]
        reevaluated.append(
            {
                "proposal_id": config_id,
                "locator": config["locator"],
                "policy": config["policy"],
                "original_high_quality_count": config["summary"]["evaluation_high_quality_count"],
                "capacity_binding_summary": summary(adapted),
                "items": items,
            }
        )

    categories = {
        "baseline_already_high_quality": 0,
        "recoverable_by_transcript_method_choice": 0,
        "recoverable_only_with_reviewed_locator_choice": 0,
        "no_frozen_proposal_high_quality": 0,
    }
    oracle_units = []
    for unit_id, rows in sorted(by_unit.items()):
        by_id = {row["proposal_id"]: row for row in rows}
        high_quality = sorted(
            row["proposal_id"]
            for row in rows
            if row["capacity_binding_evaluation"]["evaluation_gate_high_quality"]
        )
        transcript_hq = [value for value in high_quality if value.startswith("transcript_bbox_xywh|")]
        reviewed_hq = [value for value in high_quality if value.startswith("reviewed_bbox_xywh|")]
        if by_id[BASELINE]["capacity_binding_evaluation"]["evaluation_gate_high_quality"]:
            category = "baseline_already_high_quality"
        elif transcript_hq:
            category = "recoverable_by_transcript_method_choice"
        elif reviewed_hq:
            category = "recoverable_only_with_reviewed_locator_choice"
        else:
            category = "no_frozen_proposal_high_quality"
        categories[category] += 1
        oracle_units.append({"unit_id": unit_id, "text": rows[0]["text"], "category": category, "high_quality_proposal_ids": high_quality})

    latest_state = sorted((args.human_run / "revisions").glob("r*/state.json"))[-1]
    result: dict[str, Any] = {
        "schema_version": "capacity-line-binding-reevaluation.v1",
        "evidence_role": "sealed_post_freeze_evaluation_only",
        "source_experiment": {"path": str(args.experiment.resolve()), "file_sha256": sha256_file(args.experiment), "experiment_sha256": experiment["experiment_sha256"]},
        "clean_mask": {"path": str(args.clean_mask.resolve()), "file_sha256": sha256_file(args.clean_mask), "pixel_sha256": sha256_mask_pixels(clean)},
        "acting_centerlines": {"path": str(args.centerlines.resolve()), "file_sha256": sha256_file(args.centerlines), "record_sha256": centerline_record.get("centerline_record_sha256")},
        "sealed_partition": {"path": str(args.human_run.resolve()), "latest_state_file_sha256": sha256_file(latest_state), "ownership_uint16_sha256": hashlib.sha256(ownership.tobytes()).hexdigest(), "word_count": len(human)},
        "binding_derivation": {
            "policy": "choose contiguous 77-mask window by minimum capacity-constrained centerline distance, assign exact known capacity to each fitted line, then sort along the fitted line",
            "window_hypothesis_count": len(windows),
            "selected_window": best,
            "runner_up_window": runner_up,
            "runner_up_cost_margin_px": round(runner_up["line_assignment_cost_px"] - best["line_assignment_cost_px"], 6),
            "transcript_global_binding_mismatch_count": sum(canonical_binding[key] != original_transcript_binding[key] for key in canonical_binding),
            "unit_to_word_number": canonical_binding,
            "line_receipts": line_receipts,
        },
        "interpretation_guardrails": [
            "Candidates remain byte-for-byte frozen; only sealed target binding changes.",
            "The binding uses fitted lines and declared per-line token capacities but no proposal quality metric.",
            "The 77 body masks are inferred as one contiguous selector-number window; independent review is still required before benchmark promotion.",
            "High quality requires precision >= 0.97 and recall >= 0.95.",
        ],
        "configuration_binding_mismatch_count": len(mismatches),
        "binding_mismatches": mismatches,
        "configurations": reevaluated,
        "choice_oracle": {"category_counts": categories, "combined_high_quality_count": len(oracle_units) - categories["no_frozen_proposal_high_quality"], "units": oracle_units},
    }
    result["analysis_sha256"] = hashlib.sha256(canonical_json_bytes(result)).hexdigest()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(canonical_json_bytes(result) + b"\n")
    print(json.dumps(result["binding_derivation"], indent=2, sort_keys=True)[:5000])
    for config in reevaluated:
        print(f"{config['proposal_id']}: HQ {config['original_high_quality_count']} -> {config['capacity_binding_summary']['evaluation_high_quality_count']}")
    print(json.dumps(categories, indent=2, sort_keys=True))
    print(f"analysis_sha256={result['analysis_sha256']}")
    print(f"file_sha256={sha256_file(args.output)}")


if __name__ == "__main__":
    main()
