#!/usr/bin/env python3
"""Render a before/after envelope after suppressing one/two-pixel islands."""

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

from word_envelope.fragmented_envelope import fit_fragmented_envelope  # noqa: E402
from word_envelope.io_utils import canonical_json_bytes, sha256_file  # noqa: E402
from word_envelope.simple_page_agent import _hash_record  # noqa: E402


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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--target-order", type=int, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--page-source", type=Path)
    args = parser.parse_args()
    run_dir = args.run_dir.resolve()
    output = args.output_dir.resolve()
    if output.exists() or output.is_symlink():
        raise SystemExit(f"Refusing to overwrite {output}")
    public = _read(run_dir / "public-manifest.json")
    target = next(
        value
        for value in public["targets"]
        if int(value["target_order"]) == args.target_order
    )
    target_dir = run_dir / f"target-{args.target_order:02d}"
    head = _read(target_dir / "selector/head.json")
    state = _read(
        target_dir
        / "selector/revisions"
        / f'r{int(head["revision"]):06d}'
        / "state.json"
    )
    if len(state["words"]) != 1:
        raise SystemExit("Diagnostic requires exactly one committed word")
    word = state["words"][0]
    selected_path = target_dir / "selector" / word["selected_mask_path"]
    with Image.open(selected_path) as opened:
        selected = np.asarray(opened.convert("L"), dtype=np.uint8) > 0
    labels, count = ndimage.label(
        selected, structure=np.ones((3, 3), dtype=np.uint8)
    )
    areas = np.bincount(labels.ravel(), minlength=count + 1)
    micro_ids = [value for value in range(1, count + 1) if int(areas[value]) <= 2]
    pruned = selected.copy()
    if micro_ids:
        remove = np.zeros(count + 1, dtype=bool)
        remove[micro_ids] = True
        pruned &= ~remove[labels]
    fitted = fit_fragmented_envelope(pruned)
    candidate = fitted["candidates"]["balanced"]

    crop_x, crop_y, _, _ = [int(value) for value in target["crop_bbox_xywh"]]
    select_x, select_y, select_w, select_h = [
        int(value) for value in word["selection_bbox_xywh"]
    ]
    global_x = crop_x + select_x
    global_y = crop_y + select_y
    before_polygon = [
        [float(x) + crop_x, float(y) + crop_y]
        for x, y in word["envelope_polygon"]
    ]
    after_polygon = [
        [float(x) + global_x, float(y) + global_y]
        for x, y in candidate["polygon"]
    ]
    source_path = target_dir / "inputs/original.png"
    # The target source is already the hash-bound crop; draw in crop coordinates.
    with Image.open(source_path) as opened:
        crop_source = opened.convert("RGB")
    before_local = [
        (float(x) - crop_x, float(y) - crop_y) for x, y in before_polygon
    ]
    after_local = [
        (float(x) - crop_x, float(y) - crop_y) for x, y in after_polygon
    ]
    panels: list[Image.Image] = []
    for title, polygon, color in (
        ("Before: two 1-pixel specks force a bridge", before_local, (225, 106, 35)),
        ("After: micro-islands suppressed", after_local, (0, 145, 160)),
    ):
        panel = crop_source.copy()
        drawing = ImageDraw.Draw(panel)
        drawing.line(polygon + [polygon[0]], fill=color, width=6)
        panels.append(panel)
    header = 54
    canvas = Image.new(
        "RGB", (crop_source.width * 2, crop_source.height + header), "white"
    )
    drawing = ImageDraw.Draw(canvas)
    font = _font(24)
    for index, (title, panel) in enumerate(
        zip(
            (
                "Before: two 1-pixel specks force a bridge",
                "After: micro-islands suppressed",
            ),
            panels,
        )
    ):
        offset = index * crop_source.width
        drawing.text((offset + 12, 12), title, fill=(28, 55, 62), font=font)
        canvas.paste(panel, (offset, header))
    output.mkdir(parents=True)
    canvas.save(output / "before-after.png", format="PNG")
    if args.page_source is not None:
        page_source = args.page_source.resolve()
        with Image.open(page_source) as opened:
            page = opened.convert("RGB")
        neighbor_target = next(
            value for value in public["targets"] if int(value["target_order"]) == 1
        )
        neighbor_dir = run_dir / "target-01"
        neighbor_head = _read(neighbor_dir / "selector/head.json")
        neighbor_state = _read(
            neighbor_dir
            / "selector/revisions"
            / f'r{int(neighbor_head["revision"]):06d}'
            / "state.json"
        )
        neighbor_crop_x, neighbor_crop_y, _, _ = [
            int(value) for value in neighbor_target["crop_bbox_xywh"]
        ]
        neighbor_polygon = [
            (float(x) + neighbor_crop_x, float(y) + neighbor_crop_y)
            for x, y in neighbor_state["words"][0]["envelope_polygon"]
        ]
        all_points = neighbor_polygon + [tuple(value) for value in after_polygon]
        x0 = max(0, int(min(value[0] for value in all_points)) - 45)
        y0 = max(0, int(min(value[1] for value in all_points)) - 45)
        x1 = min(page.width, int(max(value[0] for value in all_points)) + 46)
        y1 = min(page.height, int(max(value[1] for value in all_points)) + 46)
        separated = page.crop((x0, y0, x1, y1))
        separated_draw = ImageDraw.Draw(separated)
        you_local = [(x - x0, y - y0) for x, y in neighbor_polygon]
        by_local = [(x - x0, y - y0) for x, y in after_polygon]
        separated_draw.line(
            you_local + [you_local[0]], fill=(139, 75, 181), width=7
        )
        separated_draw.line(
            by_local + [by_local[0]], fill=(0, 145, 160), width=7
        )
        separated_draw.text((12, 10), "You", fill=(139, 75, 181), font=font)
        separated_draw.text((80, 10), "By", fill=(0, 145, 160), font=font)
        separated.save(output / "overlap-explained.png", format="PNG")
    record = {
        "schema_version": "micro-island-envelope-diagnostic.v1",
        "target_order": args.target_order,
        "reference_text": target["reference_text"],
        "selected_mask_file_sha256": sha256_file(selected_path),
        "selected_pixels_before": int(selected.sum()),
        "selected_pixels_after": int(pruned.sum()),
        "component_areas_before": [int(areas[value]) for value in range(1, count + 1)],
        "suppressed_component_ids": micro_ids,
        "suppressed_pixels": int(selected.sum() - pruned.sum()),
        "fit_method_before": word["fit_method"],
        "fit_profile_before": word["fit_profile"],
        "fit_method_after": "component_tree_without_micro_islands",
        "fit_profile_after": "balanced",
        "mst_bridge_length_before_is_nonzero": True,
        "mst_bridge_length_after_px": candidate["mst_bridge_length_px"],
        "before_polygon": before_polygon,
        "after_polygon": after_polygon,
        "separated_neighbor_overlay_path": (
            "overlap-explained.png" if args.page_source is not None else None
        ),
    }
    record["diagnostic_sha256"] = _hash_record(record, "diagnostic_sha256")
    (output / "diagnosis.json").write_bytes(canonical_json_bytes(record) + b"\n")
    print(json.dumps(record, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
