#!/usr/bin/env python3
"""
Line Space Coordinate Finder (Google Cloud Vision API)

Detects lines of text in an image using Google Cloud Vision word-level
bounding boxes, clusters words into lines by y-coordinate proximity,
and returns top/bottom/left/right coordinates for each line.

Usage:
    python line_finder.py <image_path> [--output overlay.png] [--json]
"""

import argparse
import io
import json
import os
import sys

from google.cloud import vision
from PIL import Image, ImageDraw


def normalize_orientation(img_bytes):
    """Apply EXIF orientation and return corrected PNG bytes.

    Reads just the EXIF orientation tag to avoid crashes from corrupted
    EXIF data, applies the rotation/flip, and re-encodes as PNG.
    """
    img = Image.open(io.BytesIO(img_bytes))
    try:
        exif = img.getexif()
        orientation = exif.get(0x0112)  # EXIF Orientation tag
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


def detect_text(image_bytes):
    """Send image bytes to Google Cloud Vision API for text detection.

    Args:
        image_bytes: raw image file bytes (PNG, JPEG, etc.)

    Returns:
        Vision API response object with full annotation data.
    """
    client = vision.ImageAnnotatorClient()
    image = vision.Image(content=image_bytes)
    response = client.document_text_detection(image=image)

    if response.error.message:
        raise ValueError(f"Vision API error: {response.error.message}")

    return response


def extract_words(response):
    """Parse the Vision API response to extract word-level bounding boxes.

    Args:
        response: Vision API AnnotateImageResponse

    Returns:
        List of dicts with word text and vertex coordinates.
    """
    words = []

    if not response.full_text_annotation.pages:
        return words

    for page in response.full_text_annotation.pages:
        for block in page.blocks:
            for paragraph in block.paragraphs:
                for word in paragraph.words:
                    word_text = "".join(
                        symbol.text for symbol in word.symbols
                    )
                    vertices = [
                        {"x": v.x, "y": v.y}
                        for v in word.bounding_box.vertices
                    ]
                    words.append({
                        "word": word_text,
                        "vertices": vertices,
                    })

    return words


def group_words_into_lines(words):
    """Cluster words into lines by y-coordinate proximity.

    Computes per-word bounding box, sorts by center_y, then greedily
    assigns each word to the current line if its center_y is within
    0.5x the running average line height — otherwise starts a new line.

    Args:
        words: list of word dicts with "vertices" key

    Returns:
        List of line dicts: [{"line": 1, "top_y": ..., "bottom_y": ...,
                              "left_x": ..., "right_x": ...}, ...]
    """
    if not words:
        return []

    # Compute per-word bbox
    word_boxes = []
    for w in words:
        xs = [v["x"] for v in w["vertices"]]
        ys = [v["y"] for v in w["vertices"]]
        top = min(ys)
        bottom = max(ys)
        left = min(xs)
        right = max(xs)
        center_y = (top + bottom) / 2.0
        word_boxes.append({
            "text": w["word"],
            "top": top,
            "bottom": bottom,
            "left": left,
            "right": right,
            "center_y": center_y,
        })

    # Sort by center_y
    word_boxes.sort(key=lambda b: b["center_y"])

    # Compute average word height for threshold
    heights = [b["bottom"] - b["top"] for b in word_boxes]
    avg_height = sum(heights) / len(heights) if heights else 20
    threshold = avg_height * 0.5

    # Greedy clustering
    lines = []
    current_line = [word_boxes[0]]

    for box in word_boxes[1:]:
        # Compare to the average center_y of the current line
        line_center = sum(b["center_y"] for b in current_line) / len(current_line)
        if abs(box["center_y"] - line_center) <= threshold:
            current_line.append(box)
        else:
            lines.append(current_line)
            current_line = [box]

    lines.append(current_line)

    # Build per-line bounding boxes with per-word data
    results = []
    for i, line_words in enumerate(lines, start=1):
        top_y = min(b["top"] for b in line_words)
        bottom_y = max(b["bottom"] for b in line_words)
        left_x = min(b["left"] for b in line_words)
        right_x = max(b["right"] for b in line_words)
        sorted_words = sorted(line_words, key=lambda b: b["left"])
        results.append({
            "line": i,
            "top_y": top_y,
            "bottom_y": bottom_y,
            "left_x": left_x,
            "right_x": right_x,
            "words": [
                {
                    "text": wb["text"],
                    "left_x": wb["left"],
                    "right_x": wb["right"],
                    "top_y": wb["top"],
                    "bottom_y": wb["bottom"],
                }
                for wb in sorted_words
            ],
        })

    # Sort by top_y and re-number
    results.sort(key=lambda r: r["top_y"])
    for i, r in enumerate(results, start=1):
        r["line"] = i

    return results


def draw_overlay(corrected_bytes, line_results):
    """Draw red separator lines on the image at each line boundary.

    Args:
        corrected_bytes: EXIF-corrected PNG image bytes
        line_results: list of line dicts with top_y, bottom_y keys

    Returns:
        PNG image bytes with red line boundaries drawn.
    """
    img = Image.open(io.BytesIO(corrected_bytes))
    if img.mode != "RGB":
        img = img.convert("RGB")

    draw = ImageDraw.Draw(img)
    width = img.width

    for line in line_results:
        top_y = line["top_y"]
        bottom_y = line["bottom_y"]
        draw.line([(0, top_y), (width, top_y)], fill=(255, 0, 0), width=2)
        draw.line([(0, bottom_y), (width, bottom_y)], fill=(255, 0, 0), width=2)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def process_image_bytes(img_bytes):
    """Process raw image bytes through the full Vision API pipeline.

    Args:
        img_bytes: raw image file bytes (PNG, JPEG, etc.)

    Returns:
        (overlay_png_bytes, results_list) where results_list is a list of
        dicts with line coordinates matching the expected output format.
    """
    corrected_bytes = normalize_orientation(img_bytes)
    response = detect_text(corrected_bytes)
    words = extract_words(response)
    results = group_words_into_lines(words)
    overlay_bytes = draw_overlay(corrected_bytes, results)

    return overlay_bytes, results


def find_lines(image_path):
    """Core pipeline: load image, detect text via Vision API, group into lines.

    Args:
        image_path: path to the input image

    Returns:
        (corrected_bytes, line_results) where corrected_bytes is the
        EXIF-corrected image and line_results is a list of line dicts.
    """
    with open(image_path, "rb") as f:
        img_bytes = f.read()

    corrected_bytes = normalize_orientation(img_bytes)
    response = detect_text(corrected_bytes)
    words = extract_words(response)
    results = group_words_into_lines(words)

    return corrected_bytes, results


def main():
    parser = argparse.ArgumentParser(
        description="Detect text lines in an image using Google Cloud Vision API."
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
