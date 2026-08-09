#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from word_envelope.transcript_guided_page_agent import (  # noqa: E402
    TranscriptGuidedPageAgentSession,
    summarize_trace_timing,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Transcript-guided exact word selector")
    commands = parser.add_subparsers(dest="command", required=True)
    initialize = commands.add_parser("init")
    initialize.add_argument("--selector-dir", type=Path, required=True)
    initialize.add_argument("--trace-dir", type=Path, required=True)
    initialize.add_argument("--transcription", type=Path, required=True)
    current = commands.add_parser("next")
    current.add_argument("--trace-dir", type=Path, required=True)
    apply = commands.add_parser("apply")
    apply.add_argument("--trace-dir", type=Path, required=True)
    apply.add_argument("--action-file", type=Path, required=True)
    act = commands.add_parser("act")
    act.add_argument("--trace-dir", type=Path, required=True)
    act.add_argument(
        "--decision-file",
        type=Path,
        required=True,
        help="Bare schema-valid decision; software injects the current turn binding",
    )
    timing = commands.add_parser("timing")
    timing.add_argument("--trace-dir", type=Path, required=True)
    args = parser.parse_args()
    if args.command == "timing":
        print(json.dumps(summarize_trace_timing(args.trace_dir), indent=2, sort_keys=True))
        return 0
    if args.command == "init":
        session = TranscriptGuidedPageAgentSession(
            args.selector_dir, args.trace_dir, args.transcription
        )
    else:
        session = TranscriptGuidedPageAgentSession.open(args.trace_dir)
    if args.command == "apply":
        packet = session.apply(json.loads(args.action_file.read_text("utf-8")))
    elif args.command == "act":
        packet = session.apply_current_decision(
            json.loads(args.decision_file.read_text("utf-8"))
        )
    else:
        packet = session.current()
    print(json.dumps(packet, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
