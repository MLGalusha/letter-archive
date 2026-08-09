#!/usr/bin/env python3
"""Score frozen line candidates against a validated many-to-many semantic ledger."""

from __future__ import annotations

import argparse
import hashlib
import itertools
from pathlib import Path
from typing import Any

import numpy as np

from experiment_disjoint_component_ownership import load_human_partition, load_mask, score_component_locators
from word_envelope.io_utils import canonical_json_bytes, read_json, sha256_file, sha256_mask_pixels, write_json
from word_envelope.semantic_binding_validation import validate_semantic_binding


POLICIES = {"global_exclusive", "line_locator_strip", "line_midpoint_centroid", "line_valley_centroid"}
LOCATORS = {"transcript_bbox_xywh", "reviewed_bbox_xywh"}
BASELINE = "transcript_bbox_xywh|global_exclusive"


def proposal_id(config: dict[str, Any]) -> str:
    return f"{config['locator']}|{config['policy']}"


def score(selected: np.ndarray, target: np.ndarray, ownership: np.ndarray) -> dict[str, Any]:
    target_total = int(target.sum())
    true_positive = int(np.count_nonzero(selected & target))
    foreign = int(np.count_nonzero(selected & (ownership > 0) & ~target))
    unlabelled = int(np.count_nonzero(selected & (ownership == 0)))
    missed = target_total - true_positive
    precision = true_positive / max(1, true_positive + foreign + unlabelled)
    recall = true_positive / max(1, target_total)
    f1 = 2 * precision * recall / max(1e-12, precision + recall)
    return {
        "target_pixels": target_total,
        "true_positive_pixels": true_positive,
        "foreign_human_word_pixels": foreign,
        "unlabelled_selected_pixels": unlabelled,
        "missed_target_pixels": missed,
        "precision": round(precision, 6),
        "recall": round(recall, 6),
        "f1": round(f1, 6),
        "evaluation_gate_high_quality": bool(precision >= 0.97 and recall >= 0.95),
    }


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    values = [row["semantic_evaluation"] for row in rows]
    return {
        "scorable_unit_count": len(rows),
        "evaluation_high_quality_count": sum(row["evaluation_gate_high_quality"] for row in values),
        "foreign_error_word_count": sum(row["precision"] < 0.97 for row in values),
        "missed_error_word_count": sum(row["recall"] < 0.95 for row in values),
        "total_foreign_human_word_pixels": sum(row["foreign_human_word_pixels"] for row in values),
        "total_missed_target_pixels": sum(row["missed_target_pixels"] for row in values),
        "total_unlabelled_selected_pixels": sum(row["unlabelled_selected_pixels"] for row in values),
        "median_pixel_precision": round(float(np.median([row["precision"] for row in values])), 6),
        "median_pixel_recall": round(float(np.median([row["recall"] for row in values])), 6),
        "median_pixel_f1": round(float(np.median([row["f1"] for row in values])), 6),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--experiment", type=Path, required=True)
    parser.add_argument("--clean-mask", type=Path, required=True)
    parser.add_argument("--human-run", type=Path, required=True)
    parser.add_argument("--binding-ledger", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    ledger_validation = validate_semantic_binding(args.binding_ledger)
    if not ledger_validation["passed"]:
        raise SystemExit(f"Semantic ledger failed strict validation: {ledger_validation['violations']}")
    ledger = read_json(args.binding_ledger)
    binding: dict[str, list[int]] = {}
    excluded: list[dict[str, Any]] = []
    for line in ledger["lines"]:
        for unit in line["units"]:
            if unit["status"] == "assigned":
                binding[unit["unit_id"]] = [int(value) for value in unit["target_human_word_numbers"]]
            else:
                excluded.append({"unit_id": unit["unit_id"], "text": unit["text"], "status": unit["status"], "note": unit["note"]})

    experiment = read_json(args.experiment)
    configurations = [
        config for config in experiment["configurations"]
        if config["locator"] in LOCATORS and config["policy"] in POLICIES
    ]
    if len(configurations) != 8:
        raise SystemExit("Expected eight frozen non-abstaining configurations")

    clean = load_mask(args.clean_mask)
    labels = score_component_locators(
        clean, [{"unit_id": "whole", "bbox_xywh": [0, 0, clean.shape[1], clean.shape[0]]}]
    )["labels"]
    human, ownership = load_human_partition(args.human_run)
    human_by_number = {int(word["word_number"]): word for word in human}
    component_count = int(labels.max())
    component_pixels = np.bincount(labels.ravel(), minlength=component_count + 1)
    unlabelled_by_component = np.bincount(
        labels[(labels > 0) & (ownership == 0)].ravel(), minlength=component_count + 1
    )

    by_unit: dict[str, list[dict[str, Any]]] = {}
    evaluated_configs: list[dict[str, Any]] = []
    for config in configurations:
        identifier = proposal_id(config)
        rows: list[dict[str, Any]] = []
        for item in config["items"]:
            unit_id = str(item["unit_id"])
            if unit_id not in binding:
                continue
            selected_ids = [int(value) for value in item["selected_component_ids"]]
            selected = np.isin(labels, np.asarray(selected_ids, dtype=labels.dtype))
            if int(selected.sum()) != int(item["selected_pixels"]):
                raise RuntimeError(f"Selected pixel count mismatch for {identifier} {unit_id}")
            if sha256_mask_pixels(selected) != item["selected_pixel_sha256"]:
                raise RuntimeError(f"Selected pixel hash mismatch for {identifier} {unit_id}")
            target_numbers = binding[unit_id]
            target = np.isin(ownership, np.asarray(target_numbers, dtype=ownership.dtype))
            expected_target_pixels = sum(int(human_by_number[number]["pixels"]) for number in target_numbers)
            if int(target.sum()) != expected_target_pixels:
                raise RuntimeError(f"Target pixel count mismatch for {unit_id}")
            row = {
                "unit_id": unit_id,
                "text": item["text"],
                "line_id": item["line_id"],
                "proposal_id": identifier,
                "selected_component_ids": selected_ids,
                "selected_pixel_sha256": item["selected_pixel_sha256"],
                "target_human_word_numbers": target_numbers,
                "target_pixel_sha256s": [human_by_number[number]["pixel_sha256"] for number in target_numbers],
                "semantic_evaluation": score(selected, target, ownership),
            }
            rows.append(row)
            by_unit.setdefault(unit_id, []).append(row)
        evaluated_configs.append(
            {"proposal_id": identifier, "locator": config["locator"], "policy": config["policy"], "summary": summarize(rows), "items": rows}
        )

    categories = {
        "baseline_already_high_quality": 0,
        "recoverable_by_transcript_method_choice": 0,
        "recoverable_only_with_reviewed_locator_choice": 0,
        "no_frozen_proposal_high_quality": 0,
    }
    choice_units: list[dict[str, Any]] = []
    toggle_units: list[dict[str, Any]] = []
    one_toggle_count = 0
    two_toggle_count = 0
    for unit_id, proposals in sorted(by_unit.items()):
        if len(proposals) != 8:
            raise RuntimeError(f"{unit_id} has {len(proposals)} proposals")
        by_id = {row["proposal_id"]: row for row in proposals}
        high_quality = sorted(row["proposal_id"] for row in proposals if row["semantic_evaluation"]["evaluation_gate_high_quality"])
        if by_id[BASELINE]["semantic_evaluation"]["evaluation_gate_high_quality"]:
            category = "baseline_already_high_quality"
        elif any(value.startswith("transcript_bbox_xywh|") for value in high_quality):
            category = "recoverable_by_transcript_method_choice"
        elif high_quality:
            category = "recoverable_only_with_reviewed_locator_choice"
        else:
            category = "no_frozen_proposal_high_quality"
        categories[category] += 1
        choice_units.append({"unit_id": unit_id, "text": proposals[0]["text"], "category": category, "high_quality_proposal_ids": high_quality})

        component_pool = sorted({component for row in proposals for component in row["selected_component_ids"]})
        target_numbers = binding[unit_id]
        target = np.isin(ownership, np.asarray(target_numbers, dtype=ownership.dtype))
        target_by_component = np.bincount(labels[target & (labels > 0)].ravel(), minlength=component_count + 1)
        foreign_by_component = component_pixels - target_by_component - unlabelled_by_component
        target_total = int(target.sum())
        solutions: list[dict[str, Any]] = []
        two_solutions: list[dict[str, Any]] = []
        if not high_quality:
            for proposal in proposals:
                selected_set = set(proposal["selected_component_ids"])
                current = proposal["semantic_evaluation"]
                for component_id in component_pool:
                    direction = -1 if component_id in selected_set else 1
                    true_positive = int(current["true_positive_pixels"]) + direction * int(target_by_component[component_id])
                    foreign = int(current["foreign_human_word_pixels"]) + direction * int(foreign_by_component[component_id])
                    unlabelled = int(current["unlabelled_selected_pixels"]) + direction * int(unlabelled_by_component[component_id])
                    precision = true_positive / max(1, true_positive + foreign + unlabelled)
                    recall = true_positive / max(1, target_total)
                    if precision >= 0.97 and recall >= 0.95:
                        solutions.append({"from_proposal_id": proposal["proposal_id"], "action": "remove" if direction < 0 else "add", "component_id": component_id})
        if solutions:
            one_toggle_count += 1
        elif not high_quality:
            for proposal in proposals:
                selected_set = set(proposal["selected_component_ids"])
                current = proposal["semantic_evaluation"]
                for first, second in itertools.combinations(component_pool, 2):
                    first_direction = -1 if first in selected_set else 1
                    second_direction = -1 if second in selected_set else 1
                    true_positive = (
                        int(current["true_positive_pixels"])
                        + first_direction * int(target_by_component[first])
                        + second_direction * int(target_by_component[second])
                    )
                    foreign = (
                        int(current["foreign_human_word_pixels"])
                        + first_direction * int(foreign_by_component[first])
                        + second_direction * int(foreign_by_component[second])
                    )
                    unlabelled = (
                        int(current["unlabelled_selected_pixels"])
                        + first_direction * int(unlabelled_by_component[first])
                        + second_direction * int(unlabelled_by_component[second])
                    )
                    precision = true_positive / max(1, true_positive + foreign + unlabelled)
                    recall = true_positive / max(1, target_total)
                    if precision >= 0.97 and recall >= 0.95:
                        two_solutions.append(
                            {
                                "from_proposal_id": proposal["proposal_id"],
                                "actions": [
                                    {"action": "remove" if first_direction < 0 else "add", "component_id": first},
                                    {"action": "remove" if second_direction < 0 else "add", "component_id": second},
                                ],
                            }
                        )
        if two_solutions:
            two_toggle_count += 1
        toggle_units.append({"unit_id": unit_id, "choice_high_quality": bool(high_quality), "one_toggle_solution_count": len(solutions), "one_toggle_solutions": solutions, "two_toggle_solution_count": len(two_solutions), "two_toggle_solutions": two_solutions})

    latest_state = sorted((args.human_run / "revisions").glob("r*/state.json"))[-1]
    result: dict[str, Any] = {
        "schema_version": "semantic-binding-line-candidate-reevaluation.v1",
        "evidence_role": "sealed_post_freeze_evaluation_only_never_acting_input",
        "source_experiment": {"path": str(args.experiment.resolve()), "file_sha256": sha256_file(args.experiment), "experiment_sha256": experiment["experiment_sha256"]},
        "clean_mask": {"path": str(args.clean_mask.resolve()), "file_sha256": sha256_file(args.clean_mask), "pixel_sha256": sha256_mask_pixels(clean)},
        "sealed_human_partition": {"path": str(args.human_run.resolve()), "latest_state_path": str(latest_state.resolve()), "latest_state_file_sha256": sha256_file(latest_state), "ownership_uint16_sha256": hashlib.sha256(ownership.tobytes()).hexdigest()},
        "semantic_binding": {"path": str(args.binding_ledger.resolve()), "file_sha256": sha256_file(args.binding_ledger), "adjudication_sha256": ledger["adjudication_sha256"], "validation": ledger_validation},
        "scorable_unit_count": len(binding),
        "excluded_unit_count": len(excluded),
        "excluded_units": excluded,
        "gate": {"precision_min": 0.97, "recall_min": 0.95},
        "interpretation_guardrails": [
            "Candidates and toggle pools were frozen before sealed semantic adjudication.",
            "Counts exclude merged human masks that cannot represent one semantic word exactly.",
            "One-toggle and proposal-choice counts are oracle capacities, not actor accuracy.",
            "Foreign, missed, and unlabelled pixels remain separate objectives.",
        ],
        "configurations": evaluated_configs,
        "choice_oracle": {"category_counts": categories, "combined_high_quality_count": len(binding) - categories["no_frozen_proposal_high_quality"], "units": choice_units},
        "choice_plus_two_toggle_oracle": {"choice_only_high_quality_count": len(binding) - categories["no_frozen_proposal_high_quality"], "additional_one_toggle_high_quality_count": one_toggle_count, "additional_two_toggle_high_quality_count": two_toggle_count, "combined_high_quality_count": len(binding) - categories["no_frozen_proposal_high_quality"] + one_toggle_count + two_toggle_count, "units": toggle_units},
    }
    result["analysis_sha256"] = hashlib.sha256(canonical_json_bytes(result)).hexdigest()
    write_json(args.output, result)
    for config in evaluated_configs:
        print(config["proposal_id"], config["summary"])
    print(result["choice_oracle"]["category_counts"])
    print(result["choice_plus_two_toggle_oracle"])
    print(f"analysis_sha256={result['analysis_sha256']}")
    print(f"file_sha256={sha256_file(args.output)}")


if __name__ == "__main__":
    main()
