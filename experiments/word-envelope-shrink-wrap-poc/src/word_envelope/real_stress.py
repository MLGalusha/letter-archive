"""Serial, hash-guarded replay of the real-word stress corpus."""

from __future__ import annotations

import re
import shutil
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from .engine import EnvelopeError, EnvelopeParams
from .io_utils import (
    CLEANUP_SCHEMA_VERSION,
    check_rss,
    read_json,
    sha256_file,
    sha256_mask_pixels,
    write_json,
)
from .masks import (
    apply_cleanup_operations,
    create_bounded_crop,
    extract_ink_mask,
    save_mask,
    stable_components,
)
from .records import build_example, reset_result_dir
from .render import (
    save_component_overlay,
    save_contact_sheet,
    save_method_comparison,
    save_six_panel_comparison,
)


STRESS_SCHEMA_VERSION = "word-envelope-real-stress-suite.v1"
STRESS_SUMMARY_VERSION = "word-envelope-real-stress-summary.v1"
MANAGED_CASES_SCHEMA_VERSION = "word-envelope-real-stress-managed-cases.v1"
METHODS = ("morphological", "soft_union")
ASSESSMENT_STATUSES = {"success", "partial", "failure", "unreviewed"}
INPUT_ASSESSMENT_STATUSES = {"evaluable", "invalid_input"}
CASE_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
_CASE_KEYS = {
    "angle_degrees",
    "assessment",
    "crop",
    "envelope_profile",
    "extraction_profile",
    "id",
    "input_assessment",
    "label",
    "preferred_method",
    "raw_mask_pixel_sha256",
    "raw_mask_sha256",
    "rough_box_crop_xywh",
    "semantic_neighbor_operations",
    "source_path",
    "source_sha256",
    "source_target_box_xywh",
    "tags",
    "target_operations",
}


def generate_real_stress_suite(manifest_path: Path, output_dir: Path) -> dict[str, Any]:
    """Replay every frozen case serially and retain algorithm failures."""

    manifest = read_json(manifest_path)
    _validate_manifest(manifest)
    manifest_sha256 = sha256_file(manifest_path)
    output_dir.mkdir(parents=True, exist_ok=True)
    previous_case_ids = _completed_case_ids(output_dir / "summary.json")
    managed_case_ids = _managed_case_ids(output_dir / "managed-cases.json")
    current_case_ids = {case["id"] for case in manifest["cases"]}
    aggregate_paths = (
        output_dir / "summary.json",
        output_dir / "gallery-method-comparison.png",
        output_dir / "gallery-six-panel.png",
    )
    for aggregate_path in aggregate_paths:
        aggregate_path.unlink(missing_ok=True)
    for case_id in sorted(previous_case_ids | managed_case_ids | current_case_ids):
        case_dir = output_dir / case_id
        if case_dir.is_symlink():
            raise ValueError(f"Refusing to replace symlinked stress case: {case_dir}")
        if case_dir.exists():
            if not case_dir.is_dir():
                raise ValueError(f"Stress case path is not a directory: {case_dir}")
            shutil.rmtree(case_dir)
    write_json(
        output_dir / "managed-cases.json",
        {
            "schema_version": MANAGED_CASES_SCHEMA_VERSION,
            "case_ids": sorted(current_case_ids),
        },
    )
    summaries: list[dict[str, Any]] = []
    method_rows: list[tuple[str, Path]] = []
    six_panel_rows: list[tuple[str, Path]] = []

    for case in manifest["cases"]:
        check_rss(f"before stress case {case['id']}")
        case_dir = output_dir / case["id"]
        prepared = _prepare_case(
            case,
            extraction_profile=manifest["extraction_profiles"][
                case["extraction_profile"]
            ],
            case_dir=case_dir,
        )
        summary = _run_case(
            case,
            envelope_profile=manifest["envelope_profiles"][
                case["envelope_profile"]
            ],
            prepared=prepared,
            case_dir=case_dir,
        )
        summaries.append(summary)
        gallery_label = (
            case["label"]
            if summary["input_assessment"]["status"] == "evaluable"
            else f"{case['label']} - INVALID INPUT, NOT SCORED"
        )
        method_rows.append((gallery_label, case_dir / "method-comparison.png"))
        six_panel_rows.append((gallery_label, case_dir / "six-panel.png"))
        check_rss(f"after stress case {case['id']}")

    counts = {"success": 0, "partial": 0, "failure": 0, "unreviewed": 0}
    evaluated_counts = dict.fromkeys(counts, 0)
    input_counts = {"evaluable": 0, "invalid_input": 0}
    geometry_successes = 0
    evaluated_geometry_successes = 0
    geometry_attempts = len(summaries) * len(METHODS)
    for case in summaries:
        input_status = case["input_assessment"]["status"]
        input_counts[input_status] += 1
        geometry_successes += sum(
            method["geometry_status"] == "success"
            for method in case["methods"].values()
        )
        for method in case["methods"].values():
            counts[method["assessment_status"]] += 1
            if input_status == "evaluable":
                evaluated_counts[method["assessment_status"]] += 1
                evaluated_geometry_successes += (
                    method["geometry_status"] == "success"
                )

    evaluated_case_count = input_counts["evaluable"]
    evaluated_method_attempts = evaluated_case_count * len(METHODS)

    required_case_ids = manifest.get("required_case_ids", [])
    summaries_by_id = {case["id"]: case for case in summaries}
    required_case_outcomes = {
        case_id: {
            "geometry_success_count": sum(
                method["geometry_status"] == "success"
                for method in summaries_by_id[case_id]["methods"].values()
            ),
            "assessment_statuses": {
                method: result["assessment_status"]
                for method, result in summaries_by_id[case_id]["methods"].items()
            },
        }
        for case_id in required_case_ids
    }
    summary = {
        "schema_version": STRESS_SUMMARY_VERSION,
        "suite_id": manifest["suite_id"],
        "input_manifest_sha256": manifest_sha256,
        "case_count": len(summaries),
        "method_attempt_count": geometry_attempts,
        "geometry_success_count": geometry_successes,
        "geometry_failure_count": geometry_attempts - geometry_successes,
        "assessment_counts": counts,
        "input_assessment_counts": input_counts,
        "evaluated_case_count": evaluated_case_count,
        "evaluated_method_attempt_count": evaluated_method_attempts,
        "evaluated_geometry_success_count": evaluated_geometry_successes,
        "evaluated_geometry_failure_count": (
            evaluated_method_attempts - evaluated_geometry_successes
        ),
        "evaluated_assessment_counts": evaluated_counts,
        "required_case_outcomes": required_case_outcomes,
        "cases": summaries,
    }
    save_contact_sheet(output_dir / "gallery-method-comparison.png", method_rows)
    save_contact_sheet(output_dir / "gallery-six-panel.png", six_panel_rows)
    write_json(output_dir / "summary.json", summary)
    return summary


def _completed_case_ids(summary_path: Path) -> set[str]:
    """Return safe case ids from the prior completion record, if present."""

    if not summary_path.exists():
        return set()
    try:
        summary = read_json(summary_path)
    except (OSError, ValueError):
        return set()
    if (
        not isinstance(summary, dict)
        or summary.get("schema_version") != STRESS_SUMMARY_VERSION
    ):
        return set()
    case_ids = {
        case.get("id")
        for case in summary.get("cases", [])
        if isinstance(case, dict)
    }
    return {
        case_id
        for case_id in case_ids
        if isinstance(case_id, str) and CASE_ID_PATTERN.fullmatch(case_id)
    }


def _managed_case_ids(index_path: Path) -> set[str]:
    """Read the case ownership index that survives an incomplete replay."""

    if not index_path.exists():
        return set()
    try:
        index = read_json(index_path)
    except (OSError, ValueError):
        return set()
    if (
        not isinstance(index, dict)
        or index.get("schema_version") != MANAGED_CASES_SCHEMA_VERSION
        or not isinstance(index.get("case_ids"), list)
    ):
        return set()
    return {
        case_id
        for case_id in index["case_ids"]
        if isinstance(case_id, str) and CASE_ID_PATTERN.fullmatch(case_id)
    }


def _prepare_case(
    case: dict[str, Any],
    *,
    extraction_profile: dict[str, Any],
    case_dir: Path,
) -> dict[str, Any]:
    source_path = Path(case["source_path"])
    if sha256_file(source_path) != case["source_sha256"]:
        raise ValueError(f"Source hash drift for {case['id']}")

    inputs_dir = case_dir / "inputs"
    extraction_dir = case_dir / "extraction"
    cleanup_dir = case_dir / "cleanup"
    neighbor_dir = case_dir / "semantic-neighbors"
    crop_path = inputs_dir / "crop.png"
    crop_metadata_path = inputs_dir / "crop.json"
    crop_spec = case["crop"]
    crop_record = create_bounded_crop(
        source_path,
        box_xywh=crop_spec["requested_box_xywh"],
        padding=int(crop_spec["padding_px"]),
        output_path=crop_path,
        metadata_path=crop_metadata_path,
        max_pixels=int(crop_spec.get("max_pixels", 1_500_000)),
    )
    if sha256_file(crop_path) != crop_spec["sha256"]:
        raise ValueError(f"Crop hash drift for {case['id']}")
    actual_crop = crop_record["crop"]
    if [actual_crop["x"], actual_crop["y"]] != crop_spec["origin_xy"]:
        raise ValueError(f"Crop origin drift for {case['id']}")
    if [actual_crop["width_px"], actual_crop["height_px"]] != crop_spec["size_wh"]:
        raise ValueError(f"Crop size drift for {case['id']}")

    with Image.open(crop_path) as source:
        crop = source.convert("RGB")
    raw_mask = extract_ink_mask(
        crop,
        window_size=int(extraction_profile["window_size"]),
        k=float(extraction_profile["k"]),
        offset=float(extraction_profile.get("offset", 0.0)),
        minimum_component_area=int(extraction_profile["minimum_component_area"]),
    )
    raw_mask_path = extraction_dir / "raw-mask.png"
    save_mask(raw_mask_path, raw_mask)
    if sha256_file(raw_mask_path) != case["raw_mask_sha256"]:
        raise ValueError(f"Raw-mask file hash drift for {case['id']}")
    if sha256_mask_pixels(raw_mask) != case["raw_mask_pixel_sha256"]:
        raise ValueError(f"Raw-mask pixel hash drift for {case['id']}")
    _, raw_inventory = stable_components(raw_mask)
    save_component_overlay(extraction_dir / "components.png", crop, raw_mask)
    write_json(
        extraction_dir / "extraction.json",
        {
            "schema_version": "word-envelope-stress-extraction.v1",
            "profile": case["extraction_profile"],
            "parameters": extraction_profile,
            "crop_sha256": sha256_file(crop_path),
            "raw_mask_sha256": sha256_file(raw_mask_path),
            "raw_mask_pixel_sha256": sha256_mask_pixels(raw_mask),
            "ink_pixels": int(raw_mask.sum()),
            "components": raw_inventory,
        },
    )

    target_operations = case["target_operations"]
    target_operations_path = inputs_dir / "target-operations.json"
    write_json(target_operations_path, target_operations)
    cleaned_mask, cleanup_log = apply_cleanup_operations(raw_mask, target_operations)
    cleaned_mask_path = cleanup_dir / "cleaned-mask.png"
    discard_mask_path = cleanup_dir / "discard-mask.png"
    save_mask(cleaned_mask_path, cleaned_mask)
    save_mask(discard_mask_path, raw_mask & ~cleaned_mask)
    save_component_overlay(cleanup_dir / "cleaned-components.png", crop, cleaned_mask)
    _, cleaned_inventory = stable_components(cleaned_mask)
    write_json(
        cleanup_dir / "cleanup.json",
        {
            "schema_version": "word-envelope-stress-cleanup.v1",
            "target_operations_sha256": sha256_file(target_operations_path),
            "raw_mask_pixel_sha256": sha256_mask_pixels(raw_mask),
            "cleaned_mask_pixel_sha256": sha256_mask_pixels(cleaned_mask),
            "discard_mask_pixel_sha256": sha256_mask_pixels(raw_mask & ~cleaned_mask),
            "replay_log": cleanup_log,
            "cleaned_components": cleaned_inventory,
        },
    )

    neighbor_operations = case.get("semantic_neighbor_operations")
    neighbor_operations_path: Path | None = None
    if neighbor_operations is None:
        (inputs_dir / "semantic-neighbor-operations.json").unlink(missing_ok=True)
        neighbor_mask = np.zeros_like(raw_mask)
    else:
        neighbor_operations_path = inputs_dir / "semantic-neighbor-operations.json"
        write_json(neighbor_operations_path, neighbor_operations)
        neighbor_mask, _ = apply_cleanup_operations(raw_mask, neighbor_operations)
    target_neighbor_overlap_pixels = int(
        np.count_nonzero(cleaned_mask & neighbor_mask)
    )
    if target_neighbor_overlap_pixels:
        raise ValueError(
            f"Target/semantic-neighbor mask overlap for {case['id']}: "
            f"{target_neighbor_overlap_pixels} pixels"
        )
    neighbor_mask_path = neighbor_dir / "semantic-neighbor-mask.png"
    save_mask(neighbor_mask_path, neighbor_mask)
    save_component_overlay(
        neighbor_dir / "semantic-neighbor-components.png", crop, neighbor_mask
    )

    return {
        "crop": crop,
        "crop_path": crop_path,
        "crop_metadata_path": crop_metadata_path,
        "raw_mask": raw_mask,
        "raw_mask_path": raw_mask_path,
        "cleaned_mask": cleaned_mask,
        "cleaned_mask_path": cleaned_mask_path,
        "target_operations_path": target_operations_path,
        "neighbor_mask": neighbor_mask,
        "neighbor_mask_path": neighbor_mask_path,
        "neighbor_operations_path": neighbor_operations_path,
        "semantic_neighbor_available": neighbor_operations is not None,
        "raw_component_count": len(raw_inventory),
        "cleaned_component_count": len(cleaned_inventory),
        "target_neighbor_overlap_pixels": target_neighbor_overlap_pixels,
    }


def _run_case(
    case: dict[str, Any],
    *,
    envelope_profile: dict[str, Any],
    prepared: dict[str, Any],
    case_dir: Path,
) -> dict[str, Any]:
    method_summaries: dict[str, dict[str, Any]] = {}
    polygons: dict[str, list[list[float]] | None] = {}
    assessments = case.get("assessment", {})
    input_assessment = case["input_assessment"]
    counted_in_evaluation = input_assessment["status"] == "evaluable"
    rough_box = tuple(float(value) for value in case["rough_box_crop_xywh"])

    for method in METHODS:
        result_dir = case_dir / "results" / method
        parameters = dict(envelope_profile[method])
        parameters["angle_degrees"] = float(case["angle_degrees"])
        params = EnvelopeParams.from_mapping(parameters)
        assessment = assessments.get(method, {})
        status = assessment.get("status", "unreviewed")
        notes = assessment.get("notes", "")
        try:
            diagnostic = build_example(
                example_id=case["id"],
                crop_path=prepared["crop_path"],
                raw_mask_path=prepared["raw_mask_path"],
                cleaned_mask_path=prepared["cleaned_mask_path"],
                metadata_path=prepared["crop_metadata_path"],
                operations_path=prepared["target_operations_path"],
                excluded_mask_path=prepared["neighbor_mask_path"],
                params=params,
                method=method,
                output_dir=result_dir,
                rough_box=rough_box,
                assessment_status=status,
                assessment_notes=notes,
            )
            result = diagnostic["wrap"]["result"]
            polygons[method] = diagnostic["wrap"]["polygon_crop"]
            method_summaries[method] = {
                "geometry_status": "success",
                "assessment_status": status,
                "counted_in_evaluation": counted_in_evaluation,
                "polygon_sha256": result["polygon_sha256"],
                "selected_ink_coverage": result["selected_ink_coverage"],
                "selected_ink_support_coverage": result[
                    "selected_ink_support_coverage"
                ],
                "background_area_reduction": result["background_area_reduction"],
                "envelope_to_ink_area_ratio": result[
                    "envelope_to_ink_area_ratio"
                ],
                "excluded_ink_contamination": result[
                    "excluded_ink_contamination"
                ],
                "excluded_component_max_contamination": result[
                    "excluded_component_max_contamination"
                ],
                "angle_degrees": result["angle_degrees"],
                "angle_source": result["angle_source"],
            }
        except EnvelopeError as error:
            reset_result_dir(result_dir)
            failure = {
                "schema_version": "word-envelope-stress-failure.v1",
                "example_id": case["id"],
                "method": method,
                "error_type": type(error).__name__,
                "message": str(error),
                "parameters": params.as_record(),
                "rough_region_crop_xywh": list(rough_box),
                "input_hashes": {
                    "crop": sha256_file(prepared["crop_path"]),
                    "raw_mask": sha256_file(prepared["raw_mask_path"]),
                    "cleaned_mask": sha256_file(prepared["cleaned_mask_path"]),
                    "semantic_neighbor_mask": sha256_file(
                        prepared["neighbor_mask_path"]
                    ),
                },
            }
            write_json(result_dir / "failure.json", failure)
            polygons[method] = None
            method_summaries[method] = {
                "geometry_status": "failure",
                "assessment_status": "failure",
                "declared_assessment_status": status,
                "counted_in_evaluation": counted_in_evaluation,
                "error_type": type(error).__name__,
                "message": str(error),
            }

    preferred = case["preferred_method"]
    valid_methods = [method for method in METHODS if polygons[method] is not None]
    assessment_rank = {"failure": 0, "unreviewed": 1, "partial": 2, "success": 3}
    diagnostic_display_method = (
        max(
            valid_methods,
            key=lambda method: (
                assessment_rank[method_summaries[method]["assessment_status"]],
                method == preferred,
            ),
        )
        if valid_methods
        else None
    )
    display_method = diagnostic_display_method if counted_in_evaluation else None
    display_title = (
        case["label"]
        if counted_in_evaluation
        else f"{case['label']} - INVALID INPUT, NOT SCORED"
    )
    save_method_comparison(
        case_dir / "method-comparison.png",
        title=display_title,
        crop=prepared["crop"],
        method_polygons=[(method, polygons[method]) for method in METHODS],
    )
    save_six_panel_comparison(
        case_dir / "six-panel.png",
        title=(
            f"{display_title} - {diagnostic_display_method}"
            if diagnostic_display_method is not None
            else f"{display_title} - no valid envelope"
        ),
        crop=prepared["crop"],
        raw_mask=prepared["raw_mask"],
        cleaned_mask=prepared["cleaned_mask"],
        polygon=(
            polygons[diagnostic_display_method]
            if diagnostic_display_method is not None
            else None
        ),
        rough_box=rough_box,
    )
    return {
        "id": case["id"],
        "label": case["label"],
        "tags": case.get("tags", []),
        "input_assessment": input_assessment,
        "source_target_box_xywh": case["source_target_box_xywh"],
        "crop_sha256": sha256_file(prepared["crop_path"]),
        "raw_mask_pixel_sha256": sha256_mask_pixels(prepared["raw_mask"]),
        "cleaned_mask_pixel_sha256": sha256_mask_pixels(prepared["cleaned_mask"]),
        "semantic_neighbor_mask_pixel_sha256": sha256_mask_pixels(
            prepared["neighbor_mask"]
        ),
        "semantic_neighbor_available": prepared["semantic_neighbor_available"],
        "raw_component_count": prepared["raw_component_count"],
        "cleaned_component_count": prepared["cleaned_component_count"],
        "target_neighbor_overlap_pixels": prepared[
            "target_neighbor_overlap_pixels"
        ],
        "preferred_method": preferred,
        "display_method": display_method,
        "diagnostic_display_method": diagnostic_display_method,
        "methods": method_summaries,
    }


def _validate_manifest(manifest: dict[str, Any]) -> None:
    if manifest.get("schema_version") != STRESS_SCHEMA_VERSION:
        raise ValueError(f"Manifest must use {STRESS_SCHEMA_VERSION}")
    cases = manifest.get("cases")
    if not isinstance(cases, list) or not cases:
        raise ValueError("Stress manifest requires a non-empty cases list")
    ids = [case.get("id") for case in cases]
    if any(
        not isinstance(case_id, str) or not CASE_ID_PATTERN.fullmatch(case_id)
        for case_id in ids
    ):
        raise ValueError("Every stress case requires a safe non-empty id")
    if len(ids) != len(set(ids)):
        raise ValueError("Stress case ids must be unique")
    missing_required = sorted(set(manifest.get("required_case_ids", [])) - set(ids))
    if missing_required:
        raise ValueError(f"Missing required stress cases: {missing_required}")

    extraction_profiles = manifest.get("extraction_profiles", {})
    envelope_profiles = manifest.get("envelope_profiles", {})
    for case in cases:
        unknown = sorted(set(case) - _CASE_KEYS)
        if unknown:
            raise ValueError(f"Unknown keys for {case['id']}: {unknown}")
        if case.get("extraction_profile") not in extraction_profiles:
            raise ValueError(f"Unknown extraction profile for {case['id']}")
        if case.get("envelope_profile") not in envelope_profiles:
            raise ValueError(f"Unknown envelope profile for {case['id']}")
        if case.get("preferred_method") not in METHODS:
            raise ValueError(f"Invalid preferred method for {case['id']}")
        if "input_assessment" not in case:
            raise ValueError(f"Missing input assessment for {case['id']}")
        input_assessment = case["input_assessment"]
        if not isinstance(input_assessment, dict):
            raise ValueError(f"Invalid input assessment for {case['id']}")
        input_status = input_assessment.get("status")
        if input_status not in INPUT_ASSESSMENT_STATUSES:
            raise ValueError(f"Invalid input assessment status for {case['id']}")
        if not isinstance(input_assessment.get("notes", ""), str):
            raise ValueError(f"Invalid input assessment notes for {case['id']}")
        if input_status == "invalid_input":
            if not input_assessment.get("reason_code") or not input_assessment.get(
                "notes"
            ):
                raise ValueError(
                    f"Invalid-input assessment requires reason and notes for {case['id']}"
                )
            if case["id"] in manifest.get("required_case_ids", []):
                raise ValueError(f"Required stress case {case['id']} must be evaluable")
        assessments = case.get("assessment", {})
        if not isinstance(assessments, dict) or not set(assessments).issubset(METHODS):
            raise ValueError(f"Invalid assessments for {case['id']}")
        for method, assessment in assessments.items():
            if not isinstance(assessment, dict):
                raise ValueError(f"Invalid {method} assessment for {case['id']}")
            if assessment.get("status") not in ASSESSMENT_STATUSES:
                raise ValueError(
                    f"Invalid {method} assessment status for {case['id']}"
                )
            if not isinstance(assessment.get("notes", ""), str):
                raise ValueError(f"Invalid {method} assessment notes for {case['id']}")
        operations = case.get("target_operations", {})
        if operations.get("schema_version") != CLEANUP_SCHEMA_VERSION:
            raise ValueError(f"Invalid target operations for {case['id']}")
        neighbor = case.get("semantic_neighbor_operations")
        if neighbor is not None and neighbor.get("schema_version") != CLEANUP_SCHEMA_VERSION:
            raise ValueError(f"Invalid semantic-neighbor operations for {case['id']}")

    for profile_id, profile in envelope_profiles.items():
        if set(profile) != set(METHODS):
            raise ValueError(f"Envelope profile {profile_id} must define both methods")
        for method in METHODS:
            if "angle_degrees" in profile[method] or "centerline" in profile[method]:
                raise ValueError(
                    f"Envelope profile {profile_id}:{method} must not pin orientation"
                )
            EnvelopeParams.from_mapping(profile[method])
