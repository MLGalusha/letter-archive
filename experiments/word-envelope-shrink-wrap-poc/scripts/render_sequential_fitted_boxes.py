#!/usr/bin/env python3
"""Fit and render per-word envelopes from a sequential ownership run."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from word_envelope.fragmented_envelope import fit_fragmented_envelope


PALETTE = ((0, 145, 158), (128, 75, 181), (220, 111, 25), (40, 137, 75), (190, 52, 106))


def _read(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("run_dir", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    manifest = _read(args.run_dir / "run-manifest.json")
    source = Image.open(manifest["input_bindings"]["source"]["path"]).convert("RGB")
    ink = np.asarray(Image.open(manifest["input_bindings"]["normalized_global_ink_mask"]["path"])) > 0
    units = {unit["unit_id"]: unit for unit in manifest["units"]}
    records = []
    for event_path in sorted((args.run_dir / "commits").glob("*/event.json")):
        event = _read(event_path)
        action = ((event.get("compact_action") or {}).get("action") or {}).get("type")
        if action != "claim_select":
            continue
        selected = np.asarray(Image.open(event_path.parent / "claimed-source-mask.png")) > 0
        ys, xs = np.nonzero(selected)
        if not len(xs):
            continue
        margin = 16
        x0, y0 = max(0, int(xs.min()) - margin), max(0, int(ys.min()) - margin)
        x1, y1 = min(selected.shape[1], int(xs.max()) + margin + 1), min(selected.shape[0], int(ys.max()) + margin + 1)
        local = selected[y0:y1, x0:x1]
        excluded = ink[y0:y1, x0:x1] & ~local
        fit = fit_fragmented_envelope(local, excluded)
        candidate = fit["candidates"]["balanced"]
        polygon = [[round(x + x0, 3), round(y + y0, 3)] for x, y in candidate["polygon"]]
        unit = units[event["unit_id"]]
        records.append({
            "unit_id": event["unit_id"],
            "tentative_text": unit["tentative_text"],
            "revision": event["revision"],
            "selected_pixels": int(selected.sum()),
            "source_component_count": candidate["source_component_count"],
            "excluded_ink_inside_pixels": candidate["excluded_ink_inside_pixels"],
            "polygon": polygon,
        })

    overlay = source.copy()
    draw = ImageDraw.Draw(overlay)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 30)
    except OSError:
        font = ImageFont.load_default()
    for index, record in enumerate(records):
        color = PALETTE[index % len(PALETTE)]
        points = [(x, y) for x, y in record["polygon"]]
        draw.line(points + [points[0]], fill=color, width=7)
        x = min(point[0] for point in points)
        y = min(point[1] for point in points)
        draw.text((x, max(0, y - 36)), record["tentative_text"], fill=color, font=font)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    overlay.save(args.output, format="JPEG", quality=95, subsampling=0)
    report_path = args.output.with_suffix(".json")
    report_path.write_text(json.dumps({"schema_version": "sequential-fitted-boxes-preview.v1", "records": records}, indent=2) + "\n")
    print(json.dumps({"output": str(args.output), "report": str(report_path), "word_count": len(records)}, indent=2))


if __name__ == "__main__":
    main()
