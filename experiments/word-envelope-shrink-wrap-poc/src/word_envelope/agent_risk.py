"""Truth-free, observable risk gates for agent ink-ownership actions.

The benchmark scorer may compare a claim with sealed target masks.  Production
cannot.  This module therefore uses only the current ink mask, the public task
record, the replay-bound action, and optional hash-bound runtime ownership
state.  Its output is deliberately verbose and JSON-serializable so every
escalation can be explained and thresholds can be tuned from later pilots
without changing the feature definitions.
"""

from __future__ import annotations

import copy
from dataclasses import asdict, dataclass
import hashlib
import math
import re
from typing import Any, Mapping

import numpy as np

from .agent_ownership import component_reference, validate_single_action
from .agent_verifier_state import validate_verifier_state
from .engine import EnvelopeError
from .io_utils import canonical_json_bytes
from .masks import stable_components


AGENT_OWNERSHIP_RISK_SCHEMA_VERSION = "word-ink-ownership-risk.v2"
_MULTI_WORD = re.compile(r"\S+\s+\S+")
_BINDING_FIELDS = (
    "task_id",
    "task_pack_sha256",
    "turn",
    "input_state_sha256",
    "component_inventory_sha256",
)


@dataclass(frozen=True)
class OwnershipRiskConfig:
    """Conservative, named thresholds for the observable production gate."""

    plausible_min_overlap_px: int = 4
    plausible_min_component_area_px: int = 6
    plausible_min_active_overlap_fraction: float = 0.20
    plausible_min_area_relative_to_selected_ink: float = 0.005
    minimum_selected_active_box_fraction: float = 0.75
    maximum_selected_width_to_active_box: float = 1.20
    maximum_selected_height_to_active_box: float = 1.20
    maximum_total_components: int = 30
    maximum_selected_components: int = 8
    fragmentation_minimum_components: int = 6
    fragmentation_small_component_max_area_px: int = 16
    fragmentation_small_to_largest_area_fraction: float = 0.03
    fragmentation_small_component_fraction: float = 0.50
    vertical_tolerance_degrees: float = 25.0
    horizontal_tolerance_degrees: float = 25.0
    escalate_vertical_orientation: bool = True
    escalate_multi_word_target: bool = True
    require_local_selection_stability: bool = True

    def __post_init__(self) -> None:
        integer_minimums = {
            "plausible_min_overlap_px": (self.plausible_min_overlap_px, 1),
            "plausible_min_component_area_px": (
                self.plausible_min_component_area_px,
                1,
            ),
            "maximum_total_components": (self.maximum_total_components, 1),
            "maximum_selected_components": (self.maximum_selected_components, 1),
            "fragmentation_minimum_components": (
                self.fragmentation_minimum_components,
                2,
            ),
            "fragmentation_small_component_max_area_px": (
                self.fragmentation_small_component_max_area_px,
                0,
            ),
        }
        for name, (value, minimum) in integer_minimums.items():
            if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
                raise ValueError(f"{name} must be an integer >= {minimum}")

        unit_intervals = {
            "plausible_min_active_overlap_fraction": (
                self.plausible_min_active_overlap_fraction
            ),
            "plausible_min_area_relative_to_selected_ink": (
                self.plausible_min_area_relative_to_selected_ink
            ),
            "minimum_selected_active_box_fraction": (
                self.minimum_selected_active_box_fraction
            ),
            "fragmentation_small_to_largest_area_fraction": (
                self.fragmentation_small_to_largest_area_fraction
            ),
            "fragmentation_small_component_fraction": (
                self.fragmentation_small_component_fraction
            ),
        }
        for name, value in unit_intervals.items():
            if not _finite_number(value) or not 0.0 <= float(value) <= 1.0:
                raise ValueError(f"{name} must be finite and between 0 and 1")

        positive_floats = {
            "maximum_selected_width_to_active_box": (
                self.maximum_selected_width_to_active_box
            ),
            "maximum_selected_height_to_active_box": (
                self.maximum_selected_height_to_active_box
            ),
            "vertical_tolerance_degrees": self.vertical_tolerance_degrees,
            "horizontal_tolerance_degrees": self.horizontal_tolerance_degrees,
        }
        for name, value in positive_floats.items():
            if not _finite_number(value) or float(value) < 0.0:
                raise ValueError(f"{name} must be a finite non-negative number")

        for name, value in {
            "escalate_vertical_orientation": self.escalate_vertical_orientation,
            "escalate_multi_word_target": self.escalate_multi_word_target,
            "require_local_selection_stability": (
                self.require_local_selection_stability
            ),
        }.items():
            if not isinstance(value, bool):
                raise ValueError(f"{name} must be a boolean")


def assess_ownership_risk(
    public_task: Mapping[str, Any],
    current_base_mask: np.ndarray,
    expanded_action: Mapping[str, Any],
    *,
    config: OwnershipRiskConfig | None = None,
    verifier_state: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Assess an action using observable production inputs only.

    The function intentionally has no truth-mask, case-label, assessment-label,
    or pilot-tier argument.  Optional verifier state contains only operational
    prior ownership and is independently bound to the public task and live
    component inventory.
    """

    policy = config or OwnershipRiskConfig()
    mask = _validated_mask(current_base_mask)
    task = _validated_public_task(public_task, mask)
    action_record = validate_single_action(expanded_action, mask)
    _validate_bindings(task, action_record)

    labels, inventory = stable_components(mask)
    inventory_by_id = {component["id"]: component for component in inventory}
    action = action_record["action"]
    action_type = action["type"]
    selected_ids = (
        [reference["id"] for reference in action["target_component_refs"]]
        if action_type == "claim_select"
        else []
    )
    public_refs_exposed = bool(
        task.get("prior_owned_component_refs_exposed", False)
    )
    if verifier_state is not None:
        validated_verifier_state = validate_verifier_state(
            verifier_state,
            task,
            mask,
        )
        prior_ids = sorted(
            reference["id"]
            for reference in validated_verifier_state[
                "prior_owned_component_refs"
            ]
        )
        prior_refs_source = "internal_verifier_state"
        prior_refs_available = True
        verifier_state_hash = validated_verifier_state[
            "verifier_state_sha256"
        ]
    else:
        prior_ids = _prior_owned_ids(task, inventory_by_id)
        prior_refs_source = (
            "public_exposure" if public_refs_exposed else "unavailable"
        )
        prior_refs_available = public_refs_exposed
        verifier_state_hash = None
    action_component_ids = _action_component_ids(action)
    active_box = task["active_target_box_work_xywh"]
    features = _observable_features(
        mask=mask,
        labels=labels,
        inventory=inventory,
        selected_ids=selected_ids,
        prior_ids=prior_ids,
        active_box=active_box,
        action=action,
        task=task,
        policy=policy,
        prior_refs_source=prior_refs_source,
        prior_refs_available=prior_refs_available,
        verifier_state_hash=verifier_state_hash,
    )
    features["action_component_ids"] = action_component_ids

    decision, reasons = _policy_decision(action, features, policy)
    stability = {
        "evaluated": False,
        "stable": None,
        "accepted_single_component_addition_ids": [],
        "accepted_single_component_removal_ids": [],
        "evaluated_variant_count": 0,
    }
    if (
        action_type == "claim_select"
        and decision == "accept_candidate"
        and policy.require_local_selection_stability
    ):
        stability = _local_selection_stability(
            mask=mask,
            labels=labels,
            inventory=inventory,
            selected_ids=selected_ids,
            prior_ids=prior_ids,
            active_box=active_box,
            action=action,
            task=task,
            policy=policy,
            prior_refs_source=prior_refs_source,
            prior_refs_available=prior_refs_available,
            verifier_state_hash=verifier_state_hash,
        )
        if not stability["stable"]:
            decision = "escalate_sol"
            reasons = ["locally_ambiguous_component_selection"]
    features["local_selection_stability"] = stability
    return {
        "schema_version": AGENT_OWNERSHIP_RISK_SCHEMA_VERSION,
        "decision": decision,
        "reason_codes": reasons,
        "action_type": action_type,
        "features": features,
        "thresholds": asdict(policy),
    }


def _local_selection_stability(
    *,
    mask: np.ndarray,
    labels: np.ndarray,
    inventory: list[dict[str, Any]],
    selected_ids: list[int],
    prior_ids: list[int],
    active_box: list[int] | tuple[int, ...],
    action: Mapping[str, Any],
    task: Mapping[str, Any],
    policy: OwnershipRiskConfig,
    prior_refs_source: str,
    prior_refs_available: bool,
    verifier_state_hash: str | None,
) -> dict[str, Any]:
    """Challenge a provisionally accepted claim with one-component toggles.

    A truth-free gate cannot know whether a tiny mark is punctuation, debris, or
    part of a letter.  If both the proposed claim and a one-component addition
    or removal pass the same observable policy, the software has evidence of a
    locally ambiguous decision boundary and must not auto-accept either choice.
    """

    inventory_by_id = {component["id"]: component for component in inventory}
    selected = set(selected_ids)
    prior = set(prior_ids)
    accepted_additions: list[int] = []
    accepted_removals: list[int] = []
    evaluated_count = 0
    active_x, active_y, active_width, active_height = active_box
    active_labels = labels[
        active_y : active_y + active_height,
        active_x : active_x + active_width,
    ]

    def variant_is_accepted(variant_ids: list[int]) -> bool:
        variant_action = dict(action)
        variant_action["target_component_refs"] = [
            component_reference(inventory_by_id[component_id])
            for component_id in variant_ids
        ]
        variant_features = _observable_features(
            mask=mask,
            labels=labels,
            inventory=inventory,
            selected_ids=variant_ids,
            prior_ids=prior_ids,
            active_box=active_box,
            action=variant_action,
            task=task,
            policy=policy,
            prior_refs_source=prior_refs_source,
            prior_refs_available=prior_refs_available,
            verifier_state_hash=verifier_state_hash,
        )
        variant_decision, _ = _policy_decision(
            variant_action, variant_features, policy
        )
        return variant_decision == "accept_candidate"

    for component_id in sorted(inventory_by_id):
        if component_id in selected or component_id in prior:
            continue
        if not np.any(active_labels == component_id):
            continue
        evaluated_count += 1
        if variant_is_accepted(sorted([*selected, component_id])):
            accepted_additions.append(component_id)

    if len(selected) > 1:
        for component_id in sorted(selected):
            evaluated_count += 1
            if variant_is_accepted(sorted(selected - {component_id})):
                accepted_removals.append(component_id)

    stable = not accepted_additions and not accepted_removals
    return {
        "evaluated": True,
        "stable": stable,
        "accepted_single_component_addition_ids": accepted_additions,
        "accepted_single_component_removal_ids": accepted_removals,
        "evaluated_variant_count": evaluated_count,
    }


def _validated_mask(value: np.ndarray) -> np.ndarray:
    mask = np.asarray(value, dtype=bool)
    if mask.ndim != 2 or mask.size == 0:
        raise EnvelopeError("current base mask must be a non-empty 2D array")
    return mask


def _validated_public_task(
    value: Mapping[str, Any], mask: np.ndarray
) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise EnvelopeError("public task must be an object")
    required = {
        *_BINDING_FIELDS,
        "components",
        "work_size_wh",
        "active_target_box_work_xywh",
    }
    missing = sorted(required - set(value))
    if missing:
        raise EnvelopeError(f"public task is missing required fields: {missing}")

    work_size = value["work_size_wh"]
    if (
        not isinstance(work_size, (list, tuple))
        or len(work_size) != 2
        or any(isinstance(item, bool) or not isinstance(item, int) for item in work_size)
        or list(work_size) != [mask.shape[1], mask.shape[0]]
    ):
        raise EnvelopeError("public task work_size_wh does not match current base mask")
    _validate_active_box(value["active_target_box_work_xywh"], mask.shape)

    _, inventory = stable_components(mask)
    expected_components = [component_reference(component) for component in inventory]
    if value["components"] != expected_components:
        raise EnvelopeError("public task components do not match current base mask")

    task_basis = copy.deepcopy(dict(value))
    task_pack_hash = task_basis.pop("task_pack_sha256")
    try:
        observed_task_hash = hashlib.sha256(
            canonical_json_bytes(task_basis)
        ).hexdigest()
    except (TypeError, ValueError) as error:
        raise EnvelopeError("public task is not canonical JSON data") from error
    if task_pack_hash != observed_task_hash:
        raise EnvelopeError(
            "task_pack_sha256 does not match the public task contents"
        )
    return dict(value)


def _validate_active_box(value: Any, shape: tuple[int, int]) -> None:
    if (
        not isinstance(value, (list, tuple))
        or len(value) != 4
        or any(isinstance(item, bool) or not isinstance(item, int) for item in value)
    ):
        raise EnvelopeError("active target box must be integer [x, y, width, height]")
    x, y, width, height = value
    if x < 0 or y < 0 or width <= 0 or height <= 0:
        raise EnvelopeError("active target box must have a non-negative origin and positive size")
    if x + width > shape[1] or y + height > shape[0]:
        raise EnvelopeError("active target box must be contained by the current base mask")


def _validate_bindings(task: Mapping[str, Any], action: Mapping[str, Any]) -> None:
    for field in _BINDING_FIELDS:
        if task[field] != action[field]:
            raise EnvelopeError(f"public task and expanded action disagree on {field}")


def _prior_owned_ids(
    task: Mapping[str, Any], inventory_by_id: Mapping[int, Mapping[str, Any]]
) -> list[int]:
    references = task.get("prior_owned_component_refs", [])
    if not isinstance(references, list):
        raise EnvelopeError("public task prior_owned_component_refs must be a list")
    ids: list[int] = []
    for index, reference in enumerate(references):
        if not isinstance(reference, Mapping) or set(reference) != {"id", "fingerprint"}:
            raise EnvelopeError(
                f"public task prior-owned component {index} is not a canonical reference"
            )
        component_id = reference["id"]
        component = inventory_by_id.get(component_id)
        if component is None or reference != component_reference(component):
            raise EnvelopeError(
                f"public task prior-owned component {component_id!r} is stale"
            )
        ids.append(component_id)
    if len(ids) != len(set(ids)):
        raise EnvelopeError("public task prior-owned component IDs must be unique")
    return sorted(ids)


def _action_component_ids(action: Mapping[str, Any]) -> list[int]:
    action_type = action["type"]
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
    return sorted(reference["id"] for reference in references)


def _observable_features(
    *,
    mask: np.ndarray,
    labels: np.ndarray,
    inventory: list[dict[str, Any]],
    selected_ids: list[int],
    prior_ids: list[int],
    active_box: list[int] | tuple[int, ...],
    action: Mapping[str, Any],
    task: Mapping[str, Any],
    policy: OwnershipRiskConfig,
    prior_refs_source: str,
    prior_refs_available: bool,
    verifier_state_hash: str | None,
) -> dict[str, Any]:
    selected_id_set = set(selected_ids)
    prior_id_set = set(prior_ids)
    selected_mask = np.isin(labels, selected_ids)
    prior_mask = np.isin(labels, prior_ids)
    selected_pixels = int(selected_mask.sum())
    selected_prior_ids = sorted(selected_id_set & prior_id_set)
    selected_prior_pixels = int(np.count_nonzero(selected_mask & prior_mask))
    selected_components = [
        component for component in inventory if component["id"] in selected_id_set
    ]
    selected_border_ids = sorted(
        component["id"]
        for component in selected_components
        if component["touches_border"]
    )

    x, y, width, height = active_box
    active_mask = np.zeros(mask.shape, dtype=bool)
    active_mask[y : y + height, x : x + width] = True
    active_touches_border = bool(
        x == 0 or y == 0 or x + width == mask.shape[1] or y + height == mask.shape[0]
    )
    selected_in_active = int(np.count_nonzero(selected_mask & active_mask))
    selected_active_fraction = (
        float(selected_in_active / selected_pixels) if selected_pixels else 0.0
    )

    selected_bbox = _union_bbox(selected_components)
    width_ratio = (
        float(selected_bbox["width"] / width) if selected_bbox is not None else 0.0
    )
    height_ratio = (
        float(selected_bbox["height"] / height) if selected_bbox is not None else 0.0
    )
    bbox_area_ratio = (
        float(
            selected_bbox["width"]
            * selected_bbox["height"]
            / (width * height)
        )
        if selected_bbox is not None
        else 0.0
    )

    candidates: list[dict[str, Any]] = []
    plausible_ids: list[int] = []
    for component in inventory:
        component_id = component["id"]
        if component_id in selected_id_set or component_id in prior_id_set:
            continue
        component_mask = labels == component_id
        overlap = int(np.count_nonzero(component_mask & active_mask))
        if overlap == 0:
            continue
        area = int(component["area_px"])
        overlap_fraction = float(overlap / area)
        relative_area = float(area / selected_pixels) if selected_pixels else math.inf
        overlap_relative = (
            float(overlap / selected_pixels) if selected_pixels else math.inf
        )
        plausible = bool(
            overlap >= policy.plausible_min_overlap_px
            and area >= policy.plausible_min_component_area_px
            and overlap_fraction >= policy.plausible_min_active_overlap_fraction
            and relative_area
            >= policy.plausible_min_area_relative_to_selected_ink
        )
        record = {
            "id": component_id,
            "active_box_overlap_px": overlap,
            "area_px": area,
            "active_box_overlap_fraction": _rounded(overlap_fraction),
            "area_relative_to_selected_ink": _finite_or_none(relative_area),
            "overlap_relative_to_selected_ink": _finite_or_none(overlap_relative),
            "plausible_unclaimed": plausible,
        }
        candidates.append(record)
        if plausible:
            plausible_ids.append(component_id)

    selected_areas = sorted(int(component["area_px"]) for component in selected_components)
    largest_area = max(selected_areas, default=0)
    small_area_limit = max(
        policy.fragmentation_small_component_max_area_px,
        int(math.floor(largest_area * policy.fragmentation_small_to_largest_area_fraction)),
    )
    small_count = sum(area <= small_area_limit for area in selected_areas)
    small_fraction = (
        float(small_count / len(selected_areas)) if selected_areas else 0.0
    )
    high_fragmentation = bool(
        len(selected_areas) >= policy.fragmentation_minimum_components
        and small_fraction >= policy.fragmentation_small_component_fraction
    )

    orientation = _orientation_features(task.get("orientation_degrees", 0.0), policy)
    target_transcript = task.get("target_transcript", "")
    target_unit = task.get("target_unit", "")
    multi_word = bool(
        isinstance(target_unit, str) and "multi" in target_unit.lower()
    ) or bool(isinstance(target_transcript, str) and _MULTI_WORD.search(target_transcript))
    prior_visible = bool(task.get("prior_owned_ink_visible", False))
    prior_refs_exposed = bool(task.get("prior_owned_component_refs_exposed", False))

    return {
        "total_component_count": len(inventory),
        "selected_component_count": len(selected_ids),
        "selected_component_ids": sorted(selected_ids),
        "selected_ink_pixels": selected_pixels,
        "prior_owned_component_count": len(prior_ids),
        "prior_owned_component_ids": prior_ids,
        "prior_owned_ink_visible": prior_visible,
        "prior_owned_component_refs_exposed": prior_refs_exposed,
        "prior_owned_component_refs_available": prior_refs_available,
        "prior_owned_component_refs_source": prior_refs_source,
        "internal_verifier_state_sha256": verifier_state_hash,
        "selected_prior_owned_component_count": len(selected_prior_ids),
        "selected_prior_owned_component_ids": selected_prior_ids,
        "selected_prior_owned_pixel_count": selected_prior_pixels,
        "selected_prior_owned_pixel_fraction": _rounded(
            selected_prior_pixels / selected_pixels if selected_pixels else 0.0
        ),
        "selected_confidence": action["confidence"],
        "selected_border_contact": bool(selected_border_ids),
        "selected_border_component_ids": selected_border_ids,
        "active_target_box_work_xywh": list(active_box),
        "active_target_box_touches_work_border": active_touches_border,
        "selected_bbox_work_xywh": (
            [
                selected_bbox["x"],
                selected_bbox["y"],
                selected_bbox["width"],
                selected_bbox["height"],
            ]
            if selected_bbox is not None
            else None
        ),
        "selected_bbox_width_to_active_box": _rounded(width_ratio),
        "selected_bbox_height_to_active_box": _rounded(height_ratio),
        "selected_bbox_area_to_active_box": _rounded(bbox_area_ratio),
        "selected_ink_inside_active_box_px": selected_in_active,
        "selected_ink_inside_active_box_fraction": _rounded(
            selected_active_fraction
        ),
        "unselected_nonprior_active_box_components": candidates,
        "plausible_unclaimed_component_ids": plausible_ids,
        "plausible_unclaimed_component_count": len(plausible_ids),
        "fragmentation": {
            "selected_component_areas_px": selected_areas,
            "largest_selected_component_area_px": largest_area,
            "small_component_area_limit_px": small_area_limit,
            "small_selected_component_count": small_count,
            "small_selected_component_fraction": _rounded(small_fraction),
            "high_fragmentation": high_fragmentation,
        },
        "orientation_degrees": orientation["degrees"],
        "orientation_class": orientation["class"],
        "orientation_distance_from_horizontal_degrees": orientation[
            "distance_from_horizontal_degrees"
        ],
        "orientation_distance_from_vertical_degrees": orientation[
            "distance_from_vertical_degrees"
        ],
        "multi_word_target": multi_word,
        "target_unit": target_unit if isinstance(target_unit, str) else None,
        "action_reason_codes": list(action["reason_codes"]),
    }


def _policy_decision(
    action: Mapping[str, Any],
    features: Mapping[str, Any],
    policy: OwnershipRiskConfig,
) -> tuple[str, list[str]]:
    action_type = action["type"]
    if action_type == "defer_manual":
        return "escalate_human", ["agent_deferred_manual_review"]
    if action_type == "request_expanded_context":
        return "escalate_human", ["expanded_context_required"]
    if action_type == "cut":
        return "escalate_sol", ["cut_requires_expert_turn"]
    if action_type == "exclude":
        return "escalate_sol", ["exclusion_requires_reinspection"]

    reasons: list[str] = []
    human_reasons: list[str] = []
    action_reasons = set(features["action_reason_codes"])
    if action_reasons & {"border_contact", "clipped_ink"}:
        human_reasons.append("action_reports_border_or_clipped_ink")
    if features["selected_border_contact"]:
        human_reasons.append("selected_component_touches_work_border")
    if features["active_target_box_touches_work_border"]:
        human_reasons.append("active_target_box_touches_work_border")

    if features["selected_confidence"] != "high":
        reasons.append("claim_confidence_not_high")
    if features["selected_prior_owned_component_count"]:
        reasons.append("selected_prior_owned_components")
    if (
        features["prior_owned_ink_visible"]
        and not features["prior_owned_component_refs_available"]
    ):
        reasons.append("prior_ownership_references_unavailable")
    if features["plausible_unclaimed_component_count"]:
        reasons.append("plausible_unclaimed_active_box_components")
    if policy.escalate_vertical_orientation and features["orientation_class"] == "vertical":
        reasons.append("vertical_orientation")
    if policy.escalate_multi_word_target and features["multi_word_target"]:
        reasons.append("multi_word_target")
    if features["total_component_count"] > policy.maximum_total_components:
        reasons.append("total_component_count_exceeds_limit")
    if features["selected_component_count"] > policy.maximum_selected_components:
        reasons.append("selected_component_count_exceeds_limit")
    if features["fragmentation"]["high_fragmentation"]:
        reasons.append("high_selection_fragmentation")
    if (
        features["selected_bbox_width_to_active_box"]
        > policy.maximum_selected_width_to_active_box
        or features["selected_bbox_height_to_active_box"]
        > policy.maximum_selected_height_to_active_box
    ):
        reasons.append("selected_span_exceeds_active_box_limits")
    if (
        features["selected_ink_inside_active_box_fraction"]
        < policy.minimum_selected_active_box_fraction
    ):
        reasons.append("selected_ink_mostly_outside_active_box")

    if human_reasons:
        return "escalate_human", [*human_reasons, *reasons]
    if reasons:
        return "escalate_sol", reasons
    return "accept_candidate", ["observable_checks_passed"]


def _union_bbox(components: list[Mapping[str, Any]]) -> dict[str, int] | None:
    if not components:
        return None
    left = min(component["bbox"]["x"] for component in components)
    top = min(component["bbox"]["y"] for component in components)
    right = max(
        component["bbox"]["x"] + component["bbox"]["width"]
        for component in components
    )
    bottom = max(
        component["bbox"]["y"] + component["bbox"]["height"]
        for component in components
    )
    return {"x": left, "y": top, "width": right - left, "height": bottom - top}


def _orientation_features(
    value: Any, policy: OwnershipRiskConfig
) -> dict[str, Any]:
    if not _finite_number(value):
        raise EnvelopeError("public task orientation_degrees must be finite and numeric")
    degrees = float(value)
    half_turn = degrees % 180.0
    horizontal_distance = min(half_turn, 180.0 - half_turn)
    vertical_distance = abs(half_turn - 90.0)
    if vertical_distance <= policy.vertical_tolerance_degrees:
        orientation_class = "vertical"
    elif horizontal_distance <= policy.horizontal_tolerance_degrees:
        orientation_class = "horizontal"
    else:
        orientation_class = "oblique"
    return {
        "degrees": _rounded(degrees),
        "class": orientation_class,
        "distance_from_horizontal_degrees": _rounded(horizontal_distance),
        "distance_from_vertical_degrees": _rounded(vertical_distance),
    }


def _finite_number(value: Any) -> bool:
    return (
        not isinstance(value, bool)
        and isinstance(value, (int, float))
        and math.isfinite(float(value))
    )


def _rounded(value: float) -> float:
    return round(float(value), 9)


def _finite_or_none(value: float) -> float | None:
    return _rounded(value) if math.isfinite(value) else None
