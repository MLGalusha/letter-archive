#!/usr/bin/env python3
"""Apply sealed evaluator decisions to a semantic binding template and freeze it."""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path

from word_envelope.io_utils import canonical_json_bytes, read_json, sha256_file, write_json
from word_envelope.semantic_binding_validation import validate_semantic_binding


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--template", type=Path, required=True)
    parser.add_argument("--decisions", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        raise SystemExit("Output exists; refusing overwrite")

    record = read_json(args.template)
    decisions = read_json(args.decisions)
    assignments = decisions["assignments"]
    exclusions = decisions.get("excluded_merged", {})
    unbound_by_line = decisions.get("unbound_by_line", {})
    seen_units: set[str] = set()

    for line in record["lines"]:
        line_id = line["line_id"]
        line["unbound_human_word_numbers"] = unbound_by_line.get(line_id, [])
        line["line_note"] = decisions.get("line_notes", {}).get(line_id, "")
        for unit in line["units"]:
            unit_id = unit["unit_id"]
            if unit_id in assignments:
                unit["status"] = "assigned"
                unit["target_human_word_numbers"] = assignments[unit_id]
                unit["note"] = decisions.get("assignment_notes", {}).get(unit_id, "")
            elif unit_id in exclusions:
                unit["status"] = "excluded_merged"
                unit["target_human_word_numbers"] = []
                unit["note"] = exclusions[unit_id]
            else:
                raise SystemExit(f"No sealed decision for {unit_id}")
            seen_units.add(unit_id)

    extra = (set(assignments) | set(exclusions)) - seen_units
    if extra:
        raise SystemExit(f"Unknown decision unit IDs: {sorted(extra)}")

    record["status"] = "complete"
    record["adjudication"] = {
        "role": "sealed_evaluator_only",
        "protocol": decisions["protocol"],
        "decisions_path": str(args.decisions.resolve()),
        "decisions_file_sha256": sha256_file(args.decisions),
        "scorable_unit_count": len(assignments),
        "excluded_unit_count": len(exclusions),
        "unbound_mask_count": sum(len(values) for values in unbound_by_line.values()),
    }
    record.pop("adjudication_sha256", None)
    record["adjudication_sha256"] = hashlib.sha256(canonical_json_bytes(record)).hexdigest()
    write_json(args.output, record)
    validation = validate_semantic_binding(args.output)
    if not validation["passed"]:
        args.output.unlink()
        raise SystemExit(f"Completed ledger failed validation: {validation['violations']}")
    print(record["adjudication_sha256"])


if __name__ == "__main__":
    main()
