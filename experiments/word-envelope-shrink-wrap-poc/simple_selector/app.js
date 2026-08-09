"use strict";

const el = (id) => document.getElementById(id);
const state = {
  boot: null,
  csrf: null,
  rectangles: [],
  deselectRectangles: [],
  selectionHistory: [],
  noteCrop: null,
  noteItems: [],
  boxes: false,
  zoom: 1,
  images: {},
  drag: null,
  busy: false,
  commitBusy: false,
  previewBusy: false,
  selectionReceipt: null,
  selectionRequest: 0,
  selectionPromise: null,
  tool: "select",
  cutPoints: [],
  cutPreview: null,
  cutWidthPx: 9,
  inkVariant: "clean",
  recovery: null,
  library: null,
};

function sourceOnlyMode() {
  return state.boot?.manifest?.protocol?.selection_mode === "source_color_guided";
}

function dualInkMode() {
  return state.boot?.manifest?.protocol?.selection_mode === "dual_extracted_ink";
}

function tintOverlay(sourceImage, rgb) {
  const [width, height] = state.boot.manifest.preview_size_wh;
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d", {willReadFrequently: true});
  context.drawImage(sourceImage, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    if (pixels.data[index + 3]) {
      pixels.data[index] = rgb[0];
      pixels.data[index + 1] = rgb[1];
      pixels.data[index + 2] = rgb[2];
      pixels.data[index + 3] = 220;
    }
  }
  context.putImageData(pixels, 0, 0);
  return canvas;
}

async function api(path, body) {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : {"Content-Type": "application/json", "X-Selector-CSRF-Token": state.csrf},
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    const error = new Error(payload?.error?.message || "The selector action failed.");
    error.code = payload?.error?.code || "selector_failed";
    error.status = response.status;
    error.details = payload?.error?.details || null;
    throw error;
  }
  return payload.data;
}

function image(url) {
  return new Promise((resolve, reject) => {
    const value = new Image();
    value.onload = () => resolve(value);
    value.onerror = reject;
    value.src = url.startsWith("data:") ? url : `${url}${url.includes("?") ? "&" : "?"}v=${Date.now()}`;
  });
}

function showToast(message) {
  el("toast").textContent = message;
  el("toast").hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { el("toast").hidden = true; }, 3600);
}

function resetClientWorkspace() {
  state.rectangles = [];
  state.deselectRectangles = [];
  state.selectionHistory = [];
  state.noteCrop = null;
  state.noteItems = [];
  state.images = {};
  state.drag = null;
  state.commitBusy = false;
  state.previewBusy = false;
  state.selectionReceipt = null;
  state.selectionRequest += 1;
  state.selectionPromise = null;
  state.tool = "select";
  state.cutPoints = [];
  state.cutPreview = null;
  state.inkVariant = "clean";
  state.recovery = null;
  state.boxes = false;
  el("toggle-boxes").textContent = "Boxes off";
  el("toggle-boxes").setAttribute("aria-pressed", "false");
  el("tool-cut").textContent = "Cut ink";
  el("tool-cut").classList.remove("active");
  el("tool-cut").setAttribute("aria-pressed", "false");
  el("page-summary").value = "";
  el("crop-text").value = "";
  el("crop-notes").replaceChildren();
  el("notes-panel").hidden = true;
}

function showWorkspace() {
  el("library-view").hidden = true;
  el("workspace-view").hidden = false;
  document.body.classList.remove("library-open");
  applyZoom();
}

function librarySearchText(item) {
  const identity = item.identity;
  return [
    item.catalog_item_id,
    identity.collection_code,
    identity.date_raw,
    identity.original_filename,
    `page-${identity.page_number}`,
    ...item.challenge_tags,
  ].join(" ").toLowerCase();
}

function renderLibrary() {
  if (!state.library) return;
  const query = el("library-search").value.trim().toLowerCase()
    .replace(/\bpage\s+(\d+)\b/g, "page-$1");
  const terms = query.split(/\s+/).filter(Boolean);
  const visible = state.library.items.filter((item) => {
    const searchable = librarySearchText(item);
    return terms.every((term) => searchable.includes(term));
  });
  el("library-count").textContent = `${visible.length} page${visible.length === 1 ? "" : "s"}`;
  const cards = visible.map((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `library-card${item.saved_progress?.is_active ? " active" : ""}`;
    const preview = document.createElement("img");
    preview.src = item.thumbnail_url;
    preview.alt = `Collection ${item.identity.collection_code}, page ${item.identity.page_number}`;
    preview.loading = "lazy";
    const copy = document.createElement("span");
    copy.className = "library-card-copy";
    const title = document.createElement("strong");
    title.className = "library-card-title";
    title.textContent = `Collection ${item.identity.collection_code} · page ${item.identity.page_number}`;
    const meta = document.createElement("span");
    meta.className = "library-card-meta";
    meta.textContent = `${item.identity.date_raw} · ${item.dimensions.width} × ${item.dimensions.height}`;
    const progress = document.createElement("span");
    progress.className = `library-card-progress${item.saved_progress ? "" : " new"}`;
    const progressText = item.saved_progress
      ? item.saved_progress.status === "complete"
        ? `Complete · ${item.saved_progress.word_count} words`
        : `Resume · ${item.saved_progress.word_count} words saved`
      : "Start this page";
    progress.textContent = item.saved_progress?.is_active ? `Current · ${progressText}` : progressText;
    copy.append(title, meta, progress);
    button.append(preview, copy);
    button.addEventListener("click", () => openLibraryItem(item));
    return button;
  });
  if (!cards.length) {
    const empty = document.createElement("p");
    empty.className = "library-empty";
    empty.textContent = "No pages match that search.";
    cards.push(empty);
  }
  el("library-grid").replaceChildren(...cards);
}

async function showLibrary() {
  if (state.busy || state.commitBusy) return;
  el("workspace-view").hidden = true;
  el("library-view").hidden = false;
  document.body.classList.add("library-open");
  el("library-search").value = "";
  el("library-grid").innerHTML = '<p class="library-empty">Loading your saved pages…</p>';
  try {
    state.library = await api("/api/library");
    renderLibrary();
    el("library-search").focus();
  } catch (error) {
    showToast(error.message);
  }
}

async function openLibraryItem(item) {
  if (state.busy) return;
  state.busy = true;
  for (const card of document.querySelectorAll(".library-card")) card.disabled = true;
  showToast(item.saved_progress ? "Opening your saved page…" : "Preparing clean and high-recall ink…");
  try {
    const result = await api("/api/open-library-item", {
      catalog_item_id: item.catalog_item_id,
      catalog_revision: state.library.catalog_revision,
    });
    resetClientWorkspace();
    await loadBootstrap(result.bootstrap);
    showWorkspace();
    showToast(result.resumed ? "Saved page resumed." : "New page ready · select one word, then press Enter.");
  } catch (error) {
    showToast(error.message);
    renderLibrary();
  } finally {
    state.busy = false;
    updateSelectionCopy();
  }
}

async function resetPage() {
  if (state.busy || state.commitBusy) return;
  const words = state.boot?.state?.word_count || 0;
  if (!confirm(`Reset this page to zero words? Your current ${words}-word run will remain saved separately.`)) return;
  state.busy = true;
  updateSelectionCopy();
  try {
    const result = await api("/api/reset-page", {
      base_state_sha256: state.boot.state.state_sha256,
    });
    resetClientWorkspace();
    await loadBootstrap(result.bootstrap);
    showToast("Page reset. The earlier run is still preserved on disk.");
  } catch (error) {
    showToast(error.message);
  } finally {
    state.busy = false;
    updateSelectionCopy();
  }
}

function sourceRectFromPointer(canvas, start, end) {
  const box = canvas.getBoundingClientRect();
  const [sourceWidth, sourceHeight] = state.boot.manifest.source_size_wh;
  const x1 = Math.max(0, Math.min(box.width, Math.min(start.x, end.x) - box.left));
  const y1 = Math.max(0, Math.min(box.height, Math.min(start.y, end.y) - box.top));
  const x2 = Math.max(0, Math.min(box.width, Math.max(start.x, end.x) - box.left));
  const y2 = Math.max(0, Math.min(box.height, Math.max(start.y, end.y) - box.top));
  const x = Math.floor(x1 / box.width * sourceWidth);
  const y = Math.floor(y1 / box.height * sourceHeight);
  const right = Math.ceil(x2 / box.width * sourceWidth);
  const bottom = Math.ceil(y2 / box.height * sourceHeight);
  return [x, y, Math.max(1, right - x), Math.max(1, bottom - y)];
}

function sourcePointFromPointer(canvas, point) {
  const box = canvas.getBoundingClientRect();
  const [sourceWidth, sourceHeight] = state.boot.manifest.source_size_wh;
  return [
    Math.max(0, Math.min(sourceWidth - 1, Math.round((point.x - box.left) / box.width * sourceWidth))),
    Math.max(0, Math.min(sourceHeight - 1, Math.round((point.y - box.top) / box.height * sourceHeight))),
  ];
}

function previewRect(rect) {
  const [sourceWidth, sourceHeight] = state.boot.manifest.source_size_wh;
  const [previewWidth, previewHeight] = state.boot.manifest.preview_size_wh;
  return [rect[0] / sourceWidth * previewWidth, rect[1] / sourceHeight * previewHeight, rect[2] / sourceWidth * previewWidth, rect[3] / sourceHeight * previewHeight];
}

function selectedAtPointer(canvas, point) {
  if (!state.images.selection) return false;
  const box = canvas.getBoundingClientRect();
  const [previewWidth, previewHeight] = state.boot.manifest.preview_size_wh;
  const x = Math.max(0, Math.min(previewWidth - 1, Math.floor((point.x - box.left) / box.width * previewWidth)));
  const y = Math.max(0, Math.min(previewHeight - 1, Math.floor((point.y - box.top) / box.height * previewHeight)));
  const sample = document.createElement("canvas");
  sample.width = 1; sample.height = 1;
  const context = sample.getContext("2d", {willReadFrequently: true});
  context.drawImage(state.images.selection, x, y, 1, 1, 0, 0, 1, 1);
  return context.getImageData(0, 0, 1, 1).data[3] > 0;
}

function rectanglesOverlap(first, second) {
  return first[0] < second[0] + second[2]
    && first[0] + first[2] > second[0]
    && first[1] < second[1] + second[3]
    && first[1] + first[3] > second[1];
}

function drawPolygon(context, polygon) {
  if (!polygon?.length) return;
  const [sourceWidth, sourceHeight] = state.boot.manifest.source_size_wh;
  const [previewWidth, previewHeight] = state.boot.manifest.preview_size_wh;
  context.beginPath();
  polygon.forEach(([x, y], index) => {
    const px = x / sourceWidth * previewWidth;
    const py = y / sourceHeight * previewHeight;
    if (index === 0) context.moveTo(px, py); else context.lineTo(px, py);
  });
  context.closePath(); context.stroke();
}

function drawCutPath(context) {
  if (!state.cutPoints.length) return;
  const [sourceWidth] = state.boot.manifest.source_size_wh;
  const [previewWidth] = state.boot.manifest.preview_size_wh;
  context.save();
  context.strokeStyle = state.cutPreview ? "#f08a24" : "#087f8c";
  context.fillStyle = context.strokeStyle;
  context.lineWidth = Math.max(2, state.cutWidthPx / sourceWidth * previewWidth);
  context.lineJoin = "round";
  context.lineCap = "round";
  if (!state.cutPreview) context.setLineDash([8, 6]);
  context.beginPath();
  state.cutPoints.forEach(([x, y], index) => {
    const point = previewRect([x, y, 1, 1]);
    if (index === 0) context.moveTo(point[0], point[1]);
    else context.lineTo(point[0], point[1]);
  });
  if (state.cutPoints.length > 1) context.stroke();
  context.setLineDash([]);
  for (const [x, y] of state.cutPoints) {
    const point = previewRect([x, y, 1, 1]);
    context.beginPath();
    context.arc(point[0], point[1], 4, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function renderCanvases() {
  if (!state.boot || !state.images.original) return;
  const [width, height] = state.boot.manifest.preview_size_wh;
  const original = el("original-canvas");
  const ink = el("ink-canvas");
  for (const canvas of [original, ink]) { canvas.width = width; canvas.height = height; }
  const originalContext = original.getContext("2d");
  originalContext.drawImage(state.images.original, 0, 0, width, height);
  originalContext.drawImage(state.images.claimed, 0, 0, width, height);
  if (state.images.cut) originalContext.drawImage(state.images.cut, 0, 0, width, height);
  if (state.images.optimisticClaim) originalContext.drawImage(state.images.optimisticClaim, 0, 0, width, height);
  const inkContext = ink.getContext("2d");
  if (state.images.available) {
    inkContext.drawImage(state.images.available, 0, 0, width, height);
    inkContext.drawImage(state.images.claimed, 0, 0, width, height);
    if (state.images.cut) inkContext.drawImage(state.images.cut, 0, 0, width, height);
    if (state.images.optimisticClaim) inkContext.drawImage(state.images.optimisticClaim, 0, 0, width, height);
  }
  if (state.images.selection) {
    (sourceOnlyMode() ? originalContext : inkContext).drawImage(state.images.selection, 0, 0, width, height);
  }
  if (state.tool === "cut") {
    drawCutPath(originalContext);
    if (state.images.available) drawCutPath(inkContext);
  }
  if (state.boxes) {
    for (const context of [originalContext, inkContext]) {
      context.save(); context.strokeStyle = "#008a99"; context.lineWidth = Math.max(2, width / 500);
      state.boot.state.words.forEach((word) => drawPolygon(context, word.envelope_polygon));
      context.restore();
    }
  }
  if (state.boot.state.status === "page_notes" && state.noteCrop) {
    originalContext.save(); originalContext.strokeStyle = "#22a866"; originalContext.lineWidth = 3;
    const [x, y, w, h] = previewRect(state.noteCrop); originalContext.strokeRect(x, y, w, h); originalContext.restore();
  }
}

function updateSelectionCopy() {
  const count = state.rectangles.length + state.deselectRectangles.length;
  el("open-library").disabled = state.busy || state.commitBusy;
  el("reset-page").disabled = state.busy || state.commitBusy;
  el("undo-word").disabled = state.busy || state.commitBusy || !state.boot?.state?.word_count;
  el("ink-clean").disabled = state.busy || state.commitBusy || state.tool === "cut";
  el("ink-high-recall").disabled = state.busy || state.commitBusy || state.tool === "cut";
  el("recover-ink").disabled = state.busy || state.commitBusy || state.previewBusy || !state.selectionReceipt?.selection_preview_sha256 || state.tool === "cut";
  el("recovery-panel").hidden = !state.recovery;
  el("selection-copy").hidden = Boolean(state.recovery);
  if (state.tool === "cut") {
    const ready = state.cutPoints.length >= 2;
    el("commit-word").disabled = state.busy || !ready;
    el("commit-word").textContent = "Enter · apply cut";
    el("clear-selection").disabled = state.busy || !state.cutPoints.length;
    el("selection-status").textContent = state.busy
      ? "Saving the cut and returning to selection…"
      : state.cutPoints.length < 2
        ? "Cut ink · click at least two points to place a barrier"
        : "Barrier ready · press Enter once to save it and return to selection";
    el("shortcut-help").textContent = "The barrier works through detected ink, missed ink, and empty gaps · Backspace removes a point · Escape cancels";
    return;
  }
  el("commit-word").textContent = "Enter · finish word";
  el("commit-word").disabled = state.busy || state.commitBusy || state.previewBusy || !state.selectionReceipt?.selection_preview_sha256;
  el("clear-selection").disabled = state.busy || (count === 0 && !state.recovery);
  if (state.commitBusy && count) el("selection-status").textContent = "Next word captured · finishing its green preview…";
  else if (state.commitBusy) el("selection-status").textContent = "Saved visually · select the next word now";
  else if (state.previewBusy) el("selection-status").textContent = `Following the touched ${state.inkVariant} ink…`;
  else if (state.selectionReceipt?.selected_pixels && state.selectionReceipt?.commit_ready) {
    el("selection-status").textContent = state.recovery
      ? `${state.recovery.activeLabel} recovery visible · press Enter only if the green word is right`
      : `${state.inkVariant === "clean" ? "Clean" : "High-recall"} ink selected · press Enter · click green ink to remove it`;
  } else if (state.selectionReceipt?.selected_pixels) {
    el("selection-status").textContent = "Selection is visible but needs another click or a tighter drag.";
  } else if (state.recovery) {
    el("selection-status").textContent = `${state.recovery.activeLabel} recovery is selectable · click or drag only the word ink you want`;
  } else el("selection-status").textContent = "Click an ink piece or drag across a complete word.";
  el("shortcut-help").textContent = "Click green ink to toggle it off · Cut ink draws a split path · Escape clears";
}

async function refreshSelection() {
  const request = ++state.selectionRequest;
  state.selectionReceipt = null;
  if (!state.rectangles.length) {
    state.recovery = null;
    if (dualInkMode()) state.images.available = state.images[state.inkVariant];
    state.images.selection = null;
    state.previewBusy = false; updateSelectionCopy(); renderCanvases(); return;
  }
  if (state.commitBusy) {
    state.previewBusy = false; updateSelectionCopy(); renderCanvases(); return;
  }
  state.previewBusy = true; updateSelectionCopy(); renderCanvases();
  const selectionPayload = {
    base_state_sha256: state.boot.state.state_sha256,
    ink_variant: state.inkVariant,
    rectangles: state.rectangles,
    deselect_rectangles: state.deselectRectangles,
  };
  if (state.recovery) {
    selectionPayload.recovery_set_sha256 = state.recovery.setSha;
    selectionPayload.recovery_profile = state.recovery.active;
  }
  const pending = api("/api/preview-selection", selectionPayload).then(async (receipt) => {
    if (request !== state.selectionRequest) return;
    const overlay = await image(receipt.overlay_data_url);
    if (request !== state.selectionRequest) return;
    state.selectionReceipt = receipt;
    state.images.selection = overlay;
  }).catch((error) => {
    if (request === state.selectionRequest) showToast(error.message);
  }).finally(() => {
    if (request === state.selectionRequest) {
      state.previewBusy = false; updateSelectionCopy(); renderCanvases();
    }
  });
  state.selectionPromise = pending;
  return pending;
}

function applyZoom() {
  el("pages").style.setProperty("--image-zoom", String(state.zoom));
  el("zoom-label").textContent = `${Math.round(state.zoom * 100)}%`;
}

function changeZoom(delta) {
  const shells = [el("original-shell"), el("ink-shell")];
  const focus = shells.map((shell) => ({
    x: shell.scrollWidth ? (shell.scrollLeft + shell.clientWidth / 2) / shell.scrollWidth : .5,
    y: shell.scrollHeight ? (shell.scrollTop + shell.clientHeight / 2) / shell.scrollHeight : .5,
  }));
  state.zoom = Math.max(1, Math.min(4, state.zoom + delta));
  applyZoom();
  requestAnimationFrame(() => shells.forEach((shell, index) => {
    shell.scrollLeft = focus[index].x * shell.scrollWidth - shell.clientWidth / 2;
    shell.scrollTop = focus[index].y * shell.scrollHeight - shell.clientHeight / 2;
  }));
}

let synchronizingPageScroll = false;
function synchronizePageScroll(source, target) {
  if (synchronizingPageScroll || target.hidden) return;
  synchronizingPageScroll = true;
  const sourceX = Math.max(1, source.scrollWidth - source.clientWidth);
  const sourceY = Math.max(1, source.scrollHeight - source.clientHeight);
  const targetX = Math.max(0, target.scrollWidth - target.clientWidth);
  const targetY = Math.max(0, target.scrollHeight - target.clientHeight);
  target.scrollLeft = source.scrollLeft / sourceX * targetX;
  target.scrollTop = source.scrollTop / sourceY * targetY;
  requestAnimationFrame(() => { synchronizingPageScroll = false; });
}

async function loadBootstrap(data = null, {preserveSelection = false} = {}) {
  state.boot = data || await api("/api/bootstrap");
  if (state.boot.csrf_token) state.csrf = state.boot.csrf_token;
  if (!preserveSelection) {
    state.rectangles = [];
    state.deselectRectangles = [];
    state.selectionHistory = [];
    state.selectionReceipt = null;
    state.images.selection = null;
    state.cutPoints = [];
    state.cutPreview = null;
    state.recovery = null;
  }
  if (!state.images.original) state.images.original = await image(state.boot.assets.original);
  state.images.available = state.boot.assets.available ? await image(state.boot.assets.available) : null;
  if (dualInkMode()) {
    if (!state.images.clean) state.images.clean = await image(state.boot.assets.clean);
    if (!state.images.high_recall) state.images.high_recall = await image(state.boot.assets.high_recall);
    if (!state.boot.manifest.ink_layers?.[state.inkVariant]) state.inkVariant = "clean";
    state.images.available = state.images[state.inkVariant];
  }
  state.images.claimed = await image(state.boot.assets.claimed);
  state.images.cut = state.boot.assets.cut ? await image(state.boot.assets.cut) : null;
  el("word-count").textContent = state.boot.state.word_count;
  const status = state.boot.state.status;
  const sourceOnly = sourceOnlyMode();
  const dualInk = dualInkMode();
  el("pages").classList.toggle("source-only", sourceOnly);
  el("ink-card").hidden = sourceOnly;
  el("ink-layer-switch").hidden = !dualInk;
  el("ink-clean").setAttribute("aria-pressed", String(state.inkVariant === "clean"));
  el("ink-high-recall").setAttribute("aria-pressed", String(state.inkVariant === "high_recall"));
  el("ink-title").textContent = state.inkVariant === "clean" ? "Clean ink" : "High-recall ink";
  el("ink-layer-description").textContent = state.inkVariant === "clean" ? "V4 likely handwriting · lower noise" : "V4 likely + uncertain · higher recall";
  el("original-shell").classList.toggle("interactive", sourceOnly && status === "selecting_words");
  el("original-title").textContent = sourceOnly ? "Original letter" : "Original";
  el("original-role").textContent = sourceOnly ? "Select here" : "Context";
  el("original-canvas").setAttribute(
    "aria-label",
    sourceOnly
      ? "Original letter image. Click or drag on handwriting to select one word."
      : "Original letter with completed word ink shown red",
  );
  applyZoom();
  el("commit-bar").hidden = status !== "selecting_words";
  el("finish-page").hidden = status !== "selecting_words";
  el("tool-cut").hidden = status !== "selecting_words";
  el("undo-word").hidden = status !== "selecting_words";
  el("notes-panel").hidden = status !== "page_notes";
  el("instruction").textContent = status === "selecting_words" ? "Select one word · press Enter" : status === "page_notes" ? "Add notes once · finish the page" : "Page complete";
  updateSelectionCopy(); renderCanvases();
  if (status === "complete") showToast(`Complete · ${state.boot.state.word_count} words selected`);
}

function beginDrag(event, target) {
  if (state.busy) return;
  const status = state.boot.state.status;
  if (target === "ink" && status !== "selecting_words") return;
  if (
    target === "original"
    && !(
      status === "page_notes"
      || (status === "selecting_words" && (sourceOnlyMode() || state.tool === "cut"))
    )
  ) return;
  event.preventDefault();
  const canvas = target === "ink" ? el("ink-canvas") : el("original-canvas");
  canvas.setPointerCapture(event.pointerId);
  state.drag = {target, start: {x: event.clientX, y: event.clientY}, end: {x: event.clientX, y: event.clientY}};
}

function moveDrag(event) {
  if (!state.drag) return;
  state.drag.end = {x: event.clientX, y: event.clientY};
  const canvas = state.drag.target === "ink" ? el("ink-canvas") : el("original-canvas");
  const overlay = state.drag.target === "ink" ? el("ink-drag") : el("original-drag");
  const box = canvas.getBoundingClientRect();
  const left = Math.max(0, Math.min(state.drag.start.x, state.drag.end.x) - box.left);
  const top = Math.max(0, Math.min(state.drag.start.y, state.drag.end.y) - box.top);
  overlay.style.left = `${left}px`; overlay.style.top = `${top}px`;
  overlay.style.width = `${Math.abs(state.drag.end.x - state.drag.start.x)}px`;
  overlay.style.height = `${Math.abs(state.drag.end.y - state.drag.start.y)}px`;
  overlay.hidden = false;
}

function endDrag(event) {
  if (!state.drag) return;
  const drag = state.drag; state.drag = null;
  const canvas = drag.target === "ink" ? el("ink-canvas") : el("original-canvas");
  const overlay = drag.target === "ink" ? el("ink-drag") : el("original-drag");
  overlay.hidden = true;
  const displayWidth = Math.abs(drag.end.x - drag.start.x);
  const displayHeight = Math.abs(drag.end.y - drag.start.y);
  const isClick = displayWidth < 3 && displayHeight < 3;
  const start = isClick ? {x: drag.start.x - 1, y: drag.start.y - 1} : drag.start;
  const end = isClick ? {x: drag.start.x + 1, y: drag.start.y + 1} : drag.end;
  const rect = sourceRectFromPointer(canvas, start, end);
  if (state.tool === "cut" && state.boot.state.status === "selecting_words") {
    if (!isClick) {
      showToast("Cut paths use clicks: place one point at a time.");
      return;
    }
    state.cutPoints.push(sourcePointFromPointer(canvas, drag.start));
    state.cutPreview = null;
    updateSelectionCopy(); renderCanvases();
    return;
  }
  if (drag.target === "ink" || (drag.target === "original" && state.boot.state.status === "selecting_words")) {
    if (isClick && selectedAtPointer(canvas, drag.start)) {
      state.deselectRectangles.push(rect);
      state.selectionHistory.push("remove");
    } else {
      const restoreIndex = isClick
        ? state.deselectRectangles.findLastIndex((value) => rectanglesOverlap(value, rect))
        : -1;
      if (restoreIndex >= 0) {
        state.deselectRectangles.splice(restoreIndex, 1);
        const historyIndex = state.selectionHistory.lastIndexOf("remove");
        if (historyIndex >= 0) state.selectionHistory.splice(historyIndex, 1);
      } else {
        state.rectangles.push(rect);
        state.selectionHistory.push("add");
      }
    }
    refreshSelection();
  } else {
    if (isClick) return;
    state.noteCrop = rect;
    el("crop-status").textContent = `Crop selected: ${rect.join(" × ")}`;
    el("add-crop-note").disabled = !el("crop-text").value.trim();
    renderCanvases();
  }
}

async function commitWord() {
  if (state.busy || state.commitBusy || !state.rectangles.length || state.boot.state.status !== "selecting_words") return;
  if (state.selectionPromise) await state.selectionPromise;
  if (!state.selectionReceipt?.selection_preview_sha256) return;
  const commitRectangles = state.rectangles.map((value) => [...value]);
  const commitDeselectRectangles = state.deselectRectangles.map((value) => [...value]);
  const commitHistory = [...state.selectionHistory];
  const commitReceipt = state.selectionReceipt;
  const commitSelectionImage = state.images.selection;
  const commitInkVariant = state.inkVariant;
  const commitRecovery = state.recovery;
  const commitRecoverySurface = commitRecovery ? state.images.available : null;
  const commitBaseState = state.boot.state.state_sha256;
  state.commitBusy = true;
  state.images.optimisticClaim = tintOverlay(commitSelectionImage, [211, 47, 47]);
  state.rectangles = [];
  state.deselectRectangles = [];
  state.selectionHistory = [];
  state.selectionReceipt = null;
  state.images.selection = null;
  state.recovery = null;
  if (commitRecovery && dualInkMode()) state.images.available = state.images[state.inkVariant];
  state.selectionRequest += 1;
  state.previewBusy = false;
  updateSelectionCopy(); renderCanvases();
  try {
    const result = await api("/api/commit-word", {
      schema_version: "simple-page-word-selection-action.v1",
      base_state_sha256: commitBaseState,
      ink_variant: commitInkVariant,
      rectangles: commitRectangles,
      deselect_rectangles: commitDeselectRectangles,
      selection_preview_sha256: commitReceipt.selection_preview_sha256,
    });
    await loadBootstrap(result.bootstrap, {preserveSelection: true});
    state.images.optimisticClaim = null;
    state.commitBusy = false;
    if (state.rectangles.length) await refreshSelection();
    else { updateSelectionCopy(); renderCanvases(); }
    showToast(`Word ${result.committed_word.word_number} finished · ${result.committed_word.selected_pixels.toLocaleString()} ink pixels`);
  } catch (error) {
    state.rectangles = commitRectangles.concat(state.rectangles);
    state.deselectRectangles = commitDeselectRectangles.concat(state.deselectRectangles);
    state.selectionHistory = commitHistory.concat(state.selectionHistory);
    state.selectionReceipt = commitReceipt;
    state.images.selection = commitSelectionImage;
    state.recovery = commitRecovery;
    if (commitRecoverySurface) state.images.available = commitRecoverySurface;
    state.images.optimisticClaim = null;
    state.commitBusy = false;
    if (error.code === "stale_selection_preview" || error.code === "stale_action") {
      state.recovery = null;
      state.selectionReceipt = null;
      state.images.selection = null;
      state.selectionPromise = null;
      try {
        await loadBootstrap(null, {preserveSelection: true});
        if (state.rectangles.length) await refreshSelection();
        showToast("The page changed underneath the green preview. It was cleaned up automatically—check the green word and press Enter again.");
      } catch (refreshError) {
        showToast(refreshError.message);
      }
    } else {
      showToast(error.message); updateSelectionCopy(); renderCanvases();
    }
  }
}

function recoveryLabel(profile) {
  return ({
    original: "Original extracted ink",
    conservative: "Conservative",
    balanced: "Balanced",
    maximum_recall: "Maximum recall",
  })[profile] || profile;
}

function renderRecoveryChoices() {
  if (!state.recovery) return;
  for (const profile of state.recovery.order) {
    const button = el(`recovery-${profile.replace("maximum_recall", "maximum")}`);
    const candidate = state.recovery.candidates[profile];
    button.hidden = false;
    button.setAttribute("aria-pressed", String(profile === state.recovery.active));
    button.textContent = profile === "original"
      ? "Original"
      : `${recoveryLabel(profile)} +${candidate.recovered_source_pixels.toLocaleString()}`;
  }
}

async function previewRecovery() {
  if (state.busy || state.commitBusy || state.previewBusy || !state.selectionReceipt?.selection_preview_sha256) return;
  state.previewBusy = true; updateSelectionCopy();
  try {
    const result = await api("/api/preview-recovery", {
      base_state_sha256: state.boot.state.state_sha256,
      selection_preview_sha256: state.selectionReceipt.selection_preview_sha256,
    });
    state.recovery = {
      setSha: result.recovery_set_sha256,
      order: result.candidate_order,
      candidates: result.candidates,
      active: result.active_profile,
      activeLabel: recoveryLabel(result.active_profile),
    };
    state.rectangles = [];
    state.deselectRectangles = [];
    state.selectionHistory = [];
    state.selectionReceipt = null;
    state.images.selection = null;
    state.images.available = await image(result.surface.selectable_ink_data_url);
    state.selectionRequest += 1;
    renderRecoveryChoices();
  } catch (error) {
    showToast(error.message);
  } finally {
    state.previewBusy = false; updateSelectionCopy(); renderCanvases();
  }
}

async function chooseRecovery(profile) {
  if (state.busy || state.commitBusy || state.previewBusy || !state.recovery || profile === state.recovery.active) return;
  state.previewBusy = true; updateSelectionCopy();
  try {
    const result = await api("/api/choose-recovery", {
      base_state_sha256: state.boot.state.state_sha256,
      recovery_set_sha256: state.recovery.setSha,
      profile,
    });
    state.recovery.active = profile;
    state.recovery.activeLabel = recoveryLabel(profile);
    state.rectangles = [];
    state.deselectRectangles = [];
    state.selectionHistory = [];
    state.selectionReceipt = null;
    state.images.selection = null;
    state.images.available = await image(result.surface.selectable_ink_data_url);
    state.selectionRequest += 1;
    renderRecoveryChoices();
  } catch (error) {
    showToast(error.message);
  } finally {
    state.previewBusy = false; updateSelectionCopy(); renderCanvases();
  }
}

function setTool(tool) {
  state.tool = tool;
  state.cutPoints = [];
  state.cutPreview = null;
  el("tool-cut").setAttribute("aria-pressed", String(tool === "cut"));
  el("tool-cut").classList.toggle("active", tool === "cut");
  el("tool-cut").textContent = tool === "cut" ? "Cancel cut" : "Cut ink";
  if (tool === "cut") {
    state.rectangles = [];
    state.deselectRectangles = [];
    state.selectionHistory = [];
    state.selectionReceipt = null;
    state.images.selection = null;
    state.recovery = null;
    state.selectionRequest += 1;
    showToast("Cut mode · place two or more points, then press Enter twice.");
  }
  updateSelectionCopy(); renderCanvases();
}

function setInkVariant(variant) {
  if (!dualInkMode() || !["clean", "high_recall"].includes(variant) || variant === state.inkVariant || state.busy || state.commitBusy || state.tool === "cut") return;
  state.inkVariant = variant;
  state.images.available = state.images[variant];
  state.rectangles = [];
  state.deselectRectangles = [];
  state.selectionHistory = [];
  state.selectionReceipt = null;
  state.images.selection = null;
  state.recovery = null;
  state.selectionRequest += 1;
  el("ink-clean").setAttribute("aria-pressed", String(variant === "clean"));
  el("ink-high-recall").setAttribute("aria-pressed", String(variant === "high_recall"));
  el("ink-title").textContent = variant === "clean" ? "Clean ink" : "High-recall ink";
  el("ink-layer-description").textContent = variant === "clean" ? "V4 likely handwriting · lower noise" : "V4 likely + uncertain · higher recall";
  showToast(`${variant === "clean" ? "Clean" : "High-recall"} ink active for the next word.`);
  updateSelectionCopy(); renderCanvases();
}

async function applyCut() {
  if (state.busy || state.cutPoints.length < 2) return;
  state.busy = true; updateSelectionCopy();
  try {
    const result = await api("/api/apply-cut", {
      schema_version: "simple-page-cut-apply-action.v1",
      base_state_sha256: state.boot.state.state_sha256,
      points: state.cutPoints,
      width_px: state.cutWidthPx,
    });
    state.tool = "select";
    el("tool-cut").setAttribute("aria-pressed", "false");
    el("tool-cut").classList.remove("active");
    el("tool-cut").textContent = "Cut ink";
    await loadBootstrap(result.bootstrap);
    const crossed = result.cut.touched_high_recall_ink_pixels;
    showToast(crossed
      ? `Cut saved through ${crossed.toLocaleString()} ink pixels · select either side now.`
      : "Cut saved as a persistent barrier · select either side now.");
  } catch (error) {
    showToast(error.message);
  } finally {
    state.busy = false; updateSelectionCopy(); renderCanvases();
  }
}

function handleEnter() {
  if (state.tool === "cut") {
    applyCut();
  } else {
    commitWord();
  }
}

async function undoLastWord() {
  if (
    state.busy
    || state.commitBusy
    || state.tool === "cut"
    || !state.boot.state.word_count
    || state.boot.state.status !== "selecting_words"
  ) return;
  state.busy = true;
  state.rectangles = [];
  state.deselectRectangles = [];
  state.selectionHistory = [];
  state.selectionReceipt = null;
  state.images.selection = null;
  state.recovery = null;
  state.selectionRequest += 1;
  updateSelectionCopy(); renderCanvases();
  try {
    const result = await api("/api/undo-last-word", {
      base_state_sha256: state.boot.state.state_sha256,
    });
    await loadBootstrap(result.bootstrap);
    showToast(`Word ${result.undone_word.word_number} restored · select it again when ready`);
  } catch (error) {
    showToast(error.message);
  } finally {
    state.busy = false; updateSelectionCopy(); renderCanvases();
  }
}

async function finishWords() {
  if (state.busy || state.boot.state.status !== "selecting_words") return;
  if (state.tool === "cut") { showToast("Apply or cancel the current cut first."); return; }
  if (!confirm(`Finish word selection with ${state.boot.state.word_count} words and fit all pending boxes now?`)) return;
  state.busy = true;
  el("finish-page").textContent = "Fitting boxes…";
  try {
    const result = await api("/api/finish-words", {base_state_sha256: state.boot.state.state_sha256});
    await loadBootstrap(result.bootstrap); showToast("Word selection finished. Add page notes once, then save.");
  } catch (error) { showToast(error.message); }
  finally { state.busy = false; el("finish-page").textContent = "Finish + fit boxes"; }
}

function addCropNote() {
  const text = el("crop-text").value.trim();
  if (!state.noteCrop || !text) return;
  state.noteItems.push({text, bbox_xywh: state.noteCrop});
  state.noteCrop = null; el("crop-text").value = ""; el("add-crop-note").disabled = true;
  el("crop-status").textContent = "Drag on the original page to choose another crop.";
  renderNoteItems(); renderCanvases();
}

function renderNoteItems() {
  el("crop-notes").replaceChildren(...state.noteItems.map((item, index) => {
    const row = document.createElement("li"); row.textContent = `${item.text} · crop ${item.bbox_xywh.join(", ")}`;
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "quiet"; remove.textContent = "Remove";
    remove.addEventListener("click", () => { state.noteItems.splice(index, 1); renderNoteItems(); });
    row.append(" ", remove); return row;
  }));
}

async function saveNotes() {
  if (state.busy || state.boot.state.status !== "page_notes") return;
  state.busy = true;
  try {
    const result = await api("/api/page-notes", {base_state_sha256: state.boot.state.state_sha256, summary: el("page-summary").value, items: state.noteItems});
    await loadBootstrap(result.bootstrap); el("notes-panel").hidden = true; showToast("Page complete. Notes and crops were saved together.");
  } catch (error) { showToast(error.message); }
  finally { state.busy = false; }
}

function wire() {
  el("ink-canvas").addEventListener("pointerdown", (event) => beginDrag(event, "ink"));
  el("original-canvas").addEventListener("pointerdown", (event) => beginDrag(event, "original"));
  window.addEventListener("pointermove", moveDrag);
  window.addEventListener("pointerup", endDrag);
  el("commit-word").addEventListener("click", handleEnter);
  el("clear-selection").addEventListener("click", () => {
    if (state.tool === "cut") {
      state.cutPoints = []; state.cutPreview = null; updateSelectionCopy(); renderCanvases();
    } else {
      state.rectangles = []; state.deselectRectangles = []; state.selectionHistory = []; refreshSelection();
    }
  });
  el("tool-cut").addEventListener("click", () => setTool(state.tool === "cut" ? "select" : "cut"));
  el("ink-clean").addEventListener("click", () => setInkVariant("clean"));
  el("ink-high-recall").addEventListener("click", () => setInkVariant("high_recall"));
  el("recover-ink").addEventListener("click", previewRecovery);
  el("recovery-original").addEventListener("click", () => chooseRecovery("original"));
  el("recovery-conservative").addEventListener("click", () => chooseRecovery("conservative"));
  el("recovery-balanced").addEventListener("click", () => chooseRecovery("balanced"));
  el("recovery-maximum").addEventListener("click", () => chooseRecovery("maximum_recall"));
  el("undo-word").addEventListener("click", undoLastWord);
  el("toggle-boxes").addEventListener("click", () => { state.boxes = !state.boxes; el("toggle-boxes").textContent = state.boxes ? "Boxes on" : "Boxes off"; el("toggle-boxes").setAttribute("aria-pressed", String(state.boxes)); renderCanvases(); });
  el("zoom-out").addEventListener("click", () => changeZoom(-.25));
  el("zoom-in").addEventListener("click", () => changeZoom(.25));
  el("original-shell").addEventListener("scroll", () => synchronizePageScroll(el("original-shell"), el("ink-shell")), {passive: true});
  el("ink-shell").addEventListener("scroll", () => synchronizePageScroll(el("ink-shell"), el("original-shell")), {passive: true});
  el("finish-page").addEventListener("click", finishWords);
  el("crop-text").addEventListener("input", () => { el("add-crop-note").disabled = !state.noteCrop || !el("crop-text").value.trim(); });
  el("add-crop-note").addEventListener("click", addCropNote);
  el("save-notes").addEventListener("click", saveNotes);
  el("open-library").addEventListener("click", showLibrary);
  el("library-back").addEventListener("click", showWorkspace);
  el("library-search").addEventListener("input", renderLibrary);
  el("reset-page").addEventListener("click", resetPage);
  window.addEventListener("resize", applyZoom);
  window.addEventListener("keydown", (event) => {
    if (event.target.matches("textarea, input")) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); undoLastWord(); }
    else if (event.key === "Enter") { event.preventDefault(); handleEnter(); }
    else if (event.key === "Escape") {
      if (state.tool === "cut") setTool("select");
      else { state.rectangles = []; state.deselectRectangles = []; state.selectionHistory = []; refreshSelection(); }
    }
    else if (event.key === "Backspace" && state.tool === "cut" && state.cutPoints.length) {
      event.preventDefault(); state.cutPoints.pop(); state.cutPreview = null; updateSelectionCopy(); renderCanvases();
    }
    else if (event.key === "Backspace" && state.selectionHistory.length) {
      event.preventDefault();
      const operation = state.selectionHistory.pop();
      if (operation === "remove") state.deselectRectangles.pop(); else state.rectangles.pop();
      refreshSelection();
    }
  });
}

wire(); applyZoom();
loadBootstrap().catch((error) => showToast(error.message));
