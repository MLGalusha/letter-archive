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
from word_envelope.agent_risk import assess_ownership_risk
from word_envelope.agent_verifier_state import (
    AGENT_VERIFIER_STATE_SCHEMA_VERSION,
    build_verifier_state,
    validate_verifier_state,
)
from word_envelope.engine import EnvelopeError
from word_envelope.io_utils import canonical_json_bytes, sha256_mask_pixels
from word_envelope.masks import stable_components


class AgentVerifierStateTests(unittest.TestCase):
    def test_internal_refs_make_red_only_state_available_without_public_mutation(
        self,
    ) -> None:
        mask, task, inventory = red_only_fixture()
        action = claim_action(mask, task, inventory, [1])
        public_bytes_before = canonical_json_bytes(task)
        public_hash_before = task["task_pack_sha256"]

        without_internal_state = assess_ownership_risk(task, mask, action)
        self.assertEqual(without_internal_state["decision"], "escalate_sol")
        self.assertIn(
            "prior_ownership_references_unavailable",
            without_internal_state["reason_codes"],
        )
        self.assertEqual(
            without_internal_state["features"][
                "prior_owned_component_refs_source"
            ],
            "unavailable",
        )

        state = build_verifier_state(
            task,
            mask,
            [component_reference(inventory[0])],
        )
        result = assess_ownership_risk(
            task,
            mask,
            action,
            verifier_state=state,
        )

        self.assertEqual(result["decision"], "accept_candidate")
        features = result["features"]
        self.assertEqual(
            features["prior_owned_component_refs_source"],
            "internal_verifier_state",
        )
        self.assertTrue(features["prior_owned_component_refs_available"])
        self.assertFalse(features["prior_owned_component_refs_exposed"])
        self.assertEqual(features["prior_owned_component_ids"], [1])
        self.assertEqual(
            features["internal_verifier_state_sha256"],
            state["verifier_state_sha256"],
        )
        self.assertEqual(canonical_json_bytes(task), public_bytes_before)
        self.assertEqual(task["task_pack_sha256"], public_hash_before)

    def test_builder_canonicalizes_refs_and_validator_rejects_state_tampering(
        self,
    ) -> None:
        mask, task, inventory = red_only_fixture()
        state = build_verifier_state(
            task,
            mask,
            [
                component_reference(inventory[1]),
                component_reference(inventory[0]),
            ],
        )

        self.assertEqual(
            state["schema_version"], AGENT_VERIFIER_STATE_SCHEMA_VERSION
        )
        self.assertEqual(
            [reference["id"] for reference in state["prior_owned_component_refs"]],
            [1, 2],
        )
        self.assertEqual(validate_verifier_state(state, task, mask), state)

        stale_hash = copy.deepcopy(state)
        stale_hash["prior_owned_component_refs"] = stale_hash[
            "prior_owned_component_refs"
        ][:-1]
        with self.assertRaisesRegex(
            EnvelopeError, "verifier_state_sha256.*contents"
        ):
            validate_verifier_state(stale_hash, task, mask)

        noncanonical = copy.deepcopy(state)
        noncanonical["prior_owned_component_refs"].reverse()
        bind_state_hash(noncanonical)
        with self.assertRaisesRegex(EnvelopeError, "canonical component-ID order"):
            validate_verifier_state(noncanonical, task, mask)

        stale_fingerprint = copy.deepcopy(state)
        stale_fingerprint["prior_owned_component_refs"][0]["fingerprint"][
            "area_px"
        ] += 1
        bind_state_hash(stale_fingerprint)
        with self.assertRaisesRegex(
            EnvelopeError, "fingerprint does not match current component"
        ):
            validate_verifier_state(stale_fingerprint, task, mask)

    def test_rejects_stale_task_bindings_and_current_mask(self) -> None:
        mask, task, inventory = red_only_fixture()
        state = build_verifier_state(
            task,
            mask,
            [component_reference(inventory[0])],
        )

        rebound_state = copy.deepcopy(state)
        rebound_state["turn"] = 1
        bind_state_hash(rebound_state)
        with self.assertRaisesRegex(EnvelopeError, "disagree on turn"):
            validate_verifier_state(rebound_state, task, mask)

        stale_inventory_binding = copy.deepcopy(state)
        stale_inventory_binding["component_inventory_sha256"] = "f" * 64
        bind_state_hash(stale_inventory_binding)
        with self.assertRaisesRegex(
            EnvelopeError, "disagree on component_inventory_sha256"
        ):
            validate_verifier_state(stale_inventory_binding, task, mask)

        mutated_task = copy.deepcopy(task)
        mutated_task["target_transcript"] = "changed"
        with self.assertRaisesRegex(
            EnvelopeError, "task_pack_sha256.*public task contents"
        ):
            validate_verifier_state(state, mutated_task, mask)

        rebound_task = copy.deepcopy(task)
        rebound_task["target_transcript"] = "changed"
        bind_task_hash(rebound_task)
        with self.assertRaisesRegex(EnvelopeError, "disagree on task_pack_sha256"):
            validate_verifier_state(state, rebound_task, mask)

        changed_mask = mask.copy()
        changed_mask[35, 85] = True
        with self.assertRaisesRegex(
            EnvelopeError, "input_state_sha256.*current base mask"
        ):
            validate_verifier_state(state, task, changed_mask)

    def test_apis_and_state_have_no_benchmark_truth_inputs(self) -> None:
        builder_parameters = inspect.signature(build_verifier_state).parameters
        validator_parameters = inspect.signature(validate_verifier_state).parameters
        risk_parameters = inspect.signature(assess_ownership_risk).parameters
        forbidden = {"truth", "neighbor", "case", "tier", "assessment"}
        for parameters in (
            builder_parameters,
            validator_parameters,
            risk_parameters,
        ):
            self.assertFalse(
                any(
                    token in name
                    for name in parameters
                    for token in forbidden
                )
            )

        mask, task, inventory = red_only_fixture()
        state = build_verifier_state(
            task,
            mask,
            [component_reference(inventory[0])],
        )
        self.assertFalse(any("truth" in key for key in state))
        injected = copy.deepcopy(state)
        injected["truth_target_mask"] = "not allowed"
        with self.assertRaisesRegex(EnvelopeError, "invalid fields"):
            validate_verifier_state(injected, task, mask)


def red_only_fixture() -> tuple[
    np.ndarray,
    dict[str, object],
    list[dict[str, object]],
]:
    mask = np.zeros((40, 90), dtype=bool)
    mask[10:18, 8:18] = True
    mask[10:18, 30:40] = True
    mask[10:18, 70:80] = True
    _, inventory = stable_components(mask)
    task: dict[str, object] = {
        "task_id": "red-only-task",
        "turn": 0,
        "input_state_sha256": sha256_mask_pixels(mask),
        "component_inventory_sha256": component_inventory_sha256(inventory),
        "components": [component_reference(component) for component in inventory],
        "work_size_wh": [mask.shape[1], mask.shape[0]],
        "active_target_box_work_xywh": [5, 5, 40, 20],
        "target_transcript": "word",
        "target_unit": "single_word",
        "orientation_degrees": 0,
        "prior_owned_ink_visible": True,
        "prior_owned_component_refs_exposed": False,
        "prior_owned_component_refs": [],
    }
    bind_task_hash(task)
    return mask, task, inventory


def bind_task_hash(task: dict[str, object]) -> None:
    task.pop("task_pack_sha256", None)
    task["task_pack_sha256"] = hashlib.sha256(
        canonical_json_bytes(task)
    ).hexdigest()


def bind_state_hash(state: dict[str, object]) -> None:
    state.pop("verifier_state_sha256", None)
    state["verifier_state_sha256"] = hashlib.sha256(
        canonical_json_bytes(state)
    ).hexdigest()


def claim_action(
    mask: np.ndarray,
    task: dict[str, object],
    inventory: list[dict[str, object]],
    component_indexes: list[int],
) -> dict[str, object]:
    return {
        "schema_version": AGENT_OWNERSHIP_SCHEMA_VERSION,
        "task_id": task["task_id"],
        "task_pack_sha256": task["task_pack_sha256"],
        "turn": task["turn"],
        "input_state_sha256": sha256_mask_pixels(mask),
        "component_inventory_sha256": component_inventory_sha256(inventory),
        "action": {
            "type": "claim_select",
            "target_component_refs": [
                component_reference(inventory[index])
                for index in component_indexes
            ],
            "confidence": "high",
            "reason_codes": ["same_word_body"],
        },
    }


if __name__ == "__main__":
    unittest.main()
