"""Deterministic supervisor for page-to-word ownership work.

The existing ownership tools answer a narrow question: which current ink
components belong to one target?  This module owns the question above that:
what is the single next task, which actions are legal, and may the workflow
advance?  It deliberately keeps line registration, visual location, transcript
alignment, pixel ownership, residual coverage, and envelope geometry separate.
"""

from __future__ import annotations

import copy
import hashlib
import math
import re
from collections import Counter
from typing import Any, Mapping, Sequence

from .engine import EnvelopeError
from .io_utils import canonical_json_bytes


WORK_LEDGER_SCHEMA_VERSION = "word-work-ledger.v1"
WORK_ITEM_SCHEMA_VERSION = "word-work-item.v1"
WORK_DECISION_SCHEMA_VERSION = "word-work-decision.v1"
WORK_TRANSITION_SCHEMA_VERSION = "word-work-transition.v1"

_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_LINE_KEYS = {
    "line_id",
    "reading_order",
    "directed_reading",
    "context",
    "transcript_units",
    "visible_units",
    "alignment_groups",
    "residual_regions",
}
_DIRECTION_KEYS = {
    "source_to_upright_affine",
    "upright_to_source_affine",
    "start_anchor_source_xy",
    "end_anchor_source_xy",
    "upright_direction",
}
_CONTEXT_KEYS = {
    "source_locator_sha256",
    "upright_view_sha256",
    "ownership_overlay_sha256",
}
_UPRIGHT_DIRECTIONS = {"left_to_right", "right_to_left", "top_to_bottom"}
_RESIDUAL_DISPOSITIONS = {
    "punctuation",
    "non_word_mark",
    "scan_artifact",
}
_HUMAN_REASONS = {
    "ambiguous_ownership",
    "insufficient_context",
    "line_registration",
    "shared_ink",
    "transcript_conflict",
    "unreadable",
    "unsafe_cut",
    "envelope_failure",
}

WORK_ACTION_TYPES = {
    "accept_alignment_group",
    "approve_line_registration",
    "approve_ownership",
    "classify_residual",
    "complete_residual_audit",
    "confirm_location",
    "escalate_human",
    "insert_visible_unit",
    "record_envelope",
    "reject_transcript",
}

_ACTION_PAYLOAD_CONTRACTS: dict[str, dict[str, Any]] = {
    "approve_line_registration": {
        "required": ["directed_reading_sha256"],
        "copy_from_packet": ["required_evidence.directed_reading_sha256"],
    },
    "confirm_location": {"required": ["evidence_sha256"]},
    "accept_alignment_group": {"required": ["evidence_sha256"]},
    "reject_transcript": {
        "required": ["transcript_unit_id", "replacement_text", "evidence_sha256"],
    },
    "approve_ownership": {
        "required": ["owned_mask_sha256", "selection_record_sha256"],
    },
    "classify_residual": {
        "required": ["disposition", "evidence_sha256"],
        "disposition_enum": sorted(_RESIDUAL_DISPOSITIONS),
    },
    "insert_visible_unit": {
        "required": ["visible_unit", "alignment_group", "evidence_sha256"],
    },
    "complete_residual_audit": {"required": ["evidence_sha256"]},
    "record_envelope": {
        "required": ["outcome", "result_sha256"],
        "outcome_enum": ["pass", "box_only_failure"],
    },
    "escalate_human": {
        "required": ["reason", "evidence_sha256"],
        "reason_enum": sorted(_HUMAN_REASONS),
    },
}

_ACTION_ROUTES = {
    "approve_line_registration": "advance_to_first_unresolved_visible_location",
    "confirm_location": "advance_to_next_unresolved_visible_location_or_alignment",
    "accept_alignment_group": "advance_to_next_alignment_group_or_ownership",
    "reject_transcript": "stay_on_same_ink_with_new_transcript_revision",
    "approve_ownership": "advance_to_next_ownership_group_or_residual",
    "classify_residual": "advance_to_next_residual_or_residual_audit",
    "insert_visible_unit": "return_to_location_for_inserted_visible_unit",
    "complete_residual_audit": "advance_to_envelope_only_if_all_semantic_gates_pass",
    "record_envelope": "advance_to_next_envelope_or_machine_complete",
    "escalate_human": "route_bound_item_to_human_and_continue_independent_machine_work",
}


def create_work_ledger(
    *,
    page_id: str,
    source_sha256: str,
    lines: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    """Create revision zero from a page's explicit line/work inventory."""

    _nonempty_string(page_id, "page_id")
    _sha(source_sha256, "source_sha256")
    if not isinstance(lines, Sequence) or isinstance(lines, (str, bytes)) or not lines:
        raise EnvelopeError("lines must be a non-empty sequence")
    normalized_lines = [_normalize_line(line) for line in lines]
    line_ids = [line["line_id"] for line in normalized_lines]
    if len(line_ids) != len(set(line_ids)):
        raise EnvelopeError("line IDs must be unique")
    orders = [line["reading_order"] for line in normalized_lines]
    if len(orders) != len(set(orders)):
        raise EnvelopeError("line reading_order values must be unique")
    normalized_lines.sort(key=lambda line: (line["reading_order"], line["line_id"]))
    ledger: dict[str, Any] = {
        "schema_version": WORK_LEDGER_SCHEMA_VERSION,
        "page_id": page_id,
        "source_sha256": source_sha256,
        "revision": 0,
        "parent_ledger_sha256": None,
        "lines": normalized_lines,
        "human_queue": [],
        "history": [],
    }
    ledger["ledger_sha256"] = _hash_without(ledger, "ledger_sha256")
    return validate_work_ledger(ledger)


def validate_work_ledger(value: Mapping[str, Any]) -> dict[str, Any]:
    """Validate the complete canonical ledger and its revision hash."""

    if not isinstance(value, Mapping):
        raise EnvelopeError("work ledger must be an object")
    expected = {
        "schema_version",
        "page_id",
        "source_sha256",
        "revision",
        "parent_ledger_sha256",
        "lines",
        "human_queue",
        "history",
        "ledger_sha256",
    }
    _exact_keys(value, expected, "work ledger")
    if value["schema_version"] != WORK_LEDGER_SCHEMA_VERSION:
        raise EnvelopeError(f"work ledger schema must be {WORK_LEDGER_SCHEMA_VERSION!r}")
    _nonempty_string(value["page_id"], "page_id")
    _sha(value["source_sha256"], "source_sha256")
    _nonnegative_int(value["revision"], "revision")
    parent = value["parent_ledger_sha256"]
    if parent is not None:
        _sha(parent, "parent_ledger_sha256")
    _sha(value["ledger_sha256"], "ledger_sha256")
    if value["ledger_sha256"] != _hash_without(value, "ledger_sha256"):
        raise EnvelopeError("ledger_sha256 does not match ledger contents")
    if not isinstance(value["lines"], list) or not value["lines"]:
        raise EnvelopeError("ledger lines must be a non-empty list")
    for line in value["lines"]:
        _validate_normalized_line(line)
    _unique_ids(value["lines"], "line", key="line_id")
    _unique_orders(value["lines"], "line", key="reading_order")
    if not isinstance(value["human_queue"], list):
        raise EnvelopeError("human_queue must be a list")
    _validate_human_queue(value["human_queue"], value["lines"])
    _validate_causal_state(value["lines"], value["human_queue"])
    if not isinstance(value["history"], list):
        raise EnvelopeError("history must be a list")
    if len(value["history"]) != value["revision"]:
        raise EnvelopeError("history length must equal revision")
    _validate_history(value["history"], value["parent_ledger_sha256"], value["lines"])
    _validate_transcript_replay(value["lines"], value["history"])
    return copy.deepcopy(dict(value))


def next_work_item(ledger: Mapping[str, Any]) -> dict[str, Any]:
    """Return exactly one deterministic supervisor packet.

    Calling this repeatedly without applying a transition returns byte-identical
    canonical JSON.  The software, never the model, chooses the stage and actions.
    """

    state = validate_work_ledger(ledger)
    current = _find_current(state)
    completion = page_completion(state)
    if current is None:
        packet = {
            "schema_version": WORK_ITEM_SCHEMA_VERSION,
            "ledger_binding": _ledger_binding(state),
            "current": {
                "stage": "machine_complete",
                "line_id": None,
                "item_id": None,
                "item_kind": "page",
            },
            "goal": "No machine work remains in this revision.",
            "instruction": (
                "Stop. Do not invent another task. Human or bubble-review queues "
                "must be resolved before production completion."
            ),
            "legal_actions": [],
            "required_evidence": {},
            "done_condition": completion["production_status"],
            "blockers": completion["blockers"],
            "progress": _progress(state),
        }
    else:
        line, stage, item = current
        packet = _work_packet(state, line, stage, item, completion)
    packet["work_item_sha256"] = _hash_without(packet, "work_item_sha256")
    return packet


def bind_transition(
    ledger: Mapping[str, Any], compact_action: Mapping[str, Any]
) -> dict[str, Any]:
    """Bind one compact action to the exact ledger revision and work packet."""

    state = validate_work_ledger(ledger)
    packet = next_work_item(state)
    if packet["current"]["stage"] == "machine_complete":
        raise EnvelopeError("machine workflow is complete; no transition is legal")
    action = _validate_compact_action(compact_action, packet, state)
    transition: dict[str, Any] = {
        "schema_version": WORK_TRANSITION_SCHEMA_VERSION,
        "page_id": state["page_id"],
        "base_revision": state["revision"],
        "base_ledger_sha256": state["ledger_sha256"],
        "work_item_sha256": packet["work_item_sha256"],
        "action": action,
    }
    transition["transition_sha256"] = _hash_without(
        transition, "transition_sha256"
    )
    return transition


def bind_agent_decision(
    ledger: Mapping[str, Any], decision: Mapping[str, Any]
) -> dict[str, Any]:
    """Expand one strict model response into a revision-bound transition."""

    if not isinstance(decision, Mapping):
        raise EnvelopeError("agent decision must be an object")
    _exact_keys(decision, {"schema_version", "action"}, "agent decision")
    if decision["schema_version"] != WORK_DECISION_SCHEMA_VERSION:
        raise EnvelopeError(
            f"agent decision schema must be {WORK_DECISION_SCHEMA_VERSION!r}"
        )
    return bind_transition(ledger, decision["action"])


def apply_transition(
    ledger: Mapping[str, Any], transition: Mapping[str, Any]
) -> dict[str, Any]:
    """Apply a bound transition and return a new append-only child revision."""

    state = validate_work_ledger(ledger)
    if not isinstance(transition, Mapping):
        raise EnvelopeError("transition must be an object")
    expected = {
        "schema_version",
        "page_id",
        "base_revision",
        "base_ledger_sha256",
        "work_item_sha256",
        "action",
        "transition_sha256",
    }
    _exact_keys(transition, expected, "transition")
    if transition["schema_version"] != WORK_TRANSITION_SCHEMA_VERSION:
        raise EnvelopeError("transition schema is unsupported")
    _sha(transition["transition_sha256"], "transition_sha256")
    if transition["transition_sha256"] != _hash_without(
        transition, "transition_sha256"
    ):
        raise EnvelopeError("transition_sha256 does not match transition contents")
    if transition["page_id"] != state["page_id"]:
        raise EnvelopeError("transition page_id does not match ledger")
    if transition["base_revision"] != state["revision"]:
        raise EnvelopeError("transition is stale for the ledger revision")
    if transition["base_ledger_sha256"] != state["ledger_sha256"]:
        raise EnvelopeError("transition is stale for the ledger hash")
    expected_transition = bind_transition(state, transition["action"])
    if dict(transition) != expected_transition:
        raise EnvelopeError("transition does not match the current work item")

    child = copy.deepcopy(state)
    packet = next_work_item(state)
    _mutate_for_action(child, packet, transition["action"])
    old_hash = state["ledger_sha256"]
    child["revision"] += 1
    child["parent_ledger_sha256"] = old_hash
    child["history"].append(
        {
            "revision": child["revision"],
            "parent_ledger_sha256": old_hash,
            "transition_sha256": transition["transition_sha256"],
            "action": copy.deepcopy(transition["action"]),
        }
    )
    child.pop("ledger_sha256", None)
    child["ledger_sha256"] = _hash_without(child, "ledger_sha256")
    return validate_work_ledger(child)


def line_completion(ledger: Mapping[str, Any], line_id: str) -> dict[str, Any]:
    """Derive machine and production completion; never trust stored counters."""

    state = validate_work_ledger(ledger)
    line = _line_by_id(state, line_id)
    blockers: list[str] = []
    if line["registration_status"] != "approved":
        blockers.append(f"registration:{line['registration_status']}")
    for unit in line["visible_units"]:
        if unit["location_status"] != "approved":
            blockers.append(f"location:{unit['id']}:{unit['location_status']}")
    for transcript_id in _unaligned_transcript_ids(line):
        blockers.append(f"transcript_alignment_gap:{transcript_id}")
    for group in line["alignment_groups"]:
        if group["alignment_status"] != "approved":
            blockers.append(f"alignment:{group['id']}:{group['alignment_status']}")
        if group["ownership_status"] != "approved":
            blockers.append(f"ownership:{group['id']}:{group['ownership_status']}")
        if group["envelope_status"] != "pass":
            blockers.append(f"envelope:{group['id']}:{group['envelope_status']}")
    for residual in line["residual_regions"]:
        if residual["status"] not in {"classified", "converted"}:
            blockers.append(f"residual:{residual['id']}:{residual['status']}")
    if line["residual_audit_status"] != "complete":
        blockers.append(f"residual_audit:{line['residual_audit_status']}")
    human = [item for item in state["human_queue"] if item["line_id"] == line_id]
    machine_pending = _line_has_machine_work(line, state)
    return {
        "line_id": line_id,
        "machine_complete": not machine_pending,
        "production_complete": not blockers and not human,
        "human_queue_count": len(human),
        "blockers": blockers,
    }


def page_completion(ledger: Mapping[str, Any]) -> dict[str, Any]:
    """Return distinct machine-pass and production completion states."""

    state = validate_work_ledger(ledger)
    lines = [line_completion(state, line["line_id"]) for line in state["lines"]]
    machine_complete = all(line["machine_complete"] for line in lines)
    production_complete = all(line["production_complete"] for line in lines)
    blockers = [
        f"{line['line_id']}:{blocker}"
        for line in lines
        for blocker in line["blockers"]
    ]
    if production_complete:
        production_status = "production_complete"
    elif machine_complete and state["human_queue"]:
        production_status = "machine_pass_complete_with_human_queue"
    elif machine_complete:
        production_status = "machine_pass_complete_with_review_blockers"
    else:
        production_status = "machine_work_remaining"
    return {
        "machine_complete": machine_complete,
        "production_complete": production_complete,
        "production_status": production_status,
        "human_queue_count": len(state["human_queue"]),
        "blockers": blockers,
    }


def _normalize_line(value: Mapping[str, Any]) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise EnvelopeError("line specification must be an object")
    _exact_keys(value, _LINE_KEYS, "line specification")
    line_id = _nonempty_string(value["line_id"], "line_id")
    reading_order = _nonnegative_int(value["reading_order"], "reading_order")
    directed = _normalize_directed_reading(value["directed_reading"])
    context = _normalize_context(value["context"])
    transcript_units = [
        _normalize_transcript_unit(item)
        for item in _list(value["transcript_units"], "transcript_units")
    ]
    visible_units = [
        _normalize_visible_unit(item)
        for item in _list(value["visible_units"], "visible_units")
    ]
    groups = [
        _normalize_alignment_group(item)
        for item in _list(value["alignment_groups"], "alignment_groups")
    ]
    residual = [
        _normalize_residual(item)
        for item in _list(value["residual_regions"], "residual_regions")
    ]
    if not visible_units and not residual:
        raise EnvelopeError("line must contain a visible unit or residual region")
    _unique_ids(transcript_units, "transcript unit")
    _unique_ids(visible_units, "visible unit")
    _unique_ids(groups, "alignment group")
    _unique_ids(residual, "residual region")
    _unique_orders(transcript_units, "transcript unit")
    _unique_orders(visible_units, "visible unit")
    _unique_orders(groups, "alignment group")
    _unique_orders(residual, "residual region")
    _validate_alignment_partition(transcript_units, visible_units, groups)
    return {
        "line_id": line_id,
        "reading_order": reading_order,
        "directed_reading": directed,
        "context": context,
        "registration_status": "pending",
        "transcript_revision": 0,
        "transcript_units": transcript_units,
        "visible_units": visible_units,
        "alignment_groups": groups,
        "residual_regions": residual,
        "residual_audit_status": "pending",
    }


def _normalize_directed_reading(value: Any) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise EnvelopeError("directed_reading must be an object")
    _exact_keys(value, _DIRECTION_KEYS, "directed_reading")
    forward = _affine(value["source_to_upright_affine"], "source_to_upright_affine")
    inverse = _affine(value["upright_to_source_affine"], "upright_to_source_affine")
    product = _matmul3(forward, inverse)
    identity = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]
    if any(abs(left - right) > 1e-6 for left, right in zip(product, identity)):
        raise EnvelopeError("directed reading transforms are not inverses")
    start = _point(value["start_anchor_source_xy"], "start_anchor_source_xy")
    end = _point(value["end_anchor_source_xy"], "end_anchor_source_xy")
    if start == end:
        raise EnvelopeError("directed reading anchors must be distinct")
    direction = value["upright_direction"]
    if direction not in _UPRIGHT_DIRECTIONS:
        raise EnvelopeError("upright_direction is unsupported")
    basis = {
        "source_to_upright_affine": forward,
        "upright_to_source_affine": inverse,
        "start_anchor_source_xy": start,
        "end_anchor_source_xy": end,
        "upright_direction": direction,
    }
    return {**basis, "directed_reading_sha256": _hash(basis)}


def _normalize_context(value: Any) -> dict[str, str]:
    if not isinstance(value, Mapping):
        raise EnvelopeError("context must be an object")
    _exact_keys(value, _CONTEXT_KEYS, "context")
    result = {key: value[key] for key in sorted(_CONTEXT_KEYS)}
    for key, digest in result.items():
        _sha(digest, f"context.{key}")
    return result


def _normalize_transcript_unit(value: Any) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise EnvelopeError("transcript unit must be an object")
    _exact_keys(value, {"id", "text", "kind", "order"}, "transcript unit")
    text = _nonempty_string(value["text"], "transcript unit text")
    return {
        "id": _nonempty_string(value["id"], "transcript unit id"),
        "source_text": text,
        "text": text,
        "kind": _enum(value["kind"], {"word", "punctuation", "mark"}, "transcript unit kind"),
        "order": _nonnegative_int(value["order"], "transcript unit order"),
    }


def _normalize_visible_unit(value: Any) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise EnvelopeError("visible unit must be an object")
    _exact_keys(value, {"id", "order", "bbox_source_xywh", "proposed_text"}, "visible unit")
    proposed = value["proposed_text"]
    if proposed is not None:
        _nonempty_string(proposed, "visible unit proposed_text")
    return {
        "id": _nonempty_string(value["id"], "visible unit id"),
        "order": _nonnegative_int(value["order"], "visible unit order"),
        "bbox_source_xywh": _box(value["bbox_source_xywh"]),
        "proposed_text": proposed,
        "location_status": "pending",
        "location_evidence_sha256": None,
    }


def _normalize_alignment_group(value: Any) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise EnvelopeError("alignment group must be an object")
    _exact_keys(value, {"id", "order", "transcript_unit_ids", "visible_unit_ids"}, "alignment group")
    transcript_ids = _string_list(value["transcript_unit_ids"], "transcript_unit_ids", allow_empty=True)
    visible_ids = _string_list(value["visible_unit_ids"], "visible_unit_ids")
    return {
        "id": _nonempty_string(value["id"], "alignment group id"),
        "order": _nonnegative_int(value["order"], "alignment group order"),
        "transcript_unit_ids": transcript_ids,
        "visible_unit_ids": visible_ids,
        "alignment_status": "pending",
        "alignment_evidence_sha256": None,
        "ownership_status": "blocked",
        "owned_mask_sha256": None,
        "selection_record_sha256": None,
        "envelope_status": "blocked",
        "envelope_result_sha256": None,
    }


def _normalize_residual(value: Any) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise EnvelopeError("residual region must be an object")
    _exact_keys(
        value,
        {"id", "order", "bbox_source_xywh", "proposed_text", "evidence_sha256"},
        "residual region",
    )
    evidence = value["evidence_sha256"]
    _sha(evidence, "residual evidence_sha256")
    proposed = value["proposed_text"]
    if proposed is not None:
        _nonempty_string(proposed, "residual proposed_text")
    return {
        "id": _nonempty_string(value["id"], "residual id"),
        "order": _nonnegative_int(value["order"], "residual order"),
        "bbox_source_xywh": _box(value["bbox_source_xywh"]),
        "proposed_text": proposed,
        "evidence_sha256": evidence,
        "status": "pending",
        "disposition": None,
        "resolution_evidence_sha256": None,
        "converted_visible_unit_id": None,
        "converted_alignment_group_id": None,
    }


def _validate_normalized_line(line: Any) -> None:
    if not isinstance(line, Mapping):
        raise EnvelopeError("normalized line must be an object")
    required = {
        "line_id", "reading_order", "directed_reading", "context",
        "registration_status", "transcript_revision", "transcript_units",
        "visible_units", "alignment_groups", "residual_regions",
        "residual_audit_status",
    }
    _exact_keys(line, required, "normalized line")
    _nonempty_string(line["line_id"], "line_id")
    _nonnegative_int(line["reading_order"], "reading_order")
    directed = line["directed_reading"]
    if not isinstance(directed, Mapping):
        raise EnvelopeError("normalized directed_reading must be an object")
    _exact_keys(
        directed,
        _DIRECTION_KEYS | {"directed_reading_sha256"},
        "normalized directed_reading",
    )
    normalized_directed = _normalize_directed_reading(
        {key: directed[key] for key in _DIRECTION_KEYS}
    )
    if dict(directed) != normalized_directed:
        raise EnvelopeError("normalized directed_reading is not canonical")
    normalized_context = _normalize_context(line["context"])
    if dict(line["context"]) != normalized_context:
        raise EnvelopeError("normalized context is not canonical")
    _enum(
        line["registration_status"],
        {"pending", "approved", "human_review"},
        "registration_status",
    )
    _enum(
        line["residual_audit_status"],
        {"pending", "complete", "human_review"},
        "residual_audit_status",
    )
    _nonnegative_int(line["transcript_revision"], "transcript_revision")

    transcript_units = _list(line["transcript_units"], "transcript_units")
    visible_units = _list(line["visible_units"], "visible_units")
    groups = _list(line["alignment_groups"], "alignment_groups")
    residual = _list(line["residual_regions"], "residual_regions")
    if not visible_units and not residual:
        raise EnvelopeError("line must contain a visible unit or residual region")

    for unit in transcript_units:
        if not isinstance(unit, Mapping):
            raise EnvelopeError("normalized transcript unit must be an object")
        _exact_keys(unit, {"id", "source_text", "text", "kind", "order"}, "normalized transcript unit")
        _nonempty_string(unit["id"], "transcript unit id")
        _nonempty_string(unit["source_text"], "transcript source_text")
        _nonempty_string(unit["text"], "transcript text")
        _enum(unit["kind"], {"word", "punctuation", "mark"}, "transcript unit kind")
        _nonnegative_int(unit["order"], "transcript unit order")

    for unit in visible_units:
        if not isinstance(unit, Mapping):
            raise EnvelopeError("normalized visible unit must be an object")
        _exact_keys(
            unit,
            {
                "id", "order", "bbox_source_xywh", "proposed_text",
                "location_status", "location_evidence_sha256",
            },
            "normalized visible unit",
        )
        _nonempty_string(unit["id"], "visible unit id")
        _nonnegative_int(unit["order"], "visible unit order")
        _box(unit["bbox_source_xywh"])
        if unit["proposed_text"] is not None:
            _nonempty_string(unit["proposed_text"], "visible unit proposed_text")
        status = _enum(
            unit["location_status"],
            {"pending", "approved", "human_review"},
            "location_status",
        )
        evidence = unit["location_evidence_sha256"]
        if status == "approved":
            _sha(evidence, "location_evidence_sha256")
        elif evidence is not None:
            raise EnvelopeError("non-approved location cannot retain approval evidence")

    for group in groups:
        _validate_normalized_group(group)

    for region in residual:
        _validate_normalized_residual(region)

    _unique_ids(transcript_units, "transcript unit")
    _unique_ids(visible_units, "visible unit")
    _unique_ids(groups, "alignment group")
    _unique_ids(residual, "residual region")
    _unique_orders(transcript_units, "transcript unit")
    _unique_orders(visible_units, "visible unit")
    _unique_orders(groups, "alignment group")
    _unique_orders(residual, "residual region")
    _validate_alignment_partition(transcript_units, visible_units, groups)
    visible_ids = {unit["id"] for unit in visible_units}
    groups_by_id = {group["id"]: group for group in groups}
    for region in residual:
        if region["status"] != "converted":
            continue
        visible_id = region["converted_visible_unit_id"]
        group_id = region["converted_alignment_group_id"]
        if visible_id not in visible_ids or group_id not in groups_by_id:
            raise EnvelopeError("converted residual references missing inserted work")
        if groups_by_id[group_id]["visible_unit_ids"] != [visible_id]:
            raise EnvelopeError("converted residual group does not own its inserted visible unit")

    if line["registration_status"] != "approved":
        if any(unit["location_status"] != "pending" for unit in visible_units):
            raise EnvelopeError("unregistered line cannot contain location decisions")
    if line["registration_status"] != "approved":
        if any(
            group["alignment_status"] != "pending"
            or group["ownership_status"] != "blocked"
            or group["envelope_status"] != "blocked"
            for group in groups
        ):
            raise EnvelopeError("unregistered line cannot contain group decisions")
        if any(region["status"] != "pending" for region in residual):
            raise EnvelopeError("unregistered line cannot contain residual decisions")
        if line["residual_audit_status"] != "pending":
            raise EnvelopeError("unregistered line cannot contain a residual audit")
    for group in groups:
        location_statuses = [
            next(
                unit["location_status"]
                for unit in visible_units
                if unit["id"] == visible_id
            )
            for visible_id in group["visible_unit_ids"]
        ]
        if group["alignment_status"] == "approved" and any(
            status != "approved" for status in location_statuses
        ):
            raise EnvelopeError("approved alignment requires every referenced location approved")
        if group["alignment_status"] == "human_review" and not (
            all(status == "approved" for status in location_statuses)
            or any(status == "human_review" for status in location_statuses)
        ):
            raise EnvelopeError("human-reviewed alignment has an unresolved location dependency")
    if line["residual_audit_status"] == "complete":
        if any(region["status"] == "pending" for region in residual):
            raise EnvelopeError("residual audit cannot complete with pending residuals")


def _validate_normalized_group(group: Any) -> None:
    if not isinstance(group, Mapping):
        raise EnvelopeError("normalized alignment group must be an object")
    _exact_keys(
        group,
        {
            "id", "order", "transcript_unit_ids", "visible_unit_ids",
            "alignment_status", "alignment_evidence_sha256",
            "ownership_status", "owned_mask_sha256", "selection_record_sha256",
            "envelope_status", "envelope_result_sha256",
        },
        "normalized alignment group",
    )
    _nonempty_string(group["id"], "alignment group id")
    _nonnegative_int(group["order"], "alignment group order")
    _string_list(group["transcript_unit_ids"], "transcript_unit_ids", allow_empty=True)
    _string_list(group["visible_unit_ids"], "visible_unit_ids")
    alignment = _enum(
        group["alignment_status"],
        {"pending", "approved", "human_review"},
        "alignment_status",
    )
    ownership = _enum(
        group["ownership_status"],
        {"blocked", "pending", "approved", "human_review"},
        "ownership_status",
    )
    envelope = _enum(
        group["envelope_status"],
        {"blocked", "pending", "pass", "box_only_failure", "human_review"},
        "envelope_status",
    )
    alignment_evidence = group["alignment_evidence_sha256"]
    if alignment == "approved":
        _sha(alignment_evidence, "alignment_evidence_sha256")
    elif alignment_evidence is not None:
        raise EnvelopeError("non-approved alignment cannot retain approval evidence")
    owned_mask = group["owned_mask_sha256"]
    selection = group["selection_record_sha256"]
    if ownership == "approved":
        if alignment != "approved":
            raise EnvelopeError("ownership approval requires approved alignment")
        _sha(owned_mask, "owned_mask_sha256")
        _sha(selection, "selection_record_sha256")
    elif owned_mask is not None or selection is not None:
        raise EnvelopeError("non-approved ownership cannot retain owned-mask evidence")
    if alignment == "pending" and ownership != "blocked":
        raise EnvelopeError("pending alignment requires blocked ownership")
    if alignment == "human_review" and ownership != "human_review":
        raise EnvelopeError("human-reviewed alignment requires human-reviewed ownership")
    if ownership in {"blocked", "pending"} and envelope != "blocked":
        raise EnvelopeError("unapproved ownership requires blocked envelope")
    if ownership == "human_review" and envelope != "human_review":
        raise EnvelopeError("human-reviewed ownership requires human-reviewed envelope")
    result = group["envelope_result_sha256"]
    if envelope in {"pass", "box_only_failure"}:
        if ownership != "approved":
            raise EnvelopeError("envelope result requires approved ownership")
        _sha(result, "envelope_result_sha256")
    elif result is not None:
        raise EnvelopeError("unfinished envelope cannot retain a result hash")


def _validate_normalized_residual(region: Any) -> None:
    if not isinstance(region, Mapping):
        raise EnvelopeError("normalized residual region must be an object")
    _exact_keys(
        region,
        {
            "id", "order", "bbox_source_xywh", "proposed_text",
            "evidence_sha256", "status", "disposition",
            "resolution_evidence_sha256", "converted_visible_unit_id",
            "converted_alignment_group_id",
        },
        "normalized residual region",
    )
    _nonempty_string(region["id"], "residual id")
    _nonnegative_int(region["order"], "residual order")
    _box(region["bbox_source_xywh"])
    if region["proposed_text"] is not None:
        _nonempty_string(region["proposed_text"], "residual proposed_text")
    _sha(region["evidence_sha256"], "residual evidence_sha256")
    status = _enum(
        region["status"],
        {"pending", "classified", "converted", "human_review"},
        "residual status",
    )
    disposition = region["disposition"]
    resolution = region["resolution_evidence_sha256"]
    if status == "classified":
        _enum(disposition, _RESIDUAL_DISPOSITIONS, "residual disposition")
        _sha(resolution, "residual resolution_evidence_sha256")
    elif status == "converted":
        if disposition != "visible_unit":
            raise EnvelopeError("converted residual must have visible_unit disposition")
        _sha(resolution, "residual resolution_evidence_sha256")
        _nonempty_string(region["converted_visible_unit_id"], "converted_visible_unit_id")
        _nonempty_string(region["converted_alignment_group_id"], "converted_alignment_group_id")
    elif disposition is not None or resolution is not None:
        raise EnvelopeError("unresolved residual cannot retain resolution evidence")
    if status != "converted" and (
        region["converted_visible_unit_id"] is not None
        or region["converted_alignment_group_id"] is not None
    ):
        raise EnvelopeError("non-converted residual cannot retain converted-work links")


def _find_current(state: dict[str, Any]) -> tuple[dict[str, Any], str, dict[str, Any] | None] | None:
    for line in sorted(state["lines"], key=lambda item: (item["reading_order"], item["line_id"])):
        if line["registration_status"] == "pending":
            return line, "line_registration", None
        if line["registration_status"] == "human_review":
            continue
        for unit in sorted(line["visible_units"], key=lambda item: (item["order"], item["id"])):
            if unit["location_status"] == "pending":
                return line, "location", unit
        for unit in sorted(line["transcript_units"], key=lambda item: (item["order"], item["id"])):
            if (
                unit["id"] in _unaligned_transcript_ids(line)
                and not _is_human_queued(
                    state, line["line_id"], "alignment_gap", unit["id"]
                )
            ):
                return line, "alignment_gap", unit
        for group in sorted(line["alignment_groups"], key=lambda item: (item["order"], item["id"])):
            if group["alignment_status"] == "pending":
                return line, "alignment", group
        for group in sorted(line["alignment_groups"], key=lambda item: (item["order"], item["id"])):
            if group["alignment_status"] == "approved" and group["ownership_status"] in {"blocked", "pending"}:
                return line, "ownership", group
        for residual in sorted(line["residual_regions"], key=lambda item: (item["order"], item["id"])):
            if residual["status"] == "pending":
                return line, "residual", residual
        if line["residual_audit_status"] == "pending":
            return line, "residual_audit", None
        if _line_ready_for_envelope(line):
            for group in sorted(line["alignment_groups"], key=lambda item: (item["order"], item["id"])):
                if group["ownership_status"] == "approved" and group["envelope_status"] in {"blocked", "pending"}:
                    return line, "envelope", group
    return None


def _work_packet(state: dict[str, Any], line: dict[str, Any], stage: str, item: dict[str, Any] | None, completion: dict[str, Any]) -> dict[str, Any]:
    item_id = item["id"] if item else line["line_id"]
    specs = {
        "line_registration": (
            "Confirm the directed upright line before any word work.",
            "Review the upright line, its source locator, and explicit start-to-end reading anchors.",
            ["approve_line_registration", "escalate_human"],
            "The directed reading transform is approved or routed to a human.",
        ),
        "location": (
            "Confirm one visible unit location without deciding ink ownership.",
            "Check the complete visible unit in upright line context; do not run the envelope.",
            ["confirm_location", "escalate_human"],
            "The visual location is approved or routed to a human.",
        ),
        "alignment": (
            "Bind visible ink units to transcript units without forcing one-to-one alignment.",
            "Accept the group, reject a wrong transcript label, or escalate. Do not change ownership.",
            ["accept_alignment_group", "reject_transcript", "escalate_human"],
            "The alignment group is approved or routed to a human.",
        ),
        "alignment_gap": (
            "Resolve one transcript unit that has no visible-ink alignment.",
            "Locate and insert its visible unit, or route the gap to a human. Do not invent an empty box.",
            ["insert_visible_unit", "escalate_human"],
            "The missing visual alignment is created or explicitly human-routed.",
        ),
        "ownership": (
            "Commit the exact owned-ink result produced by the bounded ownership tools.",
            "Use the selection/cut/version workflow, then commit its hashes or escalate.",
            ["approve_ownership", "escalate_human"],
            "Owned ink is approved or routed to a human; envelope work remains blocked until then.",
        ),
        "residual": (
            "Explain one remaining ink region so omitted words cannot disappear.",
            "Classify it, convert it into a visible unit, or escalate. Never silently ignore it.",
            ["classify_residual", "insert_visible_unit", "escalate_human"],
            "The residual has a terminal, evidence-bound disposition.",
        ),
        "residual_audit": (
            "Certify that the line has no unexplained relevant ink.",
            "Complete the audit, add a newly discovered visible unit, or escalate.",
            ["complete_residual_audit", "insert_visible_unit", "escalate_human"],
            "The residual audit is complete or routed to a human.",
        ),
        "envelope": (
            "Record deterministic envelope output after approved ownership.",
            "Run geometry only on the approved owned mask and record pass or box-only failure.",
            ["record_envelope", "escalate_human"],
            "Envelope outcome is recorded; failure creates human review without discarding the box.",
        ),
    }
    goal, instruction, actions, done = specs[stage]
    line_context = _line_work_context(line)
    return {
        "schema_version": WORK_ITEM_SCHEMA_VERSION,
        "ledger_binding": _ledger_binding(state),
        "current": {
            "stage": stage,
            "line_id": line["line_id"],
            "item_id": item_id,
            "item_kind": "line" if item is None else (
                "visible_unit" if stage == "location" else
                "transcript_unit" if stage == "alignment_gap" else
                "alignment_group" if stage in {"alignment", "ownership", "envelope"} else
                "residual_region"
            ),
        },
        "goal": goal,
        "instruction": instruction,
        "legal_actions": actions,
        "legal_action_contracts": {
            action: copy.deepcopy(_ACTION_PAYLOAD_CONTRACTS[action])
            for action in actions
        },
        "action_routes": {action: _ACTION_ROUTES[action] for action in actions},
        "required_evidence": {
            **line["context"],
            "directed_reading_sha256": line["directed_reading"]["directed_reading_sha256"],
            "transcript_revision": line["transcript_revision"],
            "line_context_sha256": _hash(line_context),
            **(
                {"current_item_evidence_sha256": item["evidence_sha256"]}
                if item is not None and "evidence_sha256" in item
                else {}
            ),
        },
        "line_context": line_context,
        "done_condition": done,
        "blockers": completion["blockers"],
        "progress": _progress(state),
    }


def _validate_compact_action(action: Mapping[str, Any], packet: dict[str, Any], state: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(action, Mapping):
        raise EnvelopeError("compact action must be an object")
    _exact_keys(action, {"type", "line_id", "item_id", "payload"}, "compact action")
    action_type = action["type"]
    if action_type not in packet["legal_actions"]:
        raise EnvelopeError(f"action {action_type!r} is illegal for stage {packet['current']['stage']}")
    if action["line_id"] != packet["current"]["line_id"] or action["item_id"] != packet["current"]["item_id"]:
        raise EnvelopeError("action targets a non-current line or item")
    if not isinstance(action["payload"], Mapping):
        raise EnvelopeError("action payload must be an object")
    payload = copy.deepcopy(dict(action["payload"]))
    line = _line_by_id(state, action["line_id"])
    _validate_payload(
        action_type,
        payload,
        line,
        action["item_id"],
        packet["current"]["stage"],
    )
    return {"type": action_type, "line_id": action["line_id"], "item_id": action["item_id"], "payload": payload}


def _validate_payload(
    action_type: str,
    payload: dict[str, Any],
    line: dict[str, Any],
    item_id: str,
    stage: str,
) -> None:
    if action_type == "approve_line_registration":
        _exact_keys(payload, {"directed_reading_sha256"}, "approve_line_registration payload")
        if payload["directed_reading_sha256"] != line["directed_reading"]["directed_reading_sha256"]:
            raise EnvelopeError("directed reading hash does not match current line")
    elif action_type == "confirm_location":
        _exact_keys(payload, {"evidence_sha256"}, "confirm_location payload")
        _sha(payload["evidence_sha256"], "evidence_sha256")
    elif action_type == "accept_alignment_group":
        _exact_keys(payload, {"evidence_sha256"}, "accept_alignment_group payload")
        _sha(payload["evidence_sha256"], "evidence_sha256")
    elif action_type == "reject_transcript":
        _exact_keys(payload, {"transcript_unit_id", "replacement_text", "evidence_sha256"}, "reject_transcript payload")
        replacement = _nonempty_string(payload["replacement_text"], "replacement_text")
        if any(character.isspace() for character in replacement):
            raise EnvelopeError("replacement_text must remain one transcript unit")
        _sha(payload["evidence_sha256"], "evidence_sha256")
        group = _group_by_id(line, item_id)
        if payload["transcript_unit_id"] not in group["transcript_unit_ids"]:
            raise EnvelopeError("rejected transcript unit is not in the current group")
    elif action_type == "approve_ownership":
        _exact_keys(payload, {"owned_mask_sha256", "selection_record_sha256"}, "approve_ownership payload")
        _sha(payload["owned_mask_sha256"], "owned_mask_sha256")
        _sha(payload["selection_record_sha256"], "selection_record_sha256")
    elif action_type == "classify_residual":
        _exact_keys(payload, {"disposition", "evidence_sha256"}, "classify_residual payload")
        _enum(payload["disposition"], _RESIDUAL_DISPOSITIONS, "residual disposition")
        _sha(payload["evidence_sha256"], "evidence_sha256")
    elif action_type == "insert_visible_unit":
        _exact_keys(payload, {"visible_unit", "alignment_group", "evidence_sha256"}, "insert_visible_unit payload")
        _sha(payload["evidence_sha256"], "evidence_sha256")
        unit = _normalize_visible_unit(payload["visible_unit"])
        group = _normalize_alignment_group(payload["alignment_group"])
        if group["visible_unit_ids"] != [unit["id"]]:
            raise EnvelopeError("inserted alignment group must target only the inserted visible unit")
        transcript_ids = {item["id"] for item in line["transcript_units"]}
        if not set(group["transcript_unit_ids"]).issubset(transcript_ids):
            raise EnvelopeError("inserted alignment group references missing transcript units")
        if any(existing["id"] == unit["id"] for existing in line["visible_units"]):
            raise EnvelopeError("inserted visible unit ID already exists")
        if any(existing["id"] == group["id"] for existing in line["alignment_groups"]):
            raise EnvelopeError("inserted alignment group ID already exists")
        if any(existing["order"] == unit["order"] for existing in line["visible_units"]):
            raise EnvelopeError("inserted visible unit order already exists")
        if any(existing["order"] == group["order"] for existing in line["alignment_groups"]):
            raise EnvelopeError("inserted alignment group order already exists")
        if stage == "alignment_gap":
            if group["transcript_unit_ids"] != [item_id]:
                raise EnvelopeError("alignment-gap insertion must target only the current transcript unit")
        elif group["transcript_unit_ids"]:
            raise EnvelopeError("residual insertion cannot reuse an aligned transcript unit")
        if stage == "residual":
            residual = _residual_by_id(line, item_id)
            if not _box_contains(unit["bbox_source_xywh"], residual["bbox_source_xywh"]):
                raise EnvelopeError("inserted visible unit must contain the current residual box")
        prospective_visible = [*line["visible_units"], unit]
        prospective_groups = [*line["alignment_groups"], group]
        _validate_alignment_partition(
            line["transcript_units"], prospective_visible, prospective_groups
        )
    elif action_type == "complete_residual_audit":
        _exact_keys(payload, {"evidence_sha256"}, "complete_residual_audit payload")
        _sha(payload["evidence_sha256"], "evidence_sha256")
    elif action_type == "record_envelope":
        _exact_keys(payload, {"outcome", "result_sha256"}, "record_envelope payload")
        _enum(payload["outcome"], {"pass", "box_only_failure"}, "envelope outcome")
        _sha(payload["result_sha256"], "result_sha256")
    elif action_type == "escalate_human":
        _exact_keys(payload, {"reason", "evidence_sha256"}, "escalate_human payload")
        _enum(payload["reason"], _HUMAN_REASONS, "human reason")
        _sha(payload["evidence_sha256"], "evidence_sha256")
    else:
        raise EnvelopeError("unsupported compact action")


def _mutate_for_action(child: dict[str, Any], packet: dict[str, Any], action: dict[str, Any]) -> None:
    line = _line_by_id(child, action["line_id"])
    stage = packet["current"]["stage"]
    item_id = action["item_id"]
    kind = action["type"]
    payload = action["payload"]
    if kind == "approve_line_registration":
        line["registration_status"] = "approved"
    elif kind == "confirm_location":
        unit = _visible_by_id(line, item_id)
        unit["location_status"] = "approved"
        unit["location_evidence_sha256"] = payload["evidence_sha256"]
    elif kind == "accept_alignment_group":
        group = _group_by_id(line, item_id)
        group["alignment_status"] = "approved"
        group["alignment_evidence_sha256"] = payload["evidence_sha256"]
        group["ownership_status"] = "pending"
    elif kind == "reject_transcript":
        transcript = next(item for item in line["transcript_units"] if item["id"] == payload["transcript_unit_id"])
        transcript["text"] = payload["replacement_text"]
        line["transcript_revision"] += 1
        current_order = _group_by_id(line, item_id)["order"]
        for group in line["alignment_groups"]:
            if group["order"] >= current_order:
                group["alignment_status"] = "pending"
                group["alignment_evidence_sha256"] = None
                group["ownership_status"] = "blocked"
                group["owned_mask_sha256"] = None
                group["selection_record_sha256"] = None
                group["envelope_status"] = "blocked"
                group["envelope_result_sha256"] = None
        line["residual_audit_status"] = "pending"
    elif kind == "approve_ownership":
        for other_line in child["lines"]:
            for other in other_line["alignment_groups"]:
                if other["ownership_status"] == "approved" and other["owned_mask_sha256"] == payload["owned_mask_sha256"]:
                    raise EnvelopeError("owned mask is already committed to another alignment group")
        group = _group_by_id(line, item_id)
        group["ownership_status"] = "approved"
        group["owned_mask_sha256"] = payload["owned_mask_sha256"]
        group["selection_record_sha256"] = payload["selection_record_sha256"]
        group["envelope_status"] = "pending"
    elif kind == "classify_residual":
        residual = _residual_by_id(line, item_id)
        residual["status"] = "classified"
        residual["disposition"] = payload["disposition"]
        residual["resolution_evidence_sha256"] = payload["evidence_sha256"]
    elif kind == "insert_visible_unit":
        unit = _normalize_visible_unit(payload["visible_unit"])
        group = _normalize_alignment_group(payload["alignment_group"])
        if any(existing["id"] == unit["id"] for existing in line["visible_units"]):
            raise EnvelopeError("inserted visible unit ID already exists")
        if any(existing["id"] == group["id"] for existing in line["alignment_groups"]):
            raise EnvelopeError("inserted alignment group ID already exists")
        line["visible_units"].append(unit)
        line["alignment_groups"].append(group)
        line["visible_units"].sort(key=lambda value: (value["order"], value["id"]))
        line["alignment_groups"].sort(key=lambda value: (value["order"], value["id"]))
        if stage == "residual":
            residual = _residual_by_id(line, item_id)
            residual["status"] = "converted"
            residual["disposition"] = "visible_unit"
            residual["resolution_evidence_sha256"] = payload["evidence_sha256"]
            residual["converted_visible_unit_id"] = unit["id"]
            residual["converted_alignment_group_id"] = group["id"]
        line["residual_audit_status"] = "pending"
    elif kind == "complete_residual_audit":
        line["residual_audit_status"] = "complete"
    elif kind == "record_envelope":
        group = _group_by_id(line, item_id)
        group["envelope_status"] = payload["outcome"]
        group["envelope_result_sha256"] = payload["result_sha256"]
        if payload["outcome"] == "box_only_failure":
            _queue_human(child, line["line_id"], stage, item_id, "envelope_failure", payload["result_sha256"])
    elif kind == "escalate_human":
        if stage == "line_registration":
            line["registration_status"] = "human_review"
        elif stage == "location":
            _visible_by_id(line, item_id)["location_status"] = "human_review"
            for group in line["alignment_groups"]:
                if item_id in group["visible_unit_ids"]:
                    group["alignment_status"] = "human_review"
                    group["alignment_evidence_sha256"] = None
                    group["ownership_status"] = "human_review"
                    group["owned_mask_sha256"] = None
                    group["selection_record_sha256"] = None
                    group["envelope_status"] = "human_review"
                    group["envelope_result_sha256"] = None
        elif stage == "alignment":
            group = _group_by_id(line, item_id)
            group["alignment_status"] = "human_review"
            group["ownership_status"] = "human_review"
            group["envelope_status"] = "human_review"
        elif stage == "ownership":
            group = _group_by_id(line, item_id)
            group["ownership_status"] = "human_review"
            group["envelope_status"] = "human_review"
        elif stage == "residual":
            _residual_by_id(line, item_id)["status"] = "human_review"
        elif stage == "residual_audit":
            line["residual_audit_status"] = "human_review"
        elif stage == "envelope":
            _group_by_id(line, item_id)["envelope_status"] = "human_review"
        _queue_human(child, line["line_id"], stage, item_id, payload["reason"], payload["evidence_sha256"])


def _queue_human(state: dict[str, Any], line_id: str, stage: str, item_id: str, reason: str, evidence: str) -> None:
    queue_id = f"human:{line_id}:{stage}:{item_id}"
    if any(item["queue_id"] == queue_id for item in state["human_queue"]):
        raise EnvelopeError("human queue item already exists")
    state["human_queue"].append({
        "queue_id": queue_id,
        "line_id": line_id,
        "stage": stage,
        "item_id": item_id,
        "reason": reason,
        "evidence_sha256": evidence,
        "status": "pending",
    })


def _line_has_machine_work(line: dict[str, Any], state: dict[str, Any]) -> bool:
    if line["registration_status"] == "pending":
        return True
    if line["registration_status"] == "human_review":
        return False
    if any(unit["location_status"] == "pending" for unit in line["visible_units"]):
        return True
    if any(
        not _is_human_queued(state, line["line_id"], "alignment_gap", unit_id)
        for unit_id in _unaligned_transcript_ids(line)
    ):
        return True
    if any(group["alignment_status"] == "pending" for group in line["alignment_groups"]):
        return True
    if any(group["alignment_status"] == "approved" and group["ownership_status"] in {"blocked", "pending"} for group in line["alignment_groups"]):
        return True
    if any(region["status"] == "pending" for region in line["residual_regions"]):
        return True
    if line["residual_audit_status"] == "pending":
        return True
    if not _line_ready_for_envelope(line):
        return False
    return any(group["ownership_status"] == "approved" and group["envelope_status"] in {"blocked", "pending"} for group in line["alignment_groups"])


def _line_ready_for_envelope(line: dict[str, Any]) -> bool:
    return (
        line["registration_status"] == "approved"
        and all(unit["location_status"] == "approved" for unit in line["visible_units"])
        and not _unaligned_transcript_ids(line)
        and all(
            group["alignment_status"] == "approved"
            and group["ownership_status"] == "approved"
            for group in line["alignment_groups"]
        )
        and all(
            region["status"] in {"classified", "converted"}
            for region in line["residual_regions"]
        )
        and line["residual_audit_status"] == "complete"
    )


def _line_work_context(line: dict[str, Any]) -> dict[str, Any]:
    """Return the exact semantic inventory the model needs for one decision."""

    return copy.deepcopy(
        {
            "line_id": line["line_id"],
            "reading_order": line["reading_order"],
            "directed_reading": line["directed_reading"],
            "transcript_revision": line["transcript_revision"],
            "transcript_units": line["transcript_units"],
            "unaligned_transcript_unit_ids": _unaligned_transcript_ids(line),
            "visible_units": line["visible_units"],
            "alignment_groups": line["alignment_groups"],
            "residual_regions": line["residual_regions"],
            "residual_audit_status": line["residual_audit_status"],
        }
    )


def _progress(state: dict[str, Any]) -> dict[str, Any]:
    counts: Counter[str] = Counter()
    for line in state["lines"]:
        counts[f"registration:{line['registration_status']}"] += 1
        counts.update(f"location:{item['location_status']}" for item in line["visible_units"])
        counts.update(f"alignment:{item['alignment_status']}" for item in line["alignment_groups"])
        counts.update(f"ownership:{item['ownership_status']}" for item in line["alignment_groups"])
        counts.update(f"envelope:{item['envelope_status']}" for item in line["alignment_groups"])
        counts.update(f"residual:{item['status']}" for item in line["residual_regions"])
        counts[f"residual_audit:{line['residual_audit_status']}"] += 1
    return {"derived_counts": dict(sorted(counts.items())), "human_queue_count": len(state["human_queue"])}


def _ledger_binding(state: dict[str, Any]) -> dict[str, Any]:
    return {"page_id": state["page_id"], "revision": state["revision"], "ledger_sha256": state["ledger_sha256"]}


def _unaligned_transcript_ids(line: Mapping[str, Any]) -> list[str]:
    claimed = {
        identifier
        for group in line["alignment_groups"]
        for identifier in group["transcript_unit_ids"]
    }
    return [
        unit["id"]
        for unit in sorted(
            line["transcript_units"], key=lambda item: (item["order"], item["id"])
        )
        if unit["id"] not in claimed
    ]


def _is_human_queued(
    state: Mapping[str, Any], line_id: str, stage: str, item_id: str
) -> bool:
    return any(
        item["line_id"] == line_id
        and item["stage"] == stage
        and item["item_id"] == item_id
        and item["status"] == "pending"
        for item in state["human_queue"]
    )


def _line_by_id(state: dict[str, Any], line_id: str) -> dict[str, Any]:
    for line in state["lines"]:
        if line["line_id"] == line_id:
            return line
    raise EnvelopeError(f"missing line {line_id}")


def _visible_by_id(line: dict[str, Any], item_id: str) -> dict[str, Any]:
    for item in line["visible_units"]:
        if item["id"] == item_id:
            return item
    raise EnvelopeError(f"missing visible unit {item_id}")


def _group_by_id(line: dict[str, Any], item_id: str) -> dict[str, Any]:
    for item in line["alignment_groups"]:
        if item["id"] == item_id:
            return item
    raise EnvelopeError(f"missing alignment group {item_id}")


def _residual_by_id(line: dict[str, Any], item_id: str) -> dict[str, Any]:
    for item in line["residual_regions"]:
        if item["id"] == item_id:
            return item
    raise EnvelopeError(f"missing residual region {item_id}")


def _hash(value: Any) -> str:
    return hashlib.sha256(canonical_json_bytes(value)).hexdigest()


def _hash_without(value: Mapping[str, Any], key: str) -> str:
    basis = copy.deepcopy(dict(value))
    basis.pop(key, None)
    return _hash(basis)


def _unique_ids(
    items: Sequence[Mapping[str, Any]], name: str, *, key: str = "id"
) -> None:
    ids = [item[key] for item in items]
    if len(ids) != len(set(ids)):
        raise EnvelopeError(f"{name} IDs must be unique")


def _unique_orders(
    items: Sequence[Mapping[str, Any]], name: str, *, key: str = "order"
) -> None:
    orders = [item[key] for item in items]
    if len(orders) != len(set(orders)):
        raise EnvelopeError(f"{name} {key} values must be unique")


def _validate_alignment_partition(
    transcript_units: Sequence[Mapping[str, Any]],
    visible_units: Sequence[Mapping[str, Any]],
    groups: Sequence[Mapping[str, Any]],
) -> None:
    """Require exact visible coverage and non-duplicated transcript claims.

    A group may be one-to-one, split, merge, many-to-many, or unmatched-visible
    (zero transcript IDs). Separate groups may not silently reuse the same unit.
    An unclaimed transcript unit remains explicit `alignment_gap` work.
    """

    transcript_ids = {item["id"] for item in transcript_units}
    visible_ids = {item["id"] for item in visible_units}
    transcript_claims: Counter[str] = Counter()
    visible_claims: Counter[str] = Counter()
    for group in groups:
        for identifier in group["transcript_unit_ids"]:
            if identifier not in transcript_ids:
                raise EnvelopeError(
                    f"alignment group {group['id']} references missing transcript unit {identifier}"
                )
            transcript_claims[identifier] += 1
        for identifier in group["visible_unit_ids"]:
            if identifier not in visible_ids:
                raise EnvelopeError(
                    f"alignment group {group['id']} references missing visible unit {identifier}"
                )
            visible_claims[identifier] += 1
    duplicate_transcript = sorted(
        identifier for identifier, count in transcript_claims.items() if count > 1
    )
    missing_visible = sorted(
        identifier for identifier in visible_ids if visible_claims[identifier] == 0
    )
    duplicate_visible = sorted(
        identifier for identifier, count in visible_claims.items() if count > 1
    )
    if duplicate_transcript or missing_visible or duplicate_visible:
        raise EnvelopeError(
            "alignment groups must partition visible units and may claim each transcript unit at most once; "
            f"duplicate_transcript={duplicate_transcript}, "
            f"missing_visible={missing_visible}, duplicate_visible={duplicate_visible}"
        )


def _validate_human_queue(
    queue: Sequence[Any], lines: Sequence[Mapping[str, Any]]
) -> None:
    line_map = {line["line_id"]: line for line in lines}
    queue_keys: set[tuple[str, str, str]] = set()
    queue_ids: set[str] = set()
    valid_stages = {
        "line_registration", "location", "alignment_gap", "alignment",
        "ownership", "residual", "residual_audit", "envelope",
    }
    for item in queue:
        if not isinstance(item, Mapping):
            raise EnvelopeError("human queue item must be an object")
        _exact_keys(
            item,
            {
                "queue_id", "line_id", "stage", "item_id", "reason",
                "evidence_sha256", "status",
            },
            "human queue item",
        )
        queue_id = _nonempty_string(item["queue_id"], "human queue_id")
        if queue_id in queue_ids:
            raise EnvelopeError("human queue IDs must be unique")
        queue_ids.add(queue_id)
        line_id = _nonempty_string(item["line_id"], "human queue line_id")
        if line_id not in line_map:
            raise EnvelopeError("human queue references a missing line")
        stage = _enum(item["stage"], valid_stages, "human queue stage")
        item_id = _nonempty_string(item["item_id"], "human queue item_id")
        if queue_id != f"human:{line_id}:{stage}:{item_id}":
            raise EnvelopeError("human queue_id does not match its target")
        _enum(item["reason"], _HUMAN_REASONS, "human queue reason")
        _sha(item["evidence_sha256"], "human queue evidence_sha256")
        if item["status"] != "pending":
            raise EnvelopeError("v1 human queue status must be pending")
        line = line_map[line_id]
        if stage in {"line_registration", "residual_audit"}:
            if item_id != line_id:
                raise EnvelopeError("line-level human queue item must target its line ID")
            target_status = (
                line["registration_status"]
                if stage == "line_registration"
                else line["residual_audit_status"]
            )
            if target_status != "human_review":
                raise EnvelopeError("human queue target is not in human review")
        elif stage == "location":
            if _visible_by_id(dict(line), item_id)["location_status"] != "human_review":
                raise EnvelopeError("location human queue target is not in human review")
        elif stage == "alignment_gap":
            if item_id not in _unaligned_transcript_ids(dict(line)):
                raise EnvelopeError("alignment-gap queue target is no longer unaligned")
        elif stage in {"alignment", "ownership", "envelope"}:
            group = _group_by_id(dict(line), item_id)
            status_key = f"{stage}_status"
            valid_status = group[status_key] == "human_review"
            if stage == "envelope":
                valid_status = valid_status or group[status_key] == "box_only_failure"
            if not valid_status:
                raise EnvelopeError("group human queue target is not in human review")
        else:
            if _residual_by_id(dict(line), item_id)["status"] != "human_review":
                raise EnvelopeError("residual human queue target is not in human review")
        queue_keys.add((line_id, stage, item_id))

    for line in lines:
        line_id = line["line_id"]
        if line["registration_status"] == "human_review" and (
            line_id, "line_registration", line_id
        ) not in queue_keys:
            raise EnvelopeError("human-reviewed line registration is missing its queue item")
        for unit in line["visible_units"]:
            if unit["location_status"] == "human_review" and (
                line_id, "location", unit["id"]
            ) not in queue_keys:
                raise EnvelopeError("human-reviewed location is missing its queue item")
        for group in line["alignment_groups"]:
            upstream_location_human = any(
                (line_id, "location", visible_id) in queue_keys
                for visible_id in group["visible_unit_ids"]
            )
            if group["alignment_status"] == "human_review" and not (
                upstream_location_human
                or (line_id, "alignment", group["id"]) in queue_keys
            ):
                raise EnvelopeError("human-reviewed alignment is missing its queue item")
            if (
                group["ownership_status"] == "human_review"
                and group["alignment_status"] != "human_review"
                and (line_id, "ownership", group["id"]) not in queue_keys
            ):
                raise EnvelopeError("human-reviewed ownership is missing its queue item")
            if (
                group["envelope_status"] == "human_review"
                and group["ownership_status"] != "human_review"
                and (line_id, "envelope", group["id"]) not in queue_keys
            ):
                raise EnvelopeError("human-reviewed envelope is missing its queue item")
            if group["envelope_status"] == "box_only_failure" and (
                line_id, "envelope", group["id"]
            ) not in queue_keys:
                raise EnvelopeError("box-only envelope failure is missing its queue item")
        for region in line["residual_regions"]:
            if region["status"] == "human_review" and (
                line_id, "residual", region["id"]
            ) not in queue_keys:
                raise EnvelopeError("human-reviewed residual is missing its queue item")
        if line["residual_audit_status"] == "human_review" and (
            line_id, "residual_audit", line_id
        ) not in queue_keys:
            raise EnvelopeError("human-reviewed residual audit is missing its queue item")


def _validate_causal_state(
    lines: Sequence[Mapping[str, Any]], queue: Sequence[Mapping[str, Any]]
) -> None:
    queued_keys = {
        (item["line_id"], item["stage"], item["item_id"]) for item in queue
    }
    for line in lines:
        line_id = line["line_id"]
        unqueued_gaps = [
            unit_id
            for unit_id in _unaligned_transcript_ids(line)
            if (line_id, "alignment_gap", unit_id) not in queued_keys
        ]
        all_alignment_terminal = all(
            group["alignment_status"] in {"approved", "human_review"}
            for group in line["alignment_groups"]
        )
        all_locations_terminal = all(
            unit["location_status"] in {"approved", "human_review"}
            for unit in line["visible_units"]
        )
        semantic_ownership_terminal = (
            all_locations_terminal
            and all_alignment_terminal
            and not unqueued_gaps
            and all(
                group["ownership_status"] in {"approved", "human_review"}
                for group in line["alignment_groups"]
            )
        )
        if (
            any(
                region["status"] in {"classified", "human_review"}
                for region in line["residual_regions"]
            )
            or line["residual_audit_status"] != "pending"
        ) and not semantic_ownership_terminal:
            raise EnvelopeError(
                "residual decisions cannot precede terminal semantic ownership"
            )
        for group in line["alignment_groups"]:
            if group["envelope_status"] in {"pass", "box_only_failure"} and not _line_ready_for_envelope(dict(line)):
                raise EnvelopeError(
                    "envelope result cannot precede all line semantic gates"
                )


def _validate_history(
    history: Sequence[Any],
    parent_sha256: Any,
    lines: Sequence[Mapping[str, Any]],
) -> None:
    if not history:
        if parent_sha256 is not None:
            raise EnvelopeError("revision-zero ledger cannot have a parent hash")
        return
    _sha(parent_sha256, "parent_ledger_sha256")
    line_ids = {line["line_id"] for line in lines}
    for expected_revision, event in enumerate(history, start=1):
        if not isinstance(event, Mapping):
            raise EnvelopeError("history event must be an object")
        _exact_keys(
            event,
            {"revision", "parent_ledger_sha256", "transition_sha256", "action"},
            "history event",
        )
        if event["revision"] != expected_revision:
            raise EnvelopeError("history revisions must be contiguous")
        _sha(event["parent_ledger_sha256"], "history parent_ledger_sha256")
        _sha(event["transition_sha256"], "history transition_sha256")
        action = event["action"]
        if not isinstance(action, Mapping):
            raise EnvelopeError("history action must be an object")
        _exact_keys(action, {"type", "line_id", "item_id", "payload"}, "history action")
        if action["type"] not in WORK_ACTION_TYPES:
            raise EnvelopeError("history action type is unsupported")
        _nonempty_string(action["line_id"], "history action line_id")
        if action["line_id"] not in line_ids:
            raise EnvelopeError("history action references a missing line")
        _nonempty_string(action["item_id"], "history action item_id")
        if not isinstance(action["payload"], Mapping):
            raise EnvelopeError("history action payload must be an object")
    if history[-1]["parent_ledger_sha256"] != parent_sha256:
        raise EnvelopeError("current parent hash does not match latest history event")


def _validate_transcript_replay(
    lines: Sequence[Mapping[str, Any]], history: Sequence[Mapping[str, Any]]
) -> None:
    replay = {
        line["line_id"]: {
            unit["id"]: unit["source_text"] for unit in line["transcript_units"]
        }
        for line in lines
    }
    revision_counts: Counter[str] = Counter()
    for event in history:
        action = event["action"]
        if action["type"] != "reject_transcript":
            continue
        payload = action["payload"]
        _exact_keys(
            payload,
            {"transcript_unit_id", "replacement_text", "evidence_sha256"},
            "reject_transcript history payload",
        )
        line_id = action["line_id"]
        transcript_id = _nonempty_string(
            payload["transcript_unit_id"], "history transcript_unit_id"
        )
        if transcript_id not in replay[line_id]:
            raise EnvelopeError("transcript history references a missing unit")
        replacement = _nonempty_string(
            payload["replacement_text"], "history replacement_text"
        )
        if any(character.isspace() for character in replacement):
            raise EnvelopeError("history replacement_text must remain one transcript unit")
        _sha(payload["evidence_sha256"], "history transcript evidence_sha256")
        replay[line_id][transcript_id] = replacement
        revision_counts[line_id] += 1
    for line in lines:
        line_id = line["line_id"]
        if line["transcript_revision"] != revision_counts[line_id]:
            raise EnvelopeError("transcript_revision does not match correction history")
        for unit in line["transcript_units"]:
            if unit["text"] != replay[line_id][unit["id"]]:
                raise EnvelopeError("transcript text does not replay from source_text and history")


def _list(value: Any, name: str) -> list[Any]:
    if not isinstance(value, list):
        raise EnvelopeError(f"{name} must be a list")
    return value


def _string_list(value: Any, name: str, *, allow_empty: bool = False) -> list[str]:
    if not isinstance(value, list) or (not value and not allow_empty):
        raise EnvelopeError(f"{name} must be {'a' if allow_empty else 'a non-empty'} list")
    result = [_nonempty_string(item, name) for item in value]
    if len(result) != len(set(result)):
        raise EnvelopeError(f"{name} must not contain duplicates")
    return result


def _box(value: Any) -> list[int]:
    if not isinstance(value, list) or len(value) != 4:
        raise EnvelopeError("bbox_source_xywh must have four integers")
    if any(isinstance(item, bool) or not isinstance(item, int) for item in value):
        raise EnvelopeError("bbox_source_xywh values must be integers")
    if value[0] < 0 or value[1] < 0 or value[2] <= 0 or value[3] <= 0:
        raise EnvelopeError("bbox_source_xywh must be positive and non-negative at origin")
    return list(value)


def _box_contains(outer: Sequence[int], inner: Sequence[int]) -> bool:
    return (
        outer[0] <= inner[0]
        and outer[1] <= inner[1]
        and outer[0] + outer[2] >= inner[0] + inner[2]
        and outer[1] + outer[3] >= inner[1] + inner[3]
    )


def _affine(value: Any, name: str) -> list[float]:
    if not isinstance(value, list) or len(value) != 9:
        raise EnvelopeError(f"{name} must contain nine numbers")
    if any(isinstance(item, bool) or not isinstance(item, (int, float)) or not math.isfinite(float(item)) for item in value):
        raise EnvelopeError(f"{name} values must be finite numbers")
    return [float(item) for item in value]


def _point(value: Any, name: str) -> list[float]:
    if not isinstance(value, list) or len(value) != 2:
        raise EnvelopeError(f"{name} must contain two numbers")
    if any(isinstance(item, bool) or not isinstance(item, (int, float)) or not math.isfinite(float(item)) for item in value):
        raise EnvelopeError(f"{name} values must be finite numbers")
    return [float(item) for item in value]


def _matmul3(left: list[float], right: list[float]) -> list[float]:
    return [sum(left[row * 3 + inner] * right[inner * 3 + column] for inner in range(3)) for row in range(3) for column in range(3)]


def _exact_keys(value: Mapping[str, Any], expected: set[str], name: str) -> None:
    actual = set(value)
    if actual != expected:
        raise EnvelopeError(f"{name} has invalid fields; missing={sorted(expected - actual)}, extra={sorted(actual - expected)}")


def _sha(value: Any, name: str) -> str:
    if not isinstance(value, str) or _SHA256.fullmatch(value) is None:
        raise EnvelopeError(f"{name} must be a lowercase SHA-256 string")
    return value


def _nonempty_string(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise EnvelopeError(f"{name} must be a non-empty string")
    return value


def _nonnegative_int(value: Any, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise EnvelopeError(f"{name} must be a non-negative integer")
    return value


def _enum(value: Any, allowed: set[str], name: str) -> str:
    if value not in allowed:
        raise EnvelopeError(f"{name} is unsupported")
    return value
