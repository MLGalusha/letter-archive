(() => {
  "use strict";

  const API = {
    bootstrap: "/api/bootstrap",
    current: "/api/current",
    actions: "/api/actions",
    notes: "/api/notes",
    evidence: "/api/evidence",
    telemetry: "/api/telemetry",
    selectionSeed: "/api/selection-seed",
    selectionBox: "/api/selection-box",
    envelopePreview: "/api/envelope-preview",
  };

  const UI_VERSION = "human-review-console.v1";

  const ACTION_COPY = {
    claim_select: {
      label: "Fit, approve, and erase",
      short: "Finish this word",
      heading: "Fit an envelope around the selected ink",
      description: "Choose every connected ink piece belonging to exactly one complete word. Software must pass the fitted envelope before the claim advances.",
    },
    exclude: {
      label: "Remove selected ink",
      short: "Stay on this word",
      heading: "Remove distracting ink",
      description: "Remove numbered pieces that clearly belong to a neighbor, rule, fold, or scan artifact.",
    },
    cut: {
      label: "Sever a thin bridge",
      short: "Sol only · fresh view",
      heading: "Cut one observed ink bridge",
      description: "On the source-oriented work crop, draw one short line through a bridge that joins target ink to other ink.",
    },
    request_expanded_context: {
      label: "Enlarge the view",
      short: "Stay on this word",
      heading: "Ask software for more context",
      description: "Enlarge selected sides of the current crop. All choices use existing source pixels; this does not invent resolution.",
    },
    reopen_bbox: {
      label: "Correct the word box",
      short: "Stay on this word",
      heading: "Move or resize the active box",
      description: "Draw a replacement rectangle on Source context, or enter exact source coordinates. The original box remains in the history.",
    },
    defer_tier: {
      label: "Set aside for Sol",
      short: "Later Sol pass",
      heading: "Set this word aside for Sol",
      description: "Advance the current Terra queue and leave this word waiting for a later Sol pass. This does not start Sol now.",
    },
    defer_manual: {
      label: "Mark for human review",
      short: "Blocks completion",
      heading: "Record a final human disposition",
      description: "Use this only when the supplied tools and evidence cannot safely settle ownership.",
    },
  };

  const EVIDENCE_COPY = {
    decision_collage: ["Agent collage", "The ordered full-page, context, crop, and extracted-ink evidence supplied first"],
    residual_page: ["Remaining page", "Claimed words are visually erased so missed words stand out"],
    ink_selection_crop: ["Strong ink", "Higher-recall selectable ink; it may include more paper noise"],
    clean_ink_selection_crop: ["Clean ink", "Lower-noise comparison in the exact same crop coordinates"],
    numbered_components: ["Numbered ink", "Authoritative numbered review board"],
    prior_owned_red_overlay: ["Prior-owned ink", "Ink already assigned to earlier words appears red"],
    source_context: ["Source context", "Larger source-oriented context"],
    upright_context: ["Upright context", "Read-only context rotated for reading"],
    upright_numbered_components: ["Upright numbered", "Read-only numbered view rotated for reading"],
    work_crop: ["Work crop", "Source-oriented crop used by cleanup tools"],
  };

  const REASON_COPY = {
    same_word_body: "Main strokes of this word",
    detached_mark_belongs_to_target: "Detached mark belongs here",
    adjacent_word: "Belongs to a nearby word",
    rule_or_noise: "Rule, fold, or noise",
    threshold_bridge: "Threshold joined separate ink",
    border_contact: "Touches crop edge",
    clipped_ink: "Ink is clipped",
    touching_words: "Words touch",
    correction_or_strikeout: "Correction or strikeout",
    uncertain_reading: "Reading is uncertain",
    clipped_target: "Target is clipped",
    duplicate_geometry: "Box duplicates other geometry",
    visible_word_outside_target: "Visible word lies outside box",
    wrong_line_registration: "Box is on the wrong line",
  };

  const VALUE_COPY = {
    high: "High",
    medium: "Medium",
    low: "Low",
    crop_margin: "Wider crop",
    source_resolution: "Wider crop at source scale",
    line_context: "More of the line",
    border_contact: "Ink touches the crop edge",
    ambiguous_neighbor: "Neighbor ownership is unclear",
    detached_mark: "A detached mark needs context",
    low_resolution: "The current crop is hard to judge",
    uncertain_reading: "The handwriting is uncertain",
    left: "Left",
    right: "Right",
    top: "Top",
    bottom: "Bottom",
    ambiguous_ownership: "Ownership remains ambiguous",
    ambiguous_detached_mark: "Detached mark remains ambiguous",
    clipped_target: "Target is clipped",
    touching_or_overwritten_ink: "Touching or overwritten ink",
    insufficient_visual_evidence: "Not enough visual evidence",
    unsafe_cut: "No safe cut",
  };

  const state = {
    loading: true,
    error: null,
    data: { run: null, status: null, packet: null, notes: [], upload_constraints: null, csrf_token: null, agent_contract: null, experience_summary: null },
    packetHash: null,
    selectedComponents: new Set(),
    activeActionType: null,
    activeEvidenceKey: null,
    controlTab: "decision",
    mobileView: "evidence",
    pendingAction: null,
    submittingAction: false,
    noteFile: null,
    notePreviewUrl: null,
    bboxDraft: null,
    cutPoints: null,
    drawing: null,
    guideOffered: false,
    actionForms: {},
    noteDraftNeedsRestore: false,
    noteEvidenceTouched: false,
    noteDraftBindingHash: null,
    noteDraftBindingRunId: null,
    historicalDraftNotice: null,
    packetOpenedAt: performance.now(),
    envelopePreview: null,
    selectionCanvasReady: false,
    selectionView: "strong",
    selectionMasks: null,
    selectionDrawing: null,
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    Object.assign(els, {
      app: document.querySelector("#app"),
      headerCurrent: document.querySelector("#header-current"),
      center: document.querySelector("#center-content"),
      pipeline: document.querySelector("#pipeline-content"),
      decision: document.querySelector("#decision-panel"),
      notes: document.querySelector("#notes-panel"),
      agent: document.querySelector("#agent-panel"),
      agentContent: document.querySelector("#agent-content"),
      decisionTab: document.querySelector("#decision-tab"),
      notesTab: document.querySelector("#notes-tab"),
      agentTab: document.querySelector("#agent-tab"),
      noteForm: document.querySelector("#note-form"),
      noteList: document.querySelector("#note-list"),
      noteCountHeader: document.querySelector("#header-note-count"),
      noteCountTab: document.querySelector("#tab-note-count"),
      noteEvidence: document.querySelector("#note-evidence-select"),
      noteMessage: document.querySelector("#note-form-message"),
      draftWarning: document.querySelector("#historical-draft-warning"),
      noteText: document.querySelector('#note-form textarea[name="text"]'),
      noteCharacterCount: document.querySelector("#note-character-count"),
      screenshotInput: document.querySelector("#screenshot-input"),
      screenshotDropZone: document.querySelector("#screenshot-drop-zone"),
      screenshotPreview: document.querySelector("#screenshot-preview"),
      screenshotName: document.querySelector("#screenshot-name"),
      screenshotSize: document.querySelector("#screenshot-size"),
      uploadConstraints: document.querySelector("#upload-constraints"),
      guide: document.querySelector("#guide-dialog"),
      confirm: document.querySelector("#confirm-dialog"),
      confirmTitle: document.querySelector("#confirm-title"),
      confirmSummary: document.querySelector("#confirm-summary"),
      confirmEffect: document.querySelector("#confirm-effect"),
      confirmBinding: document.querySelector("#confirm-binding"),
      confirmMessage: document.querySelector("#confirm-message"),
      confirmSubmit: document.querySelector("#submit-confirm"),
      toastRegion: document.querySelector("#toast-region"),
      selectionAnnouncer: document.querySelector("#selection-announcer"),
    });

    bindStaticEvents();
    loadBootstrap();
  }

  function bindStaticEvents() {
    document.querySelector("#open-guide").addEventListener("click", openGuide);
    document.querySelector("#finish-guide").addEventListener("click", () => {
      try { localStorage.setItem("letterArchiveReviewGuideSeen", "true"); } catch (_) { /* storage is optional */ }
    });
    document.querySelector("#open-notebook").addEventListener("click", () => switchControl("notes"));

    els.decisionTab.addEventListener("click", () => switchControl("decision"));
    els.notesTab.addEventListener("click", () => switchControl("notes"));
    els.agentTab.addEventListener("click", () => switchControl("agent"));

    document.querySelectorAll("[data-mobile-target]").forEach((button) => {
      button.addEventListener("click", () => setMobileView(button.dataset.mobileTarget));
    });

    document.addEventListener("click", handleDelegatedClick);
    document.addEventListener("input", handleDelegatedInput);
    document.addEventListener("change", handleDelegatedInput);
    document.addEventListener("submit", handleDelegatedSubmit);
    document.addEventListener("keydown", handleKeyboardShortcut);
    document.addEventListener("pointerdown", handleDrawStart);
    document.addEventListener("pointermove", handleDrawMove);
    document.addEventListener("pointerup", handleDrawEnd);
    document.addEventListener("pointercancel", handleDrawEnd);

    document.querySelector("#close-confirm").addEventListener("click", () => closeConfirm({ cancelled: true }));
    document.querySelector("#cancel-confirm").addEventListener("click", () => closeConfirm({ cancelled: true }));
    els.confirmSubmit.addEventListener("click", submitPendingAction);

    els.noteForm.addEventListener("submit", saveNote);
    els.noteText.addEventListener("input", () => {
      els.noteCharacterCount.textContent = String(els.noteText.value.length);
    });
    els.noteForm.addEventListener("input", () => saveNoteDraftFromUI());
    els.noteForm.addEventListener("change", () => saveNoteDraftFromUI());
    els.noteEvidence.addEventListener("change", () => { state.noteEvidenceTouched = true; });
    els.screenshotInput.addEventListener("change", () => setNoteFile(els.screenshotInput.files?.[0] || null));
    document.querySelector("#remove-screenshot").addEventListener("click", () => {
      if (!state.noteFile) return;
      const shouldRemove = window.confirm("Remove this unsaved screenshot? The file cannot be recovered after it is removed.");
      if (shouldRemove) setNoteFile(null);
    });

    ["dragenter", "dragover"].forEach((eventName) => {
      els.screenshotDropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        els.screenshotDropZone.classList.add("is-dragging");
      });
    });
    ["dragleave", "drop"].forEach((eventName) => {
      els.screenshotDropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        els.screenshotDropZone.classList.remove("is-dragging");
      });
    });
    els.screenshotDropZone.addEventListener("drop", (event) => {
      const file = [...(event.dataTransfer?.files || [])].find((item) => item.type.startsWith("image/"));
      if (file) setNoteFile(file);
    });
    document.addEventListener("paste", handlePaste);
    document.addEventListener("load", (event) => {
      if (event.target instanceof HTMLImageElement && event.target.classList.contains("evidence-image")) updateDrawOverlay();
    }, true);
    window.addEventListener("beforeunload", (event) => {
      if (!state.noteFile) return;
      event.preventDefault();
      event.returnValue = "An unsaved screenshot is still attached to a note draft.";
    });
  }

  async function loadBootstrap() {
    state.loading = true;
    state.error = null;
    render();
    try {
      const data = await requestJson(API.bootstrap);
      applyServerData(data, { replace: true });
      state.loading = false;
      render();
      offerGuideOnce();
    } catch (error) {
      state.loading = false;
      state.error = friendlyError(error);
      render();
    }
  }

  async function refreshCurrent({ announce = true } = {}) {
    try {
      const data = await requestJson(API.current);
      applyServerData(data);
      state.error = null;
      render();
      if (announce) toast("Loaded the current software version.");
    } catch (error) {
      state.error = friendlyError(error);
      render();
    }
  }

  function applyServerData(incoming, { replace = false } = {}) {
    const normalized = normalizeData(incoming);
    const oldHash = state.packetHash;
    const oldRunId = currentRunId();
    const nextHash = normalized.packet?.work_packet_sha256 || null;
    const hadUnsavedNote = noteDraftHasContent();
    const noteBindingHash = state.noteDraftBindingHash || oldHash;
    const noteBindingRunId = state.noteDraftBindingRunId || oldRunId;
    const previousActionDraft = oldHash ? readStoredDraft("action", oldHash, oldRunId) : null;
    const priorActionDrafts = arrayValue(state.historicalDraftNotice?.actionDrafts)
      .filter((draft) => draft?.hash && readStoredDraft("action", draft.hash, draft.runId));
    if (oldHash && oldHash !== nextHash && hadUnsavedNote) saveNoteDraftFromUI(noteBindingHash, noteBindingRunId);
    state.data = replace ? normalized : {
      ...state.data,
      ...normalized,
      notes: normalized.notes ?? state.data.notes ?? [],
      upload_constraints: normalized.upload_constraints ?? state.data.upload_constraints,
      agent_contract: normalized.agent_contract ?? state.data.agent_contract,
      experience_summary: normalized.experience_summary ?? state.data.experience_summary,
    };
    state.packetHash = nextHash;

    if (oldHash !== nextHash) {
      state.selectedComponents.clear();
      state.bboxDraft = null;
      state.cutPoints = null;
      state.drawing = null;
      state.activeActionType = chooseDefaultAction(state.data.packet);
      state.activeEvidenceKey = chooseDefaultEvidence(state.data.packet);
      state.actionForms = {};
      state.envelopePreview = null;
      state.selectionCanvasReady = false;
      state.selectionMasks = null;
      state.selectionDrawing = null;
      state.selectionView = "strong";
      restoreActionDraft(nextHash);
      if (oldHash && hadUnsavedNote && noteBindingHash) {
        state.noteDraftBindingHash = noteBindingHash;
        state.noteDraftBindingRunId = noteBindingRunId;
        state.noteDraftNeedsRestore = false;
      } else {
        state.noteDraftBindingHash = nextHash;
        state.noteDraftBindingRunId = currentRunId();
        state.noteDraftNeedsRestore = true;
        state.noteEvidenceTouched = false;
      }
      const actionDrafts = [...priorActionDrafts];
      if (oldHash && oldHash !== nextHash && previousActionDraft && !actionDrafts.some((draft) => draft.hash === oldHash && draft.runId === oldRunId)) {
        actionDrafts.push({ hash: oldHash, runId: oldRunId });
      }
      const historicalNoteHash = hadUnsavedNote && noteBindingHash !== nextHash ? noteBindingHash : null;
      state.historicalDraftNotice = actionDrafts.length || historicalNoteHash ? {
        newHash: nextHash,
        actionDrafts,
        noteHash: historicalNoteHash,
        noteRunId: historicalNoteHash ? noteBindingRunId : null,
        screenshotPreserved: Boolean(historicalNoteHash && state.noteFile),
      } : null;
      state.packetOpenedAt = performance.now();
      if (oldHash && nextHash) {
        els.selectionAnnouncer.textContent = "A new word packet loaded. The component selection was cleared.";
      }
      if (state.historicalDraftNotice) toast("The packet changed. Earlier drafts were preserved under their original packet; review the warning before continuing.", "error");
      if (nextHash) {
        emitTelemetry("packet_opened", { revision: normalized.packet?.revision ?? normalized.status?.revision ?? null, unit_id: normalized.packet?.current?.unit_id || normalized.status?.current?.unit_id || null });
        if (state.activeActionType) emitTelemetry("action_form_opened", { action_type: state.activeActionType, automatic: true });
      }
    } else {
      const legal = legalActions();
      if (!legal.some((item) => item.type === state.activeActionType)) {
        state.activeActionType = chooseDefaultAction(state.data.packet);
      }
      if (!evidenceEntries().some(([key]) => key === state.activeEvidenceKey)) {
        state.activeEvidenceKey = chooseDefaultEvidence(state.data.packet);
      }
    }
  }

  function normalizeData(incoming) {
    const data = incoming && typeof incoming === "object" ? incoming : {};
    if (data.packet || data.status || data.run || data.notes || data.upload_constraints || data.upload_limits || data.csrf_token || data.agent_contract) {
      return {
        run: data.run ?? null,
        status: data.status ?? null,
        packet: data.packet ?? null,
        notes: Array.isArray(data.notes) ? data.notes : (data.notes?.items || []),
        upload_constraints: data.upload_constraints ?? data.upload_limits ?? null,
        csrf_token: data.csrf_token ?? null,
        agent_contract: data.agent_contract ?? null,
        experience_summary: data.experience_summary ?? null,
      };
    }
    if (data.work_packet_sha256) {
      return { ...state.data, packet: data };
    }
    return { run: null, status: null, packet: null, notes: [], upload_constraints: null, csrf_token: null, agent_contract: null, experience_summary: null };
  }

  async function requestJson(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.body instanceof FormData ? {} : options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
    });
    let body = null;
    try { body = await response.json(); } catch (_) { /* handled below */ }
    if (!response.ok || body?.ok === false) {
      const message = body?.error?.message || body?.message || `The server returned ${response.status}.`;
      const error = new Error(message);
      error.status = response.status;
      error.details = body?.error || null;
      throw error;
    }
    return body && Object.prototype.hasOwnProperty.call(body, "data") ? body.data : body;
  }

  function render() {
    els.app.dataset.state = state.loading ? "loading" : state.error ? "error" : "ready";
    renderHeader();
    renderPipeline();
    renderCenter();
    renderDecision();
    renderNotes();
    renderAgentView();
    setMobileView(state.mobileView, { focus: false });
  }

  function renderHeader() {
    if (state.loading) {
      els.headerCurrent.innerHTML = '<span class="status-dot status-dot--loading" aria-hidden="true"></span><span>Opening the current word…</span>';
      return;
    }
    if (state.error) {
      els.headerCurrent.innerHTML = `<span class="status-dot status-dot--error" aria-hidden="true"></span><span>${escapeHtml(state.error)}</span>`;
      return;
    }
    const packet = state.data.packet;
    const status = state.data.status || {};
    if (!packet) {
      const ending = ownershipEndState();
      els.headerCurrent.innerHTML = `<span class="status-dot" aria-hidden="true"></span><span>${escapeHtml(ending.header)}</span>`;
      return;
    }
    const current = getCurrent();
    els.headerCurrent.innerHTML = `<span class="status-dot" aria-hidden="true"></span><span>${escapeHtml(status.page_id || packet.page_id || "Page")} · ${escapeHtml(current.line_id || "line")}&nbsp; · Reviewing “${escapeHtml(current.tentative_text || current.unit_id || "current word")}”</span>`;
  }

  function renderPipeline() {
    if (state.loading) {
      els.pipeline.innerHTML = '<div class="skeleton skeleton--rail" aria-hidden="true"></div>';
      return;
    }
    const status = state.data.status || {};
    const packet = state.data.packet;
    const progress = status.progress || {};
    const total = numberOr(progress.total_units, progress.page_total_units, 0);
    const terminal = numberOr(progress.terminal_units, progress.page_completed_units, 0);
    const percent = total > 0 ? Math.min(100, Math.round((terminal / total) * 100)) : 0;
    const runName = state.data.run?.display_name || state.data.run?.name || status.run_id || packet?.run_id || "Word ownership run";
    const pageId = status.page_id || packet?.page_id || "No page loaded";
    const ending = ownershipEndState();
    const activeStep = packet ? 2 : ending.activeStep;
    const steps = [
      ["Software proposes regions", "Bound detector and geometry outputs become disposable starting viewports"],
      ["Software chooses next", "Reading order plus residual ink controls the cursor"],
      ["Finish one word", "Repair crop, select exact ink, fit envelope, then erase"],
      ["Check what remains", "Residual ink injects any word the proposals missed"],
      ["Human exceptions", "Only unresolved ownership or reading reaches a person"],
    ];
    const current = getCurrent();
    const now = packet ? `Software proposed “${current.tentative_text || current.unit_id || "current word"}”. Make the crop one complete word, then select its ink.` : ending.now;
    const next = packet ? activeEffectCopy() : ending.next;

    els.pipeline.innerHTML = `
      <p class="eyebrow" id="pipeline-heading">Current run</p>
      <p class="rail-run-name">${escapeHtml(runName)}</p>
      <p class="rail-page">Page ${escapeHtml(pageId)}</p>
      <div class="progress-summary" aria-label="${terminal} of ${total || "unknown"} words terminal">
        <div class="progress-numbers"><strong>${terminal}${total ? ` / ${total}` : ""}</strong><span>${percent}% terminal</span></div>
        <progress class="progress-track" max="100" value="${percent}" aria-label="${percent}% terminal"></progress>
        <p class="progress-caption">${escapeHtml(progress.claimed_units ?? 0)} claimed · ${escapeHtml(progress.tier_deferred_units ?? 0)} set aside · ${escapeHtml(progress.deferred_units ?? 0)} human</p>
      </div>
      <p class="pipeline-heading">Page pipeline</p>
      <ol class="pipeline-steps">
        ${steps.map((step, index) => {
          const className = index < activeStep ? "is-complete" : index === activeStep ? "is-active" : "";
          const marker = index < activeStep ? "✓" : String(index + 1);
          return `<li class="pipeline-step ${className}"><span class="step-number">${marker}</span><div><strong>${step[0]}</strong><p>${step[1]}</p></div></li>`;
        }).join("")}
      </ol>
      <div class="rail-now-next">
        <div class="rail-callout"><span>Now</span><strong>${escapeHtml(now)}</strong></div>
        <div class="rail-callout"><span>Next</span><strong id="rail-next">${escapeHtml(next)}</strong></div>
      </div>`;
  }

  function renderCenter() {
    if (state.loading) {
      els.center.innerHTML = `<div class="loading-stage" role="status"><div class="skeleton skeleton--line"></div><div class="skeleton skeleton--title"></div><div class="skeleton skeleton--image"></div><span class="sr-only">Loading current evidence</span></div>`;
      return;
    }
    if (state.error) {
      els.center.innerHTML = stateCard("Couldn’t open the review console", state.error, "Try again", "retry-bootstrap", true);
      return;
    }
    const packet = state.data.packet;
    if (!packet) {
      const ending = ownershipEndState();
      els.center.innerHTML = renderHistoricalDraftBanner() + stateCard(
        ending.title,
        ending.copy,
        ending.button,
        "refresh-current",
        false,
        ending.icon,
      );
      return;
    }

    const current = getCurrent();
    const status = state.data.status || {};
    const entries = evidenceEntries();
    const components = componentEntries();
    const activeEntry = entries.find(([key]) => key === state.activeEvidenceKey) || entries[0] || null;
    const tier = current.active_model_tier || current.required_model_tier || "unknown";
    const conflict = packet.ownership_conflict || packet.ownership_task?.ownership_conflict;
    const conflictCopy = conflict?.blocked ? "Software detected that an earlier claim consumed most of this proposal. Repair the viewport or escalate—do not steal prior ink." : "This rectangle is a software proposal, not the answer. First decide whether it contains exactly one complete word.";

    els.center.innerHTML = `
      ${renderHistoricalDraftBanner()}
      <article class="current-card">
        <div class="current-status-row">
          <div class="word-location">
            <span>Page ${escapeHtml(status.page_id || packet.page_id || "—")}</span>
            <span>Line ${escapeHtml(current.line_id || "—")}</span>
            <span>Unit ${escapeHtml(current.unit_id || "—")}</span>
          </div>
          <div class="meta-row current-meta">
            <span class="tier-badge">${escapeHtml(tier)} tier</span>
            <span class="revision-badge">Revision ${escapeHtml(packet.revision ?? status.revision ?? "—")} · Turn ${escapeHtml(current.unit_turn ?? packet.ownership_task?.turn ?? 0)}</span>
          </div>
        </div>
        <p class="eyebrow">Software-proposed next region</p>
        <h1 id="current-word-heading" tabindex="-1">Make this viewport contain one complete <q>${escapeHtml(current.tentative_text || current.unit_id || "word")}</q></h1>
        <p class="current-explainer">${escapeHtml(conflictCopy)}</p>
      </article>
      <div class="effect-strip" id="current-effect"><span aria-hidden="true">→</span><div><strong>${escapeHtml(ACTION_COPY[state.activeActionType]?.label || "Choose a legal move")}</strong><small>${escapeHtml(activeEffectCopy())}</small></div></div>
      <section class="evidence-card" aria-labelledby="evidence-heading">
        <div class="evidence-card-header">
          <div class="section-heading-row">
            <div><p class="eyebrow">Current evidence</p><h2 id="evidence-heading">Compare every view before deciding</h2></div>
            <div class="legend" aria-label="Evidence legend">
              <span><i class="legend-swatch legend-swatch--red"></i>Prior-owned</span>
              <span><i class="legend-swatch legend-swatch--green"></i>Current box</span>
              <span><i class="legend-swatch legend-swatch--orange"></i>Original box</span>
              <span><i class="legend-swatch legend-swatch--blue"></i>Your draw</span>
            </div>
          </div>
          <div class="evidence-tabs" role="tablist" aria-label="Evidence views">
            ${entries.map(([key]) => `<button class="evidence-tab" type="button" role="tab" data-evidence-key="${escapeAttr(key)}" aria-selected="${key === activeEntry?.[0]}">${escapeHtml(evidenceLabel(key))}</button>`).join("")}
          </div>
        </div>
        ${renderEvidenceStage(activeEntry)}
      </section>
      <section class="selection-card" aria-labelledby="selection-heading">
        <div class="selection-toolbar">
          <div><p class="eyebrow">Approximate, then refine</p><h2 id="selection-heading">Box the word, then clean up its ink</h2><p>Drag around the full word for a fast first selection. Then click individual red or green pieces to add or remove them. All three views use the exact same crop.</p></div>
          <button class="text-button" type="button" id="select-none" ${components.length ? "" : "disabled"}>Select none</button>
        </div>
        <div class="selection-triptych" id="selection-workspace">
          <figure class="selection-view selection-view--original">
            <figcaption><strong>1. Original crop</strong><span>Read the handwriting and judge what belongs.</span></figcaption>
            <img src="${escapeAttr(evidenceUrl(packet.evidence?.work_crop, "work_crop"))}" alt="Original source crop for the current word" draggable="false">
          </figure>
          <figure class="selection-view" data-selection-view="clean">
            <figcaption><button type="button" class="ink-view-button" data-ink-view="clean" aria-pressed="${state.selectionView === "clean"}"><strong>2. Clean ink</strong><span>Less noise; more fragmented strokes.</span></button></figcaption>
            <canvas class="selection-canvas" data-ink-canvas="clean" aria-label="Clean extracted ink selection. Drag a box or click a stroke." tabindex="0"></canvas>
          </figure>
          <figure class="selection-view" data-selection-view="strong">
            <figcaption><button type="button" class="ink-view-button" data-ink-view="strong" aria-pressed="${state.selectionView === "strong"}"><strong>3. Strong ink</strong><span>More complete strokes; may include noise.</span></button></figcaption>
            <canvas class="selection-canvas" data-ink-canvas="strong" aria-label="Strong extracted ink selection. Drag a box or click a stroke." tabindex="0"></canvas>
          </figure>
          <p class="selection-loading" id="selection-loading">Preparing synchronized per-pixel views…</p>
        </div>
        <div class="selection-mode-note"><strong>${state.selectionView === "strong" ? "Strong ink active" : "Clean ink active"}.</strong> Drag replaces the rough selection; Shift-drag adds to it. Point clicks toggle one connected piece. Piece IDs come from the bound strong superset, so switching views never silently changes the selected pixels; the other ink panel always shows what the same choice includes.</div>
        <div class="component-chips" id="component-chips">
          ${components.length ? components.map((component) => renderComponentChip(component)).join("") : '<p class="empty-copy">No selectable numbered components are in this packet.</p>'}
        </div>
      </section>
      ${renderEnvelopePreview()}
      <div class="context-note">
        <span aria-hidden="true">✎</span>
        <div><strong>Something awkward, missing, or slow?</strong><br>Write it down while the exact word and evidence version are still attached.</div>
        <button class="text-button" type="button" data-open-notes>Open notebook</button>
      </div>`;
    updateDrawOverlay();
    renderSelectionCanvases();
    renderAgentView();
  }

  function renderEvidenceStage(activeEntry) {
    if (!activeEntry) {
      return '<div class="image-empty"><p>No image evidence was supplied for this packet.</p></div>';
    }
    const [key, item] = activeEntry;
    const url = evidenceUrl(item, key);
    const [label, description] = EVIDENCE_COPY[key] || [humanize(key), humanize(item?.role || "Packet evidence")];
    const isBBoxSurface = state.activeActionType === "reopen_bbox" && key === "source_context";
    const isCutSurface = state.activeActionType === "cut" && key === "work_crop";
    const drawMode = isBBoxSurface ? "bbox" : isCutSurface ? "cut" : "";
    const instruction = isBBoxSurface ? "Drag on this source-oriented image to draw a replacement word box." : isCutSurface ? "Drag a line across the observed bridge. The numeric endpoints remain editable." : description;
    const drawSvg = drawMode ? `<svg class="cut-layer draw-layer" aria-hidden="true" preserveAspectRatio="none"><rect data-draw-rect hidden></rect><line data-draw-line hidden></line><circle data-draw-start hidden></circle><circle data-draw-end hidden></circle></svg>` : "";
    return `
      <div class="evidence-stage">
        ${url ? `<div class="image-wrap ${drawMode ? "is-cut-surface" : ""}" ${drawMode ? `data-draw-surface="${drawMode}"` : ""} data-evidence-key="${escapeAttr(key)}"><img class="evidence-image" src="${escapeAttr(url)}" alt="${escapeAttr(label)} for the current word" draggable="false">${drawSvg}</div>` : '<div class="image-error"><p>This evidence does not have a usable server URL.</p></div>'}
      </div>
      <div class="evidence-caption"><span><strong>${escapeHtml(label)}.</strong> ${escapeHtml(instruction)}</span><span class="evidence-caption-actions"><span>${escapeHtml(sizeLabel(item?.size_wh))}</span>${url ? `<a class="evidence-full-link" href="${escapeAttr(url)}" target="_blank" rel="noopener">Open full-size image <span aria-hidden="true">↗</span></a>` : ""}</span></div>`;
  }

  function renderComponentChip(component) {
    const id = Number(component.id);
    const fingerprint = component.fingerprint || {};
    const selected = state.selectedComponents.has(id);
    const detail = Number.isFinite(fingerprint.area_px) ? `${fingerprint.area_px.toLocaleString()} px` : "numbered region";
    return `<button class="component-chip" type="button" data-component-id="${id}" aria-pressed="${selected}" ${id >= 1 && id <= 9 ? `aria-keyshortcuts="${id}"` : ""}><span>Component ${id}</span><span class="component-detail">${escapeHtml(detail)}</span></button>`;
  }

  async function renderSelectionCanvases() {
    const canvases = [...document.querySelectorAll(".selection-canvas[data-ink-canvas]")];
    const loading = document.querySelector("#selection-loading");
    const labelEvidence = state.data.packet?.evidence?.component_label_map;
    const cleanEvidence = state.data.packet?.evidence?.clean_ink_selection_crop || state.data.packet?.evidence?.ink_selection_crop;
    if (!canvases.length || !labelEvidence || !cleanEvidence || !state.packetHash) return;
    const token = `${state.packetHash}:${selectedIds().join(",")}`;
    state.selectionRenderToken = token;
    try {
      let decoded = state.selectionLabels;
      if (!decoded || decoded.packetHash !== state.packetHash) {
        const image = new Image();
        image.src = evidenceUrl(labelEvidence, "component_label_map");
        await image.decode();
        const scratch = document.createElement("canvas");
        scratch.width = image.naturalWidth;
        scratch.height = image.naturalHeight;
        const scratchContext = scratch.getContext("2d", { willReadFrequently: true });
        scratchContext.drawImage(image, 0, 0);
        const rgba = scratchContext.getImageData(0, 0, scratch.width, scratch.height).data;
        const labels = new Uint32Array(scratch.width * scratch.height);
        for (let index = 0, pixel = 0; index < rgba.length; index += 4, pixel += 1) {
          labels[pixel] = rgba[index] | (rgba[index + 1] << 8) | (rgba[index + 2] << 16);
        }
        decoded = { packetHash: state.packetHash, width: scratch.width, height: scratch.height, labels };
        state.selectionLabels = decoded;
      }
      let masks = state.selectionMasks;
      if (!masks || masks.packetHash !== state.packetHash) {
        const cleanImage = new Image();
        cleanImage.src = evidenceUrl(cleanEvidence, "clean_ink_selection_crop");
        await cleanImage.decode();
        if (cleanImage.naturalWidth !== decoded.width || cleanImage.naturalHeight !== decoded.height) throw new Error("The clean and strong ink views do not share one crop");
        const scratch = document.createElement("canvas");
        scratch.width = decoded.width; scratch.height = decoded.height;
        const context = scratch.getContext("2d", { willReadFrequently: true });
        context.drawImage(cleanImage, 0, 0);
        const rgba = context.getImageData(0, 0, decoded.width, decoded.height).data;
        const clean = new Uint8Array(decoded.width * decoded.height);
        for (let index = 0, pixel = 0; index < rgba.length; index += 4, pixel += 1) {
          clean[pixel] = rgba[index] > 150 && rgba[index + 1] < 100 && rgba[index + 2] < 100 ? 1 : 0;
        }
        masks = { packetHash: state.packetHash, clean };
        state.selectionMasks = masks;
      }
      if (state.selectionRenderToken !== token) return;
      for (const canvas of canvases) {
        canvas.width = decoded.width;
        canvas.height = decoded.height;
        const context = canvas.getContext("2d");
        const output = context.createImageData(decoded.width, decoded.height);
        const selected = state.selectedComponents;
        const variant = canvas.dataset.inkCanvas;
        for (let pixel = 0, index = 0; pixel < decoded.labels.length; pixel += 1, index += 4) {
          const id = decoded.labels[pixel];
          const visible = variant === "strong" ? id !== 0 : Boolean(masks.clean[pixel]);
          const color = !visible ? [251, 247, 238] : selected.has(id) ? [34, 158, 92] : [201, 55, 48];
          output.data[index] = color[0]; output.data[index + 1] = color[1]; output.data[index + 2] = color[2]; output.data[index + 3] = 255;
        }
        context.putImageData(output, 0, 0);
        if (state.selectionDrawing?.variant === variant) {
          const box = normalizedSelectionBox(state.selectionDrawing.start, state.selectionDrawing.current);
          context.save();
          context.strokeStyle = "#0879bd";
          context.fillStyle = "rgba(8,121,189,.12)";
          context.lineWidth = Math.max(2, decoded.width / 240);
          context.setLineDash([8, 6]);
          context.fillRect(box[0], box[1], box[2], box[3]);
          context.strokeRect(box[0], box[1], box[2], box[3]);
          context.restore();
        }
      }
      state.selectionCanvasReady = true;
      if (loading) loading.hidden = true;
    } catch (error) {
      if (loading) {
        loading.hidden = false;
        loading.textContent = `Exact point selection could not load: ${friendlyError(error)}`;
      }
    }
  }

  async function seedFromCanvas(event, canvas = event.target.closest?.(".selection-canvas")) {
    if (!canvas || !state.packetHash) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = Math.max(0, Math.min(canvas.width - 1, Math.floor((event.clientX - rect.left) / rect.width * canvas.width)));
    const y = Math.max(0, Math.min(canvas.height - 1, Math.floor((event.clientY - rect.top) / rect.height * canvas.height)));
    try {
      const result = await requestJson(API.selectionSeed, {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({ work_packet_sha256: state.packetHash, x, y }),
      });
      toggleComponent(Number(result.component_id), { seeded: true });
      if (result.snapped) toast("The point landed beside a stroke; software snapped to the nearest connected ink.");
    } catch (error) {
      toast(friendlyError(error), "error");
    }
  }

  function renderEnvelopePreview() {
    const preview = state.envelopePreview;
    if (!preview) return "";
    const metrics = preview.metrics || {};
    const contamination = metrics.excluded_ink_contamination;
    return `<section class="envelope-preview-card" aria-labelledby="envelope-preview-heading">
      <div><p class="eyebrow">Deterministic fitted result</p><h2 id="envelope-preview-heading">Envelope passed its safety gates</h2><p>The cyan outline is software geometry around the exact green ink—not the original proposal rectangle.</p></div>
      <img src="${escapeAttr(preview.image_url)}" alt="Fitted envelope preview with selected ink green, excluded ink red, and envelope cyan">
      <div class="metric-grid">
        <span><strong>${escapeHtml(humanize(preview.profile || "standard"))}</strong> fit profile</span>
        <span><strong>${escapeHtml(preview.method)}</strong> geometry method</span>
        <span><strong>${escapeHtml(metrics.selected_ink_pixels ?? "—")}</strong> selected pixels</span>
        <span><strong>${formatPercent(metrics.selected_ink_coverage)}</strong> selected coverage</span>
        <span><strong>${contamination == null ? "0%" : formatPercent(contamination)}</strong> excluded contamination</span>
      </div>
      <details class="fit-trials"><summary>What software tried (${arrayValue(preview.fitting_trials).length} attempts)</summary><ol>${arrayValue(preview.fitting_trials).map((trial) => `<li><strong>${escapeHtml(humanize(trial.profile))} / ${escapeHtml(trial.method)}</strong>: ${trial.status === "pass" ? "passed" : escapeHtml(trial.reason || "rejected")}</li>`).join("")}</ol></details>
      <p class="preview-receipt">Preview receipt ${escapeHtml(shortHash(preview.preview_sha256))} · This exact selection must still match when approved.</p>
    </section>`;
  }

  function renderDecision() {
    if (state.loading) {
      els.decision.innerHTML = '<div class="panel-loading" role="status"><div class="skeleton skeleton--line"></div><div class="skeleton skeleton--block"></div><div class="skeleton skeleton--block"></div><span class="sr-only">Loading legal actions</span></div>';
      return;
    }
    if (state.error) {
      els.decision.innerHTML = `<div class="decision-intro"><p class="eyebrow">Connection problem</p><h2>Actions are paused</h2><p>${escapeHtml(state.error)}</p><button class="primary-button" type="button" id="retry-bootstrap">Try again</button></div>`;
      return;
    }
    const packet = state.data.packet;
    if (!packet) {
      const ending = ownershipEndState();
      els.decision.innerHTML = `<div class="decision-intro"><p class="eyebrow">Ownership status</p><h2>${escapeHtml(ending.title)}</h2><p>${escapeHtml(ending.next)}</p><button class="secondary-button" type="button" id="refresh-current">${escapeHtml(ending.button)}</button></div>`;
      return;
    }

    const legal = legalActions();
    const active = legal.find((item) => item.type === state.activeActionType) || legal[0];
    if (!active) {
      els.decision.innerHTML = `<div class="decision-intro"><p class="eyebrow">No legal action</p><h2>Software supplied no move</h2><p>This packet cannot be changed from the console. Capture a note and refresh the run state.</p></div>`;
      return;
    }
    const copy = ACTION_COPY[active.type] || { label: humanize(active.type), short: "Packet action", heading: humanize(active.type), description: "This action is supplied by the current packet." };
    els.decision.innerHTML = `
      <div class="decision-intro">
        <p class="eyebrow">One move only</p>
        <h2>What should happen now?</h2>
        <p>These controls come directly from this packet. A saved move creates the next append-only revision.</p>
      </div>
      <div class="action-choices" aria-label="Legal actions">
        ${legal.map((item) => {
          const itemCopy = ACTION_COPY[item.type] || { label: humanize(item.type), short: "Packet action" };
          return `<button class="action-choice" type="button" data-action-type="${escapeAttr(item.type)}" aria-pressed="${item.type === active.type}"><strong>${escapeHtml(itemCopy.label)}</strong><small>${escapeHtml(itemCopy.short)}</small></button>`;
        }).join("")}
      </div>
      <div class="action-effect"><span>What this move does</span><strong>${escapeHtml(actionEffect(active))}</strong></div>
      ${renderActionForm(active, copy)}
      <details class="agent-vocabulary"><summary>Show the agent’s exact action name</summary><code>${escapeHtml(active.type)}</code></details>`;
    restoreActionFormValues(active.type);
    syncGeometryInputs();
    updatePrimaryActionButton();
  }

  function renderAgentView() {
    if (!els.agentContent) return;
    const packet = state.data.packet;
    const contract = state.data.agent_contract || {};
    const summary = state.data.experience_summary || {};
    if (!packet) {
      els.agentContent.innerHTML = `<div class="decision-intro"><p class="eyebrow">Agent transparency</p><h2>No current model turn</h2><p>The exact prompt and packet appear here whenever software has a current word.</p></div>`;
      return;
    }
    const current = getCurrent();
    const automatic = current.automatic_approval_eligibility || packet.ownership_task?.unit?.automatic_approval_eligibility || {};
    const conflict = packet.ownership_conflict || {};
    const legal = legalActions();
    const contentOrder = contract.content_order || [];
    const counts = summary.counts_by_type || {};
    const automaticReason = automatic.reason === "validated_pass2_did_not_approve_an_exact_candidate_mask"
      ? "Pass 2 could not certify this proposed ink mask as exact, so a model must inspect it."
      : (automatic.reason || "Candidate ink was not automatically certified as exact.");
    els.agentContent.innerHTML = `<div class="agent-view-intro">
      <p class="eyebrow">Exact agent turn</p>
      <h2>What the model sees, chooses, and struggles with</h2>
      <p>This is the inspectable operating record. It stores concise observable reasons and difficulty signals, not private hidden chain-of-thought.</p>
    </div>
    <section class="agent-now-card">
      <span class="agent-step">Current model tier</span><strong>${escapeHtml(current.active_model_tier || "unknown")}</strong>
      <span class="agent-step">Software proposal</span><strong>${escapeHtml(current.unit_id)} · “${escapeHtml(current.tentative_text)}”</strong>
      <span class="agent-step">Why a model turn exists</span><p>${escapeHtml(automaticReason)}</p>
      <span class="agent-step">Candidate provenance</span><p>Pass-1 adjudicated upstream geometry. This packet does not include a direct Kraken execution receipt, so the UI does not claim Kraken alone produced this exact box.</p>
      <span class="agent-step">Ownership conflict</span><p>${conflict.blocked ? escapeHtml(conflict.reason || "Detected") : "No blocking prior-claim conflict detected."}</p>
      <span class="agent-step">Selectable pieces</span><strong>${componentEntries().length}</strong>
    </section>
    <section class="agent-sequence"><p class="eyebrow">What arrives, in order</p><ol>${contentOrder.map((item, index) => `<li><span>${index + 1}</span><strong>${escapeHtml(humanize(item))}</strong></li>`).join("")}</ol></section>
    <section><p class="eyebrow">Allowed choices this turn</p><div class="agent-action-list">${legal.map((item) => `<article><strong>${escapeHtml(ACTION_COPY[item.type]?.label || humanize(item.type))}</strong><code>${escapeHtml(item.type)}</code><p>${escapeHtml(actionEffect(item))}</p></article>`).join("")}</div></section>
    <section class="agent-live-choice"><p class="eyebrow">Live choice being assembled</p><p><strong>Selected ink:</strong> ${selectedIds().length ? selectedIds().join(", ") : "none yet"}</p><p><strong>Chosen tool:</strong> ${escapeHtml(state.activeActionType || "none")}</p><p><strong>Envelope:</strong> ${state.envelopePreview ? `passed with ${escapeHtml(state.envelopePreview.method)}` : "not run yet"}</p></section>
    <details class="agent-vocabulary"><summary>Show exact prompt (${escapeHtml(shortHash(contract.prompt?.file_sha256))})</summary><pre>${escapeHtml(contract.prompt?.text || "Prompt unavailable")}</pre></details>
    <details class="agent-vocabulary"><summary>Show exact current work packet (${escapeHtml(shortHash(packet.work_packet_sha256))})</summary><pre>${escapeHtml(JSON.stringify(packet, null, 2))}</pre></details>
    <details class="agent-vocabulary"><summary>Show structured response contract</summary><pre>${escapeHtml(JSON.stringify(contract.response_schema || {}, null, 2))}</pre></details>
    <section class="experience-card"><p class="eyebrow">Experience telemetry so far</p><p><strong>${escapeHtml(summary.total_events || 0)}</strong> recorded interactions · <strong>${escapeHtml(counts.action_failed || 0)}</strong> failed actions · <strong>${escapeHtml(counts.envelope_previewed || 0)}</strong> envelope attempts · <strong>${escapeHtml(counts.selection_seeded || 0)}</strong> point selections</p></section>`;
  }

  function renderActionForm(schema, copy) {
    if (!Object.prototype.hasOwnProperty.call(ACTION_COPY, schema.type)) {
      return `<div class="form-message">The packet offers <code>${escapeHtml(schema.type)}</code>, but this human console does not yet have a safe form for it. Record this as a missing tool.</div>`;
    }
    const selected = selectedIds();
    let fields = "";
    if (schema.type === "claim_select" || schema.type === "exclude") {
      fields = `
        <div class="selection-summary" id="decision-selection-summary">${selectionSummary()}</div>
        ${renderConfidence(schema)}
        ${renderReasonOptions(schema, schema.type === "claim_select" ? "same_word_body" : "adjacent_word")}`;
    } else if (schema.type === "cut") {
      const ids = allowedComponentIds(schema);
      const selectedBridge = selected.length === 1 && ids.includes(selected[0]) ? selected[0] : ids[0];
      const points = state.cutPoints || [[0, 0], [0, 0]];
      fields = `
        <label class="field"><span>Connected ink region to cut</span><select name="bridge_component_id" required>${ids.map((id) => `<option value="${id}" ${id === selectedBridge ? "selected" : ""}>Component ${id}</option>`).join("")}</select></label>
        <div class="field"><span>Line endpoints in the work crop</span><div class="field-grid field-grid--four">
          ${numberField("p1x", "Start X", points[0][0], 0)}${numberField("p1y", "Start Y", points[0][1], 0)}${numberField("p2x", "End X", points[1][0], 0)}${numberField("p2y", "End Y", points[1][1], 0)}
        </div><p class="field-hint">Use Work crop and drag a line, then fine-tune the exact coordinates here.</p></div>
        <label class="field"><span>Cut width</span><select name="width_px">${arrayValue(schema.cut?.width_px).map((value) => `<option value="${escapeAttr(value)}">${escapeHtml(value)} pixel${value === 1 ? "" : "s"}</option>`).join("")}</select></label>
        ${renderConfidence(schema)}${renderReasonOptions(schema, "threshold_bridge")}`;
    } else if (schema.type === "request_expanded_context") {
      const request = schema.request || {};
      const min = request.margin_px?.integer_min ?? 16;
      const max = request.margin_px?.integer_max ?? 512;
      fields = `
        <label class="field"><span>What kind of context?</span><select name="kind">${arrayValue(request.kind).map(optionHtml).join("")}</select></label>
        <fieldset class="field-group"><legend>Which sides?</legend><div class="check-grid">${subsetValues(request.sides).map((value) => checkHtml("sides", value, value === "left" || value === "right")).join("")}</div></fieldset>
        <label class="field"><span>Extra margin in pixels</span><input name="margin_px" type="number" min="${min}" max="${max}" step="1" value="${Math.min(max, Math.max(min, 128))}" required><span class="field-hint">Software expands the crop; it does not enhance or redraw the source.</span></label>
        <label class="field"><span>Why is more context needed?</span><select name="why">${arrayValue(request.why).map(optionHtml).join("")}</select></label>
        <div class="selection-summary">Focus on ${selected.length ? `<strong>component${selected.length === 1 ? "" : "s"} ${selected.join(", ")}</strong>` : "the whole current target"}.</div>
        ${renderConfidence(schema)}${renderReasonOptions(schema, "border_contact")}`;
    } else if (schema.type === "reopen_bbox") {
      const current = getCurrent();
      const box = state.bboxDraft || current.active_target_bbox_source_xywh || current.target_bbox_source_xywh || [0, 0, 1, 1];
      fields = `
        <div class="field"><span>Replacement source box [x, y, width, height]</span><div class="field-grid field-grid--four">
          ${numberField("bbox_x", "X", box[0], 0)}${numberField("bbox_y", "Y", box[1], 0)}${numberField("bbox_w", "Width", box[2], 1)}${numberField("bbox_h", "Height", box[3], 1)}
        </div><p class="field-hint">Switch to Source context and drag a rectangle, or edit these exact values. The new box must intersect ink and materially differ.</p></div>
        ${renderConfidence(schema)}${renderReasonOptions(schema, "wrong_line_registration")}`;
    } else if (schema.type === "defer_tier") {
      fields = `<div class="selection-summary"><strong>This does not start Sol.</strong> It records the exact word and advances Terra; software must explicitly create the later Sol pass.</div>`;
    } else if (schema.type === "defer_manual") {
      fields = `
        <label class="field"><span>Why must a person settle this?</span><select name="disposition" required><option value="" selected disabled>Choose a disposition…</option>${arrayValue(schema.disposition).map(optionHtml).join("")}</select></label>
        ${renderConfidence(schema)}${renderReasonOptions(schema, "uncertain_reading")}`;
    }
    const initiallyDisabled = (schema.type === "claim_select" || schema.type === "exclude") ? selected.length === 0 : schema.type === "reopen_bbox" ? !bboxDraftDiffers() : schema.type === "cut" ? !cutDraftDiffers() : false;
    return `
      <form class="decision-form" id="decision-form" data-action-form="${escapeAttr(schema.type)}" novalidate>
        <div><p class="eyebrow">${escapeHtml(copy.short)}</p><h3>${escapeHtml(copy.heading)}</h3><p class="field-hint form-description">${escapeHtml(copy.description)}</p></div>
        ${renderDecisionTraceFields()}
        ${fields}
        <p class="form-message" id="action-form-message" role="alert" hidden></p>
        <div class="action-dock">
          <button class="primary-button primary-button--teal" id="review-action-button" type="submit" ${initiallyDisabled ? "disabled" : ""}>${escapeHtml(actionButtonLabel(schema.type))}</button>
          <p class="packet-binding">Bound to packet ${escapeHtml(shortHash(state.packetHash))}</p>
        </div>
      </form>`;
  }

  function renderDecisionTraceFields() {
    const cropStates = {
      one_complete_word: "One complete word",
      clipped_word: "Target word is clipped",
      multiple_words: "Crop contains multiple words",
      partial_letters_only: "Only partial letters are present",
      wrong_region: "Wrong word, line, or region",
      shared_or_touching_ink: "Target touches or crosses other ink",
      uncertain: "Cannot tell safely",
    };
    const difficulties = {
      routine: "Routine",
      attention_needed: "Needed a deliberate check",
      hard: "Hard — repair or cut needed",
      blocked: "Blocked by the current tools",
    };
    const struggles = {
      crop_clips_target: "Crop clips the target",
      crop_contains_neighbor: "Crop includes a neighboring word",
      detached_mark_uncertain: "Detached mark is ambiguous",
      ink_touches_neighbor: "Ink touches a neighboring word",
      reading_uncertain: "Reading is uncertain",
      orientation_difficult: "Orientation made comparison difficult",
      proposal_on_wrong_line: "Proposal landed on the wrong line",
      insufficient_context: "More context was needed",
      tool_did_not_help: "A software tool did not help",
    };
    return `<section class="decision-trace-fields">
      <div><p class="eyebrow">Visible agent decision record</p><h3>What did the model see and struggle with?</h3><p class="field-hint">This concise record is stored with the action so later evaluation can explain success, retries, and wasted time. It is not hidden chain-of-thought.</p></div>
      <label class="field"><span>What is in the software proposal?</span><select name="crop_state" required>${Object.entries(cropStates).map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join("")}</select></label>
      <label class="field"><span>How difficult was this turn?</span><select name="difficulty" required>${Object.entries(difficulties).map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join("")}</select></label>
      <fieldset class="field-group"><legend>What made it difficult? <small>(optional)</small></legend><div class="check-grid">${Object.entries(struggles).map(([value, label]) => checkHtml("struggle_flags", value, false)).join("")}</div></fieldset>
      <label class="field"><span>Concise observable decision summary</span><textarea name="decision_summary" rows="3" maxlength="500" required placeholder="Example: The crop contains the full target plus the first stroke of the next word. I selected components 2, 3, and 5 only."></textarea><span class="field-hint">State the visible evidence, the problem, and why this tool action is appropriate.</span></label>
    </section>`;
  }

  function renderConfidence(schema) {
    const values = arrayValue(schema.confidence);
    if (!values.length) return "";
    return `<label class="field"><span>Confidence</span><select name="confidence">${values.map((value) => `<option value="${escapeAttr(value)}" ${value === "medium" || (!values.includes("medium") && value === values[0]) ? "selected" : ""}>${escapeHtml(VALUE_COPY[value] || humanize(value))}</option>`).join("")}</select></label>`;
  }

  function renderReasonOptions(schema, defaultValue) {
    const values = subsetValues(schema.reason_codes);
    if (!values.length) return "";
    return `<fieldset class="field-group"><legend>Reason</legend><div class="check-grid">${values.map((value) => checkHtml("reason_codes", value, value === defaultValue)).join("")}</div></fieldset>`;
  }

  function checkHtml(name, value, checked) {
    return `<label class="check-option"><input type="checkbox" name="${escapeAttr(name)}" value="${escapeAttr(value)}" ${checked ? "checked" : ""}><span>${escapeHtml(REASON_COPY[value] || VALUE_COPY[value] || humanize(value))}</span></label>`;
  }

  function numberField(name, label, value, min) {
    return `<label class="field"><span>${escapeHtml(label)}</span><input type="number" name="${escapeAttr(name)}" value="${escapeAttr(Number.isFinite(Number(value)) ? Number(value) : 0)}" min="${min}" step="1" required></label>`;
  }

  function renderNotes() {
    const notes = Array.isArray(state.data.notes) ? state.data.notes : [];
    els.noteCountHeader.textContent = String(notes.length);
    els.noteCountHeader.setAttribute("aria-label", `${notes.length} note${notes.length === 1 ? "" : "s"}`);
    els.noteCountTab.textContent = String(notes.length);
    renderNoteEvidenceOptions();
    renderUploadConstraints();
    restoreNoteDraftIfNeeded();
    renderHistoricalDraftNotice();
    if (!notes.length) {
      els.noteList.innerHTML = '<p class="empty-copy">No notes yet. Capture friction the moment you feel it.</p>';
      return;
    }
    const sorted = [...notes].sort((a, b) => dateValue(b) - dateValue(a));
    els.noteList.innerHTML = sorted.map(renderNoteCard).join("");
  }

  function renderNoteEvidenceOptions() {
    const oldValue = els.noteEvidence.value;
    const isHistorical = Boolean(state.noteDraftBindingHash && state.noteDraftBindingHash !== state.packetHash);
    const currentEvidenceRefs = new Set();
    const selectableEvidence = isHistorical ? [] : evidenceEntries();
    const options = [`<option value="">${isHistorical ? `Earlier review packet ${escapeHtml(shortHash(state.noteDraftBindingHash))}` : "Current review packet"}</option>`, ...selectableEvidence.map(([key, item]) => {
      const ref = evidenceRef(item, key);
      currentEvidenceRefs.add(ref);
      return `<option value="${escapeAttr(ref)}">${escapeHtml(evidenceLabel(key))}</option>`;
    })];
    if (isHistorical && oldValue && !currentEvidenceRefs.has(oldValue)) {
      options.splice(1, 0, `<option value="${escapeAttr(oldValue)}">Earlier packet evidence · ${escapeHtml(humanize(oldValue.split("/").pop()))}</option>`);
    }
    els.noteEvidence.innerHTML = options.join("");
    if ([...els.noteEvidence.options].some((option) => option.value === oldValue)) els.noteEvidence.value = oldValue;
    if (!state.noteEvidenceTouched && !isHistorical) defaultNoteEvidenceToActive();
  }

  function historicalDraftCopy() {
    const notice = state.historicalDraftNotice;
    if (!notice) return null;
    const actionDrafts = arrayValue(notice.actionDrafts);
    const parts = [];
    if (actionDrafts.length) {
      const hashes = actionDrafts.map((draft) => shortHash(draft.hash)).join(", ");
      parts.push(`${actionDrafts.length === 1 ? "An unfinished action draft is" : `${actionDrafts.length} unfinished action drafts are`} preserved locally under earlier packet${actionDrafts.length === 1 ? "" : "s"} ${hashes}. ${actionDrafts.length === 1 ? "It is" : "They are"} not applied to the current word.`);
    }
    if (notice.noteHash) {
      parts.push(`The notebook draft still belongs to earlier packet ${shortHash(notice.noteHash)} and will save against that packet.`);
      if (notice.screenshotPreserved) parts.push("Its unsaved screenshot is still attached in this tab; save the note or explicitly remove the screenshot before leaving.");
    }
    if (!parts.length) return null;
    return { title: "Earlier packet draft preserved", body: parts.join(" "), hasNote: Boolean(notice.noteHash) };
  }

  function renderHistoricalDraftBanner() {
    const warning = historicalDraftCopy();
    if (!warning) return "";
    return `<aside class="draft-warning draft-warning--center" role="status"><strong>${escapeHtml(warning.title)}</strong><p>${escapeHtml(warning.body)}</p>${warning.hasNote ? '<button class="text-button" type="button" data-open-notes>Open preserved note draft</button>' : ""}</aside>`;
  }

  function renderHistoricalDraftNotice() {
    const warning = historicalDraftCopy();
    if (!els.draftWarning) return;
    els.draftWarning.hidden = !warning;
    els.draftWarning.innerHTML = warning ? `<strong>${escapeHtml(warning.title)}</strong><p>${escapeHtml(warning.body)}</p>` : "";
  }

  function renderUploadConstraints() {
    const constraints = uploadRules();
    const types = constraints.types.map((type) => type.replace("image/", "").toUpperCase().replace("JPEG", "JPEG")).join(", ");
    els.uploadConstraints.textContent = `${types} · up to ${formatBytes(constraints.maxBytes)}. Files remain only in this open tab until saved.`;
  }

  function renderNoteCard(note) {
    const binding = note.created_binding || note.latest_binding || note.binding || note.bound_to || note.context || {};
    const current = binding.current || {};
    const text = note.text || note.body || "";
    const severity = note.severity || "medium";
    const category = note.category || "observation";
    const created = note.created_at || note.timestamp || note.saved_at;
    const screenshot = noteScreenshotUrl(note);
    const word = binding.tentative_text || binding.word || current.tentative_text || note.tentative_text;
    const unitId = binding.unit_id || current.unit_id || note.unit_id;
    const line = binding.line_id || current.line_id || note.line_id;
    const revision = binding.revision ?? note.revision;
    const page = binding.page_id || note.page_id;
    const evidence = note.evidence?.ref || note.evidence_ref || binding.evidence_ref;
    const attachedEvidenceUrl = note.evidence?.url ? safeUrl(String(note.evidence.url)) : "";
    return `<article class="note-card">
      <div class="note-card-head"><div><span class="severity-badge" data-severity="${escapeAttr(severity)}">${escapeHtml(VALUE_COPY[severity] || humanize(severity))}</span><span class="category-badge">${escapeHtml(humanize(category))}</span></div><time class="note-time" ${created ? `datetime="${escapeAttr(created)}"` : ""}>${escapeHtml(formatDate(created))}</time></div>
      <p class="note-text">${escapeHtml(text)}</p>
      <div class="note-binding">${page ? `<span>Page ${escapeHtml(page)}</span>` : ""}${line ? `<span>Line ${escapeHtml(line)}</span>` : ""}${word ? `<span>Word “${escapeHtml(word)}”</span>` : unitId ? `<span>Unit ${escapeHtml(unitId)}</span>` : ""}${revision !== undefined ? `<span>Rev ${escapeHtml(revision)}</span>` : ""}${evidence ? `<span>Evidence: ${escapeHtml(humanize(String(evidence).split("/").pop()))}</span>` : ""}</div>
      ${attachedEvidenceUrl ? `<a class="note-evidence-link" href="${escapeAttr(attachedEvidenceUrl)}" target="_blank" rel="noopener">Open attached evidence</a>` : ""}
      ${screenshot ? `<a class="note-screenshot" href="${escapeAttr(screenshot)}" target="_blank" rel="noopener"><img src="${escapeAttr(screenshot)}" alt="Screenshot attached to this note" loading="lazy"></a>` : ""}
    </article>`;
  }

  function handleDelegatedClick(event) {
    const retry = event.target.closest("#retry-bootstrap");
    if (retry) { loadBootstrap(); return; }
    const refresh = event.target.closest("#refresh-current");
    if (refresh) { refreshCurrent(); return; }
    const staleRefresh = event.target.closest("#refresh-stale");
    if (staleRefresh) {
      closeConfirm({ cancelled: false });
      refreshCurrent();
      return;
    }
    const noteButton = event.target.closest("[data-open-notes]");
    if (noteButton) { switchControl("notes"); return; }
    const inkViewButton = event.target.closest?.("[data-ink-view]");
    if (inkViewButton) {
      state.selectionView = inkViewButton.dataset.inkView;
      emitTelemetry("evidence_viewed", { evidence_key: `${state.selectionView}_ink_selection_crop` });
      renderCenter();
      return;
    }
    const evidenceButton = event.target.closest("[data-evidence-key]");
    if (evidenceButton && evidenceButton.classList.contains("evidence-tab")) {
      state.activeEvidenceKey = evidenceButton.dataset.evidenceKey;
      emitTelemetry("evidence_viewed", { evidence_key: state.activeEvidenceKey });
      renderCenter();
      return;
    }
    const componentButton = event.target.closest("[data-component-id]");
    if (componentButton && componentButton.classList.contains("component-chip")) {
      toggleComponent(Number(componentButton.dataset.componentId));
      return;
    }
    if (event.target.closest("#select-none")) {
      const removed = selectedIds();
      state.selectedComponents.clear();
      state.envelopePreview = null;
      syncSelectionUI(true);
      saveActionDraftFromUI();
      emitTelemetry("selection_toggled", { component_id: null, selected: false, cleared_count: removed.length, selection_count: 0 });
      return;
    }
    const actionButton = event.target.closest("[data-action-type]");
    if (actionButton) {
      chooseAction(actionButton.dataset.actionType);
    }
  }

  function handleDelegatedInput(event) {
    const form = event.target.closest("#decision-form");
    if (!form) return;
    if (form.dataset.actionForm === "reopen_bbox" && event.target.name?.startsWith("bbox_")) {
      const values = ["bbox_x", "bbox_y", "bbox_w", "bbox_h"].map((name) => Number(form.elements[name]?.value));
      if (values.every(Number.isFinite) && values[2] > 0 && values[3] > 0) {
        state.bboxDraft = values.map(Math.round);
        updateDrawOverlay();
      }
    }
    if (form.dataset.actionForm === "cut" && /^p[12][xy]$/.test(event.target.name || "")) {
      const values = ["p1x", "p1y", "p2x", "p2y"].map((name) => Number(form.elements[name]?.value));
      if (values.every(Number.isFinite)) {
        state.cutPoints = [[Math.round(values[0]), Math.round(values[1])], [Math.round(values[2]), Math.round(values[3])]];
        updateDrawOverlay();
      }
    }
    saveActionDraftFromUI();
    updatePrimaryActionButton();
  }

  function handleDelegatedSubmit(event) {
    if (event.target.matches("#decision-form")) {
      event.preventDefault();
      prepareActionConfirmation(event.target);
    }
  }

  function handleKeyboardShortcut(event) {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable) return;
    if (document.querySelector("dialog[open]")) return;
    if (/^[1-9]$/.test(event.key)) {
      const id = Number(event.key);
      if (componentEntries().some((item) => Number(item.id) === id)) {
        event.preventDefault();
        toggleComponent(id);
      }
    } else if (event.key.toLowerCase() === "n") {
      event.preventDefault();
      switchControl("notes");
    } else if (event.key.toLowerCase() === "g") {
      event.preventDefault();
      openGuide();
    }
  }

  function chooseAction(type) {
    if (!legalActions().some((item) => item.type === type)) return;
    captureActionFormValues();
    state.activeActionType = type;
    if (type === "reopen_bbox" && evidenceEntries().some(([key]) => key === "source_context")) state.activeEvidenceKey = "source_context";
    if (type === "cut" && evidenceEntries().some(([key]) => key === "work_crop")) state.activeEvidenceKey = "work_crop";
    renderPipeline();
    renderCenter();
    renderDecision();
    saveActionDraftFromUI();
    emitTelemetry("action_form_opened", { action_type: type, automatic: false });
  }

  function toggleComponent(id, { seeded = false } = {}) {
    if (!componentEntries().some((item) => Number(item.id) === id)) return;
    const wasSelected = state.selectedComponents.has(id);
    if (wasSelected) state.selectedComponents.delete(id);
    else state.selectedComponents.add(id);
    state.envelopePreview = null;
    syncSelectionUI(true);
    saveActionDraftFromUI();
    emitTelemetry("selection_toggled", { component_id: id, selected: !wasSelected, selection_count: state.selectedComponents.size });
    if (seeded) toast(`${wasSelected ? "Unselected" : "Selected"} connected ink component ${id}.`);
  }

  function syncSelectionUI(announce = false) {
    document.querySelectorAll(".component-chip[data-component-id]").forEach((button) => {
      button.setAttribute("aria-pressed", String(state.selectedComponents.has(Number(button.dataset.componentId))));
    });
    const summary = document.querySelector("#decision-selection-summary");
    if (summary) summary.innerHTML = selectionSummary();
    const bridge = document.querySelector('#decision-form select[name="bridge_component_id"]');
    const selected = selectedIds();
    if (bridge && selected.length === 1 && [...bridge.options].some((option) => Number(option.value) === selected[0])) bridge.value = String(selected[0]);
    if (announce) {
      els.selectionAnnouncer.textContent = selected.length ? `Selected component${selected.length === 1 ? "" : "s"} ${selected.join(", ")}.` : "Component selection cleared.";
    }
    updatePrimaryActionButton();
    renderSelectionCanvases();
    renderAgentView();
    const existingPreview = document.querySelector(".envelope-preview-card");
    if (existingPreview && !state.envelopePreview) existingPreview.remove();
  }

  function selectionSummary() {
    const ids = selectedIds();
    return ids.length ? `<strong>${ids.length} selected:</strong> component${ids.length === 1 ? "" : "s"} ${ids.join(", ")}` : "No components selected yet. Use the numbered checklist beside the evidence.";
  }

  async function prepareActionConfirmation(form) {
    const message = form.querySelector("#action-form-message");
    hideMessage(message);
    try {
      if (noteDraftHasContent()) {
        const binding = state.noteDraftBindingHash || state.packetHash;
        throw new Error(`Save or clear the notebook draft bound to packet ${shortHash(binding)} before confirming a move. This keeps its text${state.noteFile ? " and unsaved screenshot" : ""} attached to the correct word.`);
      }
      const schema = legalActions().find((item) => item.type === form.dataset.actionForm);
      if (!schema) throw new Error("That move is no longer legal for this packet. Refresh the current word.");
      const action = collectAction(form, schema);
      const decisionTrace = collectDecisionTrace(form, action);
      if (action.type === "claim_select") {
        const previewMatches = state.envelopePreview && JSON.stringify(state.envelopePreview.component_ids) === JSON.stringify(action.component_ids);
        if (!previewMatches) {
          const submit = form.querySelector("#review-action-button");
          submit.disabled = true;
          submit.textContent = "Fitting and checking envelope…";
          try {
            state.envelopePreview = await requestJson(API.envelopePreview, {
              method: "POST",
              headers: mutationHeaders(),
              body: JSON.stringify({ work_packet_sha256: state.packetHash, component_ids: action.component_ids }),
            });
          } catch (error) {
            const failures = error.details?.details?.method_failures || error.details?.method_failures;
            const detail = failures ? ` ${Object.entries(failures).map(([method, reason]) => `${method}: ${reason}`).join(" · ")}` : "";
            throw new Error(`${friendlyError(error)}${detail}`);
          } finally {
            submit.disabled = false;
          }
          renderCenter();
          renderDecision();
          toast("The fitted envelope passed. Inspect the cyan boundary and metrics, then approve to erase this word.");
          return;
        }
      }
      state.pendingAction = { action, schema, decisionTrace, envelopePreviewSha256: state.envelopePreview?.preview_sha256 || null };
      const copy = ACTION_COPY[action.type] || { label: humanize(action.type) };
      const current = getCurrent();
      const revision = state.data.packet?.revision ?? state.data.status?.revision ?? "—";
      els.confirmTitle.textContent = copy.label;
      els.confirmSummary.textContent = confirmationSummary(action);
      els.confirmEffect.innerHTML = `<strong>Before</strong><br>Revision ${escapeHtml(revision)} · ${escapeHtml(current.line_id || "line")} · “${escapeHtml(current.tentative_text || current.unit_id || "word")}”<br><br><strong>After confirmation</strong><br>${escapeHtml(actionEffect(schema))}`;
      els.confirmBinding.textContent = `This move is bound to packet ${state.packetHash}. If the packet changed, software will reject it as stale.`;
      hideMessage(els.confirmMessage);
      showModal(els.confirm);
      saveActionDraftFromUI();
      emitTelemetry("confirmation_opened", { action_type: action.type });
    } catch (error) {
      showMessage(message, error.message);
      message.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  function collectDecisionTrace(form, action) {
    const data = new FormData(form);
    const summary = String(data.get("decision_summary") || "").trim();
    if (!summary) throw new Error("Add a concise visible decision summary before continuing.");
    const evidenceUsed = ["work_crop", "clean_ink_selection_crop", "ink_selection_crop"];
    if (state.activeEvidenceKey && !evidenceUsed.includes(state.activeEvidenceKey)) evidenceUsed.push(state.activeEvidenceKey);
    return {
      schema_version: "candidate-word-agent-decision.v1",
      crop_state: requiredValue(data, "crop_state"),
      difficulty: requiredValue(data, "difficulty"),
      struggle_flags: data.getAll("struggle_flags").map(String),
      evidence_used: evidenceUsed,
      decision_summary: summary,
      confidence: action.confidence || "low",
    };
  }

  function collectAction(form, schema) {
    const data = new FormData(form);
    const type = schema.type;
    if (type === "claim_select" || type === "exclude") {
      const ids = selectedIds();
      if (!ids.length) throw new Error("Select at least one numbered component first.");
      requireAllowedIds(ids, schema);
      return { type, component_ids: ids, confidence: requiredValue(data, "confidence"), reason_codes: requiredMany(data, "reason_codes", "Choose at least one reason.") };
    }
    if (type === "cut") {
      const bridge = integerValue(data, "bridge_component_id", "Choose the connected component to cut.");
      if (!allowedComponentIds(schema).includes(bridge)) throw new Error("That component is not available in this packet.");
      const points = [[integerValue(data, "p1x", "Enter the start X coordinate."), integerValue(data, "p1y", "Enter the start Y coordinate.")], [integerValue(data, "p2x", "Enter the end X coordinate."), integerValue(data, "p2y", "Enter the end Y coordinate.")]];
      if (points[0][0] === points[1][0] && points[0][1] === points[1][1]) throw new Error("Draw a line with two different endpoints on the Work crop.");
      return { type, bridge_component_id: bridge, cut: { kind: schema.cut?.kind || "line", points, width_px: integerValue(data, "width_px", "Choose a cut width."), intent: schema.cut?.intent || "sever_observed_bridge" }, confidence: requiredValue(data, "confidence"), reason_codes: requiredMany(data, "reason_codes", "Choose at least one reason.") };
    }
    if (type === "request_expanded_context") {
      const ids = selectedIds();
      const allowed = subsetValues(schema.request?.focus_component_ids);
      if (ids.some((id) => !allowed.includes(id))) throw new Error("A selected component is not available in the current packet.");
      return { type, request: { kind: requiredValue(data, "kind"), sides: requiredMany(data, "sides", "Choose at least one side to enlarge."), margin_px: integerValue(data, "margin_px", "Enter an integer margin."), focus_component_ids: ids, why: requiredValue(data, "why") }, confidence: requiredValue(data, "confidence"), reason_codes: requiredMany(data, "reason_codes", "Choose at least one reason.") };
    }
    if (type === "reopen_bbox") {
      const box = ["bbox_x", "bbox_y", "bbox_w", "bbox_h"].map((name) => integerValue(data, name, "Enter four integer box coordinates."));
      if (box[0] < 0 || box[1] < 0 || box[2] < 1 || box[3] < 1) throw new Error("The replacement box needs non-negative X/Y and positive width/height.");
      return { type, bbox_source_xywh: box, confidence: requiredValue(data, "confidence"), reason_codes: requiredMany(data, "reason_codes", "Choose at least one registration reason.") };
    }
    if (type === "defer_tier") {
      return { type, target: schema.target, reason: schema.reason };
    }
    if (type === "defer_manual") {
      return { type, disposition: requiredValue(data, "disposition"), confidence: requiredValue(data, "confidence"), reason_codes: requiredMany(data, "reason_codes", "Choose at least one reason.") };
    }
    throw new Error("This legal action does not have a human-safe form yet.");
  }

  async function submitPendingAction() {
    if (!state.pendingAction || state.submittingAction) return;
    state.submittingAction = true;
    els.confirmSubmit.disabled = true;
    els.confirmSubmit.textContent = "Saving revision…";
    hideMessage(els.confirmMessage);
    const beforeHash = state.packetHash;
    const submittedType = state.pendingAction.action.type;
    try {
      await requestJson(API.actions, {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({
          work_packet_sha256: beforeHash,
          action: state.pendingAction.action,
          decision_trace: state.pendingAction.decisionTrace,
          envelope_preview_sha256: state.pendingAction.envelopePreviewSha256,
        }),
      });
      clearStoredDraft("action", beforeHash, currentRunId());
      closeConfirm({ cancelled: false });
      state.pendingAction = null;
      emitTelemetry("action_succeeded", { action_type: submittedType });
      await refreshCurrent({ announce: false });
      toast("Move saved. The software loaded the resulting packet.");
      setMobileView("evidence", { focus: false });
      requestAnimationFrame(() => document.querySelector("#current-word-heading")?.focus());
    } catch (error) {
      emitTelemetry("action_failed", { action_type: state.pendingAction?.action?.type || state.activeActionType, status: error.status || null, stale: error.status === 409 || /stale|packet changed/i.test(error.message) });
      if (error.status === 403) {
        await refreshReviewSession();
        showMessage(els.confirmMessage, "The local review session changed. The draft is preserved and the session token was refreshed. Confirm this move again.");
      } else if (error.status === 409 || /stale|packet changed/i.test(error.message)) {
        showMessage(els.confirmMessage, "This word changed before the move was saved. Nothing was applied. Load the current software version and decide again.");
        const refreshButton = document.createElement("button");
        refreshButton.type = "button";
        refreshButton.id = "refresh-stale";
        refreshButton.className = "secondary-button stale-refresh-button";
        refreshButton.textContent = "Load current version";
        els.confirmMessage.append(document.createElement("br"), refreshButton);
      } else {
        showMessage(els.confirmMessage, friendlyError(error));
      }
    } finally {
      state.submittingAction = false;
      els.confirmSubmit.disabled = false;
      els.confirmSubmit.textContent = "Confirm this move";
    }
  }

  function closeConfirm({ cancelled = false } = {}) {
    if (cancelled && state.pendingAction) emitTelemetry("action_cancelled", { action_type: state.pendingAction.action.type });
    if (els.confirm.open) els.confirm.close();
  }

  function confirmationSummary(action) {
    const ids = action.component_ids;
    if (action.type === "claim_select") return `Assign component${ids.length === 1 ? "" : "s"} ${ids.join(", ")} to the current word.`;
    if (action.type === "exclude") return `Remove component${ids.length === 1 ? "" : "s"} ${ids.join(", ")} from this word’s current working mask.`;
    if (action.type === "cut") return `Cut component ${action.bridge_component_id} from [${action.cut.points[0].join(", ")}] to [${action.cut.points[1].join(", ")}], ${action.cut.width_px}px wide.`;
    if (action.type === "request_expanded_context") return `Add ${action.request.margin_px}px of context on ${action.request.sides.join(", ")}.`;
    if (action.type === "reopen_bbox") return `Replace the active box with [${action.bbox_source_xywh.join(", ")}].`;
    if (action.type === "defer_tier") return "Set this word aside in the queue for a later Sol pass.";
    if (action.type === "defer_manual") return `Record “${VALUE_COPY[action.disposition] || humanize(action.disposition)}” as the human-review disposition.`;
    return humanize(action.type);
  }

  function actionEffect(schema) {
    const effect = schema?.effect || "";
    const type = schema?.type;
    if (type === "claim_select") return "Append-only: assign the chosen ink, close this word, and load the next word. There is no undo.";
    if (type === "exclude") return "Remove the chosen ink from this word’s working mask, save a revision, and reload this same word.";
    if (type === "cut") return "Sever the drawn bridge, relabel the remaining ink, save a revision, and reload this same word.";
    if (type === "request_expanded_context") return "Enlarge the crop around this same word using existing source pixels. It does not enhance the source image.";
    if (type === "reopen_bbox") return "Save corrected source geometry and load a fresh unclaimed mask for this same word; the original box remains recorded.";
    if (type === "defer_tier") return "Set this word aside and advance Terra. It waits for a later Sol pass; no Sol work starts now.";
    if (type === "defer_manual") return "Close this word with a human disposition and block production until a person resolves it.";
    return effect ? humanize(effect) : "Save exactly one packet-bound revision.";
  }

  function activeEffectCopy() {
    const schema = legalActions().find((item) => item.type === state.activeActionType);
    return schema ? actionEffect(schema) : "Choose one of the legal actions supplied by software.";
  }

  function actionButtonLabel(type) {
    const count = state.selectedComponents.size;
    if (type === "claim_select") return !count ? "Select ink to continue" : state.envelopePreview ? "Approve envelope and erase this word" : `Fit envelope around ${count} selected ink piece${count === 1 ? "" : "s"}`;
    if (type === "exclude") return count ? `Review removing ${count} ink piece${count === 1 ? "" : "s"}` : "Select ink to continue";
    if (type === "cut") return cutDraftDiffers() ? "Review this bridge cut" : "Draw a cut line to continue";
    if (type === "request_expanded_context") return "Review the larger context request";
    if (type === "reopen_bbox") return bboxDraftDiffers() ? "Review the corrected word box" : "Draw or change the box first";
    if (type === "defer_tier") return "Review setting this word aside";
    if (type === "defer_manual") return "Review the human disposition";
    return "Review before saving";
  }

  function bboxDraftDiffers() {
    const baseline = getCurrent().active_target_bbox_source_xywh || getCurrent().target_bbox_source_xywh;
    return Array.isArray(state.bboxDraft) && Array.isArray(baseline) && state.bboxDraft.length === 4 && state.bboxDraft.some((value, index) => Number(value) !== Number(baseline[index]));
  }

  function cutDraftDiffers() {
    return Array.isArray(state.cutPoints) && state.cutPoints.length === 2 && (state.cutPoints[0][0] !== state.cutPoints[1][0] || state.cutPoints[0][1] !== state.cutPoints[1][1]);
  }

  function updatePrimaryActionButton() {
    const button = document.querySelector("#review-action-button");
    const form = document.querySelector("#decision-form");
    if (!button || !form) return;
    const type = form.dataset.actionForm;
    button.textContent = actionButtonLabel(type);
    button.disabled = (type === "claim_select" || type === "exclude") ? state.selectedComponents.size === 0 : type === "reopen_bbox" ? !bboxDraftDiffers() : type === "cut" ? !cutDraftDiffers() : false;
  }

  function handleDrawStart(event) {
    const selectionCanvas = event.target.closest?.(".selection-canvas[data-ink-canvas]");
    if (selectionCanvas && (event.button === undefined || event.button === 0)) {
      const point = pointForSelectionCanvas(event, selectionCanvas);
      if (!point) return;
      event.preventDefault();
      state.selectionView = selectionCanvas.dataset.inkCanvas;
      selectionCanvas.setPointerCapture?.(event.pointerId);
      state.selectionDrawing = {
        canvas: selectionCanvas,
        pointerId: event.pointerId,
        variant: selectionCanvas.dataset.inkCanvas,
        start: point,
        current: point,
        additive: Boolean(event.shiftKey),
      };
      renderSelectionCanvases();
      return;
    }
    const surface = event.target.closest?.("[data-draw-surface]");
    if (!surface || (event.button !== undefined && event.button !== 0)) return;
    const point = pointForSurface(event, surface);
    if (!point) return;
    event.preventDefault();
    surface.setPointerCapture?.(event.pointerId);
    state.drawing = { mode: surface.dataset.drawSurface, surface, pointerId: event.pointerId, start: point };
    if (state.drawing.mode === "bbox") state.bboxDraft = [point[0], point[1], 1, 1];
    else state.cutPoints = [point, point];
    syncGeometryInputs();
    updateDrawOverlay();
    updatePrimaryActionButton();
  }

  function handleDrawMove(event) {
    if (state.selectionDrawing?.pointerId === event.pointerId) {
      const point = pointForSelectionCanvas(event, state.selectionDrawing.canvas);
      if (!point) return;
      event.preventDefault();
      state.selectionDrawing.current = point;
      renderSelectionCanvases();
      return;
    }
    const drawing = state.drawing;
    if (!drawing || drawing.pointerId !== event.pointerId) return;
    const point = pointForSurface(event, drawing.surface);
    if (!point) return;
    event.preventDefault();
    if (drawing.mode === "bbox") {
      const x = Math.min(drawing.start[0], point[0]);
      const y = Math.min(drawing.start[1], point[1]);
      const right = Math.max(drawing.start[0], point[0]);
      const bottom = Math.max(drawing.start[1], point[1]);
      state.bboxDraft = [x, y, Math.max(1, right - x), Math.max(1, bottom - y)];
    } else {
      state.cutPoints = [drawing.start, point];
    }
    syncGeometryInputs();
    updateDrawOverlay();
    updatePrimaryActionButton();
  }

  function handleDrawEnd(event) {
    if (state.selectionDrawing?.pointerId === event.pointerId) {
      const drawing = state.selectionDrawing;
      const point = pointForSelectionCanvas(event, drawing.canvas) || drawing.current;
      drawing.current = point;
      drawing.canvas.releasePointerCapture?.(event.pointerId);
      state.selectionDrawing = null;
      const box = normalizedSelectionBox(drawing.start, point);
      const moved = Math.max(box[2], box[3]) >= 5;
      if (moved) applyRoughSelection(box, { additive: drawing.additive });
      else seedFromCanvas(event, drawing.canvas);
      renderSelectionCanvases();
      return;
    }
    if (!state.drawing || state.drawing.pointerId !== event.pointerId) return;
    handleDrawMove(event);
    state.drawing.surface.releasePointerCapture?.(event.pointerId);
    state.drawing = null;
    saveActionDraftFromUI();
  }

  function pointForSelectionCanvas(event, canvas) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height || !canvas.width || !canvas.height) return null;
    return [
      Math.max(0, Math.min(canvas.width - 1, Math.floor((event.clientX - rect.left) / rect.width * canvas.width))),
      Math.max(0, Math.min(canvas.height - 1, Math.floor((event.clientY - rect.top) / rect.height * canvas.height))),
    ];
  }

  function normalizedSelectionBox(start, end) {
    const x = Math.min(start[0], end[0]);
    const y = Math.min(start[1], end[1]);
    return [x, y, Math.max(1, Math.abs(end[0] - start[0]) + 1), Math.max(1, Math.abs(end[1] - start[1]) + 1)];
  }

  async function applyRoughSelection(bbox, { additive = false } = {}) {
    try {
      const result = await requestJson(API.selectionBox, {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({ work_packet_sha256: state.packetHash, bbox_xywh: bbox }),
      });
      if (!additive) state.selectedComponents.clear();
      for (const id of result.component_ids || []) state.selectedComponents.add(Number(id));
      state.envelopePreview = null;
      syncSelectionUI(true);
      saveActionDraftFromUI();
      toast(result.component_ids?.length ? `Rough box selected ${result.component_ids.length} ink piece${result.component_ids.length === 1 ? "" : "s"}. Click pieces to refine.` : "The rough box did not contain enough extracted ink. Try a slightly larger box.");
    } catch (error) {
      toast(friendlyError(error), "error");
    }
  }

  function pointForSurface(event, surface) {
    const image = surface.querySelector("img");
    if (!image) return null;
    const rect = image.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const ratioX = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const ratioY = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    if (surface.dataset.drawSurface === "bbox") {
      const context = getCurrent().context_bbox_source_xywh;
      if (!Array.isArray(context) || context.length !== 4) return null;
      return [Math.round(context[0] + ratioX * context[2]), Math.round(context[1] + ratioY * context[3])];
    }
    const size = state.data.packet?.ownership_task?.work_size_wh || getCurrent().work_bbox_source_xywh?.slice(2) || [image.naturalWidth, image.naturalHeight];
    return [Math.round(ratioX * Math.max(0, size[0] - 1)), Math.round(ratioY * Math.max(0, size[1] - 1))];
  }

  function updateDrawOverlay() {
    const surface = document.querySelector("[data-draw-surface]");
    if (!surface) return;
    const svg = surface.querySelector("svg");
    if (!svg) return;
    const image = surface.querySelector("img");
    const size = [image?.naturalWidth || image?.width || 1, image?.naturalHeight || image?.height || 1];
    svg.setAttribute("viewBox", `0 0 ${size[0]} ${size[1]}`);
    const rectEl = svg.querySelector("[data-draw-rect]");
    const lineEl = svg.querySelector("[data-draw-line]");
    const startEl = svg.querySelector("[data-draw-start]");
    const endEl = svg.querySelector("[data-draw-end]");
    [rectEl, lineEl, startEl, endEl].forEach((element) => element?.setAttribute("hidden", ""));
    if (surface.dataset.drawSurface === "bbox" && state.bboxDraft) {
      const context = getCurrent().context_bbox_source_xywh;
      if (!Array.isArray(context)) return;
      const scaleX = size[0] / context[2];
      const scaleY = size[1] / context[3];
      rectEl.removeAttribute("hidden");
      rectEl.setAttribute("x", String((state.bboxDraft[0] - context[0]) * scaleX));
      rectEl.setAttribute("y", String((state.bboxDraft[1] - context[1]) * scaleY));
      rectEl.setAttribute("width", String(state.bboxDraft[2] * scaleX));
      rectEl.setAttribute("height", String(state.bboxDraft[3] * scaleY));
    } else if (surface.dataset.drawSurface === "cut" && state.cutPoints) {
      const work = state.data.packet?.ownership_task?.work_size_wh || getCurrent().work_bbox_source_xywh?.slice(2) || size;
      const scaleX = size[0] / work[0];
      const scaleY = size[1] / work[1];
      const [a, b] = state.cutPoints;
      lineEl.removeAttribute("hidden"); startEl.removeAttribute("hidden"); endEl.removeAttribute("hidden");
      lineEl.setAttribute("x1", String(a[0] * scaleX)); lineEl.setAttribute("y1", String(a[1] * scaleY)); lineEl.setAttribute("x2", String(b[0] * scaleX)); lineEl.setAttribute("y2", String(b[1] * scaleY));
      startEl.setAttribute("cx", String(a[0] * scaleX)); startEl.setAttribute("cy", String(a[1] * scaleY)); startEl.setAttribute("r", String(Math.max(4, size[0] * 0.008)));
      endEl.setAttribute("cx", String(b[0] * scaleX)); endEl.setAttribute("cy", String(b[1] * scaleY)); endEl.setAttribute("r", String(Math.max(4, size[0] * 0.008)));
    }
  }

  function syncGeometryInputs() {
    const form = document.querySelector("#decision-form");
    if (!form) return;
    if (form.dataset.actionForm === "reopen_bbox" && state.bboxDraft) {
      ["bbox_x", "bbox_y", "bbox_w", "bbox_h"].forEach((name, index) => { if (form.elements[name]) form.elements[name].value = state.bboxDraft[index]; });
    }
    if (form.dataset.actionForm === "cut" && state.cutPoints) {
      const values = [...state.cutPoints[0], ...state.cutPoints[1]];
      ["p1x", "p1y", "p2x", "p2y"].forEach((name, index) => { if (form.elements[name]) form.elements[name].value = values[index]; });
    }
  }

  async function saveNote(event) {
    event.preventDefault();
    hideMessage(els.noteMessage);
    const bindingHash = state.noteDraftBindingHash || state.packetHash;
    const bindingRunId = state.noteDraftBindingRunId || currentRunId();
    if (!bindingHash) {
      showMessage(els.noteMessage, "There is no review packet to bind this note to.");
      return;
    }
    const values = new FormData(els.noteForm);
    const text = String(values.get("text") || "").trim();
    if (!text) {
      showMessage(els.noteMessage, "Write what happened or what the workflow needs.");
      els.noteText.focus();
      return;
    }
    const formData = new FormData();
    formData.set("text", text);
    formData.set("category", String(values.get("category")));
    formData.set("severity", String(values.get("severity")));
    formData.set("work_packet_sha256", bindingHash);
    const evidenceRefValue = String(values.get("evidence_ref") || "");
    const hadScreenshot = Boolean(state.noteFile);
    if (evidenceRefValue) formData.set("evidence_ref", evidenceRefValue);
    if (state.noteFile) formData.set("screenshot", state.noteFile, state.noteFile.name);
    const saveButton = document.querySelector("#save-note");
    saveButton.disabled = true;
    saveButton.textContent = "Saving note…";
    try {
      await requestJson(API.notes, { method: "POST", headers: mutationHeaders(), body: formData });
      clearStoredDraft("note", bindingHash, bindingRunId);
      els.noteForm.reset();
      els.noteCharacterCount.textContent = "0";
      setNoteFile(null);
      state.noteDraftBindingHash = state.packetHash;
      state.noteDraftBindingRunId = currentRunId();
      state.noteEvidenceTouched = false;
      if (state.historicalDraftNotice?.noteHash === bindingHash) {
        state.historicalDraftNotice.noteHash = null;
        state.historicalDraftNotice.noteRunId = null;
        state.historicalDraftNotice.screenshotPreserved = false;
        if (!arrayValue(state.historicalDraftNotice.actionDrafts).length) state.historicalDraftNotice = null;
      }
      await refreshNotesOnly();
      emitTelemetry("note_saved", { category: String(values.get("category")), severity: String(values.get("severity")), has_screenshot: hadScreenshot, has_evidence_ref: Boolean(evidenceRefValue), bound_packet_sha256: bindingHash });
      toast(bindingHash === state.packetHash ? "Note saved. The current word did not move." : "Earlier-packet note saved. The current word did not move.");
      els.noteText.focus();
    } catch (error) {
      if (error.status === 403) await refreshReviewSession();
      showMessage(els.noteMessage, friendlyError(error));
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = "Save note without moving on";
    }
  }

  async function refreshNotesOnly() {
    const data = await requestJson(API.notes);
    const notes = Array.isArray(data) ? data : Array.isArray(data?.notes) ? data.notes : Array.isArray(data?.items) ? data.items : [];
    state.data.notes = notes;
    renderNotes();
  }

  function handlePaste(event) {
    if (state.controlTab !== "notes" && state.mobileView !== "notes") return;
    const file = [...(event.clipboardData?.files || [])].find((item) => item.type.startsWith("image/"));
    if (!file) return;
    event.preventDefault();
    setNoteFile(file);
    toast("Pasted screenshot is ready to attach.");
  }

  function setNoteFile(file) {
    hideMessage(els.noteMessage);
    const hadHistoricalDraft = Boolean(state.historicalDraftNotice);
    if (file) {
      const rules = uploadRules();
      if (!rules.types.includes(file.type)) {
        showMessage(els.noteMessage, `Use ${rules.types.map((type) => type.replace("image/", "")).join(", ")} images.`);
        return;
      }
      if (file.size > rules.maxBytes) {
        showMessage(els.noteMessage, `That image is ${formatBytes(file.size)}. The limit is ${formatBytes(rules.maxBytes)}.`);
        return;
      }
      if (state.noteFile && state.noteFile !== file && !window.confirm("Replace the unsaved screenshot? The currently attached file cannot be recovered after replacement.")) {
        els.screenshotInput.value = "";
        return;
      }
    }
    if (state.notePreviewUrl) URL.revokeObjectURL(state.notePreviewUrl);
    state.notePreviewUrl = null;
    state.noteFile = null;
    els.screenshotInput.value = "";
    if (!file) {
      els.screenshotPreview.hidden = true;
      els.screenshotPreview.querySelector("img").removeAttribute("src");
      if (state.historicalDraftNotice?.noteHash) {
        state.historicalDraftNotice.screenshotPreserved = false;
        if (!String(els.noteText?.value || "").trim()) {
          clearStoredDraft("note", state.historicalDraftNotice.noteHash, state.historicalDraftNotice.noteRunId);
          state.historicalDraftNotice.noteHash = null;
          state.historicalDraftNotice.noteRunId = null;
          state.noteDraftBindingHash = state.packetHash;
          state.noteDraftBindingRunId = currentRunId();
          if (!arrayValue(state.historicalDraftNotice.actionDrafts).length) state.historicalDraftNotice = null;
        }
      }
      renderHistoricalDraftNotice();
      if (hadHistoricalDraft || state.historicalDraftNotice) renderCenter();
      return;
    }
    if (!state.noteDraftBindingHash) state.noteDraftBindingHash = state.packetHash;
    if (!state.noteDraftBindingRunId) state.noteDraftBindingRunId = currentRunId();
    state.noteFile = file;
    state.notePreviewUrl = URL.createObjectURL(file);
    els.screenshotPreview.querySelector("img").src = state.notePreviewUrl;
    els.screenshotName.textContent = file.name || "Pasted screenshot";
    els.screenshotSize.textContent = formatBytes(file.size);
    els.screenshotPreview.hidden = false;
    if (state.historicalDraftNotice?.noteHash === state.noteDraftBindingHash) state.historicalDraftNotice.screenshotPreserved = true;
    saveNoteDraftFromUI();
    renderHistoricalDraftNotice();
    if (hadHistoricalDraft || state.historicalDraftNotice) renderCenter();
  }

  function switchControl(tab) {
    state.controlTab = tab;
    const isDecision = tab === "decision";
    const isNotes = tab === "notes";
    const isAgent = tab === "agent";
    els.decisionTab.setAttribute("aria-selected", String(isDecision));
    els.notesTab.setAttribute("aria-selected", String(isNotes));
    els.agentTab.setAttribute("aria-selected", String(isAgent));
    els.decision.hidden = !isDecision;
    els.notes.hidden = !isNotes;
    els.agent.hidden = !isAgent;
    if (isNotes) {
      const isHistorical = Boolean(state.noteDraftBindingHash && state.noteDraftBindingHash !== state.packetHash);
      if (!state.noteEvidenceTouched && !isHistorical) defaultNoteEvidenceToActive();
      emitTelemetry("note_opened", { source: "control" });
    }
    if (window.matchMedia("(max-width: 860px)").matches) setMobileView(tab);
    if (isNotes) requestAnimationFrame(() => els.noteText.focus());
    if (isAgent) renderAgentView();
  }

  function setMobileView(view, { focus = true } = {}) {
    if (!["progress", "evidence", "decision", "notes", "agent"].includes(view)) view = "evidence";
    state.mobileView = view;
    els.app.dataset.mobileView = view;
    document.querySelectorAll("[data-mobile-target]").forEach((button) => {
      if (button.dataset.mobileTarget === view) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    if (view === "decision" && state.controlTab !== "decision") switchControl("decision");
    if (view === "notes" && state.controlTab !== "notes") switchControl("notes");
    if (view === "agent" && state.controlTab !== "agent") switchControl("agent");
    if (focus && window.matchMedia("(max-width: 860px)").matches) window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openGuide() { showModal(els.guide); }

  function offerGuideOnce() {
    if (state.guideOffered) return;
    state.guideOffered = true;
    let seen = false;
    try { seen = localStorage.getItem("letterArchiveReviewGuideSeen") === "true"; } catch (_) { /* optional */ }
    if (!seen) setTimeout(openGuide, 250);
  }

  function showModal(dialog) {
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  function legalActions() {
    const value = state.data.packet?.legal_actions || state.data.packet?.ownership_task?.legal_actions || [];
    return Array.isArray(value) ? value.filter((item) => item && typeof item.type === "string") : [];
  }

  function getCurrent() {
    return state.data.packet?.current || state.data.packet?.ownership_task?.unit || state.data.status?.current || {};
  }

  function evidenceEntries() {
    const evidence = state.data.packet?.evidence || state.data.packet?.ownership_task?.evidence || {};
    const order = Object.keys(EVIDENCE_COPY);
    return Object.entries(evidence)
      .filter(([key, value]) => key !== "component_label_map" && value && typeof value === "object")
      .sort(([a], [b]) => {
        const ai = order.indexOf(a); const bi = order.indexOf(b);
        return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi) || a.localeCompare(b);
      });
  }

  function componentEntries() {
    const values = state.data.packet?.current_unclaimed?.components || state.data.packet?.ownership_task?.components || [];
    return Array.isArray(values) ? values.filter((item) => Number.isInteger(Number(item?.id))).sort((a, b) => Number(a.id) - Number(b.id)) : [];
  }

  function chooseDefaultAction(packet) {
    if (!packet) return null;
    const values = packet.legal_actions || packet.ownership_task?.legal_actions || [];
    for (const preferred of ["claim_select", "exclude", "request_expanded_context", "reopen_bbox", "defer_tier", "defer_manual", "cut"]) {
      if (values.some((item) => item.type === preferred)) return preferred;
    }
    return values[0]?.type || null;
  }

  function chooseDefaultEvidence(packet) {
    if (!packet) return null;
    const evidence = packet.evidence || packet.ownership_task?.evidence || {};
    for (const preferred of ["decision_collage", "ink_selection_crop", "residual_page", "numbered_components", "upright_numbered_components", "source_context", "work_crop"]) {
      if (evidence[preferred]) return preferred;
    }
    return Object.keys(evidence)[0] || null;
  }

  function selectedIds() { return [...state.selectedComponents].sort((a, b) => a - b); }

  function allowedComponentIds(schema) {
    return subsetValues(schema?.component_ids || schema?.bridge_component_id || schema?.request?.focus_component_ids);
  }

  function requireAllowedIds(ids, schema) {
    const allowed = allowedComponentIds(schema);
    if (ids.some((id) => !allowed.includes(id))) throw new Error("A selected component is no longer legal in this packet.");
  }

  function subsetValues(value) {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== "object") return [];
    return value.nonempty_subset_of || value.subset_of || value.one_of || [];
  }

  function arrayValue(value) { return Array.isArray(value) ? value : []; }

  function requiredValue(data, name) {
    const value = String(data.get(name) || "");
    if (!value) throw new Error(`Choose ${humanize(name)}.`);
    return value;
  }

  function requiredMany(data, name, message) {
    const values = data.getAll(name).map(String).filter(Boolean);
    if (!values.length) throw new Error(message);
    return values;
  }

  function integerValue(data, name, message) {
    const raw = String(data.get(name) ?? "");
    const value = Number(raw);
    if (!raw || !Number.isInteger(value)) throw new Error(message);
    return value;
  }

  function ownershipEndState() {
    const status = state.data.status || {};
    const machine = String(status.machine_status || "");
    const production = String(status.production_status || "");
    if (machine === "awaiting_tier_requeue") {
      return {
        header: "Terra queue finished · Sol pass waiting",
        title: "Start the Sol pass explicitly",
        copy: "Terra has reached the end of its queue, but words set aside for Sol are still waiting. Sol does not start automatically; use the run controls to create the Sol requeue, then refresh here.",
        now: "The Terra queue has no current word. Deferred words are waiting for an explicit Sol requeue.",
        next: "Start the Sol pass from the run controls. It will not begin automatically.",
        button: "Check for a started Sol pass",
        icon: "→",
        activeStep: 2,
      };
    }
    if (machine === "complete" && production === "blocked_manual_review") {
      return {
        header: "Ownership complete · human blockers remain",
        title: "Resolve the human-review blockers",
        copy: "Machine ownership has finished, but one or more words have unresolved human dispositions. This page is not ready for the residual-ink audit until those blockers are resolved.",
        now: "Machine ownership is complete with unresolved human-review items.",
        next: "Resolve every manual ownership blocker before starting the residual-ink audit.",
        button: "Refresh blocker status",
        icon: "!",
        activeStep: 2,
      };
    }
    if (machine === "complete" && production === "blocked_follow_up_review") {
      return {
        header: "Ownership complete · follow-up blockers remain",
        title: "Resolve the follow-up review blockers",
        copy: "Machine ownership has finished, but tier-escalation or imported-route blockers remain. This page is not ready for the residual-ink audit until those follow-up items are resolved.",
        now: "Machine ownership is complete with unresolved follow-up review items.",
        next: "Resolve every follow-up ownership blocker before starting the residual-ink audit.",
        button: "Refresh blocker status",
        icon: "!",
        activeStep: 2,
      };
    }
    if (machine === "complete" && production === "ready_for_bound_residual_audit") {
      return {
        header: "Ownership complete · residual audit ready",
        title: "Ownership is ready for the residual-ink audit",
        copy: "Every ownership unit has a terminal result and no manual ownership blocker remains. The next explicit stage is the bound exact residual-ink audit.",
        now: "The ownership queue is complete and production is clear of manual ownership blockers.",
        next: "Start the bound exact residual-ink audit from the run controls.",
        button: "Refresh stage status",
        icon: "✓",
        activeStep: 3,
      };
    }
    if (machine === "complete") {
      return {
        header: "Ownership queue complete",
        title: "The ownership queue is complete",
        copy: `Software reported production status “${production || "unspecified"}.” Check that status before starting another pipeline stage.`,
        now: "The ownership queue has no current word.",
        next: "Confirm the production gate before beginning another stage.",
        button: "Refresh production status",
        icon: "✓",
        activeStep: 2,
      };
    }
    return {
      header: "No current word is available",
      title: "There is no current word",
      copy: "The configured run may be empty, paused, or waiting for a software-controlled queue transition.",
      now: "No packet is currently available for a human decision.",
      next: "Check the run status or start the required queue transition.",
      button: "Refresh current state",
      icon: "—",
      activeStep: 2,
    };
  }

  function evidenceLabel(key) { return EVIDENCE_COPY[key]?.[0] || humanize(key); }

  function evidenceRef(item, key) { return String(item?.ref || item?.path || key); }

  function evidenceUrl(item, key) {
    const supplied = item?.url || item?.href || item?.src;
    if (supplied) return safeUrl(String(supplied));
    const ref = evidenceRef(item, key);
    return `${API.evidence}?ref=${encodeURIComponent(ref)}`;
  }

  function noteScreenshotUrl(note) {
    const supplied = note.screenshot_url || note.screenshot?.url || note.attachment?.url;
    if (supplied) return safeUrl(String(supplied));
    const ref = note.screenshot_ref || note.screenshot?.ref || note.attachment?.ref;
    return ref ? `${API.evidence}?ref=${encodeURIComponent(ref)}` : "";
  }

  function safeUrl(value) {
    try {
      const url = new URL(value, window.location.href);
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch (_) { return ""; }
  }

  function uploadRules() {
    const value = state.data.upload_constraints || {};
    const types = value.allowed_mime_types || value.accepted_media_types || value.mime_types || value.accepted_types || ["image/png", "image/jpeg", "image/webp"];
    const maxBytes = Number(value.max_bytes || value.max_file_bytes || 8 * 1024 * 1024);
    return { types: Array.isArray(types) ? types : ["image/png", "image/jpeg", "image/webp"], maxBytes: Number.isFinite(maxBytes) ? maxBytes : 8 * 1024 * 1024 };
  }

  function captureActionFormValues() {
    const form = document.querySelector("#decision-form");
    if (!form?.dataset.actionForm) return;
    const values = {};
    const seenCheckboxes = new Set();
    [...form.elements].forEach((element) => {
      if (!element.name || element.disabled || ["submit", "button"].includes(element.type)) return;
      if (element.type === "checkbox") {
        if (seenCheckboxes.has(element.name)) return;
        seenCheckboxes.add(element.name);
        values[element.name] = [...form.querySelectorAll(`input[type="checkbox"][name="${CSS.escape(element.name)}"]:checked`)].map((item) => item.value);
      } else {
        values[element.name] = element.value;
      }
    });
    state.actionForms[form.dataset.actionForm] = values;
  }

  function restoreActionFormValues(type) {
    const form = document.querySelector("#decision-form");
    const values = state.actionForms?.[type];
    if (!form || !values || typeof values !== "object") return;
    [...form.elements].forEach((element) => {
      if (!element.name || !Object.prototype.hasOwnProperty.call(values, element.name)) return;
      if (element.type === "checkbox") {
        element.checked = Array.isArray(values[element.name]) && values[element.name].includes(element.value);
      } else if ([...element.options || []].length) {
        if ([...element.options].some((option) => option.value === String(values[element.name]))) element.value = String(values[element.name]);
      } else {
        element.value = String(values[element.name]);
      }
    });
  }

  function saveActionDraftFromUI() {
    if (!state.packetHash) return;
    captureActionFormValues();
    const value = {
      selected_components: selectedIds(),
      active_action_type: state.activeActionType,
      forms: state.actionForms,
      bbox_draft: state.bboxDraft,
      cut_points: state.cutPoints,
    };
    writeStoredDraft("action", state.packetHash, currentRunId(), value);
  }

  function restoreActionDraft(hash) {
    if (!hash) return;
    const value = readStoredDraft("action", hash, currentRunId());
    if (!value || typeof value !== "object") return;
    const availableIds = new Set(componentEntries().map((item) => Number(item.id)));
    state.selectedComponents = new Set((value.selected_components || []).map(Number).filter((id) => availableIds.has(id)));
    if (legalActions().some((item) => item.type === value.active_action_type)) state.activeActionType = value.active_action_type;
    state.actionForms = value.forms && typeof value.forms === "object" ? value.forms : {};
    if (Array.isArray(value.bbox_draft) && value.bbox_draft.length === 4 && value.bbox_draft.every(Number.isFinite)) state.bboxDraft = value.bbox_draft;
    if (Array.isArray(value.cut_points) && value.cut_points.length === 2) state.cutPoints = value.cut_points;
  }

  function saveNoteDraftFromUI(hash = state.noteDraftBindingHash || state.packetHash, runId = state.noteDraftBindingRunId || currentRunId()) {
    if (!hash || !els.noteForm) return;
    const values = new FormData(els.noteForm);
    writeStoredDraft("note", hash, runId, {
      text: String(values.get("text") || ""),
      category: String(values.get("category") || "confusing_step"),
      severity: String(values.get("severity") || "medium"),
      evidence_ref: String(values.get("evidence_ref") || ""),
      evidence_explicit: state.noteEvidenceTouched,
    });
  }

  function restoreNoteDraftIfNeeded() {
    if (!state.noteDraftNeedsRestore || !els.noteForm) return;
    state.noteDraftNeedsRestore = false;
    state.noteDraftBindingHash = state.noteDraftBindingHash || state.packetHash;
    state.noteDraftBindingRunId = state.noteDraftBindingRunId || currentRunId();
    els.noteForm.reset();
    els.noteCharacterCount.textContent = "0";
    const value = readStoredDraft("note", state.noteDraftBindingHash, state.noteDraftBindingRunId);
    if (!value || typeof value !== "object") {
      state.noteEvidenceTouched = false;
      defaultNoteEvidenceToActive();
      return;
    }
    state.noteEvidenceTouched = Boolean(value.evidence_explicit);
    for (const name of ["text", "category", "severity", "evidence_ref"]) {
      const element = els.noteForm.elements[name];
      if (!element || value[name] === undefined) continue;
      if (element instanceof HTMLSelectElement && ![...element.options].some((option) => option.value === String(value[name]))) continue;
      element.value = String(value[name]);
    }
    els.noteCharacterCount.textContent = String(els.noteText.value.length);
    if (!state.noteEvidenceTouched) defaultNoteEvidenceToActive();
  }

  function defaultNoteEvidenceToActive() {
    if (state.noteDraftBindingHash && state.noteDraftBindingHash !== state.packetHash) return;
    const entry = evidenceEntries().find(([key]) => key === state.activeEvidenceKey) || evidenceEntries()[0];
    if (!entry || !els.noteEvidence) return;
    const ref = evidenceRef(entry[1], entry[0]);
    if ([...els.noteEvidence.options].some((option) => option.value === ref)) els.noteEvidence.value = ref;
  }

  function noteDraftHasContent() {
    return Boolean(String(els.noteText?.value || "").trim() || state.noteFile);
  }

  function currentRunId() {
    return String(state.data.status?.run_id || state.data.packet?.run_id || state.data.run?.run_id || state.data.run?.id || "unknown-run");
  }

  function storageKey(kind, hash, runId) {
    return `letter-archive-review:${kind}:${runId || "unknown-run"}:${hash || "no-packet"}`;
  }

  function writeStoredDraft(kind, hash, runId, value) {
    try { localStorage.setItem(storageKey(kind, hash, runId), JSON.stringify(value)); } catch (_) { /* draft persistence is best effort */ }
  }

  function readStoredDraft(kind, hash, runId) {
    if (!hash) return null;
    try {
      const raw = localStorage.getItem(storageKey(kind, hash, runId));
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  function clearStoredDraft(kind, hash, runId) {
    if (!hash) return;
    try { localStorage.removeItem(storageKey(kind, hash, runId)); } catch (_) { /* optional storage */ }
  }

  function emitTelemetry(eventName, details = {}) {
    if (!eventName) return;
    const payload = {
      event_type: eventName,
      work_packet_sha256: state.packetHash,
      ui_version: UI_VERSION,
      client_elapsed_ms: Math.max(0, Math.round(performance.now() - state.packetOpenedAt)),
      details,
    };
    try {
      void fetch(API.telemetry, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", ...mutationHeaders() },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {});
    } catch (_) { /* telemetry must never affect review */ }
  }

  function mutationHeaders() {
    return state.data.csrf_token ? { "X-Review-CSRF-Token": state.data.csrf_token } : {};
  }

  async function refreshReviewSession() {
    const beforeHash = state.packetHash;
    try {
      const data = await requestJson(API.bootstrap);
      applyServerData(data);
      render();
      const samePacket = beforeHash === state.packetHash;
      if (!samePacket) {
        state.pendingAction = null;
        closeConfirm({ cancelled: false });
        toast("The local run changed while the session refreshed. Drafts were preserved under their original packet.", "error");
      }
      return samePacket;
    } catch (_) {
      return false;
    }
  }

  function stateCard(title, copy, buttonLabel, buttonId, error = false, icon = "↻") {
    return `<section class="state-card ${error ? "state-card--error" : ""}"><span class="state-icon" aria-hidden="true">${icon}</span><p class="eyebrow">${error ? "Review unavailable" : "Pipeline status"}</p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(copy)}</p><button class="primary-button" type="button" id="${escapeAttr(buttonId)}">${escapeHtml(buttonLabel)}</button></section>`;
  }

  function optionHtml(value) { return `<option value="${escapeAttr(value)}">${escapeHtml(VALUE_COPY[value] || humanize(value))}</option>`; }
  function humanize(value) { return String(value || "").replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
  function shortHash(value) { return value ? `${String(value).slice(0, 10)}…${String(value).slice(-6)}` : "none"; }
  function numberOr(...values) { for (const value of values) if (Number.isFinite(Number(value))) return Number(value); return 0; }
  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
  function sizeLabel(value) { return Array.isArray(value) && value.length === 2 ? `${value[0]} × ${value[1]} px` : ""; }
  function formatBytes(bytes) { if (!Number.isFinite(Number(bytes))) return "unknown size"; if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / 1024 ** 2).toFixed(1)} MB`; }
  function formatPercent(value) { return Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(2)}%` : "—"; }
  function dateValue(note) { const raw = note.created_at || note.timestamp || note.saved_at; const value = Date.parse(raw || ""); return Number.isFinite(value) ? value : 0; }
  function formatDate(value) { if (!value) return "Saved note"; const date = new Date(value); return Number.isNaN(date.valueOf()) ? "Saved note" : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date); }
  function friendlyError(error) { return error?.message || "The review console could not reach its local server."; }

  function showMessage(element, message) { if (!element) return; element.textContent = message; element.hidden = false; }
  function hideMessage(element) { if (!element) return; element.textContent = ""; element.hidden = true; }

  function toast(message, type = "success") {
    const element = document.createElement("div");
    element.className = `toast ${type === "error" ? "toast--error" : ""}`;
    element.textContent = message;
    els.toastRegion.append(element);
    setTimeout(() => element.remove(), 4200);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
  }
  function escapeAttr(value) { return escapeHtml(value); }
})();
