#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from word_envelope.simple_page_agent import SimplePageAgentSession  # noqa: E402


def _show(turn: dict) -> None:
    print(
        json.dumps(
            {
                "agent_turn_sha256": turn["agent_turn_sha256"],
                "turn_index": turn["turn_index"],
                "legal_actions": turn["legal_actions"],
                "collage": turn["collage"],
                "current_draft": turn["current_draft"],
                "progress": turn["progress"],
                "previous_software_result": turn["previous_software_result"],
            },
            indent=2,
            sort_keys=True,
        )
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Transparent one-action simple-page agent session"
    )
    commands = parser.add_subparsers(dest="command", required=True)
    initialize = commands.add_parser("init")
    initialize.add_argument("--selector-dir", type=Path, required=True)
    initialize.add_argument("--trace-dir", type=Path, required=True)
    current = commands.add_parser("next")
    current.add_argument("--trace-dir", type=Path, required=True)
    apply = commands.add_parser("apply")
    apply.add_argument("--trace-dir", type=Path, required=True)
    apply.add_argument("--action-file", type=Path, required=True)
    args = parser.parse_args()
    if args.command == "init":
        session = SimplePageAgentSession(args.selector_dir, args.trace_dir)
    else:
        session = SimplePageAgentSession.open(args.trace_dir)
    if args.command == "apply":
        envelope = json.loads(args.action_file.read_text("utf-8"))
        turn = session.apply(envelope)
    else:
        turn = session.current()
    _show(turn)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
