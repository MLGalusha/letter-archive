from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

import numpy as np
from PIL import Image

from word_envelope.human_review_console import ConsoleError
from word_envelope.simple_page_agent import SimplePageAgentSession, _hash_record
from word_envelope.simple_page_selector import (
    initialize_simple_selector,
    install_dual_ink_layers,
)


class SimplePageAgentSessionTests(unittest.TestCase):
    def _session(self, root: Path) -> tuple[Path, Path]:
        source = np.full((100, 180, 3), (241, 231, 209), dtype=np.uint8)
        source[40:50, 20:55] = (68, 75, 137)
        source[42:52, 60:92] = (68, 75, 137)
        source[38:50, 125:155] = (68, 75, 137)
        source_path = root / "source.png"
        Image.fromarray(source, mode="RGB").save(source_path)
        high = np.zeros((100, 180), dtype=np.uint8)
        high[40:50, 20:55] = 255
        high[42:52, 60:92] = 255
        high[38:50, 125:155] = 255
        clean = high.copy()
        clean[42:52, 55:65] = 0
        strong_path = root / "strong.png"
        clean_path = root / "clean.png"
        Image.fromarray(high, mode="L").save(strong_path)
        Image.fromarray(clean, mode="L").save(clean_path)
        selector_dir = root / "selector"
        initialize_simple_selector(
            selector_dir,
            page_id="agent-synthetic-p01",
            source_path=source_path,
            strong_mask_path=strong_path,
        )
        install_dual_ink_layers(
            selector_dir,
            clean_mask_path=clean_path,
            high_recall_mask_path=strong_path,
        )
        return selector_dir, root / "agent-trace"

    def test_exact_collage_action_recovery_and_commit_trace(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            selector_dir, trace_dir = self._session(Path(directory))
            agent = SimplePageAgentSession(selector_dir, trace_dir)
            first = agent.current()
            self.assertEqual(
                first["content_order"],
                ["prompt", "public_packet", "response_schema", "collage"],
            )
            self.assertEqual(
                first["collage"]["action_coordinate_space"]["size_wh"],
                [180, 100],
            )
            self.assertEqual(first["collage"]["size_wh"], [374, 184])
            self.assertEqual(
                first["collage"]["ink_panel_content_bboxes_xywh"],
                {"clean": [194, 40, 180, 100]},
            )
            self.assertEqual(
                first["legal_actions"],
                ["select_or_refine", "apply_cut"],
            )
            selected = agent.apply(
                {
                    "agent_turn_sha256": first["agent_turn_sha256"],
                    "decision": {
                        "schema_version": "simple-page-agent-decision.v3",
                        "action": {
                            "type": "select_or_refine",
                            "ink_variant": "clean",
                            "rectangles": [[22, 42, 2, 2]],
                            "deselect_rectangles": [],
                        },
                    },
                }
            )
            self.assertGreater(selected["current_draft"]["selected_pixels"], 0)
            self.assertIn("commit_word", selected["legal_actions"])
            recovered = agent.apply(
                {
                    "agent_turn_sha256": selected["agent_turn_sha256"],
                    "decision": {
                        "schema_version": "simple-page-agent-decision.v3",
                        "action": {"type": "recover_source_ink"},
                    },
                }
            )
            self.assertEqual(
                recovered["current_draft"]["recovery"]["active_profile"],
                "conservative",
            )
            self.assertEqual(recovered["current_draft"]["selected_pixels"], 0)
            self.assertNotIn("commit_word", recovered["legal_actions"])
            chosen = agent.apply(
                {
                    "agent_turn_sha256": recovered["agent_turn_sha256"],
                    "decision": {
                        "schema_version": "simple-page-agent-decision.v3",
                        "action": {
                            "type": "choose_recovery",
                            "profile": "balanced",
                        },
                    },
                }
            )
            self.assertEqual(chosen["current_draft"]["selected_pixels"], 0)
            self.assertNotIn("commit_word", chosen["legal_actions"])
            reselected = agent.apply(
                {
                    "agent_turn_sha256": chosen["agent_turn_sha256"],
                    "decision": {
                        "schema_version": "simple-page-agent-decision.v3",
                        "action": {
                            "type": "select_or_refine",
                            "ink_variant": "clean",
                            "rectangles": [[22, 42, 2, 2]],
                            "deselect_rectangles": [],
                        },
                    },
                }
            )
            self.assertGreater(reselected["current_draft"]["selected_pixels"], 0)
            self.assertIn("commit_word", reselected["legal_actions"])
            resumed = SimplePageAgentSession.open(trace_dir)
            self.assertEqual(
                resumed.current()["agent_turn_sha256"],
                reselected["agent_turn_sha256"],
            )
            self.assertEqual(
                resumed.current()["current_draft"]["selected_pixels"],
                reselected["current_draft"]["selected_pixels"],
            )
            committed = resumed.apply(
                {
                    "agent_turn_sha256": reselected["agent_turn_sha256"],
                    "decision": {
                        "schema_version": "simple-page-agent-decision.v3",
                        "action": {"type": "commit_word"},
                    },
                }
            )
            self.assertEqual(committed["progress"]["words_committed"], 1)
            self.assertEqual(committed["current_draft"]["selected_pixels"], 0)
            events = sorted(trace_dir.glob("turn-*/attempts/attempt-*.json"))
            self.assertEqual(len(events), 5)
            for path in events:
                self.assertTrue(json.loads(path.read_text())["accepted"])

    def test_illegal_and_stale_actions_are_logged_without_advancing_turn(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            selector_dir, trace_dir = self._session(Path(directory))
            agent = SimplePageAgentSession(selector_dir, trace_dir)
            first = agent.current()
            illegal = {
                "schema_version": "simple-page-agent-decision.v3",
                "action": {"type": "commit_word"},
            }
            with self.assertRaisesRegex(ConsoleError, "not legal"):
                agent.apply(
                    {
                        "agent_turn_sha256": first["agent_turn_sha256"],
                        "decision": illegal,
                    }
                )
            self.assertEqual(
                agent.current()["agent_turn_sha256"],
                first["agent_turn_sha256"],
            )
            attempt = json.loads(
                (trace_dir / "turn-000001/attempts/attempt-001.json").read_text()
            )
            self.assertFalse(attempt["accepted"])
            with self.assertRaisesRegex(ConsoleError, "older collage"):
                agent.apply(
                    {
                        "agent_turn_sha256": "0" * 64,
                        "decision": illegal,
                    }
                )

    def test_permanent_high_recall_layer_is_not_an_agent_action(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            selector_dir, trace_dir = self._session(Path(directory))
            agent = SimplePageAgentSession(selector_dir, trace_dir)
            first = agent.current()
            self.assertNotIn(
                "high_recall",
                first["collage"]["ink_panel_content_bboxes_xywh"],
            )
            with self.assertRaisesRegex(ConsoleError, "strict response schema"):
                agent.apply(
                    {
                        "agent_turn_sha256": first["agent_turn_sha256"],
                        "decision": {
                            "schema_version": "simple-page-agent-decision.v3",
                            "action": {
                                "type": "select_or_refine",
                                "ink_variant": "high_recall",
                                "rectangles": [[22, 42, 2, 2]],
                                "deselect_rectangles": [],
                            },
                        },
                    }
                )

    def test_focus_locator_is_visible_and_blocks_the_wrong_word(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            selector_dir, trace_dir = self._session(Path(directory))
            agent = SimplePageAgentSession(
                selector_dir,
                trace_dir,
                focus_bbox_xywh=[15, 32, 48, 28],
            )
            first = agent.current()
            self.assertEqual(
                first["collage"]["focus_locator"]["semantic_role"],
                "location_hint_not_owned_pixels",
            )
            wrong = agent.apply(
                {
                    "agent_turn_sha256": first["agent_turn_sha256"],
                    "decision": {
                        "schema_version": "simple-page-agent-decision.v3",
                        "action": {
                            "type": "select_or_refine",
                            "ink_variant": "clean",
                            "rectangles": [[128, 40, 5, 5]],
                            "deselect_rectangles": [],
                        },
                    },
                }
            )
            self.assertNotIn("commit_word", wrong["legal_actions"])
            self.assertEqual(
                wrong["current_draft"]["focus_gate"]["status"], "blocked"
            )
            self.assertIn(
                "green_misses_target_locator",
                wrong["current_draft"]["focus_gate"]["blockers"],
            )
            resumed = SimplePageAgentSession.open(trace_dir)
            self.assertEqual(
                resumed.current()["collage"]["focus_locator"],
                wrong["collage"]["focus_locator"],
            )

    def test_resume_rejects_rehashed_turn_contract_tampering(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            selector_dir, trace_dir = self._session(Path(directory))
            SimplePageAgentSession(selector_dir, trace_dir)
            turn_path = trace_dir / "turn-000001/agent-turn.json"
            packet = json.loads(turn_path.read_text("utf-8"))
            packet["legal_actions"] = ["commit_word"]
            packet["agent_turn_sha256"] = _hash_record(
                packet,
                "agent_turn_sha256",
            )
            turn_path.write_text(json.dumps(packet), encoding="utf-8")
            with self.assertRaisesRegex(ConsoleError, "contract changed"):
                SimplePageAgentSession.open(trace_dir)

    def test_resume_rejects_rehashed_collage_path_escape(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            selector_dir, trace_dir = self._session(Path(directory))
            SimplePageAgentSession(selector_dir, trace_dir)
            turn_path = trace_dir / "turn-000001/agent-turn.json"
            packet = json.loads(turn_path.read_text("utf-8"))
            packet["collage"]["path"] = "../protocol/prompt.md"
            packet["collage"]["file_sha256"] = packet["prompt"][
                "file_sha256"
            ]
            packet["agent_turn_sha256"] = _hash_record(
                packet,
                "agent_turn_sha256",
            )
            turn_path.write_text(json.dumps(packet), encoding="utf-8")
            with self.assertRaisesRegex(ConsoleError, "reference is invalid"):
                SimplePageAgentSession.open(trace_dir)


if __name__ == "__main__":
    unittest.main()
