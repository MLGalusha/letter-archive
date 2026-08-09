"""Public-only candidate critique packs for agent ownership claims.

The ownership agent is allowed to make a first-pass whole-component claim.  A
second agent can use the artifacts produced here to inspect that claim, compare
small reversible alternatives, and return the existing compact
``claim_select`` or ``defer_manual`` decision.  This module deliberately accepts
no benchmark truth, source-case metadata, or private artifact directory.
"""

from __future__ import annotations

import copy
import hashlib
import math
import shutil
import tempfile
from pathlib import Path
from typing import Any, Mapping, Sequence

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .agent_action_builder import (
    AGENT_OWNERSHIP_DECISION_SCHEMA_VERSION,
    build_bound_action,
)
from .agent_ownership import apply_single_action
from .engine import EnvelopeError, MAX_MASK_PIXELS
from .io_utils import (
    canonical_json_bytes,
    sha256_file,
    sha256_mask_pixels,
    write_json,
)
from .masks import stable_components


AGENT_CANDIDATE_REVIEW_SCHEMA_VERSION = "word-ink-candidate-review.v1"
_REQUIRED_PUBLIC_ASSETS = {
    "components",
    "context",
    "ownership_state",
    "reading_view",
    "work_crop",
}
_PRIVATE_FIELD_NAMES = {
    "case_id",
    "input_assessment",
    "pilot_tier",
    "private",
    "private_dir",
    "source_path",
    "stress_manifest_path",
    "stress_manifest_sha256",
    "truth",
    "truth_neighbor_mask",
    "truth_target_component_refs",
    "truth_target_mask",
}
_SELECTED_COLOR = (0, 166, 224)
_CHANGE_COLOR = (196, 52, 190)
_TARGET_COLOR = (25, 190, 105)
_BOARD_BACKGROUND = (244, 243, 239)
_MAX_COUNTERFACTUALS = 24
_MAX_AUXILIARY_IMAGE_PIXELS = 40_000_000


def generate_candidate_review_pack(
    public_task: Mapping[str, Any],
    current_mask: np.ndarray,
    bound_claim: Mapping[str, Any],
    public_assets_dir: Path,
    output_dir: Path,
    *,
    maximum_counterfactuals: int = 12,
) -> dict[str, Any]:
    """Generate a deterministic, physically public-only claim review pack.

    ``public_task`` must retain its task-pack hash. ``current_mask`` must be the
    exact state bound by that task, and ``bound_claim`` must be a validated
    ``claim_select`` action for the same task and turn.  The output directory
    must not exist; it is published atomically after every generated file has
    been hashed.

    The function has intentionally no truth-mask or private-metadata argument.
    All rendered state is derived from the current public mask, the bound claim,
    and hash-verified files named by ``public_task["public_assets"]``.
    """

    if (
        not isinstance(maximum_counterfactuals, int)
        or isinstance(maximum_counterfactuals, bool)
        or not 1 <= maximum_counterfactuals <= _MAX_COUNTERFACTUALS
    ):
        raise ValueError(
            "maximum_counterfactuals must be an integer from 1 to "
            f"{_MAX_COUNTERFACTUALS}"
        )

    assets_root = Path(public_assets_dir)
    destination = Path(output_dir)
    _validate_source_and_destination(assets_root, destination)
    _reject_private_fields(public_task)

    mask = np.asarray(current_mask, dtype=bool)
    if mask.ndim != 2:
        raise EnvelopeError("Candidate-review current mask must be two-dimensional")
    if mask.size > MAX_MASK_PIXELS:
        raise EnvelopeError(
            f"Candidate-review current mask has {mask.size} pixels; limit is "
            f"{MAX_MASK_PIXELS}"
        )

    compact_claim = _compact_claim(bound_claim)
    expected_claim = build_bound_action(
        public_task,
        compact_claim,
        current_mask=mask,
    )
    if dict(bound_claim) != expected_claim:
        raise EnvelopeError(
            "Bound claim does not exactly match the hash-valid public task and "
            "current mask"
        )
    if list(public_task.get("work_size_wh", [])) != [mask.shape[1], mask.shape[0]]:
        raise EnvelopeError("Public task work_size_wh does not match current mask")

    labels, inventory = stable_components(mask)
    selected_ids = [
        int(reference["id"])
        for reference in expected_claim["action"]["target_component_refs"]
    ]
    selected_mask = np.isin(labels, selected_ids)
    if not selected_mask.any():
        raise EnvelopeError("Bound claim must select visible current-mask ink")

    asset_paths = _validated_public_assets(assets_root, public_task)
    work_crop = _load_rgb(asset_paths["work_crop"])
    ownership_state = _load_rgb(asset_paths["ownership_state"])
    expected_size = (mask.shape[1], mask.shape[0])
    if work_crop.size != expected_size or ownership_state.size != expected_size:
        raise EnvelopeError(
            "Public work-crop and ownership-state dimensions must match current mask"
        )

    rotation = _validated_reading_rotation(public_task)
    target_box = _validated_target_box(public_task, expected_size)
    selected_overlay = _selection_overlay(
        ownership_state,
        labels=labels,
        inventory=inventory,
        selected_ids=selected_ids,
        target_box=target_box,
    )
    selected_reading = _rotate_reading_view(selected_overlay, rotation)
    counterfactual_specs = _counterfactual_specs(
        inventory,
        selected_ids,
        target_box=target_box,
        limit=maximum_counterfactuals,
    )

    temporary = Path(
        tempfile.mkdtemp(prefix=f".{destination.name}.tmp-", dir=destination.parent)
    )
    try:
        copied_assets = _copy_review_inputs(asset_paths, temporary)
        generated_assets: dict[str, dict[str, str]] = {}

        selection_path = temporary / "selection-overlay.png"
        _save_png(selection_path, selected_overlay)
        generated_assets["selection_overlay"] = _asset_record(
            selection_path, temporary
        )

        selected_reading_path = temporary / "selection-reading-view.png"
        _save_png(selected_reading_path, selected_reading)
        generated_assets["selection_reading_view"] = _asset_record(
            selected_reading_path, temporary
        )

        counterfactual_records: list[dict[str, Any]] = []
        preview_images: list[Image.Image] = []
        for spec in counterfactual_specs:
            preview = _counterfactual_preview(
                ownership_state,
                labels=labels,
                inventory=inventory,
                selected_ids=spec["component_ids"],
                changed_component_id=spec["component_id"],
                edit=spec["edit"],
                target_box=target_box,
            )
            filename = (
                f"counterfactuals/{spec['edit']}-component-"
                f"{spec['component_id']:05d}.png"
            )
            preview_path = temporary / filename
            _save_png(preview_path, preview)
            compact_decision = _candidate_decision(spec["component_ids"])
            # This is the same builder the critic's response will pass through.
            build_bound_action(public_task, compact_decision, current_mask=mask)
            counterfactual_records.append(
                {
                    "counterfactual_id": (
                        f"{spec['edit']}-component-{spec['component_id']}"
                    ),
                    "edit": spec["edit"],
                    "component_id": spec["component_id"],
                    "resulting_component_ids": spec["component_ids"],
                    "preview": _asset_record(preview_path, temporary),
                    "compact_decision": compact_decision,
                }
            )
            preview_images.append(preview)

        contact_sheet = _counterfactual_contact_sheet(preview_images)
        contact_path = temporary / "counterfactuals.png"
        _save_png(contact_path, contact_sheet)
        generated_assets["counterfactuals"] = _asset_record(contact_path, temporary)

        context = _load_rgb(temporary / copied_assets["large_context"]["path"])
        numbered = _load_rgb(
            temporary / copied_assets["numbered_components"]["path"]
        )
        board = _review_board(
            task_id=str(public_task["task_id"]),
            target_transcript=str(public_task.get("target_transcript", "")),
            context=context,
            selected_reading=selected_reading,
            selected_overlay=selected_overlay,
            numbered_components=numbered,
            prior_visible=bool(public_task.get("prior_owned_ink_visible", False)),
        )
        board_path = temporary / "review-board.png"
        _save_png(board_path, board)
        generated_assets["review_board"] = _asset_record(board_path, temporary)

        manual_decision = {
            "schema_version": AGENT_OWNERSHIP_DECISION_SCHEMA_VERSION,
            "action": {
                "type": "defer_manual",
                "disposition": "ambiguous_ownership",
                "confidence": "low",
                "reason_codes": ["uncertain_reading"],
            },
        }
        build_bound_action(public_task, manual_decision, current_mask=mask)
        instructions = _critic_instructions(
            task_id=str(public_task["task_id"]),
            target_transcript=str(public_task.get("target_transcript", "")),
            selected_ids=selected_ids,
            prior_visible=bool(public_task.get("prior_owned_ink_visible", False)),
            manual_decision=manual_decision,
        )
        instructions_path = temporary / "critic-instructions.md"
        instructions_path.write_text(instructions, encoding="utf-8", newline="\n")
        generated_assets["critic_instructions"] = _asset_record(
            instructions_path, temporary
        )

        claim_hash = hashlib.sha256(canonical_json_bytes(expected_claim)).hexdigest()
        review_basis: dict[str, Any] = {
            "schema_version": AGENT_CANDIDATE_REVIEW_SCHEMA_VERSION,
            "review_kind": "claim_candidate",
            "task_binding": {
                "task_id": public_task["task_id"],
                "task_pack_sha256": public_task["task_pack_sha256"],
                "turn": public_task["turn"],
                "input_state_sha256": sha256_mask_pixels(mask),
                "component_inventory_sha256": public_task[
                    "component_inventory_sha256"
                ],
            },
            "bound_claim_sha256": claim_hash,
            "target_transcript": public_task.get("target_transcript", ""),
            "prior_owned_ink_visible": bool(
                public_task.get("prior_owned_ink_visible", False)
            ),
            "selected_component_ids": selected_ids,
            "original_compact_claim_select_decision": compact_claim,
            "source_public_asset_sha256": {
                name: public_task["public_assets"][name]["sha256"]
                for name in sorted(_REQUIRED_PUBLIC_ASSETS)
            },
            "review_assets": {
                **copied_assets,
                **generated_assets,
            },
            "counterfactual_policy": {
                "kind": "bounded-one-component-toggle-v1",
                "maximum_counterfactuals": maximum_counterfactuals,
                "removal_priority": "smallest_selected_component_then_id",
                "addition_priority": (
                    "inside_active_box_then_nearest_selected_component_then_id"
                ),
            },
            "counterfactuals": counterfactual_records,
            "critic_response": {
                "schema_version": AGENT_OWNERSHIP_DECISION_SCHEMA_VERSION,
                "allowed_action_types": ["claim_select", "defer_manual"],
                "instruction_asset": generated_assets["critic_instructions"],
                "defer_manual_example": manual_decision,
            },
        }
        review_hash = hashlib.sha256(canonical_json_bytes(review_basis)).hexdigest()
        review_record = {**review_basis, "review_pack_sha256": review_hash}
        write_json(temporary / "review.json", review_record)
        _validate_generated_review(temporary, review_record)

        if destination.exists() or destination.is_symlink():
            raise ValueError(f"Refusing to overwrite candidate-review pack: {destination}")
        temporary.rename(destination)
        return review_record
    except Exception:
        if temporary.exists() and not temporary.is_symlink():
            shutil.rmtree(temporary)
        raise


def generate_exclusion_review_pack(
    public_task: Mapping[str, Any],
    current_mask: np.ndarray,
    bound_exclusion: Mapping[str, Any],
    public_assets_dir: Path,
    output_dir: Path,
) -> dict[str, Any]:
    """Preview a bound exclusion without committing it to the current state.

    Bright red pixels in the generated comparison are exactly the public-mask
    pixels the proposed whole-component exclusion would remove.  The reviewer
    can approve by returning the included compact ``exclude`` decision, revise
    its component IDs, or preserve the current state by returning the included
    ``defer_manual`` decision.  No benchmark truth is consulted.
    """

    assets_root = Path(public_assets_dir)
    destination = Path(output_dir)
    _validate_source_and_destination(assets_root, destination)
    _reject_private_fields(public_task)

    mask = np.asarray(current_mask, dtype=bool)
    if mask.ndim != 2:
        raise EnvelopeError("Exclusion-review current mask must be two-dimensional")
    if mask.size > MAX_MASK_PIXELS:
        raise EnvelopeError(
            f"Exclusion-review current mask has {mask.size} pixels; limit is "
            f"{MAX_MASK_PIXELS}"
        )
    compact_exclusion = _compact_exclusion(bound_exclusion)
    expected_exclusion = build_bound_action(
        public_task,
        compact_exclusion,
        current_mask=mask,
    )
    if dict(bound_exclusion) != expected_exclusion:
        raise EnvelopeError(
            "Bound exclusion does not exactly match the hash-valid public task "
            "and current mask"
        )
    if list(public_task.get("work_size_wh", [])) != [mask.shape[1], mask.shape[0]]:
        raise EnvelopeError("Public task work_size_wh does not match current mask")

    simulation = apply_single_action(expected_exclusion, mask)
    if not simulation.requires_later_turn:
        raise EnvelopeError("Proposed exclusion must require a later turn")
    output_mask = np.asarray(simulation.output_mask, dtype=bool)
    removed_mask = mask & ~output_mask
    if not removed_mask.any() or np.any(output_mask & ~mask):
        raise EnvelopeError("Proposed exclusion must remove current-mask ink only")

    labels, inventory = stable_components(mask)
    removed_ids = [
        int(reference["id"])
        for reference in expected_exclusion["action"]["component_refs"]
    ]
    if not np.array_equal(removed_mask, np.isin(labels, removed_ids)):
        raise EnvelopeError("Proposed exclusion is not an exact whole-component removal")

    asset_paths = _validated_public_assets(assets_root, public_task)
    work_crop = _load_rgb(asset_paths["work_crop"])
    ownership_state = _load_rgb(asset_paths["ownership_state"])
    expected_size = (mask.shape[1], mask.shape[0])
    if work_crop.size != expected_size or ownership_state.size != expected_size:
        raise EnvelopeError(
            "Public work-crop and ownership-state dimensions must match current mask"
        )
    target_box = _validated_target_box(public_task, expected_size)
    rotation = _validated_reading_rotation(public_task)
    before = _exclusion_before_overlay(
        ownership_state,
        inventory=inventory,
        removed_ids=removed_ids,
        removed_mask=removed_mask,
        target_box=target_box,
    )
    after = _exclusion_after_overlay(
        ownership_state,
        inventory=inventory,
        removed_ids=removed_ids,
        removed_mask=removed_mask,
        target_box=target_box,
    )
    removed_only = _removed_ink_overlay(
        work_crop,
        removed_mask=removed_mask,
        inventory=inventory,
        removed_ids=removed_ids,
    )
    before_reading = _rotate_reading_view(before, rotation)
    after_reading = _rotate_reading_view(after, rotation)

    temporary = Path(
        tempfile.mkdtemp(prefix=f".{destination.name}.tmp-", dir=destination.parent)
    )
    try:
        copied_assets = _copy_review_inputs(asset_paths, temporary)
        generated_assets: dict[str, dict[str, str]] = {}
        renderings = {
            "exclude_before": ("exclude-before.png", before),
            "exclude_after": ("exclude-after.png", after),
            "removed_ink": ("removed-ink.png", removed_only),
            "exclude_before_reading": (
                "exclude-before-reading-view.png",
                before_reading,
            ),
            "exclude_after_reading": (
                "exclude-after-reading-view.png",
                after_reading,
            ),
        }
        for name, (filename, image) in renderings.items():
            path = temporary / filename
            _save_png(path, image)
            generated_assets[name] = _asset_record(path, temporary)

        context = _load_rgb(temporary / copied_assets["large_context"]["path"])
        numbered = _load_rgb(
            temporary / copied_assets["numbered_components"]["path"]
        )
        task_reading = _load_rgb(
            temporary / copied_assets["task_reading_view"]["path"]
        )
        board = _exclusion_board(
            task_id=str(public_task["task_id"]),
            target_transcript=str(public_task.get("target_transcript", "")),
            context=context,
            before=before_reading,
            after=after_reading,
            removed_only=removed_only,
            numbered_components=numbered,
            task_reading_view=task_reading,
            prior_visible=bool(public_task.get("prior_owned_ink_visible", False)),
        )
        board_path = temporary / "exclude-review-board.png"
        _save_png(board_path, board)
        generated_assets["exclude_review_board"] = _asset_record(
            board_path, temporary
        )

        rollback_decision = {
            "schema_version": AGENT_OWNERSHIP_DECISION_SCHEMA_VERSION,
            "action": {
                "type": "defer_manual",
                "disposition": "ambiguous_ownership",
                "confidence": "low",
                "reason_codes": ["uncertain_reading"],
            },
        }
        build_bound_action(public_task, rollback_decision, current_mask=mask)
        instructions = _exclusion_critic_instructions(
            task_id=str(public_task["task_id"]),
            target_transcript=str(public_task.get("target_transcript", "")),
            removed_ids=removed_ids,
            approve_decision=compact_exclusion,
            rollback_decision=rollback_decision,
        )
        instructions_path = temporary / "exclude-critic-instructions.md"
        instructions_path.write_text(instructions, encoding="utf-8", newline="\n")
        generated_assets["critic_instructions"] = _asset_record(
            instructions_path, temporary
        )

        action_hash = hashlib.sha256(
            canonical_json_bytes(expected_exclusion)
        ).hexdigest()
        review_basis: dict[str, Any] = {
            "schema_version": AGENT_CANDIDATE_REVIEW_SCHEMA_VERSION,
            "review_kind": "exclude_before_commit",
            "task_binding": {
                "task_id": public_task["task_id"],
                "task_pack_sha256": public_task["task_pack_sha256"],
                "turn": public_task["turn"],
                "input_state_sha256": sha256_mask_pixels(mask),
                "component_inventory_sha256": public_task[
                    "component_inventory_sha256"
                ],
            },
            "bound_action_sha256": action_hash,
            "target_transcript": public_task.get("target_transcript", ""),
            "prior_owned_ink_visible": bool(
                public_task.get("prior_owned_ink_visible", False)
            ),
            "proposed_excluded_component_ids": removed_ids,
            "proposed_output_state_sha256": sha256_mask_pixels(output_mask),
            "proposed_removed_pixel_count": int(removed_mask.sum()),
            "proposed_compact_exclude_decision": compact_exclusion,
            "source_public_asset_sha256": {
                name: public_task["public_assets"][name]["sha256"]
                for name in sorted(_REQUIRED_PUBLIC_ASSETS)
            },
            "review_assets": {**copied_assets, **generated_assets},
            "counterfactuals": [],
            "critic_response": {
                "schema_version": AGENT_OWNERSHIP_DECISION_SCHEMA_VERSION,
                "allowed_action_types": ["exclude", "defer_manual"],
                "approve_exact_proposal": compact_exclusion,
                "rollback_keep_current_state": rollback_decision,
                "instruction_asset": generated_assets["critic_instructions"],
            },
        }
        review_hash = hashlib.sha256(canonical_json_bytes(review_basis)).hexdigest()
        review_record = {**review_basis, "review_pack_sha256": review_hash}
        write_json(temporary / "review.json", review_record)
        _validate_generated_review(temporary, review_record)
        if destination.exists() or destination.is_symlink():
            raise ValueError(f"Refusing to overwrite candidate-review pack: {destination}")
        temporary.rename(destination)
        return review_record
    except Exception:
        if temporary.exists() and not temporary.is_symlink():
            shutil.rmtree(temporary)
        raise


def _compact_claim(bound_claim: Mapping[str, Any]) -> dict[str, Any]:
    if not isinstance(bound_claim, Mapping):
        raise EnvelopeError("Bound claim must be an object")
    action = bound_claim.get("action")
    if not isinstance(action, Mapping) or action.get("type") != "claim_select":
        raise EnvelopeError("Candidate review requires a bound claim_select action")
    expected_action_keys = {
        "type",
        "target_component_refs",
        "confidence",
        "reason_codes",
    }
    if set(action) != expected_action_keys:
        raise EnvelopeError("Bound claim_select action has invalid fields")
    references = action["target_component_refs"]
    if not isinstance(references, list):
        raise EnvelopeError("Bound claim target_component_refs must be a list")
    try:
        component_ids = [int(reference["id"]) for reference in references]
    except (KeyError, TypeError, ValueError) as error:
        raise EnvelopeError("Bound claim has invalid component references") from error
    return {
        "schema_version": AGENT_OWNERSHIP_DECISION_SCHEMA_VERSION,
        "action": {
            "type": "claim_select",
            "component_ids": component_ids,
            "confidence": copy.deepcopy(action["confidence"]),
            "reason_codes": copy.deepcopy(action["reason_codes"]),
        },
    }


def _compact_exclusion(bound_exclusion: Mapping[str, Any]) -> dict[str, Any]:
    if not isinstance(bound_exclusion, Mapping):
        raise EnvelopeError("Bound exclusion must be an object")
    action = bound_exclusion.get("action")
    if not isinstance(action, Mapping) or action.get("type") != "exclude":
        raise EnvelopeError("Exclusion review requires a bound exclude action")
    expected_action_keys = {
        "type",
        "component_refs",
        "confidence",
        "reason_codes",
    }
    if set(action) != expected_action_keys:
        raise EnvelopeError("Bound exclude action has invalid fields")
    references = action["component_refs"]
    if not isinstance(references, list):
        raise EnvelopeError("Bound exclusion component_refs must be a list")
    try:
        component_ids = [int(reference["id"]) for reference in references]
    except (KeyError, TypeError, ValueError) as error:
        raise EnvelopeError("Bound exclusion has invalid component references") from error
    return {
        "schema_version": AGENT_OWNERSHIP_DECISION_SCHEMA_VERSION,
        "action": {
            "type": "exclude",
            "component_ids": component_ids,
            "confidence": copy.deepcopy(action["confidence"]),
            "reason_codes": copy.deepcopy(action["reason_codes"]),
        },
    }


def _reject_private_fields(value: Mapping[str, Any]) -> None:
    if not isinstance(value, Mapping):
        raise EnvelopeError("Public task must be an object")

    def visit(item: Any) -> None:
        if isinstance(item, Mapping):
            for key, child in item.items():
                if not isinstance(key, str):
                    raise EnvelopeError("Public task object keys must be strings")
                lowered = key.lower()
                if lowered in _PRIVATE_FIELD_NAMES or lowered.startswith("truth_"):
                    raise EnvelopeError(
                        f"Candidate review rejects private task field {key!r}"
                    )
                visit(child)
        elif isinstance(item, list):
            for child in item:
                visit(child)

    visit(value)


def _validate_source_and_destination(source: Path, destination: Path) -> None:
    if source.is_symlink() or not source.is_dir():
        raise ValueError(
            f"Public assets root must be a non-symlink directory: {source}"
        )
    if destination.exists() or destination.is_symlink():
        raise ValueError(f"Refusing to overwrite candidate-review pack: {destination}")
    parent = destination.parent
    if parent.is_symlink() or not parent.is_dir():
        raise ValueError(
            f"Candidate-review output parent must be a non-symlink directory: {parent}"
        )
    source_root = source.resolve()
    destination_root = destination.resolve(strict=False)
    if (
        source_root == destination_root
        or destination_root.is_relative_to(source_root)
        or source_root.is_relative_to(destination_root)
    ):
        raise ValueError(
            "Public assets and candidate-review output must not contain one another"
        )


def _validated_public_assets(
    root: Path, task: Mapping[str, Any]
) -> dict[str, Path]:
    assets = task.get("public_assets")
    if not isinstance(assets, Mapping):
        raise EnvelopeError("Public task public_assets must be an object")
    missing = sorted(_REQUIRED_PUBLIC_ASSETS - set(assets))
    if missing:
        raise EnvelopeError(f"Public task is missing review assets: {missing}")

    result: dict[str, Path] = {}
    seen_paths: set[str] = set()
    root_resolved = root.resolve()
    for name, record in sorted(assets.items()):
        if not isinstance(name, str) or not isinstance(record, Mapping):
            raise EnvelopeError("Public asset bindings must be named objects")
        relative = record.get("path")
        expected_hash = record.get("sha256")
        if not isinstance(relative, str) or not isinstance(expected_hash, str):
            raise EnvelopeError(f"Public asset {name!r} has an invalid binding")
        relative_path = Path(relative)
        if (
            not relative
            or "\\" in relative
            or relative_path.is_absolute()
            or any(part in {"", ".", ".."} for part in relative_path.parts)
        ):
            raise EnvelopeError(f"Public asset {name!r} has an unsafe path")
        lowered_parts = {part.lower() for part in relative_path.parts}
        if "private" in lowered_parts or any("truth" in part for part in lowered_parts):
            raise EnvelopeError(f"Public asset {name!r} uses a private-looking path")
        if relative in seen_paths:
            raise EnvelopeError(f"Public assets duplicate path {relative!r}")
        seen_paths.add(relative)
        path = root / relative_path
        resolved = path.resolve()
        if not resolved.is_relative_to(root_resolved):
            raise EnvelopeError(f"Public asset {name!r} escapes the public root")
        if path.is_symlink() or not path.is_file():
            raise EnvelopeError(f"Missing safe public asset {name!r}")
        for parent in path.parents:
            if parent == root:
                break
            if parent.is_symlink():
                raise EnvelopeError(f"Public asset {name!r} has a symlinked parent")
        if sha256_file(path) != expected_hash:
            raise EnvelopeError(f"Public asset hash drift for {name!r}")
        result[name] = path
    return result


def _validated_reading_rotation(task: Mapping[str, Any]) -> float:
    reading = task.get("reading_view")
    if not isinstance(reading, Mapping):
        raise EnvelopeError("Public task reading_view must be an object")
    if reading.get("coordinates_valid") is not False:
        raise EnvelopeError("Public task reading view must be marked reading-only")
    rotation = reading.get("applied_rotation_degrees")
    if isinstance(rotation, bool) or not isinstance(rotation, (int, float)):
        raise EnvelopeError("Reading-view rotation must be numeric")
    value = float(rotation)
    if not math.isfinite(value):
        raise EnvelopeError("Reading-view rotation must be finite")
    return value


def _validated_target_box(
    task: Mapping[str, Any], size: tuple[int, int]
) -> tuple[int, int, int, int]:
    value = task.get("active_target_box_work_xywh")
    if (
        not isinstance(value, list)
        or len(value) != 4
        or any(not isinstance(item, int) or isinstance(item, bool) for item in value)
    ):
        raise EnvelopeError("Public task active target box must contain four integers")
    x, y, width, height = (int(item) for item in value)
    if width < 1 or height < 1:
        raise EnvelopeError("Public task active target box must have positive size")
    if x >= size[0] or y >= size[1] or x + width <= 0 or y + height <= 0:
        raise EnvelopeError("Public task active target box does not intersect work crop")
    return x, y, width, height


def _load_rgb(path: Path) -> Image.Image:
    with Image.open(path) as source:
        if source.width * source.height > _MAX_AUXILIARY_IMAGE_PIXELS:
            raise EnvelopeError(f"Public review image is too large: {path.name}")
        source.load()
        return source.convert("RGB")


def _selection_overlay(
    ownership_state: Image.Image,
    *,
    labels: np.ndarray,
    inventory: Sequence[Mapping[str, Any]],
    selected_ids: Sequence[int],
    target_box: tuple[int, int, int, int],
    changed_component_id: int | None = None,
) -> Image.Image:
    image = ownership_state.convert("RGBA")
    selected = np.isin(labels, list(selected_ids))
    overlay = np.zeros((*selected.shape, 4), dtype=np.uint8)
    overlay[selected] = (*_SELECTED_COLOR, 190)
    image = Image.alpha_composite(image, Image.fromarray(overlay, mode="RGBA"))
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default()
    x, y, width, height = target_box
    draw.rectangle(
        (x, y, x + width, y + height),
        outline=(*_TARGET_COLOR, 255),
        width=2,
    )
    by_id = {int(component["id"]): component for component in inventory}
    for component_id in selected_ids:
        component = by_id[int(component_id)]
        bbox = component["bbox"]
        left = int(bbox["x"])
        top = int(bbox["y"])
        right = left + int(bbox["width"])
        bottom = top + int(bbox["height"])
        color = _CHANGE_COLOR if component_id == changed_component_id else _SELECTED_COLOR
        draw.rectangle((left, top, right, bottom), outline=(*color, 255), width=2)
        draw.text(
            (left, max(0, top - 10)),
            f"S{component_id}",
            fill=(255, 255, 255, 255),
            stroke_width=2,
            stroke_fill=(0, 0, 0, 235),
            font=font,
        )
    if changed_component_id is not None:
        component = by_id[int(changed_component_id)]
        bbox = component["bbox"]
        left = int(bbox["x"])
        top = int(bbox["y"])
        right = left + int(bbox["width"])
        bottom = top + int(bbox["height"])
        draw.rectangle(
            (left - 2, top - 2, right + 2, bottom + 2),
            outline=(*_CHANGE_COLOR, 255),
            width=3,
        )
    return image.convert("RGB")


def _exclusion_before_overlay(
    ownership_state: Image.Image,
    *,
    inventory: Sequence[Mapping[str, Any]],
    removed_ids: Sequence[int],
    removed_mask: np.ndarray,
    target_box: tuple[int, int, int, int],
) -> Image.Image:
    image = ownership_state.convert("RGBA")
    overlay = np.zeros((*removed_mask.shape, 4), dtype=np.uint8)
    overlay[removed_mask] = (245, 25, 38, 225)
    image = Image.alpha_composite(image, Image.fromarray(overlay, mode="RGBA"))
    draw = ImageDraw.Draw(image)
    _draw_target_box(draw, target_box)
    _draw_removed_component_boxes(draw, inventory, removed_ids)
    return image.convert("RGB")


def _exclusion_after_overlay(
    ownership_state: Image.Image,
    *,
    inventory: Sequence[Mapping[str, Any]],
    removed_ids: Sequence[int],
    removed_mask: np.ndarray,
    target_box: tuple[int, int, int, int],
) -> Image.Image:
    pixels = np.asarray(ownership_state.convert("RGB"), dtype=np.uint8).copy()
    pixels[removed_mask] = (250, 250, 248)
    image = Image.fromarray(pixels, mode="RGB").convert("RGBA")
    draw = ImageDraw.Draw(image)
    _draw_target_box(draw, target_box)
    _draw_removed_component_boxes(
        draw,
        inventory,
        removed_ids,
        label_prefix="X",
        outline=(245, 25, 38, 255),
    )
    return image.convert("RGB")


def _removed_ink_overlay(
    work_crop: Image.Image,
    *,
    removed_mask: np.ndarray,
    inventory: Sequence[Mapping[str, Any]],
    removed_ids: Sequence[int],
) -> Image.Image:
    gray = np.asarray(work_crop.convert("L"), dtype=np.uint8)
    pixels = np.repeat(gray[:, :, None], 3, axis=2)
    pixels = ((pixels.astype(np.uint16) + 2 * 255) // 3).astype(np.uint8)
    pixels[removed_mask] = (245, 25, 38)
    image = Image.fromarray(pixels, mode="RGB").convert("RGBA")
    draw = ImageDraw.Draw(image)
    _draw_removed_component_boxes(draw, inventory, removed_ids)
    return image.convert("RGB")


def _draw_target_box(
    draw: ImageDraw.ImageDraw, target_box: tuple[int, int, int, int]
) -> None:
    x, y, width, height = target_box
    draw.rectangle(
        (x, y, x + width, y + height),
        outline=(*_TARGET_COLOR, 255),
        width=2,
    )


def _draw_removed_component_boxes(
    draw: ImageDraw.ImageDraw,
    inventory: Sequence[Mapping[str, Any]],
    removed_ids: Sequence[int],
    *,
    label_prefix: str = "X",
    outline: tuple[int, int, int, int] = (255, 255, 255, 255),
) -> None:
    font = ImageFont.load_default()
    by_id = {int(component["id"]): component for component in inventory}
    for component_id in removed_ids:
        bbox = by_id[int(component_id)]["bbox"]
        left = int(bbox["x"])
        top = int(bbox["y"])
        right = left + int(bbox["width"])
        bottom = top + int(bbox["height"])
        draw.rectangle((left, top, right, bottom), outline=outline, width=2)
        draw.text(
            (left, max(0, top - 10)),
            f"{label_prefix}{component_id}",
            fill=(255, 255, 255, 255),
            stroke_width=2,
            stroke_fill=(0, 0, 0, 235),
            font=font,
        )


def _rotate_reading_view(image: Image.Image, rotation_degrees: float) -> Image.Image:
    source = image.convert("RGB")
    if rotation_degrees == 0:
        return source.copy()
    return source.rotate(
        rotation_degrees,
        resample=Image.Resampling.BICUBIC,
        expand=True,
        fillcolor=(255, 255, 255),
    )


def _counterfactual_specs(
    inventory: Sequence[Mapping[str, Any]],
    selected_ids: Sequence[int],
    *,
    target_box: tuple[int, int, int, int],
    limit: int,
) -> list[dict[str, Any]]:
    selected = set(int(value) for value in selected_ids)
    selected_components = [
        component for component in inventory if int(component["id"]) in selected
    ]
    unselected_components = [
        component for component in inventory if int(component["id"]) not in selected
    ]
    removals = sorted(
        selected_components,
        key=lambda component: (int(component["area_px"]), int(component["id"])),
    )
    additions = sorted(
        unselected_components,
        key=lambda component: (
            0
            if _boxes_intersect(target_box, _component_box(component))
            else 1,
            min(
                _box_gap_squared(
                    _component_box(selected_component),
                    _component_box(component),
                )
                for selected_component in selected_components
            ),
            int(component["id"]),
        ),
    )
    if removals and additions and limit >= 2:
        removal_count = min(len(removals), max(1, limit // 4))
        addition_count = min(len(additions), limit - removal_count)
        unused = limit - removal_count - addition_count
        if unused:
            removal_count += min(unused, len(removals) - removal_count)
            unused = limit - removal_count - addition_count
            addition_count += min(unused, len(additions) - addition_count)
    elif removals:
        removal_count = min(len(removals), limit)
        addition_count = 0
    else:
        removal_count = 0
        addition_count = min(len(additions), limit)

    records: list[dict[str, Any]] = []
    for component in removals[:removal_count]:
        component_id = int(component["id"])
        records.append(
            {
                "edit": "remove",
                "component_id": component_id,
                "component_ids": sorted(selected - {component_id}),
            }
        )
    for component in additions[:addition_count]:
        component_id = int(component["id"])
        records.append(
            {
                "edit": "add",
                "component_id": component_id,
                "component_ids": sorted(selected | {component_id}),
            }
        )
    return records


def _component_box(component: Mapping[str, Any]) -> tuple[int, int, int, int]:
    bbox = component["bbox"]
    return (
        int(bbox["x"]),
        int(bbox["y"]),
        int(bbox["width"]),
        int(bbox["height"]),
    )


def _union_boxes(
    components: Sequence[Mapping[str, Any]],
) -> tuple[int, int, int, int] | None:
    if not components:
        return None
    boxes = [_component_box(component) for component in components]
    left = min(box[0] for box in boxes)
    top = min(box[1] for box in boxes)
    right = max(box[0] + box[2] for box in boxes)
    bottom = max(box[1] + box[3] for box in boxes)
    return left, top, right - left, bottom - top


def _box_gap_squared(
    first: tuple[int, int, int, int], second: tuple[int, int, int, int]
) -> int:
    first_right = first[0] + first[2]
    first_bottom = first[1] + first[3]
    second_right = second[0] + second[2]
    second_bottom = second[1] + second[3]
    dx = max(first[0] - second_right, second[0] - first_right, 0)
    dy = max(first[1] - second_bottom, second[1] - first_bottom, 0)
    return dx * dx + dy * dy


def _boxes_intersect(
    first: tuple[int, int, int, int], second: tuple[int, int, int, int]
) -> bool:
    return not (
        first[0] + first[2] <= second[0]
        or second[0] + second[2] <= first[0]
        or first[1] + first[3] <= second[1]
        or second[1] + second[3] <= first[1]
    )


def _candidate_decision(component_ids: Sequence[int]) -> dict[str, Any]:
    # Removing the only selected component would produce an invalid empty claim.
    # Such a preview is still useful, but the critic must defer instead of selecting it.
    if not component_ids:
        return {
            "schema_version": AGENT_OWNERSHIP_DECISION_SCHEMA_VERSION,
            "action": {
                "type": "defer_manual",
                "disposition": "ambiguous_ownership",
                "confidence": "low",
                "reason_codes": ["uncertain_reading"],
            },
        }
    return {
        "schema_version": AGENT_OWNERSHIP_DECISION_SCHEMA_VERSION,
        "action": {
            "type": "claim_select",
            "component_ids": list(component_ids),
            "confidence": "medium",
            "reason_codes": ["same_word_body"],
        },
    }


def _counterfactual_preview(
    ownership_state: Image.Image,
    *,
    labels: np.ndarray,
    inventory: Sequence[Mapping[str, Any]],
    selected_ids: Sequence[int],
    changed_component_id: int,
    edit: str,
    target_box: tuple[int, int, int, int],
) -> Image.Image:
    rendered = _selection_overlay(
        ownership_state,
        labels=labels,
        inventory=inventory,
        selected_ids=selected_ids,
        target_box=target_box,
        changed_component_id=changed_component_id,
    )
    by_id = {int(component["id"]): component for component in inventory}
    focus_components = [by_id[int(value)] for value in selected_ids]
    if changed_component_id not in set(selected_ids):
        focus_components.append(by_id[changed_component_id])
    focus_box = _union_boxes(focus_components) or _component_box(
        by_id[changed_component_id]
    )
    left, top, width, height = focus_box
    padding = max(10, round(max(width, height) * 0.1))
    crop_box = (
        max(0, left - padding),
        max(0, top - padding),
        min(rendered.width, left + width + padding),
        min(rendered.height, top + height + padding),
    )
    cropped = rendered.crop(crop_box)
    cropped = _fit_panel_image(cropped, (500, 230))
    preview = Image.new("RGB", (520, 290), (250, 249, 246))
    draw = ImageDraw.Draw(preview)
    font = ImageFont.load_default()
    draw.text(
        (10, 8),
        f"{edit.upper()} component {changed_component_id}",
        fill=_CHANGE_COLOR,
        font=font,
    )
    selected_label = ",".join(str(value) for value in selected_ids) or "none"
    draw.text(
        (10, 27),
        f"resulting selected IDs: {selected_label}",
        fill=(35, 35, 35),
        font=font,
    )
    x = (preview.width - cropped.width) // 2
    y = 52 + (230 - cropped.height) // 2
    preview.paste(cropped, (x, y))
    return preview


def _counterfactual_contact_sheet(previews: Sequence[Image.Image]) -> Image.Image:
    if not previews:
        raise EnvelopeError("Candidate review requires at least one counterfactual")
    columns = min(3, len(previews))
    rows = math.ceil(len(previews) / columns)
    sheet = Image.new("RGB", (columns * 520, rows * 290), _BOARD_BACKGROUND)
    for index, preview in enumerate(previews):
        x = (index % columns) * 520
        y = (index // columns) * 290
        sheet.paste(preview, (x, y))
    return sheet


def _copy_review_inputs(
    paths: Mapping[str, Path], output: Path
) -> dict[str, dict[str, str]]:
    names = {
        "context": ("large_context", "large-context.png"),
        "components": ("numbered_components", "numbered-components.png"),
        "reading_view": ("task_reading_view", "task-reading-view.png"),
    }
    result: dict[str, dict[str, str]] = {}
    for source_name, (record_name, filename) in names.items():
        destination = output / filename
        shutil.copyfile(paths[source_name], destination)
        result[record_name] = _asset_record(destination, output)
    return result


def _review_board(
    *,
    task_id: str,
    target_transcript: str,
    context: Image.Image,
    selected_reading: Image.Image,
    selected_overlay: Image.Image,
    numbered_components: Image.Image,
    prior_visible: bool,
) -> Image.Image:
    width = 1800
    header = 80
    panel_width = width // 2
    panel_height = 500
    board = Image.new("RGB", (width, header + panel_height * 2), _BOARD_BACKGROUND)
    draw = ImageDraw.Draw(board)
    font = ImageFont.load_default()
    draw.text(
        (14, 10),
        f"Candidate review {task_id} - target transcript: {target_transcript}",
        fill=(20, 20, 20),
        font=font,
    )
    legend = "cyan=current selection; amber=unselected ink; green=rough target box"
    if prior_visible:
        legend += "; red=prior-owned neighboring ink"
    draw.text((14, 36), legend, fill=(55, 55, 55), font=font)
    panels = [
        ("Large context", context),
        ("Upright candidate reading view", selected_reading),
        ("Candidate selection (coordinates valid)", selected_overlay),
        ("Numbered current components", numbered_components),
    ]
    for index, (label, panel) in enumerate(panels):
        column = index % 2
        row = index // 2
        x0 = column * panel_width
        y0 = header + row * panel_height
        _draw_centered_text(board, label, x0, panel_width, y0 + 7)
        fitted = _fit_panel_image(panel, (panel_width - 20, panel_height - 38))
        x = x0 + (panel_width - fitted.width) // 2
        y = y0 + 30 + (panel_height - 30 - fitted.height) // 2
        board.paste(fitted, (x, y))
    return board


def _exclusion_board(
    *,
    task_id: str,
    target_transcript: str,
    context: Image.Image,
    before: Image.Image,
    after: Image.Image,
    removed_only: Image.Image,
    numbered_components: Image.Image,
    task_reading_view: Image.Image,
    prior_visible: bool,
) -> Image.Image:
    width = 1800
    header = 80
    panel_width = width // 3
    panel_height = 400
    board = Image.new("RGB", (width, header + panel_height * 2), _BOARD_BACKGROUND)
    draw = ImageDraw.Draw(board)
    font = ImageFont.load_default()
    draw.text(
        (14, 10),
        f"Exclusion review {task_id} - target transcript: {target_transcript}",
        fill=(20, 20, 20),
        font=font,
    )
    legend = "bright red + X=ink proposed for removal; green=rough target box"
    if prior_visible:
        legend += "; dull red in the source view=prior-owned ink"
    draw.text((14, 36), legend, fill=(55, 55, 55), font=font)
    panels = [
        ("Large context", context),
        ("Before proposal (upright)", before),
        ("After proposal (upright)", after),
        ("Exact removed ink", removed_only),
        ("Numbered current components", numbered_components),
        ("Original upright public reading view", task_reading_view),
    ]
    for index, (label, panel) in enumerate(panels):
        column = index % 3
        row = index // 3
        x0 = column * panel_width
        y0 = header + row * panel_height
        _draw_centered_text(board, label, x0, panel_width, y0 + 7)
        fitted = _fit_panel_image(panel, (panel_width - 20, panel_height - 38))
        x = x0 + (panel_width - fitted.width) // 2
        y = y0 + 30 + (panel_height - 30 - fitted.height) // 2
        board.paste(fitted, (x, y))
    return board


def _draw_centered_text(
    image: Image.Image, text: str, x: int, width: int, y: int
) -> None:
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default()
    bounds = draw.textbbox((0, 0), text, font=font)
    draw.text(
        (x + (width - (bounds[2] - bounds[0])) // 2, y),
        text,
        fill=(25, 25, 25),
        font=font,
    )


def _fit_panel_image(
    image: Image.Image,
    bounds: tuple[int, int],
    *,
    maximum_upscale: float = 5.0,
) -> Image.Image:
    source = image.convert("RGB")
    scale = min(bounds[0] / source.width, bounds[1] / source.height)
    scale = min(scale, maximum_upscale)
    if scale == 1:
        return source.copy()
    size = (
        max(1, round(source.width * scale)),
        max(1, round(source.height * scale)),
    )
    return source.resize(size, Image.Resampling.LANCZOS)


def _critic_instructions(
    *,
    task_id: str,
    target_transcript: str,
    selected_ids: Sequence[int],
    prior_visible: bool,
    manual_decision: Mapping[str, Any],
) -> str:
    prior = (
        "Red ink is prior-owned neighboring ink and should not be reclaimed."
        if prior_visible
        else "This task does not expose a prior-owned red-ink cue."
    )
    ids = ", ".join(str(value) for value in selected_ids)
    manual_json = canonical_json_bytes(manual_decision).decode("utf-8").rstrip()
    return (
        "# Candidate ownership critique\n\n"
        f"Task: `{task_id}`  \n"
        f"Target transcript: `{target_transcript}`  \n"
        f"Current selected component IDs: `[{ids}]`\n\n"
        "Inspect `review-board.png` first. Use `selection-reading-view.png` "
        "only for reading; use `selection-overlay.png` and "
        "`numbered-components.png` for exact component IDs. "
        f"{prior}\n\n"
        "The counterfactual previews each toggle exactly one component. Their "
        "exact resulting ID lists and replayable compact decisions are bound in "
        "`review.json`. You may choose one, keep the original claim, or write a "
        "different component list visible in the numbered view.\n\n"
        "Return only one JSON object using `word-ink-ownership-decision.v1`. "
        "The action must be either `claim_select` with a non-empty "
        "`component_ids` list, `confidence`, and `reason_codes`, or "
        "`defer_manual` with `disposition`, `confidence`, and `reason_codes`. "
        "Do not return prose or a full bound action.\n\n"
        "If no visible component selection is safe, use this valid deferral:\n\n"
        "```json\n"
        f"{manual_json}\n"
        "```\n"
    )


def _exclusion_critic_instructions(
    *,
    task_id: str,
    target_transcript: str,
    removed_ids: Sequence[int],
    approve_decision: Mapping[str, Any],
    rollback_decision: Mapping[str, Any],
) -> str:
    removed = ", ".join(str(value) for value in removed_ids)
    approve_json = canonical_json_bytes(approve_decision).decode("utf-8").rstrip()
    rollback_json = canonical_json_bytes(rollback_decision).decode("utf-8").rstrip()
    return (
        "# Exclusion proposal critique\n\n"
        f"Task: `{task_id}`  \n"
        f"Target transcript: `{target_transcript}`  \n"
        f"Proposed excluded component IDs: `[{removed}]`\n\n"
        "This is a preview. The current mask has not changed. Bright red ink in "
        "`exclude-before.png` and `removed-ink.png` is exactly what the proposal "
        "would remove. Compare the upright before/after views with the large "
        "context and numbered components. No benchmark truth is present.\n\n"
        "Return only one compact `word-ink-ownership-decision.v1` JSON object. "
        "To continue, return the exact `exclude` decision below or revise its "
        "component IDs. To roll back, return the `defer_manual` decision, which "
        "keeps the current state unchanged. Do not return prose or a full bound "
        "action.\n\n"
        "Approve exact proposal:\n\n"
        "```json\n"
        f"{approve_json}\n"
        "```\n\n"
        "Roll back and keep current state:\n\n"
        "```json\n"
        f"{rollback_json}\n"
        "```\n"
    )


def _asset_record(path: Path, root: Path) -> dict[str, str]:
    return {
        "path": path.relative_to(root).as_posix(),
        "sha256": sha256_file(path),
    }


def _save_png(path: Path, image: Image.Image) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.convert("RGB").save(
        path,
        format="PNG",
        compress_level=9,
        optimize=False,
    )


def _validate_generated_review(root: Path, review: Mapping[str, Any]) -> None:
    basis = copy.deepcopy(dict(review))
    expected_hash = basis.pop("review_pack_sha256", None)
    observed_hash = hashlib.sha256(canonical_json_bytes(basis)).hexdigest()
    if expected_hash != observed_hash:
        raise EnvelopeError("Generated candidate-review binding hash drift")

    records: list[Mapping[str, Any]] = list(review["review_assets"].values())
    records.extend(item["preview"] for item in review["counterfactuals"])
    seen: set[str] = set()
    for record in records:
        relative = record["path"]
        if relative in seen:
            raise EnvelopeError(f"Generated review duplicates asset path {relative!r}")
        seen.add(relative)
        path = root / relative
        if path.is_symlink() or not path.is_file():
            raise EnvelopeError(f"Generated review asset is missing: {relative}")
        if sha256_file(path) != record["sha256"]:
            raise EnvelopeError(f"Generated review asset hash drift: {relative}")
