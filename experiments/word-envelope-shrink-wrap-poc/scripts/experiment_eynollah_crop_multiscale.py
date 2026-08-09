#!/usr/bin/env python3
"""Test frozen Eynollah hybrid inference on acting-safe crops at several scales.

Every candidate is projected back to the exact source crop. The existing full-page
probability is the acting-safe reference; no completed human annotation is read.
"""

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

from experiment_sbb_probability_sweep import predict_foreground_probability


FROZEN_CROPS = (
    ("folded-write-to-you", 1700, 1875, 1000, 350, "fold/rule contamination and faint writing"),
    ("enough-tight", 2050, 2100, 600, 300, "extremely faint word tail"),
    ("acknowledgement-tight", 1750, 3100, 900, 300, "long faint continuation"),
)
THRESHOLDS = (0.50, 0.20)
CONTEXT_MARGIN = 160
SCALES = (1.0, 1.5, 2.0)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_array(array: np.ndarray) -> str:
    return hashlib.sha256(np.ascontiguousarray(array).tobytes()).hexdigest()


def component_count(mask: np.ndarray) -> int:
    count, _, _, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    return int(count - 1)


def bounded_context_bbox(
    crop: tuple[int, int, int, int], image_width: int, image_height: int
) -> tuple[int, int, int, int]:
    x, y, width, height = crop
    x0 = max(0, x - CONTEXT_MARGIN)
    y0 = max(0, y - CONTEXT_MARGIN)
    x1 = min(image_width, x + width + CONTEXT_MARGIN)
    y1 = min(image_height, y + height + CONTEXT_MARGIN)
    return x0, y0, x1 - x0, y1 - y0


def infer_projected(
    model: tf.keras.Model,
    source: np.ndarray,
    target_bbox: tuple[int, int, int, int],
    inference_bbox: tuple[int, int, int, int],
    scale: float,
) -> np.ndarray:
    target_x, target_y, target_width, target_height = target_bbox
    infer_x, infer_y, infer_width, infer_height = inference_bbox
    inference_image = source[infer_y : infer_y + infer_height, infer_x : infer_x + infer_width]
    if scale != 1.0:
        inference_image = cv2.resize(
            inference_image,
            (round(infer_width * scale), round(infer_height * scale)),
            interpolation=cv2.INTER_LANCZOS4,
        )
    probability = predict_foreground_probability(model, inference_image)
    if scale != 1.0:
        probability = cv2.resize(probability, (infer_width, infer_height), interpolation=cv2.INTER_LINEAR)
    relative_x = target_x - infer_x
    relative_y = target_y - infer_y
    return probability[
        relative_y : relative_y + target_height,
        relative_x : relative_x + target_width,
    ]


def comparison_metrics(candidate: np.ndarray, reference: np.ndarray, threshold: float) -> dict[str, object]:
    candidate_mask = candidate >= threshold
    reference_mask = reference >= threshold
    shared = np.logical_and(candidate_mask, reference_mask)
    added = np.logical_and(candidate_mask, ~reference_mask)
    dropped = np.logical_and(reference_mask, ~candidate_mask)
    return {
        "pixels": int(candidate_mask.sum()),
        "components": component_count(candidate_mask),
        "shared_with_full_page": int(shared.sum()),
        "candidate_only": int(added.sum()),
        "full_page_only": int(dropped.sum()),
        "full_page_retention": float(shared.sum() / max(1, reference_mask.sum())),
        "jaccard_vs_full_page": float(shared.sum() / max(1, np.logical_or(candidate_mask, reference_mask).sum())),
        "mask_pixel_sha256": sha256_array(candidate_mask.astype(np.uint8)),
    }


def overlay_panel(source_rgb: np.ndarray, candidate: np.ndarray, reference: np.ndarray, threshold: float) -> Image.Image:
    base = source_rgb.astype(np.float32) * 0.58 + 255.0 * 0.42
    candidate_mask = candidate >= threshold
    reference_mask = reference >= threshold
    shared = np.logical_and(candidate_mask, reference_mask)
    added = np.logical_and(candidate_mask, ~reference_mask)
    dropped = np.logical_and(reference_mask, ~candidate_mask)
    base[shared] = (0, 190, 205)  # cyan
    base[added] = (235, 55, 45)  # red
    base[dropped] = (240, 175, 20)  # gold
    return Image.fromarray(np.clip(base, 0, 255).astype(np.uint8), "RGB")


def render_board(
    crop_name: str,
    source_rgb: np.ndarray,
    probabilities: dict[str, np.ndarray],
    metrics: dict[str, object],
    output: Path,
) -> None:
    reference = probabilities["full-page-slice"]
    ordered = [
        ("source", None),
        ("full-page-slice", reference),
        ("tight-crop-released-padding", probabilities["tight-crop-released-padding"]),
        ("real-context-1.0x", probabilities["real-context-1.0x"]),
        ("real-context-1.5x", probabilities["real-context-1.5x"]),
        ("real-context-2.0x", probabilities["real-context-2.0x"]),
    ]
    panel_width = 620
    panel_height = round(source_rgb.shape[0] * panel_width / source_rgb.shape[1])
    title_height = 68
    board = Image.new("RGB", (panel_width * 3, (panel_height + title_height) * 2), "#f3eee4")
    draw = ImageDraw.Draw(board)
    for index, (label, probability) in enumerate(ordered):
        column = index % 3
        row = index // 3
        x0 = column * panel_width
        y0 = row * (panel_height + title_height)
        if probability is None:
            panel = Image.fromarray(source_rgb, "RGB")
            subtitle = "unaltered acting-safe source crop"
        else:
            panel = overlay_panel(source_rgb, probability, reference, 0.50)
            m = metrics[label]["0.50"]
            if label == "full-page-slice":
                subtitle = f"cyan reference: {m['pixels']:,} px"
            else:
                subtitle = (
                    f"red only {m['candidate_only']:,} | gold lost {m['full_page_only']:,} | "
                    f"retain {100 * m['full_page_retention']:.1f}%"
                )
        panel = panel.resize((panel_width, panel_height), Image.Resampling.LANCZOS)
        draw.text((x0 + 10, y0 + 9), f"{crop_name}: {label}", fill="#222222")
        draw.text((x0 + 10, y0 + 34), subtitle, fill="#8a2820" if probability is not None else "#555555")
        board.paste(panel, (x0, y0 + title_height))
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
    full_page_probability = np.load(args.full_page_probability, allow_pickle=False).astype(np.float32)
    if full_page_probability.shape != source_bgr.shape[:2]:
        raise SystemExit("Full-page probability and source dimensions differ")
    source_rgb = cv2.cvtColor(source_bgr, cv2.COLOR_BGR2RGB)
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
        source_crop_rgb = source_rgb[y : y + height, x : x + width]
        probabilities: dict[str, np.ndarray] = {
            "full-page-slice": full_page_probability[y : y + height, x : x + width]
        }
        variants = (
            ("tight-crop-released-padding", target_bbox, 1.0),
            ("real-context-1.0x", context_bbox, 1.0),
            ("real-context-1.5x", context_bbox, 1.5),
            ("real-context-2.0x", context_bbox, 2.0),
        )
        runtimes: dict[str, float] = {"full-page-slice": 0.0}
        for label, inference_bbox, scale in variants:
            started = time.perf_counter()
            probabilities[label] = infer_projected(model, source_bgr, target_bbox, inference_bbox, scale)
            runtimes[label] = time.perf_counter() - started
            total_inference_seconds += runtimes[label]

        variant_metrics: dict[str, object] = {}
        output_records: dict[str, object] = {}
        for label, probability in probabilities.items():
            probability_path = crop_dir / f"{label}-probability.float16.npy"
            np.save(probability_path, probability.astype(np.float16), allow_pickle=False)
            variant_metrics[label] = {
                f"{threshold:.2f}": comparison_metrics(probability, probabilities["full-page-slice"], threshold)
                for threshold in THRESHOLDS
            }
            output_records[label] = {
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
                output_records[label][f"p{threshold:.2f}_file"] = mask_path.name
                output_records[label][f"p{threshold:.2f}_file_sha256"] = sha256_file(mask_path)

        board_path = crop_dir / "p050-crop-scale-review.png"
        render_board(crop_name, source_crop_rgb, probabilities, variant_metrics, board_path)
        crop_records[crop_name] = {
            "role_frozen_before_inference": role,
            "source_bbox_xywh": list(target_bbox),
            "context_bbox_xywh": list(context_bbox),
            "context_margin_requested_pixels": CONTEXT_MARGIN,
            "metrics": variant_metrics,
            "outputs": output_records,
            "review_board": {"file": str(board_path.relative_to(args.output)), "file_sha256": sha256_file(board_path)},
        }

    manifest = {
        "schema_version": "eynollah-crop-multiscale.v1",
        "experiment_status": "measurement_complete_visual_review_pending",
        "page_id": args.page_id,
        "sealed_human_evidence_used": False,
        "selection_rule": "Three acting-safe crop roles and source bboxes frozen before any crop inference.",
        "interpretation_guardrail": (
            "Candidate-only pixels are disagreement evidence, not recovered truth; more selected ink is not inherently better."
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
        "inference": {
            "stitching": "released SBB 10%-of-model-width overlap discard",
            "tight_crop_padding": "released zero/black centered padding to model dimensions",
            "real_context_margin_pixels": CONTEXT_MARGIN,
            "scales": list(SCALES),
            "upscale_interpolation": "OpenCV Lanczos4",
            "probability_projection_interpolation": "OpenCV bilinear",
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
