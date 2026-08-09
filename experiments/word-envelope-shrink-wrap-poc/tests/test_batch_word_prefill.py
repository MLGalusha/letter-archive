from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

import numpy as np
from PIL import Image

from word_envelope.batch_word_prefill import (
    build_batch_word_prefill,
    build_line_batch_packets,
    build_region_fill_knockout,
    validate_line_batch_decision,
)
from word_envelope.human_review_console import ConsoleError
from word_envelope.simple_page_selector import (
    initialize_simple_selector,
    install_dual_ink_layers,
)


class BatchWordPrefillTests(unittest.TestCase):
    def _fixture(self, root: Path) -> tuple[Path, Path]:
        source = np.full((100, 220, 3), (240, 230, 210), dtype=np.uint8)
        mask = np.zeros((100, 220), dtype=np.uint8)
        mask[35:48, 20:70] = 255
        mask[35:48, 110:180] = 255
        source[mask > 0] = (55, 65, 130)
        source_path = root / "source.png"
        mask_path = root / "mask.png"
        high_path = root / "high.png"
        Image.fromarray(source, mode="RGB").save(source_path)
        Image.fromarray(mask, mode="L").save(mask_path)
        high = mask.copy()
        high[70:73, 200:203] = 255
        Image.fromarray(high, mode="L").save(high_path)
        selector = root / "selector"
        initialize_simple_selector(
            selector,
            page_id="batch-test",
            source_path=source_path,
            strong_mask_path=mask_path,
        )
        install_dual_ink_layers(
            selector,
            clean_mask_path=mask_path,
            high_recall_mask_path=high_path,
        )
        record = {
            "schema_version": "candidate.v1",
            "units": [
                {
                    "id": "p1",
                    "stream_id": "body",
                    "line_id": "line-1",
                    "transcript": "one",
                    "source_axis_aligned_bbox_xywh": [15, 25, 65, 40],
                },
                {
                    "id": "p2",
                    "stream_id": "body",
                    "line_id": "line-1",
                    "transcript": "two",
                    "source_axis_aligned_bbox_xywh": [105, 25, 85, 40],
                },
            ],
        }
        record_path = root / "record.json"
        record_path.write_text(json.dumps(record), encoding="utf-8")
        return selector, record_path

    def test_prefill_and_line_snap_validation_are_deterministic(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            selector, record = self._fixture(root)
            prefill = build_batch_word_prefill(selector, record, root / "prefill")
            self.assertEqual(prefill["counts"]["proposals"], 2)
            self.assertEqual(prefill["counts"]["empty_proposals"], 0)
            self.assertEqual(prefill["counts"]["clipped_collision_pixels"], 0)
            session = build_line_batch_packets(selector, record, root / "lines")
            self.assertEqual(session["line_count"], 1)
            packet_path = root / "lines/line-001-line-1/packet.json"
            packet = json.loads(packet_path.read_text("utf-8"))
            decision = {
                "schema_version": "line-batch-word-selection.v1",
                "line_id": "line-1",
                "visible_words": [
                    {
                        "word_order": 1,
                        "proposal_ids": ["p1"],
                        "seed_points_xy": [[35, 5]],
                    },
                    {
                        "word_order": 2,
                        "proposal_ids": ["p2"],
                        "seed_points_xy": [[125, 5]],
                    },
                ],
            }
            decision_path = packet_path.parent / "decision.json"
            decision_path.write_text(json.dumps(decision), encoding="utf-8")
            result = validate_line_batch_decision(selector, packet_path, decision_path)
            self.assertEqual(result["counts"]["candidate_ready"], 2)
            self.assertEqual(result["counts"]["needs_review"], 0)
            self.assertGreater(
                sum(len(word["snapped_seed_points"]) for word in result["words"]),
                0,
            )
            knockout = build_region_fill_knockout(
                selector, root / "lines", root / "knockout"
            )
            self.assertEqual(knockout["counts"]["words"], 2)
            self.assertEqual(knockout["counts"]["nonempty_words"], 2)
            self.assertEqual(
                knockout["counts"]["assigned_pixels"]
                + knockout["counts"]["residual_pixels"],
                knockout["counts"]["clean_pixels"],
            )
            with self.assertRaisesRegex(ConsoleError, "already exists"):
                build_line_batch_packets(selector, record, root / "lines")


if __name__ == "__main__":
    unittest.main()
