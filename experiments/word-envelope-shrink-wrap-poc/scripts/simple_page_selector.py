#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from word_envelope.simple_page_selector import (  # noqa: E402
    initialize_simple_selector,
    install_dual_ink_layers,
    serve_simple_selector,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Minimal select-word, press-Enter page experiment")
    subparsers = parser.add_subparsers(dest="command", required=True)
    initialize = subparsers.add_parser("init")
    initialize.add_argument("--session-dir", type=Path, required=True)
    initialize.add_argument("--page-id", required=True)
    initialize.add_argument("--source", type=Path, required=True)
    initialize.add_argument("--strong-mask", type=Path, required=True)
    initialize.add_argument(
        "--selection-mode",
        choices=("visible_ink_components", "source_color_guided"),
        default="visible_ink_components",
    )
    serve = subparsers.add_parser("serve")
    serve.add_argument("--session-dir", type=Path, required=True)
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8770)
    layers = subparsers.add_parser("install-ink-layers")
    layers.add_argument("--session-dir", type=Path, required=True)
    layers.add_argument("--clean-mask", type=Path, required=True)
    layers.add_argument("--high-recall-mask", type=Path, required=True)
    args = parser.parse_args()
    if args.command == "init":
        state = initialize_simple_selector(
            args.session_dir,
            page_id=args.page_id,
            source_path=args.source,
            strong_mask_path=args.strong_mask,
            selection_mode=args.selection_mode,
        )
        print(state["state_sha256"])
        return 0
    if args.command == "install-ink-layers":
        record = install_dual_ink_layers(
            args.session_dir,
            clean_mask_path=args.clean_mask,
            high_recall_mask_path=args.high_recall_mask,
        )
        print(record["ink_layers_sha256"])
        return 0
    serve_simple_selector(args.session_dir, host=args.host, port=args.port)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
