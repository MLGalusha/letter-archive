#!/usr/bin/env python3
"""Compare transcript-assisted and transcript-blind inventories without choosing a winner."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_hash(value: object) -> str:
    return hashlib.sha256(
        json.dumps(
            value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
    ).hexdigest()


def iou(left: list[int], right: list[int]) -> float:
    lx, ly, lw, lh = left
    rx, ry, rw, rh = right
    ix0, iy0 = max(lx, rx), max(ly, ry)
    ix1, iy1 = min(lx + lw, rx + rw), min(ly + lh, ry + rh)
    intersection = max(0, ix1 - ix0) * max(0, iy1 - iy0)
    union = lw * lh + rw * rh - intersection
    return 0.0 if union == 0 else intersection / union


def proposal_owner_map(line: dict[str, Any]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for unit in line["visible_units"]:
        for proposal_id in unit["source_proposal_ids"]:
            result[proposal_id] = {
                "kind": "visible_unit",
                "unit_id": unit["unit_id"],
                "proposal_group": sorted(unit["source_proposal_ids"]),
                "bbox_source_xywh": unit["bbox_source_xywh"],
                "action": unit["proposal_action"],
            }
    for dropped in line["dropped_proposals"]:
        result[dropped["proposal_id"]] = {
            "kind": "dropped",
            "disposition": dropped["disposition"],
        }
    return result


def added_units(line: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {
            "unit_id": unit["unit_id"],
            "reading_order": unit["reading_order"],
            "bbox_source_xywh": unit["bbox_source_xywh"],
            "kind": unit.get("unit_kind", unit.get("visual_kind")),
        }
        for unit in line["visible_units"]
        if not unit["source_proposal_ids"]
    ]


def compare(assisted_path: Path, blind_path: Path) -> dict[str, Any]:
    assisted = json.loads(assisted_path.read_text())
    blind = json.loads(blind_path.read_text())
    if assisted["page_id"] != blind["page_id"]:
        raise RuntimeError("page mismatch")
    if assisted["source_sha256"] != blind["source_sha256"]:
        raise RuntimeError("source mismatch")
    assisted_lines = assisted["lines"]
    blind_lines = blind["lines"]
    if [line["line_id"] for line in assisted_lines] != [
        line["line_id"] for line in blind_lines
    ]:
        raise RuntimeError("line cursor mismatch")

    comparisons: list[dict[str, Any]] = []
    disagreement_lines: list[str] = []
    for assisted_line, blind_line in zip(
        assisted_lines, blind_lines, strict=True
    ):
        reasons: list[str] = []
        assisted_units = assisted_line["visible_units"]
        blind_units = blind_line["visible_units"]
        if len(assisted_units) != len(blind_units):
            reasons.append("visible_unit_count")
        if (
            assisted_line["directed_reading"] != blind_line["directed_reading"]
            or abs(
                assisted_line["upright_rotation_degrees"]
                - blind_line["upright_rotation_degrees"]
            )
            > 2.0
        ):
            reasons.append("directed_registration")

        assisted_map = proposal_owner_map(assisted_line)
        blind_map = proposal_owner_map(blind_line)
        if set(assisted_map) != set(blind_map):
            raise RuntimeError(
                f"proposal accounting domains differ in {assisted_line['line_id']}"
            )
        proposal_disagreements = []
        for proposal_id in sorted(assisted_map):
            left = assisted_map[proposal_id]
            right = blind_map[proposal_id]
            mismatch: list[str] = []
            overlap = None
            if left["kind"] != right["kind"]:
                mismatch.append("claimed_vs_dropped")
            elif left["kind"] == "dropped":
                if left["disposition"] != right["disposition"]:
                    mismatch.append("drop_disposition")
            else:
                if left["proposal_group"] != right["proposal_group"]:
                    mismatch.append("merge_split_partition")
                overlap = iou(
                    left["bbox_source_xywh"], right["bbox_source_xywh"]
                )
                if overlap < 0.7:
                    mismatch.append("material_bbox")
            if mismatch:
                proposal_disagreements.append(
                    {
                        "proposal_id": proposal_id,
                        "reasons": mismatch,
                        "assisted": left,
                        "blind": right,
                        "bbox_iou": None if overlap is None else round(overlap, 6),
                    }
                )
        if proposal_disagreements:
            reasons.append("proposal_partition_or_geometry")

        assisted_added = added_units(assisted_line)
        blind_added = added_units(blind_line)
        if len(assisted_added) != len(blind_added):
            reasons.append("added_visible_unit_count")
        elif assisted_added or blind_added:
            unused = set(range(len(blind_added)))
            for left in assisted_added:
                matches = [
                    (iou(left["bbox_source_xywh"], blind_added[index]["bbox_source_xywh"]), index)
                    for index in unused
                ]
                if not matches:
                    reasons.append("added_visible_unit_geometry")
                    break
                best_overlap, best_index = max(matches)
                unused.remove(best_index)
                if best_overlap < 0.5:
                    reasons.append("added_visible_unit_geometry")
                    break

        reasons = sorted(set(reasons))
        line_id = assisted_line["line_id"]
        if reasons:
            disagreement_lines.append(line_id)
        comparisons.append(
            {
                "line_id": line_id,
                "assisted_visible_unit_count": len(assisted_units),
                "blind_visible_unit_count": len(blind_units),
                "assisted_added_units": assisted_added,
                "blind_added_units": blind_added,
                "proposal_disagreements": proposal_disagreements,
                "disagreement_reasons": reasons,
                "potential_transcript_anchoring": bool(reasons),
                "route": "sol_adjudication" if reasons else "no_inventory_disagreement",
            }
        )

    result: dict[str, Any] = {
        "schema_version": "assisted-blind-inventory-comparison.v2",
        "trial_id": "full-page-supervisor-trial-v2",
        "page_id": assisted["page_id"],
        "source_sha256": assisted["source_sha256"],
        "assisted_decision_file_sha256": sha256_file(assisted_path),
        "blind_decision_file_sha256": sha256_file(blind_path),
        "comparison_policy": {
            "winner_selected": False,
            "semantic_ground_truth_claimed": False,
            "bbox_material_iou_threshold": 0.7,
            "added_unit_match_iou_threshold": 0.5,
            "disagreement_route": "sol_adjudication",
        },
        "line_count": len(comparisons),
        "disagreement_line_count": len(disagreement_lines),
        "disagreement_lines": disagreement_lines,
        "lines": comparisons,
    }
    result["comparison_sha256"] = canonical_hash(result)
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--assisted", type=Path, required=True)
    parser.add_argument("--blind", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = compare(args.assisted, args.blind)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({
        "page_id": result["page_id"],
        "line_count": result["line_count"],
        "disagreement_line_count": result["disagreement_line_count"],
        "disagreement_lines": result["disagreement_lines"],
        "comparison_sha256": result["comparison_sha256"],
    }, indent=2))


if __name__ == "__main__":
    main()
