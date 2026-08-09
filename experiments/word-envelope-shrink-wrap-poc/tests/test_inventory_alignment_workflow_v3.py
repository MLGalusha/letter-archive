from __future__ import annotations

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from inventory_alignment_protocol_v3 import (  # noqa: E402
    ProtocolV3Error,
    apply_affine,
    apply_decision_files_v3,
    directed_transform_v3,
    initialize_workflow_v3,
    load_packet_v3,
    load_state_v3,
    sha256_file,
    validate_decision_v3,
)


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n")


def make_fixture(
    temporary: Path,
    *,
    units: list[dict],
    line_order: list[str],
    stream_reading: dict | None = None,
    page_id: str = "synthetic-v3",
) -> tuple[dict, Path]:
    source_path = temporary / "source-fixture-v3.png"
    source = Image.new("RGB", (1600, 1000), "#eee7d5")
    draw = ImageDraw.Draw(source)
    for index, unit in enumerate(units, start=1):
        x, y, width, height = unit["source_axis_aligned_bbox_xywh"]
        draw.text((x + 5, y + 8), f"ink{index}", fill="#1d1a17")
        draw.line((x, y + height // 2, x + width, y + height // 2), fill="#3b3028", width=2)
    source.save(source_path, format="PNG")
    source.close()

    prior_path = temporary / "untrusted-prior-fixture-v3.json"
    prior_units = []
    for unit in units:
        prior_units.append(
            {
                **unit,
                "hidden_review_status": "HIDDEN_STATUS_MUST_NOT_LEAK",
                "ground_truth": "HIDDEN_TRUTH_MUST_NOT_LEAK",
                "confidence": 0.999,
            }
        )
    write_json(prior_path, {"units": prior_units, "hidden_summary": "PRIVATE_ONLY"})

    streams = stream_reading or {
        "main-body": {
            "source_to_upright_rotation_degrees": 0,
            "morphology_axis_degrees_undirected": 0,
        }
    }
    spec = {
        "schema_version": "inventory-alignment-page-spec.v3",
        "trial_id": "synthetic-inventory-alignment-v3",
        "page_id": page_id,
        "source_path": str(source_path),
        "source_sha256": sha256_file(source_path),
        "untrusted_prior_path": str(prior_path),
        "untrusted_prior_sha256": sha256_file(prior_path),
        "line_order": line_order,
        "stream_reading": streams,
        "context_padding_source_px": [180, 160],
    }
    return spec, source_path


def decision_binding(state: dict, packet: dict, schema_version: str) -> dict:
    return {
        "schema_version": schema_version,
        "trial_id": state["trial_id"],
        "page_id": state["page_id"],
        "line_id": packet["current"]["line_id"],
        "stage": packet["current"]["stage"],
        "state_revision": state["state_revision"],
        "state_sha256": state["state_sha256"],
        "packet_sha256": packet["packet_sha256"],
    }


def stage_a_span(
    order: int,
    bbox: list[int],
    *,
    visual_kind: str = "word_like",
    minimum: int = 1,
    maximum: int = 1,
    boundary: str = "clear_single",
    flags: list[str] | None = None,
    note: str = "visible in the plain source",
) -> dict:
    return {
        "order": order,
        "bbox_source_xywh": bbox,
        "visual_kind": visual_kind,
        "estimated_word_count_min": minimum,
        "estimated_word_count_max": maximum,
        "internal_boundary_status": boundary,
        "uncertainty_flags": flags or ["none"],
        "evidence_note": note,
    }


def make_stage_a_decision(state: dict, packet: dict, spans: list[dict]) -> dict:
    return {
        **decision_binding(state, packet, "inventory-stage-a-decision.v3"),
        "action": {
            "type": "submit_visible_inventory",
            "visible_span_count": len(spans),
            "spans": spans,
            "line_note": "Inventoried from wide lossless pixels without text or detector rectangles.",
        },
    }


def apply_stage_a(
    workflow_root: Path,
    state_path: Path,
    packet_path: Path,
    spans: list[dict],
) -> tuple[dict, dict, Path, dict]:
    state = load_state_v3(state_path)
    packet = load_packet_v3(packet_path)
    decision = make_stage_a_decision(state, packet, spans)
    decision_path = workflow_root / "private/stage-a-decision-v3.json"
    write_json(decision_path, decision)
    result = apply_decision_files_v3(
        state_path, packet_path, decision_path, workflow_root
    )
    next_packet_path = result["next_packet_path"]
    assert next_packet_path is not None
    return result["state"], load_packet_v3(next_packet_path), next_packet_path, decision


def body10_units() -> list[dict]:
    return [
        {
            "line_id": "heldout-body-10-shape",
            "stream_id": "main-body",
            "source_axis_aligned_bbox_xywh": [240, 330, 320, 90],
            "transcript": "guess you",
        },
        {
            "line_id": "heldout-body-10-shape",
            "stream_id": "main-body",
            "source_axis_aligned_bbox_xywh": [600, 330, 30, 90],
            "transcript": "",
        },
        {
            "line_id": "heldout-body-10-shape",
            "stream_id": "main-body",
            "source_axis_aligned_bbox_xywh": [700, 330, 75, 90],
            "transcript": "today",
        },
        {
            "line_id": "heldout-body-10-shape",
            "stream_id": "main-body",
            "source_axis_aligned_bbox_xywh": [770, 330, 85, 90],
            "transcript": "",
        },
    ]


def body10_spans() -> list[dict]:
    return [
        stage_a_span(
            1,
            [235, 325, 335, 100],
            minimum=1,
            maximum=2,
            boundary="likely_multiword",
            flags=["wide_span", "touching_neighbors"],
            note="One wide visible span has a plausible internal word boundary.",
        ),
        stage_a_span(
            2,
            [595, 340, 38, 65],
            visual_kind="punctuation",
            minimum=0,
            maximum=0,
            boundary="not_applicable",
            flags=["punctuation_uncertain"],
            note="A small punctuation-only mark is visibly separate.",
        ),
        stage_a_span(
            3,
            [695, 325, 165, 100],
            boundary="clear_single",
            flags=["fragmented"],
            note="Two fragments appear to form one visible word.",
        ),
    ]


def body10_graph_decision(state: dict, packet: dict) -> dict:
    line_id = packet["current"]["line_id"]
    spans = [f"{line_id}-VS{index:03d}" for index in range(1, 4)]
    words = [f"{line_id}-W{index:03d}" for index in range(1, 5)]
    transcripts = [
        node["transcript_node_id"]
        for node in packet["revealed_rejectable_transcript"]["nodes"]
    ]
    proposals = [
        node["proposal_node_id"]
        for node in packet["revealed_untrusted_detector"]["proposal_nodes"]
    ]
    word_units = [
        {
            "word_unit_id": words[0],
            "order": 1,
            "bbox_source_xywh": [240, 330, 145, 90],
            "kind": "word",
            "text_guess": "guess",
            "evidence_note": "left word within the wide span",
        },
        {
            "word_unit_id": words[1],
            "order": 2,
            "bbox_source_xywh": [390, 330, 170, 90],
            "kind": "word",
            "text_guess": "you",
            "evidence_note": "right word within the same detector region",
        },
        {
            "word_unit_id": words[2],
            "order": 3,
            "bbox_source_xywh": [600, 340, 30, 65],
            "kind": "punctuation",
            "text_guess": ",",
            "evidence_note": "punctuation-only unit",
        },
        {
            "word_unit_id": words[3],
            "order": 4,
            "bbox_source_xywh": [700, 330, 155, 90],
            "kind": "word",
            "text_guess": "today",
            "evidence_note": "one fragmented word across two proposals",
        },
    ]
    graph = {
        "inserted_visible_spans": [],
        "visible_span_order": spans,
        "word_units": word_units,
        "span_word_edges": [
            {"span_id": spans[0], "word_unit_id": words[0]},
            {"span_id": spans[0], "word_unit_id": words[1]},
            {"span_id": spans[1], "word_unit_id": words[2]},
            {"span_id": spans[2], "word_unit_id": words[3]},
        ],
        "word_transcript_edges": [
            {"word_unit_id": words[0], "transcript_node_id": transcripts[0]},
            {"word_unit_id": words[1], "transcript_node_id": transcripts[1]},
            {"word_unit_id": words[3], "transcript_node_id": transcripts[2]},
        ],
        "word_proposal_edges": [
            {"word_unit_id": words[0], "proposal_node_id": proposals[0]},
            {"word_unit_id": words[1], "proposal_node_id": proposals[0]},
            {"word_unit_id": words[2], "proposal_node_id": proposals[1]},
            {"word_unit_id": words[3], "proposal_node_id": proposals[2]},
            {"word_unit_id": words[3], "proposal_node_id": proposals[3]},
        ],
        "explicit_gaps": [
            {
                "node_type": "word_unit",
                "node_id": words[2],
                "missing_relation": "transcript_node",
                "reason": "punctuation_untranscribed",
                "evidence_note": "visible punctuation is absent from the text suggestion",
            }
        ],
        "graph_note": "Retains one-proposal/two-word, punctuation-only, and two-proposal/one-word cardinalities.",
    }
    return {
        **decision_binding(state, packet, "alignment-stage-b-decision.v3"),
        "action": {"type": "submit_alignment_graph", "graph": graph},
    }


class InventoryAlignmentWorkflowV3Tests(unittest.TestCase):
    def test_stage_a_physically_hides_text_boxes_and_hidden_review_state(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory)
            secret = "ANCHOR_SECRET_TRANSCRIPT"
            units = [
                {
                    "line_id": "line-01",
                    "stream_id": "main-body",
                    "source_axis_aligned_bbox_xywh": [300, 300, 420, 90],
                    "transcript": secret,
                }
            ]
            spec, source_path = make_fixture(
                temporary, units=units, line_order=["line-01"]
            )
            workflow_root = temporary / "workflow-v3"
            initialized = initialize_workflow_v3(spec, workflow_root)
            packet_path = initialized["packet_path"]
            packet = load_packet_v3(packet_path)
            state = load_state_v3(initialized["state_path"])

            public_text = packet_path.read_text()
            self.assertNotIn(secret, public_text)
            self.assertNotIn("proposal_node_id", public_text)
            self.assertNotIn("bbox_source_xywh", public_text)
            self.assertNotIn("HIDDEN_STATUS_MUST_NOT_LEAK", json.dumps(state))
            self.assertNotIn("HIDDEN_TRUTH_MUST_NOT_LEAK", json.dumps(state))
            self.assertFalse(packet["stage_contract"]["transcript_access"])
            self.assertFalse(packet["stage_contract"]["detector_word_box_access"])

            stage_a_files = sorted(path.name for path in packet_path.parent.iterdir())
            self.assertEqual(
                stage_a_files,
                [
                    "line-locator-v3.png",
                    "run-packet-v3.json",
                    "upright-plain-v3.png",
                    "wide-source-plain-v3.png",
                ],
            )
            wide_path = workflow_root / packet["evidence"]["wide_source_plain"]["path"]
            with Image.open(source_path) as source, Image.open(wide_path) as observed:
                expected = source.convert("RGB").crop(
                    tuple(packet["evidence"]["wide_source_plain"]["source_crop_xyxy"])
                )
                self.assertIsNone(ImageChops.difference(expected, observed.convert("RGB")).getbbox())
                expected.close()

            spans = [stage_a_span(1, [295, 295, 430, 100])]
            next_state, stage_b, _, _ = apply_stage_a(
                workflow_root,
                initialized["state_path"],
                packet_path,
                spans,
            )
            self.assertIn(
                secret,
                " ".join(
                    node["text"]
                    for node in stage_b["revealed_rejectable_transcript"]["nodes"]
                ),
            )
            self.assertEqual(
                len(stage_b["revealed_untrusted_detector"]["proposal_nodes"]), 1
            )
            self.assertEqual(next_state["current_stage"], "stage_b_graph_alignment")

    def test_body10_shaped_graph_accepts_true_many_to_many_and_punctuation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory)
            spec, _ = make_fixture(
                temporary,
                units=body10_units(),
                line_order=["heldout-body-10-shape"],
            )
            workflow_root = temporary / "workflow-v3"
            initialized = initialize_workflow_v3(spec, workflow_root)
            state, packet, _, _ = apply_stage_a(
                workflow_root,
                initialized["state_path"],
                initialized["packet_path"],
                body10_spans(),
            )
            decision = body10_graph_decision(state, packet)
            result = validate_decision_v3(state, packet, decision)
            features = result["details"]["cardinality_features"]
            self.assertTrue(features["one_span_to_many_words"])
            self.assertTrue(features["one_proposal_to_many_words"])
            self.assertTrue(features["many_proposals_to_one_word"])
            self.assertEqual(result["details"]["word_unit_count"], 4)
            self.assertEqual(result["details"]["explicit_gap_count"], 1)

    def test_love_shaped_omission_is_inserted_with_two_explicit_gaps(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory)
            units = [
                {
                    "line_id": "love-gap-line",
                    "stream_id": "main-body",
                    "source_axis_aligned_bbox_xywh": [400, 300, 150, 90],
                    "transcript": "you",
                }
            ]
            spec, _ = make_fixture(
                temporary, units=units, line_order=["love-gap-line"]
            )
            workflow_root = temporary / "workflow-v3"
            initialized = initialize_workflow_v3(spec, workflow_root)
            state, packet, _, _ = apply_stage_a(
                workflow_root,
                initialized["state_path"],
                initialized["packet_path"],
                [stage_a_span(1, [395, 295, 160, 100])],
            )
            line_id = "love-gap-line"
            inserted_id = packet["software_allocated_ids"][
                "inserted_visible_span_ids_in_order"
            ][0]
            word_ids = packet["software_allocated_ids"]["word_unit_ids_in_order"][:2]
            transcript_id = packet["revealed_rejectable_transcript"]["nodes"][0][
                "transcript_node_id"
            ]
            proposal_id = packet["revealed_untrusted_detector"]["proposal_nodes"][0][
                "proposal_node_id"
            ]
            graph = {
                "inserted_visible_spans": [
                    {
                        "span_id": inserted_id,
                        **stage_a_span(
                            1,
                            [225, 295, 145, 100],
                            note="Leading Love-shaped word was missed in Stage A.",
                        ),
                    }
                ],
                "visible_span_order": [inserted_id, f"{line_id}-VS001"],
                "word_units": [
                    {
                        "word_unit_id": word_ids[0],
                        "order": 1,
                        "bbox_source_xywh": [225, 295, 145, 100],
                        "kind": "word",
                        "text_guess": "Love",
                        "evidence_note": "visible leading word",
                    },
                    {
                        "word_unit_id": word_ids[1],
                        "order": 2,
                        "bbox_source_xywh": [400, 300, 150, 90],
                        "kind": "word",
                        "text_guess": "you",
                        "evidence_note": "visible proposed word",
                    },
                ],
                "span_word_edges": [
                    {"span_id": inserted_id, "word_unit_id": word_ids[0]},
                    {"span_id": f"{line_id}-VS001", "word_unit_id": word_ids[1]},
                ],
                "word_transcript_edges": [
                    {"word_unit_id": word_ids[1], "transcript_node_id": transcript_id}
                ],
                "word_proposal_edges": [
                    {"word_unit_id": word_ids[1], "proposal_node_id": proposal_id}
                ],
                "explicit_gaps": [
                    {
                        "node_type": "word_unit",
                        "node_id": word_ids[0],
                        "missing_relation": "transcript_node",
                        "reason": "omitted_visible_word",
                        "evidence_note": "Love is visible but absent from text suggestion.",
                    },
                    {
                        "node_type": "word_unit",
                        "node_id": word_ids[0],
                        "missing_relation": "proposal_node",
                        "reason": "detector_miss",
                        "evidence_note": "Love is visible but has no detector region.",
                    },
                ],
                "graph_note": "Inserted omitted visible Love without inventing text or detector nodes.",
            }
            decision = {
                **decision_binding(state, packet, "alignment-stage-b-decision.v3"),
                "action": {"type": "submit_alignment_graph", "graph": graph},
            }
            result = validate_decision_v3(state, packet, decision)
            self.assertEqual(result["details"]["inserted_visible_span_count"], 1)
            self.assertEqual(result["details"]["explicit_gap_count"], 2)

    def test_stale_stage_and_illegal_action_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory)
            spec, _ = make_fixture(
                temporary,
                units=body10_units(),
                line_order=["heldout-body-10-shape"],
            )
            workflow_root = temporary / "workflow-v3"
            initialized = initialize_workflow_v3(spec, workflow_root)
            old_state = load_state_v3(initialized["state_path"])
            old_packet = load_packet_v3(initialized["packet_path"])
            old_decision = make_stage_a_decision(old_state, old_packet, body10_spans())
            state, packet, _, _ = apply_stage_a(
                workflow_root,
                initialized["state_path"],
                initialized["packet_path"],
                body10_spans(),
            )
            with self.assertRaisesRegex(ProtocolV3Error, "stale"):
                validate_decision_v3(state, old_packet, old_decision)

            illegal = {
                **decision_binding(state, packet, "alignment-stage-b-decision.v3"),
                "action": {
                    "type": "submit_visible_inventory",
                    "visible_span_count": 1,
                    "spans": [body10_spans()[0]],
                    "line_note": "wrong stage",
                },
            }
            with self.assertRaisesRegex(ProtocolV3Error, "illegal"):
                validate_decision_v3(state, packet, illegal)

    def test_duplicate_edges_and_orphan_nodes_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory)
            spec, _ = make_fixture(
                temporary,
                units=body10_units(),
                line_order=["heldout-body-10-shape"],
            )
            workflow_root = temporary / "workflow-v3"
            initialized = initialize_workflow_v3(spec, workflow_root)
            state, packet, _, _ = apply_stage_a(
                workflow_root,
                initialized["state_path"],
                initialized["packet_path"],
                body10_spans(),
            )
            valid = body10_graph_decision(state, packet)

            duplicate = copy.deepcopy(valid)
            duplicate["action"]["graph"]["word_proposal_edges"].append(
                copy.deepcopy(duplicate["action"]["graph"]["word_proposal_edges"][0])
            )
            with self.assertRaisesRegex(ProtocolV3Error, "duplicate word-proposal edge"):
                validate_decision_v3(state, packet, duplicate)

            orphan = copy.deepcopy(valid)
            orphan["action"]["graph"]["word_transcript_edges"][0][
                "transcript_node_id"
            ] = "heldout-body-10-shape-T999"
            with self.assertRaisesRegex(ProtocolV3Error, "orphan node reference"):
                validate_decision_v3(state, packet, orphan)

    def test_clockwise_top_margin_round_trip_cannot_reverse_semantic_pairs(self) -> None:
        transform = directed_transform_v3([100, 100, 500, 900], -90)
        self.assertEqual(transform["source_to_upright_rotation_degrees"], -90)
        self.assertEqual(transform["semantic_start_source_edge"], "max_source_y")
        self.assertEqual(transform["upright_direction"], "left_to_right")

        source_points = {
            "We": [300, 850],
            "will": [300, 780],
            "have": [300, 700],
            "a": [300, 630],
            "big": [300, 550],
            "fat": [300, 480],
            "New": [300, 400],
            "Years": [300, 330],
        }
        upright = {
            word: apply_affine(transform["source_to_upright_affine"], point)
            for word, point in source_points.items()
        }
        semantic_order = [word for word, _ in sorted(upright.items(), key=lambda item: item[1][0])]
        self.assertEqual(
            semantic_order,
            ["We", "will", "have", "a", "big", "fat", "New", "Years"],
        )
        for first, second in (("We", "will"), ("have", "a"), ("big", "fat"), ("New", "Years")):
            self.assertLess(upright[first][0], upright[second][0])
        for word, source_point in source_points.items():
            round_trip = apply_affine(
                transform["upright_to_source_affine"], upright[word]
            )
            self.assertEqual(round_trip, [float(source_point[0]), float(source_point[1])])

        raw_y_order = [word for word, _ in sorted(source_points.items(), key=lambda item: item[1][1])]
        self.assertNotEqual(raw_y_order, semantic_order)

    def test_top_margin_packet_keeps_directed_transform_separate_from_morphology(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory)
            units = [
                {
                    "line_id": "top-01",
                    "stream_id": "top-margin",
                    "source_axis_aligned_bbox_xywh": [900, 300, 100, 400],
                    "transcript": "We will",
                }
            ]
            streams = {
                "top-margin": {
                    "source_to_upright_rotation_degrees": -90,
                    "morphology_axis_degrees_undirected": 90,
                }
            }
            spec, _ = make_fixture(
                temporary,
                units=units,
                line_order=["top-01"],
                stream_reading=streams,
            )
            initialized = initialize_workflow_v3(spec, temporary / "workflow-v3")
            packet = load_packet_v3(initialized["packet_path"])
            directed = packet["evidence"]["directed_transform"]
            morphology = packet["evidence"]["morphology_axis"]
            self.assertEqual(directed["source_to_upright_rotation_degrees"], -90)
            self.assertEqual(directed["semantic_start_source_edge"], "max_source_y")
            self.assertEqual(morphology["axis_degrees"], 90)
            self.assertFalse(morphology["directed_reading_authority"])

    def test_prompts_explicitly_challenge_wide_boundaries_and_cardinality(self) -> None:
        stage_a = (ROOT / "prompts/visible-span-inventory-stage-a-v3.md").read_text()
        stage_b = (ROOT / "prompts/many-to-many-alignment-stage-b-v3.md").read_text()
        self.assertIn("lossless, unannotated wide source crop", stage_a)
        self.assertIn("wide connected-looking region may", stage_a)
        self.assertIn("one proposal node to multiple word units", stage_b)
        self.assertIn("multiple proposal nodes to one word unit", stage_b)
        self.assertIn("Preserve punctuation", stage_b)
        self.assertIn("clockwise `-90`", stage_b)


if __name__ == "__main__":
    unittest.main()
