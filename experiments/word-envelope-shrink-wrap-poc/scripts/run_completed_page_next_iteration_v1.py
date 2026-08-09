#!/usr/bin/env python3
"""Run recovery and fragmented-envelope experiments on one frozen selector page."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from typing import Any

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from word_envelope.fragmented_envelope import (  # noqa: E402
    fit_fragmented_envelope,
    refine_existing_envelope,
)
from word_envelope.io_utils import (  # noqa: E402
    canonical_json_bytes,
    sha256_file,
    sha256_mask_pixels,
)
from word_envelope.local_ink_recovery import recover_local_ink_candidates  # noqa: E402
from word_envelope.simple_page_selector import SimplePageSelector  # noqa: E402


RECOVERY_FIXTURES = ((105, 1), (97, 2))
ANNOTATED_ENVELOPE_WORDS = (2, 3, 13, 18, 19, 22, 30, 37, 47, 77, 97, 101, 105)


def _json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text())
    if not isinstance(value, dict):
        raise RuntimeError(f"Expected one JSON object: {path}")
    return value


def _save_mask(path: Path, mask: np.ndarray) -> dict[str, Any]:
    Image.fromarray(np.where(mask, 255, 0).astype(np.uint8), mode="L").save(
        path,
        format="PNG",
    )
    return {
        "path": path.name,
        "file_sha256": sha256_file(path),
        "pixel_sha256": sha256_mask_pixels(mask),
        "pixels": int(mask.sum()),
    }


def _overlay_candidate(
    source: np.ndarray,
    anchor: np.ndarray,
    additions: np.ndarray,
) -> Image.Image:
    result = source.copy()
    result[anchor] = (
        result[anchor].astype(np.float32) * 0.30
        + np.array([25, 181, 101], dtype=np.float32) * 0.70
    ).astype(np.uint8)
    result[additions] = (
        result[additions].astype(np.float32) * 0.20
        + np.array([241, 139, 32], dtype=np.float32) * 0.80
    ).astype(np.uint8)
    return Image.fromarray(result, mode="RGB")


def _labelled_board(panels: list[tuple[str, Image.Image]]) -> Image.Image:
    width = max(panel.width for _label, panel in panels)
    height = max(panel.height for _label, panel in panels)
    label_height = 34
    board = Image.new("RGB", (width * len(panels), height + label_height), "white")
    drawing = ImageDraw.Draw(board)
    for index, (label, panel) in enumerate(panels):
        x = index * width
        board.paste(panel, (x, label_height))
        drawing.text((x + 8, 9), label, fill=(30, 30, 30))
    return board


def _full_word_mask(selector: SimplePageSelector, word: dict[str, Any]) -> np.ndarray:
    return selector._word_mask(word)


def _draw_polygon(image: Image.Image, polygon: list[list[float]], colour: tuple[int, int, int], width: int = 3) -> None:
    if len(polygon) < 3:
        return
    drawing = ImageDraw.Draw(image)
    points = [(round(x), round(y)) for x, y in polygon]
    drawing.line(points + [points[0]], fill=colour, width=width, joint="curve")


def _crop_with_padding(
    bbox: list[int],
    source_size: tuple[int, int],
    padding: int,
) -> list[int]:
    x, y, width, height = bbox
    source_width, source_height = source_size
    x0 = max(0, x - padding)
    y0 = max(0, y - padding)
    x1 = min(source_width, x + width + padding)
    y1 = min(source_height, y + height + padding)
    return [x0, y0, x1 - x0, y1 - y0]


def run(run_dir: Path, output_dir: Path) -> dict[str, Any]:
    run_dir = run_dir.resolve()
    output_dir = output_dir.resolve()
    if output_dir.exists() or output_dir.is_symlink():
        raise RuntimeError("Experiment output already exists")
    selector = SimplePageSelector(run_dir)
    bootstrap = selector.bootstrap()
    state = bootstrap["state"]
    if state["status"] != "complete":
        raise RuntimeError("The selector page must be complete and frozen")
    notes_binding = state.get("page_notes")
    if not isinstance(notes_binding, dict):
        raise RuntimeError("The completed page has no bound notes")
    notes_path = run_dir / notes_binding["path"]
    if sha256_file(notes_path) != notes_binding["file_sha256"]:
        raise RuntimeError("Page notes changed after completion")
    notes = _json(notes_path)
    source_path = run_dir / selector.manifest["source"]["working_path"]
    if sha256_file(source_path) != selector.manifest["source"]["working_file_sha256"]:
        raise RuntimeError("Source working image changed after completion")
    with Image.open(source_path) as opened:
        source = np.asarray(opened.convert("RGB"), dtype=np.uint8)
    claimed = selector._claimed(state)

    output_dir.mkdir(parents=True)
    recovery_root = output_dir / "recovery"
    envelope_root = output_dir / "envelopes"
    recovery_root.mkdir()
    envelope_root.mkdir()
    word_by_number = {int(word["word_number"]): word for word in state["words"]}

    recovery_records = []
    for word_number, note_number in RECOVERY_FIXTURES:
        word = word_by_number[word_number]
        note = notes["items"][note_number - 1]
        bbox = [int(value) for value in note["bbox_xywh"]]
        anchor = _full_word_mask(selector, word)
        forbidden = claimed & ~anchor
        recovered = recover_local_ink_candidates(source, anchor, forbidden, bbox)
        x, y, width, height = bbox
        local_source = source[y : y + height, x : x + width]
        local_anchor = anchor[y : y + height, x : x + width]
        fixture_dir = recovery_root / f"word-{word_number:03d}"
        fixture_dir.mkdir()
        panels = [("Original", Image.fromarray(local_source, mode="RGB"))]
        candidate_records: dict[str, Any] = {}
        for name, candidate in recovered["candidates"].items():
            mask_record = _save_mask(fixture_dir / f"{name}.mask.png", candidate["mask"])
            additions_record = _save_mask(
                fixture_dir / f"{name}.additions.mask.png",
                candidate["additions"],
            )
            overlay = _overlay_candidate(
                local_source,
                local_anchor,
                candidate["additions"],
            )
            overlay_path = fixture_dir / f"{name}.overlay.png"
            overlay.save(overlay_path, format="PNG")
            panels.append((name.replace("_", " ").title(), overlay))
            candidate_records[name] = {
                **{key: value for key, value in candidate.items() if key not in {"mask", "additions"}},
                "mask": mask_record,
                "additions": additions_record,
                "overlay_path": overlay_path.name,
                "overlay_file_sha256": sha256_file(overlay_path),
            }
        board = _labelled_board(panels)
        board_path = fixture_dir / "comparison-board.png"
        board.save(board_path, format="PNG")
        recovery_records.append(
            {
                "word_number": word_number,
                "note_number": note_number,
                "note_text": note["text"],
                "note_crop_file_sha256": note["crop_file_sha256"],
                "crop_bbox_xywh": bbox,
                "anchor_selected_pixels": int(anchor.sum()),
                "anchor_selected_component_count": word["selected_source_component_count"],
                "features": recovered["features"],
                "candidates": candidate_records,
                "comparison_board_path": str(board_path.relative_to(output_dir)),
                "comparison_board_file_sha256": sha256_file(board_path),
            }
        )

    envelope_records = []
    for word_number in ANNOTATED_ENVELOPE_WORDS:
        word = word_by_number[word_number]
        selected_full = _full_word_mask(selector, word)
        padding = max(36, min(120, round(max(word["selection_bbox_xywh"][2:]) * 0.22)))
        bbox = _crop_with_padding(
            word["selection_bbox_xywh"],
            selector.size_wh,
            padding,
        )
        x, y, width, height = bbox
        selected = selected_full[y : y + height, x : x + width]
        excluded = (claimed & ~selected_full)[y : y + height, x : x + width]
        local_source = source[y : y + height, x : x + width]
        fixture_dir = envelope_root / f"word-{word_number:03d}"
        fixture_dir.mkdir()

        existing = Image.fromarray(local_source, mode="RGB")
        existing_polygon = [
            [float(px) - x, float(py) - y]
            for px, py in word["envelope_polygon"]
        ]
        if word["fit_method"] == "selected_pixel_bbox":
            fitted = fit_fragmented_envelope(selected, excluded)
            experiment_method = "component_tree_for_fragmented_fallback"
        else:
            fitted = refine_existing_envelope(
                selected,
                existing_polygon,
                excluded,
            )
            experiment_method = "smooth_and_pad_existing_accepted_topology"
        _draw_polygon(existing, existing_polygon, (210, 45, 45), 3)
        panels = [(f"Existing: {word['fit_method']}", existing)]
        candidates: dict[str, Any] = {}
        for name, candidate in fitted["candidates"].items():
            preview = Image.fromarray(local_source, mode="RGB")
            _draw_polygon(preview, candidate["polygon"], (13, 137, 151), 3)
            panels.append((name.title(), preview))
            region_record = _save_mask(
                fixture_dir / f"{name}.region.mask.png",
                candidate["region"],
            )
            candidates[name] = {
                **{key: value for key, value in candidate.items() if key != "region"},
                "region": region_record,
                "source_polygon": [
                    [round(float(px) + x, 3), round(float(py) + y, 3)]
                    for px, py in candidate["polygon"]
                ],
            }
        board = _labelled_board(panels)
        board_path = fixture_dir / "comparison-board.png"
        board.save(board_path, format="PNG")
        envelope_records.append(
            {
                "word_number": word_number,
                "crop_bbox_xywh": bbox,
                "existing": {
                    "fit_method": word["fit_method"],
                    "fit_quality": word["fit_quality"],
                    "envelope_metrics": word["envelope_metrics"],
                },
                "experiment_method": experiment_method,
                "selected_pixels": fitted["selected_pixels"],
                "selected_component_count": fitted["selected_component_count"],
                "stroke_width_px": fitted["stroke_width_px"],
                "candidates": candidates,
                "comparison_board_path": str(board_path.relative_to(output_dir)),
                "comparison_board_file_sha256": sha256_file(board_path),
            }
        )

    manifest: dict[str, Any] = {
        "schema_version": "completed-page-next-iteration-experiment.v2",
        "status": "candidate_geometry_and_source_pixel_proposals_not_truth",
        "source": {
            "path": str(source_path),
            "file_sha256": sha256_file(source_path),
            "size_wh": list(selector.size_wh),
        },
        "frozen_run": {
            "path": str(run_dir),
            "manifest_sha256": selector.manifest["manifest_sha256"],
            "head_revision": state["revision"],
            "head_state_sha256": state["state_sha256"],
            "word_count": state["word_count"],
            "claimed_mask_pixel_sha256": state["assets"]["claimed_mask"]["pixel_sha256"],
            "notes_file_sha256": notes_binding["file_sha256"],
            "notes_sha256": notes_binding["notes_sha256"],
        },
        "invariants": {
            "frozen_run_not_modified": True,
            "recovery_additions_are_source_positions_not_generated_ink": True,
            "recovery_never_owns_forbidden_existing_words": True,
            "envelope_geometry_bridges_are_never_added_to_owned_ink": True,
            "all_envelope_candidates_cover_all_selected_ink": True,
        },
        "implementation_bindings": {
            "local_ink_recovery": {
                "path": "src/word_envelope/local_ink_recovery.py",
                "file_sha256": sha256_file(
                    ROOT / "src/word_envelope/local_ink_recovery.py"
                ),
            },
            "fragmented_envelope": {
                "path": "src/word_envelope/fragmented_envelope.py",
                "file_sha256": sha256_file(
                    ROOT / "src/word_envelope/fragmented_envelope.py"
                ),
            },
            "experiment_runner": {
                "path": "scripts/run_completed_page_next_iteration_v1.py",
                "file_sha256": sha256_file(Path(__file__).resolve()),
            },
        },
        "promotion_policy": {
            "local_recovery_default": "conservative_visible_proposal",
            "local_recovery_profiles_remain_user_or_agent_choices": True,
            "fragmented_fallback_default": "balanced_if_zero_owned_word_contamination_else_compact",
            "accepted_envelope_refinement_default": "balanced_if_zero_owned_word_contamination_else_compact",
            "maximum_recall_never_automatic": True,
        },
        "recovery_fixtures": recovery_records,
        "envelope_fixtures": envelope_records,
    }
    manifest["manifest_sha256"] = __import__("hashlib").sha256(
        canonical_json_bytes(manifest)
    ).hexdigest()
    manifest_path = output_dir / "manifest.json"
    manifest_path.write_bytes(canonical_json_bytes(manifest))
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    arguments = parser.parse_args()
    result = run(arguments.run_dir, arguments.output_dir)
    print(result["manifest_sha256"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
