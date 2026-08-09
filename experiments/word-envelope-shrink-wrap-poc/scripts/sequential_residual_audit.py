#!/usr/bin/env python3
"""CLI entry point for the isolated deterministic residual audit."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from word_envelope.sequential_residual_audit import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
