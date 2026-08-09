#!/usr/bin/env python3
"""Group exact Kraken-line vector pixels into word-like review units without changing ink."""

from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage


KERNELS = {
    "tight-3x7": (3, 7),
    "balanced-5x15": (5, 15),
    "broad-7x25": (7, 25),
}
PALETTE = np.asarray(
    [
        (0, 174, 188),
        (231, 76, 60),
        (143, 92, 189),
        (235, 157, 34),
        (42, 157, 85),
        (50, 113, 190),
        (206, 77, 146),
        (111, 94, 81),
    ],
    dtype=np.uint8,
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_array(array: np.ndarray) -> str:
    return hashlib.sha256(np.ascontiguousarray(array).tobytes()).hexdigest()


def group_exact_pixels(evidence: np.ndarray, kernel_hw: tuple[int, int]) -> tuple[np.ndarray, dict[str, object]]:
    support = ndimage.binary_dilation(evidence, structure=np.ones(kernel_hw, dtype=bool))
    support_labels, _ = ndimage.label(support, structure=np.ones((3, 3), dtype=np.uint8))
    labels = np.where(evidence, support_labels, 0).astype(np.int32)
    ids = np.unique(labels[labels > 0])
    # Re-number by left edge so adjacent review colours follow reading order.
    order: list[tuple[int, int]] = []
    for group_id in ids:
        _, xs = np.nonzero(labels == group_id)
        order.append((int(xs.min()), int(group_id)))
    remap = np.zeros(int(labels.max()) + 1, dtype=np.int32)
    for new_id, (_, old_id) in enumerate(sorted(order), start=1):
        remap[old_id] = new_id
    labels = remap[labels]
    group_records: list[dict[str, int | float]] = []
    for group_id in range(1, int(labels.max()) + 1):
        ys, xs = np.nonzero(labels == group_id)
        group_records.append(
            {
                "group_id": group_id,
                "pixels": int(len(xs)),
                "bbox_xyxy": [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1],
                "width_fraction": float((xs.max() - xs.min() + 1) / evidence.shape[1]),
            }
        )
    raw_components = ndimage.label(evidence, structure=np.ones((3, 3), dtype=np.uint8))[1]
    return labels, {
        "kernel_hw": list(kernel_hw),
        "raw_evidence_components": int(raw_components),
        "review_groups": len(group_records),
        "component_to_group_reduction_fraction": float(1.0 - len(group_records) / max(1, raw_components)),
        "largest_group_width_fraction": max((record["width_fraction"] for record in group_records), default=0.0),
        "groups": group_records,
        "exact_evidence_pixel_count": int(evidence.sum()),
        "labels_int32_pixel_sha256": sha256_array(labels),
    }


def colour_groups(source: np.ndarray, labels: np.ndarray) -> Image.Image:
    result = source.astype(np.float32) * 0.52 + 255.0 * 0.48
    for group_id in range(1, int(labels.max()) + 1):
        result[labels == group_id] = PALETTE[(group_id - 1) % len(PALETTE)]
    return Image.fromarray(np.clip(result, 0, 255).astype(np.uint8), "RGB")


def render_board(source: np.ndarray, panels: list[tuple[str, Image.Image]], title: str, output: Path) -> None:
    panel_width = 720
    panel_height = max(120, round(source.shape[0] * panel_width / source.shape[1]))
    title_height = 62
    board = Image.new("RGB", (panel_width * 2, (panel_height + title_height) * 2), "#f3eee4")
    draw = ImageDraw.Draw(board)
    for index, (label, panel) in enumerate(panels):
        x = (index % 2) * panel_width
        y = (index // 2) * (panel_height + title_height)
        draw.text((x + 10, y + 8), title, fill="#222222")
        draw.text((x + 10, y + 34), label, fill="#555555")
        board.paste(panel.resize((panel_width, panel_height), Image.Resampling.LANCZOS), (x, y + title_height))
    board.save(output, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    source_manifest = json.loads((args.input / "experiment.json").read_text())
    started = time.perf_counter()
    page_records: dict[str, object] = {}

    for page_id, page in source_manifest["pages"].items():
        source = np.asarray(Image.open(page["source"]["path"]).convert("RGB"))
        probability = np.load(page["hybrid_probability"]["path"], allow_pickle=False).astype(np.float32)
        line_records: dict[str, object] = {}
        for label, line in page["lines"].items():
            x0, y0, x1, y1 = line["bbox_xyxy"]
            local_source = source[y0:y1, x0:x1]
            local_probability = probability[y0:y1, x0:x1]
            proposal_path = args.input / line["outputs"]["mask"]["file"]
            corridor_path = args.input / line["outputs"]["corridor"]["file"]
            proposal = np.asarray(Image.open(proposal_path)) == 0
            corridor = np.asarray(Image.open(corridor_path)) == 0
            anchor = (local_probability >= 0.50) & corridor
            evidence = anchor | proposal
            output_dir = args.output / page_id / label
            output_dir.mkdir(parents=True, exist_ok=True)
            panels: list[tuple[str, Image.Image]] = [("source; no grouping", Image.fromarray(local_source, "RGB"))]
            variants: dict[str, object] = {}
            for variant, kernel in KERNELS.items():
                labels, metrics = group_exact_pixels(evidence, kernel)
                labels_path = output_dir / f"{variant}.labels.uint16.png"
                Image.fromarray(labels.astype(np.uint16)).save(labels_path)
                variants[variant] = {
                    **metrics,
                    "labels_file": labels_path.name,
                    "labels_file_sha256": sha256_file(labels_path),
                    "ink_pixel_identity_preserved": bool(np.array_equal(labels > 0, evidence)),
                }
                panels.append((f"{variant}: {metrics['review_groups']} groups", colour_groups(local_source, labels)))
            board_path = output_dir / "vector-fragment-grouping-review.png"
            render_board(local_source, panels, f"{page_id} · {label} · exact pixels recoloured", board_path)
            line_records[label] = {
                "bbox_xyxy": line["bbox_xyxy"],
                "upstream_mask": {"path": str(proposal_path), "file_sha256": sha256_file(proposal_path)},
                "upstream_corridor": {"path": str(corridor_path), "file_sha256": sha256_file(corridor_path)},
                "anchor_pixels": int(anchor.sum()),
                "proposal_pixels": int((proposal & ~anchor).sum()),
                "exact_evidence_pixels": int(evidence.sum()),
                "exact_evidence_mask_pixel_sha256": sha256_array(evidence.astype(np.uint8)),
                "variants": variants,
                "review_board": {"file": str(board_path.relative_to(args.output)), "file_sha256": sha256_file(board_path)},
            }
        page_records[page_id] = {"lines": line_records}

    manifest = {
        "schema_version": "vector-fragment-grouping.v1",
        "experiment_status": "measurement_complete_visual_review_pending",
        "sealed_human_evidence_used": False,
        "selection_rule": "Apply three frozen anisotropic grouping kernels to the six prior automatically selected cross-page lines. Group labels may change; the exact anchor-plus-proposal ink pixels may not.",
        "interpretation_guardrail": "Fewer groups is not automatically better. A grouping that merges neighboring words or unrelated strokes is a regression even when review count falls.",
        "upstream": {"path": str(args.input / "experiment.json"), "file_sha256": sha256_file(args.input / "experiment.json")},
        "pages": page_records,
        "runtime_seconds": time.perf_counter() - started,
    }
    manifest_path = args.output / "experiment.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"manifest": str(manifest_path), "runtime_seconds": manifest["runtime_seconds"]}, indent=2))


if __name__ == "__main__":
    main()
