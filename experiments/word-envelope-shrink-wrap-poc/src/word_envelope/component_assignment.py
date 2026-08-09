"""Deterministic, disjoint assignment of ink components to word locators.

Locators are proposals, not truth.  These helpers expose competition between
overlapping word boxes and make ambiguity explicit instead of letting every box
own every connected component it touches.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np
from scipy import ndimage

from .engine import EnvelopeError


LOCATOR_SCORE_FEATURES = (
    "component_inside_locator_fraction",
    "center_x_support",
    "center_y_support",
    "horizontal_overlap",
    "vertical_overlap",
)


def _bbox(value: Any) -> tuple[int, int, int, int]:
    if (
        not isinstance(value, Sequence)
        or isinstance(value, (str, bytes))
        or len(value) != 4
        or any(not isinstance(item, int) or isinstance(item, bool) for item in value)
    ):
        raise EnvelopeError("Locator bbox must contain four integers")
    x, y, width, height = (int(item) for item in value)
    if x < 0 or y < 0 or width < 1 or height < 1:
        raise EnvelopeError("Locator bbox must have nonnegative origin and positive size")
    return x, y, width, height


def _overlap_fraction(left: tuple[int, int], right: tuple[int, int]) -> float:
    start = max(left[0], right[0])
    end = min(left[1], right[1])
    return max(0, end - start) / max(1, min(left[1] - left[0], right[1] - right[0]))


def score_component_locators(
    ink_mask: np.ndarray,
    locators: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    """Score each 8-connected component against every locator it touches."""

    ink = np.asarray(ink_mask)
    if ink.ndim != 2:
        raise EnvelopeError("Ink mask must be two-dimensional")
    ink = ink > 0
    height, width = ink.shape
    locator_rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for order, locator in enumerate(locators):
        unit_id = locator.get("unit_id")
        if not isinstance(unit_id, str) or not unit_id or unit_id in seen:
            raise EnvelopeError("Locators require unique nonempty unit_id values")
        seen.add(unit_id)
        x, y, box_width, box_height = _bbox(locator.get("bbox_xywh"))
        if x + box_width > width or y + box_height > height:
            raise EnvelopeError(f"Locator {unit_id} falls outside the ink mask")
        locator_rows.append(
            {
                "unit_id": unit_id,
                "bbox_xywh": [x, y, box_width, box_height],
                "order": order,
            }
        )

    labels, count = ndimage.label(ink, structure=np.ones((3, 3), dtype=np.uint8))
    slices = ndimage.find_objects(labels)
    areas = np.bincount(labels.ravel(), minlength=count + 1)
    centers = ndimage.center_of_mass(ink, labels, range(1, count + 1)) if count else []
    components: list[dict[str, Any]] = []
    by_component: dict[int, list[dict[str, Any]]] = {}
    touched_by_unit: dict[str, list[int]] = {row["unit_id"]: [] for row in locator_rows}
    for component_id in range(1, count + 1):
        component_slice = slices[component_id - 1]
        if component_slice is None:
            continue
        y_slice, x_slice = component_slice
        x0, x1 = int(x_slice.start), int(x_slice.stop)
        y0, y1 = int(y_slice.start), int(y_slice.stop)
        area = int(areas[component_id])
        center_y, center_x = centers[component_id - 1]
        component = {
            "component_id": component_id,
            "area_px": area,
            "bbox_xywh": [x0, y0, x1 - x0, y1 - y0],
            "center_xy": [round(float(center_x), 6), round(float(center_y), 6)],
        }
        components.append(component)
        scores: list[dict[str, Any]] = []
        for locator in locator_rows:
            x, y, box_width, box_height = locator["bbox_xywh"]
            ix0, iy0 = max(x0, x), max(y0, y)
            ix1, iy1 = min(x1, x + box_width), min(y1, y + box_height)
            if ix1 <= ix0 or iy1 <= iy0:
                continue
            intersection = int(
                np.count_nonzero(
                    labels[iy0:iy1, ix0:ix1] == component_id
                )
            )
            if intersection == 0:
                continue
            inside_fraction = intersection / max(1, area)
            dx = abs(float(center_x) - (x + box_width / 2.0)) / max(1.0, box_width / 2.0)
            dy = abs(float(center_y) - (y + box_height / 2.0)) / max(1.0, box_height / 2.0)
            center_x_support = max(0.0, 1.0 - dx)
            center_y_support = max(0.0, 1.0 - dy)
            vertical_overlap = _overlap_fraction((y0, y1), (y, y + box_height))
            horizontal_overlap = _overlap_fraction((x0, x1), (x, x + box_width))
            # Pixel containment dominates; center and axis support break ties for
            # long flourishes that enter two neighboring proposal boxes.
            score = (
                inside_fraction * 0.58
                + center_x_support * 0.16
                + center_y_support * 0.16
                + horizontal_overlap * 0.05
                + vertical_overlap * 0.05
            )
            scores.append(
                {
                    "unit_id": locator["unit_id"],
                    "intersection_pixels": intersection,
                    "component_inside_locator_fraction": round(inside_fraction, 6),
                    "center_x_support": round(center_x_support, 6),
                    "center_y_support": round(center_y_support, 6),
                    "horizontal_overlap": round(horizontal_overlap, 6),
                    "vertical_overlap": round(vertical_overlap, 6),
                    "score": round(score, 6),
                    "locator_order": locator["order"],
                }
            )
            touched_by_unit[locator["unit_id"]].append(component_id)
        scores.sort(key=lambda row: (-row["score"], -row["intersection_pixels"], row["locator_order"]))
        by_component[component_id] = scores
    return {
        "labels": labels,
        "components": components,
        "scores_by_component": by_component,
        "touched_component_ids_by_unit": {
            unit_id: sorted(set(values)) for unit_id, values in touched_by_unit.items()
        },
        "locators": locator_rows,
    }


def exclusive_component_assignment(
    scored: Mapping[str, Any],
    *,
    minimum_score: float = 0.12,
    minimum_score_margin: float = 0.08,
    unit_groups: Mapping[str, str] | None = None,
    cross_group_minimum_score_margin: float | None = None,
) -> dict[str, Any]:
    """Assign each supported component to at most one word or mark it ambiguous."""

    if not 0 <= minimum_score <= 1 or not 0 <= minimum_score_margin <= 1:
        raise EnvelopeError("Assignment thresholds must fall from zero to one")
    if cross_group_minimum_score_margin is not None:
        if not 0 <= cross_group_minimum_score_margin <= 1:
            raise EnvelopeError("Cross-group score margin must fall from zero to one")
        if unit_groups is None:
            raise EnvelopeError("Cross-group score margin requires unit_groups")
        known = {row["unit_id"] for row in scored["locators"]}
        if set(unit_groups) != known or any(not value for value in unit_groups.values()):
            raise EnvelopeError("unit_groups must map every locator to a nonempty group")
    assignments: dict[str, list[int]] = {
        row["unit_id"]: [] for row in scored["locators"]
    }
    ambiguous: list[dict[str, Any]] = []
    unsupported: list[int] = []
    receipts: list[dict[str, Any]] = []
    for component in scored["components"]:
        component_id = int(component["component_id"])
        scores = list(scored["scores_by_component"].get(component_id, []))
        if not scores or float(scores[0]["score"]) < minimum_score:
            unsupported.append(component_id)
            continue
        best = scores[0]
        runner_up = scores[1] if len(scores) > 1 else None
        margin = float(best["score"]) - (
            float(runner_up["score"]) if runner_up is not None else 0.0
        )
        cross_group_competition = bool(
            runner_up is not None
            and unit_groups is not None
            and unit_groups[best["unit_id"]] != unit_groups[runner_up["unit_id"]]
        )
        required_margin = minimum_score_margin
        if cross_group_competition and cross_group_minimum_score_margin is not None:
            required_margin = cross_group_minimum_score_margin
        receipt = {
            "component_id": component_id,
            "winner_unit_id": best["unit_id"],
            "winner_score": best["score"],
            "runner_up_unit_id": runner_up["unit_id"] if runner_up else None,
            "runner_up_score": runner_up["score"] if runner_up else None,
            "score_margin": round(margin, 6),
            "required_score_margin": required_margin,
            "competition_scope": "cross_group" if cross_group_competition else "within_group",
        }
        if runner_up is not None and margin < required_margin:
            ambiguous.append(receipt)
            continue
        assignments[best["unit_id"]].append(component_id)
        receipts.append(receipt)
    for values in assignments.values():
        values.sort()
    return {
        "component_ids_by_unit": assignments,
        "ambiguous_components": ambiguous,
        "unsupported_component_ids": unsupported,
        "assignment_receipts": receipts,
        "policy": {
            "minimum_score": minimum_score,
            "minimum_score_margin": minimum_score_margin,
            "cross_group_minimum_score_margin": cross_group_minimum_score_margin,
            "unit_groups_bound": unit_groups is not None,
            "global_disjointness": True,
            "ambiguous_components_are_unassigned": True,
        },
    }


def rescore_component_locators(
    scored: Mapping[str, Any],
    weights: Mapping[str, float],
) -> dict[str, Any]:
    """Reweight frozen geometric evidence without relabeling ink components.

    This is intentionally separate from component extraction so a bounded scoring
    sweep can freeze every acting candidate before sealed evaluation is loaded.
    """

    if set(weights) != set(LOCATOR_SCORE_FEATURES):
        raise EnvelopeError(
            "Locator score weights must provide exactly: "
            + ", ".join(LOCATOR_SCORE_FEATURES)
        )
    normalized: dict[str, float] = {}
    total = 0.0
    for feature in LOCATOR_SCORE_FEATURES:
        value = weights[feature]
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise EnvelopeError("Locator score weights must be numeric")
        number = float(value)
        if not np.isfinite(number) or number < 0:
            raise EnvelopeError("Locator score weights must be finite and nonnegative")
        normalized[feature] = number
        total += number
    if total <= 0:
        raise EnvelopeError("At least one locator score weight must be positive")
    normalized = {key: value / total for key, value in normalized.items()}

    rescored_by_component: dict[int, list[dict[str, Any]]] = {}
    for raw_component_id, raw_rows in scored["scores_by_component"].items():
        component_id = int(raw_component_id)
        rows: list[dict[str, Any]] = []
        for raw in raw_rows:
            row = dict(raw)
            row["score"] = round(
                sum(float(row[feature]) * normalized[feature] for feature in LOCATOR_SCORE_FEATURES),
                6,
            )
            rows.append(row)
        rows.sort(
            key=lambda row: (
                -row["score"],
                -row["intersection_pixels"],
                row["locator_order"],
            )
        )
        rescored_by_component[component_id] = rows

    result = dict(scored)
    result["scores_by_component"] = rescored_by_component
    result["score_weights"] = normalized
    return result


def estimate_group_centerlines(
    scored: Mapping[str, Any],
    component_ids_by_unit: Mapping[str, Sequence[int]],
    unit_groups: Mapping[str, str],
    *,
    minimum_component_area_px: int = 50,
) -> dict[str, dict[str, Any]]:
    """Fit robust acting-only ink centerlines from high-confidence assignments."""

    if minimum_component_area_px < 1:
        raise EnvelopeError("minimum_component_area_px must be positive")
    known = {row["unit_id"] for row in scored["locators"]}
    if set(component_ids_by_unit) != known or set(unit_groups) != known:
        raise EnvelopeError("Assignments and unit_groups must cover every locator")
    components = {
        int(row["component_id"]): row for row in scored["components"]
    }
    grouped: dict[str, set[int]] = {}
    for unit_id, component_ids in component_ids_by_unit.items():
        grouped.setdefault(unit_groups[unit_id], set()).update(int(value) for value in component_ids)

    result: dict[str, dict[str, Any]] = {}
    for group_id, component_ids in sorted(grouped.items()):
        rows = [
            components[component_id]
            for component_id in sorted(component_ids)
            if component_id in components
            and int(components[component_id]["area_px"]) >= minimum_component_area_px
        ]
        if len(rows) < 2:
            continue
        x = np.asarray([float(row["center_xy"][0]) for row in rows], dtype=np.float64)
        y = np.asarray([float(row["center_xy"][1]) for row in rows], dtype=np.float64)
        weights = np.sqrt(
            np.asarray([float(row["area_px"]) for row in rows], dtype=np.float64)
        )
        keep = np.ones(len(rows), dtype=bool)
        slope, intercept = 0.0, float(np.average(y, weights=weights))
        for _ in range(4):
            design = np.column_stack((x[keep], np.ones(int(keep.sum()))))
            weighted_design = design * np.sqrt(weights[keep])[:, None]
            weighted_y = y[keep] * np.sqrt(weights[keep])
            slope, intercept = np.linalg.lstsq(weighted_design, weighted_y, rcond=None)[0]
            residuals = np.abs(y - (slope * x + intercept))
            median = float(np.median(residuals[keep]))
            threshold = max(24.0, median * 3.5)
            updated = residuals <= threshold
            if int(updated.sum()) < 2 or np.array_equal(updated, keep):
                break
            keep = updated
        residuals = np.abs(y - (slope * x + intercept))
        robust_scale = max(18.0, float(np.median(residuals[keep])) * 1.4826)
        result[group_id] = {
            "slope": round(float(slope), 9),
            "intercept": round(float(intercept), 6),
            "scale_px": round(robust_scale, 6),
            "fitted_component_ids": [
                int(rows[index]["component_id"])
                for index in range(len(rows))
                if keep[index]
            ],
            "excluded_component_ids": [
                int(rows[index]["component_id"])
                for index in range(len(rows))
                if not keep[index]
            ],
        }
    return result


def add_group_centerline_support(
    scored: Mapping[str, Any],
    centerlines: Mapping[str, Mapping[str, Any]],
    unit_groups: Mapping[str, str],
    *,
    weight: float,
    scale_multiplier: float = 2.5,
    cross_group_only: bool = False,
    minimum_component_area_px: int = 1,
) -> dict[str, Any]:
    """Blend frozen locator scores with proximity to an acting-only ink line."""

    if not 0 <= weight <= 1:
        raise EnvelopeError("Centerline support weight must fall from zero to one")
    if not np.isfinite(scale_multiplier) or scale_multiplier <= 0:
        raise EnvelopeError("Centerline scale multiplier must be positive")
    if minimum_component_area_px < 1:
        raise EnvelopeError("minimum_component_area_px must be positive")
    known = {row["unit_id"] for row in scored["locators"]}
    if set(unit_groups) != known:
        raise EnvelopeError("unit_groups must cover every locator")
    components = {
        int(row["component_id"]): row for row in scored["components"]
    }
    rows_by_component: dict[int, list[dict[str, Any]]] = {}
    for raw_component_id, raw_rows in scored["scores_by_component"].items():
        component_id = int(raw_component_id)
        component = components[component_id]
        center_x, center_y = (float(value) for value in component["center_xy"])
        base_groups = [unit_groups[row["unit_id"]] for row in raw_rows[:2]]
        use_support = int(component["area_px"]) >= minimum_component_area_px and (
            not cross_group_only
            or (len(base_groups) >= 2 and base_groups[0] != base_groups[1])
        )
        rows: list[dict[str, Any]] = []
        for raw in raw_rows:
            row = dict(raw)
            group_id = unit_groups[row["unit_id"]]
            line = centerlines.get(group_id)
            if line is None or not use_support:
                support = 0.0
                blended = float(row["score"])
            else:
                predicted_y = float(line["slope"]) * center_x + float(line["intercept"])
                distance = abs(center_y - predicted_y)
                sigma = max(1.0, float(line["scale_px"]) * scale_multiplier)
                support = float(np.exp(-0.5 * (distance / sigma) ** 2))
                blended = float(row["score"]) * (1.0 - weight) + support * weight
            row["base_score"] = raw["score"]
            row["group_centerline_support"] = round(support, 6)
            row["score"] = round(blended, 6)
            rows.append(row)
        rows.sort(
            key=lambda row: (
                -row["score"],
                -row["intersection_pixels"],
                row["locator_order"],
            )
        )
        rows_by_component[component_id] = rows
    result = dict(scored)
    result["scores_by_component"] = rows_by_component
    result["group_centerline_policy"] = {
        "weight": weight,
        "scale_multiplier": scale_multiplier,
        "cross_group_only": cross_group_only,
        "minimum_component_area_px": minimum_component_area_px,
        "group_count": len(centerlines),
    }
    return result


def sequential_component_claims(
    scored: Mapping[str, Any],
    unit_order: Sequence[str],
) -> dict[str, Any]:
    """Claim touched components once in the supplied order, preserving receipts."""

    known = {row["unit_id"] for row in scored["locators"]}
    if set(unit_order) != known or len(unit_order) != len(known):
        raise EnvelopeError("Sequential unit order must contain every locator exactly once")
    claimed: set[int] = set()
    by_unit: dict[str, list[int]] = {}
    blocked: dict[str, list[int]] = {}
    for unit_id in unit_order:
        touched = list(scored["touched_component_ids_by_unit"][unit_id])
        available = [component_id for component_id in touched if component_id not in claimed]
        already = [component_id for component_id in touched if component_id in claimed]
        by_unit[unit_id] = available
        blocked[unit_id] = already
        claimed.update(available)
    return {
        "component_ids_by_unit": by_unit,
        "already_claimed_component_ids_by_unit": blocked,
        "claimed_component_ids": sorted(claimed),
        "unit_order": list(unit_order),
        "policy": {
            "global_disjointness": True,
            "first_touch_wins": True,
        },
    }


def confidence_order(scored: Mapping[str, Any]) -> list[str]:
    """Rank locators by acting-only component exclusivity before first-touch claims."""

    rows: list[tuple[float, int, str]] = []
    for locator in scored["locators"]:
        unit_id = locator["unit_id"]
        touched = scored["touched_component_ids_by_unit"][unit_id]
        if not touched:
            rows.append((-1.0, locator["order"], unit_id))
            continue
        weighted_margin = 0.0
        total_area = 0
        margins: list[float] = []
        for component_id in touched:
            component = scored["components"][component_id - 1]
            area = int(component["area_px"])
            matches = scored["scores_by_component"][component_id]
            own = next(value for value in matches if value["unit_id"] == unit_id)
            competing = max(
                (float(value["score"]) for value in matches if value["unit_id"] != unit_id),
                default=0.0,
            )
            margin = float(own["score"]) - competing
            margins.append(margin)
            weighted_margin += margin * area
            total_area += area
        weighted_mean = weighted_margin / max(1, total_area)
        # A broad locator that is excellent for one component but loses another
        # component to its neighbor is unsafe to run first: first-touch claiming
        # would steal both.  The weakest touched component therefore dominates.
        confidence = min(margins) * 0.75 + weighted_mean * 0.25
        rows.append((confidence, locator["order"], unit_id))
    rows.sort(key=lambda value: (-value[0], value[1], value[2]))
    return [value[2] for value in rows]
