#!/usr/bin/env python3
"""CLI entry point for the isolated sequential ownership supervisor."""

from __future__ import annotations

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from word_envelope.sequential_ownership import main  # noqa: E402


if __name__ == "__main__":
    raise SystemExit(main())
