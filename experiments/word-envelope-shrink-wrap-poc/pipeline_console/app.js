(() => {
  "use strict";

  const UI_VERSION = "pipeline-console.v1";
  const API = {
    bootstrap: "/api/bootstrap",
    sessions: "/api/sessions",
    sessionBootstrap: (id) => `/api/sessions/${encodeURIComponent(id)}/bootstrap`,
    actions: (id) => `/api/sessions/${encodeURIComponent(id)}/actions`,
    notes: (id) => `/api/sessions/${encodeURIComponent(id)}/notes`,
    telemetry: (id) => `/api/sessions/${encodeURIComponent(id)}/telemetry`,
  };

  const PROVENANCE_CODES = [
    "live_same_run",
    "deterministic_receipt",
    "recorded_legacy_evidence",
    "available_not_started",
    "blocked_missing_transition",
    "design_only",
  ];

  const state = {
    screen: "loading",
    fatalError: null,
    root: null,
    sessionData: null,
    sessionId: null,
    csrfToken: null,
    controlTab: "action",
    mobileSection: "agent",
    loadingSession: false,
    submittingAction: false,
    actionChoice: "submit",
    agentTurnHash: null,
    stageDraft: null,
    drawing: null,
    drawingPreview: null,
    noteFile: null,
    noteFileUrl: null,
    telemetryTimers: new Map(),
    sessionOpenedAt: performance.now(),
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    Object.assign(els, {
      app: document.querySelector("#app"),
      loading: document.querySelector("#loading-screen"),
      error: document.querySelector("#error-screen"),
      chooser: document.querySelector("#chooser-screen"),
      session: document.querySelector("#session-screen"),
      topbarContext: document.querySelector("#topbar-context"),
      leaveSession: document.querySelector("#leave-session"),
      sourceGrid: document.querySelector("#source-grid"),
      sessionList: document.querySelector("#session-list"),
      catalogRevision: document.querySelector("#catalog-revision"),
      sessionSource: document.querySelector("#session-source"),
      stageList: document.querySelector("#stage-list"),
      agentScroll: document.querySelector("#agent-scroll"),
      agentView: document.querySelector("#agent-view"),
      actionPanel: document.querySelector("#panel-action"),
      instructionsPanel: document.querySelector("#panel-instructions"),
      inspectorPanel: document.querySelector("#panel-inspector"),
      notebookPanel: document.querySelector("#panel-notebook"),
      noteForm: document.querySelector("#note-form"),
      noteCount: document.querySelector("#note-count"),
      notesList: document.querySelector("#notes-list"),
      noteMessage: document.querySelector("#note-message"),
      noteDraftWarning: document.querySelector("#note-draft-warning"),
      noteCharCount: document.querySelector("#note-char-count"),
      noteCharLimit: document.querySelector("#note-char-limit"),
      screenshotInput: document.querySelector("#screenshot-input"),
      uploadZone: document.querySelector("#upload-zone"),
      uploadPreview: document.querySelector("#upload-preview"),
      uploadHint: document.querySelector("#upload-hint"),
      toastRegion: document.querySelector("#toast-region"),
    });

    bindEvents();
    loadRootBootstrap();
  }

  function bindEvents() {
    document.querySelector("#home-link").addEventListener("click", (event) => {
      event.preventDefault();
      showChooser();
    });
    els.leaveSession.addEventListener("click", showChooser);
    document.querySelector("#refresh-button").addEventListener("click", refreshCurrent);
    document.querySelector("#retry-button").addEventListener("click", refreshCurrent);
    document.addEventListener("click", handleClick);
    document.addEventListener("input", handleInput);
    document.addEventListener("change", handleInput);
    document.addEventListener("submit", handleSubmit);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("pointercancel", cancelDrawing);
    document.addEventListener("load", (event) => {
      if (event.target instanceof HTMLImageElement && event.target.matches(".evidence-frame img")) {
        sizeEvidenceCanvas(event.target.closest(".evidence-frame"));
      }
    }, true);
    document.addEventListener("paste", handlePaste);
    window.addEventListener("hashchange", handleHashChange);
    window.addEventListener("resize", () => {
      document.querySelectorAll(".evidence-frame").forEach(sizeEvidenceCanvas);
    });

    els.screenshotInput.addEventListener("change", () => setNoteFile(els.screenshotInput.files?.[0] || null));
    ["dragenter", "dragover"].forEach((name) => els.uploadZone.addEventListener(name, (event) => {
      event.preventDefault();
      els.uploadZone.classList.add("is-dragging");
    }));
    ["dragleave", "drop"].forEach((name) => els.uploadZone.addEventListener(name, (event) => {
      event.preventDefault();
      els.uploadZone.classList.remove("is-dragging");
    }));
    els.uploadZone.addEventListener("drop", (event) => {
      const file = [...(event.dataTransfer?.files || [])].find((candidate) => candidate.type.startsWith("image/"));
      if (file) setNoteFile(file);
    });
    document.querySelector("#remove-upload").addEventListener("click", () => setNoteFile(null));
  }

  async function loadRootBootstrap() {
    state.screen = "loading";
    state.fatalError = null;
    renderShell();
    try {
      const data = await requestJson(API.bootstrap);
      assertObject(data, "bootstrap");
      assertObject(data.catalog, "catalog");
      if (!Array.isArray(data.catalog.items) || !Array.isArray(data.sessions)) {
        throw new UIError("The source catalog response is incomplete.");
      }
      state.root = data;
      state.csrfToken = data.csrf_token;
      const routeSession = sessionIdFromHash();
      if (routeSession) {
        await loadSession(routeSession, { updateHash: false });
      } else {
        state.screen = "chooser";
        render();
      }
    } catch (error) {
      setFatalError(error);
    }
  }

  async function loadSession(sessionId, { updateHash = true } = {}) {
    if (!sessionId) return;
    const priorSessionId = state.sessionId;
    const priorTurnIdentity = currentTurnIdentity(state.sessionData?.current);
    state.loadingSession = true;
    state.screen = "loading";
    renderShell();
    try {
      const data = await requestJson(API.sessionBootstrap(sessionId));
      assertObject(data, "session bootstrap");
      assertObject(data.session, "session");
      if (!data.current || typeof data.current !== "object") {
        throw new UIError("This session has no safe current-stage description.");
      }
      state.sessionId = String(data.session.id || sessionId);
      state.sessionData = data;
      state.csrfToken = data.csrf_token || state.csrfToken;
      state.screen = "session";
      state.loadingSession = false;
      state.sessionOpenedAt = performance.now();
      if (updateHash) history.pushState(null, "", `#session=${encodeURIComponent(state.sessionId)}`);
      const openedNewTurn = priorSessionId !== state.sessionId || priorTurnIdentity !== currentTurnIdentity(data.current);
      if (openedNewTurn) state.controlTab = "action";
      prepareTurnDraft();
      render();
      if (openedNewTurn) resetTurnScrollOwners();
      sendTelemetry("stage_opened", { stage_id: data.current.stage_id }).catch(() => {});
    } catch (error) {
      state.loadingSession = false;
      setFatalError(error);
    }
  }

  async function startSession(itemId) {
    const root = state.root;
    if (!root) return;
    const item = root.catalog.items.find((candidate) => String(candidate.id) === String(itemId));
    if (!item || capabilityBlocked(item.capability?.mode)) return;
    const button = document.querySelector(`[data-start-source="${cssEscape(String(itemId))}"]`);
    if (button) button.disabled = true;
    try {
      const payload = {
        catalog_item_id: item.id,
        catalog_revision_sha256: root.catalog.revision_sha256,
        client_request_id: makeRequestId(),
      };
      const data = await requestJson(API.sessions, {
        method: "POST",
        headers: writeHeaders(),
        body: JSON.stringify(payload),
      });
      const created = data.session || data;
      if (!created || !created.id) throw new UIError("The server did not return the new session ID.");
      await loadSession(String(created.id));
    } catch (error) {
      toast(publicError(error), "error");
      if (button) button.disabled = false;
    }
  }

  function showChooser() {
    history.pushState(null, "", location.pathname + location.search);
    state.screen = "chooser";
    state.sessionData = null;
    state.sessionId = null;
    state.agentTurnHash = null;
    state.stageDraft = null;
    cancelDrawing();
    render();
  }

  function refreshCurrent() {
    if (state.sessionId) loadSession(state.sessionId, { updateHash: false });
    else loadRootBootstrap();
  }

  function handleHashChange() {
    const id = sessionIdFromHash();
    if (id && id !== state.sessionId) loadSession(id, { updateHash: false });
    if (!id && state.screen === "session") showChooser();
  }

  function render() {
    renderShell();
    if (state.screen === "chooser") renderChooser();
    if (state.screen === "session") renderSession();
  }

  function renderShell() {
    els.app.dataset.screen = state.screen;
    els.app.dataset.mobileSection = state.mobileSection;
    els.loading.hidden = state.screen !== "loading";
    els.error.hidden = state.screen !== "error";
    els.chooser.hidden = state.screen !== "chooser";
    els.session.hidden = state.screen !== "session";
    els.leaveSession.hidden = state.screen !== "session";
    if (state.screen === "error" && state.fatalError) {
      document.querySelector("#fatal-error-title").textContent = state.fatalError.title;
      document.querySelector("#fatal-error-message").textContent = state.fatalError.message;
    }
  }

  function renderChooser() {
    const catalog = state.root.catalog;
    els.topbarContext.innerHTML = `<span class="pulse-dot" aria-hidden="true"></span><span>${escapeHTML(catalog.items.length)} safe catalog source${catalog.items.length === 1 ? "" : "s"}</span>`;
    els.catalogRevision.textContent = shortHash(catalog.revision_sha256);
    els.catalogRevision.title = `Catalog revision ${catalog.revision_sha256 || "unavailable"}`;
    els.sourceGrid.innerHTML = catalog.items.length
      ? catalog.items.map(renderSourceCard).join("")
      : `<div class="empty-state">No safe sources are available in this catalog revision.</div>`;
    els.sessionList.innerHTML = state.root.sessions.length
      ? state.root.sessions.map(renderResumeCard).join("")
      : `<div class="empty-state">No sessions yet.</div>`;
  }

  function renderSourceCard(item) {
    const capability = item.capability || { mode: "blocked_missing_transition", label: "Unavailable", detail: "No capability receipt was supplied." };
    const blocked = capabilityBlocked(capability.mode);
    const dimensions = Array.isArray(item.size_wh) ? `${item.size_wh[0]} × ${item.size_wh[1]}` : "Dimensions unavailable";
    return `<article class="source-card">
      <div class="source-thumb">${item.thumbnail_url ? `<img src="${escapeAttr(item.thumbnail_url)}" alt="Preview of ${escapeAttr(item.display_name || "source image")}">` : `<span>No preview</span>`}</div>
      <div class="source-body">
        <h3>${escapeHTML(item.display_name || item.id)}</h3>
        <p class="source-subtitle">${escapeHTML(item.subtitle || "")}</p>
        <div class="source-meta"><span>${escapeHTML(dimensions)}</span><span class="capability capability--${safeClass(capability.mode)}">${escapeHTML(capability.label || capability.mode)}</span></div>
        <p class="capability-detail">${escapeHTML(capability.detail || "")}</p>
        <button class="${blocked ? "secondary-button" : "primary-button"} primary-button--wide" type="button" data-start-source="${escapeAttr(item.id)}" ${blocked ? "disabled" : ""}>${blocked ? "Blocked at Stage 0" : "Start exact walkthrough"}</button>
      </div>
    </article>`;
  }

  function renderResumeCard(session) {
    const id = String(session.id || session.session_id || "");
    return `<article class="session-card">
      <h3>${escapeHTML(session.display_name || session.source_display_name || id)}</h3>
      <p>${escapeHTML(session.stage_name || session.status_label || "Resume exact head")}${session.updated_at ? ` · ${escapeHTML(formatDate(session.updated_at))}` : ""}</p>
      <button class="secondary-button primary-button--wide" type="button" data-resume-session="${escapeAttr(id)}">Resume, do not reset</button>
    </article>`;
  }

  function renderSession() {
    const data = state.sessionData;
    const current = data.current;
    releaseChooserMedia();
    els.topbarContext.innerHTML = `<span class="pulse-dot" aria-hidden="true"></span><span>${escapeHTML(current.stage_name)} · revision ${escapeHTML(current.revision)}</span>`;
    renderStageRail(data);
    renderAgentView(current);
    renderActionPanel(current);
    renderInstructions(current);
    renderInspector(current);
    renderNotebook(data);
    switchControlTab(state.controlTab, { renderOnly: true });
    document.querySelectorAll(".mobile-nav button[data-mobile-section]").forEach((button) => {
      button.setAttribute("aria-current", button.dataset.mobileSection === state.mobileSection ? "page" : "false");
    });
  }

  function releaseChooserMedia() {
    els.sourceGrid.replaceChildren();
    els.sessionList.replaceChildren();
  }

  function currentTurnIdentity(current) {
    if (!current || typeof current !== "object") return null;
    return current.agent_turn?.agent_turn_sha256 || current.current_sha256 || `${current.stage_id || "unknown"}:${current.revision ?? "unknown"}`;
  }

  function resetTurnScrollOwners() {
    window.requestAnimationFrame(() => {
      if (els.agentScroll) els.agentScroll.scrollTop = 0;
      const activePanel = {
        action: els.actionPanel,
        instructions: els.instructionsPanel,
        inspector: els.inspectorPanel,
        notebook: els.notebookPanel,
      }[state.controlTab];
      if (activePanel) activePanel.scrollTop = 0;
      if (window.matchMedia("(max-width: 900px)").matches) window.scrollTo({ top: 0, behavior: "auto" });
    });
  }

  function renderStageRail(data) {
    const source = data.session.source || data.session.source_binding || {};
    els.sessionSource.innerHTML = `<strong>${escapeHTML(data.session.display_name || data.session.id)}</strong><span>${escapeHTML(source.display_name || source.catalog_item_id || data.session.source_display_name || "Frozen source")}</span><span class="mono">${escapeHTML(shortHash(source.source_manifest_sha256 || source.sha256 || ""))}</span>`;
    const stages = normalizeStages(data.stage_graph);
    els.stageList.innerHTML = stages.map((stage, index) => {
      const stageId = stage.stage_id || stage.id;
      const status = stage.status || (stageId === data.current.stage_id ? "current" : "future");
      const satisfied = ["complete", "done", "satisfied_by_bound_input"].includes(status) || stage.receipt;
      const statusClass = satisfied ? "done" : (status === "current" || stageId === data.current.stage_id ? "current" : "future");
      const statusLabel = stage.detail || stage.status_label || friendlyStageStatus(status, statusClass);
      const receipt = stage.receipt ? `<span class="stage-receipt">Receipt ${escapeHTML(shortHash(stage.receipt.sha256 || stage.receipt.receipt_sha256 || "recorded"))}</span>` : "";
      return `<li class="stage-item stage-item--${statusClass}">
        <span class="stage-index">${statusClass === "done" ? "✓" : index + 1}</span>
        <span class="stage-copy"><strong>${escapeHTML(stage.stage_name || stage.label || readable(stage.stage_id))}</strong><small>${escapeHTML(statusLabel)}</small>${receipt}</span>
      </li>`;
    }).join("");
  }

  function friendlyStageStatus(status, statusClass) {
    const labels = {
      complete: "Complete",
      done: "Complete",
      satisfied_by_bound_input: "Complete from the prepared source",
      current: "Current step",
      available_not_started: "Available after the current step",
      blocked_upstream: "Waiting for an earlier stage",
      blocked_missing_transition: "Software connection not built yet",
      available_but_disconnected: "Tool exists but is not connected yet",
      blocked: "Blocked until a missing capability is built",
      future: "Not started",
    };
    return labels[status] || (statusClass === "current" ? "Current step" : "Not started");
  }

  function renderAgentView(current) {
    const provenance = current.provenance || {};
    const blockers = Array.isArray(current.blockers) ? current.blockers : [];
    const turn = current.agent_turn;
    let body = `<div class="agent-view-inner">
      <header class="turn-header">
        <p class="eyebrow">Current software-issued step</p>
        <h1>${escapeHTML(current.item_label || current.stage_name)}</h1>
        <div class="turn-meta"><span class="meta-chip">${escapeHTML(current.stage_name)}</span><span class="meta-chip">Revision ${escapeHTML(current.revision)}</span>${current.next_effect ? `<span class="meta-chip">Next: ${escapeHTML(current.next_effect)}</span>` : ""}</div>
        ${renderProvenance(provenance)}
      </header>`;

    if (blockers.length) body += renderBlockers(blockers);

    if (!turn) {
      body += renderSourceEvidence(current.source_evidence);
      const kind = current.kind || provenance.code;
      if (kind === "deterministic_receipt" || provenance.code === "deterministic_receipt") {
        body += `<section class="receipt-card"><p class="eyebrow">Software receipt</p><h2>${escapeHTML(current.stage_name)}</h2><p>${escapeHTML(provenance.detail || current.next_effect || "This deterministic transition has no agent decision.")}</p></section>`;
      } else {
        body += `<section class="blocked-card"><p class="eyebrow">No model turn exists</p><h2>${escapeHTML(kind === "blocked_missing_transition" ? "Missing pipeline transition" : "This stage is not acting")}</h2><p>${escapeHTML(provenance.detail || "The server did not provide a model-visible turn. The UI will not synthesize one.")}</p></section>`;
      }
    } else {
      body += renderAgentTurnPlayback(turn, current);
      body += renderWithheld(turn.withheld);
    }
    body += `</div>`;
    els.agentView.innerHTML = body;
    requestAnimationFrame(() => document.querySelectorAll(".evidence-frame").forEach(sizeEvidenceCanvas));
  }

  function renderProvenance(provenance) {
    const code = PROVENANCE_CODES.includes(provenance.code) ? provenance.code : (provenance.code || "design_only");
    return `<div class="provenance-card"><span class="provenance-badge provenance-badge--${safeClass(code)}">${escapeHTML(provenance.label || code)}</span><div><strong>Provenance</strong><p>${escapeHTML(provenance.detail || "No provenance detail supplied.")}</p></div></div>`;
  }

  function renderBlockers(blockers) {
    const rows = blockers.flatMap((blocker) => {
      if (typeof blocker === "string") return [blocker];
      const primary = blocker.message || blocker.detail || blocker.label || blocker.code || "Unspecified blocker";
      const missing = Array.isArray(blocker.missing_capabilities) ? blocker.missing_capabilities.map((capability) => typeof capability === "string" ? capability : capability.label || capability.code || capability.detail) : [];
      return [primary, ...missing];
    });
    const seen = new Set();
    const uniqueRows = rows.filter((row) => {
      const key = String(row || "").trim().toLocaleLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return `<section class="blocked-card"><p class="eyebrow">Software blockers</p><h2>Nothing is being hidden or guessed</h2><ul class="blocker-list">${uniqueRows.map((row) => `<li>${escapeHTML(row)}</li>`).join("")}</ul></section>`;
  }

  function renderSourceEvidence(sourceEvidence) {
    if (!sourceEvidence) return "";
    const items = Array.isArray(sourceEvidence) ? sourceEvidence : (Array.isArray(sourceEvidence.items) ? sourceEvidence.items : [sourceEvidence]);
    const imageItems = items.filter((item) => item && item.url);
    if (!imageItems.length) return "";
    return `<div class="visibility-banner visibility-banner--software"><strong>Software intake evidence — outside the model bundle</strong><span>This selected source is visible to the operator before any agent turn is materialized.</span></div><div class="evidence-stack">${imageItems.map((item) => `<article class="evidence-card"><header class="evidence-heading"><div><h2>${escapeHTML(item.label || "Selected source")}</h2><p>${escapeHTML(item.role || "Session-local immutable source")}</p></div><code class="hash-chip">${escapeHTML(shortHash(item.sha256))}</code></header><div class="evidence-frame"><img src="${escapeAttr(item.url)}" alt="${escapeAttr(item.label || "Selected source image")}"></div>${renderIntegrityRow(item.sha256, "Software evidence SHA-256", item.role || "Session-local immutable source", true)}</article>`).join("")}</div>`;
  }

  function renderTurnOrder(turn) {
    const order = Array.isArray(turn.content_order) ? turn.content_order : [];
    return `<section class="turn-order"><strong>Immutable agent-turn order</strong><p class="source-subtitle">The human view and model invocation must consume these blocks in this exact order.</p><ol>${order.map((item) => `<li>${escapeHTML(typeof item === "string" ? item : item.label || item.key)}</li>`).join("")}</ol><div class="mono source-subtitle">Turn ${escapeHTML(shortHash(turn.agent_turn_sha256))}</div></section>`;
  }

  function renderAgentTurnPlayback(turn, current) {
    const order = Array.isArray(turn.content_order) ? turn.content_order : [];
    const steps = order.map((item, index) => renderPlaybackStep(turn, current, item, index)).join("");
    return `${renderTurnOrder(turn)}
      <div class="visibility-banner visibility-banner--agent"><strong>Agent-visible ordered playback</strong><span>Work downward. These are the exact prompt, public packet, response schema, and evidence blocks supplied to this turn—nothing from a future or private stage.</span></div>
      ${renderCongruence(turn.congruence)}
      ${steps ? `<ol class="turn-playback" aria-label="Exact agent-turn playback">${steps}</ol>` : `<div class="inline-warning">This turn declared no content order. The interface will not invent one.</div>`}`;
  }

  function renderPlaybackStep(turn, current, item, index) {
    const key = typeof item === "string" ? item : item?.key || item?.type || item?.label || "unknown";
    const normalized = String(key).toLowerCase();
    let title = typeof item === "object" && item?.label ? item.label : readable(key);
    let detail = "Exact model-visible block";
    let content = "";
    if (normalized === "prompt") {
      title = "Prompt";
      detail = `Step ${index + 1} · verbatim instructions`;
      const prompt = turn.prompt || {};
      content = `<details class="playback-details" open><summary>Verbatim prompt · collapse or expand</summary><pre class="exact-payload">${escapeHTML(prompt.text || "No prompt text was supplied.")}</pre>${renderIntegrityRow(prompt.sha256, "Prompt SHA-256", prompt.status)}</details>`;
    } else if (["public_packet", "packet"].includes(normalized)) {
      title = "Public packet";
      detail = `Step ${index + 1} · exact current-stage inputs`;
      content = `<details class="playback-details"><summary>Open exact public packet JSON</summary><pre class="exact-payload">${escapeHTML(JSON.stringify(turn.packet?.value ?? null, null, 2))}</pre>${renderIntegrityRow(turn.packet?.sha256, "Packet SHA-256", turn.packet?.status)}</details>`;
    } else if (["response_schema", "schema", "tool_schema", "tool_schemas"].includes(normalized)) {
      title = "Response schema";
      detail = `Step ${index + 1} · exact legal output shape`;
      content = `<details class="playback-details"><summary>Open exact response schema JSON</summary><pre class="exact-payload">${escapeHTML(JSON.stringify(turn.response_schema?.value ?? null, null, 2))}</pre>${renderIntegrityRow(turn.response_schema?.sha256, "Schema SHA-256", turn.response_schema?.status)}</details>`;
    } else if (normalized === "evidence" || normalized.startsWith("evidence:")) {
      title = "Evidence";
      detail = `Step ${index + 1} · model-visible evidence`;
      const evidenceKey = normalized.startsWith("evidence:") ? key.slice(String(key).indexOf(":") + 1) : null;
      content = renderEvidenceStack(turn, current, evidenceKey ? [evidenceKey] : null);
    } else {
      content = `<div class="inline-warning">The immutable order names “${escapeHTML(key)}”, but this UI has no renderer for that block. It is not being silently skipped or replaced.</div>`;
    }
    return `<li class="playback-step" data-playback-key="${escapeAttr(key)}"><header><span class="playback-number">${index + 1}</span><div><h2>${escapeHTML(title)}</h2><p>${escapeHTML(detail)}</p></div></header>${content}</li>`;
  }

  function renderIntegrityRow(hash, label, status = null, light = false) {
    const value = hash || "Hash unavailable";
    return `<div class="integrity-row${light ? " integrity-row--light" : ""}"><span>${escapeHTML(status || label)}</span><code class="full-hash">${escapeHTML(value)}</code>${hash ? `<button class="copy-hash" type="button" data-copy-hash="${escapeAttr(hash)}" aria-label="Copy ${escapeAttr(label)}">Copy hash</button>` : ""}</div>`;
  }

  function renderCongruence(congruence) {
    if (!congruence) return "";
    const issues = Array.isArray(congruence.issues) ? congruence.issues : [];
    const ok = ["match", "pass", "congruent", "ok"].includes(String(congruence.status).toLowerCase());
    if (ok && !issues.length) return "";
    return `<div class="visibility-banner visibility-banner--warning"><strong>Prompt/packet mismatch is preserved</strong><span>${escapeHTML(congruence.detail || congruence.status || "The supplied turn is not fully congruent.")}</span></div>${issues.length ? `<ul class="congruence-list">${issues.map((issue) => `<li>${escapeHTML(typeof issue === "string" ? issue : issue.detail || issue.code)}</li>`).join("")}</ul>` : ""}`;
  }

  function renderEvidenceStack(turn, current, requestedKeys = null) {
    const requested = Array.isArray(requestedKeys) ? new Set(requestedKeys) : null;
    const evidence = (Array.isArray(turn.evidence) ? turn.evidence : []).filter((item) => !requested || requested.has(item.key));
    if (!evidence.length) return `<div class="empty-state">This exact agent turn contains no image evidence.</div>`;
    const drawingKey = drawingEvidenceKey(current, turn);
    return `<div class="evidence-stack">${evidence.map((item) => {
      const interactive = item.key === drawingKey && stageSupportsDrawing(current.stage_id);
      return `<article class="evidence-card" data-evidence-key="${escapeAttr(item.key)}">
        <header class="evidence-heading"><div><h2>${escapeHTML(item.label || item.key)}</h2><p>${escapeHTML(item.role || "Model-visible evidence")}</p></div><code class="hash-chip" title="${escapeAttr(item.sha256 || "")}">${escapeHTML(shortHash(item.sha256))}</code></header>
        <div class="evidence-frame ${interactive && state.drawing ? "is-drawing" : ""}" data-evidence-frame="${escapeAttr(item.key)}">
          <img src="${escapeAttr(item.url)}" alt="${escapeAttr(item.label || item.key)}" draggable="false">
          ${interactive ? `<canvas data-drawing-canvas="${escapeAttr(item.key)}" aria-label="Rectangle drawing layer. Exact numeric box fields remain available for keyboard users."></canvas>` : ""}
        </div>
        ${renderIntegrityRow(item.sha256, "Evidence SHA-256", `${Array.isArray(item.size_wh) ? `${item.size_wh[0]} × ${item.size_wh[1]} · ` : ""}${item.role || "Model-visible evidence"}`, true)}
      </article>`;
    }).join("")}</div>`;
  }

  function renderWithheld(withheld) {
    if (!Array.isArray(withheld) || !withheld.length) return "";
    return `<section class="withheld-card"><h3>Physically withheld from this acting stage</h3><ul>${withheld.map((item) => `<li>${escapeHTML(typeof item === "string" ? item : item.label || item.key || item.detail)}</li>`).join("")}</ul></section>`;
  }

  function renderActionPanel(current) {
    if (!current.agent_turn) {
      if (current.action_ui?.type === "source_start") {
        const legal = current.action_ui.legal_actions || current.legal_actions || [];
        const beginAction = (current.action_ui.actions || []).find((action) => action.type === "begin_prepared_protocol");
        const mayBegin = legal.includes("begin_prepared_protocol") || beginAction || current.action_ui.action?.type === "begin_prepared_protocol";
        if (mayBegin) {
          els.actionPanel.innerHTML = `<div class="panel-intro"><p class="eyebrow">Stage 0 · Prepared source</p><h2>${escapeHTML(current.action_ui.title || "Start prepared protocol")}</h2><p>${escapeHTML(current.action_ui.detail || beginAction?.description || "The source receipt is ready. This software action materializes the first exact agent turn.")}</p><div class="action-effect">${escapeHTML(current.next_effect || "Create the first Stage A public packet without revealing future-stage evidence.")}</div></div><form class="stack-form" data-stage-form="source-start"><p class="form-message" data-action-message hidden></p><button class="primary-button primary-button--wide" type="submit" ${state.submittingAction ? "disabled" : ""}>${escapeHTML(beginAction?.submit_label || current.action_ui.submit_label || "Start prepared protocol")}</button></form>`;
          return;
        }
      }
      els.actionPanel.innerHTML = `<div class="panel-intro"><p class="eyebrow">No legal model action</p><h2>${escapeHTML(current.stage_name)}</h2><p>${escapeHTML(current.provenance?.detail || "This software state has no acting packet.")}</p></div>${current.blockers?.length ? renderBlockers(current.blockers) : ""}`;
      return;
    }
    if (current.stage_id === "stage_a_visible_inventory") {
      renderStageAAction(current);
      return;
    }
    if (current.stage_id === "stage_b_graph_alignment") {
      renderStageBAction(current);
      return;
    }
    renderGenericAction(current);
  }

  function renderStageAAction(current) {
    const draft = ensureStageADraft(current);
    const schema = current.agent_turn.response_schema?.value || {};
    const options = stageAOptions(schema);
    const submitSelected = state.actionChoice !== "defer";
    els.actionPanel.innerHTML = `<div class="panel-intro">
      <p class="eyebrow">Stage A · Transcript blind</p><h2>Inventory visible spans</h2>
      <p>Draw rough rectangles in semantic reading order. The transcript and detector boxes remain physically withheld.</p>
      <div class="action-effect">Submitting accepts this entire line inventory. Deferring leaves an explicit blocker; neither path skips silently.</div>
    </div>
    <div class="action-picker" role="group" aria-label="Stage A legal actions">
      <button type="button" data-action-choice="submit" aria-pressed="${submitSelected}"><i>1</i><span><strong>Submit visible inventory</strong><small>One ordered list for this line</small></span></button>
      <button type="button" data-action-choice="defer" aria-pressed="${!submitSelected}"><i>!</i><span><strong>Defer this line</strong><small>Record why it cannot be inventoried safely</small></span></button>
    </div>
    ${submitSelected ? renderStageASubmit(draft, options) : renderDeferForm(options.deferReasons, draft.defer)}`;
  }

  function renderStageASubmit(draft, options) {
    return `<form id="stage-a-form" class="stack-form" data-stage-form="stage-a" novalidate>
      <div class="tool-strip">
        <button class="tool-button" type="button" data-draw-mode="stage-a-span" aria-pressed="${state.drawing?.mode === "stage-a-span"}">＋ Draw span on upright image</button>
        <button class="tool-button" type="button" data-add-stage-a-span>Enter box numerically</button>
      </div>
      <p class="source-subtitle">Drawing uses the packet’s exact upright→source affine. Numeric source fields are the keyboard-accessible authority.</p>
      <div class="card-list" id="stage-a-span-list">${draft.spans.length ? draft.spans.map((span, index) => renderStageASpan(span, index, options)).join("") : `<div class="empty-state">No visible spans recorded yet.</div>`}</div>
      <label class="field"><span>Line note</span><textarea rows="3" data-stage-a-line-note placeholder="What is notable about the full line?">${escapeHTML(draft.line_note || "")}</textarea></label>
      <p class="form-message" data-action-message hidden></p>
      <button class="primary-button primary-button--wide" type="submit" ${state.submittingAction ? "disabled" : ""}>Submit ${draft.spans.length} visible span${draft.spans.length === 1 ? "" : "s"}</button>
    </form>`;
  }

  function renderStageASpan(span, index, options) {
    return `<article class="span-card" data-span-card="${index}">
      <div class="card-title-row"><div><strong>Span ${index + 1}</strong> <code>semantic order ${index + 1}</code></div><div><button class="mini-button" type="button" data-move-stage-a-span="${index}" data-direction="up" ${index === 0 ? "disabled" : ""} aria-label="Move span ${index + 1} earlier">↑</button> <button class="mini-button" type="button" data-move-stage-a-span="${index}" data-direction="down" ${index === state.stageDraft.spans.length - 1 ? "disabled" : ""} aria-label="Move span ${index + 1} later">↓</button> <button class="mini-button mini-button--danger" type="button" data-remove-stage-a-span="${index}">Remove</button></div></div>
      ${renderBboxFields(span.bbox_source_xywh, { scope: "stage-a", index })}
      <div class="two-fields">
        ${renderSelectField("Visible kind", options.visualKinds, span.visual_kind, `data-stage-a-index="${index}" data-stage-field="visual_kind"`)}
        ${renderSelectField("Internal boundary", options.boundaries, span.internal_boundary_status, `data-stage-a-index="${index}" data-stage-field="internal_boundary_status"`)}
      </div>
      <div class="two-fields">
        ${renderNumberField("Minimum words", span.estimated_word_count_min, `data-stage-a-index="${index}" data-stage-field="estimated_word_count_min"`, 0)}
        ${renderNumberField("Maximum words", span.estimated_word_count_max, `data-stage-a-index="${index}" data-stage-field="estimated_word_count_max"`, 0)}
      </div>
      <fieldset class="field"><legend>Uncertainty flags</legend><div class="checkbox-grid">${options.uncertainties.map((value) => `<label class="check-pill"><input type="checkbox" value="${escapeAttr(value)}" data-stage-a-index="${index}" data-stage-field="uncertainty_flags" ${span.uncertainty_flags.includes(value) ? "checked" : ""}><span>${escapeHTML(readable(value))}</span></label>`).join("")}</div></fieldset>
      <label class="field"><span>Evidence note</span><input type="text" data-stage-a-index="${index}" data-stage-field="evidence_note" value="${escapeAttr(span.evidence_note || "")}" placeholder="What makes this one visible span?"></label>
    </article>`;
  }

  function renderStageBAction(current) {
    const draft = ensureStageBDraft(current);
    normalizeVisibleSpanOrder(draft, current);
    const packet = current.agent_turn.packet?.value || {};
    const schema = current.agent_turn.response_schema?.value || {};
    const options = stageBOptions(schema);
    const submitSelected = state.actionChoice !== "defer";
    const inventory = graphInventory(packet, draft);
    const gaps = deriveGraphGaps(draft, inventory);
    els.actionPanel.innerHTML = `<div class="panel-intro">
      <p class="eyebrow">Stage B · Many-to-many</p><h2>Build the alignment graph</h2>
      <p>Word rows may share transcript or proposal nodes. Detector regions are proposals, not word truth.</p>
      <div class="action-effect">Every visible span must reach a word. Every unconnected word, transcript, or proposal node receives an explicit gap.</div>
    </div>
    <div class="action-picker" role="group" aria-label="Stage B legal actions">
      <button type="button" data-action-choice="submit" aria-pressed="${submitSelected}"><i>1</i><span><strong>Submit alignment graph</strong><small>Validate all edges and explicit gaps</small></span></button>
      <button type="button" data-action-choice="defer" aria-pressed="${!submitSelected}"><i>!</i><span><strong>Defer this line</strong><small>Keep the ambiguity explicit</small></span></button>
    </div>
    ${submitSelected ? renderStageBSubmit(draft, inventory, gaps, options) : renderDeferForm(options.deferReasons, draft.defer)}`;
  }

  function renderStageBSubmit(draft, inventory, gaps, options) {
    const idsRemaining = inventory.allocatedWordIds.filter((id) => !draft.words.some((word) => word.word_unit_id === id));
    const insertedRemaining = inventory.allocatedInsertedSpanIds.filter((id) => !draft.inserted_visible_spans.some((span) => span.span_id === id));
    return `<form id="stage-b-form" class="stack-form" data-stage-form="stage-b" novalidate>
      <div class="tool-strip">
        <button class="tool-button" type="button" data-add-word ${idsRemaining.length ? "" : "disabled"}>＋ Add word row</button>
        <button class="tool-button" type="button" data-draw-mode="stage-b-inserted-span" aria-pressed="${state.drawing?.mode === "stage-b-inserted-span"}" ${insertedRemaining.length ? "" : "disabled"}>Draw missed visible span</button>
      </div>
      <section class="form-section"><div class="form-section-header"><h3>Visible span order</h3><span class="meta-chip">${inventory.allSpans.length}</span></div><p class="source-subtitle">Move any inserted span before or between stable Stage A spans. Stable IDs remain immutable; this list alone defines the graph’s semantic span order.</p><div class="card-list">${inventory.allSpans.map((span, index) => renderVisibleSpanOrderRow(span, index, inventory.allSpans.length)).join("") || `<div class="empty-state">No visible spans were supplied.</div>`}</div></section>
      ${draft.inserted_visible_spans.length ? `<section class="form-section"><div class="form-section-header"><h3>Inserted visible spans</h3></div><div class="card-list">${draft.inserted_visible_spans.map((span, index) => renderInsertedSpan(span, index, options)).join("")}</div></section>` : ""}
      <section class="form-section"><div class="form-section-header"><h3>Word units</h3><span class="meta-chip">${draft.words.length}</span></div><div class="card-list">${draft.words.length ? draft.words.map((word, index) => renderWordRow(word, index, inventory, options)).join("") : `<div class="empty-state">Add a word row; nothing is assumed one-to-one.</div>`}</div></section>
      <section class="form-section"><div class="form-section-header"><h3>Explicit gaps</h3><span class="meta-chip">${gaps.length}</span></div>${gaps.length ? renderGapGroups(gaps, draft, options) : `<p class="source-subtitle">All word, transcript, and proposal relations are accounted for.</p>`}</section>
      <label class="field"><span>Graph note</span><textarea rows="3" data-stage-b-graph-note placeholder="Explain the line-level graph and any many-to-many choices.">${escapeHTML(draft.graph_note || "")}</textarea></label>
      <p class="form-message" data-action-message hidden></p>
      <button class="primary-button primary-button--wide" type="submit" ${state.submittingAction ? "disabled" : ""}>Submit graph with ${draft.words.length} word unit${draft.words.length === 1 ? "" : "s"}</button>
    </form>`;
  }

  function renderVisibleSpanOrderRow(span, index, total) {
    const inserted = state.stageDraft.inserted_visible_spans.some((item) => item.span_id === span.span_id);
    const controls = inserted ? `<div><button class="mini-button" type="button" data-move-visible-span="${index}" data-direction="up" ${index === 0 ? "disabled" : ""} aria-label="Move ${escapeAttr(span.span_id)} earlier">↑</button> <button class="mini-button" type="button" data-move-visible-span="${index}" data-direction="down" ${index === total - 1 ? "disabled" : ""} aria-label="Move ${escapeAttr(span.span_id)} later">↓</button></div>` : `<small>relative order fixed</small>`;
    return `<article class="gap-card"><div class="card-title-row"><div><strong>${index + 1}. ${escapeHTML(span.span_id)}</strong> <code>${inserted ? "inserted" : "stable Stage A"}</code></div>${controls}</div></article>`;
  }

  function renderInsertedSpan(span, index, options) {
    const removable = index === state.stageDraft.inserted_visible_spans.length - 1;
    return `<article class="span-card">
      <div class="card-title-row"><strong>${escapeHTML(span.span_id)} · order ${escapeHTML(span.order)}</strong><button class="mini-button mini-button--danger" type="button" data-remove-inserted-span="${index}" ${removable ? "" : "disabled title=\"Remove later inserted spans first; IDs are a software-owned prefix.\""}>Remove</button></div>
      ${renderBboxFields(span.bbox_source_xywh, { scope: "inserted", index })}
      <div class="two-fields">${renderSelectField("Visible kind", options.visualKinds, span.visual_kind, `data-inserted-index="${index}" data-inserted-field="visual_kind"`)}${renderSelectField("Internal boundary", options.boundaries, span.internal_boundary_status, `data-inserted-index="${index}" data-inserted-field="internal_boundary_status"`)}</div>
      <div class="two-fields">${renderNumberField("Minimum words", span.estimated_word_count_min, `data-inserted-index="${index}" data-inserted-field="estimated_word_count_min"`, 0)}${renderNumberField("Maximum words", span.estimated_word_count_max, `data-inserted-index="${index}" data-inserted-field="estimated_word_count_max"`, 0)}</div>
      <fieldset class="field"><legend>Uncertainty flags</legend><div class="checkbox-grid">${options.uncertainties.map((value) => `<label class="check-pill"><input type="checkbox" value="${escapeAttr(value)}" data-inserted-index="${index}" data-inserted-field="uncertainty_flags" ${span.uncertainty_flags.includes(value) ? "checked" : ""}><span>${escapeHTML(readable(value))}</span></label>`).join("")}</div></fieldset>
      <label class="field"><span>Evidence note</span><input data-inserted-index="${index}" data-inserted-field="evidence_note" value="${escapeAttr(span.evidence_note || "")}"></label>
    </article>`;
  }

  function renderWordRow(word, index, inventory, options) {
    const removable = index === state.stageDraft.words.length - 1;
    return `<article class="word-card" data-word-card="${index}">
      <div class="card-title-row"><div><strong>Word ${index + 1}</strong> <code>${escapeHTML(word.word_unit_id)}</code></div><div><button class="mini-button" type="button" data-draw-word="${index}">Draw box</button> <button class="mini-button mini-button--danger" type="button" data-remove-word="${index}" ${removable ? "" : "disabled title=\"Remove later word rows first; IDs are a software-owned prefix.\""}>Remove</button></div></div>
      ${renderBboxFields(word.bbox_source_xywh, { scope: "word", index })}
      <div class="two-fields">${renderSelectField("Kind", options.wordKinds, word.kind, `data-word-index="${index}" data-word-field="kind"`)}<label class="field"><span>Text guess (optional)</span><input data-word-index="${index}" data-word-field="text_guess" value="${escapeAttr(word.text_guess || "")}"></label></div>
      <div class="two-fields">
        ${renderRelationSelect("Visible span · exactly one", inventory.allSpans, "span_id", word.span_ids[0] || "", `data-word-index="${index}" data-word-field="span_ids"`)}
        ${renderMultiSelect("Transcript nodes", inventory.transcriptNodes, "transcript_node_id", word.transcript_node_ids, `data-word-index="${index}" data-word-field="transcript_node_ids"`, "text")}
      </div>
      ${renderMultiSelect("Detector proposals", inventory.proposalNodes, "proposal_node_id", word.proposal_node_ids, `data-word-index="${index}" data-word-field="proposal_node_ids"`)}
      <label class="field"><span>Evidence note</span><input data-word-index="${index}" data-word-field="evidence_note" value="${escapeAttr(word.evidence_note || "")}" placeholder="Why do these nodes belong together?"></label>
    </article>`;
  }

  function renderGapRow(gap, draft, options) {
    const key = gapKey(gap);
    const value = draft.gaps[key] || { reason: "", evidence_note: "" };
    return `<article class="gap-card" data-gap-key="${escapeAttr(key)}"><h4>${escapeHTML(gap.node_type)} ${escapeHTML(gap.node_id)} lacks ${escapeHTML(gap.missing_relation)}</h4><div class="two-fields">${renderSelectField("Reason", options.gapReasons, value.reason, `data-gap-key="${escapeAttr(key)}" data-gap-field="reason"`, true)}<label class="field"><span>Evidence note</span><input data-gap-key="${escapeAttr(key)}" data-gap-field="evidence_note" value="${escapeAttr(value.evidence_note || "")}"></label></div></article>`;
  }

  function renderGapGroups(gaps, draft, options) {
    const groups = new Map();
    gaps.forEach((gap) => {
      const key = gap.node_type || "other";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(gap);
    });
    return `<div class="gap-groups">${[...groups.entries()].map(([nodeType, items]) => `<details class="gap-group" open><summary>${escapeHTML(readable(nodeType))} gaps · ${items.length}</summary><div class="gap-summary">${items.map((gap) => renderGapRow(gap, draft, options)).join("")}</div></details>`).join("")}</div>`;
  }

  function renderDeferForm(reasons, draft) {
    return `<form class="stack-form" data-stage-form="defer" novalidate>
      ${renderSelectField("Why must this line be deferred?", reasons, draft.reason || "", `data-defer-field="reason"`, true)}
      <label class="field"><span>Evidence note</span><textarea rows="4" data-defer-field="evidence_note" placeholder="State the concrete missing or unsafe evidence.">${escapeHTML(draft.evidence_note || "")}</textarea></label>
      <p class="form-message" data-action-message hidden></p>
      <button class="danger-button primary-button--wide" type="submit" ${state.submittingAction ? "disabled" : ""}>Defer line with an explicit blocker</button>
    </form>`;
  }

  function renderGenericAction(current) {
    const ui = current.action_ui || {};
    const actions = Array.isArray(ui.actions) ? ui.actions : [];
    const stageFamily = /ownership/i.test(current.stage_id) ? "ownership" : (/residual/i.test(current.stage_id) ? "residual" : "future");
    if (!actions.length) {
      els.actionPanel.innerHTML = `<div class="panel-intro"><p class="eyebrow">${escapeHTML(stageFamily)} placeholder</p><h2>${escapeHTML(ui.title || current.stage_name)}</h2><p>${escapeHTML(ui.detail || "The pipeline supplied no human form for this current action. This interface will not ask for raw JSON or invent controls.")}</p></div>${current.blockers?.length ? renderBlockers(current.blockers) : `<div class="inline-warning">No action form was materialized by <code>action_ui</code>.</div>`}`;
      return;
    }
    const selected = actions.find((action) => action.type === state.stageDraft?.generic_action_type) || actions[0];
    if (!state.stageDraft) state.stageDraft = {};
    state.stageDraft.generic_action_type = selected.type;
    const fields = Array.isArray(selected.fields) ? selected.fields : [];
    els.actionPanel.innerHTML = `<div class="panel-intro"><p class="eyebrow">${escapeHTML(stageFamily)} · Server-described form</p><h2>${escapeHTML(ui.title || current.stage_name)}</h2><p>${escapeHTML(ui.detail || selected.description || "Choose one legal current-stage action.")}</p>${current.next_effect ? `<div class="action-effect">${escapeHTML(current.next_effect)}</div>` : ""}</div>
      <div class="action-picker">${actions.map((action, index) => `<button type="button" data-generic-action="${escapeAttr(action.type)}" aria-pressed="${action.type === selected.type}"><i>${index + 1}</i><span><strong>${escapeHTML(action.label || readable(action.type))}</strong><small>${escapeHTML(action.description || action.effect || "")}</small></span></button>`).join("")}</div>
      <form class="stack-form" data-stage-form="generic" novalidate>${fields.map(renderGenericField).join("")}<p class="form-message" data-action-message hidden></p><button class="primary-button primary-button--wide" type="submit">${escapeHTML(selected.submit_label || `Submit ${readable(selected.type)}`)}</button></form>`;
  }

  function renderGenericField(field) {
    const key = field.key || field.name;
    const attrs = `data-generic-field="${escapeAttr(key)}"`;
    const value = state.stageDraft?.generic_values?.[key] ?? field.default ?? "";
    if (field.type === "select") return renderSelectField(field.label || readable(key), field.options || [], value, attrs, Boolean(field.required));
    if (field.type === "multiselect" || field.type === "component_ids") return renderMultiSelect(field.label || readable(key), field.options || [], "value", Array.isArray(value) ? value : [], `${attrs} multiple`, "label");
    if (field.type === "textarea") return `<label class="field"><span>${escapeHTML(field.label || readable(key))}</span><textarea rows="4" ${attrs} ${field.required ? "required" : ""}>${escapeHTML(value)}</textarea></label>`;
    if (field.type === "number") return renderNumberField(field.label || readable(key), value, attrs, field.min ?? 0);
    if (field.type === "checkbox") return `<label class="check-pill"><input type="checkbox" ${attrs} ${value ? "checked" : ""}><span>${escapeHTML(field.label || readable(key))}</span></label>`;
    if (field.type === "bbox") return `<fieldset class="field"><legend>${escapeHTML(field.label || readable(key))}</legend>${renderBboxFields(Array.isArray(value) ? value : [0,0,1,1], { scope: "generic", key })}</fieldset>`;
    return `<label class="field"><span>${escapeHTML(field.label || readable(key))}</span><input type="text" ${attrs} value="${escapeAttr(value)}" ${field.required ? "required" : ""}></label>`;
  }

  function renderInstructions(current) {
    const turn = current.agent_turn;
    if (!turn) {
      els.instructionsPanel.innerHTML = `<div class="panel-intro"><p class="eyebrow">No agent instruction</p><h2>Software-only state</h2><p>No prompt was materialized for this current stage.</p></div>`;
      return;
    }
    const prompt = turn.prompt || {};
    const status = prompt.status || "status_not_supplied";
    els.instructionsPanel.innerHTML = `<div class="panel-intro"><p class="eyebrow">Convenience mirror · exact bytes</p><h2>Prompt mirror</h2><p>The authoritative walkthrough is the ordered playback in Agent View. This tab mirrors the same verbatim prompt for easier reading; contradictions remain visible.</p></div>
      ${!promptStatusVerified(status) ? `<div class="inline-warning"><strong>Prompt status: ${escapeHTML(status)}</strong><br>The walkthrough will not silently repair this prompt.</div>` : ""}
      ${renderCongruence(turn.congruence)}
      <div class="prompt-block"><pre>${escapeHTML(prompt.text || "No prompt text was supplied.")}</pre>${renderIntegrityRow(prompt.sha256, "Prompt SHA-256", status)}</div>
      <section class="turn-order"><strong>Agent-turn content order</strong><ol>${(turn.content_order || []).map((item) => `<li>${escapeHTML(typeof item === "string" ? item : item.label || item.key)}</li>`).join("")}</ol></section>`;
  }

  function renderInspector(current) {
    const turn = current.agent_turn;
    const safeSoftwareState = {
      session_id: state.sessionData.session.id,
      stage_id: current.stage_id,
      stage_name: current.stage_name,
      revision: current.revision,
      item_label: current.item_label,
      kind: current.kind,
      provenance: current.provenance,
      blockers: current.blockers,
      agent_turn_sha256: turn?.agent_turn_sha256 || null,
    };
    els.inspectorPanel.innerHTML = `<div class="panel-intro"><p class="eyebrow">Convenience mirror · strict inspector</p><h2>Packet and schema mirror</h2><p>The model-visible packet and schema also appear in their authoritative order in Agent View. This troubleshooting mirror adds only the safe current software-state summary; no future or private state is requested.</p></div>
      <div class="inspector-label"><strong>Software state — not model evidence</strong><br>Cursor, provenance, and blockers explain why this turn is current.</div>
      <details class="raw-block"><summary>Safe software-state summary</summary><pre>${escapeHTML(JSON.stringify(safeSoftwareState, null, 2))}</pre></details>
      ${turn ? `<details class="raw-block" open><summary>Model-visible packet · ${escapeHTML(shortHash(turn.packet?.sha256))}</summary><pre>${escapeHTML(JSON.stringify(turn.packet?.value ?? null, null, 2))}</pre></details>
      <details class="raw-block"><summary>Response schema · ${escapeHTML(shortHash(turn.response_schema?.sha256))}</summary><pre>${escapeHTML(JSON.stringify(turn.response_schema?.value ?? null, null, 2))}</pre></details>
      <details class="raw-block"><summary>Agent-turn manifest</summary><pre>${escapeHTML(JSON.stringify({ agent_turn_sha256: turn.agent_turn_sha256, content_order: turn.content_order, prompt: { sha256: turn.prompt?.sha256, status: turn.prompt?.status }, packet_sha256: turn.packet?.sha256, response_schema_sha256: turn.response_schema?.sha256, evidence: (turn.evidence || []).map(({ key, sha256, role, size_wh }) => ({ key, sha256, role, size_wh })), withheld: turn.withheld, congruence: turn.congruence }, null, 2))}</pre></details>` : `<div class="empty-state">No agent packet or response schema exists for this state.</div>`}`;
  }

  function renderNotebook(data) {
    const options = data.note_options || {};
    const categories = normalizeOptions(options.categories || []);
    const severities = normalizeOptions(options.severities || []);
    const limits = data.upload_limits || {};
    const form = els.noteForm;
    const category = form.elements.category;
    const severity = form.elements.severity;
    const priorCategory = category.value;
    const priorSeverity = severity.value;
    category.innerHTML = categories.map((option) => `<option value="${escapeAttr(option.value)}">${escapeHTML(option.label)}</option>`).join("");
    severity.innerHTML = severities.map((option) => `<option value="${escapeAttr(option.value)}">${escapeHTML(option.label)}</option>`).join("");
    if (categories.some((option) => option.value === priorCategory)) category.value = priorCategory;
    if (severities.some((option) => option.value === priorSeverity)) severity.value = priorSeverity;
    const maxChars = Number(limits.max_note_characters || 5000);
    form.elements.text.maxLength = maxChars;
    els.noteCharLimit.textContent = maxChars.toLocaleString();
    els.uploadHint.textContent = uploadHint(limits);
    const sourceEvidence = data.current.source_evidence ? (Array.isArray(data.current.source_evidence) ? data.current.source_evidence : (data.current.source_evidence.items || [data.current.source_evidence])) : [];
    const evidence = [...(data.current.agent_turn?.evidence || []), ...sourceEvidence].filter((item) => item && (item.ref || item.key || item.url));
    const evidenceSelect = form.elements.evidence_ref;
    const priorEvidence = evidenceSelect.value;
    evidenceSelect.innerHTML = `<option value="">Current stage (no image attached)</option>${evidence.map((item) => `<option value="${escapeAttr(item.ref || item.url || item.key)}">${escapeHTML(item.label || item.key || "Source evidence")}</option>`).join("")}`;
    if (evidence.some((item) => (item.ref || item.url || item.key) === priorEvidence)) evidenceSelect.value = priorEvidence;
    restoreNoteDraft();
    renderTelemetrySummary(data.telemetry_summary);
    const notes = Array.isArray(data.notes) ? data.notes : [];
    els.noteCount.textContent = String(notes.length);
    els.notesList.innerHTML = notes.length ? notes.map(renderNote).join("") : `<div class="empty-state">No notes yet. Capture friction at the stage where it happens.</div>`;
  }

  function renderTelemetrySummary(summary) {
    let host = els.notebookPanel.querySelector("#telemetry-summary");
    if (!summary || typeof summary !== "object") {
      host?.remove();
      return;
    }
    if (!host) {
      host = document.createElement("section");
      host.id = "telemetry-summary";
      host.className = "receipt-card";
      els.notebookPanel.querySelector(".note-history")?.before(host);
    }
    const counts = summary.counts && typeof summary.counts === "object" ? summary.counts : (summary.event_counts && typeof summary.event_counts === "object" ? summary.event_counts : {});
    const total = Number(summary.total_events ?? summary.total ?? Object.values(counts).reduce((sum, value) => sum + (Number(value) || 0), 0));
    const failures = Number(summary.action_failed ?? counts.action_failed ?? 0);
    const successes = Number(summary.successful_actions ?? summary.action_succeeded ?? counts.action_succeeded ?? 0);
    const retries = Number(summary.retry_count ?? summary.retries ?? 0);
    const notes = Number(summary.note_count ?? counts.note_saved ?? 0);
    const byStage = summary.by_stage && typeof summary.by_stage === "object" ? Object.entries(summary.by_stage).slice(0, 5) : [];
    const byItem = Array.isArray(summary.by_item_binding) ? summary.by_item_binding.slice(0, 3) : [];
    host.innerHTML = `<p class="eyebrow">Session telemetry · software state</p><h3>What slowed this session down</h3><div class="turn-meta"><span class="meta-chip">${escapeHTML(countLabel(total, "event"))}</span><span class="meta-chip">${escapeHTML(countLabel(successes, "saved action"))}</span><span class="meta-chip">${escapeHTML(countLabel(failures, "failed action"))}</span><span class="meta-chip">${escapeHTML(countLabel(retries, "retry", "retries"))}</span><span class="meta-chip">${escapeHTML(countLabel(notes, "note"))}</span></div>${byStage.length ? `<p class="source-subtitle">By stage: ${byStage.map(([stage, value]) => `${escapeHTML(readable(stage))} ${escapeHTML(typeof value === "object" ? value.total_events ?? value.total ?? value.count ?? "" : value)}`).join(" · ")}</p>` : `<p class="source-subtitle">Detailed stage timing will appear as this session accumulates interaction receipts.</p>`}${byItem.length ? `<p class="source-subtitle">Most interaction: ${byItem.map((item) => `${escapeHTML(item.item_label || "Unknown item")} ${escapeHTML(item.total_events ?? 0)}`).join(" · ")}</p>` : ""}`;
  }

  function countLabel(count, singular, plural = `${singular}s`) {
    return `${count} ${Number(count) === 1 ? singular : plural}`;
  }

  function renderNote(note) {
    const attachmentUrl = note.attachment?.url || note.screenshot_url;
    const evidenceLabel = note.evidence?.label || note.evidence?.evidence_key || note.evidence?.ref || note.evidence_ref;
    return `<article class="note-card"><header><span>${escapeHTML(readable(note.category || "note"))} · ${escapeHTML(readable(note.severity || ""))}</span><time>${escapeHTML(formatDate(note.created_at || note.updated_at))}</time></header>${note.text ? `<p>${escapeHTML(note.text)}</p>` : ""}${evidenceLabel ? `<small>Evidence: ${escapeHTML(evidenceLabel)}</small>` : ""}${attachmentUrl ? `<img src="${escapeAttr(attachmentUrl)}" alt="Screenshot attached to note">` : ""}</article>`;
  }

  function handleClick(event) {
    const copyHash = event.target.closest("[data-copy-hash]");
    if (copyHash) {
      copyIntegrityHash(copyHash.dataset.copyHash).catch(() => toast("The hash could not be copied. It remains visible for manual selection.", "error"));
      return;
    }
    const evidence = event.target.closest("[data-evidence-key]");
    if (evidence) queueTelemetry("evidence_viewed", { evidence_key: evidence.dataset.evidenceKey }, `evidence:${evidence.dataset.evidenceKey}`, 250);
    const start = event.target.closest("[data-start-source]");
    if (start) return startSession(start.dataset.startSource);
    const resume = event.target.closest("[data-resume-session]");
    if (resume) return loadSession(resume.dataset.resumeSession);
    const controlTab = event.target.closest("[data-control-tab]");
    if (controlTab) return switchControlTab(controlTab.dataset.controlTab);
    const mobile = event.target.closest(".mobile-nav button[data-mobile-section]");
    if (mobile) return switchMobileSection(mobile.dataset.mobileSection);
    const choice = event.target.closest("[data-action-choice]");
    if (choice) {
      state.actionChoice = choice.dataset.actionChoice;
      queueTelemetry("action_form_opened", { action_choice: state.actionChoice }, "action-choice", 150);
      saveStageDraft();
      renderActionPanel(state.sessionData.current);
      return;
    }
    const generic = event.target.closest("[data-generic-action]");
    if (generic) {
      state.stageDraft.generic_action_type = generic.dataset.genericAction;
      state.stageDraft.generic_values = {};
      saveStageDraft();
      renderActionPanel(state.sessionData.current);
      return;
    }
    if (event.target.closest("[data-add-stage-a-span]")) return addStageASpan();
    const removeSpan = event.target.closest("[data-remove-stage-a-span]");
    if (removeSpan) return removeStageASpan(Number(removeSpan.dataset.removeStageASpan));
    const moveSpan = event.target.closest("[data-move-stage-a-span]");
    if (moveSpan) return moveStageASpan(Number(moveSpan.dataset.moveStageASpan), moveSpan.dataset.direction);
    if (event.target.closest("[data-add-word]")) return addWordRow();
    const removeWord = event.target.closest("[data-remove-word]");
    if (removeWord) return removeWordRow(Number(removeWord.dataset.removeWord));
    const removeInserted = event.target.closest("[data-remove-inserted-span]");
    if (removeInserted) return removeInsertedSpan(Number(removeInserted.dataset.removeInsertedSpan));
    const moveVisible = event.target.closest("[data-move-visible-span]");
    if (moveVisible) return moveVisibleSpan(Number(moveVisible.dataset.moveVisibleSpan), moveVisible.dataset.direction);
    const drawMode = event.target.closest("[data-draw-mode]");
    if (drawMode) return toggleDrawing(drawMode.dataset.drawMode);
    const drawWord = event.target.closest("[data-draw-word]");
    if (drawWord) return toggleDrawing("stage-b-word", Number(drawWord.dataset.drawWord));
  }

  async function copyIntegrityHash(hash) {
    if (!hash) throw new UIError("No hash was supplied.");
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(hash);
    } else {
      const input = document.createElement("textarea");
      input.value = hash;
      input.setAttribute("readonly", "");
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.append(input);
      input.select();
      const copied = document.execCommand("copy");
      input.remove();
      if (!copied) throw new UIError("Clipboard copy was unavailable.");
    }
    toast("Hash copied.");
  }

  function handleInput(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) return;
    if (target.closest("#note-form")) {
      if (target.name === "text") els.noteCharCount.textContent = String(target.value.length);
      saveNoteDraft();
      return;
    }
    if (!state.stageDraft) return;
    if (target.matches("[data-stage-a-line-note]")) state.stageDraft.line_note = target.value;
    if (target.dataset.stageAIndex !== undefined) updateStageAField(target);
    if (target.dataset.insertedIndex !== undefined) updateInsertedField(target);
    if (target.dataset.wordIndex !== undefined) updateWordField(target);
    if (target.dataset.gapKey) updateGapField(target);
    if (target.dataset.deferField) state.stageDraft.defer[target.dataset.deferField] = valueFromControl(target);
    if (target.dataset.stageBGraphNote !== undefined) state.stageDraft.graph_note = target.value;
    if (target.dataset.genericField) {
      state.stageDraft.generic_values ||= {};
      state.stageDraft.generic_values[target.dataset.genericField] = valueFromControl(target);
    }
    if (target.dataset.bboxScope) updateBboxField(target);
    saveStageDraft();
    redrawAllCanvases();
  }

  function handleSubmit(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.id === "note-form") {
      event.preventDefault();
      saveNote();
      return;
    }
    const stage = form.dataset.stageForm;
    if (!stage) return;
    event.preventDefault();
    if (stage === "stage-a") submitStageA();
    else if (stage === "stage-b") submitStageB();
    else if (stage === "defer") submitDefer();
    else if (stage === "generic") submitGeneric();
    else if (stage === "source-start") submitSourceStart();
  }

  function switchControlTab(tab, { renderOnly = false } = {}) {
    const allowed = ["action", "instructions", "inspector", "notebook"];
    if (!allowed.includes(tab)) return;
    state.controlTab = tab;
    document.querySelectorAll("[data-control-tab]").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.controlTab === tab)));
    allowed.forEach((name) => {
      const panel = document.querySelector(`#panel-${name}`);
      if (panel) panel.hidden = name !== tab;
    });
    if (!renderOnly) {
      const telemetryByTab = {
        action: "action_form_opened",
        instructions: "instructions_viewed",
        inspector: "inspector_viewed",
        notebook: "note_opened",
      };
      sendTelemetry(telemetryByTab[tab], {}).catch(() => {});
    }
    if (window.matchMedia("(max-width: 900px)").matches) switchMobileSection("controls");
  }

  function switchMobileSection(section) {
    if (!["stages", "agent", "controls"].includes(section)) return;
    state.mobileSection = section;
    els.app.dataset.mobileSection = section;
    document.querySelectorAll(".mobile-nav button[data-mobile-section]").forEach((button) => button.setAttribute("aria-current", button.dataset.mobileSection === section ? "page" : "false"));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function prepareTurnDraft() {
    const current = state.sessionData.current;
    const hash = current.agent_turn?.agent_turn_sha256 || `software:${current.stage_id}:${current.revision}`;
    if (hash === state.agentTurnHash && state.stageDraft) return;
    state.agentTurnHash = hash;
    state.actionChoice = "submit";
    state.drawing = null;
    state.drawingPreview = null;
    const restored = readStorage(stageDraftKey());
    state.stageDraft = restored && restored.agent_turn_sha256 === hash ? restored.value : null;
    if (restored && restored.agent_turn_sha256 === hash && ["submit", "defer"].includes(restored.action_choice)) {
      state.actionChoice = restored.action_choice;
    }
  }

  function ensureStageADraft(current) {
    if (state.stageDraft?.kind === "stage_a") return state.stageDraft;
    state.stageDraft = { kind: "stage_a", spans: [], line_note: "", defer: { reason: "", evidence_note: "" } };
    saveStageDraft();
    return state.stageDraft;
  }

  function ensureStageBDraft(current) {
    if (state.stageDraft?.kind === "stage_b") return state.stageDraft;
    const stable = current.agent_turn?.packet?.value?.stage_a_binding?.stable_visible_spans || [];
    state.stageDraft = { kind: "stage_b", inserted_visible_spans: [], visible_span_order: stable.map((span) => span.span_id), words: [], gaps: {}, graph_note: "", defer: { reason: "", evidence_note: "" } };
    saveStageDraft();
    return state.stageDraft;
  }

  function normalizeVisibleSpanOrder(draft, current) {
    const stable = current.agent_turn?.packet?.value?.stage_a_binding?.stable_visible_spans || [];
    const stableIds = stable.map((span) => span.span_id);
    const stableSet = new Set(stableIds);
    const allowed = [...stableIds, ...draft.inserted_visible_spans.map((span) => span.span_id)];
    const allowedSet = new Set(allowed);
    const seen = new Set();
    const prior = Array.isArray(draft.visible_span_order) ? draft.visible_span_order : [];
    const normalized = [...prior, ...allowed].filter((id) => {
      if (!allowedSet.has(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    let stableIndex = 0;
    draft.visible_span_order = normalized.map((id) => stableSet.has(id) ? stableIds[stableIndex++] : id);
    syncInsertedSpanOrders(draft);
  }

  function syncInsertedSpanOrders(draft) {
    draft.inserted_visible_spans.forEach((span) => {
      const position = draft.visible_span_order.indexOf(span.span_id);
      if (position >= 0) span.order = position + 1;
    });
  }

  function saveStageDraft() {
    if (!state.sessionId || !state.agentTurnHash || !state.stageDraft) return;
    writeStorage(stageDraftKey(), { agent_turn_sha256: state.agentTurnHash, value: state.stageDraft, action_choice: state.actionChoice });
  }

  function stageDraftKey() { return `letter-pipeline-stage:${state.sessionId}:${state.agentTurnHash}`; }

  function addStageASpan(bbox = [0, 0, 1, 1]) {
    const draft = ensureStageADraft(state.sessionData.current);
    const options = stageAOptions(state.sessionData.current.agent_turn.response_schema?.value || {});
    draft.spans.push({
      order: draft.spans.length + 1,
      bbox_source_xywh: bbox,
      visual_kind: options.visualKinds[0] || "",
      estimated_word_count_min: 1,
      estimated_word_count_max: 1,
      internal_boundary_status: options.boundaries[0] || "",
      uncertainty_flags: options.uncertainties.includes("none") ? ["none"] : [],
      evidence_note: "",
    });
    saveStageDraft();
    renderActionPanel(state.sessionData.current);
    redrawAllCanvases();
  }

  function removeStageASpan(index) {
    state.stageDraft.spans.splice(index, 1);
    state.stageDraft.spans.forEach((span, position) => { span.order = position + 1; });
    saveStageDraft();
    renderActionPanel(state.sessionData.current);
    redrawAllCanvases();
  }

  function moveStageASpan(index, direction) {
    const target = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || target < 0 || index >= state.stageDraft.spans.length || target >= state.stageDraft.spans.length) return;
    [state.stageDraft.spans[index], state.stageDraft.spans[target]] = [state.stageDraft.spans[target], state.stageDraft.spans[index]];
    state.stageDraft.spans.forEach((span, position) => { span.order = position + 1; });
    saveStageDraft();
    queueTelemetry("rectangle_edited", { scope: "stage_a", edit_type: "semantic_reorder" }, "stage-a-reorder");
    renderActionPanel(state.sessionData.current);
    redrawAllCanvases();
  }

  function updateStageAField(target) {
    const span = state.stageDraft.spans[Number(target.dataset.stageAIndex)];
    if (!span) return;
    const field = target.dataset.stageField;
    if (field === "uncertainty_flags") {
      span.uncertainty_flags = exclusiveUncertaintyValues(target, document.querySelectorAll(`[data-stage-a-index="${target.dataset.stageAIndex}"][data-stage-field="uncertainty_flags"]`));
    } else if (field.startsWith("estimated_")) span[field] = integerValue(target.value);
    else span[field] = target.value;
  }

  function addWordRow() {
    const draft = ensureStageBDraft(state.sessionData.current);
    const inventory = graphInventory(state.sessionData.current.agent_turn.packet?.value || {}, draft);
    const id = inventory.allocatedWordIds.find((candidate) => !draft.words.some((word) => word.word_unit_id === candidate));
    if (!id) return toast("No unused software-allocated word IDs remain.", "error");
    const options = stageBOptions(state.sessionData.current.agent_turn.response_schema?.value || {});
    draft.words.push({ word_unit_id: id, order: draft.words.length + 1, bbox_source_xywh: [0,0,1,1], kind: options.wordKinds[0] || "", text_guess: "", evidence_note: "", span_ids: [], transcript_node_ids: [], proposal_node_ids: [] });
    queueTelemetry("graph_link_changed", { edit_type: "word_added", word_count: draft.words.length }, "graph-structure");
    saveStageDraft();
    renderActionPanel(state.sessionData.current);
  }

  function removeWordRow(index) {
    if (index !== state.stageDraft.words.length - 1) return toast("Remove later word rows first so the software-owned ID prefix stays exact.", "error");
    state.stageDraft.words.splice(index, 1);
    queueTelemetry("graph_link_changed", { edit_type: "word_removed", word_count: state.stageDraft.words.length }, "graph-structure");
    state.stageDraft.words.forEach((word, position) => { word.order = position + 1; });
    saveStageDraft();
    renderActionPanel(state.sessionData.current);
    redrawAllCanvases();
  }

  function updateWordField(target) {
    const index = Number(target.dataset.wordIndex);
    const word = state.stageDraft.words[index];
    if (!word) return;
    const field = target.dataset.wordField;
    word[field] = field === "span_ids" ? (target.value ? [target.value] : []) : valueFromControl(target);
    const relationFields = ["span_ids", "transcript_node_ids", "proposal_node_ids"];
    if (field === "span_ids" && word.span_ids.length === 1 && isPlaceholderBbox(word.bbox_source_xywh)) {
      const inventory = graphInventory(state.sessionData.current.agent_turn.packet?.value || {}, state.stageDraft);
      const span = inventory.allSpans.find((candidate) => candidate.span_id === word.span_ids[0]);
      if (span?.bbox_source_xywh) word.bbox_source_xywh = [...span.bbox_source_xywh];
    }
    if (relationFields.includes(field)) {
      queueTelemetry("graph_link_changed", { relation: field, word_index: index + 1, selected_count: word[field].length }, `graph:${index}:${field}`);
      renderActionPanel(state.sessionData.current);
    }
  }

  function updateInsertedField(target) {
    const span = state.stageDraft.inserted_visible_spans[Number(target.dataset.insertedIndex)];
    if (!span) return;
    const field = target.dataset.insertedField;
    if (field === "uncertainty_flags") {
      span.uncertainty_flags = exclusiveUncertaintyValues(target, document.querySelectorAll(`[data-inserted-index="${target.dataset.insertedIndex}"][data-inserted-field="uncertainty_flags"]`));
    } else if (field.startsWith("estimated_")) span[field] = integerValue(target.value);
    else span[field] = target.value;
  }

  function removeInsertedSpan(index) {
    if (index !== state.stageDraft.inserted_visible_spans.length - 1) return toast("Remove later inserted spans first so the software-owned ID prefix stays exact.", "error");
    const removed = state.stageDraft.inserted_visible_spans.splice(index, 1)[0];
    if (removed) {
      state.stageDraft.visible_span_order = (state.stageDraft.visible_span_order || []).filter((id) => id !== removed.span_id);
      state.stageDraft.words.forEach((word) => { word.span_ids = word.span_ids.filter((id) => id !== removed.span_id); });
    }
    queueTelemetry("graph_link_changed", { edit_type: "inserted_span_removed", inserted_count: state.stageDraft.inserted_visible_spans.length }, "graph-inserted-spans");
    saveStageDraft();
    renderActionPanel(state.sessionData.current);
    redrawAllCanvases();
  }

  function moveVisibleSpan(index, direction) {
    const order = state.stageDraft.visible_span_order || [];
    const target = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || target < 0 || index >= order.length || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    syncInsertedSpanOrders(state.stageDraft);
    queueTelemetry("graph_link_changed", { edit_type: "visible_span_reorder", inserted_span_id: order[target] }, "graph-span-order");
    saveStageDraft();
    renderActionPanel(state.sessionData.current);
  }

  function updateGapField(target) {
    state.stageDraft.gaps[target.dataset.gapKey] ||= { reason: "", evidence_note: "" };
    state.stageDraft.gaps[target.dataset.gapKey][target.dataset.gapField] = target.value;
  }

  function updateBboxField(target) {
    const scope = target.dataset.bboxScope;
    const coordinate = Number(target.dataset.bboxCoordinate);
    let bbox;
    if (scope === "stage-a") bbox = state.stageDraft.spans[Number(target.dataset.bboxIndex)]?.bbox_source_xywh;
    if (scope === "inserted") bbox = state.stageDraft.inserted_visible_spans[Number(target.dataset.bboxIndex)]?.bbox_source_xywh;
    if (scope === "word") bbox = state.stageDraft.words[Number(target.dataset.bboxIndex)]?.bbox_source_xywh;
    if (scope === "generic") {
      state.stageDraft.generic_values ||= {};
      bbox = state.stageDraft.generic_values[target.dataset.bboxKey] ||= [0,0,1,1];
    }
    if (bbox) bbox[coordinate] = integerValue(target.value);
    queueTelemetry("rectangle_edited", { scope, coordinate }, `bbox:${scope}:${target.dataset.bboxIndex || target.dataset.bboxKey || "current"}`);
  }

  function submitStageA() {
    const draft = state.stageDraft;
    const errors = [];
    if (!draft.spans.length) errors.push("Draw or enter at least one visible span.");
    draft.spans.forEach((span, index) => {
      if (!validBbox(span.bbox_source_xywh)) errors.push(`Span ${index + 1} needs a valid source box.`);
      if (!span.visual_kind || !span.internal_boundary_status) errors.push(`Span ${index + 1} is missing a controlled classification.`);
      if (span.estimated_word_count_min > span.estimated_word_count_max) errors.push(`Span ${index + 1} has a minimum word count above its maximum.`);
      if (!span.uncertainty_flags.length) errors.push(`Span ${index + 1} needs at least one uncertainty flag, including “none” when appropriate.`);
      if (!span.evidence_note.trim()) errors.push(`Span ${index + 1} needs an evidence note.`);
    });
    if (!draft.line_note.trim()) errors.push("Add a line note.");
    if (errors.length) return showActionErrors(errors);
    const action = {
      type: "submit_visible_inventory",
      visible_span_count: draft.spans.length,
      spans: draft.spans.map((span, index) => ({
        order: index + 1,
        bbox_source_xywh: span.bbox_source_xywh.map(integerValue),
        visual_kind: span.visual_kind,
        estimated_word_count_min: integerValue(span.estimated_word_count_min),
        estimated_word_count_max: integerValue(span.estimated_word_count_max),
        internal_boundary_status: span.internal_boundary_status,
        uncertainty_flags: [...span.uncertainty_flags],
        evidence_note: span.evidence_note.trim(),
      })),
      line_note: draft.line_note.trim(),
    };
    submitScopedAction(action);
  }

  function submitStageB() {
    const draft = state.stageDraft;
    const packet = state.sessionData.current.agent_turn.packet?.value || {};
    normalizeVisibleSpanOrder(draft, state.sessionData.current);
    const inventory = graphInventory(packet, draft);
    const gaps = deriveGraphGaps(draft, inventory);
    const errors = [];
    if (!draft.words.length) errors.push("Add at least one word unit.");
    const linkedSpans = new Set();
    draft.words.forEach((word, index) => {
      if (!validBbox(word.bbox_source_xywh)) errors.push(`Word ${index + 1} needs a valid source box.`);
      if (!word.kind || !word.evidence_note.trim()) errors.push(`Word ${index + 1} needs a kind and evidence note.`);
      if (word.span_ids.length !== 1) errors.push(`Word ${index + 1} must connect to exactly one visible span.`);
      word.span_ids.forEach((id) => linkedSpans.add(id));
    });
    const unlinkedSpans = inventory.allSpans.filter((span) => !linkedSpans.has(span.span_id));
    if (unlinkedSpans.length) errors.push(`Every visible span must connect to a word: ${unlinkedSpans.map((span) => span.span_id).join(", ")}.`);
    gaps.forEach((gap) => {
      const value = draft.gaps[gapKey(gap)];
      if (!value?.reason || !value.evidence_note?.trim()) errors.push(`Complete the explicit gap for ${gap.node_type} ${gap.node_id} → ${gap.missing_relation}.`);
    });
    if (!draft.graph_note.trim()) errors.push("Add a graph note.");
    const allSpanIds = inventory.allSpans.map((span) => span.span_id);
    if (draft.visible_span_order.length !== allSpanIds.length || new Set(draft.visible_span_order).size !== allSpanIds.length || draft.visible_span_order.some((id) => !allSpanIds.includes(id))) {
      errors.push("Visible span order must contain every stable and inserted span exactly once.");
    }
    if (errors.length) return showActionErrors(errors);

    const graph = {
      inserted_visible_spans: draft.inserted_visible_spans.map((span) => cleanInsertedSpan(span, draft.visible_span_order.indexOf(span.span_id) + 1)),
      visible_span_order: [...draft.visible_span_order],
      word_units: draft.words.map((word, index) => ({
        word_unit_id: word.word_unit_id,
        order: index + 1,
        bbox_source_xywh: word.bbox_source_xywh.map(integerValue),
        kind: word.kind,
        text_guess: word.text_guess.trim() || null,
        evidence_note: word.evidence_note.trim(),
      })),
      span_word_edges: draft.words.flatMap((word) => word.span_ids.map((span_id) => ({ span_id, word_unit_id: word.word_unit_id }))),
      word_transcript_edges: draft.words.flatMap((word) => word.transcript_node_ids.map((transcript_node_id) => ({ word_unit_id: word.word_unit_id, transcript_node_id }))),
      word_proposal_edges: draft.words.flatMap((word) => word.proposal_node_ids.map((proposal_node_id) => ({ word_unit_id: word.word_unit_id, proposal_node_id }))),
      explicit_gaps: gaps.map((gap) => ({ ...gap, reason: draft.gaps[gapKey(gap)].reason, evidence_note: draft.gaps[gapKey(gap)].evidence_note.trim() })),
      graph_note: draft.graph_note.trim(),
    };
    submitScopedAction({ type: "submit_alignment_graph", graph });
  }

  function cleanInsertedSpan(span, order) {
    return {
      span_id: span.span_id,
      order: integerValue(order),
      bbox_source_xywh: span.bbox_source_xywh.map(integerValue),
      visual_kind: span.visual_kind,
      estimated_word_count_min: integerValue(span.estimated_word_count_min),
      estimated_word_count_max: integerValue(span.estimated_word_count_max),
      internal_boundary_status: span.internal_boundary_status,
      uncertainty_flags: [...span.uncertainty_flags],
      evidence_note: span.evidence_note.trim(),
    };
  }

  function submitDefer() {
    const defer = state.stageDraft.defer || {};
    const errors = [];
    if (!defer.reason) errors.push("Choose the exact defer reason.");
    if (!defer.evidence_note?.trim()) errors.push("Add a concrete evidence note.");
    if (errors.length) return showActionErrors(errors);
    submitScopedAction({ type: "defer_line", reason: defer.reason, evidence_note: defer.evidence_note.trim() });
  }

  function submitGeneric() {
    const current = state.sessionData.current;
    const ui = current.action_ui || {};
    const actionDef = (ui.actions || []).find((action) => action.type === state.stageDraft.generic_action_type);
    if (!actionDef) return showActionErrors(["The selected action is no longer described by this stage."]);
    const values = state.stageDraft.generic_values || {};
    const errors = [];
    (actionDef.fields || []).forEach((field) => {
      const value = values[field.key || field.name];
      if (field.required && (value === "" || value == null || (Array.isArray(value) && !value.length))) errors.push(`${field.label || readable(field.key || field.name)} is required.`);
    });
    if (errors.length) return showActionErrors(errors);
    const base = actionDef.action_template && typeof actionDef.action_template === "object" ? structuredClone(actionDef.action_template) : { type: actionDef.type };
    Object.assign(base, values);
    submitScopedAction(base);
  }

  function submitSourceStart() {
    const current = state.sessionData.current;
    const configured = (current.action_ui?.actions || []).find((action) => action.type === "begin_prepared_protocol")?.action || current.action_ui?.action;
    const action = configured && typeof configured === "object" ? structuredClone(configured) : { type: "begin_prepared_protocol" };
    if (action.type !== "begin_prepared_protocol") return showActionErrors(["The prepared-source action changed. Refresh the exact session head."]);
    submitScopedAction(action);
  }

  async function submitScopedAction(action) {
    if (state.submittingAction) return;
    const current = state.sessionData.current;
    const currentSha = current.current_sha256;
    const agentTurnSha = current.agent_turn?.agent_turn_sha256 || null;
    if (!currentSha || (current.agent_turn && !agentTurnSha)) return showActionErrors(["This software action has no immutable current-state binding."]);
    state.submittingAction = true;
    renderActionPanel(current);
    const oldHash = agentTurnSha;
    let actionAccepted = false;
    try {
      await sendTelemetry("action_submitted", { action_type: action.type }).catch(() => {});
      const data = await requestJson(API.actions(state.sessionId), {
        method: "POST",
        headers: writeHeaders(),
        body: JSON.stringify({ pipeline_revision: current.revision, agent_turn_sha256: oldHash, action }),
      });
      actionAccepted = true;
      removeStorage(stageDraftKey());
      if (data.committed === true && data.refresh_failed === true) {
        state.submittingAction = true;
        renderActionPanel(current);
        const refreshMessage = data.refresh_error?.message || "The saved successor could not be loaded.";
        showActionErrors([`Saved; refresh failed. ${refreshMessage} Use Refresh to reload the exact saved head.`]);
        toast("Saved; refresh failed. Reload the exact head before continuing.", "error");
        return;
      }
      toast("Action accepted. The software issued the next exact state.");
      if (data.current && data.session && data.stage_graph) {
        const turnChanged = currentTurnIdentity(current) !== currentTurnIdentity(data.current);
        state.sessionData = data;
        state.csrfToken = data.csrf_token || state.csrfToken;
        state.submittingAction = false;
        if (turnChanged) state.controlTab = "action";
        prepareTurnDraft();
        render();
        if (turnChanged) resetTurnScrollOwners();
      } else {
        state.submittingAction = false;
        await loadSession(state.sessionId, { updateHash: false });
      }
    } catch (error) {
      if (actionAccepted) {
        state.submittingAction = true;
        renderActionPanel(current);
        showActionErrors(["This action is saved. Refresh the session before doing anything else on this stage."]);
        toast("Action saved, but the next exact state could not be displayed. Use Refresh to resume the saved head.", "error");
        return;
      }
      state.submittingAction = false;
      await sendTelemetry("action_failed", { action_type: action.type, error_code: error.code || "request_failed" }).catch(() => {});
      if (error.status === 409) {
        toast("This stage changed in another tab. Your local draft was preserved; refreshing the exact head.", "error");
        await loadSession(state.sessionId, { updateHash: false });
      } else {
        renderActionPanel(current);
        showActionErrors([publicError(error)]);
      }
    }
  }

  function showActionErrors(errors) {
    const message = document.querySelector("[data-action-message]");
    if (!message) return toast(errors[0], "error");
    message.hidden = false;
    message.innerHTML = errors.map((error) => escapeHTML(error)).join("<br>");
    message.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function toggleDrawing(mode, index = null) {
    if (state.drawing?.mode === mode && state.drawing?.index === index) state.drawing = null;
    else state.drawing = { mode, index, start: null, end: null };
    state.drawingPreview = null;
    renderActionPanel(state.sessionData.current);
    renderAgentView(state.sessionData.current);
    if (state.drawing) {
      switchMobileSection("agent");
      toast("Drag a rectangle on the upright plain evidence. Exact source coordinates will be recorded.");
    }
  }

  function handlePointerDown(event) {
    const canvas = event.target.closest("canvas[data-drawing-canvas]");
    if (!canvas || !state.drawing) return;
    queueTelemetry("evidence_viewed", { evidence_key: canvas.dataset.drawingCanvas, interaction: "rectangle_tool" }, `evidence:${canvas.dataset.drawingCanvas}`, 100);
    const point = canvasPoint(event, canvas);
    state.drawing.start = point;
    state.drawing.end = point;
    state.drawing.canvasKey = canvas.dataset.drawingCanvas;
    canvas.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    redrawCanvas(canvas);
  }

  function handlePointerMove(event) {
    if (!state.drawing?.start) return;
    const canvas = document.querySelector(`canvas[data-drawing-canvas="${cssEscape(state.drawing.canvasKey)}"]`);
    if (!canvas) return;
    state.drawing.end = canvasPoint(event, canvas);
    redrawCanvas(canvas);
  }

  function handlePointerUp(event) {
    if (!state.drawing?.start) return;
    const drawing = { ...state.drawing };
    const canvas = document.querySelector(`canvas[data-drawing-canvas="${cssEscape(drawing.canvasKey)}"]`);
    if (!canvas) return cancelDrawing();
    drawing.end = canvasPoint(event, canvas);
    const x0 = Math.min(drawing.start.x, drawing.end.x);
    const y0 = Math.min(drawing.start.y, drawing.end.y);
    const x1 = Math.max(drawing.start.x, drawing.end.x);
    const y1 = Math.max(drawing.start.y, drawing.end.y);
    if (x1 - x0 < 3 || y1 - y0 < 3) {
      toast("Draw a larger rectangle so the box has positive source dimensions.", "error");
      state.drawing.start = null;
      state.drawing.end = null;
      redrawCanvas(canvas);
      return;
    }
    const bbox = uprightRectToSource([x0, y0, x1 - x0, y1 - y0], currentTransforms());
    if (!validBbox(bbox)) {
      toast("The packet’s affine could not produce a valid source box.", "error");
      return cancelDrawing();
    }
    if (drawing.mode === "stage-a-span") addStageASpan(bbox);
    if (drawing.mode === "stage-b-inserted-span") addInsertedSpan(bbox);
    if (drawing.mode === "stage-b-word") setWordBbox(drawing.index, bbox);
    queueTelemetry("rectangle_drawn", { mode: drawing.mode }, `rectangle-drawn:${drawing.mode}`, 100);
    state.drawing = null;
    state.drawingPreview = null;
    renderActionPanel(state.sessionData.current);
    renderAgentView(state.sessionData.current);
  }

  function cancelDrawing() {
    if (!state.drawing) return;
    state.drawing.start = null;
    state.drawing.end = null;
    state.drawingPreview = null;
    redrawAllCanvases();
  }

  function addInsertedSpan(bbox) {
    const draft = ensureStageBDraft(state.sessionData.current);
    const inventory = graphInventory(state.sessionData.current.agent_turn.packet?.value || {}, draft);
    const id = inventory.allocatedInsertedSpanIds.find((candidate) => !draft.inserted_visible_spans.some((span) => span.span_id === candidate));
    if (!id) return toast("No software-allocated insertion span IDs remain.", "error");
    const options = stageBOptions(state.sessionData.current.agent_turn.response_schema?.value || {});
    const nextOrder = Math.max(0, ...inventory.stableSpans.map((span) => Number(span.order)), ...draft.inserted_visible_spans.map((span) => Number(span.order))) + 1;
    draft.inserted_visible_spans.push({
      span_id: id,
      order: nextOrder,
      bbox_source_xywh: bbox,
      visual_kind: options.visualKinds[0] || "",
      estimated_word_count_min: 1,
      estimated_word_count_max: 1,
      internal_boundary_status: options.boundaries[0] || "",
      uncertainty_flags: options.uncertainties.includes("none") ? ["none"] : [],
      evidence_note: "",
    });
    draft.visible_span_order ||= inventory.stableSpans.map((span) => span.span_id);
    draft.visible_span_order.push(id);
    syncInsertedSpanOrders(draft);
    queueTelemetry("graph_link_changed", { edit_type: "inserted_span_added", inserted_count: draft.inserted_visible_spans.length }, "graph-inserted-spans");
    saveStageDraft();
  }

  function setWordBbox(index, bbox) {
    const word = state.stageDraft.words[index];
    if (!word) return;
    word.bbox_source_xywh = bbox;
    saveStageDraft();
  }

  function sizeEvidenceCanvas(frame) {
    if (!frame) return;
    const image = frame.querySelector("img");
    const canvas = frame.querySelector("canvas");
    if (!image || !canvas || !image.naturalWidth || !image.naturalHeight) return;
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.style.width = `${image.clientWidth}px`;
    canvas.style.height = `${image.clientHeight}px`;
    redrawCanvas(canvas);
  }

  function redrawAllCanvases() {
    document.querySelectorAll("canvas[data-drawing-canvas]").forEach(redrawCanvas);
  }

  function redrawCanvas(canvas) {
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    const transforms = currentTransforms();
    const current = state.sessionData?.current;
    if (current?.stage_id === "stage_a_visible_inventory") {
      (state.stageDraft?.spans || []).forEach((span, index) => drawSourceBox(context, span.bbox_source_xywh, transforms, { color: "#276fbd", label: String(index + 1) }));
    }
    if (current?.stage_id === "stage_b_graph_alignment") {
      (state.stageDraft?.inserted_visible_spans || []).forEach((span) => drawSourceBox(context, span.bbox_source_xywh, transforms, { color: "#6c569a", label: span.span_id }));
      (state.stageDraft?.words || []).filter((word) => !isPlaceholderBbox(word.bbox_source_xywh)).forEach((word, index) => drawSourceBox(context, word.bbox_source_xywh, transforms, { color: "#1f6d7a", label: `W${index + 1}` }));
    }
    if (state.drawing?.start && state.drawing?.end && state.drawing.canvasKey === canvas.dataset.drawingCanvas) {
      const x = Math.min(state.drawing.start.x, state.drawing.end.x);
      const y = Math.min(state.drawing.start.y, state.drawing.end.y);
      const width = Math.abs(state.drawing.start.x - state.drawing.end.x);
      const height = Math.abs(state.drawing.start.y - state.drawing.end.y);
      context.save();
      context.strokeStyle = "#cd7029";
      context.fillStyle = "rgba(205,112,41,.12)";
      context.lineWidth = Math.max(2, canvas.width / 600);
      context.setLineDash([8, 5]);
      context.fillRect(x, y, width, height);
      context.strokeRect(x, y, width, height);
      context.restore();
    }
  }

  function drawSourceBox(context, bbox, transforms, { color, label }) {
    if (!validBbox(bbox)) return;
    const upright = sourceRectToUpright(bbox, transforms);
    if (!upright) return;
    context.save();
    context.strokeStyle = color;
    context.fillStyle = `${color}1f`;
    context.lineWidth = Math.max(2, context.canvas.width / 650);
    context.fillRect(...upright);
    context.strokeRect(...upright);
    context.font = `bold ${Math.max(13, context.canvas.width / 70)}px sans-serif`;
    const width = context.measureText(label).width + 8;
    const textHeight = Math.max(18, context.canvas.width / 52);
    context.fillStyle = color;
    context.fillRect(upright[0], Math.max(0, upright[1] - textHeight), width, textHeight);
    context.fillStyle = "white";
    context.fillText(label, upright[0] + 4, Math.max(textHeight - 4, upright[1] - 4));
    context.restore();
  }

  function canvasPoint(event, canvas) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(canvas.width, (event.clientX - rect.left) * canvas.width / rect.width)),
      y: Math.max(0, Math.min(canvas.height, (event.clientY - rect.top) * canvas.height / rect.height)),
    };
  }

  function currentTransforms() {
    const packet = state.sessionData?.current?.agent_turn?.packet?.value || {};
    const evidence = packet.evidence || {};
    const directed = evidence.directed_transform || packet.directed_transform || state.sessionData?.current?.action_ui?.directed_transform || {};
    return {
      upright_to_source_affine: directed.upright_to_source_affine,
      source_to_upright_affine: directed.source_to_upright_affine,
    };
  }

  function uprightRectToSource(rect, transforms) {
    return transformedRect(rect, transforms.upright_to_source_affine);
  }

  function sourceRectToUpright(rect, transforms) {
    return transformedRect(rect, transforms.source_to_upright_affine);
  }

  function transformedRect(rect, affine) {
    if (!Array.isArray(affine) || affine.length !== 9 || !validBbox(rect)) return null;
    const [x, y, width, height] = rect.map(Number);
    const corners = [[x,y], [x+width,y], [x,y+height], [x+width,y+height]].map((point) => affinePoint(point, affine));
    if (corners.some((point) => !point)) return null;
    const xs = corners.map((point) => point[0]);
    const ys = corners.map((point) => point[1]);
    const left = Math.max(0, Math.floor(Math.min(...xs)));
    const top = Math.max(0, Math.floor(Math.min(...ys)));
    const right = Math.ceil(Math.max(...xs));
    const bottom = Math.ceil(Math.max(...ys));
    return [left, top, Math.max(1, right - left), Math.max(1, bottom - top)];
  }

  function affinePoint([x, y], matrix) {
    const divisor = matrix[6] * x + matrix[7] * y + matrix[8];
    if (!Number.isFinite(divisor) || Math.abs(divisor) < 1e-12) return null;
    return [(matrix[0] * x + matrix[1] * y + matrix[2]) / divisor, (matrix[3] * x + matrix[4] * y + matrix[5]) / divisor];
  }

  function graphInventory(packet, draft) {
    const stableSpans = Array.isArray(packet.stage_a_binding?.stable_visible_spans) ? packet.stage_a_binding.stable_visible_spans : [];
    const transcriptNodes = Array.isArray(packet.revealed_rejectable_transcript?.nodes) ? packet.revealed_rejectable_transcript.nodes : [];
    const proposalNodes = Array.isArray(packet.revealed_untrusted_detector?.proposal_nodes) ? packet.revealed_untrusted_detector.proposal_nodes : [];
    const allocatedWordIds = Array.isArray(packet.software_allocated_ids?.word_unit_ids_in_order) ? packet.software_allocated_ids.word_unit_ids_in_order : [];
    const allocatedInsertedSpanIds = Array.isArray(packet.software_allocated_ids?.inserted_visible_span_ids_in_order) ? packet.software_allocated_ids.inserted_visible_span_ids_in_order : [];
    const combined = [...stableSpans, ...(draft.inserted_visible_spans || [])];
    const byId = new Map(combined.map((span) => [span.span_id, span]));
    const order = Array.isArray(draft.visible_span_order) ? draft.visible_span_order : combined.map((span) => span.span_id);
    const allSpans = order.map((id) => byId.get(id)).filter(Boolean);
    combined.forEach((span) => { if (!allSpans.includes(span)) allSpans.push(span); });
    return { stableSpans, transcriptNodes, proposalNodes, allocatedWordIds, allocatedInsertedSpanIds, allSpans };
  }

  function deriveGraphGaps(draft, inventory) {
    const gaps = [];
    const linkedTranscript = new Set();
    const linkedProposal = new Set();
    draft.words.forEach((word) => {
      word.transcript_node_ids.forEach((id) => linkedTranscript.add(id));
      word.proposal_node_ids.forEach((id) => linkedProposal.add(id));
      if (!word.transcript_node_ids.length) gaps.push({ node_type: "word_unit", node_id: word.word_unit_id, missing_relation: "transcript_node" });
      if (!word.proposal_node_ids.length) gaps.push({ node_type: "word_unit", node_id: word.word_unit_id, missing_relation: "proposal_node" });
    });
    inventory.transcriptNodes.forEach((node) => {
      if (!linkedTranscript.has(node.transcript_node_id)) gaps.push({ node_type: "transcript_node", node_id: node.transcript_node_id, missing_relation: "word_unit" });
    });
    inventory.proposalNodes.forEach((node) => {
      if (!linkedProposal.has(node.proposal_node_id)) gaps.push({ node_type: "proposal_node", node_id: node.proposal_node_id, missing_relation: "word_unit" });
    });
    return gaps;
  }

  function gapKey(gap) { return `${gap.node_type}:${gap.node_id}:${gap.missing_relation}`; }

  function stageAOptions(schema) {
    return {
      visualKinds: enumFrom(schema, ["$defs", "span", "properties", "visual_kind", "enum"]),
      boundaries: enumFrom(schema, ["$defs", "span", "properties", "internal_boundary_status", "enum"]),
      uncertainties: enumFrom(schema, ["$defs", "span", "properties", "uncertainty_flags", "items", "enum"]),
      deferReasons: enumFrom(schema, ["$defs", "defer_line", "properties", "reason", "enum"]),
    };
  }

  function stageBOptions(schema) {
    return {
      visualKinds: enumFrom(schema, ["$defs", "inserted_span", "properties", "visual_kind", "enum"]),
      boundaries: enumFrom(schema, ["$defs", "inserted_span", "properties", "internal_boundary_status", "enum"]),
      uncertainties: enumFrom(schema, ["$defs", "inserted_span", "properties", "uncertainty_flags", "items", "enum"]),
      wordKinds: enumFrom(schema, ["$defs", "word_unit", "properties", "kind", "enum"]),
      gapReasons: enumFrom(schema, ["$defs", "gap", "properties", "reason", "enum"]),
      deferReasons: enumFrom(schema, ["$defs", "defer_line", "properties", "reason", "enum"]),
    };
  }

  function enumFrom(root, path) {
    let value = root;
    for (const part of path) value = value && typeof value === "object" ? value[part] : null;
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
  }

  function renderBboxFields(bbox, { scope, index = "", key = "" }) {
    const labels = ["x", "y", "width", "height"];
    return `<fieldset class="field"><legend>Source box [x, y, width, height]</legend><div class="bbox-fields">${labels.map((label, coordinate) => `<label>${label}<input type="number" min="${coordinate < 2 ? 0 : 1}" value="${escapeAttr(bbox?.[coordinate] ?? (coordinate < 2 ? 0 : 1))}" data-bbox-scope="${escapeAttr(scope)}" data-bbox-index="${escapeAttr(index)}" data-bbox-key="${escapeAttr(key)}" data-bbox-coordinate="${coordinate}"></label>`).join("")}</div></fieldset>`;
  }

  function renderSelectField(label, options, selected, attributes, required = false) {
    return `<label class="field"><span>${escapeHTML(label)}</span><select ${attributes} ${required ? "required" : ""}>${required ? `<option value="">Choose…</option>` : ""}${normalizeOptions(options).map((option) => `<option value="${escapeAttr(option.value)}" ${String(option.value) === String(selected) ? "selected" : ""}>${escapeHTML(option.label)}</option>`).join("")}</select></label>`;
  }

  function renderNumberField(label, value, attributes, min = 0) {
    return `<label class="field"><span>${escapeHTML(label)}</span><input type="number" min="${escapeAttr(min)}" value="${escapeAttr(value)}" ${attributes}></label>`;
  }

  function renderMultiSelect(label, values, idKey, selected, attributes, labelKey = null) {
    const selectedSet = new Set((selected || []).map(String));
    const options = values.map((value) => {
      if (typeof value === "string") return { id: value, label: value };
      const id = value[idKey] ?? value.value ?? value.id;
      const descriptor = labelKey && value[labelKey] != null ? ` · ${value[labelKey]}` : (value.text != null ? ` · ${value.text}` : "");
      return { id, label: `${id}${descriptor}` };
    });
    return `<label class="field"><span>${escapeHTML(label)}</span><select class="select-multiple" multiple ${attributes}>${options.map((option) => `<option value="${escapeAttr(option.id)}" ${selectedSet.has(String(option.id)) ? "selected" : ""}>${escapeHTML(option.label)}</option>`).join("")}</select></label>`;
  }

  function renderRelationSelect(label, values, idKey, selected, attributes) {
    const options = values.map((value) => {
      const id = typeof value === "string" ? value : value[idKey] ?? value.value ?? value.id;
      return { id, label: String(id) };
    });
    return `<label class="field"><span>${escapeHTML(label)}</span><select ${attributes} required><option value="">Choose one…</option>${options.map((option) => `<option value="${escapeAttr(option.id)}" ${String(option.id) === String(selected) ? "selected" : ""}>${escapeHTML(option.label)}</option>`).join("")}</select><small>Several words may share this span; each word belongs to one span.</small></label>`;
  }

  function normalizeOptions(values) {
    return (Array.isArray(values) ? values : []).map((value) => typeof value === "string" ? { value, label: readable(value) } : { value: value.value ?? value.id ?? value.code, label: value.label ?? value.name ?? readable(value.value ?? value.id ?? value.code) });
  }

  function valueFromControl(target) {
    if (target instanceof HTMLSelectElement && target.multiple) return [...target.selectedOptions].map((option) => option.value);
    if (target instanceof HTMLInputElement && target.type === "checkbox") return target.checked;
    if (target instanceof HTMLInputElement && target.type === "number") return integerValue(target.value);
    return target.value;
  }

  function checkboxValues(nodes) { return [...nodes].filter((node) => node.checked).map((node) => node.value); }

  function exclusiveUncertaintyValues(target, nodes) {
    if (target.value === "none" && target.checked) {
      nodes.forEach((node) => { node.checked = node === target; });
      return ["none"];
    }
    const values = checkboxValues(nodes);
    if (target.checked && target.value !== "none") {
      nodes.forEach((node) => { if (node.value === "none") node.checked = false; });
      return values.filter((value) => value !== "none");
    }
    return values;
  }

  function promptStatusVerified(status) {
    const value = String(status || "").toLowerCase();
    return ["bound", "verified", "match", "ok", "verified_for_this_new_session"].includes(value) || value.startsWith("verified_");
  }

  function drawingEvidenceKey(current, turn) {
    if (current.action_ui?.drawing_evidence_key) return current.action_ui.drawing_evidence_key;
    const keys = (turn.evidence || []).map((item) => item.key);
    if (keys.includes("upright_plain")) return "upright_plain";
    if (keys.includes("wide_source_plain")) return "wide_source_plain";
    return keys[0];
  }

  function stageSupportsDrawing(stageId) { return ["stage_a_visible_inventory", "stage_b_graph_alignment"].includes(stageId); }

  function normalizeStages(stageGraph) {
    if (Array.isArray(stageGraph)) return stageGraph;
    if (Array.isArray(stageGraph?.nodes)) return stageGraph.nodes;
    if (Array.isArray(stageGraph?.stages)) return stageGraph.stages;
    return [];
  }

  function capabilityBlocked(mode) { return ["blocked", "unavailable", "blocked_missing_transition", "design_only"].includes(String(mode)); }

  function validBbox(value) {
    return Array.isArray(value) && value.length === 4 && value.every((number) => Number.isFinite(Number(number))) && Number(value[0]) >= 0 && Number(value[1]) >= 0 && Number(value[2]) > 0 && Number(value[3]) > 0;
  }

  function isPlaceholderBbox(value) { return Array.isArray(value) && value[0] === 0 && value[1] === 0 && value[2] === 1 && value[3] === 1; }

  async function saveNote() {
    if (!state.sessionId) return;
    const form = els.noteForm;
    const text = form.elements.text.value;
    const evidenceRef = form.elements.evidence_ref.value;
    const hadScreenshot = Boolean(state.noteFile);
    if (!text.trim() && !evidenceRef && !state.noteFile) {
      return showNoteMessage("Add text, choose current evidence, or attach a screenshot.");
    }
    const formData = new FormData();
    formData.set("text", text);
    formData.set("category", form.elements.category.value);
    formData.set("severity", form.elements.severity.value);
    formData.set("current_sha256", currentBindingSha());
    formData.set("agent_turn_sha256", state.sessionData.current.agent_turn?.agent_turn_sha256 || "");
    if (evidenceRef) formData.set("evidence_ref", evidenceRef);
    if (state.noteFile) formData.set("screenshot", state.noteFile, state.noteFile.name || "screenshot.png");
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    hideNoteMessage();
    try {
      const data = await requestJson(API.notes(state.sessionId), { method: "POST", headers: { "X-Review-CSRF-Token": state.csrfToken }, body: formData });
      if (Array.isArray(data.notes)) state.sessionData.notes = data.notes;
      else await loadSession(state.sessionId, { updateHash: false });
      form.reset();
      setNoteFile(null);
      removeStorage(noteDraftKey());
      els.noteCharCount.textContent = "0";
      toast("Note saved to this exact stage without advancing it.");
      await sendTelemetry("note_saved", { has_screenshot: hadScreenshot, evidence_ref: evidenceRef || null }).catch(() => {});
      renderNotebook(state.sessionData);
    } catch (error) {
      showNoteMessage(publicError(error));
    } finally {
      button.disabled = false;
    }
  }

  function saveNoteDraft() {
    if (!state.sessionId || !state.sessionData) return;
    const form = els.noteForm;
    writeStorage(noteDraftKey(), {
      current_sha256: currentBindingSha(),
      agent_turn_sha256: state.sessionData.current.agent_turn?.agent_turn_sha256 || null,
      text: form.elements.text.value,
      category: form.elements.category.value,
      severity: form.elements.severity.value,
      evidence_ref: form.elements.evidence_ref.value,
    });
  }

  function restoreNoteDraft() {
    const draft = readStorage(noteDraftKey());
    els.noteDraftWarning.hidden = true;
    if (!draft) return;
    const form = els.noteForm;
    form.elements.text.value = draft.text || "";
    if ([...form.elements.category.options].some((option) => option.value === draft.category)) form.elements.category.value = draft.category;
    if ([...form.elements.severity.options].some((option) => option.value === draft.severity)) form.elements.severity.value = draft.severity;
    if ([...form.elements.evidence_ref.options].some((option) => option.value === draft.evidence_ref)) form.elements.evidence_ref.value = draft.evidence_ref;
    els.noteCharCount.textContent = String(form.elements.text.value.length);
    if (draft.current_sha256 !== currentBindingSha()) {
      els.noteDraftWarning.hidden = false;
      els.noteDraftWarning.textContent = "This local draft began on a different stage head. Its text was preserved, but evidence must be chosen again before saving.";
      form.elements.evidence_ref.value = "";
    }
  }

  function noteDraftKey() { return `letter-pipeline-note:${state.sessionId}`; }

  function setNoteFile(file) {
    if (state.noteFileUrl) URL.revokeObjectURL(state.noteFileUrl);
    state.noteFile = file;
    state.noteFileUrl = file ? URL.createObjectURL(file) : null;
    els.uploadPreview.hidden = !file;
    if (file) {
      els.uploadPreview.querySelector("img").src = state.noteFileUrl;
      els.uploadPreview.querySelector("span").textContent = `${file.name || "Pasted screenshot"} · ${formatBytes(file.size)}`;
    } else {
      els.screenshotInput.value = "";
      els.uploadPreview.querySelector("img").removeAttribute("src");
      els.uploadPreview.querySelector("span").textContent = "";
    }
  }

  function handlePaste(event) {
    if (state.controlTab !== "notebook") return;
    const file = [...(event.clipboardData?.files || [])].find((candidate) => candidate.type.startsWith("image/"));
    if (file) {
      event.preventDefault();
      setNoteFile(file);
    }
  }

  function showNoteMessage(message) { els.noteMessage.hidden = false; els.noteMessage.textContent = message; }
  function hideNoteMessage() { els.noteMessage.hidden = true; els.noteMessage.textContent = ""; }

  async function sendTelemetry(eventType, details) {
    if (!state.sessionId || !state.sessionData) return;
    const current = state.sessionData.current;
    const payload = {
      current_sha256: currentBindingSha(),
      agent_turn_sha256: current.agent_turn?.agent_turn_sha256 || null,
      pipeline_revision: current.revision,
      event_type: eventType,
      details,
      client_elapsed_ms: Math.max(0, Math.round(performance.now() - state.sessionOpenedAt)),
      ui_version: UI_VERSION,
    };
    await requestJson(API.telemetry(state.sessionId), { method: "POST", headers: writeHeaders(), body: JSON.stringify(payload) });
  }

  function queueTelemetry(eventType, details, key = eventType, delay = 600) {
    if (!state.sessionId || !state.sessionData) return;
    const timerKey = `${eventType}:${key}`;
    const boundCurrent = currentBindingSha();
    const prior = state.telemetryTimers.get(timerKey);
    if (prior) window.clearTimeout(prior);
    const timer = window.setTimeout(() => {
      state.telemetryTimers.delete(timerKey);
      if (!state.sessionData || currentBindingSha() !== boundCurrent) return;
      sendTelemetry(eventType, details).catch(() => {});
    }, delay);
    state.telemetryTimers.set(timerKey, timer);
  }

  function currentBindingSha() {
    const current = state.sessionData?.current || {};
    return current.current_sha256 || current.agent_turn?.agent_turn_sha256 || `${current.stage_id}:${current.revision}`;
  }

  async function requestJson(url, options = {}) {
    let response;
    try {
      response = await fetch(url, { cache: "no-store", ...options });
    } catch (error) {
      throw new UIError("The local walkthrough service could not be reached.", { cause: error });
    }
    let body;
    try { body = await response.json(); }
    catch (error) { throw new UIError(`The server returned an unreadable response (${response.status}).`, { status: response.status, cause: error }); }
    const wrapped = body && typeof body === "object" && Object.prototype.hasOwnProperty.call(body, "ok");
    if (!response.ok || (wrapped && !body.ok)) {
      const source = wrapped ? body.error : body;
      throw new UIError(source?.message || `Request failed (${response.status}).`, { status: response.status, code: source?.code, details: source?.details });
    }
    return wrapped ? body.data : body;
  }

  function writeHeaders() {
    return { "Content-Type": "application/json", "X-Review-CSRF-Token": state.csrfToken || "" };
  }

  class UIError extends Error {
    constructor(message, { status = 0, code = "", details = null, cause = null } = {}) {
      super(message, { cause });
      this.name = "UIError";
      this.status = status;
      this.code = code;
      this.details = details;
    }
  }

  function setFatalError(error) {
    state.fatalError = { title: error.status === 404 ? "Walkthrough not found" : "Could not open the walkthrough", message: publicError(error) };
    state.screen = "error";
    renderShell();
  }

  function publicError(error) { return error instanceof Error ? error.message : "The request could not be completed safely."; }

  function assertObject(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) throw new UIError(`The ${label} response is invalid.`); }

  function toast(message, type = "success") {
    const node = document.createElement("div");
    node.className = `toast${type === "error" ? " toast--error" : ""}`;
    node.textContent = message;
    els.toastRegion.append(node);
    setTimeout(() => node.remove(), 5200);
  }

  function sessionIdFromHash() {
    const match = location.hash.match(/^#session=([^&]+)$/);
    if (!match) return null;
    try { return decodeURIComponent(match[1]); } catch (_) { return null; }
  }

  function makeRequestId() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
  function shortHash(value) { return typeof value === "string" && value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-6)}` : (value || ""); }
  function readable(value) { return String(value || "").replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
  function safeClass(value) { return String(value || "unknown").replace(/[^A-Za-z0-9_-]/g, "-"); }
  function integerValue(value) { const number = Number(value); return Number.isFinite(number) ? Math.round(number) : 0; }
  function formatBytes(bytes) { if (!Number.isFinite(bytes)) return ""; if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }
  function formatDate(value) { if (!value) return ""; const date = new Date(value); return Number.isNaN(date.valueOf()) ? String(value) : date.toLocaleString(); }
  function uploadHint(limits) { const types = (limits.accepted_media_types || ["image/png", "image/jpeg", "image/webp"]).map((type) => type.split("/")[1]?.toUpperCase()).join(", "); return `${types || "Images"}${limits.max_bytes ? ` · up to ${formatBytes(limits.max_bytes)}` : ""}`; }
  function escapeHTML(value) { return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]); }
  function escapeAttr(value) { return escapeHTML(value); }
  function cssEscape(value) { return window.CSS?.escape ? CSS.escape(value) : String(value).replace(/[^A-Za-z0-9_-]/g, "\\$&"); }
  function readStorage(key) { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (_) { return null; } }
  function writeStorage(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* Draft storage is best effort. */ } }
  function removeStorage(key) { try { localStorage.removeItem(key); } catch (_) { /* optional */ } }
})();
