from __future__ import annotations

import unittest

import numpy as np

from word_envelope.fragmented_envelope import (
    fit_fragmented_envelope,
    refine_existing_envelope,
)
from word_envelope.local_ink_recovery import recover_local_ink_candidates


class LocalInkRecoveryTests(unittest.TestCase):
    def test_anchor_conditioned_candidates_are_nested_and_never_take_forbidden_ink(self) -> None:
        source = np.full((100, 180, 3), (224, 211, 184), dtype=np.uint8)
        source[45:51, 20:72] = (55, 73, 138)
        source[45:51, 79:132] = (90, 102, 154)
        source[16:23, 25:150] = (70, 74, 82)
        anchor = np.zeros((100, 180), dtype=bool)
        anchor[45:51, 20:72] = True
        forbidden = np.zeros_like(anchor)
        forbidden[16:23, 25:150] = True
        result = recover_local_ink_candidates(
            source,
            anchor,
            forbidden,
            [10, 25, 145, 50],
        )
        prior = np.zeros((50, 145), dtype=bool)
        for name in ("conservative", "balanced", "maximum_recall"):
            candidate = result["candidates"][name]
            self.assertTrue(np.all(prior <= candidate["additions"]))
            self.assertFalse(np.any(candidate["mask"] & forbidden[25:75, 10:155]))
            self.assertTrue(candidate["source_supported_only"])
            prior = candidate["additions"]
        self.assertGreater(result["candidates"]["maximum_recall"]["added_pixels"], 0)


class FragmentedEnvelopeTests(unittest.TestCase):
    def test_component_tree_wraps_many_islands_without_claiming_bridge_pixels(self) -> None:
        selected = np.zeros((90, 220), dtype=bool)
        selected[40:47, 15:58] = True
        selected[35:46, 82:126] = True
        selected[46:52, 152:204] = True
        excluded = np.zeros_like(selected)
        excluded[12:18, 80:140] = True
        result = fit_fragmented_envelope(selected, excluded)
        self.assertEqual(result["selected_component_count"], 3)
        for candidate in result["candidates"].values():
            self.assertEqual(candidate["selected_ink_coverage"], 1.0)
            self.assertEqual(candidate["excluded_ink_inside_pixels"], 0)
            self.assertTrue(candidate["geometry_bridges_are_not_owned_ink"])
            self.assertEqual(
                int(ndimage_label(candidate["region"])),
                1,
            )

    def test_existing_envelope_refinement_adds_stroke_relative_room(self) -> None:
        selected = np.zeros((70, 140), dtype=bool)
        selected[30:38, 20:112] = True
        polygon = [[18, 27], [115, 27], [115, 41], [18, 41]]
        result = refine_existing_envelope(selected, polygon)
        areas = [
            result["candidates"][name]["envelope_area_px2"]
            for name in ("compact", "balanced", "roomy")
        ]
        self.assertEqual(areas, sorted(areas))
        for candidate in result["candidates"].values():
            self.assertEqual(candidate["selected_ink_coverage"], 1.0)
            self.assertEqual(candidate["topology_source"], "existing_accepted_envelope")


def ndimage_label(mask: np.ndarray) -> int:
    from scipy import ndimage

    return int(ndimage.label(mask, structure=np.ones((3, 3), dtype=np.uint8))[1])


if __name__ == "__main__":
    unittest.main()
