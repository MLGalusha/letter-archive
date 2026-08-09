#!/usr/bin/env python3
"""Kraken-line, Eynollah-stroke-width adaptive grouping of faint ink fragments."""

from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw
from skimage.morphology import skeletonize

from experiment_best_ink_pipeline_cohort import save_mask
from experiment_page_boundary_guard import detect_page


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_array(array: np.ndarray) -> str:
    return hashlib.sha256(np.ascontiguousarray(array).tobytes()).hexdigest()


def odd_at_least(value: float, minimum: int) -> int:
    rounded = max(minimum, int(round(value)))
    return rounded if rounded % 2 else rounded + 1


def crop_polygon(points: list[list[float]], crop: list[int], dilation: int = 0) -> np.ndarray:
    x0, y0, x1, y1 = crop
    mask = np.zeros((y1 - y0, x1 - x0), dtype=np.uint8)
    polygon = np.round(np.asarray(points, dtype=np.float32) - np.asarray([x0, y0])).astype(np.int32)
    if len(polygon) >= 3:
        cv2.fillPoly(mask, [polygon], 1)
    if dilation:
        size = 2 * dilation + 1
        mask = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (size, size)))
    return mask > 0


def crop_baseline(points: list[list[float]], crop: list[int]) -> np.ndarray:
    x0, y0, x1, y1 = crop
    mask = np.zeros((y1 - y0, x1 - x0), dtype=np.uint8)
    line = np.round(np.asarray(points, dtype=np.float32) - np.asarray([x0, y0])).astype(np.int32)
    if len(line) >= 2:
        cv2.polylines(mask, [line], False, 1, thickness=1)
    return mask > 0


def selected_lines(provider: dict[str, object], crop: list[int]) -> list[dict[str, object]]:
    x0, y0, x1, y1 = crop
    records = []
    for line in provider["segmentation"]["lines"]:
        points = line.get("boundary") or line.get("baseline") or []
        if not points:
            continue
        xs = [point[0] for point in points]
        ys = [point[1] for point in points]
        bbox = [min(xs), min(ys), max(xs) + 1, max(ys) + 1]
        intersection = max(0, min(x1, bbox[2]) - max(x0, bbox[0])) * max(0, min(y1, bbox[3]) - max(y0, bbox[1]))
        if intersection == 0 or bbox[2] - bbox[0] < 700 or bbox[0] > 0.65 * provider["image"]["width"]:
            continue
        records.append({**line, "bbox_xyxy": bbox})
    records.sort(key=lambda line: (line["bbox_xyxy"][1], line["bbox_xyxy"][0]))
    return records


def line_owners(lines: list[dict[str, object]], crop: list[int], radius: int) -> tuple[np.ndarray, list[np.ndarray]]:
    height, width = crop[3] - crop[1], crop[2] - crop[0]
    distances = []
    corridors = []
    for line in lines:
        corridor = crop_polygon(line["boundary"], crop, dilation=radius)
        baseline = crop_baseline(line["baseline"], crop)
        if not baseline.any():
            distance = cv2.distanceTransform((~corridor).astype(np.uint8), cv2.DIST_L2, 5)
        else:
            distance = cv2.distanceTransform((~baseline).astype(np.uint8), cv2.DIST_L2, 5)
        distance[~corridor] = np.inf
        distances.append(distance)
        corridors.append(corridor)
    stack = np.stack(distances, axis=0)
    owner = np.argmin(stack, axis=0).astype(np.int16)
    owner[np.all(~np.isfinite(stack), axis=0)] = -1
    return owner, corridors


def stroke_width(core: np.ndarray, allowed: np.ndarray) -> tuple[np.ndarray, dict[str, object]]:
    mask = core & allowed
    skeleton = skeletonize(mask)
    distance = cv2.distanceTransform(mask.astype(np.uint8), cv2.DIST_L2, 5)
    widths = 2.0 * distance[skeleton]
    widths = widths[np.isfinite(widths) & (widths > 0)]
    if len(widths) < 100:
        raise ValueError("Insufficient Eynollah skeleton pixels for stroke-width estimate")
    quantiles = {str(q): float(np.quantile(widths, q)) for q in (0.10, 0.25, 0.50, 0.75, 0.90)}
    return skeleton, {
        "definition": "twice Euclidean distance-to-background sampled on the Eynollah-core skeleton",
        "core_pixels_in_Kraken_lines": int(mask.sum()),
        "skeleton_pixels": int(skeleton.sum()),
        "stroke_width_px_quantiles": quantiles,
        "skeleton_mask_uint8_pixel_sha256": sha256_array(skeleton.astype(np.uint8)),
    }


def adaptive_group(
    weak: np.ndarray,
    strong: np.ndarray,
    owner: np.ndarray,
    line_count: int,
    kernel_hw: tuple[int, int],
) -> tuple[np.ndarray, np.ndarray, list[dict[str, object]]]:
    kernel_h, kernel_w = kernel_hw
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_w, kernel_h))
    accepted = np.zeros_like(weak)
    group_ids = np.zeros(weak.shape, dtype=np.int32)
    records = []
    next_group = 1
    for line_index in range(line_count):
        line_weak = weak & (owner == line_index)
        line_strong = strong & (owner == line_index)
        temporary = cv2.dilate(line_weak.astype(np.uint8), kernel) > 0
        count, labels, _, _ = cv2.connectedComponentsWithStats(temporary.astype(np.uint8), 8)
        seeded_ids = set(int(value) for value in np.unique(labels[line_strong]) if value != 0)
        line_records = []
        for temporary_id in sorted(seeded_ids):
            exact = line_weak & (labels == temporary_id)
            area = int(exact.sum())
            if area < 2:
                continue
            ys, xs = np.nonzero(exact)
            bbox = [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]
            strong_pixels = int((exact & line_strong).sum())
            accepted |= exact
            group_ids[exact] = next_group
            line_records.append(
                {
                    "group_id": next_group,
                    "exact_source_pixels": area,
                    "strong_seed_pixels": strong_pixels,
                    "bbox_crop_xyxy": bbox,
                    "centroid_x": float(xs.mean()),
                }
            )
            next_group += 1
        line_records.sort(key=lambda item: item["centroid_x"])
        records.append(
            {
                "line_index": line_index,
                "temporary_components": int(count - 1),
                "seeded_groups": len(line_records),
                "groups_left_to_right": line_records,
            }
        )
    return accepted, group_ids, records


def white_mask(mask: np.ndarray) -> Image.Image:
    return Image.fromarray(np.where(mask, 15, 255).astype(np.uint8), "L").convert("RGB")


def line_overlay(source: np.ndarray, lines: list[dict[str, object]], crop: list[int]) -> Image.Image:
    image = Image.fromarray(source, "RGB")
    draw = ImageDraw.Draw(image)
    colours = ("#00aebc", "#d04d9d", "#ed9b22", "#198f62")
    x0, y0, _, _ = crop
    for index, line in enumerate(lines):
        colour = colours[index % len(colours)]
        boundary = [(point[0] - x0, point[1] - y0) for point in line["boundary"]]
        baseline = [(point[0] - x0, point[1] - y0) for point in line["baseline"]]
        if len(boundary) >= 3:
            draw.line(boundary + [boundary[0]], fill=colour, width=3)
        if len(baseline) >= 2:
            draw.line(baseline, fill=colour, width=4)
    return image


def group_overlay(source: np.ndarray, groups: np.ndarray, line_records: list[dict[str, object]]) -> Image.Image:
    canvas = source.astype(np.float32) * 0.52 + 255.0 * 0.48
    palettes = (
        ((0, 140, 190), (0, 174, 188), (50, 105, 180), (15, 125, 135)),
        ((206, 77, 146), (164, 70, 170), (225, 90, 115), (145, 60, 125)),
    )
    for line_record in line_records:
        palette = palettes[line_record["line_index"] % 2]
        for word_index, record in enumerate(line_record["groups_left_to_right"]):
            canvas[groups == record["group_id"]] = palette[word_index % len(palette)]
    return Image.fromarray(np.uint8(canvas), "RGB")


def addition_overlay(source: np.ndarray, core: np.ndarray, accepted: np.ndarray) -> Image.Image:
    canvas = source.astype(np.float32) * 0.52 + 255.0 * 0.48
    canvas[core] = (0, 174, 188)
    canvas[accepted & ~core] = (206, 77, 146)
    return Image.fromarray(np.uint8(canvas), "RGB")


def render_board(
    source: np.ndarray,
    lines: list[dict[str, object]],
    crop: list[int],
    core: np.ndarray,
    weak: np.ndarray,
    accepted: np.ndarray,
    groups: np.ndarray,
    line_records: list[dict[str, object]],
    output: Path,
) -> None:
    panels = [
        ("Kraken lines", line_overlay(source, lines, crop), "independent boundaries + baselines"),
        ("Eynollah anchor", white_mask(core), "fixed high-confidence ink"),
        ("weak reference fragments", white_mask(weak), "q99 page-specific vector evidence"),
        ("adaptive accepted groups", white_mask(core | accepted), "stroke-width gap grouping; exact pixels only"),
        ("groups in line order", group_overlay(source, groups, line_records), "alternating palettes by line; colors by left-to-right group"),
        ("additions on source", addition_overlay(source, core, accepted), "cyan anchor · magenta review additions"),
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
    parser.add_argument("--kraken-provider", type=Path, required=True)
    parser.add_argument("--reference-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--line-radius", type=int, default=30)
    parser.add_argument("--width-quantile", type=float, choices=(0.5, 0.75, 0.9), default=0.5)
    parser.add_argument("--horizontal-multiplier", type=float, choices=(2.8, 4.0, 5.5, 7.0), default=2.8)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()

    reference_path = args.reference_root / "experiment.json"
    reference = json.loads(reference_path.read_text())
    provider = json.loads(args.kraken_provider.read_text())
    crop = [int(value) for value in reference["inputs"]["crop_bbox_xyxy"]]
    source_page = cv2.imread(str(args.source), cv2.IMREAD_COLOR)
    probability_page = np.load(args.probability, allow_pickle=False).astype(np.float32)
    if source_page is None or source_page.shape[:2] != probability_page.shape:
        raise ValueError("Source/probability shape mismatch")
    if provider["image"]["width"] != source_page.shape[1] or provider["image"]["height"] != source_page.shape[0]:
        raise ValueError("Kraken/source upright coordinate spaces differ")
    x0, y0, x1, y1 = crop
    source = cv2.cvtColor(source_page[y0:y1, x0:x1], cv2.COLOR_BGR2RGB)
    probability = probability_page[y0:y1, x0:x1]
    core = probability >= 0.50
    score_path = args.reference_root / "local-reference-score.float16.npy"
    score = np.load(score_path, allow_pickle=False).astype(np.float32)
    thresholds = reference["thresholds"]

    lines = selected_lines(provider, crop)
    owner, corridors = line_owners(lines, crop, args.line_radius)
    line_union = np.logical_or.reduce(corridors)
    page, page_distance, page_record = detect_page(source_page)
    interior = page[y0:y1, x0:x1] & (page_distance[y0:y1, x0:x1] >= 12.0)
    skeleton, width_record = stroke_width(core, line_union)
    reference_width = width_record["stroke_width_px_quantiles"][str(args.width_quantile)]
    kernel_h = odd_at_least(0.85 * reference_width, 3)
    kernel_w = odd_at_least(args.horizontal_multiplier * reference_width, 7)
    weak_reference = (score >= thresholds["paper_q990"]) & line_union & interior
    grouping_evidence = core | weak_reference
    strong = ((score >= thresholds["paper_q995"]) | core) & line_union & interior
    accepted, groups, group_records = adaptive_group(
        grouping_evidence,
        strong,
        owner,
        len(lines),
        (kernel_h, kernel_w),
    )

    outputs = {}
    for name, mask in {
        "Kraken-line-union": line_union,
        "Eynollah-core-skeleton": skeleton,
        "weak-reference": weak_reference,
        "grouping-evidence-core-plus-weak": grouping_evidence,
        "strong-seeds": strong,
        "adaptive-accepted-exact-pixels": accepted,
        "final-anchor-plus-adaptive": core | accepted,
    }.items():
        path = args.output / f"{name}.mask.png"
        save_mask(mask, path)
        outputs[path.name] = sha256_file(path)
    groups_path = args.output / "adaptive-group-ids.int32.npy"
    np.save(groups_path, groups, allow_pickle=False)
    outputs[groups_path.name] = sha256_file(groups_path)
    board = args.output / "top-left-Kraken-stroke-adaptive-recovery.png"
    render_board(source, lines, crop, core, weak_reference, accepted, groups, group_records, board)
    outputs[board.name] = sha256_file(board)

    additions = accepted & ~core
    record = {
        "schema_version": "Kraken-stroke-adaptive-recovery.v1",
        "evidence_visibility": "acting-safe-source-and-frozen-software-output-only",
        "sealed_human_evidence_used": False,
        "hypothesis": "Eynollah stroke width can parameterize exact-pixel fragment association inside independent Kraken line geometry",
        "inputs": {
            "source_sha256": sha256_file(args.source),
            "probability_file_sha256": sha256_file(args.probability),
            "Kraken_provider_sha256": sha256_file(args.kraken_provider),
            "reference_manifest_sha256": sha256_file(reference_path),
            "reference_score_sha256": sha256_file(score_path),
            "crop_bbox_xyxy": crop,
        },
        "Kraken": {
            "page_line_count": len(provider["segmentation"]["lines"]),
            "selected_crop_line_count": len(lines),
            "selected_lines": [
                {"id": line["id"], "providerOrdinal": line["providerOrdinal"], "bbox_xyxy": line["bbox_xyxy"]}
                for line in lines
            ],
            "corridor_expansion_px": args.line_radius,
        },
        "page_detection": page_record,
        "stroke_width": width_record,
        "adaptive_grouping": {
            "kernel_hw": [kernel_h, kernel_w],
            "stroke_width_reference_quantile": args.width_quantile,
            "stroke_width_reference_px": reference_width,
            "horizontal_multiplier": args.horizontal_multiplier,
            "kernel_derivation": "height=odd(max(3,0.85*reference_stroke_width)); width=odd(max(7,horizontal_multiplier*reference_stroke_width))",
            "temporary_bridge_pixels_in_final_mask": 0,
            "line_records": group_records,
        },
        "metrics": {
            "core_pixels": int(core.sum()),
            "weak_reference_pixels": int(weak_reference.sum()),
            "grouping_evidence_pixels": int(grouping_evidence.sum()),
            "strong_seed_pixels": int(strong.sum()),
            "accepted_exact_pixels": int(accepted.sum()),
            "review_addition_pixels": int(additions.sum()),
            "accepted_group_count": int(groups.max()),
            "addition_by_Eynollah_probability": {
                "p_0.20_0.50": int((additions & (probability >= 0.20)).sum()),
                "p_0.01_0.20": int((additions & (probability >= 0.01) & (probability < 0.20)).sum()),
                "p_lt_0.01": int((additions & (probability < 0.01)).sum()),
            },
            "final_mask_uint8_pixel_sha256": sha256_array((core | accepted).astype(np.uint8)),
        },
        "guardrails": [
            "Eynollah core is retained unchanged.",
            "Kraken geometry is a search/ownership coordinate frame, not ink truth.",
            "Temporary dilation establishes associations only; no dilation pixel is retained.",
            "A group needs a q99.5 reference or Eynollah seed and remains review-only.",
            "Colored groups expose merges and splits; group colors are not final word ownership.",
        ],
        "outputs": outputs,
        "runtime_seconds": time.perf_counter() - started,
    }
    manifest = args.output / "experiment.json"
    manifest.write_text(json.dumps(record, indent=2) + "\n")
    print(json.dumps({"stroke_width": width_record, "kernel_hw": [kernel_h, kernel_w], "metrics": record["metrics"], "manifest_sha256": sha256_file(manifest)}))


if __name__ == "__main__":
    main()
