#!/usr/bin/env python3
"""Validate an acting packet without opening any sealed evaluation directory."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from word_envelope.acting_packet_boundary import validate_packet_dir
from word_envelope.io_utils import canonical_json_bytes


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("packet_dir", type=Path)
    parser.add_argument("--run-root", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    record = validate_packet_dir(args.packet_dir, run_root=args.run_root)
    if args.output is not None:
        if args.output.exists():
            raise SystemExit("Output exists; refusing overwrite")
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_bytes(canonical_json_bytes(record) + b"\n")
    print(json.dumps(record, indent=2))
    raise SystemExit(0 if record["passed"] else 1)


if __name__ == "__main__":
    main()
