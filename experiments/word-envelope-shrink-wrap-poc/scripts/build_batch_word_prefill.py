#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from word_envelope.batch_word_prefill import (  # noqa: E402
    build_batch_word_prefill,
    build_line_batch_packets,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Build a noncommitting batch word prefill")
    parser.add_argument("--selector-dir", type=Path, required=True)
    parser.add_argument("--proposal-record", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--line-packets", action="store_true")
    args = parser.parse_args()
    builder = build_line_batch_packets if args.line_packets else build_batch_word_prefill
    result = builder(args.selector_dir, args.proposal_record, args.output_dir)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
