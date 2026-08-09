#!/usr/bin/env python3
"""Render low-memory, transcript-bound review boards for the 007 main body."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
STAGE_11 = (
    ROOT
    / "artifacts/full-page-agent-trial-v1/worker"
    / "stage-11-transcript-bound-007-final/007-p02"
)
OUTPUT = (
    ROOT
    / "artifacts/full-page-agent-trial-v1/integration"
    / "stage-12-serial-line-review/007-p02"
)
TARGET_WIDTH = 1800


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_sha256(value: object) -> str:
    payload = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return sha256_bytes(payload)


def unit_geometry(unit: dict) -> dict:
    return {
        "id": unit["id"],
        "transcript": unit["transcript"],
        "unit_type": unit["unit_type"],
        "source_axis_aligned_bbox_xywh": unit["source_axis_aligned_bbox_xywh"],
        "owned_ink_pixel_sha256": unit["owned_ink_pixel_sha256"],
        "owned_ink_pixels": unit["owned_ink_pixels"],
        "source_envelope_polygon_sha256": (
            unit.get("envelope", {}).get("polygon_sha256")
            if unit.get("envelope")
            else None
        ),
        "bubble_status": "accepted" if unit.get("source_envelope_polygon") else "deferred",
    }


def font(size: int) -> ImageFont.ImageFont:
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size=size)
        except OSError:
            pass
    return ImageFont.load_default()


def render_board(
    source: Image.Image,
    line: dict,
    units: list[dict],
    output_path: Path,
) -> dict:
    line_x, line_y, line_w, line_h = line["source_line_box_xywh"]
    pad_x = 45
    pad_y = 45
    left = max(0, line_x - pad_x)
    top = max(0, line_y - pad_y)
    right = min(source.width, line_x + line_w + pad_x)
    bottom = min(source.height, line_y + line_h + pad_y)

    with source.crop((left, top, right, bottom)).convert("RGB") as crop:
        scale = TARGET_WIDTH / crop.width
        image_height = max(1, round(crop.height * scale))
        resized = crop.resize((TARGET_WIDTH, image_height), Image.Resampling.LANCZOS)

    header_height = 78
    board = Image.new("RGB", (TARGET_WIDTH, image_height + header_height), "#f4f1e9")
    board.paste(resized, (0, header_height))
    resized.close()
    draw = ImageDraw.Draw(board)
    title_font = font(24)
    label_font = font(20)
    draw.text(
        (14, 10),
        f'{line["line_id"]}  |  {line["exact_line_transcript"]}',
        fill="#111111",
        font=title_font,
    )
    draw.text(
        (14, 42),
        "cyan = bubble accepted   red = box present / bubble deferred",
        fill="#444444",
        font=label_font,
    )

    for index, unit in enumerate(units, start=1):
        x, y, width, height = unit["source_axis_aligned_bbox_xywh"]
        x0 = round((x - left) * scale)
        y0 = round((y - top) * scale) + header_height
        x1 = round((x + width - left) * scale)
        y1 = round((y + height - top) * scale) + header_height
        accepted = unit.get("source_envelope_polygon") is not None
        color = "#00a6c8" if accepted else "#e43d30"
        draw.rectangle((x0, y0, x1, y1), outline=color, width=3)
        label = f'{index}:{unit["transcript"]}'
        label_y = max(header_height, y0 - 22)
        draw.text((x0 + 2, label_y), label, fill=color, font=label_font, stroke_width=2, stroke_fill="white")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    board.save(output_path, format="JPEG", quality=90, optimize=True)
    board.close()
    return {
        "path": str(output_path.relative_to(ROOT)),
        "sha256": sha256_file(output_path),
        "source_crop_xyxy": [left, top, right, bottom],
        "display_size": [TARGET_WIDTH, image_height + header_height],
    }


def main() -> None:
    page_record = json.loads((STAGE_11 / "semantic-page-record.json").read_text())
    line_record_file = json.loads((STAGE_11 / "line-records.json").read_text())
    lines = line_record_file["line_records"]
    units = page_record["units"]
    source_path = Path(page_record["source"]["path"])
    expected_source_sha = page_record["source"]["sha256"]
    if sha256_file(source_path) != expected_source_sha:
        raise RuntimeError("Source hash changed")

    output_lines: list[dict] = []
    board_dir = OUTPUT / "line-boards"
    with Image.open(source_path) as source:
        for line in lines:
            line_units = [
                unit for unit in units if unit["line_island_id"] == line["line_id"]
            ]
            if len(line_units) != line["semantic_unit_count"]:
                raise RuntimeError(f'Unit count mismatch for {line["line_id"]}')
            geometry = [unit_geometry(unit) for unit in line_units]
            board = render_board(
                source,
                line,
                line_units,
                board_dir / f'{line["line_id"]}.jpg',
            )
            output_lines.append(
                {
                    **line,
                    "unit_geometry_sha256": canonical_sha256(geometry),
                    "unit_geometry": geometry,
                    "review_board": board,
                    "word_box_status": "pending_independent_review",
                    "bubble_status": (
                        "accepted"
                        if all(item["bubble_status"] == "accepted" for item in geometry)
                        else "partially_deferred"
                    ),
                }
            )

    manifest = {
        "schema_version": "transcript-bound-serial-line-review.v1",
        "page_id": page_record["page_id"],
        "source": page_record["source"],
        "stage_11_record_sha256": sha256_file(STAGE_11 / "semantic-page-record.json"),
        "memory_policy": {
            "render_strategy": "one_source_crop_and_board_at_a_time",
            "adaptive_envelope_retry_performed": False,
            "reason": "Stage 12 adaptive retry stopped at the 450 MiB POC guard",
        },
        "line_records": output_lines,
    }
    manifest["manifest_sha256"] = canonical_sha256(manifest)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / "line-review-manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n"
    )


if __name__ == "__main__":
    main()
