"""Bind compact agent decisions to deterministic ownership action records.

The visual agent only has to return component IDs and its semantic decision.  This
module copies task/state bindings and complete component fingerprints from the
public task pack, eliminating a large and error-prone transcription step while
preserving the strict replay contract in :mod:`word_envelope.agent_ownership`.
"""

from __future__ import annotations

import copy
import hashlib
import re
from pathlib import Path
from typing import Any, Mapping

import numpy as np

from .agent_ownership import (
    AGENT_OWNERSHIP_SCHEMA_VERSION,
    component_inventory_sha256,
    component_reference,
    validate_single_action,
)
from .engine import EnvelopeError
from .io_utils import canonical_json_bytes, read_json, write_json


AGENT_OWNERSHIP_DECISION_SCHEMA_VERSION = "word-ink-ownership-decision.v1"

_DECISION_KEYS = {"schema_version", "action"}
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
_SHA256 = re.compile(r"^[0-9a-f]{64}$")


def build_bound_action(
    task: Mapping[str, Any],
    decision: Mapping[str, Any],
    current_mask: np.ndarray | None = None,
) -> dict[str, Any]:
    """Expand one compact decision into a replay-bound ownership action.

    ``task`` is the public task-pack object.  ``decision`` contains exactly a
    schema version and one compact action whose component references are integer
    IDs.  If ``current_mask`` is supplied, the fully expanded record is passed
    through the authoritative strict validator, including cut simulation and
    stale mask/inventory rejection.
    """

    bindings, references, work_size = _validate_task(task)
    if not isinstance(decision, Mapping):
        raise EnvelopeError("Agent ownership decision must be an object")
    _require_exact_keys(decision, _DECISION_KEYS, "Agent ownership decision")
    if decision["schema_version"] != AGENT_OWNERSHIP_DECISION_SCHEMA_VERSION:
        raise EnvelopeError(
            "Agent ownership decision schema must be "
            f"{AGENT_OWNERSHIP_DECISION_SCHEMA_VERSION!r}"
        )

    compact_action = decision["action"]
    if not isinstance(compact_action, Mapping):
        raise EnvelopeError("decision action must be an object")
    action = _expand_action(compact_action, references, work_size)
    record: dict[str, Any] = {
        "schema_version": AGENT_OWNERSHIP_SCHEMA_VERSION,
        **bindings,
        "action": action,
    }
    if current_mask is not None:
        validate_single_action(record, current_mask)
    return record


def build_bound_action_from_paths(
    task_path: str | Path,
    decision_path: str | Path,
    output_path: str | Path,
    *,
    current_mask: np.ndarray | None = None,
) -> dict[str, Any]:
    """Load a task and decision, build the bound record, and write canonical JSON."""

    record = build_bound_action(
        read_json(Path(task_path)),
        read_json(Path(decision_path)),
        current_mask=current_mask,
    )
    write_json(Path(output_path), record)
    return record


def _validate_task(
    task: Mapping[str, Any],
) -> tuple[dict[str, Any], dict[int, dict[str, Any]], tuple[int, int]]:
    if not isinstance(task, Mapping):
        raise EnvelopeError("Agent task pack must be an object")
    required = {
        "task_id",
        "task_pack_sha256",
        "turn",
        "input_state_sha256",
        "component_inventory_sha256",
        "components",
        "work_size_wh",
    }
    missing = sorted(required - set(task.keys()))
    if missing:
        raise EnvelopeError(f"Agent task pack is missing required fields: {missing}")
    if not isinstance(task["task_id"], str) or not task["task_id"]:
        raise EnvelopeError("task_id must be a non-empty string")
    _require_sha256(task["task_pack_sha256"], "task_pack_sha256")
    _require_sha256(task["input_state_sha256"], "input_state_sha256")
    _require_sha256(
        task["component_inventory_sha256"], "component_inventory_sha256"
    )
    turn = task["turn"]
    if not isinstance(turn, int) or isinstance(turn, bool) or turn < 0:
        raise EnvelopeError("turn must be a non-negative integer")
    work_size_value = task["work_size_wh"]
    if (
        not isinstance(work_size_value, list)
        or len(work_size_value) != 2
        or any(
            not isinstance(value, int) or isinstance(value, bool) or value < 1
            for value in work_size_value
        )
    ):
        raise EnvelopeError("work_size_wh must contain two positive integers")
    work_size = (int(work_size_value[0]), int(work_size_value[1]))

    components = task["components"]
    if not isinstance(components, list):
        raise EnvelopeError("task components must be a list")
    references: dict[int, dict[str, Any]] = {}
    inventory: list[dict[str, Any]] = []
    for position, reference in enumerate(components):
        if not isinstance(reference, Mapping):
            raise EnvelopeError(f"task component {position} must be an object")
        _require_exact_keys(
            reference, {"id", "fingerprint"}, f"task component {position}"
        )
        component_id = reference["id"]
        if (
            not isinstance(component_id, int)
            or isinstance(component_id, bool)
            or component_id < 1
        ):
            raise EnvelopeError(f"task component {position} id must be positive")
        if component_id in references:
            raise EnvelopeError(f"task components duplicate ID {component_id}")
        fingerprint = reference["fingerprint"]
        if not isinstance(fingerprint, Mapping):
            raise EnvelopeError(
                f"task component {component_id} fingerprint must be an object"
            )
        try:
            canonical = component_reference(fingerprint)
        except (KeyError, TypeError) as error:
            raise EnvelopeError(
                f"task component {component_id} fingerprint is incomplete"
            ) from error
        if reference != canonical:
            raise EnvelopeError(
                f"task component {component_id} is not a canonical component reference"
            )
        canonical_copy = copy.deepcopy(canonical)
        references[component_id] = canonical_copy
        inventory.append(copy.deepcopy(canonical_copy["fingerprint"]))

    observed_inventory_hash = component_inventory_sha256(inventory)
    if task["component_inventory_sha256"] != observed_inventory_hash:
        raise EnvelopeError(
            "Task component_inventory_sha256 does not match its component table"
        )

    task_basis = copy.deepcopy(dict(task))
    task_pack_hash = task_basis.pop("task_pack_sha256")
    try:
        observed_task_hash = hashlib.sha256(
            canonical_json_bytes(task_basis)
        ).hexdigest()
    except (TypeError, ValueError) as error:
        raise EnvelopeError("Agent task pack is not canonical JSON data") from error
    if task_pack_hash != observed_task_hash:
        raise EnvelopeError(
            "task_pack_sha256 does not match the public task contents"
        )

    bindings = {
        "task_id": task["task_id"],
        "task_pack_sha256": task["task_pack_sha256"],
        "turn": turn,
        "input_state_sha256": task["input_state_sha256"],
        "component_inventory_sha256": task["component_inventory_sha256"],
    }
    return bindings, references, work_size


def _expand_action(
    action: Mapping[str, Any],
    references: Mapping[int, dict[str, Any]],
    work_size: tuple[int, int],
) -> dict[str, Any]:
    action_type = action.get("type")
    if action_type == "claim_select":
        _require_exact_keys(
            action,
            {"type", "component_ids", "confidence", "reason_codes"},
            "claim_select decision",
        )
        result = {
            "type": action_type,
            "target_component_refs": _resolve_ids(
                action["component_ids"], references, "component_ids"
            ),
            "confidence": action["confidence"],
            "reason_codes": copy.deepcopy(action["reason_codes"]),
        }
    elif action_type == "exclude":
        _require_exact_keys(
            action,
            {"type", "component_ids", "confidence", "reason_codes"},
            "exclude decision",
        )
        result = {
            "type": action_type,
            "component_refs": _resolve_ids(
                action["component_ids"], references, "component_ids"
            ),
            "confidence": action["confidence"],
            "reason_codes": copy.deepcopy(action["reason_codes"]),
        }
    elif action_type == "cut":
        _require_exact_keys(
            action,
            {
                "type",
                "bridge_component_id",
                "cut",
                "confidence",
                "reason_codes",
            },
            "cut decision",
        )
        bridge_id = _require_existing_id(
            action["bridge_component_id"], references, "bridge_component_id"
        )
        _validate_compact_cut(action["cut"], work_size)
        result = {
            "type": action_type,
            "bridge_component_ref": copy.deepcopy(references[bridge_id]),
            "cut": copy.deepcopy(action["cut"]),
            "confidence": action["confidence"],
            "reason_codes": copy.deepcopy(action["reason_codes"]),
        }
    elif action_type == "request_expanded_context":
        _require_exact_keys(
            action,
            {"type", "request", "confidence", "reason_codes"},
            "request_expanded_context decision",
        )
        request = action["request"]
        if not isinstance(request, Mapping):
            raise EnvelopeError("request must be an object")
        _require_exact_keys(
            request,
            {"kind", "sides", "margin_px", "focus_component_ids", "why"},
            "request",
        )
        _validate_compact_request(request)
        result = {
            "type": action_type,
            "request": {
                "kind": request["kind"],
                "sides": copy.deepcopy(request["sides"]),
                "margin_px": request["margin_px"],
                "focus_component_refs": _resolve_ids(
                    request["focus_component_ids"],
                    references,
                    "focus_component_ids",
                    allow_empty=True,
                ),
                "why": request["why"],
            },
            "confidence": action["confidence"],
            "reason_codes": copy.deepcopy(action["reason_codes"]),
        }
    elif action_type == "defer_manual":
        _require_exact_keys(
            action,
            {"type", "disposition", "confidence", "reason_codes"},
            "defer_manual decision",
        )
        if action["disposition"] not in _MANUAL_DISPOSITIONS:
            raise EnvelopeError("defer_manual disposition is unsupported")
        result = {
            "type": action_type,
            "disposition": action["disposition"],
            "confidence": action["confidence"],
            "reason_codes": copy.deepcopy(action["reason_codes"]),
        }
    else:
        raise EnvelopeError("decision action.type is unsupported")

    _validate_common_fields(result)
    return result


def _resolve_ids(
    values: Any,
    references: Mapping[int, dict[str, Any]],
    field: str,
    *,
    allow_empty: bool = False,
) -> list[dict[str, Any]]:
    if not isinstance(values, list) or (not values and not allow_empty):
        qualifier = "a list" if allow_empty else "a non-empty list"
        raise EnvelopeError(f"{field} must be {qualifier}")
    ids = [_require_existing_id(value, references, field) for value in values]
    if len(ids) != len(set(ids)):
        raise EnvelopeError(f"{field} must not contain duplicate component IDs")
    return [copy.deepcopy(references[component_id]) for component_id in ids]


def _require_existing_id(
    value: Any, references: Mapping[int, dict[str, Any]], field: str
) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 1:
        raise EnvelopeError(f"{field} entries must be positive integer component IDs")
    if value not in references:
        raise EnvelopeError(f"{field} refers to missing component ID {value}")
    return value


def _validate_common_fields(action: Mapping[str, Any]) -> None:
    if action["confidence"] not in _CONFIDENCES:
        raise EnvelopeError("decision confidence is unsupported")
    reasons = action["reason_codes"]
    if not isinstance(reasons, list) or not reasons:
        raise EnvelopeError("decision reason_codes must be a non-empty list")
    if len(reasons) != len(set(reasons)) or any(
        reason not in _REASON_CODES for reason in reasons
    ):
        raise EnvelopeError("decision reason_codes are unsupported or duplicated")


def _validate_compact_cut(cut: Any, work_size: tuple[int, int]) -> None:
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
    for point in points:
        if not isinstance(point, list) or len(point) != 2:
            raise EnvelopeError("cut points must be [x, y] pairs")
        if any(
            not isinstance(coordinate, int) or isinstance(coordinate, bool)
            for coordinate in point
        ):
            raise EnvelopeError("cut coordinates must be integer pixels")
        x, y = point
        if not 0 <= x < work_size[0] or not 0 <= y < work_size[1]:
            raise EnvelopeError("cut coordinates must lie inside the work crop")
    if points[0] == points[1]:
        raise EnvelopeError("cut endpoints must be distinct")


def _validate_compact_request(request: Mapping[str, Any]) -> None:
    if request["kind"] not in _REQUEST_KINDS or request["why"] not in _REQUEST_WHY:
        raise EnvelopeError("request kind or why is unsupported")
    sides = request["sides"]
    if (
        not isinstance(sides, list)
        or not sides
        or len(sides) != len(set(sides))
        or any(side not in {"left", "right", "top", "bottom"} for side in sides)
    ):
        raise EnvelopeError("request sides are invalid")
    margin = request["margin_px"]
    if not isinstance(margin, int) or isinstance(margin, bool) or not 16 <= margin <= 512:
        raise EnvelopeError("request margin_px must be an integer from 16 to 512")


def _require_exact_keys(value: Mapping[str, Any], expected: set[str], name: str) -> None:
    actual = set(value.keys())
    if actual != expected:
        missing = sorted(expected - actual)
        extra = sorted(actual - expected)
        raise EnvelopeError(
            f"{name} has invalid fields; missing={missing}, extra={extra}"
        )


def _require_sha256(value: Any, name: str) -> None:
    if not isinstance(value, str) or _SHA256.fullmatch(value) is None:
        raise EnvelopeError(f"{name} must be a lowercase SHA-256 string")
