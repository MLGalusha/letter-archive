"""Deterministic geometry-only envelopes for fragmented semantic words."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import minimum_spanning_tree
from scipy.spatial import cKDTree
from skimage import measure
from skimage.morphology import disk, skeletonize
from shapely.geometry import Polygon, box

from .engine import EnvelopeError, canonicalize_polygon, polygon_checksum


@dataclass(frozen=True)
class FragmentedEnvelopeProfile:
    name: str
    padding_stroke_factor: float
    bridge_stroke_factor: float
    simplify_stroke_factor: float


DEFAULT_PROFILES = (
    FragmentedEnvelopeProfile("compact", 0.75, 0.38, 0.34),
    FragmentedEnvelopeProfile("balanced", 1.10, 0.46, 0.44),
    FragmentedEnvelopeProfile("roomy", 1.45, 0.55, 0.54),
)


def estimate_stroke_width(mask: np.ndarray) -> float:
    selected = np.asarray(mask, dtype=bool)
    if selected.ndim != 2 or not np.any(selected):
        raise EnvelopeError("Stroke width requires non-empty two-dimensional ink")
    distances = ndimage.distance_transform_edt(selected)
    skeleton = skeletonize(selected)
    values = distances[skeleton] * 2.0
    if values.size == 0:
        values = distances[selected] * 2.0
    return max(1.0, float(np.median(values)))


def _nearest_component_pairs(labels: np.ndarray, count: int) -> tuple[np.ndarray, dict[tuple[int, int], tuple[tuple[int, int], tuple[int, int]]]]:
    coordinates = [np.argwhere(labels == component_id) for component_id in range(1, count + 1)]
    distances = np.zeros((count, count), dtype=np.float64)
    endpoints: dict[tuple[int, int], tuple[tuple[int, int], tuple[int, int]]] = {}
    for left in range(count):
        tree = cKDTree(coordinates[left])
        for right in range(left + 1, count):
            values, indexes = tree.query(coordinates[right], k=1)
            right_index = int(np.argmin(values))
            left_index = int(indexes[right_index])
            distance = float(values[right_index])
            distances[left, right] = distance
            distances[right, left] = distance
            left_yx = tuple(int(value) for value in coordinates[left][left_index])
            right_yx = tuple(int(value) for value in coordinates[right][right_index])
            endpoints[(left, right)] = (left_yx, right_yx)
    return distances, endpoints


def _tree_support(selected: np.ndarray, bridge_width: int) -> tuple[np.ndarray, int, float]:
    labels, count = ndimage.label(
        selected,
        structure=np.ones((3, 3), dtype=np.uint8),
    )
    if count <= 1:
        return selected.copy(), count, 0.0
    distances, endpoints = _nearest_component_pairs(labels, count)
    tree = minimum_spanning_tree(csr_matrix(distances)).tocoo()
    image = Image.fromarray(np.where(selected, 255, 0).astype(np.uint8), mode="L")
    drawing = ImageDraw.Draw(image)
    total_bridge_length = 0.0
    for left, right, distance in zip(tree.row, tree.col, tree.data):
        key = (min(int(left), int(right)), max(int(left), int(right)))
        first_yx, second_yx = endpoints[key]
        drawing.line(
            [(first_yx[1], first_yx[0]), (second_yx[1], second_yx[0])],
            fill=255,
            width=bridge_width,
        )
        total_bridge_length += float(distance)
    return np.asarray(image, dtype=np.uint8) > 0, count, total_bridge_length


def _rasterize_polygon(shape: Polygon, shape_hw: tuple[int, int]) -> np.ndarray:
    height, width = shape_hw
    image = Image.new("L", (width, height), 0)
    drawing = ImageDraw.Draw(image)
    drawing.polygon(
        [(float(x), float(y)) for x, y in shape.exterior.coords],
        fill=255,
    )
    for interior in shape.interiors:
        drawing.polygon(
            [(float(x), float(y)) for x, y in interior.coords],
            fill=0,
        )
    return np.asarray(image, dtype=np.uint8) > 0


def _smoothed_shape_from_region(
    region: np.ndarray,
    selected: np.ndarray,
    simplify: float,
) -> tuple[Polygon, np.ndarray]:
    padded = np.pad(region.astype(np.uint8), 1)
    contours = measure.find_contours(padded, 0.5)
    if not contours:
        raise EnvelopeError("Fragmented envelope produced no outside contour")
    contour = max(contours, key=len)
    points = [(float(x - 1), float(y - 1)) for y, x in contour]
    shape = Polygon(points)
    if not shape.is_valid:
        shape = shape.buffer(0)
    if shape.geom_type != "Polygon" or shape.is_empty:
        raise EnvelopeError("Fragmented envelope contour is not one polygon")
    smoothing_radius = max(0.75, simplify * 0.85)
    smoothed = shape.buffer(
        smoothing_radius,
        join_style="round",
    ).buffer(
        -smoothing_radius * 0.55,
        join_style="round",
    )
    if smoothed.geom_type == "Polygon" and not smoothed.is_empty:
        shape = smoothed
    simplified = shape.simplify(simplify, preserve_topology=True)
    if simplified.geom_type == "Polygon" and not simplified.is_empty:
        shape = simplified
    shape = shape.intersection(box(0.0, 0.0, float(region.shape[1]), float(region.shape[0])))
    if shape.geom_type != "Polygon" or shape.is_empty:
        raise EnvelopeError("Smoothed fragmented envelope escaped its crop")
    raster = _rasterize_polygon(shape, region.shape)
    growth = 0.5
    while np.any(selected & ~raster) and growth <= max(4.0, simplify * 2.5):
        grown = shape.buffer(growth, join_style="round").intersection(
            box(0.0, 0.0, float(region.shape[1]), float(region.shape[0]))
        )
        if grown.geom_type != "Polygon" or grown.is_empty:
            break
        shape = grown
        raster = _rasterize_polygon(shape, region.shape)
        growth += 0.5
    if np.any(selected & ~raster):
        raise EnvelopeError("Smoothed fragmented envelope lost selected ink")
    return shape, raster


def _polygon_from_shape(shape: Polygon) -> list[list[float]]:
    canonical = canonicalize_polygon(shape.exterior.coords)
    return [[float(x), float(y)] for x, y in canonical]


def fit_fragmented_envelope(
    selected_mask: np.ndarray,
    excluded_mask: np.ndarray | None = None,
    *,
    profiles: tuple[FragmentedEnvelopeProfile, ...] = DEFAULT_PROFILES,
) -> dict[str, Any]:
    selected = np.asarray(selected_mask, dtype=bool)
    if selected.ndim != 2 or int(selected.sum()) < 8:
        raise EnvelopeError("Fragmented envelope requires at least eight selected pixels")
    excluded = (
        np.asarray(excluded_mask, dtype=bool)
        if excluded_mask is not None
        else np.zeros_like(selected)
    )
    if excluded.shape != selected.shape:
        raise EnvelopeError("Excluded ink must match selected ink dimensions")
    if np.any(selected & excluded):
        raise EnvelopeError("Selected and excluded ink overlap")
    stroke_width = estimate_stroke_width(selected)
    candidates: dict[str, dict[str, Any]] = {}
    for profile in profiles:
        bridge_width = max(1, int(round(stroke_width * profile.bridge_stroke_factor)))
        support, component_count, bridge_length = _tree_support(selected, bridge_width)
        padding = max(2, int(round(stroke_width * profile.padding_stroke_factor)))
        region = ndimage.binary_dilation(support, structure=disk(padding))
        region = ndimage.binary_fill_holes(region)
        if int(ndimage.label(region, structure=np.ones((3, 3), dtype=np.uint8))[1]) != 1:
            raise EnvelopeError("Component-tree envelope did not become connected")
        if np.any(selected & ~region):
            raise EnvelopeError("Component-tree envelope lost selected ink")
        shape, region = _smoothed_shape_from_region(
            region,
            selected,
            max(0.5, stroke_width * profile.simplify_stroke_factor),
        )
        polygon = _polygon_from_shape(shape)
        excluded_inside = int(np.count_nonzero(region & excluded))
        candidates[profile.name] = {
            "region": region,
            "polygon": polygon,
            "polygon_sha256": polygon_checksum(polygon),
            "stroke_width_px": round(stroke_width, 6),
            "padding_px": padding,
            "bridge_width_px": bridge_width,
            "source_component_count": component_count,
            "mst_bridge_length_px": round(bridge_length, 6),
            "selected_ink_coverage": 1.0,
            "envelope_area_px2": int(region.sum()),
            "excluded_ink_inside_pixels": excluded_inside,
            "excluded_ink_fraction_inside_envelope": round(
                excluded_inside / max(1, int(region.sum())),
                9,
            ),
            "geometry_bridges_are_not_owned_ink": True,
        }
    return {
        "selected_pixels": int(selected.sum()),
        "selected_component_count": int(
            ndimage.label(selected, structure=np.ones((3, 3), dtype=np.uint8))[1]
        ),
        "stroke_width_px": round(stroke_width, 6),
        "candidates": candidates,
    }


def refine_existing_envelope(
    selected_mask: np.ndarray,
    existing_polygon: list[list[float]],
    excluded_mask: np.ndarray | None = None,
) -> dict[str, Any]:
    """Smooth and pad an already valid envelope without rebuilding its topology."""

    selected = np.asarray(selected_mask, dtype=bool)
    if selected.ndim != 2 or int(selected.sum()) < 8:
        raise EnvelopeError("Envelope refinement requires selected ink")
    excluded = (
        np.asarray(excluded_mask, dtype=bool)
        if excluded_mask is not None
        else np.zeros_like(selected)
    )
    if excluded.shape != selected.shape or np.any(selected & excluded):
        raise EnvelopeError("Refinement masks are incompatible")
    shape = Polygon([(float(x), float(y)) for x, y in existing_polygon])
    if not shape.is_valid:
        shape = shape.buffer(0)
    if shape.geom_type != "Polygon" or shape.is_empty:
        raise EnvelopeError("Existing envelope is not one valid polygon")
    stroke_width = estimate_stroke_width(selected)
    bounds = box(0.0, 0.0, float(selected.shape[1]), float(selected.shape[0]))
    candidates: dict[str, dict[str, Any]] = {}
    margins = {
        "compact": 0.55,
        "balanced": 0.85,
        "roomy": 1.15,
    }
    for name, margin_factor in margins.items():
        tolerance = max(0.6, stroke_width * 0.38)
        margin = max(2.0, stroke_width * margin_factor)
        refined = shape.simplify(tolerance, preserve_topology=True).buffer(
            margin,
            join_style="round",
        ).intersection(bounds)
        if refined.geom_type != "Polygon" or refined.is_empty:
            raise EnvelopeError("Refined existing envelope is not one polygon")
        region = _rasterize_polygon(refined, selected.shape)
        if np.any(selected & ~region):
            raise EnvelopeError("Refined existing envelope lost selected ink")
        excluded_inside = int(np.count_nonzero(region & excluded))
        polygon = _polygon_from_shape(refined)
        candidates[name] = {
            "region": region,
            "polygon": polygon,
            "polygon_sha256": polygon_checksum(polygon),
            "stroke_width_px": round(stroke_width, 6),
            "padding_px": round(margin, 6),
            "simplify_tolerance_px": round(tolerance, 6),
            "selected_ink_coverage": 1.0,
            "envelope_area_px2": int(region.sum()),
            "excluded_ink_inside_pixels": excluded_inside,
            "excluded_ink_fraction_inside_envelope": round(
                excluded_inside / max(1, int(region.sum())),
                9,
            ),
            "topology_source": "existing_accepted_envelope",
        }
    return {
        "selected_pixels": int(selected.sum()),
        "selected_component_count": int(
            ndimage.label(selected, structure=np.ones((3, 3), dtype=np.uint8))[1]
        ),
        "stroke_width_px": round(stroke_width, 6),
        "candidates": candidates,
    }
