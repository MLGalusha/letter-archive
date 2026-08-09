"""Hash-bound runtime ownership state kept outside public agent packs.

Red-only agent tasks intentionally omit machine-readable prior-ownership
component references.  The runtime still needs those exact references when it
checks a proposed claim.  This module binds that private *operational* state to
the immutable public task and current component inventory without adding it to,
or re-hashing, the public task record.

The state contains no benchmark truth, semantic-neighbor mask, case label, or
assessment tier.  It records only prior ownership already known by the runtime.
"""

from __future__ import annotations

import copy
import hashlib
import re
from typing import Any, Mapping, Sequence

import numpy as np

from .agent_ownership import (
    component_inventory_sha256,
    component_reference,
)
from .engine import EnvelopeError
from .io_utils import canonical_json_bytes, sha256_mask_pixels
from .masks import stable_components


AGENT_VERIFIER_STATE_SCHEMA_VERSION = "word-ink-ownership-verifier-state.v1"
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_BINDING_FIELDS = (
    "task_id",
    "task_pack_sha256",
    "turn",
    "input_state_sha256",
    "component_inventory_sha256",
)
_STATE_KEYS = {
    "schema_version",
    *_BINDING_FIELDS,
    "prior_owned_component_refs",
    "verifier_state_sha256",
}


def build_verifier_state(
    public_task: Mapping[str, Any],
    current_base_mask: np.ndarray,
    prior_owned_component_refs: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    """Build canonical internal state bound to one public task and mask state.

    The public task is validated but never mutated.  References are replaced by
    canonical fingerprints from the current inventory and sorted by component
    ID before the independent verifier-state hash is computed.
    """

    task, _, inventory = _validated_context(public_task, current_base_mask)
    references = _canonical_prior_references(
        prior_owned_component_refs,
        inventory,
    )
    basis: dict[str, Any] = {
        "schema_version": AGENT_VERIFIER_STATE_SCHEMA_VERSION,
        **{field: copy.deepcopy(task[field]) for field in _BINDING_FIELDS},
        "prior_owned_component_refs": references,
    }
    state_hash = hashlib.sha256(canonical_json_bytes(basis)).hexdigest()
    return {**basis, "verifier_state_sha256": state_hash}


def validate_verifier_state(
    verifier_state: Mapping[str, Any],
    public_task: Mapping[str, Any],
    current_base_mask: np.ndarray,
) -> dict[str, Any]:
    """Validate internal state against its own hash and live task bindings."""

    if not isinstance(verifier_state, Mapping):
        raise EnvelopeError("verifier state must be an object")
    actual_keys = set(verifier_state)
    if actual_keys != _STATE_KEYS:
        missing = sorted(_STATE_KEYS - actual_keys)
        extra = sorted(actual_keys - _STATE_KEYS)
        raise EnvelopeError(
            "verifier state has invalid fields; "
            f"missing={missing}, extra={extra}"
        )
    if verifier_state["schema_version"] != AGENT_VERIFIER_STATE_SCHEMA_VERSION:
        raise EnvelopeError(
            "verifier state schema must be "
            f"{AGENT_VERIFIER_STATE_SCHEMA_VERSION!r}"
        )
    _require_sha256(
        verifier_state["verifier_state_sha256"],
        "verifier_state_sha256",
    )

    state_basis = copy.deepcopy(dict(verifier_state))
    state_hash = state_basis.pop("verifier_state_sha256")
    try:
        observed_state_hash = hashlib.sha256(
            canonical_json_bytes(state_basis)
        ).hexdigest()
    except (TypeError, ValueError) as error:
        raise EnvelopeError("verifier state is not canonical JSON data") from error
    if state_hash != observed_state_hash:
        raise EnvelopeError(
            "verifier_state_sha256 does not match the verifier state contents"
        )

    task, _, inventory = _validated_context(public_task, current_base_mask)
    for field in _BINDING_FIELDS:
        if verifier_state[field] != task[field]:
            raise EnvelopeError(
                f"verifier state and public task disagree on {field}"
            )

    references = _canonical_prior_references(
        verifier_state["prior_owned_component_refs"],
        inventory,
    )
    if verifier_state["prior_owned_component_refs"] != references:
        raise EnvelopeError(
            "verifier state prior_owned_component_refs are not in canonical "
            "component-ID order"
        )
    return copy.deepcopy(dict(verifier_state))


def _validated_context(
    public_task: Mapping[str, Any],
    current_base_mask: np.ndarray,
) -> tuple[dict[str, Any], np.ndarray, list[dict[str, Any]]]:
    if not isinstance(public_task, Mapping):
        raise EnvelopeError("public task must be an object")
    required = {*_BINDING_FIELDS, "components"}
    missing = sorted(required - set(public_task))
    if missing:
        raise EnvelopeError(f"public task is missing verifier fields: {missing}")

    task = copy.deepcopy(dict(public_task))
    task_hash = task.get("task_pack_sha256")
    _require_sha256(task_hash, "public task task_pack_sha256")
    task_basis = copy.deepcopy(task)
    task_basis.pop("task_pack_sha256")
    try:
        observed_task_hash = hashlib.sha256(
            canonical_json_bytes(task_basis)
        ).hexdigest()
    except (TypeError, ValueError) as error:
        raise EnvelopeError("public task is not canonical JSON data") from error
    if task_hash != observed_task_hash:
        raise EnvelopeError(
            "task_pack_sha256 does not match the public task contents"
        )

    if not isinstance(task["task_id"], str) or not task["task_id"]:
        raise EnvelopeError("public task task_id must be a non-empty string")
    if (
        isinstance(task["turn"], bool)
        or not isinstance(task["turn"], int)
        or task["turn"] < 0
    ):
        raise EnvelopeError("public task turn must be a non-negative integer")
    _require_sha256(task["input_state_sha256"], "public task input_state_sha256")
    _require_sha256(
        task["component_inventory_sha256"],
        "public task component_inventory_sha256",
    )

    mask = np.asarray(current_base_mask, dtype=bool)
    if mask.ndim != 2 or mask.size == 0:
        raise EnvelopeError("current base mask must be a non-empty 2D array")
    if task["input_state_sha256"] != sha256_mask_pixels(mask):
        raise EnvelopeError(
            "public task input_state_sha256 does not match the current base mask"
        )
    _, inventory = stable_components(mask)
    inventory_hash = component_inventory_sha256(inventory)
    if task["component_inventory_sha256"] != inventory_hash:
        raise EnvelopeError(
            "public task component_inventory_sha256 does not match the current "
            "inventory"
        )
    expected_components = [component_reference(component) for component in inventory]
    if task["components"] != expected_components:
        raise EnvelopeError("public task components do not match current base mask")
    return task, mask, inventory


def _canonical_prior_references(
    references: Sequence[Mapping[str, Any]],
    inventory: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if (
        not isinstance(references, (list, tuple))
        or isinstance(references, (str, bytes))
    ):
        raise EnvelopeError("prior_owned_component_refs must be a list or tuple")
    inventory_by_id = {component["id"]: component for component in inventory}
    canonical: list[dict[str, Any]] = []
    seen: set[int] = set()
    for index, reference in enumerate(references):
        if not isinstance(reference, Mapping) or set(reference) != {
            "id",
            "fingerprint",
        }:
            raise EnvelopeError(
                "prior_owned_component_refs entry "
                f"{index} is not a canonical reference"
            )
        component_id = reference["id"]
        if (
            isinstance(component_id, bool)
            or not isinstance(component_id, int)
            or component_id < 1
        ):
            raise EnvelopeError(
                "prior_owned_component_refs IDs must be positive integers"
            )
        if component_id in seen:
            raise EnvelopeError(
                "prior_owned_component_refs component IDs must be unique"
            )
        seen.add(component_id)
        component = inventory_by_id.get(component_id)
        if component is None:
            raise EnvelopeError(
                "prior_owned_component_refs refers to missing current component "
                f"{component_id}"
            )
        expected = component_reference(component)
        if reference != expected:
            raise EnvelopeError(
                "prior_owned_component_refs fingerprint does not match current "
                f"component {component_id}"
            )
        canonical.append(expected)
    canonical.sort(key=lambda reference: reference["id"])
    return canonical


def _require_sha256(value: Any, name: str) -> None:
    if not isinstance(value, str) or _SHA256.fullmatch(value) is None:
        raise EnvelopeError(f"{name} must be a lowercase SHA-256 string")
