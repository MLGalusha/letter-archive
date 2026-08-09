#!/usr/bin/env python3
"""Gate CLAHE-Eynollah additions with independent source-recovery evidence."""

from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw


CROPS = (
    ("folded-write-to-you", 1700, 1875, 1000, 350),
    ("enough-tight", 2050, 2100, 600, 300),
    ("acknowledgement-tight", 1750, 3100, 900, 300),
)
POLICIES = (
    ("conservative-overlap-0.10", "conservative", 0.10),
    ("conservative-overlap-0.25", "conservative", 0.25),
    ("balanced-overlap-0.10", "balanced", 0.10),
    ("balanced-overlap-0.25", "balanced", 0.25),
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_mask(mask: np.ndarray) -> str:
    return hashlib.sha256(np.ascontiguousarray(mask, dtype=np.uint8).tobytes()).hexdigest()


def load_black_mask(path: Path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("L")) == 0


def admit_whole_components(
    proposal: np.ndarray, evidence: np.ndarray, minimum_overlap: float
) -> tuple[np.ndarray, list[dict[str, object]]]:
    dilated_evidence = cv2.dilate(evidence.astype(np.uint8), np.ones((3, 3), np.uint8), iterations=1) > 0
    count, labels, stats, _ = cv2.connectedComponentsWithStats(proposal.astype(np.uint8), 8)
    accepted = np.zeros_like(proposal)
    records: list[dict[str, object]] = []
    for label in range(1, count):
        component = labels == label
        pixels = int(stats[label, cv2.CC_STAT_AREA])
        overlap_pixels = int(np.logical_and(component, dilated_evidence).sum())
        overlap_fraction = overlap_pixels / max(1, pixels)
        keep = overlap_fraction >= minimum_overlap
        if keep:
            accepted |= component
        records.append(
            {
                "component_label": label,
                "bbox_xywh": [
                    int(stats[label, cv2.CC_STAT_LEFT]),
                    int(stats[label, cv2.CC_STAT_TOP]),
                    int(stats[label, cv2.CC_STAT_WIDTH]),
                    int(stats[label, cv2.CC_STAT_HEIGHT]),
                ],
                "pixels": pixels,
                "dilated_evidence_overlap_pixels": overlap_pixels,
                "dilated_evidence_overlap_fraction": overlap_fraction,
                "accepted": keep,
            }
        )
    return accepted, records


def render_panel(source_rgb: np.ndarray, anchor: np.ndarray, additions: np.ndarray) -> Image.Image:
    base = source_rgb.astype(np.float32) * 0.60 + 255.0 * 0.40
    base[anchor] = (0, 190, 205)
    base[additions] = (235, 55, 45)
    return Image.fromarray(np.clip(base, 0, 255).astype(np.uint8), "RGB")


def render_board(
    crop_name: str,
    source_rgb: np.ndarray,
    anchor: np.ndarray,
    proposal: np.ndarray,
    policy_masks: dict[str, np.ndarray],
    output: Path,
) -> None:
    ordered: list[tuple[str, np.ndarray | None]] = [
        ("source", None),
        ("full-page anchor", np.zeros_like(anchor)),
        ("ungated CLAHE-only", proposal),
        *[(label, policy_masks[label]) for label, _, _ in POLICIES],
    ]
    panel_width = 560
    panel_height = round(source_rgb.shape[0] * panel_width / source_rgb.shape[1])
    title_height = 62
    columns = 3
    rows = 3
    board = Image.new("RGB", (panel_width * columns, (panel_height + title_height) * rows), "#f3eee4")
    draw = ImageDraw.Draw(board)
    for index, (label, additions) in enumerate(ordered):
        x0 = (index % columns) * panel_width
        y0 = (index // columns) * (panel_height + title_height)
        if additions is None:
            panel = Image.fromarray(source_rgb, "RGB")
            subtitle = "unaltered acting-safe source"
        else:
            panel = render_panel(source_rgb, anchor, additions)
            subtitle = f"cyan anchor {anchor.sum():,} | red proposal {additions.sum():,} px"
        panel = panel.resize((panel_width, panel_height), Image.Resampling.LANCZOS)
        draw.text((x0 + 10, y0 + 8), f"{crop_name}: {label}", fill="#222222")
        draw.text((x0 + 10, y0 + 33), subtitle, fill="#8a2820" if additions is not None else "#555555")
        board.paste(panel, (x0, y0 + title_height))
    draw.text(
        (10, 2 * (panel_height + title_height) + 20),
        "Whole CLAHE-only components admitted by overlap with 1 px-dilated source-recovery additions.",
        fill="#333333",
    )
    board.save(output, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--preprocessing-root", required=True, type=Path)
    parser.add_argument("--local-recovery-root", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--page-id", required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()

    source_bgr = cv2.imread(str(args.source), cv2.IMREAD_COLOR)
    if source_bgr is None:
        raise SystemExit(f"Could not read {args.source}")
    source_rgb = cv2.cvtColor(source_bgr, cv2.COLOR_BGR2RGB)
    crop_records: dict[str, object] = {}
    for crop_name, x, y, width, height in CROPS:
        crop_dir = args.output / crop_name
        crop_dir.mkdir(parents=True, exist_ok=True)
        preproc_dir = args.preprocessing_root / crop_name
        recovery_dir = args.local_recovery_root / crop_name
        anchor_path = preproc_dir / "full-page-slice-p0.50.png"
        clahe_path = preproc_dir / "lab-clahe-1.5-p0.50.png"
        anchor = load_black_mask(anchor_path)
        clahe = load_black_mask(clahe_path)
        proposal = np.logical_and(clahe, ~anchor)
        source_crop_rgb = source_rgb[y : y + height, x : x + width]
        policy_masks: dict[str, np.ndarray] = {}
        policy_records: dict[str, object] = {}
        for label, evidence_profile, minimum_overlap in POLICIES:
            evidence_path = recovery_dir / f"{evidence_profile}.additions.png"
            evidence = load_black_mask(evidence_path)
            accepted, component_records = admit_whole_components(proposal, evidence, minimum_overlap)
            output_path = crop_dir / f"{label}.additions.png"
            Image.fromarray(np.where(accepted, 0, 255).astype(np.uint8), "L").save(output_path)
            policy_masks[label] = accepted
            policy_records[label] = {
                "evidence_profile": evidence_profile,
                "evidence_file": str(evidence_path),
                "evidence_file_sha256": sha256_file(evidence_path),
                "minimum_component_overlap_fraction": minimum_overlap,
                "evidence_dilation_pixels": 1,
                "accepted_pixels": int(accepted.sum()),
                "accepted_fraction_of_clahe_only": float(accepted.sum() / max(1, proposal.sum())),
                "accepted_components": int(sum(record["accepted"] for record in component_records)),
                "proposal_components": len(component_records),
                "mask_pixel_sha256": sha256_mask(accepted),
                "output_file": output_path.name,
                "output_file_sha256": sha256_file(output_path),
                "components": component_records,
            }
        board_path = crop_dir / "component-gate-review.png"
        render_board(crop_name, source_crop_rgb, anchor, proposal, policy_masks, board_path)
        crop_records[crop_name] = {
            "bbox_xywh": [x, y, width, height],
            "anchor_file": str(anchor_path),
            "anchor_file_sha256": sha256_file(anchor_path),
            "clahe_file": str(clahe_path),
            "clahe_file_sha256": sha256_file(clahe_path),
            "anchor_pixels": int(anchor.sum()),
            "clahe_only_pixels": int(proposal.sum()),
            "clahe_only_components": int(cv2.connectedComponents(proposal.astype(np.uint8), 8)[0] - 1),
            "clahe_only_mask_pixel_sha256": sha256_mask(proposal),
            "policies": policy_records,
            "review_board": {
                "file": str(board_path.relative_to(args.output)),
                "file_sha256": sha256_file(board_path),
            },
        }

    manifest = {
        "schema_version": "clahe-recovery-component-gate.v1",
        "experiment_status": "measurement_complete_visual_review_pending",
        "page_id": args.page_id,
        "sealed_human_evidence_used": False,
        "selection_rule": "Reuse the same three source bboxes frozen before crop inference; sweep two source-evidence profiles and two predeclared overlap gates.",
        "interpretation_guardrail": "Accepted pieces remain optional proposal evidence. No policy is chosen by accepted-pixel count alone, and no proposal is merged into source truth.",
        "source": {"path": str(args.source), "file_sha256": sha256_file(args.source)},
        "upstream": {
            "preprocessing_manifest": {
                "path": str(args.preprocessing_root / "experiment.json"),
                "file_sha256": sha256_file(args.preprocessing_root / "experiment.json"),
            },
            "local_recovery_manifest": {
                "path": str(args.local_recovery_root / "experiment.json"),
                "file_sha256": sha256_file(args.local_recovery_root / "experiment.json"),
            },
        },
        "algorithm": {
            "proposal": "CLAHE-Eynollah p0.50 minus full-page Eynollah p0.50",
            "component_connectivity": 8,
            "evidence": "independent hybrid-seeded source-colour/ridge local recovery additions",
            "admission": "keep whole CLAHE-only component when overlap with 1px-dilated evidence meets threshold",
            "policies": [
                {"label": label, "evidence_profile": profile, "minimum_overlap_fraction": threshold}
                for label, profile, threshold in POLICIES
            ],
        },
        "crops": crop_records,
        "runtime": {"wall_seconds": time.perf_counter() - started, "device": "CPU"},
    }
    manifest_path = args.output / "experiment.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print(json.dumps(manifest, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
