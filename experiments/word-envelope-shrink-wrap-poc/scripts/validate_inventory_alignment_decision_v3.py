#!/usr/bin/env python3
"""Read-only validator for one current v3 inventory/alignment decision."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from inventory_alignment_protocol_v3 import ProtocolV3Error, validate_decision_files_v3


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--packet", type=Path, required=True)
    parser.add_argument("--decision", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        result = validate_decision_files_v3(
            args.state, args.packet, args.decision
        )
    except ProtocolV3Error as error:
        parser.error(str(error))
        return
    if args.output is not None:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
