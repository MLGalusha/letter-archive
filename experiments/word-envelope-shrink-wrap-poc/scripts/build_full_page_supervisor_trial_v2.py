#!/usr/bin/env python3
"""Build neutral, answer-blind line packets for the real 007/014 trial.

The older full-page records are used only as untrusted rectangle proposals and
as line-level transcript suggestions.  Review status, confidence, bubbles,
flags, prior decisions, and owned-ink claims are never copied into the public
packet.  The acting model sees numbered rectangles plus a rejectable line-level
transcript, which forces it to perform inventory and alignment itself.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import OrderedDict
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
TRIAL = ROOT / "artifacts/full-page-supervisor-trial-v2"
PRIOR = ROOT / "artifacts/full-page-agent-trial-v1"
TARGET_WIDTH = 1800


PAGE_CONFIG: dict[str, dict[str, Any]] = {
    "007-p02": {
        "source": Path(
            "/Users/masongalusha/Workspace/projects/letter-archive/backend/storage/"
            "collections/007/19430411/L01/007-19430411-L01-02.jpg"
        ),
        "source_sha256": "0bce0fe0b8c4a578b846bf004a36cc7774ecf7cbaeebe4f12106a1b962490312",
        "proposal_record": PRIOR / "final-integrated/007-p02/page-record.json",
        "proposal_file_sha256": "20b35e78f556f7ce5c51860b59df3da89b9e4a7a00504b883f04ceca108a66fc",
        "overview": PRIOR / "worker/page-previews/007-source-preview.jpg",
        "mask": PRIOR / "sol-escalation/draft-auto-gap-v0/007-p02-partial/ink-mask.png",
        "mask_sha256": "3867cc67ea089fb4a6a581fb17b3a376eb86324dcafa653710f1acd37f9cfcc1",
        "mask_role": "provisional_draft_residual_detector_only",
        "line_order": [
            *[f"body-{index:02d}" for index in range(1, 15)],
            "closing-01",
            "closing-02",
            *[f"ps-{index:02d}" for index in range(1, 6)],
            "ps-signoff-01",
        ],
        "stream_rotations": {
            "main-body": 0.0,
            "closing-signature": 0.0,
            "ps-diagonal": 25.0,
            "ps-lower-signoff": 14.0,
        },
        "padding": (115, 105),
    },
    "014-p04": {
        "source": Path(
            "/Users/masongalusha/Workspace/projects/letter-archive/backend/storage/"
            "collections/014/18780127/L01/014-18780127-L01-04.jpg"
        ),
        "source_sha256": "a52f9665c362880699636c45bd6533767c8ff46df996affd6cfca856ed2b2d69",
        "proposal_record": PRIOR / "final-integrated/014-p04/page-record.json",
        "proposal_file_sha256": "adc437853eff19a82c1c6fbaf8740641fffb4f87629b2b395d7dadc949d3f53a",
        "overview": PRIOR / "worker/page-previews/014-source-preview.jpg",
        "mask": PRIOR / "sol-escalation/corrected-v2/014-p04/ink-mask.png",
        "mask_sha256": "f6abe3b5a1c12e966d11379df66fdada0d48cc0046d47456b7c9d80c2e839bba",
        "mask_role": "prior_binary_ink_proposal_for_residual_diagnostics",
        "line_order": [
            *[f"body-{index:02d}" for index in range(1, 24)],
            "closing-01",
            "signature-01",
            "signature-02",
            "signature-03",
            *[f"top-{index:02d}" for index in range(1, 10)],
        ],
        "stream_rotations": {
            "main-body": 0.0,
            "closing": 0.0,
            "signatures": 0.0,
            "top-margin": 90.0,
        },
        "padding": (55, 45),
    },
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_hash(value: object) -> str:
    payload = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
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


def source_bounds(
    units: list[dict[str, Any]], source_size: tuple[int, int], padding: tuple[int, int]
) -> tuple[int, int, int, int]:
    boxes = [unit["source_axis_aligned_bbox_xywh"] for unit in units]
    pad_x, pad_y = padding
    source_width, source_height = source_size
    left = max(0, min(box[0] for box in boxes) - pad_x)
    top = max(0, min(box[1] for box in boxes) - pad_y)
    right = min(source_width, max(box[0] + box[2] for box in boxes) + pad_x)
    bottom = min(source_height, max(box[1] + box[3] for box in boxes) + pad_y)
    return left, top, right, bottom


def save_rgb(image: Image.Image, path: Path, *, quality: int = 92) -> dict[str, Any]:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.convert("RGB").save(path, format="JPEG", quality=quality, optimize=True)
    return {
        "path": str(path.relative_to(ROOT)),
        "sha256": sha256_file(path),
        "display_size": list(Image.open(path).size),
    }


def render_line_assets(
    source: Image.Image,
    page_id: str,
    line_id: str,
    stream_id: str,
    units: list[dict[str, Any]],
    transcript_proposal: list[str],
    padding: tuple[int, int],
    rotation_degrees: float,
) -> dict[str, Any]:
    bounds = source_bounds(units, source.size, padding)
    left, top, right, bottom = bounds
    with source.crop(bounds).convert("RGB") as raw_crop:
        scale = min(1.0, TARGET_WIDTH / raw_crop.width)
        if scale != 1.0:
            display = raw_crop.resize(
                (round(raw_crop.width * scale), round(raw_crop.height * scale)),
                Image.Resampling.LANCZOS,
            )
        else:
            display = raw_crop.copy()

    header_height = 104
    board = Image.new(
        "RGB", (display.width, display.height + header_height), "#f4f1e9"
    )
    board.paste(display, (0, header_height))
    draw = ImageDraw.Draw(board)
    title = f"{page_id} / {line_id} / {stream_id} — UNTRUSTED BOX PROPOSALS"
    transcript = " | ".join(transcript_proposal)
    draw.text((12, 8), title, fill="#111111", font=font(22))
    draw.text(
        (12, 38),
        f"rejectable line transcript: {transcript}",
        fill="#111111",
        font=font(19),
    )
    draw.text(
        (12, 69),
        "One blue style only: color carries no prior accept/reject answer. Check omitted words and order.",
        fill="#333333",
        font=font(17),
    )
    label_font = font(18)
    for index, unit in enumerate(units, start=1):
        x, y, width, height = unit["source_axis_aligned_bbox_xywh"]
        x0 = round((x - left) * scale)
        y0 = round((y - top) * scale) + header_height
        x1 = round((x + width - left) * scale)
        y1 = round((y + height - top) * scale) + header_height
        draw.rectangle((x0, y0, x1, y1), outline="#0868ac", width=3)
        draw.text(
            (x0 + 2, max(header_height, y0 - 21)),
            f"P{index:02d}",
            fill="#0868ac",
            font=label_font,
            stroke_width=2,
            stroke_fill="white",
        )

    out = TRIAL / page_id / "public" / "line-evidence"
    plain_path = out / f"{line_id}--source-plain.jpg"
    board_path = out / f"{line_id}--source-proposals.jpg"
    plain_meta = save_rgb(display, plain_path)
    board_meta = save_rgb(board, board_path)
    display.close()
    board.close()

    upright_plain_meta = None
    upright_board_meta = None
    if rotation_degrees:
        with Image.open(plain_path) as plain:
            upright_plain = plain.rotate(
                rotation_degrees,
                expand=True,
                resample=Image.Resampling.BICUBIC,
                fillcolor="#e5ddc9",
            )
            upright_plain_meta = save_rgb(
                upright_plain, out / f"{line_id}--upright-plain.jpg"
            )
            upright_plain.close()
        with Image.open(board_path) as annotated:
            # Rotate the evidence body, not the header text.  The source board
            # remains the authoritative proposal locator.
            body = annotated.crop((0, header_height, annotated.width, annotated.height))
            upright_body = body.rotate(
                rotation_degrees,
                expand=True,
                resample=Image.Resampling.BICUBIC,
                fillcolor="#e5ddc9",
            )
            upright_board = Image.new(
                "RGB",
                (upright_body.width, upright_body.height + 76),
                "#f4f1e9",
            )
            upright_board.paste(upright_body, (0, 76))
            upright_draw = ImageDraw.Draw(upright_board)
            upright_draw.text(
                (10, 8),
                f"{line_id} upright candidate: source crop rotated {rotation_degrees:+.1f} degrees",
                fill="#111111",
                font=font(21),
            )
            upright_draw.text(
                (10, 39),
                "Verify this direction; registration must fail closed if it is wrong.",
                fill="#333333",
                font=font(17),
            )
            upright_board_meta = save_rgb(
                upright_board, out / f"{line_id}--upright-proposals.jpg"
            )
            body.close()
            upright_body.close()
            upright_board.close()

    return {
        "source_crop_xyxy": list(bounds),
        "source_plain": plain_meta,
        "source_proposals": board_meta,
        "upright_rotation_degrees_proposal": rotation_degrees,
        "upright_plain": upright_plain_meta,
        "upright_proposals": upright_board_meta,
    }


def build(page_id: str) -> Path:
    config = PAGE_CONFIG[page_id]
    source_path: Path = config["source"]
    proposal_path: Path = config["proposal_record"]
    mask_path: Path = config["mask"]
    for path, expected in (
        (source_path, config["source_sha256"]),
        (proposal_path, config["proposal_file_sha256"]),
        (mask_path, config["mask_sha256"]),
    ):
        actual = sha256_file(path)
        if actual != expected:
            raise RuntimeError(f"Input hash changed for {path}: {actual}")

    prior = json.loads(proposal_path.read_text())
    units = prior["units"]
    grouped: OrderedDict[str, list[dict[str, Any]]] = OrderedDict()
    for line_id in config["line_order"]:
        line_units = [unit for unit in units if unit["line_id"] == line_id]
        if not line_units:
            raise RuntimeError(f"Missing proposal line {line_id}")
        grouped[line_id] = line_units

    if sum(len(items) for items in grouped.values()) != len(units):
        unexpected = sorted({unit["line_id"] for unit in units} - set(grouped))
        raise RuntimeError(f"Unordered proposal lines: {unexpected}")

    public_lines: list[dict[str, Any]] = []
    with Image.open(source_path) as source:
        if source.size != tuple(prior["source"].get("size", source.size)):
            # Older records do not consistently store size; opening the bound
            # source remains the authority.
            pass
        for line_index, (line_id, line_units) in enumerate(grouped.items(), start=1):
            stream_id = line_units[0]["stream_id"]
            if any(unit["stream_id"] != stream_id for unit in line_units):
                raise RuntimeError(f"Mixed streams in {line_id}")
            transcript_proposal = [unit["transcript"] for unit in line_units]
            geometry = [
                {
                    "proposal_id": f"{line_id}-P{index:02d}",
                    "proposal_order": index,
                    "source_axis_aligned_bbox_xywh": unit[
                        "source_axis_aligned_bbox_xywh"
                    ],
                }
                for index, unit in enumerate(line_units, start=1)
            ]
            rotation = config["stream_rotations"].get(stream_id, 0.0)
            evidence = render_line_assets(
                source,
                page_id,
                line_id,
                stream_id,
                line_units,
                transcript_proposal,
                config["padding"],
                rotation,
            )
            public_lines.append(
                {
                    "line_id": line_id,
                    "line_reading_order": line_index,
                    "stream_id": stream_id,
                    "registration_status": "pending_agent_review",
                    "transcript_proposal_status": "rejectable_not_ground_truth",
                    "transcript_proposal": transcript_proposal,
                    "box_proposals": geometry,
                    "box_proposals_sha256": canonical_hash(geometry),
                    "evidence": evidence,
                    "required_first_pass_output": {
                        "registration": "approve_or_escalate",
                        "visible_inventory": "accept_revise_drop_or_add_every_region",
                        "alignment": "map_visible_units_to_zero_or_more_transcript_units",
                        "ownership_route": "terra_select_or_sol_or_human",
                    },
                }
            )

    source_size = list(Image.open(source_path).size)
    packet: dict[str, Any] = {
        "schema_version": "full-page-supervisor-trial.public-packet.v2",
        "trial_id": "full-page-supervisor-trial-v2",
        "page_id": page_id,
        "source": {
            "path": str(source_path),
            "sha256": config["source_sha256"],
            "size": source_size,
        },
        "page_run_order": 1 if page_id == "007-p02" else 2,
        "prior_answer_access": False,
        "proposal_policy": {
            "role": "untrusted_upstream_detector_output",
            "copied_fields": [
                "stable_new_proposal_id",
                "line_id",
                "stream_id",
                "source_axis_aligned_bbox_xywh",
                "rejectable_line_level_transcript",
            ],
            "withheld_fields": [
                "prior_unit_id",
                "per_box_transcript_binding",
                "confidence",
                "word_box_status",
                "bubble_status",
                "flags",
                "status_reason",
                "provenance",
                "source_envelope_polygon",
                "prior_review_decisions",
            ],
            "warning": "No proposal or transcript is ground truth. Find omitted visible words before ownership.",
        },
        "workflow_order": [
            "line_registration",
            "visible_inventory",
            "transcript_alignment",
            "owned_ink_selection",
            "exact_mask_knockout_residual_audit",
            "deterministic_envelope",
        ],
        "page_overview_reference": {
            "path": str(config["overview"].relative_to(ROOT)),
            "sha256": sha256_file(config["overview"]),
            "role": "low_resolution_navigation_only",
        },
        "ink_mask_input": {
            "path": str(mask_path.relative_to(ROOT)),
            "sha256": config["mask_sha256"],
            "role": config["mask_role"],
            "warning": "A residual from this mask is a software candidate, not proof of a word omission.",
        },
        "line_count": len(public_lines),
        "proposal_box_count": sum(
            len(line["box_proposals"]) for line in public_lines
        ),
        "lines": public_lines,
    }
    packet["packet_sha256"] = canonical_hash(packet)
    destination = TRIAL / page_id / "public" / "run-packet.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(packet, indent=2, ensure_ascii=False) + "\n")
    return destination


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("page_id", choices=sorted(PAGE_CONFIG))
    args = parser.parse_args()
    path = build(args.page_id)
    print(path)


if __name__ == "__main__":
    main()
