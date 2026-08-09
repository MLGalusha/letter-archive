#!/usr/bin/env python3
"""Remove reference-recovery pixels near an automatically detected page edge."""

from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

from experiment_best_ink_pipeline_cohort import save_mask


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_array(array: np.ndarray) -> str:
    return hashlib.sha256(np.ascontiguousarray(array).tobytes()).hexdigest()


def black_mask(path: Path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("L")) < 128


def detect_page(source_bgr: np.ndarray) -> tuple[np.ndarray, np.ndarray, dict[str, object]]:
    saturation = cv2.cvtColor(source_bgr, cv2.COLOR_BGR2HSV)[..., 1]
    otsu, raw = cv2.threshold(saturation, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    closed = cv2.morphologyEx(
        raw,
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (41, 41)),
    )
    count, labels, stats, _ = cv2.connectedComponentsWithStats(closed, 8)
    if count <= 1:
        raise ValueError("No page component found")
    component_id = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    component = np.where(labels == component_id, 255, 0).astype(np.uint8)
    contours, _ = cv2.findContours(component, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    page = np.zeros_like(component)
    cv2.drawContours(page, contours, -1, 255, thickness=cv2.FILLED)
    distance = cv2.distanceTransform(page, cv2.DIST_L2, 5)
    return page > 0, distance, {
        "HSV_saturation_otsu": int(otsu),
        "closing_kernel": [41, 41],
        "largest_component_pixels_before_fill": int((component > 0).sum()),
        "filled_page_pixels": int((page > 0).sum()),
        "page_mask_uint8_pixel_sha256": sha256_array((page > 0).astype(np.uint8)),
    }


def white_mask(mask: np.ndarray) -> Image.Image:
    return Image.fromarray(np.where(mask, 15, 255).astype(np.uint8), "L").convert("RGB")


def overlay(source: np.ndarray, core: np.ndarray, kept: np.ndarray, removed: np.ndarray) -> Image.Image:
    canvas = source.astype(np.float32) * 0.52 + 255.0 * 0.48
    canvas[core] = (0, 174, 188)
    canvas[kept] = (206, 77, 146)
    canvas[removed] = (235, 157, 34)
    return Image.fromarray(np.uint8(canvas), "RGB")


def render_board(
    source: np.ndarray,
    core: np.ndarray,
    candidate: np.ndarray,
    page: np.ndarray,
    distances: np.ndarray,
    guarded: dict[str, np.ndarray],
    output: Path,
) -> None:
    distance_preview = np.uint8(255 * np.clip(distances / 40.0, 0.0, 1.0))
    panels = [
        ("source", Image.fromarray(source, "RGB"), "unaltered top-left crop"),
        ("detected page interior", white_mask(page), "saturation segmentation; largest filled component"),
        ("distance inside edge", Image.fromarray(distance_preview, "L").convert("RGB"), "white >=40 px inside page"),
        ("unguarded q99 hysteresis", white_mask(core | candidate), "contains page-edge response"),
        ("12 px inward guard", white_mask(core | guarded["guard-12px"]), "anchor fixed; only review additions guarded"),
        (
            "guard decision on source",
            overlay(source, core, guarded["guard-12px"] & ~core, candidate & ~guarded["guard-12px"] & ~core),
            "cyan anchor · magenta kept · gold removed",
        ),
    ]
    height, width = core.shape
    title_height = 66
    board = Image.new("RGB", (3 * width, 2 * (height + title_height)), "#f3eee4")
    draw = ImageDraw.Draw(board)
    for index, (title, panel, subtitle) in enumerate(panels):
        x = index % 3 * width
        y = index // 3 * (height + title_height)
        draw.text((x + 8, y + 7), title, fill="#222222")
        draw.text((x + 8, y + 34), subtitle, fill="#555555")
        board.paste(panel, (x, y + title_height))
    board.save(output, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--probability", type=Path, required=True)
    parser.add_argument("--reference-hysteresis-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()

    hysteresis_manifest_path = args.reference_hysteresis_root / "experiment.json"
    hysteresis_manifest = json.loads(hysteresis_manifest_path.read_text())
    if hysteresis_manifest.get("sealed_human_evidence_used") is not False:
        raise ValueError("Hysteresis visibility assertion is missing")
    x0, y0, x1, y1 = hysteresis_manifest["inputs"]["crop_bbox_xyxy"]
    source_page = cv2.imread(str(args.source), cv2.IMREAD_COLOR)
    probability_page = np.load(args.probability, allow_pickle=False).astype(np.float32)
    if source_page is None or source_page.shape[:2] != probability_page.shape:
        raise ValueError("Source/probability shape mismatch")
    page, distances, page_record = detect_page(source_page)
    source = cv2.cvtColor(source_page[y0:y1, x0:x1], cv2.COLOR_BGR2RGB)
    probability = probability_page[y0:y1, x0:x1]
    core = probability >= 0.50
    page_crop = page[y0:y1, x0:x1]
    distance_crop = distances[y0:y1, x0:x1]
    candidate = black_mask(args.reference_hysteresis_root / "hysteresis-q990-from-q995.mask.png")
    if candidate.shape != core.shape:
        raise ValueError("Candidate/crop shape mismatch")

    guards = (4, 8, 12, 16, 24)
    guarded = {f"guard-{distance}px": candidate & page_crop & (distance_crop >= distance) for distance in guards}
    outputs = {}
    page_path = args.output / "detected-page.mask.png"
    save_mask(page_crop, page_path)
    outputs[page_path.name] = sha256_file(page_path)
    for name, mask in guarded.items():
        path = args.output / f"{name}.mask.png"
        save_mask(mask, path)
        outputs[path.name] = sha256_file(path)
    board = args.output / "top-left-page-boundary-guard.png"
    render_board(source, core, candidate, page_crop, distance_crop, guarded, board)
    outputs[board.name] = sha256_file(board)

    metrics = {}
    for name, mask in guarded.items():
        removed = candidate & ~mask
        removed_addition = removed & ~core
        kept_addition = mask & ~core
        metrics[name] = {
            "candidate_pixels_retained": int(mask.sum()),
            "review_addition_pixels_retained": int(kept_addition.sum()),
            "review_addition_pixels_removed": int(removed_addition.sum()),
            "removed_Eynollah_core_overlap": int((removed & core).sum()),
            "retained_mask_uint8_pixel_sha256": sha256_array(mask.astype(np.uint8)),
        }
    record = {
        "schema_version": "page-boundary-guard.v1",
        "evidence_visibility": "acting-safe-source-and-frozen-model-output-only",
        "sealed_human_evidence_used": False,
        "hypothesis": "the strongest structured false positive is the physical page edge and can be removed geometrically",
        "inputs": {
            "source_sha256": sha256_file(args.source),
            "probability_file_sha256": sha256_file(args.probability),
            "hysteresis_manifest_sha256": sha256_file(hysteresis_manifest_path),
            "candidate_mask_sha256": sha256_file(args.reference_hysteresis_root / "hysteresis-q990-from-q995.mask.png"),
            "crop_bbox_xyxy": [x0, y0, x1, y1],
        },
        "page_detection": page_record,
        "metrics": metrics,
        "guardrail": "The Eynollah anchor is never removed; this guard applies only to review additions.",
        "outputs": outputs,
        "runtime_seconds": time.perf_counter() - started,
    }
    manifest = args.output / "experiment.json"
    manifest.write_text(json.dumps(record, indent=2) + "\n")
    print(json.dumps({"page_detection": page_record, "metrics": metrics, "manifest_sha256": sha256_file(manifest)}))


if __name__ == "__main__":
    main()
