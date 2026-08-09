#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from word_envelope.batch_word_prefill import validate_line_batch_decision  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate one line-batch seed decision")
    parser.add_argument("--selector-dir", type=Path, required=True)
    parser.add_argument("--packet", type=Path, required=True)
    parser.add_argument("--decision", type=Path, required=True)
    args = parser.parse_args()
    result = validate_line_batch_decision(args.selector_dir, args.packet, args.decision)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
