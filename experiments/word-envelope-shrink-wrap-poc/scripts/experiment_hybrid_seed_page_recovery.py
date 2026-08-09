#!/usr/bin/env python3
"""Use hybrid Eynollah foreground as page-adaptive source-ink recovery seeds."""

from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

from word_envelope.io_utils import sha256_file, sha256_mask_pixels
from word_envelope.local_ink_recovery import recover_local_ink_candidates


def load_dark_mask(path: Path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("L"), dtype=np.uint8) == 0


def save_dark_mask(path: Path, mask: np.ndarray) -> None:
    Image.fromarray(np.where(mask, 0, 255).astype(np.uint8), mode="L").save(path, optimize=True)


def font(size: int) -> ImageFont.ImageFont:
    try:
        return ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", size)
    except OSError:
        return ImageFont.load_default(size=size)


def fit(image: Image.Image, width: int, height: int) -> Image.Image:
    image = image.copy()
    image.thumbnail((width, height), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (width, height), "white")
    canvas.paste(image, ((width - image.width) // 2, (height - image.height) // 2))
    return canvas


def mask_image(mask: np.ndarray) -> Image.Image:
    return Image.fromarray(np.where(mask, 0, 255).astype(np.uint8), mode="L").convert("RGB")


def tint_additions(source: Image.Image, anchor: np.ndarray, additions: np.ndarray) -> Image.Image:
    array = np.asarray(source).astype(np.float32)
    array[anchor] = array[anchor] * 0.25 + np.array([0, 170, 185]) * 0.75
    array[additions] = array[additions] * 0.20 + np.array([235, 55, 45]) * 0.80
    return Image.fromarray(np.clip(array, 0, 255).astype(np.uint8))


def render_board(
    source: Image.Image,
    anchor: np.ndarray,
    candidates: dict[str, dict[str, Any]],
    output: Path,
) -> None:
    panels: list[tuple[str, Image.Image]] = [
        ("Original source", source),
        (f"Hybrid p >= 0.50 anchor ({int(anchor.sum()):,} px)", mask_image(anchor)),
    ]
    for name in ("conservative", "balanced", "maximum_recall"):
        item = candidates[name]
        panels.append(
            (
                f"{name.replace('_', ' ').title()} (+{int(item['added_pixels']):,} px)",
                mask_image(item["mask"]),
            )
        )
    maximum = candidates["maximum_recall"]
    panels.append(
        (
            "Maximum overlay: cyan=hybrid, red=recovered source",
            tint_additions(source, anchor, maximum["additions"]),
        )
    )
    cell_w, cell_h, header_h = 620, 720, 62
    board = Image.new("RGB", (cell_w * 3, (cell_h + header_h) * 2), "#f7f3ea")
    draw = ImageDraw.Draw(board)
    label_font = font(17)
    for index, (label, image) in enumerate(panels):
        row, column = divmod(index, 3)
        x, y = column * cell_w, row * (cell_h + header_h)
        draw.text((x + 14, y + 18), label, font=label_font, fill="#1f2526")
        board.paste(fit(image, cell_w - 20, cell_h - 10), (x + 10, y + header_h))
    board.save(output, optimize=True)


def component_metrics(mask: np.ndarray) -> dict[str, Any]:
    labels, count = ndimage.label(mask, structure=np.ones((3, 3), dtype=np.uint8))
    sizes = np.bincount(labels.ravel())[1:] if count else np.array([], dtype=np.int64)
    return {
        "pixels": int(mask.sum()),
        "components": int(count),
        "components_ge_3px": int((sizes >= 3).sum()),
        "components_ge_8px": int((sizes >= 8).sum()),
        "median_component_pixels": float(np.median(sizes)) if len(sizes) else 0.0,
    }


def probability_bands(additions: np.ndarray, probability: np.ndarray) -> dict[str, int]:
    return {
        "p_ge_0.20": int((additions & (probability >= 0.20)).sum()),
        "p_0.05_to_0.20": int((additions & (probability >= 0.05) & (probability < 0.20)).sum()),
        "p_0.01_to_0.05": int((additions & (probability >= 0.01) & (probability < 0.05)).sum()),
        "p_lt_0.01": int((additions & (probability < 0.01)).sum()),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--hybrid-anchor", type=Path, required=True)
    parser.add_argument("--hybrid-probability", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--page-id", required=True)
    args = parser.parse_args()
    started = time.perf_counter()
    args.output.mkdir(parents=True, exist_ok=True)

    source = Image.open(args.source).convert("RGB")
    source_rgb = np.asarray(source, dtype=np.uint8)
    anchor = load_dark_mask(args.hybrid_anchor)
    probability = np.load(args.hybrid_probability).astype(np.float32)
    if source_rgb.shape[:2] != anchor.shape or anchor.shape != probability.shape:
        raise ValueError("Source, anchor, and probability dimensions differ")
    height, width = anchor.shape
    recovered = recover_local_ink_candidates(
        source_rgb,
        anchor,
        np.zeros_like(anchor),
        [0, 0, width, height],
    )

    candidate_records: dict[str, Any] = {}
    render_candidates: dict[str, dict[str, Any]] = {}
    previous = anchor.copy()
    for name in ("conservative", "balanced", "maximum_recall"):
        local = recovered["candidates"][name]
        mask = np.asarray(local["mask"], dtype=bool)
        additions = np.asarray(local["additions"], dtype=bool)
        mask_path = args.output / f"{name}.mask.png"
        additions_path = args.output / f"{name}.additions.png"
        save_dark_mask(mask_path, mask)
        save_dark_mask(additions_path, additions)
        candidate_records[name] = {
            **{key: value for key, value in local.items() if key not in {"mask", "additions"}},
            "mask_file": mask_path.name,
            "mask_file_sha256": sha256_file(mask_path),
            "mask_pixel_sha256": sha256_mask_pixels(mask),
            "addition_file": additions_path.name,
            "addition_file_sha256": sha256_file(additions_path),
            "addition_mask_pixel_sha256": sha256_mask_pixels(additions),
            "mask_metrics": component_metrics(mask),
            "addition_metrics": component_metrics(additions),
            "new_pixels_vs_previous_profile": int((mask & ~previous).sum()),
            "hybrid_probability_bands_for_additions": probability_bands(additions, probability),
        }
        previous = mask
        render_candidates[name] = {**local, "mask": mask, "additions": additions}

    board_path = args.output / "page-adaptive-recovery-review.png"
    render_board(source, anchor, render_candidates, board_path)
    manifest = {
        "schema_version": "hybrid-seed-page-recovery.v1",
        "page_id": args.page_id,
        "evidence_boundary": {
            "sealed_human_evidence_used": False,
            "source_and_software_evidence_only": True,
        },
        "source": {
            "path": str(args.source.resolve()),
            "file_sha256": sha256_file(args.source),
            "size_wh": [width, height],
        },
        "anchor": {
            "path": str(args.hybrid_anchor.resolve()),
            "file_sha256": sha256_file(args.hybrid_anchor),
            "mask_pixel_sha256": sha256_mask_pixels(anchor),
            "pixels": int(anchor.sum()),
        },
        "hybrid_probability": {
            "path": str(args.hybrid_probability.resolve()),
            "file_sha256": sha256_file(args.hybrid_probability),
            "dtype_loaded": "float32 from preserved float16",
        },
        "method": {
            "implementation": "word_envelope.local_ink_recovery.recover_local_ink_candidates",
            "conditioning": "full-page hybrid p0.50 anchor; exact source color residual, local/broad darkness, Sato ridge, proximity, principal writing axis, and straight-artifact penalty",
            "ownership": "none; recovered pixels are proposal evidence only",
            "features": recovered["features"],
            "anchor_colour_residual_vector": recovered["anchor_colour_residual_vector"],
        },
        "candidates": candidate_records,
        "review_board": {"file": board_path.name, "file_sha256": sha256_file(board_path)},
        "runtime_seconds_cpu": time.perf_counter() - started,
        "decision_policy": "Do not promote by recovered-pixel count. Inspect continuity, paper/fold/rule contamination, foreign objects, unresolved words, and later complete-mask correction effort.",
    }
    manifest_path = args.output / "experiment.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
