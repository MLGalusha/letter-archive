#!/usr/bin/env python3
"""Render hash-bound semantic box review boards for canonical 014-p04."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
RECORD = (
    ROOT
    / "artifacts/full-page-agent-trial-v1/sol-escalation"
    / "corrected-v2/014-p04/page-record.json"
)
OUTPUT = (
    ROOT
    / "artifacts/full-page-agent-trial-v1/integration"
    / "014-semantic-line-review/014-p04"
)
TARGET_WIDTH = 1800


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_hash(value: object) -> str:
    payload = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def font(size: int) -> ImageFont.ImageFont:
    for candidate in (
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ):
        try:
            return ImageFont.truetype(candidate, size=size)
        except OSError:
            pass
    return ImageFont.load_default()


def geometry(token: dict) -> dict:
    return {
        "id": token["id"],
        "transcript": token["transcript"],
        "stream_id": token["stream_id"],
        "line_or_island_id": token["line_or_island_id"],
        "source_axis_aligned_bbox_xywh": token["source_axis_aligned_bbox_xywh"],
        "owned_ink_pixels": token["owned_ink_pixels"],
        "owned_ink_pixel_sha256": token["owned_ink_pixel_sha256"],
        "bubble_status": (
            "accepted" if token["envelope_replay"]["status"] == "pass" else "deferred"
        ),
        "shared_component_cut": "semantic_cut_through_shared_component" in token["flags"],
    }


def union_bounds(tokens: list[dict], source_size: tuple[int, int]) -> tuple[int, int, int, int]:
    width, height = source_size
    boxes = [token["source_axis_aligned_bbox_xywh"] for token in tokens]
    left = max(0, min(box[0] for box in boxes) - 22)
    top = max(0, min(box[1] for box in boxes) - 24)
    right = min(width, max(box[0] + box[2] for box in boxes) + 22)
    bottom = min(height, max(box[1] + box[3] for box in boxes) + 24)
    return left, top, right, bottom


def render_board(
    source: Image.Image,
    board_id: str,
    tokens: list[dict],
    destination: Path,
) -> dict:
    bounds = union_bounds(tokens, source.size)
    left, top, right, bottom = bounds
    with source.crop(bounds).convert("RGB") as crop:
        scale = TARGET_WIDTH / crop.width
        display_height = max(1, round(crop.height * scale))
        resized = crop.resize((TARGET_WIDTH, display_height), Image.Resampling.LANCZOS)

    header_height = 82
    board = Image.new("RGB", (TARGET_WIDTH, display_height + header_height), "#f4f1e9")
    board.paste(resized, (0, header_height))
    resized.close()
    draw = ImageDraw.Draw(board)
    transcripts = " | ".join(token["transcript"] for token in tokens)
    draw.text((12, 8), f"{board_id}  |  {transcripts}", fill="#111111", font=font(24))
    draw.text(
        (12, 44),
        "cyan = bubble accepted   red = box present / bubble deferred",
        fill="#444444",
        font=font(20),
    )
    label_font = font(19)
    for index, token in enumerate(tokens, start=1):
        x, y, width, height = token["source_axis_aligned_bbox_xywh"]
        x0 = round((x - left) * scale)
        y0 = round((y - top) * scale) + header_height
        x1 = round((x + width - left) * scale)
        y1 = round((y + height - top) * scale) + header_height
        accepted = token["envelope_replay"]["status"] == "pass"
        color = "#00a6c8" if accepted else "#e43d30"
        draw.rectangle((x0, y0, x1, y1), outline=color, width=3)
        draw.text(
            (x0 + 2, max(header_height, y0 - 21)),
            f'{index}:{token["transcript"]}',
            fill=color,
            font=label_font,
            stroke_width=2,
            stroke_fill="white",
        )
    destination.parent.mkdir(parents=True, exist_ok=True)
    board.save(destination, format="JPEG", quality=91, optimize=True)
    board.close()
    return {
        "path": str(destination.relative_to(ROOT)),
        "sha256": sha256_file(destination),
        "source_crop_xyxy": list(bounds),
        "display_size": [TARGET_WIDTH, display_height + header_height],
    }


def main() -> None:
    page = json.loads(RECORD.read_text())
    source_path = Path(page["source"]["path"])
    if sha256_file(source_path) != page["source"]["sha256"]:
        raise RuntimeError("014 source hash changed")

    tokens = page["tokens"]
    body_groups = [
        (f"body-{index:02d}", [
            token for token in tokens if token["line_or_island_id"] == f"body-{index:02d}"
        ])
        for index in range(1, 24)
    ]
    groups = body_groups + [
        ("closing-all", [token for token in tokens if token["stream_id"] == "closing"]),
        ("top-margin-all", [token for token in tokens if token["stream_id"] == "top-margin"]),
        ("signatures-all", [token for token in tokens if token["stream_id"] == "signatures"]),
    ]
    if any(not group_tokens for _, group_tokens in groups):
        raise RuntimeError("A required 014 review group is empty")

    records = []
    with Image.open(source_path) as source:
        for board_id, group_tokens in groups:
            ordered = sorted(group_tokens, key=lambda token: token["reading_order"])
            unit_geometry = [geometry(token) for token in ordered]
            review_board = render_board(
                source,
                board_id,
                ordered,
                OUTPUT / "boards" / f"{board_id}.jpg",
            )
            records.append(
                {
                    "board_id": board_id,
                    "stream_ids": sorted({token["stream_id"] for token in ordered}),
                    "unit_count": len(ordered),
                    "unit_geometry": unit_geometry,
                    "unit_geometry_sha256": canonical_hash(unit_geometry),
                    "review_board": review_board,
                    "word_box_status": "pending_independent_review",
                }
            )

    manifest = {
        "schema_version": "014-semantic-line-review.v1",
        "page_id": page["page_id"],
        "source": page["source"],
        "canonical_record_path": str(RECORD.relative_to(ROOT)),
        "canonical_record_file_sha256": sha256_file(RECORD),
        "canonical_record_internal_sha256": page["record_sha256"],
        "review_policy": "whole visible semantic unit ownership; ignore bubble color",
        "shared_component_cut_count": sum(
            "semantic_cut_through_shared_component" in token["flags"] for token in tokens
        ),
        "boards": records,
    }
    manifest["manifest_sha256"] = canonical_hash(manifest)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / "review-manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n"
    )


if __name__ == "__main__":
    main()
