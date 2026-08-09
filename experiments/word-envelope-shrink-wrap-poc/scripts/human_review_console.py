#!/usr/bin/env python3
"""Launch the local human review console."""

from __future__ import annotations

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from word_envelope.human_review_console import main  # noqa: E402


if __name__ == "__main__":
    raise SystemExit(main())
