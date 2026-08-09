from __future__ import annotations

import json
from pathlib import Path
import unittest

from jsonschema import Draft202012Validator


ROOT = Path(__file__).resolve().parents[1]
PROMPT = ROOT / "prompts/page-structure-inventory-stage-0-v1.md"
SCHEMA = ROOT / "schemas/page-structure-inventory-stage-0-decision-v1.schema.json"


class PageStructurePromptContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.prompt = PROMPT.read_text()
        self.schema = json.loads(SCHEMA.read_text())
        Draft202012Validator.check_schema(self.schema)

    def test_prompt_is_explicitly_design_only_and_has_required_safety_sections(self) -> None:
        self.assertIn("design-stage contract", self.prompt)
        self.assertIn("must not label it as a verified historical prompt", self.prompt)
        for section in (
            "<role>",
            "<authoritative_inputs>",
            "<task>",
            "<controlled_vocabularies>",
            "COMMON MISTAKES TO AVOID:",
            "<example>",
            "<verification>",
        ):
            self.assertIn(section, self.prompt)

    def test_controlled_vocabulary_in_prompt_matches_schema(self) -> None:
        definitions = self.schema["$defs"]
        enum_locations = {
            "region_kind": definitions["region"]["properties"]["region_kind"]["enum"],
            "line_legibility": definitions["line"]["properties"]["line_legibility"]["enum"],
            "boundary_status": definitions["line"]["properties"]["boundary_status"]["enum"],
            "source_start_edge": definitions["line"]["properties"]["source_start_edge"]["enum"],
            "residual_disposition": definitions["residual"]["properties"]["disposition"]["enum"],
        }
        for heading, values in enum_locations.items():
            self.assertIn(f"## {heading}", self.prompt)
            for value in values:
                self.assertIn(f"`{value}`", self.prompt)

    def test_representative_rotated_margin_decision_validates(self) -> None:
        decision = {
            "schema_version": "page-structure-inventory-decision.v1",
            "session_id": "session-1",
            "source_sha256": "1" * 64,
            "packet_sha256": "2" * 64,
            "action": {
                "type": "submit_page_structure",
                "paper_bbox_source_xywh": [18, 12, 1160, 1570],
                "regions": [
                    {
                        "region_id": "R001",
                        "order": 1,
                        "region_kind": "margin_note",
                        "bbox_source_xywh": [1030, 240, 105, 760],
                        "evidence_note": "Separate narrow writing stream.",
                    }
                ],
                "lines": [
                    {
                        "line_id": "L001",
                        "region_id": "R001",
                        "order_in_region": 1,
                        "page_reading_order": 1,
                        "bbox_source_xywh": [1040, 260, 80, 680],
                        "source_to_upright_rotation_degrees": -90,
                        "source_start_edge": "max_source_y",
                        "semantic_start_anchor_source_xy": [1080, 940],
                        "semantic_end_anchor_source_xy": [1080, 260],
                        "line_legibility": "partly_readable",
                        "boundary_status": "uncertain",
                        "evidence_note": "Reads upward after clockwise uprighting.",
                    }
                ],
                "completeness_audit": [],
                "page_note": "All visible writing streams were checked.",
            },
        }
        Draft202012Validator(self.schema).validate(decision)

    def test_near_miss_enum_and_extra_transcript_fail(self) -> None:
        validator = Draft202012Validator(self.schema)
        defer = {
            "schema_version": "page-structure-inventory-decision.v1",
            "session_id": "session-1",
            "source_sha256": "1" * 64,
            "packet_sha256": "2" * 64,
            "action": {
                "type": "defer_page",
                "reason": "unsafe ambiguity",
                "evidence_note": "Cannot identify a safe page boundary.",
                "transcript": "must not be accepted",
            },
        }
        errors = list(validator.iter_errors(defer))
        self.assertTrue(errors)


if __name__ == "__main__":
    unittest.main()
