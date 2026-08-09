from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

from word_envelope import agent_work_ledger as ledger_module
from word_envelope.agent_work_ledger import bind_agent_decision, create_work_ledger
from word_envelope.engine import EnvelopeError


ROOT = Path(__file__).resolve().parents[1]
PROMPT = ROOT / "prompts/word-work-supervised-step-v1.md"
SCHEMA = ROOT / "schemas/word-work-decision-v1.schema.json"
SHA = "a" * 64


def section_values(text: str, heading: str) -> set[str]:
    match = re.search(
        rf"^## {re.escape(heading)}\n(?P<body>.*?)(?=^## |^</controlled_vocabularies>)",
        text,
        flags=re.MULTILINE | re.DOTALL,
    )
    if match is None:
        raise AssertionError(f"missing prompt vocabulary section: {heading}")
    return set(re.findall(r'^- `"([^"`]+)"', match.group("body"), re.MULTILINE))


def action_variants(schema: dict) -> dict[str, dict]:
    return {
        variant["properties"]["type"]["const"]: variant
        for variant in schema["$defs"]["action"]["oneOf"]
    }


def sample_ledger() -> dict:
    line = {
        "line_id": "line-01",
        "reading_order": 0,
        "directed_reading": {
            "source_to_upright_affine": [1, 0, 0, 0, 1, 0, 0, 0, 1],
            "upright_to_source_affine": [1, 0, 0, 0, 1, 0, 0, 0, 1],
            "start_anchor_source_xy": [0, 0],
            "end_anchor_source_xy": [100, 0],
            "upright_direction": "left_to_right",
        },
        "context": {
            "source_locator_sha256": SHA,
            "upright_view_sha256": "b" * 64,
            "ownership_overlay_sha256": "c" * 64,
        },
        "transcript_units": [{"id": "t-01", "text": "word", "kind": "word", "order": 0}],
        "visible_units": [{"id": "v-01", "order": 0, "bbox_source_xywh": [0, 0, 20, 10], "proposed_text": None}],
        "alignment_groups": [{"id": "g-01", "transcript_unit_ids": ["t-01"], "visible_unit_ids": ["v-01"], "order": 0}],
        "residual_regions": [{
            "id": "r-01",
            "order": 0,
            "bbox_source_xywh": [40, 0, 10, 10],
            "proposed_text": None,
            "evidence_sha256": "d" * 64,
        }],
    }
    return create_work_ledger(page_id="page-01", source_sha256="e" * 64, lines=[line])


class WordWorkPromptContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.prompt = PROMPT.read_text(encoding="utf-8")
        cls.schema = json.loads(SCHEMA.read_text(encoding="utf-8"))

    def test_action_enum_matches_schema_engine_and_prompt_exactly(self) -> None:
        schema_actions = set(action_variants(self.schema))
        prompt_actions = section_values(self.prompt, "action.type")
        state = sample_ledger()
        line = state["lines"][0]
        completion = ledger_module.page_completion(state)
        items = {
            "line_registration": None,
            "location": line["visible_units"][0],
            "alignment_gap": line["transcript_units"][0],
            "alignment": line["alignment_groups"][0],
            "ownership": line["alignment_groups"][0],
            "residual": line["residual_regions"][0],
            "residual_audit": None,
            "envelope": line["alignment_groups"][0],
        }
        engine_actions = {
            action
            for stage, item in items.items()
            for action in ledger_module._work_packet(
                state, line, stage, item, completion
            )["legal_actions"]
        }
        self.assertEqual(schema_actions, engine_actions)
        self.assertEqual(schema_actions, ledger_module.WORK_ACTION_TYPES)
        self.assertEqual(prompt_actions, engine_actions)
        self.assertIn("`alignment_gap`", self.prompt)

    def test_all_controlled_schema_enums_are_printed_exactly(self) -> None:
        variants = action_variants(self.schema)
        residual = set(
            variants["classify_residual"]["properties"]["payload"]["properties"]["disposition"]["enum"]
        )
        outcome = set(
            variants["record_envelope"]["properties"]["payload"]["properties"]["outcome"]["enum"]
        )
        human = set(
            variants["escalate_human"]["properties"]["payload"]["properties"]["reason"]["enum"]
        )
        self.assertEqual(residual, section_values(self.prompt, "classify_residual.payload.disposition"))
        self.assertEqual(outcome, section_values(self.prompt, "record_envelope.payload.outcome"))
        self.assertEqual(human, section_values(self.prompt, "escalate_human.payload.reason"))

    def test_prompt_examples_are_complete_strict_schema_variants(self) -> None:
        examples = [
            json.loads(value)
            for value in re.findall(
                r"```agent-response-json\n(.*?)\n```", self.prompt, re.DOTALL
            )
        ]
        self.assertEqual(len(examples), 5)
        variants = action_variants(self.schema)
        for decision in examples:
            self.assertEqual(set(decision), {"schema_version", "action"})
            self.assertEqual(decision["schema_version"], "word-work-decision.v1")
            action = decision["action"]
            variant = variants[action["type"]]
            self.assertEqual(set(action), set(variant["required"]))
            self.assertFalse(variant["additionalProperties"])
            payload_schema = variant["properties"]["payload"]
            self.assertEqual(set(action["payload"]), set(payload_schema["required"]))
            self.assertFalse(payload_schema["additionalProperties"])

    def test_bind_agent_decision_rejects_illegal_stage_wrong_item_and_extra_fields(self) -> None:
        state = sample_ledger()
        packet = ledger_module.next_work_item(state)
        valid = {
            "schema_version": "word-work-decision.v1",
            "action": {
                "type": "approve_line_registration",
                "line_id": packet["current"]["line_id"],
                "item_id": packet["current"]["item_id"],
                "payload": {
                    "directed_reading_sha256": packet["required_evidence"]["directed_reading_sha256"]
                },
            },
        }
        self.assertEqual(bind_agent_decision(state, valid)["action"], valid["action"])

        illegal = json.loads(json.dumps(valid))
        illegal["action"] = {
            "type": "approve_ownership",
            "line_id": "line-01",
            "item_id": "line-01",
            "payload": {"owned_mask_sha256": SHA, "selection_record_sha256": SHA},
        }
        with self.assertRaisesRegex(EnvelopeError, "illegal for stage"):
            bind_agent_decision(state, illegal)

        wrong_item = json.loads(json.dumps(valid))
        wrong_item["action"]["item_id"] = "not-current"
        with self.assertRaisesRegex(EnvelopeError, "non-current"):
            bind_agent_decision(state, wrong_item)

        extra = json.loads(json.dumps(valid))
        extra["commentary"] = "not allowed"
        with self.assertRaisesRegex(EnvelopeError, "invalid fields"):
            bind_agent_decision(state, extra)


if __name__ == "__main__":
    unittest.main()
