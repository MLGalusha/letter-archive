from __future__ import annotations

import copy
import inspect
import json
import unittest
from typing import Any

import numpy as np

from word_envelope.agent_consensus import (
    AGENT_ACTION_AGREEMENT_SCHEMA_VERSION,
    compare_action_agreement,
)
from word_envelope.agent_ownership import (
    AGENT_OWNERSHIP_SCHEMA_VERSION,
    component_inventory_sha256,
    component_reference,
)
from word_envelope.engine import EnvelopeError
from word_envelope.io_utils import sha256_mask_pixels
from word_envelope.masks import stable_components


class AgentConsensusTests(unittest.TestCase):
    def test_exact_claim_mask_agrees_despite_explanatory_metadata(self) -> None:
        mask, inventory = consensus_fixture()
        first = bound_action(mask, inventory, claim(inventory, [0]))
        second = bound_action(
            mask,
            inventory,
            claim(
                inventory,
                [0],
                confidence="medium",
                reasons=["detached_mark_belongs_to_target"],
            ),
        )

        result = compare_action_agreement(first, second, mask)

        self.assertEqual(
            result["schema_version"], AGENT_ACTION_AGREEMENT_SCHEMA_VERSION
        )
        self.assertEqual(result["agreement_kind"], "exact_claim_agreement")
        self.assertTrue(result["agreement_candidate"])
        self.assertFalse(result["semantic_safety_proof"])
        self.assertTrue(result["comparisons"]["exact_claim_mask_pixels"])
        self.assertTrue(result["comparisons"]["exact_operational_outcome"])
        self.assertFalse(result["comparisons"]["exact_action_payload"])
        self.assertEqual(result["first"]["component_ids"], [1])
        self.assertEqual(
            result["first"]["claimed_mask_pixel_sha256"],
            result["second"]["claimed_mask_pixel_sha256"],
        )
        self.assertIn("not proof", result["qualification"])
        json.dumps(result, allow_nan=False)

    def test_one_pixel_debris_added_to_claim_is_exact_disagreement(self) -> None:
        mask, inventory = consensus_fixture()
        target_only = bound_action(mask, inventory, claim(inventory, [0]))
        target_plus_one_pixel_debris = bound_action(
            mask,
            inventory,
            claim(inventory, [0, 2]),
        )

        result = compare_action_agreement(
            target_only,
            target_plus_one_pixel_debris,
            mask,
        )

        self.assertEqual(result["agreement_kind"], "claim_disagreement")
        self.assertFalse(result["agreement_candidate"])
        self.assertFalse(result["comparisons"]["exact_claim_mask_pixels"])
        self.assertNotEqual(
            result["first"]["claimed_mask_pixel_sha256"],
            result["second"]["claimed_mask_pixel_sha256"],
        )
        self.assertEqual(result["second"]["component_ids"], [1, 3])

    def test_distinguishes_claim_nonterminal_and_manual_outcomes(self) -> None:
        mask, inventory = consensus_fixture()
        selected = bound_action(mask, inventory, claim(inventory, [0]))
        excluded = bound_action(mask, inventory, exclude(inventory, [1]))
        same_exclusion = bound_action(
            mask,
            inventory,
            exclude(
                inventory,
                [1],
                confidence="medium",
                reasons=["rule_or_noise"],
            ),
        )
        other_exclusion = bound_action(mask, inventory, exclude(inventory, [2]))
        manual = bound_action(mask, inventory, defer("ambiguous_ownership"))
        same_manual = bound_action(
            mask,
            inventory,
            defer(
                "ambiguous_ownership",
                confidence="medium",
                reasons=["uncertain_reading"],
            ),
        )
        other_manual = bound_action(
            mask,
            inventory,
            defer("ambiguous_detached_mark"),
        )

        claim_vs_nonclaim = compare_action_agreement(selected, manual, mask)
        self.assertEqual(
            claim_vs_nonclaim["agreement_kind"], "claim_vs_nonclaim"
        )
        self.assertFalse(claim_vs_nonclaim["agreement_candidate"])

        exact_tool = compare_action_agreement(excluded, same_exclusion, mask)
        self.assertEqual(
            exact_tool["agreement_kind"], "exact_nonterminal_agreement"
        )
        self.assertTrue(exact_tool["agreement_candidate"])
        self.assertTrue(exact_tool["comparisons"]["exact_output_mask_pixels"])
        self.assertFalse(exact_tool["comparisons"]["exact_action_payload"])

        nonexact_tool = compare_action_agreement(
            excluded, other_exclusion, mask
        )
        self.assertEqual(
            nonexact_tool["agreement_kind"], "nonexact_nonterminal_agreement"
        )
        self.assertFalse(nonexact_tool["agreement_candidate"])

        exact_manual = compare_action_agreement(manual, same_manual, mask)
        self.assertEqual(
            exact_manual["agreement_kind"], "exact_manual_agreement"
        )
        self.assertTrue(exact_manual["agreement_candidate"])

        nonexact_manual = compare_action_agreement(manual, other_manual, mask)
        self.assertEqual(
            nonexact_manual["agreement_kind"], "nonexact_manual_agreement"
        )
        self.assertFalse(nonexact_manual["agreement_candidate"])

        mixed = compare_action_agreement(excluded, manual, mask)
        self.assertEqual(mixed["agreement_kind"], "nonterminal_vs_manual")
        self.assertFalse(mixed["agreement_candidate"])

    def test_rejects_tampered_stale_or_differently_bound_actions(self) -> None:
        mask, inventory = consensus_fixture()
        first = bound_action(mask, inventory, claim(inventory, [0]))

        tampered = copy.deepcopy(first)
        tampered["action"]["target_component_refs"][0]["fingerprint"][
            "area_px"
        ] += 1
        with self.assertRaisesRegex(EnvelopeError, "fingerprint"):
            compare_action_agreement(first, tampered, mask)

        stale_mask = mask.copy()
        stale_mask[0, 29] = True
        with self.assertRaisesRegex(EnvelopeError, "input_state_sha256"):
            compare_action_agreement(first, first, stale_mask)

        differently_bound = copy.deepcopy(first)
        differently_bound["task_pack_sha256"] = "b" * 64
        with self.assertRaisesRegex(
            EnvelopeError, "binding field task_pack_sha256"
        ):
            compare_action_agreement(first, differently_bound, mask)

        other_turn = copy.deepcopy(first)
        other_turn["turn"] = 1
        with self.assertRaisesRegex(EnvelopeError, "binding field turn"):
            compare_action_agreement(first, other_turn, mask)

    def test_public_api_accepts_no_truth_case_or_tier_inputs(self) -> None:
        names = set(inspect.signature(compare_action_agreement).parameters)
        self.assertEqual(
            names, {"first_action", "second_action", "current_mask"}
        )
        self.assertFalse(
            any(
                token in name
                for name in names
                for token in ("truth", "case", "tier", "assessment")
            )
        )


def consensus_fixture() -> tuple[np.ndarray, list[dict[str, Any]]]:
    mask = np.zeros((20, 30), dtype=bool)
    mask[2:7, 2:8] = True
    mask[2:7, 17:24] = True
    mask[15, 27] = True  # isolated one-pixel generic debris
    _, inventory = stable_components(mask)
    return mask, inventory


def bound_action(
    mask: np.ndarray,
    inventory: list[dict[str, Any]],
    action: dict[str, Any],
) -> dict[str, Any]:
    return {
        "schema_version": AGENT_OWNERSHIP_SCHEMA_VERSION,
        "task_id": "public-task-001",
        "task_pack_sha256": "a" * 64,
        "turn": 0,
        "input_state_sha256": sha256_mask_pixels(mask),
        "component_inventory_sha256": component_inventory_sha256(inventory),
        "action": copy.deepcopy(action),
    }


def claim(
    inventory: list[dict[str, Any]],
    indexes: list[int],
    *,
    confidence: str = "high",
    reasons: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "type": "claim_select",
        "target_component_refs": [
            component_reference(inventory[index]) for index in indexes
        ],
        "confidence": confidence,
        "reason_codes": reasons or ["same_word_body"],
    }


def exclude(
    inventory: list[dict[str, Any]],
    indexes: list[int],
    *,
    confidence: str = "high",
    reasons: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "type": "exclude",
        "component_refs": [
            component_reference(inventory[index]) for index in indexes
        ],
        "confidence": confidence,
        "reason_codes": reasons or ["adjacent_word"],
    }


def defer(
    disposition: str,
    *,
    confidence: str = "low",
    reasons: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "type": "defer_manual",
        "disposition": disposition,
        "confidence": confidence,
        "reason_codes": reasons or ["uncertain_reading"],
    }
