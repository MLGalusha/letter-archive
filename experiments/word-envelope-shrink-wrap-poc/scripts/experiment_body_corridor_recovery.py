#!/usr/bin/env python3
"""Test whether model-derived x bounds prevent source recovery of missed line starts."""

from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

from experiment_best_ink_pipeline_cohort import (
    compose_tiers,
    line_corridors,
    mask_metrics,
    save_mask,
    source_evidence,
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_array(array: np.ndarray) -> str:
    return hashlib.sha256(np.ascontiguousarray(array).tobytes()).hexdigest()


def inherited_body_corridor(
    original: np.ndarray,
    bands: list[dict[str, object]],
) -> tuple[np.ndarray, dict[str, object]]:
    """Extend only line rows leftward to the robust body margin.

    The y support remains model-derived.  We deliberately do not extend vertically,
    and do not widen the right edge, so this ablation isolates the missed line-start
    gate rather than broadly increasing the search area.
    """
    height, width = original.shape
    body_bands = [
        band
        for band in bands
        if band["bbox_xyxy"][0] < 0.45 * width
        and band["bbox_xyxy"][1] < 0.94 * height
        and band["bbox_xyxy"][2] - band["bbox_xyxy"][0] > 0.30 * width
    ]
    left_edges = np.asarray([band["bbox_xyxy"][0] for band in body_bands], dtype=np.int32)
    if len(left_edges) < 3:
        raise ValueError("Could not infer a stable body margin")
    inherited_left = max(0, int(np.quantile(left_edges, 0.10)))
    expanded = original.copy()
    affected_bands = []
    for band in bands:
        x0, y0, x1, y1 = (int(value) for value in band["bbox_xyxy"])
        if x0 <= inherited_left or x0 >= 0.45 * width or y0 >= 0.94 * height:
            continue
        expanded[y0:y1, inherited_left:x0] = True
        affected_bands.append({"original_bbox_xyxy": [x0, y0, x1, y1], "new_left": inherited_left})
    return expanded, {
        "body_band_count": len(body_bands),
        "body_left_edges": [int(value) for value in left_edges],
        "inherited_left_x": inherited_left,
        "affected_band_count": len(affected_bands),
        "affected_bands": affected_bands,
        "added_search_pixels": int((expanded & ~original).sum()),
    }


def white_mask(mask: np.ndarray) -> Image.Image:
    return Image.fromarray(np.where(mask, 15, 255).astype(np.uint8), "L").convert("RGB")


def overlay(source: np.ndarray, core: np.ndarray, support: np.ndarray, recovered: np.ndarray) -> Image.Image:
    canvas = source.astype(np.float32) * 0.54 + 255.0 * 0.46
    canvas[core] = (0, 174, 188)
    canvas[support] = (42, 157, 85)
    canvas[recovered] = (235, 157, 34)
    return Image.fromarray(np.uint8(canvas), "RGB")


def difference(source: np.ndarray, current: np.ndarray, expanded: np.ndarray) -> Image.Image:
    canvas = source.astype(np.float32) * 0.50 + 255.0 * 0.50
    canvas[current] = (0, 174, 188)
    canvas[expanded & ~current] = (206, 77, 146)
    return Image.fromarray(np.uint8(canvas), "RGB")


def render_crop_board(
    source: np.ndarray,
    core: np.ndarray,
    current_tiers: dict[str, np.ndarray],
    expanded_tiers: dict[str, np.ndarray],
    bbox: list[int],
    output: Path,
) -> None:
    x0, y0, x1, y1 = bbox
    crop = np.s_[y0:y1, x0:x1]
    current = np.logical_or.reduce(list(current_tiers.values()))
    expanded = np.logical_or.reduce(list(expanded_tiers.values()))
    panels = [
        ("source", Image.fromarray(source[crop], "RGB"), "unaltered page"),
        ("Eynollah core", white_mask(core[crop]), "fixed high-confidence anchor"),
        ("old gated result", white_mask(current[crop]), "search starts where Eynollah starts"),
        ("inherited-margin result", white_mask(expanded[crop]), "same tests; neighboring-line left margin"),
        ("new pixels on source", difference(source[crop], current[crop], expanded[crop]), "cyan retained · magenta newly admitted"),
        (
            "evidence tiers",
            overlay(
                source[crop],
                expanded_tiers["model_core"][crop],
                expanded_tiers["model_support"][crop],
                expanded_tiers["conservative_source_recovery"][crop],
            ),
            "cyan core · green p=.20-.50 · orange source-only",
        ),
    ]
    panel_width, panel_height = x1 - x0, y1 - y0
    title_height = 66
    board = Image.new("RGB", (3 * panel_width, 2 * (panel_height + title_height)), "#f3eee4")
    draw = ImageDraw.Draw(board)
    for index, (title, panel, subtitle) in enumerate(panels):
        px = index % 3 * panel_width
        py = index // 3 * (panel_height + title_height)
        draw.text((px + 8, py + 7), title, fill="#222222")
        draw.text((px + 8, py + 34), subtitle, fill="#555555")
        board.paste(panel, (px, py + title_height))
    board.save(output, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--probability", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--crop", type=int, nargs=4, default=[180, 80, 1700, 760])
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()

    source_bgr = cv2.imread(str(args.source), cv2.IMREAD_COLOR)
    probability = np.load(args.probability, allow_pickle=False).astype(np.float32)
    if source_bgr is None or source_bgr.shape[:2] != probability.shape:
        raise ValueError("Source/probability shape mismatch")
    source = cv2.cvtColor(source_bgr, cv2.COLOR_BGR2RGB)
    core = probability >= 0.50
    original_corridor, bands = line_corridors(core)
    expanded_corridor, corridor_record = inherited_body_corridor(original_corridor, bands)
    evidence = source_evidence(source_bgr, core, probability)
    current_tiers = compose_tiers(probability, original_corridor, evidence)
    expanded_tiers = compose_tiers(probability, expanded_corridor, evidence)
    current = np.logical_or.reduce(list(current_tiers.values()))
    expanded = np.logical_or.reduce(list(expanded_tiers.values()))
    added = expanded & ~current
    crop_mask = np.zeros_like(core)
    x0, y0, x1, y1 = args.crop
    crop_mask[y0:y1, x0:x1] = True

    outputs = {}
    for name, mask in {
        "original-corridor": original_corridor,
        "inherited-body-corridor": expanded_corridor,
        "old-gated-result": current,
        "inherited-margin-result": expanded,
        "newly-admitted": added,
    }.items():
        path = args.output / f"{name}.mask.png"
        save_mask(mask, path)
        outputs[path.name] = sha256_file(path)
    board = args.output / "top-left-corridor-ablation.png"
    render_crop_board(source, core, current_tiers, expanded_tiers, args.crop, board)
    outputs[board.name] = sha256_file(board)

    probability_tiers = {
        "p_ge_0.50": core,
        "p_0.20_0.50": (probability >= 0.20) & ~core,
        "p_0.01_0.20": (probability >= 0.01) & (probability < 0.20),
        "p_lt_0.01": probability < 0.01,
    }
    paper_seed = evidence["paper_seed"]
    record = {
        "schema_version": "body-corridor-recovery.v1",
        "evidence_visibility": "acting-safe-source-and-frozen-model-output-only",
        "sealed_human_evidence_used": False,
        "hypothesis": "model-derived per-line x bounds prevent recovery where the model misses an entire line start",
        "controlled_change": "inherit only the robust left body margin; keep source evidence and thresholds fixed",
        "inputs": {
            "source": str(args.source),
            "source_sha256": sha256_file(args.source),
            "probability": str(args.probability),
            "probability_file_sha256": sha256_file(args.probability),
            "probability_float32_pixel_sha256": sha256_array(probability),
        },
        "crop_bbox_xyxy": args.crop,
        "corridor": corridor_record,
        "metrics": {
            "current": mask_metrics(current),
            "expanded": mask_metrics(expanded),
            "new_pixels": int(added.sum()),
            "new_pixels_in_crop": int((added & crop_mask).sum()),
            "new_pixels_by_model_probability": {
                name: int((added & mask).sum()) for name, mask in probability_tiers.items()
            },
            "new_paper_proxy_pixels": int((added & paper_seed).sum()),
            "new_pixels_by_tier": {
                name: int((expanded_tiers[name] & ~current_tiers[name]).sum())
                for name in expanded_tiers
            },
        },
        "guardrail": "No added pixel is treated as ground truth; visual stroke continuity and contamination must both be assessed.",
        "outputs": outputs,
        "runtime_seconds": time.perf_counter() - started,
    }
    manifest = args.output / "experiment.json"
    manifest.write_text(json.dumps(record, indent=2) + "\n")
    print(json.dumps({"metrics": record["metrics"], "corridor": corridor_record, "manifest_sha256": sha256_file(manifest)}))


if __name__ == "__main__":
    main()
