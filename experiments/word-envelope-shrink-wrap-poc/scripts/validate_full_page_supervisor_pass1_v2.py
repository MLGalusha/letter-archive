#!/usr/bin/env python3
"""Validate one pass-1 page decision against its exact public packet."""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator


ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "schemas/full-page-supervisor-pass1-decision-v2.schema.json"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_hash(value: object) -> str:
    return hashlib.sha256(
        json.dumps(
            value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
    ).hexdigest()


def fail(message: str) -> None:
    raise RuntimeError(message)


def validate(decision_path: Path) -> dict[str, Any]:
    decision = json.loads(decision_path.read_text())
    schema = json.loads(SCHEMA.read_text())
    Draft202012Validator.check_schema(schema)
    errors = sorted(
        Draft202012Validator(schema).iter_errors(decision),
        key=lambda error: list(error.absolute_path),
    )
    if errors:
        detail = "\n".join(
            f"{list(error.absolute_path)}: {error.message}" for error in errors[:30]
        )
        fail(f"JSON Schema validation failed:\n{detail}")

    page_id = decision["page_id"]
    packet_path = (
        ROOT
        / "artifacts/full-page-supervisor-trial-v2"
        / page_id
        / "public/run-packet.json"
    )
    packet = json.loads(packet_path.read_text())
    if decision["source_sha256"] != packet["source"]["sha256"]:
        fail("source_sha256 does not bind the public packet")
    packet_file_sha256 = sha256_file(packet_path)
    if decision["public_packet_sha256"] != packet_file_sha256:
        fail("public_packet_sha256 does not bind the exact packet file")
    if decision["page_run_order"] != packet["page_run_order"]:
        fail("page_run_order does not match the sequential gate")
    if decision["hidden_prior_answer_access"] is not False:
        fail("hidden prior-answer access must remain false")

    expected_lines = packet["lines"]
    actual_lines = decision["lines"]
    if [line["line_id"] for line in actual_lines] != [
        line["line_id"] for line in expected_lines
    ]:
        fail("line IDs are missing, duplicated, or out of supervisor order")
    if [line["line_reading_order"] for line in actual_lines] != list(
        range(1, len(expected_lines) + 1)
    ):
        fail("line_reading_order is not the exact supervisor sequence")

    source_width, source_height = packet["source"]["size"]
    unit_ids: list[str] = []
    accounting_counts: Counter[str] = Counter()
    route_counts: Counter[str] = Counter()
    action_counts: Counter[str] = Counter()
    alignment_counts: Counter[str] = Counter()
    transcript_change_lines = 0
    unresolved_transcript_lines: list[str] = []

    for expected, actual in zip(expected_lines, actual_lines, strict=True):
        if expected["line_id"] != actual["line_id"]:
            fail("line mismatch after ordered comparison")
        expected_proposals = {
            item["proposal_id"] for item in expected["box_proposals"]
        }
        for unit in actual["visible_units"]:
            unit_ids.append(unit["unit_id"])
            x, y, width, height = unit["bbox_source_xywh"]
            if x + width > source_width or y + height > source_height:
                fail(f"{unit['unit_id']} rectangle leaves source bounds")
            for proposal_id in unit["source_proposal_ids"]:
                if proposal_id not in expected_proposals:
                    fail(
                        f"{unit['unit_id']} references unknown proposal {proposal_id}"
                    )
                accounting_counts[f"{actual['line_id']}:{proposal_id}"] += 1
            flags = unit["risk_flags"]
            if "none" in flags and len(flags) != 1:
                fail(f"{unit['unit_id']} mixes risk flag 'none' with real flags")
            route_counts[unit["ownership_route"]] += 1
            action_counts[unit["proposal_action"]] += 1
            alignment_counts[unit["alignment_status"]] += 1

        local_orders = [unit["reading_order"] for unit in actual["visible_units"]]
        if len(local_orders) != len(set(local_orders)):
            fail(f"duplicate visible-unit reading order in {actual['line_id']}")
        if sorted(local_orders) != list(range(1, len(local_orders) + 1)):
            fail(f"visible-unit reading orders are not contiguous in {actual['line_id']}")

        dropped_ids = [item["proposal_id"] for item in actual["dropped_proposals"]]
        if len(dropped_ids) != len(set(dropped_ids)):
            fail(f"duplicate dropped proposal in {actual['line_id']}")
        for proposal_id in dropped_ids:
            if proposal_id not in expected_proposals:
                fail(f"unknown dropped proposal {proposal_id}")
            accounting_counts[f"{actual['line_id']}:{proposal_id}"] += 1

        bad_accounting = {
            proposal_id: accounting_counts[f"{actual['line_id']}:{proposal_id}"]
            for proposal_id in expected_proposals
            if accounting_counts[f"{actual['line_id']}:{proposal_id}"] != 1
        }
        if bad_accounting:
            fail(
                f"proposal accounting is not exactly once in {actual['line_id']}: "
                f"{bad_accounting}"
            )

        visible_text_sequence = [
            unit["tentative_text"]
            for unit in sorted(
                actual["visible_units"], key=lambda item: item["reading_order"]
            )
        ]
        if actual["transcript_proposal_disposition"] != "accepted":
            transcript_change_lines += 1

        expected_status = "ready_for_ownership"
        if actual["registration_status"] == "human_review" or any(
            unit["ownership_route"] == "human"
            for unit in actual["visible_units"]
        ):
            expected_status = "needs_human"
        elif actual["registration_status"] == "sol_review" or any(
            unit["ownership_route"] == "sol_shared_ink"
            for unit in actual["visible_units"]
        ):
            expected_status = "needs_sol"
        if actual["line_status"] != expected_status:
            fail(
                f"line_status for {actual['line_id']} must be {expected_status}, "
                f"got {actual['line_status']}"
            )
        if visible_text_sequence != actual["final_tentative_transcript"]:
            if actual["line_status"] == "ready_for_ownership":
                fail(
                    "ready line final_tentative_transcript does not replay its "
                    f"visible units in {actual['line_id']}"
                )
            unresolved_transcript_lines.append(actual["line_id"])

    if len(unit_ids) != len(set(unit_ids)):
        duplicates = sorted(
            unit_id for unit_id, count in Counter(unit_ids).items() if count > 1
        )
        fail(f"visible unit IDs are not page-unique: {duplicates}")

    result: dict[str, Any] = {
        "schema_version": "full-page-supervisor-pass1-validation.v2",
        "trial_id": "full-page-supervisor-trial-v2",
        "page_id": page_id,
        "status": "pass",
        "source_sha256": decision["source_sha256"],
        "public_packet_sha256": decision["public_packet_sha256"],
        "public_packet_internal_sha256": packet["packet_sha256"],
        "decision_file_sha256": sha256_file(decision_path),
        "decision_canonical_sha256": canonical_hash(decision),
        "line_count": len(actual_lines),
        "visible_unit_count": len(unit_ids),
        "input_proposal_count": sum(
            len(line["box_proposals"]) for line in expected_lines
        ),
        "dropped_proposal_count": sum(
            len(line["dropped_proposals"]) for line in actual_lines
        ),
        "transcript_change_line_count": transcript_change_lines,
        "unresolved_transcript_alignment_lines": unresolved_transcript_lines,
        "route_counts": dict(sorted(route_counts.items())),
        "proposal_action_counts": dict(sorted(action_counts.items())),
        "alignment_status_counts": dict(sorted(alignment_counts.items())),
        "invariants": {
            "schema_valid": True,
            "source_and_packet_bound": True,
            "sequential_line_order_exact": True,
            "every_input_proposal_accounted_exactly_once": True,
            "visible_unit_ids_unique": True,
            "visible_unit_orders_contiguous_per_line": True,
            "rectangles_inside_source": True,
            "ready_line_transcript_replays_all_visible_units": True,
            "line_status_matches_routes": True,
            "hidden_prior_answer_access": False,
        },
    }
    result["validation_sha256"] = canonical_hash(result)
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("decision_path", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = validate(args.decision_path)
    output = args.output or args.decision_path.with_name("validation.json")
    output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
