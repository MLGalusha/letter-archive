"""Line-coordinate ribbon envelopes for long, highly fragmented words."""

from __future__ import annotations

from typing import Any

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from skimage.measure import approximate_polygon, find_contours
from skimage.morphology import convex_hull_image

from .engine import EnvelopeError


def _polygon_area(polygon: list[list[float]]) -> float:
    points = np.asarray(polygon, dtype=np.float64)
    return abs(
        float(
            np.dot(points[:, 0], np.roll(points[:, 1], -1))
            - np.dot(points[:, 1], np.roll(points[:, 0], -1))
        )
        / 2.0
    )


def _rasterize(shape: tuple[int, int], polygon: list[list[float]]) -> np.ndarray:
    image = Image.new("L", (shape[1], shape[0]), 0)
    ImageDraw.Draw(image).polygon(
        [(float(x), float(y)) for x, y in polygon], fill=255
    )
    return np.asarray(image, dtype=np.uint8) > 0


def _smooth_polygon(
    points_xy: np.ndarray,
    *,
    bin_width_px: float,
    padding_px: float,
    simplification_tolerance_px: float,
) -> list[list[float]]:
    center = points_xy.mean(axis=0)
    centered = points_xy - center
    _u, _s, axes = np.linalg.svd(centered, full_matrices=False)
    direction = axes[0]
    if direction[0] < 0:
        direction = -direction
    normal = np.asarray([-direction[1], direction[0]], dtype=np.float64)
    along = centered @ direction
    across = centered @ normal
    start = float(np.floor(along.min() / bin_width_px) * bin_width_px)
    end = float(np.ceil(along.max() / bin_width_px) * bin_width_px)
    if end <= start:
        end = start + bin_width_px
    count = max(1, int(round((end - start) / bin_width_px)))
    indices = np.clip(
        np.floor((along - start) / bin_width_px).astype(np.int64), 0, count - 1
    )
    lower = np.full(count, np.nan, dtype=np.float64)
    upper = np.full(count, np.nan, dtype=np.float64)
    for index in range(count):
        values = across[indices == index]
        if len(values):
            lower[index] = float(values.min()) - padding_px
            upper[index] = float(values.max()) + padding_px
    observed = np.flatnonzero(np.isfinite(lower))
    if not len(observed):
        raise EnvelopeError("The ribbon has no supported line bins")
    all_indices = np.arange(count, dtype=np.float64)
    lower = np.interp(all_indices, observed.astype(np.float64), lower[observed])
    upper = np.interp(all_indices, observed.astype(np.float64), upper[observed])
    # Neighbor expansion makes linear joins conservative at bin transitions;
    # simplification is then allowed only if raster replay still covers every
    # selected ink pixel.
    lower = np.asarray(
        [
            lower[max(0, index - 1) : min(count, index + 2)].min()
            for index in range(count)
        ],
        dtype=np.float64,
    )
    upper = np.asarray(
        [
            upper[max(0, index - 1) : min(count, index + 2)].max()
            for index in range(count)
        ],
        dtype=np.float64,
    )
    centers_u = start + (np.arange(count, dtype=np.float64) + 0.5) * bin_width_px
    lower_uv: list[tuple[float, float]] = [(start, lower[0])]
    upper_uv: list[tuple[float, float]] = [(start, upper[0])]
    for index in range(count):
        lower_uv.append((float(centers_u[index]), lower[index]))
        upper_uv.append((float(centers_u[index]), upper[index]))
    lower_uv.append((end, lower[-1]))
    upper_uv.append((end, upper[-1]))
    uv = lower_uv + list(reversed(upper_uv))
    polygon = np.asarray(
        [
        [
            float(center[0] + along_value * direction[0] + across_value * normal[0]),
            float(center[1] + along_value * direction[1] + across_value * normal[1]),
        ]
        for along_value, across_value in uv
        ],
        dtype=np.float64,
    )
    if simplification_tolerance_px:
        polygon = approximate_polygon(
            np.vstack((polygon, polygon[0])),
            tolerance=simplification_tolerance_px,
        )
        if np.allclose(polygon[0], polygon[-1]):
            polygon = polygon[:-1]
    return [[round(float(x), 3), round(float(y), 3)] for x, y in polygon]


def fit_line_ribbon_envelope(
    selected_mask: np.ndarray,
    excluded_mask: np.ndarray,
    *,
    bin_widths_px: tuple[float, ...] = (4.0, 6.0, 8.0, 12.0),
    paddings_px: tuple[float, ...] = (2.0, 3.0, 4.0, 6.0),
    simplification_tolerances_px: tuple[float, ...] = (0.0, 1.0, 2.0, 3.0),
    minimum_selected_coverage: float = 1.0,
    maximum_excluded_contamination: float = 0.001,
) -> dict[str, Any]:
    """Fit a single x-monotone ribbon in the word's inferred line frame."""

    selected = np.asarray(selected_mask) > 0
    excluded = np.asarray(excluded_mask) > 0
    if selected.shape != excluded.shape or selected.ndim != 2:
        raise EnvelopeError("Ribbon masks must have the same two-dimensional shape")
    ys, xs = np.nonzero(selected)
    if len(xs) < 8:
        raise EnvelopeError("The selected word has too little ink for a ribbon")
    points = np.column_stack((xs, ys)).astype(np.float64)
    selected_pixels = int(selected.sum())
    selected_component_count = int(
        ndimage.label(selected, structure=np.ones((3, 3), dtype=np.uint8))[1]
    )
    trials: list[dict[str, Any]] = []
    accepted: list[dict[str, Any]] = []
    for bin_width in bin_widths_px:
        for padding in paddings_px:
            for tolerance in simplification_tolerances_px:
                polygon = _smooth_polygon(
                    points,
                    bin_width_px=bin_width,
                    padding_px=padding,
                    simplification_tolerance_px=tolerance,
                )
                inside = _rasterize(selected.shape, polygon)
                selected_inside = int(np.count_nonzero(inside & selected))
                excluded_inside = int(np.count_nonzero(inside & excluded))
                coverage = selected_inside / selected_pixels
                contamination = excluded_inside / max(
                    1, selected_inside + excluded_inside
                )
                trial = {
                    "bin_width_px": bin_width,
                    "padding_px": padding,
                    "simplification_tolerance_px": tolerance,
                    "selected_ink_coverage": round(coverage, 9),
                    "excluded_ink_inside_pixels": excluded_inside,
                    "excluded_ink_contamination": round(contamination, 9),
                    "envelope_area_px2": round(_polygon_area(polygon), 6),
                    "polygon_point_count": len(polygon),
                }
                if (
                    coverage >= minimum_selected_coverage
                    and contamination <= maximum_excluded_contamination
                ):
                    trial["status"] = "accepted"
                    accepted.append({**trial, "polygon": polygon})
                else:
                    trial["status"] = "rejected"
                trials.append(trial)
    if not accepted:
        raise EnvelopeError("No line ribbon covers the selected word safely")
    winner = min(
        accepted,
        key=lambda item: (
            item["excluded_ink_inside_pixels"],
            item["envelope_area_px2"],
            item["polygon_point_count"],
        ),
    )
    return {
        "method": "line_coordinate_smooth_ribbon",
        "profile": (
            f"bins-{winner['bin_width_px']:g}-pad-{winner['padding_px']:g}"
            f"-simplify-{winner['simplification_tolerance_px']:g}"
        ),
        "polygon": winner["polygon"],
        "selected_ink_coverage": winner["selected_ink_coverage"],
        "excluded_ink_contamination": winner["excluded_ink_contamination"],
        "excluded_ink_inside_pixels": winner["excluded_ink_inside_pixels"],
        "envelope_area_px2": winner["envelope_area_px2"],
        "selected_component_count": selected_component_count,
        "polygon_point_count": winner["polygon_point_count"],
        "trials": trials,
    }


def fit_simplified_convex_envelope(
    selected_mask: np.ndarray,
    excluded_mask: np.ndarray,
    *,
    dilation_iterations: tuple[int, ...] = (1, 2),
    simplification_tolerances_px: tuple[float, ...] = (1.0, 2.0, 3.0),
    minimum_selected_coverage: float = 1.0,
    maximum_excluded_contamination: float = 0.003,
    maximum_polygon_points: int = 32,
) -> dict[str, Any]:
    """Prefer a legible simple hull when its extra contamination is still tiny."""

    selected = np.asarray(selected_mask) > 0
    excluded = np.asarray(excluded_mask) > 0
    if selected.shape != excluded.shape or selected.ndim != 2:
        raise EnvelopeError("Convex fallback masks must have the same shape")
    if int(selected.sum()) < 8:
        raise EnvelopeError("The selected word has too little ink for a convex envelope")
    hull = convex_hull_image(selected)
    selected_pixels = int(selected.sum())
    selected_component_count = int(
        ndimage.label(selected, structure=np.ones((3, 3), dtype=np.uint8))[1]
    )
    trials: list[dict[str, Any]] = []
    accepted: list[dict[str, Any]] = []
    for iterations in dilation_iterations:
        expanded = ndimage.binary_dilation(hull, iterations=iterations)
        contours = find_contours(np.pad(expanded, 1), 0.5)
        if not contours:
            continue
        raw = max(contours, key=len) - 1.0
        raw_xy = raw[:, [1, 0]]
        for tolerance in simplification_tolerances_px:
            polygon_array = approximate_polygon(
                np.vstack((raw_xy, raw_xy[0])), tolerance=tolerance
            )
            if np.allclose(polygon_array[0], polygon_array[-1]):
                polygon_array = polygon_array[:-1]
            polygon = [
                [round(float(x), 3), round(float(y), 3)]
                for x, y in polygon_array
            ]
            inside = _rasterize(selected.shape, polygon)
            selected_inside = int(np.count_nonzero(inside & selected))
            excluded_inside = int(np.count_nonzero(inside & excluded))
            coverage = selected_inside / selected_pixels
            contamination = excluded_inside / max(
                1, selected_inside + excluded_inside
            )
            trial = {
                "dilation_iterations": iterations,
                "simplification_tolerance_px": tolerance,
                "selected_ink_coverage": round(coverage, 9),
                "excluded_ink_inside_pixels": excluded_inside,
                "excluded_ink_contamination": round(contamination, 9),
                "envelope_area_px2": round(_polygon_area(polygon), 6),
                "polygon_point_count": len(polygon),
            }
            if (
                coverage >= minimum_selected_coverage
                and contamination <= maximum_excluded_contamination
                and len(polygon) <= maximum_polygon_points
            ):
                trial["status"] = "accepted"
                accepted.append({**trial, "polygon": polygon})
            else:
                trial["status"] = "rejected"
            trials.append(trial)
    if not accepted:
        raise EnvelopeError("No simple convex envelope covers the selected word safely")
    winner = min(
        accepted,
        key=lambda item: (
            item["polygon_point_count"],
            item["excluded_ink_inside_pixels"],
            item["envelope_area_px2"],
        ),
    )
    return {
        "method": "simplified_convex_hull",
        "profile": (
            f"dilate-{winner['dilation_iterations']}"
            f"-simplify-{winner['simplification_tolerance_px']:g}"
        ),
        "polygon": winner["polygon"],
        "selected_ink_coverage": winner["selected_ink_coverage"],
        "excluded_ink_contamination": winner["excluded_ink_contamination"],
        "excluded_ink_inside_pixels": winner["excluded_ink_inside_pixels"],
        "envelope_area_px2": winner["envelope_area_px2"],
        "selected_component_count": selected_component_count,
        "polygon_point_count": winner["polygon_point_count"],
        "trials": trials,
    }
