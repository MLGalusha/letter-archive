from __future__ import annotations

from io import BytesIO
import http.client
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest import mock

from PIL import Image

from word_envelope.human_review_console import (
    ConsoleError,
    CSRF_HEADER_NAME,
    HumanReviewConsole,
    MAX_SCREENSHOT_BYTES,
    MODEL_CROP_STATES,
    MODEL_DECISION_SCHEMA_VERSION,
    MODEL_DIFFICULTIES,
    MODEL_STRUGGLE_FLAGS,
    ScreenshotUpload,
    build_server,
    parse_multipart_form,
)


# Reuse the supervisor's established synthetic input builder so these tests
# exercise the real packet/action contract rather than a permissive mock.
_HELPER_SPEC = importlib.util.spec_from_file_location(
    "sequential_ownership_test_helpers",
    Path(__file__).with_name("test_sequential_ownership.py"),
)
assert _HELPER_SPEC is not None and _HELPER_SPEC.loader is not None
_HELPERS = importlib.util.module_from_spec(_HELPER_SPEC)
_HELPER_SPEC.loader.exec_module(_HELPERS)


def image_bytes(format_name: str = "PNG", size: tuple[int, int] = (12, 9)) -> bytes:
    output = BytesIO()
    Image.new("RGB", size, "#d8cbb4").save(output, format=format_name)
    return output.getvalue()


def note_fields(packet: dict[str, object], **changes: str) -> dict[str, str]:
    fields = {
        "text": "The component chooser made this easy to understand.",
        "category": "observation",
        "severity": "low",
        "work_packet_sha256": str(packet["work_packet_sha256"]),
    }
    fields.update(changes)
    return fields


class HumanReviewConsoleTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        inputs = _HELPERS.make_inputs(self.root)
        self.run = _HELPERS.initialize(self.root, inputs)
        self.static = self.root / "review_console"
        self.static.mkdir()
        (self.static / "index.html").write_text("<!doctype html><title>Review</title>")
        self.console = HumanReviewConsole(self.run, self.static)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def packet(self) -> dict[str, object]:
        packet = self.console.current_packet()
        self.assertIsNotNone(packet)
        return packet  # type: ignore[return-value]

    def test_bootstrap_exposes_exact_packet_limits_and_frozen_note_enums(self) -> None:
        data = self.console.bootstrap()
        self.assertEqual(data["run"]["page_id"], "007-p02")
        self.assertEqual(data["packet"]["work_packet_sha256"], self.packet()["work_packet_sha256"])
        self.assertEqual(
            data["note_options"]["categories"],
            [
                "confusing_step",
                "missing_tool",
                "visual_evidence",
                "wrong_result",
                "time_waste",
                "idea",
                "observation",
            ],
        )
        self.assertEqual(data["note_options"]["severities"], ["low", "medium", "high", "blocker"])
        self.assertEqual(data["upload_limits"]["max_bytes"], MAX_SCREENSHOT_BYTES)
        self.assertEqual(data["upload_limits"]["max_note_characters"], 5_000)
        self.assertEqual(set(data["evidence_urls"]), set(data["packet"]["evidence"]))
        self.assertEqual(
            data["agent_contract"]["content_order"],
            ["prompt", "decision_collage", "work_packet", "legal_actions", "response_schema"],
        )
        schema = data["agent_contract"]["response_schema"]
        self.assertEqual(schema["schema_version"], MODEL_DECISION_SCHEMA_VERSION)
        self.assertEqual(schema["crop_state"], list(MODEL_CROP_STATES))
        self.assertEqual(schema["difficulty"], list(MODEL_DIFFICULTIES))
        self.assertEqual(schema["struggle_flags"], list(MODEL_STRUGGLE_FLAGS))
        self.assertIn("component_label_map", data["packet"]["evidence"])
        self.assertIn("clean_ink_selection_crop", data["packet"]["evidence"])
        self.assertIn("decision_collage", data["packet"]["evidence"])
        self.assertIn("residual_page", data["packet"]["evidence"])

    def test_point_seed_and_fitted_envelope_bind_exact_selected_ink(self) -> None:
        packet = self.packet()
        component = packet["current_unclaimed"]["components"][0]
        anchor = component["fingerprint"]["anchor"]
        seed = self.console.seed_selection(
            {
                "work_packet_sha256": packet["work_packet_sha256"],
                "x": anchor["x"],
                "y": anchor["y"],
            }
        )
        self.assertEqual(seed["component_id"], component["id"])
        preview = self.console.preview_envelope(
            {
                "work_packet_sha256": packet["work_packet_sha256"],
                "component_ids": [component["id"]],
            }
        )
        self.assertEqual(preview["component_ids"], [component["id"]])
        self.assertEqual(preview["metrics"]["selected_ink_coverage"], 1.0)
        image, media_type, digest = self.console.read_envelope_preview(
            preview["preview_sha256"]
        )
        self.assertEqual(media_type, "image/png")
        self.assertGreater(len(image), 100)
        self.assertEqual(len(digest), 64)

    def test_rough_box_selects_fragmented_components_then_points_can_refine(self) -> None:
        packet = self.packet()
        components = packet["current_unclaimed"]["components"]
        left = min(item["fingerprint"]["bbox"]["x"] for item in components)
        top = min(item["fingerprint"]["bbox"]["y"] for item in components)
        right = max(item["fingerprint"]["bbox"]["x"] + item["fingerprint"]["bbox"]["width"] for item in components)
        bottom = max(item["fingerprint"]["bbox"]["y"] + item["fingerprint"]["bbox"]["height"] for item in components)
        result = self.console.box_selection(
            {
                "work_packet_sha256": packet["work_packet_sha256"],
                "bbox_xywh": [left, top, right - left, bottom - top],
            }
        )
        self.assertEqual(result["component_ids"], [item["id"] for item in components])
        self.assertEqual(result["selection_rule"], "anchor_inside_or_15_percent_or_32_pixels")
        self.assertEqual(
            self.console.store.telemetry_summary()["counts_by_type"]["selection_boxed"], 1
        )

    def test_traversal_and_non_allowlisted_evidence_are_rejected(self) -> None:
        packet = self.packet()
        revision = self.console.supervisor_status()["revision"]
        with self.assertRaisesRegex(ConsoleError, "reference is invalid"):
            self.console.read_evidence("../../etc/passwd")
        with self.assertRaisesRegex(ConsoleError, "not in that work packet"):
            self.console.create_note(
                note_fields(packet, evidence_ref="packets/not-real/private.png"), None
            )
        with self.assertRaises(ConsoleError):
            self.console.static_file("/../run/run.json")
        self.assertEqual(self.console.supervisor_status()["revision"], revision)
        self.assertEqual(self.console.store.list_notes(), [])

    def test_mime_spoof_oversize_and_dimension_limit_leave_no_note_or_upload(self) -> None:
        packet = self.packet()
        png = image_bytes("PNG")
        with self.assertRaisesRegex(ConsoleError, "do not match"):
            self.console.create_note(
                note_fields(packet), ScreenshotUpload(png, "image/jpeg", "fake.jpg")
            )
        with self.assertRaises(ConsoleError) as oversized:
            self.console.create_note(
                note_fields(packet),
                ScreenshotUpload(b"x" * (MAX_SCREENSHOT_BYTES + 1), "image/png", "large.png"),
            )
        self.assertEqual(oversized.exception.status, 413)
        too_wide = image_bytes("PNG", (8193, 1))
        with self.assertRaisesRegex(ConsoleError, "dimensions"):
            self.console.create_note(
                note_fields(packet), ScreenshotUpload(too_wide, "image/png", "wide.png")
            )
        self.assertEqual(self.console.store.list_notes(), [])
        self.assertEqual(list((self.run / "human-observations/attachments").iterdir()), [])

    def test_stale_action_is_409_and_does_not_advance(self) -> None:
        packet = self.packet()
        before = self.console.supervisor_status()
        with self.assertRaises(ConsoleError) as raised:
            self.console.apply_action(
                {
                    "work_packet_sha256": "0" * 64,
                    "action": _HELPERS.claim_action(),
                }
            )
        self.assertEqual(raised.exception.code, "stale_action")
        self.assertEqual(raised.exception.status, 409)
        after = self.console.supervisor_status()
        self.assertEqual(after["revision"], before["revision"])
        self.assertEqual(self.packet()["work_packet_sha256"], packet["work_packet_sha256"])

    def test_successful_action_uses_real_supervisor_and_advances_once(self) -> None:
        packet = self.packet()
        before = self.console.supervisor_status()["revision"]
        result = self.console.apply_action(
            {
                "work_packet_sha256": packet["work_packet_sha256"],
                "action": _HELPERS.claim_action(),
            }
        )
        self.assertEqual(result["result"]["revision"], before + 1)
        self.assertEqual(self.console.supervisor_status()["revision"], before + 1)
        self.assertEqual(result["current"]["packet"]["current"]["unit_id"], "U2")

    def test_same_run_concurrent_actions_commit_once_and_loser_is_clean_stale_409(self) -> None:
        packet = self.packet()
        second_console = HumanReviewConsole(self.run, self.static)
        barrier = threading.Barrier(3)
        outcomes: list[tuple[str, object]] = []
        outcomes_lock = threading.Lock()

        def submit(console: HumanReviewConsole) -> None:
            barrier.wait()
            try:
                value: object = console.apply_action(
                    {
                        "work_packet_sha256": packet["work_packet_sha256"],
                        "action": _HELPERS.claim_action(),
                    }
                )
                outcome = ("ok", value)
            except ConsoleError as error:
                outcome = ("error", error)
            with outcomes_lock:
                outcomes.append(outcome)

        threads = [
            threading.Thread(target=submit, args=(self.console,)),
            threading.Thread(target=submit, args=(second_console,)),
        ]
        for thread in threads:
            thread.start()
        barrier.wait()
        for thread in threads:
            thread.join(timeout=5)
            self.assertFalse(thread.is_alive())

        successes = [value for kind, value in outcomes if kind == "ok"]
        failures = [value for kind, value in outcomes if kind == "error"]
        self.assertEqual(len(successes), 1)
        self.assertEqual(len(failures), 1)
        failure = failures[0]
        self.assertIsInstance(failure, ConsoleError)
        assert isinstance(failure, ConsoleError)
        self.assertEqual(failure.code, "stale_action")
        self.assertEqual(failure.status, 409)
        self.assertNotIn(str(self.run), failure.message)
        self.assertEqual(self.console.supervisor_status()["revision"], 1)
        current = self.packet()
        self.assertEqual(
            failure.details["current_work_packet_sha256"],
            current["work_packet_sha256"],
        )

    def test_duplicate_submit_after_final_word_is_stale_not_machine_complete(self) -> None:
        first = self.packet()
        self.console.apply_action(
            {
                "work_packet_sha256": first["work_packet_sha256"],
                "action": _HELPERS.claim_action(),
            }
        )
        final = self.packet()
        payload = {
            "work_packet_sha256": final["work_packet_sha256"],
            "action": _HELPERS.manual_action(),
        }
        self.console.apply_action(payload)
        self.assertIsNone(self.console.current_packet())

        with self.assertRaises(ConsoleError) as raised:
            self.console.apply_action(payload)

        self.assertEqual(raised.exception.code, "stale_action")
        self.assertEqual(raised.exception.status, 409)
        self.assertEqual(
            raised.exception.details,
            {"current_work_packet_sha256": None},
        )

    def test_note_is_bound_to_exact_screen_without_advancing_supervisor(self) -> None:
        packet = self.packet()
        before = self.console.supervisor_status()
        created = self.console.create_note(note_fields(packet), None)["note"]
        binding = created["created_binding"]
        self.assertEqual(binding["run_id"], before["run_id"])
        self.assertEqual(binding["page_id"], before["page_id"])
        self.assertEqual(binding["revision"], before["revision"])
        self.assertEqual(binding["checkpoint_sha256"], before["checkpoint_sha256"])
        self.assertEqual(binding["work_packet_sha256"], packet["work_packet_sha256"])
        self.assertEqual(binding["unit_id"], packet["current"]["unit_id"])
        self.assertEqual(binding["tentative_text"], packet["current"]["tentative_text"])
        self.assertEqual(binding["unit_kind"], packet["current"]["unit_kind"])
        self.assertEqual(binding["unit_turn"], packet["current"]["unit_turn"])
        self.assertEqual(self.console.supervisor_status()["revision"], before["revision"])

    def test_existing_evidence_note_uses_reference_and_remains_available_after_advance(self) -> None:
        packet = self.packet()
        evidence_ref = packet["evidence"]["numbered_components"]["path"]
        expected, media_type, _ = self.console.read_evidence(evidence_ref)
        created = self.console.create_note(
            note_fields(packet, evidence_ref=evidence_ref), None
        )["note"]
        self.assertIsNone(created["attachment"])
        self.assertEqual(created["evidence"]["ref"], evidence_ref)
        self.assertEqual(list((self.run / "human-observations/attachments").iterdir()), [])
        self.console.apply_action(
            {
                "work_packet_sha256": packet["work_packet_sha256"],
                "action": _HELPERS.claim_action(),
            }
        )
        historical, historical_type, _ = self.console.read_evidence(evidence_ref)
        self.assertEqual(historical, expected)
        self.assertEqual(historical_type, media_type)

    def test_screenshot_restart_persistence_and_hash_bound_serving(self) -> None:
        packet = self.packet()
        screenshot = image_bytes("JPEG")
        created = self.console.create_note(
            note_fields(packet, category="visual_evidence", severity="high"),
            ScreenshotUpload(screenshot, "image/jpeg", "../../browser-shot.jpg"),
        )["note"]
        attachment_id = created["attachment"]["attachment_id"]
        restarted = HumanReviewConsole(self.run, self.static)
        persisted = restarted.store.list_notes()
        self.assertEqual(len(persisted), 1)
        self.assertEqual(persisted[0]["note_id"], created["note_id"])
        body, media_type, digest = restarted.store.read_attachment(attachment_id)
        self.assertEqual(body, screenshot)
        self.assertEqual(media_type, "image/jpeg")
        self.assertEqual(digest, created["attachment"]["file_sha256"])
        stored_name = persisted[0]["attachment"]["filename"]
        self.assertNotIn("..", stored_name)
        self.assertTrue(stored_name.startswith("attachment-"))

    def test_edits_append_new_event_without_overwriting_old_event(self) -> None:
        packet = self.packet()
        created = self.console.create_note(note_fields(packet), None)["note"]
        events_dir = self.run / "human-observations/events"
        first_path = next(events_dir.glob("*.json"))
        first_bytes = first_path.read_bytes()
        edited_fields = note_fields(
            packet,
            note_id=created["note_id"],
            text="This wording is clearer after trying the step.",
            category="confusing_step",
            severity="medium",
        )
        edited = self.console.create_note(edited_fields, None)["note"]
        self.assertEqual(edited["version"], 2)
        self.assertEqual(edited["text"], edited_fields["text"])
        self.assertEqual(first_path.read_bytes(), first_bytes)
        self.assertEqual(len(list(events_dir.glob("*.json"))), 2)
        restarted = HumanReviewConsole(self.run, self.static)
        self.assertEqual(restarted.store.list_notes()[0]["version"], 2)

    def test_preplanted_append_lock_symlink_is_rejected_without_touching_target(self) -> None:
        packet = self.packet()
        target = self.root / "outside-lock-target"
        target.write_bytes(b"do-not-touch")
        lock = self.run / "human-observations/.events.append.lock"
        lock.symlink_to(target)

        with self.assertRaises(ConsoleError) as raised:
            self.console.create_note(note_fields(packet), None)

        self.assertEqual(raised.exception.code, "unsafe_storage")
        self.assertEqual(target.read_bytes(), b"do-not-touch")
        self.assertEqual(self.console.store.list_notes(), [])

    def test_failed_note_append_removes_newly_written_attachment(self) -> None:
        packet = self.packet()
        screenshot = image_bytes("PNG")
        with mock.patch.object(
            self.console.store.notes_chain,
            "append",
            side_effect=ConsoleError("append_failed", "simulated append failure"),
        ):
            with self.assertRaisesRegex(ConsoleError, "simulated append failure"):
                self.console.create_note(
                    note_fields(packet),
                    ScreenshotUpload(screenshot, "image/png", "screen.png"),
                )

        self.assertEqual(
            list((self.run / "human-observations/attachments").iterdir()),
            [],
        )

    def test_malformed_multipart_and_boundary_are_rejected(self) -> None:
        with self.assertRaisesRegex(ConsoleError, "boundary"):
            parse_multipart_form("multipart/form-data", b"not multipart")
        malformed = (
            b"--broken\r\nContent-Disposition: form-data; name=\"text\"\r\n\r\nhello"
        )
        with self.assertRaises(ConsoleError):
            parse_multipart_form("multipart/form-data; boundary=not-the-same", malformed)

    def test_telemetry_is_bounded_packet_bound_and_accepts_historical_screen(self) -> None:
        packet = self.packet()
        base = {
            "work_packet_sha256": packet["work_packet_sha256"],
            "event_type": "packet_opened",
            "details": {"evidence": "numbered_components"},
            "client_elapsed_ms": 1250,
            "ui_version": "poc-1",
        }
        accepted = self.console.record_telemetry(base)
        self.assertTrue(accepted["accepted"])
        with self.assertRaisesRegex(ConsoleError, "unsupported"):
            self.console.record_telemetry(base | {"event_type": "arbitrary_event"})
        with self.assertRaises(ConsoleError) as too_large:
            self.console.record_telemetry(base | {"details": {"huge": "x" * 20_000}})
        self.assertEqual(too_large.exception.status, 413)
        with self.assertRaises(ConsoleError) as spoofed:
            self.console.record_telemetry(base | {"work_packet_sha256": "f" * 64})
        self.assertEqual(spoofed.exception.code, "unknown_packet")

        self.console.apply_action(
            {
                "work_packet_sha256": packet["work_packet_sha256"],
                "action": _HELPERS.claim_action(),
            }
        )
        self.console.record_telemetry(base | {"event_type": "action_succeeded"})
        summary = self.console.store.telemetry_summary()
        self.assertEqual(summary["total_events"], 4)
        self.assertEqual(summary["counts_by_type"]["packet_opened"], 1)
        self.assertEqual(summary["counts_by_type"]["envelope_previewed"], 1)
        self.assertEqual(summary["counts_by_type"]["decision_recorded"], 1)
        self.assertEqual(summary["successful_actions"], 1)
        self.assertEqual(summary["total_client_elapsed_ms"], 2500)
        self.assertEqual(self.console.supervisor_status()["revision"], 1)

    def test_http_bootstrap_host_csrf_and_error_contract(self) -> None:
        with self.assertRaisesRegex(ConsoleError, "localhost"):
            build_server(run_dir=self.run, static_dir=self.static, host="0.0.0.0", port=0)
        server = build_server(run_dir=self.run, static_dir=self.static, port=0)
        second_launch = build_server(run_dir=self.run, static_dir=self.static, port=0)
        self.assertNotEqual(server.csrf_token, second_launch.csrf_token)
        second_launch.server_close()
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()

        def request(
            method: str,
            path: str,
            *,
            body: str | None = None,
            headers: dict[str, str] | None = None,
        ) -> tuple[int, dict[str, object]]:
            connection = http.client.HTTPConnection(
                "127.0.0.1", server.server_port, timeout=5
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
            self.assertTrue(payload["ok"])
            token = payload["data"]["csrf_token"]
            self.assertEqual(token, server.csrf_token)

            status, payload = request(
                "GET",
                "/api/bootstrap",
                headers={"Host": f"attacker.example:{server.server_port}"},
            )
            self.assertEqual(status, 403)
            self.assertEqual(payload["error"]["code"], "untrusted_host")

            stale = json.dumps(
                {
                    "work_packet_sha256": "0" * 64,
                    "action": _HELPERS.claim_action(),
                }
            )
            status, payload = request(
                "POST",
                "/api/actions",
                body=stale,
                headers={"Content-Type": "application/json"},
            )
            self.assertEqual(status, 403)
            self.assertFalse(payload["ok"])
            self.assertEqual(payload["error"]["code"], "csrf_denied")

            status, payload = request(
                "POST",
                "/api/actions",
                body=stale,
                headers={
                    "Content-Type": "application/json",
                    CSRF_HEADER_NAME: "wrong-token",
                },
            )
            self.assertEqual(status, 403)
            self.assertEqual(payload["error"]["code"], "csrf_denied")

            status, payload = request(
                "POST",
                "/api/actions",
                body=stale,
                headers={
                    "Content-Type": "application/json",
                    "Host": f"attacker.example:{server.server_port}",
                    "Origin": f"http://attacker.example:{server.server_port}",
                    CSRF_HEADER_NAME: token,
                },
            )
            self.assertEqual(status, 403)
            self.assertEqual(payload["error"]["code"], "untrusted_host")

            status, payload = request(
                "POST",
                "/api/actions",
                body=stale,
                headers={
                    "Content-Type": "application/json",
                    "Origin": "http://attacker.example",
                    CSRF_HEADER_NAME: token,
                },
            )
            self.assertEqual(status, 403)
            self.assertEqual(payload["error"]["code"], "cross_origin_denied")

            status, payload = request(
                "POST",
                "/api/actions",
                body=stale,
                headers={
                    "Content-Type": "application/json",
                    CSRF_HEADER_NAME: token,
                },
            )
            self.assertEqual(status, 409)
            self.assertEqual(payload["error"]["code"], "stale_action")
            self.assertEqual(self.console.supervisor_status()["revision"], 0)

            packet = self.packet()
            valid = json.dumps(
                {
                    "work_packet_sha256": packet["work_packet_sha256"],
                    "action": _HELPERS.claim_action(),
                }
            )
            status, payload = request(
                "POST",
                "/api/actions",
                body=valid,
                headers={
                    "Content-Type": "application/json",
                    CSRF_HEADER_NAME: token,
                },
            )
            self.assertEqual(status, 200)
            self.assertTrue(payload["ok"])
            self.assertEqual(payload["data"]["current"]["csrf_token"], token)
            self.assertEqual(self.console.supervisor_status()["revision"], 1)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
