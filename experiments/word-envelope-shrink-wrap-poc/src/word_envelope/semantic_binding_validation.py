"""Strict validation for sealed semantic-to-mask adjudication ledgers."""

from __future__ import annotations

from collections import Counter
from pathlib import Path
from typing import Any

from .io_utils import read_json, sha256_file


SEALED_ROLE = "sealed_evaluator_only_never_acting_input"
FINAL_UNIT_STATUSES = {"assigned", "partial", "missing", "excluded_merged"}


def _violation(kind: str, location: str, message: str) -> dict[str, str]:
    return {"kind": kind, "location": location, "message": message}


def validate_semantic_binding(
    ledger_path: Path,
    *,
    require_complete: bool = True,
    verify_inputs: bool = True,
) -> dict[str, Any]:
    """Validate completeness, exclusivity, coverage, and sealed input identity.

    This validator reads metadata only. It never opens the completed human page or
    any evaluator board, so it is safe to run outside the sealed visual review.
    """

    ledger_path = ledger_path.resolve()
    record = read_json(ledger_path)
    violations: list[dict[str, str]] = []

    if record.get("evidence_role") != SEALED_ROLE:
        violations.append(
            _violation("wrong_evidence_role", "evidence_role", f"expected {SEALED_ROLE!r}")
        )
    if require_complete and record.get("status") != "complete":
        violations.append(_violation("incomplete_record", "status", "must be 'complete'"))

    if verify_inputs:
        for name, item in record.get("inputs", {}).items():
            if not isinstance(item, dict):
                continue
            hash_pairs = (
                ("path", "file_sha256"),
                ("latest_state_path", "latest_state_file_sha256"),
            )
            for path_key, hash_key in hash_pairs:
                path_value = item.get(path_key)
                expected = item.get(hash_key)
                if not path_value or not expected:
                    continue
                path = Path(path_value)
                location = f"inputs.{name}.{path_key}"
                if not path.exists():
                    violations.append(_violation("missing_input", location, str(path)))
                elif path.is_file() and sha256_file(path) != expected:
                    violations.append(_violation("input_hash_mismatch", location, str(path)))

    globally_assigned: list[int] = []
    globally_declared: list[int] = []
    globally_resolved: list[int] = []

    for line_index, line in enumerate(record.get("lines", [])):
        line_id = str(line.get("line_id", f"line-{line_index}"))
        location = f"lines[{line_index}]({line_id})"
        candidate_numbers = [
            int(row["human_word_number"]) for row in line.get("nearby_human_masks", [])
        ]
        globally_declared.extend(candidate_numbers)
        candidate_set = set(candidate_numbers)
        unbound = [int(value) for value in line.get("unbound_human_word_numbers", [])]
        globally_resolved.extend(unbound)

        if len(candidate_set) != len(candidate_numbers):
            violations.append(
                _violation("duplicate_line_candidate", location, "candidate mask numbers repeat")
            )
        if require_complete and unbound and not str(line.get("line_note", "")).strip():
            violations.append(
                _violation("unexplained_unbound", f"{location}.line_note", "unbound masks require a note")
            )

        line_assigned: list[int] = []
        units = line.get("units", [])
        for unit_index, unit in enumerate(units):
            unit_id = str(unit.get("unit_id", f"unit-{unit_index}"))
            unit_location = f"{location}.units[{unit_index}]({unit_id})"
            status = unit.get("status")
            targets = [int(value) for value in unit.get("target_human_word_numbers", [])]
            note = str(unit.get("note", "")).strip()
            if len(set(targets)) != len(targets):
                violations.append(
                    _violation("duplicate_unit_target", unit_location, "target mask numbers repeat")
                )
            if any(target not in candidate_set for target in targets):
                violations.append(
                    _violation("target_outside_line", unit_location, "target is not a candidate on this line")
                )
            if require_complete and status not in FINAL_UNIT_STATUSES:
                violations.append(
                    _violation("incomplete_unit", f"{unit_location}.status", f"got {status!r}")
                )
            if status in {"assigned", "partial"} and not targets:
                violations.append(
                    _violation("assigned_without_target", unit_location, f"status {status!r} needs a target")
                )
            if status in {"missing", "excluded_merged"} and targets:
                violations.append(
                    _violation("target_on_unassignable_unit", unit_location, f"status {status!r} must have no target")
                )
            if require_complete and status in {"partial", "missing", "excluded_merged"} and not note:
                violations.append(
                    _violation("missing_exception_note", f"{unit_location}.note", f"status {status!r} needs a note")
                )
            line_assigned.extend(targets)

        counts = Counter(line_assigned)
        for number, count in sorted(counts.items()):
            if count > 1:
                violations.append(
                    _violation("duplicate_mask_owner", location, f"H{number} is assigned {count} times")
                )
        if set(line_assigned) & set(unbound):
            overlap = sorted(set(line_assigned) & set(unbound))
            violations.append(
                _violation("assigned_and_unbound", location, f"both dispositions: {overlap}")
            )
        resolved = set(line_assigned) | set(unbound)
        if require_complete and resolved != candidate_set:
            missing = sorted(candidate_set - resolved)
            extra = sorted(resolved - candidate_set)
            violations.append(
                _violation("incomplete_line_coverage", location, f"missing={missing}, extra={extra}")
            )
        globally_assigned.extend(line_assigned)
        globally_resolved.extend(line_assigned)

    declared_counts = Counter(globally_declared)
    for number, count in sorted(declared_counts.items()):
        if count > 1:
            violations.append(
                _violation("mask_declared_on_multiple_lines", "lines", f"H{number} appears {count} times")
            )
    owner_counts = Counter(globally_assigned)
    for number, count in sorted(owner_counts.items()):
        if count > 1:
            violations.append(
                _violation("duplicate_global_mask_owner", "lines", f"H{number} is assigned {count} times")
            )

    window = record.get("body_human_word_number_window", {})
    if all(key in window for key in ("start", "end")):
        expected = set(range(int(window["start"]), int(window["end"]) + 1))
        declared = set(globally_declared)
        if declared != expected:
            violations.append(
                _violation(
                    "body_window_mismatch",
                    "body_human_word_number_window",
                    f"missing={sorted(expected - declared)}, extra={sorted(declared - expected)}",
                )
            )

    return {
        "schema_version": "semantic-binding-validation.v1",
        "ledger_path": str(ledger_path),
        "ledger_file_sha256": sha256_file(ledger_path),
        "require_complete": require_complete,
        "verify_inputs": verify_inputs,
        "declared_mask_count": len(set(globally_declared)),
        "assigned_mask_count": len(set(globally_assigned)),
        "resolved_mask_count": len(set(globally_resolved)),
        "violation_count": len(violations),
        "violations": violations,
        "passed": not violations,
    }
