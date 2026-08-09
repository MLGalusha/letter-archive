#!/usr/bin/env python3
"""Build a review board that groups likely same-word ink fragments before the agent acts."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from word_envelope.io_utils import canonical_json_bytes, sha256_file  # noqa: E402
from word_envelope.simple_page_agent import _hash_record  # noqa: E402


PALETTE = ((32, 163, 102), (218, 120, 28), (133, 86, 185), (0, 145, 168))


def _font(size: int) -> ImageFont.ImageFont:
    for candidate in (
        "/System/Library/Fonts/SFNS.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ):
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            pass
    return ImageFont.load_default()


def _read(path: Path) -> dict:
    value = json.loads(path.read_text("utf-8"))
    if not isinstance(value, dict):
        raise SystemExit(f"Expected object: {path}")
    return value


def _connected_groups(features: list[dict]) -> list[list[int]]:
    """Return conservative candidate groups; the agent may still split any group."""
    parent = list(range(len(features)))

    def find(value: int) -> int:
        while parent[value] != value:
            parent[value] = parent[parent[value]]
            value = parent[value]
        return value

    def union(left: int, right: int) -> None:
        left_root, right_root = find(left), find(right)
        if left_root != right_root:
            parent[right_root] = left_root

    for left_index, left in enumerate(features):
        for right_index in range(left_index + 1, len(features)):
            right = features[right_index]
            left_x, _left_y, left_width, left_height = left["bbox_xywh"]
            right_x, _right_y, right_width, right_height = right["bbox_xywh"]
            horizontal_gap = max(
                0,
                max(left_x, right_x)
                - min(left_x + left_width, right_x + right_width),
            )
            gap_limit = max(24.0, 0.15 * (left_width + right_width))
            baseline_delta = abs(left["median_y"] - right["median_y"])
            baseline_limit = max(24.0, 0.30 * max(left_height, right_height))
            if horizontal_gap <= gap_limit and baseline_delta <= baseline_limit:
                union(left_index, right_index)

    grouped: dict[int, list[int]] = {}
    for index in range(len(features)):
        grouped.setdefault(find(index), []).append(index)
    return sorted(
        grouped.values(),
        key=lambda indexes: min(features[index]["bbox_xywh"][0] for index in indexes),
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--component-review-dir", type=Path, required=True)
    parser.add_argument("--clean", type=Path, required=True)
    parser.add_argument("--original", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--line-reference")
    parser.add_argument("--target-token-index", type=int)
    parser.add_argument("--lane-center-y", type=float)
    parser.add_argument("--lane-half-height", type=float, default=48.0)
    args = parser.parse_args()
    source_dir = args.component_review_dir.resolve()
    output = args.output_dir.resolve()
    if output.exists() or output.is_symlink():
        raise SystemExit(f"Refusing to overwrite {output}")
    component_review = _read(source_dir / "review.json")
    with Image.open(args.clean) as opened:
        clean = np.asarray(opened.convert("L"), dtype=np.uint8) > 0
    with Image.open(args.original) as opened:
        original = opened.convert("RGB")
    labels, _count = ndimage.label(clean, structure=np.ones((3, 3), dtype=np.uint8))

    ignored_micro_marks: list[int] = []
    features: list[dict] = []
    for component in component_review["components"]:
        component_mask = labels == int(component["source_component_id"])
        area = int(component_mask.sum())
        if area <= 2:
            ignored_micro_marks.append(int(component["mark"]))
            continue
        ys, xs = np.nonzero(component_mask)
        features.append(
            {
                **component,
                "median_y": float(np.median(ys)),
                "q25_y": float(np.quantile(ys, 0.25)),
                "q75_y": float(np.quantile(ys, 0.75)),
            }
        )
    candidate_indexes = _connected_groups(features)

    overlay = np.asarray(original, dtype=np.uint8).copy()
    groups: list[dict] = []
    for group_index, indexes in enumerate(candidate_indexes):
        group_id = chr(ord("A") + group_index)
        color = PALETTE[group_index % len(PALETTE)]
        member_marks: list[int] = []
        member_pixels = 0
        combined = np.zeros(clean.shape, dtype=bool)
        for index in indexes:
            feature = features[index]
            member_marks.append(int(feature["mark"]))
            component_mask = labels == int(feature["source_component_id"])
            combined |= component_mask
            member_pixels += int(component_mask.sum())
        overlay[combined] = np.rint(
            overlay[combined].astype(np.float32) * 0.30
            + np.asarray(color, dtype=np.float32) * 0.70
        ).astype(np.uint8)
        ys, xs = np.nonzero(combined)
        groups.append(
            {
                "group_id": group_id,
                "member_marks": member_marks,
                "area_pixels": member_pixels,
                "bbox_xywh": [
                    int(xs.min()),
                    int(ys.min()),
                    int(xs.max() - xs.min() + 1),
                    int(ys.max() - ys.min() + 1),
                ],
                "software_reason": "nearby fragments with a compatible robust baseline"
                if len(member_marks) > 1
                else "standalone candidate",
                "agent_may_split": True,
                "robust_median_y": round(
                    float(
                        np.median(
                            np.concatenate(
                                [
                                    np.nonzero(
                                        labels == int(features[index]["source_component_id"])
                                    )[0]
                                    for index in indexes
                                ]
                            )
                        )
                    ),
                    3,
                ),
            }
        )

    if args.lane_center_y is not None:
        lane_top = max(0.0, args.lane_center_y - args.lane_half_height)
        lane_bottom = min(float(original.height), args.lane_center_y + args.lane_half_height)
        for group in groups:
            group["reading_lane_status"] = (
                "aligned"
                if lane_top <= group["robust_median_y"] <= lane_bottom
                else "outside_current_line"
            )
    else:
        lane_top = lane_bottom = None
        for group in groups:
            group["reading_lane_status"] = "not_available"

    board = Image.fromarray(overlay, mode="RGB")
    drawing = ImageDraw.Draw(board)
    if lane_top is not None and lane_bottom is not None:
        drawing.rectangle(
            (0, int(lane_top), board.width - 1, int(lane_bottom)),
            outline=(0, 180, 205),
            width=4,
        )
        drawing.text(
            (12, int(lane_top) + 8),
            "active reading lane projected from prior accepted words",
            fill=(0, 105, 125),
            font=_font(20),
        )
    badge_font = _font(25)
    for group in groups:
        x, y, width, _height = group["bbox_xywh"]
        badge_x = x + width // 2
        badge_y = max(20, y - 24)
        drawing.ellipse(
            (badge_x - 17, badge_y - 17, badge_x + 17, badge_y + 17),
            fill="white",
            outline=(20, 20, 20),
            width=3,
        )
        drawing.text(
            (badge_x - 9, badge_y - 15),
            group["group_id"],
            fill=(10, 10, 10),
            font=badge_font,
        )
    header = 64
    canvas = Image.new("RGB", (board.width, board.height + header), "white")
    canvas.paste(board, (0, header))
    heading = ImageDraw.Draw(canvas)
    heading_text = (
        f"Software fragment groups for {component_review['target']['text_hint']!r} — approve or split"
    )
    if args.line_reference is not None:
        tokens = args.line_reference.split()
        if args.target_token_index is None or not 0 <= args.target_token_index < len(tokens):
            raise SystemExit("--target-token-index must address one token in --line-reference")
        tokens[args.target_token_index] = f"[{tokens[args.target_token_index]}]"
        heading_text += " | fallible line: " + " ".join(tokens)
    elif args.target_token_index is not None:
        raise SystemExit("--target-token-index requires --line-reference")
    heading.text(
        (12, 10),
        heading_text,
        fill=(20, 55, 63),
        font=_font(25),
    )
    output.mkdir(parents=True)
    canvas.save(output / "fragment-groups.png", format="PNG")
    packet = {
        "schema_version": "fragment-group-review.v1",
        "component_review_sha256": component_review["component_mark_review_sha256"],
        "target": component_review["target"],
        "fallible_line_reference": None
        if args.line_reference is None
        else {
            "text": args.line_reference,
            "target_token_index": args.target_token_index,
            "purpose": "reading-order and whole-word guidance only; not ground truth",
        },
        "active_reading_lane": None
        if lane_top is None
        else {
            "center_y": args.lane_center_y,
            "half_height": args.lane_half_height,
            "top_y": lane_top,
            "bottom_y": lane_bottom,
            "source": "projected from previously accepted words on this line",
            "policy": "outside_current_line groups are context, not legal target choices",
        },
        "instruction": (
            "Choose the software group that contains exactly one complete target word. "
            "A single cursive word may contain multiple disconnected ink fragments. Use the "
            "fallible line reference only to judge reading order and whole-word extent. Request "
            "a split only when a lane-aligned group visibly contains more than one lexical word, "
            "not merely because its letters are disconnected. Groups outside the active reading "
            "lane are context and cannot be selected as the target."
        ),
        "image_path": "fragment-groups.png",
        "image_file_sha256": sha256_file(output / "fragment-groups.png"),
        "ignored_micro_component_marks": ignored_micro_marks,
        "groups": groups,
        "eligible_group_ids": [
            group["group_id"]
            for group in groups
            if group["reading_lane_status"] in {"aligned", "not_available"}
        ],
        "required_output": {
            "schema_version": "fragment-group-decision.v1",
            "fragment_group_review_sha256": "this packet hash",
            "keep_group_id": "one eligible group ID",
            "request_split_group_ids": "zero or more group IDs",
            "brief_visible_reason": "one short sentence",
        },
    }
    packet["fragment_group_review_sha256"] = _hash_record(
        packet, "fragment_group_review_sha256"
    )
    (output / "review.json").write_bytes(canonical_json_bytes(packet) + b"\n")
    print(json.dumps(packet, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
