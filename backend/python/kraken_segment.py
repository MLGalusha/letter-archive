#!/usr/bin/env python3
"""
Kraken line segmentation script.
Takes an image path as argument, outputs JSON line segments to stdout.

Usage:
    python kraken_segment.py path/to/image.jpg

Output format:
    [
      { "line": 1, "baseline": [[x1,y1], ...], "bbox": [x1, y1, x2, y2], "ocrText": "..." },
      ...
    ]
"""

import json
import sys
from pathlib import Path

from PIL import Image
from kraken import blla, rpred
from kraken.lib import vgsl


def segment_image(image_path: str) -> list[dict]:
    """Run Kraken baseline segmentation and per-line OCR on an image."""
    img = Image.open(image_path)

    # Run baseline layout analysis
    segmentation = blla.segment(img)

    # Load default recognition model
    model_path = Path(__file__).parent / "models" / "default.mlmodel"
    if not model_path.exists():
        # Try the standard kraken model location
        model_path = Path(__file__).parent / "venv" / "lib" / "python3.11" / "site-packages" / "kraken" / "blla.model"

    # Attempt to load recognition model for OCR text
    rec_model = None
    rec_model_path = Path(__file__).parent / "models" / "default_rec.mlmodel"
    if rec_model_path.exists():
        rec_model = vgsl.TorchVGSLModel.load_model(str(rec_model_path))

    lines = []
    for idx, line in enumerate(segmentation.lines):
        baseline = [[int(p[0]), int(p[1])] for p in line.baseline]
        bbox = [int(line.bbox[0]), int(line.bbox[1]), int(line.bbox[2]), int(line.bbox[3])]

        ocr_text = ""
        if rec_model is not None:
            try:
                # Run recognition on single line
                pred = rpred.rpred(rec_model, img, segmentation)
                # rpred yields results - we collect them
                # Note: rpred processes all lines at once, handled below
                pass
            except Exception:
                pass

        lines.append({
            "line": idx + 1,
            "baseline": baseline,
            "bbox": bbox,
            "ocrText": ocr_text,
        })

    # If we have a recognition model, run OCR for all lines at once
    if rec_model is not None:
        try:
            predictions = list(rpred.rpred(rec_model, img, segmentation))
            for i, pred in enumerate(predictions):
                if i < len(lines):
                    lines[i]["ocrText"] = pred.prediction
        except Exception:
            pass  # OCR text is optional; segmentation bbox/baseline is the primary output

    return lines


def main():
    if len(sys.argv) < 2:
        print("Usage: python kraken_segment.py <image_path>", file=sys.stderr)
        sys.exit(1)

    image_path = sys.argv[1]

    if not Path(image_path).exists():
        print(f"Error: File not found: {image_path}", file=sys.stderr)
        sys.exit(1)

    try:
        result = segment_image(image_path)
        print(json.dumps(result))
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
