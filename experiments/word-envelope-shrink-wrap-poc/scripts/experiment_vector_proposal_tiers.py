#!/usr/bin/env python3
"""Rank vector-only connected components by independent recovery support."""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

from experiment_page_adaptive_vector_ink import load_source, sha256_array, sha256_file


CROPS = (
    ("folded-write-to-you", "development", "folded-write-to-you"),
    ("enough-tight", "development", "enough-tight"),
    ("acknowledgement-tight", "development", "acknowledgement-tight"),
    ("know-enough-broad", "heldout", "know-enough"),
    ("thank-you-for", "heldout", "thank-you-for"),
)
MINIMUM_OVERLAP_FRACTION = 0.10


def load_black(path: Path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("L")) == 0


def tier_components(
    proposal: np.ndarray,
    conservative: np.ndarray,
    balanced: np.ndarray,
) -> tuple[dict[str, np.ndarray], list[dict[str, object]]]:
    conservative_support = ndimage.binary_dilation(conservative, structure=np.ones((3, 3), dtype=bool))
    balanced_support = ndimage.binary_dilation(balanced, structure=np.ones((3, 3), dtype=bool))
    labels, count = ndimage.label(proposal, structure=np.ones((3, 3), dtype=np.uint8))
    tiers = {
        "strong-conservative-supported": np.zeros_like(proposal),
        "likely-balanced-supported": np.zeros_like(proposal),
        "exploratory-vector-only": np.zeros_like(proposal),
    }
    records: list[dict[str, object]] = []
    for component_id in range(1, count + 1):
        component = labels == component_id
        ys, xs = np.nonzero(component)
        pixels = int(component.sum())
        conservative_overlap = int((component & conservative_support).sum())
        balanced_overlap = int((component & balanced_support).sum())
        conservative_fraction = conservative_overlap / max(1, pixels)
        balanced_fraction = balanced_overlap / max(1, pixels)
        if conservative_fraction >= MINIMUM_OVERLAP_FRACTION:
            tier = "strong-conservative-supported"
        elif balanced_fraction >= MINIMUM_OVERLAP_FRACTION:
            tier = "likely-balanced-supported"
        else:
            tier = "exploratory-vector-only"
        tiers[tier] |= component
        records.append(
            {
                "component_id": component_id,
                "bbox_xywh": [int(xs.min()), int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)],
                "pixels": pixels,
                "conservative_overlap_pixels_dilated_1px": conservative_overlap,
                "conservative_overlap_fraction": conservative_fraction,
                "balanced_overlap_pixels_dilated_1px": balanced_overlap,
                "balanced_overlap_fraction": balanced_fraction,
                "tier": tier,
            }
        )
    return tiers, records


def render_board(
    label: str,
    source: np.ndarray,
    anchor: np.ndarray,
    proposal: np.ndarray,
    tiers: dict[str, np.ndarray],
    output: Path,
) -> None:
    def panel(masks: tuple[str, ...]) -> Image.Image:
        result = source.astype(np.float32) * 0.62 + 255.0 * 0.38
        result[anchor] = (0, 190, 205)
        colours = {
            "strong-conservative-supported": (35, 175, 75),
            "likely-balanced-supported": (245, 145, 25),
            "exploratory-vector-only": (205, 60, 190),
        }
        for name in masks:
            result[tiers[name]] = colours[name]
        return Image.fromarray(np.clip(result, 0, 255).astype(np.uint8), "RGB")

    blank_tiers = {name: np.zeros_like(proposal) for name in tiers}
    original_tiers = tiers.copy()
    panels = (
        ("source", Image.fromarray(source, "RGB"), "unaltered acting-safe source"),
        ("anchor + all vector", None, f"cyan anchor | all proposals {proposal.sum():,} px"),
        ("strong", ("strong-conservative-supported",), "green: conservative recovery agrees"),
        ("likely", ("likely-balanced-supported",), "orange: balanced-only agreement"),
        ("exploratory", ("exploratory-vector-only",), "magenta: vector-only; inspect, never auto-accept"),
        ("all ranked tiers", tuple(tiers), "green strong | orange likely | magenta exploratory"),
    )
    panel_width = 600
    panel_height = round(source.shape[0] * panel_width / source.shape[1])
    title_height = 72
    board = Image.new("RGB", (panel_width * 3, (panel_height + title_height) * 2), "#f3eee4")
    draw = ImageDraw.Draw(board)
    for index, (name, value, subtitle) in enumerate(panels):
        x0 = (index % 3) * panel_width
        y0 = (index // 3) * (panel_height + title_height)
        if name == "source":
            image = value
        elif name == "anchor + all vector":
            saved = tiers
            tiers = blank_tiers
            tiers["exploratory-vector-only"] = proposal
            image = panel(("exploratory-vector-only",))
            tiers = saved
        else:
            image = panel(value)
        image = image.resize((panel_width, panel_height), Image.Resampling.LANCZOS)
        draw.text((x0 + 10, y0 + 8), f"{label}: {name}", fill="#222222")
        draw.text((x0 + 10, y0 + 37), subtitle, fill="#6f2925")
        board.paste(image, (x0, y0 + title_height))
    tiers = original_tiers
    board.save(output, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--hybrid-probability", required=True, type=Path)
    parser.add_argument("--development-root", required=True, type=Path)
    parser.add_argument("--heldout-root", required=True, type=Path)
    parser.add_argument("--local-recovery-root", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--page-id", required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    source = load_source(args.source)
    probability = np.load(args.hybrid_probability, allow_pickle=False).astype(np.float32)
    development_manifest = json.loads((args.development_root / "experiment.json").read_text())
    heldout_manifest = json.loads((args.heldout_root / "experiment.json").read_text())
    started = time.perf_counter()
    crop_records: dict[str, object] = {}
    for label, cohort, recovery_label in CROPS:
        vector_root = args.development_root if cohort == "development" else args.heldout_root
        vector_manifest = development_manifest if cohort == "development" else heldout_manifest
        crop_record = vector_manifest["crops"][label]
        x, y, width, height = crop_record["bbox_xywh"]
        local_source = source[y : y + height, x : x + width]
        local_probability = probability[y : y + height, x : x + width]
        anchor = local_probability >= 0.50
        score_path = vector_root / label / "prototype-classifier-agreement.score.float16.npy"
        proposal = (np.load(score_path, allow_pickle=False).astype(np.float32) >= 0.80) & ~anchor
        recovery_dir = args.local_recovery_root / recovery_label
        conservative_path = recovery_dir / "conservative.additions.png"
        balanced_path = recovery_dir / "balanced.additions.png"
        conservative = load_black(conservative_path)
        balanced = load_black(balanced_path)
        tiers, components = tier_components(proposal, conservative, balanced)
        crop_dir = args.output / label
        crop_dir.mkdir(parents=True, exist_ok=True)
        tier_records: dict[str, object] = {}
        for tier, mask in tiers.items():
            path = crop_dir / f"{tier}.png"
            Image.fromarray(np.where(mask, 0, 255).astype(np.uint8), "L").save(path)
            tier_records[tier] = {
                "pixels": int(mask.sum()),
                "components": int(sum(record["tier"] == tier for record in components)),
                "p_lt_0.01_pixels": int((mask & (local_probability < 0.01)).sum()),
                "mask_pixel_sha256": sha256_array(mask.astype(np.uint8)),
                "file": path.name,
                "file_sha256": sha256_file(path),
            }
        board_path = crop_dir / "vector-proposal-tiers-review.png"
        render_board(label, local_source, anchor, proposal, tiers, board_path)
        crop_records[label] = {
            "cohort": cohort,
            "bbox_xywh": crop_record["bbox_xywh"],
            "vector_score_file": str(score_path),
            "vector_score_file_sha256": sha256_file(score_path),
            "conservative_recovery_file": str(conservative_path),
            "conservative_recovery_file_sha256": sha256_file(conservative_path),
            "balanced_recovery_file": str(balanced_path),
            "balanced_recovery_file_sha256": sha256_file(balanced_path),
            "proposal_pixels": int(proposal.sum()),
            "proposal_components": len(components),
            "tiers": tier_records,
            "components": components,
            "review_board": {"file": board_path.name, "file_sha256": sha256_file(board_path)},
        }
    manifest = {
        "schema_version": "vector-proposal-tiers.v1",
        "experiment_status": "measurement_complete_visual_review_pending",
        "page_id": args.page_id,
        "sealed_human_evidence_used": False,
        "selection_rule": "Apply the same 10% whole-component support rule to all five frozen vector crops; use 1px-dilated independent local recovery evidence.",
        "interpretation_guardrail": "Tier is review priority, not truth. Exploratory components remain visible because independent recovery can miss valid near-erased ink; no tier is automatically owned or merged.",
        "tier_definitions": {
            "strong-conservative-supported": "vector component overlap with 1px-dilated conservative recovery >=10%",
            "likely-balanced-supported": "not strong; overlap with 1px-dilated balanced recovery >=10%",
            "exploratory-vector-only": "neither independent recovery gate reaches 10%",
        },
        "source": {"path": str(args.source), "file_sha256": sha256_file(args.source)},
        "hybrid_probability": {"path": str(args.hybrid_probability), "file_sha256": sha256_file(args.hybrid_probability)},
        "crops": crop_records,
        "runtime_seconds": time.perf_counter() - started,
    }
    manifest_path = args.output / "experiment.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print(json.dumps(manifest, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
