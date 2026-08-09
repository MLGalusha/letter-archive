from __future__ import annotations

import unittest

import numpy as np

from word_envelope.line_ribbon_envelope import (
    fit_line_ribbon_envelope,
    fit_simplified_convex_envelope,
)


class LineRibbonEnvelopeTests(unittest.TestCase):
    def test_fragmented_sloped_word_gets_full_coverage_without_neighbor_ink(self) -> None:
        selected = np.zeros((100, 180), dtype=bool)
        for x0 in (12, 34, 63, 91, 118):
            y0 = 45 + x0 // 18
            selected[y0 : y0 + 8, x0 : x0 + 14] = True
        selected[38:42, 70:75] = True
        excluded = np.zeros_like(selected)
        excluded[26:34, 20:145] = True
        excluded[53:63, 145:164] = True

        result = fit_line_ribbon_envelope(selected, excluded)

        self.assertEqual(result["selected_ink_coverage"], 1.0)
        self.assertEqual(result["excluded_ink_inside_pixels"], 0)
        self.assertEqual(result["excluded_ink_contamination"], 0.0)
        self.assertGreater(result["polygon_point_count"], 4)
        self.assertTrue(any(trial["status"] == "accepted" for trial in result["trials"]))

    def test_simple_convex_candidate_balances_coverage_and_legibility(self) -> None:
        selected = np.zeros((110, 190), dtype=bool)
        for x0 in (14, 42, 76, 111, 143):
            selected[52:61, x0 : x0 + 17] = True
        excluded = np.zeros_like(selected)
        excluded[25:34, 20:170] = True

        result = fit_simplified_convex_envelope(selected, excluded)

        self.assertEqual(result["selected_ink_coverage"], 1.0)
        self.assertEqual(result["excluded_ink_inside_pixels"], 0)
        self.assertLessEqual(result["polygon_point_count"], 32)
        self.assertEqual(result["method"], "simplified_convex_hull")


if __name__ == "__main__":
    unittest.main()
