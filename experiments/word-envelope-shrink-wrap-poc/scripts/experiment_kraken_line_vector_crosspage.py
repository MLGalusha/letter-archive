#!/usr/bin/env python3
"""Test line-conditioned vector proposals on automatic Kraken crops across pages."""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

from experiment_line_conditioned_vector_ink import learn_scores, structured_score, training_seeds
from experiment_page_adaptive_vector_ink import (
    DECISION_THRESHOLD,
    component_count,
    feature_stack,
    load_source,
    method_metrics,
    sha256_array,
    sha256_file,
)


PAGES = (
    "001-18881103-L01-01",
    "002-19001113-L01-02",
)
MARGIN = 90
CORRIDOR_RADIUS = 30
MINIMUM_LINE_WIDTH = 500


def page_paths(root: Path, page_id: str) -> tuple[Path, Path, Path]:
    hybrid_root = root / "artifacts/eynollah-hybrid-binarization-trial-20260809" / page_id
    conditioning = root / "artifacts/eynollah-line-conditioning-v1" / page_id / "experiment.json"
    condition_record = json.loads(conditioning.read_text())
    return (
        Path(condition_record["source"]["path"]),
        hybrid_root / "foreground-probability.float16.npy",
        Path(condition_record["kraken_layout"]["path"]),
    )


def bounds(points: list[dict[str, float]], width: int, height: int) -> tuple[int, int, int, int]:
    xs = [float(point["x"]) for point in points]
    ys = [float(point["y"]) for point in points]
    x0 = max(0, int(np.floor(min(xs))) - MARGIN)
    y0 = max(0, int(np.floor(min(ys))) - MARGIN)
    x1 = min(width, int(np.ceil(max(xs))) + MARGIN + 1)
    y1 = min(height, int(np.ceil(max(ys))) + MARGIN + 1)
    return x0, y0, x1, y1


def polygon_mask(points: list[dict[str, float]], crop: tuple[int, int, int, int]) -> np.ndarray:
    x0, y0, x1, y1 = crop
    image = Image.new("L", (x1 - x0, y1 - y0), 0)
    draw = ImageDraw.Draw(image)
    draw.polygon([(round(point["x"] - x0), round(point["y"] - y0)) for point in points], fill=255)
    return np.asarray(image) > 0


def select_lines(
    layout: dict[str, object], probability: np.ndarray
) -> list[tuple[str, dict[str, object], float]]:
    height, width = probability.shape
    candidates: list[tuple[dict[str, object], float]] = []
    for line in layout["lines"]:
        points = line["boundary"]
        xs = [float(point["x"]) for point in points]
        if max(xs) - min(xs) < MINIMUM_LINE_WIDTH:
            continue
        crop = bounds(points, width, height)
        line_mask = polygon_mask(points, crop)
        x0, y0, x1, y1 = crop
        local_probability = probability[y0:y1, x0:x1]
        density = float(((local_probability >= 0.50) & line_mask).sum() / max(1, line_mask.sum()))
        candidates.append((line, density))
    candidates.sort(key=lambda item: item[1])
    if len(candidates) < 3:
        raise ValueError("Need at least three eligible Kraken lines")
    chosen: list[tuple[str, dict[str, object], float]] = []
    for rank, index in (("low", 0), ("median", len(candidates) // 2), ("high", len(candidates) - 1)):
        line, density = candidates[index]
        chosen.append((rank, line, density))
    return chosen


def overlay(source: np.ndarray, mask: np.ndarray, colour: tuple[int, int, int]) -> Image.Image:
    result = source.astype(np.float32) * 0.70 + 255.0 * 0.30
    result[mask] = colour
    return Image.fromarray(np.clip(result, 0, 255).astype(np.uint8), "RGB")


def review_board(
    source: np.ndarray,
    polygon: np.ndarray,
    corridor: np.ndarray,
    anchor: np.ndarray,
    proposal: np.ndarray,
    title: str,
    output: Path,
) -> None:
    panels = (
        ("source", Image.fromarray(source, "RGB")),
        ("Kraken boundary + 30px corridor", overlay(source, corridor, (230, 170, 30))),
        ("Eynollah anchor", overlay(source, anchor, (0, 185, 200))),
        ("anchor + vector additions", overlay(np.asarray(overlay(source, anchor, (0, 185, 200))), proposal, (230, 45, 55))),
    )
    panel_width = 720
    panel_height = max(120, round(source.shape[0] * panel_width / source.shape[1]))
    title_height = 58
    board = Image.new("RGB", (panel_width * 2, (panel_height + title_height) * 2), "#f3eee4")
    draw = ImageDraw.Draw(board)
    for index, (label, panel) in enumerate(panels):
        x = (index % 2) * panel_width
        y = (index // 2) * (panel_height + title_height)
        draw.text((x + 10, y + 8), title, fill="#222222")
        draw.text((x + 10, y + 31), label, fill="#555555")
        board.paste(panel.resize((panel_width, panel_height), Image.Resampling.LANCZOS), (x, y + title_height))
    board.save(output, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("experiments/word-envelope-shrink-wrap-poc"))
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    page_records: dict[str, object] = {}

    for page_id in PAGES:
        source_path, probability_path, layout_path = page_paths(args.root, page_id)
        source = load_source(source_path)
        probability = np.load(probability_path, allow_pickle=False).astype(np.float32)
        layout = json.loads(layout_path.read_text())
        height, width = probability.shape
        selected = select_lines(layout, probability)
        line_records: dict[str, object] = {}

        for rank, line, anchor_density in selected:
            line_started = time.perf_counter()
            crop = bounds(line["boundary"], width, height)
            x0, y0, x1, y1 = crop
            local_source = source[y0:y1, x0:x1]
            local_probability = probability[y0:y1, x0:x1]
            boundary = polygon_mask(line["boundary"], crop)
            corridor = ndimage.distance_transform_edt(~boundary) <= CORRIDOR_RADIUS
            anchor = (local_probability >= 0.50) & corridor
            features, auxiliaries = feature_stack(local_source)
            positive, negative, seed_stats = training_seeds(local_probability, auxiliaries, corridor)
            scores, training = learn_scores(features, positive, negative, corridor)
            structured, structure = structured_score(scores["line-prototype"])
            agreement = (
                (structured >= DECISION_THRESHOLD)
                & (scores["line-hist-gradient-boosting"] >= 0.50)
            )
            additions = agreement & ~anchor
            metrics = method_metrics(agreement.astype(np.float32), anchor, local_probability)
            label = f"{rank}-{line['id'].split('-')[-1]}"
            line_dir = args.output / page_id / label
            line_dir.mkdir(parents=True, exist_ok=True)
            score_path = line_dir / "prototype-classifier-agreement.score.float16.npy"
            mask_path = line_dir / "prototype-classifier-agreement.p080.png"
            corridor_path = line_dir / "kraken-corridor.png"
            np.save(score_path, agreement.astype(np.float16), allow_pickle=False)
            Image.fromarray(np.where(agreement, 0, 255).astype(np.uint8), "L").save(mask_path)
            Image.fromarray(np.where(corridor, 0, 255).astype(np.uint8), "L").save(corridor_path)
            board_path = line_dir / "cross-page-line-vector-review.png"
            review_board(local_source, boundary, corridor, anchor, additions, f"{page_id} · {rank} anchor-density line", board_path)
            line_records[label] = {
                "selection_rank": rank,
                "line_id": line["id"],
                "reading_order": line.get("readingOrder"),
                "bbox_xyxy": list(crop),
                "kraken_boundary_anchor_density_p050": anchor_density,
                "kraken_boundary_pixel_count": int(boundary.sum()),
                "corridor_pixel_count": int(corridor.sum()),
                "anchor_pixels": int(anchor.sum()),
                "seed_stats": {**seed_stats, "positive_pixels": int(positive.sum()), "negative_pixels": int(negative.sum())},
                "training": training,
                "structure": structure,
                "proposal": metrics,
                "proposal_to_anchor_ratio": float(metrics["addition_pixels"] / max(1, anchor.sum())),
                "proposal_component_median_area": float(np.median(np.bincount(ndimage.label(additions)[0].ravel())[1:])) if additions.any() else 0.0,
                "corridor_mask_pixel_sha256": sha256_array(corridor.astype(np.uint8)),
                "outputs": {
                    "score": {"file": str(score_path.relative_to(args.output)), "file_sha256": sha256_file(score_path)},
                    "mask": {"file": str(mask_path.relative_to(args.output)), "file_sha256": sha256_file(mask_path)},
                    "corridor": {"file": str(corridor_path.relative_to(args.output)), "file_sha256": sha256_file(corridor_path)},
                    "review_board": {"file": str(board_path.relative_to(args.output)), "file_sha256": sha256_file(board_path)},
                },
                "runtime_seconds": time.perf_counter() - line_started,
            }

        page_records[page_id] = {
            "source": {"path": str(source_path), "file_sha256": sha256_file(source_path)},
            "hybrid_probability": {"path": str(probability_path), "file_sha256": sha256_file(probability_path)},
            "kraken_layout": {"path": str(layout_path), "file_sha256": sha256_file(layout_path)},
            "eligible_line_count": sum(1 for line in layout["lines"] if max(point["x"] for point in line["boundary"]) - min(point["x"] for point in line["boundary"]) >= MINIMUM_LINE_WIDTH),
            "lines": line_records,
        }

    manifest = {
        "schema_version": "kraken-line-vector-crosspage.v1",
        "experiment_status": "measurement_complete_visual_review_pending",
        "sealed_human_evidence_used": False,
        "selection_rule": "On each independent page, automatically choose eligible Kraken lines at low, median, and high Eynollah p0.50 density; no human visual choice enters selection.",
        "geometry_rule": {"kraken_boundary_expansion_pixels": CORRIDOR_RADIUS, "crop_margin_pixels": MARGIN, "minimum_line_width_pixels": MINIMUM_LINE_WIDTH},
        "interpretation_guardrail": "No human ownership truth is available. Red pixels are review proposals, not recovered-ink correctness. Compare coherence, texture, component burden, and page/rank stability—not pixel count alone.",
        "pages": page_records,
        "runtime_seconds": time.perf_counter() - started,
    }
    manifest_path = args.output / "experiment.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"manifest": str(manifest_path), "runtime_seconds": manifest["runtime_seconds"]}, indent=2))


if __name__ == "__main__":
    main()
