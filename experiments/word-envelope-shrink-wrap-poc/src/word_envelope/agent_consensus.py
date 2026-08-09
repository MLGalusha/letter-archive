"""Truth-free exact agreement checks for two bound ownership actions.

Agreement is useful as a routing signal when two agents independently inspect
the same public task state.  It is deliberately *not* a semantic correctness
check: two agents can agree exactly and still agree on the wrong ink.  This
module therefore reports only an ``agreement_candidate`` and always marks
``semantic_safety_proof`` false.
"""

from __future__ import annotations

import hashlib
from typing import Any, Mapping

import numpy as np

from .agent_ownership import OwnershipActionResult, apply_single_action
from .engine import EnvelopeError
from .io_utils import canonical_json_bytes, sha256_mask_pixels


AGENT_ACTION_AGREEMENT_SCHEMA_VERSION = (
    "word-ink-ownership-action-agreement.v1"
)

_BINDING_FIELDS = (
    "schema_version",
    "task_id",
    "task_pack_sha256",
    "turn",
    "input_state_sha256",
    "component_inventory_sha256",
)
_NONTERMINAL_ACTION_TYPES = {
    "exclude",
    "cut",
    "request_expanded_context",
}


def compare_action_agreement(
    first_action: Mapping[str, Any],
    second_action: Mapping[str, Any],
    current_mask: np.ndarray,
) -> dict[str, Any]:
    """Compare two independently produced actions bound to one current mask.

    Both actions are strictly validated and replayed twice against
    ``current_mask``.  Every binding field must match before their operational
    results are compared.  A matching result is only an agreement candidate;
    callers must still apply separate risk, semantic, or human review gates.

    No benchmark truth or source-case metadata is accepted by this API.
    """

    first_record, first = _validated_replay(first_action, current_mask, "first")
    second_record, second = _validated_replay(
        second_action, current_mask, "second"
    )
    binding = _matching_binding(first_record, second_record)

    first_type = str(first.action["type"])
    second_type = str(second.action["type"])
    first_class = _action_class(first_type)
    second_class = _action_class(second_type)
    same_action_type = first_type == second_type
    exact_action_payload = canonical_json_bytes(first.action) == canonical_json_bytes(
        second.action
    )
    exact_operational_outcome = _operational_signature(
        first.action
    ) == _operational_signature(second.action)
    exact_output_mask_pixels = _same_mask(first.output_mask, second.output_mask)

    exact_claim_mask_pixels: bool | None = None
    if first_class == "claim" and second_class == "claim":
        if first.claimed_mask is None or second.claimed_mask is None:
            raise EnvelopeError("A validated claim replay did not emit a claimed mask")
        exact_claim_mask_pixels = _same_mask(
            first.claimed_mask, second.claimed_mask
        )
        agreement_kind = (
            "exact_claim_agreement"
            if exact_claim_mask_pixels
            else "claim_disagreement"
        )
        agreement_candidate = exact_claim_mask_pixels
    elif first_class == "claim" or second_class == "claim":
        agreement_kind = "claim_vs_nonclaim"
        agreement_candidate = False
    elif first_class == "manual" and second_class == "manual":
        agreement_kind = (
            "exact_manual_agreement"
            if exact_operational_outcome
            else "nonexact_manual_agreement"
        )
        agreement_candidate = exact_operational_outcome
    elif first_class == "nonterminal" and second_class == "nonterminal":
        agreement_kind = (
            "exact_nonterminal_agreement"
            if exact_operational_outcome
            else "nonexact_nonterminal_agreement"
        )
        agreement_candidate = exact_operational_outcome
    else:
        agreement_kind = "nonterminal_vs_manual"
        agreement_candidate = False

    result = {
        "schema_version": AGENT_ACTION_AGREEMENT_SCHEMA_VERSION,
        "agreement_kind": agreement_kind,
        "agreement_candidate": bool(agreement_candidate),
        "semantic_safety_proof": False,
        "qualification": (
            "Exact agreement is a truth-free routing candidate, not proof that "
            "the selected or proposed ink is semantically correct."
        ),
        "binding": binding,
        "comparisons": {
            "same_action_type": same_action_type,
            "exact_action_payload": exact_action_payload,
            "exact_operational_outcome": exact_operational_outcome,
            "exact_output_mask_pixels": exact_output_mask_pixels,
            "exact_claim_mask_pixels": exact_claim_mask_pixels,
        },
        "first": _action_summary(first_record, first),
        "second": _action_summary(second_record, second),
    }
    # Fail closed if a future edit accidentally adds a non-JSON value.
    canonical_json_bytes(result)
    return result


def _validated_replay(
    action: Mapping[str, Any],
    current_mask: np.ndarray,
    label: str,
) -> tuple[dict[str, Any], OwnershipActionResult]:
    if not isinstance(action, Mapping):
        raise EnvelopeError(f"{label} bound action must be an object")
    record = dict(action)
    first = apply_single_action(record, current_mask)
    second = apply_single_action(record, current_mask)
    if not _same_replay(first, second):
        raise EnvelopeError(f"{label} bound action replay is not deterministic")
    return record, first


def _matching_binding(
    first: Mapping[str, Any], second: Mapping[str, Any]
) -> dict[str, Any]:
    binding: dict[str, Any] = {}
    for field in _BINDING_FIELDS:
        if first[field] != second[field]:
            raise EnvelopeError(f"Bound actions disagree on binding field {field}")
        binding[field] = first[field]
    return binding


def _same_replay(
    first: OwnershipActionResult, second: OwnershipActionResult
) -> bool:
    if (
        first.action != second.action
        or first.input_mask_pixel_sha256 != second.input_mask_pixel_sha256
        or first.output_mask_pixel_sha256 != second.output_mask_pixel_sha256
        or first.input_component_inventory_sha256
        != second.input_component_inventory_sha256
        or first.output_component_inventory_sha256
        != second.output_component_inventory_sha256
        or first.requires_later_turn != second.requires_later_turn
        or first.terminal_status != second.terminal_status
        or first.cleanup_log != second.cleanup_log
        or not _same_mask(first.output_mask, second.output_mask)
    ):
        return False
    if (first.claimed_mask is None) != (second.claimed_mask is None):
        return False
    return first.claimed_mask is None or _same_mask(
        first.claimed_mask, second.claimed_mask
    )


def _same_mask(first: np.ndarray, second: np.ndarray) -> bool:
    first_mask = np.asarray(first, dtype=bool)
    second_mask = np.asarray(second, dtype=bool)
    return (
        first_mask.shape == second_mask.shape
        and sha256_mask_pixels(first_mask) == sha256_mask_pixels(second_mask)
        and np.array_equal(first_mask, second_mask)
    )


def _action_class(action_type: str) -> str:
    if action_type == "claim_select":
        return "claim"
    if action_type == "defer_manual":
        return "manual"
    if action_type in _NONTERMINAL_ACTION_TYPES:
        return "nonterminal"
    raise EnvelopeError(f"Unsupported validated action type {action_type!r}")


def _operational_signature(action: Mapping[str, Any]) -> dict[str, Any]:
    """Return action semantics without confidence or explanatory reason codes."""

    action_type = str(action["type"])
    signature: dict[str, Any] = {"type": action_type}
    if action_type == "claim_select":
        signature["component_ids"] = sorted(
            int(reference["id"])
            for reference in action["target_component_refs"]
        )
    elif action_type == "exclude":
        signature["component_ids"] = sorted(
            int(reference["id"]) for reference in action["component_refs"]
        )
    elif action_type == "cut":
        signature["bridge_component_id"] = int(
            action["bridge_component_ref"]["id"]
        )
        signature["cut"] = action["cut"]
    elif action_type == "request_expanded_context":
        request = action["request"]
        signature["request"] = {
            "kind": request["kind"],
            "sides": sorted(request["sides"]),
            "margin_px": request["margin_px"],
            "focus_component_ids": sorted(
                int(reference["id"])
                for reference in request["focus_component_refs"]
            ),
            "why": request["why"],
        }
    elif action_type == "defer_manual":
        signature["disposition"] = action["disposition"]
    else:
        raise EnvelopeError(f"Unsupported validated action type {action_type!r}")
    return signature


def _action_summary(
    record: Mapping[str, Any], replay: OwnershipActionResult
) -> dict[str, Any]:
    action_type = str(replay.action["type"])
    claimed_hash = (
        sha256_mask_pixels(replay.claimed_mask)
        if replay.claimed_mask is not None
        else None
    )
    return {
        "bound_action_sha256": hashlib.sha256(
            canonical_json_bytes(record)
        ).hexdigest(),
        "action_payload_sha256": hashlib.sha256(
            canonical_json_bytes(replay.action)
        ).hexdigest(),
        "action_type": action_type,
        "action_class": _action_class(action_type),
        "component_ids": _referenced_component_ids(replay.action),
        "confidence": replay.action["confidence"],
        "terminal_status": replay.terminal_status,
        "requires_later_turn": replay.requires_later_turn,
        "input_mask_pixel_sha256": replay.input_mask_pixel_sha256,
        "output_mask_pixel_sha256": replay.output_mask_pixel_sha256,
        "claimed_mask_pixel_sha256": claimed_hash,
        "deterministic_replay": True,
    }


def _referenced_component_ids(action: Mapping[str, Any]) -> list[int]:
    action_type = str(action["type"])
    if action_type == "claim_select":
        references = action["target_component_refs"]
    elif action_type == "exclude":
        references = action["component_refs"]
    elif action_type == "cut":
        references = [action["bridge_component_ref"]]
    elif action_type == "request_expanded_context":
        references = action["request"]["focus_component_refs"]
    else:
        references = []
    return sorted(int(reference["id"]) for reference in references)
