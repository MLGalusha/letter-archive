#!/usr/bin/env python3
"""Render a detailed crop from a frozen hybrid-seed page-recovery run."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_dark(path: Path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("L"), dtype=np.uint8) == 0


def mask_image(mask: np.ndarray) -> Image.Image:
    return Image.fromarray(np.where(mask, 0, 255).astype(np.uint8), mode="L").convert("RGB")


def overlay(source: np.ndarray, anchor: np.ndarray, additions: np.ndarray) -> Image.Image:
    result = source.astype(np.float32).copy()
    result[anchor] = result[anchor] * 0.25 + np.array([0, 170, 185]) * 0.75
    result[additions] = result[additions] * 0.20 + np.array([235, 55, 45]) * 0.80
    return Image.fromarray(np.clip(result, 0, 255).astype(np.uint8))


def fit(image: Image.Image, width: int, height: int) -> Image.Image:
    image = image.copy()
    image.thumbnail((width, height), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (width, height), "white")
    canvas.paste(image, ((width - image.width) // 2, (height - image.height) // 2))
    return canvas


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("run", type=Path)
    parser.add_argument("--margin", type=int, default=120)
    args = parser.parse_args()
    run = args.run.resolve()
    manifest = json.loads((run / "experiment.json").read_text(encoding="utf-8"))
    source = np.asarray(Image.open(manifest["source"]["path"]).convert("RGB"), dtype=np.uint8)
    anchor = load_dark(Path(manifest["anchor"]["path"]))
    candidates = {
        name: {
            "mask": load_dark(run / manifest["candidates"][name]["mask_file"]),
            "additions": load_dark(run / manifest["candidates"][name]["addition_file"]),
        }
        for name in ("conservative", "balanced", "maximum_recall")
    }
    ys, xs = np.nonzero(anchor)
    x0 = max(0, int(xs.min()) - args.margin)
    y0 = max(0, int(ys.min()) - args.margin)
    x1 = min(anchor.shape[1], int(xs.max()) + 1 + args.margin)
    y1 = min(anchor.shape[0], int(ys.max()) + 1 + args.margin)
    crop = (x0, y0, x1, y1)

    source_crop = source[y0:y1, x0:x1]
    anchor_crop = anchor[y0:y1, x0:x1]
    panels = [
        ("Original writing crop", Image.fromarray(source_crop)),
        ("Hybrid p >= 0.50", mask_image(anchor_crop)),
        ("Conservative recovered mask", mask_image(candidates["conservative"]["mask"][y0:y1, x0:x1])),
        (
            "Conservative overlay: cyan=hybrid, red=recovered",
            overlay(source_crop, anchor_crop, candidates["conservative"]["additions"][y0:y1, x0:x1]),
        ),
        ("Balanced additions only", mask_image(candidates["balanced"]["additions"][y0:y1, x0:x1])),
        ("Maximum-recall additions only", mask_image(candidates["maximum_recall"]["additions"][y0:y1, x0:x1])),
    ]
    cell_w, cell_h, header_h = 720, 760, 62
    board = Image.new("RGB", (cell_w * 3, (cell_h + header_h) * 2), "#f7f3ea")
    draw = ImageDraw.Draw(board)
    label_font = ImageFont.load_default(size=18)
    for index, (label, image) in enumerate(panels):
        row, column = divmod(index, 3)
        x, y = column * cell_w, row * (cell_h + header_h)
        draw.text((x + 14, y + 18), label, font=label_font, fill="#1f2526")
        board.paste(fit(image, cell_w - 20, cell_h - 10), (x + 10, y + header_h))
    output = run / "main-writing-recovery-detail.png"
    board.save(output, optimize=True)
    print(json.dumps({"crop_bbox_xyxy": list(crop), "file": output.name, "file_sha256": sha256_file(output)}, indent=2))


if __name__ == "__main__":
    main()
