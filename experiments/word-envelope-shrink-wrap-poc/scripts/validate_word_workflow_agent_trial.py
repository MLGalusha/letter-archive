#!/usr/bin/env python3
"""Replay and quality-check one four-scenario word-work agent trial."""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
from typing import Any, Iterable

from word_envelope.agent_work_ledger import (
    apply_transition,
    bind_agent_decision,
    next_work_item,
)
from word_envelope.io_utils import canonical_json_bytes, read_json, write_json


SCHEMA_VERSION = "word-workflow-agent-trial-validation.v1"
EXPECTED_ACTIONS = {
    "01-007-will-to-wish": "reject_transcript",
    "02-007-omitted-love-residual": "insert_visible_unit",
    "03-014-clockwise-top-margin-order": "approve_line_registration",
    "04-007-body-10-many-to-many": "accept_alignment_group",
}


def strings(value: Any) -> Iterable[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for child in value.values():
            yield from strings(child)
    elif isinstance(value, list):
        for child in value:
            yield from strings(child)


def validate(demo_root: Path, decisions_path: Path) -> dict[str, Any]:
    decisions = read_json(decisions_path)
    if set(decisions) != set(EXPECTED_ACTIONS):
        raise ValueError("trial decisions must contain the exact four demo scenarios")
    results: dict[str, Any] = {}
    for name in sorted(EXPECTED_ACTIONS):
        decision = decisions[name]
        ledger = read_json(demo_root / name / "current-ledger.json")
        packet = next_work_item(ledger)
        action = decision["action"]
        if action["type"] != EXPECTED_ACTIONS[name]:
            raise ValueError(
                f"{name}: expected semantic action {EXPECTED_ACTIONS[name]!r}, "
                f"got {action['type']!r}"
            )
        payload = action["payload"]
        evidence = payload.get("evidence_sha256") or payload.get(
            "directed_reading_sha256"
        )
        if evidence not in set(strings(packet)):
            raise ValueError(f"{name}: decision evidence was not present in its packet")
        transition = bind_agent_decision(ledger, decision)
        child = apply_transition(ledger, transition)
        child_packet = next_work_item(child)
        if child["parent_ledger_sha256"] != ledger["ledger_sha256"]:
            raise ValueError(f"{name}: child revision lost its parent binding")
        results[name] = {
            "action": action["type"],
            "base_stage": packet["current"]["stage"],
            "base_item_id": packet["current"]["item_id"],
            "evidence_was_packet_bound": True,
            "transition_sha256": transition["transition_sha256"],
            "child_revision": child["revision"],
            "child_stage": child_packet["current"]["stage"],
            "child_item_id": child_packet["current"]["item_id"],
        }
    basis = {
        "schema_version": SCHEMA_VERSION,
        "model_label": "gpt-5.6-terra",
        "scenario_count": len(results),
        "schema_valid_count": len(results),
        "intended_action_count": len(results),
        "packet_bound_evidence_count": len(results),
        "results": results,
    }
    return {
        **basis,
        "validation_sha256": hashlib.sha256(canonical_json_bytes(basis)).hexdigest(),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--demo-root",
        type=Path,
        default=Path("artifacts/word-workflow-v1-demo"),
    )
    parser.add_argument(
        "--decisions",
        type=Path,
        default=Path("artifacts/word-workflow-v1-terra-trial/decisions.json"),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("artifacts/word-workflow-v1-terra-trial/VALIDATION.json"),
    )
    args = parser.parse_args()
    result = validate(args.demo_root, args.decisions)
    write_json(args.output, result)
    print(result["validation_sha256"])


if __name__ == "__main__":
    main()
