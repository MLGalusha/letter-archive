#!/usr/bin/env python3
"""
Line Space Coordinate Finder

Detects lines of text in an image and returns top/bottom y-coordinates
for each line. Handles rotated images (0/90/180/270 degree increments).

Usage:
    python line_finder.py <image_path> [--output overlay.png] [--json]
"""

import argparse
import json
import os
import sys

import cv2
import numpy as np


def load_image(path):
    """Load an image from disk."""
    img = cv2.imread(path)
    if img is None:
        print(f"Error: Could not load image at '{path}'", file=sys.stderr)
        sys.exit(1)
    return img


def rotate_image(img, angle):
    """Rotate image by 0, 90, 180, or 270 degrees."""
    if angle == 0:
        return img
    elif angle == 90:
        return cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)
    elif angle == 180:
        return cv2.rotate(img, cv2.ROTATE_180)
    elif angle == 270:
        return cv2.rotate(img, cv2.ROTATE_90_COUNTERCLOCKWISE)
    return img


def preprocess(img):
    """Convert to binary image with white text on black background.

    Uses aggressive noise removal to handle aged/textured paper:
    - Large adaptive threshold block size to ignore paper texture
    - Morphological opening to remove small noise specks
    """
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)

    # Larger block size (31) and higher C (15) to be more selective —
    # only strong dark regions (actual ink) pass through, not paper texture.
    binary = cv2.adaptiveThreshold(
        blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV, 31, 15
    )

    # Morphological opening removes small noise specks while preserving text
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)

    return binary


def horizontal_projection(binary):
    """Compute smoothed horizontal projection profile."""
    projection = np.sum(binary, axis=1).astype(float)
    # Smooth with Gaussian-like moving average sized to image height.
    # Larger images need more smoothing to bridge within-character gaps
    # but not so much that inter-line gaps are lost.
    h = binary.shape[0]
    kernel_size = max(5, h // 400)
    if kernel_size % 2 == 0:
        kernel_size += 1
    kernel = np.ones(kernel_size) / kernel_size
    smoothed = np.convolve(projection, kernel, mode='same')
    return smoothed


def detect_rotation(img):
    """Auto-detect rotation by picking the angle with highest projection variance.

    Tries 0, 90, 180, 270 and returns the angle whose horizontal projection
    has the highest variance (sharpest text-line separation).

    For 0 vs 180 (or 90 vs 270) — both have the same variance since lines
    are symmetric. We disambiguate by checking which orientation has the
    text block closer to the top (text typically starts near the top of a page).
    """
    best_angle = 0
    best_variance = -1
    variances = {}

    for angle in [0, 90, 180, 270]:
        rotated = rotate_image(img, angle)
        binary = preprocess(rotated)
        projection = horizontal_projection(binary)
        variance = np.var(projection)
        variances[angle] = (variance, projection)
        if variance > best_variance:
            best_variance = variance
            best_angle = angle

    # Find the pair of angles with the best variance (0/180 or 90/270)
    # Disambiguate by checking top margin size. A correctly oriented document
    # typically has a larger top margin (header/date area) than the upside-down
    # version. Pick the orientation where text starts furthest from the top edge.
    if best_angle in (0, 180):
        candidates = [0, 180]
    else:
        candidates = [90, 270]

    best_top_margin = -1
    for angle in candidates:
        proj = variances[angle][1]
        threshold = 0.1 * np.max(proj)
        text_rows = np.where(proj > threshold)[0]
        if len(text_rows) > 0:
            top_margin = text_rows[0]
            if top_margin > best_top_margin:
                best_top_margin = top_margin
                best_angle = angle

    return best_angle


def find_line_boundaries(projection, img_height, threshold_ratio=0.08):
    """Find contiguous text regions in the horizontal projection.

    Args:
        projection: smoothed horizontal projection array
        img_height: height of the image (used to compute adaptive min line height)
        threshold_ratio: fraction of max projection to count as "text"

    Returns:
        List of (top_y, bottom_y) tuples for each detected line.
    """
    # Adaptive minimum line height: filter out noise but keep short text lines
    # like dates or signatures. img_height/150 works for typical letter images.
    min_line_height = max(8, img_height // 150)

    threshold = threshold_ratio * np.max(projection)
    is_text = projection > threshold

    lines = []
    in_line = False
    top_y = 0

    for y, val in enumerate(is_text):
        if val and not in_line:
            in_line = True
            top_y = y
        elif not val and in_line:
            in_line = False
            bottom_y = y - 1
            if bottom_y - top_y + 1 >= min_line_height:
                lines.append((top_y, bottom_y))

    # Handle case where text extends to bottom of image
    if in_line:
        bottom_y = len(is_text) - 1
        if bottom_y - top_y + 1 >= min_line_height:
            lines.append((top_y, bottom_y))

    # Post-process: iteratively split any "line" that is unreasonably tall.
    # If a detected region is much taller than the median, it likely
    # contains multiple merged lines — re-scan it with a tighter threshold.
    # Repeat until no more oversized lines remain.
    for _ in range(5):  # max iterations to prevent infinite loops
        if len(lines) < 3:
            break
        heights = [b - t + 1 for t, b in lines]
        median_h = np.median(heights)
        split_lines = []
        any_split = False
        for top_y, bottom_y in lines:
            h = bottom_y - top_y + 1
            if h > median_h * 1.8:
                sub_proj = projection[top_y:bottom_y + 1]
                sub_lines = _split_merged_region(
                    sub_proj, top_y, min_line_height, median_h
                )
                if len(sub_lines) > 1:
                    any_split = True
                split_lines.extend(sub_lines)
            else:
                split_lines.append((top_y, bottom_y))
        lines = split_lines
        if not any_split:
            break

    return lines


def _split_merged_region(sub_proj, offset, min_line_height, expected_height):
    """Split a merged region by finding local minima (valleys between lines)."""
    region_len = len(sub_proj)

    # Approach 1: Find local minima in the projection profile.
    # Smooth the sub-projection to find clean valleys.
    k = max(3, int(expected_height * 0.3))
    if k % 2 == 0:
        k += 1
    smooth = np.convolve(sub_proj, np.ones(k) / k, mode='same')

    # Find valleys: points lower than both neighbors within a window
    window = max(5, int(expected_height * 0.4))
    valleys = []
    for i in range(window, region_len - window):
        local_region = smooth[i - window:i + window + 1]
        if smooth[i] == np.min(local_region):
            valleys.append(i)

    # Deduplicate valleys that are too close together
    if valleys:
        deduped = [valleys[0]]
        for v in valleys[1:]:
            if v - deduped[-1] > min_line_height:
                deduped.append(v)
        valleys = deduped

    # Build lines from valleys
    if valleys:
        lines = []
        prev = 0
        for v in valleys:
            if v - prev >= min_line_height:
                lines.append((prev + offset, v - 1 + offset))
            prev = v
        # Last segment
        if region_len - 1 - prev >= min_line_height:
            lines.append((prev + offset, region_len - 1 + offset))

        if len(lines) >= 2:
            return lines

    # Approach 2: Fallback — try progressively higher thresholds
    max_val = np.max(sub_proj)
    for ratio in [0.15, 0.20, 0.30, 0.40, 0.50]:
        threshold = ratio * max_val
        is_text = sub_proj > threshold

        lines = []
        in_line = False
        top_y = 0

        for y, val in enumerate(is_text):
            if val and not in_line:
                in_line = True
                top_y = y
            elif not val and in_line:
                in_line = False
                bottom_y = y - 1
                if bottom_y - top_y + 1 >= min_line_height:
                    lines.append((top_y + offset, bottom_y + offset))

        if in_line:
            bottom_y = len(is_text) - 1
            if bottom_y - top_y + 1 >= min_line_height:
                lines.append((top_y + offset, bottom_y + offset))

        if len(lines) >= 2:
            return lines

    # Couldn't split — return original region
    return [(offset, offset + len(sub_proj) - 1)]


def find_horizontal_bounds(binary, lines, margin=15):
    """Find consistent left/right text boundaries across all detected lines.

    For each line strip, computes vertical projection (sum down columns)
    to find the leftmost and rightmost text-containing columns.
    Returns global bounds (min left, max right + margin) for a stable UI.

    Args:
        binary: preprocessed binary image (white text on black)
        lines: list of (top_y, bottom_y) tuples
        margin: padding in pixels around the text bounds

    Returns:
        (global_left, global_right) pixel coordinates
    """
    if not lines:
        return 0, binary.shape[1]

    img_width = binary.shape[1]
    all_lefts = []
    all_rights = []

    for top_y, bottom_y in lines:
        strip = binary[top_y:bottom_y + 1, :]
        v_proj = np.sum(strip, axis=0).astype(float)

        if np.max(v_proj) == 0:
            continue

        threshold = 0.05 * np.max(v_proj)
        text_cols = np.where(v_proj > threshold)[0]
        if len(text_cols) == 0:
            continue

        all_lefts.append(int(text_cols[0]))
        all_rights.append(int(text_cols[-1]))

    if not all_lefts:
        return 0, img_width

    global_left = max(0, min(all_lefts) - margin)
    global_right = min(img_width, max(all_rights) + margin)

    return global_left, global_right


def draw_overlay(img, lines, color=(0, 0, 255), thickness=2):
    """Draw red separator lines on the image at each line boundary."""
    overlay = img.copy()
    width = overlay.shape[1]

    for top_y, bottom_y in lines:
        cv2.line(overlay, (0, top_y), (width, top_y), color, thickness)
        cv2.line(overlay, (0, bottom_y), (width, bottom_y), color, thickness)

    return overlay


def process_image_bytes(img_bytes):
    """Process raw image bytes through the full pipeline in-memory.

    cv2.imdecode with IMREAD_COLOR auto-applies EXIF orientation (OpenCV 4.5.1+),
    so the image is correctly oriented without needing detect_rotation.

    Args:
        img_bytes: raw image file bytes (PNG, JPEG, etc.)

    Returns:
        (overlay_png_bytes, results_list) where overlay_png_bytes is a PNG-encoded
        overlay image and results_list is a list of dicts with line coordinates.
    """
    arr = np.frombuffer(img_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Could not decode image from provided bytes")

    binary = preprocess(img)
    projection = horizontal_projection(binary)
    lines = find_line_boundaries(projection, img.shape[0])
    global_left, global_right = find_horizontal_bounds(binary, lines)

    results = []
    for i, (top_y, bottom_y) in enumerate(lines, start=1):
        results.append({
            "line": i,
            "top_y": int(top_y),
            "bottom_y": int(bottom_y),
            "left_x": global_left,
            "right_x": global_right,
        })

    overlay = draw_overlay(img, lines)
    _, png_bytes = cv2.imencode(".png", overlay)

    return png_bytes.tobytes(), results


def find_lines(image_path):
    """Core pipeline: load image, detect rotation, find lines.

    Args:
        image_path: path to the input image

    Returns:
        (img, lines, results) where img is the (possibly rotated) image,
        lines is a list of (top_y, bottom_y) tuples, and results is a
        list of dicts with line number and coordinates.
    """
    img = load_image(image_path)

    # Auto-detect and correct rotation
    angle = detect_rotation(img)
    if angle != 0:
        print(f"Detected rotation: {angle}° — correcting...", file=sys.stderr)
        img = rotate_image(img, angle)

    # Preprocess and compute projection
    binary = preprocess(img)
    projection = horizontal_projection(binary)

    # Find line boundaries
    lines = find_line_boundaries(projection, img.shape[0])

    # Find horizontal text bounds (consistent across all lines)
    global_left, global_right = find_horizontal_bounds(binary, lines)

    # Build result
    results = []
    for i, (top_y, bottom_y) in enumerate(lines, start=1):
        results.append({
            "line": i,
            "top_y": int(top_y),
            "bottom_y": int(bottom_y),
            "left_x": global_left,
            "right_x": global_right,
        })

    return img, lines, results


def main():
    parser = argparse.ArgumentParser(
        description="Detect text lines in an image and return y-coordinates."
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

    img, lines, results = find_lines(args.image)

    if args.json_only:
        # Clean JSON-only output — no overlay, no extra messages
        print(json.dumps(results))
    else:
        # Interactive mode: save overlay and print results
        output_path = args.output
        if output_path is None:
            script_dir = os.path.dirname(os.path.abspath(__file__))
            output_path = os.path.join(script_dir, "output", "overlay.png")

        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        overlay = draw_overlay(img, lines)
        cv2.imwrite(output_path, overlay)
        print(f"Overlay saved to: {output_path}")

        print(f"\nDetected {len(results)} lines:\n")
        print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
