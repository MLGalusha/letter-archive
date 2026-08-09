#!/usr/bin/env python3
"""Run a fresh, read-only model context against one public work packet.

The actor receives only the packet JSON and its allowlisted evidence directory.
It has a read-only image/file tool, no shell, no parent-directory task, and no
sealed evaluation inputs.  The resulting compact action is persisted but not
applied; the caller validates and applies it separately.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import time
from typing import Any

from word_envelope.io_utils import canonical_json_bytes, sha256_file


def read(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def schema() -> dict[str, Any]:
    action_common = {
        "confidence": {"enum": ["high", "medium", "low"]},
        "reason_codes": {"type": "array", "items": {"type": "string"}},
    }
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["schema_version", "work_packet_sha256", "action"],
        "properties": {
            "schema_version": {"type": "string"},
            "work_packet_sha256": {"type": "string"},
            "action": {
                "oneOf": [
                    {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["type", "component_ids", "confidence", "reason_codes"],
                        "properties": {
                            "type": {"const": "claim_select"},
                            "component_ids": {"type": "array", "minItems": 1, "items": {"type": "integer"}},
                            **action_common,
                        },
                    },
                    {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["type", "component_ids", "confidence", "reason_codes"],
                        "properties": {
                            "type": {"const": "exclude"},
                            "component_ids": {"type": "array", "minItems": 1, "items": {"type": "integer"}},
                            **action_common,
                        },
                    },
                    {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["type", "request", "confidence", "reason_codes"],
                        "properties": {
                            "type": {"const": "request_expanded_context"},
                            "request": {
                                "type": "object",
                                "additionalProperties": False,
                                "required": ["kind", "sides", "margin_px", "focus_component_ids", "why"],
                                "properties": {
                                    "kind": {"enum": ["crop_margin", "source_resolution", "line_context"]},
                                    "sides": {"type": "array", "minItems": 1, "items": {"enum": ["left", "right", "top", "bottom"]}},
                                    "margin_px": {"type": "integer", "minimum": 16, "maximum": 512},
                                    "focus_component_ids": {"type": "array", "items": {"type": "integer"}},
                                    "why": {"enum": ["border_contact", "ambiguous_neighbor", "detached_mark", "low_resolution", "uncertain_reading"]},
                                },
                            },
                            **action_common,
                        },
                    },
                    {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["type", "bbox_source_xywh", "confidence", "reason_codes"],
                        "properties": {
                            "type": {"const": "reopen_bbox"},
                            "bbox_source_xywh": {"type": "array", "minItems": 4, "maxItems": 4, "items": {"type": "integer"}},
                            **action_common,
                        },
                    },
                    {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["type", "target", "reason"],
                        "properties": {
                            "type": {"const": "defer_tier"},
                            "target": {"const": "sol"},
                            "reason": {"type": "string"},
                        },
                    },
                    {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["type", "disposition", "confidence", "reason_codes"],
                        "properties": {
                            "type": {"const": "defer_manual"},
                            "disposition": {
                                "enum": [
                                    "ambiguous_ownership",
                                    "ambiguous_detached_mark",
                                    "clipped_target",
                                    "touching_or_overwritten_ink",
                                    "insufficient_visual_evidence",
                                    "unsafe_cut",
                                ]
                            },
                            **action_common,
                        },
                    },
                ]
            },
        },
    }


def prompt(packet: dict[str, Any]) -> str:
    current = packet["current"]
    evidence_names = [
        "decision-collage.jpg",
        "work-crop.jpg",
        "clean-ink-selection-crop.png",
        "ink-selection-crop.png",
        "numbered-components.jpg",
        "upright-numbered-components.jpg",
    ]
    return f"""You are the acting word-ink ownership reviewer for exactly one frozen public packet.

Read ONLY `work-packet.json` and these evidence files in the current directory: {', '.join(evidence_names)}. Do not inspect parent directories, search the filesystem, or use any information outside this packet. No human answer or evaluation is available to you.

Target unit: {current['unit_id']}
Tentative reading (navigation hint, not ownership truth): {current['tentative_text']!r}
Active target bbox: {current['active_target_bbox_source_xywh']}

Inspect the original crop, Clean Ink, High Recall selectable ink, numbered components, line context, prior-owned overlay, and the software fragment guidance in `work-packet.json`. Decide exactly one legal compact action from the packet. Select all and only connected components belonging to one complete semantic word; disconnected pieces are allowed. Do not absorb a neighbor just to satisfy the tentative text. If a component contains inseparable ink from two words, do not claim it without a legal cut path; defer tier/manual when required. If the locator is wrong or clipped, reopen it. If evidence is insufficient, request context. Return only the structured compact action envelope bound to work packet SHA-256 {packet['work_packet_sha256']} with schema version sequential-full-page-ownership-compact-action.v1."""


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--packet", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--model", default="opus")
    parser.add_argument("--effort", default="high", choices=["low", "medium", "high", "max"])
    args = parser.parse_args()
    packet_path = args.packet.resolve()
    if args.output_dir.exists():
        raise SystemExit("Output exists; refusing overwrite")
    args.output_dir.mkdir(parents=True)
    packet = read(packet_path)
    packet_dir = packet_path.parent
    for evidence in packet["evidence"].values():
        path = packet_dir / Path(evidence["path"]).name
        if not path.is_file():
            raise RuntimeError(f"Public packet evidence is missing: {path.name}")
    prompt_text = prompt(packet)
    command = [
        "claude",
        "--print",
        "--model",
        args.model,
        "--effort",
        args.effort,
        "--tools",
        "Read",
        "--permission-mode",
        "dontAsk",
        "--disable-slash-commands",
        "--no-session-persistence",
        "--output-format",
        "json",
        "--json-schema",
        json.dumps(schema(), separators=(",", ":")),
        "--append-system-prompt",
        "This is a sealed-evidence experiment. Never inspect parent directories or any file not explicitly allowlisted in the user prompt. Do not use prior conversations or memory. Analyze only the current public packet.",
        prompt_text,
    ]
    started_at = datetime.now(timezone.utc).isoformat()
    started = time.perf_counter()
    completed = subprocess.run(
        command,
        cwd=packet_dir,
        capture_output=True,
        text=True,
        timeout=600,
        check=False,
    )
    elapsed_ms = round((time.perf_counter() - started) * 1000.0, 3)
    if completed.returncode != 0:
        failure = {
            "returncode": completed.returncode,
            "stderr": completed.stderr,
            "stdout": completed.stdout,
            "elapsed_ms": elapsed_ms,
        }
        (args.output_dir / "failed-call.json").write_bytes(canonical_json_bytes(failure) + b"\n")
        raise SystemExit(f"Actor failed with exit code {completed.returncode}")
    response = json.loads(completed.stdout)
    action = response.get("structured_output")
    if not isinstance(action, dict):
        result = response.get("result")
        if isinstance(result, str):
            try:
                action = json.loads(result)
            except json.JSONDecodeError:
                action = None
    if not isinstance(action, dict):
        raise RuntimeError("Actor response did not contain structured output")
    if action.get("work_packet_sha256") != packet["work_packet_sha256"]:
        raise RuntimeError("Actor response is not bound to the current work packet")
    call_record = {
        "schema_version": "isolated-sequential-actor-call.v1",
        "started_at": started_at,
        "elapsed_ms": elapsed_ms,
        "model": args.model,
        "effort": args.effort,
        "packet": {
            "path": str(packet_path),
            "file_sha256": sha256_file(packet_path),
            "work_packet_sha256": packet["work_packet_sha256"],
            "unit_id": packet["current"]["unit_id"],
            "revision": packet["revision"],
        },
        "prompt_sha256": hashlib.sha256(prompt_text.encode("utf-8")).hexdigest(),
        "filesystem_policy": "read_tool_only_current_allowlisted_packet_files_no_parent_search",
        "sealed_evaluation_visible": False,
        "response_metadata": {
            key: value for key, value in response.items()
            if key not in {"result", "structured_output"}
        },
        "action": action,
    }
    call_record["call_sha256"] = hashlib.sha256(canonical_json_bytes(call_record)).hexdigest()
    (args.output_dir / "decision.json").write_bytes(canonical_json_bytes(action) + b"\n")
    (args.output_dir / "model-call.json").write_bytes(canonical_json_bytes(call_record) + b"\n")
    print(json.dumps({"output": str(args.output_dir), "elapsed_ms": elapsed_ms, "action": action, "call_sha256": call_record["call_sha256"]}, indent=2))


if __name__ == "__main__":
    main()
