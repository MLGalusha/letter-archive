#!/usr/bin/env python3
"""Make a frozen faint word more visible while measuring paper damage and distortion."""

from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from skimage import color, exposure, filters
from skimage.metrics import structural_similarity


FROZEN_BBOX_XYWH = (2050, 2100, 600, 300)
CONTEXT_MARGIN = 160


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def to_rgb8(image: np.ndarray) -> np.ndarray:
    return np.clip(np.rint(image), 0, 255).astype(np.uint8)


def paper_flatten(rgb: np.ndarray) -> np.ndarray:
    image = rgb.astype(np.float32) / 255.0
    background = np.stack([ndimage.gaussian_filter(image[..., channel], 42.0) for channel in range(3)], axis=2)
    reference = np.median(background.reshape(-1, 3), axis=0)
    corrected = image / np.maximum(background, 0.08) * reference
    return to_rgb8(corrected * 255.0)


def unsharp(rgb: np.ndarray) -> np.ndarray:
    image = rgb.astype(np.float32)
    blurred = ndimage.gaussian_filter(image, sigma=(1.4, 1.4, 0.0))
    return to_rgb8(image + 1.35 * (image - blurred))


def lab_local_residual(rgb: np.ndarray, gain: float = 2.0) -> np.ndarray:
    lab = color.rgb2lab(rgb)
    background = np.stack([ndimage.gaussian_filter(lab[..., channel], 28.0) for channel in range(3)], axis=2)
    boosted = background + gain * (lab - background)
    boosted[..., 0] = np.clip(boosted[..., 0], 0.0, 100.0)
    return to_rgb8(color.lab2rgb(boosted) * 255.0)


def dark_ink_boost(rgb: np.ndarray) -> np.ndarray:
    lab = color.rgb2lab(rgb)
    background = np.stack([ndimage.gaussian_filter(lab[..., channel], 34.0) for channel in range(3)], axis=2)
    dark = np.maximum(background[..., 0] - lab[..., 0], 0.0)
    chroma_residual = lab[..., 1:] - background[..., 1:]
    result = lab.copy()
    result[..., 0] = np.clip(lab[..., 0] - 2.25 * dark, 0.0, 100.0)
    result[..., 1:] = background[..., 1:] + 1.45 * chroma_residual
    return to_rgb8(color.lab2rgb(result) * 255.0)


def natural_combo(rgb: np.ndarray) -> np.ndarray:
    flattened = paper_flatten(rgb)
    lab = color.rgb2lab(flattened)
    broad = ndimage.gaussian_filter(lab[..., 0], 32.0)
    medium = ndimage.gaussian_filter(lab[..., 0], 8.0)
    dark_broad = np.maximum(broad - lab[..., 0], 0.0)
    dark_medium = np.maximum(medium - lab[..., 0], 0.0)
    result = lab.copy()
    result[..., 0] = np.clip(lab[..., 0] - 1.50 * dark_broad - 0.65 * dark_medium, 0.0, 100.0)
    result[..., 1:] *= 1.08
    return to_rgb8(color.lab2rgb(result) * 255.0)


def ink_vector_boost(
    rgb: np.ndarray,
    anchor: np.ndarray,
    paper: np.ndarray,
    ridge_gated: bool,
) -> np.ndarray:
    """Amplify only local residuals aligned with the crop's strong-ink colour."""
    lab = color.rgb2lab(rgb)
    background = np.stack([ndimage.gaussian_filter(lab[..., channel], 34.0) for channel in range(3)], axis=2)
    ink_centre = np.median(lab[anchor], axis=0)
    paper_centre = np.median(lab[paper], axis=0)
    direction = ink_centre - paper_centre
    direction /= max(float(np.linalg.norm(direction)), 1e-6)
    projection = np.sum((lab - background) * direction[None, None, :], axis=2)
    threshold = float(np.quantile(projection[paper], 0.82))
    strength = np.maximum(projection - threshold, 0.0)
    strength = np.minimum(strength, np.quantile(strength, 0.997))
    if ridge_gated:
        ridge = filters.sato(color.rgb2gray(rgb), sigmas=(1, 2, 3), black_ridges=True)
        low = float(np.quantile(ridge[paper], 0.75))
        high = max(low + 1e-6, float(np.quantile(ridge, 0.995)))
        gate = 0.18 + 0.82 * np.clip((ridge - low) / (high - low), 0.0, 1.0)
        strength *= gate
    result = lab + 1.85 * strength[..., None] * direction[None, None, :]
    result[..., 0] = np.clip(result[..., 0], 0.0, 100.0)
    return to_rgb8(color.lab2rgb(result) * 255.0)


def clahe_natural(rgb: np.ndarray) -> np.ndarray:
    lab = color.rgb2lab(rgb)
    light = exposure.equalize_adapthist(lab[..., 0] / 100.0, kernel_size=(48, 48), clip_limit=0.012)
    result = lab.copy()
    result[..., 0] = light * 100.0
    return to_rgb8(color.lab2rgb(result) * 255.0)


def grayscale(image: np.ndarray) -> np.ndarray:
    return color.rgb2gray(image)


def metrics(
    original: np.ndarray,
    enhanced: np.ndarray,
    anchor: np.ndarray,
    faint_proposal: np.ndarray,
    paper: np.ndarray,
) -> dict[str, float | int]:
    original_gray = grayscale(original)
    enhanced_gray = grayscale(enhanced)
    paper_median = float(np.median(enhanced_gray[paper]))
    anchor_median = float(np.median(enhanced_gray[anchor]))
    faint_median = float(np.median(enhanced_gray[faint_proposal]))
    return {
        "paper_minus_anchor_median_contrast": paper_median - anchor_median,
        "paper_minus_faint_proposal_median_contrast": paper_median - faint_median,
        "paper_grayscale_std": float(np.std(enhanced_gray[paper])),
        "ssim_to_original": float(structural_similarity(original_gray, enhanced_gray, data_range=1.0)),
        "mean_absolute_rgb_change": float(np.mean(np.abs(enhanced.astype(np.float32) - original.astype(np.float32)))),
        "clipped_channel_fraction": float(np.mean((enhanced == 0) | (enhanced == 255))),
        "anchor_pixels": int(anchor.sum()),
        "faint_proposal_pixels": int(faint_proposal.sum()),
        "paper_proxy_pixels": int(paper.sum()),
    }


def render_board(variants: dict[str, np.ndarray], records: dict[str, object], output: Path) -> None:
    panel_width = 600
    panel_height = 300
    title_height = 76
    rows = int(np.ceil(len(variants) / 2))
    board = Image.new("RGB", (panel_width * 2, (panel_height + title_height) * rows), "#f3eee4")
    draw = ImageDraw.Draw(board)
    for index, (name, image) in enumerate(variants.items()):
        x = (index % 2) * panel_width
        y = (index // 2) * (panel_height + title_height)
        item = records[name]["metrics"]
        draw.text((x + 10, y + 8), name, fill="#222222")
        draw.text(
            (x + 10, y + 33),
            f"faint contrast {item['paper_minus_faint_proposal_median_contrast']:.3f} · paper std {item['paper_grayscale_std']:.3f}",
            fill="#555555",
        )
        draw.text(
            (x + 10, y + 54),
            f"SSIM {item['ssim_to_original']:.3f} · RGB change {item['mean_absolute_rgb_change']:.1f}",
            fill="#555555",
        )
        board.paste(Image.fromarray(image, "RGB"), (x, y + title_height))
    board.save(output, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--hybrid-probability", required=True, type=Path)
    parser.add_argument("--vector-score", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    x, y, width, height = FROZEN_BBOX_XYWH
    full_source = np.asarray(Image.open(args.source).convert("RGB"))
    source = full_source[y : y + height, x : x + width]
    probability = np.load(args.hybrid_probability, allow_pickle=False).astype(np.float32)[y : y + height, x : x + width]
    vector_score = np.load(args.vector_score, allow_pickle=False).astype(np.float32)
    anchor = probability >= 0.50
    faint_proposal = (vector_score >= 0.80) & (probability < 0.01) & ~anchor
    lab = color.rgb2lab(source)
    local_std = ndimage.generic_filter(lab[..., 0], np.std, size=9, mode="nearest")
    paper = (probability <= 0.0001) & (local_std <= np.quantile(local_std, 0.45))

    variants = {
        "original": source,
        "paper flattened": paper_flatten(source),
        "unsharp edges": unsharp(source),
        "LAB residual x2": lab_local_residual(source),
        "dark-ink selective boost": dark_ink_boost(source),
        "flatten + multiscale ink": natural_combo(source),
        "page-ink vector boost": ink_vector_boost(source, anchor, paper, ridge_gated=False),
        "ink vector + ridge gate": ink_vector_boost(source, anchor, paper, ridge_gated=True),
    }
    records: dict[str, object] = {}
    for name, image in variants.items():
        path = args.output / f"{name.lower().replace(' ', '-').replace('+', 'plus')}.png"
        Image.fromarray(image, "RGB").save(path, optimize=True)
        records[name] = {
            "file": path.name,
            "file_sha256": sha256_file(path),
            "rgb_pixel_sha256": hashlib.sha256(np.ascontiguousarray(image).tobytes()).hexdigest(),
            "metrics": metrics(source, image, anchor, faint_proposal, paper),
        }
    board_path = args.output / "natural-faint-word-enhancement-review.png"
    render_board(variants, records, board_path)

    context_x0 = max(0, x - CONTEXT_MARGIN)
    context_y0 = max(0, y - CONTEXT_MARGIN)
    context_x1 = min(full_source.shape[1], x + width + CONTEXT_MARGIN)
    context_y1 = min(full_source.shape[0], y + height + CONTEXT_MARGIN)
    context_source = full_source[context_y0:context_y1, context_x0:context_x1]
    context_probability = np.load(args.hybrid_probability, allow_pickle=False).astype(np.float32)[
        context_y0:context_y1, context_x0:context_x1
    ]
    context_anchor = context_probability >= 0.50
    context_lab = color.rgb2lab(context_source)
    context_local_std = ndimage.generic_filter(context_lab[..., 0], np.std, size=9, mode="nearest")
    context_paper = (context_probability <= 0.0001) & (
        context_local_std <= np.quantile(context_local_std, 0.45)
    )
    context_variants = {
        "original context": context_source,
        "dark-ink selective boost": dark_ink_boost(context_source),
        "page-ink vector boost": ink_vector_boost(context_source, context_anchor, context_paper, ridge_gated=False),
        "ink vector + ridge gate": ink_vector_boost(context_source, context_anchor, context_paper, ridge_gated=True),
    }
    context_dir = args.output / "context-inputs"
    context_dir.mkdir(parents=True, exist_ok=True)
    context_records: dict[str, object] = {}
    for name, image in context_variants.items():
        path = context_dir / f"{name.lower().replace(' ', '-').replace('+', 'plus')}.png"
        Image.fromarray(image, "RGB").save(path, optimize=True)
        context_records[name] = {
            "file": str(path.relative_to(args.output)),
            "file_sha256": sha256_file(path),
            "rgb_pixel_sha256": hashlib.sha256(np.ascontiguousarray(image).tobytes()).hexdigest(),
        }
    paper_proxy_path = context_dir / "target-paper-proxy.png"
    faint_proxy_path = context_dir / "target-faint-vector-proxy.png"
    Image.fromarray(np.where(paper, 0, 255).astype(np.uint8), "L").save(paper_proxy_path)
    Image.fromarray(np.where(faint_proposal, 0, 255).astype(np.uint8), "L").save(faint_proxy_path)
    manifest = {
        "schema_version": "natural-faint-word-enhancement.v1",
        "experiment_status": "measurement_complete_visual_review_pending",
        "sealed_human_evidence_used": False,
        "frozen_crop": {"label": "enough-tight", "bbox_xywh": list(FROZEN_BBOX_XYWH)},
        "interpretation_guardrail": "The hybrid anchor and vector proposal define measurement probes, not human truth. More contrast is not automatically better if paper texture, clipping, or structural distortion also increases.",
        "source": {"path": str(args.source), "file_sha256": sha256_file(args.source)},
        "hybrid_probability": {"path": str(args.hybrid_probability), "file_sha256": sha256_file(args.hybrid_probability)},
        "vector_score": {"path": str(args.vector_score), "file_sha256": sha256_file(args.vector_score)},
        "eynollah_reinference_context": {
            "bbox_xywh": [context_x0, context_y0, context_x1 - context_x0, context_y1 - context_y0],
            "target_bbox_within_context_xywh": [x - context_x0, y - context_y0, width, height],
            "margin_pixels": CONTEXT_MARGIN,
            "inputs": context_records,
            "target_paper_proxy": {"file": str(paper_proxy_path.relative_to(args.output)), "file_sha256": sha256_file(paper_proxy_path)},
            "target_faint_vector_proxy": {"file": str(faint_proxy_path.relative_to(args.output)), "file_sha256": sha256_file(faint_proxy_path)},
        },
        "paper_proxy": "hybrid<=0.0001 and local LAB-L 9x9 standard deviation at or below crop 45th percentile",
        "faint_proxy": "line-conditioned vector agreement>=0.80 where hybrid<0.01 and outside p0.50 anchor",
        "variants": records,
        "review_board": {"file": board_path.name, "file_sha256": sha256_file(board_path)},
        "runtime_seconds": time.perf_counter() - started,
    }
    manifest_path = args.output / "experiment.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"manifest": str(manifest_path), "runtime_seconds": manifest["runtime_seconds"]}, indent=2))


if __name__ == "__main__":
    main()
