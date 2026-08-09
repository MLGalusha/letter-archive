#!/usr/bin/env python3
"""Reject unreliable fitted lines and preserve upstream vector proposals."""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

from experiment_page_adaptive_vector_ink import component_count, load_source, sha256_array, sha256_file


MINIMUM_OCCUPIED_BINS = 8
MINIMUM_INLIER_FRACTION = 0.60
MAXIMUM_ABSOLUTE_SLOPE = 0.08
MINIMUM_ANCHOR_RETENTION = 0.55


def load_black(path: Path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("L")) == 0


def remove_singletons(mask: np.ndarray) -> np.ndarray:
    labels, count = ndimage.label(mask, structure=np.ones((3, 3), dtype=np.uint8))
    sizes = np.bincount(labels.ravel(), minlength=count + 1)
    keep = sizes >= 2
    keep[0] = False
    return keep[labels]


def quality_decision(line_fit: dict[str, object]) -> tuple[bool, list[str]]:
    occupied = int(line_fit["occupied_bins"])
    inliers = int(line_fit["inlier_bins"])
    inlier_fraction = inliers / max(1, occupied)
    failures: list[str] = []
    if occupied < MINIMUM_OCCUPIED_BINS:
        failures.append("insufficient_occupied_bins")
    if inlier_fraction < MINIMUM_INLIER_FRACTION:
        failures.append("insufficient_inlier_fraction")
    if abs(float(line_fit["slope"])) > MAXIMUM_ABSOLUTE_SLOPE:
        failures.append("implausible_absolute_slope")
    if float(line_fit["anchor_retention"]) < MINIMUM_ANCHOR_RETENTION:
        failures.append("insufficient_anchor_retention")
    return not failures, failures


def mask_metrics(mask: np.ndarray, upstream: np.ndarray, probability: np.ndarray) -> dict[str, object]:
    return {
        "pixels": int(mask.sum()),
        "components": component_count(mask),
        "retained_fraction_of_upstream": float(mask.sum() / max(1, upstream.sum())),
        "removed_pixels": int((upstream & ~mask).sum()),
        "p_lt_0.01_pixels": int((mask & (probability < 0.01)).sum()),
        "mask_pixel_sha256": sha256_array(mask.astype(np.uint8)),
    }


def overlay(source: np.ndarray, anchor: np.ndarray, additions: np.ndarray) -> Image.Image:
    result = source.astype(np.float32) * 0.62 + 255.0 * 0.38
    result[anchor] = (0, 190, 205)
    result[additions] = (235, 55, 45)
    return Image.fromarray(np.clip(result, 0, 255).astype(np.uint8), "RGB")


def render_board(
    label: str,
    source: np.ndarray,
    anchor: np.ndarray,
    upstream: np.ndarray,
    unguarded: np.ndarray,
    guarded: np.ndarray,
    guarded_area2: np.ndarray,
    accepted: bool,
    failures: list[str],
    output: Path,
) -> None:
    panels = (
        ("source", Image.fromarray(source, "RGB"), "unaltered acting-safe source"),
        ("upstream vector agreement", overlay(source, anchor, upstream), f"red {upstream.sum():,} px"),
        ("unguarded fitted line", overlay(source, anchor, unguarded), f"red {unguarded.sum():,} px"),
        (
            "quality-gated result",
            overlay(source, anchor, guarded),
            "FIT ACCEPTED" if accepted else "FIT REJECTED: upstream preserved",
        ),
        (
            "quality-gated + area>=2",
            overlay(source, anchor, guarded_area2),
            f"red {guarded_area2.sum():,} px",
        ),
        (
            "decision",
            Image.new("RGB", (source.shape[1], source.shape[0]), "#f7f3ea"),
            "none" if accepted else ", ".join(failures),
        ),
    )
    panel_width = 600
    panel_height = round(source.shape[0] * panel_width / source.shape[1])
    title_height = 72
    board = Image.new("RGB", (panel_width * 3, (panel_height + title_height) * 2), "#f3eee4")
    draw = ImageDraw.Draw(board)
    for index, (name, panel, subtitle) in enumerate(panels):
        x0 = (index % 3) * panel_width
        y0 = (index // 3) * (panel_height + title_height)
        panel = panel.resize((panel_width, panel_height), Image.Resampling.LANCZOS)
        draw.text((x0 + 10, y0 + 8), f"{label}: {name}", fill="#222222")
        draw.text((x0 + 10, y0 + 37), subtitle, fill="#8a2820")
        board.paste(panel, (x0, y0 + title_height))
    board.save(output, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--hybrid-probability", required=True, type=Path)
    parser.add_argument("--vector-root", required=True, type=Path)
    parser.add_argument("--line-gate-root", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--page-id", required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    source = load_source(args.source)
    probability = np.load(args.hybrid_probability, allow_pickle=False).astype(np.float32)
    vector_manifest_path = args.vector_root / "experiment.json"
    line_manifest_path = args.line_gate_root / "experiment.json"
    vector_manifest = json.loads(vector_manifest_path.read_text())
    line_manifest = json.loads(line_manifest_path.read_text())
    started = time.perf_counter()
    crop_records: dict[str, object] = {}
    for label, vector_record in vector_manifest["crops"].items():
        x, y, width, height = vector_record["bbox_xywh"]
        local_source = source[y : y + height, x : x + width]
        local_probability = probability[y : y + height, x : x + width]
        anchor = local_probability >= 0.50
        upstream_score_path = args.vector_root / label / "prototype-classifier-agreement.score.float16.npy"
        upstream = (np.load(upstream_score_path, allow_pickle=False).astype(np.float32) >= 0.80) & ~anchor
        unguarded_path = args.line_gate_root / label / "fitted-line.additions.png"
        unguarded = load_black(unguarded_path)
        line_fit = line_manifest["crops"][label]["line_fit"]
        accepted, failures = quality_decision(line_fit)
        guarded = unguarded if accepted else upstream
        guarded_area2 = remove_singletons(guarded)
        crop_dir = args.output / label
        crop_dir.mkdir(parents=True, exist_ok=True)
        outputs: dict[str, object] = {}
        for name, mask in (("quality-gated", guarded), ("quality-gated-area2", guarded_area2)):
            path = crop_dir / f"{name}.additions.png"
            Image.fromarray(np.where(mask, 0, 255).astype(np.uint8), "L").save(path)
            outputs[name] = {"file": path.name, "file_sha256": sha256_file(path)}
        board_path = crop_dir / "fitted-line-quality-gate-review.png"
        render_board(
            label, local_source, anchor, upstream, unguarded, guarded, guarded_area2,
            accepted, failures, board_path
        )
        crop_records[label] = {
            "bbox_xywh": vector_record["bbox_xywh"],
            "line_fit": line_fit,
            "quality": {
                "accepted": accepted,
                "failure_reasons": failures,
                "occupied_bins": int(line_fit["occupied_bins"]),
                "inlier_fraction": float(line_fit["inlier_bins"] / max(1, line_fit["occupied_bins"])),
                "absolute_slope": abs(float(line_fit["slope"])),
                "anchor_retention": float(line_fit["anchor_retention"]),
            },
            "upstream": mask_metrics(upstream, upstream, local_probability),
            "unguarded_fitted_line": mask_metrics(unguarded, upstream, local_probability),
            "quality_gated": mask_metrics(guarded, upstream, local_probability),
            "quality_gated_area2": mask_metrics(guarded_area2, upstream, local_probability),
            "outputs": outputs,
            "review_board": {"file": board_path.name, "file_sha256": sha256_file(board_path)},
        }
    manifest = {
        "schema_version": "fitted-line-quality-gate.v1",
        "experiment_status": "measurement_complete_visual_review_pending",
        "page_id": args.page_id,
        "sealed_human_evidence_used": False,
        "selection_rule": "Quality thresholds frozen after observing the specific sparse-anchor failure; apply unchanged to all three previously frozen crops.",
        "interpretation_guardrail": "A rejected fit preserves the broader upstream proposal and emits explicit line-unresolved state. It does not imply upstream pixels are clean or owned.",
        "thresholds": {
            "minimum_occupied_bins": MINIMUM_OCCUPIED_BINS,
            "minimum_inlier_fraction": MINIMUM_INLIER_FRACTION,
            "maximum_absolute_slope": MAXIMUM_ABSOLUTE_SLOPE,
            "minimum_anchor_retention": MINIMUM_ANCHOR_RETENTION,
        },
        "fallback": "Preserve frozen upstream prototype-classifier agreement and mark line unresolved.",
        "source": {"path": str(args.source), "file_sha256": sha256_file(args.source)},
        "hybrid_probability": {"path": str(args.hybrid_probability), "file_sha256": sha256_file(args.hybrid_probability)},
        "upstream_vector_manifest": {"path": str(vector_manifest_path), "file_sha256": sha256_file(vector_manifest_path)},
        "upstream_line_manifest": {"path": str(line_manifest_path), "file_sha256": sha256_file(line_manifest_path)},
        "crops": crop_records,
        "runtime_seconds": time.perf_counter() - started,
    }
    manifest_path = args.output / "experiment.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print(json.dumps(manifest, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
