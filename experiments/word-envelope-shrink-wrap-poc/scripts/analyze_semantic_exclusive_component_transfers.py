#!/usr/bin/env python3
"""Audit exclusive same-line transfers against validated semantic targets."""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
from typing import Any

import numpy as np

from analyze_exclusive_component_transfers import POLICIES, score
from experiment_disjoint_component_ownership import load_human_partition, load_mask, score_component_locators
from word_envelope.io_utils import canonical_json_bytes, read_json, sha256_file, sha256_mask_pixels, write_json
from word_envelope.semantic_binding_validation import validate_semantic_binding


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--experiment", type=Path, required=True)
    parser.add_argument("--clean-mask", type=Path, required=True)
    parser.add_argument("--human-run", type=Path, required=True)
    parser.add_argument("--binding-ledger", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    validation = validate_semantic_binding(args.binding_ledger)
    if not validation["passed"]:
        raise SystemExit("Binding ledger failed strict validation")
    ledger = read_json(args.binding_ledger)
    binding = {
        unit["unit_id"]: [int(value) for value in unit["target_human_word_numbers"]]
        for line in ledger["lines"] for unit in line["units"] if unit["status"] == "assigned"
    }
    experiment = read_json(args.experiment)
    configs = [
        config for config in experiment["configurations"]
        if config["locator"] == "transcript_bbox_xywh" and config["policy"] in POLICIES
    ]
    clean = load_mask(args.clean_mask)
    labels = score_component_locators(
        clean, [{"unit_id": "whole", "bbox_xywh": [0, 0, clean.shape[1], clean.shape[0]]}]
    )["labels"]
    _, ownership = load_human_partition(args.human_run)
    component_count = int(labels.max())
    component_pixels = np.bincount(labels.ravel(), minlength=component_count + 1)
    unlabelled_by_component = np.bincount(
        labels[(labels > 0) & (ownership == 0)].ravel(), minlength=component_count + 1
    )
    target_overlap: dict[str, np.ndarray] = {}
    target_totals: dict[str, int] = {}
    for unit_id, numbers in binding.items():
        target = np.isin(ownership, np.asarray(numbers, dtype=ownership.dtype))
        target_overlap[unit_id] = np.bincount(
            labels[target & (labels > 0)].ravel(), minlength=component_count + 1
        )
        target_totals[unit_id] = int(target.sum())

    config_records: list[dict[str, Any]] = []
    for config in configs:
        items = {str(item["unit_id"]): item for item in config["items"] if item["unit_id"] in binding}
        line_units: dict[str, list[str]] = {}
        current: dict[str, dict[str, Any]] = {}
        component_owner: dict[int, str] = {}
        for unit_id, item in items.items():
            line_units.setdefault(str(item["line_id"]), []).append(unit_id)
            selected_ids = [int(value) for value in item["selected_component_ids"]]
            selected = np.isin(labels, np.asarray(selected_ids, dtype=labels.dtype))
            if int(selected.sum()) != int(item["selected_pixels"]) or sha256_mask_pixels(selected) != item["selected_pixel_sha256"]:
                raise RuntimeError(f"Frozen mask mismatch for {config['policy']} {unit_id}")
            for component_id in selected_ids:
                if component_id in component_owner:
                    raise RuntimeError(f"Configuration {config['policy']} is not exclusive")
                component_owner[component_id] = unit_id
            target_counts = target_overlap[unit_id]
            tp = int(target_counts[selected_ids].sum()) if selected_ids else 0
            unlabelled = int(unlabelled_by_component[selected_ids].sum()) if selected_ids else 0
            foreign = int(component_pixels[selected_ids].sum()) - tp - unlabelled if selected_ids else 0
            current[unit_id] = score(tp, foreign, unlabelled, target_totals[unit_id])
        for unit_ids in line_units.values():
            unit_ids.sort(key=lambda value: (int(items[value]["word_order"]), value))

        transfers: list[dict[str, Any]] = []
        for component_id, owner_id in sorted(component_owner.items()):
            owner_item = items[owner_id]
            owner_before = current[owner_id]
            owner_target = int(target_overlap[owner_id][component_id])
            owner_unlabelled = int(unlabelled_by_component[component_id])
            owner_foreign = int(component_pixels[component_id]) - owner_target - owner_unlabelled
            owner_after = score(
                owner_before["true_positive_pixels"] - owner_target,
                owner_before["foreign_human_word_pixels"] - owner_foreign,
                owner_before["unlabelled_selected_pixels"] - owner_unlabelled,
                target_totals[owner_id],
            )
            for recipient_id in line_units[str(owner_item["line_id"])]:
                if recipient_id == owner_id:
                    continue
                recipient_before = current[recipient_id]
                recipient_target = int(target_overlap[recipient_id][component_id])
                recipient_unlabelled = int(unlabelled_by_component[component_id])
                recipient_foreign = int(component_pixels[component_id]) - recipient_target - recipient_unlabelled
                recipient_after = score(
                    recipient_before["true_positive_pixels"] + recipient_target,
                    recipient_before["foreign_human_word_pixels"] + recipient_foreign,
                    recipient_before["unlabelled_selected_pixels"] + recipient_unlabelled,
                    target_totals[recipient_id],
                )
                before = {
                    "high_quality": int(owner_before["evaluation_gate_high_quality"]) + int(recipient_before["evaluation_gate_high_quality"]),
                    "foreign": owner_before["foreign_human_word_pixels"] + recipient_before["foreign_human_word_pixels"],
                    "missed": owner_before["missed_target_pixels"] + recipient_before["missed_target_pixels"],
                    "unlabelled": owner_before["unlabelled_selected_pixels"] + recipient_before["unlabelled_selected_pixels"],
                }
                after = {
                    "high_quality": int(owner_after["evaluation_gate_high_quality"]) + int(recipient_after["evaluation_gate_high_quality"]),
                    "foreign": owner_after["foreign_human_word_pixels"] + recipient_after["foreign_human_word_pixels"],
                    "missed": owner_after["missed_target_pixels"] + recipient_after["missed_target_pixels"],
                    "unlabelled": owner_after["unlabelled_selected_pixels"] + recipient_after["unlabelled_selected_pixels"],
                }
                nonregressing = (
                    recipient_target > owner_target
                    and recipient_target > 0
                    and after["high_quality"] >= before["high_quality"]
                    and after["foreign"] <= before["foreign"]
                    and after["missed"] <= before["missed"]
                    and after["unlabelled"] <= before["unlabelled"]
                    and after != before
                )
                if nonregressing:
                    owner_order = int(owner_item["word_order"])
                    recipient_order = int(items[recipient_id]["word_order"])
                    transfers.append(
                        {
                            "component_id": component_id,
                            "owner_unit_id": owner_id,
                            "owner_text": owner_item["text"],
                            "recipient_unit_id": recipient_id,
                            "recipient_text": items[recipient_id]["text"],
                            "direction": "to_later_word" if recipient_order > owner_order else "to_earlier_word",
                            "high_quality_delta": after["high_quality"] - before["high_quality"],
                            "foreign_pixel_delta": after["foreign"] - before["foreign"],
                            "missed_pixel_delta": after["missed"] - before["missed"],
                            "unlabelled_pixel_delta": after["unlabelled"] - before["unlabelled"],
                        }
                    )
        positive = [row for row in transfers if row["high_quality_delta"] > 0]
        config_records.append(
            {
                "policy": config["policy"],
                "baseline_high_quality_count": sum(value["evaluation_gate_high_quality"] for value in current.values()),
                "nonregressing_transfer_count": len(transfers),
                "positive_high_quality_transfer_count": len(positive),
                "positive_transfer_direction_counts": {
                    "to_later_word": sum(row["direction"] == "to_later_word" for row in positive),
                    "to_earlier_word": sum(row["direction"] == "to_earlier_word" for row in positive),
                },
                "positive_transfers": positive,
            }
        )

    latest_state = sorted((args.human_run / "revisions").glob("r*/state.json"))[-1]
    result: dict[str, Any] = {
        "schema_version": "semantic-exclusive-component-transfer-audit.v1",
        "evidence_role": "sealed_post_freeze_evaluation_only_never_acting_input",
        "source_experiment": {"path": str(args.experiment.resolve()), "file_sha256": sha256_file(args.experiment), "experiment_sha256": experiment["experiment_sha256"]},
        "clean_mask": {"path": str(args.clean_mask.resolve()), "file_sha256": sha256_file(args.clean_mask), "pixel_sha256": sha256_mask_pixels(clean)},
        "semantic_binding": {"path": str(args.binding_ledger.resolve()), "file_sha256": sha256_file(args.binding_ledger), "adjudication_sha256": ledger["adjudication_sha256"]},
        "sealed_human_partition": {"path": str(args.human_run.resolve()), "latest_state_file_sha256": sha256_file(latest_state), "ownership_uint16_sha256": hashlib.sha256(ownership.tobytes()).hexdigest()},
        "audit_definition": {"candidate": "move one already-claimed whole Clean component to another scorable word on the same fitted line", "target_directed": "recipient contains more target pixels from the component than the current owner and contains at least one", "nonregressing": "high-quality count does not fall; foreign, missed, and unlabelled pixels do not increase; at least one objective improves"},
        "guardrails": ["Direction counts are sealed oracle diagnostics, not proof of a processing policy.", "Excluded merged targets do not participate.", "Every configuration remains exclusive before each independent transfer."],
        "configurations": config_records,
    }
    result["analysis_sha256"] = hashlib.sha256(canonical_json_bytes(result)).hexdigest()
    write_json(args.output, result)
    for config in config_records:
        print(config["policy"], config["baseline_high_quality_count"], config["positive_high_quality_transfer_count"], config["positive_transfer_direction_counts"])
    print(f"analysis_sha256={result['analysis_sha256']}")
    print(f"file_sha256={sha256_file(args.output)}")


if __name__ == "__main__":
    main()
