#!/usr/bin/env python3
"""Compare acting-safe Kraken-to-exact-ink word ownership proposals."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
import time
from typing import Any, Mapping

import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from word_envelope.component_assignment import (  # noqa: E402
    exclusive_component_assignment,
    score_component_locators,
)
from word_envelope.io_utils import canonical_json_bytes, sha256_file  # noqa: E402
from word_envelope.line_word_assignment import (  # noqa: E402
    assign_components_to_lines,
    assign_line_components_by_boundaries,
    build_line_frames,
    ink_valley_boundaries,
    locator_strip_assignment,
    midpoint_boundaries,
)
from word_envelope.provisional_ownership_ledger import (  # noqa: E402
    PALETTES,
    ProvisionalOwnershipLedger,
)
from word_envelope.simple_page_selector import SimplePageSelector  # noqa: E402


SCHEMA = "kraken-word-prefill-experiment.v1"
TOKEN_PATTERN = re.compile(r"\S+")


def load_object(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text("utf-8"))
    if not isinstance(value, dict):
        raise RuntimeError(f"{path} must contain one JSON object")
    return value


def record_hash(value: Mapping[str, Any], key: str) -> str:
    basis = dict(value)
    basis.pop(key, None)
    return hashlib.sha256(canonical_json_bytes(basis)).hexdigest()


def color_rgb(value: str) -> tuple[int, int, int]:
    return tuple(int(value[index : index + 2], 16) for index in (1, 3, 5))


def point_xy(raw: Any) -> tuple[float, float]:
    if isinstance(raw, Mapping):
        return float(raw["x"]), float(raw["y"])
    return float(raw[0]), float(raw[1])


def line_centerline(line: Mapping[str, Any]) -> dict[str, float]:
    points = [point_xy(point) for point in line["baseline"]]
    x = np.asarray([point[0] for point in points], dtype=np.float64)
    y = np.asarray([point[1] for point in points], dtype=np.float64)
    if len(points) < 2 or float(np.ptp(x)) < 1.0:
        slope = 0.0
        intercept = float(np.mean(y))
    else:
        slope, intercept = np.polyfit(x, y, 1)
    boundary = [point_xy(point) for point in line["boundary"]]
    boundary_height = max(point[1] for point in boundary) - min(point[1] for point in boundary)
    return {
        "slope": float(slope),
        "intercept": float(intercept),
        "scale_px": max(12.0, float(boundary_height) / 2.0),
    }


def recognition_word_locators(
    recognition: Mapping[str, Any],
    layout: Mapping[str, Any],
    size_wh: tuple[int, int],
) -> tuple[list[dict[str, Any]], dict[str, dict[str, float]]]:
    width, height = size_wh
    lines = {str(line["id"]): line for line in layout["lines"]}
    locators: list[dict[str, Any]] = []
    centerlines: dict[str, dict[str, float]] = {}
    for line_order, record in enumerate(recognition["records"], start=1):
        line_id = str(record["segmentId"])
        if line_id not in lines:
            raise RuntimeError(f"Recognition line {line_id} has no layout line")
        text = str(record["text"])
        cuts = record["cuts"]
        if len(cuts) != len(text):
            raise RuntimeError(
                f"{line_id} has {len(text)} text codepoints but {len(cuts)} cuts"
            )
        line = lines[line_id]
        boundary = [point_xy(point) for point in line["boundary"]]
        boundary_x = [point[0] for point in boundary]
        boundary_y = [point[1] for point in boundary]
        cut_x = [float(np.mean([point_xy(point)[0] for point in cut])) for cut in cuts]
        if not cut_x:
            continue
        centerlines[line_id] = line_centerline(line)
        word_order = 0
        for token in TOKEN_PATTERN.finditer(text):
            word_order += 1
            start, end = token.span()
            left = (
                (cut_x[start - 1] + cut_x[start]) / 2.0
                if start > 0
                else min(boundary_x)
            )
            right = (
                (cut_x[end - 1] + cut_x[end]) / 2.0
                if end < len(cut_x)
                else max(boundary_x)
            )
            if right <= left:
                token_x = [point_xy(point)[0] for cut in cuts[start:end] for point in cut]
                left, right = min(token_x), max(token_x) + 1.0
            x0 = max(0, int(np.floor(left)))
            x1 = min(width, max(x0 + 1, int(np.ceil(right))))
            y0 = max(0, int(np.floor(min(boundary_y))))
            y1 = min(height, max(y0 + 1, int(np.ceil(max(boundary_y)))))
            locators.append(
                {
                    "unit_id": f"{line_id}-word-{word_order:03d}",
                    "line_id": line_id,
                    "line_order": line_order,
                    "word_order": word_order,
                    "reference_text": token.group(0),
                    "bbox_xywh": [x0, y0, x1 - x0, y1 - y0],
                    "recognition_mean_confidence": float(record["meanConfidence"]),
                    "recognition_character_span": [start, end],
                }
            )
    return locators, centerlines


def assignment_metrics(
    assignment: Mapping[str, Any],
    components: list[Mapping[str, Any]],
    locator_count: int,
) -> dict[str, Any]:
    areas = {int(row["component_id"]): int(row["area_px"]) for row in components}
    assigned = {
        int(component_id)
        for component_ids in assignment["component_ids_by_unit"].values()
        for component_id in component_ids
    }
    ambiguous = {
        int(row["component_id"]) for row in assignment.get("ambiguous_components", [])
    }
    known = set(areas)
    residual = known - assigned
    return {
        "word_slots": locator_count,
        "nonempty_word_slots": sum(
            bool(values) for values in assignment["component_ids_by_unit"].values()
        ),
        "assigned_components": len(assigned),
        "assigned_pixels": sum(areas[value] for value in assigned),
        "ambiguous_components": len(ambiguous),
        "ambiguous_pixels": sum(areas[value] for value in ambiguous),
        "residual_components": len(residual),
        "residual_pixels": sum(areas[value] for value in residual),
        "duplicate_component_assignments": sum(
            len(values) for values in assignment["component_ids_by_unit"].values()
        )
        - len(assigned),
    }


def render_review(
    path: Path,
    source: np.ndarray,
    labels: np.ndarray,
    locators: list[Mapping[str, Any]],
    assignment: Mapping[str, Any],
) -> None:
    unit_by_id = {str(unit["unit_id"]): unit for unit in locators}
    owner = np.zeros(labels.shape, dtype=np.uint16)
    colors = np.zeros((*labels.shape, 3), dtype=np.uint8)
    for owner_label, (unit_id, component_ids) in enumerate(
        assignment["component_ids_by_unit"].items(), start=1
    ):
        unit = unit_by_id[unit_id]
        color = PALETTES[(int(unit["line_order"]) - 1) % 2][
            (int(unit["word_order"]) - 1) % len(PALETTES[0])
        ]
        chosen = np.isin(labels, component_ids)
        owner[chosen] = owner_label
        colors[chosen] = color_rgb(color)
    assigned = owner > 0
    ambiguous_ids = {
        int(row["component_id"]) for row in assignment.get("ambiguous_components", [])
    }
    ambiguous = np.isin(labels, list(ambiguous_ids)) if ambiguous_ids else np.zeros(labels.shape, bool)
    residual = (labels > 0) & ~assigned & ~ambiguous
    source_panel = source.copy()
    source_panel[assigned] = (
        source_panel[assigned].astype(np.uint16) * 28 // 100
        + colors[assigned].astype(np.uint16) * 72 // 100
    ).astype(np.uint8)
    source_panel[ambiguous] = (217, 145, 27)
    source_panel[residual] = (
        source_panel[residual].astype(np.uint16) * 45 // 100
        + np.array([78, 78, 78], dtype=np.uint16) * 55 // 100
    ).astype(np.uint8)
    ink_panel = np.full((*labels.shape, 3), 250, dtype=np.uint8)
    ink_panel[residual] = (92, 92, 92)
    ink_panel[ambiguous] = (217, 145, 27)
    ink_panel[assigned] = colors[assigned]
    preview_wh = (855, 1200)
    left = Image.fromarray(source_panel).resize(preview_wh, Image.Resampling.LANCZOS)
    right = Image.fromarray(ink_panel).resize(preview_wh, Image.Resampling.NEAREST)
    canvas = Image.new("RGB", (1730, 1260), (246, 240, 230))
    canvas.paste(left, (0, 60))
    canvas.paste(right, (875, 60))
    draw = ImageDraw.Draw(canvas)
    draw.text((16, 20), "Kraken proposal on source · exact whole components", fill=(25, 25, 25))
    draw.text((890, 20), "word colors · amber ambiguous · gray residual", fill=(25, 25, 25))
    canvas.save(path, format="JPEG", quality=93, optimize=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--selector-dir", type=Path, required=True)
    parser.add_argument("--recognition", type=Path, required=True)
    parser.add_argument("--layout", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--ledger-dir", type=Path)
    parser.add_argument("--selected-method", default="line_locator_strip")
    args = parser.parse_args()
    started = time.perf_counter()
    output = args.output_dir.resolve()
    if output.exists() or output.is_symlink():
        raise SystemExit(f"Output already exists: {output}")
    output.mkdir(parents=True)

    selector = SimplePageSelector(args.selector_dir)
    clean = selector._ink_mask("clean")
    source_path = selector.session_dir / selector.manifest["source"]["working_path"]
    with Image.open(source_path) as image:
        source = np.asarray(image.convert("RGB"), dtype=np.uint8)
    recognition = load_object(args.recognition.resolve())
    layout = load_object(args.layout.resolve())
    if layout["image"]["width"] != selector.size_wh[0] or layout["image"]["height"] != selector.size_wh[1]:
        raise RuntimeError("Kraken and selector coordinate spaces differ")
    prepared_path = Path(recognition["source"]["imagePath"])
    with Image.open(prepared_path) as image:
        prepared = np.asarray(image.convert("RGB"), dtype=np.uint8)
    if not np.array_equal(prepared, source):
        raise RuntimeError("Kraken prepared pixels do not exactly match selector source pixels")

    locators, centerlines = recognition_word_locators(
        recognition, layout, tuple(selector.size_wh)
    )
    scored = score_component_locators(clean, locators)
    unit_groups = {str(unit["unit_id"]): str(unit["line_id"]) for unit in locators}
    global_assignment = exclusive_component_assignment(
        scored,
        minimum_score=0.12,
        minimum_score_margin=0.08,
        unit_groups=unit_groups,
        cross_group_minimum_score_margin=0.04,
    )
    framed = build_line_frames(scored["components"], locators, centerlines)
    line_assignments = assign_components_to_lines(
        framed,
        maximum_spacing_fraction=0.52,
        minimum_normalized_margin=0.05,
        x_padding_px=100.0,
    )
    strip = locator_strip_assignment(framed, line_assignments, minimum_score_margin=0.08)
    strip["ambiguous_components"] = [
        *line_assignments["ambiguous_components"],
        *strip["ambiguous_components"],
    ]
    midpoint_by_line = {
        line_id: midpoint_boundaries(frame)
        for line_id, frame in framed["frames"].items()
    }
    midpoint = assign_line_components_by_boundaries(
        framed,
        line_assignments,
        midpoint_by_line,
        abstain_on_boundary_crossing=True,
        minimum_boundary_clearance_px=1.0,
    )
    midpoint["ambiguous_components"] = [
        *line_assignments["ambiguous_components"],
        *midpoint["ambiguous_components"],
    ]
    valley_by_line = {
        line_id: ink_valley_boundaries(
            clean,
            frame,
            midpoint_by_line[line_id],
            band_half_height_px=max(32.0, float(frame["scale_px"]) * 1.35),
        )
        for line_id, frame in framed["frames"].items()
    }
    valley = assign_line_components_by_boundaries(
        framed,
        line_assignments,
        valley_by_line,
        abstain_on_boundary_crossing=True,
        minimum_boundary_clearance_px=1.0,
    )
    valley["ambiguous_components"] = [
        *line_assignments["ambiguous_components"],
        *valley["ambiguous_components"],
    ]
    methods = {
        "global_exclusive_boxes": global_assignment,
        "line_locator_strip": strip,
        "line_midpoint_strict": midpoint,
        "line_ink_valley_strict": valley,
    }
    if args.selected_method not in methods:
        raise RuntimeError(f"Unknown selected method: {args.selected_method}")
    metrics = {
        name: assignment_metrics(method, scored["components"], len(locators))
        for name, method in methods.items()
    }
    for name, method in methods.items():
        if metrics[name]["duplicate_component_assignments"]:
            raise RuntimeError(f"{name} assigned one component twice")
        render_review(output / f"{name}.review.jpg", source, scored["labels"], locators, method)

    selected = methods[args.selected_method]
    ambiguous_ids = sorted(
        {int(row["component_id"]) for row in selected.get("ambiguous_components", [])}
    )
    words = [
        {
            "word_id": str(unit["unit_id"]),
            "line_id": str(unit["line_id"]),
            "line_order": int(unit["line_order"]),
            "word_order": int(unit["word_order"]),
            "reference_text": unit["reference_text"],
            "component_ids": selected["component_ids_by_unit"][unit["unit_id"]],
            "provenance": {
                "kind": "kraken_recognition_locator_prefill",
                "recognition_mean_confidence": unit["recognition_mean_confidence"],
                "rough_bbox_xywh": unit["bbox_xywh"],
            },
        }
        for unit in locators
    ]
    ledger_root = (
        args.ledger_dir.resolve()
        if args.ledger_dir is not None
        else output / "ownership-ledger"
    )
    ledger = ProvisionalOwnershipLedger.initialize(
        ledger_root,
        selector.session_dir,
        words,
        ambiguous_component_ids=ambiguous_ids,
        provenance={
            "evidence_role": "acting_only_software_prefill",
            "selected_method": args.selected_method,
            "recognition_path": str(args.recognition.resolve()),
            "recognition_file_sha256": sha256_file(args.recognition.resolve()),
            "layout_path": str(args.layout.resolve()),
            "layout_file_sha256": sha256_file(args.layout.resolve()),
        },
    )
    validation = ledger.validate()
    if validation["violation_count"]:
        raise RuntimeError(f"Ledger validation failed: {validation['violations']}")

    report = {
        "schema_version": SCHEMA,
        "evidence_role": "acting_only_software_prefill",
        "page_id": selector.manifest["page_id"],
        "selector": {
            "session_dir": str(selector.session_dir),
            "manifest_sha256": selector.manifest["manifest_sha256"],
            "source_file_sha256": sha256_file(source_path),
            "clean_mask_pixel_sha256": ledger._manifest["clean_mask_pixel_sha256"],
        },
        "kraken": {
            "recognition_path": str(args.recognition.resolve()),
            "recognition_file_sha256": sha256_file(args.recognition.resolve()),
            "layout_path": str(args.layout.resolve()),
            "layout_file_sha256": sha256_file(args.layout.resolve()),
            "prepared_pixels_exactly_match_selector_source": True,
        },
        "counts": {
            "recognition_lines": len(recognition["records"]),
            "word_slots": len(locators),
            "clean_components": len(scored["components"]),
            "clean_pixels": int(clean.sum()),
        },
        "methods": metrics,
        "selected_method": args.selected_method,
        "selected_ledger_dir": str(ledger_root),
        "selected_ledger_validation": validation,
        "review_artifacts": {
            name: {
                "path": f"{name}.review.jpg",
                "file_sha256": sha256_file(output / f"{name}.review.jpg"),
            }
            for name in methods
        },
        "timing_ms": round((time.perf_counter() - started) * 1000.0, 3),
    }
    report["experiment_sha256"] = record_hash(report, "experiment_sha256")
    (output / "experiment.json").write_bytes(canonical_json_bytes(report) + b"\n")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
