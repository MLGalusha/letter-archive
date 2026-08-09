from __future__ import annotations

from pathlib import Path
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[1]
CONSOLE = ROOT / "pipeline_console"


class PipelineConsoleFrontendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.html = (CONSOLE / "index.html").read_text(encoding="utf-8")
        cls.css = (CONSOLE / "app.css").read_text(encoding="utf-8")
        cls.js = (CONSOLE / "app.js").read_text(encoding="utf-8")

    def test_standalone_console_has_source_resume_and_three_column_walkthrough(self) -> None:
        for marker in (
            'id="chooser-screen"',
            'id="source-grid"',
            'id="session-list"',
            'id="stage-list"',
            'id="agent-view"',
            'id="panel-action"',
            'id="panel-instructions"',
            'id="panel-inspector"',
            'id="panel-notebook"',
        ):
            self.assertIn(marker, self.html)
        self.assertIn("grid-template-columns: var(--rail) minmax(420px, 1fr) var(--controls)", self.css)
        self.assertIn(".agent-scroll { height: 100%; overflow: auto", self.css)
        self.assertIn("[hidden] { display: none !important; }", self.css)
        self.assertIn('@media (max-width: 900px)', self.css)
        self.assertIn('data-mobile-section="agent"', self.html)
        self.assertIn('closest(".mobile-nav button[data-mobile-section]")', self.js)
        self.assertNotIn('closest("[data-mobile-section]")', self.js)

    def test_api_contract_is_session_scoped_and_actions_are_bound(self) -> None:
        for endpoint in (
            'bootstrap: "/api/bootstrap"',
            'sessions: "/api/sessions"',
            '/bootstrap`',
            '/actions`',
            '/notes`',
            '/telemetry`',
        ):
            self.assertIn(endpoint, self.js)
        for field in (
            "catalog_item_id",
            "catalog_revision_sha256",
            "client_request_id",
            "pipeline_revision",
            "agent_turn_sha256",
            "current_sha256",
        ):
            self.assertIn(field, self.js)
        self.assertIn('type: "begin_prepared_protocol"', self.js)
        self.assertIn('current.action_ui?.type === "source_start"', self.js)
        self.assertIn("const oldHash = agentTurnSha", self.js)
        self.assertIn("agent_turn_sha256: oldHash", self.js)

    def test_agent_view_and_inspector_preserve_visibility_boundaries(self) -> None:
        for provenance in (
            "live_same_run",
            "deterministic_receipt",
            "recorded_legacy_evidence",
            "available_not_started",
            "blocked_missing_transition",
            "design_only",
        ):
            self.assertIn(provenance, self.js)
        self.assertIn("Immutable agent-turn order", self.js)
        self.assertIn("Agent-visible ordered playback", self.js)
        self.assertIn("Convenience mirror · exact bytes", self.js)
        self.assertIn("Convenience mirror · strict inspector", self.js)
        self.assertIn("Prompt/packet mismatch is preserved", self.js)
        self.assertIn("Software state — not model evidence", self.js)
        self.assertIn("Physically withheld from this acting stage", self.js)
        self.assertIn("Software intake evidence — outside the model bundle", self.js)
        self.assertIn("missing_capabilities", self.js)
        self.assertIn("const uniqueRows = rows.filter", self.js)
        self.assertIn("seen.has(key)", self.js)
        self.assertNotIn("private_state", self.html)
        self.assertNotIn("ground_truth", self.html)

    def test_agent_view_plays_every_exact_block_in_server_declared_order(self) -> None:
        for marker in (
            "function renderAgentTurnPlayback(turn, current)",
            "order.map((item, index) => renderPlaybackStep",
            'normalized === "prompt"',
            '"public_packet", "packet"',
            '"response_schema", "schema"',
            'normalized === "evidence"',
            "Verbatim prompt · collapse or expand",
            "Open exact public packet JSON",
            "Open exact response schema JSON",
            'class="turn-playback"',
        ):
            self.assertIn(marker, self.js)
        agent_branch = self.js.split("} else {\n      body += renderAgentTurnPlayback", 1)[1].split("body += `</div>`", 1)[0]
        self.assertIn("renderWithheld", agent_branch)
        self.assertNotIn("renderEvidenceStack(turn, current);", agent_branch)

    def test_stage_a_is_rectangle_inventory_not_raw_json(self) -> None:
        for marker in (
            "stage_a_visible_inventory",
            "submit_visible_inventory",
            "visible_span_count",
            "bbox_source_xywh",
            "visual_kind",
            "estimated_word_count_min",
            "estimated_word_count_max",
            "internal_boundary_status",
            "uncertainty_flags",
            "evidence_note",
            "uprightRectToSource",
            "upright_to_source_affine",
        ):
            self.assertIn(marker, self.js)
        self.assertNotIn('name="action_json"', self.html)
        self.assertNotIn('name="raw_json"', self.html)

    def test_stage_b_builds_many_to_many_edges_and_all_explicit_gaps(self) -> None:
        for marker in (
            "stage_b_graph_alignment",
            "submit_alignment_graph",
            "software_allocated_ids",
            "inserted_visible_spans",
            "visible_span_order",
            "word_units",
            "span_word_edges",
            "word_transcript_edges",
            "word_proposal_edges",
            "explicit_gaps",
            "deriveGraphGaps",
            "transcript_node",
            "proposal_node",
            "stage-b-inserted-span",
        ):
            self.assertIn(marker, self.js)
        self.assertIn("Every visible span must connect to a word", self.js)
        self.assertIn("nothing is assumed one-to-one", self.js)
        self.assertIn("must connect to exactly one visible span", self.js)
        self.assertIn("Several words may share this span; each word belongs to one span.", self.js)
        self.assertIn("data-move-visible-span", self.js)
        self.assertIn("normalizeVisibleSpanOrder", self.js)
        self.assertIn("syncInsertedSpanOrders", self.js)
        self.assertIn("const stableSet = new Set(stableIds)", self.js)
        self.assertIn("stableSet.has(id) ? stableIds[stableIndex++] : id", self.js)
        self.assertIn("Stable IDs remain immutable", self.js)
        self.assertIn("function renderGapGroups(gaps, draft, options)", self.js)
        self.assertIn('class="gap-group" open', self.js)

    def test_verified_prompt_and_telemetry_use_live_server_vocabulary(self) -> None:
        self.assertIn("verified_for_this_new_session", self.js)
        self.assertIn('notebook: "note_opened"', self.js)
        self.assertNotIn('sendTelemetry("notebook_opened"', self.js)
        self.assertIn('const UI_VERSION = "pipeline-console.v1"', self.js)
        self.assertIn('sendTelemetry("action_submitted"', self.js)
        self.assertIn('sendTelemetry("action_submitted", { action_type: action.type }).catch(() => {})', self.js)
        self.assertIn('sendTelemetry("action_failed"', self.js)
        self.assertNotIn('sendTelemetry("action_succeeded"', self.js)

    def test_notes_screenshots_drafts_and_stale_refresh_are_present(self) -> None:
        for marker in (
            'name="category"',
            'name="severity"',
            'name="evidence_ref"',
            'name="screenshot"',
            "FormData",
            "saveNoteDraft",
            "restoreNoteDraft",
            "localStorage",
            "error.status === 409",
            "Your local draft was preserved",
            "let actionAccepted = false",
            "Action saved, but the next exact state could not be displayed",
            "This action is saved. Refresh the session before doing anything else on this stage.",
            "renderActionPanel(current);\n        showActionErrors([publicError(error)]);",
        ):
            self.assertIn(marker, self.html + self.js)

    def test_committed_refresh_failure_is_locked_and_never_reported_as_action_failure(self) -> None:
        self.assertIn("data.committed === true && data.refresh_failed === true", self.js)
        self.assertIn("data.refresh_error?.message", self.js)
        self.assertIn("Saved; refresh failed.", self.js)
        self.assertIn("state.submittingAction = true", self.js)
        committed_branch = self.js.split("if (data.committed === true && data.refresh_failed === true)", 1)[1].split("toast(\"Action accepted", 1)[0]
        self.assertNotIn('sendTelemetry("action_failed"', committed_branch)
        self.assertNotIn("loadSession(", committed_branch)

    def test_new_turn_resets_only_the_owned_scroll_regions(self) -> None:
        self.assertIn('agentScroll: document.querySelector("#agent-scroll")', self.js)
        self.assertIn("function currentTurnIdentity(current)", self.js)
        self.assertIn("function resetTurnScrollOwners()", self.js)
        self.assertIn("els.agentScroll.scrollTop = 0", self.js)
        self.assertIn("activePanel.scrollTop = 0", self.js)
        self.assertIn("if (turnChanged) resetTurnScrollOwners()", self.js)
        self.assertIn("priorTurnIdentity !== currentTurnIdentity(data.current)", self.js)
        self.assertGreaterEqual(self.js.count('state.controlTab = "action"'), 2)

    def test_hashes_wrap_copy_and_internal_statuses_are_human_friendly(self) -> None:
        self.assertIn("function renderIntegrityRow", self.js)
        self.assertIn('data-copy-hash=', self.js)
        self.assertIn("function copyIntegrityHash(hash)", self.js)
        self.assertIn(".full-hash { min-width: 0", self.css)
        self.assertIn("overflow-wrap: anywhere", self.css)
        self.assertIn("function friendlyStageStatus", self.js)
        self.assertIn("Software connection not built yet", self.js)
        self.assertIn("Complete from the prepared source", self.js)
        self.assertIn("function releaseChooserMedia()", self.js)
        self.assertIn("els.sourceGrid.replaceChildren()", self.js)

    def test_bounded_interaction_telemetry_is_wired_to_real_tools(self) -> None:
        for event_type in (
            "rectangle_drawn",
            "rectangle_edited",
            "graph_link_changed",
            "evidence_viewed",
        ):
            self.assertIn(f'queueTelemetry("{event_type}"', self.js)
        self.assertIn("state.telemetryTimers.get", self.js)
        self.assertIn("window.clearTimeout", self.js)
        self.assertIn("currentBindingSha() !== boundCurrent", self.js)
        self.assertIn('id = "telemetry-summary"', self.js)
        self.assertIn("What slowed this session down", self.js)
        self.assertIn("summary.successful_actions", self.js)
        self.assertIn("summary.by_item_binding", self.js)

    def test_javascript_parses(self) -> None:
        result = subprocess.run(
            ["node", "--check", str(CONSOLE / "app.js")],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
