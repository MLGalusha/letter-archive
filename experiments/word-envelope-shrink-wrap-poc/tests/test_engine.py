from __future__ import annotations

import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

import numpy as np
from shapely.geometry import Polygon

from word_envelope.engine import (
    EnvelopeError,
    EnvelopeParams,
    canonicalize_polygon,
    map_polygon_from_source,
    map_polygon_to_source,
    wrap_envelope,
)


class EnvelopeEngineTests(unittest.TestCase):
    def test_deterministic_result_and_checksum(self) -> None:
        mask = horizontal_word()
        params = normal_params()
        first = wrap_envelope(mask, params, method="morphological")
        second = wrap_envelope(mask, params, method="morphological")
        self.assertEqual(first.as_record(), second.as_record())
        self.assertEqual(first.polygon_checksum, second.polygon_checksum)

    def test_deterministic_across_fresh_hash_seeded_processes(self) -> None:
        script = """
import json, numpy as np
from word_envelope.engine import EnvelopeParams, wrap_envelope
m=np.zeros((70,220),bool)
for x in (20,58,96,134,172): m[27:43,x:x+20]=1
p=EnvelopeParams(angle_degrees=0,along_bridge_px=22,cross_bridge_px=5,padding_px=5,maximum_envelope_fraction=.95)
r=wrap_envelope(m,p,method='morphological')
print(json.dumps(r.as_record(),sort_keys=True,separators=(',',':')))
"""
        root = Path(__file__).resolve().parents[1]
        environment = dict(os.environ)
        environment["PYTHONPATH"] = str(root / "src")
        outputs = []
        for seed in ("1", "987654"):
            environment["PYTHONHASHSEED"] = seed
            outputs.append(
                subprocess.check_output(
                    [sys.executable, "-c", script],
                    env=environment,
                    text=True,
                )
            )
        self.assertEqual(outputs[0], outputs[1])

    def test_disconnected_components_join(self) -> None:
        result = wrap_envelope(
            horizontal_word(), normal_params(), method="morphological"
        )
        self.assertEqual(result.envelope_component_count, 1)
        self.assertEqual(result.selected_ink_coverage, 1.0)
        self.assertEqual(result.selected_ink_support_coverage, 1.0)

    def test_direction_aware_bridge_joins_along_but_not_across(self) -> None:
        params = EnvelopeParams(
            angle_degrees=0,
            along_bridge_px=30,
            cross_bridge_px=4,
            padding_px=2,
            maximum_envelope_fraction=0.95,
        )
        horizontal = rectangles(
            (70, 70), [(10, 30, 20, 40), (45, 30, 55, 40)]
        )
        vertical = rectangles(
            (70, 70), [(30, 10, 40, 20), (30, 45, 40, 55)]
        )
        wrap_envelope(horizontal, params, method="morphological")
        with self.assertRaisesRegex(EnvelopeError, "disconnected islands"):
            wrap_envelope(vertical, params, method="morphological")

    def test_vertical_word_joins_only_with_vertical_axis(self) -> None:
        vertical = rectangles(
            (220, 70), [(27, y, 43, y + 20) for y in (20, 58, 96, 134, 172)]
        )
        vertical_params = EnvelopeParams(
            angle_degrees=90,
            along_bridge_px=22,
            cross_bridge_px=5,
            padding_px=5,
            maximum_envelope_fraction=0.95,
        )
        horizontal_params = EnvelopeParams(
            angle_degrees=0,
            along_bridge_px=22,
            cross_bridge_px=5,
            padding_px=5,
            maximum_envelope_fraction=0.95,
        )
        for method in ("morphological", "soft_union"):
            result = wrap_envelope(vertical, vertical_params, method=method)
            self.assertEqual(result.envelope_component_count, 1)
            self.assertEqual(result.selected_ink_support_coverage, 1.0)
            with self.assertRaisesRegex(EnvelopeError, "disconnected islands"):
                wrap_envelope(vertical, horizontal_params, method=method)

    def test_equivalent_vertical_angles_are_canonical(self) -> None:
        vertical = rectangles(
            (220, 70), [(27, y, 43, y + 20) for y in (20, 58, 96, 134, 172)]
        )
        for method in ("morphological", "soft_union"):
            records = []
            for angle in (90, -90, 270):
                result = wrap_envelope(
                    vertical,
                    EnvelopeParams(
                        angle_degrees=angle,
                        along_bridge_px=22,
                        cross_bridge_px=5,
                        padding_px=5,
                        maximum_envelope_fraction=0.95,
                    ),
                    method=method,
                )
                records.append(result.as_record())
            self.assertEqual(records[0], records[1])
            self.assertEqual(records[0], records[2])

    def test_detached_dot_is_preserved(self) -> None:
        mask = horizontal_word()
        mask[9:14, 96:101] = True
        params = EnvelopeParams(
            angle_degrees=0,
            along_bridge_px=24,
            cross_bridge_px=32,
            padding_px=6,
            maximum_envelope_fraction=0.95,
        )
        for method in ("morphological", "soft_union"):
            result = wrap_envelope(mask, params, method=method)
            self.assertEqual(result.selected_ink_support_coverage, 1.0)

    def test_neighbor_exclusion_has_zero_contamination(self) -> None:
        selected = horizontal_word()
        excluded = np.zeros_like(selected)
        excluded[10:25, 205:215] = True
        result = wrap_envelope(
            selected,
            normal_params(),
            method="morphological",
            excluded_mask=excluded,
        )
        self.assertEqual(result.excluded_ink_contamination, 0.0)

    def test_known_neighbor_contamination_over_limit_fails(self) -> None:
        selected = horizontal_word()
        excluded = np.zeros_like(selected)
        excluded[27:43, 172:192] = True
        with self.assertRaisesRegex(EnvelopeError, "Excluded-ink contamination"):
            wrap_envelope(
                selected,
                normal_params(),
                method="morphological",
                excluded_mask=excluded,
            )

    def test_small_swallowed_neighbor_is_not_diluted_by_distant_clutter(self) -> None:
        selected = horizontal_word()
        excluded = np.zeros_like(selected)
        excluded[33:35, 46:48] = True
        excluded[0:18, :] = True
        with self.assertRaisesRegex(EnvelopeError, "Excluded component contamination"):
            wrap_envelope(
                selected,
                normal_params(),
                method="morphological",
                excluded_mask=excluded,
            )

    def test_smoothing_keeps_polygon_simple_and_does_not_increase_perimeter(self) -> None:
        mask = horizontal_word()
        unsmoothed = wrap_envelope(
            mask,
            EnvelopeParams(
                **{**normal_params().as_record(), "smooth_iterations": 0}
            ),
            method="morphological",
        )
        smoothed = wrap_envelope(
            mask, normal_params(), method="morphological"
        )
        plain_shape = Polygon(unsmoothed.polygon)
        smooth_shape = Polygon(smoothed.polygon)
        self.assertTrue(smooth_shape.is_valid)
        self.assertTrue(smooth_shape.is_simple)
        self.assertLessEqual(smooth_shape.length, plain_shape.length + 1e-6)
        self.assertEqual(smoothed.selected_ink_support_coverage, 1.0)

    def test_soft_union_produces_valid_outer_envelope(self) -> None:
        result = wrap_envelope(horizontal_word(), normal_params(), method="soft_union")
        shape = Polygon(result.polygon)
        self.assertTrue(shape.is_valid)
        self.assertEqual(len(shape.interiors), 0)
        self.assertEqual(result.selected_ink_coverage, 1.0)

    def test_crop_source_translation_round_trips_exactly(self) -> None:
        polygon = ((0.0, 0.0), (12.25, 1.5), (9.0, 18.0), (0.0, 0.0))
        source = map_polygon_to_source(polygon, crop_x=901, crop_y=2451)
        recovered = map_polygon_from_source(source, crop_x=901, crop_y=2451)
        self.assertEqual(polygon, recovered)

    def test_rough_box_must_contain_selected_ink_and_envelope(self) -> None:
        with self.assertRaisesRegex(EnvelopeError, "Rough box"):
            wrap_envelope(
                horizontal_word(),
                normal_params(),
                method="morphological",
                rough_box=(0, 0, 15, 15),
            )

    def test_canonical_ring_is_start_and_direction_invariant(self) -> None:
        first = [(1, 1), (7, 1), (7, 5), (1, 5), (1, 1)]
        shifted = [(7, 5), (1, 5), (1, 1), (7, 1), (7, 5)]
        reversed_ring = list(reversed(first))
        self.assertEqual(canonicalize_polygon(first), canonicalize_polygon(shifted))
        self.assertEqual(canonicalize_polygon(first), canonicalize_polygon(reversed_ring))

    def test_empty_and_invalid_masks_fail(self) -> None:
        with self.assertRaisesRegex(EnvelopeError, "empty"):
            wrap_envelope(
                np.zeros((20, 20), dtype=bool),
                EnvelopeParams(),
                method="morphological",
            )
        with self.assertRaisesRegex(EnvelopeError, "2D"):
            wrap_envelope(
                np.ones((2, 2, 2), dtype=bool),
                EnvelopeParams(),
                method="morphological",
            )
        with self.assertRaisesRegex(EnvelopeError, "finite number"):
            wrap_envelope(
                horizontal_word(),
                EnvelopeParams(maximum_envelope_to_ink_area_ratio=float("nan")),
                method="morphological",
            )
        with self.assertRaisesRegex(EnvelopeError, "must be an integer"):
            wrap_envelope(
                horizontal_word(),
                EnvelopeParams(smooth_iterations=1.5),
                method="morphological",
            )

    def test_excessively_broad_parameters_fail(self) -> None:
        with self.assertRaisesRegex(EnvelopeError, "excessively broad"):
            wrap_envelope(
                horizontal_word(),
                EnvelopeParams(padding_px=30),
                method="morphological",
            )

    def test_large_morphology_footprint_fails_before_allocation(self) -> None:
        mask = np.zeros((300, 300), dtype=bool)
        mask[140:150, 100:110] = True
        mask[140:150, 180:190] = True
        with self.assertRaisesRegex(EnvelopeError, "safe POC limit"):
            wrap_envelope(
                mask,
                EnvelopeParams(
                    angle_degrees=0,
                    along_bridge_px=120,
                    cross_bridge_px=100,
                    padding_px=5,
                    maximum_envelope_fraction=0.99,
                ),
                method="morphological",
            )

    def test_large_soft_union_kernel_fails_before_allocation(self) -> None:
        mask = np.zeros((300, 300), dtype=bool)
        mask[140:150, 100:110] = True
        mask[140:150, 180:190] = True
        with self.assertRaisesRegex(EnvelopeError, "safe POC limit"):
            wrap_envelope(
                mask,
                EnvelopeParams(
                    angle_degrees=0,
                    along_bridge_px=120,
                    cross_bridge_px=100,
                    padding_px=5,
                    maximum_envelope_fraction=0.99,
                ),
                method="soft_union",
            )

    def test_tiny_speck_is_rejected(self) -> None:
        mask = np.zeros((50, 100), dtype=bool)
        mask[25, 50] = True
        with self.assertRaisesRegex(EnvelopeError, "minimum"):
            wrap_envelope(
                mask,
                EnvelopeParams(
                    angle_degrees=0,
                    maximum_envelope_fraction=0.99,
                ),
                method="morphological",
            )

    def test_border_touching_ink_requests_crop_expansion(self) -> None:
        mask = np.zeros((50, 100), dtype=bool)
        mask[20:30, 0:20] = True
        with self.assertRaisesRegex(EnvelopeError, "expand the crop"):
            wrap_envelope(
                mask,
                EnvelopeParams(
                    angle_degrees=0,
                    padding_px=3,
                    maximum_envelope_fraction=0.99,
                ),
                method="morphological",
            )


def horizontal_word() -> np.ndarray:
    return rectangles(
        (70, 220),
        [(x, 27, x + 20, 43) for x in (20, 58, 96, 134, 172)],
    )


def normal_params() -> EnvelopeParams:
    return EnvelopeParams(
        angle_degrees=0,
        along_bridge_px=22,
        cross_bridge_px=5,
        padding_px=5,
        smooth_iterations=2,
        maximum_envelope_fraction=0.95,
    )


def rectangles(
    shape: tuple[int, int], values: list[tuple[int, int, int, int]]
) -> np.ndarray:
    mask = np.zeros(shape, dtype=bool)
    for x1, y1, x2, y2 in values:
        mask[y1:y2, x1:x2] = True
    return mask


if __name__ == "__main__":
    unittest.main()
