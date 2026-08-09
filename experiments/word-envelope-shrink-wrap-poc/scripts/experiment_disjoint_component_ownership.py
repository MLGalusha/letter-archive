#!/usr/bin/env python3
"""Compare independent, ordered-knockout, and exclusive component ownership.

All acting candidates are generated from software locators plus V4 Clean Ink.
The completed human page is loaded only after every candidate mask, fitted
envelope, order, and acting-gate decision has been frozen and hashed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage
from scipy.optimize import linear_sum_assignment

from word_envelope.component_assignment import (
    confidence_order,
    exclusive_component_assignment,
    score_component_locators,
    sequential_component_claims,
)
from word_envelope.fragmented_envelope import fit_fragmented_envelope
from word_envelope.io_utils import canonical_json_bytes, sha256_file, sha256_mask_pixels


PAPER = (250, 246, 237)
INK = (40, 44, 52)
GREEN = (18, 145, 73)
RED = (202, 48, 49)
CYAN = (0, 135, 160)
MAGENTA = (178, 64, 153)
AMBER = (222, 143, 30)


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


def polygon_bbox(points: list[list[float]]) -> list[int]:
    xs = [float(point[0]) for point in points]
    ys = [float(point[1]) for point in points]
    x0, y0 = int(np.floor(min(xs))), int(np.floor(min(ys)))
    x1, y1 = int(np.ceil(max(xs))), int(np.ceil(max(ys)))
    return [x0, y0, max(1, x1 - x0), max(1, y1 - y0)]


def expand_bbox(value: list[int], fraction: float, size_wh: tuple[int, int]) -> list[int]:
    x, y, width, height = value
    px, py = max(2, round(width * fraction)), max(2, round(height * fraction))
    x0, y0 = max(0, x - px), max(0, y - py)
    x1, y1 = min(size_wh[0], x + width + px), min(size_wh[1], y + height + py)
    return [x0, y0, max(1, x1 - x0), max(1, y1 - y0)]


def bbox_iou(left: list[int], right: list[int]) -> float:
    lx, ly, lw, lh = left
    rx, ry, rw, rh = right
    ix0, iy0 = max(lx, rx), max(ly, ry)
    ix1, iy1 = min(lx + lw, rx + rw), min(ly + lh, ry + rh)
    intersection = max(0, ix1 - ix0) * max(0, iy1 - iy0)
    union = lw * lh + rw * rh - intersection
    return intersection / max(1, union)


def reviewed_units(path: Path) -> list[dict[str, Any]]:
    decision = read(path)
    units: list[dict[str, Any]] = []
    for line in decision["lines"]:
        if not str(line["line_id"]).startswith("body-"):
            continue
        for unit in line["visible_units"]:
            if unit["unit_kind"] != "word":
                continue
            units.append(
                {
                    "unit_id": unit["unit_id"],
                    "line_id": line["line_id"],
                    "line_order": int(line["line_reading_order"]),
                    "word_order": int(unit["reading_order"]),
                    "text": unit["tentative_text"],
                    "reviewed_bbox_xywh": [int(value) for value in unit["bbox_source_xywh"]],
                }
            )
    units.sort(key=lambda value: (value["line_order"], value["word_order"], value["unit_id"]))
    return units


def transcript_boxes(path: Path) -> dict[tuple[int, int], list[int]]:
    result = read(path)
    boxes: dict[tuple[int, int], list[int]] = {}
    for line in result["bodyLines"]:
        for word in line["words"]:
            boxes[(int(line["lineIndex"]), int(word["wordIndex"]))] = polygon_bbox(word["polygon"])
    return boxes


def load_human_partition(run_dir: Path) -> tuple[list[dict[str, Any]], np.ndarray]:
    state_path = sorted((run_dir / "revisions").glob("r*/state.json"))[-1]
    state = read(state_path)
    manifest = read(run_dir / "manifest.json")
    width, height = manifest["source"]["size_wh"]
    ownership = np.zeros((height, width), dtype=np.uint16)
    words: list[dict[str, Any]] = []
    for word in state["words"]:
        number = int(word["word_number"])
        local = load_mask(run_dir / word["selected_mask_path"])
        x, y, box_width, box_height = [int(value) for value in word["selection_bbox_xywh"]]
        target = ownership[y : y + box_height, x : x + box_width]
        if local.shape != target.shape or np.any(target[local]):
            raise RuntimeError("Sealed human partition is stale or overlapping")
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


def bind_human_numbers(units: list[dict[str, Any]], human: list[dict[str, Any]], locator_key: str) -> dict[str, int]:
    cost = np.zeros((len(units), len(human)), dtype=np.float64)
    diagonal = float(np.hypot(3000, 4000))
    for row, unit in enumerate(units):
        bbox = unit[locator_key]
        cx, cy = bbox[0] + bbox[2] / 2, bbox[1] + bbox[3] / 2
        for column, word in enumerate(human):
            target_bbox = word["bbox_xywh"]
            hx, hy = target_bbox[0] + target_bbox[2] / 2, target_bbox[1] + target_bbox[3] / 2
            distance = np.hypot(cx - hx, cy - hy) / diagonal
            cost[row, column] = -(bbox_iou(bbox, target_bbox) * 4.0 - distance)
    rows, columns = linear_sum_assignment(cost)
    return {units[int(row)]["unit_id"]: human[int(column)]["word_number"] for row, column in zip(rows, columns)}


def fit_selection(selected: np.ndarray, clean: np.ndarray) -> dict[str, Any]:
    selected_bbox = bbox_from_mask(selected)
    if selected_bbox is None:
        return {"fit_status": "not_run_empty"}
    size_wh = (selected.shape[1], selected.shape[0])
    crop = expand_bbox(selected_bbox, 0.20, size_wh)
    x, y, width, height = crop
    local_selected = selected[y : y + height, x : x + width]
    local_excluded = clean[y : y + height, x : x + width] & ~local_selected
    started = time.perf_counter()
    try:
        fitted = fit_fragmented_envelope(local_selected, local_excluded)
        profile, candidate = sorted(
            fitted["candidates"].items(),
            key=lambda value: (
                value[1]["excluded_ink_fraction_inside_envelope"],
                value[1]["envelope_area_px2"],
            ),
        )[0]
        return {
            "fit_status": "pass",
            "fit_profile": profile,
            "envelope_excluded_ink_fraction": candidate["excluded_ink_fraction_inside_envelope"],
            "envelope_area_px2": candidate["envelope_area_px2"],
            "envelope_polygon": [
                [round(float(px + x), 3), round(float(py + y), 3)]
                for px, py in candidate["polygon"]
            ],
            "fit_wall_time_ms": round((time.perf_counter() - started) * 1000.0, 3),
        }
    except Exception as error:
        return {
            "fit_status": "rejected",
            "fit_error": type(error).__name__,
            "fit_wall_time_ms": round((time.perf_counter() - started) * 1000.0, 3),
        }


def candidate_item(
    unit: dict[str, Any],
    locator_key: str,
    component_ids: list[int],
    scored: dict[str, Any],
    clean: np.ndarray,
    *,
    ambiguity_ids: list[int] | None = None,
    blocked_ids: list[int] | None = None,
) -> dict[str, Any]:
    labels = scored["labels"]
    selected = np.isin(labels, np.asarray(component_ids, dtype=labels.dtype))
    proposal = unit[locator_key]
    x, y, width, height = proposal
    selected_pixels = int(selected.sum())
    selected_inside = int(selected[y : y + height, x : x + width].sum())
    proposal_ink = int(clean[y : y + height, x : x + width].sum())
    selected_bbox = bbox_from_mask(selected)
    size_wh = (clean.shape[1], clean.shape[0])
    guard = expand_bbox(proposal, 0.35, size_wh)
    gx, gy, gw, gh = guard
    outside_guard = selected_pixels - int(selected[gy : gy + gh, gx : gx + gw].sum())
    lost_to_competitor: list[int] = []
    for component_id in component_ids:
        matches = scored["scores_by_component"].get(component_id, [])
        if matches and matches[0]["unit_id"] != unit["unit_id"]:
            lost_to_competitor.append(component_id)
    fit = fit_selection(selected, clean)
    support_fraction = selected_inside / max(1, selected_pixels)
    proposal_coverage = selected_inside / max(1, proposal_ink)
    extension_fraction = outside_guard / max(1, selected_pixels)
    bbox_height_ratio = (
        selected_bbox[3] / max(1, height) if selected_bbox is not None else float("inf")
    )
    acting_gate = (
        selected_pixels >= 250
        and len(component_ids) <= 16
        and support_fraction >= 0.68
        and proposal_coverage >= 0.55
        and extension_fraction <= 0.025
        and bbox_height_ratio <= 1.75
        and not lost_to_competitor
        and fit.get("fit_status") == "pass"
        and float(fit.get("envelope_excluded_ink_fraction", 1.0)) <= 0.055
    )
    return {
        "unit_id": unit["unit_id"],
        "line_id": unit["line_id"],
        "line_order": unit["line_order"],
        "word_order": unit["word_order"],
        "text": unit["text"],
        "proposal_bbox_xywh": proposal,
        "selected_component_ids": component_ids,
        "selected_component_count": len(component_ids),
        "selected_bbox_xywh": selected_bbox,
        "selected_pixels": selected_pixels,
        "selected_pixel_sha256": sha256_mask_pixels(selected),
        "selected_inside_proposal_pixels": selected_inside,
        "proposal_ink_pixels": proposal_ink,
        "selected_support_fraction": round(support_fraction, 6),
        "proposal_ink_coverage": round(proposal_coverage, 6),
        "component_extension_fraction": round(extension_fraction, 6),
        "selected_bbox_height_to_proposal_ratio": round(bbox_height_ratio, 6) if np.isfinite(bbox_height_ratio) else None,
        "selected_components_better_supported_by_competitor": lost_to_competitor,
        "ambiguous_touched_component_ids": sorted(ambiguity_ids or []),
        "already_claimed_component_ids": sorted(blocked_ids or []),
        "acting_gate_auto_easy": bool(acting_gate),
        **fit,
        "_selected": selected,
    }


def freeze_locator_family(
    units: list[dict[str, Any]],
    locator_key: str,
    clean: np.ndarray,
) -> tuple[list[dict[str, Any]], dict[str, Any], dict[str, Any]]:
    locators = [{"unit_id": unit["unit_id"], "bbox_xywh": unit[locator_key]} for unit in units]
    score_started = time.perf_counter()
    scored = score_component_locators(clean, locators)
    score_wall_time_ms = round((time.perf_counter() - score_started) * 1000.0, 3)
    unit_ids = [unit["unit_id"] for unit in units]
    policies: list[tuple[str, dict[str, list[int]], dict[str, Any]]] = []
    independent = {
        unit_id: list(scored["touched_component_ids_by_unit"][unit_id])
        for unit_id in unit_ids
    }
    policies.append(("independent_all_touched", independent, {"global_disjointness": False}))
    for name, order in (
        ("sequential_reading_order", unit_ids),
        ("sequential_reverse_order", list(reversed(unit_ids))),
        ("sequential_confidence_first", confidence_order(scored)),
    ):
        result = sequential_component_claims(scored, order)
        policies.append((name, result["component_ids_by_unit"], result))
    exclusive = exclusive_component_assignment(
        scored,
        minimum_score=0.12,
        minimum_score_margin=0.08,
    )
    policies.append(("global_exclusive_ambiguous_abstain", exclusive["component_ids_by_unit"], exclusive))

    configurations: list[dict[str, Any]] = []
    by_unit = {unit["unit_id"]: unit for unit in units}
    ambiguous_by_unit: dict[str, list[int]] = {unit_id: [] for unit_id in unit_ids}
    for ambiguity in exclusive["ambiguous_components"]:
        component_id = int(ambiguity["component_id"])
        for match in scored["scores_by_component"].get(component_id, []):
            ambiguous_by_unit[match["unit_id"]].append(component_id)
    for policy_name, assignments, metadata in policies:
        freeze_started = time.perf_counter()
        items: list[dict[str, Any]] = []
        blocked = metadata.get("already_claimed_component_ids_by_unit", {})
        for unit_id in unit_ids:
            items.append(
                candidate_item(
                    by_unit[unit_id],
                    locator_key,
                    list(assignments[unit_id]),
                    scored,
                    clean,
                    ambiguity_ids=(ambiguous_by_unit[unit_id] if policy_name.startswith("global_exclusive") else []),
                    blocked_ids=list(blocked.get(unit_id, [])),
                )
            )
        configurations.append(
            {
                "locator": locator_key,
                "policy": policy_name,
                "policy_metadata": {
                    key: value for key, value in metadata.items()
                    if key not in {"component_ids_by_unit", "already_claimed_component_ids_by_unit", "assignment_receipts"}
                },
                "unit_order": metadata.get("unit_order"),
                "candidate_freeze_wall_time_ms": round((time.perf_counter() - freeze_started) * 1000.0, 3),
                "items": items,
            }
        )

    score_record = {
        "schema_version": "component-locator-score-record.v1",
        "locator": locator_key,
        "score_wall_time_ms": score_wall_time_ms,
        "locators": scored["locators"],
        "components": scored["components"],
        "scores_by_component": {str(key): value for key, value in scored["scores_by_component"].items()},
        "touched_component_ids_by_unit": scored["touched_component_ids_by_unit"],
    }
    order_disagreement = compare_order_assignments(configurations)
    return configurations, score_record, order_disagreement


def compare_order_assignments(configurations: list[dict[str, Any]]) -> dict[str, Any]:
    sequential = {
        config["policy"]: {
            component_id: item["unit_id"]
            for item in config["items"]
            for component_id in item["selected_component_ids"]
        }
        for config in configurations
        if config["policy"].startswith("sequential_")
    }
    names = sorted(sequential)
    pairs: list[dict[str, Any]] = []
    unstable: set[int] = set()
    for left_index, left_name in enumerate(names):
        for right_name in names[left_index + 1 :]:
            shared = set(sequential[left_name]) & set(sequential[right_name])
            changed = sorted(
                component_id for component_id in shared
                if sequential[left_name][component_id] != sequential[right_name][component_id]
            )
            unstable.update(changed)
            pairs.append(
                {
                    "left_policy": left_name,
                    "right_policy": right_name,
                    "differently_owned_component_count": len(changed),
                    "differently_owned_component_ids": changed,
                }
            )
    return {
        "unstable_component_count_union": len(unstable),
        "unstable_component_ids_union": sorted(unstable),
        "pairwise": pairs,
    }


def evaluate_configurations(
    configurations: list[dict[str, Any]],
    human: list[dict[str, Any]],
    ownership: np.ndarray,
    human_binding: dict[str, int],
    clean: np.ndarray,
) -> None:
    human_by_number = {word["word_number"]: word for word in human}
    for config in configurations:
        claimed_union = np.zeros_like(clean)
        component_claimants: dict[int, list[str]] = {}
        for item in config["items"]:
            selected = item.pop("_selected")
            number = int(human_binding[item["unit_id"]])
            target = ownership == number
            true_positive = int(np.count_nonzero(selected & target))
            foreign = int(np.count_nonzero(selected & (ownership > 0) & ~target))
            unlabelled = int(np.count_nonzero(selected & (ownership == 0)))
            missed = int(np.count_nonzero(target & ~selected))
            precision = true_positive / max(1, true_positive + foreign + unlabelled)
            recall = true_positive / max(1, human_by_number[number]["pixels"])
            f1 = 2 * precision * recall / max(1e-12, precision + recall)
            item["evaluation_human_word_number"] = number
            item["evaluation"] = {
                "human_word_number": number,
                "human_pixel_sha256": human_by_number[number]["pixel_sha256"],
                "true_positive_pixels": true_positive,
                "foreign_human_word_pixels": foreign,
                "unlabelled_selected_pixels": unlabelled,
                "missed_target_pixels": missed,
                "precision": round(precision, 6),
                "recall": round(recall, 6),
                "f1": round(f1, 6),
                "evaluation_gate_high_quality": bool(precision >= 0.97 and recall >= 0.95),
            }
            claimed_union |= selected
            for component_id in item["selected_component_ids"]:
                component_claimants.setdefault(component_id, []).append(item["unit_id"])
        auto = [item for item in config["items"] if item["acting_gate_auto_easy"]]
        auto_quality = [item for item in auto if item["evaluation"]["evaluation_gate_high_quality"]]
        quality = [item for item in config["items"] if item["evaluation"]["evaluation_gate_high_quality"]]
        config["summary"] = {
            "unit_count": len(config["items"]),
            "nonempty_selection_count": sum(item["selected_pixels"] > 0 for item in config["items"]),
            "evaluation_high_quality_count": len(quality),
            "acting_auto_easy_count": len(auto),
            "acting_auto_easy_high_quality_count": len(auto_quality),
            "acting_gate_precision": round(len(auto_quality) / max(1, len(auto)), 6),
            "median_pixel_precision": round(float(np.median([item["evaluation"]["precision"] for item in config["items"]])), 6),
            "median_pixel_recall": round(float(np.median([item["evaluation"]["recall"] for item in config["items"]])), 6),
            "median_pixel_f1": round(float(np.median([item["evaluation"]["f1"] for item in config["items"]])), 6),
            "duplicate_component_claim_count": sum(len(claimants) > 1 for claimants in component_claimants.values()),
            "claimed_union_pixels": int(claimed_union.sum()),
            "clean_residual_pixels": int(np.count_nonzero(clean & ~claimed_union)),
            "empty_or_abstained_units": [item["unit_id"] for item in config["items"] if item["selected_pixels"] == 0],
        }


def render_comparison_boards(
    source_image: Image.Image,
    clean: np.ndarray,
    configurations: list[dict[str, Any]],
    ownership: np.ndarray,
    output_dir: Path,
) -> list[dict[str, Any]]:
    configs = {config["policy"]: config for config in configurations if config["locator"] == "transcript_bbox_xywh"}
    independent = configs["independent_all_touched"]
    exclusive = configs["global_exclusive_ambiguous_abstain"]
    exclusive_by_unit = {item["unit_id"]: item for item in exclusive["items"]}
    cases = [
        item for item in independent["items"]
        if item["acting_gate_auto_easy"] and not item["evaluation"]["evaluation_gate_high_quality"]
    ][:12]
    if not cases:
        cases = sorted(
            independent["items"],
            key=lambda item: item["evaluation"]["precision"],
        )[:12]
    labels, _ = ndimage.label(clean, structure=np.ones((3, 3), dtype=np.uint8))
    columns, cell_width, cell_height = 2, 930, 300
    rows = (len(cases) + columns - 1) // columns
    acting = Image.new("RGB", (columns * cell_width + 40, rows * cell_height + 85), PAPER)
    sealed = Image.new("RGB", acting.size, PAPER)
    acting_draw, sealed_draw = ImageDraw.Draw(acting), ImageDraw.Draw(sealed)
    acting_draw.text((18, 14), "COMPONENT OWNERSHIP — ACTING COMPARISON", fill=(40, 34, 28), font=font(27, bold=True))
    acting_draw.text((18, 49), "red = all touched baseline · green = exclusive suggestion · amber = overlap · cyan = locator", fill=(70, 60, 50), font=font(15))
    sealed_draw.text((18, 14), "COMPONENT OWNERSHIP — SEALED POST-FREEZE CHECK", fill=(40, 34, 28), font=font(27, bold=True))
    sealed_draw.text((18, 49), "green = target · red = baseline foreign · cyan = exclusive foreign · magenta = target still missed", fill=(70, 60, 50), font=font(15))
    source = np.asarray(source_image, dtype=np.uint8)
    for index, baseline_item in enumerate(cases):
        improved_item = exclusive_by_unit[baseline_item["unit_id"]]
        baseline_mask = np.isin(labels, np.asarray(baseline_item["selected_component_ids"], dtype=labels.dtype))
        exclusive_mask = np.isin(labels, np.asarray(improved_item["selected_component_ids"], dtype=labels.dtype))
        number = int(baseline_item["evaluation_human_word_number"])
        target = ownership == number
        union = baseline_mask | exclusive_mask | target
        crop_bbox = bbox_from_mask(union) or baseline_item["proposal_bbox_xywh"]
        crop = expand_bbox(crop_bbox, 0.15, source_image.size)
        x, y, width, height = crop
        row_x = 20 + (index % columns) * cell_width
        row_y = 82 + (index // columns) * cell_height
        acting_values = np.full((height, width, 3), PAPER, dtype=np.uint8)
        acting_values[clean[y : y + height, x : x + width]] = INK
        local_base = baseline_mask[y : y + height, x : x + width]
        local_exclusive = exclusive_mask[y : y + height, x : x + width]
        acting_values[local_base] = RED
        acting_values[local_exclusive] = GREEN
        acting_values[local_base & local_exclusive] = AMBER
        sealed_values = source[y : y + height, x : x + width].copy()
        local_target = target[y : y + height, x : x + width]
        sealed_values[local_target] = (
            sealed_values[local_target].astype(np.float32) * 0.30 + np.asarray(GREEN) * 0.70
        ).astype(np.uint8)
        base_foreign = local_base & ~local_target
        exclusive_foreign = local_exclusive & ~local_target
        missed = local_target & ~local_exclusive
        sealed_values[base_foreign] = RED
        sealed_values[exclusive_foreign] = CYAN
        sealed_values[missed] = MAGENTA

        def fit_panel(values: np.ndarray) -> Image.Image:
            image = Image.fromarray(values, mode="RGB")
            image.thumbnail((430, 185), Image.Resampling.LANCZOS)
            panel = Image.new("RGB", (430, 185), PAPER)
            panel.paste(image, ((430 - image.width) // 2, (185 - image.height) // 2))
            return panel

        acting.paste(fit_panel(acting_values), (row_x, row_y + 55))
        sealed.paste(fit_panel(sealed_values), (row_x, row_y + 55))
        baseline_eval = baseline_item["evaluation"]
        improved_eval = improved_item["evaluation"]
        label = f"{baseline_item['unit_id']} {baseline_item['text']!r}"
        acting_draw.text((row_x, row_y), label, fill=(40, 34, 28), font=font(18, bold=True))
        acting_draw.text((row_x, row_y + 24), f"components {baseline_item['selected_component_count']} → {improved_item['selected_component_count']} · exclusive auto={improved_item['acting_gate_auto_easy']}", fill=(70, 60, 50), font=font(14))
        sealed_draw.text((row_x, row_y), label, fill=(40, 34, 28), font=font(18, bold=True))
        sealed_draw.text((row_x, row_y + 24), f"P {baseline_eval['precision']:.3f}→{improved_eval['precision']:.3f} · R {baseline_eval['recall']:.3f}→{improved_eval['recall']:.3f}", fill=(70, 60, 50), font=font(14))
    acting_path = output_dir / "acting-component-comparison.jpg"
    sealed_path = output_dir / "sealed-component-comparison.jpg"
    acting.save(acting_path, format="JPEG", quality=93, subsampling=0, optimize=True)
    sealed.save(sealed_path, format="JPEG", quality=93, subsampling=0, optimize=True)
    return [
        {"path": acting_path.name, "file_sha256": sha256_file(acting_path), "evidence_role": "acting_visible_no_human_data"},
        {"path": sealed_path.name, "file_sha256": sha256_file(sealed_path), "evidence_role": "post_freeze_sealed_evaluation_only"},
    ]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reviewed-decision", type=Path, required=True)
    parser.add_argument("--transcript-localization", type=Path, required=True)
    parser.add_argument("--clean-mask", type=Path, required=True)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--human-run", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    if args.output_dir.exists():
        raise SystemExit("Output exists; refusing overwrite")
    args.output_dir.mkdir(parents=True)
    units = reviewed_units(args.reviewed_decision)
    transcript = transcript_boxes(args.transcript_localization)
    for unit in units:
        key = (unit["line_order"], unit["word_order"])
        if key in transcript:
            unit["transcript_bbox_xywh"] = transcript[key]
    # Same word set for locator comparison; explicit transcript omissions abstain.
    units = [unit for unit in units if "transcript_bbox_xywh" in unit]
    clean = load_mask(args.clean_mask)
    source_image = Image.open(args.source).convert("RGB")
    if clean.shape != (source_image.height, source_image.width):
        raise RuntimeError("Clean mask and source dimensions differ")

    all_configurations: list[dict[str, Any]] = []
    score_records: list[dict[str, Any]] = []
    order_disagreements: list[dict[str, Any]] = []
    for locator_key in ("reviewed_bbox_xywh", "transcript_bbox_xywh"):
        configs, score_record, disagreement = freeze_locator_family(units, locator_key, clean)
        all_configurations.extend(configs)
        score_records.append(score_record)
        order_disagreements.append({"locator": locator_key, **disagreement})

    score_files: list[dict[str, Any]] = []
    for score_record in score_records:
        path = args.output_dir / f"component-scores-{score_record['locator'].replace('_bbox_xywh', '')}.json"
        path.write_bytes(canonical_json_bytes(score_record) + b"\n")
        score_files.append({"path": path.name, "file_sha256": sha256_file(path), "locator": score_record["locator"]})

    # Sealed evaluation starts only after every candidate and score record exists.
    human, ownership = load_human_partition(args.human_run)
    for locator_key in ("reviewed_bbox_xywh", "transcript_bbox_xywh"):
        binding = bind_human_numbers(units, human, locator_key)
        evaluate_configurations(
            [config for config in all_configurations if config["locator"] == locator_key],
            human,
            ownership,
            binding,
            clean,
        )
    boards = render_comparison_boards(source_image, clean, all_configurations, ownership, args.output_dir)
    record: dict[str, Any] = {
        "schema_version": "disjoint-component-ownership-experiment.v1",
        "evidence_role": "full_body_development_diagnostic_with_post_freeze_sealed_evaluation",
        "method": {
            "component_universe": "8-connected V4 Clean components",
            "locator_families": ["reviewed/Kraken-derived", "transcript-conditioned"],
            "policies": [
                "independent all touched",
                "reading-order first touch",
                "reverse-order first touch",
                "acting-confidence first touch",
                "global exclusive score with ambiguous abstention",
            ],
            "automatic_recovery": False,
            "sealed_evaluation_loaded_after_candidates_frozen": True,
        },
        "inputs": {
            "reviewed_decision": {"path": str(args.reviewed_decision), "file_sha256": sha256_file(args.reviewed_decision)},
            "transcript_localization": {"path": str(args.transcript_localization), "file_sha256": sha256_file(args.transcript_localization)},
            "clean_mask": {"path": str(args.clean_mask), "file_sha256": sha256_file(args.clean_mask), "pixel_sha256": sha256_mask_pixels(clean), "pixels": int(clean.sum())},
            "source": {"path": str(args.source), "file_sha256": sha256_file(args.source)},
            "sealed_human_run": {"path": str(args.human_run), "word_count": len(human)},
        },
        "same_word_set": {"unit_count": len(units), "unit_ids": [unit["unit_id"] for unit in units]},
        "score_files": score_files,
        "order_disagreement": order_disagreements,
        "configurations": all_configurations,
        "boards": boards,
        "metric_warning": "Global disjointness can prevent duplicate ownership but can also starve a later word after an early error. Order disagreement and abstention are review cues, not accuracy certificates.",
    }
    record["experiment_sha256"] = hashlib.sha256(canonical_json_bytes(record)).hexdigest()
    path = args.output_dir / "experiment.json"
    path.write_bytes(canonical_json_bytes(record) + b"\n")
    print(json.dumps({
        "output": str(args.output_dir),
        "summaries": [
            {"locator": config["locator"], "policy": config["policy"], **config["summary"]}
            for config in all_configurations
        ],
        "order_disagreement": order_disagreements,
        "experiment_sha256": record["experiment_sha256"],
    }, indent=2))


if __name__ == "__main__":
    main()
