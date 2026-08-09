"""Deterministic Pillow diagnostics and bounded contact sheets."""

from __future__ import annotations

from pathlib import Path
from typing import Iterable, Sequence

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .engine import polygon_mask
from .masks import stable_components


COLORS = (
    (18, 145, 215),
    (231, 92, 62),
    (57, 168, 91),
    (155, 89, 182),
    (240, 174, 45),
    (33, 174, 170),
    (220, 84, 145),
    (116, 120, 126),
)
PANEL_WIDTH = 300
PANEL_HEIGHT = 190
HEADER_HEIGHT = 28
MAX_CONTACT_SHEET_ROWS = 32
MAX_CONTACT_SOURCE_PIXELS = 12_000_000
MAX_CONTACT_SHEET_PIXELS = 30_000_000


def save_component_overlay(
    path: Path, crop: Image.Image, raw_mask: np.ndarray
) -> list[dict[str, object]]:
    labels, inventory = stable_components(raw_mask)
    image = crop.convert("RGBA")
    overlay = np.zeros((image.height, image.width, 4), dtype=np.uint8)
    for component in inventory:
        component_id = int(component["id"])
        color = COLORS[(component_id - 1) % len(COLORS)]
        selected = labels == component_id
        overlay[selected, 0] = color[0]
        overlay[selected, 1] = color[1]
        overlay[selected, 2] = color[2]
        overlay[selected, 3] = 175
    image = Image.alpha_composite(image, Image.fromarray(overlay, mode="RGBA"))
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default()
    for component in inventory:
        bbox = component["bbox"]
        x = int(bbox["x"])
        y = max(0, int(bbox["y"]) - 10)
        label = str(component["id"])
        draw.text(
            (x, y),
            label,
            fill=(255, 255, 255, 255),
            font=font,
            stroke_width=2,
            stroke_fill=(0, 0, 0, 235),
        )
    _save_png(path, image.convert("RGB"))
    return inventory


def save_envelope_overlay(
    path: Path,
    crop: Image.Image,
    polygon: Sequence[Sequence[float]],
    *,
    color: tuple[int, int, int] = (0, 170, 230),
) -> None:
    image = crop.convert("RGBA")
    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    points = [(float(x), float(y)) for x, y in polygon]
    draw.polygon(points, fill=(*color, 70))
    draw.line(points, fill=(*color, 245), width=2, joint="curve")
    _save_png(path, Image.alpha_composite(image, layer).convert("RGB"))


def save_six_panel_comparison(
    path: Path,
    *,
    title: str,
    crop: Image.Image,
    raw_mask: np.ndarray,
    cleaned_mask: np.ndarray,
    polygon: Sequence[Sequence[float]] | None,
    rough_box: Sequence[float],
) -> None:
    original = crop.convert("RGB")
    rough = original.copy()
    rough_draw = ImageDraw.Draw(rough)
    x, y, width, height = (float(value) for value in rough_box)
    rough_draw.rectangle(
        (x, y, x + width, y + height),
        outline=(235, 60, 45),
        width=3,
    )

    component_path = path.with_name(path.stem + ".components.tmp.png")
    save_component_overlay(component_path, original, raw_mask)
    with Image.open(component_path) as component_source:
        components = component_source.convert("RGB")
    component_path.unlink()

    cleaned = _mask_panel(cleaned_mask)
    wrapped = (
        _wrapped_panel(cleaned_mask, polygon)
        if polygon is not None
        else _failure_panel(original.size)
    )
    final = (
        _overlay_image(original, polygon)
        if polygon is not None
        else _failure_panel(original.size)
    )
    panels = [original, rough, components, cleaned, wrapped, final]
    labels = [
        "Original crop",
        "Rough region",
        "Numbered raw components",
        "Cleaned ink",
        "Final envelope",
        "Final overlay",
    ]
    row = Image.new(
        "RGB",
        (PANEL_WIDTH * len(panels), HEADER_HEIGHT + PANEL_HEIGHT),
        (250, 249, 246),
    )
    for index, (panel, label) in enumerate(zip(panels, labels)):
        row.paste(_fit_panel(panel), (index * PANEL_WIDTH, HEADER_HEIGHT))
        _center_text(row, label, index * PANEL_WIDTH, PANEL_WIDTH, 7)
    titled = Image.new("RGB", (row.width, row.height + 24), (235, 233, 228))
    titled.paste(row, (0, 24))
    ImageDraw.Draw(titled).text((8, 6), title, fill=(25, 25, 25), font=ImageFont.load_default())
    _save_png(path, titled)


def save_method_comparison(
    path: Path,
    *,
    title: str,
    crop: Image.Image,
    method_polygons: Iterable[
        tuple[str, Sequence[Sequence[float]] | None]
    ],
) -> None:
    values = [("Original", crop.convert("RGB"))]
    for label, polygon in method_polygons:
        values.append(
            (
                label,
                _overlay_image(crop.convert("RGB"), polygon)
                if polygon is not None
                else _failure_panel(crop.size),
            )
        )
    width = PANEL_WIDTH * len(values)
    sheet = Image.new("RGB", (width, 24 + HEADER_HEIGHT + PANEL_HEIGHT), (242, 241, 237))
    ImageDraw.Draw(sheet).text((8, 6), title, fill=(20, 20, 20), font=ImageFont.load_default())
    for index, (label, panel) in enumerate(values):
        _center_text(sheet, label, index * PANEL_WIDTH, PANEL_WIDTH, 24 + 7)
        sheet.paste(_fit_panel(panel), (index * PANEL_WIDTH, 24 + HEADER_HEIGHT))
    _save_png(path, sheet)


def save_contact_sheet(
    path: Path,
    rows: Iterable[tuple[str, Path]],
    *,
    maximum_row_width: int = 1800,
) -> None:
    row_values = list(rows)
    if len(row_values) > MAX_CONTACT_SHEET_ROWS:
        raise ValueError(
            f"Contact sheet has {len(row_values)} rows; limit is "
            f"{MAX_CONTACT_SHEET_ROWS}"
        )
    if maximum_row_width < 1:
        raise ValueError("maximum_row_width must be positive")
    row_specs: list[tuple[str, Path, int, int]] = []
    target_width = 0
    target_height = 0
    for label, row_path in row_values:
        with Image.open(row_path) as source:
            if source.width * source.height > MAX_CONTACT_SOURCE_PIXELS:
                raise ValueError(f"Contact-sheet source {row_path} is too large")
            width, height = source.size
        if width > maximum_row_width:
            height = max(1, round(height * maximum_row_width / width))
            width = maximum_row_width
        row_specs.append((label, row_path, width, height))
        target_width = max(target_width, width)
        target_height += height + 22
        if target_width * target_height > MAX_CONTACT_SHEET_PIXELS:
            raise ValueError(
                f"Contact sheet would use {target_width * target_height} pixels; "
                f"limit is {MAX_CONTACT_SHEET_PIXELS}"
            )
    if not row_specs:
        raise ValueError("At least one comparison row is required")

    rendered: list[Image.Image] = []
    for label, row_path, width, height in row_specs:
        with Image.open(row_path) as source:
            row = source.convert("RGB")
        if row.size != (width, height):
            row = row.resize((width, height), Image.Resampling.LANCZOS)
        header = Image.new("RGB", (row.width, 22), (220, 218, 212))
        ImageDraw.Draw(header).text((8, 5), label, fill=(15, 15, 15), font=ImageFont.load_default())
        combined = Image.new("RGB", (row.width, row.height + header.height), (255, 255, 255))
        combined.paste(header, (0, 0))
        combined.paste(row, (0, header.height))
        rendered.append(combined)
    width = max(image.width for image in rendered)
    height = sum(image.height for image in rendered)
    sheet = Image.new("RGB", (width, height), (255, 255, 255))
    offset = 0
    for image in rendered:
        sheet.paste(image, (0, offset))
        offset += image.height
    _save_png(path, sheet)


def _mask_panel(mask: np.ndarray) -> Image.Image:
    canvas = np.full((*mask.shape, 3), 250, dtype=np.uint8)
    canvas[np.asarray(mask, dtype=bool)] = (25, 25, 28)
    return Image.fromarray(canvas, mode="RGB")


def _failure_panel(size: tuple[int, int]) -> Image.Image:
    panel = Image.new("RGB", size, (244, 238, 235))
    draw = ImageDraw.Draw(panel)
    font = ImageFont.load_default()
    message = "No valid polygon\n(disconnected or unsafe)"
    bbox = draw.multiline_textbbox((0, 0), message, font=font, align="center")
    x = (size[0] - (bbox[2] - bbox[0])) // 2
    y = (size[1] - (bbox[3] - bbox[1])) // 2
    draw.multiline_text((x, y), message, fill=(145, 48, 38), font=font, align="center")
    return panel


def _wrapped_panel(
    cleaned_mask: np.ndarray, polygon: Sequence[Sequence[float]]
) -> Image.Image:
    panel = _mask_panel(cleaned_mask).convert("RGBA")
    layer = Image.new("RGBA", panel.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    points = [(float(x), float(y)) for x, y in polygon]
    draw.polygon(points, fill=(0, 170, 230, 58))
    draw.line(points, fill=(0, 145, 210, 255), width=2, joint="curve")
    return Image.alpha_composite(panel, layer).convert("RGB")


def _overlay_image(
    crop: Image.Image, polygon: Sequence[Sequence[float]]
) -> Image.Image:
    image = crop.convert("RGBA")
    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    points = [(float(x), float(y)) for x, y in polygon]
    draw.polygon(points, fill=(0, 170, 230, 68))
    draw.line(points, fill=(0, 145, 210, 250), width=2, joint="curve")
    return Image.alpha_composite(image, layer).convert("RGB")


def _fit_panel(image: Image.Image) -> Image.Image:
    copy = image.convert("RGB")
    copy.thumbnail((PANEL_WIDTH - 12, PANEL_HEIGHT - 12), Image.Resampling.LANCZOS)
    panel = Image.new("RGB", (PANEL_WIDTH, PANEL_HEIGHT), (245, 244, 240))
    x = (PANEL_WIDTH - copy.width) // 2
    y = (PANEL_HEIGHT - copy.height) // 2
    panel.paste(copy, (x, y))
    return panel


def _center_text(image: Image.Image, text: str, x: int, width: int, y: int) -> None:
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default()
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    draw.text((x + (width - text_width) // 2, y), text, fill=(30, 30, 30), font=font)


def _save_png(path: Path, image: Image.Image) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format="PNG", compress_level=9, optimize=False, interlace=False)
