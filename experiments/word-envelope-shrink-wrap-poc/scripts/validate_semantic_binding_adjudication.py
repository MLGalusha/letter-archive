#!/usr/bin/env python3
"""Validate a completed sealed semantic binding ledger before scoring."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from word_envelope.io_utils import write_json
from word_envelope.semantic_binding_validation import validate_semantic_binding


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("ledger", type=Path)
    parser.add_argument("--allow-incomplete", action="store_true")
    parser.add_argument("--skip-input-hashes", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = validate_semantic_binding(
        args.ledger,
        require_complete=not args.allow_incomplete,
        verify_inputs=not args.skip_input_hashes,
    )
    if args.output:
        write_json(args.output, result)
    print(json.dumps(result, indent=2, sort_keys=True))
    raise SystemExit(0 if result["passed"] else 1)


if __name__ == "__main__":
    main()
