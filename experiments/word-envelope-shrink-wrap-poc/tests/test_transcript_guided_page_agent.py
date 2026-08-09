from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

import numpy as np
from PIL import Image

from word_envelope.human_review_console import ConsoleError
from word_envelope.simple_page_selector import (
    initialize_simple_selector,
    install_dual_ink_layers,
)
from word_envelope.transcript_guided_page_agent import (
    TranscriptGuidedPageAgentSession,
    build_target_plan,
    summarize_trace_timing,
)


class TranscriptGuidedPageAgentTests(unittest.TestCase):
    def _fixture(self, root: Path) -> tuple[Path, Path]:
        source = np.full((100, 180, 3), (241, 231, 209), dtype=np.uint8)
        source[35:48, 20:55] = (68, 75, 137)
        source[35:48, 90:135] = (68, 75, 137)
        mask = np.zeros((100, 180), dtype=np.uint8)
        mask[35:48, 20:55] = 255
        mask[35:48, 90:135] = 255
        source_path = root / "source.png"
        mask_path = root / "mask.png"
        clean_path = root / "clean.png"
        Image.fromarray(source, mode="RGB").save(source_path)
        Image.fromarray(mask, mode="L").save(mask_path)
        clean = mask.copy()
        clean[35, 134] = 0
        Image.fromarray(clean, mode="L").save(clean_path)
        selector = root / "selector"
        initialize_simple_selector(
            selector,
            page_id="guided-test",
            source_path=source_path,
            strong_mask_path=mask_path,
        )
        install_dual_ink_layers(
            selector,
            clean_mask_path=clean_path,
            high_recall_mask_path=mask_path,
        )
        transcription = {
            "schema_version": "simple-page-transcription-first-decision.v1",
            "lines": [
                {
                    "line_order": 1,
                    "line_kind": "body",
                    "tokens": [
                        {
                            "token_order": 1,
                            "text": "now",
                            "reading_status": "readable",
                        },
                        {
                            "token_order": 2,
                            "text": "there",
                            "reading_status": "readable",
                        },
                        {
                            "token_order": 3,
                            "text": "[flourish]",
                            "reading_status": "nonword_mark",
                        },
                    ],
                }
            ],
        }
        transcription_path = root / "transcription.json"
        transcription_path.write_text(json.dumps(transcription), encoding="utf-8")
        return selector, transcription_path

    def _apply(self, session, packet, decision):
        return session.apply(
            {
                "guided_turn_sha256": packet["guided_turn_sha256"],
                "decision": decision,
            }
        )

    def test_exact_target_cursor_drives_one_word_then_the_next(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            selector, transcription = self._fixture(root)
            session = TranscriptGuidedPageAgentSession(
                selector, root / "trace", transcription
            )
            first = session.current()
            self.assertEqual(first["current_target"]["text"], "now")
            self.assertEqual(first["target_queue"]["remaining"], 2)
            self.assertEqual(session.plan["target_count"], 2)
            self.assertEqual(len(session.plan["ignored_nonword_marks"]), 1)
            self.assertEqual(first["collage"]["target_banner_height_px"], 0)
            self.assertEqual(
                first["collage"]["target_display"],
                "hash_bound_current_target_packet_field",
            )
            self.assertEqual(first["collage"]["path"], "turn-000001/collage.jpg")
            self.assertEqual(first["collage"]["media_type"], "image/jpeg")
            selected = self._apply(
                session,
                first,
                {
                    "schema_version": "simple-page-agent-decision.v3",
                    "action": {
                        "type": "select_or_refine",
                        "ink_variant": "clean",
                        "rectangles": [[25, 38, 5, 5]],
                        "deselect_rectangles": [],
                    },
                },
            )
            self.assertEqual(selected["current_target"]["text"], "now")
            self.assertGreater(selected["current_draft"]["selected_pixels"], 0)
            committed = self._apply(
                session,
                selected,
                {
                    "schema_version": "simple-page-agent-decision.v3",
                    "action": {"type": "commit_word"},
                },
            )
            self.assertEqual(committed["current_target"]["text"], "there")
            self.assertEqual(committed["target_queue"]["committed"], 1)
            resumed = TranscriptGuidedPageAgentSession.open(root / "trace")
            self.assertEqual(
                resumed.current()["guided_turn_sha256"],
                committed["guided_turn_sha256"],
            )

    def test_queue_completion_blocks_unlisted_extra_word(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            selector, transcription = self._fixture(root)
            session = TranscriptGuidedPageAgentSession(
                selector, root / "trace", transcription
            )
            packet = session.current()
            for rectangle in ([[25, 38, 5, 5]], [[95, 38, 5, 5]]):
                packet = self._apply(
                    session,
                    packet,
                    {
                        "schema_version": "simple-page-agent-decision.v3",
                        "action": {
                            "type": "select_or_refine",
                            "ink_variant": "clean",
                            "rectangles": rectangle,
                            "deselect_rectangles": [],
                        },
                    },
                )
                packet = self._apply(
                    session,
                    packet,
                    {
                        "schema_version": "simple-page-agent-decision.v3",
                        "action": {"type": "commit_word"},
                    },
                )
            self.assertIsNone(packet["current_target"])
            self.assertEqual(packet["target_queue"]["status"], "complete")
            self.assertEqual(packet["legal_actions"], [])
            with self.assertRaisesRegex(ConsoleError, "Every transcript target"):
                session.apply(
                    {
                        "guided_turn_sha256": packet["guided_turn_sha256"],
                        "decision": {
                            "schema_version": "simple-page-agent-decision.v3",
                            "action": {
                                "type": "select_or_refine",
                                "ink_variant": "clean",
                                "rectangles": [[2, 2, 2, 2]],
                                "deselect_rectangles": [],
                            },
                        },
                    }
                )

    def test_readable_multiword_token_is_rejected(self) -> None:
        schema = json.loads(
            (
                Path(__file__).resolve().parents[1]
                / "schemas/simple-page-transcription-first-decision-v1.schema.json"
            ).read_text()
        )
        decision = {
            "schema_version": "simple-page-transcription-first-decision.v1",
            "lines": [
                {
                    "line_order": 1,
                    "line_kind": "body",
                    "tokens": [
                        {
                            "token_order": 1,
                            "text": "I guess",
                            "reading_status": "readable",
                        }
                    ],
                }
            ],
        }
        with self.assertRaisesRegex(ConsoleError, "cannot contain multiple words"):
            build_target_plan(decision, schema)

    def test_timing_summary_counts_packet_to_commit_actions(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            selector, transcription = self._fixture(root)
            session = TranscriptGuidedPageAgentSession(
                selector, root / "trace", transcription
            )
            packet = session.current()
            packet = self._apply(
                session,
                packet,
                {
                    "schema_version": "simple-page-agent-decision.v3",
                    "action": {
                        "type": "select_or_refine",
                        "ink_variant": "clean",
                        "rectangles": [[25, 38, 5, 5]],
                        "deselect_rectangles": [],
                    },
                },
            )
            self._apply(
                session,
                packet,
                {
                    "schema_version": "simple-page-agent-decision.v3",
                    "action": {"type": "commit_word"},
                },
            )
            summary = summarize_trace_timing(root / "trace")
            self.assertEqual(summary["committed_words"], 1)
            self.assertEqual(summary["average_actions_per_word"], 2.0)
            self.assertEqual(summary["total_rejected_actions"], 0)
            self.assertGreaterEqual(summary["average_wall_ms_per_word"], 0)
            self.assertGreaterEqual(summary["average_software_ms_per_word"], 0)
            self.assertEqual(summary["words"][0]["reference_text"], "now")

    def test_dispatcher_injects_current_turn_binding_for_compact_decision(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            selector, transcription = self._fixture(root)
            session = TranscriptGuidedPageAgentSession(
                selector, root / "trace", transcription
            )
            selected = session.apply_current_decision(
                {
                    "schema_version": "simple-page-agent-decision.v3",
                    "action": {
                        "type": "select_or_refine",
                        "ink_variant": "clean",
                        "rectangles": [[25, 38, 5, 5]],
                        "deselect_rectangles": [],
                    },
                }
            )
            self.assertGreater(selected["current_draft"]["selected_pixels"], 0)
            committed = session.apply_current_decision(
                {
                    "schema_version": "simple-page-agent-decision.v3",
                    "action": {"type": "commit_word"},
                }
            )
            self.assertEqual(committed["target_queue"]["committed"], 1)
            self.assertEqual(summarize_trace_timing(root / "trace")["total_rejected_actions"], 0)


if __name__ == "__main__":
    unittest.main()
