from __future__ import annotations

from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont


CLASS_COLORS = {
    "text": (0, 180, 255, 210),
    "marginalia": (255, 168, 0, 230),
    "foreign_page": (255, 40, 40, 230),
    "illustration": (178, 80, 255, 220),
    "background": (125, 125, 125, 180),
    "table": (0, 205, 120, 220),
    "header": (255, 90, 190, 220),
    "footer": (150, 80, 255, 220),
    "other": (255, 220, 40, 210),
}


def draw_overlay(
    prepared_path: Path, normalized: dict[str, Any], output_path: Path
) -> None:
    with Image.open(prepared_path) as source:
        image = source.convert("RGBA")
    draw = ImageDraw.Draw(image, "RGBA")
    width = max(2, round(max(image.size) / 900))
    font = ImageFont.load_default()

    _draw_polygon(
        draw,
        normalized["pageBoundary"],
        (0, 255, 115, 230),
        max(2, width + 1),
    )
    for region in normalized["regions"]:
        color = CLASS_COLORS.get(region["class"], CLASS_COLORS["other"])
        _draw_polygon(draw, region["boundary"], color, max(2, width))
        anchor = _anchor(region["boundary"])
        if anchor is not None:
            order = region.get("readingOrder")
            label = (
                f"R{order['index'] + 1}:{region['class']}"
                if order is not None
                else f"R:{region['class']}"
            )
            draw.text(anchor, label, fill=color, font=font, stroke_width=1)

    for line in normalized["lines"]:
        color = CLASS_COLORS.get(line["class"], CLASS_COLORS["text"])
        _draw_polygon(draw, line["boundary"], color, width)
        baseline = line.get("baseline")
        if baseline:
            draw.line(
                [(point["x"], point["y"]) for point in baseline],
                fill=(255, 40, 40, 235),
                width=max(2, width),
            )
        anchor = _anchor(line["boundary"])
        order = line.get("readingOrder")
        if anchor is not None and order is not None:
            draw.text(
                anchor,
                str(order["index"] + 1),
                fill=(255, 255, 255, 255),
                font=font,
                stroke_width=2,
                stroke_fill=(0, 0, 0, 220),
            )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    image.convert("RGB").save(
        output_path,
        format="PNG",
        compress_level=9,
        optimize=False,
        interlace=False,
    )


def _draw_polygon(
    draw: ImageDraw.ImageDraw,
    points: list[dict[str, int]],
    color: tuple[int, int, int, int],
    width: int,
) -> None:
    values = [(point["x"], point["y"]) for point in points]
    if len(values) < 2:
        return
    draw.line(values + [values[0]], fill=color, width=width, joint="curve")


def _anchor(points: list[dict[str, int]]) -> tuple[int, int] | None:
    if not points:
        return None
    return min((point["x"], point["y"]) for point in points)
