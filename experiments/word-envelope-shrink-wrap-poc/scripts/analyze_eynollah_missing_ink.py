#!/usr/bin/env python3
"""Diagnose why source-visible ink receives low Eynollah probability.

This acting-safe analysis creates a source-derived candidate set before comparing
model probabilities. It never reads a completed human mask.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from skimage.filters import threshold_sauvola

from experiment_best_ink_pipeline_cohort import line_corridors


MODEL_SIZE = 448
MODEL_MARGIN = 44
MODEL_STEP = 360


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


def stitch_boundaries(length: int) -> list[int]:
    tile_count = int(np.ceil(length / MODEL_STEP))
    boundaries = []
    for tile_index in range(1, tile_count):
        start = tile_index * MODEL_STEP
        end = start + MODEL_SIZE
        if end > length:
            start = length - MODEL_SIZE
        boundaries.append(start + MODEL_MARGIN)
    return sorted(set(boundary for boundary in boundaries if 0 < boundary < length))


def distance_to_boundaries(length: int, boundaries: list[int]) -> np.ndarray:
    coordinates = np.arange(length)
    if not boundaries:
        return np.full(length, length, dtype=np.int32)
    return np.min(np.abs(coordinates[:, None] - np.asarray(boundaries)[None, :]), axis=1).astype(np.int32)


def source_features(source_bgr: np.ndarray) -> dict[str, np.ndarray | object]:
    gray = cv2.cvtColor(source_bgr, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0
    lab = cv2.cvtColor(source_bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    local_min = ndimage.minimum_filter(gray, size=31, mode="nearest")
    local_max = ndimage.maximum_filter(gray, size=31, mode="nearest")
    local_mean = ndimage.uniform_filter(gray, size=31, mode="nearest")
    local_range = local_max - local_min
    local_contrast = local_range / np.maximum(local_max + local_min, 1e-4)
    normalized_darkness = (local_mean - gray) / np.maximum(local_range, 0.02)
    contrast_u8 = np.clip(local_contrast * 255 / max(1e-6, np.quantile(local_contrast, 0.995)), 0, 255).astype(np.uint8)
    otsu, _ = cv2.threshold(contrast_u8, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    contrast_threshold = float(otsu / 255.0 * np.quantile(local_contrast, 0.995))
    su = (local_contrast >= contrast_threshold) & (normalized_darkness >= 0.14)

    sauvola_votes = np.zeros(gray.shape, dtype=np.uint8)
    for window in (31, 61, 121):
        sauvola_votes += gray < threshold_sauvola(gray, window_size=window, k=0.18, r=0.5)
    sauvola = sauvola_votes >= 2

    gray_u8 = np.round(gray * 255).astype(np.uint8)
    blackhat_response = np.zeros(gray.shape, dtype=np.uint8)
    for diameter in (5, 9, 15):
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (diameter, diameter))
        blackhat_response = np.maximum(
            blackhat_response,
            cv2.morphologyEx(gray_u8, cv2.MORPH_BLACKHAT, kernel),
        )
    blackhat_otsu, _ = cv2.threshold(blackhat_response, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    blackhat = blackhat_response >= max(3, int(blackhat_otsu))

    background = cv2.GaussianBlur(gray, (0, 0), 18.0)
    reflectance = np.maximum(background - gray, 0.0)
    ridge = np.zeros_like(gray)
    for sigma in (0.8, 1.4, 2.4, 4.0):
        smooth = cv2.GaussianBlur(gray, (0, 0), sigma)
        ridge = np.maximum(ridge, np.maximum(cv2.Laplacian(smooth, cv2.CV_32F, ksize=3), 0) * sigma * sigma)

    method_votes = su.astype(np.uint8) + sauvola.astype(np.uint8) + blackhat.astype(np.uint8)
    return {
        "gray": gray,
        "lab": lab,
        "local_contrast": local_contrast,
        "normalized_darkness": normalized_darkness,
        "reflectance": reflectance,
        "ridge": ridge,
        "blackhat_response": blackhat_response.astype(np.float32),
        "sauvola_votes": sauvola_votes.astype(np.float32),
        "method_votes": method_votes,
        "source_candidate": method_votes >= 2,
        "configuration": {
            "su_window": 31,
            "su_contrast_threshold": contrast_threshold,
            "su_normalized_darkness_threshold": 0.14,
            "sauvola_windows": [31, 61, 121],
            "sauvola_k": 0.18,
            "sauvola_minimum_votes": 2,
            "blackhat_diameters": [5, 9, 15],
            "blackhat_otsu": int(blackhat_otsu),
            "method_minimum_votes": 2,
        },
    }


def summarize_pixels(
    name: str,
    mask: np.ndarray,
    probability: np.ndarray,
    features: dict[str, np.ndarray | object],
    seam_distance: np.ndarray,
) -> dict[str, object]:
    count = int(mask.sum())
    if count == 0:
        return {"name": name, "pixels": 0}
    lab = features["lab"]
    record = {"name": name, "pixels": count}
    for feature_name in (
        "gray",
        "local_contrast",
        "normalized_darkness",
        "reflectance",
        "ridge",
        "blackhat_response",
        "sauvola_votes",
        "method_votes",
    ):
        values = features[feature_name][mask]
        record[feature_name] = {
            "median": float(np.median(values)),
            "q10": float(np.quantile(values, 0.10)),
            "q90": float(np.quantile(values, 0.90)),
        }
    record["lab_median"] = [float(v) for v in np.median(lab[mask], axis=0)]
    record["probability"] = {
        "median": float(np.median(probability[mask])),
        "q10": float(np.quantile(probability[mask], 0.10)),
        "q90": float(np.quantile(probability[mask], 0.90)),
    }
    distances = seam_distance[mask]
    record["stitch_distance"] = {
        "median": float(np.median(distances)),
        "within_8px_fraction": float((distances <= 8).mean()),
        "within_16px_fraction": float((distances <= 16).mean()),
        "within_32px_fraction": float((distances <= 32).mean()),
    }
    return record


def boxes_iou(a: list[int], b: list[int]) -> float:
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    intersection = max(0, min(ax1, bx1) - max(ax0, bx0)) * max(0, min(ay1, by1) - max(ay0, by0))
    union = (ax1 - ax0) * (ay1 - ay0) + (bx1 - bx0) * (by1 - by0) - intersection
    return intersection / max(1, union)


def select_windows(missed: np.ndarray, selected: np.ndarray, count: int = 8) -> list[dict[str, object]]:
    height, width = missed.shape
    window_w = min(520, width)
    window_h = min(220, height)
    candidates = []
    for y0 in range(0, max(1, height - window_h + 1), 90):
        for x0 in range(0, max(1, width - window_w + 1), 180):
            x1, y1 = min(width, x0 + window_w), min(height, y0 + window_h)
            missed_pixels = int(missed[y0:y1, x0:x1].sum())
            selected_pixels = int(selected[y0:y1, x0:x1].sum())
            if missed_pixels < 80:
                continue
            candidates.append(
                {
                    "bbox_xyxy": [x0, y0, x1, y1],
                    "missed_pixels": missed_pixels,
                    "selected_pixels": selected_pixels,
                    "score": missed_pixels / max(1.0, np.sqrt(selected_pixels + 1)),
                }
            )
    chosen = []
    for candidate in sorted(candidates, key=lambda item: item["score"], reverse=True):
        if any(boxes_iou(candidate["bbox_xyxy"], prior["bbox_xyxy"]) > 0.20 for prior in chosen):
            continue
        chosen.append(candidate)
        if len(chosen) == count:
            break
    return chosen


def render_window_board(
    source_rgb: np.ndarray,
    probability: np.ndarray,
    selected: np.ndarray,
    uncertain: np.ndarray,
    missed_low: np.ndarray,
    missed_near_zero: np.ndarray,
    source_candidate: np.ndarray,
    bbox: list[int],
    x_boundaries: list[int],
    y_boundaries: list[int],
    title: str,
    output: Path,
) -> None:
    x0, y0, x1, y1 = bbox
    source = source_rgb[y0:y1, x0:x1]
    local_probability = probability[y0:y1, x0:x1]
    overlays = []
    probability_overlay = source.astype(np.float32) * 0.55 + 255 * 0.45
    probability_overlay[selected[y0:y1, x0:x1]] = (0, 174, 188)
    probability_overlay[uncertain[y0:y1, x0:x1]] = (42, 157, 85)
    probability_overlay[missed_low[y0:y1, x0:x1]] = (235, 157, 34)
    probability_overlay[missed_near_zero[y0:y1, x0:x1]] = (206, 77, 146)
    overlays.append(("probability anatomy", Image.fromarray(np.uint8(probability_overlay))))

    candidate_overlay = source.astype(np.float32) * 0.55 + 255 * 0.45
    candidate_overlay[source_candidate[y0:y1, x0:x1]] = (235, 65, 45)
    candidate_overlay[selected[y0:y1, x0:x1]] = (0, 174, 188)
    overlays.append(("source consensus vs selected", Image.fromarray(np.uint8(candidate_overlay))))

    heat = np.clip(local_probability * 255, 0, 255).astype(np.uint8)
    overlays.append(("raw model probability", Image.fromarray(heat, "L").convert("RGB")))

    grid = Image.fromarray(source, "RGB")
    grid_draw = ImageDraw.Draw(grid)
    for boundary in x_boundaries:
        if x0 <= boundary < x1:
            grid_draw.line((boundary - x0, 0, boundary - x0, y1 - y0), fill=(230, 45, 45), width=2)
    for boundary in y_boundaries:
        if y0 <= boundary < y1:
            grid_draw.line((0, boundary - y0, x1 - x0, boundary - y0), fill=(230, 45, 45), width=2)
    overlays.append(("released stitch boundaries", grid))

    panels = [("original source", Image.fromarray(source, "RGB")), *overlays]
    panel_width = x1 - x0
    panel_height = y1 - y0
    title_height = 68
    board = Image.new("RGB", (panel_width * 2, (panel_height + title_height) * 3), "#f3eee4")
    draw = ImageDraw.Draw(board)
    legend = "cyan >=.50 · green .20-.50 · orange .01-.20 · magenta <.01 source candidate"
    for index, (label, panel) in enumerate(panels):
        px = index % 2 * panel_width
        py = index // 2 * (panel_height + title_height)
        draw.text((px + 8, py + 7), f"{title} · {label}", fill="#222222")
        draw.text((px + 8, py + 34), legend if index == 1 else f"page bbox {bbox}", fill="#555555")
        board.paste(panel, (px, py + title_height))
    board.save(output, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--probability", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--page-id", required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()

    source_bgr = cv2.imread(str(args.source), cv2.IMREAD_COLOR)
    probability = np.load(args.probability, allow_pickle=False).astype(np.float32)
    if source_bgr is None or source_bgr.shape[:2] != probability.shape:
        raise ValueError("Source/probability shape mismatch")
    core = probability >= 0.50
    corridor, bands = line_corridors(core)
    features = source_features(source_bgr)
    source_candidate = features["source_candidate"] & corridor
    selected = source_candidate & (probability >= 0.50)
    uncertain = source_candidate & (probability >= 0.20) & (probability < 0.50)
    missed_low = source_candidate & (probability >= 0.01) & (probability < 0.20)
    missed_near_zero = source_candidate & (probability < 0.01)
    missed = missed_low | missed_near_zero

    height, width = probability.shape
    x_boundaries = stitch_boundaries(width)
    y_boundaries = stitch_boundaries(height)
    x_distance = distance_to_boundaries(width, x_boundaries)
    y_distance = distance_to_boundaries(height, y_boundaries)
    seam_distance = np.minimum(y_distance[:, None], x_distance[None, :])

    categories = {
        "selected_source_candidate_p_ge_0.50": selected,
        "uncertain_source_candidate_p_0.20_0.50": uncertain,
        "missed_source_candidate_p_0.01_0.20": missed_low,
        "missed_source_candidate_p_lt_0.01": missed_near_zero,
    }
    summaries = {
        name: summarize_pixels(name, mask, probability, features, seam_distance)
        for name, mask in categories.items()
    }
    windows = select_windows(missed, selected)
    source_rgb = cv2.cvtColor(source_bgr, cv2.COLOR_BGR2RGB)
    window_records = []
    for index, window in enumerate(windows, start=1):
        path = args.output / f"missed-window-{index:02d}.png"
        render_window_board(
            source_rgb,
            probability,
            selected,
            uncertain,
            missed_low,
            missed_near_zero,
            source_candidate,
            window["bbox_xyxy"],
            x_boundaries,
            y_boundaries,
            f"{args.page_id} missed window {index}",
            path,
        )
        window_records.append({**window, "board": path.name, "board_sha256": sha256_file(path)})

    for name, mask in categories.items():
        save_mask(mask, args.output / f"{name}.mask.png")
    record = {
        "schema_version": "eynollah-missing-ink-anatomy.v1",
        "page_id": args.page_id,
        "evidence_visibility": "acting-safe-source-and-model-output-only",
        "sealed_human_evidence_used": False,
        "source": {"path": str(args.source), "file_sha256": sha256_file(args.source)},
        "probability": {"path": str(args.probability), "file_sha256": sha256_file(args.probability)},
        "source_candidate_definition": features["configuration"],
        "line_corridors": {"bands": bands, "pixels": int(corridor.sum()), "mask_sha256": sha256_array(corridor.astype(np.uint8))},
        "released_stitch_geometry": {
            "model_size": MODEL_SIZE,
            "discard_margin": MODEL_MARGIN,
            "nominal_step": MODEL_STEP,
            "x_boundaries": x_boundaries,
            "y_boundaries": y_boundaries,
        },
        "category_summaries": summaries,
        "missed_windows": window_records,
        "runtime_seconds": time.perf_counter() - started,
    }
    record_path = args.output / "experiment.json"
    record_path.write_text(json.dumps(record, indent=2) + "\n")
    print(json.dumps({"summaries": summaries, "windows": window_records, "manifest_sha256": sha256_file(record_path)}))


if __name__ == "__main__":
    main()
