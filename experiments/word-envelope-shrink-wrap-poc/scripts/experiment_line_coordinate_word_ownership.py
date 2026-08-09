#!/usr/bin/env python3
"""Compare line-coordinate word ownership techniques on frozen page-007 inputs."""

from __future__ import annotations

import argparse
import hashlib
import json
import time
from collections import Counter
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from experiment_disjoint_component_ownership import (
    bbox_from_mask,
    bind_human_numbers,
    candidate_item,
    evaluate_configurations,
    expand_bbox,
    load_human_partition,
    load_mask,
    reviewed_units,
    score_component_locators,
    transcript_boxes,
)
from word_envelope.component_assignment import exclusive_component_assignment
from word_envelope.io_utils import canonical_json_bytes, sha256_file, sha256_mask_pixels
from word_envelope.line_word_assignment import (
    assign_components_to_lines,
    assign_line_components_by_boundaries,
    build_line_frames,
    ink_valley_boundaries,
    locator_strip_assignment,
    midpoint_boundaries,
)


PAPER = (250, 246, 237)
INK = (42, 46, 52)
GREEN = (18, 145, 73)
RED = (202, 48, 49)
CYAN = (0, 135, 160)
MAGENTA = (178, 64, 153)
AMBER = (222, 143, 30)


def read(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def font(size: int, *, bold: bool = False) -> ImageFont.ImageFont:
    name = "Arial Bold.ttf" if bold else "Arial.ttf"
    try:
        return ImageFont.truetype(f"/System/Library/Fonts/Supplemental/{name}", size)
    except OSError:
        return ImageFont.load_default()


def ambiguity_by_unit(result: dict[str, Any], scored: dict[str, Any]) -> dict[str, list[int]]:
    values = {row["unit_id"]: [] for row in scored["locators"]}
    for receipt in result.get("ambiguous_components", []):
        component_id = int(receipt["component_id"])
        matches = scored["scores_by_component"].get(component_id, [])
        if matches:
            for match in matches:
                values[match["unit_id"]].append(component_id)
        else:
            winner = receipt.get("winner_unit_id")
            if winner in values:
                values[winner].append(component_id)
    return {key: sorted(set(items)) for key, items in values.items()}


def make_configuration(
    *,
    policy: str,
    label: str,
    locator_key: str,
    units: list[dict[str, Any]],
    scored: dict[str, Any],
    clean: np.ndarray,
    result: dict[str, Any],
    method_metadata: dict[str, Any],
) -> dict[str, Any]:
    by_unit = {unit["unit_id"]: unit for unit in units}
    ambiguous = ambiguity_by_unit(result, scored)
    started = time.perf_counter()
    items: list[dict[str, Any]] = []
    for unit_id in [unit["unit_id"] for unit in units]:
        item = candidate_item(
            by_unit[unit_id],
            locator_key,
            list(result["component_ids_by_unit"].get(unit_id, [])),
            scored,
            clean,
            ambiguity_ids=ambiguous.get(unit_id, []),
        )
        item.pop("_selected", None)
        items.append(item)
    return {
        "locator": locator_key,
        "policy": policy,
        "label": label,
        "method_metadata": method_metadata,
        "candidate_fit_wall_time_ms": round((time.perf_counter() - started) * 1000.0, 3),
        "items": items,
    }


def evaluate_reconstructed(
    configurations: list[dict[str, Any]],
    labels: np.ndarray,
    human: list[dict[str, Any]],
    ownership: np.ndarray,
    human_binding: dict[str, int],
    clean: np.ndarray,
) -> None:
    """Evaluate one reconstructed component mask at a time after candidate freeze."""

    human_by_number = {int(word["word_number"]): word for word in human}
    for config in configurations:
        claimed_union = np.zeros_like(clean)
        component_claimants: dict[int, list[str]] = {}
        evaluations: list[dict[str, Any]] = []
        for item in config["items"]:
            selected = np.isin(
                labels,
                np.asarray(item["selected_component_ids"], dtype=labels.dtype),
            )
            number = int(human_binding[item["unit_id"]])
            target = ownership == number
            true_positive = int(np.count_nonzero(selected & target))
            foreign = int(np.count_nonzero(selected & (ownership > 0) & ~target))
            unlabelled = int(np.count_nonzero(selected & (ownership == 0)))
            missed = int(np.count_nonzero(target & ~selected))
            precision = true_positive / max(1, true_positive + foreign + unlabelled)
            recall = true_positive / max(1, int(human_by_number[number]["pixels"]))
            f1 = 2 * precision * recall / max(1e-12, precision + recall)
            evaluation = {
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
            item["evaluation_human_word_number"] = number
            item["evaluation"] = evaluation
            evaluations.append(evaluation)
            claimed_union |= selected
            for component_id in item["selected_component_ids"]:
                component_claimants.setdefault(component_id, []).append(item["unit_id"])
        auto = [item for item in config["items"] if item["acting_gate_auto_easy"]]
        auto_quality = [item for item in auto if item["evaluation"]["evaluation_gate_high_quality"]]
        config["summary"] = {
            "unit_count": len(config["items"]),
            "nonempty_selection_count": sum(item["selected_pixels"] > 0 for item in config["items"]),
            "evaluation_high_quality_count": sum(value["evaluation_gate_high_quality"] for value in evaluations),
            "acting_auto_easy_count": len(auto),
            "acting_auto_easy_high_quality_count": len(auto_quality),
            "acting_gate_precision": round(len(auto_quality) / max(1, len(auto)), 6),
            "median_pixel_precision": round(float(np.median([value["precision"] for value in evaluations])), 6),
            "median_pixel_recall": round(float(np.median([value["recall"] for value in evaluations])), 6),
            "median_pixel_f1": round(float(np.median([value["f1"] for value in evaluations])), 6),
            "foreign_error_word_count": sum(value["precision"] < 0.97 for value in evaluations),
            "missed_error_word_count": sum(value["recall"] < 0.95 for value in evaluations),
            "total_foreign_human_word_pixels": sum(value["foreign_human_word_pixels"] for value in evaluations),
            "total_missed_target_pixels": sum(value["missed_target_pixels"] for value in evaluations),
            "duplicate_component_claim_count": sum(len(values) > 1 for values in component_claimants.values()),
            "claimed_union_pixels": int(claimed_union.sum()),
            "clean_residual_pixels": int(np.count_nonzero(clean & ~claimed_union)),
            "empty_or_abstained_units": [item["unit_id"] for item in config["items"] if item["selected_pixels"] == 0],
        }


def consensus_assignment(
    results: list[dict[str, Any]],
    unit_ids: list[str],
    *,
    votes_required: int,
) -> dict[str, Any]:
    owner_maps = [
        {
            component_id: unit_id
            for unit_id, component_ids in result["component_ids_by_unit"].items()
            for component_id in component_ids
        }
        for result in results
    ]
    all_components = sorted(set().union(*(set(value) for value in owner_maps)))
    by_unit = {unit_id: [] for unit_id in unit_ids}
    ambiguous: list[dict[str, Any]] = []
    receipts: list[dict[str, Any]] = []
    for component_id in all_components:
        votes = Counter(mapping[component_id] for mapping in owner_maps if component_id in mapping)
        winner, count = votes.most_common(1)[0]
        receipt = {
            "component_id": component_id,
            "winner_unit_id": winner,
            "winner_votes": count,
            "votes": dict(sorted(votes.items())),
            "votes_required": votes_required,
        }
        if count < votes_required or list(votes.values()).count(count) > 1:
            ambiguous.append(receipt)
            continue
        by_unit[winner].append(component_id)
        receipts.append(receipt)
    for values in by_unit.values():
        values.sort()
    return {
        "component_ids_by_unit": by_unit,
        "ambiguous_components": ambiguous,
        "assignment_receipts": receipts,
        "policy": {"global_disjointness": True, "votes_required": votes_required, "source_count": len(results)},
    }


def freeze_locator_family(
    units: list[dict[str, Any]],
    locator_key: str,
    clean: np.ndarray,
    centerlines: dict[str, Any],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    locators = [{"unit_id": unit["unit_id"], "bbox_xywh": unit[locator_key]} for unit in units]
    scored = score_component_locators(clean, locators)
    frame_units = [
        {
            "unit_id": unit["unit_id"],
            "line_id": unit["line_id"],
            "word_order": unit["word_order"],
            "bbox_xywh": unit[locator_key],
        }
        for unit in units
    ]
    framed = build_line_frames(scored["components"], frame_units, centerlines)
    line_assignment = assign_components_to_lines(
        framed,
        maximum_spacing_fraction=0.58,
        minimum_normalized_margin=0.05,
        x_padding_px=120.0,
    )
    midpoint_by_line = {
        line_id: midpoint_boundaries(frame)
        for line_id, frame in framed["frames"].items()
    }
    valley_by_line = {
        line_id: ink_valley_boundaries(
            clean,
            frame,
            midpoint_by_line[line_id],
            band_half_height_px=max(58.0, min(78.0, float(frame["scale_px"]) * 3.5)),
            search_fraction=0.34,
            smoothing_radius_px=9,
            midpoint_bias=0.08,
        )
        for line_id, frame in framed["frames"].items()
    }

    exclusive = exclusive_component_assignment(scored, minimum_score=0.12, minimum_score_margin=0.08)
    strip = locator_strip_assignment(framed, line_assignment, minimum_score_margin=0.08)
    midpoint_centroid = assign_line_components_by_boundaries(
        framed,
        line_assignment,
        midpoint_by_line,
        abstain_on_boundary_crossing=False,
    )
    midpoint_abstain = assign_line_components_by_boundaries(
        framed,
        line_assignment,
        midpoint_by_line,
        abstain_on_boundary_crossing=True,
        minimum_boundary_clearance_px=2.0,
    )
    valley_centroid = assign_line_components_by_boundaries(
        framed,
        line_assignment,
        valley_by_line,
        abstain_on_boundary_crossing=False,
    )
    valley_abstain = assign_line_components_by_boundaries(
        framed,
        line_assignment,
        valley_by_line,
        abstain_on_boundary_crossing=True,
        minimum_boundary_clearance_px=2.0,
    )
    majority = consensus_assignment(
        [exclusive, strip, midpoint_centroid, valley_centroid],
        [unit["unit_id"] for unit in units],
        votes_required=3,
    )
    unanimous = consensus_assignment(
        [exclusive, strip, midpoint_centroid, valley_centroid],
        [unit["unit_id"] for unit in units],
        votes_required=4,
    )
    methods = [
        ("global_exclusive", "2-D global exclusive", exclusive),
        ("line_locator_strip", "line + rough span", strip),
        ("line_midpoint_centroid", "line + midpoint cuts", midpoint_centroid),
        ("line_midpoint_boundary_abstain", "midpoint + crossing abstain", midpoint_abstain),
        ("line_valley_centroid", "line + ink-valley cuts", valley_centroid),
        ("line_valley_boundary_abstain", "valley + crossing abstain", valley_abstain),
        ("line_majority_3_of_4", "3-of-4 line consensus", majority),
        ("line_unanimous_4_of_4", "4-of-4 line consensus", unanimous),
    ]
    configurations = [
        make_configuration(
            policy=policy,
            label=label,
            locator_key=locator_key,
            units=units,
            scored=scored,
            clean=clean,
            result=result,
            method_metadata=result.get("policy", {}),
        )
        for policy, label, result in methods
    ]
    record = {
        "locator": locator_key,
        "line_assignment": line_assignment,
        "frames": framed["frames"],
        "midpoint_boundaries": midpoint_by_line,
        "valley_boundaries": valley_by_line,
        "component_count": len(scored["components"]),
        "line_owned_component_count": sum(len(values) for values in line_assignment["component_ids_by_line"].values()),
        "line_ambiguous_component_count": len(line_assignment["ambiguous_components"]),
        "line_unsupported_component_count": len(line_assignment["unsupported_component_ids"]),
    }
    return configurations, {"record": record, "scored": scored}


def choose_acting_cases(configurations: list[dict[str, Any]], count: int = 8) -> list[str]:
    configs = [
        config for config in configurations
        if config["locator"] == "transcript_bbox_xywh"
        and config["policy"] in {
            "global_exclusive",
            "line_locator_strip",
            "line_midpoint_centroid",
            "line_valley_centroid",
        }
    ]
    unit_ids = [item["unit_id"] for item in configs[0]["items"]]
    scored: list[tuple[int, int, str]] = []
    for unit_id in unit_ids:
        items = [next(item for item in config["items"] if item["unit_id"] == unit_id) for config in configs]
        distinct = len({item["selected_pixel_sha256"] for item in items})
        ambiguity = sum(bool(item["ambiguous_touched_component_ids"]) for item in items)
        scored.append((distinct, ambiguity, unit_id))
    scored.sort(key=lambda value: (-value[0], -value[1], value[2]))
    return [value[2] for value in scored[:count]]


def panel(values: np.ndarray, width: int, height: int) -> Image.Image:
    image = Image.fromarray(values, mode="RGB")
    image.thumbnail((width, height), Image.Resampling.LANCZOS)
    output = Image.new("RGB", (width, height), PAPER)
    output.paste(image, ((width - image.width) // 2, (height - image.height) // 2))
    return output


def render_acting_board(
    clean: np.ndarray,
    configurations: list[dict[str, Any]],
    cases: list[str],
    centerlines: dict[str, Any],
    path: Path,
) -> None:
    policy_order = [
        "global_exclusive",
        "line_locator_strip",
        "line_midpoint_centroid",
        "line_valley_centroid",
    ]
    configs = {
        config["policy"]: config for config in configurations
        if config["locator"] == "transcript_bbox_xywh" and config["policy"] in policy_order
    }
    labels = score_component_locators(clean, [{"unit_id": "whole", "bbox_xywh": [0, 0, clean.shape[1], clean.shape[0]]}])["labels"]
    cell_w, cell_h, header = 360, 250, 105
    image = Image.new("RGB", (cell_w * 4 + 30, header + len(cases) * cell_h), PAPER)
    draw = ImageDraw.Draw(image)
    draw.text((16, 14), "LINE-COORDINATE WORD OWNERSHIP — ACTING-VISIBLE COMPARISON", fill=(38, 34, 29), font=font(25, bold=True))
    draw.text((16, 50), "green = selected Clean components · cyan = rough locator · red = fitted line · cases chosen only by software disagreement", fill=(72, 62, 53), font=font(14))
    for column, policy in enumerate(policy_order):
        draw.text((16 + column * cell_w, 78), configs[policy]["label"], fill=(45, 40, 35), font=font(15, bold=True))
    for row, unit_id in enumerate(cases):
        items = [next(item for item in configs[policy]["items"] if item["unit_id"] == unit_id) for policy in policy_order]
        union = np.zeros_like(clean)
        for item in items:
            union |= np.isin(labels, np.asarray(item["selected_component_ids"], dtype=labels.dtype))
        crop = expand_bbox(bbox_from_mask(union) or items[0]["proposal_bbox_xywh"], 0.20, (clean.shape[1], clean.shape[0]))
        x, y, width, height = crop
        for column, item in enumerate(items):
            selected = np.isin(labels, np.asarray(item["selected_component_ids"], dtype=labels.dtype))
            values = np.full((height, width, 3), PAPER, dtype=np.uint8)
            values[clean[y:y+height, x:x+width]] = INK
            values[selected[y:y+height, x:x+width]] = GREEN
            tile = panel(values, cell_w - 26, cell_h - 64)
            px, py = 13 + column * cell_w, header + row * cell_h + 50
            image.paste(tile, (px, py))
            locator = item["proposal_bbox_xywh"]
            scale_x, scale_y = tile.width / max(1, width), tile.height / max(1, height)
            # Locator/line marks are drawn approximately on the fixed tile; exact
            # coordinates remain in frozen JSON.
            lx0 = px + max(0, locator[0] - x) * scale_x
            ly0 = py + max(0, locator[1] - y) * scale_y
            lx1 = px + min(width, locator[0] + locator[2] - x) * scale_x
            ly1 = py + min(height, locator[1] + locator[3] - y) * scale_y
            draw.rectangle((lx0, ly0, lx1, ly1), outline=CYAN, width=2)
            line = centerlines[item["line_id"]]
            line_y0 = float(line["slope"]) * x + float(line["intercept"])
            line_y1 = float(line["slope"]) * (x + width) + float(line["intercept"])
            draw.line((px, py + (line_y0-y)*scale_y, px+tile.width, py+(line_y1-y)*scale_y), fill=RED, width=2)
            draw.text((px + 2, header + row * cell_h + 8), f"{unit_id} {item['text']!r}", fill=(40, 35, 30), font=font(15, bold=True))
            draw.text((px + 2, header + row * cell_h + 29), f"components {item['selected_component_count']} · fit {item['fit_status']}", fill=(70, 62, 54), font=font(12))
    image.save(path, format="JPEG", quality=93, subsampling=0, optimize=True)


def render_sealed_board(
    source: Image.Image,
    clean: np.ndarray,
    configurations: list[dict[str, Any]],
    cases: list[str],
    ownership: np.ndarray,
    labels: np.ndarray,
    path: Path,
) -> None:
    policy_order = ["global_exclusive", "line_locator_strip", "line_midpoint_centroid", "line_valley_centroid"]
    configs = {
        config["policy"]: config for config in configurations
        if config["locator"] == "transcript_bbox_xywh" and config["policy"] in policy_order
    }
    cell_w, cell_h, header = 360, 245, 105
    image = Image.new("RGB", (cell_w * 4 + 30, header + len(cases) * cell_h), PAPER)
    draw = ImageDraw.Draw(image)
    draw.text((16, 14), "LINE-COORDINATE WORD OWNERSHIP — SEALED POST-FREEZE", fill=(38, 34, 29), font=font(25, bold=True))
    draw.text((16, 50), "green = target selected · red = foreign selected · magenta = target missed", fill=(72, 62, 53), font=font(14))
    for column, policy in enumerate(policy_order):
        draw.text((16 + column * cell_w, 78), configs[policy]["label"], fill=(45, 40, 35), font=font(15, bold=True))
    source_values = np.asarray(source, dtype=np.uint8)
    for row, unit_id in enumerate(cases):
        items = [next(item for item in configs[policy]["items"] if item["unit_id"] == unit_id) for policy in policy_order]
        target = ownership == int(items[0]["evaluation_human_word_number"])
        union = target.copy()
        for item in items:
            union |= np.isin(labels, np.asarray(item["selected_component_ids"], dtype=labels.dtype))
        crop = expand_bbox(bbox_from_mask(union) or items[0]["proposal_bbox_xywh"], 0.18, source.size)
        x, y, width, height = crop
        for column, item in enumerate(items):
            selected = np.isin(labels, np.asarray(item["selected_component_ids"], dtype=labels.dtype))
            values = source_values[y:y+height, x:x+width].copy()
            local_target = target[y:y+height, x:x+width]
            local_selected = selected[y:y+height, x:x+width]
            values[local_target & local_selected] = GREEN
            values[local_selected & ~local_target] = RED
            values[local_target & ~local_selected] = MAGENTA
            tile = panel(values, cell_w - 26, cell_h - 62)
            px, py = 13 + column * cell_w, header + row * cell_h + 48
            image.paste(tile, (px, py))
            evaluation = item["evaluation"]
            draw.text((px + 2, header + row * cell_h + 8), f"{unit_id} {item['text']!r}", fill=(40, 35, 30), font=font(15, bold=True))
            draw.text((px + 2, header + row * cell_h + 28), f"P {evaluation['precision']:.3f} · R {evaluation['recall']:.3f} · fit {item['fit_status']}", fill=(70, 62, 54), font=font(12))
    image.save(path, format="JPEG", quality=93, subsampling=0, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reviewed-decision", type=Path, required=True)
    parser.add_argument("--transcript-localization", type=Path, required=True)
    parser.add_argument("--clean-mask", type=Path, required=True)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--acting-centerlines", type=Path, required=True)
    parser.add_argument("--human-run", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    if args.output_dir.exists():
        raise SystemExit("Output exists; refusing overwrite")
    args.output_dir.mkdir(parents=True)

    clean = load_mask(args.clean_mask)
    source = Image.open(args.source).convert("RGB")
    if clean.shape != (source.height, source.width):
        raise RuntimeError("Clean mask and source dimensions differ")
    centerline_record = read(args.acting_centerlines)
    centerlines = centerline_record["centerlines"]
    units = reviewed_units(args.reviewed_decision)
    transcript = transcript_boxes(args.transcript_localization)
    for unit in units:
        key = (unit["line_order"], unit["word_order"])
        if key in transcript:
            unit["transcript_bbox_xywh"] = transcript[key]
    units = [unit for unit in units if "transcript_bbox_xywh" in unit and unit["line_id"] in centerlines]

    freeze_started = time.perf_counter()
    configurations: list[dict[str, Any]] = []
    acting_records: list[dict[str, Any]] = []
    scored_by_locator: dict[str, dict[str, Any]] = {}
    for locator_key in ("reviewed_bbox_xywh", "transcript_bbox_xywh"):
        configs, bundle = freeze_locator_family(units, locator_key, clean, centerlines)
        configurations.extend(configs)
        acting_records.append(bundle["record"])
        scored_by_locator[locator_key] = bundle["scored"]
    cases = choose_acting_cases(configurations)
    acting_board = args.output_dir / "acting-line-technique-comparison.jpg"
    render_acting_board(clean, configurations, cases, centerlines, acting_board)
    acting_record: dict[str, Any] = {
        "schema_version": "line-coordinate-word-ownership-acting.v1",
        "evidence_role": "acting_candidates_only_no_human_data",
        "inputs": {
            "reviewed_decision": {"path": str(args.reviewed_decision), "file_sha256": sha256_file(args.reviewed_decision)},
            "transcript_localization": {"path": str(args.transcript_localization), "file_sha256": sha256_file(args.transcript_localization)},
            "clean_mask": {"path": str(args.clean_mask), "file_sha256": sha256_file(args.clean_mask), "pixel_sha256": sha256_mask_pixels(clean), "pixels": int(clean.sum())},
            "source": {"path": str(args.source), "file_sha256": sha256_file(args.source)},
            "acting_centerlines": {"path": str(args.acting_centerlines), "file_sha256": sha256_file(args.acting_centerlines), "record_sha256": centerline_record.get("centerline_record_sha256")},
        },
        "unit_ids": [unit["unit_id"] for unit in units],
        "acting_case_unit_ids": cases,
        "acting_board": {"path": acting_board.name, "file_sha256": sha256_file(acting_board)},
        "line_coordinate_records": acting_records,
        "candidate_freeze_wall_time_ms": round((time.perf_counter() - freeze_started) * 1000.0, 3),
        "configurations": [
            {**{key: value for key, value in config.items() if key != "items"}, "items": list(config["items"])}
            for config in configurations
        ],
    }
    acting_record["frozen_candidate_set_sha256"] = hashlib.sha256(canonical_json_bytes(acting_record)).hexdigest()
    acting_path = args.output_dir / "frozen-acting-candidates.json"
    acting_path.write_bytes(canonical_json_bytes(acting_record) + b"\n")

    # Sealed evaluation begins only after every candidate, fit, case choice, and
    # acting board has been frozen to disk.
    human, ownership = load_human_partition(args.human_run)
    for locator_key in ("reviewed_bbox_xywh", "transcript_bbox_xywh"):
        binding = bind_human_numbers(units, human, locator_key)
        evaluate_reconstructed(
            [config for config in configurations if config["locator"] == locator_key],
            scored_by_locator[locator_key]["labels"],
            human,
            ownership,
            binding,
            clean,
        )
    for config in configurations:
        config["summary"]["fit_pass_count"] = sum(item["fit_status"] == "pass" for item in config["items"])
        config["summary"]["fit_rejected_count"] = sum(item["fit_status"] == "rejected" for item in config["items"])
        config["summary"]["fit_empty_count"] = sum(item["fit_status"] == "not_run_empty" for item in config["items"])
        fit_times = sorted(float(item["fit_wall_time_ms"]) for item in config["items"] if item.get("fit_wall_time_ms") is not None)
        config["summary"]["median_fit_wall_time_ms"] = round(fit_times[len(fit_times)//2], 3) if fit_times else None
    sealed_board = args.output_dir / "sealed-line-technique-comparison.jpg"
    render_sealed_board(source, clean, configurations, cases, ownership, scored_by_locator["transcript_bbox_xywh"]["labels"], sealed_board)
    record: dict[str, Any] = {
        "schema_version": "line-coordinate-word-ownership-experiment.v1",
        "evidence_role": "page_007_development_with_post_freeze_sealed_evaluation",
        "frozen_acting_candidates": {"path": acting_path.name, "file_sha256": sha256_file(acting_path), "candidate_set_sha256": acting_record["frozen_candidate_set_sha256"], "candidate_freeze_wall_time_ms": acting_record["candidate_freeze_wall_time_ms"], "sealed_evaluation_loaded_after_file_written": True},
        "acting_board": {"path": acting_board.name, "file_sha256": sha256_file(acting_board), "evidence_role": "acting_visible_no_human_data"},
        "sealed_board": {"path": sealed_board.name, "file_sha256": sha256_file(sealed_board), "evidence_role": "post_freeze_sealed_evaluation_only"},
        "acting_case_unit_ids": cases,
        "configurations": configurations,
        "metric_warning": "A line coordinate frame can simplify localization but can also force residual or neighboring ink into an ordered word interval. Read foreign capture, missed target, abstention, fitted geometry, and final residual together; fitted envelopes do not certify semantic ownership.",
    }
    record["experiment_sha256"] = hashlib.sha256(canonical_json_bytes(record)).hexdigest()
    experiment_path = args.output_dir / "experiment.json"
    experiment_path.write_bytes(canonical_json_bytes(record) + b"\n")
    print(json.dumps({
        "output": str(args.output_dir),
        "experiment_sha256": record["experiment_sha256"],
        "frozen_candidate_set_sha256": acting_record["frozen_candidate_set_sha256"],
        "acting_cases": cases,
        "summaries": [{"locator": config["locator"], "policy": config["policy"], **config["summary"]} for config in configurations],
    }, indent=2))


if __name__ == "__main__":
    main()
