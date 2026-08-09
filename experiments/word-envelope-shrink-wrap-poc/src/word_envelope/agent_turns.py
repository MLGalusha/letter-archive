"""Deterministic follow-up turns for safe whole-component exclusions.

An exclusion is not a terminal ownership decision.  This module turns one
strictly bound, target-safe exclusion into a fresh task pack whose component
labels and hashes describe the new mask.  Removed ink is retained only as red
presentation history; it is neither current actionable ink nor part of the
effective semantic-neighbor scoring mask.
"""

from __future__ import annotations

import copy
import hashlib
import re
import shutil
import tempfile
from pathlib import Path
from typing import Any, Mapping

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .agent_benchmark import _validate_fixture
from .agent_ownership import (
    apply_single_action,
    component_inventory_sha256,
    component_reference,
)
from .agent_packs import (
    _context_overlay,
    _reading_rotation_degrees,
    _reading_view,
    _save_large_component_overlay,
)
from .engine import EnvelopeError
from .io_utils import (
    canonical_json_bytes,
    read_json,
    sha256_file,
    sha256_image_pixels,
    sha256_mask_pixels,
    write_json,
)
from .masks import load_mask, save_mask, stable_components


AGENT_FOLLOWUP_TRANSITION_SCHEMA_VERSION = "word-ink-agent-followup-transition.v1"
AGENT_DISPLAY_HISTORY_SCHEMA_VERSION = "word-ink-agent-display-history.v1"
_SAFE_TASK_ID = re.compile(r"^[a-z0-9][a-z0-9-]*$")
_REQUIRED_PUBLIC_ASSETS = {
    "prompt",
    "board",
    "context",
    "work_crop",
    "components",
    "ownership_state",
    "reading_view",
}
_REGENERATED_PUBLIC_ASSETS = {
    "board",
    "context",
    "components",
    "ownership_state",
    "reading_view",
}
_AMBER = (235, 157, 40)
_RED = (225, 55, 65)
_GREEN = (25, 190, 105)


def generate_exclusion_followup_task(
    parent_task_dir: Path,
    bound_action: Mapping[str, Any],
    output_task_dir: Path,
) -> dict[str, Any]:
    """Generate one later-turn task from a safe, bound ``exclude`` action.

    The destination must not already exist.  Parent fixtures, assets, masks,
    action bindings, and any existing turn provenance are validated before a
    temporary output directory is created.  The temporary directory is renamed
    into place only after the regenerated pack validates as a benchmark task.
    """

    parent_root = Path(parent_task_dir)
    destination = Path(output_task_dir)
    _validate_source_and_destination(parent_root, destination)
    parent = _load_and_validate_parent(parent_root)

    task = parent["task"]
    truth = parent["truth"]
    base_mask = parent["base_mask"]
    truth_target = parent["truth_target"]
    truth_neighbor = parent["truth_neighbor"]
    action_record = _validated_bound_exclusion(bound_action, task)

    first = apply_single_action(action_record, base_mask)
    second = apply_single_action(action_record, base_mask)
    if not first.requires_later_turn:
        raise EnvelopeError("Exclusion must require a later agent turn")
    if first.action["type"] != "exclude":
        raise EnvelopeError("Follow-up generation supports only exclude actions")
    if not np.array_equal(first.output_mask, second.output_mask):
        raise EnvelopeError("Exclusion replay is not deterministic")

    output_mask = np.asarray(first.output_mask, dtype=bool)
    removed_mask = base_mask & ~output_mask
    _, input_inventory = stable_components(base_mask)
    output_labels, output_inventory = stable_components(output_mask)
    removed_component_count = len(input_inventory) - len(output_inventory)
    if not removed_mask.any() or removed_component_count < 1:
        raise EnvelopeError("Exclusion must remove at least one whole component")
    if np.any(removed_mask & truth_target):
        raise EnvelopeError("Exclusion would remove frozen target pixels")
    if np.any(truth_target & ~output_mask):
        raise EnvelopeError("Unchanged target truth is not contained in output mask")
    if np.any(output_mask & ~base_mask):
        raise EnvelopeError("Exclusion output unexpectedly adds ink")

    target_component_refs = _whole_component_refs(
        output_labels,
        output_inventory,
        truth_target,
        name="unchanged target truth",
    )
    effective_neighbor = truth_neighbor & output_mask
    new_turn = int(task["turn"]) + 1
    child_task_id = _child_task_id(str(task["task_id"]), int(task["turn"]), new_turn)
    action_hash = hashlib.sha256(canonical_json_bytes(action_record)).hexdigest()

    parent_display_history = parent["display_history_mask"]
    display_history = parent_display_history | removed_mask
    if np.any(display_history & truth_target):
        raise EnvelopeError("Red display history must never cover frozen target truth")

    prior_visible = bool(task.get("prior_owned_ink_visible", False))
    expose_prior_refs = bool(task.get("prior_owned_component_refs_exposed", False))
    current_prior_mask = effective_neighbor if prior_visible else np.zeros_like(output_mask)
    current_prior_refs = (
        _overlapping_component_refs(output_labels, output_inventory, current_prior_mask)
        if expose_prior_refs
        else []
    )
    retired_history = _next_retired_history(
        task,
        action_record,
        action_hash=action_hash,
        retired_on_turn=new_turn,
    )
    transition_basis = {
        "schema_version": AGENT_FOLLOWUP_TRANSITION_SCHEMA_VERSION,
        "parent_task_id": task["task_id"],
        "parent_task_pack_sha256": task["task_pack_sha256"],
        "parent_turn": task["turn"],
        "child_task_id": child_task_id,
        "child_turn": new_turn,
        "bound_action_sha256": action_hash,
        "input_state_sha256": sha256_mask_pixels(base_mask),
        "output_state_sha256": sha256_mask_pixels(output_mask),
        "input_component_inventory_sha256": component_inventory_sha256(
            input_inventory
        ),
        "output_component_inventory_sha256": component_inventory_sha256(
            output_inventory
        ),
        "removed_component_count": removed_component_count,
        "removed_mask_pixel_sha256": sha256_mask_pixels(removed_mask),
    }
    transition_record = {
        "schema_version": AGENT_FOLLOWUP_TRANSITION_SCHEMA_VERSION,
        "transition": transition_basis,
        "bound_action": copy.deepcopy(action_record),
        "cleanup_log": [copy.deepcopy(value) for value in first.cleanup_log],
        "retired_component_refs": copy.deepcopy(
            action_record["action"]["component_refs"]
        ),
    }
    transition_hash = hashlib.sha256(
        canonical_json_bytes(transition_record)
    ).hexdigest()
    transition_link = {
        **transition_basis,
        "private_provenance_sha256": transition_hash,
    }
    lineage = copy.deepcopy(task.get("transition_lineage", []))
    lineage.append(copy.deepcopy(transition_link))

    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(
        tempfile.mkdtemp(prefix=f".{destination.name}.tmp-", dir=destination.parent)
    )
    try:
        task_record = _write_followup_pack(
            parent=parent,
            temporary_root=temporary,
            child_task_id=child_task_id,
            new_turn=new_turn,
            output_mask=output_mask,
            output_inventory=output_inventory,
            truth_target=truth_target,
            truth_neighbor=effective_neighbor,
            target_component_refs=target_component_refs,
            display_history=display_history,
            current_prior_refs=current_prior_refs,
            expose_prior_refs=expose_prior_refs,
            retired_history=retired_history,
            transition_record=transition_record,
            transition_link=transition_link,
            lineage=lineage,
        )
        _validate_generated_pack(temporary)
        if destination.exists() or destination.is_symlink():
            raise ValueError(f"Refusing to overwrite follow-up task: {destination}")
        temporary.rename(destination)
        return task_record
    except Exception:
        if temporary.exists() and not temporary.is_symlink():
            shutil.rmtree(temporary)
        raise


def _load_and_validate_parent(parent_root: Path) -> dict[str, Any]:
    public_dir = parent_root / "public"
    private_dir = parent_root / "private"
    for path, label in (
        (parent_root, "parent task"),
        (public_dir, "parent public directory"),
        (private_dir, "parent private directory"),
    ):
        if path.is_symlink() or not path.is_dir():
            raise ValueError(f"{label} must be a non-symlink directory: {path}")

    required_private = {
        "truth.json",
        "base-mask.png",
        "truth-target-mask.png",
        "truth-neighbor-mask.png",
        "context-original.png",
        "context.json",
    }
    for name in sorted(required_private):
        path = private_dir / name
        if path.is_symlink() or not path.is_file():
            raise EnvelopeError(f"Missing safe parent private asset: {name}")

    task_path = public_dir / "task.json"
    if task_path.is_symlink() or not task_path.is_file():
        raise EnvelopeError("Missing safe parent public task.json")
    task = read_json(task_path)
    truth = read_json(private_dir / "truth.json")
    if not isinstance(task, dict) or not isinstance(truth, dict):
        raise EnvelopeError("Parent task and truth records must be objects")
    for field in (
        "target_transcript",
        "target_unit",
        "orientation_degrees",
        "active_target_box_work_xywh",
    ):
        if field not in task:
            raise EnvelopeError(f"Parent task is missing preserved field {field!r}")

    asset_sources = _validated_public_assets(public_dir, task)
    missing_assets = sorted(_REQUIRED_PUBLIC_ASSETS - set(asset_sources))
    if missing_assets:
        raise EnvelopeError(f"Parent task is missing required public assets: {missing_assets}")

    base_mask = load_mask(private_dir / "base-mask.png", polarity="bright")
    truth_target = load_mask(
        private_dir / "truth-target-mask.png", polarity="bright"
    )
    truth_neighbor = load_mask(
        private_dir / "truth-neighbor-mask.png", polarity="bright"
    )
    _validate_fixture(
        public_dir=public_dir,
        task=task,
        truth=truth,
        base_mask=base_mask,
        truth_target=truth_target,
        truth_neighbor=truth_neighbor,
    )
    if np.any(truth_target & ~base_mask):
        raise EnvelopeError("Parent target truth must be contained by its base mask")
    with Image.open(asset_sources["work_crop"]) as source:
        if source.size != (base_mask.shape[1], base_mask.shape[0]):
            raise EnvelopeError("Parent work crop dimensions do not match its mask")

    prompt_hash = task["public_assets"]["prompt"]["sha256"]
    if truth.get("prompt_sha256") != prompt_hash:
        raise EnvelopeError("Parent prompt public/private binding does not match")
    context_record = read_json(private_dir / "context.json")
    if context_record != truth.get("context"):
        raise EnvelopeError("Parent context record does not match private truth")
    _validate_context_original(private_dir / "context-original.png", context_record)

    display_history = _validated_parent_display_history(
        private_dir, task, truth, truth_neighbor, base_mask
    )
    _validate_parent_followup_provenance(private_dir, task, truth)
    return {
        "root": parent_root,
        "public_dir": public_dir,
        "private_dir": private_dir,
        "asset_sources": asset_sources,
        "task": task,
        "truth": truth,
        "base_mask": base_mask,
        "truth_target": truth_target,
        "truth_neighbor": truth_neighbor,
        "context_record": context_record,
        "display_history_mask": display_history,
    }


def _validated_public_assets(
    public_dir: Path, task: Mapping[str, Any]
) -> dict[str, Path]:
    assets = task.get("public_assets")
    if not isinstance(assets, Mapping) or not assets:
        raise EnvelopeError("Parent public_assets must be a non-empty object")
    sources: dict[str, Path] = {}
    seen_paths: set[str] = set()
    public_root = public_dir.resolve()
    for name, record in assets.items():
        if not isinstance(name, str) or not isinstance(record, Mapping):
            raise EnvelopeError("Parent public asset entries are malformed")
        relative = record.get("path")
        expected_hash = record.get("sha256")
        if not isinstance(relative, str) or not isinstance(expected_hash, str):
            raise EnvelopeError(f"Parent public asset {name!r} lacks a binding")
        relative_path = Path(relative)
        if (
            not relative
            or "\\" in relative
            or relative_path.is_absolute()
            or any(part in {"", ".", ".."} for part in relative_path.parts)
        ):
            raise EnvelopeError(f"Unsafe parent public asset path: {relative!r}")
        if relative in seen_paths:
            raise EnvelopeError(f"Duplicate parent public asset path: {relative!r}")
        seen_paths.add(relative)
        source = public_dir / relative_path
        if (
            source.is_symlink()
            or not source.is_file()
            or not source.resolve().is_relative_to(public_root)
        ):
            raise EnvelopeError(f"Missing safe parent public asset: {relative!r}")
        if any(
            ancestor.is_symlink()
            for ancestor in source.parents
            if ancestor != public_dir and ancestor.is_relative_to(public_dir)
        ):
            raise EnvelopeError(f"Symlinked parent public asset path: {relative!r}")
        if sha256_file(source) != expected_hash:
            raise EnvelopeError(f"Parent public asset hash drift: {name!r}")
        sources[name] = source
    return sources


def _validate_context_original(path: Path, record: Any) -> None:
    if not isinstance(record, Mapping) or not isinstance(record.get("crop"), Mapping):
        raise EnvelopeError("Parent private context record is malformed")
    crop = record["crop"]
    if sha256_file(path) != crop.get("sha256"):
        raise EnvelopeError("Parent context-original file hash drift")
    with Image.open(path) as source:
        image = source.convert("RGB")
    if image.size != (crop.get("width_px"), crop.get("height_px")):
        raise EnvelopeError("Parent context-original dimensions drift")
    pixel_hash = crop.get("pixel_sha256")
    if pixel_hash is not None and sha256_image_pixels(image) != pixel_hash:
        raise EnvelopeError("Parent context-original pixel hash drift")


def _validated_parent_display_history(
    private_dir: Path,
    task: Mapping[str, Any],
    truth: Mapping[str, Any],
    truth_neighbor: np.ndarray,
    base_mask: np.ndarray,
) -> np.ndarray:
    history_path = private_dir / "display-history-mask.png"
    expected_hash = truth.get("display_history_mask_pixel_sha256")
    if history_path.exists() or expected_hash is not None:
        if history_path.is_symlink() or not history_path.is_file():
            raise EnvelopeError("Parent display-history mask is missing or unsafe")
        history = load_mask(history_path, polarity="bright")
        if history.shape != base_mask.shape:
            raise EnvelopeError("Parent display-history dimensions drift")
        if sha256_mask_pixels(history) != expected_hash:
            raise EnvelopeError("Parent display-history mask binding drift")
        display = task.get("display_history")
        if not isinstance(display, Mapping):
            raise EnvelopeError("Parent display-history public metadata is missing")
        if display.get("mask_pixel_sha256") != expected_hash:
            raise EnvelopeError("Parent public/private display-history binding drift")
        return history
    return (
        truth_neighbor.copy()
        if bool(task.get("prior_owned_ink_visible", False))
        else np.zeros_like(base_mask)
    )


def _validate_parent_followup_provenance(
    private_dir: Path, task: Mapping[str, Any], truth: Mapping[str, Any]
) -> None:
    turn = task.get("turn")
    if not isinstance(turn, int) or isinstance(turn, bool) or turn < 0:
        raise EnvelopeError("Parent task turn is invalid")
    task_lineage = task.get("transition_lineage", [])
    truth_lineage = truth.get("transition_lineage", [])
    if task_lineage != truth_lineage or not isinstance(task_lineage, list):
        raise EnvelopeError("Parent transition lineage public/private drift")
    if turn == 0:
        if task_lineage:
            raise EnvelopeError("Turn-zero parent must not have transition lineage")
        return
    transition_path = private_dir / "transition.json"
    if transition_path.is_symlink() or not transition_path.is_file():
        raise EnvelopeError("Follow-up parent is missing safe transition provenance")
    if not task_lineage:
        raise EnvelopeError("Follow-up parent transition lineage is empty")
    link = task.get("parent_transition")
    if link != task_lineage[-1] or link != truth.get("parent_transition"):
        raise EnvelopeError("Follow-up parent transition link drift")
    if sha256_file(transition_path) != link.get("private_provenance_sha256"):
        raise EnvelopeError("Follow-up parent transition provenance hash drift")
    transition = read_json(transition_path)
    if not isinstance(transition, Mapping):
        raise EnvelopeError("Follow-up parent transition provenance is malformed")
    expected_basis = dict(link)
    expected_basis.pop("private_provenance_sha256", None)
    if transition.get("transition") != expected_basis:
        raise EnvelopeError("Follow-up parent transition record drift")
    action = transition.get("bound_action")
    if not isinstance(action, Mapping):
        raise EnvelopeError("Follow-up parent transition action is malformed")
    if hashlib.sha256(canonical_json_bytes(action)).hexdigest() != link.get(
        "bound_action_sha256"
    ):
        raise EnvelopeError("Follow-up parent transition action hash drift")
    if task.get("retired_component_history", []) != truth.get(
        "retired_component_history", []
    ):
        raise EnvelopeError("Follow-up parent retired-component history drift")


def _validated_bound_exclusion(
    bound_action: Mapping[str, Any], task: Mapping[str, Any]
) -> dict[str, Any]:
    if not isinstance(bound_action, Mapping):
        raise EnvelopeError("Bound exclusion action must be an object")
    for field in ("task_id", "task_pack_sha256", "turn"):
        if bound_action.get(field) != task.get(field):
            raise EnvelopeError(f"Bound exclusion {field} is stale or mismatched")
    action = bound_action.get("action")
    if not isinstance(action, Mapping) or action.get("type") != "exclude":
        raise EnvelopeError("Follow-up generation supports only exclude actions")
    return copy.deepcopy(dict(bound_action))


def _whole_component_refs(
    labels: np.ndarray,
    inventory: list[dict[str, Any]],
    mask: np.ndarray,
    *,
    name: str,
) -> list[dict[str, Any]]:
    ids = [
        component["id"]
        for component in inventory
        if np.any(mask & (labels == component["id"]))
    ]
    if not np.array_equal(np.isin(labels, ids), mask):
        raise EnvelopeError(f"{name} is not reconstructible from whole components")
    return [component_reference(inventory[component_id - 1]) for component_id in ids]


def _overlapping_component_refs(
    labels: np.ndarray,
    inventory: list[dict[str, Any]],
    mask: np.ndarray,
) -> list[dict[str, Any]]:
    return [
        component_reference(component)
        for component in inventory
        if np.any(mask & (labels == component["id"]))
    ]


def _next_retired_history(
    task: Mapping[str, Any],
    action: Mapping[str, Any],
    *,
    action_hash: str,
    retired_on_turn: int,
) -> list[dict[str, Any]]:
    prior = task.get("retired_component_history", [])
    if not isinstance(prior, list):
        raise EnvelopeError("Parent retired_component_history must be a list")
    history = copy.deepcopy(prior)
    for reference in action["action"]["component_refs"]:
        history.append(
            {
                "source_task_id": task["task_id"],
                "retired_on_turn": retired_on_turn,
                "source_component_ref": copy.deepcopy(reference),
                "source_action_sha256": action_hash,
                "status": "immutable_nonactionable_history",
                "accepted_as_current_ref": False,
            }
        )
    return history


def _write_followup_pack(
    *,
    parent: Mapping[str, Any],
    temporary_root: Path,
    child_task_id: str,
    new_turn: int,
    output_mask: np.ndarray,
    output_inventory: list[dict[str, Any]],
    truth_target: np.ndarray,
    truth_neighbor: np.ndarray,
    target_component_refs: list[dict[str, Any]],
    display_history: np.ndarray,
    current_prior_refs: list[dict[str, Any]],
    expose_prior_refs: bool,
    retired_history: list[dict[str, Any]],
    transition_record: dict[str, Any],
    transition_link: dict[str, Any],
    lineage: list[dict[str, Any]],
) -> dict[str, Any]:
    parent_task = parent["task"]
    parent_truth = parent["truth"]
    public_dir = temporary_root / "public"
    private_dir = temporary_root / "private"
    public_dir.mkdir(parents=True)
    private_dir.mkdir(parents=True)

    asset_paths: dict[str, Path] = {}
    for name, source in parent["asset_sources"].items():
        relative = Path(parent_task["public_assets"][name]["path"])
        destination = public_dir / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        if name not in _REGENERATED_PUBLIC_ASSETS:
            shutil.copyfile(source, destination)
        asset_paths[name] = destination

    with Image.open(asset_paths["work_crop"]) as source:
        work_crop = source.convert("RGB")
    target_box = copy.deepcopy(parent_task["active_target_box_work_xywh"])
    ownership_view = _followup_ownership_overlay(
        work_crop,
        output_mask=output_mask,
        display_history=display_history,
        target_box=target_box,
    )
    ownership_view.save(
        asset_paths["ownership_state"],
        format="PNG",
        compress_level=9,
        optimize=False,
    )
    _save_large_component_overlay(
        asset_paths["components"], work_crop, output_mask
    )

    context_original_path = parent["private_dir"] / "context-original.png"
    with Image.open(context_original_path) as source:
        context_original = source.convert("RGB")
    context_origin, work_origin, source_target_box = _context_geometry(
        parent["context_record"], target_box
    )
    context_view = _context_overlay(
        context_original,
        context_origin=context_origin,
        target_box=source_target_box,
        work_origin=work_origin,
        work_size=(output_mask.shape[1], output_mask.shape[0]),
        prior_mask=display_history,
        shared_component_mask=np.zeros_like(output_mask),
    )
    context_view.save(
        asset_paths["context"], format="PNG", compress_level=9, optimize=False
    )

    rotation = _reading_rotation_degrees(parent_task["orientation_degrees"])
    reading_view = _reading_view(ownership_view, rotation)
    reading_view.save(
        asset_paths["reading_view"],
        format="PNG",
        compress_level=9,
        optimize=False,
    )
    with Image.open(asset_paths["components"]) as source:
        component_view = source.convert("RGB")
    _save_followup_board(
        asset_paths["board"],
        title=(
            f"Task {child_task_id} - target transcript: "
            f"{parent_task['target_transcript']}"
        ),
        context=context_view,
        ownership=ownership_view,
        components=component_view,
    )

    public_assets = {
        name: {
            "path": parent_task["public_assets"][name]["path"],
            "sha256": sha256_file(path),
        }
        for name, path in asset_paths.items()
    }
    display_hash = sha256_mask_pixels(display_history)
    input_hash = sha256_mask_pixels(output_mask)
    inventory_hash = component_inventory_sha256(output_inventory)
    task_basis = copy.deepcopy(parent_task)
    task_basis.pop("task_pack_sha256", None)
    task_basis.update(
        {
            "task_id": child_task_id,
            "turn": new_turn,
            "input_state_sha256": input_hash,
            "component_inventory_sha256": inventory_hash,
            "components": [
                component_reference(component) for component in output_inventory
            ],
            "prior_owned_component_refs_exposed": expose_prior_refs,
            "prior_owned_component_refs": copy.deepcopy(current_prior_refs),
            "parent_transition": copy.deepcopy(transition_link),
            "transition_lineage": copy.deepcopy(lineage),
            "retired_component_history": copy.deepcopy(retired_history),
            "display_history": {
                "schema_version": AGENT_DISPLAY_HISTORY_SCHEMA_VERSION,
                "visible": True,
                "color": "red",
                "mask_pixel_sha256": display_hash,
                "meaning": (
                    "Red pixels are immutable, nonactionable visual history: "
                    "previously owned ink and ink excluded on earlier turns."
                ),
                "scoring_role": (
                    "presentation_only; red history is not added to the private "
                    "semantic-neighbor scoring denominator"
                ),
                "current_reference_rule": (
                    "Only refs in components are current; retired_component_history "
                    "refs must never be submitted as current refs."
                ),
            },
            "reading_view": {
                "purpose": "reading_only",
                "source_asset": "ownership_state",
                "applied_rotation_degrees": rotation,
                "coordinates_valid": False,
                "instruction": (
                    "This is the upright reading-only view. Use unrotated task views "
                    "for coordinates and current component references."
                ),
            },
            "public_assets": public_assets,
        }
    )
    task_hash = hashlib.sha256(canonical_json_bytes(task_basis)).hexdigest()
    task_record = {**task_basis, "task_pack_sha256": task_hash}
    write_json(public_dir / "task.json", task_record)

    save_mask(private_dir / "base-mask.png", output_mask)
    save_mask(private_dir / "truth-target-mask.png", truth_target)
    save_mask(private_dir / "truth-neighbor-mask.png", truth_neighbor)
    save_mask(private_dir / "display-history-mask.png", display_history)
    shutil.copyfile(context_original_path, private_dir / "context-original.png")
    write_json(private_dir / "context.json", parent["context_record"])
    write_json(private_dir / "transition.json", transition_record)

    removed_neighbor_pixels = int((parent["truth_neighbor"] & ~truth_neighbor).sum())
    prior_excluded = int(
        parent_truth.get("semantic_neighbor_pixels_excluded_outside_base", 0)
    )
    truth_record = copy.deepcopy(parent_truth)
    truth_record.update(
        {
            "task_id": child_task_id,
            "task_pack_sha256": task_hash,
            "base_mask_pixel_sha256": input_hash,
            "truth_target_mask_pixel_sha256": sha256_mask_pixels(truth_target),
            "truth_neighbor_mask_pixel_sha256": sha256_mask_pixels(truth_neighbor),
            "semantic_neighbor_pixels_excluded_outside_base": (
                prior_excluded + removed_neighbor_pixels
            ),
            "truth_target_component_refs": copy.deepcopy(target_component_refs),
            "display_history_mask_pixel_sha256": display_hash,
            "display_history_scoring_role": (
                "presentation_only_not_semantic_neighbor_denominator"
            ),
            "parent_transition": copy.deepcopy(transition_link),
            "transition_lineage": copy.deepcopy(lineage),
            "retired_component_history": copy.deepcopy(retired_history),
        }
    )
    write_json(private_dir / "truth.json", truth_record)
    return task_record


def _context_geometry(
    context_record: Mapping[str, Any], target_box_work: list[int]
) -> tuple[tuple[int, int], tuple[int, int], list[int]]:
    crop = context_record.get("crop")
    if not isinstance(crop, Mapping):
        raise EnvelopeError("Private context crop metadata is malformed")
    requested = crop.get("requested_box_xywh")
    if (
        not isinstance(requested, list)
        or len(requested) != 4
        or any(isinstance(value, bool) or not isinstance(value, int) for value in requested)
    ):
        raise EnvelopeError("Private context requested target box is malformed")
    context_x = crop.get("x")
    context_y = crop.get("y")
    if any(
        isinstance(value, bool) or not isinstance(value, int)
        for value in (context_x, context_y)
    ):
        raise EnvelopeError("Private context origin is malformed")
    work_origin = (
        requested[0] - int(target_box_work[0]),
        requested[1] - int(target_box_work[1]),
    )
    return (context_x, context_y), work_origin, copy.deepcopy(requested)


def _followup_ownership_overlay(
    crop: Image.Image,
    *,
    output_mask: np.ndarray,
    display_history: np.ndarray,
    target_box: list[int],
) -> Image.Image:
    image = crop.convert("RGBA")
    overlay = np.zeros((*output_mask.shape, 4), dtype=np.uint8)
    unresolved = output_mask & ~display_history
    overlay[unresolved] = (*_AMBER, 90)
    overlay[display_history] = (*_RED, 205)
    layer = Image.fromarray(overlay, mode="RGBA")
    composed = Image.alpha_composite(image, layer)
    draw = ImageDraw.Draw(composed)
    x, y, width, height = (int(value) for value in target_box)
    draw.rectangle(
        (x, y, x + width, y + height), outline=(*_GREEN, 255), width=2
    )
    return composed.convert("RGB")


def _save_followup_board(
    path: Path,
    *,
    title: str,
    context: Image.Image,
    ownership: Image.Image,
    components: Image.Image,
) -> None:
    width, header, panel_height = 1800, 76, 520
    panel_width = width // 3
    board = Image.new("RGB", (width, header + panel_height), (244, 243, 239))
    draw = ImageDraw.Draw(board)
    font = ImageFont.load_default()
    draw.text((14, 8), title, fill=(20, 20, 20), font=font)
    draw.text(
        (14, 29),
        "green=active rough box; amber=unresolved current ink; "
        "red=immutable nonactionable history (not the scoring denominator)",
        fill=(55, 55, 55),
        font=font,
    )
    panels = (
        ("Larger context", context),
        ("Current state + red history", ownership),
        ("Numbered current components only", components),
    )
    for index, (label, panel) in enumerate(panels):
        x0 = index * panel_width
        text_box = draw.textbbox((0, 0), label, font=font)
        text_width = text_box[2] - text_box[0]
        draw.text(
            (x0 + (panel_width - text_width) // 2, 53),
            label,
            fill=(25, 25, 25),
            font=font,
        )
        fitted = panel.convert("RGB")
        fitted.thumbnail((panel_width - 16, panel_height - 16), Image.Resampling.LANCZOS)
        x = x0 + (panel_width - fitted.width) // 2
        y = header + (panel_height - fitted.height) // 2
        board.paste(fitted, (x, y))
    path.parent.mkdir(parents=True, exist_ok=True)
    board.save(path, format="PNG", compress_level=9, optimize=False)


def _child_task_id(parent_task_id: str, parent_turn: int, new_turn: int) -> str:
    if not _SAFE_TASK_ID.fullmatch(parent_task_id):
        raise EnvelopeError("Parent task_id is not safe for a follow-up suffix")
    root = parent_task_id
    if parent_turn > 0:
        suffix = f"-t{parent_turn}"
        if not parent_task_id.endswith(suffix):
            raise EnvelopeError("Follow-up parent task_id does not match its turn suffix")
        root = parent_task_id[: -len(suffix)]
    child = f"{root}-t{new_turn}"
    if not _SAFE_TASK_ID.fullmatch(child):
        raise EnvelopeError("Derived follow-up task_id is unsafe")
    return child


def _validate_source_and_destination(parent: Path, destination: Path) -> None:
    if destination.exists() or destination.is_symlink():
        raise ValueError(f"Refusing to overwrite follow-up task: {destination}")
    if destination.parent.exists() and destination.parent.is_symlink():
        raise ValueError(f"Follow-up destination parent must not be a symlink: {destination.parent}")
    parent_resolved = parent.resolve()
    destination_resolved = destination.resolve()
    if (
        parent_resolved == destination_resolved
        or parent_resolved.is_relative_to(destination_resolved)
        or destination_resolved.is_relative_to(parent_resolved)
    ):
        raise ValueError("Parent and follow-up task directories must be disjoint")


def _validate_generated_pack(root: Path) -> None:
    public = root / "public"
    private = root / "private"
    task = read_json(public / "task.json")
    truth = read_json(private / "truth.json")
    base = load_mask(private / "base-mask.png", polarity="bright")
    target = load_mask(private / "truth-target-mask.png", polarity="bright")
    neighbor = load_mask(private / "truth-neighbor-mask.png", polarity="bright")
    _validate_fixture(
        public_dir=public,
        task=task,
        truth=truth,
        base_mask=base,
        truth_target=target,
        truth_neighbor=neighbor,
    )
    if np.any(target & ~base):
        raise EnvelopeError("Generated target truth escaped the follow-up base mask")
    history = load_mask(private / "display-history-mask.png", polarity="bright")
    if sha256_mask_pixels(history) != truth.get("display_history_mask_pixel_sha256"):
        raise EnvelopeError("Generated display-history binding drift")
    if task.get("display_history", {}).get("mask_pixel_sha256") != sha256_mask_pixels(
        history
    ):
        raise EnvelopeError("Generated public display-history binding drift")
    transition = private / "transition.json"
    link = task.get("parent_transition", {})
    if sha256_file(transition) != link.get("private_provenance_sha256"):
        raise EnvelopeError("Generated transition provenance binding drift")
