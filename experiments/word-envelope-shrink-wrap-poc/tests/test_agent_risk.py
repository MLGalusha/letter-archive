from __future__ import annotations

import copy
import hashlib
import inspect
import unittest

import numpy as np

from word_envelope.agent_ownership import (
    AGENT_OWNERSHIP_SCHEMA_VERSION,
    component_inventory_sha256,
    component_reference,
)
from word_envelope.agent_risk import OwnershipRiskConfig, assess_ownership_risk
from word_envelope.engine import EnvelopeError
from word_envelope.io_utils import canonical_json_bytes, sha256_mask_pixels
from word_envelope.masks import stable_components


class AgentRiskTests(unittest.TestCase):
    def test_easy_exact_selection_is_an_accept_candidate(self) -> None:
        mask = np.zeros((30, 70), dtype=bool)
        mask[8:16, 8:18] = True
        mask[8:16, 50:60] = True
        task, inventory = task_for(mask, active_box=[5, 5, 20, 16])
        result = assess_ownership_risk(
            task,
            mask,
            action_for(mask, task, inventory, claim([0])),
        )

        self.assertEqual(result["decision"], "accept_candidate")
        self.assertEqual(result["reason_codes"], ["observable_checks_passed"])
        features = result["features"]
        self.assertEqual(features["total_component_count"], 2)
        self.assertEqual(features["selected_component_count"], 1)
        self.assertEqual(features["plausible_unclaimed_component_ids"], [])
        self.assertFalse(features["selected_border_contact"])
        self.assertEqual(features["selected_ink_inside_active_box_fraction"], 1.0)
        self.assertTrue(features["local_selection_stability"]["stable"])

    def test_local_toggle_ambiguity_rejects_under_and_over_selection(self) -> None:
        mask = np.zeros((30, 50), dtype=bool)
        mask[8:16, 8:18] = True
        mask[10:12, 20:22] = True
        task, inventory = task_for(mask, active_box=[5, 5, 25, 16])

        missing_tiny_mark = assess_ownership_risk(
            task,
            mask,
            action_for(mask, task, inventory, claim([0])),
        )
        self.assertEqual(missing_tiny_mark["decision"], "escalate_sol")
        self.assertEqual(
            missing_tiny_mark["reason_codes"],
            ["locally_ambiguous_component_selection"],
        )
        self.assertEqual(
            missing_tiny_mark["features"]["local_selection_stability"][
                "accepted_single_component_addition_ids"
            ],
            [inventory[1]["id"]],
        )

        possibly_overselected = assess_ownership_risk(
            task,
            mask,
            action_for(mask, task, inventory, claim([0, 1])),
        )
        self.assertEqual(possibly_overselected["decision"], "escalate_sol")
        self.assertEqual(
            possibly_overselected["features"]["local_selection_stability"][
                "accepted_single_component_removal_ids"
            ],
            [inventory[1]["id"]],
        )

        exploratory_policy = OwnershipRiskConfig(
            require_local_selection_stability=False
        )
        without_counterfactual_check = assess_ownership_risk(
            task,
            mask,
            action_for(mask, task, inventory, claim([0, 1])),
            config=exploratory_policy,
        )
        self.assertEqual(
            without_counterfactual_check["decision"], "accept_candidate"
        )
        self.assertFalse(
            without_counterfactual_check["features"]["local_selection_stability"][
                "evaluated"
            ]
        )

    def test_confidently_incomplete_word_escalates_for_large_unclaimed_ink(self) -> None:
        mask = np.zeros((30, 70), dtype=bool)
        mask[8:16, 8:18] = True
        mask[8:16, 23:34] = True
        task, inventory = task_for(mask, active_box=[5, 5, 34, 16])
        result = assess_ownership_risk(
            task,
            mask,
            action_for(mask, task, inventory, claim([0])),
        )

        self.assertEqual(result["decision"], "escalate_sol")
        self.assertIn(
            "plausible_unclaimed_active_box_components", result["reason_codes"]
        )
        candidate = result["features"][
            "unselected_nonprior_active_box_components"
        ][0]
        self.assertEqual(candidate["id"], inventory[1]["id"])
        self.assertEqual(candidate["active_box_overlap_px"], 88)
        self.assertEqual(candidate["area_px"], 88)
        self.assertGreater(candidate["area_relative_to_selected_ink"], 1.0)
        self.assertTrue(candidate["plausible_unclaimed"])

    def test_selecting_prior_owned_component_escalates(self) -> None:
        mask = np.zeros((30, 50), dtype=bool)
        mask[8:16, 8:18] = True
        task, inventory = task_for(mask, active_box=[5, 5, 20, 16])
        task["prior_owned_ink_visible"] = True
        task["prior_owned_component_refs_exposed"] = True
        task["prior_owned_component_refs"] = [component_reference(inventory[0])]
        bind_task_hash(task)
        result = assess_ownership_risk(
            task,
            mask,
            action_for(mask, task, inventory, claim([0])),
        )

        self.assertEqual(result["decision"], "escalate_sol")
        self.assertIn("selected_prior_owned_components", result["reason_codes"])
        self.assertEqual(
            result["features"]["selected_prior_owned_component_ids"], [1]
        )
        self.assertEqual(
            result["features"]["selected_prior_owned_pixel_fraction"], 1.0
        )
        self.assertEqual(
            result["features"]["prior_owned_component_refs_source"],
            "public_exposure",
        )
        self.assertTrue(
            result["features"]["prior_owned_component_refs_available"]
        )

    def test_vertical_and_high_fragmentation_claims_upgrade(self) -> None:
        vertical_mask = np.zeros((40, 40), dtype=bool)
        vertical_mask[8:20, 8:16] = True
        vertical_task, vertical_inventory = task_for(
            vertical_mask,
            active_box=[5, 5, 20, 22],
            orientation_degrees=90,
        )
        vertical = assess_ownership_risk(
            vertical_task,
            vertical_mask,
            action_for(
                vertical_mask, vertical_task, vertical_inventory, claim([0])
            ),
        )
        self.assertEqual(vertical["decision"], "escalate_sol")
        self.assertIn("vertical_orientation", vertical["reason_codes"])
        self.assertEqual(vertical["features"]["orientation_class"], "vertical")

        fragmented_mask = np.zeros((35, 80), dtype=bool)
        for index in range(6):
            x = 8 + index * 8
            fragmented_mask[10:12, x : x + 2] = True
        fragmented_task, fragmented_inventory = task_for(
            fragmented_mask, active_box=[5, 5, 54, 15]
        )
        fragmented = assess_ownership_risk(
            fragmented_task,
            fragmented_mask,
            action_for(
                fragmented_mask,
                fragmented_task,
                fragmented_inventory,
                claim(list(range(6))),
            ),
        )
        self.assertEqual(fragmented["decision"], "escalate_sol")
        self.assertIn("high_selection_fragmentation", fragmented["reason_codes"])
        self.assertTrue(fragmented["features"]["fragmentation"]["high_fragmentation"])

    def test_clipped_border_and_manual_actions_route_to_human(self) -> None:
        border_mask = np.zeros((30, 50), dtype=bool)
        border_mask[8:16, 0:10] = True
        border_task, border_inventory = task_for(
            border_mask, active_box=[0, 5, 20, 16]
        )
        border = assess_ownership_risk(
            border_task,
            border_mask,
            action_for(border_mask, border_task, border_inventory, claim([0])),
        )
        self.assertEqual(border["decision"], "escalate_human")
        self.assertIn(
            "selected_component_touches_work_border", border["reason_codes"]
        )

        clipped_mask = np.zeros((30, 50), dtype=bool)
        clipped_mask[8:16, 8:18] = True
        clipped_task, clipped_inventory = task_for(
            clipped_mask, active_box=[5, 5, 20, 16]
        )
        clipped_action = claim([0])
        clipped_action["reason_codes"] = ["clipped_ink"]
        clipped = assess_ownership_risk(
            clipped_task,
            clipped_mask,
            action_for(
                clipped_mask, clipped_task, clipped_inventory, clipped_action
            ),
        )
        self.assertEqual(clipped["decision"], "escalate_human")
        self.assertIn(
            "action_reports_border_or_clipped_ink", clipped["reason_codes"]
        )

        manual = assess_ownership_risk(
            clipped_task,
            clipped_mask,
            action_for(
                clipped_mask,
                clipped_task,
                clipped_inventory,
                {
                    "type": "defer_manual",
                    "disposition": "ambiguous_ownership",
                    "confidence": "low",
                    "reason_codes": ["uncertain_reading"],
                },
            ),
        )
        self.assertEqual(manual["decision"], "escalate_human")
        self.assertEqual(manual["reason_codes"], ["agent_deferred_manual_review"])

    def test_nonterminal_tool_actions_route_for_an_expert_turn(self) -> None:
        mask = np.zeros((30, 70), dtype=bool)
        mask[8:16, 8:18] = True
        mask[8:16, 45:55] = True
        task, inventory = task_for(mask, active_box=[5, 5, 20, 16])
        exclusion = assess_ownership_risk(
            task,
            mask,
            action_for(
                mask,
                task,
                inventory,
                {
                    "type": "exclude",
                    "component_refs": [component_reference(inventory[1])],
                    "confidence": "high",
                    "reason_codes": ["adjacent_word"],
                },
            ),
        )
        self.assertEqual(exclusion["decision"], "escalate_sol")
        self.assertEqual(
            exclusion["reason_codes"], ["exclusion_requires_reinspection"]
        )

        context = assess_ownership_risk(
            task,
            mask,
            action_for(
                mask,
                task,
                inventory,
                {
                    "type": "request_expanded_context",
                    "request": {
                        "kind": "crop_margin",
                        "sides": ["right"],
                        "margin_px": 64,
                        "focus_component_refs": [component_reference(inventory[1])],
                        "why": "border_contact",
                    },
                    "confidence": "low",
                    "reason_codes": ["border_contact"],
                },
            ),
        )
        self.assertEqual(context["decision"], "escalate_human")
        self.assertEqual(context["reason_codes"], ["expanded_context_required"])

        bridge_mask = np.zeros((30, 70), dtype=bool)
        bridge_mask[12:18, 10:50] = True
        bridge_task, bridge_inventory = task_for(
            bridge_mask, active_box=[5, 5, 55, 20]
        )
        cut = assess_ownership_risk(
            bridge_task,
            bridge_mask,
            action_for(
                bridge_mask,
                bridge_task,
                bridge_inventory,
                {
                    "type": "cut",
                    "bridge_component_ref": component_reference(
                        bridge_inventory[0]
                    ),
                    "cut": {
                        "kind": "line",
                        "points": [[30, 5], [30, 24]],
                        "width_px": 1,
                        "intent": "sever_observed_bridge",
                    },
                    "confidence": "medium",
                    "reason_codes": ["threshold_bridge"],
                },
            ),
        )
        self.assertEqual(cut["decision"], "escalate_sol")
        self.assertEqual(cut["reason_codes"], ["cut_requires_expert_turn"])

    def test_public_api_has_no_truth_or_benchmark_label_inputs(self) -> None:
        parameters = inspect.signature(assess_ownership_risk).parameters
        self.assertEqual(
            list(parameters),
            [
                "public_task",
                "current_base_mask",
                "expanded_action",
                "config",
                "verifier_state",
            ],
        )
        forbidden = {"truth", "neighbor", "case", "tier", "assessment"}
        self.assertFalse(
            any(
                token in name
                for name in parameters
                for token in forbidden
            )
        )

    def test_rejects_public_task_mutations_that_retain_the_old_hash(self) -> None:
        mask = np.zeros((30, 70), dtype=bool)
        mask[8:16, 8:18] = True
        mask[8:16, 50:60] = True
        task, inventory = task_for(mask, active_box=[5, 5, 20, 16])
        action = action_for(mask, task, inventory, claim([0]))
        mutations = {
            "prior-owned refs": lambda value: value.update(
                {
                    "prior_owned_ink_visible": True,
                    "prior_owned_component_refs_exposed": True,
                    "prior_owned_component_refs": [
                        component_reference(inventory[0])
                    ],
                }
            ),
            "other public field": lambda value: value.update(
                {"target_transcript": "tampered transcript"}
            ),
        }

        for label, mutate in mutations.items():
            with self.subTest(label=label):
                stale = copy.deepcopy(task)
                mutate(stale)
                self.assertEqual(
                    stale["task_pack_sha256"], task["task_pack_sha256"]
                )
                with self.assertRaisesRegex(
                    EnvelopeError, "task_pack_sha256.*public task contents"
                ):
                    assess_ownership_risk(stale, mask, action)


def task_for(
    mask: np.ndarray,
    *,
    active_box: list[int],
    orientation_degrees: float = 0,
) -> tuple[dict[str, object], list[dict[str, object]]]:
    _, inventory = stable_components(mask)
    task: dict[str, object] = {
        "task_id": "observable-task",
        "turn": 0,
        "input_state_sha256": sha256_mask_pixels(mask),
        "component_inventory_sha256": component_inventory_sha256(inventory),
        "components": [component_reference(component) for component in inventory],
        "work_size_wh": [mask.shape[1], mask.shape[0]],
        "active_target_box_work_xywh": active_box,
        "target_transcript": "word",
        "target_unit": "single_word",
        "orientation_degrees": orientation_degrees,
        "prior_owned_ink_visible": False,
        "prior_owned_component_refs_exposed": False,
        "prior_owned_component_refs": [],
    }
    bind_task_hash(task)
    return task, inventory


def bind_task_hash(task: dict[str, object]) -> None:
    task.pop("task_pack_sha256", None)
    task["task_pack_sha256"] = hashlib.sha256(
        canonical_json_bytes(task)
    ).hexdigest()


def claim(component_indexes: list[int]) -> dict[str, object]:
    return {
        "type": "claim_select",
        "component_indexes": component_indexes,
        "confidence": "high",
        "reason_codes": ["same_word_body"],
    }


def action_for(
    mask: np.ndarray,
    task: dict[str, object],
    inventory: list[dict[str, object]],
    action: dict[str, object],
) -> dict[str, object]:
    expanded = copy.deepcopy(action)
    indexes = expanded.pop("component_indexes", None)
    if indexes is not None:
        expanded["target_component_refs"] = [
            component_reference(inventory[index]) for index in indexes
        ]
    return {
        "schema_version": AGENT_OWNERSHIP_SCHEMA_VERSION,
        "task_id": task["task_id"],
        "task_pack_sha256": task["task_pack_sha256"],
        "turn": task["turn"],
        "input_state_sha256": sha256_mask_pixels(mask),
        "component_inventory_sha256": component_inventory_sha256(inventory),
        "action": expanded,
    }


if __name__ == "__main__":
    unittest.main()
