#!/usr/bin/env python3
"""Build a transcript-blind visible-unit inventory packet from public proposals."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
TRIAL = ROOT / "artifacts/full-page-supervisor-trial-v2"
TARGET_WIDTH = 1800


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_hash(value: object) -> str:
    return hashlib.sha256(
        json.dumps(
            value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
    ).hexdigest()


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


def render_board(
    source: Image.Image,
    line: dict[str, Any],
    destination: Path,
) -> dict[str, Any]:
    left, top, right, bottom = line["evidence"]["source_crop_xyxy"]
    with source.crop((left, top, right, bottom)).convert("RGB") as crop:
        scale = min(1.0, TARGET_WIDTH / crop.width)
        if scale != 1.0:
            body = crop.resize(
                (round(crop.width * scale), round(crop.height * scale)),
                Image.Resampling.LANCZOS,
            )
        else:
            body = crop.copy()
    header_height = 90
    board = Image.new("RGB", (body.width, body.height + header_height), "#f4f1e9")
    board.paste(body, (0, header_height))
    draw = ImageDraw.Draw(board)
    draw.text(
        (12, 8),
        f"{line['line_id']} / {line['stream_id']} — TRANSCRIPT HIDDEN",
        fill="#111111",
        font=font(22),
    )
    draw.text(
        (12, 40),
        "Count visible word-like units first. Rectangles are untrusted proposals; add, split, merge, revise, or drop.",
        fill="#333333",
        font=font(17),
    )
    for proposal in line["box_proposals"]:
        x, y, width, height = proposal["source_axis_aligned_bbox_xywh"]
        x0 = round((x - left) * scale)
        y0 = round((y - top) * scale) + header_height
        x1 = round((x + width - left) * scale)
        y1 = round((y + height - top) * scale) + header_height
        draw.rectangle((x0, y0, x1, y1), outline="#0868ac", width=3)
        draw.text(
            (x0 + 2, max(header_height, y0 - 21)),
            proposal["proposal_id"].rsplit("-", 1)[-1],
            fill="#0868ac",
            font=font(18),
            stroke_width=2,
            stroke_fill="white",
        )
    destination.parent.mkdir(parents=True, exist_ok=True)
    board.save(destination, format="JPEG", quality=92, optimize=True)
    size = list(board.size)
    body.close()
    board.close()
    return {
        "path": str(destination.relative_to(ROOT)),
        "sha256": sha256_file(destination),
        "display_size": size,
        "source_crop_xyxy": [left, top, right, bottom],
    }


def build(page_id: str) -> Path:
    public_packet_path = TRIAL / page_id / "public/run-packet.json"
    public = json.loads(public_packet_path.read_text())
    if public["page_id"] != page_id:
        raise RuntimeError("public packet page mismatch")
    basis = dict(public)
    observed_hash = basis.pop("packet_sha256")
    if canonical_hash(basis) != observed_hash:
        raise RuntimeError("public packet hash drift")
    source_path = Path(public["source"]["path"])
    if sha256_file(source_path) != public["source"]["sha256"]:
        raise RuntimeError("source hash drift")

    lines = []
    with Image.open(source_path) as source:
        for line in public["lines"]:
            board = render_board(
                source,
                line,
                TRIAL
                / page_id
                / "public/inventory-blind/line-evidence"
                / f"{line['line_id']}--inventory-blind.jpg",
            )
            lines.append(
                {
                    "line_id": line["line_id"],
                    "line_reading_order": line["line_reading_order"],
                    "stream_id": line["stream_id"],
                    "box_proposals": line["box_proposals"],
                    "box_proposals_sha256": line["box_proposals_sha256"],
                    "source_plain": line["evidence"]["source_plain"],
                    "inventory_blind_proposals": board,
                    "upright_rotation_degrees_proposal": line["evidence"][
                        "upright_rotation_degrees_proposal"
                    ],
                    "upright_plain": line["evidence"]["upright_plain"],
                }
            )

    packet: dict[str, Any] = {
        "schema_version": "full-page-supervisor-inventory-blind-packet.v2",
        "trial_id": "full-page-supervisor-trial-v2",
        "page_id": page_id,
        "page_run_order": public["page_run_order"],
        "source": public["source"],
        "parent_public_packet_sha256": public["packet_sha256"],
        "transcript_access": False,
        "hidden_prior_answer_access": False,
        "instruction": (
            "Inventory visible word-like units in directed reading order before "
            "any transcript is revealed. Account for every proposal exactly once."
        ),
        "line_count": len(lines),
        "proposal_box_count": sum(len(line["box_proposals"]) for line in lines),
        "lines": lines,
    }
    packet["packet_sha256"] = canonical_hash(packet)
    destination = TRIAL / page_id / "public/inventory-blind/run-packet.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(packet, indent=2, ensure_ascii=False) + "\n")
    return destination


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("page_id", choices=("007-p02", "014-p04"))
    args = parser.parse_args()
    print(build(args.page_id))


if __name__ == "__main__":
    main()
