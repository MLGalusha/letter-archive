#!/usr/bin/env python3
"""
Text Line Detection with Kraken

Detects text lines in an image using Kraken baseline segmentation, returns
line-level bounding box coordinates with polygon boundaries, and optionally
generates an overlay image.

Usage:
    python line_finder.py <image_path> [--output overlay.png] [--json]
"""

import argparse
import io
import json
import os
from functools import lru_cache
from importlib import resources

from kraken import blla
from kraken.lib import vgsl
from PIL import Image, ImageDraw


def normalize_orientation(img_bytes):
    """Apply EXIF orientation and return corrected PNG bytes."""
    img = Image.open(io.BytesIO(img_bytes))
    try:
        exif = img.getexif()
        orientation = exif.get(0x0112)
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
        pass
    if img.mode != "RGB":
        img = img.convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@lru_cache(maxsize=1)
def load_default_model():
    """
    Load Kraken's bundled baseline segmentation model once.

    Kraken 6.x currently mis-resolves the default model path when `blla.segment`
    is called without an explicit model, so we load it ourselves from the
    package root and pass it in directly.
    """
    model_path = resources.files("kraken").joinpath("blla.mlmodel")
    return vgsl.TorchVGSLModel.load_model(str(model_path))


def segment_image(img):
    """Use Kraken baseline segmentation to detect text lines.

    Returns list of dicts with bounding box coords and boundary polygon,
    matching the format expected by the backend TypeScript parser:
      { line, top_y, bottom_y, left_x, right_x, boundary: [{x, y}] }

    Returns raw Kraken segments sorted by position, no post-processing.
    """
    seg = blla.segment(img, model=load_default_model())

    lines = []
    for line in seg.lines:
        boundary = line.boundary
        xs = [p[0] for p in boundary]
        ys = [p[1] for p in boundary]
        lines.append({
            "line": 0,
            "top_y": int(min(ys)),
            "bottom_y": int(max(ys)),
            "left_x": int(min(xs)),
            "right_x": int(max(xs)),
            "boundary": [{"x": int(p[0]), "y": int(p[1])} for p in boundary],
        })

    # Sort by vertical then horizontal position, number sequentially
    lines.sort(key=lambda r: (r["top_y"], r["left_x"]))
    for i, r in enumerate(lines, start=1):
        r["line"] = i

    return lines


def draw_overlay(corrected_bytes, lines):
    """Draw polygon outlines on the image for each detected line.

    Returns PNG image bytes with polygon boundaries drawn.
    """
    img = Image.open(io.BytesIO(corrected_bytes))
    if img.mode != "RGB":
        img = img.convert("RGB")

    draw = ImageDraw.Draw(img)

    for line_info in lines:
        boundary = line_info["boundary"]
        points = [(p["x"], p["y"]) for p in boundary]
        # Close the polygon
        points.append(points[0])
        draw.line(points, fill=(79, 110, 247), width=2)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def process_image_bytes(img_bytes):
    """Process raw image bytes through the Kraken segmentation pipeline.

    Returns (overlay_png_bytes, results_list).
    """
    corrected_bytes = normalize_orientation(img_bytes)
    img = Image.open(io.BytesIO(corrected_bytes))
    if img.mode != "RGB":
        img = img.convert("RGB")

    lines = segment_image(img)
    overlay_bytes = draw_overlay(corrected_bytes, lines)

    return overlay_bytes, lines


def find_lines(image_path):
    """Load image, detect text lines via Kraken, return results.

    Returns (corrected_bytes, line_results).
    """
    with open(image_path, "rb") as f:
        img_bytes = f.read()

    corrected_bytes = normalize_orientation(img_bytes)
    img = Image.open(io.BytesIO(corrected_bytes))
    if img.mode != "RGB":
        img = img.convert("RGB")

    lines = segment_image(img)
    return corrected_bytes, lines


def main():
    parser = argparse.ArgumentParser(
        description="Detect text lines in an image using Kraken."
    )
    parser.add_argument("image", help="Path to the input image")
    parser.add_argument(
        "--output", "-o",
        help="Path to save overlay image (default: output/overlay.png)"
    )
    parser.add_argument(
        "--json", action="store_true", dest="json_only",
        help="Output only raw JSON (no extra messages)"
    )
    args = parser.parse_args()

    corrected_bytes, results = find_lines(args.image)

    if args.json_only:
        print(json.dumps(results))
    else:
        output_path = args.output
        if output_path is None:
            script_dir = os.path.dirname(os.path.abspath(__file__))
            output_path = os.path.join(script_dir, "output", "overlay.png")

        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        overlay_bytes = draw_overlay(corrected_bytes, results)
        with open(output_path, "wb") as f:
            f.write(overlay_bytes)
        print(f"Overlay saved to: {output_path}")

        print(f"\nDetected {len(results)} lines:\n")
        print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
