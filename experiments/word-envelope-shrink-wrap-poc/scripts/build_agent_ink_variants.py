#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from word_envelope.ink_variants import build_high_recall_union  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Build bound clean/strong agent ink views")
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--clean-mask", type=Path, required=True)
    parser.add_argument("--possible-ink-mask", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--research-reference", required=True)
    args = parser.parse_args()
    manifest = build_high_recall_union(
        source_path=args.source,
        clean_mask_path=args.clean_mask,
        possible_ink_mask_path=args.possible_ink_mask,
        output_dir=args.output_dir,
        research_reference=args.research_reference,
    )
    print(manifest["manifest_sha256"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
