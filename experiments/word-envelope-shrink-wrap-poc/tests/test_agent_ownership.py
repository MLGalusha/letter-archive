from __future__ import annotations

import copy
import unittest

import numpy as np

from word_envelope.agent_ownership import (
    AGENT_OWNERSHIP_SCHEMA_VERSION,
    apply_single_action,
    component_inventory_sha256,
    component_reference,
    score_ownership,
    validate_single_action,
)
from word_envelope.engine import EnvelopeError
from word_envelope.io_utils import sha256_mask_pixels
from word_envelope.masks import stable_components


class AgentOwnershipTests(unittest.TestCase):
    def test_claim_select_builds_terminal_mask(self) -> None:
        mask = two_components()
        _, inventory = stable_components(mask)
        record = action_record(
            mask,
            inventory,
            {
                "type": "claim_select",
                "target_component_refs": [component_reference(inventory[0])],
                "confidence": "high",
                "reason_codes": ["same_word_body"],
            },
        )
        result = apply_single_action(record, mask)
        self.assertEqual(result.terminal_status, "selected")
        self.assertFalse(result.requires_later_turn)
        self.assertEqual(int(result.claimed_mask.sum()), inventory[0]["area_px"])
        self.assertTrue(result.claimed_mask[3, 3])
        self.assertFalse(result.claimed_mask[3, 18])

    def test_stale_component_fingerprint_is_rejected(self) -> None:
        mask = two_components()
        _, inventory = stable_components(mask)
        record = action_record(
            mask,
            inventory,
            {
                "type": "exclude",
                "component_refs": [component_reference(inventory[0])],
                "confidence": "high",
                "reason_codes": ["adjacent_word"],
            },
        )
        record["action"]["component_refs"][0]["fingerprint"]["area_px"] += 1
        with self.assertRaisesRegex(EnvelopeError, "fingerprint"):
            validate_single_action(record, mask)

    def test_cut_splits_bridge_and_requires_later_turn(self) -> None:
        mask = np.zeros((20, 40), dtype=bool)
        mask[7:13, 3:37] = True
        _, inventory = stable_components(mask)
        record = action_record(
            mask,
            inventory,
            {
                "type": "cut",
                "bridge_component_ref": component_reference(inventory[0]),
                "cut": {
                    "kind": "line",
                    "points": [[20, 2], [20, 17]],
                    "width_px": 1,
                    "intent": "sever_observed_bridge",
                },
                "confidence": "medium",
                "reason_codes": ["threshold_bridge"],
            },
        )
        result = apply_single_action(record, mask)
        self.assertTrue(result.requires_later_turn)
        self.assertIsNone(result.claimed_mask)
        self.assertIsNone(result.terminal_status)
        self.assertEqual(len(stable_components(result.output_mask)[1]), 2)
        self.assertNotEqual(result.input_mask_pixel_sha256, result.output_mask_pixel_sha256)

    def test_exclude_removes_components_and_requires_later_turn(self) -> None:
        mask = two_components()
        _, inventory = stable_components(mask)
        record = action_record(
            mask,
            inventory,
            {
                "type": "exclude",
                "component_refs": [component_reference(inventory[1])],
                "confidence": "high",
                "reason_codes": ["adjacent_word"],
            },
        )

        result = apply_single_action(record, mask)

        self.assertTrue(result.requires_later_turn)
        self.assertIsNone(result.terminal_status)
        self.assertIsNone(result.claimed_mask)
        self.assertTrue(result.output_mask[3, 3])
        self.assertFalse(result.output_mask[3, 18])
        self.assertEqual(len(result.cleanup_log), 1)
        self.assertNotEqual(
            result.input_mask_pixel_sha256, result.output_mask_pixel_sha256
        )

    def test_cut_that_only_erases_ink_is_rejected(self) -> None:
        mask = two_components()
        _, inventory = stable_components(mask)
        record = action_record(
            mask,
            inventory,
            {
                "type": "cut",
                "bridge_component_ref": component_reference(inventory[0]),
                "cut": {
                    "kind": "line",
                    "points": [[2, 1], [2, 8]],
                    "width_px": 1,
                    "intent": "sever_observed_bridge",
                },
                "confidence": "medium",
                "reason_codes": ["threshold_bridge"],
            },
        )
        with self.assertRaisesRegex(EnvelopeError, "must split"):
            validate_single_action(record, mask)

    def test_cut_cannot_damage_an_unreferenced_component(self) -> None:
        mask = np.zeros((20, 40), dtype=bool)
        mask[7:13, 3:37] = True
        mask[1:4, 18:23] = True
        _, inventory = stable_components(mask)
        bridge = max(inventory, key=lambda component: component["area_px"])
        record = action_record(
            mask,
            inventory,
            {
                "type": "cut",
                "bridge_component_ref": component_reference(bridge),
                "cut": {
                    "kind": "line",
                    "points": [[20, 0], [20, 17]],
                    "width_px": 1,
                    "intent": "sever_observed_bridge",
                },
                "confidence": "medium",
                "reason_codes": ["threshold_bridge"],
            },
        )

        with self.assertRaisesRegex(
            EnvelopeError, "outside its bridge_component_ref"
        ):
            validate_single_action(record, mask)

    def test_context_and_manual_are_terminal_without_mask_mutation(self) -> None:
        mask = two_components()
        _, inventory = stable_components(mask)
        context = action_record(
            mask,
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
        )
        self.assertEqual(apply_single_action(context, mask).terminal_status, "needs_expanded_context")
        manual = action_record(
            mask,
            inventory,
            {
                "type": "defer_manual",
                "disposition": "ambiguous_ownership",
                "confidence": "low",
                "reason_codes": ["touching_words"],
            },
        )
        self.assertEqual(apply_single_action(manual, mask).terminal_status, "manual_review")

    def test_strict_unknown_fields_are_rejected(self) -> None:
        mask = two_components()
        _, inventory = stable_components(mask)
        record = action_record(
            mask,
            inventory,
            {
                "type": "exclude",
                "component_refs": [component_reference(inventory[0])],
                "confidence": "high",
                "reason_codes": ["rule_or_noise"],
                "explanation": "not allowed",
            },
        )
        with self.assertRaisesRegex(EnvelopeError, "invalid fields"):
            validate_single_action(record, mask)

    def test_pixel_metrics_and_neighbor_contamination_are_exact(self) -> None:
        truth = np.zeros((10, 12), dtype=bool)
        truth[1:3, 1:4] = True  # 6 pixels
        neighbor = np.zeros_like(truth)
        neighbor[1:3, 6:8] = True  # 4 pixels
        neighbor[7, 10] = True  # one-pixel independent neighbor component
        claimed = truth.copy()
        claimed[1, 6] = True
        claimed[7, 10] = True
        scores = score_ownership(claimed, truth, neighbor)
        self.assertEqual(scores["true_positive_pixels"], 6)
        self.assertEqual(scores["false_positive_pixels"], 2)
        self.assertEqual(scores["false_negative_pixels"], 0)
        self.assertEqual(scores["precision"], 0.75)
        self.assertEqual(scores["recall"], 1.0)
        self.assertEqual(scores["f1"], 0.857142857)
        self.assertEqual(scores["iou"], 0.75)
        self.assertEqual(scores["neighbor_contamination"], 0.4)
        self.assertEqual(scores["neighbor_component_max_contamination"], 1.0)


def two_components() -> np.ndarray:
    mask = np.zeros((12, 30), dtype=bool)
    mask[2:7, 2:8] = True
    mask[2:7, 17:24] = True
    return mask


def action_record(mask: np.ndarray, inventory: list[dict[str, object]], action: dict[str, object]) -> dict[str, object]:
    return {
        "schema_version": AGENT_OWNERSHIP_SCHEMA_VERSION,
        "task_id": "blinded-task-001",
        "task_pack_sha256": "a" * 64,
        "turn": 0,
        "input_state_sha256": sha256_mask_pixels(mask),
        "component_inventory_sha256": component_inventory_sha256(inventory),
        "action": copy.deepcopy(action),
    }
