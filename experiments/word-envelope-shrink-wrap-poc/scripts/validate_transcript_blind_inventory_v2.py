#!/usr/bin/env python3
"""Validate a transcript-blind visible-inventory audit."""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator


ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "schemas/transcript-blind-inventory-decision-v2.schema.json"
TRIAL = ROOT / "artifacts/full-page-supervisor-trial-v2"


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


def validate(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text())
    schema = json.loads(SCHEMA.read_text())
    Draft202012Validator.check_schema(schema)
    errors = sorted(
        Draft202012Validator(schema).iter_errors(value),
        key=lambda error: list(error.absolute_path),
    )
    if errors:
        raise RuntimeError(
            "Schema validation failed:\n"
            + "\n".join(
                f"{list(error.absolute_path)}: {error.message}"
                for error in errors[:30]
            )
        )
    page_id = value["page_id"]
    packet_path = TRIAL / page_id / "public/inventory-blind/run-packet.json"
    packet = json.loads(packet_path.read_text())
    if value["source_sha256"] != packet["source"]["sha256"]:
        raise RuntimeError("source hash mismatch")
    if value["inventory_packet_sha256"] != sha256_file(packet_path):
        raise RuntimeError("inventory packet file hash mismatch")
    if value["page_run_order"] != packet["page_run_order"]:
        raise RuntimeError("page run order mismatch")
    if value["transcript_access"] is not False:
        raise RuntimeError("transcript access must remain false")
    expected_lines = packet["lines"]
    actual_lines = value["lines"]
    if [line["line_id"] for line in actual_lines] != [
        line["line_id"] for line in expected_lines
    ]:
        raise RuntimeError("line cursor sequence mismatch")
    source_width, source_height = packet["source"]["size"]
    all_unit_ids: list[str] = []
    route_counts: Counter[str] = Counter()
    action_counts: Counter[str] = Counter()
    for expected, actual in zip(expected_lines, actual_lines, strict=True):
        expected_proposals = {
            proposal["proposal_id"] for proposal in expected["box_proposals"]
        }
        accounting: Counter[str] = Counter()
        orders: list[int] = []
        for unit in actual["visible_units"]:
            all_unit_ids.append(unit["unit_id"])
            orders.append(unit["reading_order"])
            x, y, width, height = unit["bbox_source_xywh"]
            if x + width > source_width or y + height > source_height:
                raise RuntimeError(f"out-of-source rectangle: {unit['unit_id']}")
            for proposal_id in unit["source_proposal_ids"]:
                if proposal_id not in expected_proposals:
                    raise RuntimeError(f"unknown proposal reference: {proposal_id}")
                accounting[proposal_id] += 1
            flags = unit["risk_flags"]
            if "none" in flags and len(flags) > 1:
                raise RuntimeError(f"mixed none/risk flags: {unit['unit_id']}")
            route_counts[unit["review_route"]] += 1
            action_counts[unit["proposal_action"]] += 1
        if sorted(orders) != list(range(1, len(orders) + 1)):
            raise RuntimeError(f"non-contiguous unit orders: {actual['line_id']}")
        drop_ids = [item["proposal_id"] for item in actual["dropped_proposals"]]
        if len(drop_ids) != len(set(drop_ids)):
            raise RuntimeError(f"duplicate drop: {actual['line_id']}")
        for proposal_id in drop_ids:
            if proposal_id not in expected_proposals:
                raise RuntimeError(f"unknown dropped proposal: {proposal_id}")
            accounting[proposal_id] += 1
        bad = {
            proposal_id: accounting[proposal_id]
            for proposal_id in expected_proposals
            if accounting[proposal_id] != 1
        }
        if bad:
            raise RuntimeError(
                f"proposal accounting must be exactly once in {actual['line_id']}: {bad}"
            )
        expected_status = "inventory_ready"
        if actual["registration_status"] == "human_review" or any(
            unit["review_route"] == "human" for unit in actual["visible_units"]
        ):
            expected_status = "needs_human"
        elif actual["registration_status"] == "sol_review" or any(
            unit["review_route"] == "sol" for unit in actual["visible_units"]
        ):
            expected_status = "needs_sol"
        if actual["line_status"] != expected_status:
            raise RuntimeError(
                f"line status mismatch in {actual['line_id']}: expected {expected_status}"
            )
    if len(all_unit_ids) != len(set(all_unit_ids)):
        raise RuntimeError("unit IDs must be page-unique")
    result: dict[str, Any] = {
        "schema_version": "transcript-blind-inventory-validation.v2",
        "trial_id": "full-page-supervisor-trial-v2",
        "page_id": page_id,
        "status": "pass",
        "source_sha256": value["source_sha256"],
        "inventory_packet_sha256": value["inventory_packet_sha256"],
        "inventory_packet_internal_sha256": packet["packet_sha256"],
        "decision_file_sha256": sha256_file(path),
        "decision_canonical_sha256": canonical_hash(value),
        "line_count": len(actual_lines),
        "visible_unit_count": len(all_unit_ids),
        "proposal_count": packet["proposal_box_count"],
        "review_route_counts": dict(sorted(route_counts.items())),
        "proposal_action_counts": dict(sorted(action_counts.items())),
        "invariants": {
            "schema_valid": True,
            "packet_and_source_bound": True,
            "transcript_access": False,
            "line_cursor_exact": True,
            "proposal_accounting_exactly_once": True,
            "unit_ids_unique": True,
            "unit_orders_contiguous": True,
            "rectangles_inside_source": True,
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
