#!/usr/bin/env python3
"""Post-freeze failure atlas for the automatic shrink/select/fit experiment.

The acting experiment must already be frozen.  This script reconstructs its
selected components, loads the sealed human partition only for evaluation, and
writes compact comparison boards plus an exact JSON diagnosis.  Nothing from
the human partition is fed back into candidate construction.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

from word_envelope.io_utils import canonical_json_bytes, sha256_file, sha256_mask_pixels


PAPER = (250, 246, 237)
INK = (38, 43, 54)
GREEN = (18, 145, 73)
RED = (202, 48, 49)
MAGENTA = (176, 62, 151)
CYAN = (0, 135, 160)
AMBER = (222, 142, 29)


def read(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def load_mask(path: Path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("L"), dtype=np.uint8) > 0


def font(size: int, *, bold: bool = False) -> ImageFont.ImageFont:
    name = "Arial Bold.ttf" if bold else "Arial.ttf"
    try:
        return ImageFont.truetype(f"/System/Library/Fonts/Supplemental/{name}", size)
    except OSError:
        return ImageFont.load_default()


def bbox_from_mask(value: np.ndarray) -> list[int] | None:
    ys, xs = np.nonzero(value)
    if not len(xs):
        return None
    x0, y0 = int(xs.min()), int(ys.min())
    x1, y1 = int(xs.max()) + 1, int(ys.max()) + 1
    return [x0, y0, x1 - x0, y1 - y0]


def expand_bbox(value: list[int], fraction: float, size_wh: tuple[int, int]) -> list[int]:
    x, y, width, height = value
    px = max(24, round(width * fraction))
    py = max(24, round(height * fraction))
    x0, y0 = max(0, x - px), max(0, y - py)
    x1, y1 = min(size_wh[0], x + width + px), min(size_wh[1], y + height + py)
    return [x0, y0, x1 - x0, y1 - y0]


def union_bbox(values: list[list[int]]) -> list[int]:
    x0 = min(value[0] for value in values)
    y0 = min(value[1] for value in values)
    x1 = max(value[0] + value[2] for value in values)
    y1 = max(value[1] + value[3] for value in values)
    return [x0, y0, x1 - x0, y1 - y0]


def load_human_partition(run_dir: Path) -> tuple[list[dict[str, Any]], np.ndarray]:
    revision_paths = sorted((run_dir / "revisions").glob("r*/state.json"))
    if not revision_paths:
        raise RuntimeError("Sealed evaluation run has no revision state")
    state = read(revision_paths[-1])
    manifest = read(run_dir / "manifest.json")
    width, height = manifest["source"]["size_wh"]
    ownership = np.zeros((height, width), dtype=np.uint16)
    words: list[dict[str, Any]] = []
    for word in state["words"]:
        number = int(word["word_number"])
        local = load_mask(run_dir / word["selected_mask_path"])
        x, y, box_width, box_height = [int(value) for value in word["selection_bbox_xywh"]]
        if local.shape != (box_height, box_width):
            raise RuntimeError(f"Sealed word {number} mask dimensions are stale")
        target = ownership[y : y + box_height, x : x + box_width]
        if np.any(target[local]):
            raise RuntimeError("Sealed human masks are not a disjoint partition")
        target[local] = number
        words.append(
            {
                "word_number": number,
                "bbox_xywh": [x, y, box_width, box_height],
                "pixels": int(local.sum()),
                "pixel_sha256": word["selected_pixel_sha256"],
            }
        )
    return words, ownership


def vertical_relation(left: list[int], right: list[int]) -> str:
    left_top, left_bottom = left[1], left[1] + left[3]
    right_top, right_bottom = right[1], right[1] + right[3]
    overlap = max(0, min(left_bottom, right_bottom) - max(left_top, right_top))
    denominator = max(1, min(left[3], right[3]))
    return "same_line" if overlap / denominator >= 0.35 else "cross_line"


def reconstruct_selected(labels: np.ndarray, component_ids: list[int]) -> np.ndarray:
    return np.isin(labels, np.asarray(component_ids, dtype=labels.dtype))


def diagnose_item(
    item: dict[str, Any],
    labels: np.ndarray,
    ownership: np.ndarray,
    words_by_number: dict[int, dict[str, Any]],
) -> tuple[dict[str, Any], np.ndarray]:
    selected = reconstruct_selected(labels, item["selected_component_ids"])
    target_number = int(item["evaluation_human_word_number"])
    target = ownership == target_number
    target_word = words_by_number[target_number]
    foreign_numbers, counts = np.unique(ownership[selected & (ownership != target_number)], return_counts=True)
    foreign = [
        {"word_number": int(number), "pixels": int(count), "bbox_xywh": words_by_number[int(number)]["bbox_xywh"]}
        for number, count in zip(foreign_numbers, counts)
        if int(number) > 0
    ]
    same_line_foreign = [
        value for value in foreign
        if vertical_relation(target_word["bbox_xywh"], value["bbox_xywh"]) == "same_line"
    ]
    cross_line_foreign = [value for value in foreign if value not in same_line_foreign]

    component_roles: list[dict[str, Any]] = []
    shared_component = False
    foreign_only_component = False
    for component_id in item["selected_component_ids"]:
        component = labels == int(component_id)
        target_pixels = int(np.count_nonzero(component & target))
        foreign_pixels = int(np.count_nonzero(component & (ownership > 0) & ~target))
        unlabelled_pixels = int(np.count_nonzero(component & (ownership == 0)))
        role = (
            "shared_target_and_foreign"
            if target_pixels and foreign_pixels
            else "target_only"
            if target_pixels
            else "foreign_only"
            if foreign_pixels
            else "unlabelled_only"
        )
        shared_component = shared_component or role == "shared_target_and_foreign"
        foreign_only_component = foreign_only_component or role == "foreign_only"
        component_roles.append(
            {
                "component_id": int(component_id),
                "role": role,
                "target_pixels": target_pixels,
                "foreign_pixels": foreign_pixels,
                "unlabelled_pixels": unlabelled_pixels,
                "pixel_count": int(component.sum()),
                "pixel_sha256": sha256_mask_pixels(component),
            }
        )

    missed = target & ~selected
    missed_labels, missed_count = ndimage.label(missed, structure=np.ones((3, 3), dtype=np.uint8))
    missed_areas = [int(value) for value in np.bincount(missed_labels.ravel())[1:]]
    missed_areas.sort(reverse=True)
    evaluation = item["evaluation"]
    categories: list[str] = []
    if float(evaluation["recall"]) < 0.10:
        categories.append("locator_target_mismatch")
    elif float(evaluation["recall"]) < 0.95:
        if missed_areas and sum(missed_areas) <= max(64, round(target_word["pixels"] * 0.25)):
            categories.append("detached_mark_or_small_fragment_miss")
        else:
            categories.append("incomplete_target")
    if shared_component:
        categories.append("shared_component_cross_word")
    if foreign_only_component:
        categories.append("foreign_component_touched")
    if same_line_foreign:
        categories.append("same_line_neighbor_capture")
    if cross_line_foreign:
        categories.append("cross_line_capture")
    unlabelled_pixels = int(evaluation["unlabelled_selected_pixels"])
    if unlabelled_pixels >= max(100, round(int(item["selected_pixels"]) * 0.05)):
        categories.append("unlabelled_fold_or_noise_risk")
    if not categories:
        categories.append("clean_match")

    diagnosis = {
        "unit_id": item["unit_id"],
        "line_id": item["line_id"],
        "text": item["text"],
        "acting_gate_auto_easy": bool(item["acting_gate_auto_easy"]),
        "evaluation_gate_high_quality": bool(evaluation["evaluation_gate_high_quality"]),
        "categories": categories,
        "proposal_bbox_xywh": item["proposal_bbox_xywh"],
        "ink_tight_bbox_xywh": item["ink_tight_bbox_xywh"],
        "selection_anchor_bbox_xywh": item["selection_anchor_bbox_xywh"],
        "selected_bbox_xywh": item["selected_bbox_xywh"],
        "selected_pixel_sha256": item["selected_pixel_sha256"],
        "selected_pixels": item["selected_pixels"],
        "fit_status": item["fit_status"],
        "fit_profile": item["fit_profile"],
        "envelope_polygon": item["envelope_polygon"],
        "envelope_excluded_ink_fraction": item["envelope_excluded_ink_fraction"],
        "evaluation": evaluation,
        "target": target_word,
        "foreign_words": foreign,
        "same_line_foreign_pixels": sum(value["pixels"] for value in same_line_foreign),
        "cross_line_foreign_pixels": sum(value["pixels"] for value in cross_line_foreign),
        "component_roles": component_roles,
        "missed_target_component_areas": missed_areas,
    }
    return diagnosis, selected


def alpha_overlay(image: Image.Image, mask: np.ndarray, color: tuple[int, int, int], alpha: float) -> None:
    if not np.any(mask):
        return
    base = np.asarray(image, dtype=np.float32)
    base[mask] = base[mask] * (1.0 - alpha) + np.asarray(color, dtype=np.float32) * alpha
    image.paste(Image.fromarray(np.clip(base, 0, 255).astype(np.uint8), mode="RGB"))


def draw_bbox(draw: ImageDraw.ImageDraw, bbox: list[int], crop: list[int], scale: float, color: tuple[int, int, int], width: int) -> None:
    x, y, box_width, box_height = bbox
    cx, cy = crop[:2]
    draw.rectangle(
        (
            round((x - cx) * scale),
            round((y - cy) * scale),
            round((x + box_width - cx) * scale),
            round((y + box_height - cy) * scale),
        ),
        outline=color,
        width=width,
    )


def panel_for_case(
    source: Image.Image,
    clean: np.ndarray,
    selected: np.ndarray,
    ownership: np.ndarray,
    diagnosis: dict[str, Any],
    *,
    sealed: bool,
    size: tuple[int, int] = (430, 235),
) -> Image.Image:
    boxes = [diagnosis["proposal_bbox_xywh"], diagnosis["selected_bbox_xywh"], diagnosis["target"]["bbox_xywh"]]
    boxes.extend(value["bbox_xywh"] for value in diagnosis["foreign_words"])
    crop = expand_bbox(union_bbox(boxes), 0.12, source.size)
    x, y, width, height = crop
    if sealed:
        panel = source.crop((x, y, x + width, y + height)).convert("RGB")
        target = ownership[y : y + height, x : x + width] == diagnosis["target"]["word_number"]
        local_selected = selected[y : y + height, x : x + width]
        foreign = local_selected & (ownership[y : y + height, x : x + width] > 0) & ~target
        missed = target & ~local_selected
        correct = local_selected & target
        alpha_overlay(panel, correct, GREEN, 0.72)
        alpha_overlay(panel, foreign, RED, 0.75)
        alpha_overlay(panel, missed, MAGENTA, 0.82)
    else:
        local_clean = clean[y : y + height, x : x + width]
        values = np.full((height, width, 3), PAPER, dtype=np.uint8)
        values[local_clean] = INK
        panel = Image.fromarray(values, mode="RGB")
        alpha_overlay(panel, selected[y : y + height, x : x + width], GREEN, 0.74)

    scale = min(size[0] / width, size[1] / height)
    resized = panel.resize((max(1, round(width * scale)), max(1, round(height * scale))), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", size, PAPER)
    offset = ((size[0] - resized.width) // 2, (size[1] - resized.height) // 2)
    canvas.paste(resized, offset)
    draw = ImageDraw.Draw(canvas)

    def shifted_bbox(value: list[int]) -> list[int]:
        return [
            value[0] - round(offset[0] / scale),
            value[1] - round(offset[1] / scale),
            value[2],
            value[3],
        ]

    adjusted_crop = [crop[0] - round(offset[0] / scale), crop[1] - round(offset[1] / scale), crop[2], crop[3]]
    if sealed:
        draw_bbox(draw, diagnosis["target"]["bbox_xywh"], adjusted_crop, scale, GREEN, 3)
        for value in diagnosis["foreign_words"]:
            draw_bbox(draw, value["bbox_xywh"], adjusted_crop, scale, RED, 2)
    else:
        draw_bbox(draw, diagnosis["proposal_bbox_xywh"], adjusted_crop, scale, CYAN, 3)
        draw_bbox(draw, diagnosis["selection_anchor_bbox_xywh"], adjusted_crop, scale, AMBER, 2)
    polygon = diagnosis.get("envelope_polygon")
    if polygon:
        points = [
            (
                round((float(px) - adjusted_crop[0]) * scale),
                round((float(py) - adjusted_crop[1]) * scale),
            )
            for px, py in polygon
        ]
        draw.line(points, fill=(255, 255, 255) if sealed else RED, width=2, joint="curve")
    return canvas


def render_board(
    source: Image.Image,
    clean: np.ndarray,
    ownership: np.ndarray,
    cases: list[tuple[dict[str, Any], np.ndarray]],
    output: Path,
    title: str,
) -> None:
    cell_width, cell_height = 930, 330
    columns = 2
    rows = (len(cases) + columns - 1) // columns
    canvas = Image.new("RGB", (columns * cell_width + 40, rows * cell_height + 90), PAPER)
    draw = ImageDraw.Draw(canvas)
    draw.text((24, 18), title, fill=(40, 34, 28), font=font(30, bold=True))
    draw.text((24, 56), "ACTING: cyan proposal · amber anchor · green chosen · red fitted envelope    SEALED: green correct · red foreign · magenta missed", fill=(70, 60, 50), font=font(15))
    for index, (diagnosis, selected) in enumerate(cases):
        x0 = 20 + (index % columns) * cell_width
        y0 = 90 + (index // columns) * cell_height
        acting = panel_for_case(source, clean, selected, ownership, diagnosis, sealed=False)
        sealed = panel_for_case(source, clean, selected, ownership, diagnosis, sealed=True)
        canvas.paste(acting, (x0, y0 + 62))
        canvas.paste(sealed, (x0 + 440, y0 + 62))
        evaluation = diagnosis["evaluation"]
        draw.text((x0, y0), f"{diagnosis['unit_id']}  {diagnosis['text']!r}", fill=(40, 34, 28), font=font(20, bold=True))
        draw.text((x0, y0 + 25), f"P {evaluation['precision']:.3f} · R {evaluation['recall']:.3f} · selected {diagnosis['selected_pixels']:,}px", fill=(65, 56, 48), font=font(16))
        draw.text((x0, y0 + 45), " · ".join(diagnosis["categories"][:3]), fill=RED if not diagnosis["evaluation_gate_high_quality"] else GREEN, font=font(14))
        draw.text((x0, y0 + 294), "software-visible", fill=(75, 65, 55), font=font(14))
        draw.text((x0 + 440, y0 + 294), "post-freeze evaluation only", fill=(75, 65, 55), font=font(14))
    canvas.save(output, format="JPEG", quality=93, subsampling=0, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--experiment", type=Path, required=True)
    parser.add_argument("--clean-mask", type=Path, required=True)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--human-run", type=Path, required=True)
    parser.add_argument("--locator", default="transcript_bbox_xywh")
    parser.add_argument("--margin", type=float, default=0.0)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    if args.output_dir.exists():
        raise SystemExit("Output exists; refusing overwrite")
    args.output_dir.mkdir(parents=True)

    experiment = read(args.experiment)
    configuration = next(
        value for value in experiment["configurations"]
        if value["locator"] == args.locator and abs(float(value["anchor_margin_fraction"]) - args.margin) < 1e-9
    )
    clean = load_mask(args.clean_mask)
    labels, _ = ndimage.label(clean, structure=np.ones((3, 3), dtype=np.uint8))
    human_words, ownership = load_human_partition(args.human_run)
    words_by_number = {value["word_number"]: value for value in human_words}
    diagnosed: list[tuple[dict[str, Any], np.ndarray]] = []
    for item in configuration["items"]:
        if item.get("status") != "frozen":
            continue
        diagnosis, selected = diagnose_item(item, labels, ownership, words_by_number)
        if sha256_mask_pixels(selected) != item["selected_pixel_sha256"]:
            raise RuntimeError(f"Reconstructed selection hash differs for {item['unit_id']}")
        diagnosed.append((diagnosis, selected))

    false_approvals = [value for value in diagnosed if value[0]["acting_gate_auto_easy"] and not value[0]["evaluation_gate_high_quality"]]
    true_approvals = [value for value in diagnosed if value[0]["acting_gate_auto_easy"] and value[0]["evaluation_gate_high_quality"]]
    safe_abstentions = [value for value in diagnosed if not value[0]["acting_gate_auto_easy"] and value[0]["evaluation_gate_high_quality"]]
    board_specs = [
        ("auto-false-approvals.jpg", "FALSE AUTOMATIC APPROVALS — ACTING VIEW VS SEALED EVALUATION", false_approvals),
        ("auto-true-approvals-sample.jpg", "TRUE AUTOMATIC APPROVALS — REPRESENTATIVE SAMPLE", true_approvals[:8]),
        ("safe-abstentions.jpg", "HIGH-QUALITY MASKS THE CONSERVATIVE GATE ABSTAINED ON", safe_abstentions),
    ]
    boards: list[dict[str, Any]] = []
    source = Image.open(args.source).convert("RGB")
    for name, title, cases in board_specs:
        if not cases:
            continue
        path = args.output_dir / name
        render_board(source, clean, ownership, cases, path, title)
        boards.append({"path": name, "file_sha256": sha256_file(path), "case_count": len(cases)})

    category_counts: dict[str, int] = {}
    for diagnosis, _selected in false_approvals:
        for category in diagnosis["categories"]:
            category_counts[category] = category_counts.get(category, 0) + 1
    record: dict[str, Any] = {
        "schema_version": "auto-selection-failure-atlas.v1",
        "evidence_role": "post_freeze_sealed_evaluation",
        "acting_candidates_changed": False,
        "inputs": {
            "experiment": {"path": str(args.experiment), "file_sha256": sha256_file(args.experiment), "experiment_sha256": experiment["experiment_sha256"]},
            "clean_mask": {"path": str(args.clean_mask), "file_sha256": sha256_file(args.clean_mask), "pixel_sha256": sha256_mask_pixels(clean)},
            "source": {"path": str(args.source), "file_sha256": sha256_file(args.source)},
            "sealed_human_run": {"path": str(args.human_run), "word_count": len(human_words)},
        },
        "configuration": {"locator": args.locator, "anchor_margin_fraction": args.margin},
        "summary": {
            "frozen_count": len(diagnosed),
            "acting_auto_easy_count": len(false_approvals) + len(true_approvals),
            "true_automatic_approvals": len(true_approvals),
            "false_automatic_approvals": len(false_approvals),
            "safe_abstentions": len(safe_abstentions),
            "false_approval_category_counts_nonexclusive": category_counts,
        },
        "false_automatic_approvals": [value[0] for value in false_approvals],
        "safe_abstentions": [value[0] for value in safe_abstentions],
        "boards": boards,
        "interpretation_warning": "Categories may overlap. Human masks were loaded only after acting selections were already frozen and must not be included in a future acting packet.",
    }
    record["atlas_sha256"] = hashlib.sha256(canonical_json_bytes(record)).hexdigest()
    output_json = args.output_dir / "analysis.json"
    output_json.write_bytes(canonical_json_bytes(record) + b"\n")
    print(json.dumps({"output": str(args.output_dir), "summary": record["summary"], "atlas_sha256": record["atlas_sha256"]}, indent=2))


if __name__ == "__main__":
    main()
