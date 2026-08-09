#!/usr/bin/env python3
"""Rank recovered fragment groups using Eynollah-taught positive prototypes.

This bounded acting-safe experiment does not change the recovered mask.  It
uses groups containing Eynollah core as page-specific positive references and
ranks wholly new groups by robust similarity.  Rule-based flags only control
the review lane: nothing is silently accepted or deleted.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageOps


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_array(array: np.ndarray) -> str:
    return hashlib.sha256(np.ascontiguousarray(array).tobytes()).hexdigest()


def quantile(values: np.ndarray, q: float) -> float:
    return float(np.quantile(values, q)) if values.size else 0.0


def thickness_proxy(mask: np.ndarray) -> float:
    """Return 2A/P, an exact-pixel width proxy with no synthetic joins."""
    padded = np.pad(mask.astype(np.int8), 1)
    perimeter = int(np.abs(np.diff(padded, axis=0)).sum() + np.abs(np.diff(padded, axis=1)).sum())
    return float(2.0 * mask.sum() / max(perimeter, 1))


def group_features(
    mask: np.ndarray,
    probability: np.ndarray,
    reference_score: np.ndarray,
    darkness_residual: np.ndarray,
    strong_threshold: float,
) -> dict[str, float | int | list[int]]:
    ys, xs = np.nonzero(mask)
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    area = int(mask.sum())
    width, height = x1 - x0, y1 - y0
    core = mask & (probability >= 0.50)
    strong = mask & (reference_score >= strong_threshold)
    edge_distance = np.minimum.reduce(
        (xs, ys, mask.shape[1] - 1 - xs, mask.shape[0] - 1 - ys)
    )
    return {
        "area": area,
        "bbox_crop_xyxy": [x0, y0, x1, y1],
        "width": width,
        "height": height,
        "aspect_width_over_height": float(width / max(height, 1)),
        "bbox_density": float(area / max(width * height, 1)),
        "exact_pixel_thickness_proxy_2A_over_P": thickness_proxy(mask),
        "Eynollah_core_pixels": int(core.sum()),
        "Eynollah_core_fraction": float(core.sum() / area),
        "strong_reference_pixels": int(strong.sum()),
        "strong_reference_fraction": float(strong.sum() / area),
        "reference_score_q50": quantile(reference_score[mask], 0.50),
        "reference_score_q90": quantile(reference_score[mask], 0.90),
        "darkness_residual_q50": quantile(darkness_residual[mask], 0.50),
        "darkness_residual_q90": quantile(darkness_residual[mask], 0.90),
        "crop_edge_distance_q10": quantile(edge_distance.astype(np.float32), 0.10),
    }


SIMILARITY_FEATURES = (
    "bbox_density",
    "exact_pixel_thickness_proxy_2A_over_P",
    "reference_score_q50",
    "reference_score_q90",
    "darkness_residual_q50",
    "darkness_residual_q90",
)


def robust_positive_model(records: list[dict[str, object]]) -> dict[str, object]:
    references = [
        record
        for record in records
        if int(record["Eynollah_core_pixels"]) >= 8 and int(record["area"]) >= 20
    ]
    if len(references) < 12:
        raise ValueError("Insufficient substantive Eynollah-backed groups")
    matrix = np.asarray(
        [[float(record[name]) for name in SIMILARITY_FEATURES] for record in references],
        dtype=np.float64,
    )
    center = np.median(matrix, axis=0)
    mad = np.median(np.abs(matrix - center), axis=0)
    scale = np.maximum(1.4826 * mad, np.asarray([0.01, 0.05, 0.05, 0.05, 0.002, 0.002]))
    return {
        "definition": "diagonal robust one-class prototype fitted only to substantive Eynollah-core-backed groups",
        "feature_names": list(SIMILARITY_FEATURES),
        "reference_group_count": len(references),
        "feature_center": [float(value) for value in center],
        "feature_robust_scale": [float(value) for value in scale],
    }


def positive_similarity(record: dict[str, object], model: dict[str, object]) -> tuple[float, list[float]]:
    values = np.asarray([float(record[name]) for name in model["feature_names"]], dtype=np.float64)
    center = np.asarray(model["feature_center"], dtype=np.float64)
    scale = np.asarray(model["feature_robust_scale"], dtype=np.float64)
    robust_z = np.abs(values - center) / scale
    distance = float(np.mean(np.minimum(robust_z, 8.0)))
    return float(math.exp(-0.5 * distance)), [float(value) for value in robust_z]


def review_lane(record: dict[str, object]) -> tuple[str, str]:
    if int(record["Eynollah_core_pixels"]) > 0:
        return "anchor-backed", "contains fixed Eynollah core"
    if float(record["crop_edge_distance_q10"]) < 12.0:
        return "needs-context", "wholly new group reaches the bounded crop edge"
    if int(record["area"]) < 8:
        return "micro-fragment", "wholly new group has fewer than eight exact pixels"
    if (
        float(record["aspect_width_over_height"]) > 12.0
        and int(record["height"]) < 20
    ):
        return "elongated-risk", "wholly new group is unusually long and thin"
    return "faint-candidate", "substantial wholly new group; review by positive similarity"


def category_overlay(
    source: np.ndarray,
    groups: np.ndarray,
    records: list[dict[str, object]],
) -> Image.Image:
    canvas = source.astype(np.float32) * 0.56 + 255.0 * 0.44
    colours = {
        "anchor-backed": (0, 150, 170),
        "faint-candidate": (206, 77, 146),
        "needs-context": (237, 155, 34),
        "micro-fragment": (132, 100, 168),
        "elongated-risk": (204, 62, 52),
    }
    for record in records:
        canvas[groups == int(record["group_id"])] = colours[str(record["review_lane"])]
    return Image.fromarray(np.uint8(canvas), "RGB")


def similarity_overlay(
    source: np.ndarray,
    groups: np.ndarray,
    records: list[dict[str, object]],
) -> Image.Image:
    canvas = source.astype(np.float32) * 0.62 + 255.0 * 0.38
    for record in records:
        mask = groups == int(record["group_id"])
        if int(record["Eynollah_core_pixels"]) > 0:
            colour = np.asarray((0, 150, 170), dtype=np.float32)
        else:
            score = float(record["positive_similarity"])
            colour = (1.0 - score) * np.asarray((212, 66, 52)) + score * np.asarray((26, 154, 91))
        canvas[mask] = colour
    return Image.fromarray(np.uint8(canvas), "RGB")


def numbered_candidates(
    source: np.ndarray,
    records: list[dict[str, object]],
) -> Image.Image:
    image = Image.fromarray(source, "RGB")
    draw = ImageDraw.Draw(image)
    colours = {
        "faint-candidate": "#c53788",
        "needs-context": "#d77d00",
        "micro-fragment": "#7653a4",
        "elongated-risk": "#c43a31",
    }
    for record in records:
        lane = str(record["review_lane"])
        if lane == "anchor-backed":
            continue
        x0, y0, x1, y1 = [int(value) for value in record["bbox_crop_xyxy"]]
        colour = colours[lane]
        draw.rectangle((x0 - 2, y0 - 2, x1 + 2, y1 + 2), outline=colour, width=2)
        draw.text((x0 + 2, max(0, y0 - 15)), f"g{record['group_id']} {record['positive_similarity']:.2f}", fill=colour)
    return image


def render_board(
    source: np.ndarray,
    groups: np.ndarray,
    records: list[dict[str, object]],
    output: Path,
) -> None:
    panels = [
        ("source", Image.fromarray(source, "RGB"), "unaltered acting-safe crop"),
        (
            "review lanes",
            category_overlay(source, groups, records),
            "cyan anchor · pink candidate · orange context · purple micro · red elongated",
        ),
        (
            "positive-prototype similarity",
            similarity_overlay(source, groups, records),
            "new groups: green more similar · red less similar; anchors remain cyan",
        ),
        (
            "new groups numbered",
            numbered_candidates(source, records),
            "group id + one-class similarity; no group is auto-accepted or deleted",
        ),
    ]
    height, width = groups.shape
    title_height = 66
    board = Image.new("RGB", (2 * width, 2 * (height + title_height)), "#f3eee4")
    draw = ImageDraw.Draw(board)
    for index, (title, panel, subtitle) in enumerate(panels):
        x = index % 2 * width
        y = index // 2 * (height + title_height)
        draw.text((x + 8, y + 7), title, fill="#222222")
        draw.text((x + 8, y + 34), subtitle, fill="#555555")
        board.paste(panel, (x, y + title_height))
    board.save(output, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--probability", type=Path, required=True)
    parser.add_argument("--reference-root", type=Path, required=True)
    parser.add_argument("--group-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()

    group_manifest_path = args.group_root / "experiment.json"
    reference_manifest_path = args.reference_root / "experiment.json"
    group_manifest = json.loads(group_manifest_path.read_text())
    reference_manifest = json.loads(reference_manifest_path.read_text())
    groups_path = args.group_root / "adaptive-group-ids.int32.npy"
    reference_score_path = args.reference_root / "local-reference-score.float16.npy"
    groups = np.load(groups_path, allow_pickle=False)
    probability_page = np.load(args.probability, allow_pickle=False).astype(np.float32)
    reference_score = np.load(reference_score_path, allow_pickle=False).astype(np.float32)
    crop = [int(value) for value in group_manifest["inputs"]["crop_bbox_xyxy"]]
    x0, y0, x1, y1 = crop
    probability = probability_page[y0:y1, x0:x1]
    if groups.shape != probability.shape or groups.shape != reference_score.shape:
        raise ValueError("Group, probability, and reference-score coordinates differ")

    with Image.open(args.source) as raw:
        upright = ImageOps.exif_transpose(raw).convert("RGB")
        source_image = upright.crop((x0, y0, x1, y1))
    source = np.asarray(source_image)
    gray_image = source_image.convert("L")
    background = np.asarray(gray_image.filter(ImageFilter.GaussianBlur(radius=12)), dtype=np.float32)
    gray = np.asarray(gray_image, dtype=np.float32)
    darkness_residual = (background - gray) / 255.0
    strong_threshold = float(reference_manifest["thresholds"]["paper_q995"])

    records: list[dict[str, object]] = []
    line_by_group: dict[int, int] = {}
    for line_record in group_manifest["adaptive_grouping"]["line_records"]:
        for group_record in line_record["groups_left_to_right"]:
            line_by_group[int(group_record["group_id"])] = int(line_record["line_index"])
    for group_id in range(1, int(groups.max()) + 1):
        mask = groups == group_id
        record: dict[str, object] = {
            "group_id": group_id,
            "line_index": line_by_group[group_id],
            **group_features(mask, probability, reference_score, darkness_residual, strong_threshold),
        }
        records.append(record)

    model = robust_positive_model(records)
    for record in records:
        similarity, robust_z = positive_similarity(record, model)
        lane, reason = review_lane(record)
        record["positive_similarity"] = similarity
        record["positive_similarity_robust_z"] = robust_z
        record["review_lane"] = lane
        record["review_reason"] = reason

    lane_counts: dict[str, dict[str, int]] = {}
    for record in records:
        lane = str(record["review_lane"])
        bucket = lane_counts.setdefault(lane, {"groups": 0, "exact_pixels": 0})
        bucket["groups"] += 1
        bucket["exact_pixels"] += int(record["area"])
    wholly_new = [record for record in records if int(record["Eynollah_core_pixels"]) == 0]
    new_ranked = sorted(wholly_new, key=lambda record: float(record["positive_similarity"]), reverse=True)

    board_path = args.output / "eynollah-taught-group-ranking.png"
    render_board(source, groups, records, board_path)
    records_path = args.output / "group-records.json"
    records_path.write_text(json.dumps(records, indent=2) + "\n")
    record = {
        "schema_version": "eynollah-taught-group-ranking.v1",
        "evidence_visibility": "acting-safe-source-and-frozen-software-output-only",
        "sealed_human_evidence_used": False,
        "hypothesis": "Eynollah-backed groups can act as positive prototypes that focus review of wholly new faint-fragment groups",
        "inputs": {
            "source_sha256": sha256_file(args.source),
            "probability_file_sha256": sha256_file(args.probability),
            "reference_manifest_sha256": sha256_file(reference_manifest_path),
            "reference_score_sha256": sha256_file(reference_score_path),
            "adaptive_group_manifest_sha256": sha256_file(group_manifest_path),
            "adaptive_group_ids_sha256": sha256_file(groups_path),
            "crop_bbox_xyxy": crop,
        },
        "positive_model": model,
        "review_lane_rules": [
            "anchor-backed: contains any fixed Eynollah core pixel",
            "needs-context: wholly new and within 12 px of bounded crop edge",
            "micro-fragment: wholly new and fewer than 8 exact pixels",
            "elongated-risk: wholly new, width/height >12, and height <20 px",
            "faint-candidate: remaining substantial wholly new groups",
        ],
        "metrics": {
            "total_groups": len(records),
            "Eynollah_core_backed_groups": len(records) - len(wholly_new),
            "wholly_new_groups": len(wholly_new),
            "review_lanes": lane_counts,
            "top_wholly_new_by_positive_similarity": [
                {
                    "group_id": int(item["group_id"]),
                    "line_index": int(item["line_index"]),
                    "review_lane": item["review_lane"],
                    "positive_similarity": float(item["positive_similarity"]),
                    "area": int(item["area"]),
                    "bbox_crop_xyxy": item["bbox_crop_xyxy"],
                }
                for item in new_ranked
            ],
            "group_ids_int32_pixel_sha256_unchanged": sha256_array(groups),
        },
        "guardrails": [
            "This experiment ranks existing exact-pixel groups and does not alter the mask.",
            "Eynollah core is a precision-oriented pseudo-label, not human ground truth.",
            "Pixels outside Eynollah core remain unknown rather than automatic background.",
            "Positive similarity is one-class triage, not calibrated probability.",
            "Crop-edge and morphology flags route review; they never delete evidence.",
        ],
        "outputs": {
            board_path.name: sha256_file(board_path),
            records_path.name: sha256_file(records_path),
        },
        "runtime_seconds": time.perf_counter() - started,
    }
    manifest_path = args.output / "experiment.json"
    manifest_path.write_text(json.dumps(record, indent=2) + "\n")
    print(
        json.dumps(
            {
                "metrics": record["metrics"],
                "manifest_sha256": sha256_file(manifest_path),
                "board": str(board_path),
            }
        )
    )


if __name__ == "__main__":
    main()
