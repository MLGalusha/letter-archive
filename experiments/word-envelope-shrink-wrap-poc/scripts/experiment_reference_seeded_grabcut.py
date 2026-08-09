#!/usr/bin/env python3
"""Use Eynollah/reference/paper seeds in a spatial GrabCut segmentation."""

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
from experiment_page_boundary_guard import detect_page


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_array(array: np.ndarray) -> str:
    return hashlib.sha256(np.ascontiguousarray(array).tobytes()).hexdigest()


def white_mask(mask: np.ndarray) -> Image.Image:
    return Image.fromarray(np.where(mask, 15, 255).astype(np.uint8), "L").convert("RGB")


def seed_overlay(source: np.ndarray, seeds: np.ndarray) -> Image.Image:
    canvas = source.astype(np.float32) * 0.52 + 255.0 * 0.48
    canvas[seeds == cv2.GC_BGD] = (80, 80, 80)
    canvas[seeds == cv2.GC_PR_BGD] = (220, 220, 220)
    canvas[seeds == cv2.GC_PR_FGD] = (206, 77, 146)
    canvas[seeds == cv2.GC_FGD] = (0, 174, 188)
    return Image.fromarray(np.uint8(canvas), "RGB")


def result_overlay(source: np.ndarray, core: np.ndarray, result: np.ndarray) -> Image.Image:
    canvas = source.astype(np.float32) * 0.52 + 255.0 * 0.48
    canvas[core] = (0, 174, 188)
    canvas[result & ~core] = (206, 77, 146)
    return Image.fromarray(np.uint8(canvas), "RGB")


def render_board(
    source: np.ndarray,
    core: np.ndarray,
    balanced: np.ndarray,
    seeds: np.ndarray,
    methods: dict[str, np.ndarray],
    output: Path,
) -> None:
    panels = [
        ("source", Image.fromarray(source, "RGB"), "unaltered crop"),
        ("seed map", seed_overlay(source, seeds), "cyan definite ink · magenta probable · gray paper"),
        ("pixelwise reference", white_mask(core | balanced), "balanced vector candidate before spatial optimization"),
        ("GrabCut 1 iteration", white_mask(methods["grabcut-1"]), "appearance + neighboring pixels"),
        ("GrabCut 5 iterations", white_mask(methods["grabcut-5"]), "additional mixture refinement"),
        (
            "5-iteration additions",
            result_overlay(source, core, methods["grabcut-5"]),
            "cyan fixed anchor · magenta spatially selected additions",
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


def metrics(mask: np.ndarray, core: np.ndarray, probability: np.ndarray) -> dict[str, object]:
    additions = mask & ~core
    count, _, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    return {
        "pixels": int(mask.sum()),
        "components": int(count - 1),
        "components_ge_8px": int((stats[1:, cv2.CC_STAT_AREA] >= 8).sum()),
        "Eynollah_anchor_retention": float((mask & core).sum() / max(1, core.sum())),
        "review_addition_pixels": int(additions.sum()),
        "addition_by_Eynollah_probability": {
            "p_0.20_0.50": int((additions & (probability >= 0.20)).sum()),
            "p_0.01_0.20": int((additions & (probability >= 0.01) & (probability < 0.20)).sum()),
            "p_lt_0.01": int((additions & (probability < 0.01)).sum()),
        },
        "mask_uint8_pixel_sha256": sha256_array(mask.astype(np.uint8)),
    }


def run_grabcut(source: np.ndarray, initial: np.ndarray, iterations: int) -> tuple[np.ndarray, np.ndarray]:
    mask = initial.copy()
    background_model = np.zeros((1, 65), np.float64)
    foreground_model = np.zeros((1, 65), np.float64)
    cv2.grabCut(
        source,
        mask,
        None,
        background_model,
        foreground_model,
        iterations,
        cv2.GC_INIT_WITH_MASK,
    )
    foreground = (mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD)
    return foreground, mask


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--probability", type=Path, required=True)
    parser.add_argument("--reference-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()

    reference_path = args.reference_root / "experiment.json"
    reference = json.loads(reference_path.read_text())
    if reference.get("sealed_human_evidence_used") is not False:
        raise ValueError("Reference visibility assertion is missing")
    x0, y0, x1, y1 = reference["inputs"]["crop_bbox_xyxy"]
    source_page = cv2.imread(str(args.source), cv2.IMREAD_COLOR)
    probability_page = np.load(args.probability, allow_pickle=False).astype(np.float32)
    if source_page is None or source_page.shape[:2] != probability_page.shape:
        raise ValueError("Source/probability shape mismatch")
    core_page = probability_page >= 0.50
    original_corridor, bands = line_corridors(core_page)
    corridor_page, corridor_record = inherited_body_corridor(original_corridor, bands)
    page, distance, page_record = detect_page(source_page)

    source = source_page[y0:y1, x0:x1]
    source_rgb = cv2.cvtColor(source, cv2.COLOR_BGR2RGB)
    probability = probability_page[y0:y1, x0:x1]
    core = probability >= 0.50
    corridor = corridor_page[y0:y1, x0:x1]
    page_crop = page[y0:y1, x0:x1]
    distance_crop = distance[y0:y1, x0:x1]
    score_path = args.reference_root / "local-reference-score.float16.npy"
    score = np.load(score_path, allow_pickle=False).astype(np.float32)
    thresholds = reference["thresholds"]
    balanced = corridor & (score >= thresholds["paper_q995"])
    probable = corridor & (score >= thresholds["paper_q990"])

    seeds = np.full(core.shape, cv2.GC_PR_BGD, dtype=np.uint8)
    seeds[~page_crop | (distance_crop < 12.0) | ~corridor] = cv2.GC_BGD
    seeds[probable & page_crop & (distance_crop >= 12.0)] = cv2.GC_PR_FGD
    seeds[core] = cv2.GC_FGD
    methods = {}
    final_label_maps = {}
    for iterations in (1, 3, 5):
        foreground, labels = run_grabcut(source, seeds, iterations)
        methods[f"grabcut-{iterations}"] = core | foreground
        final_label_maps[f"grabcut-{iterations}"] = labels

    outputs = {}
    for name, mask in methods.items():
        path = args.output / f"{name}.mask.png"
        save_mask(mask, path)
        outputs[path.name] = sha256_file(path)
    seed_path = args.output / "grabcut-initial-seeds.uint8.npy"
    np.save(seed_path, seeds, allow_pickle=False)
    outputs[seed_path.name] = sha256_file(seed_path)
    board = args.output / "top-left-reference-seeded-grabcut.png"
    render_board(source_rgb, core, balanced, seeds, methods, board)
    outputs[board.name] = sha256_file(board)

    seed_counts = {
        "definite_background": int((seeds == cv2.GC_BGD).sum()),
        "probable_background": int((seeds == cv2.GC_PR_BGD).sum()),
        "probable_foreground": int((seeds == cv2.GC_PR_FGD).sum()),
        "definite_foreground": int((seeds == cv2.GC_FGD).sum()),
    }
    record = {
        "schema_version": "reference-seeded-grabcut.v1",
        "evidence_visibility": "acting-safe-source-and-frozen-model-output-only",
        "sealed_human_evidence_used": False,
        "hypothesis": "a spatial optimizer can turn fragmented page-specific ink scores into coherent source-pixel regions",
        "inputs": {
            "source_sha256": sha256_file(args.source),
            "probability_file_sha256": sha256_file(args.probability),
            "reference_manifest_sha256": sha256_file(reference_path),
            "reference_score_sha256": sha256_file(score_path),
            "crop_bbox_xyxy": [x0, y0, x1, y1],
        },
        "seed_counts": seed_counts,
        "page_detection": page_record,
        "corridor": corridor_record,
        "methods": {name: metrics(mask, core, probability) for name, mask in methods.items()},
        "final_label_counts": {
            name: {str(label): int((labels == label).sum()) for label in range(4)}
            for name, labels in final_label_maps.items()
        },
        "guardrails": [
            "The Eynollah core is forced to definite foreground and retained in every output.",
            "Outside-page, boundary, and outside-corridor pixels are definite background.",
            "GrabCut output is a review proposal, not ground truth.",
            "Spatial smoothness may erase thin strokes or absorb similarly colored paper regions.",
        ],
        "outputs": outputs,
        "runtime_seconds": time.perf_counter() - started,
    }
    manifest = args.output / "experiment.json"
    manifest.write_text(json.dumps(record, indent=2) + "\n")
    print(json.dumps({"seed_counts": seed_counts, "methods": record["methods"], "manifest_sha256": sha256_file(manifest)}))


if __name__ == "__main__":
    main()
