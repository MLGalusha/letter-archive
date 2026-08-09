"""Deterministic synthetic feasibility cases and galleries."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw

from .engine import EnvelopeParams
from .io_utils import (
    CLEANUP_SCHEMA_VERSION,
    CROP_SCHEMA_VERSION,
    check_rss,
    sha256_file,
    sha256_image_pixels,
    sha256_mask_pixels,
    write_json,
)
from .masks import apply_cleanup_operations, save_mask, stable_components
from .records import build_example
from .render import save_contact_sheet, save_method_comparison


WIDTH = 520
HEIGHT = 180
ROUGH_BOX = (0.0, 0.0, float(WIDTH), float(HEIGHT))


@dataclass(frozen=True)
class SyntheticCase:
    case_id: str
    description: str
    raw_mask: np.ndarray
    operations: dict[str, Any]
    params: EnvelopeParams
    preferred_method: str = "morphological"
    excluded_mask: np.ndarray | None = None
    assessment_status: str = "success"


def generate_synthetic_suite(output_dir: Path) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    cases = _cases()
    summaries: list[dict[str, Any]] = []
    gallery_rows: list[tuple[str, Path]] = []
    method_rows: list[tuple[str, Path]] = []
    for case_index, case in enumerate(cases):
        check_rss(f"synthetic case {case.case_id}")
        case_root = output_dir / case.case_id
        (case_root / "method-comparison.png").unlink(missing_ok=True)
        inputs = case_root / "inputs"
        results_root = case_root / "results"
        inputs.mkdir(parents=True, exist_ok=True)
        cleaned_mask, cleanup_log = apply_cleanup_operations(
            case.raw_mask, case.operations
        )
        excluded_mask = (
            case.excluded_mask
            if case.excluded_mask is not None
            else case.raw_mask & ~cleaned_mask
        )
        crop = _paper_image(case.raw_mask, seed=case_index)
        crop_path = inputs / "crop.png"
        raw_path = inputs / "raw-mask.png"
        cleaned_path = inputs / "cleaned-mask.png"
        excluded_path = inputs / "excluded-mask.png"
        operations_path = inputs / "operations.json"
        metadata_path = inputs / "crop.json"
        crop.save(crop_path, format="PNG", compress_level=9, optimize=False)
        save_mask(raw_path, case.raw_mask)
        save_mask(cleaned_path, cleaned_mask)
        save_mask(excluded_path, excluded_mask)
        write_json(operations_path, case.operations)
        write_json(
            metadata_path,
            {
                "schema_version": CROP_SCHEMA_VERSION,
                "source": {
                    "path": str(crop_path.resolve()),
                    "sha256": sha256_file(crop_path),
                    "pixel_sha256": sha256_image_pixels(crop),
                    "width_px": WIDTH,
                    "height_px": HEIGHT,
                    "kind": "deterministic_synthetic_crop",
                },
                "crop": {
                    "path": str(crop_path.resolve()),
                    "sha256": sha256_file(crop_path),
                    "pixel_sha256": sha256_image_pixels(crop),
                    "x": 0,
                    "y": 0,
                    "width_px": WIDTH,
                    "height_px": HEIGHT,
                    "requested_box_xywh": [0, 0, WIDTH, HEIGHT],
                    "padding_px": 0,
                },
                "transform": {
                    "type": "crop-edge-translation-v1",
                    "crop_to_source": {"translate_x": 0, "translate_y": 0},
                    "source_to_crop": {"translate_x": 0, "translate_y": 0},
                },
            },
        )

        successes: dict[str, dict[str, Any]] = {}
        failures: dict[str, str] = {}
        for method in ("morphological", "soft_union"):
            method_dir = results_root / method
            try:
                diagnostic = build_example(
                    example_id=case.case_id,
                    crop_path=crop_path,
                    raw_mask_path=raw_path,
                    cleaned_mask_path=cleaned_path,
                    metadata_path=metadata_path,
                    operations_path=operations_path,
                    excluded_mask_path=excluded_path,
                    params=case.params,
                    method=method,
                    output_dir=method_dir,
                    rough_box=ROUGH_BOX,
                    assessment_status=case.assessment_status,
                    assessment_notes=case.description,
                )
                successes[method] = diagnostic
            except Exception as error:  # Preserve intentionally informative failures.
                failures[method] = f"{type(error).__name__}: {error}"
                write_json(
                    method_dir / "failure.json",
                    {
                        "schema_version": "word-envelope-failure.v2",
                        "example_id": case.case_id,
                        "method": method,
                        "error_type": type(error).__name__,
                        "message": str(error),
                        "parameters": case.params.as_record(),
                        "rough_region_crop_xywh": list(ROUGH_BOX),
                        "inputs": {
                            "crop": {
                                "path": str(crop_path.resolve()),
                                "sha256": sha256_file(crop_path),
                            },
                            "raw_mask": {
                                "path": str(raw_path.resolve()),
                                "sha256": sha256_file(raw_path),
                                "pixel_sha256": sha256_mask_pixels(case.raw_mask),
                            },
                            "cleaned_mask": {
                                "path": str(cleaned_path.resolve()),
                                "sha256": sha256_file(cleaned_path),
                                "pixel_sha256": sha256_mask_pixels(cleaned_mask),
                            },
                        },
                    },
                )

        preferred = case.preferred_method if case.preferred_method in successes else None
        if preferred is None and successes:
            preferred = sorted(successes)[0]
        if preferred is not None:
            comparison_path = results_root / preferred / "comparison.png"
            gallery_rows.append((case.case_id, comparison_path))
        if successes:
            method_comparison_path = case_root / "method-comparison.png"
            polygons = [
                (
                    method,
                    successes[method]["wrap"]["polygon_crop"],
                )
                for method in ("morphological", "soft_union")
                if method in successes
            ]
            save_method_comparison(
                method_comparison_path,
                title=f"{case.case_id}: {case.description}",
                crop=crop,
                method_polygons=polygons,
            )
            method_rows.append((case.case_id, method_comparison_path))

        summaries.append(
            {
                "case_id": case.case_id,
                "description": case.description,
                "semantic_assessment": case.assessment_status,
                "raw_mask_pixel_sha256": sha256_mask_pixels(case.raw_mask),
                "cleaned_mask_pixel_sha256": sha256_mask_pixels(cleaned_mask),
                "cleanup_replay_log": cleanup_log,
                "successes": {
                    method: {
                        "polygon_sha256": diagnostic["wrap"]["result"][
                            "polygon_sha256"
                        ],
                        "selected_ink_coverage": diagnostic["wrap"]["result"][
                            "selected_ink_coverage"
                        ],
                        "selected_ink_support_coverage": diagnostic["wrap"][
                            "result"
                        ]["selected_ink_support_coverage"],
                        "excluded_ink_contamination": diagnostic["wrap"]["result"][
                            "excluded_ink_contamination"
                        ],
                        "excluded_ink_support_contamination": diagnostic["wrap"][
                            "result"
                        ]["excluded_ink_support_contamination"],
                        "background_area_reduction": diagnostic["wrap"]["result"][
                            "background_area_reduction"
                        ],
                        "envelope_to_ink_area_ratio": diagnostic["wrap"]["result"][
                            "envelope_to_ink_area_ratio"
                        ],
                        "geometry_valid": True,
                        "semantic_assessment": case.assessment_status,
                    }
                    for method, diagnostic in sorted(successes.items())
                },
                "failures": failures,
                "preferred_method": preferred,
            }
        )
    for name in ("gallery-six-panel.png", "gallery-method-comparison.png"):
        (output_dir / name).unlink(missing_ok=True)
    if gallery_rows:
        save_contact_sheet(output_dir / "gallery-six-panel.png", gallery_rows)
    if method_rows:
        save_contact_sheet(output_dir / "gallery-method-comparison.png", method_rows)
    summary = {
        "schema_version": "word-envelope-synthetic-suite.v1",
        "case_count": len(cases),
        "cases": summaries,
    }
    write_json(output_dir / "summary.json", summary)
    return summary


def _cases() -> list[SyntheticCase]:
    cases: list[SyntheticCase] = []

    normal = _word_mask([(75 + 72 * index, 92) for index in range(6)])
    cases.append(
        _case(
            "normal-horizontal",
            "ordinary horizontal disconnected letters",
            normal,
            along_bridge_px=40.0,
            padding_px=6.0,
        )
    )

    slanted_centers = [(85 + 82 * index, 145 - 35 * index) for index in range(4)]
    slanted = _word_mask(slanted_centers, slant=-7)
    cases.append(
        _case(
            "strongly-slanted",
            "23 degree rising word with direction-aware bridging",
            slanted,
            angle_degrees=-23.1,
            along_bridge_px=50.0,
            cross_bridge_px=5.0,
        )
    )

    curved_centers = [(68 + 70 * index, value) for index, value in enumerate((104, 82, 70, 74, 92, 116))]
    curved = _word_mask(curved_centers)
    cases.append(
        _case(
            "curved-word",
            "curved baseline approximated by one global centerline direction",
            curved,
            centerline=((52.0, 105.0), (190.0, 70.0), (332.0, 76.0), (466.0, 118.0)),
            along_bridge_px=40.0,
            cross_bridge_px=11.0,
            padding_px=6.0,
        )
    )

    disconnected = _word_mask([(68 + 78 * index, 92) for index in range(6)], small=True)
    cases.append(
        _case(
            "disconnected-letters",
            "widely disconnected letters joined as one word",
            disconnected,
            along_bridge_px=50.0,
            padding_px=7.0,
        )
    )

    detached = _word_mask([(82 + 72 * index, 104) for index in range(5)])
    detached |= _draw_mask(lambda draw: draw.ellipse((212, 45, 220, 53), fill=1))
    detached |= _draw_mask(lambda draw: draw.line((343, 72, 365, 72), fill=1, width=4))
    cases.append(
        _case(
            "detached-dot-cross",
            "detached dot and cross stroke must remain inside the envelope",
            detached,
            along_bridge_px=45.0,
            cross_bridge_px=40.0,
            padding_px=7.0,
        )
    )

    ascenders = _word_mask([(70 + 74 * index, 94) for index in range(6)])
    ascenders |= _draw_mask(
        lambda draw: (
            draw.line((84, 95, 84, 36), fill=1, width=5),
            draw.line((305, 92, 315, 150), fill=1, width=5),
            draw.line((380, 93, 388, 145), fill=1, width=4),
        )
    )
    cases.append(
        _case(
            "ascenders-descenders",
            "tall ascenders and deep descenders without a giant convex hull",
            ascenders,
            along_bridge_px=40.0,
            cross_bridge_px=14.0,
            padding_px=7.0,
        )
    )

    target = _word_mask([(65 + 66 * index, 96) for index in range(5)])
    neighbor = _word_mask([(408, 56), (468, 58)], small=True)
    neighbor |= _draw_mask(lambda draw: draw.ellipse((36, 28, 48, 40), fill=1))
    raw = target | neighbor
    remove_ids = _component_ids_overlapping(raw, neighbor)
    operations = _operations_record(
        raw,
        [{"type": "remove_components", "ids": remove_ids}],
    )
    cases.append(
        SyntheticCase(
            "nearby-contamination",
            "neighboring ink is removed before deterministic wrapping",
            raw,
            operations,
            EnvelopeParams(
                angle_degrees=0.0,
                along_bridge_px=35.0,
                cross_bridge_px=10.0,
                padding_px=6.0,
            ),
            excluded_mask=neighbor,
        )
    )

    left = _word_mask([(58 + 55 * index, 98) for index in range(4)], small=True)
    right = _word_mask([(320 + 55 * index, 98) for index in range(4)], small=True)
    bridge = _draw_mask(lambda draw: draw.line((238, 98, 320, 98), fill=1, width=5))
    touching_raw = left | right | bridge
    first_operation = {
        "type": "cut",
        "points": [[278, 72], [278, 124]],
        "width_px": 7,
    }
    first_record = _operations_record(touching_raw, [first_operation])
    cut_mask, _ = apply_cleanup_operations(touching_raw, first_record)
    labels, inventory = stable_components(cut_mask)
    left_ids = [
        component["id"]
        for component in inventory
        if component["centroid"]["x"] < 278
    ]
    del labels
    touching_operations = _operations_record(
        touching_raw,
        [first_operation, {"type": "keep_components", "ids": left_ids}],
    )
    cases.append(
        SyntheticCase(
            "touching-words-cut",
            "two touching words separated by a recorded narrow cut",
            touching_raw,
            touching_operations,
            EnvelopeParams(angle_degrees=0.0, along_bridge_px=24.0, padding_px=6.0),
        )
    )

    sparse = _word_mask([(58, 102), (155, 70), (255, 112), (355, 68), (455, 104)], small=True)
    cases.append(
        _case(
            "sparse-multi-island",
            "sparse multi-island word near the useful bridging limit",
            sparse,
            along_bridge_px=55.0,
            cross_bridge_px=20.0,
            padding_px=8.0,
            soft_threshold=0.12,
            assessment_status="partial",
        )
    )

    faint_target = _word_mask([(82 + 72 * index, 96) for index in range(5)])
    missed = _draw_mask(lambda draw: draw.line((238, 84, 255, 108), fill=1, width=3))
    faint_raw = faint_target & ~missed
    restore = {
        "type": "restore_scribble",
        "points": [[238, 84], [255, 108]],
        "width_px": 3,
    }
    cases.append(
        SyntheticCase(
            "faint-stroke-restore",
            "a missed faint stroke is restored by a recorded positive scribble",
            faint_raw,
            _operations_record(faint_raw, [restore]),
            EnvelopeParams(
                angle_degrees=0.0,
                along_bridge_px=35.0,
                cross_bridge_px=10.0,
                padding_px=6.0,
            ),
        )
    )
    return cases


def _case(
    case_id: str,
    description: str,
    raw_mask: np.ndarray,
    assessment_status: str = "success",
    **parameter_overrides: Any,
) -> SyntheticCase:
    return SyntheticCase(
        case_id,
        description,
        raw_mask,
        _operations_record(raw_mask, []),
        EnvelopeParams(**parameter_overrides),
        assessment_status=assessment_status,
    )


def _operations_record(
    raw_mask: np.ndarray, operations: list[dict[str, Any]]
) -> dict[str, Any]:
    current = raw_mask.copy()
    guarded: list[dict[str, Any]] = []
    for operation in operations:
        guarded_operation = {
            **operation,
            "expected_input_mask_pixel_sha256": sha256_mask_pixels(current),
        }
        one = {
            "schema_version": CLEANUP_SCHEMA_VERSION,
            "operations": [guarded_operation],
        }
        current, _ = apply_cleanup_operations(current, one)
        guarded.append(guarded_operation)
    return {
        "schema_version": CLEANUP_SCHEMA_VERSION,
        "operations": guarded,
    }


def _component_ids_overlapping(mask: np.ndarray, selected: np.ndarray) -> list[int]:
    labels, inventory = stable_components(mask)
    ids = sorted(int(value) for value in np.unique(labels[selected]) if value > 0)
    if not ids:
        raise AssertionError("Synthetic selected mask did not overlap any components")
    available = {component["id"] for component in inventory}
    if not set(ids).issubset(available):
        raise AssertionError("Synthetic stable component mismatch")
    return ids


def _word_mask(
    centers: list[tuple[int, int]], *, slant: int = 0, small: bool = False
) -> np.ndarray:
    def draw_word(draw: ImageDraw.ImageDraw) -> None:
        radius_x = 15 if small else 19
        radius_y = 22 if small else 27
        width = 4 if small else 5
        for index, (center_x, center_y) in enumerate(centers):
            draw.ellipse(
                (
                    center_x - radius_x,
                    center_y - radius_y,
                    center_x + radius_x,
                    center_y + radius_y,
                ),
                outline=1,
                width=width,
            )
            draw.line(
                (
                    center_x + slant,
                    center_y - radius_y + 2,
                    center_x - slant,
                    center_y + radius_y - 2,
                ),
                fill=1,
                width=width,
            )
            if index % 2 == 1:
                draw.line(
                    (
                        center_x - radius_x,
                        center_y + 2,
                        center_x + radius_x + 7,
                        center_y - 5,
                    ),
                    fill=1,
                    width=max(2, width - 1),
                )
    return _draw_mask(draw_word)


def _draw_mask(draw_fn: Any) -> np.ndarray:
    image = Image.new("1", (WIDTH, HEIGHT), 0)
    draw_fn(ImageDraw.Draw(image))
    return np.asarray(image, dtype=bool).copy()


def _paper_image(raw_mask: np.ndarray, *, seed: int) -> Image.Image:
    rng = np.random.default_rng(73_001 + seed)
    base = np.empty((HEIGHT, WIDTH, 3), dtype=np.int16)
    base[:, :, 0] = 246
    base[:, :, 1] = 241
    base[:, :, 2] = 226
    noise = rng.integers(-3, 4, size=(HEIGHT, WIDTH, 1), dtype=np.int16)
    base = np.clip(base + noise, 0, 255).astype(np.uint8)
    base[raw_mask] = (44, 39, 34)
    return Image.fromarray(base, mode="RGB")
