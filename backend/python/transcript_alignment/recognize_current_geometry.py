#!/usr/bin/env python3
"""Recognize exact, current page geometry with revision-bound output.

This worker deliberately does not read or write the application database. A
TypeScript caller must export a strict batch manifest from a current database
snapshot, invoke this process, and separately validate/import the resulting
``page-line-recognition`` artifacts.

The contract is intentionally conservative:

* encoded source bytes and decoded raster pixels are checksum-bound;
* every current segment has a stable ID and an exact geometry checksum;
* baseline geometry is passed to Kraken directly;
* bbox geometry is converted only through the named Kraken 7 adapter
  ``bbox-to-baseline-v1``;
* legacy stored baselines without a boundary use the exact stored bbox only
  through ``legacy-baseline-bbox-boundary-v1``;
* text direction is explicit for every segment, including vertical text;
* a model is loaded once and reused for every page in the batch;
* output coverage must exactly equal input segment coverage.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import time
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from importlib.metadata import version
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping, Sequence
from uuid import UUID, uuid4

from PIL import Image
from kraken.configs import RecognitionInferenceConfig
from kraken.containers import BBoxLine, BaselineLine, Segmentation
from kraken.tasks import RecognitionTaskModel


SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
RUN_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
SEGMENT_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
TEXT_DIRECTIONS = {
    "horizontal-lr",
    "horizontal-rl",
    "vertical-lr",
    "vertical-rl",
}
JAVASCRIPT_SAFE_INTEGER = 9_007_199_254_740_991
EXPECTED_INFERENCE = {
    "accelerator": "cpu",
    "precision": "32-true",
    "batchSize": 1,
    "numLineWorkers": 0,
    "numThreads": 1,
    "padding": 16,
    "segmentationType": "baselines",
}


class ManifestValidationError(ValueError):
    """Raised when a batch does not prove exact source/geometry identity."""


@dataclass(frozen=True)
class ValidatedSegment:
    raw: dict[str, Any]
    segment_id: str
    geometry_type: str | None
    text_direction: str
    geometry_checksum_sha256: str
    recognition_adapter: str


@dataclass(frozen=True)
class ValidatedPage:
    raw: dict[str, Any]
    page_id: str
    page_key: str | None
    source_path: Path
    raster_path: Path
    segments: tuple[ValidatedSegment, ...]


@dataclass(frozen=True)
class ValidatedBatch:
    raw: dict[str, Any]
    manifest_path: Path
    manifest_checksum_sha256: str
    run_id: str
    profile: dict[str, Any]
    inference: dict[str, Any]
    model_path: Path
    pages: tuple[ValidatedPage, ...]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def rgb8_raster_sha256(image: Image.Image) -> str:
    """Hash decoded pixels using the application's RGB8 raster contract."""
    rgb = image if image.mode == "RGB" else image.convert("RGB")
    framing = f"rgb8:{rgb.width}x{rgb.height}\n".encode("ascii")
    return hashlib.sha256(framing + rgb.tobytes()).hexdigest()


def _ecmascript_number(value: int | float) -> str:
    """Serialize a finite number like JSON.stringify for checksum parity."""
    if isinstance(value, bool):
        raise TypeError("Booleans are not canonical JSON numbers")
    if isinstance(value, int):
        return str(value)
    if not math.isfinite(value):
        raise TypeError("Non-finite numbers are not canonical JSON values")
    if value == 0:
        return "0"

    absolute = abs(value)
    shortest = repr(value).lower()
    if 1e-6 <= absolute < 1e21:
        fixed = format(Decimal(shortest), "f")
        if "." in fixed:
            fixed = fixed.rstrip("0").rstrip(".")
        return fixed

    if "e" not in shortest:
        shortest = format(value, ".17e")
    coefficient, exponent = shortest.split("e", 1)
    if "." in coefficient:
        coefficient = coefficient.rstrip("0").rstrip(".")
    exponent_value = int(exponent)
    exponent_text = (
        f"+{exponent_value}" if exponent_value >= 0 else str(exponent_value)
    )
    return f"{coefficient}e{exponent_text}"


def _utf16_sort_key(value: str) -> bytes:
    return value.encode("utf-16-be", errors="surrogatepass")


def canonical_json(value: Any) -> str:
    """Mirror backend/src/services/page-layout-checksum.ts."""
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, (int, float)):
        return _ecmascript_number(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, list):
        return "[" + ",".join(canonical_json(item) for item in value) + "]"
    if isinstance(value, tuple):
        return "[" + ",".join(canonical_json(item) for item in value) + "]"
    if isinstance(value, dict):
        if not all(isinstance(key, str) for key in value):
            raise TypeError("Canonical JSON object keys must be strings")
        pairs = []
        for key in sorted(value, key=_utf16_sort_key):
            pairs.append(
                f"{json.dumps(key, ensure_ascii=False)}:"
                f"{canonical_json(value[key])}",
            )
        return "{" + ",".join(pairs) + "}"
    raise TypeError(f"Unsupported canonical JSON value: {type(value).__name__}")


def canonical_json_checksum(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def segment_geometry_checksum(segment: Mapping[str, Any]) -> str:
    """Compute the exact TypeScript segmentRecognitionGeometryChecksum."""
    value: dict[str, Any] = {"id": segment["id"]}
    for key in ("geometryType", "baseline", "bbox", "boundary"):
        if key in segment:
            value[key] = segment[key]
    value["textDirection"] = segment["textDirection"]
    return canonical_json_checksum(value)


def _reject_duplicate_json_keys(
    pairs: list[tuple[str, Any]],
) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ManifestValidationError(f"Duplicate JSON object key: {key}")
        result[key] = value
    return result


def _object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ManifestValidationError(f"{label} must be an object")
    return value


def _array(value: Any, label: str) -> list[Any]:
    if not isinstance(value, list):
        raise ManifestValidationError(f"{label} must be an array")
    return value


def _strict_keys(
    value: Mapping[str, Any],
    *,
    label: str,
    required: set[str],
    optional: set[str] | None = None,
) -> None:
    optional = optional or set()
    actual = set(value)
    missing = required - actual
    unexpected = actual - required - optional
    if missing:
        raise ManifestValidationError(
            f"{label} is missing required keys: {sorted(missing)}",
        )
    if unexpected:
        raise ManifestValidationError(
            f"{label} has unexpected keys: {sorted(unexpected)}",
        )


def _string(value: Any, label: str, *, maximum: int = 4096) -> str:
    if not isinstance(value, str) or not value or len(value) > maximum:
        raise ManifestValidationError(
            f"{label} must be a nonempty string of at most {maximum} characters",
        )
    return value


def _sha256(value: Any, label: str) -> str:
    if not isinstance(value, str) or not SHA256_PATTERN.fullmatch(value):
        raise ManifestValidationError(
            f"{label} must be a lowercase SHA-256 digest",
        )
    return value


def _nonnegative_int(value: Any, label: str) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or value < 0
        or value > JAVASCRIPT_SAFE_INTEGER
    ):
        raise ManifestValidationError(
            f"{label} must be a nonnegative JavaScript-safe integer",
        )
    return value


def _positive_int(value: Any, label: str) -> int:
    result = _nonnegative_int(value, label)
    if result == 0:
        raise ManifestValidationError(f"{label} must be positive")
    return result


def _coordinate(
    value: Any,
    label: str,
    *,
    maximum: int,
) -> int | float:
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or value < 0
        or value > maximum
    ):
        raise ManifestValidationError(
            f"{label} must be a finite coordinate between 0 and {maximum}",
        )
    return value


def _validate_bbox(
    value: Any,
    label: str,
    *,
    width: int,
    height: int,
) -> list[int | float]:
    bbox = _array(value, label)
    if len(bbox) != 4:
        raise ManifestValidationError(f"{label} must contain four coordinates")
    x_min = _coordinate(bbox[0], f"{label}[0]", maximum=width)
    y_min = _coordinate(bbox[1], f"{label}[1]", maximum=height)
    x_max = _coordinate(bbox[2], f"{label}[2]", maximum=width)
    y_max = _coordinate(bbox[3], f"{label}[3]", maximum=height)
    if x_max <= x_min or y_max <= y_min:
        raise ManifestValidationError(f"{label} must have positive area")
    return [x_min, y_min, x_max, y_max]


def _validate_baseline(
    value: Any,
    label: str,
    *,
    width: int,
    height: int,
) -> list[list[int | float]]:
    points = _array(value, label)
    if len(points) < 2:
        raise ManifestValidationError(f"{label} must contain at least two points")
    validated = []
    for index, point_value in enumerate(points):
        point = _array(point_value, f"{label}[{index}]")
        if len(point) != 2:
            raise ManifestValidationError(
                f"{label}[{index}] must contain two coordinates",
            )
        validated.append([
            _coordinate(
                point[0],
                f"{label}[{index}][0]",
                maximum=width,
            ),
            _coordinate(
                point[1],
                f"{label}[{index}][1]",
                maximum=height,
            ),
        ])
    return validated


def _validate_boundary(
    value: Any,
    label: str,
    *,
    width: int,
    height: int,
) -> list[dict[str, int | float]]:
    points = _array(value, label)
    if len(points) < 3:
        raise ManifestValidationError(
            f"{label} must contain at least three points",
        )
    validated = []
    for index, point_value in enumerate(points):
        point = _object(point_value, f"{label}[{index}]")
        _strict_keys(
            point,
            label=f"{label}[{index}]",
            required={"x", "y"},
        )
        validated.append({
            "x": _coordinate(
                point["x"],
                f"{label}[{index}].x",
                maximum=width,
            ),
            "y": _coordinate(
                point["y"],
                f"{label}[{index}].y",
                maximum=height,
            ),
        })
    return validated


def _resolve_file(
    manifest_directory: Path,
    value: Any,
    label: str,
) -> Path:
    raw = _string(value, label)
    candidate = Path(raw)
    if not candidate.is_absolute():
        candidate = manifest_directory / candidate
    try:
        resolved = candidate.resolve(strict=True)
    except FileNotFoundError as error:
        raise ManifestValidationError(f"{label} does not exist: {candidate}") from error
    if not resolved.is_file():
        raise ManifestValidationError(f"{label} is not a file: {resolved}")
    return resolved


def _load_verified_raster(
    *,
    source: Mapping[str, Any],
    source_path: Path,
    raster_path: Path,
    label: str,
) -> Image.Image:
    if sha256_file(source_path) != source["sourceChecksumSha256"]:
        raise ManifestValidationError(
            f"{label} source byte checksum mismatch",
        )
    if (
        sha256_file(raster_path)
        != source["rasterEncodedChecksumSha256"]
    ):
        raise ManifestValidationError(
            f"{label} raster encoded-byte checksum mismatch",
        )
    try:
        with Image.open(raster_path) as opened:
            image = opened.convert("RGB")
            image.load()
    except Exception as error:  # noqa: BLE001 - include decoder errors
        raise ManifestValidationError(
            f"{label}.source.rasterPath is not a readable image",
        ) from error
    expected_size = (source["width"], source["height"])
    if image.size != expected_size:
        raise ManifestValidationError(
            f"{label} raster size mismatch: "
            f"{image.size} != {expected_size}",
        )
    if rgb8_raster_sha256(image) != source["rasterChecksumSha256"]:
        raise ManifestValidationError(
            f"{label} decoded RGB raster checksum mismatch",
        )
    return image


def _validate_profile(
    raw_profile: Any,
    raw_inference: Any,
    *,
    model_path: Path,
    runtime_engine_version: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    profile = _object(raw_profile, "profile")
    _strict_keys(
        profile,
        label="profile",
        required={
            "profileChecksumSha256",
            "engine",
            "engineVersion",
            "modelName",
            "modelChecksumSha256",
            "configChecksumSha256",
        },
    )
    inference = _object(raw_inference, "inference")
    _strict_keys(
        inference,
        label="inference",
        required=set(EXPECTED_INFERENCE),
    )
    if inference != EXPECTED_INFERENCE:
        raise ManifestValidationError(
            "inference must exactly match the production McCATMuS profile",
        )

    engine = _string(profile["engine"], "profile.engine", maximum=128)
    engine_version = _string(
        profile["engineVersion"],
        "profile.engineVersion",
        maximum=128,
    )
    model_name = _string(
        profile["modelName"],
        "profile.modelName",
        maximum=512,
    )
    model_checksum = _sha256(
        profile["modelChecksumSha256"],
        "profile.modelChecksumSha256",
    )
    config_checksum = _sha256(
        profile["configChecksumSha256"],
        "profile.configChecksumSha256",
    )
    profile_checksum = _sha256(
        profile["profileChecksumSha256"],
        "profile.profileChecksumSha256",
    )
    if engine != "kraken":
        raise ManifestValidationError(
            f"profile.engine must be 'kraken', received {engine!r}",
        )
    if engine_version != runtime_engine_version:
        raise ManifestValidationError(
            "profile.engineVersion does not match the installed Kraken "
            f"runtime: {engine_version!r} != {runtime_engine_version!r}",
        )
    if model_path.name != model_name:
        raise ManifestValidationError(
            "profile.modelName does not match the supplied model filename: "
            f"{model_name!r} != {model_path.name!r}",
        )
    actual_model_checksum = sha256_file(model_path)
    if actual_model_checksum != model_checksum:
        raise ManifestValidationError(
            "Supplied model checksum does not match "
            "profile.modelChecksumSha256",
        )
    actual_config_checksum = canonical_json_checksum(inference)
    if actual_config_checksum != config_checksum:
        raise ManifestValidationError(
            "profile.configChecksumSha256 does not match inference",
        )
    profile_identity = {
        "engine": engine,
        "engineVersion": engine_version,
        "modelName": model_name,
        "modelChecksumSha256": model_checksum,
        "inference": inference,
    }
    if canonical_json_checksum(profile_identity) != profile_checksum:
        raise ManifestValidationError(
            "profile.profileChecksumSha256 does not match profile identity",
        )
    return dict(profile), dict(inference)


def _validate_segment(
    raw_segment: Any,
    *,
    label: str,
    width: int,
    height: int,
) -> ValidatedSegment:
    segment = _object(raw_segment, label)
    _strict_keys(
        segment,
        label=label,
        required={
            "id",
            "segmentGeometryChecksumSha256",
            "textDirection",
            "bbox",
        },
        optional={"geometryType", "baseline", "boundary"},
    )
    segment_id = _string(segment["id"], f"{label}.id", maximum=128)
    if not SEGMENT_ID_PATTERN.fullmatch(segment_id):
        raise ManifestValidationError(
            f"{label}.id is not a valid stable segment ID",
        )
    geometry_type = segment.get("geometryType")
    if geometry_type not in {None, "baseline", "bbox"}:
        raise ManifestValidationError(
            f"{label}.geometryType must be absent, 'baseline', or 'bbox'",
        )
    text_direction = segment["textDirection"]
    if text_direction not in TEXT_DIRECTIONS:
        raise ManifestValidationError(
            f"{label}.textDirection must explicitly declare a supported direction",
        )
    _validate_bbox(
        segment["bbox"],
        f"{label}.bbox",
        width=width,
        height=height,
    )
    if geometry_type == "baseline":
        if "baseline" not in segment or "boundary" not in segment:
            raise ManifestValidationError(
                f"{label} baseline geometry requires baseline and boundary",
            )
        _validate_baseline(
            segment["baseline"],
            f"{label}.baseline",
            width=width,
            height=height,
        )
        _validate_boundary(
            segment["boundary"],
            f"{label}.boundary",
            width=width,
            height=height,
        )
        recognition_adapter = "direct-baseline"
    elif geometry_type == "bbox" and "baseline" in segment:
        raise ManifestValidationError(
            f"{label} bbox geometry cannot contain an invented baseline",
        )
    elif geometry_type == "bbox":
        if "boundary" in segment:
            _validate_boundary(
                segment["boundary"],
                f"{label}.boundary",
                width=width,
                height=height,
            )
        recognition_adapter = "bbox-to-baseline-v1"
    else:
        if "baseline" not in segment:
            raise ManifestValidationError(
                f"{label} can omit geometryType only when a stored "
                "legacy baseline exists",
            )
        _validate_baseline(
            segment["baseline"],
            f"{label}.baseline",
            width=width,
            height=height,
        )
        if "boundary" in segment:
            _validate_boundary(
                segment["boundary"],
                f"{label}.boundary",
                width=width,
                height=height,
            )
            recognition_adapter = "direct-baseline"
        else:
            recognition_adapter = "legacy-baseline-bbox-boundary-v1"

    expected_checksum = _sha256(
        segment["segmentGeometryChecksumSha256"],
        f"{label}.segmentGeometryChecksumSha256",
    )
    actual_checksum = segment_geometry_checksum(segment)
    if actual_checksum != expected_checksum:
        raise ManifestValidationError(
            f"{label} geometry checksum mismatch for {segment_id}: "
            f"{actual_checksum} != {expected_checksum}",
        )
    return ValidatedSegment(
        raw=dict(segment),
        segment_id=segment_id,
        geometry_type=geometry_type,
        text_direction=text_direction,
        geometry_checksum_sha256=expected_checksum,
        recognition_adapter=recognition_adapter,
    )


def _validate_page(
    raw_page: Any,
    *,
    index: int,
    manifest_directory: Path,
) -> ValidatedPage:
    label = f"pages[{index}]"
    page = _object(raw_page, label)
    _strict_keys(
        page,
        label=label,
        required={"pageId", "source", "geometry", "segments"},
        optional={"pageKey"},
    )
    page_id = _string(page["pageId"], f"{label}.pageId", maximum=64)
    try:
        parsed_page_id = UUID(page_id)
    except ValueError as error:
        raise ManifestValidationError(
            f"{label}.pageId must be a UUID",
        ) from error
    if str(parsed_page_id).lower() != page_id.lower():
        raise ManifestValidationError(
            f"{label}.pageId must use canonical hyphenated UUID syntax",
        )
    page_key = (
        _string(page["pageKey"], f"{label}.pageKey", maximum=512)
        if "pageKey" in page
        else None
    )

    source = _object(page["source"], f"{label}.source")
    _strict_keys(
        source,
        label=f"{label}.source",
        required={
            "primarySourceRevision",
            "sourcePath",
            "sourceChecksumSha256",
            "rasterPath",
            "rasterEncodedChecksumSha256",
            "rasterChecksumAlgorithm",
            "rasterChecksumSha256",
            "width",
            "height",
            "normalization",
        },
    )
    _nonnegative_int(
        source["primarySourceRevision"],
        f"{label}.source.primarySourceRevision",
    )
    width = _positive_int(source["width"], f"{label}.source.width")
    height = _positive_int(source["height"], f"{label}.source.height")
    _sha256(
        source["sourceChecksumSha256"],
        f"{label}.source.sourceChecksumSha256",
    )
    _sha256(
        source["rasterEncodedChecksumSha256"],
        f"{label}.source.rasterEncodedChecksumSha256",
    )
    _sha256(
        source["rasterChecksumSha256"],
        f"{label}.source.rasterChecksumSha256",
    )
    if source["rasterChecksumAlgorithm"] != "sha256-rgb8-v1":
        raise ManifestValidationError(
            f"{label}.source.rasterChecksumAlgorithm must be "
            "'sha256-rgb8-v1'",
        )
    normalization = _object(
        source["normalization"],
        f"{label}.source.normalization",
    )
    _strict_keys(
        normalization,
        label=f"{label}.source.normalization",
        required={
            "operation",
            "applied",
            "originalExifOrientation",
            "exifReadError",
            "original",
            "normalized",
        },
    )
    _string(
        normalization["operation"],
        f"{label}.source.normalization.operation",
        maximum=128,
    )
    if not isinstance(normalization["applied"], bool):
        raise ManifestValidationError(
            f"{label}.source.normalization.applied must be boolean",
        )
    original_orientation = normalization["originalExifOrientation"]
    if (
        original_orientation is not None
        and (
            isinstance(original_orientation, bool)
            or not isinstance(original_orientation, int)
            or original_orientation < 1
            or original_orientation > 8
        )
    ):
        raise ManifestValidationError(
            f"{label}.source.normalization.originalExifOrientation "
            "must be null or an integer from 1 through 8",
        )
    if not isinstance(normalization["exifReadError"], bool):
        raise ManifestValidationError(
            f"{label}.source.normalization.exifReadError must be boolean",
        )
    original = _object(
        normalization["original"],
        f"{label}.source.normalization.original",
    )
    normalized = _object(
        normalization["normalized"],
        f"{label}.source.normalization.normalized",
    )
    for dimensions, dimensions_label in (
        (original, f"{label}.source.normalization.original"),
        (normalized, f"{label}.source.normalization.normalized"),
    ):
        _strict_keys(
            dimensions,
            label=dimensions_label,
            required={"width", "height", "mode"},
        )
        _positive_int(dimensions["width"], f"{dimensions_label}.width")
        _positive_int(dimensions["height"], f"{dimensions_label}.height")
        _string(dimensions["mode"], f"{dimensions_label}.mode", maximum=64)
    if normalized["mode"] != "RGB":
        raise ManifestValidationError(
            f"{label}.source.normalization.normalized.mode must equal 'RGB'",
        )
    if normalized["width"] != width or normalized["height"] != height:
        raise ManifestValidationError(
            f"{label}.source normalization dimensions do not match raster",
        )
    source_path = _resolve_file(
        manifest_directory,
        source["sourcePath"],
        f"{label}.source.sourcePath",
    )
    raster_path = _resolve_file(
        manifest_directory,
        source["rasterPath"],
        f"{label}.source.rasterPath",
    )
    _load_verified_raster(
        source=source,
        source_path=source_path,
        raster_path=raster_path,
        label=label,
    )

    geometry = _object(page["geometry"], f"{label}.geometry")
    _strict_keys(
        geometry,
        label=f"{label}.geometry",
        required={
            "geometryRevision",
            "geometryChecksumSha256",
            "lineSegmentsChecksumSha256",
            "alignmentSegmentInputChecksumSha256",
        },
    )
    _nonnegative_int(
        geometry["geometryRevision"],
        f"{label}.geometry.geometryRevision",
    )
    for key in (
        "geometryChecksumSha256",
        "lineSegmentsChecksumSha256",
        "alignmentSegmentInputChecksumSha256",
    ):
        _sha256(geometry[key], f"{label}.geometry.{key}")

    segments = []
    seen_ids: set[str] = set()
    for segment_index, raw_segment in enumerate(
        _array(page["segments"], f"{label}.segments"),
    ):
        segment = _validate_segment(
            raw_segment,
            label=f"{label}.segments[{segment_index}]",
            width=width,
            height=height,
        )
        if segment.segment_id in seen_ids:
            raise ManifestValidationError(
                f"{label} has duplicate segment ID: {segment.segment_id}",
            )
        seen_ids.add(segment.segment_id)
        segments.append(segment)

    return ValidatedPage(
        raw=dict(page),
        page_id=page_id,
        page_key=page_key,
        source_path=source_path,
        raster_path=raster_path,
        segments=tuple(segments),
    )


def load_and_validate_manifest(
    manifest_path: Path,
    model_path: Path,
    *,
    runtime_engine_version: str | None = None,
) -> ValidatedBatch:
    manifest_path = manifest_path.resolve(strict=True)
    model_path = model_path.resolve(strict=True)
    try:
        raw = json.loads(
            manifest_path.read_text(encoding="utf-8"),
            object_pairs_hook=_reject_duplicate_json_keys,
        )
    except json.JSONDecodeError as error:
        raise ManifestValidationError(
            f"Manifest is not valid JSON: {error}",
        ) from error
    manifest = _object(raw, "manifest")
    _strict_keys(
        manifest,
        label="manifest",
        required={
            "schemaVersion",
            "kind",
            "runId",
            "profile",
            "inference",
            "pages",
        },
    )
    if manifest["schemaVersion"] != 1:
        raise ManifestValidationError("manifest.schemaVersion must equal 1")
    if manifest["kind"] != "current-page-recognition-batch":
        raise ManifestValidationError(
            "manifest.kind must equal 'current-page-recognition-batch'",
        )
    run_id = _string(manifest["runId"], "manifest.runId", maximum=128)
    if not RUN_ID_PATTERN.fullmatch(run_id):
        raise ManifestValidationError("manifest.runId is not filesystem-safe")

    profile, inference = _validate_profile(
        manifest["profile"],
        manifest["inference"],
        model_path=model_path,
        runtime_engine_version=(
            runtime_engine_version
            if runtime_engine_version is not None
            else version("kraken")
        ),
    )
    pages = []
    seen_page_ids: set[str] = set()
    for page_index, raw_page in enumerate(_array(manifest["pages"], "pages")):
        page = _validate_page(
            raw_page,
            index=page_index,
            manifest_directory=manifest_path.parent,
        )
        if page.page_id in seen_page_ids:
            raise ManifestValidationError(
                f"Manifest has duplicate page ID: {page.page_id}",
            )
        seen_page_ids.add(page.page_id)
        pages.append(page)

    return ValidatedBatch(
        raw=dict(manifest),
        manifest_path=manifest_path,
        manifest_checksum_sha256=sha256_file(manifest_path),
        run_id=run_id,
        profile=profile,
        inference=inference,
        model_path=model_path,
        pages=tuple(pages),
    )


def _rounded_point_pairs(
    points: Iterable[Sequence[int | float]],
) -> list[tuple[int, int]]:
    return [
        (round(float(point[0])), round(float(point[1])))
        for point in points
    ]


def _closed_rounded_boundary(
    points: Iterable[Mapping[str, int | float]],
) -> list[tuple[int, int]]:
    boundary = [
        (round(float(point["x"])), round(float(point["y"])))
        for point in points
    ]
    if boundary and boundary[0] != boundary[-1]:
        boundary.append(boundary[0])
    return boundary


def _base_direction(text_direction: str) -> str:
    return "R" if text_direction.endswith("-rl") else "L"


def _baseline_line(
    segment: ValidatedSegment,
    *,
    raster_path: Path,
) -> BaselineLine:
    raw = segment.raw
    if segment.geometry_type != "bbox":
        rounded_baseline = _rounded_point_pairs(raw["baseline"])
        if segment.recognition_adapter == "direct-baseline":
            rounded_boundary = _closed_rounded_boundary(raw["boundary"])
        else:
            x_min, y_min, x_max, y_max = (
                round(float(value)) for value in raw["bbox"]
            )
            if x_max <= x_min or y_max <= y_min:
                raise ManifestValidationError(
                    "legacy-baseline-bbox-boundary-v1 collapsed a "
                    f"subpixel bbox for {segment.segment_id}",
                )
            rounded_boundary = [
                (x_min, y_min),
                (x_max, y_min),
                (x_max, y_max),
                (x_min, y_max),
                (x_min, y_min),
            ]
        if len(set(rounded_baseline)) < 2:
            raise ManifestValidationError(
                "direct-baseline collapsed to fewer than two distinct "
                f"points for {segment.segment_id}",
            )
        if len(set(rounded_boundary[:-1])) < 3:
            raise ManifestValidationError(
                "direct-baseline boundary collapsed to fewer than three "
                f"distinct points for {segment.segment_id}",
            )
        return BaselineLine(
            id=segment.segment_id,
            text=None,
            base_dir=_base_direction(segment.text_direction),
            imagename=str(raster_path),
            baseline=rounded_baseline,
            boundary=rounded_boundary,
        )

    rounded_bbox = tuple(round(float(value)) for value in raw["bbox"])
    x_min, y_min, x_max, y_max = rounded_bbox
    if x_max <= x_min or y_max <= y_min:
        raise ManifestValidationError(
            "bbox-to-baseline-v1 collapsed a subpixel bbox for "
            f"{segment.segment_id}",
        )
    return BBoxLine(
        id=segment.segment_id,
        text=None,
        base_dir=_base_direction(segment.text_direction),
        imagename=str(raster_path),
        bbox=rounded_bbox,
        text_direction=segment.text_direction,
    ).to_baseline(topline=False)


def build_recognition_segmentations(
    page: ValidatedPage,
) -> list[Segmentation]:
    """Build one Kraken segmentation per explicit text direction."""
    grouped: OrderedDict[str, list[BaselineLine]] = OrderedDict()
    for segment in page.segments:
        grouped.setdefault(segment.text_direction, []).append(
            _baseline_line(segment, raster_path=page.raster_path),
        )
    return [
        Segmentation(
            type="baselines",
            imagename=str(page.raster_path),
            text_direction=text_direction,
            script_detection=False,
            lines=lines,
            regions=None,
            line_orders=None,
            language=["eng"],
        )
        for text_direction, lines in grouped.items()
    ]


def _mean_confidence(values: Any, *, segment_id: str) -> float | None:
    if values is None:
        return None
    confidences = [float(value) for value in values]
    for confidence in confidences:
        if not math.isfinite(confidence) or not 0 <= confidence <= 1:
            raise RuntimeError(
                f"Kraken returned invalid confidence for {segment_id}",
            )
    if not confidences:
        return None
    return sum(confidences) / len(confidences)


def _recognition_config(
    inference: Mapping[str, Any],
) -> RecognitionInferenceConfig:
    return RecognitionInferenceConfig(
        accelerator=inference["accelerator"],
        device=1,
        precision=inference["precision"],
        batch_size=inference["batchSize"],
        num_line_workers=inference["numLineWorkers"],
        num_threads=inference["numThreads"],
        padding=inference["padding"],
        raise_on_error=True,
        return_logits=False,
        return_line_image=False,
    )


def recognize_page(
    page: ValidatedPage,
    *,
    model: Any,
    profile: Mapping[str, Any],
    inference: Mapping[str, Any],
    run_id: str,
    manifest_checksum_sha256: str,
    created_at: str | None = None,
) -> dict[str, Any]:
    """Recognize one page and return the strict TypeScript artifact shape."""
    expected = {segment.segment_id: segment for segment in page.segments}
    recognized: dict[str, dict[str, Any]] = {}
    config = _recognition_config(inference)

    image = _load_verified_raster(
        source=page.raw["source"],
        source_path=page.source_path,
        raster_path=page.raster_path,
        label=f"page {page.page_id}",
    )
    for segmentation in build_recognition_segmentations(page):
        for result in model.predict(image, segmentation, config):
            segment_id = getattr(result, "id", None)
            if segment_id not in expected:
                raise RuntimeError(
                    f"Kraken returned unknown segment ID: {segment_id!r}",
                )
            if segment_id in recognized:
                raise RuntimeError(
                    f"Kraken returned duplicate segment ID: {segment_id}",
                )
            prediction = getattr(result, "prediction", "")
            if prediction is None:
                prediction = ""
            if not isinstance(prediction, str):
                raise RuntimeError(
                    f"Kraken returned non-string text for {segment_id}",
                )
            source_segment = expected[segment_id]
            recognized[segment_id] = {
                "segmentId": segment_id,
                "segmentGeometryChecksumSha256":
                    source_segment.geometry_checksum_sha256,
                "textDirection": source_segment.text_direction,
                "text": prediction,
                "meanConfidence": _mean_confidence(
                    getattr(result, "confidences", None),
                    segment_id=segment_id,
                ),
                "state": (
                    "recognized"
                    if prediction.strip()
                    else "attempted-empty"
                ),
                "binding": {
                    "kind": "exact-current-input",
                    "adapter": source_segment.recognition_adapter,
                },
            }

    missing = set(expected) - set(recognized)
    if missing:
        raise RuntimeError(
            "Kraken did not return exact segment coverage; missing "
            f"{sorted(missing)}",
        )
    if set(recognized) != set(expected):
        raise RuntimeError("Kraken output segment coverage does not match input")

    source = page.raw["source"]
    geometry = page.raw["geometry"]
    timestamp = created_at or (
        datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )
    return {
        "schemaVersion": 2,
        "kind": "page-line-recognition",
        "pageId": page.page_id,
        "source": {
            "primarySourceRevision": source["primarySourceRevision"],
            "sourceChecksumSha256": source["sourceChecksumSha256"],
            "geometryRevision": geometry["geometryRevision"],
            "geometryChecksumSha256":
                geometry["geometryChecksumSha256"],
            "lineSegmentsChecksumSha256":
                geometry["lineSegmentsChecksumSha256"],
            "alignmentSegmentInputChecksumSha256":
                geometry["alignmentSegmentInputChecksumSha256"],
        },
        "profile": dict(profile),
        "evidence": {
            "runId": run_id,
            "manifestChecksumSha256": manifest_checksum_sha256,
            "inference": dict(inference),
            "raster": {
                "encodedChecksumSha256":
                    source["rasterEncodedChecksumSha256"],
                "checksumAlgorithm": source["rasterChecksumAlgorithm"],
                "checksumSha256": source["rasterChecksumSha256"],
                "width": source["width"],
                "height": source["height"],
            },
            "normalization": dict(source["normalization"]),
        },
        "state": "completed",
        "records": [
            recognized[segment.segment_id]
            for segment in page.segments
        ],
        "createdAt": timestamp,
    }


def exclusive_atomic_write_json(path: Path, payload: Mapping[str, Any]) -> None:
    """Atomically create a JSON file while refusing to replace any output."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}-{uuid4()}")
    try:
        with temporary.open("x", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError as error:
            raise FileExistsError(
                f"Refusing to overwrite existing recognition output: {path}",
            ) from error
    finally:
        temporary.unlink(missing_ok=True)


def _page_output_path(output_root: Path, page: ValidatedPage) -> Path:
    return output_root / "pages" / page.page_id / "recognition.v1.json"


def run_batch(
    *,
    manifest_path: Path,
    model_path: Path,
    output_root: Path,
    model_loader: Callable[[Path], Any] = RecognitionTaskModel.load_model,
) -> dict[str, Any]:
    """Validate all inputs, load one model, and recognize every page."""
    batch = load_and_validate_manifest(manifest_path, model_path)
    output_root = output_root.resolve()
    run_output_path = output_root / "run.v1.json"
    planned = [run_output_path]
    planned.extend(_page_output_path(output_root, page) for page in batch.pages)
    existing = [str(path) for path in planned if path.exists()]
    if existing:
        raise FileExistsError(
            "Refusing to overwrite existing recognition outputs: "
            f"{existing}",
        )

    started_at = time.time()
    model_load_started = time.monotonic()
    if sha256_file(batch.model_path) != batch.profile["modelChecksumSha256"]:
        raise ManifestValidationError(
            "Model bytes changed after manifest validation",
        )
    model = model_loader(batch.model_path)
    model_load_seconds = time.monotonic() - model_load_started
    if getattr(model, "seg_type", None) != "baselines":
        raise ValueError(
            "Recognition model must accept baselines, got "
            f"{getattr(model, 'seg_type', None)!r}",
        )

    successes = []
    failures = []
    for page in batch.pages:
        page_started = time.monotonic()
        try:
            artifact = recognize_page(
                page,
                model=model,
                profile=batch.profile,
                inference=batch.inference,
                run_id=batch.run_id,
                manifest_checksum_sha256=
                    batch.manifest_checksum_sha256,
            )
            output_path = _page_output_path(output_root, page)
            exclusive_atomic_write_json(output_path, artifact)
            successes.append({
                "pageId": page.page_id,
                **({"pageKey": page.page_key} if page.page_key else {}),
                "status": "succeeded",
                "output": str(output_path.relative_to(output_root)),
                "artifactChecksumSha256":
                    canonical_json_checksum(artifact),
                "recordCount": len(artifact["records"]),
                "elapsedSeconds": time.monotonic() - page_started,
            })
        except Exception as error:  # noqa: BLE001 - preserve per-page diagnostics
            failures.append({
                "pageId": page.page_id,
                **({"pageKey": page.page_key} if page.page_key else {}),
                "status": "failed",
                "errorType": type(error).__name__,
                "message": str(error),
                "elapsedSeconds": time.monotonic() - page_started,
            })

    completed_at = time.time()
    run = {
        "schemaVersion": 1,
        "kind": "current-page-recognition-run",
        "runId": batch.run_id,
        "state": (
            "completed"
            if not failures
            else "completed-with-failures"
        ),
        "source": {
            "manifestPath": str(batch.manifest_path),
            "manifestChecksumSha256": batch.manifest_checksum_sha256,
        },
        "profile": batch.profile,
        "timing": {
            "startedAtUnix": started_at,
            "completedAtUnix": completed_at,
            "elapsedSeconds": completed_at - started_at,
            "modelLoadSeconds": model_load_seconds,
        },
        "summary": {
            "requestedPageCount": len(batch.pages),
            "succeededPageCount": len(successes),
            "failedPageCount": len(failures),
            "requestedSegmentCount": sum(
                len(page.segments) for page in batch.pages
            ),
            "recognizedSegmentCount": sum(
                page["recordCount"] for page in successes
            ),
        },
        "pages": successes,
        "failures": failures,
    }
    exclusive_atomic_write_json(run_output_path, run)
    return run


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Recognize checksum-bound current page geometry with Kraken 7"
        ),
    )
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--output-root", type=Path)
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="Validate identities and checksums without loading the model",
    )
    args = parser.parse_args()
    if args.validate_only and args.output_root is not None:
        parser.error("--output-root cannot be used with --validate-only")
    if not args.validate_only and args.output_root is None:
        parser.error("--output-root is required unless --validate-only is used")
    return args


def main() -> None:
    args = parse_args()
    if args.validate_only:
        batch = load_and_validate_manifest(args.manifest, args.model)
        print(json.dumps({
            "state": "valid",
            "runId": batch.run_id,
            "pageCount": len(batch.pages),
            "segmentCount": sum(len(page.segments) for page in batch.pages),
            "modelLoaded": False,
        }))
        return

    run = run_batch(
        manifest_path=args.manifest,
        model_path=args.model,
        output_root=args.output_root,
    )
    print(json.dumps({
        "run": str((args.output_root.resolve() / "run.v1.json")),
        "state": run["state"],
        "summary": run["summary"],
    }))
    if run["failures"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
