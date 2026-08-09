from __future__ import annotations

from io import BytesIO
import hashlib
import http.client
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest import mock

from PIL import Image

from word_envelope.human_review_console import ObservationStore, ScreenshotUpload
from word_envelope.pipeline_walkthrough_console import (
    LEGACY_CATALOG_ITEM,
    PREPARED_CATALOG_ITEM,
    PipelineConsoleError,
    PipelineWalkthroughConsole,
    build_server,
)
from word_envelope.human_review_console import CSRF_HEADER_NAME


LETTER_ARCHIVE = Path("/Users/masongalusha/Workspace/projects/letter-archive")


def screenshot_bytes() -> bytes:
    output = BytesIO()
    Image.new("RGB", (24, 18), "#d8cbb4").save(output, format="PNG")
    return output.getvalue()


class PipelineWalkthroughConsoleTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.static = self.root / "static"
        self.static.mkdir()
        (self.static / "index.html").write_text("<!doctype html><title>Pipeline</title>")
        self.console = PipelineWalkthroughConsole(
            self.root / "workspace",
            static_dir=self.static,
            letter_archive_root=LETTER_ARCHIVE,
        )

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def create(self, item_id: str, request_id: str) -> dict:
        return self.console.create_session(
            {
                "catalog_item_id": item_id,
                "catalog_revision_sha256": self.console.catalog.catalog_revision,
                "client_request_id": request_id,
            }
        )

    def test_catalog_is_privacy_safe_and_features_prepared_and_legacy_focus_pages(self) -> None:
        bootstrap = self.console.global_bootstrap()
        self.assertEqual(bootstrap["catalog"]["count"], 80)
        items = {item["id"]: item for item in bootstrap["catalog"]["items"]}
        self.assertEqual(items[PREPARED_CATALOG_ITEM]["capability"]["mode"], "prepared_live")
        self.assertEqual(
            items[LEGACY_CATALOG_ITEM]["capability"]["mode"],
            "recorded_legacy_available",
        )
        serialized = json.dumps(bootstrap)
        self.assertNotIn("/Users/", serialized)
        self.assertNotIn("checksum", serialized.lower())
        self.assertNotIn("transcript", serialized.lower())
        self.assertNotIn("ground_truth", serialized.lower())

    def test_arbitrary_source_session_shows_image_and_exact_missing_capabilities(self) -> None:
        data = self.create(LEGACY_CATALOG_ITEM, "request-source-007")
        current = data["current"]
        self.assertEqual(current["stage_id"], "source_intake")
        self.assertEqual(current["kind"], "blocked")
        self.assertEqual(current["provenance"]["code"], "blocked_missing_transition")
        graph_nodes = {node["id"]: node for node in data["stage_graph"]["nodes"]}
        self.assertEqual(graph_nodes["source_intake"]["status"], "complete")
        self.assertEqual(graph_nodes["source_preparation"]["status"], "blocked")
        missing = [item for item in current["blockers"] if item["code"] != "missing_source_preparation"]
        self.assertEqual(len(missing), 6)
        self.assertIsNone(current["agent_turn"])
        source = current["source_evidence"]
        body, media_type, digest = self.console.read_evidence(
            data["session"]["id"], source["ref"]
        )
        self.assertEqual(source["ref"], "source/working.png")
        self.assertEqual(source["role"], "metadata_free_working_raster")
        self.assertEqual(media_type, "image/png")
        self.assertEqual(digest, source["sha256"])
        self.assertTrue(body)
        with Image.open(BytesIO(body)) as working:
            self.assertEqual(working.format, "PNG")
            self.assertFalse(
                {"exif", "xmp", "XML:com.adobe.xmp"}.intersection(working.info)
            )
        session_dir = self.console._session_dir(data["session"]["id"])
        manifest = json.loads((session_dir / "source/source-manifest.json").read_text())
        metadata = json.loads((session_dir / "console-session.json").read_text())
        original_path = session_dir / manifest["original"]["path"]
        self.assertEqual(
            hashlib.sha256(original_path.read_bytes()).hexdigest(),
            metadata["source_original_file_sha256"],
        )
        self.assertEqual(
            manifest["working_raster"]["metadata_policy"],
            "rgb_pixels_only_no_source_metadata",
        )
        with self.assertRaises(PipelineConsoleError) as original_denied:
            self.console.read_evidence(
                data["session"]["id"], manifest["original"]["path"]
            )
        self.assertEqual(original_denied.exception.code, "invalid_evidence")
        self.assertNotIn("/Users/", json.dumps(data))

    def test_idempotent_source_selection_returns_one_isolated_session(self) -> None:
        first = self.create(LEGACY_CATALOG_ITEM, "same-request-007")
        second = self.create(LEGACY_CATALOG_ITEM, "same-request-007")
        self.assertEqual(first["session"]["id"], second["session"]["id"])
        self.assertEqual(len(self.console.global_bootstrap()["sessions"]), 1)
        with self.assertRaises(PipelineConsoleError) as raised:
            self.create(PREPARED_CATALOG_ITEM, "same-request-007")
        self.assertEqual(raised.exception.code, "idempotency_conflict")
        with self.assertRaises(PipelineConsoleError) as revision_conflict:
            self.console.create_session(
                {
                    "catalog_item_id": LEGACY_CATALOG_ITEM,
                    "catalog_revision_sha256": "0" * 64,
                    "client_request_id": "same-request-007",
                }
            )
        self.assertEqual(revision_conflict.exception.code, "idempotency_conflict")

    def test_prepared_014_starts_fresh_exact_stage_a_then_advances_to_stage_b(self) -> None:
        data = self.create(PREPARED_CATALOG_ITEM, "request-prepared-014")
        session_id = data["session"]["id"]
        source_current = data["current"]
        self.assertEqual(source_current["kind"], "source_start")
        stage_a_data = self.console.apply_action(
            session_id,
            {
                "pipeline_revision": 0,
                "agent_turn_sha256": None,
                "action": {"type": "begin_prepared_protocol"},
            },
        )
        current = stage_a_data["current"]
        self.assertEqual(current["stage_id"], "stage_a_visible_inventory")
        turn = current["agent_turn"]
        self.assertEqual(turn["prompt"]["status"], "verified_for_this_new_session")
        self.assertEqual(turn["congruence"]["status"], "pass")
        self.assertEqual(
            turn["packet"]["value"]["withheld_from_acting_stage"]["rejectable_line_text"],
            "physically_absent_from_packet_and_stage_a_images",
        )
        self.assertEqual(len(turn["evidence"]), 3)
        evidence = turn["evidence"][0]
        body, media_type, digest = self.console.read_evidence(session_id, evidence["ref"])
        self.assertEqual(media_type, "image/png")
        self.assertEqual(digest, evidence["sha256"])
        self.assertTrue(body)

        packet = turn["packet"]["value"]
        left, top, right, bottom = packet["evidence"]["directed_transform"][
            "source_crop_xyxy"
        ]
        action = {
            "type": "submit_visible_inventory",
            "visible_span_count": 1,
            "spans": [
                {
                    "order": 1,
                    "bbox_source_xywh": [
                        left + 10,
                        top + 10,
                        min(100, right - left - 20),
                        min(60, bottom - top - 20),
                    ],
                    "visual_kind": "word_like",
                    "estimated_word_count_min": 1,
                    "estimated_word_count_max": 1,
                    "internal_boundary_status": "clear_single",
                    "uncertainty_flags": ["none"],
                    "evidence_note": "One clearly bounded visible span.",
                }
            ],
            "line_note": "Minimal human walkthrough inventory.",
        }
        stage_b_data = self.console.apply_action(
            session_id,
            {
                "pipeline_revision": current["revision"],
                "agent_turn_sha256": turn["agent_turn_sha256"],
                "action": action,
            },
        )
        self.assertEqual(stage_b_data["current"]["stage_id"], "stage_b_graph_alignment")
        self.assertEqual(stage_b_data["current"]["revision"], 1)
        graph_nodes = {
            node["id"]: node for node in stage_b_data["stage_graph"]["nodes"]
        }
        self.assertEqual(graph_nodes["stage_a_visible_inventory"]["status"], "complete")
        self.assertEqual(
            graph_nodes["stage_a_visible_inventory"]["current_line_status"],
            "complete",
        )
        self.assertEqual(
            graph_nodes["stage_b_graph_alignment"]["current_line_status"],
            "current",
        )

        with self.assertRaises(PipelineConsoleError) as stale:
            self.console.apply_action(
                session_id,
                {
                    "pipeline_revision": current["revision"],
                    "agent_turn_sha256": turn["agent_turn_sha256"],
                    "action": action,
                },
            )
        self.assertEqual(stale.exception.code, "stale_action")
        self.assertEqual(stale.exception.status, 409)

    def test_server_records_action_success_and_pipeline_summary_without_client_details(self) -> None:
        data = self.create(PREPARED_CATALOG_ITEM, "request-success-telemetry-014")
        session_id = data["session"]["id"]
        advanced = self.console.apply_action(
            session_id,
            {
                "pipeline_revision": 0,
                "agent_turn_sha256": None,
                "action": {"type": "begin_prepared_protocol"},
            },
        )

        summary = advanced["telemetry_summary"]
        self.assertEqual(summary["successful_actions"], 1)
        self.assertEqual(summary["counts_by_type"]["action_succeeded"], 1)
        self.assertEqual(summary["by_stage"]["source_intake"]["total_events"], 1)
        self.assertTrue(summary["by_item_binding"])
        self.assertNotIn("details", json.dumps(summary))
        session_dir = self.console._session_dir(session_id)
        events = ObservationStore(session_dir).interactions_chain.load()
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["event_type"], "action_succeeded")
        self.assertEqual(events[0]["details"]["recorded_by"], "pipeline_console_server")

        with self.assertRaises(PipelineConsoleError) as stale:
            self.console.record_telemetry(
                session_id,
                {
                    "current_sha256": data["current"]["current_sha256"],
                    "agent_turn_sha256": None,
                    "pipeline_revision": 0,
                    "event_type": "action_succeeded",
                    "details": {"action_type": "begin_prepared_protocol"},
                    "client_elapsed_ms": 1,
                    "ui_version": "pipeline-console.v1",
                },
            )
        self.assertEqual(stale.exception.code, "stale_telemetry")
        self.assertEqual(
            self.console.session_bootstrap(session_id)["telemetry_summary"][
                "successful_actions"
            ],
            1,
        )

    def test_committed_action_returns_2xx_compatible_refresh_failure_receipt(self) -> None:
        data = self.create(PREPARED_CATALOG_ITEM, "request-refresh-failure-014")
        session_id = data["session"]["id"]
        injected = PipelineConsoleError(
            "injected_refresh_failure", "injected", status=500
        )

        with mock.patch.object(self.console, "session_bootstrap", side_effect=injected):
            result = self.console.apply_action(
                session_id,
                {
                    "pipeline_revision": 0,
                    "agent_turn_sha256": None,
                    "action": {"type": "begin_prepared_protocol"},
                },
            )

        self.assertTrue(result["committed"])
        self.assertTrue(result["refresh_failed"])
        self.assertTrue(result["action_success_telemetry_recorded"])
        self.assertEqual(
            result["refresh_error"]["code"], "action_committed_refresh_failed"
        )
        self.assertEqual(result["action_commit"]["action_type"], "begin_prepared_protocol")
        self.assertRegex(result["action_commit"]["transition_sha256"], r"^[0-9a-f]{64}$")
        recovered = self.console.session_bootstrap(session_id)
        self.assertEqual(recovered["current"]["stage_id"], "stage_a_visible_inventory")
        self.assertEqual(recovered["telemetry_summary"]["successful_actions"], 1)

    def test_console_anchor_rejects_resigned_pipeline_manifest_identity(self) -> None:
        data = self.create(LEGACY_CATALOG_ITEM, "request-anchor-007")
        session_dir = self.console._session_dir(data["session"]["id"])
        path = session_dir / "pipeline/session-manifest.json"
        manifest = json.loads(path.read_text())
        manifest["session_id"] = "f" * 32
        manifest.pop("session_manifest_sha256")
        manifest["session_manifest_sha256"] = hashlib.sha256(
            json.dumps(
                manifest,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()
        path.write_text(json.dumps(manifest, indent=2) + "\n")

        with self.assertRaises(PipelineConsoleError) as raised:
            self.console.session_bootstrap(data["session"]["id"])
        self.assertEqual(raised.exception.code, "session_integrity_error")
        self.assertIn("console anchor", str(raised.exception))

    def test_note_validation_and_append_hold_same_lock_as_action(self) -> None:
        data = self.create(PREPARED_CATALOG_ITEM, "request-note-action-race-014")
        session_id = data["session"]["id"]
        current = data["current"]
        note_entered = threading.Event()
        release_note = threading.Event()
        action_done = threading.Event()
        outcomes: dict[str, object] = {}
        original_create = ObservationStore.create_or_edit_note

        def blocking_create(store: ObservationStore, **kwargs):
            note_entered.set()
            if not release_note.wait(5):
                raise RuntimeError("test did not release note")
            return original_create(store, **kwargs)

        def save_note() -> None:
            try:
                outcomes["note"] = self.console.create_note(
                    session_id,
                    {
                        "text": "Bound to the exact source-intake screen.",
                        "category": "observation",
                        "severity": "low",
                        "current_sha256": current["current_sha256"],
                        "agent_turn_sha256": "",
                        "evidence_ref": "",
                    },
                    None,
                )
            except BaseException as error:
                outcomes["note_error"] = error

        def advance() -> None:
            try:
                outcomes["action"] = self.console.apply_action(
                    session_id,
                    {
                        "pipeline_revision": 0,
                        "agent_turn_sha256": None,
                        "action": {"type": "begin_prepared_protocol"},
                    },
                )
            except BaseException as error:
                outcomes["action_error"] = error
            finally:
                action_done.set()

        with mock.patch.object(ObservationStore, "create_or_edit_note", new=blocking_create):
            note_thread = threading.Thread(target=save_note)
            note_thread.start()
            self.assertTrue(note_entered.wait(5))
            action_thread = threading.Thread(target=advance)
            action_thread.start()
            self.assertFalse(action_done.wait(0.2))
            release_note.set()
            note_thread.join(5)
            action_thread.join(10)

        self.assertNotIn("note_error", outcomes)
        self.assertNotIn("action_error", outcomes)
        self.assertEqual(outcomes["action"]["current"]["stage_id"], "stage_a_visible_inventory")
        notes = self.console.session_bootstrap(session_id)["notes"]
        self.assertEqual(notes[0]["created_binding"]["pipeline_revision"], 0)

    def test_note_with_screenshot_binds_current_screen_without_advancing(self) -> None:
        data = self.create(LEGACY_CATALOG_ITEM, "request-note-007")
        session_id = data["session"]["id"]
        current = data["current"]
        source = current["source_evidence"]
        result = self.console.create_note(
            session_id,
            {
                "text": "The missing line-discovery tool is the first blocker I hit.",
                "category": "missing_tool",
                "severity": "high",
                "current_sha256": current["current_sha256"],
                "agent_turn_sha256": "",
                "evidence_ref": source["ref"],
            },
            ScreenshotUpload(screenshot_bytes(), "image/png", "screen.png"),
        )
        self.assertEqual(len(result["notes"]), 1)
        self.assertIsNotNone(result["note"]["attachment"])
        after = self.console.session_bootstrap(session_id)
        self.assertEqual(after["current"]["current_sha256"], current["current_sha256"])
        self.assertEqual(len(after["notes"]), 1)

    def test_evidence_traversal_and_stale_note_fail_without_mutation(self) -> None:
        data = self.create(LEGACY_CATALOG_ITEM, "request-safe-007")
        session_id = data["session"]["id"]
        with self.assertRaises(PipelineConsoleError):
            self.console.read_evidence(session_id, "../../etc/passwd")
        with self.assertRaises(PipelineConsoleError) as stale:
            self.console.create_note(
                session_id,
                {
                    "text": "This should not save.",
                    "category": "observation",
                    "severity": "low",
                    "current_sha256": "0" * 64,
                    "agent_turn_sha256": "",
                    "evidence_ref": "",
                },
                None,
            )
        self.assertEqual(stale.exception.code, "stale_note")
        self.assertEqual(self.console.session_bootstrap(session_id)["notes"], [])

    def test_http_is_local_csrf_protected_and_session_scoped(self) -> None:
        server = build_server(
            workspace_dir=self.root / "http-workspace",
            static_dir=self.static,
            letter_archive_root=LETTER_ARCHIVE,
            port=0,
        )
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()

        def request(
            method: str,
            path: str,
            *,
            body: str | None = None,
            headers: dict[str, str] | None = None,
        ) -> tuple[int, dict]:
            connection = http.client.HTTPConnection(
                "127.0.0.1", server.server_port, timeout=10
            )
            try:
                connection.request(method, path, body=body, headers=headers or {})
                response = connection.getresponse()
                return response.status, json.loads(response.read())
            finally:
                connection.close()

        try:
            status, payload = request("GET", "/api/bootstrap")
            self.assertEqual(status, 200)
            token = payload["data"]["csrf_token"]
            self.assertEqual(payload["data"]["catalog"]["count"], 80)

            status, payload = request(
                "GET",
                "/api/bootstrap",
                headers={"Host": f"attacker.example:{server.server_port}"},
            )
            self.assertEqual(status, 403)
            self.assertEqual(payload["error"]["code"], "untrusted_host")

            create = json.dumps(
                {
                    "catalog_item_id": LEGACY_CATALOG_ITEM,
                    "catalog_revision_sha256": server.console.catalog.catalog_revision,
                    "client_request_id": "http-request-007",
                }
            )
            status, payload = request(
                "POST",
                "/api/sessions",
                body=create,
                headers={"Content-Type": "application/json"},
            )
            self.assertEqual(status, 403)
            self.assertEqual(payload["error"]["code"], "csrf_denied")

            status, payload = request(
                "POST",
                "/api/sessions",
                body=create,
                headers={
                    "Content-Type": "application/json",
                    CSRF_HEADER_NAME: token,
                },
            )
            self.assertEqual(status, 201)
            session_id = payload["data"]["session"]["id"]
            self.assertRegex(session_id, r"^[0-9a-f]{32}$")
            self.assertNotIn("/Users/", json.dumps(payload))

            status, payload = request(
                "GET", f"/api/sessions/{session_id}/bootstrap"
            )
            self.assertEqual(status, 200)
            self.assertEqual(payload["data"]["current"]["stage_id"], "source_intake")
            self.assertEqual(payload["data"]["csrf_token"], token)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
