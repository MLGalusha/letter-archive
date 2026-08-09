#!/usr/bin/env python3
"""Build a hash-bound Set-of-Mark review for one selected word draft."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from word_envelope.io_utils import canonical_json_bytes, sha256_file  # noqa: E402
from word_envelope.simple_page_agent import _hash_record  # noqa: E402


COLORS = (
    (230, 76, 60),
    (36, 152, 214),
    (34, 170, 95),
    (220, 145, 35),
    (148, 92, 190),
    (0, 160, 170),
)


def _read(path: Path) -> dict:
    value = json.loads(path.read_text("utf-8"))
    if not isinstance(value, dict):
        raise SystemExit(f"Expected object: {path}")
    return value


def _font(size: int) -> ImageFont.ImageFont:
    for candidate in (
        "/System/Library/Fonts/SFNS.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ):
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            pass
    return ImageFont.load_default()


def _draw_mark_badges(
    image: Image.Image,
    components: list[dict],
    *,
    coordinate_scale: int = 1,
    offset_xy: tuple[int, int] = (0, 0),
) -> None:
    drawing = ImageDraw.Draw(image)
    mark_font = _font(22)
    radius = 14
    offset_x, offset_y = offset_xy
    for component in components:
        anchor_x, anchor_y = component["mark_anchor_xy"]
        bbox_x, bbox_y, bbox_width, bbox_height = component["bbox_xywh"]
        anchor_x = (anchor_x - offset_x) * coordinate_scale
        anchor_y = (anchor_y - offset_y) * coordinate_scale
        bbox_x = (bbox_x - offset_x) * coordinate_scale
        bbox_y = (bbox_y - offset_y) * coordinate_scale
        bbox_width *= coordinate_scale
        bbox_height *= coordinate_scale
        x = bbox_x + bbox_width // 2
        y = bbox_y - radius - 8
        if y - radius < 0:
            y = bbox_y + bbox_height + radius + 8
        x = max(radius + 2, min(image.width - radius - 2, x))
        y = max(radius + 2, min(image.height - radius - 2, y))
        text = str(component["mark"])
        drawing.line(
            [(x, y), (anchor_x, anchor_y)],
            fill=tuple(component["color_rgb"]),
            width=3,
        )
        drawing.ellipse(
            (x - radius, y - radius, x + radius, y + radius),
            fill=(255, 255, 255),
            outline=(20, 20, 20),
            width=3,
        )
        drawing.text(
            (x - 6, y - 13),
            text,
            fill=(10, 10, 10),
            font=mark_font,
        )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--target-order", type=int, required=True)
    parser.add_argument("--turn", type=int, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    run_dir = args.run_dir.resolve()
    output = args.output_dir.resolve()
    if output.exists() or output.is_symlink():
        raise SystemExit(f"Refusing to overwrite {output}")
    target_dir = run_dir / f"target-{args.target_order:02d}"
    turn_dir = target_dir / "agent-trace" / f"turn-{args.turn:06d}"
    turn = _read(turn_dir / "agent-turn.json")
    draft = turn["current_draft"]
    clean_path = target_dir / "inputs/clean.png"
    original_path = target_dir / "inputs/original.png"
    with Image.open(clean_path) as opened:
        clean = np.asarray(opened.convert("L"), dtype=np.uint8) > 0
    with Image.open(original_path) as opened:
        original = opened.convert("RGB")
    labels, count = ndimage.label(
        clean, structure=np.ones((3, 3), dtype=np.uint8)
    )
    selected_ids: list[int] = []
    for rectangle in draft["rectangles"]:
        x, y, width, height = [int(value) for value in rectangle]
        for value in np.unique(labels[y : y + height, x : x + width]):
            component_id = int(value)
            if component_id > 0 and component_id not in selected_ids:
                selected_ids.append(component_id)
    if not selected_ids:
        raise SystemExit("The selected draft contains no markable components")
    if len(selected_ids) > len(COLORS):
        raise SystemExit("Too many components for this bounded mark review")

    marked = np.full((clean.shape[0], clean.shape[1], 3), 255, dtype=np.uint8)
    marked[clean] = (25, 25, 25)
    components: list[dict] = []
    for mark, component_id in enumerate(selected_ids, start=1):
        component = labels == component_id
        color = COLORS[mark - 1]
        marked[component] = color
        ys, xs = np.nonzero(component)
        distance = ndimage.distance_transform_edt(component)
        label_y, label_x = np.unravel_index(int(np.argmax(distance)), distance.shape)
        components.append(
            {
                "mark": mark,
                "source_component_id": component_id,
                "area_pixels": int(component.sum()),
                "bbox_xywh": [
                    int(xs.min()),
                    int(ys.min()),
                    int(xs.max() - xs.min() + 1),
                    int(ys.max() - ys.min() + 1),
                ],
                "mark_anchor_xy": [int(label_x), int(label_y)],
                "color_rgb": list(color),
            }
        )
    marked_image = Image.fromarray(marked, mode="RGB")
    _draw_mark_badges(marked_image, components)

    # Preserve the source pixels while making the stable component identities visible.
    # The earlier two-panel board forced the reviewer to mentally map colored binary
    # fragments back to the handwriting. A translucent overlay removes that ambiguity.
    source_marked = np.asarray(original, dtype=np.uint8).copy()
    for component in components:
        component_mask = labels == component["source_component_id"]
        color = np.asarray(component["color_rgb"], dtype=np.float32)
        source_marked[component_mask] = np.rint(
            source_marked[component_mask].astype(np.float32) * 0.35 + color * 0.65
        ).astype(np.uint8)
    source_marked_base = Image.fromarray(source_marked, mode="RGB")
    source_marked_image = source_marked_base.copy()
    _draw_mark_badges(source_marked_image, components)

    locator = turn["collage"]["focus_locator"]["bbox_xywh"]
    for panel in (original, marked_image, source_marked_image):
        drawing = ImageDraw.Draw(panel)
        x, y, width, height = [int(value) for value in locator]
        drawing.rectangle((x, y, x + width, y + height), outline=(0, 190, 210), width=4)

    # A magnified locator crop makes detached endings and punctuation legible without
    # sacrificing the full-page line context above it.
    x, y, width, height = [int(value) for value in locator]
    focus_padding = 28
    left = max(0, x - focus_padding)
    top = max(0, y - focus_padding)
    right = min(original.width, x + width + focus_padding)
    bottom = min(original.height, y + height + focus_padding)
    focus = source_marked_base.crop((left, top, right, bottom))
    focus_scale = max(2, min(4, (original.width * 2) // max(1, focus.width)))
    focus = focus.resize(
        (focus.width * focus_scale, focus.height * focus_scale),
        Image.Resampling.NEAREST,
    )
    focus_components = [
        component
        for component in components
        if component["bbox_xywh"][0] < right
        and component["bbox_xywh"][1] < bottom
        and component["bbox_xywh"][0] + component["bbox_xywh"][2] > left
        and component["bbox_xywh"][1] + component["bbox_xywh"][3] > top
    ]
    _draw_mark_badges(
        focus,
        focus_components,
        coordinate_scale=focus_scale,
        offset_xy=(left, top),
    )

    header = 56
    focus_header = 48
    canvas_width = original.width * 2
    focus_x = (canvas_width - focus.width) // 2
    canvas = Image.new(
        "RGB",
        (canvas_width, original.height + header + focus_header + focus.height),
        "white",
    )
    canvas.paste(source_marked_image, (0, header))
    canvas.paste(marked_image, (original.width, header))
    canvas.paste(focus, (focus_x, original.height + header + focus_header))
    draw = ImageDraw.Draw(canvas)
    title_font = _font(25)
    draw.text(
        (12, 12),
        "Original context with the same numbered components",
        fill=(20, 55, 63),
        font=title_font,
    )
    draw.text(
        (original.width + 12, 12),
        "Extracted ink — choose marks, not coordinates",
        fill=(20, 55, 63),
        font=title_font,
    )
    draw.text(
        (focus_x, original.height + header + 8),
        f"Magnified target focus — reference text: {turn['current_target']['text']!r} (may be imperfect)",
        fill=(20, 55, 63),
        font=_font(22),
    )
    output.mkdir(parents=True)
    canvas.save(output / "component-marks.png", format="PNG")
    packet = {
        "schema_version": "component-mark-review.v2",
        "source_turn_sha256": turn["guided_turn_sha256"],
        "target": {
            "text_hint": turn["current_target"]["text"],
            "hint_is_fallible": True,
        },
        "instruction": (
            "Choose the marked components that together form exactly one complete target word. "
            "Remove components belonging to another word, row, or noise. Do not estimate coordinates."
        ),
        "image_path": "component-marks.png",
        "image_file_sha256": sha256_file(output / "component-marks.png"),
        "components": components,
        "required_output": {
            "schema_version": "component-mark-decision.v2",
            "component_mark_review_sha256": "this packet hash",
            "keep_marks": "nonempty unique mark integers",
            "remove_marks": "remaining mark integers",
            "brief_visible_reason": "one short sentence",
        },
    }
    packet["component_mark_review_sha256"] = _hash_record(
        packet, "component_mark_review_sha256"
    )
    (output / "review.json").write_bytes(canonical_json_bytes(packet) + b"\n")
    print(json.dumps(packet, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
