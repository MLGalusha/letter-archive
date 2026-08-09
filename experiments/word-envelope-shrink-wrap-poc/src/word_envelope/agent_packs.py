"""Build blinded, bounded task packs for agent-first ink ownership trials."""

from __future__ import annotations

import hashlib
import math
import re
import shutil
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .agent_ownership import (
    AGENT_OWNERSHIP_SCHEMA_VERSION,
    component_inventory_sha256,
    component_reference,
)
from .io_utils import (
    CLEANUP_SCHEMA_VERSION,
    canonical_json_bytes,
    read_json,
    sha256_file,
    sha256_mask_pixels,
    write_json,
)
from .masks import (
    apply_cleanup_operations,
    create_bounded_crop,
    load_mask,
    save_mask,
    stable_components,
)
from .render import save_component_overlay


AGENT_BENCHMARK_SCHEMA_VERSION = "word-ink-agent-benchmark.v1"
AGENT_TASK_PACK_SCHEMA_VERSION = "word-ink-agent-task-pack.v1"
AGENT_TRUTH_SCHEMA_VERSION = "word-ink-agent-task-truth.v1"
AGENT_PACK_SUMMARY_SCHEMA_VERSION = "word-ink-agent-pack-summary.v1"
MANAGED_TASKS_SCHEMA_VERSION = "word-ink-agent-managed-tasks.v1"
AGENT_PUBLIC_STAGE_SCHEMA_VERSION = "word-ink-agent-public-stage.v1"
_SAFE_ID = re.compile(r"^[a-z0-9][a-z0-9-]*$")
_PREPROCESSING_EDGE_CORRIDOR_PX = 16
_BOARD_WIDTH = 1800
_BOARD_PANEL_WIDTH = 600
_BOARD_PANEL_HEIGHT = 520
_BOARD_HEADER_HEIGHT = 68
_COLORS = {
    "active": (25, 190, 105),
    "prior": (225, 55, 65),
    "unresolved": (235, 157, 40),
    "work": (35, 105, 220),
}


def generate_agent_task_packs(
    pilot_path: Path,
    stress_manifest_path: Path,
    stress_artifacts_dir: Path,
    output_dir: Path,
    *,
    prompt_path: Path,
) -> dict[str, Any]:
    """Generate public task views and sealed evaluator truth for one pilot."""

    prompt_sha256 = _validate_prompt(prompt_path)
    pilot = read_json(pilot_path)
    _validate_pilot(pilot)
    manifest = read_json(stress_manifest_path)
    cases_by_id = {case["id"]: case for case in manifest["cases"]}
    requested_ids = {case["case_id"] for case in pilot["cases"]}
    missing = sorted(requested_ids - set(cases_by_id))
    if missing:
        raise ValueError(f"Pilot references missing stress cases: {missing}")
    for pilot_case in pilot["cases"]:
        case = cases_by_id[pilot_case["case_id"]]
        target = _public_target(case, pilot_case)
        if not isinstance(target, str) or not target.strip():
            raise ValueError(
                "Agent task target transcript must be a non-empty string for "
                f"{pilot_case['opaque_id']} ({case['id']}); route missing "
                "transcripts in software instead"
            )

    output_dir.mkdir(parents=True, exist_ok=True)
    task_ids = {
        f"{case['opaque_id']}-{variant['opaque_suffix']}"
        for case in pilot["cases"]
        for variant in pilot["variants"]
    }
    managed_path = output_dir / "managed-tasks.json"
    prior_ids = _read_managed_task_ids(managed_path)
    for task_id in sorted(prior_ids | task_ids):
        task_dir = output_dir / task_id
        if task_dir.is_symlink():
            raise ValueError(f"Refusing to replace symlinked agent task: {task_dir}")
        if task_dir.exists():
            if not task_dir.is_dir():
                raise ValueError(f"Agent task path is not a directory: {task_dir}")
            shutil.rmtree(task_dir)
    write_json(
        managed_path,
        {
            "schema_version": MANAGED_TASKS_SCHEMA_VERSION,
            "task_ids": sorted(task_ids),
        },
    )

    task_summaries: list[dict[str, Any]] = []
    for pilot_case in pilot["cases"]:
        case = cases_by_id[pilot_case["case_id"]]
        for variant in pilot["variants"]:
            task_id = f"{pilot_case['opaque_id']}-{variant['opaque_suffix']}"
            task_summaries.append(
                _generate_one_pack(
                    task_id=task_id,
                    pilot_case=pilot_case,
                    variant=variant,
                    context_config=pilot["context"],
                    case=case,
                    manifest_path=stress_manifest_path,
                    stress_artifacts_dir=stress_artifacts_dir,
                    task_dir=output_dir / task_id,
                    prompt_path=prompt_path,
                    prompt_sha256=prompt_sha256,
                )
            )

    summary = {
        "schema_version": AGENT_PACK_SUMMARY_SCHEMA_VERSION,
        "suite_id": pilot["suite_id"],
        "pilot_sha256": sha256_file(pilot_path),
        "stress_manifest_sha256": sha256_file(stress_manifest_path),
        "prompt_sha256": prompt_sha256,
        "task_count": len(task_summaries),
        "tasks": task_summaries,
    }
    write_json(output_dir / "summary.json", summary)
    return summary


def stage_public_task_packs(
    pack_dir: Path,
    output_dir: Path,
    task_ids: list[str] | tuple[str, ...] | None = None,
) -> dict[str, Any]:
    """Copy verified public task files into a physically public-only stage."""

    if pack_dir.is_symlink() or output_dir.is_symlink():
        raise ValueError("Public stage source and output roots must not be symlinks")
    pack_root = pack_dir.resolve()
    stage_root = output_dir.resolve()
    if pack_root == stage_root:
        raise ValueError("Public stage output must differ from the source pack directory")
    if stage_root.is_relative_to(pack_root) or pack_root.is_relative_to(stage_root):
        raise ValueError(
            "Public stage output and source pack directory must not contain one another"
        )
    if task_ids is None:
        selected_ids = sorted(_read_managed_task_ids(pack_dir / "managed-tasks.json"))
        if not selected_ids:
            raise ValueError("Source pack has no managed public tasks to stage")
    else:
        selected_ids = list(task_ids)
        if not selected_ids:
            raise ValueError("Public stage task_ids must be non-empty when supplied")
        if len(selected_ids) != len(set(selected_ids)):
            raise ValueError("Public stage task_ids must be unique")
        if any(
            not isinstance(task_id, str) or not _SAFE_ID.fullmatch(task_id)
            for task_id in selected_ids
        ):
            raise ValueError("Public stage task_ids must be safe lowercase ids")
        selected_ids.sort()

    staged_tasks = [
        _verified_public_task_source(pack_dir, task_id) for task_id in selected_ids
    ]
    output_dir.mkdir(parents=True, exist_ok=True)
    summary_path = output_dir / "stage-summary.json"
    if summary_path.is_symlink():
        raise ValueError(f"Refusing to replace symlinked stage summary: {summary_path}")
    prior_ids = _read_staged_task_ids(summary_path)
    for task_id in sorted(prior_ids - set(selected_ids)):
        _remove_managed_stage_task(output_dir / task_id)

    task_summaries: list[dict[str, Any]] = []
    for source in staged_tasks:
        task_id = source["task_id"]
        destination = output_dir / task_id
        if destination.exists() or destination.is_symlink():
            if task_id not in prior_ids:
                raise ValueError(
                    f"Refusing to replace unmanaged public stage path: {destination}"
                )
            _remove_managed_stage_task(destination)
        destination.mkdir()
        copied: list[dict[str, str]] = []
        for relative_path, expected_hash in source["files"]:
            source_path = source["public_dir"] / relative_path
            destination_path = destination / relative_path
            destination_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source_path, destination_path)
            observed_hash = sha256_file(destination_path)
            if observed_hash != expected_hash:
                raise ValueError(
                    f"Public stage copy drift for {task_id}/{relative_path}"
                )
            copied.append({"path": relative_path, "sha256": observed_hash})
        task_summaries.append(
            {
                "task_id": task_id,
                "task_pack_sha256": source["task_pack_sha256"],
                "files": copied,
            }
        )

    summary = {
        "schema_version": AGENT_PUBLIC_STAGE_SCHEMA_VERSION,
        "task_count": len(task_summaries),
        "task_ids": selected_ids,
        "tasks": task_summaries,
    }
    write_json(summary_path, summary)
    return summary


def _verified_public_task_source(pack_dir: Path, task_id: str) -> dict[str, Any]:
    task_dir = pack_dir / task_id
    public_dir = task_dir / "public"
    if task_dir.is_symlink() or public_dir.is_symlink():
        raise ValueError(f"Refusing symlinked public task source for {task_id}")
    task_path = public_dir / "task.json"
    if not task_path.is_file() or task_path.is_symlink():
        raise ValueError(f"Missing safe public task record for {task_id}")
    task = read_json(task_path)
    if not isinstance(task, dict) or task.get("task_id") != task_id:
        raise ValueError(f"Public task id mismatch for {task_id}")
    task_hash = task.get("task_pack_sha256")
    if not isinstance(task_hash, str):
        raise ValueError(f"Public task hash is missing for {task_id}")
    task_basis = dict(task)
    task_basis.pop("task_pack_sha256", None)
    observed_task_hash = hashlib.sha256(canonical_json_bytes(task_basis)).hexdigest()
    if observed_task_hash != task_hash:
        raise ValueError(f"Public task binding hash drift for {task_id}")
    assets = task.get("public_assets")
    if not isinstance(assets, dict) or not assets:
        raise ValueError(f"Public task assets are missing for {task_id}")
    if "prompt" not in assets or "reading_view" not in assets:
        raise ValueError(f"Public task {task_id} lacks required prompt/reading assets")

    files: list[tuple[str, str]] = []
    seen_paths = {"task.json"}
    for asset_name in sorted(assets):
        asset = assets[asset_name]
        if not isinstance(asset, dict):
            raise ValueError(f"Invalid public asset {asset_name!r} for {task_id}")
        relative_path = asset.get("path")
        expected_hash = asset.get("sha256")
        if not isinstance(relative_path, str) or not isinstance(expected_hash, str):
            raise ValueError(f"Invalid public asset binding {asset_name!r} for {task_id}")
        _validate_public_relative_path(relative_path, task_id=task_id)
        if relative_path in seen_paths:
            raise ValueError(f"Duplicate public asset path {relative_path!r} for {task_id}")
        seen_paths.add(relative_path)
        source_path = public_dir / relative_path
        resolved_source = source_path.resolve()
        if not resolved_source.is_relative_to(public_dir.resolve()):
            raise ValueError(f"Public asset escapes task directory for {task_id}")
        if any(
            parent.is_symlink()
            for parent in source_path.parents
            if parent != public_dir and parent.is_relative_to(public_dir)
        ):
            raise ValueError(f"Symlinked public asset parent for {task_id}/{relative_path}")
        if not source_path.is_file() or source_path.is_symlink():
            raise ValueError(f"Missing safe public asset {relative_path!r} for {task_id}")
        if sha256_file(source_path) != expected_hash:
            raise ValueError(f"Public asset hash drift for {task_id}/{relative_path}")
        files.append((relative_path, expected_hash))
    files.append(("task.json", sha256_file(task_path)))
    files.sort(key=lambda item: item[0])
    return {
        "task_id": task_id,
        "task_pack_sha256": task_hash,
        "public_dir": public_dir,
        "files": files,
    }


def _validate_public_relative_path(relative_path: str, *, task_id: str) -> None:
    path = Path(relative_path)
    if (
        not relative_path
        or "\\" in relative_path
        or path.is_absolute()
        or any(part in {"", ".", ".."} for part in path.parts)
    ):
        raise ValueError(f"Unsafe public asset path {relative_path!r} for {task_id}")


def _remove_managed_stage_task(path: Path) -> None:
    if path.is_symlink():
        raise ValueError(f"Refusing to remove symlinked public stage task: {path}")
    if not path.exists():
        return
    if not path.is_dir():
        raise ValueError(f"Managed public stage task is not a directory: {path}")
    shutil.rmtree(path)


def _read_staged_task_ids(path: Path) -> set[str]:
    if not path.exists():
        return set()
    try:
        record = read_json(path)
    except (OSError, ValueError):
        return set()
    if (
        not isinstance(record, dict)
        or record.get("schema_version") != AGENT_PUBLIC_STAGE_SCHEMA_VERSION
        or not isinstance(record.get("task_ids"), list)
    ):
        return set()
    return {
        value
        for value in record["task_ids"]
        if isinstance(value, str) and _SAFE_ID.fullmatch(value)
    }


def _generate_one_pack(
    *,
    task_id: str,
    pilot_case: dict[str, Any],
    variant: dict[str, Any],
    context_config: dict[str, Any],
    case: dict[str, Any],
    manifest_path: Path,
    stress_artifacts_dir: Path,
    task_dir: Path,
    prompt_path: Path,
    prompt_sha256: str,
) -> dict[str, Any]:
    public_dir = task_dir / "public"
    private_dir = task_dir / "private"
    artifact_dir = stress_artifacts_dir / case["id"]
    crop_path = artifact_dir / "inputs/crop.png"
    raw_path = artifact_dir / "extraction/raw-mask.png"
    if sha256_file(crop_path) != case["crop"]["sha256"]:
        raise ValueError(f"Stress crop drift for {case['id']}")
    raw_mask = load_mask(raw_path, polarity="bright")
    if sha256_mask_pixels(raw_mask) != case["raw_mask_pixel_sha256"]:
        raise ValueError(f"Stress raw-mask drift for {case['id']}")

    preprocessing = _explicit_preprocessing(
        case["target_operations"],
        pilot_case["preprocessing"],
        mask_shape=raw_mask.shape,
        case_id=case["id"],
    )
    base_mask, preprocessing_log = apply_cleanup_operations(raw_mask, preprocessing)
    truth_target, _ = apply_cleanup_operations(raw_mask, case["target_operations"])
    neighbor_operations = case.get("semantic_neighbor_operations")
    raw_truth_neighbor = (
        apply_cleanup_operations(raw_mask, neighbor_operations)[0]
        if neighbor_operations is not None
        else np.zeros_like(raw_mask)
    )
    neighbor_pixels_excluded = int((raw_truth_neighbor & ~base_mask).sum())
    truth_neighbor = raw_truth_neighbor & base_mask
    del raw_truth_neighbor
    if np.any(truth_neighbor & ~base_mask):
        raise AssertionError(f"Effective neighbor truth escaped base mask for {case['id']}")
    if np.any(truth_target & truth_neighbor):
        raise ValueError(f"Target/neighbor truth overlap for {case['id']}")
    if np.any(truth_target & ~base_mask):
        raise ValueError(f"Target truth is not contained by task base mask for {case['id']}")

    labels, inventory = stable_components(base_mask)
    component_refs = [component_reference(component) for component in inventory]
    truth_ids = [
        component["id"]
        for component in inventory
        if np.any(truth_target & (labels == component["id"]))
    ]
    reconstructed_truth = np.isin(labels, truth_ids)
    if not np.array_equal(reconstructed_truth, truth_target):
        raise ValueError(f"Target truth is not whole-component ownership for {case['id']}")

    with Image.open(crop_path) as source:
        work_crop = source.convert("RGB")
    public_dir.mkdir(parents=True, exist_ok=True)
    prompt_public_path = public_dir / "prompt.md"
    shutil.copyfile(prompt_path, prompt_public_path)
    if sha256_file(prompt_public_path) != prompt_sha256:
        raise ValueError(f"Prompt copy drift for agent task {task_id}")
    work_public_path = public_dir / "work-crop.png"
    work_crop.save(work_public_path, format="PNG", compress_level=9, optimize=False)

    context_padding = (
        int(context_config["large_blue_padding_px"])
        if case["extraction_profile"].startswith("blue")
        else int(context_config["small_gray_padding_px"])
    )
    context_original_path = private_dir / "context-original.png"
    context_metadata_path = private_dir / "context.json"
    context_record = create_bounded_crop(
        Path(case["source_path"]),
        box_xywh=case["source_target_box_xywh"],
        padding=context_padding,
        output_path=context_original_path,
        metadata_path=context_metadata_path,
        max_pixels=int(context_config["maximum_pixels"]),
    )
    with Image.open(context_original_path) as source:
        context_original = source.convert("RGB")

    show_prior = bool(variant["show_prior_owned_ink"])
    prior_mask = truth_neighbor if show_prior else np.zeros_like(base_mask)
    prior_component_ids = [
        component["id"]
        for component in inventory
        if np.any(prior_mask & (labels == component["id"]))
    ]
    shared_component_mask = np.zeros_like(base_mask)
    for component_id in prior_component_ids:
        component_mask = labels == component_id
        if np.any(component_mask & ~prior_mask):
            shared_component_mask |= component_mask

    context_view = _context_overlay(
        context_original,
        context_origin=(
            int(context_record["crop"]["x"]),
            int(context_record["crop"]["y"]),
        ),
        target_box=case["source_target_box_xywh"],
        work_origin=tuple(int(value) for value in case["crop"]["origin_xy"]),
        work_size=tuple(int(value) for value in case["crop"]["size_wh"]),
        prior_mask=prior_mask,
        shared_component_mask=shared_component_mask,
    )
    context_public_path = public_dir / "context.png"
    context_view.save(context_public_path, format="PNG", compress_level=9, optimize=False)

    component_path = public_dir / "components.png"
    _save_large_component_overlay(component_path, work_crop, base_mask)
    ownership_path = public_dir / "ownership-state.png"
    ownership_view = _ownership_overlay(
        work_crop,
        base_mask=base_mask,
        prior_mask=prior_mask,
        shared_component_mask=shared_component_mask,
        target_box=_target_box_in_work(case),
    )
    ownership_view.save(ownership_path, format="PNG", compress_level=9, optimize=False)
    reading_path = public_dir / "reading-view.png"
    reading_rotation = _reading_rotation_degrees(case["angle_degrees"])
    reading_view = _reading_view(ownership_view, reading_rotation)
    reading_view.save(reading_path, format="PNG", compress_level=9, optimize=False)
    board_path = public_dir / "board.png"
    with Image.open(component_path) as component_source:
        component_view = component_source.convert("RGB")
    _save_board(
        board_path,
        title=f"Task {task_id} - target transcript: {_public_target(case, pilot_case)}",
        panels=[
            ("Larger context", context_view),
            ("Work crop + ownership state", ownership_view),
            ("Numbered current components", component_view),
        ],
        show_prior=show_prior,
    )

    save_mask(private_dir / "base-mask.png", base_mask)
    save_mask(private_dir / "truth-target-mask.png", truth_target)
    truth_neighbor_path = private_dir / "truth-neighbor-mask.png"
    save_mask(truth_neighbor_path, truth_neighbor)
    saved_base = load_mask(private_dir / "base-mask.png", polarity="bright")
    saved_neighbor = load_mask(truth_neighbor_path, polarity="bright")
    if np.any(saved_neighbor & ~saved_base):
        raise AssertionError(f"Saved neighbor truth escaped base mask for {case['id']}")
    del saved_base, saved_neighbor
    input_state_hash = sha256_mask_pixels(base_mask)
    inventory_hash = component_inventory_sha256(inventory)
    target_box_work = _target_box_in_work(case)
    expose_prior_refs = bool(variant["expose_prior_component_refs"])
    task_basis = {
        "schema_version": AGENT_TASK_PACK_SCHEMA_VERSION,
        "task_id": task_id,
        "turn": 0,
        "target_transcript": _public_target(case, pilot_case),
        "target_unit": _target_unit(case, pilot_case),
        "orientation_degrees": case["angle_degrees"],
        "variant": variant["id"],
        "prior_owned_ink_visible": show_prior,
        "prior_owned_component_refs_exposed": expose_prior_refs,
        "input_state_sha256": input_state_hash,
        "component_inventory_sha256": inventory_hash,
        "work_size_wh": [work_crop.width, work_crop.height],
        "active_target_box_work_xywh": target_box_work,
        "components": component_refs,
        "prior_owned_component_refs": [
            component_refs[component_id - 1] for component_id in prior_component_ids
        ] if expose_prior_refs else [],
        "software_preprocessing": {
            "kind": "declared-crop-perimeter-cuts-v1",
            "operation_count": len(preprocessing["operations"]),
            "provenance": pilot_case["preprocessing"]["provenance"],
            "output_state_sha256": input_state_hash,
        },
        "reading_view": {
            "purpose": "reading_only",
            "source_asset": "ownership_state",
            "applied_rotation_degrees": reading_rotation,
            "coordinates_valid": False,
            "instruction": (
                "Use reading-view.png only to read the handwriting; copy all "
                "coordinates and component references from the unrotated task views."
            ),
        },
        "allowed_action_schema_version": AGENT_OWNERSHIP_SCHEMA_VERSION,
        "public_assets": {
            "prompt": {"path": "prompt.md", "sha256": sha256_file(prompt_public_path)},
            "board": {"path": "board.png", "sha256": sha256_file(board_path)},
            "context": {"path": "context.png", "sha256": sha256_file(context_public_path)},
            "work_crop": {"path": "work-crop.png", "sha256": sha256_file(work_public_path)},
            "components": {"path": "components.png", "sha256": sha256_file(component_path)},
            "ownership_state": {"path": "ownership-state.png", "sha256": sha256_file(ownership_path)},
            "reading_view": {"path": "reading-view.png", "sha256": sha256_file(reading_path)},
        },
    }
    task_pack_hash = hashlib.sha256(canonical_json_bytes(task_basis)).hexdigest()
    task_record = {**task_basis, "task_pack_sha256": task_pack_hash}
    write_json(public_dir / "task.json", task_record)

    truth_record = {
        "schema_version": AGENT_TRUTH_SCHEMA_VERSION,
        "task_id": task_id,
        "case_id": case["id"],
        "pilot_tier": pilot_case["pilot_tier"],
        "input_assessment": case["input_assessment"],
        "stress_manifest_path": str(manifest_path.resolve()),
        "stress_manifest_sha256": sha256_file(manifest_path),
        "task_pack_sha256": task_pack_hash,
        "prompt_sha256": prompt_sha256,
        "base_mask_pixel_sha256": input_state_hash,
        "truth_target_mask_pixel_sha256": sha256_mask_pixels(truth_target),
        "truth_neighbor_mask_pixel_sha256": sha256_mask_pixels(truth_neighbor),
        "semantic_neighbor_pixels_excluded_outside_base": neighbor_pixels_excluded,
        "truth_target_component_refs": [
            component_refs[component_id - 1] for component_id in truth_ids
        ],
        "semantic_neighbor_available": neighbor_operations is not None,
        "preprocessing_log": preprocessing_log,
        "context": context_record,
    }
    write_json(private_dir / "truth.json", truth_record)
    return {
        "task_id": task_id,
        "variant": variant["id"],
        "task_pack_sha256": task_pack_hash,
        "prompt_sha256": prompt_sha256,
        "public_task_path": str((public_dir / "task.json").resolve()),
        "public_board_path": str(board_path.resolve()),
    }


def _explicit_preprocessing(
    target_operations: dict[str, Any],
    preprocessing_config: dict[str, Any],
    *,
    mask_shape: tuple[int, ...],
    case_id: str,
) -> dict[str, Any]:
    operations = target_operations.get("operations")
    if not isinstance(operations, list):
        raise ValueError(f"Target operations are invalid for {case_id}")
    operation_count = preprocessing_config["operation_count"]
    if operation_count > len(operations):
        raise ValueError(
            f"Declared preprocessing count {operation_count} exceeds the "
            f"{len(operations)} target operations for {case_id}"
        )
    declared = operations[:operation_count]
    for index, operation in enumerate(declared):
        _validate_perimeter_cut(
            operation,
            mask_shape=mask_shape,
            case_id=case_id,
            operation_index=index,
        )
    return {
        "schema_version": CLEANUP_SCHEMA_VERSION,
        "operations": declared,
    }


def _validate_perimeter_cut(
    operation: Any,
    *,
    mask_shape: tuple[int, ...],
    case_id: str,
    operation_index: int,
) -> None:
    if not isinstance(operation, dict) or operation.get("type") != "cut":
        raise ValueError(
            f"Declared preprocessing operation {operation_index} for {case_id} "
            "must be a cut"
        )
    points = operation.get("points")
    if not isinstance(points, list) or len(points) < 2:
        raise ValueError(
            f"Declared preprocessing cut {operation_index} for {case_id} must "
            "have at least two points"
        )
    if len(mask_shape) != 2:
        raise ValueError(f"Agent task mask must be two-dimensional for {case_id}")
    height, width = (int(mask_shape[0]), int(mask_shape[1]))
    try:
        xs = [float(point[0]) for point in points]
        ys = [float(point[1]) for point in points]
    except (IndexError, TypeError, ValueError) as error:
        raise ValueError(
            f"Declared preprocessing cut {operation_index} for {case_id} has "
            "invalid points"
        ) from error
    if not all(math.isfinite(value) for value in (*xs, *ys)):
        raise ValueError(
            f"Declared preprocessing cut {operation_index} for {case_id} has "
            "non-finite points"
        )
    vertical = max(xs) == min(xs) and min(ys) <= 0 and max(ys) >= height - 1
    horizontal = max(ys) == min(ys) and min(xs) <= 0 and max(xs) >= width - 1
    if vertical:
        coordinate = xs[0]
        corridor = _edge_corridor(width)
        near_edge = (
            0 <= coordinate <= corridor
            or width - 1 - corridor <= coordinate <= width - 1
        )
    elif horizontal:
        coordinate = ys[0]
        corridor = _edge_corridor(height)
        near_edge = (
            0 <= coordinate <= corridor
            or height - 1 - corridor <= coordinate <= height - 1
        )
    else:
        near_edge = False
    if not near_edge:
        raise ValueError(
            f"Declared preprocessing cut {operation_index} for {case_id} must "
            "be an axis-aligned crop-spanning cut inside the edge corridor"
        )


def _edge_corridor(dimension: int) -> int:
    return min(
        _PREPROCESSING_EDGE_CORRIDOR_PX,
        max(2, int(math.ceil(dimension * 0.25))),
    )


def _target_box_in_work(case: dict[str, Any]) -> list[int]:
    source_x, source_y, width, height = (
        int(value) for value in case["source_target_box_xywh"]
    )
    crop_x, crop_y = (int(value) for value in case["crop"]["origin_xy"])
    return [source_x - crop_x, source_y - crop_y, width, height]


def _reading_rotation_degrees(orientation_degrees: Any) -> float:
    if isinstance(orientation_degrees, bool) or not isinstance(
        orientation_degrees, (int, float)
    ):
        raise ValueError("Agent task orientation_degrees must be numeric")
    angle = float(orientation_degrees)
    if not math.isfinite(angle):
        raise ValueError("Agent task orientation_degrees must be finite")
    rotation = -angle
    return 0.0 if rotation == 0 else rotation


def _reading_view(image: Image.Image, rotation_degrees: float) -> Image.Image:
    source = image.convert("RGB")
    if rotation_degrees == 0:
        return source.copy()
    return source.rotate(
        rotation_degrees,
        resample=Image.Resampling.BICUBIC,
        expand=True,
        fillcolor=(255, 255, 255),
    )


def _public_target(case: dict[str, Any], pilot_case: dict[str, Any]) -> str | None:
    if "public_target_transcript" in pilot_case:
        return pilot_case["public_target_transcript"]
    if case["input_assessment"]["status"] == "invalid_input" and case["id"].endswith(
        "fold-fragment"
    ):
        return None
    return case["label"]


def _target_unit(case: dict[str, Any], pilot_case: dict[str, Any]) -> str:
    if "target_unit" in pilot_case:
        return pilot_case["target_unit"]
    target = _public_target(case, pilot_case)
    if target is None:
        return "single_word"
    if target == "P.S.":
        return "punctuation_group"
    return "multi_word_phrase" if " " in target else "single_word"


def _context_overlay(
    context: Image.Image,
    *,
    context_origin: tuple[int, int],
    target_box: list[int],
    work_origin: tuple[int, int],
    work_size: tuple[int, int],
    prior_mask: np.ndarray,
    shared_component_mask: np.ndarray,
) -> Image.Image:
    image = context.convert("RGBA")
    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    work_offset = (
        work_origin[0] - context_origin[0],
        work_origin[1] - context_origin[1],
    )
    _paste_mask(layer, shared_component_mask, work_offset, (*_COLORS["unresolved"], 130))
    _paste_mask(layer, prior_mask, work_offset, (*_COLORS["prior"], 190))
    draw = ImageDraw.Draw(layer)
    work_x, work_y = work_offset
    draw.rectangle(
        (work_x, work_y, work_x + work_size[0], work_y + work_size[1]),
        outline=(*_COLORS["work"], 240),
        width=3,
    )
    target_x = int(target_box[0]) - context_origin[0]
    target_y = int(target_box[1]) - context_origin[1]
    draw.rectangle(
        (
            target_x,
            target_y,
            target_x + int(target_box[2]),
            target_y + int(target_box[3]),
        ),
        outline=(*_COLORS["active"], 255),
        width=4,
    )
    return Image.alpha_composite(image, layer).convert("RGB")


def _ownership_overlay(
    crop: Image.Image,
    *,
    base_mask: np.ndarray,
    prior_mask: np.ndarray,
    shared_component_mask: np.ndarray,
    target_box: list[int],
) -> Image.Image:
    image = crop.convert("RGBA")
    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    unresolved = base_mask & ~prior_mask
    _paste_mask(layer, unresolved, (0, 0), (*_COLORS["unresolved"], 80))
    _paste_mask(layer, shared_component_mask, (0, 0), (*_COLORS["unresolved"], 160))
    _paste_mask(layer, prior_mask, (0, 0), (*_COLORS["prior"], 200))
    draw = ImageDraw.Draw(layer)
    x, y, width, height = target_box
    draw.rectangle(
        (x, y, x + width, y + height),
        outline=(*_COLORS["active"], 255),
        width=2,
    )
    return Image.alpha_composite(image, layer).convert("RGB")


def _paste_mask(
    layer: Image.Image,
    mask: np.ndarray,
    offset: tuple[int, int],
    color: tuple[int, int, int, int],
) -> None:
    binary = np.asarray(mask, dtype=bool)
    overlay = np.zeros((*binary.shape, 4), dtype=np.uint8)
    overlay[binary] = color
    patch = Image.fromarray(overlay, mode="RGBA")
    layer.alpha_composite(patch, dest=offset)


def _save_large_component_overlay(
    path: Path, crop: Image.Image, mask: np.ndarray
) -> None:
    longest = max(crop.size)
    scale = max(1, min(5, math.ceil(850 / longest)))
    scaled_crop = crop.resize(
        (crop.width * scale, crop.height * scale), Image.Resampling.LANCZOS
    )
    scaled_mask = np.repeat(np.repeat(mask, scale, axis=0), scale, axis=1)
    save_component_overlay(path, scaled_crop, scaled_mask)


def _save_board(
    path: Path,
    *,
    title: str,
    panels: list[tuple[str, Image.Image]],
    show_prior: bool,
) -> None:
    board = Image.new(
        "RGB",
        (_BOARD_WIDTH, _BOARD_HEADER_HEIGHT + _BOARD_PANEL_HEIGHT),
        (244, 243, 239),
    )
    draw = ImageDraw.Draw(board)
    font = ImageFont.load_default()
    draw.text((14, 10), title, fill=(20, 20, 20), font=font)
    legend = "green=active rough box; blue=work crop; amber=unassigned ink"
    if show_prior:
        legend += "; red=previously owned neighboring ink"
    draw.text((14, 34), legend, fill=(55, 55, 55), font=font)
    for index, (label, panel) in enumerate(panels):
        x0 = index * _BOARD_PANEL_WIDTH
        _center_text(board, label, x0, _BOARD_PANEL_WIDTH, _BOARD_HEADER_HEIGHT - 20)
        fitted = _fit_image(panel, (_BOARD_PANEL_WIDTH - 16, _BOARD_PANEL_HEIGHT - 16))
        x = x0 + (_BOARD_PANEL_WIDTH - fitted.width) // 2
        y = _BOARD_HEADER_HEIGHT + (_BOARD_PANEL_HEIGHT - fitted.height) // 2
        board.paste(fitted, (x, y))
    path.parent.mkdir(parents=True, exist_ok=True)
    board.save(path, format="PNG", compress_level=9, optimize=False)


def _fit_image(image: Image.Image, bounds: tuple[int, int]) -> Image.Image:
    fitted = image.convert("RGB")
    fitted.thumbnail(bounds, Image.Resampling.LANCZOS)
    return fitted


def _center_text(image: Image.Image, text: str, x: int, width: int, y: int) -> None:
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default()
    bbox = draw.textbbox((0, 0), text, font=font)
    draw.text(
        (x + (width - (bbox[2] - bbox[0])) // 2, y),
        text,
        fill=(25, 25, 25),
        font=font,
    )


def _validate_pilot(pilot: dict[str, Any]) -> None:
    if pilot.get("schema_version") != AGENT_BENCHMARK_SCHEMA_VERSION:
        raise ValueError(f"Pilot must use {AGENT_BENCHMARK_SCHEMA_VERSION}")
    if not isinstance(pilot.get("suite_id"), str) or not pilot["suite_id"]:
        raise ValueError("Pilot suite_id must be non-empty")
    cases = pilot.get("cases")
    variants = pilot.get("variants")
    if not isinstance(cases, list) or not cases:
        raise ValueError("Pilot cases must be non-empty")
    if not isinstance(variants, list) or not variants:
        raise ValueError("Pilot variants must be non-empty")
    opaque_ids = [case.get("opaque_id") for case in cases]
    if any(not isinstance(value, str) or not _SAFE_ID.fullmatch(value) for value in opaque_ids):
        raise ValueError("Pilot opaque ids must be safe lowercase ids")
    if len(opaque_ids) != len(set(opaque_ids)):
        raise ValueError("Pilot opaque ids must be unique")
    suffixes = [variant.get("opaque_suffix") for variant in variants]
    if any(not isinstance(value, str) or not _SAFE_ID.fullmatch(value) for value in suffixes):
        raise ValueError("Pilot variant suffixes must be safe lowercase ids")
    if len(suffixes) != len(set(suffixes)):
        raise ValueError("Pilot variant suffixes must be unique")
    for index, variant in enumerate(variants):
        show_prior = variant.get("show_prior_owned_ink")
        expose_refs = variant.get("expose_prior_component_refs")
        if not isinstance(variant.get("id"), str) or not variant["id"]:
            raise ValueError(f"Pilot variant {index} id must be non-empty")
        if not isinstance(show_prior, bool):
            raise ValueError(
                f"Pilot variant {index} show_prior_owned_ink must be boolean"
            )
        if not isinstance(expose_refs, bool):
            raise ValueError(
                f"Pilot variant {index} expose_prior_component_refs must be boolean"
            )
        if expose_refs and not show_prior:
            raise ValueError(
                f"Pilot variant {index} cannot expose prior component references "
                "without showing prior-owned ink"
            )
    for index, pilot_case in enumerate(cases):
        preprocessing = pilot_case.get("preprocessing")
        if not isinstance(preprocessing, dict):
            raise ValueError(f"Pilot case {index} preprocessing config is required")
        if set(preprocessing) != {"operation_count", "provenance"}:
            raise ValueError(
                f"Pilot case {index} preprocessing must contain exactly "
                "operation_count and provenance"
            )
        operation_count = preprocessing["operation_count"]
        if (
            isinstance(operation_count, bool)
            or not isinstance(operation_count, int)
            or operation_count < 0
        ):
            raise ValueError(
                f"Pilot case {index} preprocessing operation_count must be a "
                "non-negative integer"
            )
        provenance = preprocessing["provenance"]
        if not isinstance(provenance, str) or not provenance.strip():
            raise ValueError(
                f"Pilot case {index} preprocessing provenance must be non-empty"
            )
    context = pilot.get("context")
    if not isinstance(context, dict):
        raise ValueError("Pilot context config is required")


def _validate_prompt(path: Path) -> str:
    if not path.is_file() or path.is_symlink():
        raise ValueError(f"Agent prompt must be an existing regular file: {path}")
    try:
        prompt = path.read_text("utf-8")
    except (OSError, UnicodeError) as error:
        raise ValueError(f"Agent prompt must be readable UTF-8 text: {path}") from error
    if not prompt.strip():
        raise ValueError("Agent prompt must not be empty")
    return sha256_file(path)


def _read_managed_task_ids(path: Path) -> set[str]:
    if not path.exists():
        return set()
    try:
        record = read_json(path)
    except (OSError, ValueError):
        return set()
    if (
        not isinstance(record, dict)
        or record.get("schema_version") != MANAGED_TASKS_SCHEMA_VERSION
        or not isinstance(record.get("task_ids"), list)
    ):
        return set()
    return {
        value
        for value in record["task_ids"]
        if isinstance(value, str) and _SAFE_ID.fullmatch(value)
    }
