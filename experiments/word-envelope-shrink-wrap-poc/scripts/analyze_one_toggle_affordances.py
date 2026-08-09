#!/usr/bin/env python3
"""Evaluate one-component edits to an already frozen proposal suite.

This script is sealed post-freeze evaluation. Candidate proposals and the set of
toggleable components are fixed by an existing acting run before the human
partition is opened. No acting policy may consume this output.
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


def proposal_id(config: dict[str, Any]) -> str:
    return f"{config['locator']}|{config['policy']}"


def score(
    *,
    true_positive: int,
    foreign: int,
    unlabelled: int,
    target_total: int,
) -> dict[str, Any]:
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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--experiment", type=Path, required=True)
    parser.add_argument("--clean-mask", type=Path, required=True)
    parser.add_argument("--human-run", type=Path, required=True)
    parser.add_argument("--locator", choices=[*sorted(LOCATORS), "both"], default="transcript_bbox_xywh")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    experiment = json.loads(args.experiment.read_text(encoding="utf-8"))
    configurations = [
        config
        for config in experiment["configurations"]
        if (args.locator == "both" or config["locator"] == args.locator)
        and config["policy"] in POLICIES
    ]
    expected_configuration_count = 8 if args.locator == "both" else 4
    if len(configurations) != expected_configuration_count:
        raise SystemExit(f"Expected exactly {expected_configuration_count} frozen non-abstaining configurations")
    canonical_config = next(
        config
        for config in experiment["configurations"]
        if config["locator"] == "transcript_bbox_xywh" and config["policy"] == "global_exclusive"
    )
    canonical_binding = {
        str(item["unit_id"]): int(item["evaluation_human_word_number"])
        for item in canonical_config["items"]
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
    unlabelled_pixels = np.bincount(
        labels[(labels > 0) & (ownership == 0)].ravel(), minlength=component_count + 1
    )

    by_unit: dict[str, list[dict[str, Any]]] = {}
    for config in configurations:
        identifier = proposal_id(config)
        for item in config["items"]:
            selected_component_ids = [int(value) for value in item["selected_component_ids"]]
            reconstructed = np.isin(labels, np.asarray(selected_component_ids, dtype=labels.dtype))
            if int(reconstructed.sum()) != int(item["selected_pixels"]):
                raise RuntimeError(f"Component labels do not reproduce {identifier} {item['unit_id']}")
            if sha256_mask_pixels(reconstructed) != item["selected_pixel_sha256"]:
                raise RuntimeError(f"Component labels fail pixel hash for {identifier} {item['unit_id']}")
            by_unit.setdefault(str(item["unit_id"]), []).append(
                {
                    "proposal_id": identifier,
                    "text": item["text"],
                    "line_id": item["line_id"],
                    "selected_component_ids": selected_component_ids,
                    "evaluation": item["evaluation"],
                }
            )

    records: list[dict[str, Any]] = []
    zero_action_count = 0
    one_toggle_count = 0
    unresolved_count = 0
    for unit_id, proposals in sorted(by_unit.items()):
        if len(proposals) != expected_configuration_count:
            raise RuntimeError(f"{unit_id} does not have {expected_configuration_count} proposals")
        component_pool = sorted(
            {
                component_id
                for proposal in proposals
                for component_id in proposal["selected_component_ids"]
            }
        )
        human_number = canonical_binding[unit_id]
        target = ownership == human_number
        target_by_component = np.bincount(
            labels[target & (labels > 0)].ravel(), minlength=component_count + 1
        )
        foreign_by_component = component_pixels - target_by_component - unlabelled_pixels
        target_total = int(human_by_number[human_number]["pixels"])
        for proposal in proposals:
            selected_ids = np.asarray(proposal["selected_component_ids"], dtype=np.int64)
            proposal["canonical_evaluation"] = score(
                true_positive=int(target_by_component[selected_ids].sum()),
                foreign=int(foreign_by_component[selected_ids].sum()),
                unlabelled=int(unlabelled_pixels[selected_ids].sum()),
                target_total=target_total,
            )
        zero_action = any(
            bool(proposal["canonical_evaluation"]["evaluation_gate_high_quality"])
            for proposal in proposals
        )
        solutions: list[dict[str, Any]] = []
        if not zero_action:
            for proposal in proposals:
                selected = set(proposal["selected_component_ids"])
                evaluation = proposal["canonical_evaluation"]
                current = (
                    int(evaluation["true_positive_pixels"]),
                    int(evaluation["foreign_human_word_pixels"]),
                    int(evaluation["unlabelled_selected_pixels"]),
                )
                for component_id in component_pool:
                    direction = -1 if component_id in selected else 1
                    revised = score(
                        true_positive=current[0] + direction * int(target_by_component[component_id]),
                        foreign=current[1] + direction * int(foreign_by_component[component_id]),
                        unlabelled=current[2] + direction * int(unlabelled_pixels[component_id]),
                        target_total=target_total,
                    )
                    if revised["evaluation_gate_high_quality"]:
                        solutions.append(
                            {
                                "from_proposal_id": proposal["proposal_id"],
                                "action": "remove" if direction < 0 else "add",
                                "component_id": component_id,
                                "component_pixels": int(component_pixels[component_id]),
                                "component_target_pixels": int(target_by_component[component_id]),
                                "component_foreign_pixels": int(foreign_by_component[component_id]),
                                "component_unlabelled_pixels": int(unlabelled_pixels[component_id]),
                                "result": revised,
                            }
                        )
        solutions.sort(
            key=lambda row: (
                row["result"]["foreign_human_word_pixels"],
                row["result"]["missed_target_pixels"],
                row["result"]["unlabelled_selected_pixels"],
                row["action"],
                row["component_id"],
                row["from_proposal_id"],
            )
        )
        if zero_action:
            disposition = "frozen_choice_only_high_quality"
            zero_action_count += 1
        elif solutions:
            disposition = "one_component_toggle_high_quality"
            one_toggle_count += 1
        else:
            disposition = "unresolved_by_choice_plus_one_union_component_toggle"
            unresolved_count += 1
        records.append(
            {
                "unit_id": unit_id,
                "text": proposals[0]["text"],
                "line_id": proposals[0]["line_id"],
                "human_word_number": human_number,
                "disposition": disposition,
                "frozen_union_component_pool": component_pool,
                "frozen_union_component_pool_count": len(component_pool),
                "one_toggle_solution_count": len(solutions),
                "one_toggle_solutions": solutions,
            }
        )

    latest_state = sorted((args.human_run / "revisions").glob("r*/state.json"))[-1]
    result: dict[str, Any] = {
        "schema_version": "one-toggle-affordance-analysis.v1",
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
            "pixels": int(clean.sum()),
            "component_count": component_count,
        },
        "sealed_human_partition": {
            "path": str(args.human_run.resolve()),
            "manifest_file_sha256": sha256_file(args.human_run / "manifest.json"),
            "latest_state_path": str(latest_state.resolve()),
            "latest_state_file_sha256": sha256_file(latest_state),
            "ownership_uint16_sha256": hashlib.sha256(ownership.tobytes()).hexdigest(),
            "word_count": len(human),
        },
        "interaction_definition": {
            "locator_family": args.locator,
            "canonical_binding": "transcript_bbox_xywh|global_exclusive",
            "zero_action": f"choose any one of {expected_configuration_count} already-frozen proposals",
            "one_toggle": "choose a frozen proposal, then add or remove one whole Clean component",
            "toggle_pool": f"union of component IDs already visible in the {expected_configuration_count} frozen proposals for that word",
            "excludes": [
                "components absent from every frozen proposal",
                "component splitting",
                "pixel painting or erasing",
                "new locator or line reassignment",
            ],
        },
        "interpretation_guardrails": [
            "Counts are sealed oracle ceilings, not acting-agent accuracy.",
            "The human partition was loaded only after the proposal suite and toggle pools were frozen.",
            "One-toggle success does not show that an agent can identify the correct component.",
            "Unresolved words may need multiple toggles, unseen local components, splitting, or reassignment.",
            "High quality requires precision >= 0.97 and recall >= 0.95.",
        ],
        "summary": {
            "unit_count": len(records),
            "frozen_choice_only_high_quality_count": zero_action_count,
            "additional_one_component_toggle_high_quality_count": one_toggle_count,
            "choice_plus_one_toggle_oracle_high_quality_count": zero_action_count + one_toggle_count,
            "unresolved_count": unresolved_count,
            "unresolved_units": [
                {"unit_id": record["unit_id"], "text": record["text"]}
                for record in records
                if record["disposition"].startswith("unresolved")
            ],
        },
        "units": records,
    }
    result["analysis_sha256"] = hashlib.sha256(canonical_json_bytes(result)).hexdigest()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(canonical_json_bytes(result) + b"\n")
    print(json.dumps(result["summary"], indent=2, sort_keys=True))
    print(f"analysis_sha256={result['analysis_sha256']}")
    print(f"file_sha256={sha256_file(args.output)}")


if __name__ == "__main__":
    main()
