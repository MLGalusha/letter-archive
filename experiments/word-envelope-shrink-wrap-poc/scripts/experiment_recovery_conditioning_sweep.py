#!/usr/bin/env python3
"""Sweep recovery-conditioning margins without changing ownership selection.

Each word keeps the exact frozen transcript/0%-margin ownership mask from the
prior automatic experiment.  A larger rectangle changes only the Clean pixels
used to condition local source-colour recovery.  Recovered pixels are presented
as optional evidence and are never automatically added to ownership.

The sealed human partition is loaded only after all recovery candidates and
their hashes are frozen.  It diagnoses target evidence, foreign evidence,
detached fragments, and residual consequences.
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

from word_envelope.io_utils import canonical_json_bytes, sha256_file, sha256_mask_pixels
from word_envelope.local_ink_recovery import recover_local_ink_candidates


PAPER = (250, 246, 237)
INK = (40, 44, 52)
GREEN = (18, 145, 73)
RED = (202, 48, 49)
AMBER = (221, 143, 31)
MAGENTA = (178, 64, 153)
CYAN = (0, 135, 160)


DEFAULT_UNITS = (
    "body-01-U02",
    "body-02-U01",
    "body-02-U02",
    "body-02-U03",
    "body-02-U04",
    "body-05-U04",
    "body-08-U03",
    "body-10-U02",
    "body-11-U03",
    "body-14-U03",
)


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


def clip_bbox(value: list[int], size_wh: tuple[int, int]) -> list[int]:
    x, y, width, height = value
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(size_wh[0], x + width), min(size_wh[1], y + height)
    return [x0, y0, max(1, x1 - x0), max(1, y1 - y0)]


def expand_bbox(value: list[int], fraction: float, size_wh: tuple[int, int], *, minimum: int = 2) -> list[int]:
    x, y, width, height = value
    px = max(minimum, round(width * fraction))
    py = max(minimum, round(height * fraction))
    return clip_bbox([x - px, y - py, width + 2 * px, height + 2 * py], size_wh)


def bbox_from_mask(value: np.ndarray) -> list[int] | None:
    ys, xs = np.nonzero(value)
    if not len(xs):
        return None
    x0, y0 = int(xs.min()), int(ys.min())
    x1, y1 = int(xs.max()) + 1, int(ys.max()) + 1
    return [x0, y0, x1 - x0, y1 - y0]


def load_human_partition(run_dir: Path) -> tuple[dict[int, dict[str, Any]], np.ndarray]:
    state_path = sorted((run_dir / "revisions").glob("r*/state.json"))[-1]
    state = read(state_path)
    manifest = read(run_dir / "manifest.json")
    width, height = manifest["source"]["size_wh"]
    ownership = np.zeros((height, width), dtype=np.uint16)
    words: dict[int, dict[str, Any]] = {}
    for word in state["words"]:
        number = int(word["word_number"])
        local = load_mask(run_dir / word["selected_mask_path"])
        x, y, box_width, box_height = [int(value) for value in word["selection_bbox_xywh"]]
        target = ownership[y : y + box_height, x : x + box_width]
        if local.shape != target.shape or np.any(target[local]):
            raise RuntimeError("Sealed human word partition is stale or overlapping")
        target[local] = number
        words[number] = {
            "word_number": number,
            "bbox_xywh": [x, y, box_width, box_height],
            "pixels": int(local.sum()),
            "pixel_sha256": word["selected_pixel_sha256"],
        }
    return words, ownership


def freeze_candidates(
    items: list[dict[str, Any]],
    clean: np.ndarray,
    strong: np.ndarray,
    source: np.ndarray,
    margins: list[float],
) -> list[dict[str, Any]]:
    labels, _ = ndimage.label(clean, structure=np.ones((3, 3), dtype=np.uint8))
    size_wh = (clean.shape[1], clean.shape[0])
    frozen: list[dict[str, Any]] = []
    for item in items:
        selected = np.isin(labels, np.asarray(item["selected_component_ids"], dtype=labels.dtype))
        if sha256_mask_pixels(selected) != item["selected_pixel_sha256"]:
            raise RuntimeError(f"Frozen baseline selection changed for {item['unit_id']}")
        tight = [int(value) for value in item["ink_tight_bbox_xywh"]]
        recovery_crop = expand_bbox(tight, 0.70, size_wh, minimum=36)
        cx, cy, cw, ch = recovery_crop
        word_result: dict[str, Any] = {
            "unit_id": item["unit_id"],
            "line_id": item["line_id"],
            "text": item["text"],
            "evaluation_human_word_number": item["evaluation_human_word_number"],
            "proposal_bbox_xywh": item["proposal_bbox_xywh"],
            "ink_tight_bbox_xywh": tight,
            "fixed_ownership_bbox_xywh": item["selected_bbox_xywh"],
            "fixed_ownership_component_ids": item["selected_component_ids"],
            "fixed_ownership_pixels": int(selected.sum()),
            "fixed_ownership_pixel_sha256": sha256_mask_pixels(selected),
            "recovery_crop_bbox_xywh": recovery_crop,
            "margins": [],
            "_fixed_ownership": selected,
        }
        previous_candidate: np.ndarray | None = None
        for margin in margins:
            conditioning_bbox = expand_bbox(tight, margin, size_wh, minimum=2)
            ax, ay, aw, ah = conditioning_bbox
            anchor = np.zeros_like(clean)
            anchor[ay : ay + ah, ax : ax + aw] = clean[ay : ay + ah, ax : ax + aw]
            started = time.perf_counter()
            recovered = recover_local_ink_candidates(
                source,
                anchor,
                np.zeros_like(clean),
                recovery_crop,
            )
            elapsed_ms = (time.perf_counter() - started) * 1000.0
            local_anchor = anchor[cy : cy + ch, cx : cx + cw]
            local_candidate = recovered["candidates"]["maximum_recall"]["mask"] & strong[cy : cy + ch, cx : cx + cw]
            candidate = np.zeros_like(clean)
            candidate[cy : cy + ch, cx : cx + cw] = local_candidate
            optional_evidence = candidate & ~selected
            local_recovery_additions = np.zeros_like(clean)
            local_recovery_additions[cy : cy + ch, cx : cx + cw] = (
                local_candidate & ~local_anchor
            )
            conditioning_anchor_optional = anchor & ~selected
            generous_guard = expand_bbox(item["proposal_bbox_xywh"], 0.35, size_wh, minimum=12)
            gx, gy, gw, gh = generous_guard
            outside_guard = int(candidate.sum()) - int(candidate[gy : gy + gh, gx : gx + gw].sum())
            candidate_pixels = int(candidate.sum())
            changed_pixels = (
                int(np.count_nonzero(candidate ^ previous_candidate))
                if previous_candidate is not None
                else None
            )
            result = {
                "conditioning_margin_fraction": margin,
                "conditioning_bbox_xywh": conditioning_bbox,
                "conditioning_anchor_pixels": int(anchor.sum()),
                "candidate_bbox_xywh": bbox_from_mask(candidate),
                "candidate_pixels": candidate_pixels,
                "candidate_pixel_sha256": sha256_mask_pixels(candidate),
                "optional_evidence_pixels": int(optional_evidence.sum()),
                "optional_evidence_pixel_sha256": sha256_mask_pixels(optional_evidence),
                "conditioning_anchor_optional_pixels": int(conditioning_anchor_optional.sum()),
                "local_recovery_addition_optional_pixels": int(
                    np.count_nonzero(local_recovery_additions & ~selected)
                ),
                "candidate_component_count": int(ndimage.label(local_candidate, structure=np.ones((3, 3), dtype=np.uint8))[1]),
                "outside_generous_proposal_pixels": outside_guard,
                "outside_generous_proposal_fraction": round(outside_guard / max(1, candidate_pixels), 6),
                "changed_candidate_pixels_from_previous_margin": changed_pixels,
                "recovery_wall_time_ms": round(elapsed_ms, 3),
                "recovery_profile": "maximum_recall_clipped_to_bound_v4_high_recall",
                "automatic_ownership_effect": "none",
                "_candidate": candidate,
                "_optional_evidence": optional_evidence,
            }
            word_result["margins"].append(result)
            previous_candidate = candidate
        frozen.append(word_result)
    return frozen


def evaluate(frozen: list[dict[str, Any]], words: dict[int, dict[str, Any]], ownership: np.ndarray) -> None:
    for word in frozen:
        target_number = int(word["evaluation_human_word_number"])
        target = ownership == target_number
        fixed = word["_fixed_ownership"]
        fixed_true = int(np.count_nonzero(fixed & target))
        fixed_foreign = int(np.count_nonzero(fixed & (ownership > 0) & ~target))
        fixed_unlabelled = int(np.count_nonzero(fixed & (ownership == 0)))
        word["sealed_fixed_ownership_evaluation"] = {
            "target_word": words[target_number],
            "true_positive_pixels": fixed_true,
            "foreign_word_pixels": fixed_foreign,
            "unlabelled_pixels": fixed_unlabelled,
            "precision": round(fixed_true / max(1, int(fixed.sum())), 6),
            "recall": round(fixed_true / max(1, words[target_number]["pixels"]), 6),
        }
        missed_before = target & ~fixed
        missed_labels, missed_count = ndimage.label(missed_before, structure=np.ones((3, 3), dtype=np.uint8))
        for result in word["margins"]:
            candidate = result.pop("_candidate")
            optional_evidence = result.pop("_optional_evidence")
            target_additions = int(np.count_nonzero(optional_evidence & target))
            foreign_additions = int(np.count_nonzero(optional_evidence & (ownership > 0) & ~target))
            unlabelled_additions = int(np.count_nonzero(optional_evidence & (ownership == 0)))
            recovered_missed_component_areas: list[int] = []
            fully_recovered_missed_components = 0
            for component_id in range(1, missed_count + 1):
                component = missed_labels == component_id
                area = int(component.sum())
                recovered_pixels = int(np.count_nonzero(component & optional_evidence))
                if recovered_pixels:
                    recovered_missed_component_areas.append(recovered_pixels)
                if area and recovered_pixels == area:
                    fully_recovered_missed_components += 1
            potential_true = int(np.count_nonzero((fixed | optional_evidence) & target))
            naive = fixed | optional_evidence
            naive_true = int(np.count_nonzero(naive & target))
            naive_foreign = int(np.count_nonzero(naive & (ownership > 0) & ~target))
            naive_unlabelled = int(np.count_nonzero(naive & (ownership == 0)))
            result["sealed_evaluation"] = {
                "target_optional_evidence_pixels_not_in_fixed_ownership": target_additions,
                "foreign_word_optional_evidence_pixels": foreign_additions,
                "unlabelled_optional_evidence_pixels": unlabelled_additions,
                "potential_target_recall_if_only_correct_additions_approved": round(potential_true / max(1, words[target_number]["pixels"]), 6),
                "correction_pixels_if_all_recovery_naively_owned": foreign_additions + unlabelled_additions,
                "naive_all_recovery_precision": round(naive_true / max(1, naive_true + naive_foreign + naive_unlabelled), 6),
                "naive_all_recovery_recall": round(naive_true / max(1, words[target_number]["pixels"]), 6),
                "false_residual_removal_pixels_if_naively_owned": foreign_additions,
                "target_residual_reduction_pixels_if_correctly_approved": target_additions,
                "missed_target_components_touched": len(recovered_missed_component_areas),
                "missed_target_components_fully_recovered": fully_recovered_missed_components,
                "recovered_pixels_by_missed_target_component": recovered_missed_component_areas,
            }
        word.pop("_fixed_ownership")


def summarize(frozen: list[dict[str, Any]], margins: list[float]) -> list[dict[str, Any]]:
    summaries: list[dict[str, Any]] = []
    for index, margin in enumerate(margins):
        rows = [word["margins"][index] for word in frozen]
        evaluations = [row["sealed_evaluation"] for row in rows]
        summaries.append(
            {
                "conditioning_margin_fraction": margin,
                "median_conditioning_anchor_pixels": round(float(np.median([row["conditioning_anchor_pixels"] for row in rows])), 3),
                "median_optional_evidence_pixels": round(float(np.median([row["optional_evidence_pixels"] for row in rows])), 3),
                "median_target_optional_evidence_pixels": round(float(np.median([value["target_optional_evidence_pixels_not_in_fixed_ownership"] for value in evaluations])), 3),
                "median_foreign_word_optional_evidence_pixels": round(float(np.median([value["foreign_word_optional_evidence_pixels"] for value in evaluations])), 3),
                "median_unlabelled_optional_evidence_pixels": round(float(np.median([value["unlabelled_optional_evidence_pixels"] for value in evaluations])), 3),
                "median_potential_target_recall": round(float(np.median([value["potential_target_recall_if_only_correct_additions_approved"] for value in evaluations])), 6),
                "median_naive_all_recovery_precision": round(float(np.median([value["naive_all_recovery_precision"] for value in evaluations])), 6),
                "words_with_target_optional_evidence": sum(value["target_optional_evidence_pixels_not_in_fixed_ownership"] > 0 for value in evaluations),
                "words_with_foreign_optional_evidence": sum(value["foreign_word_optional_evidence_pixels"] > 0 for value in evaluations),
                "total_target_residual_reduction_if_correctly_approved": sum(value["target_residual_reduction_pixels_if_correctly_approved"] for value in evaluations),
                "total_false_residual_removal_if_naively_owned": sum(value["false_residual_removal_pixels_if_naively_owned"] for value in evaluations),
                "median_recovery_wall_time_ms": round(float(np.median([row["recovery_wall_time_ms"] for row in rows])), 3),
            }
        )
    return summaries


def tint(base: np.ndarray, mask: np.ndarray, color: tuple[int, int, int], alpha: float) -> np.ndarray:
    result = base.astype(np.float32)
    result[mask] = result[mask] * (1.0 - alpha) + np.asarray(color, dtype=np.float32) * alpha
    return np.clip(result, 0, 255).astype(np.uint8)


def render_boards(
    source_image: Image.Image,
    clean: np.ndarray,
    strong: np.ndarray,
    frozen: list[dict[str, Any]],
    ownership: np.ndarray,
    output_dir: Path,
) -> list[dict[str, Any]]:
    size_wh = source_image.size
    panel_size = (205, 122)
    row_height = 180
    width = 1280
    acting = Image.new("RGB", (width, 95 + row_height * len(frozen)), PAPER)
    sealed = Image.new("RGB", (width, 95 + row_height * len(frozen)), PAPER)
    acting_draw = ImageDraw.Draw(acting)
    sealed_draw = ImageDraw.Draw(sealed)
    acting_draw.text((18, 14), "RECOVERY CONDITIONING SWEEP — ACTING EVIDENCE ONLY", fill=(40, 34, 28), font=font(25, bold=True))
    acting_draw.text((18, 47), "dark = Clean · green = fixed ownership · amber = optional recovered evidence · cyan = locator", fill=(70, 60, 50), font=font(15))
    sealed_draw.text((18, 14), "RECOVERY CONDITIONING SWEEP — SEALED POST-FREEZE EVALUATION", fill=(40, 34, 28), font=font(25, bold=True))
    sealed_draw.text((18, 47), "green = target evidence · red = foreign-word evidence · magenta = unlabelled evidence", fill=(70, 60, 50), font=font(15))
    source = np.asarray(source_image, dtype=np.uint8)
    labels, _ = ndimage.label(clean, structure=np.ones((3, 3), dtype=np.uint8))

    for row_index, word in enumerate(frozen):
        y0 = 83 + row_index * row_height
        crop = expand_bbox(word["recovery_crop_bbox_xywh"], 0.04, size_wh, minimum=8)
        x, y, cw, ch = crop
        scale = min(panel_size[0] / cw, panel_size[1] / ch)
        target_number = int(word["evaluation_human_word_number"])
        fixed_hash = word["fixed_ownership_pixel_sha256"]
        fixed = np.isin(
            labels,
            np.asarray(word["fixed_ownership_component_ids"], dtype=labels.dtype),
        )
        if sha256_mask_pixels(fixed) != fixed_hash:
            raise RuntimeError(f"Fixed ownership rendering drifted for {word['unit_id']}")
        fixed_local = fixed[y : y + ch, x : x + cw]
        acting_draw.text((18, y0), f"{word['unit_id']}  {word['text']!r}", fill=(40, 34, 28), font=font(17, bold=True))
        sealed_draw.text((18, y0), f"{word['unit_id']}  {word['text']!r}", fill=(40, 34, 28), font=font(17, bold=True))
        for margin_index, result in enumerate(word["margins"]):
            px = 205 + margin_index * 212
            local_candidate_hash = result["candidate_pixel_sha256"]
            # Recompute for rendering from the exact frozen inputs; hashes are
            # verified against the stored candidate to catch drift.
            ax, ay, aw, ah = result["conditioning_bbox_xywh"]
            anchor = np.zeros_like(clean)
            anchor[ay : ay + ah, ax : ax + aw] = clean[ay : ay + ah, ax : ax + aw]
            recovered = recover_local_ink_candidates(source, anchor, np.zeros_like(clean), word["recovery_crop_bbox_xywh"])
            rcx, rcy, rcw, rch = word["recovery_crop_bbox_xywh"]
            candidate = np.zeros_like(clean)
            candidate[rcy : rcy + rch, rcx : rcx + rcw] = recovered["candidates"]["maximum_recall"]["mask"] & strong[rcy : rcy + rch, rcx : rcx + rcw]
            if sha256_mask_pixels(candidate) != local_candidate_hash:
                raise RuntimeError(f"Rendering recomputation drifted for {word['unit_id']} margin {result['conditioning_margin_fraction']}")
            optional_evidence = candidate & ~fixed
            local_clean = clean[y : y + ch, x : x + cw]
            act_values = np.full((ch, cw, 3), PAPER, dtype=np.uint8)
            act_values[local_clean] = INK
            act_values = tint(act_values, fixed_local, GREEN, 0.72)
            act_values = tint(act_values, optional_evidence[y : y + ch, x : x + cw], AMBER, 0.78)
            eval_values = np.asarray(source_image.crop((x, y, x + cw, y + ch)), dtype=np.uint8)
            local_add = optional_evidence[y : y + ch, x : x + cw]
            local_ownership = ownership[y : y + ch, x : x + cw]
            eval_values = tint(eval_values, local_add & (local_ownership == target_number), GREEN, 0.78)
            eval_values = tint(eval_values, local_add & (local_ownership > 0) & (local_ownership != target_number), RED, 0.80)
            eval_values = tint(eval_values, local_add & (local_ownership == 0), MAGENTA, 0.72)

            def fit(values: np.ndarray) -> Image.Image:
                image = Image.fromarray(values, mode="RGB")
                image.thumbnail(panel_size, Image.Resampling.LANCZOS)
                panel = Image.new("RGB", panel_size, PAPER)
                panel.paste(image, ((panel_size[0] - image.width) // 2, (panel_size[1] - image.height) // 2))
                return panel

            acting.paste(fit(act_values), (px, y0 + 25))
            sealed.paste(fit(eval_values), (px, y0 + 25))
            label = f"{result['conditioning_margin_fraction']:.0%}"
            acting_draw.text((px, y0 + 149), f"{label}  +{result['optional_evidence_pixels']:,}", fill=(65, 56, 48), font=font(13))
            evaluation = result["sealed_evaluation"]
            sealed_draw.text((px, y0 + 149), f"{label}  T+{evaluation['target_optional_evidence_pixels_not_in_fixed_ownership']:,} F+{evaluation['foreign_word_optional_evidence_pixels']:,}", fill=(65, 56, 48), font=font(13))
        acting_draw.text((18, y0 + 29), f"fixed mask {fixed_hash[:10]}…", fill=(80, 68, 58), font=font(12))
        sealed_draw.text((18, y0 + 29), f"base P {word['sealed_fixed_ownership_evaluation']['precision']:.3f} R {word['sealed_fixed_ownership_evaluation']['recall']:.3f}", fill=(80, 68, 58), font=font(12))
    acting_path = output_dir / "acting-recovery-sweep.jpg"
    sealed_path = output_dir / "sealed-recovery-evaluation.jpg"
    acting.save(acting_path, format="JPEG", quality=92, subsampling=0, optimize=True)
    sealed.save(sealed_path, format="JPEG", quality=92, subsampling=0, optimize=True)
    return [
        {"path": acting_path.name, "file_sha256": sha256_file(acting_path), "evidence_role": "acting_visible_no_human_data"},
        {"path": sealed_path.name, "file_sha256": sha256_file(sealed_path), "evidence_role": "post_freeze_sealed_evaluation_only"},
    ]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--experiment", type=Path, required=True)
    parser.add_argument("--clean-mask", type=Path, required=True)
    parser.add_argument("--strong-mask", type=Path, required=True)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--human-run", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--margins", default="0,0.10,0.18,0.30,0.45")
    parser.add_argument("--unit-id", action="append")
    args = parser.parse_args()
    if args.output_dir.exists():
        raise SystemExit("Output exists; refusing overwrite")
    args.output_dir.mkdir(parents=True)
    margins = [float(value) for value in args.margins.split(",")]
    if margins != sorted(set(margins)) or any(value < 0 or value > 1.0 for value in margins):
        raise SystemExit("Margins must be unique ascending fractions from 0 to 1")

    experiment = read(args.experiment)
    configuration = next(
        value for value in experiment["configurations"]
        if value["locator"] == "transcript_bbox_xywh" and float(value["anchor_margin_fraction"]) == 0.0
    )
    by_unit = {value["unit_id"]: value for value in configuration["items"] if value.get("status") == "frozen"}
    unit_ids = tuple(args.unit_id or DEFAULT_UNITS)
    missing = [value for value in unit_ids if value not in by_unit]
    if missing:
        raise SystemExit(f"Frozen units unavailable: {missing}")
    clean = load_mask(args.clean_mask)
    strong = load_mask(args.strong_mask)
    if clean.shape != strong.shape or np.any(clean & ~strong):
        raise RuntimeError("Bound Clean and High Recall masks are not same-size nested masks")
    source_image = Image.open(args.source).convert("RGB")
    source = np.asarray(source_image, dtype=np.uint8)
    if clean.shape != source.shape[:2]:
        raise RuntimeError("Source and bound ink masks have different dimensions")

    started = time.perf_counter()
    frozen = freeze_candidates([by_unit[value] for value in unit_ids], clean, strong, source, margins)
    candidate_freeze_wall_time_ms = round((time.perf_counter() - started) * 1000.0, 3)
    words, ownership = load_human_partition(args.human_run)
    evaluate(frozen, words, ownership)
    summaries = summarize(frozen, margins)
    boards = render_boards(source_image, clean, strong, frozen, ownership, args.output_dir)
    record: dict[str, Any] = {
        "schema_version": "recovery-conditioning-ownership-independent-sweep.v2",
        "evidence_role": "ten_word_development_diagnostic_with_post_freeze_sealed_evaluation",
        "method": {
            "fixed_ownership": "exact transcript-locator 0%-margin frozen selection; identical at every recovery margin",
            "conditioning_anchor": "V4 Clean pixels inside ink-tight bbox expanded by the configured margin",
            "recovery": "maximum_recall local source-colour candidate clipped to bound V4 High Recall; every candidate pixel outside fixed ownership remains optional evidence, including conditioning-anchor Clean ink",
            "automatic_ownership_of_recovery": False,
            "sealed_evaluation_loaded_after_candidates_frozen": True,
        },
        "inputs": {
            "experiment": {"path": str(args.experiment), "file_sha256": sha256_file(args.experiment), "experiment_sha256": experiment["experiment_sha256"]},
            "clean_mask": {"path": str(args.clean_mask), "file_sha256": sha256_file(args.clean_mask), "pixel_sha256": sha256_mask_pixels(clean), "pixels": int(clean.sum())},
            "strong_mask": {"path": str(args.strong_mask), "file_sha256": sha256_file(args.strong_mask), "pixel_sha256": sha256_mask_pixels(strong), "pixels": int(strong.sum())},
            "source": {"path": str(args.source), "file_sha256": sha256_file(args.source)},
            "sealed_human_run": {"path": str(args.human_run), "word_count": len(words)},
        },
        "sample": {"unit_ids": list(unit_ids), "selection_role": "predeclared mixed development sample spanning easy, broad, neighbor-capture, incomplete, and punctuation cases"},
        "margins": margins,
        "candidate_freeze_wall_time_ms": candidate_freeze_wall_time_ms,
        "summary_by_margin": summaries,
        "words": frozen,
        "boards": boards,
        "metric_warning": "Recovered target pixels are potential evidence, not ownership. Foreign and unlabelled available pixels require exclusion; naive ownership is reported only as a failure counterfactual.",
    }
    record["experiment_sha256"] = hashlib.sha256(canonical_json_bytes(record)).hexdigest()
    output_path = args.output_dir / "experiment.json"
    output_path.write_bytes(canonical_json_bytes(record) + b"\n")
    print(json.dumps({"output": str(args.output_dir), "summary_by_margin": summaries, "experiment_sha256": record["experiment_sha256"]}, indent=2))


if __name__ == "__main__":
    main()
