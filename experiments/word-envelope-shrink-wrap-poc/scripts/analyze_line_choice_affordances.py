#!/usr/bin/env python3
"""Measure the choice-only potential of frozen line-coordinate proposals.

This is sealed post-freeze analysis. It never creates or changes an acting
candidate and it does not open the completed page. The evaluated experiment is
the only source of human-derived measurements.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path
from typing import Any


POLICIES = (
    "global_exclusive",
    "line_locator_strip",
    "line_midpoint_centroid",
    "line_valley_centroid",
)
LOCATORS = ("transcript_bbox_xywh", "reviewed_bbox_xywh")
BASELINE = "transcript_bbox_xywh|global_exclusive"


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode(
        "utf-8"
    )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def proposal_id(locator: str, policy: str) -> str:
    return f"{locator}|{policy}"


def pareto_frontier(candidates: list[dict[str, Any]]) -> list[str]:
    """Return proposals not dominated on foreign, missed, and unlabelled ink."""

    frontier: list[str] = []
    for candidate in candidates:
        evaluation = candidate["evaluation"]
        vector = (
            int(evaluation["foreign_human_word_pixels"]),
            int(evaluation["missed_target_pixels"]),
            int(evaluation["unlabelled_selected_pixels"]),
        )
        dominated = False
        for other in candidates:
            if other is candidate:
                continue
            other_evaluation = other["evaluation"]
            other_vector = (
                int(other_evaluation["foreign_human_word_pixels"]),
                int(other_evaluation["missed_target_pixels"]),
                int(other_evaluation["unlabelled_selected_pixels"]),
            )
            if all(left <= right for left, right in zip(other_vector, vector)) and any(
                left < right for left, right in zip(other_vector, vector)
            ):
                dominated = True
                break
        if not dominated:
            frontier.append(candidate["proposal_id"])
    return sorted(frontier)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("experiment", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    experiment = json.loads(args.experiment.read_text(encoding="utf-8"))
    by_unit: dict[str, list[dict[str, Any]]] = {}
    config_summaries: dict[str, dict[str, Any]] = {}
    for config in experiment["configurations"]:
        locator = str(config["locator"])
        policy = str(config["policy"])
        if locator not in LOCATORS or policy not in POLICIES:
            continue
        identifier = proposal_id(locator, policy)
        config_summaries[identifier] = config["summary"]
        for item in config["items"]:
            by_unit.setdefault(str(item["unit_id"]), []).append(
                {
                    "proposal_id": identifier,
                    "locator": locator,
                    "policy": policy,
                    "selected_pixel_sha256": item["selected_pixel_sha256"],
                    "selected_component_ids": item["selected_component_ids"],
                    "selected_pixels": item["selected_pixels"],
                    "evaluation": item["evaluation"],
                    "text": item["text"],
                }
            )

    if len(config_summaries) != len(LOCATORS) * len(POLICIES):
        raise SystemExit("Expected exactly eight non-abstaining frozen proposal configurations")
    if any(len(candidates) != 8 for candidates in by_unit.values()):
        raise SystemExit("Every unit must have exactly eight frozen proposals")

    category_counts: Counter[str] = Counter()
    unique_count_distribution: Counter[int] = Counter()
    high_quality_method_counts: Counter[str] = Counter()
    records: list[dict[str, Any]] = []
    for unit_id, candidates in sorted(by_unit.items()):
        by_id = {candidate["proposal_id"]: candidate for candidate in candidates}
        baseline_hq = bool(by_id[BASELINE]["evaluation"]["evaluation_gate_high_quality"])
        transcript_hq = sorted(
            candidate["proposal_id"]
            for candidate in candidates
            if candidate["locator"] == "transcript_bbox_xywh"
            and candidate["evaluation"]["evaluation_gate_high_quality"]
        )
        all_hq = sorted(
            candidate["proposal_id"]
            for candidate in candidates
            if candidate["evaluation"]["evaluation_gate_high_quality"]
        )
        if baseline_hq:
            category = "baseline_already_high_quality"
        elif transcript_hq:
            category = "recoverable_by_transcript_method_choice"
        elif all_hq:
            category = "recoverable_only_with_reviewed_locator_choice"
        else:
            category = "no_frozen_proposal_high_quality"
        category_counts[category] += 1
        high_quality_method_counts.update(all_hq)

        groups: dict[str, list[str]] = {}
        for candidate in candidates:
            groups.setdefault(candidate["selected_pixel_sha256"], []).append(candidate["proposal_id"])
        unique_count_distribution[len(groups)] += 1
        distinct = [
            {"selected_pixel_sha256": digest, "proposal_ids": sorted(identifiers)}
            for digest, identifiers in sorted(groups.items())
        ]
        best_f1 = max(
            candidates,
            key=lambda candidate: (
                float(candidate["evaluation"]["f1"]),
                float(candidate["evaluation"]["precision"]),
                float(candidate["evaluation"]["recall"]),
                candidate["proposal_id"],
            ),
        )
        records.append(
            {
                "unit_id": unit_id,
                "text": candidates[0]["text"],
                "category": category,
                "baseline_high_quality": baseline_hq,
                "high_quality_proposal_ids": all_hq,
                "distinct_proposal_count": len(distinct),
                "distinct_proposals": distinct,
                "pareto_proposal_ids": pareto_frontier(candidates),
                "descriptive_best_f1_proposal_id": best_f1["proposal_id"],
                "descriptive_best_f1": best_f1["evaluation"]["f1"],
                "proposals": sorted(candidates, key=lambda candidate: candidate["proposal_id"]),
            }
        )

    total = len(records)
    transcript_oracle = sum(
        record["category"]
        in {"baseline_already_high_quality", "recoverable_by_transcript_method_choice"}
        for record in records
    )
    combined_oracle = sum(record["high_quality_proposal_ids"] != [] for record in records)
    result: dict[str, Any] = {
        "schema_version": "line-choice-affordance-analysis.v1",
        "evidence_role": "sealed_post_freeze_evaluation_only",
        "source_experiment": str(args.experiment.resolve()),
        "source_experiment_file_sha256": sha256_file(args.experiment),
        "source_experiment_identity_sha256": experiment["experiment_sha256"],
        "candidate_suite": {
            "locators": list(LOCATORS),
            "policies": list(POLICIES),
            "proposal_count_per_word": 8,
            "baseline_proposal_id": BASELINE,
        },
        "interpretation_guardrails": [
            "Oracle counts measure proposal-set potential, not acting-agent accuracy.",
            "The oracle uses sealed human evidence and cannot be used as an acting policy.",
            "High quality requires precision >= 0.97 and recall >= 0.95.",
            "Pareto frontiers retain foreign, missed, and unlabelled ink as separate objectives.",
            "A high-quality choice does not prove that a future agent can recognize it reliably.",
        ],
        "summary": {
            "unit_count": total,
            "baseline_high_quality_count": category_counts["baseline_already_high_quality"],
            "transcript_four_proposal_oracle_high_quality_count": transcript_oracle,
            "combined_eight_proposal_oracle_high_quality_count": combined_oracle,
            "additional_choice_only_potential_over_baseline": combined_oracle
            - category_counts["baseline_already_high_quality"],
            "category_counts": dict(sorted(category_counts.items())),
            "distinct_proposal_count_distribution": {
                str(key): value for key, value in sorted(unique_count_distribution.items())
            },
            "high_quality_method_incidence_counts": dict(sorted(high_quality_method_counts.items())),
            "no_frozen_proposal_high_quality_units": [
                {"unit_id": record["unit_id"], "text": record["text"]}
                for record in records
                if record["category"] == "no_frozen_proposal_high_quality"
            ],
        },
        "configuration_summaries": config_summaries,
        "units": records,
    }
    result["analysis_sha256"] = hashlib.sha256(canonical_bytes(result)).hexdigest()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(canonical_bytes(result) + b"\n")
    print(json.dumps(result["summary"], indent=2, sort_keys=True))
    print(f"analysis_sha256={result['analysis_sha256']}")
    print(f"file_sha256={sha256_file(args.output)}")


if __name__ == "__main__":
    main()
