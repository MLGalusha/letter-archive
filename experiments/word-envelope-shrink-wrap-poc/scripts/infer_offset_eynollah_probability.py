#!/usr/bin/env python3
"""Shift Eynollah's tile grid without changing source pixels, then crop back."""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
import tensorflow as tf

from experiment_sbb_probability_sweep import predict_foreground_probability


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_array(array: np.ndarray) -> str:
    return hashlib.sha256(np.ascontiguousarray(array).tobytes()).hexdigest()


def save_mask(mask: np.ndarray, path: Path) -> None:
    Image.fromarray(np.where(mask, 0, 255).astype(np.uint8), "L").save(path, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--page-id", required=True)
    parser.add_argument("--offset-x", type=int, default=180)
    parser.add_argument("--offset-y", type=int, default=180)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    source = cv2.imread(str(args.source), cv2.IMREAD_COLOR)
    if source is None:
        raise ValueError(f"Could not read {args.source}")
    height, width = source.shape[:2]

    # A robust bright paper-like border avoids the released function's black
    # padding while changing only where the source falls relative to its tile grid.
    border_sample = source.reshape(-1, 3)
    brightness = border_sample.mean(axis=1)
    paper = np.median(border_sample[brightness >= np.quantile(brightness, 0.65)], axis=0)
    padded = np.empty((height + 2 * args.offset_y, width + 2 * args.offset_x, 3), dtype=np.uint8)
    padded[:] = np.round(paper).astype(np.uint8)
    padded[args.offset_y:args.offset_y + height, args.offset_x:args.offset_x + width] = source

    load_started = time.perf_counter()
    model = tf.keras.models.load_model(args.model, compile=False)
    load_seconds = time.perf_counter() - load_started
    inference_started = time.perf_counter()
    padded_probability = predict_foreground_probability(model, padded)
    inference_seconds = time.perf_counter() - inference_started
    probability = padded_probability[
        args.offset_y:args.offset_y + height,
        args.offset_x:args.offset_x + width,
    ]
    probability_path = args.output / "foreground-probability.float16.npy"
    np.save(probability_path, probability.astype(np.float16), allow_pickle=False)
    mask_path = args.output / "foreground-p0.50.png"
    save_mask(probability >= 0.50, mask_path)
    record = {
        "schema_version": "eynollah-offset-grid-inference.v1",
        "page_id": args.page_id,
        "evidence_visibility": "acting-safe-source-only",
        "sealed_human_evidence_used": False,
        "source": {"path": str(args.source), "file_sha256": sha256_file(args.source), "shape_hw": [height, width]},
        "offset_xy": [args.offset_x, args.offset_y],
        "border_bgr_median": [float(v) for v in paper],
        "source_pixels_modified": 0,
        "model": {
            "release": "2022-08-16",
            "saved_model_pb_sha256": sha256_file(args.model / "saved_model.pb"),
            "variables_data_sha256": sha256_file(args.model / "variables/variables.data-00000-of-00001"),
        },
        "probability": {
            "file": probability_path.name,
            "file_sha256": sha256_file(probability_path),
            "float32_pixel_sha256": sha256_array(probability.astype(np.float32)),
            "minimum": float(probability.min()),
            "maximum": float(probability.max()),
            "mean": float(probability.mean()),
        },
        "p0.50": {
            "pixels": int((probability >= 0.50).sum()),
            "mask_uint8_pixel_sha256": sha256_array((probability >= 0.50).astype(np.uint8)),
            "file": mask_path.name,
            "file_sha256": sha256_file(mask_path),
        },
        "runtime": {
            "model_load_seconds": load_seconds,
            "inference_seconds": inference_seconds,
            "wall_seconds": time.perf_counter() - started,
            "tensorflow": tf.__version__,
            "platform": platform.platform(),
        },
    }
    record_path = args.output / "experiment.json"
    record_path.write_text(json.dumps(record, indent=2) + "\n")
    print(json.dumps({"result": record, "manifest_sha256": sha256_file(record_path)}))


if __name__ == "__main__":
    main()
