from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

import numpy as np
from PIL import Image

from word_envelope.human_review_console import ConsoleError
from word_envelope.io_utils import canonical_json_bytes
from word_envelope.provisional_ownership_ledger import (
    ACTION_SCHEMA,
    ProvisionalOwnershipLedger,
)
from word_envelope.simple_page_selector import SimplePageSelector, initialize_simple_selector


class ProvisionalOwnershipLedgerTests(unittest.TestCase):
    def _ledger(self, root: Path) -> ProvisionalOwnershipLedger:
        source = np.full((80, 140, 3), 245, dtype=np.uint8)
        mask = np.zeros((80, 140), dtype=np.uint8)
        rectangles = (
            (8, 18, 19, 27),
            (30, 18, 42, 27),
            (56, 18, 72, 27),
            (12, 48, 28, 57),
            (76, 48, 92, 57),
        )
        for x1, y1, x2, y2 in rectangles:
            source[y1:y2, x1:x2] = (55, 45, 40)
            mask[y1:y2, x1:x2] = 255
        source_path = root / "source.png"
        mask_path = root / "mask.png"
        Image.fromarray(source, mode="RGB").save(source_path)
        Image.fromarray(mask, mode="L").save(mask_path)
        selector_dir = root / "selector"
        initialize_simple_selector(
            selector_dir,
            page_id="synthetic-p01",
            source_path=source_path,
            strong_mask_path=mask_path,
        )
        return ProvisionalOwnershipLedger.initialize(
            root / "ownership",
            selector_dir,
            [
                {
                    "word_id": "word-a",
                    "line_id": "line-1",
                    "line_order": 1,
                    "word_order": 1,
                    "reference_text": "one",
                    "component_ids": [1, 2],
                },
                {
                    "word_id": "word-b",
                    "line_id": "line-1",
                    "line_order": 1,
                    "word_order": 2,
                    "reference_text": "two",
                    "component_ids": [3],
                },
                {
                    "word_id": "word-c",
                    "line_id": "line-2",
                    "line_order": 2,
                    "word_order": 1,
                    "reference_text": "three",
                    "component_ids": [4],
                },
            ],
            ambiguous_component_ids=[5],
            provenance={"experiment": "synthetic-ledger-contract"},
        )

    def _apply(self, ledger: ProvisionalOwnershipLedger, action_type: str, **fields):
        state = ledger.head()
        return ledger.apply(
            {
                "schema_version": ACTION_SCHEMA,
                "base_state_sha256": state["state_sha256"],
                "type": action_type,
                **fields,
            }
        )

    def test_replays_full_correction_sequence_without_lost_or_duplicate_components(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            ledger = self._ledger(Path(directory))
            initial = ledger.head()
            self.assertEqual(len(initial["component_owner"]), 5)
            self.assertNotEqual(initial["words"][0]["color_hex"], initial["words"][1]["color_hex"])
            self.assertNotEqual(initial["words"][0]["palette_family"], initial["words"][2]["palette_family"])

            self._apply(
                ledger,
                "transfer",
                component_ids=[2],
                target_word_id="word-b",
            )
            created = self._apply(
                ledger,
                "create_word",
                line_id="line-1",
                line_order=1,
                word_order=2,
                reference_text="inserted",
            )
            inserted = max(created["words"], key=lambda word: word["owner_label"])["word_id"]
            self._apply(
                ledger,
                "transfer",
                component_ids=[5],
                target_word_id=inserted,
            )
            split = self._apply(
                ledger,
                "split_word",
                source_word_id="word-b",
                component_ids=[3],
                reference_text="split",
            )
            split_id = max(split["words"], key=lambda word: word["owner_label"])["word_id"]
            self._apply(
                ledger,
                "merge_words",
                source_word_id=split_id,
                target_word_id=inserted,
            )
            final = self._apply(ledger, "mark_nontext", component_ids=[4])

            self.assertEqual(set(final["component_owner"]), {"1", "2", "3", "4", "5"})
            self.assertIsNone(final["component_owner"]["4"])
            self.assertIn(4, final["nontext_component_ids"])
            self.assertNotIn(5, final["ambiguous_component_ids"])
            owned_lists = [
                component_id
                for word in final["words"]
                for component_id in word["component_ids"]
            ]
            self.assertEqual(len(owned_lists), len(set(owned_lists)))
            self.assertEqual(ledger.validate()["violation_count"], 0)
            self.assertEqual(ledger.validate()["revision"], 6)

    def test_rejects_stale_edits_and_freeze_blocks_further_changes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            ledger = self._ledger(Path(directory))
            stale_hash = ledger.head()["state_sha256"]
            self._apply(
                ledger,
                "transfer",
                component_ids=[2],
                target_word_id="word-b",
            )
            with self.assertRaisesRegex(ConsoleError, "changed"):
                ledger.apply(
                    {
                        "schema_version": ACTION_SCHEMA,
                        "base_state_sha256": stale_hash,
                        "type": "mark_nontext",
                        "component_ids": [5],
                    }
                )
            frozen = self._apply(ledger, "freeze")
            self.assertEqual(frozen["status"], "frozen")
            with self.assertRaisesRegex(ConsoleError, "Frozen"):
                self._apply(
                    ledger,
                    "transfer",
                    component_ids=[5],
                    target_word_id="word-a",
                )

    def test_validation_detects_historical_state_tampering(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            ledger = self._ledger(Path(directory))
            self._apply(
                ledger,
                "transfer",
                component_ids=[2],
                target_word_id="word-b",
            )
            state_path = ledger.root / "revisions" / "r000000" / "state.json"
            state = json.loads(state_path.read_text("utf-8"))
            state["words"][0]["reference_text"] = "tampered"
            state_path.write_bytes(canonical_json_bytes(state) + b"\n")
            result = ledger.validate()
            self.assertEqual(result["violation_count"], 1)
            self.assertIn("Revision 0", result["violations"][0])

    def test_validation_detects_owner_label_tampering(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            ledger = self._ledger(Path(directory))
            labels_path = ledger.root / "revisions" / "r000000" / "owner-labels.png"
            with Image.open(labels_path) as image:
                labels = np.asarray(image, dtype=np.uint16).copy()
            labels[18, 8] = 0
            Image.fromarray(labels).save(labels_path)
            result = ledger.validate()
            self.assertEqual(result["violation_count"], 1)
            self.assertIn("owner labels", result["violations"][0])

    def test_frozen_ownership_imports_exact_masks_then_fits_envelopes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            ledger = self._ledger(Path(directory))
            frozen = self._apply(ledger, "freeze")
            selector = SimplePageSelector(ledger._manifest["selector_session_dir"])
            imported = selector.import_provisional_ownership(ledger)
            self.assertEqual(imported["imported_word_count"], 3)
            self.assertEqual(imported["state"]["word_count"], 3)
            self.assertEqual(
                imported["state"]["claimed_pixels"],
                sum(word["selected_pixels"] for word in imported["state"]["words"]),
            )
            self.assertEqual(
                {word["ownership_word_id"] for word in imported["state"]["words"]},
                {"word-a", "word-b", "word-c"},
            )
            fitted = selector.finish_words(
                {"base_state_sha256": imported["state"]["state_sha256"]}
            )["state"]
            self.assertEqual(fitted["status"], "page_notes")
            self.assertTrue(all(word["envelope_polygon"] for word in fitted["words"]))
            self.assertEqual(frozen["status"], "frozen")


if __name__ == "__main__":
    unittest.main()
