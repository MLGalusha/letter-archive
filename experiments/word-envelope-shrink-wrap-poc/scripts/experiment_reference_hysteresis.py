#!/usr/bin/env python3
"""Grow strong page-specific ink-reference seeds through weaker exact-source evidence."""

from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

from experiment_best_ink_pipeline_cohort import line_corridors, save_mask
from experiment_body_corridor_recovery import inherited_body_corridor


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_array(array: np.ndarray) -> str:
    return hashlib.sha256(np.ascontiguousarray(array).tobytes()).hexdigest()


def hysteresis_components(
    weak: np.ndarray,
    strong: np.ndarray,
    maximum_aspect: float = 28.0,
) -> tuple[np.ndarray, dict[str, int]]:
    """Keep exact weak pixels only in components containing a strong seed."""
    count, labels, stats, _ = cv2.connectedComponentsWithStats(weak.astype(np.uint8), 8)
    strong_ids = np.unique(labels[strong])
    keep = np.zeros(count, dtype=bool)
    kept_components = 0
    rejected_shape = 0
    rejected_unseeded = 0
    for component_id in range(1, count):
        if component_id not in strong_ids:
            rejected_unseeded += 1
            continue
        width = int(stats[component_id, cv2.CC_STAT_WIDTH])
        height = int(stats[component_id, cv2.CC_STAT_HEIGHT])
        area = int(stats[component_id, cv2.CC_STAT_AREA])
        aspect = max(width / max(1, height), height / max(1, width))
        if area < 2 or aspect > maximum_aspect:
            rejected_shape += 1
            continue
        keep[component_id] = True
        kept_components += 1
    return keep[labels], {
        "weak_components": int(count - 1),
        "kept_seeded_components": kept_components,
        "rejected_unseeded_components": rejected_unseeded,
        "rejected_shape_components": rejected_shape,
    }


def white_mask(mask: np.ndarray) -> Image.Image:
    return Image.fromarray(np.where(mask, 15, 255).astype(np.uint8), "L").convert("RGB")


def overlay(source: np.ndarray, core: np.ndarray, additions: np.ndarray) -> Image.Image:
    canvas = source.astype(np.float32) * 0.52 + 255.0 * 0.48
    canvas[core] = (0, 174, 188)
    canvas[additions] = (206, 77, 146)
    return Image.fromarray(np.uint8(canvas), "RGB")


def render_board(
    source: np.ndarray,
    core: np.ndarray,
    methods: dict[str, np.ndarray],
    output: Path,
) -> None:
    balanced = methods["balanced-q995"]
    conservative = methods["hysteresis-q990-from-q995"]
    broad = methods["hysteresis-q950-from-q995"]
    panels = [
        ("source", Image.fromarray(source, "RGB"), "unaltered top-left crop"),
        ("Eynollah anchor", white_mask(core), "fixed; never removed"),
        ("balanced threshold", white_mask(core | balanced), "fragmented reference candidates"),
        ("q99 hysteresis", white_mask(core | conservative), "weaker pixels only along strong components"),
        ("q95 hysteresis", white_mask(core | broad), "broader continuation; higher contamination risk"),
        (
            "q99 additions on source",
            overlay(source, core, conservative & ~core),
            "cyan anchor · magenta connected review additions",
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


def method_metrics(mask: np.ndarray, core: np.ndarray, probability: np.ndarray) -> dict[str, object]:
    additions = mask & ~core
    count, _, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    return {
        "candidate_pixels": int(mask.sum()),
        "candidate_components": int(count - 1),
        "candidate_components_ge_8px": int((stats[1:, cv2.CC_STAT_AREA] >= 8).sum()),
        "review_addition_pixels": int(additions.sum()),
        "addition_by_Eynollah_probability": {
            "p_0.20_0.50": int((additions & (probability >= 0.20)).sum()),
            "p_0.01_0.20": int((additions & (probability >= 0.01) & (probability < 0.20)).sum()),
            "p_lt_0.01": int((additions & (probability < 0.01)).sum()),
        },
        "mask_uint8_pixel_sha256": sha256_array(mask.astype(np.uint8)),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--probability", type=Path, required=True)
    parser.add_argument("--reference-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()

    reference_manifest_path = args.reference_root / "experiment.json"
    reference = json.loads(reference_manifest_path.read_text())
    if reference.get("sealed_human_evidence_used") is not False:
        raise ValueError("Reference experiment visibility assertion is missing")
    x0, y0, x1, y1 = reference["inputs"]["crop_bbox_xyxy"]
    source_page = cv2.imread(str(args.source), cv2.IMREAD_COLOR)
    probability_page = np.load(args.probability, allow_pickle=False).astype(np.float32)
    if source_page is None or source_page.shape[:2] != probability_page.shape:
        raise ValueError("Source/probability shape mismatch")
    core_page = probability_page >= 0.50
    original_corridor, bands = line_corridors(core_page)
    expanded_corridor, corridor_record = inherited_body_corridor(original_corridor, bands)
    source = cv2.cvtColor(source_page[y0:y1, x0:x1], cv2.COLOR_BGR2RGB)
    probability = probability_page[y0:y1, x0:x1]
    core = probability >= 0.50
    corridor = expanded_corridor[y0:y1, x0:x1]
    score_path = args.reference_root / "local-reference-score.float16.npy"
    score = np.load(score_path, allow_pickle=False).astype(np.float32)
    if score.shape != core.shape:
        raise ValueError("Reference score/crop shape mismatch")
    thresholds = reference["thresholds"]

    weak950 = corridor & (score >= thresholds["paper_q950"])
    weak990 = corridor & (score >= thresholds["paper_q990"])
    strong995 = corridor & (score >= thresholds["paper_q995"])
    strong999 = corridor & (score >= thresholds["paper_q999"])
    h990_995, audit_990_995 = hysteresis_components(weak990, strong995)
    h950_995, audit_950_995 = hysteresis_components(weak950, strong995)
    h950_999, audit_950_999 = hysteresis_components(weak950, strong999)
    methods = {
        "strict-q999": strong999,
        "balanced-q995": strong995,
        "hysteresis-q990-from-q995": h990_995,
        "hysteresis-q950-from-q995": h950_995,
        "hysteresis-q950-from-q999": h950_999,
    }

    outputs = {}
    for name, mask in methods.items():
        path = args.output / f"{name}.mask.png"
        save_mask(mask, path)
        outputs[path.name] = sha256_file(path)
    board = args.output / "top-left-reference-hysteresis.png"
    render_board(source, core, methods, board)
    outputs[board.name] = sha256_file(board)

    record = {
        "schema_version": "reference-hysteresis.v1",
        "evidence_visibility": "acting-safe-source-and-frozen-model-output-only",
        "sealed_human_evidence_used": False,
        "hypothesis": "strong reference matches can seed weaker exact-source pixels belonging to the same stroke components",
        "inputs": {
            "source_sha256": sha256_file(args.source),
            "probability_file_sha256": sha256_file(args.probability),
            "reference_manifest_sha256": sha256_file(reference_manifest_path),
            "reference_score_sha256": sha256_file(score_path),
            "crop_bbox_xyxy": [x0, y0, x1, y1],
        },
        "thresholds": thresholds,
        "component_audits": {
            "hysteresis-q990-from-q995": audit_990_995,
            "hysteresis-q950-from-q995": audit_950_995,
            "hysteresis-q950-from-q999": audit_950_999,
        },
        "corridor": corridor_record,
        "metrics": {name: method_metrics(mask, core, probability) for name, mask in methods.items()},
        "guardrails": [
            "Only original source pixels passing the weak threshold are retained.",
            "Connectivity is used for admission; no dilation or closing pixels become labels.",
            "The method cannot cross a true score gap, so some faint strokes will remain fragmented.",
            "Page edges and stains can also form seeded components; visual contamination remains required.",
        ],
        "outputs": outputs,
        "runtime_seconds": time.perf_counter() - started,
    }
    manifest = args.output / "experiment.json"
    manifest.write_text(json.dumps(record, indent=2) + "\n")
    print(json.dumps({"metrics": record["metrics"], "component_audits": record["component_audits"], "manifest_sha256": sha256_file(manifest)}))


if __name__ == "__main__":
    main()
