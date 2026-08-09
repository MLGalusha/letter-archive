from __future__ import annotations

import unittest

import numpy as np

from word_envelope.component_assignment import (
    add_group_centerline_support,
    confidence_order,
    estimate_group_centerlines,
    exclusive_component_assignment,
    rescore_component_locators,
    score_component_locators,
    sequential_component_claims,
)


class ComponentAssignmentTests(unittest.TestCase):
    def test_exclusive_assignment_prefers_stronger_containment_and_never_duplicates(self) -> None:
        ink = np.zeros((50, 120), dtype=bool)
        ink[20:28, 20:54] = True
        ink[20:28, 66:104] = True
        scored = score_component_locators(
            ink,
            [
                {"unit_id": "left", "bbox_xywh": [14, 14, 55, 22]},
                {"unit_id": "right", "bbox_xywh": [52, 14, 60, 22]},
            ],
        )
        result = exclusive_component_assignment(scored, minimum_score_margin=0.04)
        self.assertEqual(result["component_ids_by_unit"]["left"], [1])
        self.assertEqual(result["component_ids_by_unit"]["right"], [2])
        claimed = sum(result["component_ids_by_unit"].values(), [])
        self.assertEqual(len(claimed), len(set(claimed)))

    def test_near_tied_component_is_left_unassigned_for_review(self) -> None:
        ink = np.zeros((40, 100), dtype=bool)
        ink[18:24, 35:65] = True
        scored = score_component_locators(
            ink,
            [
                {"unit_id": "left", "bbox_xywh": [20, 10, 35, 25]},
                {"unit_id": "right", "bbox_xywh": [45, 10, 35, 25]},
            ],
        )
        result = exclusive_component_assignment(scored, minimum_score_margin=0.20)
        self.assertFalse(result["component_ids_by_unit"]["left"])
        self.assertFalse(result["component_ids_by_unit"]["right"])
        self.assertEqual([value["component_id"] for value in result["ambiguous_components"]], [1])

    def test_sequential_claims_are_disjoint_and_order_sensitive(self) -> None:
        ink = np.zeros((40, 100), dtype=bool)
        ink[18:24, 35:65] = True
        scored = score_component_locators(
            ink,
            [
                {"unit_id": "left", "bbox_xywh": [20, 10, 40, 25]},
                {"unit_id": "right", "bbox_xywh": [40, 10, 40, 25]},
            ],
        )
        forward = sequential_component_claims(scored, ["left", "right"])
        reverse = sequential_component_claims(scored, ["right", "left"])
        self.assertEqual(forward["component_ids_by_unit"]["left"], [1])
        self.assertEqual(reverse["component_ids_by_unit"]["right"], [1])
        self.assertFalse(forward["component_ids_by_unit"]["right"])
        self.assertFalse(reverse["component_ids_by_unit"]["left"])

    def test_confidence_order_places_exclusive_locator_before_competing_locator(self) -> None:
        ink = np.zeros((60, 150), dtype=bool)
        ink[15:23, 12:42] = True
        ink[37:45, 68:118] = True
        scored = score_component_locators(
            ink,
            [
                {"unit_id": "broad", "bbox_xywh": [5, 8, 125, 45]},
                {"unit_id": "exclusive", "bbox_xywh": [64, 32, 60, 20]},
            ],
        )
        self.assertEqual(confidence_order(scored)[0], "exclusive")

    def test_rescore_changes_competition_without_mutating_frozen_features(self) -> None:
        ink = np.zeros((50, 110), dtype=bool)
        ink[18:28, 36:74] = True
        scored = score_component_locators(
            ink,
            [
                {"unit_id": "broad", "bbox_xywh": [8, 10, 80, 28]},
                {"unit_id": "centered", "bbox_xywh": [35, 10, 40, 28]},
            ],
        )
        original_scores = [row["score"] for row in scored["scores_by_component"][1]]
        rescored = rescore_component_locators(
            scored,
            {
                "component_inside_locator_fraction": 0.05,
                "center_x_support": 0.80,
                "center_y_support": 0.05,
                "horizontal_overlap": 0.05,
                "vertical_overlap": 0.05,
            },
        )
        self.assertEqual([row["score"] for row in scored["scores_by_component"][1]], original_scores)
        self.assertEqual(rescored["scores_by_component"][1][0]["unit_id"], "centered")
        self.assertAlmostEqual(sum(rescored["score_weights"].values()), 1.0)

    def test_rescore_rejects_incomplete_weight_sets(self) -> None:
        ink = np.zeros((10, 10), dtype=bool)
        ink[3:5, 3:5] = True
        scored = score_component_locators(
            ink,
            [{"unit_id": "one", "bbox_xywh": [0, 0, 10, 10]}],
        )
        with self.assertRaisesRegex(Exception, "provide exactly"):
            rescore_component_locators(scored, {"center_x_support": 1.0})

    def test_cross_group_competition_can_require_stricter_abstention(self) -> None:
        ink = np.zeros((40, 100), dtype=bool)
        ink[18:24, 35:65] = True
        scored = score_component_locators(
            ink,
            [
                {"unit_id": "line-a-left", "bbox_xywh": [18, 10, 45, 25]},
                {"unit_id": "line-b-right", "bbox_xywh": [40, 10, 45, 25]},
            ],
        )
        ordinary = exclusive_component_assignment(scored, minimum_score_margin=0.01)
        guarded = exclusive_component_assignment(
            scored,
            minimum_score_margin=0.01,
            unit_groups={"line-a-left": "line-a", "line-b-right": "line-b"},
            cross_group_minimum_score_margin=0.30,
        )
        self.assertEqual(sum(ordinary["component_ids_by_unit"].values(), []), [1])
        self.assertFalse(sum(guarded["component_ids_by_unit"].values(), []))
        self.assertEqual(guarded["ambiguous_components"][0]["competition_scope"], "cross_group")

    def test_cross_group_margin_requires_complete_group_map(self) -> None:
        ink = np.zeros((10, 10), dtype=bool)
        ink[3:5, 3:5] = True
        scored = score_component_locators(
            ink,
            [{"unit_id": "one", "bbox_xywh": [0, 0, 10, 10]}],
        )
        with self.assertRaisesRegex(Exception, "requires unit_groups"):
            exclusive_component_assignment(
                scored,
                cross_group_minimum_score_margin=0.2,
            )

    def test_group_centerline_support_resolves_overlapping_line_boxes(self) -> None:
        ink = np.zeros((100, 140), dtype=bool)
        ink[20:25, 12:36] = True
        ink[22:27, 88:116] = True
        ink[70:75, 12:36] = True
        ink[72:77, 88:116] = True
        ink[63:67, 54:66] = True
        locators = [
            {"unit_id": "top-a", "bbox_xywh": [5, 10, 55, 65]},
            {"unit_id": "top-b", "bbox_xywh": [55, 10, 75, 65]},
            {"unit_id": "bottom-a", "bbox_xywh": [5, 45, 55, 45]},
            {"unit_id": "bottom-b", "bbox_xywh": [55, 45, 75, 45]},
        ]
        scored = score_component_locators(ink, locators)
        groups = {"top-a": "top", "top-b": "top", "bottom-a": "bottom", "bottom-b": "bottom"}
        seed = {
            "top-a": [1],
            "top-b": [2],
            "bottom-a": [4],
            "bottom-b": [5],
        }
        centerlines = estimate_group_centerlines(scored, seed, groups)
        rescored = add_group_centerline_support(
            scored,
            centerlines,
            groups,
            weight=0.60,
            scale_multiplier=1.5,
        )
        disputed_id = 3
        self.assertEqual(rescored["scores_by_component"][disputed_id][0]["unit_id"], "bottom-b")
        self.assertGreater(
            rescored["scores_by_component"][disputed_id][0]["group_centerline_support"],
            rescored["scores_by_component"][disputed_id][-1]["group_centerline_support"],
        )

    def test_cross_group_only_line_support_leaves_same_group_competition_unchanged(self) -> None:
        ink = np.zeros((40, 100), dtype=bool)
        ink[18:24, 35:65] = True
        scored = score_component_locators(
            ink,
            [
                {"unit_id": "line-left", "bbox_xywh": [20, 10, 40, 25]},
                {"unit_id": "line-right", "bbox_xywh": [40, 10, 40, 25]},
            ],
        )
        original = [row["score"] for row in scored["scores_by_component"][1]]
        rescored = add_group_centerline_support(
            scored,
            {"line": {"slope": 0.0, "intercept": 0.0, "scale_px": 1.0}},
            {"line-left": "line", "line-right": "line"},
            weight=1.0,
            cross_group_only=True,
        )
        self.assertEqual([row["score"] for row in rescored["scores_by_component"][1]], original)

    def test_line_support_area_floor_leaves_tiny_component_unchanged(self) -> None:
        ink = np.zeros((40, 100), dtype=bool)
        ink[20, 50] = True
        scored = score_component_locators(
            ink,
            [
                {"unit_id": "top", "bbox_xywh": [35, 0, 30, 30]},
                {"unit_id": "bottom", "bbox_xywh": [35, 10, 30, 30]},
            ],
        )
        original = [row["score"] for row in scored["scores_by_component"][1]]
        rescored = add_group_centerline_support(
            scored,
            {
                "top": {"slope": 0.0, "intercept": 5.0, "scale_px": 1.0},
                "bottom": {"slope": 0.0, "intercept": 20.0, "scale_px": 1.0},
            },
            {"top": "top", "bottom": "bottom"},
            weight=1.0,
            cross_group_only=True,
            minimum_component_area_px=2,
        )
        self.assertEqual([row["score"] for row in rescored["scores_by_component"][1]], original)


if __name__ == "__main__":
    unittest.main()
