#!/usr/bin/env python3
"""Evaluation-only comparison of a frozen line batch to the hidden human run."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.optimize import linear_sum_assignment

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from word_envelope.io_utils import canonical_json_bytes, sha256_file  # noqa: E402
from word_envelope.simple_page_agent import _hash_record  # noqa: E402


def read_object(path: Path) -> dict:
    value = json.loads(path.read_text("utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} is not an object")
    return value


def load_mask(path: Path, size_wh: tuple[int, int]) -> np.ndarray:
    with Image.open(path) as image:
        if image.size != size_wh:
            raise ValueError(f"mask dimensions changed: {path}")
        return np.asarray(image.convert("L"), dtype=np.uint8) > 0


def ratio(numerator: int, denominator: int) -> float:
    return round(numerator / denominator, 6) if denominator else 0.0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--line-session", type=Path, required=True)
    parser.add_argument("--selector-dir", type=Path, required=True)
    parser.add_argument("--hidden-benchmark", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument(
        "--ownership-mode",
        choices=("components", "region_fill"),
        default="components",
    )
    args = parser.parse_args()

    line_root = args.line_session.resolve()
    selector = args.selector_dir.resolve()
    hidden_path = args.hidden_benchmark.resolve()
    output = args.output_dir.resolve()
    if output.exists() or output.is_symlink():
        raise ValueError("evaluation output already exists")
    hidden = read_object(hidden_path)
    manifest = read_object(selector / "manifest.json")
    layers = read_object(selector / "ink-layers.json")
    width, height = (int(value) for value in manifest["source"]["size_wh"])
    size_wh = (width, height)
    clean_path = selector / layers["layers"]["clean"]["mask_path"]
    clean = load_mask(clean_path, size_wh)
    clean_labels, _ = ndimage.label(
        clean, structure=np.ones((3, 3), dtype=np.uint8)
    )
    clean_labels = clean_labels.astype(np.int32, copy=False)

    agent_words: list[dict] = []
    component_claimants: dict[int, list[int]] = {}
    for line_dir in sorted(line_root.glob("line-[0-9][0-9][0-9]-*")):
        result_path = line_dir / "software-result-snap-v4.json"
        if not result_path.is_file():
            raise ValueError(f"missing frozen v4 result: {line_dir.name}")
        result = read_object(result_path)
        if result.get("result_sha256") != _hash_record(result, "result_sha256"):
            raise ValueError(f"result hash changed: {line_dir.name}")
        packet = read_object(line_dir / "packet.json")
        decision = read_object(line_dir / "decision.json")
        decision_by_order = {
            word["word_order"]: word for word in decision["visible_words"]
        }
        proposal_by_id = {
            proposal["proposal_id"]: proposal for proposal in packet["proposals"]
        }
        crop_x, crop_y, _, _ = packet["coordinate_space"]["source_crop_xywh"]
        preview_to_source = float(
            packet["coordinate_space"]["preview_to_source_scale"]
        )
        for word in result["words"]:
            index = len(agent_words)
            decision_word = decision_by_order[word["word_order"]]
            source_seed_points = [
                [
                    crop_x + round(point[0] * preview_to_source),
                    crop_y + round(point[1] * preview_to_source),
                ]
                for point in decision_word["seed_points_xy"]
            ]
            record = {
                "agent_word_id": f"{result['line_id']}:W{word['word_order']:02d}",
                "line_id": result["line_id"],
                "word_order": word["word_order"],
                "proposal_ids": word["proposal_ids"],
                "local_status": word["status"],
                "component_ids": word["component_ids"],
                "source_seed_points": source_seed_points,
                "source_seed_center_xy": [
                    round(sum(point[0] for point in source_seed_points) / len(source_seed_points)),
                    round(sum(point[1] for point in source_seed_points) / len(source_seed_points)),
                ],
                "cited_source_bboxes_xywh": [
                    proposal_by_id[proposal_id]["source_bbox_xywh"]
                    for proposal_id in word["proposal_ids"]
                ],
                "line_source_crop_xywh": packet["coordinate_space"]["source_crop_xywh"],
            }
            agent_words.append(record)
            if word["status"] == "candidate_ready":
                for component_id in word["component_ids"]:
                    component_claimants.setdefault(int(component_id), []).append(index)

    cross_line_component_ids = {
        component_id
        for component_id, claimants in component_claimants.items()
        if len(set(claimants)) > 1
    }
    safe_agent_indices: list[int] = []
    for index, word in enumerate(agent_words):
        collisions = sorted(set(word["component_ids"]) & cross_line_component_ids)
        word["cross_line_collision_component_ids"] = collisions
        word["page_status"] = (
            "cross_line_component_conflict"
            if collisions
            else word["local_status"]
        )
        if word["page_status"] == "candidate_ready":
            safe_agent_indices.append(index)

    agent_label_map = np.zeros((height, width), dtype=np.uint16)
    safe_agent_words: list[dict] = []
    if args.ownership_mode == "components":
        for output_label, agent_index in enumerate(safe_agent_indices, start=1):
            word = agent_words[agent_index]
            mask = np.isin(clean_labels, word["component_ids"])
            if np.any(agent_label_map[mask]):
                raise ValueError("safe agent ownership unexpectedly overlaps")
            agent_label_map[mask] = output_label
            word["selected_pixels"] = int(mask.sum())
            safe_agent_words.append(word)
    else:
        # A seed is a rough word center. Disposable boxes define its local
        # collection region; nearest-center ownership resolves overlapping boxes.
        # Uncited or materially misregistered words receive an ordered line cell.
        best_distance = np.full((height, width), np.inf, dtype=np.float32)
        line_groups: dict[str, list[dict]] = {}
        for word in agent_words:
            line_groups.setdefault(word["line_id"], []).append(word)
        dynamic_geometry: dict[str, tuple[np.ndarray, np.ndarray, float]] = {}
        for line_id, words in line_groups.items():
            words.sort(key=lambda value: value["word_order"])
            first = np.asarray(words[0]["source_seed_center_xy"], dtype=np.float64)
            last = np.asarray(words[-1]["source_seed_center_xy"], dtype=np.float64)
            axis = last - first
            norm = float(np.linalg.norm(axis))
            if norm < 1.0:
                axis = np.array([1.0, 0.0], dtype=np.float64)
            else:
                axis /= norm
            normal = np.array([-axis[1], axis[0]], dtype=np.float64)
            cited_heights = [
                bbox[3]
                for word in words
                for bbox in word["cited_source_bboxes_xywh"]
            ]
            half_band = max(55.0, float(np.median(cited_heights)) * 0.65 + 20.0) if cited_heights else 90.0
            dynamic_geometry[line_id] = (axis, normal, half_band)

        for output_label, word in enumerate(agent_words, start=1):
            center = np.asarray(word["source_seed_center_xy"], dtype=np.float64)
            cited = word["cited_source_bboxes_xywh"]
            use_cited = False
            if cited:
                union_x0 = min(bbox[0] for bbox in cited)
                union_y0 = min(bbox[1] for bbox in cited)
                union_x1 = max(bbox[0] + bbox[2] for bbox in cited)
                union_y1 = max(bbox[1] + bbox[3] for bbox in cited)
                use_cited = (
                    union_x0 - 40 <= center[0] <= union_x1 + 40
                    and union_y0 - 40 <= center[1] <= union_y1 + 40
                )
            if use_cited:
                box_width = union_x1 - union_x0
                box_height = union_y1 - union_y0
                pad_x = max(18, round(box_width * 0.12))
                pad_y = max(18, round(box_height * 0.25))
                x0 = max(0, union_x0 - pad_x)
                y0 = max(0, union_y0 - pad_y)
                x1 = min(width, union_x1 + pad_x)
                y1 = min(height, union_y1 + pad_y)
                yy, xx = np.ogrid[y0:y1, x0:x1]
                candidate = clean[y0:y1, x0:x1]
            else:
                words = line_groups[word["line_id"]]
                position = next(
                    index
                    for index, value in enumerate(words)
                    if value["agent_word_id"] == word["agent_word_id"]
                )
                axis, normal, half_band = dynamic_geometry[word["line_id"]]
                projections = [
                    float(np.dot(np.asarray(value["source_seed_center_xy"]) - center, axis))
                    for value in words
                ]
                left = (
                    (projections[position - 1] + projections[position]) / 2.0
                    if position > 0
                    else -max(90.0, abs(projections[position + 1]) / 2.0 + 35.0)
                    if len(words) > 1
                    else -140.0
                )
                right = (
                    (projections[position] + projections[position + 1]) / 2.0
                    if position + 1 < len(words)
                    else max(90.0, abs(projections[position - 1]) / 2.0 + 35.0)
                    if len(words) > 1
                    else 140.0
                )
                crop_x, crop_y, crop_width, crop_height = word["line_source_crop_xywh"]
                x0, y0 = crop_x, crop_y
                x1, y1 = crop_x + crop_width, crop_y + crop_height
                yy, xx = np.ogrid[y0:y1, x0:x1]
                dx = xx - center[0]
                dy = yy - center[1]
                along = dx * axis[0] + dy * axis[1]
                across = dx * normal[0] + dy * normal[1]
                candidate = (
                    clean[y0:y1, x0:x1]
                    & (along >= min(left, right))
                    & (along <= max(left, right))
                    & (np.abs(across) <= half_band)
                )
            distance = (xx - center[0]) ** 2 + (yy - center[1]) ** 2
            local_best = best_distance[y0:y1, x0:x1]
            replace = candidate & (distance < local_best)
            local_best[replace] = distance[replace]
            agent_label_map[y0:y1, x0:x1][replace] = output_label

        selected_counts = np.bincount(
            agent_label_map.ravel(), minlength=len(agent_words) + 1
        )
        for output_label, word in enumerate(agent_words, start=1):
            word["selected_pixels"] = int(selected_counts[output_label])
            word["page_status"] = (
                "region_fill_candidate" if selected_counts[output_label] else "region_fill_empty"
            )
            if selected_counts[output_label]:
                safe_agent_words.append(word)

    human_info = hidden["human_run"]
    human_root = ROOT / human_info["session_path"]
    human_state_path = human_root / f"revisions/r{int(human_info['revision']):06d}/state.json"
    human_state = read_object(human_state_path)
    if human_state["state_sha256"] != human_info["state_sha256"]:
        raise ValueError("hidden human state changed")
    claimed_path = human_root / f"revisions/r{int(human_info['revision']):06d}/claimed.mask.png"
    if sha256_file(claimed_path) != human_info["claimed_mask_file_sha256"]:
        raise ValueError("hidden human claimed mask changed")
    human_union = load_mask(claimed_path, size_wh)
    human_words = sorted(human_state["words"], key=lambda word: word["word_number"])
    intersections = np.zeros((len(human_words), len(safe_agent_words)), dtype=np.int64)
    human_pixels = np.zeros(len(human_words), dtype=np.int64)
    for human_index, human_word in enumerate(human_words):
        mask_path = human_root / human_word["selected_mask_path"]
        if sha256_file(mask_path) != human_word["selected_mask_file_sha256"]:
            raise ValueError(f"hidden human word changed: {human_word['word_number']}")
        x, y, mask_width, mask_height = human_word["selection_bbox_xywh"]
        with Image.open(mask_path) as image:
            if image.size != (mask_width, mask_height):
                raise ValueError(
                    f"hidden human word crop dimensions changed: {human_word['word_number']}"
                )
            mask = np.asarray(image.convert("L"), dtype=np.uint8) > 0
        human_pixels[human_index] = int(mask.sum())
        counts = np.bincount(
            agent_label_map[y : y + mask_height, x : x + mask_width][mask].ravel(),
            minlength=len(safe_agent_words) + 1,
        )
        intersections[human_index, :] = counts[1 : len(safe_agent_words) + 1]
    agent_pixels = np.array(
        [word["selected_pixels"] for word in safe_agent_words], dtype=np.int64
    )
    unions = human_pixels[:, None] + agent_pixels[None, :] - intersections
    ious = np.divide(
        intersections,
        unions,
        out=np.zeros_like(intersections, dtype=np.float64),
        where=unions > 0,
    )
    human_rows, agent_columns = linear_sum_assignment(-ious)
    matches: list[dict] = []
    for human_index, agent_index in zip(human_rows, agent_columns):
        intersection = int(intersections[human_index, agent_index])
        match = {
            "human_word_number": int(human_words[human_index]["word_number"]),
            "agent_word_id": safe_agent_words[agent_index]["agent_word_id"],
            "intersection_pixels": intersection,
            "human_pixels": int(human_pixels[human_index]),
            "agent_pixels": int(agent_pixels[agent_index]),
            "precision": ratio(intersection, int(agent_pixels[agent_index])),
            "recall": ratio(intersection, int(human_pixels[human_index])),
            "iou": ratio(intersection, int(unions[human_index, agent_index])),
        }
        matches.append(match)

    agent_union = agent_label_map > 0
    union_intersection = int(np.count_nonzero(agent_union & human_union))
    clean_human = human_union & clean
    clean_intersection = int(np.count_nonzero(agent_union & clean_human))
    matched_human = {match["human_word_number"] for match in matches if match["intersection_pixels"]}
    matched_agent = {match["agent_word_id"] for match in matches if match["intersection_pixels"]}
    strong_80 = [
        match for match in matches if match["precision"] >= 0.8 and match["recall"] >= 0.8
    ]
    strong_90 = [
        match for match in matches if match["precision"] >= 0.9 and match["recall"] >= 0.9
    ]
    report = {
        "schema_version": "line-batch-hidden-human-evaluation.v1",
        "epistemic_role": "post_freeze_evaluation_only_never_visible_to_acting_agent",
        "bindings": {
            "line_session_file_sha256": sha256_file(line_root / "session.json"),
            "hidden_benchmark_file_sha256": sha256_file(hidden_path),
            "human_state_sha256": human_state["state_sha256"],
            "clean_mask_file_sha256": sha256_file(clean_path),
        },
        "ownership_mode": args.ownership_mode,
        "counts": {
            "agent_visible_words": len(agent_words),
            "agent_local_candidate_ready": sum(
                word["local_status"] == "candidate_ready" for word in agent_words
            ),
            "agent_local_needs_review": sum(
                word["local_status"] != "candidate_ready" for word in agent_words
            ),
            "cross_line_collision_components": len(cross_line_component_ids),
            "cross_line_collision_words": sum(
                word["page_status"] == "cross_line_component_conflict"
                for word in agent_words
            ),
            "agent_page_safe_words": len(safe_agent_words),
            "human_words": len(human_words),
            "matched_with_any_intersection": sum(match["intersection_pixels"] > 0 for match in matches),
            "matched_precision_recall_80": len(strong_80),
            "matched_precision_recall_90": len(strong_90),
            "unmatched_human_words": len(human_words) - len(matched_human),
            "unmatched_safe_agent_words": len(safe_agent_words) - len(matched_agent),
        },
        "union": {
            "agent_pixels": int(agent_union.sum()),
            "human_pixels": int(human_union.sum()),
            "human_clean_supported_pixels": int(clean_human.sum()),
            "intersection_pixels": union_intersection,
            "agent_only_pixels": int(np.count_nonzero(agent_union & ~human_union)),
            "human_only_pixels": int(np.count_nonzero(human_union & ~agent_union)),
            "precision_vs_human": ratio(union_intersection, int(agent_union.sum())),
            "recall_vs_full_human": ratio(union_intersection, int(human_union.sum())),
            "recall_vs_clean_supported_human": ratio(
                clean_intersection, int(clean_human.sum())
            ),
            "iou": ratio(
                union_intersection,
                int(np.count_nonzero(agent_union | human_union)),
            ),
        },
        "agent_words": agent_words,
        "matches": sorted(matches, key=lambda match: match["human_word_number"]),
    }
    output.mkdir(parents=True)
    overlay = np.full((height, width, 3), 248, dtype=np.uint8)
    overlay[human_union & ~agent_union] = (52, 101, 164)
    overlay[agent_union & ~human_union] = (210, 47, 47)
    overlay[agent_union & human_union] = (34, 139, 84)
    overlay_path = output / "human-agent-overlap.png"
    Image.fromarray(overlay, mode="RGB").resize(
        (900, 1200), Image.Resampling.NEAREST
    ).save(overlay_path, format="PNG", optimize=True)
    report["evidence"] = {
        "overlap_path": overlay_path.name,
        "overlap_file_sha256": sha256_file(overlay_path),
        "legend": {
            "green": "agent_and_human",
            "red": "agent_only",
            "blue": "human_only",
        },
    }
    report["evaluation_sha256"] = _hash_record(report, "evaluation_sha256")
    (output / "evaluation.json").write_bytes(canonical_json_bytes(report) + b"\n")
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
