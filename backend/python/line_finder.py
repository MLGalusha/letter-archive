#!/usr/bin/env python3
"""Versioned page-layout detection with Kraken 7.

The canonical result of this module is a ``PageLayoutV2``-like object that
preserves Kraken's native geometry and document structure.  In particular, it
does not turn bounding boxes into baselines, flatten curved baselines, or
replace Kraken's reading order with a coordinate sort.

One-shot integrations use ``--native-json``. Multi-page integrations use the
versioned ``--worker-native-json`` protocol so the model is loaded only once.
"""

import argparse
import hashlib
import io
import json
import os
import platform
import sys
from dataclasses import dataclass
from functools import lru_cache
from importlib import resources
from importlib.metadata import version
from numbers import Integral
from pathlib import Path
from typing import Any

from kraken.configs import SegmentationInferenceConfig
from kraken.tasks import SegmentationTaskModel
from PIL import Image, ImageDraw


SCHEMA_VERSION = 2
EXPECTED_KRAKEN_VERSION = "7.0.3"
IDENTITY_VERSION = 1
IDENTITY_SOURCE = "derived-source-raster-model-provider-order-geometry-v2"
RASTER_CHECKSUM_ALGORITHM = "sha256-rgb8-v1"
WORKER_PROTOCOL = "kraken-native-layout-ndjson"
WORKER_PROTOCOL_VERSION = 1
TEXT_DIRECTIONS = (
    "horizontal-lr",
    "horizontal-rl",
    "vertical-lr",
    "vertical-rl",
)
DEFAULT_INFERENCE_CONFIG = {
    "accelerator": "cpu",
    "device": "auto",
    "precision": "32-true",
    "batch_size": 1,
    "raise_on_error": True,
    "num_threads": 1,
    "input_padding": 0,
}
RUNTIME_DISTRIBUTIONS = {
    "kraken": "kraken",
    "torch": "torch",
    "pillow": "Pillow",
    "numpy": "numpy",
    "coremltools": "coremltools",
    "lightning": "lightning",
    "safetensors": "safetensors",
    "scikitImage": "scikit-image",
    "scikitLearn": "scikit-learn",
    "scipy": "scipy",
    "shapely": "shapely",
    "torchmetrics": "torchmetrics",
    "torchvision": "torchvision",
}
ADAPTER_NAME = "letter-archive-kraken-native-layout"
ADAPTER_CONTRACT_VERSION = 2


@dataclass(frozen=True)
class LoadedModel:
    task_model: Any
    provenance: dict[str, Any]


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _rgb8_raster_sha256(image: Image.Image) -> str:
    """Hash decoded pixels independently of PNG/JPEG encoder differences."""
    rgb = image if image.mode == "RGB" else image.convert("RGB")
    framing = f"rgb8:{rgb.width}x{rgb.height}\n".encode("ascii")
    return _sha256_bytes(framing + rgb.tobytes())


def normalize_orientation_with_metadata(img_bytes: bytes) -> tuple[bytes, dict[str, Any]]:
    """Apply EXIF orientation and describe the resulting coordinate transform."""
    img = Image.open(io.BytesIO(img_bytes))
    original_width, original_height = img.size
    original_mode = img.mode
    orientation = None
    exif_read_error = False
    try:
        exif = img.getexif()
        raw_orientation = exif.get(0x0112)
        orientation = (
            int(raw_orientation)
            if (
                isinstance(raw_orientation, Integral)
                and not isinstance(raw_orientation, bool)
                and 1 <= int(raw_orientation) <= 8
            )
            else None
        )
        if orientation == 2:
            img = img.transpose(Image.FLIP_LEFT_RIGHT)
        elif orientation == 3:
            img = img.transpose(Image.ROTATE_180)
        elif orientation == 4:
            img = img.transpose(Image.FLIP_TOP_BOTTOM)
        elif orientation == 5:
            img = img.transpose(Image.ROTATE_270).transpose(Image.FLIP_LEFT_RIGHT)
        elif orientation == 6:
            img = img.transpose(Image.ROTATE_270)
        elif orientation == 7:
            img = img.transpose(Image.ROTATE_90).transpose(Image.FLIP_LEFT_RIGHT)
        elif orientation == 8:
            img = img.transpose(Image.ROTATE_90)
    except Exception:
        exif_read_error = True
    if img.mode != "RGB":
        img = img.convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    corrected = buf.getvalue()
    operation = {
        2: "flip-horizontal",
        3: "rotate-180",
        4: "flip-vertical",
        5: "transpose",
        6: "rotate-90-cw",
        7: "transverse",
        8: "rotate-90-ccw",
    }.get(orientation, "identity")
    return corrected, {
        "operation": operation,
        "applied": operation != "identity",
        "originalExifOrientation": orientation,
        "exifReadError": exif_read_error,
        "original": {
            "width": original_width,
            "height": original_height,
            "mode": original_mode,
        },
        "normalized": {
            "width": img.width,
            "height": img.height,
            "mode": img.mode,
        },
    }


def normalize_orientation(img_bytes: bytes) -> bytes:
    """Backward-compatible helper returning only normalized PNG bytes."""
    corrected, _ = normalize_orientation_with_metadata(img_bytes)
    return corrected


@lru_cache(maxsize=1)
def load_default_model() -> LoadedModel:
    """Load and fingerprint Kraken's bundled layout model once."""
    installed_version = version("kraken")
    if installed_version != EXPECTED_KRAKEN_VERSION:
        raise RuntimeError(
            "Unsupported Kraken runtime: "
            f"expected {EXPECTED_KRAKEN_VERSION}, found {installed_version}. "
            "Run backend/python/setup.sh before detecting lines."
        )
    model_path = Path(str(resources.files("kraken").joinpath("blla.mlmodel")))
    if not model_path.is_file():
        raise RuntimeError(f"Bundled Kraken model not found: {model_path}")
    return LoadedModel(
        task_model=SegmentationTaskModel.load_model(str(model_path)),
        provenance={
            "name": model_path.name,
            "kind": "kraken-package-resource",
            "sha256": _sha256_file(model_path),
            "sizeBytes": model_path.stat().st_size,
        },
    )


def _json_value(value: Any) -> Any:
    """Convert provider values, including NumPy scalars, into JSON values."""
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, Path):
        return value.as_posix()
    if isinstance(value, dict):
        return {str(key): _json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_value(item) for item in value]
    item_method = getattr(value, "item", None)
    if callable(item_method):
        return _json_value(item_method())
    return str(value)


def _callable_identity(value: Any) -> dict[str, str]:
    """Serialize a callable without unstable repr memory addresses."""
    module = getattr(value, "__module__", type(value).__module__)
    qualname = getattr(
        value,
        "__qualname__",
        getattr(value, "__name__", type(value).__qualname__),
    )
    return {
        "kind": "python-callable",
        "module": str(module),
        "qualname": str(qualname),
    }


def _effective_inference_config(
    config: SegmentationInferenceConfig,
) -> dict[str, Any]:
    """Capture every effective Kraken setting, including provider defaults."""
    effective: dict[str, Any] = {}
    for key, value in sorted(vars(config).items()):
        effective[key] = (
            _callable_identity(value) if callable(value) else _json_value(value)
        )
    return effective


@lru_cache(maxsize=1)
def _runtime_artifacts() -> dict[str, Any]:
    adapter_path = Path(__file__).resolve()
    constraints_path = adapter_path.with_name("constraints-runtime.txt")
    if not constraints_path.is_file():
        raise RuntimeError(
            f"Kraken runtime constraints not found: {constraints_path}"
        )
    return {
        "adapter": {
            "name": ADAPTER_NAME,
            "contractVersion": ADAPTER_CONTRACT_VERSION,
            "sha256": _sha256_file(adapter_path),
        },
        "constraints": {
            "name": constraints_path.name,
            "sha256": _sha256_file(constraints_path),
        },
    }


def _model_execution_observation(task_model: Any) -> dict[str, list[str]]:
    """Query loaded model parameters for their actual devices and dtypes."""
    devices: set[str] = set()
    dtypes: set[str] = set()
    for collection_name in ("seg_models", "ro_models"):
        collection = getattr(task_model, collection_name, None) or []
        values = collection.values() if isinstance(collection, dict) else collection
        for model in values:
            parameters = getattr(model, "parameters", None)
            if not callable(parameters):
                continue
            for parameter in parameters():
                devices.add(str(parameter.device))
                dtypes.add(str(parameter.dtype))
    return {
        "modelParameterDevices": sorted(devices),
        "modelParameterDtypes": sorted(dtypes),
    }


def _runtime_provenance(
    inference_config: dict[str, Any],
    *,
    process_mode: str,
    execution_observation: dict[str, list[str]] | None = None,
) -> dict[str, Any]:
    """Record the concrete runtime that produced this page layout."""
    accelerator = str(inference_config["accelerator"])
    configured_device = _json_value(inference_config["device"])
    observation = execution_observation or {
        "modelParameterDevices": [],
        "modelParameterDtypes": [],
    }
    observed_devices = observation["modelParameterDevices"]
    if len(observed_devices) == 1:
        resolved_device = observed_devices[0]
        resolution_source = "model-parameters"
    elif accelerator == "cpu":
        resolved_device = "cpu"
        resolution_source = "configured-accelerator"
    else:
        resolved_device = str(configured_device)
        resolution_source = "configured-device"
    return {
        "python": {
            "version": platform.python_version(),
            "implementation": platform.python_implementation(),
        },
        "platform": {
            "system": platform.system(),
            "release": platform.release(),
            "machine": platform.machine(),
        },
        "packages": {
            key: version(distribution)
            for key, distribution in RUNTIME_DISTRIBUTIONS.items()
        },
        "artifacts": _runtime_artifacts(),
        "execution": {
            "processMode": process_mode,
            "accelerator": accelerator,
            "configuredDevice": configured_device,
            "resolvedDevice": resolved_device,
            "resolutionSource": resolution_source,
            "precision": str(inference_config["precision"]),
            **observation,
        },
    }


def _points(value: Any) -> list[dict[str, int]] | None:
    if value is None:
        return None
    return [{"x": int(point[0]), "y": int(point[1])} for point in value]


def _bbox(value: Any) -> list[int] | None:
    if value is None:
        return None
    if len(value) != 4:
        raise ValueError(f"Expected a four-coordinate bounding box, got {value!r}")
    return [int(coordinate) for coordinate in value]


def _extent_from_points(
    points: list[dict[str, int]] | None,
) -> list[int] | None:
    if not points:
        return None
    xs = [point["x"] for point in points]
    ys = [point["y"] for point in points]
    return [min(xs), min(ys), max(xs), max(ys)]


def _provider_id(value: Any) -> str | None:
    provider_id = getattr(value, "id", None)
    if provider_id is None or not str(provider_id):
        return None
    return str(provider_id)


def _identity_source(source: dict[str, Any]) -> dict[str, Any]:
    """Return the page attributes used by deterministic entity identities."""
    original = source.get("original") or {}
    normalized = source.get("normalized") or {}
    return {
        "sourceSha256": original.get("sha256") or normalized.get("sha256"),
        "normalizedRasterSha256": normalized.get("rasterSha256"),
        "rasterChecksumAlgorithm": normalized.get("rasterChecksumAlgorithm"),
    }


def _persistent_id(prefix: str, value: dict[str, Any]) -> str:
    canonical = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return f"{prefix}-sha256-{_sha256_bytes(canonical)}"


def _region_references(
    line: Any,
    provider_region_ids: dict[str, str],
) -> tuple[list[Any], list[str], list[Any]]:
    raw_references = _json_value(getattr(line, "regions", None)) or []
    if not isinstance(raw_references, list):
        raw_references = [raw_references]
    canonical_ids: list[str] = []
    unresolved: list[Any] = []
    for provider_reference in raw_references:
        canonical_id = provider_region_ids.get(str(provider_reference))
        if canonical_id is None:
            unresolved.append(provider_reference)
        else:
            canonical_ids.append(canonical_id)
    return raw_references, canonical_ids, unresolved


def _serialize_line(
    line: Any,
    ordinal: int,
    *,
    source_identity: dict[str, Any],
    model_sha256: str | None,
    provider_region_ids: dict[str, str],
) -> dict[str, Any]:
    line_type = str(getattr(line, "type", "baselines"))

    if line_type == "bbox":
        native_bbox = _bbox(getattr(line, "bbox", None))
        geometry = {
            "type": "bbox",
            "bbox": native_bbox,
            "textDirection": getattr(line, "text_direction", None),
        }
        extent = native_bbox
        extent_source = "native-bbox" if native_bbox is not None else "unavailable"
    elif line_type in ("baseline", "baselines"):
        baseline = _points(getattr(line, "baseline", None))
        boundary = _points(getattr(line, "boundary", None))
        geometry = {
            "type": "baselines",
            "baseline": baseline,
            "boundary": boundary,
        }
        extent = _extent_from_points(boundary)
        extent_source = "derived-boundary-aabb"
        if extent is None:
            extent = _extent_from_points(baseline)
            extent_source = (
                "derived-baseline-aabb" if extent is not None else "unavailable"
            )
    else:
        raise ValueError(f"Unsupported Kraken line type: {line_type}")

    persistent_id = _persistent_id(
        "line",
        {
            "identityVersion": IDENTITY_VERSION,
            "kind": "line",
            "source": source_identity,
            "modelSha256": model_sha256,
            "providerOrdinal": ordinal,
            "geometry": geometry,
        },
    )
    raw_region_ids, region_ids, unresolved_region_ids = _region_references(
        line,
        provider_region_ids,
    )
    return {
        "id": persistent_id,
        "providerId": _provider_id(line),
        "identityVersion": IDENTITY_VERSION,
        "idSource": IDENTITY_SOURCE,
        "providerOrdinal": ordinal,
        "text": getattr(line, "text", None),
        "baseDirection": getattr(line, "base_dir", None),
        "tags": _json_value(getattr(line, "tags", None)),
        "providerRegionIds": raw_region_ids,
        "regionIds": region_ids,
        "unresolvedProviderRegionIds": unresolved_region_ids,
        "language": _json_value(getattr(line, "language", None)),
        "geometry": geometry,
        "displayExtent": {
            "bbox": extent,
            "source": extent_source,
            "derived": extent_source.startswith("derived-"),
        },
    }


def _serialize_regions(
    segmentation: Any,
    *,
    source_identity: dict[str, Any],
    model_sha256: str | None,
) -> tuple[list[dict[str, Any]], dict[str, str]]:
    serialized: list[dict[str, Any]] = []
    provider_ids: dict[str, str] = {}
    for region_class, regions in (getattr(segmentation, "regions", None) or {}).items():
        for ordinal, region in enumerate(regions):
            boundary = _points(getattr(region, "boundary", None))
            persistent_id = _persistent_id(
                "region",
                {
                    "identityVersion": IDENTITY_VERSION,
                    "kind": "region",
                    "source": source_identity,
                    "modelSha256": model_sha256,
                    "class": str(region_class),
                    "providerOrdinal": ordinal,
                    "boundary": boundary,
                },
            )
            provider_id = _provider_id(region)
            serialized.append(
                {
                    "id": persistent_id,
                    "providerId": provider_id,
                    "identityVersion": IDENTITY_VERSION,
                    "idSource": IDENTITY_SOURCE,
                    "class": str(region_class),
                    "providerOrdinal": ordinal,
                    "boundary": boundary,
                    "tags": _json_value(getattr(region, "tags", None)),
                    "language": _json_value(getattr(region, "language", None)),
                }
            )
            if provider_id is not None:
                provider_ids[provider_id] = persistent_id
    return serialized, provider_ids


def _serialize_alternate_orders(
    raw_orders: Any,
    ordered_line_ids: list[str],
) -> list[dict[str, Any]]:
    orders: list[dict[str, Any]] = []
    for ordinal, raw_order in enumerate(raw_orders or []):
        provider_indices = [int(index) for index in raw_order]
        line_ids = [
            ordered_line_ids[index]
            for index in provider_indices
            if 0 <= index < len(ordered_line_ids)
        ]
        orders.append(
            {
                "providerOrdinal": ordinal,
                "providerIndices": provider_indices,
                "lineIds": line_ids,
                "complete": len(line_ids) == len(provider_indices),
            }
        )
    return orders


def build_page_layout(
    segmentation: Any,
    image: Image.Image,
    *,
    source: dict[str, Any],
    model_provenance: dict[str, Any],
    inference_config: dict[str, Any],
    process_mode: str = "one-shot",
    execution_observation: dict[str, list[str]] | None = None,
) -> dict[str, Any]:
    """Normalize a Kraken container without flattening its native structure."""
    normalized_source = source.get("normalized")
    if normalized_source is not None:
        declared_size = (
            normalized_source.get("width"),
            normalized_source.get("height"),
        )
        if declared_size != image.size:
            raise ValueError(
                "Normalized source dimensions do not match the segmented image: "
                f"declared {declared_size}, actual {image.size}"
            )
        source = {
            **source,
            "normalized": {
                **normalized_source,
                "rasterSha256": _rgb8_raster_sha256(image),
                "rasterChecksumAlgorithm": RASTER_CHECKSUM_ALGORITHM,
            },
        }
    source_identity = _identity_source(source)
    model_sha256 = model_provenance.get("sha256")
    regions, provider_region_ids = _serialize_regions(
        segmentation,
        source_identity=source_identity,
        model_sha256=model_sha256,
    )
    lines = [
        _serialize_line(
            line,
            ordinal,
            source_identity=source_identity,
            model_sha256=model_sha256,
            provider_region_ids=provider_region_ids,
        )
        for ordinal, line in enumerate(getattr(segmentation, "lines", None) or [])
    ]
    ordered_line_ids = [line["id"] for line in lines]
    layout = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": "PageLayout",
        "source": source,
        "producer": {
            "engine": "kraken",
            "engineVersion": version("kraken"),
            "api": "kraken.tasks.SegmentationTaskModel",
            "model": model_provenance,
            "config": inference_config,
            "runtime": _runtime_provenance(
                inference_config,
                process_mode=process_mode,
                execution_observation=execution_observation,
            ),
        },
        "segmentation": {
            "type": getattr(segmentation, "type", None),
            "textDirection": getattr(segmentation, "text_direction", None),
            "scriptDetection": bool(
                getattr(segmentation, "script_detection", False)
            ),
            "language": _json_value(getattr(segmentation, "language", None)),
            "readingOrder": {
                "source": "segmentation.lines",
                "lineIds": ordered_line_ids,
            },
            "alternateReadingOrders": _serialize_alternate_orders(
                getattr(segmentation, "line_orders", None),
                ordered_line_ids,
            ),
            "regions": regions,
            "lines": lines,
        },
    }
    return layout


def segment_image(
    img: Image.Image,
    *,
    source: dict[str, Any] | None = None,
    text_direction: str = "horizontal-lr",
    process_mode: str = "one-shot",
) -> dict[str, Any]:
    """Run the Kraken 7 task API and return the native versioned contract."""
    if text_direction not in TEXT_DIRECTIONS:
        raise ValueError(f"Unsupported text direction: {text_direction}")
    loaded = load_default_model()
    config_values = {
        **DEFAULT_INFERENCE_CONFIG,
        "text_direction": text_direction,
    }
    config = SegmentationInferenceConfig(**config_values)
    segmentation = loaded.task_model.predict(img, config)
    execution_observation = _model_execution_observation(loaded.task_model)
    if source is None:
        source = {
            "name": None,
            "coordinateSpace": "normalized-image-pixels",
            "original": None,
            "normalized": {
                "sha256": None,
                "width": img.width,
                "height": img.height,
                "mode": img.mode,
            },
            "normalization": {
                "operation": "caller-supplied",
                "applied": None,
            },
        }
    return build_page_layout(
        segmentation,
        img,
        source=source,
        model_provenance=loaded.provenance,
        inference_config={
            "accelerator": config_values["accelerator"],
            "device": config_values["device"],
            "precision": config_values["precision"],
            "batchSize": config_values["batch_size"],
            "raiseOnError": config_values["raise_on_error"],
            "numThreads": config_values["num_threads"],
            "inputPadding": config_values["input_padding"],
            "textDirection": text_direction,
            "effective": _effective_inference_config(config),
        },
        process_mode=process_mode,
        execution_observation=execution_observation,
    )


def draw_overlay(corrected_bytes: bytes, layout: dict[str, Any]) -> bytes:
    """Draw native boundaries/bboxes and baselines without altering geometry."""
    img = Image.open(io.BytesIO(corrected_bytes))
    if img.mode != "RGB":
        img = img.convert("RGB")

    draw = ImageDraw.Draw(img)

    for line in layout["segmentation"]["lines"]:
        geometry = line["geometry"]
        if geometry["type"] == "baselines":
            boundary = geometry["boundary"]
            if boundary:
                points = [(point["x"], point["y"]) for point in boundary]
                draw.line(points + [points[0]], fill=(79, 110, 247), width=2)
            baseline = geometry["baseline"]
            if baseline and len(baseline) >= 2:
                draw.line(
                    [(point["x"], point["y"]) for point in baseline],
                    fill=(245, 158, 11),
                    width=2,
                )
        else:
            bbox = geometry["bbox"]
            if bbox:
                draw.rectangle(bbox, outline=(79, 110, 247), width=2)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def process_image_bytes(
    img_bytes: bytes,
    *,
    source_name: str | None = None,
    text_direction: str = "horizontal-lr",
) -> tuple[bytes, dict[str, Any]]:
    """Process raw image bytes through the Kraken segmentation pipeline.

    Returns ``(overlay_png_bytes, PageLayoutV2)``.
    """
    corrected_bytes, normalization = normalize_orientation_with_metadata(img_bytes)
    img = Image.open(io.BytesIO(corrected_bytes))
    if img.mode != "RGB":
        img = img.convert("RGB")

    source = {
        "name": source_name,
        "coordinateSpace": "normalized-image-pixels",
        "original": {
            **normalization["original"],
            "sha256": _sha256_bytes(img_bytes),
            "exifOrientation": normalization["originalExifOrientation"],
        },
        "normalized": {
            **normalization["normalized"],
            "sha256": _sha256_bytes(corrected_bytes),
            "format": "PNG",
        },
        "normalization": {
            "operation": normalization["operation"],
            "applied": normalization["applied"],
            "exifReadError": normalization["exifReadError"],
        },
    }
    layout = segment_image(
        img,
        source=source,
        text_direction=text_direction,
    )
    overlay_bytes = draw_overlay(corrected_bytes, layout)

    return overlay_bytes, layout


def find_lines(
    image_path: str | os.PathLike[str],
    *,
    text_direction: str = "horizontal-lr",
    process_mode: str = "one-shot",
) -> tuple[bytes, dict[str, Any]]:
    """Load an image and return normalized bytes plus native page layout.

    The name is retained for the existing local workflow.
    """
    with open(image_path, "rb") as f:
        img_bytes = f.read()
    corrected_bytes, normalization = normalize_orientation_with_metadata(img_bytes)
    img = Image.open(io.BytesIO(corrected_bytes))
    source = {
        "name": Path(image_path).name,
        "coordinateSpace": "normalized-image-pixels",
        "original": {
            **normalization["original"],
            "sha256": _sha256_bytes(img_bytes),
            "exifOrientation": normalization["originalExifOrientation"],
        },
        "normalized": {
            **normalization["normalized"],
            "sha256": _sha256_bytes(corrected_bytes),
            "format": "PNG",
        },
        "normalization": {
            "operation": normalization["operation"],
            "applied": normalization["applied"],
            "exifReadError": normalization["exifReadError"],
        },
    }
    layout = segment_image(
        img,
        source=source,
        text_direction=text_direction,
        process_mode=process_mode,
    )
    return corrected_bytes, layout


def _write_worker_message(message: dict[str, Any]) -> None:
    sys.stdout.write(
        json.dumps(
            message,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        + "\n"
    )
    sys.stdout.flush()


def _worker_request_id(value: Any) -> str | None:
    if not isinstance(value, dict):
        return None
    request_id = value.get("id")
    return request_id if isinstance(request_id, str) and request_id else None


def _parse_worker_detect_request(value: Any) -> tuple[str, str, str]:
    if not isinstance(value, dict):
        raise ValueError("Worker request must be a JSON object")
    unknown = set(value) - {"type", "id", "imagePath", "textDirection"}
    if unknown:
        raise ValueError(
            f"Worker request contains unknown fields: {sorted(unknown)!r}"
        )
    if value.get("type") != "detect":
        raise ValueError("Worker request type must be 'detect'")
    request_id = value.get("id")
    image_path = value.get("imagePath")
    text_direction = value.get("textDirection", "horizontal-lr")
    if not isinstance(request_id, str) or not request_id:
        raise ValueError("Worker request id must be a non-empty string")
    if not isinstance(image_path, str) or not image_path:
        raise ValueError("Worker imagePath must be a non-empty string")
    if text_direction not in TEXT_DIRECTIONS:
        raise ValueError(f"Unsupported text direction: {text_direction!r}")
    return request_id, image_path, text_direction


def run_native_json_worker() -> int:
    """Serve sequential line-detection requests over a strict NDJSON stream."""
    try:
        loaded = load_default_model()
    except Exception as error:
        _write_worker_message(
            {
                "type": "fatal",
                "protocol": WORKER_PROTOCOL,
                "version": WORKER_PROTOCOL_VERSION,
                "error": {
                    "type": type(error).__name__,
                    "message": str(error),
                },
            }
        )
        return 1

    _write_worker_message(
        {
            "type": "ready",
            "protocol": WORKER_PROTOCOL,
            "version": WORKER_PROTOCOL_VERSION,
            "model": loaded.provenance,
        }
    )

    for raw_line in sys.stdin:
        request: Any = None
        request_id: str | None = None
        try:
            request = json.loads(raw_line)
            request_id = _worker_request_id(request)
            if isinstance(request, dict) and request.get("type") == "shutdown":
                unknown = set(request) - {"type", "id"}
                if unknown:
                    raise ValueError(
                        "Shutdown request contains unknown fields: "
                        f"{sorted(unknown)!r}"
                    )
                if request_id is None:
                    raise ValueError(
                        "Shutdown request id must be a non-empty string"
                    )
                _write_worker_message(
                    {
                        "type": "stopped",
                        "id": request_id,
                        "protocol": WORKER_PROTOCOL,
                        "version": WORKER_PROTOCOL_VERSION,
                    }
                )
                return 0

            request_id, image_path, text_direction = (
                _parse_worker_detect_request(request)
            )
            _, layout = find_lines(
                image_path,
                text_direction=text_direction,
                process_mode="persistent-worker",
            )
            _write_worker_message(
                {
                    "type": "result",
                    "id": request_id,
                    "ok": True,
                    "layout": layout,
                }
            )
        except Exception as error:
            _write_worker_message(
                {
                    "type": "result",
                    "id": request_id,
                    "ok": False,
                    "error": {
                        "type": type(error).__name__,
                        "message": str(error),
                    },
                }
            )
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Detect text lines in an image using Kraken."
    )
    parser.add_argument("image", nargs="?", help="Path to the input image")
    parser.add_argument(
        "--output", "-o",
        help="Path to save overlay image (default: output/overlay.png)"
    )
    output_group = parser.add_mutually_exclusive_group()
    output_group.add_argument(
        "--native-json",
        action="store_true",
        help="Emit only the versioned native PageLayout JSON object",
    )
    output_group.add_argument(
        "--worker-native-json",
        action="store_true",
        help=(
            "Serve strict sequential native-layout requests over stdin/stdout "
            "using the versioned NDJSON worker protocol"
        ),
    )
    parser.add_argument(
        "--text-direction",
        choices=TEXT_DIRECTIONS,
        default="horizontal-lr",
        help="Principal page text direction (default: horizontal-lr)",
    )
    args = parser.parse_args()

    if args.worker_native_json:
        if args.image is not None:
            parser.error("--worker-native-json does not accept an image argument")
        raise SystemExit(run_native_json_worker())
    if args.image is None:
        parser.error("an image path is required outside worker mode")

    corrected_bytes, layout = find_lines(
        args.image,
        text_direction=args.text_direction,
    )

    if args.native_json:
        print(json.dumps(layout, ensure_ascii=False, sort_keys=True))
    else:
        output_path = args.output
        if output_path is None:
            script_dir = os.path.dirname(os.path.abspath(__file__))
            output_path = os.path.join(script_dir, "output", "overlay.png")

        output_parent = os.path.dirname(output_path)
        if output_parent:
            os.makedirs(output_parent, exist_ok=True)
        overlay_bytes = draw_overlay(corrected_bytes, layout)
        with open(output_path, "wb") as f:
            f.write(overlay_bytes)
        print(f"Overlay saved to: {output_path}")

        line_count = len(layout["segmentation"]["lines"])
        print(f"\nDetected {line_count} lines:\n")
        print(json.dumps(layout, ensure_ascii=False, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
