"""Line-coordinate word proposals from ink, line fields, and rough locators.

The line is a coordinate frame, not ownership truth. These helpers reduce a 2-D
word-localization problem to ordered intervals while preserving explicit
abstention for components that cross or compete at a proposed word boundary.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np

from .engine import EnvelopeError


def _bbox(value: Any) -> tuple[int, int, int, int]:
    if (
        not isinstance(value, Sequence)
        or isinstance(value, (str, bytes))
        or len(value) != 4
        or any(not isinstance(item, int) or isinstance(item, bool) for item in value)
    ):
        raise EnvelopeError("bbox_xywh must contain four integers")
    x, y, width, height = (int(item) for item in value)
    if x < 0 or y < 0 or width < 1 or height < 1:
        raise EnvelopeError("bbox_xywh must have nonnegative origin and positive size")
    return x, y, width, height


def _project_xy(x: float, y: float, frame: Mapping[str, Any]) -> tuple[float, float]:
    origin_x, origin_y = (float(value) for value in frame["origin_xy"])
    direction_x, direction_y = (float(value) for value in frame["direction_xy"])
    normal_x, normal_y = (float(value) for value in frame["normal_xy"])
    dx, dy = x - origin_x, y - origin_y
    return dx * direction_x + dy * direction_y, dx * normal_x + dy * normal_y


def build_line_frames(
    components: Sequence[Mapping[str, Any]],
    units: Sequence[Mapping[str, Any]],
    centerlines: Mapping[str, Mapping[str, Any]],
) -> dict[str, Any]:
    """Bind fitted body lines, ordered word locators, and projected components."""

    seen_units: set[str] = set()
    grouped_units: dict[str, list[dict[str, Any]]] = {}
    for unit in units:
        unit_id = unit.get("unit_id")
        line_id = unit.get("line_id")
        if not isinstance(unit_id, str) or not unit_id or unit_id in seen_units:
            raise EnvelopeError("Units require unique nonempty unit_id values")
        if not isinstance(line_id, str) or line_id not in centerlines:
            raise EnvelopeError(f"Unit {unit_id} has no bound centerline")
        seen_units.add(unit_id)
        x, y, width, height = _bbox(unit.get("bbox_xywh"))
        grouped_units.setdefault(line_id, []).append(
            {
                "unit_id": unit_id,
                "line_id": line_id,
                "word_order": int(unit.get("word_order", len(grouped_units.get(line_id, [])) + 1)),
                "bbox_xywh": [x, y, width, height],
            }
        )

    frames: dict[str, dict[str, Any]] = {}
    for line_id, line_units in sorted(grouped_units.items()):
        line = centerlines[line_id]
        slope = float(line["slope"])
        intercept = float(line["intercept"])
        norm = float(np.hypot(1.0, slope))
        direction = (1.0 / norm, slope / norm)
        normal = (-slope / norm, 1.0 / norm)
        frame: dict[str, Any] = {
            "line_id": line_id,
            "slope": slope,
            "intercept": intercept,
            "scale_px": float(line["scale_px"]),
            "origin_xy": [0.0, intercept],
            "direction_xy": list(direction),
            "normal_xy": list(normal),
        }
        projected_units: list[dict[str, Any]] = []
        for unit in sorted(line_units, key=lambda row: (row["word_order"], row["unit_id"])):
            x, y, width, height = unit["bbox_xywh"]
            corners = (
                (x, y),
                (x + width, y),
                (x, y + height),
                (x + width, y + height),
            )
            projected = [_project_xy(px, py, frame) for px, py in corners]
            center_u, center_v = _project_xy(x + width / 2.0, y + height / 2.0, frame)
            projected_units.append(
                {
                    **unit,
                    "anchor_u": round(center_u, 6),
                    "anchor_v": round(center_v, 6),
                    "locator_u_interval": [
                        round(min(value[0] for value in projected), 6),
                        round(max(value[0] for value in projected), 6),
                    ],
                    "locator_v_interval": [
                        round(min(value[1] for value in projected), 6),
                        round(max(value[1] for value in projected), 6),
                    ],
                }
            )
        anchors = [row["anchor_u"] for row in projected_units]
        if any(right <= left for left, right in zip(anchors, anchors[1:])):
            raise EnvelopeError(f"Line {line_id} word anchors are not strictly ordered")
        frame["units"] = projected_units
        frame["x_extent"] = [
            min(row["bbox_xywh"][0] for row in projected_units),
            max(row["bbox_xywh"][0] + row["bbox_xywh"][2] for row in projected_units),
        ]
        frames[line_id] = frame

    projected_components: dict[int, dict[str, Any]] = {}
    for raw in components:
        component_id = int(raw["component_id"])
        x, y, width, height = _bbox(raw["bbox_xywh"])
        center_x, center_y = (float(value) for value in raw["center_xy"])
        by_line: dict[str, dict[str, Any]] = {}
        for line_id, frame in frames.items():
            center_u, center_v = _project_xy(center_x, center_y, frame)
            corners = (
                (x, y),
                (x + width, y),
                (x, y + height),
                (x + width, y + height),
            )
            projected = [_project_xy(px, py, frame) for px, py in corners]
            by_line[line_id] = {
                "center_u": round(center_u, 6),
                "center_v": round(center_v, 6),
                "u_interval": [
                    round(min(value[0] for value in projected), 6),
                    round(max(value[0] for value in projected), 6),
                ],
                "v_interval": [
                    round(min(value[1] for value in projected), 6),
                    round(max(value[1] for value in projected), 6),
                ],
            }
        projected_components[component_id] = {
            "component_id": component_id,
            "area_px": int(raw["area_px"]),
            "bbox_xywh": [x, y, width, height],
            "center_xy": [center_x, center_y],
            "by_line": by_line,
        }
    return {"frames": frames, "components": projected_components}


def assign_components_to_lines(
    framed: Mapping[str, Any],
    *,
    maximum_spacing_fraction: float = 0.58,
    minimum_normalized_margin: float = 0.05,
    x_padding_px: float = 120.0,
) -> dict[str, Any]:
    """Choose the nearest plausible line or abstain near/beyond line boundaries."""

    if not 0 < maximum_spacing_fraction <= 1:
        raise EnvelopeError("maximum_spacing_fraction must fall in (0, 1]")
    if not 0 <= minimum_normalized_margin <= 1:
        raise EnvelopeError("minimum_normalized_margin must fall in [0, 1]")
    frames = framed["frames"]
    assignments: dict[str, list[int]] = {line_id: [] for line_id in frames}
    receipts: list[dict[str, Any]] = []
    ambiguous: list[dict[str, Any]] = []
    unsupported: list[int] = []
    for component_id, component in sorted(framed["components"].items()):
        center_x = float(component["center_xy"][0])
        candidates: list[dict[str, Any]] = []
        for line_id, frame in frames.items():
            x0, x1 = (float(value) for value in frame["x_extent"])
            if center_x < x0 - x_padding_px or center_x > x1 + x_padding_px:
                continue
            distance = abs(float(component["by_line"][line_id]["center_v"]))
            line_y = float(frame["slope"]) * center_x + float(frame["intercept"])
            # Normalize by the actual local separation between fitted lines, not
            # by this component's distance to another line. The latter makes the
            # first and last line acquire an unbounded outer territory and can
            # absorb page numbers, signatures, and marginalia.
            neighbor_spacings = [
                abs(
                    line_y
                    - (
                        float(other["slope"]) * center_x
                        + float(other["intercept"])
                    )
                )
                for other_id, other in frames.items()
                if other_id != line_id
            ]
            spacing = min(
                neighbor_spacings,
                default=max(80.0, float(frame["scale_px"]) * 6.0),
            )
            normalized = distance / max(1.0, spacing)
            candidates.append(
                {
                    "line_id": line_id,
                    "distance_px": round(distance, 6),
                    "local_spacing_px": round(spacing, 6),
                    "normalized_distance": round(normalized, 6),
                }
            )
        candidates.sort(key=lambda row: (row["normalized_distance"], row["distance_px"], row["line_id"]))
        if not candidates or candidates[0]["normalized_distance"] > maximum_spacing_fraction:
            unsupported.append(component_id)
            continue
        best = candidates[0]
        runner_up = candidates[1] if len(candidates) > 1 else None
        margin = (
            float(runner_up["normalized_distance"]) - float(best["normalized_distance"])
            if runner_up is not None
            else 1.0
        )
        receipt = {
            "component_id": component_id,
            "winner_line_id": best["line_id"],
            "winner_normalized_distance": best["normalized_distance"],
            "runner_up_line_id": runner_up["line_id"] if runner_up else None,
            "runner_up_normalized_distance": runner_up["normalized_distance"] if runner_up else None,
            "normalized_margin": round(margin, 6),
        }
        if runner_up is not None and margin < minimum_normalized_margin:
            ambiguous.append(receipt)
            continue
        assignments[best["line_id"]].append(component_id)
        receipts.append(receipt)
    return {
        "component_ids_by_line": assignments,
        "assignment_receipts": receipts,
        "ambiguous_components": ambiguous,
        "unsupported_component_ids": unsupported,
        "policy": {
            "maximum_spacing_fraction": maximum_spacing_fraction,
            "minimum_normalized_margin": minimum_normalized_margin,
            "x_padding_px": x_padding_px,
        },
    }


def midpoint_boundaries(frame: Mapping[str, Any]) -> dict[str, Any]:
    """Create ordered word cuts halfway between rough locator centers."""

    units = frame["units"]
    anchors = [float(row["anchor_u"]) for row in units]
    if not anchors:
        return {"boundaries_u": [], "outer_u_interval": [0.0, 0.0]}
    internal = [(left + right) / 2.0 for left, right in zip(anchors, anchors[1:])]
    if len(anchors) == 1:
        outer = [
            float(units[0]["locator_u_interval"][0]),
            float(units[0]["locator_u_interval"][1]),
        ]
    else:
        first_gap, last_gap = anchors[1] - anchors[0], anchors[-1] - anchors[-2]
        outer = [
            min(float(units[0]["locator_u_interval"][0]), anchors[0] - first_gap / 2.0),
            max(float(units[-1]["locator_u_interval"][1]), anchors[-1] + last_gap / 2.0),
        ]
    return {
        "boundaries_u": [round(value, 6) for value in internal],
        "outer_u_interval": [round(value, 6) for value in outer],
        "source": "rough_locator_anchor_midpoints",
    }


def ink_valley_boundaries(
    ink_mask: np.ndarray,
    frame: Mapping[str, Any],
    midpoint: Mapping[str, Any],
    *,
    band_half_height_px: float,
    search_fraction: float = 0.32,
    smoothing_radius_px: int = 9,
    midpoint_bias: float = 0.08,
) -> dict[str, Any]:
    """Move midpoint cuts toward low-ink valleys inside a fitted line strip."""

    ink = np.asarray(ink_mask) > 0
    if ink.ndim != 2:
        raise EnvelopeError("Ink mask must be two-dimensional")
    if band_half_height_px <= 0 or not 0 < search_fraction < 0.5:
        raise EnvelopeError("Invalid valley search geometry")
    if smoothing_radius_px < 0 or midpoint_bias < 0:
        raise EnvelopeError("Invalid valley smoothing policy")
    ys, xs = np.nonzero(ink)
    origin_x, origin_y = (float(value) for value in frame["origin_xy"])
    direction_x, direction_y = (float(value) for value in frame["direction_xy"])
    normal_x, normal_y = (float(value) for value in frame["normal_xy"])
    dx, dy = xs.astype(np.float64) - origin_x, ys.astype(np.float64) - origin_y
    u = dx * direction_x + dy * direction_y
    v = dx * normal_x + dy * normal_y
    keep = np.abs(v) <= band_half_height_px
    u = u[keep]
    units = frame["units"]
    anchors = [float(row["anchor_u"]) for row in units]
    outer = [float(value) for value in midpoint["outer_u_interval"]]
    start, end = int(np.floor(outer[0])) - 2, int(np.ceil(outer[1])) + 3
    bins = max(1, end - start)
    histogram = np.bincount(
        np.clip(np.floor(u - start).astype(np.int64), 0, bins - 1),
        minlength=bins,
    ).astype(np.float64)
    if smoothing_radius_px:
        kernel = np.ones(smoothing_radius_px * 2 + 1, dtype=np.float64)
        smoothed = np.convolve(histogram, kernel / kernel.sum(), mode="same")
    else:
        smoothed = histogram
    cuts: list[float] = []
    receipts: list[dict[str, Any]] = []
    for left, right in zip(anchors, anchors[1:]):
        gap = right - left
        midpoint_u = (left + right) / 2.0
        search_start = midpoint_u - gap * search_fraction
        search_end = midpoint_u + gap * search_fraction
        lo = max(0, int(np.floor(search_start - start)))
        hi = min(bins, int(np.ceil(search_end - start)) + 1)
        candidates = np.arange(lo, hi, dtype=np.int64)
        if not len(candidates):
            chosen = midpoint_u
            density = 0.0
        else:
            candidate_u = candidates.astype(np.float64) + start + 0.5
            density_values = smoothed[candidates]
            scale = max(1.0, float(density_values.max()))
            objective = density_values / scale + midpoint_bias * np.abs(candidate_u - midpoint_u) / max(1.0, gap)
            best_index = int(np.argmin(objective))
            chosen = float(candidate_u[best_index])
            density = float(density_values[best_index])
        cuts.append(chosen)
        receipts.append(
            {
                "left_unit_id": units[len(cuts) - 1]["unit_id"],
                "right_unit_id": units[len(cuts)]["unit_id"],
                "midpoint_u": round(midpoint_u, 6),
                "chosen_u": round(chosen, 6),
                "shift_px": round(chosen - midpoint_u, 6),
                "smoothed_ink_density": round(density, 6),
            }
        )
    return {
        "boundaries_u": [round(value, 6) for value in cuts],
        "outer_u_interval": [round(value, 6) for value in outer],
        "source": "low_ink_valley_near_locator_midpoint",
        "receipts": receipts,
        "policy": {
            "band_half_height_px": band_half_height_px,
            "search_fraction": search_fraction,
            "smoothing_radius_px": smoothing_radius_px,
            "midpoint_bias": midpoint_bias,
        },
    }


def assign_line_components_by_boundaries(
    framed: Mapping[str, Any],
    line_assignments: Mapping[str, Any],
    boundaries_by_line: Mapping[str, Mapping[str, Any]],
    *,
    abstain_on_boundary_crossing: bool,
    minimum_boundary_clearance_px: float = 0.0,
) -> dict[str, Any]:
    """Assign each line-owned component to one ordered word interval."""

    if minimum_boundary_clearance_px < 0:
        raise EnvelopeError("minimum_boundary_clearance_px must be nonnegative")
    frames = framed["frames"]
    by_unit = {
        unit["unit_id"]: []
        for frame in frames.values()
        for unit in frame["units"]
    }
    ambiguous: list[dict[str, Any]] = []
    outside: list[int] = []
    receipts: list[dict[str, Any]] = []
    for line_id, component_ids in line_assignments["component_ids_by_line"].items():
        frame = frames[line_id]
        units = frame["units"]
        boundary = boundaries_by_line[line_id]
        cuts = [float(value) for value in boundary["boundaries_u"]]
        outer_start, outer_end = (float(value) for value in boundary["outer_u_interval"])
        for component_id in component_ids:
            projected = framed["components"][component_id]["by_line"][line_id]
            center_u = float(projected["center_u"])
            interval_start, interval_end = (float(value) for value in projected["u_interval"])
            if center_u < outer_start or center_u > outer_end:
                outside.append(component_id)
                continue
            word_index = int(np.searchsorted(np.asarray(cuts), center_u, side="right"))
            crossed = [
                index for index, cut in enumerate(cuts)
                if interval_start + minimum_boundary_clearance_px < cut < interval_end - minimum_boundary_clearance_px
            ]
            receipt = {
                "component_id": component_id,
                "line_id": line_id,
                "winner_unit_id": units[word_index]["unit_id"],
                "center_u": round(center_u, 6),
                "u_interval": [round(interval_start, 6), round(interval_end, 6)],
                "crossed_boundary_indices": crossed,
            }
            if abstain_on_boundary_crossing and crossed:
                ambiguous.append(receipt)
                continue
            by_unit[units[word_index]["unit_id"]].append(component_id)
            receipts.append(receipt)
    for values in by_unit.values():
        values.sort()
    return {
        "component_ids_by_unit": by_unit,
        "ambiguous_components": ambiguous,
        "outside_outer_interval_component_ids": sorted(outside),
        "assignment_receipts": receipts,
        "policy": {
            "abstain_on_boundary_crossing": abstain_on_boundary_crossing,
            "minimum_boundary_clearance_px": minimum_boundary_clearance_px,
            "global_disjointness": True,
        },
    }


def locator_strip_assignment(
    framed: Mapping[str, Any],
    line_assignments: Mapping[str, Any],
    *,
    minimum_score_margin: float = 0.08,
) -> dict[str, Any]:
    """Assign line-owned components using 1-D overlap with rough locator spans."""

    if not 0 <= minimum_score_margin <= 1:
        raise EnvelopeError("minimum_score_margin must fall from zero to one")
    frames = framed["frames"]
    by_unit = {unit["unit_id"]: [] for frame in frames.values() for unit in frame["units"]}
    ambiguous: list[dict[str, Any]] = []
    unsupported: list[int] = []
    receipts: list[dict[str, Any]] = []
    for line_id, component_ids in line_assignments["component_ids_by_line"].items():
        units = frames[line_id]["units"]
        for component_id in component_ids:
            projected = framed["components"][component_id]["by_line"][line_id]
            start, end = (float(value) for value in projected["u_interval"])
            center = float(projected["center_u"])
            component_width = max(1.0, end - start)
            scores: list[dict[str, Any]] = []
            for unit in units:
                left, right = (float(value) for value in unit["locator_u_interval"])
                intersection = max(0.0, min(end, right) - max(start, left))
                if intersection <= 0 and not left <= center <= right:
                    continue
                overlap = intersection / max(1.0, min(component_width, right - left))
                half = max(1.0, (right - left) / 2.0)
                center_support = max(0.0, 1.0 - abs(center - float(unit["anchor_u"])) / half)
                score = overlap * 0.65 + center_support * 0.35
                scores.append({"unit_id": unit["unit_id"], "score": score, "overlap": overlap, "center_support": center_support})
            scores.sort(key=lambda row: (-row["score"], row["unit_id"]))
            if not scores:
                unsupported.append(component_id)
                continue
            runner = scores[1] if len(scores) > 1 else None
            margin = scores[0]["score"] - (runner["score"] if runner else 0.0)
            receipt = {
                "component_id": component_id,
                "line_id": line_id,
                "winner_unit_id": scores[0]["unit_id"],
                "winner_score": round(scores[0]["score"], 6),
                "runner_up_unit_id": runner["unit_id"] if runner else None,
                "runner_up_score": round(runner["score"], 6) if runner else None,
                "score_margin": round(margin, 6),
            }
            if runner is not None and margin < minimum_score_margin:
                ambiguous.append(receipt)
                continue
            by_unit[scores[0]["unit_id"]].append(component_id)
            receipts.append(receipt)
    for values in by_unit.values():
        values.sort()
    return {
        "component_ids_by_unit": by_unit,
        "ambiguous_components": ambiguous,
        "unsupported_component_ids": sorted(unsupported),
        "assignment_receipts": receipts,
        "policy": {"minimum_score_margin": minimum_score_margin, "global_disjointness": True},
    }
