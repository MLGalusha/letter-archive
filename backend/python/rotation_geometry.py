"""Deterministic image rotation, source projection, and geometry merging."""

from __future__ import annotations

import copy
import math
from dataclasses import dataclass
from typing import Any, Iterable

from PIL import Image


SUPPORTED_ROTATIONS = (0, 90, 180, 270)
COORDINATE_TRANSFORM_VERSION = "pil-pixel-centers-to-source-v1"
ROTATION_EVIDENCE_CONTRACT = "native-and-source-projected-v2"
PASS_STATUSES = ("succeeded", "partial", "failed")
MERGE_POLICIES = (
    "evidence-union",
    "baseline-plus-consensus",
    "baseline-plus-vertical-zones",
    "baseline-plus-nonoverlapping-vertical-zones",
)

SAFE_VERTICAL_ZONE_PARAMETER_KEYS = (
    "verticalAxisToleranceDegrees",
    "strongBaselineLongEdgeRatio",
    "zoneJoinPaddingLongEdgeRatio",
    "zoneMemberPaddingLongEdgeRatio",
    "minimumStrongProposalClustersPerZone",
    "minimumProposalClustersPerZone",
    "baselineInterferencePaddingLongEdgeRatio",
    "baselineInterferenceHorizontalAxisToleranceDegrees",
    "maximumHorizontalBaselineCentroidRatioPerZone",
    "minimumHorizontalBaselineCentroidAllowancePerZone",
)


@dataclass(frozen=True)
class _Candidate:
    index: int
    rotation: int
    line: dict[str, Any]


@dataclass(frozen=True)
class _ProjectedGeometry:
    axis_degrees: float
    along_min: float
    along_max: float
    normal_min: float
    normal_max: float

    @property
    def along_length(self) -> float:
        return max(0.0, self.along_max - self.along_min)

    @property
    def normal_center(self) -> float:
        return (self.normal_min + self.normal_max) / 2

    @property
    def normal_thickness(self) -> float:
        return max(0.0, self.normal_max - self.normal_min)


@dataclass(frozen=True)
class _MatchEvidence:
    score: float
    orientation_difference_degrees: float
    along_overlap_ratio: float
    normal_distance_px: float
    normal_tolerance_px: float


def validate_rotations(value: Iterable[int]) -> tuple[int, ...]:
    rotations = tuple(int(rotation) for rotation in value)
    if not rotations:
        raise ValueError("At least one rotation is required")
    if len(set(rotations)) != len(rotations):
        raise ValueError("Rotation values must be unique")
    unsupported = [
        rotation for rotation in rotations if rotation not in SUPPORTED_ROTATIONS
    ]
    if unsupported:
        raise ValueError(
            f"Unsupported rotations {unsupported}; expected 0, 90, 180, or 270"
        )
    if 0 not in rotations:
        raise ValueError("Rotation ensembles must retain the unrotated 0° pass")
    return rotations


def validate_merge_selection_parameters(
    merge_policy: str,
    value: dict[str, Any] | None,
) -> dict[str, float | int] | None:
    if merge_policy == "baseline-plus-nonoverlapping-vertical-zones":
        return _safe_vertical_zone_parameters(value)
    _reject_unexpected_selection_parameters(merge_policy, value)
    return None


def rotate_image(image: Image.Image, rotation: int) -> Image.Image:
    if rotation == 0:
        return image
    transpose = {
        90: Image.Transpose.ROTATE_90,
        180: Image.Transpose.ROTATE_180,
        270: Image.Transpose.ROTATE_270,
    }.get(rotation)
    if transpose is None:
        raise ValueError(f"Unsupported rotation {rotation}")
    return image.transpose(transpose)


def transform_point_to_source(
    point: Iterable[float],
    *,
    rotation: int,
    source_width: int,
    source_height: int,
) -> list[int]:
    x, y = (float(value) for value in point)
    max_x = source_width - 1
    max_y = source_height - 1
    if rotation == 0:
        source_x, source_y = x, y
    elif rotation == 90:
        source_x, source_y = max_x - y, x
    elif rotation == 180:
        source_x, source_y = max_x - x, max_y - y
    elif rotation == 270:
        source_x, source_y = y, max_y - x
    else:
        raise ValueError(f"Unsupported rotation {rotation}")
    return [
        min(max(int(round(source_x)), 0), max_x),
        min(max(int(round(source_y)), 0), max_y),
    ]


def transform_segmentation_to_source(
    segmentation: dict[str, Any],
    *,
    rotation: int,
    source_width: int,
    source_height: int,
) -> dict[str, Any]:
    transformed = copy.deepcopy(segmentation)
    transformed["sourceRotationDegrees"] = rotation

    transformed_regions: dict[str, list[dict[str, Any]]] = {}
    region_id_map: dict[str, str] = {}
    regions = transformed.get("regions")
    if isinstance(regions, dict):
        for region_class, values in regions.items():
            if not isinstance(values, list):
                continue
            transformed_regions[str(region_class)] = []
            for ordinal, value in enumerate(values):
                if not isinstance(value, dict):
                    continue
                region = copy.deepcopy(value)
                provider_id = str(region.get("id") or f"region-{ordinal}")
                transformed_id = f"rot{rotation}:{provider_id}"
                region_id_map[provider_id] = transformed_id
                region["id"] = transformed_id
                region["boundary"] = _transform_points(
                    region.get("boundary"),
                    rotation=rotation,
                    source_width=source_width,
                    source_height=source_height,
                )
                region["ensembleEvidence"] = {
                    "sourceRotationDegrees": rotation,
                    "sourceProviderOrdinal": region.get(
                        "providerOrdinal", ordinal
                    ),
                }
                transformed_regions[str(region_class)].append(region)
    transformed["regions"] = transformed_regions

    transformed_lines: list[dict[str, Any]] = []
    lines = transformed.get("lines")
    if isinstance(lines, list):
        for ordinal, value in enumerate(lines):
            if not isinstance(value, dict):
                continue
            line = copy.deepcopy(value)
            provider_id = str(line.get("id") or f"line-{ordinal}")
            line["id"] = f"rot{rotation}:{provider_id}"
            line["boundary"] = _transform_points(
                line.get("boundary"),
                rotation=rotation,
                source_width=source_width,
                source_height=source_height,
            )
            line["baseline"] = _transform_points(
                line.get("baseline"),
                rotation=rotation,
                source_width=source_width,
                source_height=source_height,
            )
            if line.get("bbox") is not None:
                line["bbox"] = _transform_bbox(
                    line["bbox"],
                    rotation=rotation,
                    source_width=source_width,
                    source_height=source_height,
                )
            raw_regions = line.get("regions")
            line["regions"] = (
                [
                    region_id_map.get(str(region_id), f"rot{rotation}:{region_id}")
                    for region_id in raw_regions
                ]
                if isinstance(raw_regions, list)
                else []
            )
            line["ensembleEvidence"] = {
                "sourceRotationDegrees": rotation,
                "sourceProviderOrdinal": line.get("providerOrdinal", ordinal),
                "sourceProviderId": provider_id,
            }
            transformed_lines.append(line)
    transformed["lines"] = transformed_lines
    return transformed


def merge_rotation_passes(
    passes: list[dict[str, Any]],
    *,
    rotations: Iterable[int],
    source_width: int,
    source_height: int,
    merge_policy: str,
    pass_outcomes: Iterable[dict[str, Any]] | None = None,
    selection_parameters: dict[str, Any] | None = None,
) -> dict[str, Any]:
    configured_rotations = validate_rotations(rotations)
    if merge_policy not in MERGE_POLICIES:
        raise ValueError(
            f"Unknown rotation merge policy {merge_policy!r}; "
            f"expected one of {MERGE_POLICIES}"
        )
    if len(passes) != len(configured_rotations):
        raise ValueError("A segmentation pass is required for every rotation")
    outcomes = _validated_pass_outcomes(
        configured_rotations,
        pass_outcomes,
    )
    baseline_status = outcomes[configured_rotations.index(0)]["status"]
    quality_error = (
        {
            "code": "ROTATION_BASELINE_PASS_NOT_SUCCEEDED",
            "message": (
                "Baseline-plus rotation policies require the 0 degree pass to "
                f"fully succeed; observed {baseline_status}."
            ),
            "rotationDegrees": 0,
            "status": baseline_status,
        }
        if (
            merge_policy.startswith("baseline-plus-")
            and baseline_status != "succeeded"
        )
        else None
    )

    transformed_passes = [
        transform_segmentation_to_source(
            segmentation,
            rotation=rotation,
            source_width=source_width,
            source_height=source_height,
        )
        for rotation, segmentation in zip(configured_rotations, passes, strict=True)
    ]
    candidates: list[_Candidate] = []
    for rotation, segmentation, outcome in zip(
        configured_rotations, transformed_passes, outcomes, strict=True
    ):
        if outcome["status"] != "succeeded":
            continue
        for line in segmentation.get("lines", []):
            candidates.append(
                _Candidate(
                    index=len(candidates),
                    rotation=rotation,
                    line=line,
                )
            )

    clusters, pair_evidence = _cluster_candidates(
        candidates,
        source_width=source_width,
        source_height=source_height,
    )
    rotation_priority = {
        rotation: index for index, rotation in enumerate(configured_rotations)
    }
    included_cluster_indexes, selection_evidence = _included_cluster_indexes(
        clusters,
        merge_policy=merge_policy,
        source_width=source_width,
        source_height=source_height,
        selection_parameters=selection_parameters,
    )
    merged_lines: list[dict[str, Any]] = []
    for cluster_index, cluster in enumerate(clusters):
        if cluster_index not in included_cluster_indexes:
            continue
        representative = _representative(cluster, rotation_priority)
        line = copy.deepcopy(representative.line)
        members = sorted(
            cluster,
            key=lambda candidate: (
                rotation_priority[candidate.rotation],
                int(candidate.line.get("providerOrdinal", candidate.index)),
            ),
        )
        source_rotations = [member.rotation for member in members]
        if representative.rotation != 0:
            line["regions"] = []
        line["providerOrdinal"] = len(merged_lines)
        line["ensembleEvidence"] = {
            "evidenceContract": ROTATION_EVIDENCE_CONTRACT,
            "mergePolicy": merge_policy,
            "clusterIndex": cluster_index,
            "supportCount": len(source_rotations),
            "sourceRotationsDegrees": source_rotations,
            "sourcePassStatuses": ["succeeded" for _ in source_rotations],
            "representativeRotationDegrees": representative.rotation,
            "representativeProviderOrdinal": representative.line.get(
                "providerOrdinal", representative.index
            ),
            "memberProviderIds": [
                str(member.line.get("id")) for member in members
            ],
            "readingOrderSource": (
                "provider-unrotated"
                if representative.rotation == 0
                else "unresolved-rotated-proposal"
            ),
        }
        merged_lines.append(line)

    baseline_pass = transformed_passes[configured_rotations.index(0)]
    result = {
        "type": baseline_pass.get("type"),
        "textDirection": baseline_pass.get("textDirection"),
        "scriptDetection": baseline_pass.get("scriptDetection"),
        "lineOrders": [],
        "language": baseline_pass.get("language"),
        "regions": (
            baseline_pass.get("regions", {})
            if baseline_status == "succeeded"
            else {}
        ),
        "lines": merged_lines,
        "rotationEnsemble": {
            "evidenceContract": ROTATION_EVIDENCE_CONTRACT,
            "rotationsDegrees": list(configured_rotations),
            "mergePolicy": merge_policy,
            "rawInputLineCount": sum(
                len(segmentation.get("lines", []))
                for segmentation in transformed_passes
            ),
            "inputLineCount": len(candidates),
            "excludedInputLineCount": sum(
                len(segmentation.get("lines", []))
                for segmentation, outcome in zip(
                    transformed_passes, outcomes, strict=True
                )
                if outcome["status"] != "succeeded"
            ),
            "clusterCount": len(clusters),
            "includedClusterCount": len(merged_lines),
            "rejectedClusterCount": len(clusters) - len(merged_lines),
            "selectionEvidence": {
                **selection_evidence,
                "eligiblePassStatus": "succeeded",
                "successfulRotationsDegrees": [
                    rotation
                    for rotation, outcome in zip(
                        configured_rotations, outcomes, strict=True
                    )
                    if outcome["status"] == "succeeded"
                ],
            },
            "coordinateTransform": COORDINATE_TRANSFORM_VERSION,
            "passEligibility": [
                {
                    "rotationDegrees": rotation,
                    "status": outcome["status"],
                    "displayEligible": outcome["status"] == "succeeded",
                    "nativeLineCount": len(segmentation.get("lines", [])),
                }
                for rotation, segmentation, outcome in zip(
                    configured_rotations,
                    passes,
                    outcomes,
                    strict=True,
                )
            ],
            "clustering": {
                "method": "complete-link-rotation-disjoint-v1",
                "orientationToleranceDegrees": 12,
                "minimumAlongOverlapRatio": 0.55,
                "normalDistanceLongEdgeRatio": 0.006,
                "oneMemberPerRotation": True,
            },
            "associations": [
                {
                    "leftProviderId": str(candidates[left_index].line.get("id")),
                    "rightProviderId": str(candidates[right_index].line.get("id")),
                    "leftRotationDegrees": candidates[left_index].rotation,
                    "rightRotationDegrees": candidates[right_index].rotation,
                    "score": round(evidence.score, 6),
                    "orientationDifferenceDegrees": round(
                        evidence.orientation_difference_degrees, 3
                    ),
                    "alongOverlapRatio": round(
                        evidence.along_overlap_ratio, 6
                    ),
                    "normalDistancePx": round(
                        evidence.normal_distance_px, 3
                    ),
                    "normalTolerancePx": round(
                        evidence.normal_tolerance_px, 3
                    ),
                }
                for (left_index, right_index), evidence in sorted(
                    pair_evidence.items()
                )
            ],
            "candidateClusters": [
                {
                    "clusterIndex": cluster_index,
                    "members": [
                        {
                            "providerId": str(candidate.line.get("id")),
                            "rotationDegrees": candidate.rotation,
                        }
                        for candidate in cluster
                    ],
                    "classification": (
                        "multi-pass" if len(cluster) > 1 else "singleton"
                    ),
                }
                for cluster_index, cluster in enumerate(clusters)
            ],
        },
    }
    return {
        "segmentation": result,
        "qualityError": quality_error,
        "rotationPasses": [
            {
                "evidenceContract": ROTATION_EVIDENCE_CONTRACT,
                "rotationDegrees": rotation,
                "status": outcome["status"],
                "error": copy.deepcopy(outcome.get("error")),
                "attempts": copy.deepcopy(outcome.get("attempts", [])),
                "fallback": copy.deepcopy(outcome["fallback"]),
                "nativeImage": {
                    "width": (
                        source_height if rotation in (90, 270) else source_width
                    ),
                    "height": (
                        source_width if rotation in (90, 270) else source_height
                    ),
                    "coordinateSpace": "rotated-input-pixels-top-left",
                },
                "sourceImage": {
                    "width": source_width,
                    "height": source_height,
                    "coordinateSpace": "prepared-pixels-top-left",
                },
                "coordinateTransform": {
                    "version": COORDINATE_TRANSFORM_VERSION,
                    "direction": "native-rotated-to-source",
                },
                "nativeSegmentation": copy.deepcopy(native_segmentation),
                "sourceProjectedSegmentation": projected_segmentation,
            }
            for rotation, native_segmentation, projected_segmentation, outcome in zip(
                configured_rotations,
                passes,
                transformed_passes,
                outcomes,
                strict=True,
            )
        ],
    }


def _validated_pass_outcomes(
    rotations: tuple[int, ...],
    pass_outcomes: Iterable[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    if pass_outcomes is None:
        return [
            {
                "rotationDegrees": rotation,
                "status": "succeeded",
                "error": None,
                "attempts": [],
                "fallback": {"attempted": False, "outcome": None},
            }
            for rotation in rotations
        ]
    values = [copy.deepcopy(value) for value in pass_outcomes]
    if len(values) != len(rotations):
        raise ValueError("A pass outcome is required for every rotation")
    normalized: list[dict[str, Any]] = []
    for rotation, value in zip(rotations, values, strict=True):
        if not isinstance(value, dict):
            raise ValueError(f"Pass outcome for {rotation} degrees must be an object")
        if int(value.get("rotationDegrees", rotation)) != rotation:
            raise ValueError(
                "Pass outcomes must have the same order and rotations as the "
                "configured passes"
            )
        status = str(value.get("status", ""))
        if status not in PASS_STATUSES:
            raise ValueError(
                f"Unsupported pass status {status!r} for {rotation} degrees"
            )
        attempts = value.get("attempts", [])
        if not isinstance(attempts, list):
            raise ValueError(f"Pass attempts for {rotation} degrees must be an array")
        fallback_attempts = [
            attempt
            for attempt in attempts
            if isinstance(attempt, dict)
            and attempt.get("raiseOnError") is False
        ]
        fallback = value.get("fallback")
        if not isinstance(fallback, dict):
            fallback = {
                "attempted": bool(fallback_attempts),
                "outcome": (
                    fallback_attempts[-1].get("outcome")
                    if fallback_attempts
                    else None
                ),
            }
        normalized.append(
            {
                **value,
                "rotationDegrees": rotation,
                "status": status,
                "error": copy.deepcopy(value.get("error")),
                "attempts": attempts,
                "fallback": fallback,
            }
        )
    return normalized


def _transform_points(
    value: Any,
    *,
    rotation: int,
    source_width: int,
    source_height: int,
) -> list[list[int]] | None:
    if value is None:
        return None
    return [
        transform_point_to_source(
            point,
            rotation=rotation,
            source_width=source_width,
            source_height=source_height,
        )
        for point in value
    ]


def _transform_bbox(
    value: Any,
    *,
    rotation: int,
    source_width: int,
    source_height: int,
) -> list[int]:
    if (
        isinstance(value, (list, tuple))
        and len(value) == 4
        and all(isinstance(coordinate, (int, float)) for coordinate in value)
    ):
        min_x, min_y, max_x, max_y = value
    elif (
        isinstance(value, (list, tuple))
        and len(value) == 2
        and all(
            isinstance(point, (list, tuple)) and len(point) == 2
            for point in value
        )
    ):
        (min_x, min_y), (max_x, max_y) = value
    else:
        raise ValueError(f"Unsupported Kraken bbox {value!r}")
    corners = [
        (min_x, min_y),
        (max_x, min_y),
        (max_x, max_y),
        (min_x, max_y),
    ]
    transformed = [
        transform_point_to_source(
            point,
            rotation=rotation,
            source_width=source_width,
            source_height=source_height,
        )
        for point in corners
    ]
    xs = [point[0] for point in transformed]
    ys = [point[1] for point in transformed]
    return [min(xs), min(ys), max(xs), max(ys)]


def _line_points(line: dict[str, Any]) -> list[tuple[float, float]]:
    # Native baselines are the most stable evidence for matching the same
    # physical line across rotations. Provider polygons can be broad or
    # irregular enough to overlap neighboring rows, so they are a fallback.
    for key in ("baseline", "boundary"):
        value = line.get(key)
        if isinstance(value, list) and len(value) >= 2:
            return [
                (float(point[0]), float(point[1]))
                for point in value
                if isinstance(point, (list, tuple)) and len(point) == 2
            ]
    bbox = line.get("bbox")
    if isinstance(bbox, list) and len(bbox) == 4:
        min_x, min_y, max_x, max_y = (float(value) for value in bbox)
        return [
            (min_x, min_y),
            (max_x, min_y),
            (max_x, max_y),
            (min_x, max_y),
        ]
    return []


def _axis_degrees(line: dict[str, Any]) -> float:
    baseline = line.get("baseline")
    if isinstance(baseline, list) and len(baseline) >= 2:
        first = baseline[0]
        last = baseline[-1]
        if (
            isinstance(first, (list, tuple))
            and isinstance(last, (list, tuple))
            and len(first) == 2
            and len(last) == 2
            and first != last
        ):
            return math.degrees(
                math.atan2(float(last[1]) - first[1], float(last[0]) - first[0])
            ) % 180
    points = _line_points(line)
    if len(points) < 2:
        return 0.0
    center_x = sum(point[0] for point in points) / len(points)
    center_y = sum(point[1] for point in points) / len(points)
    xx = sum((point[0] - center_x) ** 2 for point in points)
    yy = sum((point[1] - center_y) ** 2 for point in points)
    xy = sum(
        (point[0] - center_x) * (point[1] - center_y) for point in points
    )
    return (0.5 * math.degrees(math.atan2(2 * xy, xx - yy))) % 180


def _projected_geometry(
    line: dict[str, Any],
    *,
    axis_degrees: float | None = None,
) -> _ProjectedGeometry | None:
    points = _line_points(line)
    if len(points) < 2:
        return None
    angle = _axis_degrees(line) if axis_degrees is None else axis_degrees
    radians = math.radians(angle)
    axis_x = math.cos(radians)
    axis_y = math.sin(radians)
    normal_x = -axis_y
    normal_y = axis_x
    along = [point[0] * axis_x + point[1] * axis_y for point in points]
    normal = [point[0] * normal_x + point[1] * normal_y for point in points]
    return _ProjectedGeometry(
        axis_degrees=angle,
        along_min=min(along),
        along_max=max(along),
        normal_min=min(normal),
        normal_max=max(normal),
    )


def _orientation_distance(left: float, right: float) -> float:
    difference = abs(left - right) % 180
    return min(difference, 180 - difference)


def _match_evidence(
    left: _Candidate,
    right: _Candidate,
    *,
    source_width: int,
    source_height: int,
) -> _MatchEvidence | None:
    left_axis = _axis_degrees(left.line)
    right_axis = _axis_degrees(right.line)
    orientation_difference = _orientation_distance(left_axis, right_axis)
    if orientation_difference > 12:
        return None
    comparison_axis = _mean_axis(left_axis, right_axis)
    left_geometry = _projected_geometry(
        left.line, axis_degrees=comparison_axis
    )
    right_geometry = _projected_geometry(
        right.line, axis_degrees=comparison_axis
    )
    if left_geometry is None or right_geometry is None:
        return None
    overlap = max(
        0.0,
        min(left_geometry.along_max, right_geometry.along_max)
        - max(left_geometry.along_min, right_geometry.along_min),
    )
    shorter_length = min(
        left_geometry.along_length, right_geometry.along_length
    )
    if shorter_length <= 0:
        return None
    along_overlap_ratio = overlap / shorter_length
    if along_overlap_ratio < 0.55:
        return None
    long_edge = max(source_width, source_height)
    normal_tolerance = max(
        3.0,
        long_edge * 0.006,
        min(
            0.5
            * (
                left_geometry.normal_thickness
                + right_geometry.normal_thickness
            ),
            long_edge * 0.012,
        ),
    )
    normal_distance = abs(
        left_geometry.normal_center - right_geometry.normal_center
    )
    if normal_distance > normal_tolerance:
        return None
    orientation_score = 1 - (orientation_difference / 12)
    normal_score = 1 - (normal_distance / normal_tolerance)
    return _MatchEvidence(
        score=(
            0.45 * min(along_overlap_ratio, 1.0)
            + 0.35 * max(normal_score, 0.0)
            + 0.20 * max(orientation_score, 0.0)
        ),
        orientation_difference_degrees=orientation_difference,
        along_overlap_ratio=along_overlap_ratio,
        normal_distance_px=normal_distance,
        normal_tolerance_px=normal_tolerance,
    )


def _mean_axis(left: float, right: float) -> float:
    left_radians = math.radians(left * 2)
    right_radians = math.radians(right * 2)
    x = math.cos(left_radians) + math.cos(right_radians)
    y = math.sin(left_radians) + math.sin(right_radians)
    if abs(x) < 1e-9 and abs(y) < 1e-9:
        return left
    return (math.degrees(math.atan2(y, x)) / 2) % 180


def _cluster_candidates(
    candidates: list[_Candidate],
    *,
    source_width: int,
    source_height: int,
) -> tuple[
    list[list[_Candidate]],
    dict[tuple[int, int], _MatchEvidence],
]:
    pair_evidence: dict[tuple[int, int], _MatchEvidence] = {}
    for left_index, left in enumerate(candidates):
        for right_index in range(left_index + 1, len(candidates)):
            right = candidates[right_index]
            if left.rotation == right.rotation:
                continue
            evidence = _match_evidence(
                left,
                right,
                source_width=source_width,
                source_height=source_height,
            )
            if evidence is not None:
                pair_evidence[(left_index, right_index)] = evidence

    clusters: list[list[_Candidate]] = [[candidate] for candidate in candidates]
    scored_pairs = sorted(
        (
            (evidence.score, left_index, right_index)
            for (left_index, right_index), evidence in pair_evidence.items()
        ),
        key=lambda value: (-value[0], value[1], value[2]),
    )
    for _, left_index, right_index in scored_pairs:
        left_cluster_index = next(
            index
            for index, cluster in enumerate(clusters)
            if any(candidate.index == left_index for candidate in cluster)
        )
        right_cluster_index = next(
            index
            for index, cluster in enumerate(clusters)
            if any(candidate.index == right_index for candidate in cluster)
        )
        if left_cluster_index == right_cluster_index:
            continue
        left_cluster = clusters[left_cluster_index]
        right_cluster = clusters[right_cluster_index]
        if {
            candidate.rotation for candidate in left_cluster
        } & {
            candidate.rotation for candidate in right_cluster
        }:
            continue
        # Complete-link compatibility prevents a single weak bridge from
        # collapsing adjacent or split lines into one apparent consensus.
        if not all(
            (
                min(left.index, right.index),
                max(left.index, right.index),
            )
            in pair_evidence
            for left in left_cluster
            for right in right_cluster
        ):
            continue
        merged = sorted(
            [*left_cluster, *right_cluster],
            key=lambda candidate: (candidate.rotation, candidate.index),
        )
        keep_index = min(left_cluster_index, right_cluster_index)
        remove_index = max(left_cluster_index, right_cluster_index)
        clusters[keep_index] = merged
        clusters.pop(remove_index)

    clusters.sort(key=lambda cluster: min(candidate.index for candidate in cluster))
    return clusters, pair_evidence


def _included_cluster_indexes(
    clusters: list[list[_Candidate]],
    *,
    merge_policy: str,
    source_width: int,
    source_height: int,
    selection_parameters: dict[str, Any] | None,
) -> tuple[set[int], dict[str, Any]]:
    if merge_policy == "evidence-union":
        _reject_unexpected_selection_parameters(
            merge_policy, selection_parameters
        )
        return set(range(len(clusters))), {
            "rule": "all-associated-and-singleton-clusters",
        }
    baseline_indexes = {
        index
        for index, cluster in enumerate(clusters)
        if any(candidate.rotation == 0 for candidate in cluster)
    }
    if merge_policy == "baseline-plus-consensus":
        _reject_unexpected_selection_parameters(
            merge_policy, selection_parameters
        )
        consensus_indexes = {
            index for index, cluster in enumerate(clusters) if len(cluster) >= 2
        }
        return baseline_indexes | consensus_indexes, {
            "rule": "unrotated-baseline-plus-two-pass-minimum",
            "baselineClusterCount": len(baseline_indexes),
            "consensusClusterCount": len(consensus_indexes),
        }
    if merge_policy not in {
        "baseline-plus-vertical-zones",
        "baseline-plus-nonoverlapping-vertical-zones",
    }:
        raise ValueError(f"Unsupported merge policy {merge_policy}")

    long_edge = max(source_width, source_height)
    safe_policy = (
        _safe_vertical_zone_parameters(selection_parameters)
        if merge_policy == "baseline-plus-nonoverlapping-vertical-zones"
        else None
    )
    if safe_policy is None:
        _reject_unexpected_selection_parameters(
            merge_policy, selection_parameters
        )
        vertical_axis_tolerance = 15.0
        strong_length_ratio = 0.025
        zone_join_padding_ratio = 0.06
        zone_member_padding_ratio = 0.02
        minimum_strong_proposals = 2
        minimum_proposals = 2
        baseline_interference_padding_ratio = 0.0
        horizontal_interference_tolerance = None
        maximum_horizontal_interference_ratio = None
        minimum_horizontal_interference_allowance = None
    else:
        vertical_axis_tolerance = safe_policy[
            "verticalAxisToleranceDegrees"
        ]
        strong_length_ratio = safe_policy[
            "strongBaselineLongEdgeRatio"
        ]
        zone_join_padding_ratio = safe_policy[
            "zoneJoinPaddingLongEdgeRatio"
        ]
        zone_member_padding_ratio = safe_policy[
            "zoneMemberPaddingLongEdgeRatio"
        ]
        minimum_strong_proposals = safe_policy[
            "minimumStrongProposalClustersPerZone"
        ]
        minimum_proposals = safe_policy[
            "minimumProposalClustersPerZone"
        ]
        baseline_interference_padding_ratio = safe_policy[
            "baselineInterferencePaddingLongEdgeRatio"
        ]
        horizontal_interference_tolerance = safe_policy[
            "baselineInterferenceHorizontalAxisToleranceDegrees"
        ]
        maximum_horizontal_interference_ratio = safe_policy[
            "maximumHorizontalBaselineCentroidRatioPerZone"
        ]
        minimum_horizontal_interference_allowance = safe_policy[
            "minimumHorizontalBaselineCentroidAllowancePerZone"
        ]
    strong_length = long_edge * strong_length_ratio
    zone_join_padding = long_edge * zone_join_padding_ratio
    zone_member_padding = long_edge * zone_member_padding_ratio
    baseline_interference_padding = (
        long_edge * baseline_interference_padding_ratio
    )
    vertical_candidates: dict[int, dict[str, Any]] = {}
    for index, cluster in enumerate(clusters):
        if index in baseline_indexes:
            continue
        representative = min(
            cluster,
            key=lambda candidate: (candidate.rotation, candidate.index),
        )
        axis = _axis_degrees(representative.line)
        vertical_difference = _orientation_distance(axis, 90)
        if vertical_difference > vertical_axis_tolerance:
            continue
        bounds = _line_bounds(representative.line)
        if bounds is None:
            continue
        length = _baseline_length(representative.line)
        vertical_candidates[index] = {
            "axisDegrees": axis,
            "verticalDifferenceDegrees": vertical_difference,
            "baselineLengthPx": length,
            "bounds": bounds,
            "strong": length >= strong_length,
        }

    strong_indexes = [
        index
        for index, evidence in vertical_candidates.items()
        if evidence["strong"]
    ]
    components: list[set[int]] = [{index} for index in strong_indexes]
    changed = True
    while changed:
        changed = False
        for left_index in range(len(components)):
            if changed:
                break
            for right_index in range(left_index + 1, len(components)):
                if any(
                    _boxes_near(
                        vertical_candidates[left]["bounds"],
                        vertical_candidates[right]["bounds"],
                        padding=zone_join_padding,
                    )
                    for left in components[left_index]
                    for right in components[right_index]
                ):
                    components[left_index] |= components[right_index]
                    components.pop(right_index)
                    changed = True
                    break

    candidate_components = [
        component
        for component in components
        if len(component) >= minimum_strong_proposals
    ]
    vertical_zone_indexes: set[int] = set()
    zones: list[dict[str, Any]] = []
    contributing_rotations: set[int] = set()
    rejected_zone_count = 0
    rejected_cluster_indexes: set[int] = set()
    baseline_geometry = {
        index: {
            "centroid": _line_centroid(
                next(
                    candidate
                    for candidate in cluster
                    if candidate.rotation == 0
                ).line
            ),
            "axisDegrees": _axis_degrees(
                next(
                    candidate
                    for candidate in cluster
                    if candidate.rotation == 0
                ).line
            ),
        }
        for index, cluster in enumerate(clusters)
        if index in baseline_indexes
    }
    for zone_index, component in enumerate(candidate_components):
        component_bounds = _union_bounds(
            [vertical_candidates[index]["bounds"] for index in component]
        )
        members = {
            index
            for index, evidence in vertical_candidates.items()
            if _boxes_near(
                component_bounds,
                evidence["bounds"],
                padding=zone_member_padding,
            )
        }
        horizontal_baseline_interference = sorted(
            index
            for index, evidence in baseline_geometry.items()
            if evidence["centroid"] is not None
            and _point_inside_box(
                evidence["centroid"],
                component_bounds,
                padding=baseline_interference_padding,
            )
            and (
                horizontal_interference_tolerance is None
                or _orientation_distance(
                    float(evidence["axisDegrees"]), 0
                )
                <= horizontal_interference_tolerance
            )
        )
        horizontal_interference_allowance = (
            None
            if (
                maximum_horizontal_interference_ratio is None
                or minimum_horizontal_interference_allowance is None
            )
            else max(
                minimum_horizontal_interference_allowance,
                math.floor(
                    len(members) * maximum_horizontal_interference_ratio
                ),
            )
        )
        rejection_reasons: list[str] = []
        if len(members) < minimum_proposals:
            rejection_reasons.append("INSUFFICIENT_PROPOSAL_CLUSTERS")
        if (
            horizontal_interference_allowance is not None
            and len(horizontal_baseline_interference)
            > horizontal_interference_allowance
        ):
            rejection_reasons.append(
                "SUBSTANTIAL_HORIZONTAL_BASELINE_INTERFERENCE"
            )
        accepted = not rejection_reasons
        if accepted:
            vertical_zone_indexes |= members
        else:
            rejected_zone_count += 1
            rejected_cluster_indexes |= members
        zone_rotations = sorted(
            {
                candidate.rotation
                for cluster_index in members
                for candidate in clusters[cluster_index]
            }
        )
        if accepted:
            contributing_rotations.update(zone_rotations)
        zones.append(
            {
                "zoneIndex": zone_index,
                "bounds": {
                    "minX": round(component_bounds[0], 3),
                    "minY": round(component_bounds[1], 3),
                    "maxX": round(component_bounds[2], 3),
                    "maxY": round(component_bounds[3], 3),
                },
                "strongClusterIndexes": sorted(component),
                "includedClusterIndexes": sorted(members),
                "acceptedClusterIndexes": (
                    sorted(members) if accepted else []
                ),
                "accepted": accepted,
                "rejectionReasons": rejection_reasons,
                "proposalClusterCount": len(members),
                "horizontalBaselineInterference": {
                    "centroidClusterIndexes": (
                        horizontal_baseline_interference
                    ),
                    "centroidCount": len(horizontal_baseline_interference),
                    "horizontalAxisToleranceDegrees": (
                        horizontal_interference_tolerance
                    ),
                    "maximumCentroidRatioPerProposalCluster": (
                        maximum_horizontal_interference_ratio
                    ),
                    "minimumCentroidAllowance": (
                        minimum_horizontal_interference_allowance
                    ),
                    "maximumAcceptedCentroidCount": (
                        horizontal_interference_allowance
                    ),
                    "paddingPx": round(
                        baseline_interference_padding, 3
                    ),
                },
                "contributingSuccessfulRotationsDegrees": zone_rotations,
            }
        )
    rule = (
        "unrotated-baseline-plus-nonoverlapping-vertical-zones-v1"
        if safe_policy is not None
        else "unrotated-baseline-plus-single-successful-rotation-spatial-zones-v2"
    )
    support_semantics = (
        "A vertical proposal zone must contain the configured minimum number "
        "of qualifying clusters. Substantially horizontal unrotated provider "
        "baselines are counted only when their centroids overlap the zone; "
        "the accepted count scales explicitly with proposal count and a "
        "configured minimum allowance. Rejected zone geometry remains in the "
        "raw rotation-pass evidence."
        if safe_policy is not None
        else (
            "Two nearby strong vertical line hypotheses may establish a zone "
            "within one fully successful rotated pass. Independent rotational "
            "consensus is not required."
        )
    )
    return baseline_indexes | vertical_zone_indexes, {
        "rule": rule,
        "supportSemantics": support_semantics,
        "independentRotationConsensusRequired": False,
        "verticalAxisToleranceDegrees": vertical_axis_tolerance,
        "strongBaselineLongEdgeRatio": strong_length_ratio,
        "strongBaselineLengthPx": round(strong_length, 3),
        "zoneJoinPaddingLongEdgeRatio": zone_join_padding_ratio,
        "zoneJoinPaddingPx": round(zone_join_padding, 3),
        "zoneMemberPaddingLongEdgeRatio": zone_member_padding_ratio,
        "zoneMemberPaddingPx": round(zone_member_padding, 3),
        "minimumStrongProposalClustersPerZone": minimum_strong_proposals,
        "minimumProposalClustersPerZone": minimum_proposals,
        "baselineInterferencePaddingLongEdgeRatio": (
            baseline_interference_padding_ratio
        ),
        "baselineInterferencePaddingPx": round(
            baseline_interference_padding, 3
        ),
        "baselineInterferenceHorizontalAxisToleranceDegrees": (
            horizontal_interference_tolerance
        ),
        "maximumHorizontalBaselineCentroidRatioPerZone": (
            maximum_horizontal_interference_ratio
        ),
        "minimumHorizontalBaselineCentroidAllowancePerZone": (
            minimum_horizontal_interference_allowance
        ),
        "baselineClusterCount": len(baseline_indexes),
        "verticalCandidateCount": len(vertical_candidates),
        "strongVerticalCandidateCount": len(strong_indexes),
        "acceptedVerticalClusterCount": len(vertical_zone_indexes),
        "acceptedZoneCount": len(zones) - rejected_zone_count,
        "rejectedZoneCount": rejected_zone_count,
        "rejectedVerticalClusterIndexes": sorted(
            rejected_cluster_indexes - vertical_zone_indexes
        ),
        "contributingSuccessfulRotationsDegrees": sorted(
            contributing_rotations
        ),
        "zones": zones,
    }


def _baseline_length(line: dict[str, Any]) -> float:
    baseline = line.get("baseline")
    if not isinstance(baseline, list) or len(baseline) < 2:
        bounds = _line_bounds(line)
        if bounds is None:
            return 0.0
        return max(bounds[2] - bounds[0], bounds[3] - bounds[1])
    length = 0.0
    for first, second in zip(baseline, baseline[1:]):
        length += math.hypot(
            float(second[0]) - float(first[0]),
            float(second[1]) - float(first[1]),
        )
    return length


def _reject_unexpected_selection_parameters(
    merge_policy: str,
    value: dict[str, Any] | None,
) -> None:
    if value not in (None, {}):
        raise ValueError(
            f"{merge_policy} does not accept selection parameters"
        )


def _safe_vertical_zone_parameters(
    value: dict[str, Any] | None,
) -> dict[str, float | int]:
    if not isinstance(value, dict):
        raise ValueError(
            "baseline-plus-nonoverlapping-vertical-zones requires explicit "
            "selection parameters"
        )
    observed_keys = tuple(sorted(value))
    expected_keys = tuple(sorted(SAFE_VERTICAL_ZONE_PARAMETER_KEYS))
    if observed_keys != expected_keys:
        raise ValueError(
            "Safe vertical-zone selection parameters must contain exactly "
            f"{expected_keys}; observed {observed_keys}"
        )

    def finite_number(key: str) -> float:
        item = value[key]
        if (
            isinstance(item, bool)
            or not isinstance(item, (int, float))
            or not math.isfinite(float(item))
        ):
            raise ValueError(f"{key} must be a finite number")
        return float(item)

    vertical_tolerance = finite_number("verticalAxisToleranceDegrees")
    strong_ratio = finite_number("strongBaselineLongEdgeRatio")
    join_ratio = finite_number("zoneJoinPaddingLongEdgeRatio")
    member_ratio = finite_number("zoneMemberPaddingLongEdgeRatio")
    interference_ratio = finite_number(
        "baselineInterferencePaddingLongEdgeRatio"
    )
    if not 0 < vertical_tolerance <= 45:
        raise ValueError(
            "verticalAxisToleranceDegrees must be greater than 0 and at most 45"
        )
    for key, item in (
        ("strongBaselineLongEdgeRatio", strong_ratio),
        ("zoneJoinPaddingLongEdgeRatio", join_ratio),
        ("zoneMemberPaddingLongEdgeRatio", member_ratio),
        ("baselineInterferencePaddingLongEdgeRatio", interference_ratio),
    ):
        if not 0 <= item <= 0.25:
            raise ValueError(f"{key} must be between 0 and 0.25")
    minimum_strong = value["minimumStrongProposalClustersPerZone"]
    minimum_proposals = value["minimumProposalClustersPerZone"]
    horizontal_tolerance = finite_number(
        "baselineInterferenceHorizontalAxisToleranceDegrees"
    )
    maximum_horizontal_ratio = finite_number(
        "maximumHorizontalBaselineCentroidRatioPerZone"
    )
    minimum_horizontal_allowance = value[
        "minimumHorizontalBaselineCentroidAllowancePerZone"
    ]
    for key, item in (
        ("minimumStrongProposalClustersPerZone", minimum_strong),
        ("minimumProposalClustersPerZone", minimum_proposals),
        (
            "minimumHorizontalBaselineCentroidAllowancePerZone",
            minimum_horizontal_allowance,
        ),
    ):
        if isinstance(item, bool) or not isinstance(item, int) or item < 0:
            raise ValueError(f"{key} must be a nonnegative integer")
    if minimum_strong < 2:
        raise ValueError(
            "minimumStrongProposalClustersPerZone must be at least 2"
        )
    if minimum_proposals < minimum_strong:
        raise ValueError(
            "minimumProposalClustersPerZone must be greater than or equal to "
            "minimumStrongProposalClustersPerZone"
        )
    if not 0 < horizontal_tolerance <= 45:
        raise ValueError(
            "baselineInterferenceHorizontalAxisToleranceDegrees must be "
            "greater than 0 and at most 45"
        )
    if not 0 <= maximum_horizontal_ratio <= 1:
        raise ValueError(
            "maximumHorizontalBaselineCentroidRatioPerZone must be between "
            "0 and 1"
        )
    return {
        "verticalAxisToleranceDegrees": vertical_tolerance,
        "strongBaselineLongEdgeRatio": strong_ratio,
        "zoneJoinPaddingLongEdgeRatio": join_ratio,
        "zoneMemberPaddingLongEdgeRatio": member_ratio,
        "minimumStrongProposalClustersPerZone": minimum_strong,
        "minimumProposalClustersPerZone": minimum_proposals,
        "baselineInterferencePaddingLongEdgeRatio": interference_ratio,
        "baselineInterferenceHorizontalAxisToleranceDegrees": (
            horizontal_tolerance
        ),
        "maximumHorizontalBaselineCentroidRatioPerZone": (
            maximum_horizontal_ratio
        ),
        "minimumHorizontalBaselineCentroidAllowancePerZone": (
            minimum_horizontal_allowance
        ),
    }


def _line_centroid(
    line: dict[str, Any],
) -> tuple[float, float] | None:
    points = _line_points(line)
    if not points:
        return None
    return (
        sum(point[0] for point in points) / len(points),
        sum(point[1] for point in points) / len(points),
    )


def _point_inside_box(
    point: tuple[float, float],
    bounds: tuple[float, float, float, float],
    *,
    padding: float,
) -> bool:
    return (
        bounds[0] - padding <= point[0] <= bounds[2] + padding
        and bounds[1] - padding <= point[1] <= bounds[3] + padding
    )


def _line_bounds(
    line: dict[str, Any],
) -> tuple[float, float, float, float] | None:
    points = _line_points(line)
    if not points:
        return None
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    return min(xs), min(ys), max(xs), max(ys)


def _boxes_near(
    left: tuple[float, float, float, float],
    right: tuple[float, float, float, float],
    *,
    padding: float,
) -> bool:
    return not (
        left[2] + padding < right[0]
        or right[2] + padding < left[0]
        or left[3] + padding < right[1]
        or right[3] + padding < left[1]
    )


def _union_bounds(
    bounds: list[tuple[float, float, float, float]],
) -> tuple[float, float, float, float]:
    return (
        min(value[0] for value in bounds),
        min(value[1] for value in bounds),
        max(value[2] for value in bounds),
        max(value[3] for value in bounds),
    )


def _representative(
    cluster: list[_Candidate],
    rotation_priority: dict[int, int],
) -> _Candidate:
    baseline = next(
        (candidate for candidate in cluster if candidate.rotation == 0),
        None,
    )
    if baseline is not None:
        return baseline
    return min(
        cluster,
        key=lambda candidate: (
            rotation_priority[candidate.rotation],
            int(candidate.line.get("providerOrdinal", candidate.index)),
            str(candidate.line.get("id", "")),
        ),
    )
