"""Deterministic, single-turn ownership actions for the word-envelope POC.

This module deliberately decides *which mask pixels belong to a word*, not the
final envelope geometry.  Actions are bound to the current mask and component
inventory so a relabel after a cut cannot silently retarget a later selection.
"""

from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Any, Iterable, Mapping

import numpy as np

from .engine import EnvelopeError
from .io_utils import CLEANUP_SCHEMA_VERSION, canonical_json_bytes, sha256_mask_pixels
from .masks import apply_cleanup_operations, stable_components


AGENT_OWNERSHIP_SCHEMA_VERSION = "word-ink-ownership-action.v1"
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_CONFIDENCES = {"high", "medium", "low"}
_REASON_CODES = {
    "same_word_body",
    "detached_mark_belongs_to_target",
    "adjacent_word",
    "rule_or_noise",
    "threshold_bridge",
    "border_contact",
    "clipped_ink",
    "touching_words",
    "correction_or_strikeout",
    "uncertain_reading",
}
_REQUEST_KINDS = {"crop_margin", "source_resolution", "line_context"}
_REQUEST_WHY = {
    "border_contact",
    "ambiguous_neighbor",
    "detached_mark",
    "low_resolution",
    "uncertain_reading",
}
_MANUAL_DISPOSITIONS = {
    "ambiguous_ownership",
    "ambiguous_detached_mark",
    "clipped_target",
    "touching_or_overwritten_ink",
    "insufficient_visual_evidence",
    "unsafe_cut",
}
_ROOT_KEYS = {
    "schema_version",
    "task_id",
    "task_pack_sha256",
    "turn",
    "input_state_sha256",
    "component_inventory_sha256",
    "action",
}


@dataclass(frozen=True)
class OwnershipActionResult:
    """The deterministic state resulting from exactly one validated action."""

    action: dict[str, Any]
    output_mask: np.ndarray
    claimed_mask: np.ndarray | None
    input_mask_pixel_sha256: str
    output_mask_pixel_sha256: str
    input_component_inventory_sha256: str
    output_component_inventory_sha256: str
    requires_later_turn: bool
    terminal_status: str | None
    cleanup_log: tuple[dict[str, Any], ...]


def component_inventory_sha256(inventory: Iterable[Mapping[str, Any]]) -> str:
    """Hash the public, stable component inventory without implementation labels."""

    import hashlib

    value = [_component_fingerprint(component) for component in inventory]
    return hashlib.sha256(canonical_json_bytes(value)).hexdigest()


def component_reference(component: Mapping[str, Any]) -> dict[str, Any]:
    """Return the only component reference accepted by a validated action."""

    fingerprint = _component_fingerprint(component)
    return {"id": fingerprint["id"], "fingerprint": fingerprint}


def validate_single_action(
    record: Mapping[str, Any], raw_mask: np.ndarray
) -> dict[str, Any]:
    """Strictly validate one action against the current mask and inventory.

    Validation does not mutate the mask.  A ``cut`` is additionally simulated to
    prove that it severs its referenced connected component, but selection is
    intentionally impossible in the same turn.
    """

    if not isinstance(record, Mapping):
        raise EnvelopeError("Agent ownership record must be an object")
    _require_exact_keys(record, _ROOT_KEYS, "Agent ownership record")
    if record["schema_version"] != AGENT_OWNERSHIP_SCHEMA_VERSION:
        raise EnvelopeError(
            f"Agent ownership schema must be {AGENT_OWNERSHIP_SCHEMA_VERSION!r}"
        )
    if not isinstance(record["task_id"], str) or not record["task_id"]:
        raise EnvelopeError("task_id must be a non-empty string")
    _require_sha256(record["task_pack_sha256"], "task_pack_sha256")
    _require_nonnegative_int(record["turn"], "turn")

    mask = _validated_mask(raw_mask, "raw mask")
    observed_state_hash = sha256_mask_pixels(mask)
    _require_sha256(record["input_state_sha256"], "input_state_sha256")
    if record["input_state_sha256"] != observed_state_hash:
        raise EnvelopeError("Action input_state_sha256 does not match the current mask")
    labels, inventory = stable_components(mask)
    observed_inventory_hash = component_inventory_sha256(inventory)
    _require_sha256(record["component_inventory_sha256"], "component_inventory_sha256")
    if record["component_inventory_sha256"] != observed_inventory_hash:
        raise EnvelopeError(
            "Action component_inventory_sha256 does not match the current inventory"
        )

    action = record["action"]
    if not isinstance(action, Mapping):
        raise EnvelopeError("action must be an object")
    action_type = action.get("type")
    if action_type not in {
        "claim_select",
        "exclude",
        "cut",
        "request_expanded_context",
        "defer_manual",
    }:
        raise EnvelopeError("action.type is unsupported")

    _validate_common_action_fields(action)
    by_id = {component["id"]: component for component in inventory}
    if action_type == "claim_select":
        _require_exact_keys(
            action,
            {"type", "target_component_refs", "confidence", "reason_codes"},
            "claim_select action",
        )
        _validate_component_refs(action["target_component_refs"], by_id, "target_component_refs")
    elif action_type == "exclude":
        _require_exact_keys(
            action,
            {"type", "component_refs", "confidence", "reason_codes"},
            "exclude action",
        )
        _validate_component_refs(action["component_refs"], by_id, "component_refs")
    elif action_type == "cut":
        _require_exact_keys(
            action,
            {"type", "cut", "bridge_component_ref", "confidence", "reason_codes"},
            "cut action",
        )
        bridge = _validate_component_ref(action["bridge_component_ref"], by_id, "bridge_component_ref")
        _validate_cut(action["cut"], mask, labels, bridge)
    elif action_type == "request_expanded_context":
        _require_exact_keys(
            action,
            {"type", "request", "confidence", "reason_codes"},
            "request_expanded_context action",
        )
        _validate_context_request(action["request"], by_id)
    else:
        _require_exact_keys(
            action,
            {"type", "disposition", "confidence", "reason_codes"},
            "defer_manual action",
        )
        if action["disposition"] not in _MANUAL_DISPOSITIONS:
            raise EnvelopeError("defer_manual disposition is unsupported")
    return dict(record)


def apply_single_action(
    record: Mapping[str, Any], raw_mask: np.ndarray
) -> OwnershipActionResult:
    """Validate and apply exactly one ownership action.

    ``claim_select`` is the only action that emits a terminal claimed mask.  A
    successful exclusion or cut always sets ``requires_later_turn`` so its
    relabeled inventory must be shown to the agent before a claim can be made.
    """

    validated = validate_single_action(record, raw_mask)
    mask = _validated_mask(raw_mask, "raw mask")
    labels, inventory = stable_components(mask)
    action = dict(validated["action"])
    action_type = action["type"]
    input_hash = sha256_mask_pixels(mask)
    input_inventory_hash = component_inventory_sha256(inventory)
    output_mask = mask.copy()
    claimed_mask: np.ndarray | None = None
    cleanup_log: tuple[dict[str, Any], ...] = ()
    requires_later_turn = False
    terminal_status: str | None = None

    if action_type == "claim_select":
        ids = [reference["id"] for reference in action["target_component_refs"]]
        claimed_mask = np.isin(labels, ids)
        terminal_status = "selected"
    elif action_type == "exclude":
        cleanup = {
            "schema_version": CLEANUP_SCHEMA_VERSION,
            "operations": [
                {
                    "type": "remove_components",
                    "ids": [
                        reference["id"] for reference in action["component_refs"]
                    ],
                    "expected_input_mask_pixel_sha256": input_hash,
                }
            ],
        }
        output_mask, log = apply_cleanup_operations(mask, cleanup)
        cleanup_log = tuple(log)
        requires_later_turn = True
    elif action_type == "cut":
        cleanup = {
            "schema_version": CLEANUP_SCHEMA_VERSION,
            "operations": [
                {
                    "type": "cut",
                    "points": action["cut"]["points"],
                    "width_px": action["cut"]["width_px"],
                    "expected_input_mask_pixel_sha256": input_hash,
                }
            ],
        }
        output_mask, log = apply_cleanup_operations(mask, cleanup)
        cleanup_log = tuple(log)
        requires_later_turn = True
    elif action_type == "request_expanded_context":
        terminal_status = "needs_expanded_context"
    elif action_type == "defer_manual":
        terminal_status = "manual_review"

    _, output_inventory = stable_components(output_mask)
    return OwnershipActionResult(
        action=action,
        output_mask=output_mask,
        claimed_mask=claimed_mask,
        input_mask_pixel_sha256=input_hash,
        output_mask_pixel_sha256=sha256_mask_pixels(output_mask),
        input_component_inventory_sha256=input_inventory_hash,
        output_component_inventory_sha256=component_inventory_sha256(output_inventory),
        requires_later_turn=requires_later_turn,
        terminal_status=terminal_status,
        cleanup_log=cleanup_log,
    )


def score_ownership(
    claimed_mask: np.ndarray,
    truth_target_mask: np.ndarray,
    semantic_neighbor_mask: np.ndarray | None = None,
) -> dict[str, Any]:
    """Score a terminal claim against frozen pixel truth deterministically."""

    claimed = _validated_mask(claimed_mask, "claimed mask")
    truth = _validated_mask(truth_target_mask, "truth target mask", shape=claimed.shape)
    if not truth.any():
        raise EnvelopeError("truth target mask must contain at least one pixel")
    neighbor = (
        _validated_mask(semantic_neighbor_mask, "semantic neighbor mask", shape=claimed.shape)
        if semantic_neighbor_mask is not None
        else None
    )
    if neighbor is not None and np.any(truth & neighbor):
        raise EnvelopeError("truth target and semantic neighbor masks must not overlap")

    true_positive = int(np.count_nonzero(claimed & truth))
    false_positive = int(np.count_nonzero(claimed & ~truth))
    false_negative = int(np.count_nonzero(truth & ~claimed))
    claimed_pixels = int(claimed.sum())
    truth_pixels = int(truth.sum())
    precision = float(true_positive / claimed_pixels) if claimed_pixels else 0.0
    recall = float(true_positive / truth_pixels)
    f1 = float(2 * precision * recall / (precision + recall)) if precision + recall else 0.0
    union = true_positive + false_positive + false_negative
    iou = float(true_positive / union) if union else 0.0

    result: dict[str, Any] = {
        "claimed_mask_pixel_sha256": sha256_mask_pixels(claimed),
        "truth_target_mask_pixel_sha256": sha256_mask_pixels(truth),
        "claimed_pixels": claimed_pixels,
        "truth_target_pixels": truth_pixels,
        "true_positive_pixels": true_positive,
        "false_positive_pixels": false_positive,
        "false_negative_pixels": false_negative,
        "precision": round(precision, 9),
        "recall": round(recall, 9),
        "f1": round(f1, 9),
        "iou": round(iou, 9),
        "semantic_neighbor_available": neighbor is not None,
        "semantic_neighbor_mask_pixel_sha256": (
            sha256_mask_pixels(neighbor) if neighbor is not None else None
        ),
        "neighbor_contamination": None,
        "neighbor_component_max_contamination": None,
    }
    if neighbor is not None:
        neighbor_pixels = int(neighbor.sum())
        contamination = float(np.count_nonzero(claimed & neighbor) / neighbor_pixels) if neighbor_pixels else 0.0
        _, inventory = stable_components(neighbor)
        component_values: list[float] = []
        labels, _ = stable_components(neighbor)
        for component in inventory:
            component_mask = labels == component["id"]
            component_values.append(float(np.count_nonzero(claimed & component_mask) / component["area_px"]))
        result.update(
            {
                "semantic_neighbor_pixels": neighbor_pixels,
                "neighbor_contamination": round(contamination, 9),
                "neighbor_component_max_contamination": round(max(component_values, default=0.0), 9),
            }
        )
    return result


def _component_fingerprint(component: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "id": component["id"],
        "area_px": component["area_px"],
        "bbox": dict(component["bbox"]),
        "anchor": dict(component["anchor"]),
    }


def _validate_common_action_fields(action: Mapping[str, Any]) -> None:
    if action.get("confidence") not in _CONFIDENCES:
        raise EnvelopeError("action confidence is unsupported")
    reasons = action.get("reason_codes")
    if not isinstance(reasons, list) or not reasons:
        raise EnvelopeError("action reason_codes must be a non-empty list")
    if len(reasons) != len(set(reasons)) or any(reason not in _REASON_CODES for reason in reasons):
        raise EnvelopeError("action reason_codes are unsupported or duplicated")


def _validate_component_refs(
    references: Any, by_id: Mapping[int, Mapping[str, Any]], field: str
) -> None:
    if not isinstance(references, list) or not references:
        raise EnvelopeError(f"{field} must be a non-empty list")
    ids = [_validate_component_ref(reference, by_id, field)["id"] for reference in references]
    if len(ids) != len(set(ids)):
        raise EnvelopeError(f"{field} must not contain duplicate component IDs")


def _validate_component_ref(
    reference: Any, by_id: Mapping[int, Mapping[str, Any]], field: str
) -> Mapping[str, Any]:
    if not isinstance(reference, Mapping):
        raise EnvelopeError(f"{field} entries must be objects")
    _require_exact_keys(reference, {"id", "fingerprint"}, f"{field} entry")
    component_id = reference["id"]
    _require_positive_int(component_id, f"{field}.id")
    component = by_id.get(component_id)
    if component is None:
        raise EnvelopeError(f"{field} refers to a missing component ID {component_id}")
    if reference["fingerprint"] != _component_fingerprint(component):
        raise EnvelopeError(f"{field} fingerprint does not match current component {component_id}")
    return component


def _validate_cut(
    cut: Any,
    mask: np.ndarray,
    labels: np.ndarray,
    bridge_component: Mapping[str, Any],
) -> None:
    if not isinstance(cut, Mapping):
        raise EnvelopeError("cut must be an object")
    _require_exact_keys(cut, {"kind", "points", "width_px", "intent"}, "cut")
    if cut["kind"] != "line" or cut["intent"] != "sever_observed_bridge":
        raise EnvelopeError("cut must be a line with sever_observed_bridge intent")
    width = cut["width_px"]
    if not isinstance(width, int) or isinstance(width, bool) or not 1 <= width <= 3:
        raise EnvelopeError("cut width_px must be an integer from 1 to 3")
    points = cut["points"]
    if not isinstance(points, list) or len(points) != 2:
        raise EnvelopeError("cut points must contain exactly two endpoints")
    checked_points: list[tuple[int, int]] = []
    for point in points:
        if not isinstance(point, list) or len(point) != 2:
            raise EnvelopeError("cut points must be [x, y] pairs")
        x, y = point
        if not isinstance(x, int) or isinstance(x, bool) or not isinstance(y, int) or isinstance(y, bool):
            raise EnvelopeError("cut coordinates must be integer pixels")
        if not 0 <= x < mask.shape[1] or not 0 <= y < mask.shape[0]:
            raise EnvelopeError("cut coordinates must lie inside the crop")
        checked_points.append((x, y))
    if checked_points[0] == checked_points[1]:
        raise EnvelopeError("cut endpoints must be distinct")

    cleanup = {
        "schema_version": CLEANUP_SCHEMA_VERSION,
        "operations": [
            {
                "type": "cut",
                "points": points,
                "width_px": width,
                "expected_input_mask_pixel_sha256": sha256_mask_pixels(mask),
            }
        ],
    }
    cut_mask, _ = apply_cleanup_operations(mask, cleanup)
    removed = mask & ~cut_mask
    bridge_pixels = labels == bridge_component["id"]
    if not np.any(removed & bridge_pixels):
        raise EnvelopeError("cut does not remove ink from its bridge_component_ref")
    if np.any(removed & ~bridge_pixels):
        raise EnvelopeError(
            "cut removes ink outside its bridge_component_ref"
        )
    before_count = len(stable_components(mask)[1])
    after_labels, after_inventory = stable_components(cut_mask)
    if len(after_inventory) <= before_count:
        raise EnvelopeError("cut must split a connected component before a later turn")
    overlapping_after_ids = np.unique(after_labels[bridge_pixels & cut_mask])
    if len(overlapping_after_ids[overlapping_after_ids > 0]) < 2:
        raise EnvelopeError("cut does not sever its bridge_component_ref into multiple components")


def _validate_context_request(request: Any, by_id: Mapping[int, Mapping[str, Any]]) -> None:
    if not isinstance(request, Mapping):
        raise EnvelopeError("request must be an object")
    _require_exact_keys(
        request,
        {"kind", "sides", "margin_px", "focus_component_refs", "why"},
        "request",
    )
    if request["kind"] not in _REQUEST_KINDS or request["why"] not in _REQUEST_WHY:
        raise EnvelopeError("request kind or why is unsupported")
    sides = request["sides"]
    if not isinstance(sides, list) or not sides or len(sides) != len(set(sides)) or any(side not in {"left", "right", "top", "bottom"} for side in sides):
        raise EnvelopeError("request sides are invalid")
    margin = request["margin_px"]
    if not isinstance(margin, int) or isinstance(margin, bool) or not 16 <= margin <= 512:
        raise EnvelopeError("request margin_px must be an integer from 16 to 512")
    focus = request["focus_component_refs"]
    if not isinstance(focus, list):
        raise EnvelopeError("request focus_component_refs must be a list")
    if focus:
        _validate_component_refs(focus, by_id, "focus_component_refs")


def _validated_mask(mask: np.ndarray, name: str, shape: tuple[int, int] | None = None) -> np.ndarray:
    array = np.asarray(mask)
    if array.ndim != 2:
        raise EnvelopeError(f"{name} must be two-dimensional")
    if shape is not None and array.shape != shape:
        raise EnvelopeError(f"{name} dimensions do not match the claimed mask")
    return np.asarray(array, dtype=bool)


def _require_exact_keys(value: Mapping[str, Any], expected: set[str], name: str) -> None:
    actual = set(value.keys())
    if actual != expected:
        missing = sorted(expected - actual)
        extra = sorted(actual - expected)
        raise EnvelopeError(f"{name} has invalid fields; missing={missing}, extra={extra}")


def _require_sha256(value: Any, name: str) -> None:
    if not isinstance(value, str) or _SHA256.fullmatch(value) is None:
        raise EnvelopeError(f"{name} must be a lowercase SHA-256 string")


def _require_positive_int(value: Any, name: str) -> None:
    if not isinstance(value, int) or isinstance(value, bool) or value < 1:
        raise EnvelopeError(f"{name} must be a positive integer")


def _require_nonnegative_int(value: Any, name: str) -> None:
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise EnvelopeError(f"{name} must be a non-negative integer")
