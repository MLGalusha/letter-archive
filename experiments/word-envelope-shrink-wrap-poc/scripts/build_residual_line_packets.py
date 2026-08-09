#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from word_envelope.io_utils import canonical_json_bytes, sha256_file  # noqa: E402
from word_envelope.simple_page_agent import _hash_record  # noqa: E402


def font(size: int):
    try:
        return ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", size)
    except OSError:
        return ImageFont.load_default()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--selector-dir", type=Path, required=True)
    parser.add_argument("--knockout-dir", type=Path, required=True)
    parser.add_argument("--scan-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    selector = args.selector_dir.resolve()
    knockout_dir = args.knockout_dir.resolve()
    scan_dir = args.scan_dir.resolve()
    output = args.output_dir.resolve()
    if output.exists() or output.is_symlink():
        raise ValueError("residual line packets already exist")
    manifest = json.loads((selector / "manifest.json").read_text("utf-8"))
    knockout = json.loads((knockout_dir / "knockout.json").read_text("utf-8"))
    scan_packet = json.loads((scan_dir / "packet.json").read_text("utf-8"))
    scan = json.loads((scan_dir / "decision.json").read_text("utf-8"))
    scan_schema = json.loads((scan_dir / "response-schema.json").read_text("utf-8"))
    errors = list(Draft202012Validator(scan_schema).iter_errors(scan))
    if errors:
        raise ValueError(errors[0].message)
    width, height = manifest["source"]["size_wh"]
    source_path = selector / manifest["source"]["working_path"]
    residual_path = knockout_dir / knockout["evidence"]["residual_mask"]["path"]
    with Image.open(source_path) as image:
        source = image.convert("RGB")
    with Image.open(residual_path) as image:
        residual = np.asarray(image.convert("L"), dtype=np.uint8) > 0
    output.mkdir(parents=True)
    protocol = output / "protocol"
    protocol.mkdir()
    prompt_source = ROOT / "prompts/residual-line-word-selector-v1.md"
    schema_source = ROOT / "schemas/line-batch-word-selection-v1.schema.json"
    (protocol / "prompt.md").write_bytes(prompt_source.read_bytes())
    (protocol / "response-schema.json").write_bytes(schema_source.read_bytes())
    entries = []
    source_scale_x = width / scan_packet["coordinate_space"]["size_wh"][0]
    source_scale_y = height / scan_packet["coordinate_space"]["size_wh"][1]
    for region in scan["missing_line_regions"]:
        rx, ry, rw, rh = region["bbox_xywh"]
        x0 = max(0, round(rx * source_scale_x) - 90)
        y0 = max(0, round(ry * source_scale_y) - 90)
        x1 = min(width, round((rx + rw) * source_scale_x) + 90)
        y1 = min(height, round((ry + rh) * source_scale_y) + 90)
        crop_width, crop_height = x1 - x0, y1 - y0
        scale = min(1.0, 1400 / crop_width, 600 / crop_height)
        panel_wh = (round(crop_width * scale), round(crop_height * scale))
        original = source.crop((x0, y0, x1, y1)).resize(panel_wh, Image.Resampling.LANCZOS)
        residual_crop = residual[y0:y1, x0:x1]
        ink = np.full((*residual_crop.shape, 3), 250, dtype=np.uint8)
        ink[residual_crop] = (20, 20, 20)
        ink_image = Image.fromarray(ink, mode="RGB").resize(panel_wh, Image.Resampling.NEAREST)
        collage = Image.new("RGB", (panel_wh[0] * 2 + 12, panel_wh[1] + 46), (248, 243, 233))
        collage.paste(original, (0, 46))
        collage.paste(ink_image, (panel_wh[0] + 12, 46))
        draw = ImageDraw.Draw(collage)
        draw.text((8, 10), "Original context", fill=(35, 35, 35), font=font(22))
        draw.text((panel_wh[0] + 20, 10), "Residual ink only", fill=(35, 35, 35), font=font(22))
        line_id = f"residual-{region['region_order']:03d}"
        line_dir = output / line_id
        line_dir.mkdir()
        collage.save(line_dir / "collage.png", format="PNG", optimize=True)
        packet = {
            "schema_version": "residual-line-word-packet.v1",
            "line_id": line_id,
            "region_order": region["region_order"],
            "reading_direction": region["reading_direction"],
            "content_order": ["prompt", "packet", "response_schema", "collage"],
            "prompt": {"path": "../protocol/prompt.md", "file_sha256": sha256_file(protocol / "prompt.md")},
            "response_schema": {"path": "../protocol/response-schema.json", "file_sha256": sha256_file(protocol / "response-schema.json")},
            "coordinate_space": {
                "origin": "right_residual_panel_content_top_left",
                "size_wh": list(panel_wh),
                "source_crop_xywh": [x0, y0, crop_width, crop_height],
                "preview_to_source_scale": 1.0 / scale,
            },
            "proposals": [],
            "collage": {"path": "collage.png", "file_sha256": sha256_file(line_dir / "collage.png"), "size_wh": list(collage.size)},
        }
        packet["packet_sha256"] = _hash_record(packet, "packet_sha256")
        (line_dir / "packet.json").write_bytes(canonical_json_bytes(packet) + b"\n")
        entries.append({"line_id": line_id, "packet_path": f"{line_id}/packet.json", "packet_sha256": packet["packet_sha256"]})
    session = {
        "schema_version": "residual-line-word-session.v1",
        "knockout_sha256": knockout["knockout_sha256"],
        "scan_packet_sha256": scan_packet["packet_sha256"],
        "scan_decision_file_sha256": sha256_file(scan_dir / "decision.json"),
        "line_count": len(entries),
        "lines": entries,
    }
    session["session_sha256"] = _hash_record(session, "session_sha256")
    (output / "session.json").write_bytes(canonical_json_bytes(session) + b"\n")
    print(json.dumps(session, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
