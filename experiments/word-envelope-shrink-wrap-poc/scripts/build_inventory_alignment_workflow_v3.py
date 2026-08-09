#!/usr/bin/env python3
"""Initialize or advance the public inventory/alignment workflow v3."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from inventory_alignment_protocol_v3 import (
    PAGE_SPECS_V3,
    ProtocolV3Error,
    apply_decision_files_v3,
    initialize_builtin_workflow_v3,
)


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Build lossless Stage A packets and advance valid two-turn v3 decisions. "
            "Initialization emits no Stage B proposal/text evidence."
        )
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    initialize = subparsers.add_parser("init")
    initialize.add_argument("page_id", choices=sorted(PAGE_SPECS_V3))
    initialize.add_argument("--output-dir", type=Path, required=True)

    apply = subparsers.add_parser("apply")
    apply.add_argument("--workflow-root", type=Path, required=True)
    apply.add_argument("--state", type=Path, required=True)
    apply.add_argument("--packet", type=Path, required=True)
    apply.add_argument("--decision", type=Path, required=True)

    args = parser.parse_args()
    try:
        if args.command == "init":
            result = initialize_builtin_workflow_v3(args.page_id, args.output_dir)
            summary = {
                "status": "initialized",
                "page_id": args.page_id,
                "state_path": str(result["state_path"]),
                "current_packet_path": str(result["packet_path"]),
                "current_stage": result["state"]["current_stage"],
                "state_revision": result["state"]["state_revision"],
                "notice": "Only public Stage A was emitted; transcript and detector regions remain private.",
            }
        else:
            result = apply_decision_files_v3(
                args.state,
                args.packet,
                args.decision,
                args.workflow_root,
            )
            summary = {
                "status": "applied",
                "validation_sha256": result["validation"]["validation_sha256"],
                "state_path": str(result["state_path"]),
                "state_revision": result["state"]["state_revision"],
                "current_stage": result["state"]["current_stage"],
                "next_packet_path": (
                    None
                    if result["next_packet_path"] is None
                    else str(result["next_packet_path"])
                ),
            }
    except ProtocolV3Error as error:
        parser.error(str(error))
        return
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
