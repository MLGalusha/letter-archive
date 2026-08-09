#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from word_envelope.batch_word_prefill import build_region_fill_knockout  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--selector-dir", type=Path, required=True)
    parser.add_argument("--line-session", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    result = build_region_fill_knockout(
        args.selector_dir, args.line_session, args.output_dir
    )
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
