from __future__ import annotations

import io
import json
import math

from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path
from typing import Any, Mapping, Sequence

from PIL import Image, ImageFilter

from .preparation import (
    RASTER_FINGERPRINT_ALGORITHM,
    preprocessing_metadata,
    rgb8_raster_sha256,
)
from .util import canonical_json_bytes, sha256_bytes


MASK_SCHEMA_VERSION = 1
MASK_COORDINATE_SPACE = "prepared-pixels-top-left"
MASK_RASTERIZATION_ALGORITHM = (
    "integer-pixel-contour-even-odd-boundary-inclusive-v1"
)
MASK_PADDING_ALGORITHM = "chebyshev-grid-morphology-black-exterior-v1"
MASK_COMPOSITE_ALGORITHM = "outside-mask-white-identity-v1"
MASK_POLARITY = "255-include-0-exclude"
MASK_RASTER_FINGERPRINT_ALGORITHM = "sha256-l8-v1"

# These caps are deliberately above the accepted benchmark cohort
# (12,000,000 pixels and 844 page-boundary vertices) while preventing an
# accidental config value from turning polygon validation or morphology into
# an unbounded allocation.
MAX_IMAGE_DIMENSION = 20_000
MAX_IMAGE_PIXELS = 50_000_000
MAX_BOUNDARY_VERTICES = 4_096
MAX_ABS_PADDING_PIXELS = 64
MAX_MORPHOLOGY_PIXELS = 55_000_000

Point = tuple[int, int]
BoundaryPoint = Sequence[int] | Mapping[str, int]
ClosedPolygon = tuple[Point, ...]


@dataclass(frozen=True)
class VerifiedPageBoundary:
    """
    Immutable page-boundary evidence produced by the source-run verifier.

    The caller must obtain these values from the benchmark's authoritative
    source binding (`load_source_context` plus its verified page inputs), not
    directly from untrusted request data. `from_normalized_layout` still
    validates the normalized layout's exact page identity, artifact hash,
    coordinate space, and availability before accepting it.
    """

    page_key: str
    run_id: str
    engine_id: str
    manifest_sha256: str
    normalized_artifact_sha256: str
    normalized_artifact_reference: str
    source_sha256: str
    prepared_encoded_sha256: str
    prepared_raster_sha256: str
    width: int
    height: int
    closed_polygon: ClosedPolygon

    @classmethod
    def from_normalized_layout(
        cls,
        normalized_layout_bytes: bytes,
        *,
        expected_page_key: str,
        expected_run_id: str,
        expected_engine_id: str,
        expected_manifest_sha256: str,
        expected_normalized_artifact_sha256: str,
        normalized_artifact_reference: str,
        verified_prepared_raster_sha256: str,
    ) -> VerifiedPageBoundary:
        """
        Parses exact bytes already verified against an immutable source run.

        `expected_manifest_sha256` and the prepared raster fingerprint must
        come from the existing source-run verification path. This method
        verifies the normalized artifact bytes and cross-checks every identity
        field that the normalized layout itself carries.
        """

        for field, value in (
            ("expected_manifest_sha256", expected_manifest_sha256),
            (
                "expected_normalized_artifact_sha256",
                expected_normalized_artifact_sha256,
            ),
            (
                "verified_prepared_raster_sha256",
                verified_prepared_raster_sha256,
            ),
        ):
            _require_sha256(value, field)
        if not isinstance(normalized_layout_bytes, bytes):
            raise ValueError("normalized_layout_bytes must be bytes")
        actual_normalized_sha256 = sha256_bytes(normalized_layout_bytes)
        if actual_normalized_sha256 != expected_normalized_artifact_sha256:
            raise ValueError(
                "normalized page-boundary artifact checksum does not match "
                "its verified source binding"
            )
        if (
            not isinstance(normalized_artifact_reference, str)
            or not normalized_artifact_reference
        ):
            raise ValueError(
                "normalized_artifact_reference must be a non-empty string"
            )

        try:
            layout = json.loads(normalized_layout_bytes)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError(
                f"normalized page-boundary artifact is invalid JSON: {exc}"
            ) from exc
        if not isinstance(layout, dict):
            raise ValueError("normalized page-boundary artifact must be an object")
        if layout.get("schemaVersion") != 1:
            raise ValueError("normalized page-boundary schemaVersion must be 1")
        for field, expected in (
            ("pageKey", expected_page_key),
            ("runId", expected_run_id),
            ("engineId", expected_engine_id),
        ):
            if layout.get(field) != expected:
                raise ValueError(
                    f"normalized page-boundary {field} does not match "
                    "its verified source binding"
                )
        if not expected_engine_id.startswith("eynollah"):
            raise ValueError(
                "page-boundary source engine must be an Eynollah profile"
            )

        image = layout.get("image")
        if not isinstance(image, dict):
            raise ValueError("normalized page-boundary image metadata is missing")
        if image.get("coordinateSpace") != MASK_COORDINATE_SPACE:
            raise ValueError(
                "normalized page boundary is not in prepared pixel coordinates"
            )
        width = image.get("width")
        height = image.get("height")
        _validate_image_size(width, height)
        source_sha256 = image.get("sourceSha256")
        prepared_encoded_sha256 = image.get("preparedSha256")
        _require_sha256(source_sha256, "image.sourceSha256")
        _require_sha256(prepared_encoded_sha256, "image.preparedSha256")

        warnings = layout.get("warnings")
        if not isinstance(warnings, list):
            raise ValueError("normalized page-boundary warnings must be a list")
        if any(
            isinstance(warning, dict)
            and warning.get("code") == "PAGE_BOUNDARY_UNAVAILABLE"
            for warning in warnings
        ):
            raise ValueError(
                "Eynollah page boundary is unavailable; a full-frame fallback "
                "cannot be used as predicted page evidence"
            )

        closed_polygon = _validate_page_boundary(
            layout.get("pageBoundary"),
            width=width,
            height=height,
        )
        return cls(
            page_key=expected_page_key,
            run_id=expected_run_id,
            engine_id=expected_engine_id,
            manifest_sha256=expected_manifest_sha256,
            normalized_artifact_sha256=actual_normalized_sha256,
            normalized_artifact_reference=normalized_artifact_reference,
            source_sha256=source_sha256,
            prepared_encoded_sha256=prepared_encoded_sha256,
            prepared_raster_sha256=verified_prepared_raster_sha256,
            width=width,
            height=height,
            closed_polygon=closed_polygon,
        )


@dataclass(frozen=True)
class MaskedKrakenInput:
    """Immutable bytes for one source-bound page-mask stage."""

    include_mask_png: bytes
    engine_input_png: bytes
    provenance_json: bytes


def build_masked_kraken_input(
    prepared_png_path: Path,
    boundary: VerifiedPageBoundary,
    *,
    page_key: str,
    padding_pixels: int = 0,
) -> MaskedKrakenInput:
    """
    White-fills pixels outside a verified Eynollah page boundary.

    The prepared raster remains the coordinate authority. The output has the
    same RGB dimensions and uses an identity transform, so Kraken geometry
    stays directly projectable onto `prepared.png`.
    """

    if not isinstance(boundary, VerifiedPageBoundary):
        raise ValueError(
            "boundary must be verified source-bound page-boundary evidence"
        )
    if page_key != boundary.page_key:
        raise ValueError(
            "target page key does not match the verified page boundary"
        )
    padding = _validate_padding(padding_pixels)
    if not isinstance(prepared_png_path, Path):
        raise ValueError("prepared_png_path must be a pathlib.Path")

    try:
        prepared_bytes = prepared_png_path.read_bytes()
        with Image.open(io.BytesIO(prepared_bytes)) as decoded:
            decoded.load()
            if decoded.mode != "RGB":
                raise ValueError("prepared input must decode as RGB")
            if decoded.size != (boundary.width, boundary.height):
                raise ValueError(
                    "prepared input dimensions do not match the verified "
                    "page boundary"
                )
            prepared = Image.frombytes("RGB", decoded.size, decoded.tobytes())
    except (OSError, ValueError) as exc:
        raise ValueError(f"could not load canonical prepared PNG: {exc}") from exc

    prepared_raster_sha256 = rgb8_raster_sha256(
        prepared.width,
        prepared.height,
        prepared.tobytes(),
    )
    if prepared_raster_sha256 != boundary.prepared_raster_sha256:
        raise ValueError(
            "prepared decoded raster does not match the verified "
            "page-boundary source"
        )

    include_mask = _rasterize_validated_polygon(
        boundary.closed_polygon,
        width=boundary.width,
        height=boundary.height,
    )
    include_mask = _apply_padding(include_mask, padding)
    white = Image.new("RGB", prepared.size, (255, 255, 255))
    engine_input = Image.composite(prepared, white, include_mask)

    include_mask_png = _encode_png(include_mask)
    engine_input_png = _encode_png(engine_input)
    mask_pixels = include_mask.tobytes()
    included_pixels = mask_pixels.count(255)
    preprocessing = preprocessing_metadata()
    source_boundary_payload = {
        "coordinateSpace": MASK_COORDINATE_SPACE,
        "image": {"width": boundary.width, "height": boundary.height},
        "closedPolygon": [
            {"x": point[0], "y": point[1]}
            for point in boundary.closed_polygon
        ],
    }
    provenance = {
        "schemaVersion": MASK_SCHEMA_VERSION,
        "stage": "source-bound-page-mask-to-kraken-input",
        "pageKey": page_key,
        "algorithms": {
            "rasterization": MASK_RASTERIZATION_ALGORITHM,
            "padding": MASK_PADDING_ALGORITHM,
            "composite": MASK_COMPOSITE_ALGORITHM,
        },
        "coordinateTransform": {
            "name": "identity",
            "coordinateSpace": MASK_COORDINATE_SPACE,
            "width": boundary.width,
            "height": boundary.height,
        },
        "sourceBoundary": {
            "runId": boundary.run_id,
            "engineId": boundary.engine_id,
            "manifestSha256": boundary.manifest_sha256,
            "normalizedArtifact": boundary.normalized_artifact_reference,
            "normalizedArtifactSha256": (
                boundary.normalized_artifact_sha256
            ),
            "sourceSha256": boundary.source_sha256,
            "preparedEncodedSha256": boundary.prepared_encoded_sha256,
            "preparedRasterFingerprint": {
                "algorithm": RASTER_FINGERPRINT_ALGORITHM,
                "sha256": boundary.prepared_raster_sha256,
            },
            "boundary": source_boundary_payload,
            "boundarySha256": sha256_bytes(
                canonical_json_bytes(source_boundary_payload)
            ),
        },
        "targetPrepared": {
            "artifact": prepared_png_path.name,
            "encodedSha256": sha256_bytes(prepared_bytes),
            "rasterFingerprint": {
                "algorithm": RASTER_FINGERPRINT_ALGORITHM,
                "sha256": prepared_raster_sha256,
            },
        },
        "includeMask": {
            "polarity": MASK_POLARITY,
            "includeValue": 255,
            "excludeValue": 0,
            "paddingPixels": padding,
            "includedPixelCount": included_pixels,
            "excludedPixelCount": (
                boundary.width * boundary.height - included_pixels
            ),
            "artifact": _artifact_metadata(
                include_mask,
                include_mask_png,
            ),
        },
        "engineInput": {
            "outsideFill": [255, 255, 255],
            "artifact": _artifact_metadata(
                engine_input,
                engine_input_png,
            ),
        },
        "encoderProfile": {
            "profileId": preprocessing["profileId"],
            "profileSha256": preprocessing["profileSha256"],
            "library": preprocessing["library"],
            "libraryVersion": preprocessing["libraryVersion"],
            "format": preprocessing["format"],
            "encoder": preprocessing["encoder"],
        },
    }
    return MaskedKrakenInput(
        include_mask_png=include_mask_png,
        engine_input_png=engine_input_png,
        provenance_json=canonical_json_bytes(provenance),
    )


def _validate_page_boundary(
    value: Any,
    *,
    width: int,
    height: int,
) -> ClosedPolygon:
    if isinstance(value, (str, bytes)) or not isinstance(value, Sequence):
        raise ValueError("page boundary must be a sequence of {x, y} points")
    if len(value) > MAX_BOUNDARY_VERTICES + 1:
        raise ValueError(
            f"page boundary exceeds {MAX_BOUNDARY_VERTICES} vertices"
        )

    points: list[Point] = []
    for index, raw_point in enumerate(value):
        if not isinstance(raw_point, Mapping) or set(raw_point) != {"x", "y"}:
            raise ValueError(
                f"page boundary point {index} must contain exactly x and y"
            )
        x = raw_point["x"]
        y = raw_point["y"]
        if (
            isinstance(x, bool)
            or isinstance(y, bool)
            or not isinstance(x, int)
            or not isinstance(y, int)
        ):
            raise ValueError(
                f"page boundary point {index} must use integer coordinates"
            )
        if x < 0 or x >= width or y < 0 or y >= height:
            raise ValueError(
                f"page boundary point {index} is outside "
                f"the {width}x{height} pixel coordinate space"
            )
        points.append((x, y))

    if len(points) > 1 and points[-1] == points[0]:
        points.pop()
    if len(points) < 3:
        raise ValueError(
            "page boundary must contain at least three distinct vertices"
        )
    if len(points) > MAX_BOUNDARY_VERTICES:
        raise ValueError(
            f"page boundary exceeds {MAX_BOUNDARY_VERTICES} vertices"
        )
    if len(set(points)) != len(points):
        raise ValueError("page boundary contains a repeated vertex")

    twice_signed_area = sum(
        first[0] * second[1] - second[0] * first[1]
        for first, second in zip(points, points[1:] + points[:1])
    )
    if twice_signed_area == 0:
        raise ValueError("page boundary has zero area")

    _validate_simple_polygon(points)
    return tuple([*points, points[0]])


def _rasterize_validated_polygon(
    closed_polygon: ClosedPolygon,
    *,
    width: int,
    height: int,
) -> Image.Image:
    """
    Rasterizes normalized Eynollah integer pixel-contour coordinates.

    Pixel `(x, y)` is included when that integer sample is inside the simple
    polygon under the even-odd rule or lies exactly on its boundary. This
    deliberately differs from an edge-space `(x + .5, y + .5)` convention:
    the repository's `(0,0)..(w-1,h-1)` frame includes every image pixel.
    """

    vertices = closed_polygon[:-1]
    pixels = bytearray(width * height)
    for y in range(height):
        intersections: list[Fraction] = []
        for first, second in zip(vertices, (*vertices[1:], vertices[0])):
            x1, y1 = first
            x2, y2 = second
            if y1 == y2:
                continue
            if min(y1, y2) <= y < max(y1, y2):
                intersections.append(
                    Fraction(x1)
                    + Fraction((y - y1) * (x2 - x1), y2 - y1)
                )
        intersections.sort()
        if len(intersections) % 2:
            raise ValueError(
                "page boundary produced an invalid odd scanline intersection"
            )
        row_offset = y * width
        for left, right in zip(
            intersections[0::2], intersections[1::2]
        ):
            first_x = max(0, _ceil_fraction(left))
            last_x = min(width - 1, _floor_fraction(right))
            if first_x <= last_x:
                pixels[
                    row_offset + first_x : row_offset + last_x + 1
                ] = b"\xff" * (last_x - first_x + 1)

    # The half-open scanline rule intentionally skips maxima and horizontal
    # edges. Add every exact integer lattice point on each contour edge so
    # boundary pixels remain included without relying on renderer heuristics.
    for first, second in zip(vertices, (*vertices[1:], vertices[0])):
        delta_x = second[0] - first[0]
        delta_y = second[1] - first[1]
        steps = math.gcd(abs(delta_x), abs(delta_y))
        step_x = delta_x // steps
        step_y = delta_y // steps
        for step in range(steps + 1):
            x = first[0] + step * step_x
            y = first[1] + step * step_y
            pixels[y * width + x] = 255

    return Image.frombytes("L", (width, height), bytes(pixels))


def _apply_padding(mask: Image.Image, padding: int) -> Image.Image:
    if padding == 0:
        return mask
    radius = abs(padding)
    padded_width = mask.width + 2 * radius
    padded_height = mask.height + 2 * radius
    if padded_width * padded_height > MAX_MORPHOLOGY_PIXELS:
        raise ValueError(
            "padding would exceed the page-mask morphology pixel limit"
        )
    extended = Image.new("L", (padded_width, padded_height), 0)
    extended.paste(mask, (radius, radius))
    filter_size = 2 * radius + 1
    operation = (
        ImageFilter.MaxFilter(filter_size)
        if padding > 0
        else ImageFilter.MinFilter(filter_size)
    )
    filtered = extended.filter(operation)
    return filtered.crop(
        (
            radius,
            radius,
            radius + mask.width,
            radius + mask.height,
        )
    )


def _artifact_metadata(
    image: Image.Image,
    encoded_png: bytes,
) -> dict[str, Any]:
    if image.mode == "RGB":
        raster_algorithm = RASTER_FINGERPRINT_ALGORITHM
        raster_sha256 = rgb8_raster_sha256(
            image.width,
            image.height,
            image.tobytes(),
        )
    elif image.mode == "L":
        raster_algorithm = MASK_RASTER_FINGERPRINT_ALGORITHM
        raster_sha256 = sha256_bytes(
            f"l8:{image.width}x{image.height}\n".encode("ascii")
            + image.tobytes()
        )
    else:
        raise ValueError(f"unsupported page-mask artifact mode: {image.mode}")
    return {
        "format": "PNG",
        "mode": image.mode,
        "width": image.width,
        "height": image.height,
        "sha256": sha256_bytes(encoded_png),
        "sizeBytes": len(encoded_png),
        "rasterFingerprint": {
            "algorithm": raster_algorithm,
            "sha256": raster_sha256,
        },
    }


def _encode_png(image: Image.Image) -> bytes:
    if image.mode not in {"L", "RGB"}:
        raise ValueError("page-mask PNG must be L or RGB")
    stripped = Image.frombytes(image.mode, image.size, image.tobytes())
    buffer = io.BytesIO()
    stripped.save(
        buffer,
        format="PNG",
        compress_level=9,
        optimize=False,
        interlace=False,
    )
    return buffer.getvalue()


def _validate_image_size(width: Any, height: Any) -> None:
    if (
        isinstance(width, bool)
        or isinstance(height, bool)
        or not isinstance(width, int)
        or not isinstance(height, int)
        or width <= 0
        or height <= 0
        or width > MAX_IMAGE_DIMENSION
        or height > MAX_IMAGE_DIMENSION
        or width * height > MAX_IMAGE_PIXELS
    ):
        raise ValueError(
            "page-boundary dimensions exceed the supported benchmark limits"
        )


def _validate_padding(value: int) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or abs(value) > MAX_ABS_PADDING_PIXELS
    ):
        raise ValueError(
            "padding_pixels must be an integer between "
            f"-{MAX_ABS_PADDING_PIXELS} and {MAX_ABS_PADDING_PIXELS}"
        )
    return value


def _require_sha256(value: Any, field: str) -> str:
    if (
        not isinstance(value, str)
        or len(value) != 64
        or any(character not in "0123456789abcdef" for character in value)
    ):
        raise ValueError(f"{field} must be a lowercase SHA-256 digest")
    return value


def _ceil_fraction(value: Fraction) -> int:
    return -(-value.numerator // value.denominator)


def _floor_fraction(value: Fraction) -> int:
    return value.numerator // value.denominator


def _validate_simple_polygon(points: Sequence[Point]) -> None:
    edge_count = len(points)
    edges = [
        (points[index], points[(index + 1) % edge_count])
        for index in range(edge_count)
    ]
    for left_index, left in enumerate(edges):
        for right_index in range(left_index + 1, edge_count):
            if (
                right_index == (left_index + 1) % edge_count
                or left_index == (right_index + 1) % edge_count
            ):
                continue
            if _segments_intersect(*left, *edges[right_index]):
                raise ValueError("page boundary is self-intersecting")


def _segments_intersect(
    first_start: Point,
    first_end: Point,
    second_start: Point,
    second_end: Point,
) -> bool:
    orientation_1 = _orientation(first_start, first_end, second_start)
    orientation_2 = _orientation(first_start, first_end, second_end)
    orientation_3 = _orientation(second_start, second_end, first_start)
    orientation_4 = _orientation(second_start, second_end, first_end)

    if (
        orientation_1 == 0
        and _point_on_segment(second_start, first_start, first_end)
    ):
        return True
    if (
        orientation_2 == 0
        and _point_on_segment(second_end, first_start, first_end)
    ):
        return True
    if (
        orientation_3 == 0
        and _point_on_segment(first_start, second_start, second_end)
    ):
        return True
    if (
        orientation_4 == 0
        and _point_on_segment(first_end, second_start, second_end)
    ):
        return True
    return (
        (orientation_1 > 0) != (orientation_2 > 0)
        and (orientation_3 > 0) != (orientation_4 > 0)
    )


def _orientation(first: Point, second: Point, third: Point) -> int:
    return (
        (second[0] - first[0]) * (third[1] - first[1])
        - (second[1] - first[1]) * (third[0] - first[0])
    )


def _point_on_segment(point: Point, start: Point, end: Point) -> bool:
    return (
        min(start[0], end[0]) <= point[0] <= max(start[0], end[0])
        and min(start[1], end[1]) <= point[1] <= max(start[1], end[1])
    )
