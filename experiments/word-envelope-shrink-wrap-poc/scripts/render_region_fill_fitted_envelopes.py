#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from word_envelope.fragmented_envelope import fit_fragmented_envelope  # noqa: E402
from word_envelope.io_utils import canonical_json_bytes, sha256_file  # noqa: E402
from word_envelope.simple_page_agent import _hash_record  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--selector-dir", type=Path, required=True)
    parser.add_argument("--knockout-dir", type=Path, required=True)
    parser.add_argument("--reassignment-map", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    selector = args.selector_dir.resolve()
    knockout_dir = args.knockout_dir.resolve()
    output = args.output_dir.resolve()
    if output.exists():
        raise ValueError("output already exists")
    manifest = json.loads((selector / "manifest.json").read_text("utf-8"))
    layers = json.loads((selector / "ink-layers.json").read_text("utf-8"))
    knockout = json.loads((knockout_dir / "knockout.json").read_text("utf-8"))
    reassignment = json.loads(args.reassignment_map.read_text("utf-8"))
    pending_lines = {item["replace_line_id"] for item in reassignment["mappings"]}
    source_path = selector / manifest["source"]["working_path"]
    clean_path = selector / layers["layers"]["clean"]["mask_path"]
    label_path = knockout_dir / knockout["evidence"]["owner_labels"]["path"]
    with Image.open(source_path) as image:
        source = image.convert("RGB")
    with Image.open(clean_path) as image:
        clean = np.asarray(image.convert("L"), dtype=np.uint8) > 0
    with Image.open(label_path) as image:
        owner = np.asarray(image, dtype=np.uint16)
    words = []
    for label, word in enumerate(knockout["words"], start=1):
        selected_full = owner == label
        ys, xs = np.nonzero(selected_full)
        if not len(xs):
            continue
        pad = 35
        x0, y0 = max(0, int(xs.min()) - pad), max(0, int(ys.min()) - pad)
        x1, y1 = min(owner.shape[1], int(xs.max()) + pad + 1), min(owner.shape[0], int(ys.max()) + pad + 1)
        selected = selected_full[y0:y1, x0:x1]
        excluded = clean[y0:y1, x0:x1] & ~selected
        status = "fitted"
        try:
            fitted = fit_fragmented_envelope(selected, excluded)
            candidates = fitted["candidates"]
            name, candidate = min(
                candidates.items(),
                key=lambda item: (
                    item[1]["excluded_ink_fraction_inside_envelope"],
                    item[1]["envelope_area_px2"],
                ),
            )
            polygon = [[round(point[0] + x0, 3), round(point[1] + y0, 3)] for point in candidate["polygon"]]
            metrics = {
                "profile": name,
                "excluded_fraction": candidate["excluded_ink_fraction_inside_envelope"],
                "selected_components": fitted["selected_component_count"],
            }
        except Exception as error:
            status = "bbox_fallback"
            polygon = [
                [float(xs.min()), float(ys.min())],
                [float(xs.max() + 1), float(ys.min())],
                [float(xs.max() + 1), float(ys.max() + 1)],
                [float(xs.min()), float(ys.max() + 1)],
            ]
            metrics = {"reason": str(error)}
        words.append(
            {
                "word_id": word["word_id"],
                "line_id": word["line_id"],
                "status": status,
                "pending_reassignment": word["line_id"] in pending_lines,
                "polygon": polygon,
                "metrics": metrics,
            }
        )
    preview = source.resize((900, 1200), Image.Resampling.LANCZOS)
    draw = ImageDraw.Draw(preview)
    scale = 0.3
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 10)
    except OSError:
        font = ImageFont.load_default()
    for index, word in enumerate(words, start=1):
        points = [(round(x * scale), round(y * scale)) for x, y in word["polygon"]]
        color = (245, 139, 31) if word["pending_reassignment"] else (10, 132, 142)
        draw.line(points + [points[0]], fill=color, width=2)
        if points:
            draw.text(points[0], str(index), fill=color, font=font)
    output.mkdir(parents=True)
    image_path = output / "fitted-envelopes-overlay.png"
    preview.save(image_path, format="PNG", optimize=True)
    record = {
        "schema_version": "region-fill-fitted-envelope-render.v1",
        "knockout_sha256": knockout["knockout_sha256"],
        "pending_reassignment_lines": sorted(pending_lines),
        "legend": {"teal": "current fitted envelope", "orange": "fitted envelope pending residual reassignment"},
        "counts": {
            "words": len(words),
            "fitted": sum(word["status"] == "fitted" for word in words),
            "bbox_fallback": sum(word["status"] == "bbox_fallback" for word in words),
            "pending_reassignment": sum(word["pending_reassignment"] for word in words),
        },
        "words": words,
        "overlay": {"path": image_path.name, "file_sha256": sha256_file(image_path)},
    }
    record["render_sha256"] = _hash_record(record, "render_sha256")
    (output / "render.json").write_bytes(canonical_json_bytes(record) + b"\n")
    print(json.dumps(record, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
