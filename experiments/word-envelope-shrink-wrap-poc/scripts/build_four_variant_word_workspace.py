#!/usr/bin/env python3
"""Build a hash-bound four-ink counterfactual workspace for one frozen packet."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

from word_envelope.io_utils import canonical_json_bytes, sha256_file, sha256_mask_pixels
from word_envelope.masks import stable_components


PAPER = (251, 247, 238)
RED = (201, 55, 48)
GREEN = (24, 151, 75)
BLUE = (15, 112, 180)


def _read(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _binary(path: Path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("L")) > 0


def _font(size: int) -> ImageFont.ImageFont:
    try:
        return ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", size)
    except OSError:
        return ImageFont.load_default()


def _fit(image: Image.Image, size: tuple[int, int], fill=PAPER) -> Image.Image:
    result = image.copy()
    result.thumbnail(size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", size, fill)
    canvas.paste(result, ((size[0] - result.width) // 2, (size[1] - result.height) // 2))
    return canvas


def _ink_image(mask: np.ndarray, suggestion: np.ndarray | None = None) -> Image.Image:
    rgb = np.full((*mask.shape, 3), PAPER, dtype=np.uint8)
    rgb[mask] = RED
    if suggestion is not None:
        rgb[suggestion & mask] = GREEN
    return Image.fromarray(rgb, mode="RGB")


def _variant_masks(clean: np.ndarray, maximum: np.ndarray) -> dict[str, np.ndarray]:
    if np.any(clean & ~maximum):
        raise SystemExit("Clean ink must be an exact subset of maximum-recall ink")
    extra = maximum & ~clean
    distance = ndimage.distance_transform_edt(~clean)
    conservative = clean | (extra & (distance <= 1.5))
    balanced = clean | (extra & (distance <= 4.0))
    return {
        "clean": clean,
        "conservative": conservative,
        "balanced": balanced,
        "maximum_recall": maximum,
    }


def _suggestion(maximum: np.ndarray, active_local: list[int]) -> tuple[np.ndarray, list[int], list[dict]]:
    labels, inventory = stable_components(maximum)
    ax, ay, aw, ah = active_local
    expanded = (max(0, ax - 12), max(0, ay - 16), ax + aw + 12, ay + ah + 16)
    chosen: list[int] = []
    for component in inventory:
        box = component["bbox"]
        x0, y0 = box["x"], box["y"]
        x1, y1 = x0 + box["width"], y0 + box["height"]
        if x1 >= expanded[0] and x0 <= expanded[2] and y1 >= expanded[1] and y0 <= expanded[3]:
            chosen.append(int(component["id"]))
    suggested = np.isin(labels, chosen)
    return suggested, chosen, inventory


def _find_packet(run_dir: Path, unit_id: str) -> tuple[Path, dict]:
    matches = []
    for path in sorted((run_dir / "packets").glob("*/work-packet.json")):
        packet = _read(path)
        if (packet.get("current") or {}).get("unit_id") == unit_id:
            matches.append((path, packet))
    if not matches:
        raise SystemExit(f"No frozen packet found for {unit_id}")
    return matches[0]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--unit-id", required=True)
    parser.add_argument("--clean-mask", type=Path, required=True)
    parser.add_argument("--maximum-mask", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    if args.output_dir.exists():
        raise SystemExit("Output directory already exists; refusing overwrite")

    manifest = _read(args.run_dir / "run-manifest.json")
    packet_path, packet = _find_packet(args.run_dir, args.unit_id)
    source_path = Path(manifest["input_bindings"]["source"]["path"])
    source = Image.open(source_path).convert("RGB")
    clean_page = _binary(args.clean_mask)
    maximum_page = _binary(args.maximum_mask)
    if clean_page.shape != maximum_page.shape or clean_page.shape != (source.height, source.width):
        raise SystemExit("Ink layers must match the source dimensions")

    revision = int(packet["revision"])
    checkpoint_path = args.run_dir / "commits" / f"{revision:06d}" / "checkpoint.json"
    checkpoint = _read(checkpoint_path)
    claimed_path = args.run_dir / checkpoint["state"]["global_claimed_mask"]["path"]
    claimed = _binary(claimed_path)
    manifest_unit = next(unit for unit in manifest["units"] if unit["unit_id"] == args.unit_id)
    rotation = float(manifest_unit.get("upright_rotation_degrees", 0))
    old_work = packet["current"]["work_bbox_source_xywh"]
    cx, cy, cw, ch = packet["current"]["context_bbox_source_xywh"]
    tx, ty, tw, th = packet["current"]["active_target_bbox_source_xywh"]
    selection_padding = max(32, round(max(tw, th) * 0.22))
    wx = max(0, tx - selection_padding)
    wy = max(0, ty - selection_padding)
    wx1 = min(source.width, tx + tw + selection_padding)
    wy1 = min(source.height, ty + th + selection_padding)
    ww, wh = wx1 - wx, wy1 - wy
    clean = clean_page[wy:wy+wh, wx:wx+ww] & ~claimed[wy:wy+wh, wx:wx+ww]
    maximum = maximum_page[wy:wy+wh, wx:wx+ww] & ~claimed[wy:wy+wh, wx:wx+ww]
    variants = _variant_masks(clean, maximum)
    suggested, suggested_ids, inventory = _suggestion(maximum, [tx-wx, ty-wy, tw, th])

    args.output_dir.mkdir(parents=True)
    evidence = {}
    for name, mask in variants.items():
        path = args.output_dir / f"ink-{name.replace('_', '-')}.png"
        _ink_image(mask, suggested).save(path, format="PNG")
        evidence[name] = {
            "path": path.name,
            "file_sha256": sha256_file(path),
            "mask_pixel_sha256": sha256_mask_pixels(mask),
            "pixels": int(mask.sum()),
            "component_count": int(ndimage.label(mask, structure=np.ones((3,3), dtype=np.uint8))[1]),
        }

    context = source.crop((cx, cy, cx+cw, cy+ch))
    context_draw = ImageDraw.Draw(context)
    context_draw.rectangle((tx-cx, ty-cy, tx+tw-cx, ty+th-cy), outline=GREEN, width=5)
    context_draw.line((tx-cx, ty+th//2-cy, tx+tw-cx, ty+th//2-cy), fill=GREEN, width=2)
    context = context.rotate(rotation, expand=True, resample=Image.Resampling.BICUBIC, fillcolor=PAPER)
    focus_margin_x = max(50, tw)
    focus_margin_y = max(45, th)
    fx0, fy0 = max(0, tx-focus_margin_x), max(0, ty-focus_margin_y)
    fx1, fy1 = min(source.width, tx+tw+focus_margin_x), min(source.height, ty+th+focus_margin_y)
    focus = source.crop((fx0, fy0, fx1, fy1))
    focus_draw = ImageDraw.Draw(focus)
    focus_draw.rectangle((tx-fx0, ty-fy0, tx+tw-fx0, ty+th-fy0), outline=GREEN, width=5)
    focus = focus.rotate(rotation, expand=True, resample=Image.Resampling.BICUBIC, fillcolor=PAPER)
    page = _fit(source, (150, 180), fill=(235, 226, 213))

    canvas = Image.new("RGB", (1800, 1260), (245, 237, 225))
    draw = ImageDraw.Draw(canvas)
    draw.text((34, 24), "ONE WORD · FOUR INK CHOICES", fill=(45,36,29), font=_font(34))
    draw.text((34, 68), f"{args.unit_id} · reference only: {packet['current']['tentative_text']}", fill=(78,67,57), font=_font(21))
    draw.text((34, 100), "Green is software-suggested, not owned. Choose the clearest layer, then correct the selection.", fill=(20,83,94), font=_font(20))
    panels = [
        ("1  Line context (read first)", context, (34, 170, 1040, 560)),
        ("2  Original focus", focus, (1070, 170, 1766, 560)),
    ]
    for label, image, box in panels:
        x0,y0,x1,y1=box
        draw.text((x0,y0-32), label, fill=(45,36,29), font=_font(22))
        canvas.paste(_fit(image,(x1-x0,y1-y0)),(x0,y0))
        draw.rectangle(box,outline=(185,170,150),width=2)
    names = [("Clean base","clean"),("Conservative","conservative"),("Balanced","balanced"),("Maximum recall","maximum_recall")]
    for index,(label,name) in enumerate(names):
        x0=34+index*430; y0=650; x1=x0+405; y1=1050
        draw.text((x0,y0-32), f"{index+3}  {label}", fill=(45,36,29), font=_font(21))
        draw.text((x0+255,y0-30), f"{evidence[name]['pixels']:,} px", fill=(78,67,57), font=_font(16))
        canvas.paste(_fit(_ink_image(variants[name], suggested),(x1-x0,y1-y0)),(x0,y0))
        draw.rectangle((x0,y0,x1,y1),outline=(185,170,150),width=2)
    canvas.paste(page,(34,1070))
    draw.text((220,1100), "Selection contract", fill=(45,36,29), font=_font(23))
    draw.text((220,1140), "Pick one layer. Green is a starting suggestion. Add/remove components until exactly one complete word remains.", fill=(20,83,94), font=_font(20))
    draw.text((220,1180), "The full-page locator is intentionally last and small; the upright line and tight word focus own the decision.", fill=(78,67,57), font=_font(18))
    collage_path = args.output_dir / "agent-workspace.jpg"
    canvas.save(collage_path, format="JPEG", quality=95, subsampling=0, optimize=True)

    record = {
        "schema_version": "four-variant-word-workspace.v1",
        "unit_id": args.unit_id,
        "tentative_text": packet["current"]["tentative_text"],
        "frozen_packet": {"path": str(packet_path), "file_sha256": sha256_file(packet_path), "work_packet_sha256": packet["work_packet_sha256"]},
        "source": {"path": str(source_path), "file_sha256": sha256_file(source_path)},
        "proposal_boxes": {
            "original_bbox_source_xywh": packet["current"]["original_target_bbox_source_xywh"],
            "active_bbox_source_xywh": packet["current"]["active_target_bbox_source_xywh"],
            "work_bbox_source_xywh": packet["current"]["work_bbox_source_xywh"],
            "selection_bbox_source_xywh": [wx, wy, ww, wh],
            "legacy_work_bbox_source_xywh": old_work,
            "context_bbox_source_xywh": packet["current"]["context_bbox_source_xywh"],
        },
        "ink_inputs": {"clean": {"path": str(args.clean_mask), "file_sha256": sha256_file(args.clean_mask)}, "maximum_recall": {"path": str(args.maximum_mask), "file_sha256": sha256_file(args.maximum_mask)}},
        "variant_order": ["clean","conservative","balanced","maximum_recall"],
        "variants": evidence,
        "software_suggestion": {"component_ids_in_maximum_inventory": suggested_ids, "pixels": int(suggested.sum()), "status": "proposal_not_truth"},
        "directed_display": {"upright_rotation_degrees": rotation, "selection_coordinates_remain_source_oriented": True},
        "maximum_component_inventory": inventory,
        "collage": {"path": collage_path.name, "file_sha256": sha256_file(collage_path)},
        "measurement_guardrails": ["proposal boxes are locator evidence, not target truth", "software suggestion is measured against frozen final ownership only after the decision", "no single overlap metric certifies success", "residual completeness remains an independent gate"],
    }
    record["workspace_sha256"] = hashlib.sha256(canonical_json_bytes(record)).hexdigest()
    (args.output_dir / "workspace.json").write_bytes(canonical_json_bytes(record)+b"\n")
    print(json.dumps({"output": str(args.output_dir), "workspace_sha256": record["workspace_sha256"], "suggested_component_ids": suggested_ids, "variant_pixels": {k:v["pixels"] for k,v in evidence.items()}}, indent=2))


if __name__ == "__main__":
    main()
