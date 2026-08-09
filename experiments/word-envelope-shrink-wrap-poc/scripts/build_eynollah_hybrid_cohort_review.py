#!/usr/bin/env python3
"""Build an acting-safe review board and exact cohort summary for Eynollah trials."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont, ImageOps


REVIEW_NOTES = {
    "001-18881103-L01-01": (
        "Strong handwriting extraction, but glass-weight rings and the page edge are "
        "also high-confidence foreground. Geometry filtering is required."
    ),
    "002-19001113-L01-02": (
        "Strong whole-page extraction across folded paper; folds and most paper texture "
        "remain suppressed."
    ),
    "003-18860314-L01-01": (
        "Recovers many faint words and line portions omitted by the 2021 convolutional "
        "checkpoint while still suppressing rules and the central fold."
    ),
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fit_image(path: Path, width: int, height: int) -> Image.Image:
    with Image.open(path) as opened:
        image = opened.convert("RGB")
    image.thumbnail((width, height), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (width, height), "white")
    canvas.paste(image, ((width - image.width) // 2, (height - image.height) // 2))
    return canvas


def draw_wrapped(
    draw: ImageDraw.ImageDraw,
    text: str,
    xy: tuple[int, int],
    max_width: int,
    font: ImageFont.ImageFont,
    fill: str,
) -> None:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if draw.textbbox((0, 0), candidate, font=font)[2] <= max_width:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    x, y = xy
    for line in lines:
        draw.text((x, y), line, font=font, fill=fill)
        y += 23


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    args = parser.parse_args()
    root = args.root.resolve()

    records: list[dict[str, Any]] = []
    for manifest_path in sorted(root.glob("*/experiment.json")):
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        page_id = manifest["page_id"]
        if page_id not in REVIEW_NOTES:
            continue
        page_root = manifest_path.parent
        records.append(
            {
                "manifest": manifest,
                "manifest_path": manifest_path,
                "source_path": Path(manifest["input"]["path"]),
                "p050_path": page_root / manifest["thresholds"]["0.50"]["file"],
                "p020_path": page_root / manifest["thresholds"]["0.20"]["file"],
            }
        )
    if len(records) != 3:
        raise ValueError(f"Expected exactly three reviewed pages, found {len(records)}")

    cell_w, cell_h = 560, 650
    left = 30
    header_h = 94
    note_h = 78
    board = Image.new("RGB", (left * 2 + cell_w * 3, header_h + len(records) * (cell_h + note_h)), "#f7f3ea")
    draw = ImageDraw.Draw(board)
    font = ImageFont.load_default(size=19)
    small = ImageFont.load_default(size=16)
    draw.text((left, 18), "Eynollah/SBB hybrid CNN-Transformer: three acting-safe pages", font=font, fill="#1f2526")
    for index, label in enumerate(("Original source", "Hybrid foreground p >= 0.50", "Hybrid foreground p >= 0.20")):
        draw.text((left + index * cell_w + 8, 58), label, font=small, fill="#245e63")

    for row, record in enumerate(records):
        manifest = record["manifest"]
        page_id = manifest["page_id"]
        top = header_h + row * (cell_h + note_h)
        for column, key in enumerate(("source_path", "p050_path", "p020_path")):
            x = left + column * cell_w
            panel = fit_image(record[key], cell_w - 16, cell_h - 16)
            board.paste(panel, (x + 8, top + 8))
            draw.rectangle((x + 7, top + 7, x + cell_w - 8, top + cell_h - 8), outline="#cfc6b4", width=1)
        note_y = top + cell_h + 8
        p050 = manifest["thresholds"]["0.50"]
        draw.text((left + 8, note_y), f"{page_id} · p0.50 {p050['pixels']:,} px · {manifest['runtime']['wall_seconds']:.2f}s CPU", font=small, fill="#1f2526")
        draw_wrapped(draw, REVIEW_NOTES[page_id], (left + 520, note_y), cell_w * 2 - 505, small, "#5b4132")

    board_path = root / "cohort-p050-p020-review.png"
    board.save(board_path, optimize=True)

    model = records[0]["manifest"]["model"]
    summary = {
        "schema_version": "eynollah-hybrid-binarization-cohort.v1",
        "created_date": "2026-08-09",
        "evidence_boundary": {
            "sealed_human_evidence_used": False,
            "source_pages_only": True,
            "claim": "Acting-safe characterization; not a semantic ownership evaluation.",
        },
        "model": {
            "label": model["label"],
            "release": model["release"],
            "source": model["source"],
            "parameters": model["parameters"],
            "architecture_observed": model["architecture_observed"],
            "saved_model_file_sha256": "63cfe676b63569e7cbebf05567448834945e9be9c35bcf3dbce59312ca0d1902",
            "keras_metadata_file_sha256": "ca18795a986844bf1c147950ddca70975df736f87994477252f0088f4c65882e",
            "variables_data_file_sha256": "965b62227ce6e572203662a67c1d0d232b996acdc68bbaae26f93cc15ce40458",
            "variables_index_file_sha256": "17de8e34f380d0b7c631dff48e1ac21660bc9503f7da7ecff72d36156f8dd87d",
        },
        "pages": [],
        "review_board": {
            "path": str(board_path),
            "file_sha256": sha256_file(board_path),
        },
        "decision": {
            "status": "promising_candidate_not_ownership_truth",
            "promote": [
                "Preserve hybrid foreground probability as the primary candidate-ink layer.",
                "Use old-model/hybrid agreement as an ultra-conservative positive seed.",
                "Test hybrid p0.50 inside page, text-region, and fitted-line geometry.",
            ],
            "do_not_promote": [
                "Do not treat full-page hybrid foreground as handwriting-only.",
                "Do not use a lower global threshold as the main recovery mechanism.",
                "Do not infer word ownership or fitted boxes from binarization alone.",
            ],
            "next_bounded_test": (
                "Compare line-conditioned hybrid p0.50 and seed-driven page-adaptive graph "
                "propagation on the same three pages before exposing a default UI layer."
            ),
        },
    }
    for record in records:
        manifest = record["manifest"]
        page_id = manifest["page_id"]
        summary["pages"].append(
            {
                "page_id": page_id,
                "input_sha256": manifest["input"]["file_sha256"],
                "experiment_manifest_sha256": sha256_file(record["manifest_path"]),
                "runtime_seconds_cpu": manifest["runtime"]["wall_seconds"],
                "p0.50": manifest["thresholds"]["0.50"],
                "p0.20": manifest["thresholds"]["0.20"],
                "visual_review": REVIEW_NOTES[page_id],
            }
        )
    summary_path = root / "cohort-summary.json"
    summary_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"summary": str(summary_path), "board": summary["review_board"]}, indent=2))


if __name__ == "__main__":
    main()
