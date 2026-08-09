#!/usr/bin/env python3
"""Audit one-component ownership transfers in frozen exclusive assignments."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

import numpy as np

from experiment_disjoint_component_ownership import load_human_partition, load_mask, score_component_locators
from word_envelope.io_utils import canonical_json_bytes, sha256_file, sha256_mask_pixels


POLICIES = (
    "global_exclusive",
    "line_locator_strip",
    "line_midpoint_centroid",
    "line_valley_centroid",
)


def score(tp: int, foreign: int, unlabelled: int, target_total: int) -> dict[str, Any]:
    missed = target_total - tp
    precision = tp / max(1, tp + foreign + unlabelled)
    recall = tp / max(1, target_total)
    f1 = 2 * precision * recall / max(1e-12, precision + recall)
    return {
        "true_positive_pixels": tp,
        "foreign_human_word_pixels": foreign,
        "unlabelled_selected_pixels": unlabelled,
        "missed_target_pixels": missed,
        "precision": round(precision, 6),
        "recall": round(recall, 6),
        "f1": round(f1, 6),
        "evaluation_gate_high_quality": bool(precision >= 0.97 and recall >= 0.95),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--experiment", type=Path, required=True)
    parser.add_argument("--clean-mask", type=Path, required=True)
    parser.add_argument("--human-run", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    experiment = json.loads(args.experiment.read_text(encoding="utf-8"))
    configs = [
        config
        for config in experiment["configurations"]
        if config["locator"] == "transcript_bbox_xywh" and config["policy"] in POLICIES
    ]
    if len(configs) != 4:
        raise SystemExit("Expected four transcript frozen configurations")
    baseline = next(config for config in configs if config["policy"] == "global_exclusive")
    binding = {
        str(item["unit_id"]): int(item["evaluation_human_word_number"])
        for item in baseline["items"]
    }

    clean = load_mask(args.clean_mask)
    labels = score_component_locators(
        clean,
        [{"unit_id": "whole", "bbox_xywh": [0, 0, clean.shape[1], clean.shape[0]]}],
    )["labels"]
    human, ownership = load_human_partition(args.human_run)
    human_by_number = {int(word["word_number"]): word for word in human}
    component_count = int(labels.max())
    component_pixels = np.bincount(labels.ravel(), minlength=component_count + 1)
    unlabelled_by_component = np.bincount(
        labels[(labels > 0) & (ownership == 0)].ravel(), minlength=component_count + 1
    )
    target_overlap: dict[str, np.ndarray] = {}
    for unit_id, human_number in binding.items():
        target_overlap[unit_id] = np.bincount(
            labels[(ownership == human_number) & (labels > 0)].ravel(),
            minlength=component_count + 1,
        )

    config_records: list[dict[str, Any]] = []
    for config in configs:
        items = {str(item["unit_id"]): item for item in config["items"]}
        line_units: dict[str, list[str]] = {}
        current: dict[str, dict[str, Any]] = {}
        component_owner: dict[int, str] = {}
        for unit_id, item in items.items():
            line_units.setdefault(str(item["line_id"]), []).append(unit_id)
            selected_ids = [int(value) for value in item["selected_component_ids"]]
            selected = np.isin(labels, np.asarray(selected_ids, dtype=labels.dtype))
            if int(selected.sum()) != int(item["selected_pixels"]):
                raise RuntimeError(f"Pixel count mismatch for {config['policy']} {unit_id}")
            if sha256_mask_pixels(selected) != item["selected_pixel_sha256"]:
                raise RuntimeError(f"Pixel hash mismatch for {config['policy']} {unit_id}")
            for component_id in selected_ids:
                if component_id in component_owner:
                    raise RuntimeError(f"Configuration {config['policy']} is not exclusive")
                component_owner[component_id] = unit_id
            number = binding[unit_id]
            target_total = int(human_by_number[number]["pixels"])
            target_counts = target_overlap[unit_id]
            tp = int(target_counts[selected_ids].sum()) if selected_ids else 0
            unlabelled = int(unlabelled_by_component[selected_ids].sum()) if selected_ids else 0
            foreign = int(component_pixels[selected_ids].sum()) - tp - unlabelled if selected_ids else 0
            current[unit_id] = score(tp, foreign, unlabelled, target_total)
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
                int(human_by_number[binding[owner_id]]["pixels"]),
            )
            candidates = line_units[str(owner_item["line_id"])]
            for recipient_id in candidates:
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
                    int(human_by_number[binding[recipient_id]]["pixels"]),
                )
                before_hq = int(owner_before["evaluation_gate_high_quality"]) + int(
                    recipient_before["evaluation_gate_high_quality"]
                )
                after_hq = int(owner_after["evaluation_gate_high_quality"]) + int(
                    recipient_after["evaluation_gate_high_quality"]
                )
                before_foreign = owner_before["foreign_human_word_pixels"] + recipient_before["foreign_human_word_pixels"]
                after_foreign = owner_after["foreign_human_word_pixels"] + recipient_after["foreign_human_word_pixels"]
                before_missed = owner_before["missed_target_pixels"] + recipient_before["missed_target_pixels"]
                after_missed = owner_after["missed_target_pixels"] + recipient_after["missed_target_pixels"]
                before_unlabelled = owner_before["unlabelled_selected_pixels"] + recipient_before["unlabelled_selected_pixels"]
                after_unlabelled = owner_after["unlabelled_selected_pixels"] + recipient_after["unlabelled_selected_pixels"]
                owner_order = int(owner_item["word_order"])
                recipient_order = int(items[recipient_id]["word_order"])
                nonregressing = (
                    after_hq >= before_hq
                    and after_foreign <= before_foreign
                    and after_missed <= before_missed
                    and after_unlabelled <= before_unlabelled
                    and (
                        after_hq > before_hq
                        or after_foreign < before_foreign
                        or after_missed < before_missed
                        or after_unlabelled < before_unlabelled
                    )
                )
                transfers.append(
                    {
                        "component_id": component_id,
                        "component_pixels": int(component_pixels[component_id]),
                        "line_id": owner_item["line_id"],
                        "owner_unit_id": owner_id,
                        "owner_text": owner_item["text"],
                        "owner_word_order": owner_order,
                        "recipient_unit_id": recipient_id,
                        "recipient_text": items[recipient_id]["text"],
                        "recipient_word_order": recipient_order,
                        "direction": "to_later_word" if recipient_order > owner_order else "to_earlier_word",
                        "affected_high_quality_before": before_hq,
                        "affected_high_quality_after": after_hq,
                        "high_quality_delta": after_hq - before_hq,
                        "foreign_pixel_delta": after_foreign - before_foreign,
                        "missed_pixel_delta": after_missed - before_missed,
                        "unlabelled_pixel_delta": after_unlabelled - before_unlabelled,
                        "nonregressing_multiobjective": nonregressing,
                        "owner_before": owner_before,
                        "owner_after": owner_after,
                        "recipient_before": recipient_before,
                        "recipient_after": recipient_after,
                    }
                )
        useful = [row for row in transfers if row["nonregressing_multiobjective"]]
        useful.sort(
            key=lambda row: (
                -row["high_quality_delta"],
                row["foreign_pixel_delta"],
                row["missed_pixel_delta"],
                row["component_id"],
                row["recipient_unit_id"],
            )
        )
        baseline_hq = sum(row["evaluation_gate_high_quality"] for row in current.values())
        max_gain = max((row["high_quality_delta"] for row in useful), default=0)
        config_records.append(
            {
                "policy": config["policy"],
                "baseline_high_quality_count": baseline_hq,
                "claimed_component_count": len(component_owner),
                "candidate_transfer_count": len(transfers),
                "nonregressing_multiobjective_transfer_count": len(useful),
                "positive_high_quality_transfer_count": sum(row["high_quality_delta"] > 0 for row in useful),
                "max_single_transfer_high_quality_gain": max_gain,
                "single_transfer_oracle_high_quality_count": baseline_hq + max_gain,
                "positive_transfer_direction_counts": {
                    "to_later_word": sum(
                        row["high_quality_delta"] > 0 and row["direction"] == "to_later_word" for row in useful
                    ),
                    "to_earlier_word": sum(
                        row["high_quality_delta"] > 0 and row["direction"] == "to_earlier_word" for row in useful
                    ),
                },
                "nonregressing_transfers": useful,
            }
        )

    latest_state = sorted((args.human_run / "revisions").glob("r*/state.json"))[-1]
    result: dict[str, Any] = {
        "schema_version": "exclusive-component-transfer-audit.v1",
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
        "sealed_human_partition": {
            "path": str(args.human_run.resolve()),
            "latest_state_file_sha256": sha256_file(latest_state),
            "ownership_uint16_sha256": hashlib.sha256(ownership.tobytes()).hexdigest(),
        },
        "audit_definition": {
            "candidate": "move one whole claimed Clean component to another word on the same fitted line",
            "canonical_binding": "transcript_bbox_xywh|global_exclusive",
            "nonregressing": "affected high-quality count does not fall and foreign, missed, and unlabelled pixels do not increase; at least one objective strictly improves",
        },
        "interpretation_guardrails": [
            "This is a sealed one-transfer oracle audit, not an acting ownership policy.",
            "A reading-order direction count does not prove that processing in that direction will choose the right owner.",
            "Only whole-component transfers within the same fitted line are tested.",
            "Candidates remain frozen and exclusive before each independent transfer.",
        ],
        "configurations": config_records,
    }
    result["analysis_sha256"] = hashlib.sha256(canonical_json_bytes(result)).hexdigest()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(canonical_json_bytes(result) + b"\n")
    for config in config_records:
        print(
            f"{config['policy']}: HQ {config['baseline_high_quality_count']} -> "
            f"{config['single_transfer_oracle_high_quality_count']}; "
            f"positive transfers={config['positive_high_quality_transfer_count']} "
            f"directions={config['positive_transfer_direction_counts']}"
        )
    print(f"analysis_sha256={result['analysis_sha256']}")
    print(f"file_sha256={sha256_file(args.output)}")


if __name__ == "__main__":
    main()
