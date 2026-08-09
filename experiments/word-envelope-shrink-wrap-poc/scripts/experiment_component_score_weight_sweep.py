#!/usr/bin/env python3
"""Freeze and evaluate a bounded component-score/margin sweep.

The script writes every component assignment and pixel hash before opening the
sealed human run. Evaluation then reports ownership quality, abstention/workload,
and residual together. This is a page-007 development experiment, not a universal
calibration.
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

from experiment_disjoint_component_ownership import (
    bind_human_numbers,
    load_human_partition,
    load_mask,
    reviewed_units,
    transcript_boxes,
)
from word_envelope.component_assignment import (
    exclusive_component_assignment,
    rescore_component_locators,
)
from word_envelope.io_utils import canonical_json_bytes, sha256_file, sha256_mask_pixels


WEIGHT_PROFILES: dict[str, dict[str, float]] = {
    "current": {
        "component_inside_locator_fraction": 0.58,
        "center_x_support": 0.16,
        "center_y_support": 0.16,
        "horizontal_overlap": 0.05,
        "vertical_overlap": 0.05,
    },
    "containment_heavy": {
        "component_inside_locator_fraction": 0.70,
        "center_x_support": 0.10,
        "center_y_support": 0.10,
        "horizontal_overlap": 0.05,
        "vertical_overlap": 0.05,
    },
    "balanced_x": {
        "component_inside_locator_fraction": 0.45,
        "center_x_support": 0.30,
        "center_y_support": 0.15,
        "horizontal_overlap": 0.05,
        "vertical_overlap": 0.05,
    },
    "center_x_heavy": {
        "component_inside_locator_fraction": 0.30,
        "center_x_support": 0.45,
        "center_y_support": 0.15,
        "horizontal_overlap": 0.05,
        "vertical_overlap": 0.05,
    },
    "center_xy": {
        "component_inside_locator_fraction": 0.25,
        "center_x_support": 0.40,
        "center_y_support": 0.25,
        "horizontal_overlap": 0.05,
        "vertical_overlap": 0.05,
    },
    "axis_overlap": {
        "component_inside_locator_fraction": 0.40,
        "center_x_support": 0.20,
        "center_y_support": 0.20,
        "horizontal_overlap": 0.10,
        "vertical_overlap": 0.10,
    },
    "center_dominant": {
        "component_inside_locator_fraction": 0.05,
        "center_x_support": 0.60,
        "center_y_support": 0.25,
        "horizontal_overlap": 0.05,
        "vertical_overlap": 0.05,
    },
}

MARGINS = (0.0, 0.03, 0.06, 0.08, 0.12, 0.16, 0.22)


def read(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def font(size: int, *, bold: bool = False) -> ImageFont.ImageFont:
    name = "Arial Bold.ttf" if bold else "Arial.ttf"
    try:
        return ImageFont.truetype(f"/System/Library/Fonts/Supplemental/{name}", size)
    except OSError:
        return ImageFont.load_default()


def load_scored(path: Path) -> dict[str, Any]:
    record = read(path)
    return {
        "components": record["components"],
        "locators": record["locators"],
        "scores_by_component": {
            int(component_id): rows
            for component_id, rows in record["scores_by_component"].items()
        },
        "touched_component_ids_by_unit": record["touched_component_ids_by_unit"],
    }


def freeze_candidates(
    scored: dict[str, Any],
    clean: np.ndarray,
    labels: np.ndarray,
    units: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    configurations: list[dict[str, Any]] = []
    by_unit = {unit["unit_id"]: unit for unit in units}
    for profile_name, weights in WEIGHT_PROFILES.items():
        rescored = rescore_component_locators(scored, weights)
        for margin in MARGINS:
            started = time.perf_counter()
            assigned = exclusive_component_assignment(
                rescored,
                minimum_score=0.12,
                minimum_score_margin=margin,
            )
            ambiguous_ids = {
                int(row["component_id"]) for row in assigned["ambiguous_components"]
            }
            items: list[dict[str, Any]] = []
            claimed = np.zeros_like(clean)
            for unit_id in [unit["unit_id"] for unit in units]:
                component_ids = list(assigned["component_ids_by_unit"][unit_id])
                selected = np.isin(labels, np.asarray(component_ids, dtype=labels.dtype))
                claimed |= selected
                touched = set(scored["touched_component_ids_by_unit"][unit_id])
                items.append(
                    {
                        "unit_id": unit_id,
                        "line_id": by_unit[unit_id]["line_id"],
                        "text": by_unit[unit_id]["text"],
                        "selected_component_ids": component_ids,
                        "selected_pixels": int(selected.sum()),
                        "selected_pixel_sha256": sha256_mask_pixels(selected),
                        "ambiguous_touched_component_ids": sorted(touched & ambiguous_ids),
                    }
                )
            configurations.append(
                {
                    "config_id": f"{profile_name}--margin-{margin:.2f}",
                    "weight_profile": profile_name,
                    "weights": rescored["score_weights"],
                    "minimum_score": 0.12,
                    "minimum_score_margin": margin,
                    "assignment_wall_time_ms": round(
                        (time.perf_counter() - started) * 1000.0, 3
                    ),
                    "ambiguous_component_count": len(ambiguous_ids),
                    "ambiguous_component_pixels": int(
                        sum(
                            int(scored["components"][component_id - 1]["area_px"])
                            for component_id in ambiguous_ids
                        )
                    ),
                    "unsupported_component_count": len(assigned["unsupported_component_ids"]),
                    "claimed_union_pixels": int(claimed.sum()),
                    "clean_residual_pixels": int(np.count_nonzero(clean & ~claimed)),
                    "items": items,
                }
            )
    return configurations


def evaluate(
    configurations: list[dict[str, Any]],
    labels: np.ndarray,
    human: list[dict[str, Any]],
    ownership: np.ndarray,
    binding: dict[str, int],
) -> None:
    human_by_number = {int(word["word_number"]): word for word in human}
    for config in configurations:
        for item in config["items"]:
            selected = np.isin(
                labels,
                np.asarray(item["selected_component_ids"], dtype=labels.dtype),
            )
            number = int(binding[item["unit_id"]])
            target = ownership == number
            true_positive = int(np.count_nonzero(selected & target))
            foreign = int(np.count_nonzero(selected & (ownership > 0) & ~target))
            unlabelled = int(np.count_nonzero(selected & (ownership == 0)))
            missed = int(np.count_nonzero(target & ~selected))
            precision = true_positive / max(1, true_positive + foreign + unlabelled)
            recall = true_positive / max(1, int(human_by_number[number]["pixels"]))
            f1 = 2 * precision * recall / max(1e-12, precision + recall)
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
                "high_quality": bool(precision >= 0.97 and recall >= 0.95),
            }
        config["summary"] = summarize(config["items"])


def summarize(items: list[dict[str, Any]]) -> dict[str, Any]:
    evaluations = [item["evaluation"] for item in items]
    return {
        "unit_count": len(items),
        "high_quality_count": sum(value["high_quality"] for value in evaluations),
        "foreign_error_word_count": sum(value["precision"] < 0.97 for value in evaluations),
        "missed_error_word_count": sum(value["recall"] < 0.95 for value in evaluations),
        "empty_word_count": sum(item["selected_pixels"] == 0 for item in items),
        "total_true_positive_pixels": sum(value["true_positive_pixels"] for value in evaluations),
        "total_foreign_human_word_pixels": sum(value["foreign_human_word_pixels"] for value in evaluations),
        "total_unlabelled_selected_pixels": sum(value["unlabelled_selected_pixels"] for value in evaluations),
        "total_missed_target_pixels": sum(value["missed_target_pixels"] for value in evaluations),
        "median_precision": round(float(np.median([value["precision"] for value in evaluations])), 6),
        "median_recall": round(float(np.median([value["recall"] for value in evaluations])), 6),
        "median_f1": round(float(np.median([value["f1"] for value in evaluations])), 6),
    }


def ranking_key(summary: dict[str, Any]) -> tuple[Any, ...]:
    """Safety-conscious multi-measure ordering for development comparison."""

    return (
        int(summary["high_quality_count"]),
        -int(summary["foreign_error_word_count"]),
        -int(summary["missed_error_word_count"]),
        -int(summary["total_foreign_human_word_pixels"]),
        -int(summary["total_missed_target_pixels"]),
        -int(summary["empty_word_count"]),
    )


def line_held_out(configurations: list[dict[str, Any]]) -> dict[str, Any]:
    line_ids = sorted({item["line_id"] for item in configurations[0]["items"]})
    folds: list[dict[str, Any]] = []
    combined: list[dict[str, Any]] = []
    for line_id in line_ids:
        ranked: list[tuple[tuple[Any, ...], str, dict[str, Any]]] = []
        for config in configurations:
            training = [item for item in config["items"] if item["line_id"] != line_id]
            ranked.append((ranking_key(summarize(training)), config["config_id"], config))
        _, _, selected = max(ranked, key=lambda row: (row[0], row[1]))
        held_out = [item for item in selected["items"] if item["line_id"] == line_id]
        combined.extend(held_out)
        folds.append(
            {
                "held_out_line_id": line_id,
                "selected_config_id": selected["config_id"],
                "held_out_summary": summarize(held_out),
                "held_out_unit_ids": [item["unit_id"] for item in held_out],
            }
        )
    return {
        "selection_rule": "maximize training high-quality count, then minimize foreign-error words, missed-error words, foreign pixels, missed pixels, and empty words",
        "folds": folds,
        "combined_held_out_summary": summarize(combined),
    }


def pareto_front(configurations: list[dict[str, Any]]) -> list[str]:
    def dominates(left: dict[str, Any], right: dict[str, Any]) -> bool:
        a, b = left["summary"], right["summary"]
        comparisons = (
            a["high_quality_count"] >= b["high_quality_count"],
            a["foreign_error_word_count"] <= b["foreign_error_word_count"],
            a["missed_error_word_count"] <= b["missed_error_word_count"],
            a["total_foreign_human_word_pixels"] <= b["total_foreign_human_word_pixels"],
            a["total_missed_target_pixels"] <= b["total_missed_target_pixels"],
            a["empty_word_count"] <= b["empty_word_count"],
        )
        strict = (
            a["high_quality_count"] > b["high_quality_count"]
            or a["foreign_error_word_count"] < b["foreign_error_word_count"]
            or a["missed_error_word_count"] < b["missed_error_word_count"]
            or a["total_foreign_human_word_pixels"] < b["total_foreign_human_word_pixels"]
            or a["total_missed_target_pixels"] < b["total_missed_target_pixels"]
            or a["empty_word_count"] < b["empty_word_count"]
        )
        return all(comparisons) and strict

    return sorted(
        config["config_id"]
        for config in configurations
        if not any(
            other is not config and dominates(other, config)
            for other in configurations
        )
    )


def render_grid(configurations: list[dict[str, Any]], output: Path) -> None:
    by_id = {config["config_id"]: config for config in configurations}
    left, top, cell_w, cell_h = 255, 105, 170, 94
    width = left + len(MARGINS) * cell_w + 35
    height = top + len(WEIGHT_PROFILES) * cell_h + 55
    image = Image.new("RGB", (width, height), (250, 246, 237))
    draw = ImageDraw.Draw(image)
    draw.text((20, 18), "COMPONENT SCORE SWEEP — SEALED POST-FREEZE EVALUATION", fill=(38, 34, 29), font=font(25, bold=True))
    draw.text((20, 53), "cell: high-quality / foreign-error / missed-error words · darker green = more high-quality", fill=(76, 66, 56), font=font(15))
    for column, margin in enumerate(MARGINS):
        draw.text((left + column * cell_w + 12, 82), f"margin {margin:.2f}", fill=(55, 48, 42), font=font(14, bold=True))
    for row, profile in enumerate(WEIGHT_PROFILES):
        y = top + row * cell_h
        draw.text((18, y + 29), profile, fill=(55, 48, 42), font=font(16, bold=True))
        for column, margin in enumerate(MARGINS):
            config = by_id[f"{profile}--margin-{margin:.2f}"]
            summary = config["summary"]
            quality = int(summary["high_quality_count"])
            shade = int(245 - 110 * quality / 77)
            fill = (max(85, shade - 45), max(135, shade), max(95, shade - 30))
            x = left + column * cell_w
            draw.rounded_rectangle((x + 5, y + 7, x + cell_w - 8, y + cell_h - 8), radius=8, fill=fill, outline=(90, 90, 78), width=1)
            draw.text((x + 17, y + 17), f"HQ {quality:02d}/77", fill=(25, 38, 27), font=font(17, bold=True))
            draw.text((x + 17, y + 46), f"F {summary['foreign_error_word_count']:02d}  M {summary['missed_error_word_count']:02d}", fill=(35, 40, 35), font=font(15))
            draw.text((x + 17, y + 67), f"res {config['clean_residual_pixels']:,}", fill=(55, 55, 48), font=font(12))
    image.save(output, format="JPEG", quality=94, subsampling=0, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--score-record", type=Path, required=True)
    parser.add_argument("--reviewed-decision", type=Path, required=True)
    parser.add_argument("--transcript-localization", type=Path, required=True)
    parser.add_argument("--clean-mask", type=Path, required=True)
    parser.add_argument("--human-run", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    if args.output_dir.exists():
        raise SystemExit("Output exists; refusing overwrite")
    args.output_dir.mkdir(parents=True)

    clean = load_mask(args.clean_mask)
    labels, component_count = ndimage.label(clean, structure=np.ones((3, 3), dtype=np.uint8))
    scored = load_scored(args.score_record)
    if component_count != len(scored["components"]):
        raise RuntimeError("Frozen component record does not match Clean mask")
    units = reviewed_units(args.reviewed_decision)
    transcript = transcript_boxes(args.transcript_localization)
    for unit in units:
        key = (unit["line_order"], unit["word_order"])
        if key in transcript:
            unit["transcript_bbox_xywh"] = transcript[key]
    units = [unit for unit in units if "transcript_bbox_xywh" in unit]

    freeze_started = time.perf_counter()
    configurations = freeze_candidates(scored, clean, labels, units)
    frozen: dict[str, Any] = {
        "schema_version": "component-score-weight-sweep-frozen.v1",
        "evidence_role": "acting_candidates_only_no_human_data",
        "sealed_evaluation_loaded": False,
        "inputs": {
            "score_record": {"path": str(args.score_record), "file_sha256": sha256_file(args.score_record)},
            "reviewed_decision": {"path": str(args.reviewed_decision), "file_sha256": sha256_file(args.reviewed_decision)},
            "transcript_localization": {"path": str(args.transcript_localization), "file_sha256": sha256_file(args.transcript_localization)},
            "clean_mask": {"path": str(args.clean_mask), "file_sha256": sha256_file(args.clean_mask), "pixel_sha256": sha256_mask_pixels(clean), "pixels": int(clean.sum())},
        },
        "unit_ids": [unit["unit_id"] for unit in units],
        "candidate_freeze_wall_time_ms": round((time.perf_counter() - freeze_started) * 1000.0, 3),
        "configurations": configurations,
    }
    frozen["frozen_candidate_set_sha256"] = hashlib.sha256(canonical_json_bytes(frozen)).hexdigest()
    frozen_path = args.output_dir / "frozen-candidates.json"
    frozen_path.write_bytes(canonical_json_bytes(frozen) + b"\n")

    # The sealed completed page is opened only after the candidate file exists.
    human, ownership = load_human_partition(args.human_run)
    binding = bind_human_numbers(units, human, "transcript_bbox_xywh")
    evaluate(configurations, labels, human, ownership, binding)
    held_out = line_held_out(configurations)
    pareto = pareto_front(configurations)
    ranked = sorted(configurations, key=lambda config: (ranking_key(config["summary"]), config["config_id"]), reverse=True)
    render_grid(configurations, args.output_dir / "sealed-score-grid.jpg")

    record: dict[str, Any] = {
        "schema_version": "component-score-weight-sweep-experiment.v1",
        "evidence_role": "page_007_development_with_post_freeze_sealed_evaluation",
        "frozen_candidate_set": {
            "path": frozen_path.name,
            "file_sha256": sha256_file(frozen_path),
            "candidate_set_sha256": frozen["frozen_candidate_set_sha256"],
            "candidate_freeze_wall_time_ms": frozen["candidate_freeze_wall_time_ms"],
            "sealed_evaluation_loaded_after_file_written": True,
        },
        "sealed_human_run": {"path": str(args.human_run), "word_count": len(human)},
        "configuration_count": len(configurations),
        "ranked_configurations": [
            {
                "config_id": config["config_id"],
                "weight_profile": config["weight_profile"],
                "minimum_score_margin": config["minimum_score_margin"],
                "ambiguous_component_count": config["ambiguous_component_count"],
                "ambiguous_component_pixels": config["ambiguous_component_pixels"],
                "claimed_union_pixels": config["claimed_union_pixels"],
                "clean_residual_pixels": config["clean_residual_pixels"],
                "summary": config["summary"],
            }
            for config in ranked
        ],
        "pareto_config_ids": pareto,
        "line_held_out": held_out,
        "configurations": configurations,
        "board": {"path": "sealed-score-grid.jpg", "file_sha256": sha256_file(args.output_dir / "sealed-score-grid.jpg"), "evidence_role": "post_freeze_sealed_evaluation_only"},
        "metric_warning": "This is one development page. High-quality count jointly requires precision and recall, but no single rank proves production safety. Foreign capture, misses, abstention, residual, and line-held-out behavior must be read together.",
    }
    record["experiment_sha256"] = hashlib.sha256(canonical_json_bytes(record)).hexdigest()
    experiment_path = args.output_dir / "experiment.json"
    experiment_path.write_bytes(canonical_json_bytes(record) + b"\n")
    print(json.dumps({
        "output": str(args.output_dir),
        "frozen_candidate_set_sha256": frozen["frozen_candidate_set_sha256"],
        "experiment_sha256": record["experiment_sha256"],
        "pareto_config_ids": pareto,
        "top_five": record["ranked_configurations"][:5],
        "line_held_out": held_out["combined_held_out_summary"],
    }, indent=2))


if __name__ == "__main__":
    main()
