from __future__ import annotations

from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from build_fragment_group_review import _connected_groups  # noqa: E402
from validate_fragment_group_decision import validate  # noqa: E402


class FragmentGroupReviewTests(unittest.TestCase):
    def test_same_baseline_fragments_group_while_row_above_stays_separate(self) -> None:
        features = [
            {"bbox_xywh": [315, 186, 230, 140], "median_y": 216.0},
            {"bbox_xywh": [427, 297, 179, 83], "median_y": 341.0},
            {"bbox_xywh": [625, 349, 161, 29], "median_y": 363.0},
        ]
        self.assertEqual(_connected_groups(features), [[0], [1, 2]])

    def test_validator_rejects_wrong_lane_and_accepts_exact_bound_choice(self) -> None:
        review = {
            "fragment_group_review_sha256": "a" * 64,
            "eligible_group_ids": ["B"],
        }
        decision = {
            "schema_version": "fragment-group-decision.v1",
            "fragment_group_review_sha256": "a" * 64,
            "keep_group_id": "B",
            "request_split_group_ids": [],
            "brief_visible_reason": "The disconnected pieces form one word.",
        }
        receipt = validate(review, decision)
        self.assertEqual(receipt["status"], "pass")
        self.assertFalse(receipt["split_requested"])
        wrong_lane = {**decision, "keep_group_id": "A"}
        with self.assertRaisesRegex(ValueError, "not eligible"):
            validate(review, wrong_lane)
        stale = {**decision, "fragment_group_review_sha256": "b" * 64}
        with self.assertRaisesRegex(ValueError, "Stale"):
            validate(review, stale)


if __name__ == "__main__":
    unittest.main()
