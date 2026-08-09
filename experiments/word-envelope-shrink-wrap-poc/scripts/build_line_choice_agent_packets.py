#!/usr/bin/env python3
"""Build acting-only line-choice and component-toggle packets."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from experiment_disjoint_component_ownership import bbox_from_mask, expand_bbox, load_mask, score_component_locators
from word_envelope.io_utils import canonical_json_bytes, sha256_file, sha256_mask_pixels


POLICIES = (
    "global_exclusive",
    "line_locator_strip",
    "line_midpoint_centroid",
    "line_valley_centroid",
)
LOCATORS = ("transcript_bbox_xywh", "reviewed_bbox_xywh")
GREEN = (16, 154, 83)
AMBER = (231, 153, 44)
CYAN = (0, 145, 170)
PURPLE = (155, 78, 176)
RED = (210, 54, 57)


def font(size: int, *, bold: bool = False) -> ImageFont.ImageFont:
    name = "Arial Bold.ttf" if bold else "Arial.ttf"
    try:
        return ImageFont.truetype(f"/System/Library/Fonts/Supplemental/{name}", size)
    except OSError:
        return ImageFont.load_default()


def tint(source: Image.Image, mask: np.ndarray, color: tuple[int, int, int], alpha: float) -> Image.Image:
    values = np.asarray(source).copy()
    overlay = np.asarray(color, dtype=np.float32)
    values[mask] = np.clip(values[mask] * (1.0 - alpha) + overlay * alpha, 0, 255).astype(np.uint8)
    return Image.fromarray(values, mode="RGB")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--frozen-candidates", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--packet-count", type=int, default=8)
    args = parser.parse_args()
    if args.output_dir.exists():
        raise SystemExit("Output exists; refusing overwrite")
    args.output_dir.mkdir(parents=True)

    frozen = json.loads(args.frozen_candidates.read_text(encoding="utf-8"))
    if frozen.get("evidence_role") != "acting_candidates_only_no_human_data":
        raise SystemExit("Input is not an acting-only frozen candidate record")
    root = args.frozen_candidates.resolve().parents[3]
    clean_path = (root / frozen["inputs"]["clean_mask"]["path"]).resolve()
    source_path = Path(frozen["inputs"]["source"]["path"]).resolve()
    centerline_path = (root / frozen["inputs"]["acting_centerlines"]["path"]).resolve()
    if sha256_file(clean_path) != frozen["inputs"]["clean_mask"]["file_sha256"]:
        raise RuntimeError("Clean mask hash mismatch")
    if sha256_file(source_path) != frozen["inputs"]["source"]["file_sha256"]:
        raise RuntimeError("Source hash mismatch")
    if sha256_file(centerline_path) != frozen["inputs"]["acting_centerlines"]["file_sha256"]:
        raise RuntimeError("Centerline hash mismatch")
    clean = load_mask(clean_path)
    source = Image.open(source_path).convert("RGB")
    centerlines = json.loads(centerline_path.read_text(encoding="utf-8"))["centerlines"]
    scored = score_component_locators(
        clean,
        [{"unit_id": "whole", "bbox_xywh": [0, 0, clean.shape[1], clean.shape[0]]}],
    )
    labels = scored["labels"]
    components = {int(row["component_id"]): row for row in scored["components"]}
    component_pixels = np.bincount(labels.ravel(), minlength=int(labels.max()) + 1)

    configs = [
        config
        for config in frozen["configurations"]
        if config["locator"] in LOCATORS and config["policy"] in POLICIES
    ]
    if len(configs) != 8:
        raise RuntimeError("Expected eight non-abstaining proposal configurations")
    by_unit: dict[str, list[dict[str, Any]]] = {}
    line_neighbors: dict[str, list[dict[str, Any]]] = {}
    for config in configs:
        for item in config["items"]:
            proposal = {
                **item,
                "proposal_id": f"{config['locator']}|{config['policy']}",
                "locator": config["locator"],
                "policy": config["policy"],
                "label": config["label"],
            }
            by_unit.setdefault(str(item["unit_id"]), []).append(proposal)
            if config["locator"] == "transcript_bbox_xywh" and config["policy"] == "global_exclusive":
                line_neighbors.setdefault(str(item["line_id"]), []).append(proposal)
    for values in line_neighbors.values():
        values.sort(key=lambda row: (int(row["word_order"]), row["unit_id"]))

    ranked: list[dict[str, Any]] = []
    for unit_id, proposals in by_unit.items():
        hashes = {row["selected_pixel_sha256"] for row in proposals}
        union = {component_id for row in proposals for component_id in row["selected_component_ids"]}
        intersection = set(union)
        for row in proposals:
            intersection &= set(row["selected_component_ids"])
        disputed = union - intersection
        disagreement_pixels = int(sum(component_pixels[value] for value in disputed))
        auto_values = {bool(row["acting_gate_auto_easy"]) for row in proposals}
        ranked.append(
            {
                "unit_id": unit_id,
                "line_id": proposals[0]["line_id"],
                "distinct_proposal_count": len(hashes),
                "disputed_component_count": len(disputed),
                "disagreement_pixels": disagreement_pixels,
                "acting_gate_disagrees": len(auto_values) > 1,
                "score": disagreement_pixels * max(1, len(hashes) - 1) + (25000 if len(auto_values) > 1 else 0),
            }
        )
    ranked.sort(key=lambda row: (-row["score"], -row["distinct_proposal_count"], row["unit_id"]))
    cases: list[dict[str, Any]] = []
    used_lines: set[str] = set()
    for row in ranked:
        if row["line_id"] in used_lines:
            continue
        cases.append(row)
        used_lines.add(row["line_id"])
        if len(cases) == args.packet_count:
            break
    if len(cases) < args.packet_count:
        for row in ranked:
            if row not in cases:
                cases.append(row)
                if len(cases) == args.packet_count:
                    break

    packets_root = args.output_dir / "packets"
    packets_root.mkdir()
    manifest_packets: list[dict[str, Any]] = []
    for index, case in enumerate(cases, 1):
        unit_id = case["unit_id"]
        proposals = by_unit[unit_id]
        packet_id = f"case-{index:02d}-{unit_id.lower()}"
        packet_dir = packets_root / packet_id
        packet_dir.mkdir()
        union_ids = sorted({component_id for row in proposals for component_id in row["selected_component_ids"]})
        union_mask = np.isin(labels, np.asarray(union_ids, dtype=labels.dtype))
        neighbor_rows = line_neighbors[str(proposals[0]["line_id"])]
        order = int(proposals[0]["word_order"])
        local_neighbors = [row for row in neighbor_rows if abs(int(row["word_order"]) - order) <= 1]
        crop_mask = union_mask.copy()
        for row in local_neighbors:
            x, y, width, height = row["proposal_bbox_xywh"]
            crop_mask[y : y + height, x : x + width] = True
        crop = expand_bbox(bbox_from_mask(crop_mask) or proposals[0]["proposal_bbox_xywh"], 0.22, source.size)
        x, y, width, height = crop

        context = source.crop((x, y, x + width, y + height))
        context_draw = ImageDraw.Draw(context)
        line = centerlines[str(proposals[0]["line_id"])]
        y0 = float(line["slope"]) * x + float(line["intercept"]) - y
        y1 = float(line["slope"]) * (x + width) + float(line["intercept"]) - y
        context_draw.line((0, y0, width, y1), fill=RED, width=2)
        locator_colors = {"transcript_bbox_xywh": CYAN, "reviewed_bbox_xywh": PURPLE}
        for locator in LOCATORS:
            row = next(value for value in proposals if value["locator"] == locator)
            bx, by, bw, bh = row["proposal_bbox_xywh"]
            context_draw.rectangle((bx - x, by - y, bx + bw - x, by + bh - y), outline=locator_colors[locator], width=3)
        for component_id in union_ids:
            bx, by, bw, bh = components[component_id]["bbox_xywh"]
            context_draw.rectangle((bx - x, by - y, bx + bw - x, by + bh - y), outline=AMBER, width=2)
            context_draw.text((bx - x + 2, by - y + 1), str(component_id), fill=(55, 38, 10), font=font(13, bold=True))
        context_path = packet_dir / "source-context.jpg"
        context.save(context_path, format="JPEG", quality=94, subsampling=0, optimize=True)

        cell_w, cell_h = 520, 300
        board = Image.new("RGB", (cell_w * 4, cell_h * 2), (250, 247, 239))
        board_draw = ImageDraw.Draw(board)
        ordered = sorted(proposals, key=lambda row: (LOCATORS.index(row["locator"]), POLICIES.index(row["policy"])))
        for position, row in enumerate(ordered):
            column, grid_row = position % 4, position // 4
            selected = np.isin(labels[y : y + height, x : x + width], np.asarray(row["selected_component_ids"], dtype=labels.dtype))
            tile = tint(source.crop((x, y, x + width, y + height)), selected, GREEN, 0.78)
            scale = min((cell_w - 12) / max(1, width), (cell_h - 70) / max(1, height))
            resized = tile.resize((max(1, round(width * scale)), max(1, round(height * scale))), Image.Resampling.LANCZOS)
            px = column * cell_w + 6
            py = grid_row * cell_h + 62
            board.paste(resized, (px, py))
            short_locator = "transcript" if row["locator"].startswith("transcript") else "reviewed/Kraken"
            board_draw.text((column * cell_w + 8, grid_row * cell_h + 7), short_locator, fill=(45, 40, 36), font=font(16, bold=True))
            board_draw.text((column * cell_w + 8, grid_row * cell_h + 28), row["label"], fill=(60, 54, 48), font=font(15))
            board_draw.text(
                (column * cell_w + 8, grid_row * cell_h + 46),
                f"components {row['selected_component_ids']}",
                fill=(75, 66, 58),
                font=font(11),
            )
        proposals_path = packet_dir / "proposal-grid.jpg"
        board.save(proposals_path, format="JPEG", quality=93, subsampling=0, optimize=True)

        distinct: dict[str, dict[str, Any]] = {}
        for row in proposals:
            digest = row["selected_pixel_sha256"]
            if digest not in distinct:
                distinct[digest] = {
                    "selected_pixel_sha256": digest,
                    "selected_component_ids": row["selected_component_ids"],
                    "selected_pixels": row["selected_pixels"],
                    "proposal_ids": [],
                    "fit_statuses": [],
                }
            distinct[digest]["proposal_ids"].append(row["proposal_id"])
            distinct[digest]["fit_statuses"].append(row["fit_status"])
        packet: dict[str, Any] = {
            "schema_version": "line-choice-agent-work-packet.v1",
            "evidence_role": "acting_only_source_clean_line_and_frozen_proposals",
            "packet_id": packet_id,
            "unit": {
                "unit_id": unit_id,
                "text": proposals[0]["text"],
                "line_id": proposals[0]["line_id"],
                "word_order": proposals[0]["word_order"],
            },
            "selection_reason": {
                "policy": "software_disagreement_only",
                **{key: case[key] for key in ("distinct_proposal_count", "disputed_component_count", "disagreement_pixels", "acting_gate_disagrees")},
            },
            "evidence": {
                "source_context": {
                    "path": str(context_path.relative_to(args.output_dir)),
                    "file_sha256": sha256_file(context_path),
                },
                "proposal_grid": {
                    "path": str(proposals_path.relative_to(args.output_dir)),
                    "file_sha256": sha256_file(proposals_path),
                },
            },
            "visual_legend": {
                "green": "component selected by that proposal",
                "amber_box_and_number": "toggleable component in the union of proposals",
                "cyan_box": "transcript rough locator",
                "purple_box": "reviewed/Kraken rough locator",
                "red_line": "fitted body centerline",
            },
            "neighbor_units": [
                {"unit_id": row["unit_id"], "text": row["text"], "word_order": row["word_order"]}
                for row in local_neighbors
            ],
            "toggleable_components": [
                {
                    "component_id": component_id,
                    "pixels": int(component_pixels[component_id]),
                    "bbox_xywh": components[component_id]["bbox_xywh"],
                }
                for component_id in union_ids
            ],
            "distinct_proposals": sorted(distinct.values(), key=lambda row: row["selected_pixel_sha256"]),
            "allowed_response": {
                "action": ["choose", "choose_and_toggle", "defer"],
                "chosen_selected_pixel_sha256": "required for choose or choose_and_toggle",
                "add_component_ids": "zero or more IDs from toggleable_components",
                "remove_component_ids": "zero or more IDs already present in the chosen proposal",
                "confidence": ["high", "medium", "low"],
                "note": "brief visible-evidence rationale",
            },
            "instructions": [
                "Select only the ink belonging to the named unit.",
                "Use the centerline for vertical context and component IDs for exact ownership edits.",
                "Do not claim a component merely because it increases recovered ink.",
                "Consider neighboring words and defer when a whole component cannot express the boundary.",
            ],
            "provenance": {
                "frozen_candidate_set_sha256": frozen["frozen_candidate_set_sha256"],
                "frozen_candidate_file_sha256": sha256_file(args.frozen_candidates),
                "clean_pixel_sha256": sha256_mask_pixels(clean),
            },
        }
        packet["packet_sha256"] = hashlib.sha256(canonical_json_bytes(packet)).hexdigest()
        packet_path = packet_dir / "work-packet.json"
        packet_path.write_bytes(canonical_json_bytes(packet) + b"\n")
        manifest_packets.append(
            {
                "packet_id": packet_id,
                "unit_id": unit_id,
                "work_packet_file_sha256": sha256_file(packet_path),
                "packet_sha256": packet["packet_sha256"],
            }
        )

    manifest: dict[str, Any] = {
        "schema_version": "line-choice-agent-packet-run.v1",
        "evidence_role": "acting_only_no_completed_page",
        "selection_policy": "rank frozen proposal disagreement, then diversify fitted lines",
        "frozen_candidates": {
            "path": str(args.frozen_candidates.resolve()),
            "file_sha256": sha256_file(args.frozen_candidates),
            "candidate_set_sha256": frozen["frozen_candidate_set_sha256"],
        },
        "packet_count": len(manifest_packets),
        "packets": manifest_packets,
    }
    manifest["manifest_sha256"] = hashlib.sha256(canonical_json_bytes(manifest)).hexdigest()
    manifest_path = args.output_dir / "run-manifest.json"
    manifest_path.write_bytes(canonical_json_bytes(manifest) + b"\n")
    print(json.dumps({"packet_count": len(manifest_packets), "units": [row["unit_id"] for row in manifest_packets]}, indent=2))
    print(f"manifest_sha256={manifest['manifest_sha256']}")
    print(f"file_sha256={sha256_file(manifest_path)}")


if __name__ == "__main__":
    main()
