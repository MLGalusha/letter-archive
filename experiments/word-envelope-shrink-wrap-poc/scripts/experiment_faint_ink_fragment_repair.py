#!/usr/bin/env python3
"""Prepare source-supported and temporary-bridge inputs for Eynollah reinference."""

from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from skimage import color

from experiment_natural_faint_word_enhancement import (
    CONTEXT_MARGIN,
    FROZEN_BBOX_XYWH,
    ink_vector_boost,
    sha256_file,
    to_rgb8,
)


def sha256_array(array: np.ndarray) -> str:
    return hashlib.sha256(np.ascontiguousarray(array).tobytes()).hexdigest()


def ink_field(
    rgb: np.ndarray,
    anchor: np.ndarray,
    paper: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    lab = color.rgb2lab(rgb)
    background = np.stack([ndimage.gaussian_filter(lab[..., channel], 34.0) for channel in range(3)], axis=2)
    ink_centre = np.median(lab[anchor], axis=0)
    paper_centre = np.median(lab[paper], axis=0)
    direction = ink_centre - paper_centre
    direction /= max(float(np.linalg.norm(direction)), 1e-6)
    projection = np.sum((lab - background) * direction[None, None, :], axis=2)
    threshold = float(np.quantile(projection[paper], 0.82))
    strength = np.maximum(projection - threshold, 0.0)
    return lab, direction, projection, strength


def connected_support(
    source_evidence: np.ndarray,
    strong: np.ndarray,
    kernel_hw: tuple[int, int],
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    temporary = ndimage.binary_closing(source_evidence | strong, structure=np.ones(kernel_hw, dtype=bool))
    reachable = ndimage.binary_propagation(strong, mask=temporary | strong)
    supported_source = source_evidence & ndimage.binary_dilation(reachable, structure=np.ones((3, 3), dtype=bool))
    synthetic_bridge = reachable & ~source_evidence & ~strong
    return supported_source, synthetic_bridge, reachable


def darken_along_ink(
    base_rgb: np.ndarray,
    direction: np.ndarray,
    source_mask: np.ndarray,
    synthetic_mask: np.ndarray,
    source_strength: np.ndarray,
) -> np.ndarray:
    lab = color.rgb2lab(base_rgb)
    amount = np.zeros(source_mask.shape, dtype=np.float32)
    positive = source_strength[source_mask]
    source_floor = float(np.quantile(positive, 0.40)) if len(positive) else 0.0
    amount[source_mask] = 0.75 * np.maximum(source_strength[source_mask], source_floor)
    bridge_amount = max(0.9, float(np.quantile(positive, 0.58)) if len(positive) else 0.9)
    amount[synthetic_mask] = bridge_amount
    result = lab + amount[..., None] * direction[None, None, :]
    result[..., 0] = np.clip(result[..., 0], 0.0, 100.0)
    return to_rgb8(color.lab2rgb(result) * 255.0)


def render_board(
    variants: dict[str, np.ndarray],
    target_bbox: tuple[int, int, int, int],
    synthetic_masks: dict[str, np.ndarray],
    output: Path,
) -> None:
    tx, ty, tw, th = target_bbox
    panel_width = 600
    panel_height = 300
    title_height = 66
    columns = 3
    rows = int(np.ceil(len(variants) / columns))
    board = Image.new("RGB", (panel_width * columns, (panel_height + title_height) * rows), "#f3eee4")
    draw = ImageDraw.Draw(board)
    for index, (name, context_image) in enumerate(variants.items()):
        crop = context_image[ty : ty + th, tx : tx + tw].copy()
        bridge = synthetic_masks[name]
        overlay = crop.astype(np.float32) * 0.82 + 255.0 * 0.18
        overlay[bridge] = (230, 45, 55)
        x = (index % columns) * panel_width
        y = (index // columns) * (panel_height + title_height)
        draw.text((x + 10, y + 8), name, fill="#222222")
        draw.text((x + 10, y + 34), f"red = temporary bridge only · {bridge.sum():,} px", fill="#555555")
        board.paste(Image.fromarray(overlay.astype(np.uint8), "RGB"), (x, y + title_height))
    board.save(output, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--hybrid-probability", required=True, type=Path)
    parser.add_argument("--vector-score", required=True, type=Path)
    parser.add_argument("--fragment-probability", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    x, y, width, height = FROZEN_BBOX_XYWH
    source_page = np.asarray(Image.open(args.source).convert("RGB"))
    full_probability = np.load(args.hybrid_probability, allow_pickle=False).astype(np.float32)
    vector_score = np.load(args.vector_score, allow_pickle=False).astype(np.float32)
    fragment_probability = np.load(args.fragment_probability, allow_pickle=False).astype(np.float32)
    if fragment_probability.shape != (height, width):
        raise ValueError(f"Expected fragment probability {(height, width)}, got {fragment_probability.shape}")
    context_x0 = max(0, x - CONTEXT_MARGIN)
    context_y0 = max(0, y - CONTEXT_MARGIN)
    context_x1 = min(source_page.shape[1], x + width + CONTEXT_MARGIN)
    context_y1 = min(source_page.shape[0], y + height + CONTEXT_MARGIN)
    context_source = source_page[context_y0:context_y1, context_x0:context_x1]
    context_probability = full_probability[context_y0:context_y1, context_x0:context_x1]
    target_bbox = (x - context_x0, y - context_y0, width, height)
    tx, ty, tw, th = target_bbox

    context_anchor = context_probability >= 0.50
    context_lab = color.rgb2lab(context_source)
    local_std = ndimage.generic_filter(context_lab[..., 0], np.std, size=9, mode="nearest")
    context_paper = (context_probability <= 0.0001) & (local_std <= np.quantile(local_std, 0.45))
    base = ink_vector_boost(context_source, context_anchor, context_paper, ridge_gated=False)
    _, direction, _, strength = ink_field(context_source, context_anchor, context_paper)

    target_strength = strength[ty : ty + th, tx : tx + tw]
    corridor = np.zeros((th, tw), dtype=bool)
    corridor[round(0.22 * th) : round(0.78 * th), :] = True
    source_evidence = (fragment_probability >= 0.20) & corridor
    strong = (fragment_probability >= 0.50) & corridor

    tight_source, tight_bridge, tight_support = connected_support(source_evidence, strong, (3, 7))
    broad_source, broad_bridge, broad_support = connected_support(source_evidence, strong, (5, 11))
    base_target = base[ty : ty + th, tx : tx + tw]
    source_only_target = darken_along_ink(base_target, direction, tight_source, np.zeros_like(tight_bridge), target_strength)
    tight_target = darken_along_ink(base_target, direction, tight_source, tight_bridge, target_strength)
    broad_target = darken_along_ink(base_target, direction, broad_source, broad_bridge, target_strength)

    variants = {
        "original context": context_source.copy(),
        "page-ink vector baseline": base.copy(),
        "source-only reconnect 3x7": base.copy(),
        "temporary bridge 3x7": base.copy(),
        "temporary bridge 5x11": base.copy(),
    }
    variants["source-only reconnect 3x7"][ty : ty + th, tx : tx + tw] = source_only_target
    variants["temporary bridge 3x7"][ty : ty + th, tx : tx + tw] = tight_target
    variants["temporary bridge 5x11"][ty : ty + th, tx : tx + tw] = broad_target
    synthetic_masks = {
        "original context": np.zeros((th, tw), dtype=bool),
        "page-ink vector baseline": np.zeros((th, tw), dtype=bool),
        "source-only reconnect 3x7": np.zeros((th, tw), dtype=bool),
        "temporary bridge 3x7": tight_bridge,
        "temporary bridge 5x11": broad_bridge,
    }

    input_dir = args.output / "context-inputs"
    input_dir.mkdir(parents=True, exist_ok=True)
    input_records: dict[str, object] = {}
    for name, image in variants.items():
        slug = name.lower().replace(" ", "-")
        image_path = input_dir / f"{slug}.png"
        Image.fromarray(image, "RGB").save(image_path, optimize=True)
        record: dict[str, object] = {
            "file": str(image_path.relative_to(args.output)),
            "file_sha256": sha256_file(image_path),
            "rgb_pixel_sha256": sha256_array(image),
        }
        if synthetic_masks[name].any():
            bridge_path = input_dir / f"{slug}-target-synthetic-bridge.png"
            Image.fromarray(np.where(synthetic_masks[name], 0, 255).astype(np.uint8), "L").save(bridge_path)
            record["target_synthetic_bridge_file"] = str(bridge_path.relative_to(args.output))
            record["target_synthetic_bridge_file_sha256"] = sha256_file(bridge_path)
        input_records[name] = record

    target_crop_probability = full_probability[y : y + height, x : x + width]
    faint_proxy = (vector_score >= 0.80) & (target_crop_probability < 0.01) & (target_crop_probability < 0.50)
    paper_proxy = context_paper[ty : ty + th, tx : tx + tw]
    paper_path = input_dir / "target-paper-proxy.png"
    faint_path = input_dir / "target-faint-vector-proxy.png"
    Image.fromarray(np.where(paper_proxy, 0, 255).astype(np.uint8), "L").save(paper_path)
    Image.fromarray(np.where(faint_proxy, 0, 255).astype(np.uint8), "L").save(faint_path)
    board_path = args.output / "faint-ink-fragment-repair-input-review.png"
    render_board(variants, target_bbox, synthetic_masks, board_path)

    manifest = {
        "schema_version": "faint-ink-fragment-repair.v1",
        "experiment_status": "measurement_complete_visual_review_pending",
        "sealed_human_evidence_used": False,
        "frozen_crop": {"label": "enough-tight", "bbox_xywh": list(FROZEN_BBOX_XYWH)},
        "selection_rule": "Reuse the prior page-ink vector context. Freeze 3x7 and 5x11 temporary grouping kernels before Eynollah reinference. Restrict all repair to the centered 22%-78% target-line corridor.",
        "interpretation_guardrail": "Temporary bridge pixels are model-input scaffolding, never source ink. Every downstream mask must report and remove selected synthetic bridge pixels before fitted geometry or training export.",
        "source": {"path": str(args.source), "file_sha256": sha256_file(args.source)},
        "hybrid_probability": {"path": str(args.hybrid_probability), "file_sha256": sha256_file(args.hybrid_probability)},
        "vector_score": {"path": str(args.vector_score), "file_sha256": sha256_file(args.vector_score)},
        "fragment_probability": {
            "path": str(args.fragment_probability),
            "file_sha256": sha256_file(args.fragment_probability),
            "high_seed_threshold": 0.50,
            "weak_source_threshold": 0.20
        },
        "repair": {
            "source_evidence_pixels": int(source_evidence.sum()),
            "strong_seed_pixels": int(strong.sum()),
            "source_evidence_components": int(ndimage.label(source_evidence, structure=np.ones((3, 3), dtype=np.uint8))[1]),
            "tight_3x7": {
                "supported_source_pixels": int(tight_source.sum()),
                "synthetic_bridge_pixels": int(tight_bridge.sum()),
                "temporary_support_components": int(ndimage.label(tight_support, structure=np.ones((3, 3), dtype=np.uint8))[1]),
                "synthetic_bridge_mask_pixel_sha256": sha256_array(tight_bridge.astype(np.uint8)),
            },
            "broad_5x11": {
                "supported_source_pixels": int(broad_source.sum()),
                "synthetic_bridge_pixels": int(broad_bridge.sum()),
                "temporary_support_components": int(ndimage.label(broad_support, structure=np.ones((3, 3), dtype=np.uint8))[1]),
                "synthetic_bridge_mask_pixel_sha256": sha256_array(broad_bridge.astype(np.uint8)),
            },
        },
        "eynollah_reinference_context": {
            "bbox_xywh": [context_x0, context_y0, context_x1 - context_x0, context_y1 - context_y0],
            "target_bbox_within_context_xywh": list(target_bbox),
            "margin_pixels": CONTEXT_MARGIN,
            "inputs": input_records,
            "target_paper_proxy": {"file": str(paper_path.relative_to(args.output)), "file_sha256": sha256_file(paper_path)},
            "target_faint_vector_proxy": {"file": str(faint_path.relative_to(args.output)), "file_sha256": sha256_file(faint_path)},
        },
        "review_board": {"file": board_path.name, "file_sha256": sha256_file(board_path)},
        "runtime_seconds": time.perf_counter() - started,
    }
    manifest_path = args.output / "experiment.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"manifest": str(manifest_path), "repair": manifest["repair"], "runtime_seconds": manifest["runtime_seconds"]}, indent=2))


if __name__ == "__main__":
    main()
