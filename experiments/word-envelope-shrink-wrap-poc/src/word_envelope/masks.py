"""Mask extraction, component inspection, cleanup operations, and safe crops."""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any, Iterable, Literal, Sequence

import numpy as np
from PIL import Image, ImageDraw
from skimage import filters, measure

from .engine import EnvelopeError, MAX_MASK_PIXELS
from .io_utils import (
    CLEANUP_SCHEMA_VERSION,
    CROP_SCHEMA_VERSION,
    check_rss,
    sha256_file,
    sha256_image_pixels,
    sha256_mask_pixels,
    write_json,
)


MaskPolarity = Literal["auto", "dark", "bright"]
MAX_CROP_PIXELS = 1_500_000
MAX_SOURCE_PIXELS_FOR_CROP = 50_000_000
MAX_COMPONENTS = 20_000
MAX_EXPORTED_COMPONENT_COORDINATES = 100_000


def load_mask(path: Path, *, polarity: MaskPolarity = "auto") -> np.ndarray:
    if polarity not in {"auto", "dark", "bright"}:
        raise EnvelopeError(f"Unknown mask polarity: {polarity}")
    with Image.open(path) as source:
        if source.width * source.height > MAX_MASK_PIXELS:
            raise EnvelopeError(
                f"Mask has {source.width * source.height} pixels; limit is "
                f"{MAX_MASK_PIXELS}"
            )
        grayscale = np.asarray(source.convert("L"), dtype=np.uint8)
    if grayscale.size > MAX_MASK_PIXELS:
        raise EnvelopeError(
            f"Mask has {grayscale.size} pixels; limit is {MAX_MASK_PIXELS}"
        )
    if grayscale.min() == grayscale.max():
        value = int(grayscale.min())
        if polarity == "dark":
            return np.full(grayscale.shape, value < 128, dtype=bool)
        if polarity == "bright":
            return np.full(grayscale.shape, value >= 128, dtype=bool)
        return np.full(grayscale.shape, value != 0, dtype=bool)
    threshold = float(filters.threshold_otsu(grayscale))
    dark = grayscale <= threshold
    bright = grayscale > threshold
    if polarity == "dark":
        return dark
    if polarity == "bright":
        return bright
    return dark if dark.sum() <= bright.sum() else bright


def save_mask(path: Path, mask: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image = Image.fromarray(np.asarray(mask, dtype=np.uint8) * 255, mode="L")
    image.save(path, format="PNG", compress_level=9, optimize=False)


def extract_ink_mask(
    image: Image.Image,
    *,
    window_size: int = 31,
    k: float = 0.16,
    offset: float = 0.0,
    minimum_component_area: int = 2,
) -> np.ndarray:
    if image.width * image.height > MAX_MASK_PIXELS:
        raise EnvelopeError(
            f"Extraction crop has {image.width * image.height} pixels; limit is "
            f"{MAX_MASK_PIXELS}"
        )
    if window_size < 3 or window_size % 2 == 0:
        raise EnvelopeError("Sauvola window size must be odd and at least 3")
    if not math.isfinite(k) or not math.isfinite(offset):
        raise EnvelopeError("Extraction parameters must be finite")
    grayscale = np.asarray(image.convert("L"), dtype=np.float64) / 255.0
    threshold = filters.threshold_sauvola(grayscale, window_size=window_size, k=k)
    mask = grayscale < (threshold + offset)
    if minimum_component_area > 1:
        labels, inventory = stable_components(mask)
        keep = {
            component["id"]
            for component in inventory
            if component["area_px"] >= minimum_component_area
        }
        mask = np.isin(labels, sorted(keep))
    return mask


def stable_components(
    mask: np.ndarray, *, include_pixels: bool = False
) -> tuple[np.ndarray, list[dict[str, Any]]]:
    binary = np.asarray(mask, dtype=bool)
    raw = measure.label(binary, connectivity=2)
    component_count = int(raw.max())
    if component_count > MAX_COMPONENTS:
        raise EnvelopeError(
            f"Mask has {component_count} components; inventory limit is "
            f"{MAX_COMPONENTS}"
        )
    if include_pixels and int(binary.sum()) > MAX_EXPORTED_COMPONENT_COORDINATES:
        raise EnvelopeError(
            f"Pixel-coordinate export would emit {int(binary.sum())} coordinates; "
            f"limit is {MAX_EXPORTED_COMPONENT_COORDINATES}"
        )
    components: list[dict[str, Any]] = []
    for region in measure.regionprops(raw):
        min_row, min_col, max_row, max_col = region.bbox
        coordinates = region.coords
        components.append(
            {
                "raw_label": int(region.label),
                "area_px": int(region.area),
                "bbox": {
                    "x": int(min_col),
                    "y": int(min_row),
                    "width": int(max_col - min_col),
                    "height": int(max_row - min_row),
                },
                "centroid": {
                    "x": round(float(region.centroid[1]), 3),
                    "y": round(float(region.centroid[0]), 3),
                },
                "anchor": {
                    "x": int(coordinates[0, 1]),
                    "y": int(coordinates[0, 0]),
                },
                "touches_border": bool(
                    min_row == 0
                    or min_col == 0
                    or max_row == binary.shape[0]
                    or max_col == binary.shape[1]
                ),
                "_coordinates": coordinates,
            }
        )
    components.sort(
        key=lambda component: (
            component["bbox"]["y"],
            component["bbox"]["x"],
            component["bbox"]["height"],
            component["bbox"]["width"],
            -component["area_px"],
        )
    )
    stable = np.zeros(raw.shape, dtype=np.int32)
    inventory: list[dict[str, Any]] = []
    for stable_id, component in enumerate(components, start=1):
        coordinates = component.pop("_coordinates")
        stable[coordinates[:, 0], coordinates[:, 1]] = stable_id
        component.pop("raw_label")
        component["id"] = stable_id
        if include_pixels:
            component["coordinates"] = [
                [int(column), int(row)] for row, column in coordinates
            ]
        inventory.append(component)
    return stable, inventory


def apply_cleanup_operations(
    raw_mask: np.ndarray, operations_record: dict[str, Any]
) -> tuple[np.ndarray, list[dict[str, Any]]]:
    if operations_record.get("schema_version") != CLEANUP_SCHEMA_VERSION:
        raise EnvelopeError(
            f"Cleanup schema must be {CLEANUP_SCHEMA_VERSION!r}"
        )
    operations = operations_record.get("operations")
    if not isinstance(operations, list):
        raise EnvelopeError("Cleanup record must contain an operations list")
    mask = np.asarray(raw_mask, dtype=bool).copy()
    log: list[dict[str, Any]] = []
    for index, operation in enumerate(operations):
        if not isinstance(operation, dict):
            raise EnvelopeError(f"Cleanup operation {index} must be an object")
        before_labels, before_inventory = stable_components(mask)
        before_pixels = int(mask.sum())
        before_hash = sha256_mask_pixels(mask)
        expected_hash = operation.get("expected_input_mask_pixel_sha256")
        if expected_hash is not None and expected_hash != before_hash:
            raise EnvelopeError(
                f"Cleanup operation {index} expected input mask {expected_hash}, "
                f"observed {before_hash}"
            )
        operation_type = operation.get("type")
        if operation_type in {"keep_components", "remove_components"}:
            ids = _component_ids(operation, before_inventory, index=index)
            selected = np.isin(before_labels, ids)
            mask = selected if operation_type == "keep_components" else mask & ~selected
        elif operation_type in {
            "positive_polygon",
            "negative_polygon",
            "restore_polygon",
        }:
            edit = _polygon_edit(mask.shape, operation.get("points"))
            mask = mask | edit if operation_type != "negative_polygon" else mask & ~edit
        elif operation_type in {
            "positive_scribble",
            "negative_scribble",
            "restore_scribble",
            "cut",
        }:
            edit = _scribble_edit(
                mask.shape,
                operation.get("points"),
                width=operation.get("width_px", 1),
            )
            mask = (
                mask | edit
                if operation_type in {"positive_scribble", "restore_scribble"}
                else mask & ~edit
            )
        else:
            raise EnvelopeError(
                f"Unsupported cleanup operation {operation_type!r} at index {index}"
            )
        _, after_inventory = stable_components(mask)
        log.append(
            {
                "index": index,
                "type": operation_type,
                "before_pixels": before_pixels,
                "after_pixels": int(mask.sum()),
                "input_mask_pixel_sha256": before_hash,
                "output_mask_pixel_sha256": sha256_mask_pixels(mask),
                "before_component_count": len(before_inventory),
                "after_component_count": len(after_inventory),
            }
        )
    return mask, log


def create_bounded_crop(
    source_path: Path,
    *,
    box_xywh: Sequence[int],
    padding: int,
    output_path: Path,
    metadata_path: Path,
    max_pixels: int = MAX_CROP_PIXELS,
) -> dict[str, Any]:
    """Create only an explicitly bounded sub-image and its exact translation."""

    if (
        isinstance(max_pixels, bool)
        or not isinstance(max_pixels, int)
        or max_pixels < 1
        or max_pixels > MAX_CROP_PIXELS
    ):
        raise EnvelopeError(
            f"max_pixels must be between 1 and {MAX_CROP_PIXELS}"
        )
    resolved_paths = {
        source_path.resolve(),
        output_path.resolve(),
        metadata_path.resolve(),
    }
    if len(resolved_paths) != 3:
        raise EnvelopeError("Source, crop output, and metadata paths must be distinct")
    if len(box_xywh) != 4:
        raise EnvelopeError("Crop box must be x y width height")
    x, y, width, height = (int(value) for value in box_xywh)
    if width <= 0 or height <= 0 or padding < 0:
        raise EnvelopeError("Crop dimensions must be positive and padding non-negative")
    source_hash = sha256_file(source_path)
    check_rss("before source crop")
    with Image.open(source_path) as source:
        source_width, source_height = source.size
        source_pixels = source_width * source_height
        if source_pixels > MAX_SOURCE_PIXELS_FOR_CROP:
            raise EnvelopeError(
                f"Source has {source_pixels} pixels; crop decode limit is "
                f"{MAX_SOURCE_PIXELS_FOR_CROP}"
            )
        check_rss(
            "before bounded source decode",
            reserve_bytes=source_pixels * 5,
        )
        left = max(0, x - padding)
        top = max(0, y - padding)
        right = min(source_width, x + width + padding)
        bottom = min(source_height, y + height + padding)
        crop_width = right - left
        crop_height = bottom - top
        if crop_width * crop_height > max_pixels:
            raise EnvelopeError(
                f"Requested crop has {crop_width * crop_height} pixels; "
                f"limit is {max_pixels}"
            )
        if left == 0 and top == 0 and right == source_width and bottom == source_height:
            raise EnvelopeError("Refusing to copy the full-resolution source image")
        crop = source.crop((left, top, right, bottom)).convert("RGB")
        check_rss("after source crop decode")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    crop.save(output_path, format="PNG", compress_level=9, optimize=False)
    record = {
        "schema_version": CROP_SCHEMA_VERSION,
        "source": {
            "path": str(source_path.resolve()),
            "sha256": source_hash,
            "width_px": source_width,
            "height_px": source_height,
        },
        "crop": {
            "path": str(output_path.resolve()),
            "sha256": sha256_file(output_path),
            "pixel_sha256": sha256_image_pixels(crop),
            "x": left,
            "y": top,
            "width_px": crop_width,
            "height_px": crop_height,
            "requested_box_xywh": [x, y, width, height],
            "padding_px": padding,
        },
        "transform": {
            "type": "crop-edge-translation-v1",
            "crop_to_source": {"translate_x": left, "translate_y": top},
            "source_to_crop": {"translate_x": -left, "translate_y": -top},
        },
    }
    write_json(metadata_path, record)
    check_rss("after crop save")
    return record


def _component_ids(
    operation: dict[str, Any],
    inventory: list[dict[str, Any]],
    *,
    index: int,
) -> list[int]:
    raw_ids = operation.get("ids")
    if not isinstance(raw_ids, list) or not raw_ids:
        raise EnvelopeError(f"Cleanup operation {index} requires non-empty ids")
    ids = [int(value) for value in raw_ids]
    if len(ids) != len(set(ids)):
        raise EnvelopeError(f"Cleanup operation {index} has duplicate component ids")
    available = {component["id"] for component in inventory}
    missing = sorted(set(ids) - available)
    if missing:
        raise EnvelopeError(
            f"Cleanup operation {index} refers to missing component ids {missing}"
        )
    return ids


def _polygon_edit(
    shape: tuple[int, int], points: Iterable[Sequence[float]] | None
) -> np.ndarray:
    values = _validated_points(points, minimum=3)
    image = Image.new("1", (shape[1], shape[0]), 0)
    ImageDraw.Draw(image).polygon(values, fill=1)
    return np.asarray(image, dtype=bool)


def _scribble_edit(
    shape: tuple[int, int],
    points: Iterable[Sequence[float]] | None,
    *,
    width: Any,
) -> np.ndarray:
    values = _validated_points(points, minimum=2)
    width_px = int(width)
    if width_px < 1 or width_px > min(shape):
        raise EnvelopeError("Scribble width is outside the mask bounds")
    image = Image.new("1", (shape[1], shape[0]), 0)
    draw = ImageDraw.Draw(image)
    draw.line(values, fill=1, width=width_px, joint="curve")
    radius = width_px / 2.0
    for x, y in (values[0], values[-1]):
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=1)
    return np.asarray(image, dtype=bool)


def _validated_points(
    points: Iterable[Sequence[float]] | None, *, minimum: int
) -> list[tuple[float, float]]:
    if points is None:
        raise EnvelopeError("Cleanup edit requires points")
    values = [(float(point[0]), float(point[1])) for point in points]
    if len(values) < minimum:
        raise EnvelopeError(f"Cleanup edit requires at least {minimum} points")
    if any(not math.isfinite(value) for point in values for value in point):
        raise EnvelopeError("Cleanup points must be finite")
    return values
