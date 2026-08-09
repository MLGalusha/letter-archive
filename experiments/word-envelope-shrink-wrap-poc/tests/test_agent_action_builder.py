from __future__ import annotations

import copy
import hashlib
import tempfile
import unittest
from pathlib import Path

import numpy as np

from word_envelope.agent_action_builder import (
    AGENT_OWNERSHIP_DECISION_SCHEMA_VERSION,
    build_bound_action,
    build_bound_action_from_paths,
)
from word_envelope.agent_ownership import (
    AGENT_OWNERSHIP_SCHEMA_VERSION,
    component_inventory_sha256,
    component_reference,
    validate_single_action,
)
from word_envelope.engine import EnvelopeError
from word_envelope.io_utils import (
    canonical_json_bytes,
    read_json,
    sha256_mask_pixels,
    write_json,
)
from word_envelope.masks import stable_components


class AgentActionBuilderTests(unittest.TestCase):
    def test_builds_claim_exclude_context_and_manual_with_canonical_refs(self) -> None:
        mask = two_components()
        _, inventory = stable_components(mask)
        task = task_for(mask)
        decisions = [
            decision(
                {
                    "type": "claim_select",
                    "component_ids": [inventory[0]["id"]],
                    "confidence": "high",
                    "reason_codes": ["same_word_body"],
                }
            ),
            decision(
                {
                    "type": "exclude",
                    "component_ids": [inventory[1]["id"]],
                    "confidence": "high",
                    "reason_codes": ["adjacent_word"],
                }
            ),
            decision(
                {
                    "type": "request_expanded_context",
                    "request": {
                        "kind": "crop_margin",
                        "sides": ["right"],
                        "margin_px": 64,
                        "focus_component_ids": [inventory[1]["id"]],
                        "why": "border_contact",
                    },
                    "confidence": "low",
                    "reason_codes": ["border_contact"],
                }
            ),
            decision(
                {
                    "type": "defer_manual",
                    "disposition": "ambiguous_ownership",
                    "confidence": "low",
                    "reason_codes": ["touching_words"],
                }
            ),
        ]

        records = [build_bound_action(task, item, mask) for item in decisions]

        for record in records:
            self.assertEqual(
                record["schema_version"], AGENT_OWNERSHIP_SCHEMA_VERSION
            )
            self.assertEqual(record["task_id"], task["task_id"])
            self.assertEqual(record["task_pack_sha256"], task["task_pack_sha256"])
            self.assertEqual(record["turn"], task["turn"])
            self.assertEqual(
                record["input_state_sha256"], task["input_state_sha256"]
            )
            self.assertEqual(
                record["component_inventory_sha256"],
                task["component_inventory_sha256"],
            )
            self.assertEqual(validate_single_action(record, mask), record)

        self.assertEqual(
            records[0]["action"]["target_component_refs"],
            [task["components"][0]],
        )
        self.assertEqual(
            records[1]["action"]["component_refs"], [task["components"][1]]
        )
        self.assertEqual(
            records[2]["action"]["request"]["focus_component_refs"],
            [task["components"][1]],
        )

    def test_builds_real_splitting_cut(self) -> None:
        mask = np.zeros((20, 40), dtype=bool)
        mask[7:13, 3:37] = True
        task = task_for(mask)
        compact = decision(
            {
                "type": "cut",
                "bridge_component_id": 1,
                "cut": {
                    "kind": "line",
                    "points": [[20, 2], [20, 17]],
                    "width_px": 1,
                    "intent": "sever_observed_bridge",
                },
                "confidence": "medium",
                "reason_codes": ["threshold_bridge"],
            }
        )

        record = build_bound_action(task, compact, mask)

        self.assertEqual(record["action"]["bridge_component_ref"], task["components"][0])
        self.assertEqual(validate_single_action(record, mask), record)

    def test_rejects_unknown_and_duplicate_component_ids(self) -> None:
        mask = two_components()
        task = task_for(mask)
        unknown = decision(
            {
                "type": "claim_select",
                "component_ids": [999],
                "confidence": "high",
                "reason_codes": ["same_word_body"],
            }
        )
        duplicate = copy.deepcopy(unknown)
        duplicate["action"]["component_ids"] = [1, 1]

        with self.assertRaisesRegex(EnvelopeError, "missing component ID 999"):
            build_bound_action(task, unknown)
        with self.assertRaisesRegex(EnvelopeError, "duplicate component IDs"):
            build_bound_action(task, duplicate)

    def test_rejects_extra_decision_fields_at_every_level(self) -> None:
        mask = two_components()
        task = task_for(mask)
        compact = decision(
            {
                "type": "exclude",
                "component_ids": [2],
                "confidence": "high",
                "reason_codes": ["adjacent_word"],
            }
        )
        extra_root = copy.deepcopy(compact)
        extra_root["explanation"] = "not allowed"
        extra_action = copy.deepcopy(compact)
        extra_action["action"]["explanation"] = "not allowed"

        with self.assertRaisesRegex(EnvelopeError, "invalid fields"):
            build_bound_action(task, extra_root)
        with self.assertRaisesRegex(EnvelopeError, "invalid fields"):
            build_bound_action(task, extra_action)

    def test_rejects_stale_task_inventory_and_current_mask(self) -> None:
        mask = two_components()
        task = task_for(mask)
        compact = decision(
            {
                "type": "claim_select",
                "component_ids": [1],
                "confidence": "high",
                "reason_codes": ["same_word_body"],
            }
        )
        stale_inventory = copy.deepcopy(task)
        stale_inventory["component_inventory_sha256"] = "f" * 64
        stale_mask = mask.copy()
        stale_mask[10, 29] = True

        with self.assertRaisesRegex(EnvelopeError, "component table"):
            build_bound_action(stale_inventory, compact)
        with self.assertRaisesRegex(EnvelopeError, "input_state_sha256"):
            build_bound_action(task, compact, stale_mask)

    def test_rejects_cut_coordinates_outside_public_work_size(self) -> None:
        mask = np.zeros((20, 40), dtype=bool)
        mask[7:13, 3:37] = True
        task = task_for(mask)
        compact = decision(
            {
                "type": "cut",
                "bridge_component_id": 1,
                "cut": {
                    "kind": "line",
                    "points": [[40, 2], [40, 17]],
                    "width_px": 1,
                    "intent": "sever_observed_bridge",
                },
                "confidence": "medium",
                "reason_codes": ["threshold_bridge"],
            }
        )

        with self.assertRaisesRegex(EnvelopeError, "inside the work crop"):
            build_bound_action(task, compact)

    def test_rejects_public_task_mutations_that_retain_the_old_hash(self) -> None:
        mask = two_components()
        task = task_for(mask)
        compact = decision(
            {
                "type": "claim_select",
                "component_ids": [1],
                "confidence": "high",
                "reason_codes": ["same_word_body"],
            }
        )
        mutations = {
            "prior-owned refs": lambda value: value.update(
                {
                    "prior_owned_component_refs": [
                        copy.deepcopy(value["components"][1])
                    ]
                }
            ),
            "other public field": lambda value: value.update(
                {"unrelated_public_field": "tampered"}
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
                    build_bound_action(stale, compact)

    def test_path_helper_loads_builds_and_writes_canonical_json(self) -> None:
        mask = two_components()
        task = task_for(mask)
        compact = decision(
            {
                "type": "claim_select",
                "component_ids": [1],
                "confidence": "high",
                "reason_codes": ["same_word_body"],
            }
        )
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            task_path = root / "task.json"
            decision_path = root / "decision.json"
            output_path = root / "action.json"
            write_json(task_path, task)
            write_json(decision_path, compact)

            result = build_bound_action_from_paths(
                task_path, decision_path, output_path, current_mask=mask
            )

            self.assertEqual(read_json(output_path), result)
            self.assertEqual(validate_single_action(result, mask), result)


def two_components() -> np.ndarray:
    mask = np.zeros((12, 30), dtype=bool)
    mask[2:7, 2:8] = True
    mask[2:7, 17:24] = True
    return mask


def task_for(mask: np.ndarray) -> dict[str, object]:
    _, inventory = stable_components(mask)
    task: dict[str, object] = {
        "schema_version": "word-ink-agent-task-pack.v1",
        "task_id": "compact-decision-fixture",
        "turn": 0,
        "input_state_sha256": sha256_mask_pixels(mask),
        "component_inventory_sha256": component_inventory_sha256(inventory),
        "work_size_wh": [mask.shape[1], mask.shape[0]],
        "components": [component_reference(item) for item in inventory],
        "unrelated_public_field": "accepted",
    }
    task["task_pack_sha256"] = hashlib.sha256(
        canonical_json_bytes(task)
    ).hexdigest()
    return task


def decision(action: dict[str, object]) -> dict[str, object]:
    return {
        "schema_version": AGENT_OWNERSHIP_DECISION_SCHEMA_VERSION,
        "action": copy.deepcopy(action),
    }
