#!/usr/bin/env python3
"""Render human-readable alignment comparisons and crop evidence."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont


BLUE = (25, 118, 210, 235)
GREEN = (18, 150, 92, 235)
ORANGE = (237, 129, 25, 235)
RED = (210, 55, 70, 235)
INK = (28, 28, 30, 255)
MUTED = (90, 90, 96, 255)
PAPER = (250, 248, 243, 255)


def load_font(size: int, *, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = (
        "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
        if bold
        else "/System/Library/Fonts/Supplemental/Arial.ttf",
    )
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            continue
    return ImageFont.load_default()


def legacy_lines(layout: dict[str, Any]) -> list[dict[str, Any]]:
    return sorted(
        layout["lines"],
        key=lambda line: (
            (line.get("readingOrder") or {}).get("index", 2**63),
            line["id"],
        ),
    )


def polygon(line: dict[str, Any]) -> list[tuple[float, float]]:
    return [(float(point["x"]), float(point["y"])) for point in line["boundary"]]


def label_anchor(line: dict[str, Any]) -> tuple[float, float]:
    points = polygon(line)
    return min(point[0] for point in points), min(point[1] for point in points)


def wrap_text(
    draw: ImageDraw.ImageDraw,
    value: str,
    font: ImageFont.ImageFont,
    maximum_width: int,
) -> list[str]:
    words = value.split()
    if not words:
        return [""]
    lines: list[str] = []
    current = words[0]
    for word in words[1:]:
        proposed = f"{current} {word}"
        if draw.textlength(proposed, font=font) <= maximum_width:
            current = proposed
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines


def scaled_page(
    image: Image.Image,
    width: int,
) -> tuple[Image.Image, float]:
    scale = width / image.width
    return image.resize(
        (width, round(image.height * scale)),
        Image.Resampling.LANCZOS,
    ), scale


def draw_mapping_panel(
    image: Image.Image,
    layout_lines: list[dict[str, Any]],
    mapping_by_segment: dict[str, list[dict[str, Any]]],
    *,
    title: str,
    subtitle: str,
    positional: bool,
    transcript_lines: list[dict[str, Any]],
    skipped_ids: set[str],
    panel_width: int = 1000,
) -> Image.Image:
    page, scale = scaled_page(image, panel_width)
    header_height = 120
    panel = Image.new("RGBA", (panel_width, page.height + header_height), PAPER)
    panel.alpha_composite(page.convert("RGBA"), (0, header_height))
    draw = ImageDraw.Draw(panel, "RGBA")
    title_font = load_font(32, bold=True)
    subtitle_font = load_font(21)
    label_font = load_font(22, bold=True)
    draw.text((24, 18), title, font=title_font, fill=INK)
    draw.text((24, 64), subtitle, font=subtitle_font, fill=MUTED)

    for index, line in enumerate(layout_lines):
        segment_id = line["id"]
        if positional:
            mapped = [transcript_lines[index]] if index < len(transcript_lines) else []
            color = BLUE if mapped else ORANGE
            label = (
                f"T{mapped[0]['sourceLineNumber']:02d}"
                if mapped
                else "extra"
            )
        else:
            mapped = mapping_by_segment.get(segment_id, [])
            if mapped:
                accepted = all(item["status"] == "accepted" for item in mapped)
                color = GREEN if accepted else BLUE
                label = "/".join(
                    f"T{item['sourceLineNumber']:02d}"
                    for item in mapped
                )
            elif segment_id in skipped_ids:
                color = ORANGE
                label = "skip"
            else:
                color = RED
                label = "?"
        points = [
            (round(x * scale), round(y * scale) + header_height)
            for x, y in polygon(line)
        ]
        if len(points) >= 2:
            draw.line(points + [points[0]], fill=color, width=4, joint="curve")
        anchor_x, anchor_y = label_anchor(line)
        position = (
            round(anchor_x * scale),
            round(anchor_y * scale) + header_height - 25,
        )
        text_box = draw.textbbox(position, label, font=label_font)
        draw.rounded_rectangle(
            (
                text_box[0] - 3,
                text_box[1] - 2,
                text_box[2] + 3,
                text_box[3] + 2,
            ),
            radius=4,
            fill=(255, 255, 255, 210),
        )
        draw.text(position, label, font=label_font, fill=color)
    return panel.convert("RGB")


def render_comparison(
    *,
    image: Image.Image,
    layout: dict[str, Any],
    alignment: dict[str, Any],
    transcript_lines: list[dict[str, Any]],
    output_path: Path,
) -> None:
    lines = legacy_lines(layout)
    mapping_by_segment: dict[str, list[dict[str, Any]]] = {}
    for mapping in alignment["mappings"]:
        for segment_id in mapping["segmentIds"]:
            mapping_by_segment.setdefault(segment_id, []).append(mapping)
    skipped_ids = set(alignment["skippedSegmentIds"])
    positional = draw_mapping_panel(
        image,
        lines,
        mapping_by_segment,
        title="Current positional assignment",
        subtitle="First transcript line starts at first Kraken detection",
        positional=True,
        transcript_lines=transcript_lines,
        skipped_ids=skipped_ids,
    )
    content_aware = draw_mapping_panel(
        image,
        lines,
        mapping_by_segment,
        title="Content-aware assignment",
        subtitle="Noisy handwriting fingerprints + geometry-aware flow repair",
        positional=False,
        transcript_lines=transcript_lines,
        skipped_ids=skipped_ids,
    )
    gutter = 24
    output = Image.new(
        "RGB",
        (positional.width + content_aware.width + gutter, positional.height),
        PAPER[:3],
    )
    output.paste(positional, (0, 0))
    output.paste(content_aware, (positional.width + gutter, 0))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output.save(output_path, format="PNG", optimize=True)


def union_bounds(
    line_by_id: dict[str, dict[str, Any]],
    segment_ids: list[str],
) -> tuple[int, int, int, int] | None:
    points = [
        point
        for segment_id in segment_ids
        for point in polygon(line_by_id[segment_id])
    ]
    if not points:
        return None
    return (
        math.floor(min(point[0] for point in points)),
        math.floor(min(point[1] for point in points)),
        math.ceil(max(point[0] for point in points)),
        math.ceil(max(point[1] for point in points)),
    )


def render_crop_sheet(
    *,
    image: Image.Image,
    layout: dict[str, Any],
    alignment: dict[str, Any],
    recognition: dict[str, Any],
    output_path: Path,
) -> None:
    line_by_id = {line["id"]: line for line in legacy_lines(layout)}
    recognized_by_id = {
        record["segmentId"]: record for record in recognition["records"]
    }
    width = 1200
    crop_height = 150
    text_height = 130
    row_height = crop_height + text_height + 20
    mappings = alignment["mappings"]
    sheet = Image.new("RGB", (width, row_height * len(mappings)), PAPER[:3])
    draw = ImageDraw.Draw(sheet)
    heading_font = load_font(26, bold=True)
    body_font = load_font(23)
    small_font = load_font(20)

    for row_index, mapping in enumerate(mappings):
        top = row_index * row_height
        bounds = union_bounds(line_by_id, mapping["segmentIds"])
        if bounds:
            padding_x = 45
            padding_y = 35
            crop_box = (
                max(0, bounds[0] - padding_x),
                max(0, bounds[1] - padding_y),
                min(image.width, bounds[2] + padding_x),
                min(image.height, bounds[3] + padding_y),
            )
            crop = image.crop(crop_box)
            scale = min(width / crop.width, crop_height / crop.height)
            resized = crop.resize(
                (round(crop.width * scale), round(crop.height * scale)),
                Image.Resampling.LANCZOS,
            )
            sheet.paste(
                resized,
                ((width - resized.width) // 2, top + (crop_height - resized.height) // 2),
            )
        else:
            draw.rectangle((0, top, width, top + crop_height), fill=(235, 231, 222))
            draw.text(
                (30, top + 50),
                "No detected image line",
                font=heading_font,
                fill=RED,
            )

        status_color = (
            GREEN if mapping["status"] == "accepted"
            else ORANGE if mapping["status"] == "ambiguous"
            else RED
        )
        heading = (
            f"Source line {mapping['sourceLineNumber']} · "
            f"{mapping['operation']} · {mapping['status']} · "
            f"similarity {mapping['similarity']:.2f}"
        )
        draw.text(
            (24, top + crop_height + 10),
            heading,
            font=heading_font,
            fill=status_color,
        )
        transcript = "Transcript: " + mapping["transcriptText"].strip()
        rough = "Kraken: " + " / ".join(
            recognized_by_id[segment_id]["text"]
            for segment_id in mapping["segmentIds"]
        )
        text_y = top + crop_height + 48
        for text_value, font, fill in (
            (transcript, body_font, INK),
            (rough, small_font, MUTED),
        ):
            wrapped = wrap_text(draw, text_value, font, width - 48)
            for line in wrapped[:2]:
                draw.text((24, text_y), line, font=font, fill=fill)
                text_y += 28
        draw.line(
            (0, top + row_height - 1, width, top + row_height - 1),
            fill=(205, 200, 190),
            width=1,
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output_path, format="PNG", optimize=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True, type=Path)
    parser.add_argument("--layout", required=True, type=Path)
    parser.add_argument("--alignment", required=True, type=Path)
    parser.add_argument("--recognition", required=True, type=Path)
    parser.add_argument("--snapshot", required=True, type=Path)
    parser.add_argument("--letter", required=True)
    parser.add_argument("--comparison-output", required=True, type=Path)
    parser.add_argument("--crops-output", required=True, type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    layout = json.loads(args.layout.read_text(encoding="utf-8"))
    alignment = json.loads(args.alignment.read_text(encoding="utf-8"))
    recognition = json.loads(args.recognition.read_text(encoding="utf-8"))
    snapshot = json.loads(args.snapshot.read_text(encoding="utf-8"))
    letter = next(
        value for value in snapshot["letters"]
        if value["letterKey"] == args.letter
    )
    page_key = recognition["pageKey"]
    page = next(
        value for value in letter["pages"]
        if value["pageKey"] == page_key
    )
    transcript_lines = [
        line for line in page["transcript"]["lines"]
        if line["alignable"]
    ]
    page_segment_ids = {line["id"] for line in legacy_lines(layout)}
    page_alignment = {
        **alignment,
        "mappings": [
            mapping for mapping in alignment["mappings"]
            if mapping.get("pageKey") == page_key
            or any(
                segment_id in page_segment_ids
                for segment_id in mapping["segmentIds"]
            )
        ],
        "skippedSegmentIds": [
            segment_id for segment_id in alignment["skippedSegmentIds"]
            if segment_id in page_segment_ids
        ],
    }
    with Image.open(args.image) as source:
        image = source.convert("RGB")
    render_comparison(
        image=image,
        layout=layout,
        alignment=page_alignment,
        transcript_lines=transcript_lines,
        output_path=args.comparison_output,
    )
    render_crop_sheet(
        image=image,
        layout=layout,
        alignment=page_alignment,
        recognition=recognition,
        output_path=args.crops_output,
    )
    print(
        json.dumps(
            {
                "comparison": str(args.comparison_output),
                "crops": str(args.crops_output),
            },
        ),
    )


if __name__ == "__main__":
    main()
