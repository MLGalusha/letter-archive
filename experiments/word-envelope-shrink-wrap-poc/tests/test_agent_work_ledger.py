from __future__ import annotations

import copy
import hashlib
import unittest

from word_envelope.agent_work_ledger import (
    apply_transition,
    bind_transition,
    create_work_ledger,
    next_work_item,
    page_completion,
    validate_work_ledger,
)
from word_envelope.engine import EnvelopeError
from word_envelope.io_utils import canonical_json_bytes


def digest(label: str) -> str:
    return hashlib.sha256(label.encode("utf-8")).hexdigest()


def digest_from_value(value: object) -> str:
    return hashlib.sha256(canonical_json_bytes(value)).hexdigest()


def line_spec(
    *,
    line_id: str = "body-01",
    transcript: list[tuple[str, str]] | None = None,
    visible: list[tuple[str, int]] | None = None,
    groups: list[tuple[str, list[str], list[str], int]] | None = None,
    residual: list[str] | None = None,
) -> dict:
    transcript = transcript or [("t-01", "word")]
    visible = visible or [("v-01", 0)]
    groups = groups or [("g-01", [transcript[0][0]], [visible[0][0]], 0)]
    residual = residual or []
    return {
        "line_id": line_id,
        "reading_order": 0,
        "directed_reading": {
            "source_to_upright_affine": [1, 0, 0, 0, 1, 0, 0, 0, 1],
            "upright_to_source_affine": [1, 0, 0, 0, 1, 0, 0, 0, 1],
            "start_anchor_source_xy": [900, 100],
            "end_anchor_source_xy": [100, 100],
            "upright_direction": "left_to_right",
        },
        "context": {
            "source_locator_sha256": digest(f"{line_id}-source"),
            "upright_view_sha256": digest(f"{line_id}-upright"),
            "ownership_overlay_sha256": digest(f"{line_id}-overlay"),
        },
        "transcript_units": [
            {"id": identifier, "text": text, "kind": "word", "order": index}
            for index, (identifier, text) in enumerate(transcript)
        ],
        "visible_units": [
            {
                "id": identifier,
                "order": order,
                "bbox_source_xywh": [100 + order * 80, 100, 70, 40],
                "proposed_text": None,
            }
            for identifier, order in visible
        ],
        "alignment_groups": [
            {
                "id": identifier,
                "transcript_unit_ids": transcript_ids,
                "visible_unit_ids": visible_ids,
                "order": order,
            }
            for identifier, transcript_ids, visible_ids, order in groups
        ],
        "residual_regions": [
            {
                "id": identifier,
                "order": index,
                "bbox_source_xywh": [20 + index * 80, 100, 75, 40],
                "proposed_text": "Love" if "love" in identifier else None,
                "evidence_sha256": digest(identifier),
            }
            for index, identifier in enumerate(residual)
        ],
    }


def ledger_for(line: dict) -> dict:
    return create_work_ledger(
        page_id="test-page",
        source_sha256=digest("source"),
        lines=[line],
    )


def rehash(ledger: dict) -> dict:
    forged = copy.deepcopy(ledger)
    forged.pop("ledger_sha256", None)
    forged["ledger_sha256"] = hashlib.sha256(canonical_json_bytes(forged)).hexdigest()
    return forged


def act(ledger: dict, action_type: str, payload: dict) -> dict:
    packet = next_work_item(ledger)
    action = {
        "type": action_type,
        "line_id": packet["current"]["line_id"],
        "item_id": packet["current"]["item_id"],
        "payload": payload,
    }
    return apply_transition(ledger, bind_transition(ledger, action))


def approve_registration(ledger: dict) -> dict:
    packet = next_work_item(ledger)
    return act(
        ledger,
        "approve_line_registration",
        {"directed_reading_sha256": packet["required_evidence"]["directed_reading_sha256"]},
    )


class AgentWorkLedgerTests(unittest.TestCase):
    def test_next_packet_is_deterministic_and_software_chooses_actions(self) -> None:
        ledger = ledger_for(line_spec())
        first = next_work_item(ledger)
        second = next_work_item(ledger)
        self.assertEqual(first, second)
        self.assertEqual(canonical_json_bytes(first), canonical_json_bytes(second))
        self.assertEqual(first["current"]["stage"], "line_registration")
        self.assertEqual(
            first["legal_actions"],
            ["approve_line_registration", "escalate_human"],
        )
        self.assertIn("directed_reading_sha256", first["required_evidence"])
        self.assertEqual(first["ledger_binding"]["revision"], 0)

        illegal = {
            "type": "approve_ownership",
            "line_id": "body-01",
            "item_id": "body-01",
            "payload": {
                "owned_mask_sha256": digest("mask"),
                "selection_record_sha256": digest("selection"),
            },
        }
        with self.assertRaisesRegex(EnvelopeError, "illegal for stage"):
            bind_transition(ledger, illegal)
        self.assertEqual(next_work_item(ledger), first)

    def test_stale_transition_cannot_advance_a_new_revision(self) -> None:
        ledger = ledger_for(line_spec())
        packet = next_work_item(ledger)
        transition = bind_transition(
            ledger,
            {
                "type": "approve_line_registration",
                "line_id": "body-01",
                "item_id": "body-01",
                "payload": {
                    "directed_reading_sha256": packet["required_evidence"]["directed_reading_sha256"]
                },
            },
        )
        child = apply_transition(ledger, transition)
        with self.assertRaisesRegex(EnvelopeError, "stale"):
            apply_transition(child, transition)
        self.assertEqual(child["revision"], 1)
        self.assertEqual(child["parent_ledger_sha256"], ledger["ledger_sha256"])

    def test_directed_semantic_order_is_separate_from_undirected_envelope_axis(self) -> None:
        line = line_spec()
        line["directed_reading"] = {
            "source_to_upright_affine": [0, 1, 0, -1, 0, 1200, 0, 0, 1],
            "upright_to_source_affine": [0, -1, 1200, 1, 0, 0, 0, 0, 1],
            "start_anchor_source_xy": [245, 147],
            "end_anchor_source_xy": [245, 78],
            "upright_direction": "left_to_right",
        }
        ledger = ledger_for(line)
        stored = ledger["lines"][0]["directed_reading"]
        self.assertEqual(stored["start_anchor_source_xy"], [245.0, 147.0])
        self.assertEqual(stored["end_anchor_source_xy"], [245.0, 78.0])
        self.assertNotEqual(stored["start_anchor_source_xy"][1], min(147, 78))

        broken = copy.deepcopy(line)
        broken["directed_reading"]["upright_to_source_affine"] = [1, 0, 0, 0, 1, 0, 0, 0, 1]
        with self.assertRaisesRegex(EnvelopeError, "not inverses"):
            ledger_for(broken)

    def test_wrong_transcript_is_rejected_without_advancing_the_ink(self) -> None:
        ledger = ledger_for(
            line_spec(transcript=[("t-will", "will")], visible=[("v-ink", 0)])
        )
        ledger = approve_registration(ledger)
        ledger = act(ledger, "confirm_location", {"evidence_sha256": digest("location")})
        before = next_work_item(ledger)
        self.assertEqual(before["current"], {
            "stage": "alignment", "line_id": "body-01", "item_id": "g-01", "item_kind": "alignment_group"
        })
        ledger = act(
            ledger,
            "reject_transcript",
            {
                "transcript_unit_id": "t-will",
                "replacement_text": "wish",
                "evidence_sha256": digest("visible-wish"),
            },
        )
        line = ledger["lines"][0]
        self.assertEqual(line["transcript_units"][0]["text"], "wish")
        self.assertEqual(line["transcript_units"][0]["source_text"], "will")
        self.assertEqual(line["transcript_revision"], 1)
        self.assertEqual(line["alignment_groups"][0]["ownership_status"], "blocked")
        after = next_work_item(ledger)
        self.assertEqual(after["current"]["stage"], "alignment")
        self.assertEqual(after["current"]["item_id"], "g-01")

    def test_residual_can_create_an_omitted_visible_word(self) -> None:
        ledger = ledger_for(
            line_spec(
                transcript=[("t-you", "You.")],
                visible=[("v-you", 1)],
                groups=[("g-you", ["t-you"], ["v-you"], 1)],
                residual=["r-leading-love"],
            )
        )
        ledger = approve_registration(ledger)
        ledger = act(ledger, "confirm_location", {"evidence_sha256": digest("you-location")})
        ledger = act(ledger, "accept_alignment_group", {"evidence_sha256": digest("you-alignment")})
        ledger = act(
            ledger,
            "approve_ownership",
            {
                "owned_mask_sha256": digest("you-mask"),
                "selection_record_sha256": digest("you-selection"),
            },
        )
        self.assertEqual(next_work_item(ledger)["current"]["stage"], "residual")
        ledger = act(
            ledger,
            "insert_visible_unit",
            {
                "visible_unit": {
                    "id": "v-love",
                    "order": 0,
                    "bbox_source_xywh": [20, 100, 75, 40],
                    "proposed_text": "Love",
                },
                "alignment_group": {
                    "id": "g-love-unmatched",
                    "order": 0,
                    "transcript_unit_ids": [],
                    "visible_unit_ids": ["v-love"],
                },
                "evidence_sha256": digest("residual-love"),
            },
        )
        self.assertEqual([item["text"] for item in ledger["lines"][0]["transcript_units"]], ["You."])
        self.assertEqual(ledger["lines"][0]["residual_regions"][0]["status"], "converted")
        current = next_work_item(ledger)["current"]
        self.assertEqual((current["stage"], current["item_id"]), ("location", "v-love"))

    def test_many_to_many_group_is_one_current_alignment_item(self) -> None:
        ledger = ledger_for(
            line_spec(
                transcript=[("t-felt", "[felt?]"), ("t-like", "like")],
                visible=[("v-combined", 0)],
                groups=[("g-felt-like", ["t-felt", "t-like"], ["v-combined"], 0)],
            )
        )
        ledger = approve_registration(ledger)
        ledger = act(ledger, "confirm_location", {"evidence_sha256": digest("combined-location")})
        packet = next_work_item(ledger)
        self.assertEqual(packet["current"]["item_id"], "g-felt-like")
        ledger = act(ledger, "accept_alignment_group", {"evidence_sha256": digest("many-to-many")})
        self.assertEqual(next_work_item(ledger)["current"]["stage"], "ownership")
        group = ledger["lines"][0]["alignment_groups"][0]
        self.assertEqual(group["transcript_unit_ids"], ["t-felt", "t-like"])

    def test_duplicate_owned_mask_is_rejected_but_boxes_are_not_compared(self) -> None:
        ledger = ledger_for(
            line_spec(
                transcript=[("t-i", "I"), ("t-am", "am")],
                visible=[("v-i", 0), ("v-am", 1)],
                groups=[
                    ("g-i", ["t-i"], ["v-i"], 0),
                    ("g-am", ["t-am"], ["v-am"], 1),
                ],
            )
        )
        ledger = approve_registration(ledger)
        ledger = act(ledger, "confirm_location", {"evidence_sha256": digest("loc-i")})
        ledger = act(ledger, "confirm_location", {"evidence_sha256": digest("loc-am")})
        ledger = act(ledger, "accept_alignment_group", {"evidence_sha256": digest("align-i")})
        ledger = act(ledger, "accept_alignment_group", {"evidence_sha256": digest("align-am")})
        ledger = act(
            ledger,
            "approve_ownership",
            {"owned_mask_sha256": digest("shared-mask"), "selection_record_sha256": digest("sel-i")},
        )
        packet = next_work_item(ledger)
        transition = bind_transition(
            ledger,
            {
                "type": "approve_ownership",
                "line_id": packet["current"]["line_id"],
                "item_id": packet["current"]["item_id"],
                "payload": {"owned_mask_sha256": digest("shared-mask"), "selection_record_sha256": digest("sel-am")},
            },
        )
        with self.assertRaisesRegex(EnvelopeError, "already committed"):
            apply_transition(ledger, transition)
        self.assertEqual(next_work_item(ledger)["current"]["item_id"], "g-am")

    def test_machine_completion_and_production_completion_are_distinct(self) -> None:
        ledger = ledger_for(line_spec())
        ledger = act(
            ledger,
            "escalate_human",
            {"reason": "line_registration", "evidence_sha256": digest("bad-line")},
        )
        completion = page_completion(ledger)
        self.assertTrue(completion["machine_complete"])
        self.assertFalse(completion["production_complete"])
        self.assertEqual(completion["production_status"], "machine_pass_complete_with_human_queue")
        self.assertEqual(next_work_item(ledger)["current"]["stage"], "machine_complete")

    def test_box_survives_envelope_failure_and_failure_routes_to_human(self) -> None:
        ledger = ledger_for(line_spec())
        ledger = approve_registration(ledger)
        ledger = act(ledger, "confirm_location", {"evidence_sha256": digest("location")})
        ledger = act(ledger, "accept_alignment_group", {"evidence_sha256": digest("alignment")})
        ledger = act(
            ledger,
            "approve_ownership",
            {"owned_mask_sha256": digest("owned"), "selection_record_sha256": digest("selection")},
        )
        ledger = act(ledger, "complete_residual_audit", {"evidence_sha256": digest("residual-audit")})
        ledger = act(
            ledger,
            "record_envelope",
            {"outcome": "box_only_failure", "result_sha256": digest("envelope-failure")},
        )
        group = ledger["lines"][0]["alignment_groups"][0]
        self.assertEqual(group["ownership_status"], "approved")
        self.assertEqual(group["owned_mask_sha256"], digest("owned"))
        self.assertEqual(group["envelope_status"], "box_only_failure")
        completion = page_completion(ledger)
        self.assertTrue(completion["machine_complete"])
        self.assertFalse(completion["production_complete"])
        self.assertEqual(completion["human_queue_count"], 1)

    def test_visible_inventory_is_exact_and_transcript_gaps_become_work(self) -> None:
        missing_visible = line_spec()
        missing_visible["visible_units"].append(
            {"id": "v-orphan", "order": 1, "bbox_source_xywh": [300, 100, 70, 40], "proposed_text": "lost"}
        )
        with self.assertRaisesRegex(EnvelopeError, "missing_visible=.*v-orphan"):
            ledger_for(missing_visible)

        missing_transcript = line_spec()
        missing_transcript["transcript_units"].append(
            {"id": "t-orphan", "text": "lost", "kind": "word", "order": 1}
        )
        gap_ledger = approve_registration(ledger_for(missing_transcript))
        gap_ledger = act(
            gap_ledger,
            "confirm_location",
            {"evidence_sha256": digest("known-location")},
        )
        gap = next_work_item(gap_ledger)
        self.assertEqual(gap["current"]["stage"], "alignment_gap")
        self.assertEqual(gap["current"]["item_id"], "t-orphan")
        self.assertEqual(gap["legal_actions"], ["insert_visible_unit", "escalate_human"])

        reused = line_spec()
        reused["alignment_groups"].append(
            {
                "id": "g-duplicate",
                "transcript_unit_ids": [],
                "visible_unit_ids": ["v-01"],
                "order": 1,
            }
        )
        with self.assertRaisesRegex(EnvelopeError, "duplicate_visible=.*v-01"):
            ledger_for(reused)

        duplicate_transcript = line_spec()
        duplicate_transcript["visible_units"].append(
            {"id": "v-second", "order": 1, "bbox_source_xywh": [300, 100, 70, 40], "proposed_text": "word"}
        )
        duplicate_transcript["alignment_groups"].append(
            {
                "id": "g-second",
                "transcript_unit_ids": ["t-01"],
                "visible_unit_ids": ["v-second"],
                "order": 1,
            }
        )
        with self.assertRaisesRegex(EnvelopeError, "duplicate_transcript=.*t-01"):
            ledger_for(duplicate_transcript)

    def test_duplicate_semantic_orders_are_rejected(self) -> None:
        line = line_spec(
            transcript=[("t-one", "one"), ("t-two", "two")],
            visible=[("v-one", 0), ("v-two", 1)],
            groups=[
                ("g-one", ["t-one"], ["v-one"], 0),
                ("g-two", ["t-two"], ["v-two"], 1),
            ],
        )
        line["visible_units"][1]["order"] = 0
        with self.assertRaisesRegex(EnvelopeError, "visible unit order values must be unique"):
            ledger_for(line)

    def test_rehashed_forgery_cannot_bypass_nested_evidence_or_references(self) -> None:
        ledger = approve_registration(ledger_for(line_spec()))
        missing_evidence = copy.deepcopy(ledger)
        missing_evidence["lines"][0]["visible_units"][0]["location_status"] = "approved"
        with self.assertRaisesRegex(EnvelopeError, "location_evidence_sha256"):
            validate_work_ledger(rehash(missing_evidence))

        dangling = copy.deepcopy(ledger)
        dangling["lines"][0]["alignment_groups"][0]["visible_unit_ids"] = ["ghost"]
        with self.assertRaisesRegex(EnvelopeError, "missing visible unit ghost"):
            validate_work_ledger(rehash(dangling))

        jumped_stage = copy.deepcopy(ledger)
        group = jumped_stage["lines"][0]["alignment_groups"][0]
        group.update(
            {
                "alignment_status": "approved",
                "alignment_evidence_sha256": digest("forged-alignment"),
                "ownership_status": "approved",
                "owned_mask_sha256": digest("forged-mask"),
                "selection_record_sha256": digest("forged-selection"),
                "envelope_status": "pass",
                "envelope_result_sha256": digest("forged-envelope"),
            }
        )
        jumped_stage["lines"][0]["residual_audit_status"] = "complete"
        with self.assertRaisesRegex(EnvelopeError, "alignment requires every referenced location"):
            validate_work_ledger(rehash(jumped_stage))

    def test_transcript_text_replays_from_immutable_source_and_history(self) -> None:
        ledger = approve_registration(ledger_for(line_spec()))
        forged = copy.deepcopy(ledger)
        forged["lines"][0]["transcript_units"][0]["text"] = "forged"
        forged["lines"][0]["transcript_revision"] = 1
        with self.assertRaisesRegex(EnvelopeError, "transcript_revision does not match"):
            validate_work_ledger(rehash(forged))

    def test_duplicate_line_ids_cannot_hide_incomplete_work(self) -> None:
        first = line_spec(line_id="same")
        second = line_spec(line_id="other")
        second["reading_order"] = 1
        ledger = create_work_ledger(
            page_id="test-page", source_sha256=digest("source"), lines=[first, second]
        )
        forged = copy.deepcopy(ledger)
        forged["lines"][1]["line_id"] = "same"
        with self.assertRaisesRegex(EnvelopeError, "line IDs must be unique"):
            validate_work_ledger(rehash(forged))

    def test_location_escalation_cascades_and_blocks_envelopes(self) -> None:
        ledger = approve_registration(ledger_for(line_spec()))
        ledger = act(
            ledger,
            "escalate_human",
            {"reason": "insufficient_context", "evidence_sha256": digest("clipped")},
        )
        line = ledger["lines"][0]
        group = line["alignment_groups"][0]
        self.assertEqual(line["visible_units"][0]["location_status"], "human_review")
        self.assertEqual(group["alignment_status"], "human_review")
        self.assertEqual(group["ownership_status"], "human_review")
        self.assertEqual(group["envelope_status"], "human_review")
        self.assertEqual(next_work_item(ledger)["current"]["stage"], "residual_audit")

        ledger = act(
            ledger,
            "complete_residual_audit",
            {"evidence_sha256": digest("audit-around-human-item")},
        )
        self.assertEqual(next_work_item(ledger)["current"]["stage"], "machine_complete")
        completion = page_completion(ledger)
        self.assertTrue(completion["machine_complete"])
        self.assertFalse(completion["production_complete"])
        self.assertIn("body-01:envelope:g-01:human_review", completion["blockers"])

    def test_human_status_cannot_survive_without_bound_queue_evidence(self) -> None:
        ledger = ledger_for(line_spec())
        ledger = act(
            ledger,
            "escalate_human",
            {"reason": "line_registration", "evidence_sha256": digest("bad-line")},
        )
        forged = copy.deepcopy(ledger)
        forged["human_queue"] = []
        with self.assertRaisesRegex(EnvelopeError, "missing its queue item"):
            validate_work_ledger(rehash(forged))

    def test_packet_contains_exact_line_inventory_action_shapes_and_routes(self) -> None:
        ledger = ledger_for(line_spec())
        packet = next_work_item(ledger)
        self.assertEqual(packet["line_context"]["line_id"], "body-01")
        self.assertEqual(packet["line_context"]["transcript_units"][0]["source_text"], "word")
        self.assertEqual(
            packet["legal_action_contracts"]["approve_line_registration"]["required"],
            ["directed_reading_sha256"],
        )
        self.assertEqual(
            packet["action_routes"]["approve_line_registration"],
            "advance_to_first_unresolved_visible_location",
        )
        self.assertEqual(
            packet["required_evidence"]["line_context_sha256"],
            digest_from_value(packet["line_context"]),
        )

    def test_alignment_gap_can_insert_missing_visual_work(self) -> None:
        line = line_spec(
            transcript=[("t-known", "known"), ("t-missing", "missing")],
            visible=[("v-known", 0)],
            groups=[("g-known", ["t-known"], ["v-known"], 0)],
        )
        ledger = approve_registration(ledger_for(line))
        ledger = act(
            ledger,
            "confirm_location",
            {"evidence_sha256": digest("known-location")},
        )
        self.assertEqual(next_work_item(ledger)["current"]["stage"], "alignment_gap")
        ledger = act(
            ledger,
            "insert_visible_unit",
            {
                "visible_unit": {
                    "id": "v-missing",
                    "order": 1,
                    "bbox_source_xywh": [240, 100, 90, 40],
                    "proposed_text": "missing",
                },
                "alignment_group": {
                    "id": "g-missing",
                    "order": 1,
                    "transcript_unit_ids": ["t-missing"],
                    "visible_unit_ids": ["v-missing"],
                },
                "evidence_sha256": digest("located-missing"),
            },
        )
        current = next_work_item(ledger)["current"]
        self.assertEqual((current["stage"], current["item_id"]), ("location", "v-missing"))

    def test_insert_is_fully_preflighted_before_a_transition_is_bound(self) -> None:
        ledger = ledger_for(
            line_spec(
                transcript=[("t-you", "You")],
                visible=[("v-you", 1)],
                groups=[("g-you", ["t-you"], ["v-you"], 1)],
                residual=["r-leading-love"],
            )
        )
        ledger = approve_registration(ledger)
        ledger = act(ledger, "confirm_location", {"evidence_sha256": digest("loc")})
        ledger = act(ledger, "accept_alignment_group", {"evidence_sha256": digest("align")})
        ledger = act(
            ledger,
            "approve_ownership",
            {"owned_mask_sha256": digest("mask"), "selection_record_sha256": digest("selection")},
        )
        packet = next_work_item(ledger)

        reused_transcript = {
            "type": "insert_visible_unit",
            "line_id": packet["current"]["line_id"],
            "item_id": packet["current"]["item_id"],
            "payload": {
                "visible_unit": {
                    "id": "v-love",
                    "order": 0,
                    "bbox_source_xywh": [20, 100, 75, 40],
                    "proposed_text": "Love",
                },
                "alignment_group": {
                    "id": "g-love",
                    "order": 0,
                    "transcript_unit_ids": ["t-you"],
                    "visible_unit_ids": ["v-love"],
                },
                "evidence_sha256": digest("residual"),
            },
        }
        with self.assertRaisesRegex(EnvelopeError, "cannot reuse an aligned transcript"):
            bind_transition(ledger, reused_transcript)

        duplicate_order = copy.deepcopy(reused_transcript)
        duplicate_order["payload"]["alignment_group"]["transcript_unit_ids"] = []
        duplicate_order["payload"]["visible_unit"]["order"] = 1
        with self.assertRaisesRegex(EnvelopeError, "visible unit order already exists"):
            bind_transition(ledger, duplicate_order)


if __name__ == "__main__":
    unittest.main()
