#!/usr/bin/env python3
"""Re-evaluate frozen candidates with one monotonic reading-order binding.

The completed selector has 100 masks and the acting body queue has 77 semantic
units. This sealed audit tests every contiguous 77-mask word-number window in
both orientations, using only rough-box geometry to choose one monotonic mapping.
It then freezes that mapping for every proposal family.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

import numpy as np

from experiment_disjoint_component_ownership import bbox_iou, load_human_partition, load_mask, score_component_locators
from reevaluate_line_candidates_canonical_binding import LOCATORS, POLICIES, BASELINE, evaluate, identifier, summary
from word_envelope.io_utils import canonical_json_bytes, sha256_file, sha256_mask_pixels


def binding_cost(units: list[dict[str, Any]], words: list[dict[str, Any]]) -> float:
    diagonal = float(np.hypot(3000, 4000))
    total = 0.0
    for unit, word in zip(units, words):
        bbox = unit["proposal_bbox_xywh"]
        target = word["bbox_xywh"]
        cx, cy = bbox[0] + bbox[2] / 2.0, bbox[1] + bbox[3] / 2.0
        hx, hy = target[0] + target[2] / 2.0, target[1] + target[3] / 2.0
        distance = float(np.hypot(cx - hx, cy - hy)) / diagonal
        total += -4.0 * bbox_iou(bbox, target) + distance
    return total


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--experiment", type=Path, required=True)
    parser.add_argument("--clean-mask", type=Path, required=True)
    parser.add_argument("--human-run", type=Path, required=True)
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
        raise SystemExit("Expected eight configurations and 77 body units")

    clean = load_mask(args.clean_mask)
    labels = score_component_locators(
        clean,
        [{"unit_id": "whole", "bbox_xywh": [0, 0, clean.shape[1], clean.shape[0]]}],
    )["labels"]
    human, ownership = load_human_partition(args.human_run)
    human_by_number = {int(word["word_number"]): word for word in human}
    ordered_human = sorted(human, key=lambda word: int(word["word_number"]))

    hypotheses: list[dict[str, Any]] = []
    for start in range(0, len(ordered_human) - len(units) + 1):
        window = ordered_human[start : start + len(units)]
        for orientation, sequence in (("ascending", window), ("descending", list(reversed(window)))):
            hypotheses.append(
                {
                    "start_word_number": int(window[0]["word_number"]),
                    "end_word_number": int(window[-1]["word_number"]),
                    "orientation": orientation,
                    "geometry_cost": round(binding_cost(units, sequence), 9),
                    "word_numbers": [int(word["word_number"]) for word in sequence],
                }
            )
    hypotheses.sort(
        key=lambda row: (
            row["geometry_cost"],
            row["start_word_number"],
            row["orientation"],
        )
    )
    best = hypotheses[0]
    runner_up = hypotheses[1]
    canonical_binding = {
        str(unit["unit_id"]): int(number)
        for unit, number in zip(units, best["word_numbers"])
    }
    original_transcript_binding = {
        str(item["unit_id"]): int(item["evaluation_human_word_number"])
        for item in baseline["items"]
    }

    monotonic_line_failures: list[dict[str, Any]] = []
    for line_id in sorted({str(unit["line_id"]) for unit in units}):
        line_units = [unit for unit in units if unit["line_id"] == line_id]
        centers = []
        for unit in line_units:
            bbox = human_by_number[canonical_binding[str(unit["unit_id"])]] ["bbox_xywh"]
            centers.append(bbox[0] + bbox[2] / 2.0)
        if any(right <= left for left, right in zip(centers, centers[1:])):
            monotonic_line_failures.append({"line_id": line_id, "center_x_values": centers})

    mismatch_ledger: list[dict[str, Any]] = []
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
                mismatch_ledger.append(
                    {
                        "proposal_id": config_id,
                        "unit_id": unit_id,
                        "text": item["text"],
                        "original_human_word_number": original_number,
                        "reading_order_human_word_number": number,
                    }
                )
            selected = np.isin(labels, np.asarray(item["selected_component_ids"], dtype=labels.dtype))
            if int(selected.sum()) != int(item["selected_pixels"]):
                raise RuntimeError(f"Selected pixel count mismatch for {config_id} {unit_id}")
            if sha256_mask_pixels(selected) != item["selected_pixel_sha256"]:
                raise RuntimeError(f"Selected pixel hash mismatch for {config_id} {unit_id}")
            human_word = human_by_number[number]
            canonical_evaluation = evaluate(
                selected,
                ownership == number,
                ownership,
                int(human_word["pixels"]),
            )
            row = {
                "unit_id": unit_id,
                "text": item["text"],
                "line_id": item["line_id"],
                "proposal_id": config_id,
                "selected_component_ids": item["selected_component_ids"],
                "selected_pixel_sha256": item["selected_pixel_sha256"],
                "reading_order_human_word_number": number,
                "reading_order_human_pixel_sha256": human_word["pixel_sha256"],
                "original_human_word_number": original_number,
                "reading_order_evaluation": canonical_evaluation,
            }
            items.append(row)
            by_unit.setdefault(unit_id, []).append(row)
        adapted = [{"canonical_evaluation": row["reading_order_evaluation"]} for row in items]
        reevaluated.append(
            {
                "proposal_id": config_id,
                "locator": config["locator"],
                "policy": config["policy"],
                "original_high_quality_count": config["summary"]["evaluation_high_quality_count"],
                "reading_order_summary": summary(adapted),
                "items": items,
            }
        )

    categories = {
        "baseline_already_high_quality": 0,
        "recoverable_by_transcript_method_choice": 0,
        "recoverable_only_with_reviewed_locator_choice": 0,
        "no_frozen_proposal_high_quality": 0,
    }
    oracle_units: list[dict[str, Any]] = []
    for unit_id, rows in sorted(by_unit.items()):
        by_id = {row["proposal_id"]: row for row in rows}
        high_quality = sorted(
            row["proposal_id"]
            for row in rows
            if row["reading_order_evaluation"]["evaluation_gate_high_quality"]
        )
        transcript_hq = [value for value in high_quality if value.startswith("transcript_bbox_xywh|")]
        reviewed_hq = [value for value in high_quality if value.startswith("reviewed_bbox_xywh|")]
        if by_id[BASELINE]["reading_order_evaluation"]["evaluation_gate_high_quality"]:
            category = "baseline_already_high_quality"
        elif transcript_hq:
            category = "recoverable_by_transcript_method_choice"
        elif reviewed_hq:
            category = "recoverable_only_with_reviewed_locator_choice"
        else:
            category = "no_frozen_proposal_high_quality"
        categories[category] += 1
        oracle_units.append(
            {
                "unit_id": unit_id,
                "text": rows[0]["text"],
                "category": category,
                "high_quality_proposal_ids": high_quality,
            }
        )

    latest_state = sorted((args.human_run / "revisions").glob("r*/state.json"))[-1]
    result: dict[str, Any] = {
        "schema_version": "reading-order-binding-reevaluation.v1",
        "evidence_role": "sealed_post_freeze_evaluation_only",
        "source_experiment": {
            "path": str(args.experiment.resolve()),
            "file_sha256": sha256_file(args.experiment),
            "experiment_sha256": experiment["experiment_sha256"],
        },
        "clean_mask": {
            "path": str(args.clean_mask.resolve()),
            "file_sha256": sha256_file(args.clean_mask),
            "pixel_sha256": sha256_mask_pixels(clean),
        },
        "sealed_partition": {
            "path": str(args.human_run.resolve()),
            "latest_state_file_sha256": sha256_file(latest_state),
            "ownership_uint16_sha256": hashlib.sha256(ownership.tobytes()).hexdigest(),
            "word_count": len(human),
        },
        "binding_derivation": {
            "policy": "minimum rough-box geometry cost over every contiguous 77-mask word-number window in ascending and descending order",
            "hypothesis_count": len(hypotheses),
            "selected": best,
            "runner_up": runner_up,
            "runner_up_cost_margin": round(runner_up["geometry_cost"] - best["geometry_cost"], 9),
            "line_monotonic_failure_count": len(monotonic_line_failures),
            "line_monotonic_failures": monotonic_line_failures,
            "transcript_global_binding_mismatch_count": sum(
                canonical_binding[key] != original_transcript_binding[key] for key in canonical_binding
            ),
            "unit_to_word_number": canonical_binding,
        },
        "interpretation_guardrails": [
            "Candidates remain byte-for-byte frozen; only sealed target binding changes.",
            "This exploits selector word-number continuity and reading order; it must be independently reviewed before becoming benchmark truth.",
            "No proposal quality metric participates in binding selection.",
            "High quality requires precision >= 0.97 and recall >= 0.95.",
        ],
        "configuration_binding_mismatch_count": len(mismatch_ledger),
        "binding_mismatches": mismatch_ledger,
        "configurations": reevaluated,
        "choice_oracle": {
            "category_counts": categories,
            "combined_high_quality_count": len(oracle_units) - categories["no_frozen_proposal_high_quality"],
            "units": oracle_units,
        },
    }
    result["analysis_sha256"] = hashlib.sha256(canonical_json_bytes(result)).hexdigest()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(canonical_json_bytes(result) + b"\n")
    print(json.dumps(result["binding_derivation"], indent=2, sort_keys=True)[:5000])
    for config in reevaluated:
        print(
            f"{config['proposal_id']}: HQ {config['original_high_quality_count']} -> "
            f"{config['reading_order_summary']['evaluation_high_quality_count']}"
        )
    print(json.dumps(result["choice_oracle"]["category_counts"], indent=2, sort_keys=True))
    print(f"analysis_sha256={result['analysis_sha256']}")
    print(f"file_sha256={sha256_file(args.output)}")


if __name__ == "__main__":
    main()
