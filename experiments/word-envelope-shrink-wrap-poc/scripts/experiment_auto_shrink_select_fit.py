#!/usr/bin/env python3
"""Evaluate proposal -> ink-tight box -> component selection -> fitted envelope.

The automatic path never reads the human run while making a selection.  Human
word masks are loaded only after every candidate is frozen and are used to
measure the result.  This keeps the experiment useful without turning the
evaluation page into an input hint.
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
from scipy.optimize import linear_sum_assignment

from word_envelope.fragmented_envelope import fit_fragmented_envelope
from word_envelope.io_utils import canonical_json_bytes, sha256_file, sha256_mask_pixels


PAPER = (251, 247, 238)
GREEN = (20, 151, 75)
RED = (201, 55, 48)
CYAN = (0, 137, 159)
AMBER = (214, 139, 33)


def read(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def mask(path: Path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("L"), dtype=np.uint8) > 0


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


def clip_bbox(value: list[int], size_wh: tuple[int, int]) -> list[int]:
    x, y, width, height = value
    x0, y0 = max(0, x), max(0, y)
    x1 = min(size_wh[0], x + width)
    y1 = min(size_wh[1], y + height)
    return [x0, y0, max(1, x1 - x0), max(1, y1 - y0)]


def expand_bbox(value: list[int], fraction: float, size_wh: tuple[int, int]) -> list[int]:
    x, y, width, height = value
    px = max(2, int(round(width * fraction)))
    py = max(2, int(round(height * fraction)))
    return clip_bbox([x - px, y - py, width + 2 * px, height + 2 * py], size_wh)


def bbox_iou(left: list[int], right: list[int]) -> float:
    lx, ly, lw, lh = left
    rx, ry, rw, rh = right
    ix0, iy0 = max(lx, rx), max(ly, ry)
    ix1, iy1 = min(lx + lw, rx + rw), min(ly + lh, ry + rh)
    intersection = max(0, ix1 - ix0) * max(0, iy1 - iy0)
    union = lw * lh + rw * rh - intersection
    return intersection / max(1, union)


def font(size: int) -> ImageFont.ImageFont:
    try:
        return ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", size)
    except OSError:
        return ImageFont.load_default()


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
                    "reviewed_bbox_xywh": list(unit["bbox_source_xywh"]),
                }
            )
    return units


def transcript_boxes(path: Path) -> dict[tuple[int, int], list[int]]:
    result = read(path)
    boxes: dict[tuple[int, int], list[int]] = {}
    for line in result["bodyLines"]:
        for word in line["words"]:
            boxes[(int(line["lineIndex"]), int(word["wordIndex"]))] = polygon_bbox(
                word["polygon"]
            )
    return boxes


def freeze_candidates(
    units: list[dict[str, Any]],
    clean: np.ndarray,
    locator_name: str,
    margin_fraction: float,
) -> list[dict[str, Any]]:
    labels, count = ndimage.label(clean, structure=np.ones((3, 3), dtype=np.uint8))
    component_areas = np.bincount(labels.ravel(), minlength=count + 1)
    component_slices = ndimage.find_objects(labels)
    size_wh = (clean.shape[1], clean.shape[0])
    frozen: list[dict[str, Any]] = []
    for unit in units:
        if locator_name not in unit:
            frozen.append(unit | {"status": "locator_unavailable"})
            continue
        proposal = clip_bbox(list(unit[locator_name]), size_wh)
        x, y, width, height = proposal
        local = clean[y : y + height, x : x + width]
        local_bbox = bbox_from_mask(local)
        if local_bbox is None:
            frozen.append(unit | {"status": "no_ink_in_locator", "proposal_bbox_xywh": proposal})
            continue
        tight = [x + local_bbox[0], y + local_bbox[1], local_bbox[2], local_bbox[3]]
        anchor = expand_bbox(tight, margin_fraction, size_wh)
        ax, ay, aw, ah = anchor
        touched = np.unique(labels[ay : ay + ah, ax : ax + aw])
        touched = touched[touched > 0]
        selected = np.isin(labels, touched)
        selected_bbox = bbox_from_mask(selected)
        if selected_bbox is None:
            frozen.append(unit | {"status": "empty_selection", "proposal_bbox_xywh": proposal})
            continue
        sx, sy, sw, sh = selected_bbox
        proposal_guard = expand_bbox(proposal, 0.35, size_wh)
        gx, gy, gw, gh = proposal_guard
        outside_guard = int(selected.sum()) - int(selected[gy : gy + gh, gx : gx + gw].sum())
        selected_pixels = int(selected.sum())
        # Acting-only conservative signals.  They intentionally do not use the
        # human masks loaded later.
        component_extension_fraction = outside_guard / max(1, selected_pixels)
        enormous_component = any(int(component_areas[int(cid)]) > max(12000, selected_pixels * 0.8) for cid in touched)
        acting_gate = (
            selected_pixels >= 8
            and len(touched) <= 16
            and component_extension_fraction <= 0.025
            and not enormous_component
        )
        crop = expand_bbox(selected_bbox, 0.20, size_wh)
        cx, cy, cw, ch = crop
        local_selected = selected[cy : cy + ch, cx : cx + cw]
        local_excluded = clean[cy : cy + ch, cx : cx + cw] & ~local_selected
        fit_status = "not_run"
        fit_profile = None
        envelope_polygon = None
        envelope_contamination = None
        try:
            fitted = fit_fragmented_envelope(local_selected, local_excluded)
            profile_name, passing = sorted(
                fitted["candidates"].items(),
                key=lambda item: (
                    item[1]["excluded_ink_fraction_inside_envelope"],
                    item[1]["envelope_area_px2"],
                ),
            )[0]
            fit_status = "pass"
            fit_profile = profile_name
            envelope_contamination = passing["excluded_ink_fraction_inside_envelope"]
            envelope_polygon = [
                [round(float(px + cx), 3), round(float(py + cy), 3)]
                for px, py in passing["polygon"]
            ]
            acting_gate = acting_gate and envelope_contamination <= 0.055
        except Exception as error:  # fail closed and preserve the reason in this diagnostic
            fit_status = "rejected"
            fit_profile = type(error).__name__
            acting_gate = False
        frozen.append(
            unit
            | {
                "status": "frozen",
                "proposal_bbox_xywh": proposal,
                "ink_tight_bbox_xywh": tight,
                "selection_anchor_bbox_xywh": anchor,
                "selected_bbox_xywh": selected_bbox,
                "selected_component_ids": [int(value) for value in touched],
                "selected_component_count": int(len(touched)),
                "selected_pixels": selected_pixels,
                "selected_pixel_sha256": sha256_mask_pixels(selected),
                "component_extension_fraction": round(component_extension_fraction, 6),
                "fit_status": fit_status,
                "fit_profile": fit_profile,
                "envelope_excluded_ink_fraction": envelope_contamination,
                "envelope_polygon": envelope_polygon,
                "acting_gate_auto_easy": bool(acting_gate),
                "_selected": selected,
            }
        )
    return frozen


def load_human_words(run_dir: Path) -> tuple[list[dict[str, Any]], np.ndarray]:
    revisions = sorted((run_dir / "revisions").glob("r*/state.json"))
    state = read(revisions[-1])
    manifest = read(run_dir / "manifest.json")
    width, height = manifest["source"]["size_wh"]
    ownership = np.zeros((height, width), dtype=np.uint16)
    words: list[dict[str, Any]] = []
    for word in state["words"]:
        word_number = int(word["word_number"])
        local = mask(run_dir / word["selected_mask_path"])
        x, y, box_width, box_height = word["selection_bbox_xywh"]
        if local.shape != (box_height, box_width):
            raise RuntimeError("Human word mask does not match its frozen source bbox")
        target = ownership[y : y + box_height, x : x + box_width]
        if np.any(target[local]):
            raise RuntimeError("Human word masks overlap; evaluation is not an exact partition")
        target[local] = word_number
        words.append(
            {
                "word_number": word_number,
                "bbox_xywh": list(word["selection_bbox_xywh"]),
                "pixels": int(local.sum()),
                "pixel_sha256": word["selected_pixel_sha256"],
            }
        )
    return words, ownership


def bind_human_words(candidates: list[dict[str, Any]], human: list[dict[str, Any]]) -> None:
    valid_indices = [index for index, item in enumerate(candidates) if item.get("status") == "frozen"]
    cost = np.zeros((len(valid_indices), len(human)), dtype=np.float64)
    diagonal = float(np.hypot(3000, 4000))
    for row, candidate_index in enumerate(valid_indices):
        candidate_bbox = candidates[candidate_index]["proposal_bbox_xywh"]
        cx = candidate_bbox[0] + candidate_bbox[2] / 2
        cy = candidate_bbox[1] + candidate_bbox[3] / 2
        for column, word in enumerate(human):
            bbox = word["bbox_xywh"]
            hx = bbox[0] + bbox[2] / 2
            hy = bbox[1] + bbox[3] / 2
            distance = np.hypot(cx - hx, cy - hy) / diagonal
            cost[row, column] = -(bbox_iou(candidate_bbox, bbox) * 4.0 - distance)
    rows, columns = linear_sum_assignment(cost)
    for row, column in zip(rows, columns):
        candidates[valid_indices[int(row)]]["evaluation_human_word_number"] = human[int(column)]["word_number"]


def evaluate(candidates: list[dict[str, Any]], ownership: np.ndarray, human: list[dict[str, Any]]) -> None:
    human_by_number = {word["word_number"]: word for word in human}
    for item in candidates:
        selected = item.pop("_selected", None)
        if selected is None:
            continue
        target_number = int(item["evaluation_human_word_number"])
        target = ownership == target_number
        true_positive = int(np.count_nonzero(selected & target))
        false_positive = int(np.count_nonzero(selected & (ownership > 0) & ~target))
        unlabelled = int(np.count_nonzero(selected & (ownership == 0)))
        false_negative = int(np.count_nonzero(target & ~selected))
        precision = true_positive / max(1, true_positive + false_positive + unlabelled)
        recall = true_positive / max(1, human_by_number[target_number]["pixels"])
        f1 = 2 * precision * recall / max(1e-12, precision + recall)
        item["evaluation"] = {
            "human_word_number": target_number,
            "human_pixel_sha256": human_by_number[target_number]["pixel_sha256"],
            "true_positive_pixels": true_positive,
            "foreign_human_word_pixels": false_positive,
            "unlabelled_selected_pixels": unlabelled,
            "missed_target_pixels": false_negative,
            "precision": round(precision, 6),
            "recall": round(recall, 6),
            "f1": round(f1, 6),
            "evaluation_gate_high_quality": bool(precision >= 0.97 and recall >= 0.95),
        }


def render_overlay(source: Image.Image, groups: list[tuple[str, float, list[dict[str, Any]]]], output: Path) -> None:
    scale = 0.42
    panel_size = (round(source.width * scale), round(source.height * scale))
    canvas = Image.new("RGB", (panel_size[0] * 2 + 60, panel_size[1] * 2 + 150), PAPER)
    draw = ImageDraw.Draw(canvas)
    draw.text((30, 20), "AUTO SHRINK → SELECT → FIT", fill=(45, 36, 29), font=font(34))
    for index, (locator, margin, items) in enumerate(groups):
        panel = source.resize(panel_size, Image.Resampling.LANCZOS)
        pd = ImageDraw.Draw(panel)
        passed = 0
        for item in items:
            if item.get("status") != "frozen":
                continue
            good = item["evaluation"]["evaluation_gate_high_quality"]
            acting = item["acting_gate_auto_easy"]
            color = GREEN if good and acting else AMBER if good else RED
            if good and acting:
                passed += 1
            x, y, width, height = item["selected_bbox_xywh"]
            pd.rectangle(
                (round(x * scale), round(y * scale), round((x + width) * scale), round((y + height) * scale)),
                outline=color,
                width=3,
            )
        x0 = 30 + (index % 2) * (panel_size[0] + 30)
        y0 = 90 + (index // 2) * (panel_size[1] + 60)
        canvas.paste(panel, (x0, y0))
        draw.text(
            (x0, y0 - 28),
            f"{locator.replace('_bbox_xywh','')} · margin {margin:.0%} · conservative auto-easy {passed}",
            fill=(45, 36, 29),
            font=font(20),
        )
    canvas.save(output, format="JPEG", quality=94, subsampling=0, optimize=True)


def summary(items: list[dict[str, Any]]) -> dict[str, Any]:
    frozen = [item for item in items if item.get("status") == "frozen"]
    quality = [item for item in frozen if item["evaluation"]["evaluation_gate_high_quality"]]
    auto = [item for item in frozen if item["acting_gate_auto_easy"]]
    auto_quality = [item for item in auto if item["evaluation"]["evaluation_gate_high_quality"]]
    return {
        "candidate_count": len(items),
        "frozen_count": len(frozen),
        "evaluation_high_quality_count": len(quality),
        "acting_auto_easy_count": len(auto),
        "acting_auto_easy_high_quality_count": len(auto_quality),
        "acting_auto_easy_precision": round(len(auto_quality) / max(1, len(auto)), 6),
        "median_pixel_precision": round(float(np.median([i["evaluation"]["precision"] for i in frozen])), 6),
        "median_pixel_recall": round(float(np.median([i["evaluation"]["recall"] for i in frozen])), 6),
        "median_pixel_f1": round(float(np.median([i["evaluation"]["f1"] for i in frozen])), 6),
    }


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

    clean = mask(args.clean_mask)
    units = reviewed_units(args.reviewed_decision)
    transcript = transcript_boxes(args.transcript_localization)
    for unit in units:
        key = (unit["line_order"], unit["word_order"])
        if key in transcript:
            unit["transcript_bbox_xywh"] = transcript[key]

    # Acting candidates freeze before the evaluation masks are loaded.
    configurations = [
        ("reviewed_bbox_xywh", 0.00),
        ("reviewed_bbox_xywh", 0.18),
        ("transcript_bbox_xywh", 0.00),
        ("transcript_bbox_xywh", 0.18),
    ]
    groups: list[tuple[str, float, list[dict[str, Any]]]] = []
    for locator, margin in configurations:
        groups.append((locator, margin, freeze_candidates(units, clean, locator, margin)))

    human, ownership = load_human_words(args.human_run)
    for _, _, items in groups:
        bind_human_words(items, human)
        evaluate(items, ownership, human)

    source = Image.open(args.source).convert("RGB")
    overlay_path = args.output_dir / "page-comparison.jpg"
    render_overlay(source, groups, overlay_path)
    record: dict[str, Any] = {
        "schema_version": "auto-shrink-select-fit-experiment.v1",
        "method": {
            "proposal_tightening": "axis-aligned bbox of V4 Clean Ink inside locator",
            "selection": "all 8-connected V4 Clean components touched by expanded tight bbox",
            "fit": "fragmented envelope; lowest excluded-ink fraction profile",
            "acting_gate_uses_human_data": False,
            "evaluation_loaded_after_candidates_frozen": True,
        },
        "inputs": {
            "reviewed_decision": {"path": str(args.reviewed_decision), "file_sha256": sha256_file(args.reviewed_decision)},
            "transcript_localization": {"path": str(args.transcript_localization), "file_sha256": sha256_file(args.transcript_localization)},
            "clean_mask": {"path": str(args.clean_mask), "file_sha256": sha256_file(args.clean_mask), "pixel_sha256": sha256_mask_pixels(clean)},
            "source": {"path": str(args.source), "file_sha256": sha256_file(args.source)},
            "human_evaluation_state": {"run": str(args.human_run), "word_count": len(human)},
        },
        "configurations": [
            {
                "locator": locator,
                "anchor_margin_fraction": margin,
                "summary": summary(items),
                "items": items,
            }
            for locator, margin, items in groups
        ],
        "overlay": {"path": overlay_path.name, "file_sha256": sha256_file(overlay_path)},
        "metric_warning": (
            "Human-mask precision/recall diagnose this frozen page only. They do not certify semantic text, "
            "generalization, residual completeness, or production readiness. Acting gates never receive them."
        ),
    }
    record["experiment_sha256"] = hashlib.sha256(canonical_json_bytes(record)).hexdigest()
    (args.output_dir / "experiment.json").write_bytes(canonical_json_bytes(record) + b"\n")
    print(json.dumps({
        "output": str(args.output_dir),
        "summaries": [config["summary"] for config in record["configurations"]],
        "experiment_sha256": record["experiment_sha256"],
    }, indent=2))


if __name__ == "__main__":
    main()
