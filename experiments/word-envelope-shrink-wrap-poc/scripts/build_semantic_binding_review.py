#!/usr/bin/env python3
"""Build sealed evaluator boards and a many-to-many semantic binding template."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from experiment_disjoint_component_ownership import expand_bbox, load_human_partition
from word_envelope.io_utils import canonical_json_bytes, sha256_file


PALETTE = (
    (225, 62, 62),
    (25, 146, 92),
    (42, 116, 210),
    (181, 82, 190),
    (231, 151, 37),
    (0, 156, 165),
)
CYAN = (0, 120, 160)


def font(size: int, *, bold: bool = False) -> ImageFont.ImageFont:
    name = "Arial Bold.ttf" if bold else "Arial.ttf"
    try:
        return ImageFont.truetype(f"/System/Library/Fonts/Supplemental/{name}", size)
    except OSError:
        return ImageFont.load_default()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--experiment", type=Path, required=True)
    parser.add_argument("--human-run", type=Path, required=True)
    parser.add_argument("--centerlines", type=Path, required=True)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    if args.output_dir.exists():
        raise SystemExit("Output exists; refusing overwrite")
    args.output_dir.mkdir(parents=True)

    experiment = json.loads(args.experiment.read_text(encoding="utf-8"))
    centerline_record = json.loads(args.centerlines.read_text(encoding="utf-8"))
    centerlines = centerline_record["centerlines"]
    source = Image.open(args.source).convert("RGB")
    human, ownership = load_human_partition(args.human_run)
    human_by_number = {int(word["word_number"]): word for word in human}
    baseline = next(
        config
        for config in experiment["configurations"]
        if config["locator"] == "transcript_bbox_xywh" and config["policy"] == "global_exclusive"
    )
    units = sorted(
        baseline["items"],
        key=lambda item: (int(item["line_order"]), int(item["word_order"]), item["unit_id"]),
    )
    body_numbers = list(range(23, 100))
    body_words = [human_by_number[number] for number in body_numbers]
    line_ids = sorted({str(unit["line_id"]) for unit in units})

    line_spacings: dict[str, float] = {}
    for line_id in line_ids:
        line = centerlines[line_id]
        x_mid = 1500.0
        y_value = float(line["slope"]) * x_mid + float(line["intercept"])
        line_spacings[line_id] = min(
            abs(y_value - (float(other["slope"]) * x_mid + float(other["intercept"])))
            for other_id, other in centerlines.items()
            if other_id in line_ids and other_id != line_id
        )

    line_records: list[dict[str, Any]] = []
    for line_id in line_ids:
        line_units = [unit for unit in units if unit["line_id"] == line_id]
        x0 = min(int(unit["proposal_bbox_xywh"][0]) for unit in line_units)
        x1 = max(int(unit["proposal_bbox_xywh"][0] + unit["proposal_bbox_xywh"][2]) for unit in line_units)
        line = centerlines[line_id]
        candidates: list[dict[str, Any]] = []
        for word in body_words:
            x, y, width, height = word["bbox_xywh"]
            cx, cy = x + width / 2.0, y + height / 2.0
            line_y = float(line["slope"]) * cx + float(line["intercept"])
            distance = abs(cy - line_y) / float(np.hypot(1.0, float(line["slope"])))
            if distance <= 0.60 * line_spacings[line_id] and x0 - 150 <= cx <= x1 + 150:
                candidates.append(word)
        all_boxes = [unit["proposal_bbox_xywh"] for unit in line_units] + [word["bbox_xywh"] for word in candidates]
        left = min(box[0] for box in all_boxes)
        top = min(box[1] for box in all_boxes)
        right = max(box[0] + box[2] for box in all_boxes)
        bottom = max(box[1] + box[3] for box in all_boxes)
        crop = expand_bbox([left, top, right - left, bottom - top], 0.18, source.size)
        crop_x, crop_y, crop_width, crop_height = crop
        canvas = source.crop((crop_x, crop_y, crop_x + crop_width, crop_y + crop_height))
        values = np.asarray(canvas).copy()
        for index, word in enumerate(sorted(candidates, key=lambda row: row["bbox_xywh"][0])):
            color = np.asarray(PALETTE[index % len(PALETTE)], dtype=np.float32)
            local_ownership = ownership[crop_y : crop_y + crop_height, crop_x : crop_x + crop_width]
            mask = local_ownership == int(word["word_number"])
            values[mask] = np.clip(values[mask] * 0.35 + color * 0.65, 0, 255).astype(np.uint8)
        canvas = Image.fromarray(values, mode="RGB")
        draw = ImageDraw.Draw(canvas)
        y_left = float(line["slope"]) * crop_x + float(line["intercept"]) - crop_y
        y_right = float(line["slope"]) * (crop_x + crop_width) + float(line["intercept"]) - crop_y
        draw.line((0, y_left, crop_width, y_right), fill=(208, 47, 51), width=2)
        for index, word in enumerate(sorted(candidates, key=lambda row: row["bbox_xywh"][0])):
            x, y, width, height = word["bbox_xywh"]
            color = PALETTE[index % len(PALETTE)]
            draw.rectangle((x - crop_x, y - crop_y, x + width - crop_x, y + height - crop_y), outline=color, width=3)
            draw.text((x - crop_x + 2, y - crop_y + 2), f"H{word['word_number']}", fill=color, font=font(15, bold=True))
        for unit in line_units:
            x, y, width, height = unit["proposal_bbox_xywh"]
            draw.rectangle((x - crop_x, y - crop_y, x + width - crop_x, y + height - crop_y), outline=CYAN, width=2)
            draw.text(
                (x - crop_x + 2, max(0, y - crop_y - 18)),
                f"{unit['unit_id'].split('-')[-1]} {unit['text']}",
                fill=(0, 78, 108),
                font=font(14, bold=True),
            )
        board_path = args.output_dir / f"{line_id}-binding-review.jpg"
        canvas.save(board_path, format="JPEG", quality=94, subsampling=0, optimize=True)
        line_records.append(
            {
                "line_id": line_id,
                "declared_unit_count": len(line_units),
                "nearby_human_mask_count": len(candidates),
                "board": {"path": board_path.name, "file_sha256": sha256_file(board_path)},
                "units": [
                    {
                        "unit_id": unit["unit_id"],
                        "text": unit["text"],
                        "line_order": unit["line_order"],
                        "word_order": unit["word_order"],
                        "transcript_bbox_xywh": unit["proposal_bbox_xywh"],
                        "status": "needs_adjudication",
                        "target_human_word_numbers": [],
                        "note": "",
                    }
                    for unit in line_units
                ],
                "nearby_human_masks": [
                    {
                        "human_word_number": int(word["word_number"]),
                        "bbox_xywh": word["bbox_xywh"],
                        "pixels": int(word["pixels"]),
                        "pixel_sha256": word["pixel_sha256"],
                    }
                    for word in sorted(candidates, key=lambda row: row["bbox_xywh"][0])
                ],
                "unbound_human_word_numbers": [],
                "line_note": "",
            }
        )

    latest_state = sorted((args.human_run / "revisions").glob("r*/state.json"))[-1]
    record: dict[str, Any] = {
        "schema_version": "semantic-binding-adjudication-template.v1",
        "evidence_role": "sealed_evaluator_only_never_acting_input",
        "status": "needs_adjudication",
        "contract": {
            "unit_target_cardinality": "zero_or_more_human_masks",
            "human_mask_cardinality": "zero_or_one_semantic_unit; unbound masks remain residual/artifact",
            "missing_target": "empty target_human_word_numbers plus an explicit missing note",
            "commit_rule": "complete every line, validate no human mask is assigned twice, then hash the adjudicated record before metric recomputation",
        },
        "inputs": {
            "experiment": {"path": str(args.experiment.resolve()), "file_sha256": sha256_file(args.experiment), "experiment_sha256": experiment["experiment_sha256"]},
            "human_run": {"path": str(args.human_run.resolve()), "latest_state_path": str(latest_state.resolve()), "latest_state_file_sha256": sha256_file(latest_state)},
            "centerlines": {"path": str(args.centerlines.resolve()), "file_sha256": sha256_file(args.centerlines), "record_sha256": centerline_record.get("centerline_record_sha256")},
            "source": {"path": str(args.source.resolve()), "file_sha256": sha256_file(args.source)},
        },
        "body_human_word_number_window": {"start": 23, "end": 99, "count": 77, "status": "strong_geometry_hypothesis_not_semantic_truth"},
        "visual_legend": {"colored_H_number": "completed-page mask and selector number", "cyan_U_text": "acting transcript unit and rough box", "red_line": "acting fitted centerline"},
        "lines": line_records,
    }
    record["template_sha256"] = hashlib.sha256(canonical_json_bytes(record)).hexdigest()
    template_path = args.output_dir / "adjudication-template.json"
    template_path.write_bytes(canonical_json_bytes(record) + b"\n")
    manifest = {
        "schema_version": "semantic-binding-review-run.v1",
        "evidence_role": "sealed_evaluator_only_never_acting_input",
        "template": {"path": template_path.name, "file_sha256": sha256_file(template_path), "template_sha256": record["template_sha256"]},
        "line_count": len(line_records),
        "board_file_sha256s": {row["line_id"]: row["board"]["file_sha256"] for row in line_records},
    }
    manifest["manifest_sha256"] = hashlib.sha256(canonical_json_bytes(manifest)).hexdigest()
    manifest_path = args.output_dir / "run-manifest.json"
    manifest_path.write_bytes(canonical_json_bytes(manifest) + b"\n")
    print(json.dumps({"line_count": len(line_records), "counts": {row["line_id"]: [row["declared_unit_count"], row["nearby_human_mask_count"]] for row in line_records}}, indent=2))
    print(f"template_sha256={record['template_sha256']}")
    print(f"manifest_sha256={manifest['manifest_sha256']}")
    print(f"manifest_file_sha256={sha256_file(manifest_path)}")


if __name__ == "__main__":
    main()
