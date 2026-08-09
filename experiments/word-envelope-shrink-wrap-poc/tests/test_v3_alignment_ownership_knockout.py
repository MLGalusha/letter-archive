from __future__ import annotations

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
SRC = ROOT / "src"
for directory in (SCRIPTS, SRC):
    if str(directory) not in sys.path:
        sys.path.insert(0, str(directory))

from build_v3_alignment_ownership_knockout import (  # noqa: E402
    AdapterError,
    build,
)
from inventory_alignment_protocol_v3 import (  # noqa: E402
    PROTOCOL_VERSION,
    STATE_SCHEMA_VERSION,
    canonical_hash,
    directed_transform_v3,
    sha256_file,
)
from word_envelope.io_utils import sha256_mask_pixels  # noqa: E402
from word_envelope.sequential_ownership import init_run  # noqa: E402


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def fixed_hash(value: str) -> str:
    import hashlib

    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def span(span_id: str, order: int, bbox: list[int], flags: list[str] | None = None) -> dict:
    return {
        "span_id": span_id,
        "order": order,
        "bbox_source_xywh": bbox,
        "visual_kind": "word_like",
        "estimated_word_count_min": 1,
        "estimated_word_count_max": 2 if flags and "wide_span" in flags else 1,
        "internal_boundary_status": "likely_multiword" if flags and "wide_span" in flags else "clear_single",
        "uncertainty_flags": flags or ["none"],
        "evidence_note": "synthetic visible Stage A evidence",
    }


def word(word_id: str, order: int, bbox: list[int], text: str) -> dict:
    return {
        "word_unit_id": word_id,
        "order": order,
        "bbox_source_xywh": bbox,
        "kind": "word",
        "text_guess": text,
        "evidence_note": "accepted synthetic graph unit",
    }


def graph(
    spans: list[dict],
    words: list[dict],
    span_word: list[tuple[str, str]],
    word_transcript: list[tuple[str, str]],
    word_proposal: list[tuple[str, str]],
    gaps: list[dict],
) -> dict:
    return {
        "inserted_visible_spans": [],
        "visible_span_order": [item["span_id"] for item in spans],
        "word_units": words,
        "span_word_edges": [
            {"span_id": span_id, "word_unit_id": word_id}
            for span_id, word_id in span_word
        ],
        "word_transcript_edges": [
            {"word_unit_id": word_id, "transcript_node_id": transcript_id}
            for word_id, transcript_id in word_transcript
        ],
        "word_proposal_edges": [
            {"word_unit_id": word_id, "proposal_node_id": proposal_id}
            for word_id, proposal_id in word_proposal
        ],
        "explicit_gaps": gaps,
        "graph_note": "synthetic complete many-to-many graph",
    }


def make_line(
    line_id: str,
    reading_order: int,
    stream_id: str,
    transform: dict,
    spans: list[dict],
    words: list[dict],
    span_word: list[tuple[str, str]],
    word_transcript: list[tuple[str, str]],
    word_proposal: list[tuple[str, str]],
    gaps: list[dict],
    transcript_ids: list[str],
    proposal_ids: list[str],
) -> dict:
    return {
        "line_id": line_id,
        "line_reading_order": reading_order,
        "stream_id": stream_id,
        "wide_source_crop_xyxy": transform["source_crop_xyxy"],
        "context_padding_source_px": [10, 10],
        "directed_transform": transform,
        "morphology_axis": {
            "schema_version": "undirected-morphology-axis.v3",
            "axis_degrees": abs(transform["source_to_upright_rotation_degrees"]),
            "directed_reading_authority": False,
            "warning": "test",
        },
        "private_untrusted_proposal_nodes": [
            {
                "proposal_node_id": node_id,
                "proposal_display_order": index,
                "bbox_source_xywh": [1, 1, 2, 2],
                "role": "untrusted_detector_region_not_a_word_claim",
            }
            for index, node_id in enumerate(proposal_ids, start=1)
        ],
        "private_rejectable_transcript_nodes": [
            {"transcript_node_id": node_id, "order": index, "text": "private"}
            for index, node_id in enumerate(transcript_ids, start=1)
        ],
        "visible_spans": spans,
        "stage_a_decision_sha256": fixed_hash(f"{line_id}-stage-a"),
        "alignment_graph": graph(
            spans, words, span_word, word_transcript, word_proposal, gaps
        ),
        "stage_b_decision_sha256": fixed_hash(f"{line_id}-stage-b"),
        "status": "alignment_complete",
    }


def make_fixture(root: Path) -> dict[str, Path]:
    source_path = root / "source.png"
    source = Image.new("RGB", (120, 160), "#253548")
    draw = ImageDraw.Draw(source)
    draw.rectangle((14, 8, 112, 153), fill="#eee4ce")
    for box in ([25, 30, 20, 15], [40, 30, 20, 15], [68, 30, 15, 15], [88, 30, 15, 15], [30, 95, 18, 12]):
        x, y, width, height = box
        draw.line((x + 2, y + height // 2, x + width - 2, y + height // 2), fill="#302820", width=2)
    source.save(source_path, format="PNG")
    source.close()

    ink_path = root / "full-source-ink-mask.png"
    mask = Image.new("L", (120, 160), 0)
    ink_draw = ImageDraw.Draw(mask)
    # Two table/surround marks must be suppressed by source-derived support.
    ink_draw.rectangle((1, 20, 5, 25), fill=255)
    ink_draw.rectangle((116, 120, 119, 125), fill=255)
    # Accepted-unit candidates, including ink in the W1/W2 bbox overlap.
    ink_draw.rectangle((28, 36, 44, 38), fill=255)
    ink_draw.rectangle((46, 36, 56, 38), fill=255)
    ink_draw.rectangle((70, 36, 79, 38), fill=255)
    ink_draw.rectangle((90, 36, 99, 38), fill=255)
    ink_draw.rectangle((33, 99, 44, 101), fill=255)
    # Retained ink outside all accepted boxes exercises exact residual.
    ink_draw.rectangle((55, 70, 60, 72), fill=255)
    mask.save(ink_path, format="PNG")
    mask.close()

    body_spans = [
        span("body-01-VS001", 1, [24, 28, 38, 20], ["wide_span", "touching_neighbors"]),
        span("body-01-VS002", 2, [66, 28, 19, 20]),
        span("body-01-VS003", 3, [86, 28, 19, 20]),
    ]
    body_words = [
        word("body-01-W001", 1, [25, 30, 20, 15], "one"),
        word("body-01-W002", 2, [40, 30, 20, 15], "two"),
        word("body-01-W003", 3, [68, 30, 15, 15], "three"),
        word("body-01-W004", 4, [88, 30, 15, 15], "four"),
    ]
    gaps = [
        {
            "node_type": "word_unit",
            "node_id": "body-01-W004",
            "missing_relation": relation,
            "reason": "detector_miss" if relation == "proposal_node" else "omitted_visible_word",
            "evidence_note": "synthetic explicit graph gap",
        }
        for relation in ("transcript_node", "proposal_node")
    ]
    body = make_line(
        "body-01",
        1,
        "main-body",
        directed_transform_v3([15, 20, 108, 55], 0),
        body_spans,
        body_words,
        [
            ("body-01-VS001", "body-01-W001"),
            ("body-01-VS001", "body-01-W002"),
            ("body-01-VS002", "body-01-W003"),
            ("body-01-VS003", "body-01-W004"),
        ],
        [
            ("body-01-W001", "body-01-T001"),
            ("body-01-W002", "body-01-T002"),
            ("body-01-W003", "body-01-T003"),
        ],
        [
            ("body-01-W001", "body-01-P001"),
            ("body-01-W002", "body-01-P001"),
            ("body-01-W002", "body-01-P002"),
            ("body-01-W003", "body-01-P003"),
        ],
        gaps,
        ["body-01-T001", "body-01-T002", "body-01-T003"],
        ["body-01-P001", "body-01-P002", "body-01-P003"],
    )

    top_spans = [span("top-01-VS001", 1, [28, 92, 22, 18])]
    top_words = [word("top-01-W001", 1, [30, 95, 18, 12], "sideways")]
    top = make_line(
        "top-01",
        2,
        "top-margin",
        directed_transform_v3([20, 80, 60, 130], -90),
        top_spans,
        top_words,
        [("top-01-VS001", "top-01-W001")],
        [("top-01-W001", "top-01-T001")],
        [("top-01-W001", "top-01-P001")],
        [],
        ["top-01-T001"],
        ["top-01-P001"],
    )

    lines = [body, top]
    history = []
    for line in lines:
        for stage, action, decision_hash in (
            ("stage_a_visible_inventory", "submit_visible_inventory", line["stage_a_decision_sha256"]),
            ("stage_b_graph_alignment", "submit_alignment_graph", line["stage_b_decision_sha256"]),
        ):
            history.append(
                {
                    "state_revision": len(history),
                    "stage": stage,
                    "line_id": line["line_id"],
                    "action_type": action,
                    "packet_sha256": fixed_hash(f"packet-{len(history)}"),
                    "decision_sha256": decision_hash,
                    "validation_sha256": fixed_hash(f"validation-{len(history)}"),
                }
            )
    state = {
        "schema_version": STATE_SCHEMA_VERSION,
        "protocol_version": PROTOCOL_VERSION,
        "trial_id": "synthetic-v3-to-ownership",
        "page_id": "synthetic-014",
        "source": {
            "path": str(source_path),
            "sha256": sha256_file(source_path),
            "size": [120, 160],
        },
        "untrusted_builder_input": {"private": "must never be exported"},
        "state_revision": len(history),
        "current_stage": "complete",
        "current_line_index": len(lines),
        "line_order": [line["line_id"] for line in lines],
        "lines": lines,
        "decision_history": history,
    }
    state["state_sha256"] = canonical_hash(state)
    state_path = root / "workflow-state-v3.json"
    write_json(state_path, state)
    return {"state": state_path, "source": source_path, "ink": ink_path}


class V3AlignmentOwnershipKnockoutTests(unittest.TestCase):
    def test_build_is_sequential_compatible_and_preserves_graph_units(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture = make_fixture(root)
            output = root / "knockout"
            manifest_path = build(fixture["state"], fixture["ink"], output)

            decision = json.loads((output / "ownership-seed-decision.json").read_text())
            units = [unit for line in decision["lines"] for unit in line["visible_units"]]
            self.assertEqual([unit["unit_id"] for unit in units], [
                "body-01-W001", "body-01-W002", "body-01-W003", "body-01-W004", "top-01-W001"
            ])
            self.assertEqual(decision["lines"][1]["directed_reading"], "bottom_to_top")
            self.assertEqual(decision["lines"][1]["visible_units"][0]["reading_order"], 1)
            self.assertEqual(units[2]["ownership_route"], "terra_box_mask")
            self.assertEqual(units[4]["ownership_route"], "sol_shared_ink")
            self.assertIn("one_span_many_words", units[0]["risk_flags"])
            self.assertIn("many_proposals_one_word", units[1]["risk_flags"])

            run_dir = root / "sequential-run"
            status = init_run(
                pass1_decision_path=output / "ownership-seed-decision.json",
                knockout_manifest_path=manifest_path,
                public_packet_path=output / "ownership-public-packet.json",
                run_dir=run_dir,
                work_padding_px=2,
                context_padding_px=5,
            )
            self.assertEqual(status["current"]["unit_id"], "body-01-W001")
            self.assertTrue((output / "diagnostics/top-margin-upright-ordering.png").is_file())

    def test_support_suppression_collision_withholding_and_exact_residual(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture = make_fixture(root)
            output = root / "knockout"
            build(fixture["state"], fixture["ink"], output)

            normalization = json.loads((output / "masks/ink-proposal-record.json").read_text())
            self.assertGreater(normalization["suppressed_outside_paper_pixels"], 0)
            self.assertEqual(
                normalization["raw_foreground_pixels"],
                normalization["retained_within_paper_pixels"] + normalization["suppressed_outside_paper_pixels"],
            )
            record = json.loads((output / "units/selection-records.json").read_text())
            summary = record["summary"]
            self.assertGreater(summary["collision_pixels"], 0)
            self.assertGreater(summary["unboxed_residual_pixels"], 0)
            self.assertTrue(summary["exact_equations"]["ink_equals_exclusive_union_plus_residual"])
            self.assertTrue(summary["exact_equations"]["residual_equals_collisions_plus_unboxed"])

            with Image.open(output / "masks/ink-proposal.png") as image:
                ink = np.asarray(image.convert("L")) > 0
            with Image.open(output / "masks/candidate-exclusive-union.png") as image:
                retained = np.asarray(image.convert("L")) > 0
            with Image.open(output / "masks/exact-residual.png") as image:
                residual = np.asarray(image.convert("L")) > 0
            with Image.open(output / "masks/collisions.png") as image:
                collision = np.asarray(image.convert("L")) > 0
            self.assertTrue(np.array_equal(ink, retained | residual))
            self.assertFalse(np.any(retained & residual))
            self.assertFalse(np.any(retained & collision))
            manifest = json.loads((output / "manifest.json").read_text())
            self.assertEqual(manifest["inputs"]["ink_proposal_pixel_sha256"], sha256_mask_pixels(ink))
            self.assertTrue(any(item["path"] == "masks/ink-proposal.png" for item in manifest["outputs"]))

    def test_incomplete_stale_and_overwrite_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture = make_fixture(root)
            original = json.loads(fixture["state"].read_text())

            stale_path = root / "stale.json"
            stale = copy.deepcopy(original)
            stale["lines"][0]["alignment_graph"]["word_units"][0]["text_guess"] = "drift"
            write_json(stale_path, stale)
            with self.assertRaisesRegex(AdapterError, "state_sha256 is stale"):
                build(stale_path, fixture["ink"], root / "stale-output")
            self.assertFalse((root / "stale-output").exists())

            incomplete_path = root / "incomplete.json"
            incomplete = copy.deepcopy(original)
            incomplete["current_stage"] = "stage_b_graph_alignment"
            incomplete["state_sha256"] = canonical_hash({key: value for key, value in incomplete.items() if key != "state_sha256"})
            write_json(incomplete_path, incomplete)
            with self.assertRaisesRegex(AdapterError, "must be complete"):
                build(incomplete_path, fixture["ink"], root / "incomplete-output")

            output = root / "knockout"
            build(fixture["state"], fixture["ink"], output)
            marker = output / "user-marker.txt"
            marker.write_text("preserve", encoding="utf-8")
            with self.assertRaisesRegex(AdapterError, "refusing overwrite"):
                build(fixture["state"], fixture["ink"], output)
            self.assertEqual(marker.read_text(), "preserve")

    def test_rebuild_is_byte_deterministic_and_private_state_does_not_leak(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture = make_fixture(root)
            first, second = root / "first", root / "second"
            build(fixture["state"], fixture["ink"], first)
            build(fixture["state"], fixture["ink"], second)
            first_files = sorted(path.relative_to(first) for path in first.rglob("*") if path.is_file())
            second_files = sorted(path.relative_to(second) for path in second.rglob("*") if path.is_file())
            self.assertEqual(first_files, second_files)
            for relative in first_files:
                self.assertEqual((first / relative).read_bytes(), (second / relative).read_bytes(), str(relative))
            public_bytes = (first / "ownership-public-packet.json").read_bytes() + (first / "ownership-seed-decision.json").read_bytes()
            self.assertNotIn(b"must never be exported", public_bytes)
            self.assertNotIn(b"private_rejectable_transcript_nodes", public_bytes)
            self.assertNotIn(b"private_untrusted_proposal_nodes", public_bytes)


if __name__ == "__main__":
    unittest.main()
