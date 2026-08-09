#!/usr/bin/env python3
"""Fail-closed validator for one fragment-group agent decision."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from word_envelope.io_utils import canonical_json_bytes, sha256_file  # noqa: E402
from word_envelope.simple_page_agent import _hash_record  # noqa: E402


def _read(path: Path) -> dict:
    value = json.loads(path.read_text("utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"Expected JSON object: {path}")
    return value


def validate(review: dict, decision: dict) -> dict:
    expected_keys = {
        "schema_version",
        "fragment_group_review_sha256",
        "keep_group_id",
        "request_split_group_ids",
        "brief_visible_reason",
    }
    if set(decision) != expected_keys:
        raise ValueError("Decision fields must match the frozen contract exactly")
    if decision["schema_version"] != "fragment-group-decision.v1":
        raise ValueError("Unsupported decision schema")
    if decision["fragment_group_review_sha256"] != review["fragment_group_review_sha256"]:
        raise ValueError("Stale or wrong fragment-group review binding")
    eligible = review["eligible_group_ids"]
    if decision["keep_group_id"] not in eligible:
        raise ValueError("keep_group_id is not eligible in the active reading lane")
    split_ids = decision["request_split_group_ids"]
    if not isinstance(split_ids, list) or len(set(split_ids)) != len(split_ids):
        raise ValueError("request_split_group_ids must be a unique list")
    if any(group_id not in eligible for group_id in split_ids):
        raise ValueError("Only eligible groups can be split")
    if split_ids and split_ids != [decision["keep_group_id"]]:
        raise ValueError("A split request may target only the chosen group")
    reason = decision["brief_visible_reason"]
    if not isinstance(reason, str) or not reason.strip() or len(reason) > 500:
        raise ValueError("brief_visible_reason must contain 1–500 characters")
    receipt = {
        "schema_version": "fragment-group-validation.v1",
        "status": "pass",
        "review_sha256": review["fragment_group_review_sha256"],
        "keep_group_id": decision["keep_group_id"],
        "split_requested": bool(split_ids),
    }
    receipt["validation_sha256"] = _hash_record(receipt, "validation_sha256")
    return receipt


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--review", type=Path, required=True)
    parser.add_argument("--decision", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists() or args.output.is_symlink():
        raise SystemExit(f"Refusing to overwrite {args.output}")
    try:
        review = _read(args.review)
        decision = _read(args.decision)
        receipt = validate(review, decision)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(str(error), file=sys.stderr)
        return 2
    receipt["review_file_sha256"] = sha256_file(args.review)
    receipt["decision_file_sha256"] = sha256_file(args.decision)
    receipt["validation_sha256"] = _hash_record(receipt, "validation_sha256")
    args.output.write_bytes(canonical_json_bytes(receipt) + b"\n")
    print(json.dumps(receipt, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
