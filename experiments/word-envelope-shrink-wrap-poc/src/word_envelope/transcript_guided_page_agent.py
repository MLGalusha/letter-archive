"""Transcript-first semantic cursor layered over the exact simple page selector."""

from __future__ import annotations

import json
from pathlib import Path
from statistics import median
from time import perf_counter
from typing import Any, Mapping

from jsonschema import Draft202012Validator
from PIL import Image, ImageDraw, ImageFont

from .human_review_console import ConsoleError
from .io_utils import canonical_json_bytes, sha256_file
from .simple_page_agent import SimplePageAgentSession, _hash_record, _write_new


GUIDED_SESSION_VERSION = "transcript-guided-page-agent-session.v1"
GUIDED_TURN_VERSION = "transcript-guided-page-agent-turn.v1"
GUIDED_ATTEMPT_VERSION = "transcript-guided-page-agent-attempt.v1"
TRANSCRIPTION_VERSION = "simple-page-transcription-first-decision.v1"


def summarize_trace_timing(trace_dir: Path | str) -> dict[str, Any]:
    """Measure immutable packet-to-commit latency without changing the run.

    File publication times are used deliberately: older traces predate explicit
    timestamps, while every packet and attempt is append-only.  The wall-clock
    number includes agent/tool pauses; software time is reported separately.
    """

    root = Path(trace_dir).resolve()
    turns: list[tuple[int, Path, dict[str, Any]]] = []
    for turn_dir in sorted(root.glob("turn-[0-9][0-9][0-9][0-9][0-9][0-9]")):
        packet_path = turn_dir / "agent-turn.json"
        if packet_path.is_file() and not packet_path.is_symlink():
            packet = _read_object(packet_path)
            turns.append((int(packet["turn_index"]), packet_path, packet))

    starts: dict[str, tuple[int, int, dict[str, Any]]] = {}
    records: list[dict[str, Any]] = []
    for turn_index, packet_path, packet in turns:
        target = packet.get("current_target")
        if not isinstance(target, dict):
            continue
        target_id = target["target_id"]
        starts.setdefault(
            target_id,
            (turn_index, packet_path.stat().st_mtime_ns, target),
        )
        for attempt_path in sorted(packet_path.parent.glob("attempts/attempt-*.json")):
            attempt = _read_object(attempt_path)
            action = attempt.get("decision", {}).get("action", {}).get("type")
            if not attempt.get("accepted") or action != "commit_word":
                continue
            start_turn, start_ns, start_target = starts[target_id]
            action_attempts = []
            for prior_turn_index, prior_packet_path, prior_packet in turns:
                prior_target = prior_packet.get("current_target")
                if (
                    prior_turn_index < start_turn
                    or prior_turn_index > turn_index
                    or not isinstance(prior_target, dict)
                    or prior_target.get("target_id") != target_id
                ):
                    continue
                action_attempts.extend(
                    _read_object(path)
                    for path in sorted(
                        prior_packet_path.parent.glob("attempts/attempt-*.json")
                    )
                )
            end_ns = attempt_path.stat().st_mtime_ns
            records.append(
                {
                    "target_id": target_id,
                    "target_order": start_target["target_order"],
                    "reference_text": start_target["text"],
                    "start_turn": start_turn,
                    "commit_turn": turn_index,
                    "wall_ms": max(0, round((end_ns - start_ns) / 1_000_000)),
                    "action_count": len(action_attempts),
                    "rejected_action_count": sum(
                        1 for item in action_attempts if not item.get("accepted")
                    ),
                    "software_ms": sum(
                        int(item.get("elapsed_ms", 0)) for item in action_attempts
                    ),
                }
            )
            break

    wall_values = [record["wall_ms"] for record in records]
    software_values = [record["software_ms"] for record in records]
    action_values = [record["action_count"] for record in records]
    return {
        "schema_version": "transcript-guided-timing-summary.v1",
        "measurement": {
            "wall_clock": "agent-turn packet publication to accepted commit publication; includes pauses",
            "software": "sum of deterministic action execution elapsed_ms",
        },
        "committed_words": len(records),
        "average_wall_ms_per_word": (
            round(sum(wall_values) / len(wall_values)) if wall_values else None
        ),
        "median_wall_ms_per_word": round(median(wall_values)) if wall_values else None,
        "average_actions_per_word": (
            round(sum(action_values) / len(action_values), 3) if action_values else None
        ),
        "average_software_ms_per_word": (
            round(sum(software_values) / len(software_values))
            if software_values
            else None
        ),
        "total_rejected_actions": sum(
            record["rejected_action_count"] for record in records
        ),
        "words": sorted(records, key=lambda record: record["target_order"]),
    }


def _read_object(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text("utf-8"))
    if not isinstance(value, dict):
        raise ConsoleError("invalid_transcription", "The transcription must be a JSON object")
    return value


def _font(size: int) -> ImageFont.ImageFont:
    for candidate in (
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ):
        try:
            return ImageFont.truetype(candidate, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


def build_target_plan(
    transcription: Mapping[str, Any], schema: Mapping[str, Any]
) -> dict[str, Any]:
    errors = sorted(
        Draft202012Validator(schema).iter_errors(transcription),
        key=lambda error: list(error.absolute_path),
    )
    if errors:
        raise ConsoleError(
            "invalid_transcription",
            "The transcription does not match the strict first-pass schema",
        )
    lines = transcription["lines"]
    if [line["line_order"] for line in lines] != list(range(1, len(lines) + 1)):
        raise ConsoleError(
            "invalid_transcription",
            "Transcription line orders must be consecutive from one",
        )
    targets: list[dict[str, Any]] = []
    ignored_nonword_marks: list[dict[str, Any]] = []
    for line in lines:
        tokens = line["tokens"]
        if [token["token_order"] for token in tokens] != list(
            range(1, len(tokens) + 1)
        ):
            raise ConsoleError(
                "invalid_transcription",
                "Token orders must be consecutive within every line",
            )
        line_id = f"L{line['line_order']:03d}"
        line_text = " ".join(token["text"] for token in tokens)
        for index, token in enumerate(tokens):
            text = token["text"]
            if token["reading_status"] in {"readable", "uncertain"} and any(
                character.isspace() for character in text
            ):
                raise ConsoleError(
                    "invalid_transcription",
                    "A readable localization target cannot contain multiple words",
                )
            if token["reading_status"] == "nonword_mark":
                ignored_nonword_marks.append(
                    {
                        "line_id": line_id,
                        "line_order": line["line_order"],
                        "token_order": token["token_order"],
                        "text": text,
                        "disposition": "defer_to_residual_nonword_audit",
                    }
                )
                continue
            targets.append(
                {
                    "target_id": f"{line_id}-T{token['token_order']:03d}",
                    "target_order": len(targets) + 1,
                    "line_id": line_id,
                    "line_order": line["line_order"],
                    "line_kind": line["line_kind"],
                    "line_text": line_text,
                    "token_order": token["token_order"],
                    "text": text,
                    "reading_status": token["reading_status"],
                    "previous_token": tokens[index - 1]["text"] if index else None,
                    "next_token": (
                        tokens[index + 1]["text"] if index + 1 < len(tokens) else None
                    ),
                }
            )
    if not targets:
        raise ConsoleError("invalid_transcription", "The transcription has no targets")
    plan = {
        "schema_version": "transcript-guided-target-plan.v1",
        "transcription_schema_version": transcription["schema_version"],
        "line_count": len(lines),
        "target_count": len(targets),
        "targets": targets,
        "ignored_nonword_marks": ignored_nonword_marks,
    }
    plan["target_plan_sha256"] = _hash_record(plan, "target_plan_sha256")
    return plan


class TranscriptGuidedPageAgentSession:
    """Expose one transcript token and one exact base selector turn at a time."""

    def __init__(
        self,
        selector_dir: Path | str,
        trace_dir: Path | str,
        transcription_path: Path | str,
        *,
        focus_bbox_xywh: list[int] | None = None,
    ):
        self.trace_dir = Path(trace_dir).resolve()
        if self.trace_dir.exists() or self.trace_dir.is_symlink():
            raise ConsoleError("trace_exists", "The guided agent trace already exists", status=409)
        root = Path(__file__).resolve().parents[2]
        prompt_source = root / "prompts/transcript-guided-word-selector-v1.md"
        schema_source = root / "schemas/simple-page-agent-decision-v3.schema.json"
        transcription_schema_source = (
            root / "schemas/simple-page-transcription-first-decision-v1.schema.json"
        )
        transcription = _read_object(Path(transcription_path).resolve())
        transcription_schema = _read_object(transcription_schema_source)
        plan = build_target_plan(transcription, transcription_schema)

        self.trace_dir.mkdir(parents=True)
        protocol = self.trace_dir / "protocol"
        protocol.mkdir()
        _write_new(protocol / "prompt.md", prompt_source.read_bytes())
        _write_new(protocol / "response-schema.json", schema_source.read_bytes())
        _write_new(
            protocol / "target-plan.json", canonical_json_bytes(plan) + b"\n"
        )
        self.base = SimplePageAgentSession(
            selector_dir,
            self.trace_dir / "base-selector-trace",
            focus_bbox_xywh=focus_bbox_xywh,
        )
        self.plan = plan
        manifest = {
            "schema_version": GUIDED_SESSION_VERSION,
            "selector_dir": str(self.base.selector.session_dir),
            "base_trace_dir": str(self.base.trace_dir),
            "selector_manifest_sha256": self.base.selector.manifest["manifest_sha256"],
            "prompt_file_sha256": sha256_file(protocol / "prompt.md"),
            "response_schema_file_sha256": sha256_file(
                protocol / "response-schema.json"
            ),
            "target_plan_file_sha256": sha256_file(protocol / "target-plan.json"),
            "target_plan_sha256": plan["target_plan_sha256"],
        }
        manifest["session_manifest_sha256"] = _hash_record(
            manifest, "session_manifest_sha256"
        )
        _write_new(
            self.trace_dir / "session-manifest.json",
            canonical_json_bytes(manifest) + b"\n",
        )

    @classmethod
    def open(cls, trace_dir: Path | str) -> "TranscriptGuidedPageAgentSession":
        self = cls.__new__(cls)
        self.trace_dir = Path(trace_dir).resolve()
        manifest_path = self.trace_dir / "session-manifest.json"
        if not manifest_path.is_file() or manifest_path.is_symlink():
            raise ConsoleError("integrity_error", "The guided session manifest is missing")
        manifest = _read_object(manifest_path)
        if (
            manifest.get("schema_version") != GUIDED_SESSION_VERSION
            or manifest.get("session_manifest_sha256")
            != _hash_record(manifest, "session_manifest_sha256")
        ):
            raise ConsoleError("integrity_error", "The guided session manifest changed")
        protocol = self.trace_dir / "protocol"
        prompt = protocol / "prompt.md"
        response_schema = protocol / "response-schema.json"
        plan_path = protocol / "target-plan.json"
        if (
            sha256_file(prompt) != manifest["prompt_file_sha256"]
            or sha256_file(response_schema) != manifest["response_schema_file_sha256"]
            or sha256_file(plan_path) != manifest["target_plan_file_sha256"]
        ):
            raise ConsoleError("integrity_error", "The guided protocol snapshot changed")
        self.plan = _read_object(plan_path)
        if self.plan.get("target_plan_sha256") != _hash_record(
            self.plan, "target_plan_sha256"
        ) or self.plan.get("target_plan_sha256") != manifest.get("target_plan_sha256"):
            raise ConsoleError("integrity_error", "The guided target plan changed")
        self.base = SimplePageAgentSession.open(manifest["base_trace_dir"])
        if (
            str(self.base.selector.session_dir) != manifest["selector_dir"]
            or self.base.selector.manifest["manifest_sha256"]
            != manifest["selector_manifest_sha256"]
        ):
            raise ConsoleError("integrity_error", "The guided selector binding changed")
        return self

    def _target(self, committed: int) -> dict[str, Any] | None:
        targets = self.plan["targets"]
        return dict(targets[committed]) if committed < len(targets) else None

    def _turn_dir(self, turn_index: int) -> Path:
        return self.trace_dir / f"turn-{turn_index:06d}"

    def _render_collage(
        self, base_turn: Mapping[str, Any], target: Mapping[str, Any] | None, path: Path
    ) -> dict[str, Any]:
        base_path = (
            self.base.trace_dir
            / f"turn-{base_turn['turn_index']:06d}"
            / base_turn["collage"]["path"]
        )
        # The target already lives in the hash-bound public packet.  A hard link
        # gives the guided turn its own stable evidence path without storing a
        # second multi-megabyte copy of the same collage on every action.
        path.hardlink_to(base_path)
        result = dict(base_turn["collage"])
        result.update(
            {
                "path": str(path.relative_to(self.trace_dir)),
                "file_sha256": sha256_file(path),
                "size_wh": list(base_turn["collage"]["size_wh"]),
                "base_collage_file_sha256": base_turn["collage"]["file_sha256"],
                "target_banner_height_px": 0,
                "target_display": "hash_bound_current_target_packet_field",
            }
        )
        return result

    def current(self) -> dict[str, Any]:
        base_turn = self.base.current()
        committed = int(base_turn["progress"]["words_committed"])
        target = self._target(committed)
        turn_dir = self._turn_dir(base_turn["turn_index"])
        packet_path = turn_dir / "agent-turn.json"
        if packet_path.exists():
            packet = _read_object(packet_path)
            if packet.get("guided_turn_sha256") != _hash_record(
                packet, "guided_turn_sha256"
            ):
                raise ConsoleError("integrity_error", "The guided turn changed")
            return packet
        turn_dir.mkdir(exist_ok=True)
        collage = self._render_collage(
            base_turn,
            target,
            turn_dir / base_turn["collage"]["path"],
        )
        packet: dict[str, Any] = {
            "schema_version": GUIDED_TURN_VERSION,
            "turn_index": base_turn["turn_index"],
            "content_order": ["prompt", "public_packet", "response_schema", "collage"],
            "prompt": {
                "path": "../protocol/prompt.md",
                "file_sha256": sha256_file(self.trace_dir / "protocol/prompt.md"),
            },
            "response_schema": {
                "path": "../protocol/response-schema.json",
                "file_sha256": sha256_file(
                    self.trace_dir / "protocol/response-schema.json"
                ),
            },
            "base_agent_turn_sha256": base_turn["agent_turn_sha256"],
            "collage": collage,
            "current_target": target,
            "target_queue": {
                "status": "active" if target is not None else "complete",
                "total": self.plan["target_count"],
                "committed": committed,
                "remaining": max(0, self.plan["target_count"] - committed),
            },
            "legal_actions": base_turn["legal_actions"] if target is not None else [],
            "current_draft": base_turn["current_draft"],
            "progress": base_turn["progress"],
            "previous_software_result": base_turn["previous_software_result"],
        }
        packet["guided_turn_sha256"] = _hash_record(packet, "guided_turn_sha256")
        _write_new(packet_path, canonical_json_bytes(packet) + b"\n")
        return packet

    def apply(self, envelope: Mapping[str, Any]) -> dict[str, Any]:
        started = perf_counter()
        if not isinstance(envelope, Mapping) or set(envelope) != {
            "guided_turn_sha256",
            "decision",
        }:
            raise ConsoleError(
                "invalid_guided_action",
                "The guided action needs the current turn hash and one decision",
            )
        current = self.current()
        if envelope["guided_turn_sha256"] != current["guided_turn_sha256"]:
            raise ConsoleError("stale_guided_turn", "The target or collage is stale", status=409)
        if current["current_target"] is None:
            raise ConsoleError("target_queue_complete", "Every transcript target is committed")
        turn_dir = self._turn_dir(current["turn_index"])
        attempts = sorted((turn_dir / "attempts").glob("attempt-*.json"))
        attempt_number = len(attempts) + 1
        try:
            next_base = self.base.apply(
                {
                    "agent_turn_sha256": current["base_agent_turn_sha256"],
                    "decision": envelope["decision"],
                }
            )
            accepted = True
            outcome = {
                "base_agent_turn_sha256": next_base["agent_turn_sha256"],
                "words_committed": next_base["progress"]["words_committed"],
                "action": envelope["decision"]["action"]["type"],
            }
        except ConsoleError as error:
            accepted = False
            outcome = {"error_code": error.code, "message": error.message}
            raise
        finally:
            attempt = {
                "schema_version": GUIDED_ATTEMPT_VERSION,
                "guided_turn_sha256": current["guided_turn_sha256"],
                "current_target_id": current["current_target"]["target_id"],
                "decision": envelope["decision"],
                "accepted": accepted,
                "elapsed_ms": round((perf_counter() - started) * 1000),
                "software_outcome": outcome,
            }
            attempt["attempt_sha256"] = _hash_record(attempt, "attempt_sha256")
            _write_new(
                turn_dir / "attempts" / f"attempt-{attempt_number:03d}.json",
                canonical_json_bytes(attempt) + b"\n",
            )
        return self.current()

    def apply_current_decision(self, decision: Mapping[str, Any]) -> dict[str, Any]:
        """Bind a model's compact decision to the current immutable packet.

        The dispatcher owns the turn hash. The acting model should only have to
        choose one schema-valid decision, not reconstruct transport metadata.
        `apply` still performs the authoritative stale-turn check under the
        normal session/selector locks.
        """

        current = self.current()
        return self.apply(
            {
                "guided_turn_sha256": current["guided_turn_sha256"],
                "decision": decision,
            }
        )
