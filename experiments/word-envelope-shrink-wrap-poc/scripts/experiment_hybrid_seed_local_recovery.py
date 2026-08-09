#!/usr/bin/env python3
"""Test Eynollah-seeded source recovery inside predeclared local writing crops."""

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


def parse_crop(value: str) -> tuple[str, list[int]]:
    label, coordinates = value.split(":", 1)
    crop = [int(item) for item in coordinates.split(",")]
    if len(crop) != 4:
        raise argparse.ArgumentTypeError("crop must be label:x,y,width,height")
    return label, crop


def load_dark(path: Path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("L"), dtype=np.uint8) == 0


def save_dark(path: Path, mask: np.ndarray) -> None:
    Image.fromarray(np.where(mask, 0, 255).astype(np.uint8), mode="L").save(path, optimize=True)


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


def render_crop_board(
    source: np.ndarray,
    anchor: np.ndarray,
    candidates: dict[str, dict[str, np.ndarray]],
    output: Path,
    label: str,
) -> None:
    panels = [("Source crop", Image.fromarray(source)), ("Hybrid anchor", overlay(source, anchor, np.zeros_like(anchor)))]
    for name in ("conservative", "balanced", "maximum_recall"):
        panels.append((name.replace("_", " ").title(), overlay(source, anchor, candidates[name]["additions"])))
    cell_w, cell_h, header_h = 520, 330, 58
    board = Image.new("RGB", (cell_w * 5, cell_h + header_h), "#f7f3ea")
    draw = ImageDraw.Draw(board)
    text_font = ImageFont.load_default(size=17)
    for column, (panel_label, image) in enumerate(panels):
        x = column * cell_w
        draw.text((x + 12, 8), f"{label}: {panel_label}", font=text_font, fill="#1f2526")
        if column >= 2:
            count = int(candidates[("conservative", "balanced", "maximum_recall")[column - 2]]["additions"].sum())
            draw.text((x + 12, 31), f"red additions: {count:,} px", font=text_font, fill="#a62f2f")
        board.paste(fit(image, cell_w - 16, cell_h - 8), (x + 8, header_h))
    board.save(output, optimize=True)


def component_count(mask: np.ndarray) -> int:
    return int(ndimage.label(mask, structure=np.ones((3, 3), dtype=np.uint8))[1])


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
    parser.add_argument("--crop", type=parse_crop, action="append", required=True)
    args = parser.parse_args()
    started = time.perf_counter()
    args.output.mkdir(parents=True, exist_ok=True)

    source_image = Image.open(args.source).convert("RGB")
    source = np.asarray(source_image, dtype=np.uint8)
    anchor = load_dark(args.hybrid_anchor)
    probability = np.load(args.hybrid_probability).astype(np.float32)
    if source.shape[:2] != anchor.shape or anchor.shape != probability.shape:
        raise ValueError("Source, anchor, and probability dimensions differ")

    crop_records: dict[str, Any] = {}
    review_boards: list[Path] = []
    for label, bbox in args.crop:
        x, y, width, height = bbox
        if x < 0 or y < 0 or x + width > source.shape[1] or y + height > source.shape[0]:
            raise ValueError(f"Crop {label} falls outside source")
        result = recover_local_ink_candidates(source, anchor, np.zeros_like(anchor), bbox)
        local_source = source[y : y + height, x : x + width]
        local_anchor = anchor[y : y + height, x : x + width]
        local_probability = probability[y : y + height, x : x + width]
        render_candidates: dict[str, dict[str, np.ndarray]] = {}
        profile_records: dict[str, Any] = {}
        crop_root = args.output / label
        crop_root.mkdir(parents=True, exist_ok=True)
        for name in ("conservative", "balanced", "maximum_recall"):
            item = result["candidates"][name]
            mask = np.asarray(item["mask"], dtype=bool)
            additions = np.asarray(item["additions"], dtype=bool)
            mask_path = crop_root / f"{name}.mask.png"
            additions_path = crop_root / f"{name}.additions.png"
            save_dark(mask_path, mask)
            save_dark(additions_path, additions)
            profile_records[name] = {
                **{key: value for key, value in item.items() if key not in {"mask", "additions"}},
                "mask_file": str(mask_path.relative_to(args.output)),
                "mask_file_sha256": sha256_file(mask_path),
                "mask_pixel_sha256": sha256_mask_pixels(mask),
                "addition_file": str(additions_path.relative_to(args.output)),
                "addition_file_sha256": sha256_file(additions_path),
                "addition_mask_pixel_sha256": sha256_mask_pixels(additions),
                "addition_component_count": component_count(additions),
                "hybrid_probability_bands_for_additions": probability_bands(additions, local_probability),
            }
            render_candidates[name] = {"mask": mask, "additions": additions}
        board_path = crop_root / "review.png"
        render_crop_board(local_source, local_anchor, render_candidates, board_path, label)
        review_boards.append(board_path)
        crop_records[label] = {
            "bbox_xywh": bbox,
            "selection_role": "predeclared acting-safe source-visible difficult writing crop",
            "anchor_pixels": int(local_anchor.sum()),
            "anchor_colour_residual_vector": result["anchor_colour_residual_vector"],
            "features": result["features"],
            "profiles": profile_records,
            "review_board": {"file": str(board_path.relative_to(args.output)), "file_sha256": sha256_file(board_path)},
        }

    opened_boards = [Image.open(path).convert("RGB") for path in review_boards]
    cohort_width = 2600
    resized_boards: list[Image.Image] = []
    for board in opened_boards:
        height = round(board.height * cohort_width / board.width)
        resized_boards.append(board.resize((cohort_width, height), Image.Resampling.LANCZOS))
    cohort_board = Image.new(
        "RGB",
        (cohort_width, sum(board.height for board in resized_boards)),
        "#f7f3ea",
    )
    offset_y = 0
    for board in resized_boards:
        cohort_board.paste(board, (0, offset_y))
        offset_y += board.height
    cohort_board_path = args.output / "local-recovery-cohort-review.png"
    cohort_board.save(cohort_board_path, optimize=True)

    manifest = {
        "schema_version": "hybrid-seed-local-recovery.v1",
        "page_id": args.page_id,
        "evidence_boundary": {"sealed_human_evidence_used": False, "source_and_software_evidence_only": True},
        "source": {"path": str(args.source.resolve()), "file_sha256": sha256_file(args.source)},
        "anchor": {"path": str(args.hybrid_anchor.resolve()), "file_sha256": sha256_file(args.hybrid_anchor), "mask_pixel_sha256": sha256_mask_pixels(anchor)},
        "hybrid_probability": {"path": str(args.hybrid_probability.resolve()), "file_sha256": sha256_file(args.hybrid_probability)},
        "method": "Existing local source-colour/ridge recovery, conditioned by hybrid p0.50 only inside each predeclared crop; proposal evidence, not ownership.",
        "crops": crop_records,
        "cohort_review_board": {
            "file": cohort_board_path.name,
            "file_sha256": sha256_file(cohort_board_path),
        },
        "runtime_seconds_cpu": time.perf_counter() - started,
        "decision_policy": "Inspect useful stroke continuation and rule/fold/neighbor contamination together; do not select by added-pixel count.",
    }
    manifest_path = args.output / "experiment.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
