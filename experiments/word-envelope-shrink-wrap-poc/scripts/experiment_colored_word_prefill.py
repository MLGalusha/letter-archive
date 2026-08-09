#!/usr/bin/env python3
"""Render acting-safe provisional word ownership as distinct exact-ink colors."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys
import time

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from word_envelope.io_utils import canonical_json_bytes, sha256_file  # noqa: E402


SCHEMA = "colored-word-ownership-prefill-experiment.v1"
PALETTES = (
    ("#D43D51", "#E57A1F", "#D4A000", "#43A047", "#008C95", "#2474D2", "#7357C7", "#B43FA8"),
    ("#8B1E3F", "#B85C00", "#8A7300", "#167A4A", "#006A80", "#174EA6", "#51349B", "#8A267F"),
)


def record_hash(value: dict, key: str) -> str:
    basis = dict(value)
    basis.pop(key, None)
    return hashlib.sha256(canonical_json_bytes(basis)).hexdigest()


def load_json(path: Path) -> dict:
    value = json.loads(path.read_text("utf-8"))
    if not isinstance(value, dict):
        raise RuntimeError(f"{path.name} must contain one object")
    return value


def rgb(value: str) -> tuple[int, int, int]:
    return tuple(int(value[index : index + 2], 16) for index in (1, 3, 5))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--frozen-candidates",
        type=Path,
        default=ROOT / "artifacts/line-coordinate-word-ownership-v3/007-p02-body77-spacing-fixed/frozen-acting-candidates.json",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=ROOT / "artifacts/colored-word-ownership-prefill-v1/007-p02-line-rough-span",
    )
    args = parser.parse_args()
    frozen_path = args.frozen_candidates.resolve()
    output = args.output_dir.resolve()
    if output.exists() or output.is_symlink():
        raise SystemExit(f"Output already exists: {output}")

    started = time.perf_counter()
    frozen = load_json(frozen_path)
    if not str(frozen.get("evidence_role", "")).startswith("acting"):
        raise RuntimeError("The candidate file is not acting-only evidence")
    matches = [
        row
        for row in frozen.get("configurations", [])
        if row.get("locator") == "transcript_bbox_xywh"
        and row.get("policy") == "line_locator_strip"
    ]
    if len(matches) != 1:
        raise RuntimeError("Expected exactly one transcript line + rough span configuration")
    configuration = matches[0]

    clean_input = frozen["inputs"]["clean_mask"]
    source_input = frozen["inputs"]["source"]
    clean_path = (ROOT / clean_input["path"]).resolve()
    source_path = Path(source_input["path"]).resolve()
    if sha256_file(clean_path) != clean_input["file_sha256"]:
        raise RuntimeError("The frozen Clean mask changed")
    if sha256_file(source_path) != source_input["file_sha256"]:
        raise RuntimeError("The frozen source image changed")
    with Image.open(clean_path) as image:
        clean = np.asarray(image.convert("L"), dtype=np.uint8) > 0
    with Image.open(source_path) as image:
        source = np.asarray(image.convert("RGB"), dtype=np.uint8)
    if clean.shape != source.shape[:2]:
        raise RuntimeError("The source and Clean mask dimensions differ")

    labels, component_count = ndimage.label(
        clean,
        structure=np.ones((3, 3), dtype=np.uint8),
    )
    labels = labels.astype(np.int32, copy=False)
    owner = np.zeros(clean.shape, dtype=np.uint16)
    color_pixels = np.zeros((*clean.shape, 3), dtype=np.uint8)
    words: list[dict] = []
    used_components: dict[int, str] = {}
    color_by_unit: dict[str, str] = {}
    line_palettes: dict[int, set[str]] = {}
    adjacent_same_color_violations: list[list[str]] = []
    by_line: dict[int, list[dict]] = {}
    for label_index, item in enumerate(configuration["items"], start=1):
        unit_id = str(item["unit_id"])
        line_order = int(item["line_order"])
        word_order = int(item["word_order"])
        color_hex = PALETTES[(line_order - 1) % 2][(word_order - 1) % len(PALETTES[0])]
        color_by_unit[unit_id] = color_hex
        line_palettes.setdefault(line_order, set()).add(color_hex)
        component_ids = [int(value) for value in item["selected_component_ids"]]
        for component_id in component_ids:
            if not 1 <= component_id <= component_count:
                raise RuntimeError(f"{unit_id} names unknown component {component_id}")
            previous = used_components.get(component_id)
            if previous is not None:
                raise RuntimeError(f"Component {component_id} belongs to both {previous} and {unit_id}")
            used_components[component_id] = unit_id
        mask = np.isin(labels, component_ids) if component_ids else np.zeros_like(clean)
        owner[mask] = label_index
        color_pixels[mask] = rgb(color_hex)
        word = {
            "owner_label": label_index,
            "unit_id": unit_id,
            "line_id": item["line_id"],
            "line_order": line_order,
            "word_order": word_order,
            "reference_text": item.get("text"),
            "color_hex": color_hex,
            "component_ids": component_ids,
            "selected_pixels": int(mask.sum()),
            "selected_bbox_xywh": item.get("selected_bbox_xywh"),
            "fitted_envelope_polygon": item.get("envelope_polygon"),
            "fit_status": item.get("fit_status"),
            "fit_profile": item.get("fit_profile"),
        }
        words.append(word)
        by_line.setdefault(line_order, []).append(word)

    for line_words in by_line.values():
        ordered = sorted(line_words, key=lambda item: (item["word_order"], item["unit_id"]))
        for left, right in zip(ordered, ordered[1:]):
            if left["color_hex"] == right["color_hex"]:
                adjacent_same_color_violations.append([left["unit_id"], right["unit_id"]])
    adjacent_line_palette_violations = [
        [line_order, line_order + 1, sorted(line_palettes[line_order] & line_palettes[line_order + 1])]
        for line_order in sorted(line_palettes)
        if line_order + 1 in line_palettes
        and line_palettes[line_order] & line_palettes[line_order + 1]
    ]

    assigned = owner > 0
    residual = clean & ~assigned
    original_overlay = source.copy()
    original_overlay[assigned] = (
        original_overlay[assigned].astype(np.uint16) * 28 // 100
        + color_pixels[assigned].astype(np.uint16) * 72 // 100
    ).astype(np.uint8)
    original_overlay[residual] = (
        original_overlay[residual].astype(np.uint16) * 45 // 100
        + np.array([78, 78, 78], dtype=np.uint16) * 55 // 100
    ).astype(np.uint8)
    ink_panel = np.full((*clean.shape, 3), 250, dtype=np.uint8)
    ink_panel[residual] = (92, 92, 92)
    ink_panel[assigned] = color_pixels[assigned]

    output.mkdir(parents=True)
    Image.fromarray(owner, mode="I;16").save(output / "word-owner-labels.png", format="PNG")
    Image.fromarray(np.where(residual, 255, 0).astype(np.uint8), mode="L").save(
        output / "residual.mask.png",
        format="PNG",
    )
    Image.fromarray(original_overlay, mode="RGB").save(
        output / "source-colored-ownership.png",
        format="PNG",
        optimize=True,
    )
    Image.fromarray(ink_panel, mode="RGB").save(
        output / "ink-colored-ownership.png",
        format="PNG",
        optimize=True,
    )

    preview_size = (900, 1200)
    left = Image.fromarray(original_overlay, mode="RGB").resize(preview_size, Image.Resampling.LANCZOS)
    right = Image.fromarray(ink_panel, mode="RGB").resize(preview_size, Image.Resampling.NEAREST)
    canvas = Image.new("RGB", (1820, 1260), (246, 240, 230))
    canvas.paste(left, (0, 60))
    canvas.paste(right, (920, 60))
    draw = ImageDraw.Draw(canvas)
    draw.text((18, 20), "Original + provisional exact ink owners", fill=(30, 30, 30))
    draw.text((938, 20), "Editable owner colors · gray = residual/unassigned", fill=(30, 30, 30))
    canvas.save(output / "colored-prefill-review.jpg", format="JPEG", quality=93, optimize=True)

    record = {
        "schema_version": SCHEMA,
        "evidence_role": "acting_only_software_prefill",
        "source": {
            "frozen_candidates_path": frozen_path.relative_to(ROOT).as_posix(),
            "frozen_candidates_file_sha256": sha256_file(frozen_path),
            "frozen_candidate_set_sha256": frozen["frozen_candidate_set_sha256"],
            "configuration_label": configuration["label"],
            "configuration_locator": configuration["locator"],
            "configuration_policy": configuration["policy"],
            "source_file_sha256": source_input["file_sha256"],
            "clean_mask_file_sha256": clean_input["file_sha256"],
        },
        "color_policy": {
            "line_palette_period": 2,
            "word_palette_period": len(PALETTES[0]),
            "adjacent_lines_use_disjoint_palettes": True,
            "line_three_may_reuse_line_one": True,
            "palettes": [list(palette) for palette in PALETTES],
        },
        "counts": {
            "word_slots": len(words),
            "nonempty_word_slots": sum(bool(word["selected_pixels"]) for word in words),
            "clean_components": int(component_count),
            "assigned_components": len(used_components),
            "clean_pixels": int(clean.sum()),
            "assigned_pixels": int(assigned.sum()),
            "residual_pixels": int(residual.sum()),
            "adjacent_same_color_violations": len(adjacent_same_color_violations),
            "adjacent_line_palette_violations": len(adjacent_line_palette_violations),
        },
        "violations": {
            "adjacent_same_color": adjacent_same_color_violations,
            "adjacent_line_palette": adjacent_line_palette_violations,
        },
        "words": words,
        "artifacts": {
            name: {"path": name, "file_sha256": sha256_file(output / name)}
            for name in (
                "word-owner-labels.png",
                "residual.mask.png",
                "source-colored-ownership.png",
                "ink-colored-ownership.png",
                "colored-prefill-review.jpg",
            )
        },
        "timing_ms": round((time.perf_counter() - started) * 1000, 3),
    }
    record["experiment_sha256"] = record_hash(record, "experiment_sha256")
    (output / "experiment.json").write_bytes(canonical_json_bytes(record) + b"\n")
    print(json.dumps({"output": str(output), **record["counts"], "timing_ms": record["timing_ms"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
