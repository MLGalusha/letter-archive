from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from word_envelope.semantic_binding_validation import validate_semantic_binding


def ledger() -> dict:
    return {
        "evidence_role": "sealed_evaluator_only_never_acting_input",
        "status": "complete",
        "body_human_word_number_window": {"start": 23, "end": 24},
        "lines": [
            {
                "line_id": "body-01",
                "nearby_human_masks": [
                    {"human_word_number": 23},
                    {"human_word_number": 24},
                ],
                "units": [
                    {
                        "unit_id": "body-01-U01",
                        "status": "assigned",
                        "target_human_word_numbers": [23, 24],
                        "note": "",
                    }
                ],
                "unbound_human_word_numbers": [],
                "line_note": "",
            }
        ],
    }


class SemanticBindingValidationTests(unittest.TestCase):
    def validate(self, payload: dict) -> dict:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "ledger.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            return validate_semantic_binding(path, verify_inputs=False)

    def test_many_masks_may_belong_to_one_unit(self) -> None:
        result = self.validate(ledger())
        self.assertTrue(result["passed"])
        self.assertEqual(result["assigned_mask_count"], 2)

    def test_one_mask_cannot_belong_to_two_units(self) -> None:
        payload = ledger()
        payload["lines"][0]["units"].append(
            {
                "unit_id": "body-01-U02",
                "status": "assigned",
                "target_human_word_numbers": [24],
                "note": "",
            }
        )
        result = self.validate(payload)
        self.assertFalse(result["passed"])
        self.assertTrue(any(row["kind"] == "duplicate_mask_owner" for row in result["violations"]))

    def test_unbound_mask_requires_explanation(self) -> None:
        payload = ledger()
        payload["lines"][0]["units"][0]["target_human_word_numbers"] = [23]
        payload["lines"][0]["unbound_human_word_numbers"] = [24]
        result = self.validate(payload)
        self.assertFalse(result["passed"])
        self.assertTrue(any(row["kind"] == "unexplained_unbound" for row in result["violations"]))

    def test_missing_word_requires_note(self) -> None:
        payload = ledger()
        payload["lines"][0]["units"].append(
            {
                "unit_id": "body-01-U02",
                "status": "missing",
                "target_human_word_numbers": [],
                "note": "",
            }
        )
        result = self.validate(payload)
        self.assertFalse(result["passed"])
        self.assertTrue(any(row["kind"] == "missing_exception_note" for row in result["violations"]))

    def test_omitted_mask_is_rejected(self) -> None:
        payload = ledger()
        payload["lines"][0]["units"][0]["target_human_word_numbers"] = [23]
        result = self.validate(payload)
        self.assertFalse(result["passed"])
        self.assertTrue(any(row["kind"] == "incomplete_line_coverage" for row in result["violations"]))

    def test_incomplete_template_is_rejected(self) -> None:
        payload = ledger()
        payload["status"] = "needs_adjudication"
        payload["lines"][0]["units"][0]["status"] = "needs_adjudication"
        result = self.validate(payload)
        self.assertFalse(result["passed"])
        kinds = {row["kind"] for row in result["violations"]}
        self.assertIn("incomplete_record", kinds)
        self.assertIn("incomplete_unit", kinds)


if __name__ == "__main__":
    unittest.main()
