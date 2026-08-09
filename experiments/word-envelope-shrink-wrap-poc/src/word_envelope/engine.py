"""Deterministic mask-to-envelope geometry.

Coordinates use crop pixel-edge space: ``(0, 0)`` is the upper-left crop edge
and ``(width, height)`` is the lower-right edge. Source projection is therefore
an exact translation by the crop origin.
"""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import asdict, dataclass
from typing import Any, Iterable, Literal, Sequence

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage, signal
from shapely import box, intersects_xy
from shapely.geometry import Polygon
from shapely.geometry.polygon import orient
from skimage import measure

from .io_utils import check_rss


Method = Literal["morphological", "soft_union"]
MAX_MASK_PIXELS = 2_000_000
MAX_PADDED_PIXELS = 4_000_000
MAX_MORPHOLOGY_FOOTPRINT_CELLS = 4096
MAX_SOFT_KERNEL_CELLS = 65_536
MAX_SOFT_FFT_PIXELS = 4_000_000
MAX_EXCLUDED_COMPONENTS_FOR_GATE = 20_000
ROUND_DIGITS = 3


class EnvelopeError(ValueError):
    """Raised when inputs cannot produce a safe semantic envelope."""


@dataclass(frozen=True)
class EnvelopeParams:
    """Parameters shared by both wrapping approaches.

    Bridge values are approximate maximum gaps, in pixels, rather than kernel
    radii. The soft-union approach converts them to Gaussian sigmas.
    """

    angle_degrees: float | None = None
    centerline: tuple[tuple[float, float], ...] = ()
    along_bridge_px: float = 14.0
    cross_bridge_px: float = 5.0
    padding_px: float = 4.0
    smooth_iterations: int = 2
    simplify_tolerance_px: float = 1.2
    soft_threshold: float = 0.18
    minimum_selected_coverage: float = 1.0
    minimum_selected_ink_pixels: int = 8
    maximum_envelope_fraction: float = 0.82
    maximum_envelope_to_ink_area_ratio: float = 12.0
    maximum_excluded_contamination: float = 0.05
    maximum_excluded_component_contamination: float = 0.25
    minimum_excluded_component_pixels_for_gate: int = 1
    maximum_vertices: int = 1024
    allow_border_touching_ink: bool = False

    @classmethod
    def from_mapping(cls, value: dict[str, Any]) -> "EnvelopeParams":
        known = {field for field in cls.__dataclass_fields__}
        unknown = sorted(set(value) - known)
        if unknown:
            raise EnvelopeError(f"Unknown envelope parameters: {unknown}")
        converted = dict(value)
        if "centerline" in converted:
            try:
                converted["centerline"] = tuple(
                    (float(point[0]), float(point[1]))
                    for point in converted["centerline"]
                )
            except (IndexError, TypeError, ValueError) as error:
                raise EnvelopeError(
                    "centerline must be a list of finite [x, y] points"
                ) from error
        return cls(**converted)

    def as_record(self) -> dict[str, Any]:
        value = asdict(self)
        value["centerline"] = [list(point) for point in self.centerline]
        return value


@dataclass(frozen=True)
class EnvelopeResult:
    method: Method
    polygon: tuple[tuple[float, float], ...]
    angle_degrees: float
    angle_source: str
    selected_component_count: int
    selected_ink_pixels: int
    selected_ink_covered_pixels: int
    selected_ink_coverage: float
    selected_ink_support_coverage: float
    envelope_area_px2: float
    envelope_perimeter_px: float
    polygon_vertex_count: int
    rough_box_area_px2: float
    ink_bbox_area_px2: float
    ink_bbox_fill_fraction: float
    envelope_to_ink_area_ratio: float
    envelope_to_ink_bbox_area_ratio: float
    envelope_fraction_of_rough_box: float
    total_area_reduction: float
    background_area_reduction: float
    excluded_ink_pixels: int
    excluded_ink_inside_pixels: int
    excluded_ink_contamination: float | None
    excluded_ink_support_contamination: float | None
    excluded_component_max_contamination: float | None
    joined_component_count: int
    envelope_component_count: int
    smoothing_iterations_applied: int
    simplify_tolerance_applied_px: float

    @property
    def polygon_checksum(self) -> str:
        return polygon_checksum(self.polygon)

    def as_record(self) -> dict[str, Any]:
        return {
            "method": self.method,
            "polygon": [[x, y] for x, y in self.polygon],
            "polygon_sha256": self.polygon_checksum,
            "angle_degrees": self.angle_degrees,
            "angle_source": self.angle_source,
            "selected_component_count": self.selected_component_count,
            "selected_ink_pixels": self.selected_ink_pixels,
            "selected_ink_covered_pixels": self.selected_ink_covered_pixels,
            "selected_ink_coverage": self.selected_ink_coverage,
            "selected_ink_support_coverage": self.selected_ink_support_coverage,
            "envelope_area_px2": self.envelope_area_px2,
            "envelope_perimeter_px": self.envelope_perimeter_px,
            "polygon_vertex_count": self.polygon_vertex_count,
            "rough_box_area_px2": self.rough_box_area_px2,
            "ink_bbox_area_px2": self.ink_bbox_area_px2,
            "ink_bbox_fill_fraction": self.ink_bbox_fill_fraction,
            "envelope_to_ink_area_ratio": self.envelope_to_ink_area_ratio,
            "envelope_to_ink_bbox_area_ratio": self.envelope_to_ink_bbox_area_ratio,
            "envelope_fraction_of_rough_box": self.envelope_fraction_of_rough_box,
            "total_area_reduction": self.total_area_reduction,
            "background_area_reduction": self.background_area_reduction,
            "excluded_ink_pixels": self.excluded_ink_pixels,
            "excluded_ink_inside_pixels": self.excluded_ink_inside_pixels,
            "excluded_ink_contamination": self.excluded_ink_contamination,
            "excluded_ink_support_contamination": self.excluded_ink_support_contamination,
            "excluded_component_max_contamination": self.excluded_component_max_contamination,
            "joined_component_count": self.joined_component_count,
            "envelope_component_count": self.envelope_component_count,
            "smoothing_iterations_applied": self.smoothing_iterations_applied,
            "simplify_tolerance_applied_px": self.simplify_tolerance_applied_px,
        }


def wrap_envelope(
    cleaned_mask: np.ndarray,
    params: EnvelopeParams,
    *,
    method: Method,
    excluded_mask: np.ndarray | None = None,
    rough_box: tuple[float, float, float, float] | None = None,
    allowed_polygon: Sequence[Sequence[float]] | None = None,
) -> EnvelopeResult:
    """Create and validate one deterministic outside envelope."""

    mask = _validated_mask(cleaned_mask, name="cleaned mask")
    height, width = mask.shape
    _validate_params(params, width=width, height=height)
    if not params.allow_border_touching_ink and (
        mask[0, :].any()
        or mask[-1, :].any()
        or mask[:, 0].any()
        or mask[:, -1].any()
    ):
        raise EnvelopeError(
            "Selected ink touches the crop boundary; expand the crop or explicitly "
            "allow border-touching ink"
        )
    excluded = (
        _validated_mask(excluded_mask, name="excluded mask", shape=mask.shape)
        if excluded_mask is not None
        else np.zeros_like(mask)
    )
    selected_pixels = int(mask.sum())
    if selected_pixels < params.minimum_selected_ink_pixels:
        raise EnvelopeError(
            f"Selected ink has {selected_pixels} pixels; minimum is "
            f"{params.minimum_selected_ink_pixels}"
        )
    selected_component_count = _component_count(mask)
    ink_ys, ink_xs = np.nonzero(mask)
    ink_bbox_area = float(
        (int(ink_xs.max()) - int(ink_xs.min()) + 1)
        * (int(ink_ys.max()) - int(ink_ys.min()) + 1)
    )
    angle, angle_source = estimate_angle(mask, params)

    if method == "morphological":
        region, joined_count = _morphological_region(mask, params, angle)
    elif method == "soft_union":
        region, joined_count = _soft_union_region(mask, params, angle)
    else:
        raise EnvelopeError(f"Unsupported wrapping method: {method}")

    region = ndimage.binary_fill_holes(region)
    envelope_count = _component_count(region)
    if envelope_count != 1:
        raise EnvelopeError(
            f"Envelope has {envelope_count} disconnected islands; increase the "
            "appropriate bridge or padding parameter"
        )

    if rough_box is None:
        rough_box = (0.0, 0.0, float(width), float(height))
    rough_shape = _validated_rough_box(rough_box, width=width, height=height)
    ink_bounds = box(
        float(ink_xs.min()),
        float(ink_ys.min()),
        float(ink_xs.max() + 1),
        float(ink_ys.max() + 1),
    )
    if not rough_shape.covers(ink_bounds):
        raise EnvelopeError("Rough box does not contain all selected ink")
    allowed = box(0.0, 0.0, float(width), float(height))
    if allowed_polygon is not None:
        requested = Polygon([(float(x), float(y)) for x, y in allowed_polygon])
        if not requested.is_valid or requested.is_empty:
            raise EnvelopeError("Allowed boundary polygon is invalid")
        allowed = allowed.intersection(requested)
        if allowed.geom_type != "Polygon":
            raise EnvelopeError("Allowed boundary must intersect the crop as one polygon")

    raw_polygon = _outside_polygon(region)
    final_polygon, applied_smoothing, applied_tolerance = _postprocess_polygon(
        raw_polygon,
        mask=mask,
        allowed=allowed,
        params=params,
    )
    canonical = canonicalize_polygon(final_polygon.exterior.coords)
    canonical_shape = Polygon(canonical)
    if not canonical_shape.is_valid or not canonical_shape.is_simple:
        raise EnvelopeError("Canonical polygon is not simple")
    if not allowed.covers(canonical_shape):
        raise EnvelopeError("Canonical polygon escapes the allowed boundary")
    if not rough_shape.covers(canonical_shape):
        raise EnvelopeError(
            "Envelope escapes the rough box; expand the rough region or reduce padding"
        )

    coverage = _ink_coverage(canonical_shape, mask)
    support_coverage = _ink_support_coverage(canonical_shape, mask)
    if coverage + 1e-12 < params.minimum_selected_coverage:
        raise EnvelopeError(
            f"Selected-ink coverage {coverage:.6f} is below required "
            f"{params.minimum_selected_coverage:.6f}"
        )
    if support_coverage + 1e-12 < params.minimum_selected_coverage:
        raise EnvelopeError(
            f"Selected-ink pixel-support coverage {support_coverage:.6f} is below "
            f"required {params.minimum_selected_coverage:.6f}"
        )

    rough_area = rough_shape.area
    area = canonical_shape.area
    fraction = area / rough_area
    if fraction > params.maximum_envelope_fraction + 1e-12:
        raise EnvelopeError(
            f"Envelope consumes {fraction:.3f} of the rough box; maximum is "
            f"{params.maximum_envelope_fraction:.3f}"
        )
    envelope_to_ink_ratio = area / selected_pixels
    if envelope_to_ink_ratio > params.maximum_envelope_to_ink_area_ratio + 1e-12:
        raise EnvelopeError(
            f"Envelope-to-ink area ratio {envelope_to_ink_ratio:.3f} exceeds "
            f"maximum {params.maximum_envelope_to_ink_area_ratio:.3f}"
        )
    excluded_pixels = int(excluded.sum())
    contamination = (
        _ink_coverage(canonical_shape, excluded) if excluded_pixels else None
    )
    support_contamination = (
        _ink_support_coverage(canonical_shape, excluded) if excluded_pixels else None
    )
    contamination_gate = (
        max(contamination, support_contamination)
        if contamination is not None and support_contamination is not None
        else None
    )
    component_contamination = _maximum_component_contamination(
        canonical_shape,
        excluded,
        minimum_pixels=params.minimum_excluded_component_pixels_for_gate,
    )
    if (
        contamination_gate is not None
        and contamination_gate > params.maximum_excluded_contamination + 1e-12
    ):
        raise EnvelopeError(
            f"Excluded-ink contamination {contamination_gate:.6f} exceeds maximum "
            f"{params.maximum_excluded_contamination:.6f} (center={contamination:.6f}, "
            f"support={support_contamination:.6f})"
        )
    if (
        component_contamination is not None
        and component_contamination
        > params.maximum_excluded_component_contamination + 1e-12
    ):
        raise EnvelopeError(
            f"Excluded component contamination {component_contamination:.6f} exceeds "
            f"maximum {params.maximum_excluded_component_contamination:.6f}"
        )

    return EnvelopeResult(
        method=method,
        polygon=tuple(canonical),
        angle_degrees=round(angle, 6),
        angle_source=angle_source,
        selected_component_count=selected_component_count,
        selected_ink_pixels=selected_pixels,
        selected_ink_covered_pixels=int(round(coverage * selected_pixels)),
        selected_ink_coverage=round(coverage, 9),
        selected_ink_support_coverage=round(support_coverage, 9),
        envelope_area_px2=round(area, 6),
        envelope_perimeter_px=round(canonical_shape.length, 6),
        polygon_vertex_count=len(canonical) - 1,
        rough_box_area_px2=round(rough_area, 6),
        ink_bbox_area_px2=round(ink_bbox_area, 6),
        ink_bbox_fill_fraction=round(selected_pixels / ink_bbox_area, 9),
        envelope_to_ink_area_ratio=round(envelope_to_ink_ratio, 9),
        envelope_to_ink_bbox_area_ratio=round(area / ink_bbox_area, 9),
        envelope_fraction_of_rough_box=round(fraction, 9),
        total_area_reduction=round(1.0 - fraction, 9),
        background_area_reduction=round(
            1.0 - (area - int(mask.sum())) / max(rough_area - int(mask.sum()), 1.0),
            9,
        ),
        excluded_ink_pixels=excluded_pixels,
        excluded_ink_inside_pixels=(
            int(round(contamination * excluded_pixels))
            if contamination is not None
            else 0
        ),
        excluded_ink_contamination=(
            round(contamination, 9) if contamination is not None else None
        ),
        excluded_ink_support_contamination=(
            round(support_contamination, 9)
            if support_contamination is not None
            else None
        ),
        excluded_component_max_contamination=(
            round(component_contamination, 9)
            if component_contamination is not None
            else None
        ),
        joined_component_count=joined_count,
        envelope_component_count=envelope_count,
        smoothing_iterations_applied=applied_smoothing,
        simplify_tolerance_applied_px=applied_tolerance,
    )


def estimate_angle(mask: np.ndarray, params: EnvelopeParams) -> tuple[float, str]:
    if params.angle_degrees is not None:
        return _normalized_angle(float(params.angle_degrees)), "supplied_angle"
    if len(params.centerline) >= 2:
        cosine = 0.0
        sine = 0.0
        total_length = 0.0
        for start, end in zip(params.centerline, params.centerline[1:]):
            dx = end[0] - start[0]
            dy = end[1] - start[1]
            length = math.hypot(dx, dy)
            if length < 1e-6:
                continue
            angle = math.atan2(dy, dx)
            cosine += length * math.cos(2.0 * angle)
            sine += length * math.sin(2.0 * angle)
            total_length += length
        if total_length < 1e-6 or math.hypot(cosine, sine) < 1e-9:
            raise EnvelopeError("Centerline must contain a directional segment")
        return _normalized_angle(0.5 * math.degrees(math.atan2(sine, cosine))), "centerline"

    ys, xs = np.nonzero(mask)
    if len(xs) < 2:
        return 0.0, "ink_geometry_fallback"
    coordinates = np.column_stack((xs.astype(float), ys.astype(float)))
    coordinates -= coordinates.mean(axis=0)
    covariance = np.cov(coordinates, rowvar=False)
    eigenvalues, eigenvectors = np.linalg.eigh(covariance)
    vector = eigenvectors[:, int(np.argmax(eigenvalues))]
    angle = math.degrees(math.atan2(float(vector[1]), float(vector[0])))
    return _normalized_angle(angle), "ink_geometry_pca"


def map_polygon_to_source(
    polygon: Iterable[Sequence[float]], *, crop_x: float, crop_y: float
) -> tuple[tuple[float, float], ...]:
    return tuple(
        (round(float(x) + crop_x, ROUND_DIGITS), round(float(y) + crop_y, ROUND_DIGITS))
        for x, y in polygon
    )


def map_polygon_from_source(
    polygon: Iterable[Sequence[float]], *, crop_x: float, crop_y: float
) -> tuple[tuple[float, float], ...]:
    return tuple(
        (round(float(x) - crop_x, ROUND_DIGITS), round(float(y) - crop_y, ROUND_DIGITS))
        for x, y in polygon
    )


def polygon_checksum(polygon: Iterable[Sequence[float]]) -> str:
    ring = json.dumps(
        [[float(x), float(y)] for x, y in polygon],
        ensure_ascii=True,
        separators=(",", ":"),
    )
    payload = (
        "word-envelope-ring-v1\n"
        "coordinates=crop-pixel-edges-xy\n"
        f"quantum={10 ** -ROUND_DIGITS}\n"
        f"{ring}\n"
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def polygon_mask(
    polygon: Iterable[Sequence[float]], *, width: int, height: int
) -> np.ndarray:
    image = Image.new("1", (width, height), 0)
    draw = ImageDraw.Draw(image)
    draw.polygon([(float(x), float(y)) for x, y in polygon], fill=1)
    return np.asarray(image, dtype=bool)


def canonicalize_polygon(
    coordinates: Iterable[Sequence[float]],
) -> tuple[tuple[float, float], ...]:
    points = [
        (round(float(point[0]), ROUND_DIGITS), round(float(point[1]), ROUND_DIGITS))
        for point in coordinates
    ]
    if len(points) > 1 and points[0] == points[-1]:
        points.pop()
    deduplicated: list[tuple[float, float]] = []
    for point in points:
        if not deduplicated or point != deduplicated[-1]:
            deduplicated.append(point)
    if len(deduplicated) < 3:
        raise EnvelopeError("Polygon has fewer than three unique vertices")
    if _signed_area(deduplicated) < 0:
        deduplicated.reverse()
    first = min(range(len(deduplicated)), key=lambda index: deduplicated[index])
    rotated = deduplicated[first:] + deduplicated[:first]
    rotated.append(rotated[0])
    return tuple(rotated)


def _morphological_region(
    mask: np.ndarray, params: EnvelopeParams, angle: float
) -> tuple[np.ndarray, int]:
    radius = max(
        max(0.5, params.along_bridge_px / 2.0),
        max(0.5, params.cross_bridge_px / 2.0),
    )
    extent = int(math.ceil(radius)) + 1
    footprint_cells = (2 * extent + 1) ** 2
    if footprint_cells > MAX_MORPHOLOGY_FOOTPRINT_CELLS:
        raise EnvelopeError(
            f"Morphology footprint would use {footprint_cells} cells; safe POC "
            f"limit is {MAX_MORPHOLOGY_FOOTPRINT_CELLS}"
        )
    structure = _oriented_ellipse(
        angle,
        along_radius=max(0.5, params.along_bridge_px / 2.0),
        cross_radius=max(0.5, params.cross_bridge_px / 2.0),
    )
    if _component_count(structure) != 1:
        raise EnvelopeError(
            "Oriented morphology footprint is disconnected; increase cross_bridge_px"
        )
    margin = max(structure.shape) + 2
    padded_pixels = (mask.shape[0] + 2 * margin) * (mask.shape[1] + 2 * margin)
    if padded_pixels > MAX_PADDED_PIXELS:
        raise EnvelopeError(
            f"Padded morphology would use {padded_pixels} pixels; safe POC limit "
            f"is {MAX_PADDED_PIXELS}"
        )
    check_rss(
        "before morphological closing",
        reserve_bytes=padded_pixels * 160,
    )
    padded = np.pad(mask, margin, mode="constant")
    joined = ndimage.binary_closing(padded, structure=structure, border_value=0)
    joined |= padded
    joined = joined[margin:-margin, margin:-margin]
    joined_count = _component_count(joined)
    if params.padding_px > 0:
        distance = ndimage.distance_transform_edt(~joined)
        region = distance <= params.padding_px + 1e-9
    else:
        region = joined.copy()
    return region, joined_count


def _soft_union_region(
    mask: np.ndarray, params: EnvelopeParams, angle: float
) -> tuple[np.ndarray, int]:
    sigma_along = max(0.55, params.along_bridge_px / 2.355)
    sigma_cross = max(0.55, params.cross_bridge_px / 2.355)
    extent = int(math.ceil(3.5 * max(sigma_along, sigma_cross)))
    kernel_edge = 2 * extent + 1
    kernel_cells = kernel_edge * kernel_edge
    if kernel_cells > MAX_SOFT_KERNEL_CELLS:
        raise EnvelopeError(
            f"Soft-union Gaussian kernel would use {kernel_cells} cells; safe POC "
            f"limit is {MAX_SOFT_KERNEL_CELLS}"
        )
    fft_pixels = (mask.shape[0] + kernel_edge - 1) * (
        mask.shape[1] + kernel_edge - 1
    )
    if fft_pixels > MAX_SOFT_FFT_PIXELS:
        raise EnvelopeError(
            f"Soft-union FFT workspace would use {fft_pixels} pixels; safe POC "
            f"limit is {MAX_SOFT_FFT_PIXELS}"
        )
    check_rss(
        "before soft-union field",
        reserve_bytes=fft_pixels * 64 + kernel_cells * 16 + mask.size * 24,
    )
    if params.padding_px > 0:
        distance = ndimage.distance_transform_edt(~mask)
        seed = distance <= params.padding_px + 1e-9
    else:
        seed = mask.copy()
    kernel = _oriented_gaussian(angle, sigma_along, sigma_cross)
    field = signal.fftconvolve(seed.astype(np.float64), kernel, mode="same")
    field = np.clip(field, 0.0, 1.0)
    field = np.maximum(field, seed.astype(np.float64))
    region = field >= params.soft_threshold
    region |= mask
    return region, _component_count(region)


def _postprocess_polygon(
    raw: Polygon,
    *,
    mask: np.ndarray,
    allowed: Polygon,
    params: EnvelopeParams,
) -> tuple[Polygon, int, float]:
    tolerances: list[float] = []
    tolerance = params.simplify_tolerance_px
    while tolerance > 0.05:
        tolerances.append(tolerance)
        tolerance /= 2.0
    tolerances.append(0.0)

    for applied_tolerance in tolerances:
        base = (
            raw.simplify(applied_tolerance, preserve_topology=True)
            if applied_tolerance > 0
            else raw
        )
        if base.geom_type != "Polygon" or base.is_empty:
            continue
        base = orient(base, sign=1.0)
        base_points = list(base.exterior.coords)[:-1]
        for iterations in range(params.smooth_iterations, -1, -1):
            points = _chaikin(base_points, iterations)
            if len(points) + 1 > params.maximum_vertices:
                continue
            candidate = Polygon(points)
            if candidate.is_empty or not candidate.is_valid or not candidate.is_simple:
                continue
            candidate = orient(candidate, sign=1.0)
            if not allowed.covers(candidate):
                continue
            if _ink_coverage(candidate, mask) + 1e-12 < params.minimum_selected_coverage:
                continue
            if (
                _ink_support_coverage(candidate, mask) + 1e-12
                < params.minimum_selected_coverage
            ):
                continue
            canonical = canonicalize_polygon(candidate.exterior.coords)
            quantized = Polygon(canonical)
            if not quantized.is_valid or not allowed.covers(quantized):
                continue
            if (
                _ink_support_coverage(quantized, mask) + 1e-12
                < params.minimum_selected_coverage
            ):
                continue
            return quantized, iterations, round(applied_tolerance, 6)
    raise EnvelopeError(
        "Simplification/smoothing could not preserve selected ink and boundary validity"
    )


def _outside_polygon(region: np.ndarray) -> Polygon:
    padded = np.pad(region.astype(np.uint8), 1, mode="constant")
    contours = measure.find_contours(padded, level=0.5, fully_connected="high")
    candidates: list[Polygon] = []
    height, width = region.shape
    for contour in contours:
        points = [
            (
                min(max(float(column) - 0.5, 0.0), float(width)),
                min(max(float(row) - 0.5, 0.0), float(height)),
            )
            for row, column in contour
        ]
        if len(points) < 4:
            continue
        polygon = Polygon(points)
        if polygon.is_valid and not polygon.is_empty and polygon.area > 0:
            candidates.append(orient(polygon, sign=1.0))
    if not candidates:
        raise EnvelopeError("No valid outside contour was found")
    candidates.sort(
        key=lambda polygon: (
            -polygon.area,
            round(polygon.bounds[0], 6),
            round(polygon.bounds[1], 6),
        )
    )
    return candidates[0]


def _oriented_ellipse(
    angle_degrees: float, along_radius: float, cross_radius: float
) -> np.ndarray:
    extent = int(math.ceil(max(along_radius, cross_radius))) + 1
    ys, xs = np.mgrid[-extent : extent + 1, -extent : extent + 1]
    radians = math.radians(angle_degrees)
    along = xs * math.cos(radians) + ys * math.sin(radians)
    cross = -xs * math.sin(radians) + ys * math.cos(radians)
    ellipse = (along / along_radius) ** 2 + (cross / cross_radius) ** 2 <= 1.0
    ellipse[extent, extent] = True
    return ellipse


def _oriented_gaussian(
    angle_degrees: float, sigma_along: float, sigma_cross: float
) -> np.ndarray:
    extent = int(math.ceil(3.5 * max(sigma_along, sigma_cross)))
    ys, xs = np.mgrid[-extent : extent + 1, -extent : extent + 1]
    radians = math.radians(angle_degrees)
    along = xs * math.cos(radians) + ys * math.sin(radians)
    cross = -xs * math.sin(radians) + ys * math.cos(radians)
    kernel = np.exp(
        -0.5 * ((along / sigma_along) ** 2 + (cross / sigma_cross) ** 2)
    )
    kernel /= kernel.sum()
    return kernel


def _chaikin(
    points: Sequence[Sequence[float]], iterations: int
) -> list[tuple[float, float]]:
    current = [(float(x), float(y)) for x, y in points]
    for _ in range(iterations):
        output: list[tuple[float, float]] = []
        for index, point in enumerate(current):
            following = current[(index + 1) % len(current)]
            output.append(
                (
                    0.75 * point[0] + 0.25 * following[0],
                    0.75 * point[1] + 0.25 * following[1],
                )
            )
            output.append(
                (
                    0.25 * point[0] + 0.75 * following[0],
                    0.25 * point[1] + 0.75 * following[1],
                )
            )
        current = output
    return current


def _ink_coverage(polygon: Polygon, mask: np.ndarray) -> float:
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return 1.0
    covered = intersects_xy(polygon, xs.astype(float) + 0.5, ys.astype(float) + 0.5)
    return float(np.count_nonzero(covered) / len(xs))


def _ink_support_coverage(polygon: Polygon, mask: np.ndarray) -> float:
    """Conservatively sample the center and four inset corners of each ink pixel."""

    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return 1.0
    epsilon = 1e-3
    offsets = (
        (0.5, 0.5),
        (epsilon, epsilon),
        (1.0 - epsilon, epsilon),
        (1.0 - epsilon, 1.0 - epsilon),
        (epsilon, 1.0 - epsilon),
    )
    covered_count = 0
    for offset_x, offset_y in offsets:
        covered = intersects_xy(
            polygon,
            xs.astype(float) + offset_x,
            ys.astype(float) + offset_y,
        )
        covered_count += int(np.count_nonzero(covered))
    return float(covered_count / (len(xs) * len(offsets)))


def _component_count(mask: np.ndarray) -> int:
    _, count = ndimage.label(mask, structure=np.ones((3, 3), dtype=np.uint8))
    return int(count)


def _maximum_component_contamination(
    polygon: Polygon, excluded: np.ndarray, *, minimum_pixels: int
) -> float | None:
    labels, count = ndimage.label(
        excluded, structure=np.ones((3, 3), dtype=np.uint8)
    )
    if count > MAX_EXCLUDED_COMPONENTS_FOR_GATE:
        raise EnvelopeError(
            f"Excluded mask has {count} components; contamination-gate limit is "
            f"{MAX_EXCLUDED_COMPONENTS_FOR_GATE}"
        )
    values: list[float] = []
    for component_id, component_slice in enumerate(
        ndimage.find_objects(labels), start=1
    ):
        if component_slice is None:
            continue
        local_y, local_x = np.nonzero(
            labels[component_slice] == component_id
        )
        if len(local_x) < minimum_pixels:
            continue
        ys = local_y.astype(float) + float(component_slice[0].start)
        xs = local_x.astype(float) + float(component_slice[1].start)
        center = intersects_xy(polygon, xs + 0.5, ys + 0.5)
        center_fraction = float(np.count_nonzero(center) / len(xs))
        support_count = 0
        for offset_x, offset_y in (
            (0.5, 0.5),
            (1e-3, 1e-3),
            (1.0 - 1e-3, 1e-3),
            (1.0 - 1e-3, 1.0 - 1e-3),
            (1e-3, 1.0 - 1e-3),
        ):
            support_count += int(
                np.count_nonzero(intersects_xy(polygon, xs + offset_x, ys + offset_y))
            )
        support_fraction = float(support_count / (len(xs) * 5))
        values.append(max(center_fraction, support_fraction))
    return max(values) if values else None


def _validated_mask(
    value: np.ndarray | None,
    *,
    name: str,
    shape: tuple[int, int] | None = None,
) -> np.ndarray:
    if value is None:
        raise EnvelopeError(f"{name.title()} is required")
    array = np.asarray(value)
    if array.ndim != 2:
        raise EnvelopeError(f"{name.title()} must be a 2D array")
    if shape is not None and array.shape != shape:
        raise EnvelopeError(
            f"{name.title()} shape {array.shape} does not match expected {shape}"
        )
    if array.size > MAX_MASK_PIXELS:
        raise EnvelopeError(
            f"{name.title()} has {array.size} pixels; limit is {MAX_MASK_PIXELS}"
        )
    mask = array.astype(bool)
    if name == "cleaned mask" and not mask.any():
        raise EnvelopeError("Cleaned mask is empty")
    return mask


def _validate_params(params: EnvelopeParams, *, width: int, height: int) -> None:
    numeric_nonnegative = {
        "along_bridge_px": params.along_bridge_px,
        "cross_bridge_px": params.cross_bridge_px,
        "padding_px": params.padding_px,
        "simplify_tolerance_px": params.simplify_tolerance_px,
    }
    for name, value in numeric_nonnegative.items():
        numeric = _finite_parameter(name, value)
        if numeric < 0:
            raise EnvelopeError(f"{name} must be finite and non-negative")
    if params.angle_degrees is not None:
        _finite_parameter("angle_degrees", params.angle_degrees)
    soft_threshold = _finite_parameter("soft_threshold", params.soft_threshold)
    if not 0 < soft_threshold < 1:
        raise EnvelopeError("soft_threshold must be between 0 and 1")
    minimum_coverage = _finite_parameter(
        "minimum_selected_coverage", params.minimum_selected_coverage
    )
    if not 0 < minimum_coverage <= 1:
        raise EnvelopeError("minimum_selected_coverage must be in (0, 1]")
    minimum_selected_pixels = _integer_parameter(
        "minimum_selected_ink_pixels", params.minimum_selected_ink_pixels
    )
    if minimum_selected_pixels < 1:
        raise EnvelopeError("minimum_selected_ink_pixels must be positive")
    maximum_fraction = _finite_parameter(
        "maximum_envelope_fraction", params.maximum_envelope_fraction
    )
    if not 0 < maximum_fraction <= 1:
        raise EnvelopeError("maximum_envelope_fraction must be in (0, 1]")
    maximum_area_ratio = _finite_parameter(
        "maximum_envelope_to_ink_area_ratio",
        params.maximum_envelope_to_ink_area_ratio,
    )
    if maximum_area_ratio <= 1:
        raise EnvelopeError("maximum_envelope_to_ink_area_ratio must exceed 1")
    maximum_contamination = _finite_parameter(
        "maximum_excluded_contamination", params.maximum_excluded_contamination
    )
    if not 0 <= maximum_contamination <= 1:
        raise EnvelopeError("maximum_excluded_contamination must be in [0, 1]")
    maximum_component_contamination = _finite_parameter(
        "maximum_excluded_component_contamination",
        params.maximum_excluded_component_contamination,
    )
    if not 0 <= maximum_component_contamination <= 1:
        raise EnvelopeError(
            "maximum_excluded_component_contamination must be in [0, 1]"
        )
    minimum_component_pixels = _integer_parameter(
        "minimum_excluded_component_pixels_for_gate",
        params.minimum_excluded_component_pixels_for_gate,
    )
    if minimum_component_pixels < 1:
        raise EnvelopeError(
            "minimum_excluded_component_pixels_for_gate must be positive"
        )
    smooth_iterations = _integer_parameter(
        "smooth_iterations", params.smooth_iterations
    )
    if smooth_iterations < 0 or smooth_iterations > 5:
        raise EnvelopeError("smooth_iterations must be between 0 and 5")
    maximum_vertices = _integer_parameter("maximum_vertices", params.maximum_vertices)
    if maximum_vertices < 8 or maximum_vertices > 8192:
        raise EnvelopeError("maximum_vertices must be between 8 and 8192")
    if not isinstance(params.allow_border_touching_ink, bool):
        raise EnvelopeError("allow_border_touching_ink must be boolean")
    try:
        centerline = list(params.centerline)
    except TypeError as error:
        raise EnvelopeError("centerline must contain [x, y] points") from error
    for point in centerline:
        if not isinstance(point, Sequence) or len(point) != 2:
            raise EnvelopeError("centerline must contain [x, y] points")
        _finite_parameter("centerline x", point[0])
        _finite_parameter("centerline y", point[1])
    shorter = min(width, height)
    if params.padding_px > shorter / 3:
        raise EnvelopeError("padding_px is excessively broad for this crop")
    if params.along_bridge_px > max(width, height) * 0.8:
        raise EnvelopeError("along_bridge_px is excessively broad for this crop")
    if params.cross_bridge_px > shorter * 0.8:
        raise EnvelopeError("cross_bridge_px is excessively broad for this crop")


def _finite_parameter(name: str, value: Any) -> float:
    if isinstance(value, (bool, np.bool_)) or not isinstance(
        value, (int, float, np.integer, np.floating)
    ):
        raise EnvelopeError(f"{name} must be a finite number")
    numeric = float(value)
    if not math.isfinite(numeric):
        raise EnvelopeError(f"{name} must be a finite number")
    return numeric


def _integer_parameter(name: str, value: Any) -> int:
    if isinstance(value, (bool, np.bool_)) or not isinstance(value, (int, np.integer)):
        raise EnvelopeError(f"{name} must be an integer")
    return int(value)


def _validated_rough_box(
    value: Sequence[float], *, width: int, height: int
) -> Polygon:
    if len(value) != 4:
        raise EnvelopeError("Rough box must be [x, y, width, height]")
    x, y, box_width, box_height = (float(item) for item in value)
    if box_width <= 0 or box_height <= 0:
        raise EnvelopeError("Rough box dimensions must be positive")
    result = box(x, y, x + box_width, y + box_height)
    if not box(0.0, 0.0, float(width), float(height)).covers(result):
        raise EnvelopeError("Rough box falls outside the crop")
    return result


def _normalized_angle(value: float) -> float:
    angle = ((value + 90.0) % 180.0) - 90.0
    if abs(angle + 90.0) < 1e-9:
        return 90.0
    return round(angle, 9)


def _signed_area(points: Sequence[Sequence[float]]) -> float:
    return 0.5 * sum(
        points[index][0] * points[(index + 1) % len(points)][1]
        - points[(index + 1) % len(points)][0] * points[index][1]
        for index in range(len(points))
    )
