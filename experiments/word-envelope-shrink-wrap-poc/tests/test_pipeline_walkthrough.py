from __future__ import annotations

import base64
import hashlib
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from PIL import Image, ImageDraw

from word_envelope.pipeline_walkthrough import (
    PREPARED_PROTOCOL_KIND,
    PipelineWalkthroughSession,
    SOURCE_ACTION_SCHEMA_VERSION,
    SOURCE_DESCRIPTOR_SCHEMA_VERSION,
    V3_DECISION_ENVELOPE_SCHEMA_VERSION,
    WalkthroughError,
)


ROOT = Path(__file__).resolve().parents[1]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n")


def canonical_hash(value: object) -> str:
    return hashlib.sha256(
        json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()


def make_source(directory: Path) -> Path:
    source_path = directory / "014-prepared-source.png"
    image = Image.new("RGB", (1600, 1000), "#eee7d5")
    draw = ImageDraw.Draw(image)
    draw.text((310, 325), "visible marks", fill="#17130f")
    draw.line((300, 365, 720, 365), fill="#2f261e", width=3)
    image.save(source_path, format="PNG")
    image.close()
    return source_path


def arbitrary_descriptor(source_path: Path, page_id: str = "arbitrary-page") -> dict:
    return {
        "schema_version": SOURCE_DESCRIPTOR_SCHEMA_VERSION,
        "page_id": page_id,
        "source": {"path": str(source_path)},
    }


def prepared_descriptor(
    directory: Path,
    *,
    secret_transcript: str = "SECRET_TRANSCRIPT_MUST_BE_WITHHELD_FROM_STAGE_A",
) -> tuple[dict, str]:
    source_path = make_source(directory)
    prior_path = directory / "prepared-untrusted-prior.json"
    write_json(
        prior_path,
        {
            "units": [
                {
                    "line_id": "body-01",
                    "stream_id": "main-body",
                    "source_axis_aligned_bbox_xywh": [300, 300, 430, 100],
                    "transcript": secret_transcript,
                    "hidden_review_status": "must not enter Stage A",
                }
            ]
        },
    )
    spec = {
        "schema_version": "inventory-alignment-page-spec.v3",
        "trial_id": "fresh-prepared-014-walkthrough-test",
        "page_id": "014-p04",
        "source_path": str(source_path),
        "source_sha256": sha256_file(source_path),
        "untrusted_prior_path": str(prior_path),
        "untrusted_prior_sha256": sha256_file(prior_path),
        "line_order": ["body-01"],
        "stream_reading": {
            "main-body": {
                "source_to_upright_rotation_degrees": 0,
                "morphology_axis_degrees_undirected": 0,
            }
        },
        "context_padding_source_px": [180, 160],
    }
    selected_source_path = directory / "selected-source-byte-copy.png"
    shutil.copyfile(source_path, selected_source_path)
    return (
        {
            "schema_version": SOURCE_DESCRIPTOR_SCHEMA_VERSION,
            "page_id": "014-p04",
            "source": {
                "path": str(selected_source_path),
                "sha256": sha256_file(selected_source_path),
                "size": [1600, 1000],
            },
            "prepared_protocol": {
                "kind": PREPARED_PROTOCOL_KIND,
                "spec": spec,
            },
        },
        secret_transcript,
    )


def begin_prepared(session: PipelineWalkthroughSession) -> tuple[dict, dict]:
    intake = session.current()
    stage_a = session.apply_source_action(
        {
            "schema_version": SOURCE_ACTION_SCHEMA_VERSION,
            "current_sha256": intake["current_sha256"],
            "action": {"type": "begin_prepared_protocol"},
        }
    )
    return intake, stage_a


def stage_a_decision(current: dict) -> dict:
    packet = current["agent_turn"]["public_packet"]["json"]
    return {
        "schema_version": "inventory-stage-a-decision.v3",
        "trial_id": packet["trial_id"],
        "page_id": packet["page_id"],
        "line_id": packet["current"]["line_id"],
        "stage": packet["current"]["stage"],
        "state_revision": packet["state_revision"],
        "state_sha256": packet["state_sha256"],
        "packet_sha256": packet["packet_sha256"],
        "action": {
            "type": "submit_visible_inventory",
            "visible_span_count": 1,
            "spans": [
                {
                    "order": 1,
                    "bbox_source_xywh": [295, 295, 440, 110],
                    "visual_kind": "word_like",
                    "estimated_word_count_min": 1,
                    "estimated_word_count_max": 2,
                    "internal_boundary_status": "possible_multiword",
                    "uncertainty_flags": ["wide_span"],
                    "evidence_note": "A wide connected-looking region may contain two words.",
                }
            ],
            "line_note": "Inventoried only from the new session's plain pixel evidence.",
        },
    }


class PipelineWalkthroughTests(unittest.TestCase):
    def test_arbitrary_source_starts_at_explicit_six_capability_blocker(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory)
            source_path = make_source(temporary)
            session = PipelineWalkthroughSession.create(
                temporary / "session", arbitrary_descriptor(source_path)
            )

            current = session.current()

            self.assertEqual(current["stage"], "source_intake")
            self.assertEqual(current["status"], "blocked")
            self.assertEqual(current["legal_actions"], [])
            self.assertEqual(current["blocker"]["code"], "missing_source_preparation")
            capabilities = current["blocker"]["missing_capabilities"]
            self.assertEqual(len(capabilities), 6)
            self.assertEqual(len({item["id"] for item in capabilities}), 6)
            graph = current["stage_graph"]
            nodes = {node["id"]: node for node in graph["nodes"]}
            self.assertEqual(nodes["source_intake"]["status"], "complete")
            self.assertEqual(nodes["source_preparation"]["status"], "blocked")
            self.assertEqual(len(graph["nodes"]), 9)
            self.assertIn(
                "claimed_mask_to_envelope_handoff",
                {node["id"] for node in graph["nodes"]},
            )
            self.assertIn(
                "missing_claimed_mask_to_envelope_handoff",
                {edge["blocker_code"] for edge in graph["edges"]},
            )

            with self.assertRaises(WalkthroughError) as raised:
                session.apply_source_action(
                    {
                        "schema_version": SOURCE_ACTION_SCHEMA_VERSION,
                        "current_sha256": current["current_sha256"],
                        "action": {"type": "begin_prepared_protocol"},
                    }
                )
            self.assertEqual(raised.exception.code, "missing_source_preparation")

    def test_fresh_prepared_014_stage_a_withholds_transcript_and_binds_exact_bytes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory)
            descriptor, secret = prepared_descriptor(temporary)
            session = PipelineWalkthroughSession.create(temporary / "session", descriptor)

            intake, current = begin_prepared(session)

            self.assertEqual(intake["stage"], "source_intake")
            self.assertEqual(intake["legal_actions"], ["begin_prepared_protocol"])
            intake_nodes = {
                node["id"]: node for node in intake["stage_graph"]["nodes"]
            }
            self.assertEqual(
                intake_nodes["stage_a_visible_inventory"]["detail"],
                "Available after the prepared protocol begins.",
            )
            self.assertEqual(
                intake_nodes["stage_b_graph_alignment"]["detail"],
                "Available after the current line inventory is submitted.",
            )
            self.assertEqual(current["stage"], "stage_a_visible_inventory")
            turn = current["agent_turn"]
            packet = turn["public_packet"]["json"]
            packet_bytes = base64.b64decode(turn["public_packet"]["bytes_base64"])
            self.assertNotIn(secret.encode(), packet_bytes)
            self.assertNotIn(b"proposal_node_id", packet_bytes)
            self.assertFalse(packet["stage_contract"]["transcript_access"])
            self.assertFalse(packet["stage_contract"]["detector_word_box_access"])
            self.assertEqual(
                turn["prompt"]["provenance_status"], "verified_for_this_new_session"
            )
            self.assertFalse(turn["provenance"]["historical_prompt_claim"])
            self.assertEqual(
                turn["content_order"],
                ["prompt", "public_packet", "response_schema", "evidence"],
            )
            self.assertFalse(Path(turn["prompt"]["repository_source_path"]).is_absolute())
            self.assertFalse(
                Path(turn["response_schema"]["repository_source_path"]).is_absolute()
            )

            prompt_bytes = (ROOT / "prompts/visible-span-inventory-stage-a-v3.md").read_bytes()
            schema_bytes = (ROOT / "schemas/inventory-stage-a-decision-v3.schema.json").read_bytes()
            self.assertEqual(base64.b64decode(turn["prompt"]["bytes_base64"]), prompt_bytes)
            self.assertEqual(
                base64.b64decode(turn["response_schema"]["bytes_base64"]), schema_bytes
            )
            prompt_copy = session.root / turn["prompt"]["immutable_copy_path"]
            schema_copy = session.root / turn["response_schema"]["immutable_copy_path"]
            packet_copy = session.root / turn["public_packet"]["immutable_copy_path"]
            live_packet = session.root / "protocol-v3" / turn["public_packet"]["protocol_source_path"]
            self.assertEqual(prompt_copy.read_bytes(), prompt_bytes)
            self.assertEqual(schema_copy.read_bytes(), schema_bytes)
            self.assertEqual(packet_copy.read_bytes(), live_packet.read_bytes())
            self.assertEqual(packet_copy.read_bytes(), packet_bytes)
            self.assertTrue(turn["evidence"]["files"])
            self.assertTrue(
                all(
                    item["packet_claimed_sha256"] == item["observed_file_sha256"]
                    for item in turn["evidence"]["files"]
                )
            )
            self.assertEqual(turn["legal_action_congruence"]["status"], "pass")
            self.assertTrue(
                turn["legal_action_congruence"]["response_schema_exact_set_match"]
            )
            graph_nodes = {node["id"]: node for node in current["stage_graph"]["nodes"]}
            self.assertEqual(
                graph_nodes["stage_a_visible_inventory"]["current_line_status"],
                "current",
            )
            self.assertEqual(
                graph_nodes["stage_b_graph_alignment"]["current_line_status"],
                "next",
            )

    def test_valid_stage_a_advances_to_stage_b_and_stale_turn_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory)
            descriptor, secret = prepared_descriptor(temporary)
            session = PipelineWalkthroughSession.create(temporary / "session", descriptor)
            _, stage_a = begin_prepared(session)
            decision = stage_a_decision(stage_a)
            old_envelope = {
                "schema_version": V3_DECISION_ENVELOPE_SCHEMA_VERSION,
                "current_sha256": stage_a["current_sha256"],
                "agent_turn_sha256": stage_a["agent_turn"]["agent_turn_sha256"],
                "decision": decision,
            }

            stage_b = session.apply_v3_decision(old_envelope)

            self.assertEqual(stage_b["stage"], "stage_b_graph_alignment")
            turn_b = stage_b["agent_turn"]
            revealed = turn_b["public_packet"]["json"]["revealed_rejectable_transcript"]
            self.assertIn(secret, " ".join(node["text"] for node in revealed["nodes"]))
            report = turn_b["legal_action_congruence"]
            self.assertEqual(report["status"], "pass")
            self.assertTrue(report["response_schema_exact_set_match"])
            self.assertFalse(report["prompt_literal_mentions"]["submit_alignment_graph"])
            self.assertTrue(report["prompt_delegates_exact_output_to_bound_response_schema"])
            graph_nodes = {node["id"]: node for node in stage_b["stage_graph"]["nodes"]}
            self.assertEqual(graph_nodes["stage_a_visible_inventory"]["status"], "complete")
            self.assertEqual(
                graph_nodes["stage_a_visible_inventory"]["current_line_status"],
                "complete",
            )
            self.assertEqual(
                graph_nodes["stage_b_graph_alignment"]["current_line_status"],
                "current",
            )

            with self.assertRaises(WalkthroughError) as raised:
                session.apply_v3_decision(old_envelope)
            self.assertEqual(raised.exception.code, "stale_current")

            with self.assertRaises(WalkthroughError) as raised_hash:
                session.apply_v3_decision(
                    {
                        "schema_version": V3_DECISION_ENVELOPE_SCHEMA_VERSION,
                        "current_sha256": stage_b["current_sha256"],
                        "agent_turn_sha256": "0" * 64,
                        "decision": decision,
                    }
                )
            self.assertEqual(raised_hash.exception.code, "stale_agent_turn")
            self.assertEqual(session.current()["stage"], "stage_b_graph_alignment")
            receipts = sorted((session.root / "transitions").glob("*.json"))
            self.assertEqual([path.name for path in receipts], ["00000001.json", "00000002.json"])

    def test_current_line_loop_status_does_not_claim_all_prior_work_is_current(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory)
            descriptor, _ = prepared_descriptor(temporary)
            session = PipelineWalkthroughSession.create(temporary / "session", descriptor)

            graph = session._stage_graph(
                prepared=True,
                begun=True,
                protocol_stage="stage_a_visible_inventory",
                current_line_id="body-02",
                current_line_index=1,
                line_count=3,
            )

            nodes = {node["id"]: node for node in graph["nodes"]}
            self.assertEqual(graph["loop"]["completed_line_count"], 1)
            self.assertEqual(nodes["stage_a_visible_inventory"]["current_line_status"], "current")
            self.assertEqual(nodes["stage_b_graph_alignment"]["current_line_status"], "next")
            self.assertIn("earlier lines", nodes["stage_b_graph_alignment"]["detail"])

    def test_embedded_turn_json_cannot_be_resigned_away_from_exact_snapshot_bytes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory)
            descriptor, _ = prepared_descriptor(temporary)
            session = PipelineWalkthroughSession.create(temporary / "session", descriptor)
            _, current = begin_prepared(session)
            turn_path = session.root / current["agent_turn"]["public_packet"][
                "immutable_copy_path"
            ]
            agent_record_path = turn_path.parent / "agent-turn.json"
            record = json.loads(agent_record_path.read_text())
            record["response_schema"]["json"]["title"] = "tampered embedded schema"
            record.pop("agent_turn_sha256")
            record["agent_turn_sha256"] = canonical_hash(record)
            write_json(agent_record_path, record)

            receipt_path = session.root / "transitions/00000001.json"
            receipt = json.loads(receipt_path.read_text())
            receipt["result"]["agent_turn_sha256"] = record["agent_turn_sha256"]
            receipt.pop("transition_sha256")
            receipt["transition_sha256"] = canonical_hash(receipt)
            write_json(receipt_path, receipt)

            with self.assertRaises(WalkthroughError) as raised:
                session.current()
            self.assertEqual(raised.exception.code, "session_integrity_error")
            self.assertIn("Embedded response schema", str(raised.exception))

    def test_post_commit_refresh_failure_returns_durable_commit_identity(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory)
            descriptor, _ = prepared_descriptor(temporary)
            session = PipelineWalkthroughSession.create(temporary / "session", descriptor)
            intake = session.current()
            original_current = session.current
            calls = 0

            def fail_only_successor_refresh() -> dict:
                nonlocal calls
                calls += 1
                if calls == 2:
                    raise RuntimeError("injected successor refresh failure")
                return original_current()

            with mock.patch.object(session, "current", side_effect=fail_only_successor_refresh):
                with self.assertRaises(WalkthroughError) as raised:
                    session.apply_source_action(
                        {
                            "schema_version": SOURCE_ACTION_SCHEMA_VERSION,
                            "current_sha256": intake["current_sha256"],
                            "action": {"type": "begin_prepared_protocol"},
                        }
                    )

            error = raised.exception
            self.assertTrue(error.committed)
            self.assertEqual(error.code, "action_committed_refresh_failed")
            commit = error.details["action_commit"]
            self.assertTrue(commit["committed"])
            self.assertEqual(commit["sequence"], 1)
            self.assertEqual(commit["action_type"], "begin_prepared_protocol")
            self.assertEqual(session.current()["stage"], "stage_a_visible_inventory")

    def test_failed_post_apply_receipt_rolls_back_state_and_new_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory)
            descriptor, _ = prepared_descriptor(temporary)
            session = PipelineWalkthroughSession.create(temporary / "session", descriptor)
            _, stage_a = begin_prepared(session)
            envelope = {
                "schema_version": V3_DECISION_ENVELOPE_SCHEMA_VERSION,
                "current_sha256": stage_a["current_sha256"],
                "agent_turn_sha256": stage_a["agent_turn"]["agent_turn_sha256"],
                "decision": stage_a_decision(stage_a),
            }
            state_path = session.root / "protocol-v3/private/workflow-state-v3.json"
            state_before = state_path.read_bytes()
            public_before = {path.name for path in (session.root / "protocol-v3/public").iterdir()}
            turns_before = {path.name for path in (session.root / "agent-turns").iterdir()}

            with mock.patch.object(
                session, "_append_receipt", side_effect=RuntimeError("injected receipt failure")
            ):
                with self.assertRaisesRegex(RuntimeError, "injected receipt failure"):
                    session.apply_v3_decision(envelope)

            self.assertEqual(state_path.read_bytes(), state_before)
            self.assertEqual(
                {path.name for path in (session.root / "protocol-v3/public").iterdir()},
                public_before,
            )
            self.assertEqual(
                {path.name for path in (session.root / "agent-turns").iterdir()},
                turns_before,
            )
            self.assertEqual(list((session.root / "decisions").iterdir()), [])
            self.assertEqual(
                [path.name for path in (session.root / "transitions").glob("*.json")],
                ["00000001.json"],
            )
            recovered = session.current()
            self.assertEqual(recovered["stage"], "stage_a_visible_inventory")
            self.assertEqual(recovered["current_sha256"], stage_a["current_sha256"])

    def test_session_creation_never_overwrites_existing_path(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory)
            source_path = make_source(temporary)
            descriptor = arbitrary_descriptor(source_path)
            session_path = temporary / "session"
            first = PipelineWalkthroughSession.create(session_path, descriptor)
            manifest_before = (first.root / "session-manifest.json").read_bytes()

            with self.assertRaises(WalkthroughError) as raised:
                PipelineWalkthroughSession.create(session_path, descriptor)

            self.assertEqual(raised.exception.code, "refusing_overwrite")
            self.assertEqual((first.root / "session-manifest.json").read_bytes(), manifest_before)

    def test_source_symlink_is_rejected_without_creating_a_session(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory)
            source_path = make_source(temporary)
            link_path = temporary / "linked-source.png"
            link_path.symlink_to(source_path)
            session_path = temporary / "session"

            with self.assertRaises(WalkthroughError) as raised:
                PipelineWalkthroughSession.create(
                    session_path, arbitrary_descriptor(link_path)
                )

            self.assertEqual(raised.exception.code, "unsafe_path")
            self.assertFalse(session_path.exists())


if __name__ == "__main__":
    unittest.main()
