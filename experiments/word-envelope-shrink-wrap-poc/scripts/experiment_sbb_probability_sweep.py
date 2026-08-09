#!/usr/bin/env python3
"""Preserve SBB foreground probabilities and sweep thresholds on acting-safe pages."""

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


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_mask(mask: np.ndarray) -> str:
    return hashlib.sha256(np.ascontiguousarray(mask, dtype=np.uint8).tobytes()).hexdigest()


def component_metrics(mask: np.ndarray) -> dict[str, int | float]:
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    sizes = stats[1:, cv2.CC_STAT_AREA] if count > 1 else np.array([], dtype=np.int32)
    return {
        "pixels": int(mask.sum()),
        "page_fraction": float(mask.mean()),
        "components": int(len(sizes)),
        "components_ge_3px": int((sizes >= 3).sum()),
        "components_ge_8px": int((sizes >= 8).sum()),
        "median_component_pixels": float(np.median(sizes)) if len(sizes) else 0.0,
    }


def predict_foreground_probability(model: tf.keras.Model, image: np.ndarray) -> np.ndarray:
    model_height = int(model.output_shape[1])
    model_width = int(model.output_shape[2])
    original_height, original_width = image.shape[:2]

    padded_height = max(original_height, model_height)
    padded_width = max(original_width, model_width)
    start_y = (padded_height - original_height) // 2
    start_x = (padded_width - original_width) // 2
    padded = np.zeros((padded_height, padded_width, 3), dtype=np.float32)
    padded[start_y : start_y + original_height, start_x : start_x + original_width] = image
    padded /= 255.0

    # Match the released SBB stitcher: discard a 10%-of-width margin where tiles overlap.
    margin = int(0.1 * model_width)
    step_x = model_width - 2 * margin
    step_y = model_height - 2 * margin
    tiles_x = int(np.ceil(padded_width / step_x))
    tiles_y = int(np.ceil(padded_height / step_y))
    probability = np.zeros((padded_height, padded_width), dtype=np.float32)

    for tile_x in range(tiles_x):
        for tile_y in range(tiles_y):
            x0 = tile_x * step_x
            y0 = tile_y * step_y
            x1 = x0 + model_width
            y1 = y0 + model_height
            if x1 > padded_width:
                x1 = padded_width
                x0 = padded_width - model_width
            if y1 > padded_height:
                y1 = padded_height
                y0 = padded_height - model_height

            patch = padded[y0:y1, x0:x1]
            prediction = model.predict(patch[None, ...], verbose=0)[0, :, :, 1]
            left = 0 if tile_x == 0 else margin
            right = 0 if tile_x == tiles_x - 1 else margin
            top = 0 if tile_y == 0 else margin
            bottom = 0 if tile_y == tiles_y - 1 else margin
            probability[y0 + top : y1 - bottom, x0 + left : x1 - right] = prediction[
                top : model_height - bottom,
                left : model_width - right,
            ]

    return probability[start_y : start_y + original_height, start_x : start_x + original_width]


def save_binary(mask: np.ndarray, path: Path) -> None:
    Image.fromarray(np.where(mask, 0, 255).astype(np.uint8), mode="L").save(path, optimize=True)


def render_board(source_path: Path, probability: np.ndarray, threshold_paths: list[tuple[float, Path]], out: Path) -> None:
    source = Image.open(source_path).convert("RGB")
    panel_width = 760
    scale = panel_width / source.width
    panel_height = round(source.height * scale)
    panels: list[tuple[str, Image.Image]] = [("Original", source.resize((panel_width, panel_height)))]
    for threshold, path in threshold_paths:
        panels.append((f"SBB foreground p >= {threshold:.2f}", Image.open(path).convert("RGB").resize((panel_width, panel_height))))
    heat = Image.fromarray(np.clip(probability * 255, 0, 255).astype(np.uint8), mode="L").convert("RGB")
    panels.append(("Foreground probability (white = confident ink)", heat.resize((panel_width, panel_height))))

    columns = 3
    rows = int(np.ceil(len(panels) / columns))
    title_height = 42
    board = Image.new("RGB", (columns * panel_width, rows * (panel_height + title_height)), "#eee9df")
    draw = ImageDraw.Draw(board)
    for index, (title, panel) in enumerate(panels):
        x = (index % columns) * panel_width
        y = (index // columns) * (panel_height + title_height)
        draw.text((x + 12, y + 12), title, fill="#222222")
        board.paste(panel, (x, y + title_height))
    board.save(out, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--hard-reference", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--page-id", required=True)
    parser.add_argument("--thresholds", default="0.50,0.40,0.30,0.20")
    args = parser.parse_args()
    thresholds = [float(value) for value in args.thresholds.split(",")]
    args.output.mkdir(parents=True, exist_ok=True)

    started = time.perf_counter()
    image = cv2.imread(str(args.input), cv2.IMREAD_COLOR)
    if image is None:
        raise SystemExit(f"Could not read {args.input}")
    model = tf.keras.models.load_model(args.model, compile=False)
    probability = predict_foreground_probability(model, image)
    wall_seconds = time.perf_counter() - started

    probability_path = args.output / "foreground-probability.float16.npy"
    np.save(probability_path, probability.astype(np.float16), allow_pickle=False)
    threshold_outputs: list[tuple[float, Path]] = []
    threshold_records: dict[str, object] = {}
    previous_mask: np.ndarray | None = None
    for threshold in thresholds:
        mask = probability >= threshold
        path = args.output / f"foreground-p{threshold:.2f}.png"
        save_binary(mask, path)
        record = component_metrics(mask)
        record.update({
            "file": path.name,
            "file_sha256": sha256_file(path),
            "mask_pixel_sha256": sha256_mask(mask),
        })
        if previous_mask is not None:
            record["pixels_added_vs_previous_threshold"] = int(np.logical_and(mask, ~previous_mask).sum())
        threshold_records[f"{threshold:.2f}"] = record
        previous_mask = mask
        threshold_outputs.append((threshold, path))

    hard_reference = np.asarray(Image.open(args.hard_reference).convert("L")) == 0
    p50 = probability >= 0.5
    board_path = args.output / "probability-threshold-board.png"
    render_board(args.input, probability, threshold_outputs, board_path)
    manifest = {
        "schema_version": "sbb-probability-sweep.v1",
        "page_id": args.page_id,
        "sealed_human_evidence_used": False,
        "input": {"path": str(args.input), "file_sha256": sha256_file(args.input), "size_wh": [image.shape[1], image.shape[0]]},
        "model": {
            "path": str(args.model),
            "name": model.name,
            "input_shape": list(model.input_shape),
            "output_shape": list(model.output_shape),
            "parameters": int(model.count_params()),
            "foreground_channel": 1,
            "release": "2021-03-09",
            "architecture_observed": "ResNet-50 encoder with convolutional upsampling/skip decoder; no transformer layers observed",
        },
        "inference": {
            "stitching": "released SBB 10%-of-model-width overlap discard",
            "released_decision": "argmax over two softmax channels",
            "probability_dtype": "float16 on disk; float32 during inference and thresholding",
        },
        "thresholds": threshold_records,
        "hard_reference_check": {
            "path": str(args.hard_reference),
            "file_sha256": sha256_file(args.hard_reference),
            "p50_disagreement_pixels": int(np.logical_xor(p50, hard_reference).sum()),
        },
        "probability": {
            "file": probability_path.name,
            "file_sha256": sha256_file(probability_path),
            "min": float(probability.min()),
            "max": float(probability.max()),
            "mean": float(probability.mean()),
            "quantiles": {str(q): float(np.quantile(probability, q)) for q in (0.5, 0.9, 0.95, 0.99, 0.995, 0.999)},
        },
        "board": {"file": board_path.name, "file_sha256": sha256_file(board_path)},
        "runtime": {"wall_seconds": wall_seconds, "device": "CPU", "host_arch": platform.machine(), "tensorflow": tf.__version__},
    }
    manifest_path = args.output / "experiment.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print(json.dumps(manifest, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
