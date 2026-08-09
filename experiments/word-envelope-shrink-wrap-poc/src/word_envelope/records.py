"""Versioned experiment records and per-example artifact generation."""

from __future__ import annotations

import os
import platform
import tempfile
from pathlib import Path
from typing import Any

import numpy as np
import PIL
import scipy
import shapely
import skimage
from PIL import Image

from .engine import (
    EnvelopeError,
    EnvelopeParams,
    MAX_MASK_PIXELS,
    Method,
    map_polygon_from_source,
    map_polygon_to_source,
    wrap_envelope,
)
from .io_utils import (
    CLEANUP_SCHEMA_VERSION,
    CROP_SCHEMA_VERSION,
    SCHEMA_VERSION,
    check_rss,
    read_json,
    sha256_file,
    sha256_image_pixels,
    sha256_mask_pixels,
    write_json,
)
from .masks import apply_cleanup_operations, load_mask, stable_components
from .render import save_envelope_overlay, save_six_panel_comparison


POLYGON_SCHEMA_VERSION = "word-envelope-polygon.v1"
MAX_SOURCE_PIXELS_FOR_PROVENANCE = 50_000_000
RESULT_STATE_FILES = (
    "comparison.png",
    "diagnostic.json",
    "failure.json",
    "method-comparison.png",
    "overlay.png",
    "polygon.crop.json",
    "polygon.source.json",
    "wrap-summary.json",
)


def build_example(
    *,
    example_id: str,
    crop_path: Path,
    raw_mask_path: Path,
    cleaned_mask_path: Path,
    metadata_path: Path,
    operations_path: Path | None,
    excluded_mask_path: Path | None,
    params: EnvelopeParams,
    method: Method,
    output_dir: Path,
    rough_box: tuple[float, float, float, float] | None = None,
    assessment_status: str = "unreviewed",
    assessment_notes: str = "",
) -> dict[str, Any]:
    """Build one deterministic result plus human-readable images."""

    reset_result_dir(output_dir)
    check_rss(f"before {example_id}:{method}")
    crop_metadata = read_json(metadata_path)
    if crop_metadata.get("schema_version") != CROP_SCHEMA_VERSION:
        raise EnvelopeError(f"Crop metadata must use {CROP_SCHEMA_VERSION}")
    crop_record = crop_metadata["crop"]
    with Image.open(crop_path) as source:
        if source.width * source.height > MAX_MASK_PIXELS:
            raise EnvelopeError(
                f"Crop has {source.width * source.height} pixels; limit is "
                f"{MAX_MASK_PIXELS}"
            )
        if (source.width, source.height) != (
            int(crop_record["width_px"]),
            int(crop_record["height_px"]),
        ):
            raise EnvelopeError("Crop dimensions do not match crop metadata")
        crop = source.convert("RGB")
    actual_crop_hash = sha256_file(crop_path)
    recorded_crop_hash = crop_metadata["crop"].get("sha256")
    if recorded_crop_hash is not None and actual_crop_hash != recorded_crop_hash:
        raise EnvelopeError(
            f"Crop hash mismatch: metadata has {recorded_crop_hash}, observed "
            f"{actual_crop_hash}"
        )
    recorded_pixel_hash = crop_record.get("pixel_sha256")
    actual_pixel_hash = sha256_image_pixels(crop)
    if recorded_pixel_hash is not None and actual_pixel_hash != recorded_pixel_hash:
        raise EnvelopeError("Decoded crop pixel hash does not match crop metadata")
    crop_x = float(crop_record["x"])
    crop_y = float(crop_record["y"])
    if not crop_x.is_integer() or not crop_y.is_integer():
        raise EnvelopeError("Raster crop origin must use integer pixel coordinates")

    source_record = crop_metadata["source"]
    source_path = Path(source_record["path"])
    if not source_path.exists():
        raise EnvelopeError(f"Recorded source image does not exist: {source_path}")
    actual_source_hash = sha256_file(source_path)
    if actual_source_hash != source_record["sha256"]:
        raise EnvelopeError(
            f"Source hash mismatch: metadata has {source_record['sha256']}, "
            f"observed {actual_source_hash}"
        )
    with Image.open(source_path) as source_image:
        if (source_image.width, source_image.height) != (
            int(source_record["width_px"]),
            int(source_record["height_px"]),
        ):
            raise EnvelopeError("Source dimensions do not match source metadata")
        if (
            crop_x < 0
            or crop_y < 0
            or crop_x + crop.width > source_image.width
            or crop_y + crop.height > source_image.height
        ):
            raise EnvelopeError("Crop coordinates fall outside source dimensions")
        source_pixels = source_image.width * source_image.height
        if source_pixels > MAX_SOURCE_PIXELS_FOR_PROVENANCE:
            raise EnvelopeError(
                f"Source has {source_pixels} pixels; provenance decode limit is "
                f"{MAX_SOURCE_PIXELS_FOR_PROVENANCE}"
            )
        check_rss(
            f"before source provenance decode for {example_id}",
            reserve_bytes=source_pixels * 5,
        )
        source_region = source_image.crop(
            (
                int(crop_x),
                int(crop_y),
                int(crop_x) + crop.width,
                int(crop_y) + crop.height,
            )
        ).convert("RGB")
    if sha256_image_pixels(source_region) != actual_pixel_hash:
        raise EnvelopeError("Crop pixels do not match the recorded source region")
    metadata_transform = crop_metadata.get("transform")
    if metadata_transform is not None:
        forward = metadata_transform.get("crop_to_source", {})
        reverse = metadata_transform.get("source_to_crop", {})
        if (
            float(forward.get("translate_x", crop_x)) != crop_x
            or float(forward.get("translate_y", crop_y)) != crop_y
            or float(reverse.get("translate_x", -crop_x)) != -crop_x
            or float(reverse.get("translate_y", -crop_y)) != -crop_y
        ):
            raise EnvelopeError("Crop translation metadata is inconsistent")
    raw_mask = load_mask(raw_mask_path, polarity="bright")
    cleaned_mask = load_mask(cleaned_mask_path, polarity="bright")
    expected_shape = (crop.height, crop.width)
    if raw_mask.shape != expected_shape or cleaned_mask.shape != expected_shape:
        raise EnvelopeError(
            f"Crop is {expected_shape}, raw mask is {raw_mask.shape}, and cleaned "
            f"mask is {cleaned_mask.shape}"
        )
    excluded = (
        load_mask(excluded_mask_path, polarity="bright")
        if excluded_mask_path is not None
        else np.zeros(expected_shape, dtype=bool)
    )
    if excluded.shape != expected_shape:
        raise EnvelopeError("Excluded mask dimensions do not match the crop")

    if operations_path is None and sha256_mask_pixels(raw_mask) != sha256_mask_pixels(
        cleaned_mask
    ):
        raise EnvelopeError(
            "Raw and cleaned masks differ but no cleanup operations were supplied"
        )

    operations: dict[str, Any] = {
        "schema_version": CLEANUP_SCHEMA_VERSION,
        "operations": [],
    }
    cleanup_log: list[dict[str, Any]] = []
    if operations_path is not None:
        operations = read_json(operations_path)
        replayed, cleanup_log = apply_cleanup_operations(raw_mask, operations)
        if sha256_mask_pixels(replayed) != sha256_mask_pixels(cleaned_mask):
            raise EnvelopeError(
                "Replaying cleanup operations does not reproduce the cleaned mask"
            )

    if rough_box is None:
        rough_box = (0.0, 0.0, float(crop.width), float(crop.height))
    result = wrap_envelope(
        cleaned_mask,
        params,
        method=method,
        excluded_mask=excluded,
        rough_box=rough_box,
        allowed_polygon=crop_metadata.get("allowed_boundary_crop"),
    )
    source_polygon = map_polygon_to_source(
        result.polygon, crop_x=crop_x, crop_y=crop_y
    )
    round_trip = map_polygon_from_source(
        source_polygon, crop_x=crop_x, crop_y=crop_y
    )
    round_trip_error = max(
        max(abs(first[0] - second[0]), abs(first[1] - second[1]))
        for first, second in zip(result.polygon, round_trip)
    )
    if round_trip_error > 1.0:
        raise EnvelopeError(
            f"Crop/source coordinate round trip error is {round_trip_error:.3f} px"
        )

    crop_polygon_record = {
        "schema_version": POLYGON_SCHEMA_VERSION,
        "coordinate_space": "crop-pixel-edges-xy",
        "method": method,
        "polygon": [[x, y] for x, y in result.polygon],
        "polygon_sha256": result.polygon_checksum,
    }
    source_polygon_record = {
        "schema_version": POLYGON_SCHEMA_VERSION,
        "coordinate_space": "source-pixel-edges-xy",
        "method": method,
        "crop_origin": {"x": crop_x, "y": crop_y},
        "polygon": [[x, y] for x, y in source_polygon],
        "crop_polygon_sha256": result.polygon_checksum,
    }
    raw_labels, raw_inventory = stable_components(raw_mask)
    del raw_labels
    cleaned_labels, cleaned_inventory = stable_components(cleaned_mask)
    del cleaned_labels
    diagnostic = {
        "schema_version": SCHEMA_VERSION,
        "example_id": example_id,
        "inputs": {
            "source": crop_metadata["source"],
            "crop": {
                **crop_record,
                "path": str(crop_path.resolve()),
                "sha256": actual_crop_hash,
            },
            "raw_mask": _mask_record(raw_mask_path, raw_mask),
            "cleaned_mask": _mask_record(cleaned_mask_path, cleaned_mask),
            "excluded_mask": (
                _mask_record(excluded_mask_path, excluded)
                if excluded_mask_path is not None
                else None
            ),
        },
        "coordinate_transform": {
            "convention": "continuous pixel-edge XY; pixel centers are x+0.5,y+0.5",
            "crop_to_source_affine_3x3": [
                [1.0, 0.0, crop_x],
                [0.0, 1.0, crop_y],
                [0.0, 0.0, 1.0],
            ],
            "source_to_crop_affine_3x3": [
                [1.0, 0.0, -crop_x],
                [0.0, 1.0, -crop_y],
                [0.0, 0.0, 1.0],
            ],
            "maximum_round_trip_error_px": round(round_trip_error, 6),
            "allowed_boundary_crop": crop_metadata.get("allowed_boundary_crop"),
        },
        "rough_region_crop_xywh": list(rough_box),
        "components": {
            "raw": raw_inventory,
            "cleaned": cleaned_inventory,
        },
        "cleanup": {
            "semantic_cleanup_required": bool(
                sha256_mask_pixels(raw_mask) != sha256_mask_pixels(cleaned_mask)
            ),
            "operations_path": (
                str(operations_path.resolve()) if operations_path is not None else None
            ),
            "operations": operations["operations"],
            "replay_log": cleanup_log,
        },
        "wrap": {
            "parameters": params.as_record(),
            "result": result.as_record(),
            "polygon_crop": crop_polygon_record["polygon"],
            "polygon_source": source_polygon_record["polygon"],
        },
        "assessment": {
            "status": assessment_status,
            "notes": assessment_notes,
        },
        "runtime": _runtime_record(),
    }
    try:
        with tempfile.TemporaryDirectory(
            prefix=f".{output_dir.name}-staging-",
            dir=output_dir.parent,
        ) as temporary:
            staging = Path(temporary)
            write_json(staging / "polygon.crop.json", crop_polygon_record)
            write_json(staging / "polygon.source.json", source_polygon_record)
            write_json(staging / "diagnostic.json", diagnostic)
            save_envelope_overlay(staging / "overlay.png", crop, result.polygon)
            save_six_panel_comparison(
                staging / "comparison.png",
                title=f"{example_id} - {method}",
                crop=crop,
                raw_mask=raw_mask,
                cleaned_mask=cleaned_mask,
                polygon=result.polygon,
                rough_box=rough_box,
            )
            check_rss(f"after staged {example_id}:{method}")
            for name in (
                "comparison.png",
                "overlay.png",
                "polygon.crop.json",
                "polygon.source.json",
                "diagnostic.json",
            ):
                os.replace(staging / name, output_dir / name)
    except Exception:
        reset_result_dir(output_dir)
        raise
    return diagnostic


def reset_result_dir(output_dir: Path) -> None:
    """Remove only this tool's known current-state files before a new attempt."""

    output_dir.mkdir(parents=True, exist_ok=True)
    for name in RESULT_STATE_FILES:
        (output_dir / name).unlink(missing_ok=True)


def _mask_record(path: Path, mask: np.ndarray) -> dict[str, Any]:
    return {
        "encoding": "black-background-white-ink",
        "polarity": "bright",
        "path": str(path.resolve()),
        "sha256": sha256_file(path),
        "pixel_sha256": sha256_mask_pixels(mask),
        "width_px": int(mask.shape[1]),
        "height_px": int(mask.shape[0]),
        "ink_pixels": int(mask.sum()),
    }


def _runtime_record() -> dict[str, str]:
    return {
        "python": platform.python_version(),
        "numpy": np.__version__,
        "Pillow": PIL.__version__,
        "scipy": scipy.__version__,
        "scikit_image": skimage.__version__,
        "shapely": shapely.__version__,
        "geos": shapely.geos_version_string,
    }
