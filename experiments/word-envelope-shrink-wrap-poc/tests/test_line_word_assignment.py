from __future__ import annotations

import unittest

import numpy as np

from word_envelope.line_word_assignment import (
    assign_components_to_lines,
    assign_line_components_by_boundaries,
    build_line_frames,
    ink_valley_boundaries,
    locator_strip_assignment,
    midpoint_boundaries,
)


class LineWordAssignmentTests(unittest.TestCase):
    def fixture(self) -> tuple[dict, list[dict], dict]:
        components = [
            {"component_id": 1, "area_px": 30, "bbox_xywh": [10, 18, 18, 8], "center_xy": [19.0, 22.0]},
            {"component_id": 2, "area_px": 35, "bbox_xywh": [60, 18, 20, 8], "center_xy": [70.0, 22.0]},
            {"component_id": 3, "area_px": 32, "bbox_xywh": [12, 68, 18, 8], "center_xy": [21.0, 72.0]},
            {"component_id": 4, "area_px": 36, "bbox_xywh": [62, 68, 20, 8], "center_xy": [72.0, 72.0]},
        ]
        units = [
            {"unit_id": "a-1", "line_id": "a", "word_order": 1, "bbox_xywh": [5, 10, 35, 25]},
            {"unit_id": "a-2", "line_id": "a", "word_order": 2, "bbox_xywh": [48, 10, 42, 25]},
            {"unit_id": "b-1", "line_id": "b", "word_order": 1, "bbox_xywh": [5, 60, 35, 25]},
            {"unit_id": "b-2", "line_id": "b", "word_order": 2, "bbox_xywh": [48, 60, 42, 25]},
        ]
        centerlines = {
            "a": {"slope": 0.0, "intercept": 22.0, "scale_px": 8.0},
            "b": {"slope": 0.0, "intercept": 72.0, "scale_px": 8.0},
        }
        return build_line_frames(components, units, centerlines), units, centerlines

    def test_line_frame_and_midpoints_reduce_words_to_ordered_intervals(self) -> None:
        framed, _, _ = self.fixture()
        midpoint = midpoint_boundaries(framed["frames"]["a"])
        self.assertEqual(len(midpoint["boundaries_u"]), 1)
        self.assertGreater(midpoint["boundaries_u"][0], 40)
        self.assertLess(midpoint["boundaries_u"][0], 60)

    def test_nearest_line_then_midpoint_assigns_four_components_disjointly(self) -> None:
        framed, _, _ = self.fixture()
        lines = assign_components_to_lines(framed)
        boundaries = {line_id: midpoint_boundaries(frame) for line_id, frame in framed["frames"].items()}
        result = assign_line_components_by_boundaries(
            framed,
            lines,
            boundaries,
            abstain_on_boundary_crossing=False,
        )
        self.assertEqual(result["component_ids_by_unit"], {"a-1": [1], "a-2": [2], "b-1": [3], "b-2": [4]})

    def test_outer_line_does_not_absorb_distant_page_or_signature_component(self) -> None:
        framed, units, centerlines = self.fixture()
        raw = [
            {"component_id": value["component_id"], "area_px": value["area_px"], "bbox_xywh": value["bbox_xywh"], "center_xy": value["center_xy"]}
            for value in framed["components"].values()
        ]
        raw.extend(
            [
                {"component_id": 5, "area_px": 20, "bbox_xywh": [45, 0, 10, 4], "center_xy": [50.0, 2.0]},
                {"component_id": 6, "area_px": 20, "bbox_xywh": [45, 94, 10, 4], "center_xy": [50.0, 96.0]},
            ]
        )
        expanded = build_line_frames(raw, units, centerlines)
        result = assign_components_to_lines(expanded, maximum_spacing_fraction=0.35)
        self.assertIn(5, result["unsupported_component_ids"])
        self.assertIn(6, result["unsupported_component_ids"])

    def test_boundary_crossing_component_can_abstain(self) -> None:
        framed, units, centerlines = self.fixture()
        components = list(framed["components"].values())
        raw = [
            {"component_id": value["component_id"], "area_px": value["area_px"], "bbox_xywh": value["bbox_xywh"], "center_xy": value["center_xy"]}
            for value in components
        ]
        raw.append({"component_id": 5, "area_px": 50, "bbox_xywh": [38, 18, 24, 8], "center_xy": [50.0, 22.0]})
        expanded = build_line_frames(raw, units, centerlines)
        lines = assign_components_to_lines(expanded)
        boundaries = {line_id: midpoint_boundaries(frame) for line_id, frame in expanded["frames"].items()}
        result = assign_line_components_by_boundaries(expanded, lines, boundaries, abstain_on_boundary_crossing=True)
        self.assertIn(5, [row["component_id"] for row in result["ambiguous_components"]])

    def test_locator_strip_uses_line_before_rough_horizontal_overlap(self) -> None:
        framed, _, _ = self.fixture()
        lines = assign_components_to_lines(framed)
        result = locator_strip_assignment(framed, lines)
        self.assertEqual(result["component_ids_by_unit"]["a-1"], [1])
        self.assertEqual(result["component_ids_by_unit"]["b-2"], [4])

    def test_ink_valley_moves_cut_toward_blank_gap(self) -> None:
        framed, _, _ = self.fixture()
        frame = framed["frames"]["a"]
        ink = np.zeros((100, 120), dtype=bool)
        ink[18:27, 5:38] = True
        ink[18:27, 68:105] = True
        midpoint = midpoint_boundaries(frame)
        valley = ink_valley_boundaries(
            ink,
            frame,
            midpoint,
            band_half_height_px=20,
            search_fraction=0.40,
            smoothing_radius_px=3,
        )
        self.assertEqual(len(valley["boundaries_u"]), 1)
        self.assertGreater(valley["boundaries_u"][0], 38)
        self.assertLess(valley["boundaries_u"][0], 68)


if __name__ == "__main__":
    unittest.main()
