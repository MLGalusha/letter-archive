#!/usr/bin/env python3
"""Re-evaluate frozen line candidates against one canonical word binding.

The original experiment matched each locator family to the sealed human
partition independently. That is unsuitable for cross-family comparison when a
rough locator drifts to a neighboring word. This sealed-only audit keeps every
candidate unchanged and binds all candidates to the human target selected by
the transcript/global baseline for the same semantic unit ID.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

import numpy as np

from experiment_disjoint_component_ownership import load_human_partition, load_mask, score_component_locators
from word_envelope.io_utils import canonical_json_bytes, sha256_file, sha256_mask_pixels


POLICIES = {
    "global_exclusive",
    "line_locator_strip",
    "line_midpoint_centroid",
    "line_valley_centroid",
}
LOCATORS = {"transcript_bbox_xywh", "reviewed_bbox_xywh"}
BASELINE = "transcript_bbox_xywh|global_exclusive"


def identifier(config: dict[str, Any]) -> str:
    return f"{config['locator']}|{config['policy']}"


def evaluate(selected: np.ndarray, target: np.ndarray, ownership: np.ndarray, target_total: int) -> dict[str, Any]:
    true_positive = int(np.count_nonzero(selected & target))
    foreign = int(np.count_nonzero(selected & (ownership > 0) & ~target))
    unlabelled = int(np.count_nonzero(selected & (ownership == 0)))
    missed = target_total - true_positive
    precision = true_positive / max(1, true_positive + foreign + unlabelled)
    recall = true_positive / max(1, target_total)
    f1 = 2 * precision * recall / max(1e-12, precision + recall)
    return {
        "true_positive_pixels": true_positive,
        "foreign_human_word_pixels": foreign,
        "unlabelled_selected_pixels": unlabelled,
        "missed_target_pixels": missed,
        "precision": round(precision, 6),
        "recall": round(recall, 6),
        "f1": round(f1, 6),
        "evaluation_gate_high_quality": bool(precision >= 0.97 and recall >= 0.95),
    }


def summary(items: list[dict[str, Any]]) -> dict[str, Any]:
    evaluations = [item["canonical_evaluation"] for item in items]
    return {
        "unit_count": len(items),
        "evaluation_high_quality_count": sum(row["evaluation_gate_high_quality"] for row in evaluations),
        "foreign_error_word_count": sum(row["precision"] < 0.97 for row in evaluations),
        "missed_error_word_count": sum(row["recall"] < 0.95 for row in evaluations),
        "total_foreign_human_word_pixels": sum(row["foreign_human_word_pixels"] for row in evaluations),
        "total_missed_target_pixels": sum(row["missed_target_pixels"] for row in evaluations),
        "total_unlabelled_selected_pixels": sum(row["unlabelled_selected_pixels"] for row in evaluations),
        "median_pixel_precision": round(float(np.median([row["precision"] for row in evaluations])), 6),
        "median_pixel_recall": round(float(np.median([row["recall"] for row in evaluations])), 6),
        "median_pixel_f1": round(float(np.median([row["f1"] for row in evaluations])), 6),
    }


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
    if len(configurations) != 8:
        raise SystemExit("Expected eight frozen non-abstaining configurations")
    baseline = next(config for config in configurations if identifier(config) == BASELINE)
    canonical_binding = {
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

    mismatch_ledger: list[dict[str, Any]] = []
    reevaluated: list[dict[str, Any]] = []
    by_unit: dict[str, list[dict[str, Any]]] = {}
    for config in configurations:
        config_id = identifier(config)
        items: list[dict[str, Any]] = []
        for item in config["items"]:
            unit_id = str(item["unit_id"])
            canonical_number = canonical_binding[unit_id]
            original_number = int(item["evaluation_human_word_number"])
            if original_number != canonical_number:
                mismatch_ledger.append(
                    {
                        "proposal_id": config_id,
                        "unit_id": unit_id,
                        "text": item["text"],
                        "original_human_word_number": original_number,
                        "canonical_human_word_number": canonical_number,
                    }
                )
            component_ids = np.asarray(item["selected_component_ids"], dtype=labels.dtype)
            selected = np.isin(labels, component_ids)
            if int(selected.sum()) != int(item["selected_pixels"]):
                raise RuntimeError(f"Selected pixel count mismatch for {config_id} {unit_id}")
            if sha256_mask_pixels(selected) != item["selected_pixel_sha256"]:
                raise RuntimeError(f"Selected pixel hash mismatch for {config_id} {unit_id}")
            human_word = human_by_number[canonical_number]
            if config_id == BASELINE and item["evaluation"]["human_pixel_sha256"] != human_word["pixel_sha256"]:
                raise RuntimeError(f"Canonical human hash mismatch for {unit_id}")
            canonical_evaluation = evaluate(
                selected,
                ownership == canonical_number,
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
                "canonical_human_word_number": canonical_number,
                "canonical_human_pixel_sha256": human_word["pixel_sha256"],
                "original_human_word_number": original_number,
                "canonical_evaluation": canonical_evaluation,
            }
            items.append(row)
            by_unit.setdefault(unit_id, []).append(row)
        canonical_summary = summary(items)
        original_summary = config["summary"]
        reevaluated.append(
            {
                "proposal_id": config_id,
                "locator": config["locator"],
                "policy": config["policy"],
                "original_summary": {
                    key: original_summary[key]
                    for key in (
                        "evaluation_high_quality_count",
                        "foreign_error_word_count",
                        "missed_error_word_count",
                        "total_foreign_human_word_pixels",
                        "total_missed_target_pixels",
                    )
                },
                "canonical_summary": canonical_summary,
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
            if row["canonical_evaluation"]["evaluation_gate_high_quality"]
        )
        transcript_hq = [value for value in high_quality if value.startswith("transcript_bbox_xywh|")]
        reviewed_hq = [value for value in high_quality if value.startswith("reviewed_bbox_xywh|")]
        if by_id[BASELINE]["canonical_evaluation"]["evaluation_gate_high_quality"]:
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
        "schema_version": "canonical-binding-reevaluation.v1",
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
            "manifest_file_sha256": sha256_file(args.human_run / "manifest.json"),
            "latest_state_path": str(latest_state.resolve()),
            "latest_state_file_sha256": sha256_file(latest_state),
            "ownership_uint16_sha256": hashlib.sha256(ownership.tobytes()).hexdigest(),
        },
        "canonical_binding": {
            "policy": "reuse transcript_bbox_xywh|global_exclusive human binding for every proposal family",
            "unit_to_human_word_number": canonical_binding,
            "warning": "This is a consistent geometry-derived benchmark alignment, not independently text-labelled semantic ground truth.",
        },
        "interpretation_guardrails": [
            "All acting candidates remain byte-for-byte frozen; only sealed evaluation targets change.",
            "Cross-locator comparisons from the original independently-bound summaries are invalid.",
            "The canonical binding is fixed from the transcript baseline because unit IDs and word order originate with the transcript.",
            "High quality requires precision >= 0.97 and recall >= 0.95.",
            "Foreign, missed, and unlabelled ink remain separate objectives.",
        ],
        "binding_mismatch_count": len(mismatch_ledger),
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
    print(f"binding_mismatch_count={len(mismatch_ledger)}")
    for config in reevaluated:
        before = config["original_summary"]["evaluation_high_quality_count"]
        after = config["canonical_summary"]["evaluation_high_quality_count"]
        print(f"{config['proposal_id']}: high_quality {before} -> {after}")
    print(json.dumps(result["choice_oracle"], indent=2, sort_keys=True)[:4000])
    print(f"analysis_sha256={result['analysis_sha256']}")
    print(f"file_sha256={sha256_file(args.output)}")


if __name__ == "__main__":
    main()
