"""Transparent one-action-at-a-time agent wrapper for the simple page selector."""

from __future__ import annotations

import base64
from io import BytesIO
import json
from pathlib import Path
from time import perf_counter
from typing import Any, Mapping

from jsonschema import Draft202012Validator
from PIL import Image, ImageDraw

from .human_review_console import ConsoleError
from .io_utils import canonical_json_bytes, sha256_file
from .simple_page_selector import SimplePageSelector


DECISION_SCHEMA_VERSION = "simple-page-agent-decision.v3"
TURN_SCHEMA_VERSION = "simple-page-agent-turn.v3"


def _hash_record(value: Mapping[str, Any], key: str) -> str:
    import hashlib

    basis = dict(value)
    basis.pop(key, None)
    return hashlib.sha256(canonical_json_bytes(basis)).hexdigest()


def _write_new(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as handle:
        handle.write(data)


class SimplePageAgentSession:
    """Keep the model's draft and exact selector preview cache in one process."""

    def __init__(
        self,
        selector_dir: Path | str,
        trace_dir: Path | str,
        *,
        focus_bbox_xywh: list[int] | None = None,
    ):
        self.selector = SimplePageSelector(selector_dir)
        self.focus_bbox_xywh = self._validated_focus(focus_bbox_xywh)
        self.trace_dir = Path(trace_dir).resolve()
        if self.trace_dir.exists() or self.trace_dir.is_symlink():
            raise ConsoleError(
                "trace_exists",
                "The transparent agent trace already exists",
                status=409,
            )
        root = Path(__file__).resolve().parents[2]
        prompt_source = root / "prompts/simple-page-word-selector-v3.md"
        schema_source = root / "schemas/simple-page-agent-decision-v3.schema.json"
        self.prompt = prompt_source.read_bytes()
        self.schema_bytes = schema_source.read_bytes()
        self.schema = json.loads(self.schema_bytes)
        Draft202012Validator.check_schema(self.schema)
        self.validator = Draft202012Validator(self.schema)
        # Photographic page context makes PNG turn evidence several megabytes per
        # action. High-quality 4:4:4 JPEG preserves the visible selection evidence
        # while keeping an append-only full-page run bounded on disk.
        self.collage_filename = "collage.jpg"
        self.trace_dir.mkdir(parents=True)
        protocol = self.trace_dir / "protocol"
        protocol.mkdir()
        _write_new(protocol / "prompt.md", self.prompt)
        _write_new(protocol / "response-schema.json", self.schema_bytes)
        manifest = {
            "schema_version": "simple-page-agent-session.v3",
            "selector_dir": str(self.selector.session_dir),
            "selector_manifest_sha256": self.selector.manifest[
                "manifest_sha256"
            ],
            "prompt_file_sha256": sha256_file(protocol / "prompt.md"),
            "response_schema_file_sha256": sha256_file(
                protocol / "response-schema.json"
            ),
            "focus_bbox_xywh": self.focus_bbox_xywh,
            "collage_filename": self.collage_filename,
        }
        manifest["session_manifest_sha256"] = _hash_record(
            manifest,
            "session_manifest_sha256",
        )
        _write_new(
            self.trace_dir / "session-manifest.json",
            canonical_json_bytes(manifest) + b"\n",
        )
        self.rectangles: list[list[int]] = []
        self.deselect_rectangles: list[list[int]] = []
        self.preview_rectangles: list[list[int]] = []
        self.preview_deselect_rectangles: list[list[int]] = []
        self.ink_variant = "clean"
        self.selection: dict[str, Any] | None = None
        self.recovery: dict[str, Any] | None = None
        self.turn_index = 0
        self._current: dict[str, Any] | None = None
        self._attempt_count = 0
        self._publish_turn(previous_result=None)

    @classmethod
    def open(cls, trace_dir: Path | str) -> "SimplePageAgentSession":
        """Resume the exact current turn and reconstruct its ephemeral preview."""

        self = cls.__new__(cls)
        self.trace_dir = Path(trace_dir).resolve()
        manifest_path = self.trace_dir / "session-manifest.json"
        if (
            not manifest_path.is_file()
            or manifest_path.is_symlink()
            or self.trace_dir not in manifest_path.resolve().parents
        ):
            raise ConsoleError(
                "integrity_error",
                "The transparent agent session manifest is missing or unsafe",
                status=500,
            )
        manifest = json.loads(manifest_path.read_text("utf-8"))
        if (
            not isinstance(manifest, dict)
            or manifest.get("schema_version") != "simple-page-agent-session.v3"
            or manifest.get("session_manifest_sha256")
            != _hash_record(manifest, "session_manifest_sha256")
        ):
            raise ConsoleError(
                "integrity_error",
                "The transparent agent session manifest changed",
                status=500,
            )
        self.selector = SimplePageSelector(str(manifest.get("selector_dir")))
        self.collage_filename = str(manifest.get("collage_filename", "collage.png"))
        if self.collage_filename not in {"collage.png", "collage.jpg"}:
            raise ConsoleError(
                "integrity_error",
                "The transparent agent collage format is unsupported",
                status=500,
            )
        self.focus_bbox_xywh = self._validated_focus(
            manifest.get("focus_bbox_xywh")
        )
        if (
            self.selector.manifest.get("manifest_sha256")
            != manifest.get("selector_manifest_sha256")
        ):
            raise ConsoleError(
                "integrity_error",
                "The selector binding changed before agent resume",
                status=500,
            )
        prompt_path = self.trace_dir / "protocol/prompt.md"
        schema_path = self.trace_dir / "protocol/response-schema.json"
        if (
            prompt_path.is_symlink()
            or schema_path.is_symlink()
            or sha256_file(prompt_path) != manifest.get("prompt_file_sha256")
            or sha256_file(schema_path)
            != manifest.get("response_schema_file_sha256")
        ):
            raise ConsoleError(
                "integrity_error",
                "The agent protocol snapshot changed before resume",
                status=500,
            )
        self.prompt = prompt_path.read_bytes()
        self.schema_bytes = schema_path.read_bytes()
        self.schema = json.loads(self.schema_bytes)
        Draft202012Validator.check_schema(self.schema)
        self.validator = Draft202012Validator(self.schema)
        turn_dirs = sorted(self.trace_dir.glob("turn-[0-9][0-9][0-9][0-9][0-9][0-9]"))
        if not turn_dirs:
            raise ConsoleError(
                "integrity_error",
                "The transparent agent session has no current turn",
                status=500,
            )
        for candidate in turn_dirs:
            if candidate.is_symlink() or candidate.resolve().parent != self.trace_dir:
                raise ConsoleError(
                    "integrity_error",
                    "A transparent agent turn directory is unsafe",
                    status=500,
                )
        expected_indices = list(range(1, len(turn_dirs) + 1))
        actual_indices = [
            int(candidate.name.rsplit("-", 1)[1]) for candidate in turn_dirs
        ]
        if actual_indices != expected_indices:
            raise ConsoleError(
                "integrity_error",
                "The transparent agent turn sequence is incomplete",
                status=500,
            )
        turn_dir = turn_dirs[-1]
        turn_path = turn_dir / "agent-turn.json"
        if not turn_path.is_file() or turn_path.is_symlink():
            raise ConsoleError(
                "integrity_error",
                "The current transparent agent turn is missing",
                status=500,
            )
        packet = json.loads(turn_path.read_text("utf-8"))
        if (
            not isinstance(packet, dict)
            or packet.get("schema_version") != TURN_SCHEMA_VERSION
            or packet.get("agent_turn_sha256")
            != _hash_record(packet, "agent_turn_sha256")
            or packet.get("turn_index") != int(turn_dir.name.rsplit("-", 1)[1])
        ):
            raise ConsoleError(
                "integrity_error",
                "The current transparent agent turn changed",
                status=500,
            )
        collage_record = packet.get("collage", {})
        if (
            not isinstance(collage_record, dict)
            or collage_record.get("path") != self.collage_filename
        ):
            raise ConsoleError(
                "integrity_error",
                "The current agent collage reference is invalid",
                status=500,
            )
        collage_path = turn_dir / self.collage_filename
        if (
            collage_path.resolve().parent != turn_dir
            or collage_path.is_symlink()
            or sha256_file(collage_path)
            != collage_record.get("file_sha256")
        ):
            raise ConsoleError(
                "integrity_error",
                "The current agent collage changed before resume",
                status=500,
            )
        selector_state = self.selector.bootstrap()["state"]
        binding = packet.get("selector_binding", {})
        if (
            binding.get("page_id") != selector_state["page_id"]
            or binding.get("revision") != selector_state["revision"]
            or binding.get("state_sha256") != selector_state["state_sha256"]
        ):
            raise ConsoleError(
                "stale_agent_session",
                "The selector advanced outside this transparent agent session",
                status=409,
            )
        self.turn_index = int(packet["turn_index"])
        self._current = packet
        self._attempt_count = len(list((turn_dir / "attempts").glob("attempt-*.json")))
        draft = packet["current_draft"]
        self.ink_variant = str(draft["ink_variant"])
        self.preview_rectangles = [list(value) for value in draft["rectangles"]]
        self.preview_deselect_rectangles = [
            list(value) for value in draft["deselect_rectangles"]
        ]
        self.rectangles = [
            self._source_rectangle(value) for value in self.preview_rectangles
        ]
        self.deselect_rectangles = [
            self._source_rectangle(value)
            for value in self.preview_deselect_rectangles
        ]
        self.selection = None
        self.recovery = None
        recovery_packet = draft.get("recovery")
        if recovery_packet is not None:
            anchor = recovery_packet["anchor_draft"]
            anchor_selection = self.selector.preview_selection(
                {
                    "base_state_sha256": selector_state["state_sha256"],
                    "ink_variant": anchor["ink_variant"],
                    "rectangles": [
                        self._source_rectangle(value)
                        for value in anchor["rectangles"]
                    ],
                    "deselect_rectangles": [
                        self._source_rectangle(value)
                        for value in anchor["deselect_rectangles"]
                    ],
                }
            )
            recovery = self.selector.preview_recovery(
                {
                    "base_state_sha256": selector_state["state_sha256"],
                    "selection_preview_sha256": anchor_selection[
                        "selection_preview_sha256"
                    ],
                }
            )
            recovery["anchor_draft"] = anchor
            self.recovery = recovery
            active_profile = recovery_packet["active_profile"]
            if active_profile != "conservative":
                chosen = self.selector.choose_recovery(
                    {
                        "base_state_sha256": selector_state["state_sha256"],
                        "recovery_set_sha256": recovery["recovery_set_sha256"],
                        "profile": active_profile,
                    }
                )
                self.recovery["surface"] = chosen["surface"]
            self.recovery["active_profile"] = active_profile
        if int(draft["selected_pixels"]) > 0:
            selection_payload = {
                "base_state_sha256": selector_state["state_sha256"],
                "ink_variant": self.ink_variant,
                "rectangles": self.rectangles,
                "deselect_rectangles": self.deselect_rectangles,
            }
            if self.recovery is not None:
                selection_payload.update(
                    {
                        "recovery_set_sha256": self.recovery[
                            "recovery_set_sha256"
                        ],
                        "recovery_profile": self.recovery["active_profile"],
                    }
                )
            self.selection = self.selector.preview_selection(selection_payload)
            if (
                self.selection is None
                or self.selection["selected_pixels"] != draft["selected_pixels"]
                or self.selection["selection_preview_sha256"]
                != draft["selection_preview_sha256"]
            ):
                raise ConsoleError(
                    "integrity_error",
                    "The exact green draft could not be reconstructed",
                    status=500,
                )
        elif draft["selection_preview_sha256"] is not None:
            raise ConsoleError(
                "integrity_error",
                "An empty green draft cannot have a commit receipt",
                status=500,
            )
        expected_collage_contract = {
            "size_wh": [self.preview_wh[0] * 2 + 14, self.preview_wh[1] + 84],
            "ink_panel_content_bboxes_xywh": {
                "clean": [self.preview_wh[0] + 14, 40, *self.preview_wh],
            },
            "action_coordinate_space": {
                "origin": "clean_ink_panel_content_top_left",
                "size_wh": list(self.preview_wh),
                "units": "integer_preview_pixels",
            },
        }
        if self.focus_bbox_xywh is not None:
            expected_collage_contract["focus_locator"] = self._focus_locator_record()
        if (
            packet.get("content_order")
            != ["prompt", "public_packet", "response_schema", "collage"]
            or packet.get("prompt")
            != {
                "path": "../protocol/prompt.md",
                "file_sha256": manifest["prompt_file_sha256"],
                "status": "verified_for_this_agent_session",
            }
            or packet.get("response_schema")
            != {
                "path": "../protocol/response-schema.json",
                "file_sha256": manifest["response_schema_file_sha256"],
            }
            or any(
                collage_record.get(key) != value
                for key, value in expected_collage_contract.items()
            )
            or packet.get("legal_actions") != self._legal_actions()
            or packet.get("progress")
            != {
                "words_committed": selector_state["word_count"],
                "claimed_pixels": selector_state["claimed_pixels"],
            }
        ):
            raise ConsoleError(
                "integrity_error",
                "The current agent turn contract changed before resume",
                status=500,
            )
        return self

    @property
    def preview_wh(self) -> tuple[int, int]:
        return self.selector.preview_wh

    def _validated_focus(self, value: Any) -> list[int] | None:
        if value is None:
            return None
        if (
            not isinstance(value, list)
            or len(value) != 4
            or any(not isinstance(item, int) or isinstance(item, bool) for item in value)
        ):
            raise ConsoleError("invalid_focus", "The word locator must be [x, y, width, height]")
        x, y, width, height = value
        source_width, source_height = self.selector.size_wh
        if (
            x < 0
            or y < 0
            or width < 1
            or height < 1
            or x + width > source_width
            or y + height > source_height
        ):
            raise ConsoleError("invalid_focus", "The word locator falls outside the crop")
        return list(value)

    def _focus_locator_record(self) -> dict[str, Any]:
        if self.focus_bbox_xywh is None:
            raise RuntimeError("No focus locator is active")
        source_width, source_height = self.selector.size_wh
        preview_width, preview_height = self.preview_wh
        x, y, width, height = self.focus_bbox_xywh
        x0 = int(x * preview_width // source_width)
        y0 = int(y * preview_height // source_height)
        x1 = int(-(-(x + width) * preview_width // source_width))
        y1 = int(-(-(y + height) * preview_height // source_height))
        return {
            "bbox_xywh": [x0, y0, max(1, x1 - x0), max(1, y1 - y0)],
            "coordinate_space": "ink_panel_preview_pixels",
            "semantic_role": "location_hint_not_owned_pixels",
            "color": "cyan",
        }

    def _focus_gate(self) -> dict[str, Any] | None:
        if self.focus_bbox_xywh is None:
            return None
        blockers: list[str] = []
        selection_bbox = (
            self.selection.get("selection_bbox_xywh")
            if self.selection is not None
            else None
        )
        if selection_bbox is None:
            blockers.append("no_green_selection")
            overlap_fraction = 0.0
        else:
            sx, sy, sw, sh = selection_bbox
            fx, fy, fw, fh = self.focus_bbox_xywh
            ix = max(0, min(sx + sw, fx + fw) - max(sx, fx))
            iy = max(0, min(sy + sh, fy + fh) - max(sy, fy))
            overlap_fraction = (ix * iy) / max(1, fw * fh)
            if overlap_fraction < 0.10:
                blockers.append("green_misses_target_locator")
            slack_x = max(24, round(fw * 0.18))
            slack_y = max(18, round(fh * 0.25))
            if (
                sx < fx - slack_x
                or sy < fy - slack_y
                or sx + sw > fx + fw + slack_x
                or sy + sh > fy + fh + slack_y
            ):
                blockers.append("green_spills_beyond_one_word_bounds")
        return {
            "status": "pass" if not blockers else "blocked",
            "blockers": blockers,
            "selection_bbox_xywh": selection_bbox,
            "locator_overlap_fraction": round(overlap_fraction, 6),
            "rule": "green_must_overlap_and_remain_near_the_software_word_locator",
        }

    def current(self) -> dict[str, Any]:
        if self._current is None:
            raise RuntimeError("Agent turn was not published")
        return json.loads(json.dumps(self._current))

    def _asset(self, kind: str, revision: int | None = None) -> Image.Image:
        path, _media = self.selector.asset_path(kind, revision)
        with Image.open(path) as opened:
            return opened.convert("RGBA")

    @staticmethod
    def _data_url_image(value: str) -> Image.Image:
        prefix = "data:image/png;base64,"
        if not value.startswith(prefix):
            raise ConsoleError(
                "integrity_error",
                "The exact green selection overlay is invalid",
                status=500,
            )
        with Image.open(BytesIO(base64.b64decode(value[len(prefix) :]))) as opened:
            return opened.convert("RGBA")

    def _render_collage(self, path: Path, state: Mapping[str, Any]) -> dict[str, Any]:
        width, height = self.preview_wh
        revision = int(state["revision"])
        original = self._asset("original").resize((width, height))
        clean = self._asset("clean").resize((width, height))
        if self.recovery is not None:
            recovered_surface = self._data_url_image(
                self.recovery["surface"]["selectable_ink_data_url"]
            ).resize((width, height))
            clean = recovered_surface
        claimed = self._asset("claimed", revision).resize((width, height))
        original.alpha_composite(claimed)
        clean.alpha_composite(claimed)
        if "cut_overlay" in state["assets"]:
            cut = self._asset("cut", revision).resize((width, height))
            original.alpha_composite(cut)
            clean.alpha_composite(cut)
        if self.selection is not None:
            selection = self._data_url_image(
                self.selection["overlay_data_url"]
            ).resize((width, height))
            clean.alpha_composite(selection)
        focus_locator = None
        if self.focus_bbox_xywh is not None:
            focus_locator = self._focus_locator_record()
            x, y, box_width, box_height = focus_locator["bbox_xywh"]
            for panel in (original, clean):
                locator_draw = ImageDraw.Draw(panel)
                locator_draw.rectangle(
                    (x, y, x + box_width - 1, y + box_height - 1),
                    outline=(0, 180, 205, 255),
                    width=4,
                )
        header = 40
        footer = 44
        gap = 14
        board = Image.new(
            "RGB",
            (width * 2 + gap, height + header + footer),
            "white",
        )
        board.paste(original.convert("RGB"), (0, header))
        board.paste(clean.convert("RGB"), (width + gap, header))
        draw = ImageDraw.Draw(board)
        draw.text((10, 12), "ORIGINAL · context only", fill=(40, 35, 31))
        clean_label = (
            f"RECOVERED INK · {self.recovery['active_profile'].replace('_', ' ').upper()} · ACTIVE"
            if self.recovery is not None
            else "CLEAN INK · ACTIVE"
        )
        draw.text(
            (width + gap + 10, 12),
            clean_label,
            fill=(40, 35, 31),
        )
        draft = (
            f"green draft: {self.selection['selected_pixels']:,} pixels"
            if self.selection is not None
            else "green draft: none"
        )
        draw.text(
            (10, height + header + 14),
            f"red words: {state['word_count']}  ·  {draft}",
            fill=(40, 35, 31),
        )
        if path.suffix.lower() == ".jpg":
            board.save(
                path,
                format="JPEG",
                quality=90,
                subsampling=0,
                optimize=True,
            )
            media_type = "image/jpeg"
        else:
            board.save(path, format="PNG")
            media_type = "image/png"
        result = {
            "path": path.name,
            "file_sha256": sha256_file(path),
            "media_type": media_type,
            "size_wh": list(board.size),
            "ink_panel_content_bboxes_xywh": {
                "clean": [width + gap, header, width, height],
            },
            "action_coordinate_space": {
                "origin": "clean_ink_panel_content_top_left",
                "size_wh": [width, height],
                "units": "integer_preview_pixels",
            },
        }
        if focus_locator is not None:
            result["focus_locator"] = focus_locator
        return result

    def _legal_actions(self) -> list[str]:
        actions = ["select_or_refine", "apply_cut"]
        focus_gate = self._focus_gate()
        if (
            self.selection is not None
            and self.selection.get("commit_ready")
            and (focus_gate is None or focus_gate["status"] == "pass")
        ):
            actions.extend(["commit_word", "recover_source_ink"])
        if self.recovery is not None:
            actions.append("choose_recovery")
        return actions

    def _publish_turn(self, previous_result: Mapping[str, Any] | None) -> None:
        state = self.selector.bootstrap()["state"]
        self.turn_index += 1
        self._attempt_count = 0
        turn_dir = self.trace_dir / f"turn-{self.turn_index:06d}"
        turn_dir.mkdir()
        collage = self._render_collage(turn_dir / self.collage_filename, state)
        packet: dict[str, Any] = {
            "schema_version": TURN_SCHEMA_VERSION,
            "turn_index": self.turn_index,
            "selector_binding": {
                "page_id": state["page_id"],
                "revision": state["revision"],
                "state_sha256": state["state_sha256"],
            },
            "content_order": ["prompt", "public_packet", "response_schema", "collage"],
            "prompt": {
                "path": "../protocol/prompt.md",
                "file_sha256": sha256_file(self.trace_dir / "protocol/prompt.md"),
                "status": "verified_for_this_agent_session",
            },
            "response_schema": {
                "path": "../protocol/response-schema.json",
                "file_sha256": sha256_file(
                    self.trace_dir / "protocol/response-schema.json"
                ),
            },
            "collage": collage,
            "legal_actions": self._legal_actions(),
            "current_draft": {
                "ink_variant": self.ink_variant,
                "rectangles": self.preview_rectangles,
                "deselect_rectangles": self.preview_deselect_rectangles,
                "selected_pixels": (
                    self.selection["selected_pixels"]
                    if self.selection is not None
                    else 0
                ),
                "selection_preview_sha256": (
                    self.selection["selection_preview_sha256"]
                    if self.selection is not None
                    else None
                ),
                "focus_gate": self._focus_gate(),
                "recovery": (
                    {
                        "active_profile": self.recovery["active_profile"],
                        "candidate_order": self.recovery["candidate_order"],
                        "candidates": self.recovery["candidates"],
                        "anchor_draft": self.recovery["anchor_draft"],
                    }
                    if self.recovery is not None
                    else None
                ),
            },
            "progress": {
                "words_committed": state["word_count"],
                "claimed_pixels": state["claimed_pixels"],
            },
            "previous_software_result": (
                dict(previous_result) if previous_result is not None else None
            ),
        }
        packet["agent_turn_sha256"] = _hash_record(packet, "agent_turn_sha256")
        _write_new(turn_dir / "agent-turn.json", canonical_json_bytes(packet) + b"\n")
        self._current = packet

    def _source_rectangle(self, rectangle: list[int]) -> list[int]:
        preview_width, preview_height = self.preview_wh
        source_width, source_height = self.selector.size_wh
        x, y, width, height = rectangle
        if (
            x < 0
            or y < 0
            or width < 1
            or height < 1
            or x + width > preview_width
            or y + height > preview_height
        ):
            raise ConsoleError(
                "invalid_agent_coordinates",
                "A rectangle falls outside the active ink panel",
            )
        x0 = int(x * source_width // preview_width)
        y0 = int(y * source_height // preview_height)
        x1 = int(-(-(x + width) * source_width // preview_width))
        y1 = int(-(-(y + height) * source_height // preview_height))
        return [x0, y0, max(1, x1 - x0), max(1, y1 - y0)]

    def _source_point(self, point: list[int]) -> list[int]:
        preview_width, preview_height = self.preview_wh
        source_width, source_height = self.selector.size_wh
        x, y = point
        if x < 0 or y < 0 or x >= preview_width or y >= preview_height:
            raise ConsoleError(
                "invalid_agent_coordinates",
                "A cut point falls outside the active ink panel",
            )
        return [
            min(source_width - 1, int(round(x * source_width / preview_width))),
            min(source_height - 1, int(round(y * source_height / preview_height))),
        ]

    def _record_attempt(
        self,
        decision: Mapping[str, Any],
        *,
        elapsed_ms: int,
        outcome: Mapping[str, Any],
        accepted: bool,
    ) -> None:
        self._attempt_count += 1
        attempt = {
            "schema_version": "simple-page-agent-attempt.v3",
            "agent_turn_sha256": self.current()["agent_turn_sha256"],
            "attempt_number": self._attempt_count,
            "decision": dict(decision),
            "accepted": accepted,
            "elapsed_ms": elapsed_ms,
            "software_outcome": dict(outcome),
        }
        attempt["attempt_sha256"] = _hash_record(attempt, "attempt_sha256")
        _write_new(
            self.trace_dir
            / f"turn-{self.turn_index:06d}"
            / "attempts"
            / f"attempt-{self._attempt_count:03d}.json",
            canonical_json_bytes(attempt) + b"\n",
        )

    def apply(self, envelope: Mapping[str, Any]) -> dict[str, Any]:
        started = perf_counter()
        if not isinstance(envelope, Mapping) or set(envelope) != {
            "agent_turn_sha256",
            "decision",
        }:
            raise ConsoleError(
                "invalid_agent_action",
                "Agent action needs the current turn hash and one decision",
            )
        decision = envelope.get("decision")
        try:
            if envelope.get("agent_turn_sha256") != self.current()[
                "agent_turn_sha256"
            ]:
                raise ConsoleError(
                    "stale_agent_turn",
                    "The agent acted on an older collage",
                    status=409,
                )
            errors = sorted(
                self.validator.iter_errors(decision),
                key=lambda error: list(error.path),
            )
            if errors:
                raise ConsoleError(
                    "invalid_agent_action",
                    "The agent decision does not match the strict response schema",
                )
            action = decision["action"]
            action_type = action["type"]
            if action_type not in self._legal_actions():
                raise ConsoleError(
                    "illegal_agent_action",
                    "That action is not legal for the current green draft",
                    status=409,
                )
            state = self.selector.bootstrap()["state"]
            result_summary: dict[str, Any] = {"action": action_type}
            if action_type == "select_or_refine":
                if action["ink_variant"] != self.ink_variant:
                    self.recovery = None
                self.ink_variant = action["ink_variant"]
                self.preview_rectangles = [list(value) for value in action["rectangles"]]
                self.preview_deselect_rectangles = [
                    list(value) for value in action["deselect_rectangles"]
                ]
                self.rectangles = [
                    self._source_rectangle(rectangle)
                    for rectangle in action["rectangles"]
                ]
                self.deselect_rectangles = [
                    self._source_rectangle(rectangle)
                    for rectangle in action["deselect_rectangles"]
                ]
                payload: dict[str, Any] = {
                    "base_state_sha256": state["state_sha256"],
                    "ink_variant": self.ink_variant,
                    "rectangles": self.rectangles,
                    "deselect_rectangles": self.deselect_rectangles,
                }
                if self.recovery is not None:
                    payload.update(
                        {
                            "recovery_set_sha256": self.recovery[
                                "recovery_set_sha256"
                            ],
                            "recovery_profile": self.recovery["active_profile"],
                        }
                    )
                self.selection = self.selector.preview_selection(payload)
                result_summary.update(
                    {
                        "selected_pixels": self.selection["selected_pixels"],
                        "component_count": self.selection["component_count"],
                        "commit_ready": self.selection["commit_ready"],
                    }
                )
            elif action_type == "recover_source_ink":
                anchor_draft = {
                    "ink_variant": self.ink_variant,
                    "rectangles": [list(value) for value in self.preview_rectangles],
                    "deselect_rectangles": [
                        list(value) for value in self.preview_deselect_rectangles
                    ],
                }
                recovery = self.selector.preview_recovery(
                    {
                        "base_state_sha256": state["state_sha256"],
                        "selection_preview_sha256": self.selection[
                            "selection_preview_sha256"
                        ],
                    }
                )
                recovery["anchor_draft"] = anchor_draft
                self.recovery = recovery
                self.selection = None
                self.rectangles = []
                self.deselect_rectangles = []
                self.preview_rectangles = []
                self.preview_deselect_rectangles = []
                result_summary.update(
                    {
                        "active_profile": recovery["active_profile"],
                        "requires_manual_reselection": True,
                        "candidate_additions": {
                            name: value["recovered_source_pixels"]
                            for name, value in recovery["candidates"].items()
                        },
                    }
                )
            elif action_type == "choose_recovery":
                chosen = self.selector.choose_recovery(
                    {
                        "base_state_sha256": state["state_sha256"],
                        "recovery_set_sha256": self.recovery[
                            "recovery_set_sha256"
                        ],
                        "profile": action["profile"],
                    }
                )
                self.recovery["active_profile"] = action["profile"]
                self.recovery["surface"] = chosen["surface"]
                self.selection = None
                self.rectangles = []
                self.deselect_rectangles = []
                self.preview_rectangles = []
                self.preview_deselect_rectangles = []
                result_summary.update(
                    {
                        "active_profile": action["profile"],
                        "selected_pixels": 0,
                        "requires_manual_reselection": True,
                        "recovered_source_pixels": chosen["surface"][
                            "recovered_source_pixels"
                        ],
                    }
                )
            elif action_type == "commit_word":
                committed = self.selector.commit_word(
                    {
                        "schema_version": "simple-page-word-selection-action.v1",
                        "base_state_sha256": state["state_sha256"],
                        "ink_variant": self.ink_variant,
                        "rectangles": self.rectangles,
                        "deselect_rectangles": self.deselect_rectangles,
                        "selection_preview_sha256": self.selection[
                            "selection_preview_sha256"
                        ],
                    }
                )["committed_word"]
                result_summary.update(
                    {
                        "word_number": committed["word_number"],
                        "selected_pixels": committed["selected_pixels"],
                        "recovery_profile": (
                            committed["recovery"]["profile"]
                            if committed.get("recovery")
                            else None
                        ),
                    }
                )
                self.rectangles = []
                self.deselect_rectangles = []
                self.preview_rectangles = []
                self.preview_deselect_rectangles = []
                self.selection = None
                self.recovery = None
            elif action_type == "apply_cut":
                source_width = self.selector.size_wh[0]
                preview_width = self.preview_wh[0]
                width_px = max(
                    1,
                    int(round(action["width_px"] * source_width / preview_width)),
                )
                cut = self.selector.apply_cut(
                    {
                        "schema_version": "simple-page-cut-apply-action.v1",
                        "base_state_sha256": state["state_sha256"],
                        "points": [
                            self._source_point(point) for point in action["points"]
                        ],
                        "width_px": min(40, width_px),
                    }
                )["cut"]
                result_summary.update(cut)
                self.rectangles = []
                self.deselect_rectangles = []
                self.preview_rectangles = []
                self.preview_deselect_rectangles = []
                self.selection = None
                self.recovery = None
            elapsed_ms = round((perf_counter() - started) * 1000)
            self._record_attempt(
                decision,
                elapsed_ms=elapsed_ms,
                outcome=result_summary,
                accepted=True,
            )
            result_summary["elapsed_ms"] = elapsed_ms
            self._publish_turn(previous_result=result_summary)
            return self.current()
        except ConsoleError as error:
            elapsed_ms = round((perf_counter() - started) * 1000)
            if isinstance(decision, Mapping):
                self._record_attempt(
                    decision,
                    elapsed_ms=elapsed_ms,
                    outcome={"error_code": error.code, "message": error.message},
                    accepted=False,
                )
            raise
