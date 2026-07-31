from __future__ import annotations

import copy
import unittest

from PIL import Image

from rotation_geometry import (
    merge_rotation_passes,
    rotate_image,
    transform_point_to_source,
    transform_segmentation_to_source,
    validate_rotations,
)


def _line(
    line_id: str,
    boundary: list[list[int]],
    baseline: list[list[int]],
    ordinal: int = 0,
) -> dict:
    return {
        "id": line_id,
        "type": "baselines",
        "boundary": boundary,
        "baseline": baseline,
        "regions": [],
        "providerOrdinal": ordinal,
    }


def _segmentation(*lines: dict) -> dict:
    return {
        "type": "baselines",
        "textDirection": "horizontal-lr",
        "scriptDetection": False,
        "lineOrders": [],
        "language": None,
        "regions": {},
        "lines": list(lines),
    }


def _outcome(
    rotation: int,
    status: str = "succeeded",
    *,
    fallback: bool = False,
) -> dict:
    attempts = [
        {
            "raiseOnError": True,
            "outcome": "succeeded" if status == "succeeded" else "failed",
        }
    ]
    if fallback:
        attempts.append(
            {
                "raiseOnError": False,
                "outcome": "succeeded" if status == "partial" else "failed",
            }
        )
    return {
        "rotationDegrees": rotation,
        "status": status,
        "error": (
            None
            if status == "succeeded"
            else {"type": "ProviderError", "message": f"{rotation} failed"}
        ),
        "attempts": attempts,
    }


def _safe_zone_parameters() -> dict:
    return {
        "verticalAxisToleranceDegrees": 15,
        "strongBaselineLongEdgeRatio": 0.025,
        "zoneJoinPaddingLongEdgeRatio": 0.06,
        "zoneMemberPaddingLongEdgeRatio": 0.02,
        "minimumStrongProposalClustersPerZone": 2,
        "minimumProposalClustersPerZone": 3,
        "baselineInterferencePaddingLongEdgeRatio": 0,
        "baselineInterferenceHorizontalAxisToleranceDegrees": 20,
        "maximumHorizontalBaselineCentroidRatioPerZone": 0.1,
        "minimumHorizontalBaselineCentroidAllowancePerZone": 2,
    }


class RotationTransformTests(unittest.TestCase):
    def test_rotated_pixel_corners_map_back_to_source(self) -> None:
        width = 4
        height = 3
        expected = {
            0: {
                (0, 0): [0, 0],
                (3, 2): [3, 2],
            },
            90: {
                (0, 0): [3, 0],
                (2, 3): [0, 2],
            },
            180: {
                (0, 0): [3, 2],
                (3, 2): [0, 0],
            },
            270: {
                (0, 0): [0, 2],
                (2, 3): [3, 0],
            },
        }
        for rotation, cases in expected.items():
            for point, source_point in cases.items():
                with self.subTest(rotation=rotation, point=point):
                    self.assertEqual(
                        transform_point_to_source(
                            point,
                            rotation=rotation,
                            source_width=width,
                            source_height=height,
                        ),
                        source_point,
                    )

    def test_pil_rotation_dimensions_match_contract(self) -> None:
        image = Image.new("RGB", (4, 3))
        self.assertEqual(rotate_image(image, 0).size, (4, 3))
        self.assertEqual(rotate_image(image, 90).size, (3, 4))
        self.assertEqual(rotate_image(image, 180).size, (4, 3))
        self.assertEqual(rotate_image(image, 270).size, (3, 4))

    def test_every_rotated_pixel_round_trips_to_the_declared_source_point(
        self,
    ) -> None:
        width, height = 7, 5
        image = Image.new("I", (width, height))
        for source_y in range(height):
            for source_x in range(width):
                image.putpixel(
                    (source_x, source_y),
                    source_y * width + source_x,
                )

        for rotation in (0, 90, 180, 270):
            rotated = rotate_image(image, rotation)
            for rotated_y in range(rotated.height):
                for rotated_x in range(rotated.width):
                    source_x, source_y = transform_point_to_source(
                        (rotated_x, rotated_y),
                        rotation=rotation,
                        source_width=width,
                        source_height=height,
                    )
                    with self.subTest(
                        rotation=rotation,
                        rotated_x=rotated_x,
                        rotated_y=rotated_y,
                    ):
                        self.assertEqual(
                            rotated.getpixel((rotated_x, rotated_y)),
                            image.getpixel((source_x, source_y)),
                        )

    def test_provider_ids_and_region_references_are_pass_scoped(self) -> None:
        segmentation = {
            **_segmentation(
                {
                    **_line(
                        "line-a",
                        [[0, 0], [2, 0], [2, 1], [0, 1]],
                        [[0, 0], [2, 0]],
                    ),
                    "regions": ["region-a"],
                }
            ),
            "regions": {
                "text": [
                    {
                        "id": "region-a",
                        "boundary": [[0, 0], [2, 0], [2, 1], [0, 1]],
                        "providerOrdinal": 0,
                    }
                ]
            },
        }
        result = transform_segmentation_to_source(
            segmentation,
            rotation=180,
            source_width=4,
            source_height=3,
        )
        self.assertEqual(result["lines"][0]["id"], "rot180:line-a")
        self.assertEqual(
            result["lines"][0]["regions"], ["rot180:region-a"]
        )
        self.assertEqual(
            result["regions"]["text"][0]["id"], "rot180:region-a"
        )

    def test_rotation_validation_rejects_ambiguous_profiles(self) -> None:
        self.assertEqual(validate_rotations([0, 90, 180, 270]), (0, 90, 180, 270))
        for invalid in ([], [90], [0, 90, 90], [0, 45]):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                validate_rotations(invalid)


class RotationMergeTests(unittest.TestCase):
    def test_raw_pass_keeps_untouched_native_and_separate_source_projection(
        self,
    ) -> None:
        native = _segmentation(
            _line(
                "side-note",
                [[20, 5], [80, 5], [80, 15], [20, 15]],
                [[20, 10], [80, 10]],
            )
        )
        original = copy.deepcopy(native)
        result = merge_rotation_passes(
            [_segmentation(), native],
            rotations=[0, 90],
            source_width=100,
            source_height=100,
            merge_policy="evidence-union",
            pass_outcomes=[_outcome(0), _outcome(90)],
        )

        record = result["rotationPasses"][1]
        self.assertEqual(native, original)
        self.assertEqual(record["nativeSegmentation"], original)
        self.assertEqual(
            record["nativeSegmentation"]["lines"][0]["baseline"],
            [[20, 10], [80, 10]],
        )
        self.assertEqual(
            record["sourceProjectedSegmentation"]["lines"][0]["baseline"],
            [[89, 20], [89, 80]],
        )
        self.assertEqual(
            record["nativeSegmentation"]["lines"][0]["id"], "side-note"
        )
        self.assertEqual(
            record["sourceProjectedSegmentation"]["lines"][0]["id"],
            "rot90:side-note",
        )
        self.assertEqual(
            record["coordinateTransform"]["version"],
            "pil-pixel-centers-to-source-v1",
        )
        self.assertEqual(
            record["nativeImage"],
            {
                "width": 100,
                "height": 100,
                "coordinateSpace": "rotated-input-pixels-top-left",
            },
        )

    def test_baseline_plus_policy_records_quality_failure_when_zero_pass_fails(
        self,
    ) -> None:
        result = merge_rotation_passes(
            [_segmentation(), _segmentation()],
            rotations=[0, 90],
            source_width=100,
            source_height=100,
            merge_policy="baseline-plus-consensus",
            pass_outcomes=[_outcome(0, "failed"), _outcome(90)],
        )

        self.assertEqual(
            result["qualityError"]["code"],
            "ROTATION_BASELINE_PASS_NOT_SUCCEEDED",
        )
        self.assertEqual(result["rotationPasses"][0]["status"], "failed")

    def test_partial_pass_geometry_remains_raw_and_is_never_displayed(
        self,
    ) -> None:
        baseline = _line(
            "baseline",
            [[100, 100], [500, 100], [500, 120], [100, 120]],
            [[100, 110], [500, 110]],
        )
        partial_first = _line(
            "partial-first",
            [[95, 790], [225, 790], [225, 808], [95, 808]],
            [[100, 799], [220, 799]],
        )
        partial_second = _line(
            "partial-second",
            [[105, 730], [230, 730], [230, 748], [105, 748]],
            [[110, 739], [220, 739]],
        )
        result = merge_rotation_passes(
            [
                _segmentation(baseline),
                _segmentation(partial_first, partial_second),
                _segmentation(),
            ],
            rotations=[0, 90, 270],
            source_width=1_000,
            source_height=1_600,
            merge_policy="baseline-plus-vertical-zones",
            pass_outcomes=[
                _outcome(0),
                _outcome(90, "partial", fallback=True),
                _outcome(270),
            ],
        )

        self.assertIsNone(result["qualityError"])
        self.assertEqual(
            [line["id"] for line in result["segmentation"]["lines"]],
            ["rot0:baseline"],
        )
        self.assertEqual(
            result["segmentation"]["rotationEnsemble"][
                "excludedInputLineCount"
            ],
            2,
        )
        partial_record = result["rotationPasses"][1]
        self.assertEqual(partial_record["status"], "partial")
        self.assertEqual(
            len(partial_record["nativeSegmentation"]["lines"]), 2
        )
        self.assertEqual(
            len(partial_record["sourceProjectedSegmentation"]["lines"]), 2
        )
        self.assertEqual(
            partial_record["fallback"],
            {"attempted": True, "outcome": "succeeded"},
        )

    def test_successful_pass_is_the_only_eligible_representative(
        self,
    ) -> None:
        partial_90 = _line(
            "partial-90",
            [[20, 5], [80, 5], [80, 15], [20, 15]],
            [[20, 10], [80, 10]],
        )
        successful_270 = _line(
            "successful-270",
            [[19, 84], [79, 84], [79, 94], [19, 94]],
            [[19, 89], [79, 89]],
        )
        result = merge_rotation_passes(
            [
                _segmentation(),
                _segmentation(partial_90),
                _segmentation(successful_270),
            ],
            rotations=[0, 90, 270],
            source_width=100,
            source_height=100,
            merge_policy="evidence-union",
            pass_outcomes=[
                _outcome(0),
                _outcome(90, "partial", fallback=True),
                _outcome(270),
            ],
        )

        self.assertEqual(len(result["segmentation"]["lines"]), 1)
        evidence = result["segmentation"]["lines"][0]["ensembleEvidence"]
        self.assertEqual(evidence["representativeRotationDegrees"], 270)
        self.assertEqual(evidence["sourceRotationsDegrees"], [270])
        self.assertEqual(evidence["sourcePassStatuses"], ["succeeded"])

    def test_union_keeps_unrotated_geometry_as_representative(self) -> None:
        baseline = _line(
            "normal",
            [[10, 10], [90, 10], [90, 20], [10, 20]],
            [[10, 15], [90, 15]],
        )
        rotated_equivalent = _line(
            "rotated",
            [[10, 79], [90, 79], [90, 89], [10, 89]],
            [[10, 84], [90, 84]],
        )
        result = merge_rotation_passes(
            [
                _segmentation(baseline),
                _segmentation(rotated_equivalent),
            ],
            rotations=[0, 180],
            source_width=100,
            source_height=100,
            merge_policy="evidence-union",
        )
        lines = result["segmentation"]["lines"]
        self.assertEqual(len(lines), 1)
        self.assertEqual(lines[0]["id"], "rot0:normal")
        self.assertEqual(
            lines[0]["ensembleEvidence"]["sourceRotationsDegrees"],
            [0, 180],
        )
        self.assertEqual(
            lines[0]["ensembleEvidence"]["representativeRotationDegrees"],
            0,
        )

    def test_union_adds_vertical_line_found_only_after_rotation(self) -> None:
        vertical_in_rotated_coordinates = _line(
            "side-note",
            [[20, 5], [80, 5], [80, 15], [20, 15]],
            [[20, 10], [80, 10]],
        )
        result = merge_rotation_passes(
            [
                _segmentation(),
                _segmentation(vertical_in_rotated_coordinates),
            ],
            rotations=[0, 90],
            source_width=100,
            source_height=100,
            merge_policy="evidence-union",
        )
        line = result["segmentation"]["lines"][0]
        self.assertEqual(
            line["ensembleEvidence"]["sourceRotationsDegrees"], [90]
        )
        self.assertEqual(line["regions"], [])
        xs = [point[0] for point in line["baseline"]]
        ys = [point[1] for point in line["baseline"]]
        self.assertEqual(xs, [89, 89])
        self.assertEqual(ys, [20, 80])

    def test_consensus_keeps_baseline_and_rejects_single_pass_addition(self) -> None:
        baseline = _line(
            "baseline",
            [[5, 5], [50, 5], [50, 10], [5, 10]],
            [[5, 8], [50, 8]],
        )
        unmatched = _line(
            "unmatched",
            [[10, 70], [60, 70], [60, 80], [10, 80]],
            [[10, 75], [60, 75]],
        )
        result = merge_rotation_passes(
            [
                _segmentation(baseline),
                _segmentation(unmatched),
            ],
            rotations=[0, 180],
            source_width=100,
            source_height=100,
            merge_policy="baseline-plus-consensus",
        )
        self.assertEqual(len(result["segmentation"]["lines"]), 1)
        self.assertEqual(
            result["segmentation"]["rotationEnsemble"][
                "rejectedClusterCount"
            ],
            1,
        )

    def test_cluster_never_collapses_two_lines_from_the_same_pass(self) -> None:
        first = _line(
            "first",
            [[0, 10], [40, 10], [40, 20], [0, 20]],
            [[0, 15], [40, 15]],
            0,
        )
        second = _line(
            "second",
            [[35, 10], [80, 10], [80, 20], [35, 20]],
            [[35, 15], [80, 15]],
            1,
        )
        bridge = _line(
            "bridge",
            [[0, 79], [80, 79], [80, 89], [0, 89]],
            [[0, 84], [80, 84]],
        )
        result = merge_rotation_passes(
            [
                _segmentation(first, second),
                _segmentation(bridge),
            ],
            rotations=[0, 180],
            source_width=100,
            source_height=100,
            merge_policy="evidence-union",
        )
        clusters = result["segmentation"]["lines"]
        self.assertEqual(len(clusters), 2)
        self.assertEqual(
            sum(
                line["ensembleEvidence"]["supportCount"] == 2
                for line in clusters
            ),
            1,
        )

    def test_vertical_zone_policy_keeps_supported_zone_not_isolated_noise(
        self,
    ) -> None:
        baseline = _line(
            "baseline",
            [[100, 100], [500, 100], [500, 120], [100, 120]],
            [[100, 110], [500, 110]],
        )
        # These are expressed in the 90°-rotated raster. They map back to
        # nearby vertical lines around source x=200 and x=260.
        first_strong = _line(
            "first-strong",
            [[95, 790], [225, 790], [225, 808], [95, 808]],
            [[100, 799], [220, 799]],
            0,
        )
        second_strong = _line(
            "second-strong",
            [[105, 730], [230, 730], [230, 748], [105, 748]],
            [[110, 739], [220, 739]],
            1,
        )
        nearby_short = _line(
            "nearby-short",
            [[145, 715], [175, 715], [175, 733], [145, 733]],
            [[150, 724], [170, 724]],
            2,
        )
        isolated_strong = _line(
            "isolated-noise",
            [[795, 290], [925, 290], [925, 308], [795, 308]],
            [[800, 299], [920, 299]],
            3,
        )
        result = merge_rotation_passes(
            [
                _segmentation(baseline),
                _segmentation(
                    first_strong,
                    second_strong,
                    nearby_short,
                    isolated_strong,
                ),
                _segmentation(),
            ],
            rotations=[0, 90, 270],
            source_width=1_000,
            source_height=1_600,
            merge_policy="baseline-plus-vertical-zones",
            pass_outcomes=[
                _outcome(0),
                _outcome(90),
                _outcome(270),
            ],
        )
        lines = result["segmentation"]["lines"]
        provider_ids = {line["id"] for line in lines}
        self.assertEqual(len(lines), 4)
        self.assertIn("rot0:baseline", provider_ids)
        self.assertIn("rot90:first-strong", provider_ids)
        self.assertIn("rot90:second-strong", provider_ids)
        self.assertIn("rot90:nearby-short", provider_ids)
        self.assertNotIn("rot90:isolated-noise", provider_ids)
        evidence = result["segmentation"]["rotationEnsemble"][
            "selectionEvidence"
        ]
        self.assertEqual(evidence["strongVerticalCandidateCount"], 3)
        self.assertEqual(evidence["acceptedVerticalClusterCount"], 3)
        self.assertEqual(len(evidence["zones"]), 1)
        self.assertFalse(evidence["independentRotationConsensusRequired"])
        self.assertIn("one fully successful rotated pass", evidence["supportSemantics"])
        self.assertEqual(
            evidence["contributingSuccessfulRotationsDegrees"], [90]
        )
        self.assertEqual(
            evidence["zones"][0][
                "contributingSuccessfulRotationsDegrees"
            ],
            [90],
        )

    def test_safe_vertical_zone_accepts_three_proposals_with_limited_baseline_overlap(
        self,
    ) -> None:
        baseline_first = _line(
            "baseline-first",
            [[180, 130], [300, 130], [300, 150], [180, 150]],
            [[180, 140], [300, 140]],
            0,
        )
        baseline_second = _line(
            "baseline-second",
            [[180, 170], [300, 170], [300, 190], [180, 190]],
            [[180, 180], [300, 180]],
            1,
        )
        vertical_baseline_fragment = _line(
            "vertical-baseline-fragment",
            [[236, 150], [244, 150], [244, 165], [236, 165]],
            [[240, 150], [240, 165]],
            2,
        )
        rotated_proposals = [
            _line(
                f"proposal-{index}",
                [
                    [95, native_y - 9],
                    [225, native_y - 9],
                    [225, native_y + 9],
                    [95, native_y + 9],
                ],
                [[100, native_y], [220, native_y]],
                index,
            )
            for index, native_y in enumerate((799, 739, 679))
        ]
        result = merge_rotation_passes(
            [
                _segmentation(
                    baseline_first,
                    baseline_second,
                    vertical_baseline_fragment,
                ),
                _segmentation(*rotated_proposals),
                _segmentation(),
            ],
            rotations=[0, 90, 270],
            source_width=1_000,
            source_height=1_600,
            merge_policy="baseline-plus-nonoverlapping-vertical-zones",
            pass_outcomes=[
                _outcome(0),
                _outcome(90),
                _outcome(270),
            ],
            selection_parameters=_safe_zone_parameters(),
        )

        self.assertEqual(len(result["segmentation"]["lines"]), 6)
        evidence = result["segmentation"]["rotationEnsemble"][
            "selectionEvidence"
        ]
        self.assertEqual(evidence["acceptedZoneCount"], 1)
        self.assertEqual(evidence["rejectedZoneCount"], 0)
        self.assertEqual(
            evidence["zones"][0]["horizontalBaselineInterference"][
                "centroidCount"
            ],
            2,
        )
        self.assertTrue(evidence["zones"][0]["accepted"])
        self.assertEqual(evidence["zones"][0]["rejectionReasons"], [])

    def test_safe_vertical_zone_rejects_typed_like_baseline_interference(
        self,
    ) -> None:
        baselines = [
            _line(
                f"baseline-{index}",
                [
                    [180, source_y - 10],
                    [300, source_y - 10],
                    [300, source_y + 10],
                    [180, source_y + 10],
                ],
                [[180, source_y], [300, source_y]],
                index,
            )
            for index, source_y in enumerate((130, 160, 190))
        ]
        rotated_proposals = [
            _line(
                f"proposal-{index}",
                [
                    [95, native_y - 9],
                    [225, native_y - 9],
                    [225, native_y + 9],
                    [95, native_y + 9],
                ],
                [[100, native_y], [220, native_y]],
                index,
            )
            for index, native_y in enumerate((799, 739, 679))
        ]
        result = merge_rotation_passes(
            [
                _segmentation(*baselines),
                _segmentation(*rotated_proposals),
                _segmentation(),
            ],
            rotations=[0, 90, 270],
            source_width=1_000,
            source_height=1_600,
            merge_policy="baseline-plus-nonoverlapping-vertical-zones",
            selection_parameters=_safe_zone_parameters(),
        )

        self.assertEqual(len(result["segmentation"]["lines"]), 3)
        evidence = result["segmentation"]["rotationEnsemble"][
            "selectionEvidence"
        ]
        self.assertEqual(evidence["acceptedZoneCount"], 0)
        self.assertEqual(evidence["rejectedZoneCount"], 1)
        zone = evidence["zones"][0]
        self.assertFalse(zone["accepted"])
        self.assertEqual(
            zone["rejectionReasons"],
            ["SUBSTANTIAL_HORIZONTAL_BASELINE_INTERFERENCE"],
        )
        self.assertEqual(
            zone["horizontalBaselineInterference"]["centroidCount"], 3
        )
        self.assertEqual(
            evidence["rejectedVerticalClusterIndexes"],
            zone["includedClusterIndexes"],
        )

    def test_safe_vertical_zone_rejects_only_two_proposals(
        self,
    ) -> None:
        rotated_proposals = [
            _line(
                f"proposal-{index}",
                [
                    [95, native_y - 9],
                    [225, native_y - 9],
                    [225, native_y + 9],
                    [95, native_y + 9],
                ],
                [[100, native_y], [220, native_y]],
                index,
            )
            for index, native_y in enumerate((799, 739))
        ]
        result = merge_rotation_passes(
            [
                _segmentation(),
                _segmentation(*rotated_proposals),
                _segmentation(),
            ],
            rotations=[0, 90, 270],
            source_width=1_000,
            source_height=1_600,
            merge_policy="baseline-plus-nonoverlapping-vertical-zones",
            selection_parameters=_safe_zone_parameters(),
        )

        self.assertEqual(result["segmentation"]["lines"], [])
        evidence = result["segmentation"]["rotationEnsemble"][
            "selectionEvidence"
        ]
        self.assertEqual(evidence["acceptedZoneCount"], 0)
        self.assertEqual(evidence["rejectedZoneCount"], 1)
        self.assertEqual(
            evidence["zones"][0]["rejectionReasons"],
            ["INSUFFICIENT_PROPOSAL_CLUSTERS"],
        )

    def test_safe_vertical_zone_requires_complete_explicit_parameters(
        self,
    ) -> None:
        for invalid in (
            None,
            {},
            {
                **_safe_zone_parameters(),
                "minimumHorizontalBaselineCentroidAllowancePerZone": -1,
            },
            {
                **_safe_zone_parameters(),
                "unexpected": 1,
            },
        ):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                merge_rotation_passes(
                    [_segmentation(), _segmentation(), _segmentation()],
                    rotations=[0, 90, 270],
                    source_width=100,
                    source_height=100,
                    merge_policy=(
                        "baseline-plus-nonoverlapping-vertical-zones"
                    ),
                    selection_parameters=invalid,
                )


if __name__ == "__main__":
    unittest.main()
