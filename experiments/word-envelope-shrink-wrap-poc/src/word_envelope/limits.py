"""Adversarial characterization of the word-envelope operating limits."""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path
from typing import Any, Callable

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from shapely.geometry import Polygon

from .engine import (
    EnvelopeParams,
    _ink_support_coverage,
    estimate_angle,
    wrap_envelope,
)
from .io_utils import check_rss, sha256_mask_pixels, write_json
from .render import save_contact_sheet, save_method_comparison


METHODS = ("morphological", "soft_union")
COLORS = {
    "valid": (92, 175, 104),
    "review_broad": (238, 190, 70),
    "contaminated": (226, 126, 54),
    "false_success": (151, 92, 180),
    "failure_disconnected": (207, 72, 67),
    "failure_guard": (148, 55, 52),
    "failure_other": (112, 112, 112),
}


def generate_limit_characterization(output_dir: Path) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    sweeps = [
        _letter_gap_sweep(),
        _remote_mark_sweep(),
        _curvature_sweep(),
        _angle_error_sweep(),
        _neighbor_clearance_sweep(),
        _scale_sweep(),
        _pca_short_word_sweep(),
        _soft_threshold_matrix(),
    ]
    adversarial, gallery_specs = _adversarial_cases()
    summary = {
        "schema_version": "word-envelope-limit-characterization.v1",
        "interpretation": (
            "Synthetic geometric characterization, not lexical accuracy. A valid "
            "polygon is not semantic proof."
        ),
        "sweeps": sweeps,
        "adversarial_cases": adversarial,
        "classification_counts": _classification_counts(sweeps, adversarial),
    }
    write_json(output_dir / "summary.json", summary)
    _save_sweep_grid(output_dir / "sweep-grid.png", sweeps)

    gallery_rows: list[tuple[str, Path]] = []
    for case_id, title, original, method_values in gallery_specs:
        path = output_dir / case_id / "method-comparison.png"
        save_method_comparison(
            path,
            title=title,
            crop=original,
            method_polygons=method_values,
        )
        gallery_rows.append((case_id, path))
    save_contact_sheet(output_dir / "gallery-adversarial.png", gallery_rows)
    check_rss("after limit characterization")
    return summary


def _letter_gap_sweep() -> dict[str, Any]:
    values = list(range(4, 41, 4)) + [48, 56]
    points = []
    for gap in values:
        mask = _separate_glyph_word(gap_px=gap)
        params = EnvelopeParams(
            angle_degrees=0,
            along_bridge_px=30,
            cross_bridge_px=8,
            padding_px=5,
            maximum_envelope_fraction=0.95,
        )
        points.append(_sweep_point(gap, mask, params))
    return _sweep(
        "letter-gap",
        "literal gap between disconnected letter bodies",
        "gap_px",
        points,
    )


def _remote_mark_sweep() -> dict[str, Any]:
    points = []
    for gap in range(0, 71, 5):
        body = _connected_body()
        mask = body.copy()
        bottom = 104 - gap
        mask[max(2, bottom - 8) : bottom, 236:244] = True
        params = EnvelopeParams(
            angle_degrees=0,
            along_bridge_px=30,
            cross_bridge_px=18,
            padding_px=6,
            maximum_envelope_fraction=0.95,
        )
        points.append(_sweep_point(gap, mask, params))
    return _sweep(
        "remote-mark",
        "gap from word body to detached dot/apostrophe",
        "cross_gap_px",
        points,
    )


def _curvature_sweep() -> dict[str, Any]:
    points = []
    pattern = np.asarray((0.0, -0.6, -1.0, -0.6, 0.0, 0.6))
    for amplitude in range(0, 91, 10):
        centers = [
            (55 + 54 * index, int(round(116 + amplitude * pattern[index])))
            for index in range(len(pattern))
        ]
        mask = _glyphs_at(centers, shape=(240, 520))
        params = EnvelopeParams(
            angle_degrees=0,
            along_bridge_px=55,
            cross_bridge_px=18,
            padding_px=6,
            maximum_envelope_fraction=0.95,
        )
        points.append(_sweep_point(amplitude, mask, params))
    return _sweep(
        "global-angle-curvature",
        "one global angle applied to a curved baseline",
        "amplitude_px",
        points,
    )


def _angle_error_sweep() -> dict[str, Any]:
    points = []
    for true_angle in range(0, 31, 5):
        mask = _angled_glyphs(true_angle)
        params = EnvelopeParams(
            angle_degrees=0,
            along_bridge_px=28,
            cross_bridge_px=5,
            padding_px=2,
            maximum_envelope_fraction=0.95,
        )
        points.append(_sweep_point(true_angle, mask, params))
    return _sweep(
        "angle-error",
        "true word angle while supplied wrapping angle remains 0 degrees",
        "angle_error_degrees",
        points,
    )


def _neighbor_clearance_sweep() -> dict[str, Any]:
    points = []
    for gap in (0, 2, 4, 6, 8, 10, 14, 18, 24, 32):
        target = _connected_body()
        excluded = np.zeros_like(target)
        excluded[104:132, 351 + gap : 381 + gap] = True
        params = EnvelopeParams(
            angle_degrees=0,
            along_bridge_px=30,
            cross_bridge_px=10,
            padding_px=6,
            maximum_envelope_fraction=0.95,
        )
        points.append(
            _sweep_point(
                gap,
                target,
                params,
                excluded=excluded,
                observe_contamination=True,
            )
        )
    return _sweep(
        "neighbor-clearance",
        "known neighboring ink to the right of a cleaned target",
        "clearance_px",
        points,
    )


def _scale_sweep() -> dict[str, Any]:
    points = []
    for scale in (1, 2, 3):
        height = 100 * scale
        width = 320 * scale
        mask = np.zeros((height, width), dtype=bool)
        for index in range(5):
            x = (35 + 48 * index) * scale
            mask[35 * scale : 55 * scale, x : x + 20 * scale] = True
        params = EnvelopeParams(
            angle_degrees=0,
            along_bridge_px=30,
            cross_bridge_px=8,
            padding_px=5,
            maximum_envelope_fraction=0.95,
        )
        points.append(_sweep_point(scale, mask, params))
    return _sweep(
        "fixed-pixels-vs-scale",
        "same topology enlarged without scaling pixel parameters",
        "scale_factor",
        points,
    )


def _pca_short_word_sweep() -> dict[str, Any]:
    points = []
    for stem_count in range(1, 9):
        mask = np.zeros((100, 280), dtype=bool)
        for index in range(stem_count):
            x = 25 + 15 * index
            mask[30:82, x : x + 5] = True
            if index % 2 == 0:
                mask[16:22, x : x + 5] = True
        params = EnvelopeParams(
            along_bridge_px=28,
            cross_bridge_px=6,
            padding_px=4,
            maximum_envelope_fraction=0.95,
        )
        point = _sweep_point(stem_count, mask, params)
        point["pca_angle_degrees"] = round(estimate_angle(mask, params)[0], 6)
        points.append(point)
    return _sweep(
        "pca-short-tall-word",
        "PCA direction for short words dominated by tall stems and dots",
        "stem_count",
        points,
    )


def _soft_threshold_matrix() -> dict[str, Any]:
    centers = [(38, 131), (84, 85), (130, 49), (175, 54), (221, 90), (267, 136)]
    mask = _glyphs_at(
        centers,
        shape=(190, 320),
        half_width=9,
        half_height=10,
    )
    points = []
    for threshold in (0.18, 0.12):
        for bridge in (40, 50, 60, 70, 80, 85):
            params = EnvelopeParams(
                angle_degrees=0,
                along_bridge_px=bridge,
                cross_bridge_px=bridge,
                padding_px=8,
                soft_threshold=threshold,
                maximum_envelope_fraction=0.95,
            )
            outcome = _evaluate(mask, None, params, "soft_union")
            points.append(
                {
                    "value": f"{bridge}@{threshold}",
                    "selected_mask_pixel_sha256": sha256_mask_pixels(mask),
                    "parameters": params.as_record(),
                    "methods": {"soft_union": _public_outcome(outcome)},
                }
            )
    result = _sweep(
        "soft-bridge-threshold",
        "soft union is not monotone in bridge size at a fixed normalized threshold",
        "bridge_px@threshold",
        points,
        methods=("soft_union",),
    )
    result["observation_note"] = (
        "Default hard gates remain active; outcomes above ratio 8 are additionally "
        "classified review_broad for this characterization."
    )
    return result


def _adversarial_cases() -> tuple[list[dict[str, Any]], list[tuple[Any, ...]]]:
    records: list[dict[str, Any]] = []
    gallery: list[tuple[Any, ...]] = []

    # A detached target mark with a known neighboring stroke directly between it
    # and the body has no safe global cross bridge.
    target = np.zeros((140, 240), dtype=bool)
    target[85:105, 45:195] = True
    target[20:30, 115:125] = True
    neighbor = np.zeros_like(target)
    neighbor[48:60, 95:145] = True
    raw = target | neighbor
    cross_trials: dict[str, list[dict[str, Any]]] = {method: [] for method in METHODS}
    display: list[tuple[str, Any]] = []
    for method in METHODS:
        chosen = None
        for cross in (10, 20, 30, 40, 50, 60, 70, 80, 85):
            params = EnvelopeParams(
                angle_degrees=0,
                along_bridge_px=20,
                cross_bridge_px=cross,
                padding_px=6,
                maximum_envelope_fraction=0.95,
            )
            observation_params = replace(
                params,
                maximum_excluded_contamination=1.0,
                maximum_excluded_component_contamination=1.0,
            )
            outcome = _evaluate(target, neighbor, observation_params, method)
            cross_trials[method].append(
                {
                    "cross_bridge_px": cross,
                    "parameters": observation_params.as_record(),
                    **_public_outcome(outcome),
                }
            )
            if chosen is None and outcome.get("_polygon") is not None:
                chosen = outcome["_polygon"]
        display.append((method, chosen))
    records.append(
        {
            "case_id": "remote-mark-sandwich",
            "semantic_assessment": "expected_failure_no_safe_global_bridge",
            "description": (
                "A neighboring stroke lies between the body and a detached target mark."
            ),
            "selected_mask_pixel_sha256": sha256_mask_pixels(target),
            "semantic_neighbor_mask_pixel_sha256": sha256_mask_pixels(neighbor),
            "observation_note": (
                "Contamination gates are relaxed only to measure capture; normal "
                "validation rejects every connected contaminated outcome."
            ),
            "trials": cross_trials,
        }
    )
    gallery.append(
        (
            "remote-mark-sandwich",
            "Remote mark with intervening neighbor: connectivity conflicts with exclusion",
            _paper(raw),
            display,
        )
    )

    # Missing true ink is unknowable from the cleaned mask alone.
    cleaned = _connected_body()
    truth = cleaned.copy()
    missing_component = np.zeros_like(cleaned)
    missing_component[62:72, 236:246] = True
    truth |= missing_component
    missing_methods = {}
    display = []
    for method in METHODS:
        params = EnvelopeParams(
            angle_degrees=0,
            along_bridge_px=30,
            cross_bridge_px=18,
            padding_px=6,
            maximum_envelope_fraction=0.95,
        )
        outcome = _evaluate(cleaned, None, params, method)
        if outcome.get("_polygon") is not None:
            truth_coverage = _ink_support_coverage(
                Polygon(outcome["_polygon"]), truth
            )
            outcome["truth_target_support_coverage"] = round(truth_coverage, 9)
            outcome["missing_component_support_coverage"] = round(
                _ink_support_coverage(
                    Polygon(outcome["_polygon"]), missing_component
                ),
                9,
            )
            outcome["classification"] = "false_success"
        missing_methods[method] = _public_outcome(outcome)
        display.append((method, outcome.get("_polygon")))
    records.append(
        {
            "case_id": "truth-omission",
            "semantic_assessment": "false_success",
            "description": "The cleaned mask omits a true detached dot.",
            "truth_target_mask_pixel_sha256": sha256_mask_pixels(truth),
            "cleaned_selected_mask_pixel_sha256": sha256_mask_pixels(cleaned),
            "missing_component_mask_pixel_sha256": sha256_mask_pixels(
                missing_component
            ),
            "methods": missing_methods,
        }
    )
    gallery.append(
        (
            "truth-omission",
            "Missing target ink: geometry cannot know the dot was omitted",
            _paper(truth),
            display,
        )
    )

    # A connected pair of words is valid geometry without independent semantics.
    left = _connected_body()
    selected = left.copy()
    selected[104:132, 365:455] = True
    selected[116:120, 340:365] = True
    second_word = np.zeros_like(selected)
    second_word[104:132, 365:455] = True
    merged_methods = {}
    display = []
    for method in METHODS:
        params = EnvelopeParams(
            angle_degrees=0,
            along_bridge_px=30,
            cross_bridge_px=10,
            padding_px=6,
            maximum_envelope_fraction=0.95,
        )
        outcome = _evaluate(selected, None, params, method)
        if outcome.get("_polygon") is not None:
            outcome["classification"] = "false_success"
            outcome["note"] = "No excluded truth was supplied; both words are accepted."
            outcome["foreign_selected_support_coverage"] = round(
                _ink_support_coverage(Polygon(outcome["_polygon"]), second_word),
                9,
            )
        merged_methods[method] = _public_outcome(outcome)
        display.append((method, outcome.get("_polygon")))
    records.append(
        {
            "case_id": "two-selected-words",
            "semantic_assessment": "false_success_without_independent_neighbor_mask",
            "description": "Cleanup accidentally retained a touching second word.",
            "cleaned_selected_mask_pixel_sha256": sha256_mask_pixels(selected),
            "foreign_selected_mask_pixel_sha256": sha256_mask_pixels(second_word),
            "methods": merged_methods,
        }
    )
    gallery.append(
        (
            "two-selected-words",
            "Two selected words: valid polygon, wrong semantic group",
            _paper(selected),
            display,
        )
    )

    # A loop around foreign ink conflicts with a hole-free word envelope.
    loop = np.zeros((200, 500), dtype=bool)
    image = Image.new("1", (500, 200), 0)
    draw = ImageDraw.Draw(image)
    draw.ellipse((100, 45, 380, 155), outline=1, width=8)
    loop = np.asarray(image, dtype=bool).copy()
    enclosed = np.zeros_like(loop)
    enclosed[88:112, 230:270] = True
    loop_methods = {}
    display = []
    for method in METHODS:
        params = EnvelopeParams(
            angle_degrees=0,
            along_bridge_px=20,
            cross_bridge_px=10,
            padding_px=5,
            maximum_envelope_fraction=0.95,
        )
        outcome = _evaluate(loop, enclosed, params, method)
        loop_methods[method] = _public_outcome(outcome)
        display.append((method, outcome.get("_polygon")))
    records.append(
        {
            "case_id": "enclosed-neighbor",
            "semantic_assessment": "expected_failure_topology_conflict",
            "description": "A target flourish encloses known neighboring ink.",
            "selected_mask_pixel_sha256": sha256_mask_pixels(loop),
            "semantic_neighbor_mask_pixel_sha256": sha256_mask_pixels(enclosed),
            "methods": loop_methods,
        }
    )
    gallery.append(
        (
            "enclosed-neighbor",
            "Hole-free envelope cannot exclude ink enclosed by a target flourish",
            _paper(loop | enclosed),
            display,
        )
    )

    # Border touch and tiny garbage should be stable guard failures.
    for case_id, selected, description in (
        (
            "clipped-terminal",
            _border_touching_mask(),
            "Target ink touches the crop edge and must request crop expansion.",
        ),
        (
            "tiny-garbage",
            _tiny_mask(),
            "A single speck must not become a confident word envelope.",
        ),
    ):
        methods = {}
        display = []
        for method in METHODS:
            outcome = _evaluate(
                selected,
                None,
                EnvelopeParams(
                    angle_degrees=0,
                    padding_px=5,
                    maximum_envelope_fraction=0.99,
                ),
                method,
            )
            methods[method] = _public_outcome(outcome)
            display.append((method, outcome.get("_polygon")))
        records.append(
            {
                "case_id": case_id,
                "semantic_assessment": "expected_guard_failure",
                "description": description,
                "selected_mask_pixel_sha256": sha256_mask_pixels(selected),
                "methods": methods,
            }
        )
        gallery.append((case_id, description, _paper(selected), display))
    return records, gallery


def _sweep_point(
    value: int | float,
    mask: np.ndarray,
    params: EnvelopeParams,
    *,
    excluded: np.ndarray | None = None,
    observe_contamination: bool = False,
) -> dict[str, Any]:
    outcomes = {}
    for method in METHODS:
        effective = (
            replace(
                params,
                maximum_excluded_contamination=1.0,
                maximum_excluded_component_contamination=1.0,
            )
            if observe_contamination
            else params
        )
        outcomes[method] = _public_outcome(
            _evaluate(mask, excluded, effective, method)
        )
    return {
        "value": value,
        "selected_mask_pixel_sha256": sha256_mask_pixels(mask),
        "semantic_neighbor_mask_pixel_sha256": (
            sha256_mask_pixels(excluded) if excluded is not None else None
        ),
        "parameters": params.as_record(),
        "observation_overrides": (
            {
                "maximum_excluded_contamination": 1.0,
                "maximum_excluded_component_contamination": 1.0,
            }
            if observe_contamination
            else None
        ),
        "methods": outcomes,
    }


def _evaluate(
    mask: np.ndarray,
    excluded: np.ndarray | None,
    params: EnvelopeParams,
    method: str,
) -> dict[str, Any]:
    try:
        result = wrap_envelope(
            mask,
            params,
            method=method,
            excluded_mask=excluded,
            rough_box=(0.0, 0.0, float(mask.shape[1]), float(mask.shape[0])),
        )
        contamination = max(
            value
            for value in (
                result.excluded_ink_contamination,
                result.excluded_ink_support_contamination,
                result.excluded_component_max_contamination,
                0.0,
            )
            if value is not None
        )
        if contamination > 0.05:
            classification = "contaminated"
        elif (
            result.envelope_to_ink_area_ratio > 8.0
            or result.background_area_reduction < 0.65
        ):
            classification = "review_broad"
        else:
            classification = "valid"
        return {
            "geometry_valid": True,
            "classification": classification,
            "polygon_sha256": result.polygon_checksum,
            "selected_ink_support_coverage": result.selected_ink_support_coverage,
            "background_area_reduction": result.background_area_reduction,
            "envelope_to_ink_area_ratio": result.envelope_to_ink_area_ratio,
            "excluded_ink_contamination": result.excluded_ink_contamination,
            "excluded_ink_support_contamination": result.excluded_ink_support_contamination,
            "excluded_component_max_contamination": result.excluded_component_max_contamination,
            "estimated_angle_degrees": result.angle_degrees,
            "angle_source": result.angle_source,
            "_polygon": result.polygon,
        }
    except Exception as error:
        message = str(error)
        if "disconnected" in message.lower():
            classification = "failure_disconnected"
        elif any(
            token in message.lower()
            for token in (
                "boundary",
                "minimum",
                "safe poc limit",
                "contamination",
                "rough box",
                "area ratio",
            )
        ):
            classification = "failure_guard"
        else:
            classification = "failure_other"
        return {
            "geometry_valid": False,
            "classification": classification,
            "error_type": type(error).__name__,
            "message": message,
            "_polygon": None,
        }


def _public_outcome(outcome: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in outcome.items() if not key.startswith("_")}


def _sweep(
    sweep_id: str,
    description: str,
    variable: str,
    points: list[dict[str, Any]],
    *,
    methods: tuple[str, ...] = METHODS,
) -> dict[str, Any]:
    return {
        "sweep_id": sweep_id,
        "description": description,
        "variable": variable,
        "methods": list(methods),
        "points": points,
    }


def _classification_counts(
    sweeps: list[dict[str, Any]], adversarial: list[dict[str, Any]]
) -> dict[str, int]:
    counts: dict[str, int] = {}
    for sweep in sweeps:
        for point in sweep["points"]:
            for outcome in point["methods"].values():
                value = outcome["classification"]
                counts[value] = counts.get(value, 0) + 1
    for case in adversarial:
        for outcome in case.get("methods", {}).values():
            value = outcome["classification"]
            counts[value] = counts.get(value, 0) + 1
        for method_trials in case.get("trials", {}).values():
            for outcome in method_trials:
                value = outcome["classification"]
                counts[value] = counts.get(value, 0) + 1
    return dict(sorted(counts.items()))


def _separate_glyph_word(*, gap_px: int) -> np.ndarray:
    mask = np.zeros((180, 520), dtype=bool)
    for index in range(5):
        x = 35 + index * (24 + gap_px)
        mask[76:108, x : x + 24] = True
    return mask


def _connected_body() -> np.ndarray:
    image = Image.new("1", (500, 200), 0)
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((70, 104, 350, 132), radius=12, outline=1, width=6)
    draw.line((78, 119, 345, 113), fill=1, width=5)
    return np.asarray(image, dtype=bool).copy()


def _glyphs_at(
    centers: list[tuple[int, int]],
    *,
    shape: tuple[int, int],
    half_width: int = 11,
    half_height: int = 16,
) -> np.ndarray:
    mask = np.zeros(shape, dtype=bool)
    for x, y in centers:
        mask[
            max(0, y - half_height) : min(shape[0], y + half_height),
            max(0, x - half_width) : min(shape[1], x + half_width),
        ] = True
    return mask


def _angled_glyphs(angle_degrees: float) -> np.ndarray:
    radians = np.deg2rad(angle_degrees)
    centers = []
    for index in range(6):
        distance = (index - 2.5) * 38
        centers.append(
            (
                int(round(180 + distance * np.cos(radians))),
                int(round(180 - distance * np.sin(radians))),
            )
        )
    return _glyphs_at(centers, shape=(360, 360), half_width=6, half_height=5)


def _border_touching_mask() -> np.ndarray:
    mask = np.zeros((120, 320), dtype=bool)
    mask[48:72, 0:115] = True
    return mask


def _tiny_mask() -> np.ndarray:
    mask = np.zeros((120, 320), dtype=bool)
    mask[60, 160] = True
    return mask


def _paper(mask: np.ndarray) -> Image.Image:
    array = np.empty((*mask.shape, 3), dtype=np.uint8)
    array[:, :] = (244, 239, 224)
    array[mask] = (45, 40, 35)
    return Image.fromarray(array, mode="RGB")


def _save_sweep_grid(path: Path, sweeps: list[dict[str, Any]]) -> None:
    label_width = 245
    cell_width = 58
    row_height = 27
    section_gap = 8
    legend_height = 46
    maximum_points = max(len(sweep["points"]) for sweep in sweeps)
    width = label_width + cell_width * maximum_points
    height = legend_height + sum(
        row_height * (1 + len(sweep["methods"])) + section_gap
        for sweep in sweeps
    )
    image = Image.new("RGB", (width, height), (247, 246, 242))
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default()
    x = 8
    for label, color in COLORS.items():
        draw.rectangle((x, 8, x + 13, 21), fill=color)
        draw.text((x + 17, 9), label, fill=(25, 25, 25), font=font)
        x += 17 + draw.textlength(label, font=font) + 16
    y = legend_height
    for sweep in sweeps:
        draw.rectangle((0, y, width, y + row_height - 1), fill=(224, 222, 216))
        draw.text((7, y + 7), sweep["sweep_id"], fill=(20, 20, 20), font=font)
        for index, point in enumerate(sweep["points"]):
            value = str(point["value"])
            draw.text(
                (label_width + index * cell_width + 4, y + 7),
                value,
                fill=(30, 30, 30),
                font=font,
            )
        y += row_height
        for method in sweep["methods"]:
            draw.text((15, y + 7), method, fill=(35, 35, 35), font=font)
            for index, point in enumerate(sweep["points"]):
                outcome = point["methods"].get(method)
                if outcome is None:
                    continue
                color = COLORS[outcome["classification"]]
                left = label_width + index * cell_width
                draw.rectangle(
                    (left + 1, y + 1, left + cell_width - 2, y + row_height - 2),
                    fill=color,
                )
            y += row_height
        y += section_gap
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format="PNG", compress_level=9, optimize=False)
