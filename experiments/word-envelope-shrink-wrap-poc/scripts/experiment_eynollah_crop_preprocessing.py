#!/usr/bin/env python3
"""Test bounded native-scale preprocessing before Eynollah crop inference."""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw
import tensorflow as tf

from experiment_eynollah_crop_multiscale import (
    CONTEXT_MARGIN,
    FROZEN_CROPS,
    bounded_context_bbox,
    comparison_metrics,
    sha256_array,
    sha256_file,
)
from experiment_sbb_probability_sweep import predict_foreground_probability


THRESHOLDS = (0.50, 0.20)
VARIANTS = (
    "real-context-rgb",
    "lab-clahe-1.5",
    "paper-flatten-1.0",
    "paper-flatten-1.5",
    "paper-flatten-2.0",
)


def transform_context(image_bgr: np.ndarray, variant: str) -> np.ndarray:
    if variant == "real-context-rgb":
        return image_bgr.copy()
    lab = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2LAB)
    lightness, channel_a, channel_b = cv2.split(lab)
    if variant == "lab-clahe-1.5":
        lightness = cv2.createCLAHE(clipLimit=1.5, tileGridSize=(8, 8)).apply(lightness)
    elif variant.startswith("paper-flatten-"):
        gain = float(variant.rsplit("-", 1)[1])
        background = cv2.GaussianBlur(lightness, (0, 0), sigmaX=35.0, sigmaY=35.0)
        darkness = np.maximum(background.astype(np.float32) - lightness.astype(np.float32), 0.0)
        lightness = np.clip(245.0 - gain * darkness, 0, 255).astype(np.uint8)
        # Remove paper hue while preserving the original chroma direction at half strength.
        channel_a = np.clip(128.0 + 0.5 * (channel_a.astype(np.float32) - 128.0), 0, 255).astype(np.uint8)
        channel_b = np.clip(128.0 + 0.5 * (channel_b.astype(np.float32) - 128.0), 0, 255).astype(np.uint8)
    else:
        raise ValueError(f"Unknown preprocessing variant: {variant}")
    return cv2.cvtColor(cv2.merge((lightness, channel_a, channel_b)), cv2.COLOR_LAB2BGR)


def infer_context_target(
    model: tf.keras.Model,
    transformed_context: np.ndarray,
    target_bbox: tuple[int, int, int, int],
    context_bbox: tuple[int, int, int, int],
) -> np.ndarray:
    target_x, target_y, target_width, target_height = target_bbox
    context_x, context_y, _, _ = context_bbox
    probability = predict_foreground_probability(model, transformed_context)
    relative_x = target_x - context_x
    relative_y = target_y - context_y
    return probability[
        relative_y : relative_y + target_height,
        relative_x : relative_x + target_width,
    ]


def overlay(source_rgb: np.ndarray, candidate: np.ndarray, reference: np.ndarray, threshold: float) -> Image.Image:
    base = source_rgb.astype(np.float32) * 0.58 + 255.0 * 0.42
    candidate_mask = candidate >= threshold
    reference_mask = reference >= threshold
    shared = np.logical_and(candidate_mask, reference_mask)
    candidate_only = np.logical_and(candidate_mask, ~reference_mask)
    reference_only = np.logical_and(reference_mask, ~candidate_mask)
    base[shared] = (0, 190, 205)
    base[candidate_only] = (235, 55, 45)
    base[reference_only] = (240, 175, 20)
    return Image.fromarray(np.clip(base, 0, 255).astype(np.uint8), "RGB")


def render_board(
    crop_name: str,
    source_rgb: np.ndarray,
    probabilities: dict[str, np.ndarray],
    metrics: dict[str, object],
    threshold: float,
    output: Path,
) -> None:
    reference = probabilities["full-page-slice"]
    ordered = ("source", "full-page-slice", *VARIANTS)
    panel_width = 560
    panel_height = round(source_rgb.shape[0] * panel_width / source_rgb.shape[1])
    title_height = 72
    columns = 3
    rows = 3
    board = Image.new("RGB", (panel_width * columns, (panel_height + title_height) * rows), "#f3eee4")
    draw = ImageDraw.Draw(board)
    for index, label in enumerate(ordered):
        x0 = (index % columns) * panel_width
        y0 = (index // columns) * (panel_height + title_height)
        if label == "source":
            panel = Image.fromarray(source_rgb, "RGB")
            subtitle = "unaltered acting-safe source crop"
        else:
            panel = overlay(source_rgb, probabilities[label], reference, threshold)
            m = metrics[label][f"{threshold:.2f}"]
            if label == "full-page-slice":
                subtitle = f"cyan reference: {m['pixels']:,} px"
            else:
                subtitle = (
                    f"red only {m['candidate_only']:,} | gold lost {m['full_page_only']:,} | "
                    f"retain {100 * m['full_page_retention']:.1f}%"
                )
        panel = panel.resize((panel_width, panel_height), Image.Resampling.LANCZOS)
        draw.text((x0 + 10, y0 + 9), f"{crop_name}: {label}", fill="#222222")
        draw.text((x0 + 10, y0 + 35), subtitle, fill="#8a2820" if label != "source" else "#555555")
        board.paste(panel, (x0, y0 + title_height))
    legend_y = 2 * (panel_height + title_height) + 18
    draw.text((panel_width + 10, legend_y), "cyan shared | red candidate-only | gold full-page-only", fill="#333333")
    board.save(output, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--full-page-probability", required=True, type=Path)
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--page-id", required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    source_bgr = cv2.imread(str(args.input), cv2.IMREAD_COLOR)
    if source_bgr is None:
        raise SystemExit(f"Could not read {args.input}")
    source_rgb = cv2.cvtColor(source_bgr, cv2.COLOR_BGR2RGB)
    full_page_probability = np.load(args.full_page_probability, allow_pickle=False).astype(np.float32)
    if full_page_probability.shape != source_bgr.shape[:2]:
        raise SystemExit("Full-page probability and source dimensions differ")
    model_started = time.perf_counter()
    model = tf.keras.models.load_model(args.model, compile=False)
    model_load_seconds = time.perf_counter() - model_started

    crop_records: dict[str, object] = {}
    total_inference_seconds = 0.0
    for crop_name, x, y, width, height, role in FROZEN_CROPS:
        crop_dir = args.output / crop_name
        crop_dir.mkdir(parents=True, exist_ok=True)
        target_bbox = (x, y, width, height)
        context_bbox = bounded_context_bbox(target_bbox, source_bgr.shape[1], source_bgr.shape[0])
        context_x, context_y, context_width, context_height = context_bbox
        context = source_bgr[context_y : context_y + context_height, context_x : context_x + context_width]
        source_crop_rgb = source_rgb[y : y + height, x : x + width]
        probabilities: dict[str, np.ndarray] = {
            "full-page-slice": full_page_probability[y : y + height, x : x + width]
        }
        runtimes: dict[str, float] = {"full-page-slice": 0.0}
        transformed_records: dict[str, object] = {}
        for variant in VARIANTS:
            transformed = transform_context(context, variant)
            transformed_path = crop_dir / f"{variant}-context-input.png"
            cv2.imwrite(str(transformed_path), transformed)
            started = time.perf_counter()
            probabilities[variant] = infer_context_target(model, transformed, target_bbox, context_bbox)
            runtimes[variant] = time.perf_counter() - started
            total_inference_seconds += runtimes[variant]
            transformed_records[variant] = {
                "file": transformed_path.name,
                "file_sha256": sha256_file(transformed_path),
                "pixel_sha256": sha256_array(transformed),
            }

        metrics: dict[str, object] = {}
        outputs: dict[str, object] = {}
        for label, probability in probabilities.items():
            probability_path = crop_dir / f"{label}-probability.float16.npy"
            np.save(probability_path, probability.astype(np.float16), allow_pickle=False)
            metrics[label] = {
                f"{threshold:.2f}": comparison_metrics(probability, probabilities["full-page-slice"], threshold)
                for threshold in THRESHOLDS
            }
            outputs[label] = {
                "probability_file": probability_path.name,
                "probability_file_sha256": sha256_file(probability_path),
                "probability_float32_pixel_sha256": sha256_array(probability.astype(np.float32)),
                "runtime_seconds": runtimes[label],
                "probability_quantiles": {
                    str(q): float(np.quantile(probability, q)) for q in (0.50, 0.90, 0.95, 0.99, 0.995)
                },
            }
            for threshold in THRESHOLDS:
                mask_path = crop_dir / f"{label}-p{threshold:.2f}.png"
                Image.fromarray(np.where(probability >= threshold, 0, 255).astype(np.uint8), "L").save(mask_path)
                outputs[label][f"p{threshold:.2f}_file"] = mask_path.name
                outputs[label][f"p{threshold:.2f}_file_sha256"] = sha256_file(mask_path)

        boards: dict[str, object] = {}
        for threshold in THRESHOLDS:
            board_path = crop_dir / f"p{threshold:.2f}-preprocessing-review.png"
            render_board(crop_name, source_crop_rgb, probabilities, metrics, threshold, board_path)
            boards[f"{threshold:.2f}"] = {
                "file": str(board_path.relative_to(args.output)),
                "file_sha256": sha256_file(board_path),
            }
        crop_records[crop_name] = {
            "role_frozen_before_inference": role,
            "source_bbox_xywh": list(target_bbox),
            "context_bbox_xywh": list(context_bbox),
            "metrics": metrics,
            "transformed_inputs": transformed_records,
            "outputs": outputs,
            "review_boards": boards,
        }

    manifest = {
        "schema_version": "eynollah-crop-preprocessing.v1",
        "experiment_status": "measurement_complete_visual_review_pending",
        "page_id": args.page_id,
        "sealed_human_evidence_used": False,
        "selection_rule": "Same three crop roles and source bboxes frozen before the preceding multiscale experiment.",
        "interpretation_guardrail": (
            "Transformed-image output is proposal evidence only. Candidate-only pixels are not recovered truth, "
            "and no transformed pixel replaces the source raster."
        ),
        "input": {
            "path": str(args.input),
            "file_sha256": sha256_file(args.input),
            "size_wh": [source_bgr.shape[1], source_bgr.shape[0]],
        },
        "full_page_probability": {
            "path": str(args.full_page_probability),
            "file_sha256": sha256_file(args.full_page_probability),
        },
        "model": {
            "path": str(args.model),
            "saved_model_pb_sha256": sha256_file(args.model / "saved_model.pb"),
            "input_shape": list(model.input_shape),
            "output_shape": list(model.output_shape),
            "parameters": int(model.count_params()),
            "foreground_channel": 1,
        },
        "preprocessing": {
            "variants": list(VARIANTS),
            "lab_clahe": {"clip_limit": 1.5, "tile_grid_size": [8, 8]},
            "paper_flatten": {
                "formula": "L_out = 245 - gain * max(GaussianBlur(L,sigma=35)-L,0)",
                "gains": [1.0, 1.5, 2.0],
                "chroma": "original LAB a/b displacement from neutral reduced to 50%",
            },
            "inference_scale": 1.0,
            "context_margin_pixels": CONTEXT_MARGIN,
            "source_coordinate_projection": True,
        },
        "crops": crop_records,
        "runtime": {
            "model_load_seconds": model_load_seconds,
            "crop_inference_seconds": total_inference_seconds,
            "device": "CPU",
            "host_arch": platform.machine(),
            "tensorflow": tf.__version__,
        },
    }
    manifest_path = args.output / "experiment.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print(json.dumps(manifest, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
