import { calculateOverallScore, scoreFields, statusOptions, tagOptions } from "./scoring.js";

const state = {
  batches: [],
  selectedBatchId: "",
  items: [],
  stats: null,
  selectedItemId: "",
  compareMode: "side-by-side",
  overlayOpacity: 55,
  overlayTop: "source",
  overlayBlink: false,
  imageSizes: {},
  imageLoadFailures: {},
  retryingImages: new Set(),
  reviewDrafts: {},
  filters: {
    model: "all",
    status: "all",
    search: "",
  },
};

const els = {
  batchMeta: document.querySelector("#batchMeta"),
  batchSelect: document.querySelector("#batchSelect"),
  importButton: document.querySelector("#importButton"),
  totalItems: document.querySelector("#totalItems"),
  reviewedItems: document.querySelector("#reviewedItems"),
  remainingItems: document.querySelector("#remainingItems"),
  sourceCache: document.querySelector("#sourceCache"),
  resultCache: document.querySelector("#resultCache"),
  modelFilter: document.querySelector("#modelFilter"),
  statusFilter: document.querySelector("#statusFilter"),
  searchInput: document.querySelector("#searchInput"),
  nextUnreviewedButton: document.querySelector("#nextUnreviewedButton"),
  visibleCount: document.querySelector("#visibleCount"),
  itemList: document.querySelector("#itemList"),
  reviewPane: document.querySelector("#reviewPane"),
  modelStats: document.querySelector("#modelStats"),
  tagStats: document.querySelector("#tagStats"),
  imageDialog: document.querySelector("#imageDialog"),
  dialogImage: document.querySelector("#dialogImage"),
  closeDialogButton: document.querySelector("#closeDialogButton"),
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options,
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error || "Request failed");
  }
  return body;
}

function scoreValue(item, field) {
  return Number(item[field] || 3);
}

function calculateOverall(form) {
  return calculateOverallScore(Object.fromEntries(scoreFields.map(({ field }) => [field, Number(form[field])]))).toFixed(2);
}

function isReviewed(item) {
  return item.overall_score !== null && item.overall_score !== undefined;
}

function selectedBatch() {
  return state.batches.find((batch) => batch.id === state.selectedBatchId);
}

function filteredItems() {
  const query = state.filters.search.trim().toLowerCase();
  return state.items.filter((item) => {
    if (state.filters.model !== "all" && item.model !== state.filters.model) return false;
    if (state.filters.status === "reviewed" && !isReviewed(item)) return false;
    if (state.filters.status === "unreviewed" && isReviewed(item)) return false;
    if (!query) return true;
    const haystack = [
      item.model,
      item.text,
      item.optimization_prompt,
      item.raw_json_file,
      ...(Array.isArray(item.tags) ? item.tags : []),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });
}

function renderBatchSelect() {
  if (!state.batches.length) {
    els.batchSelect.innerHTML = '<option value="">No batches</option>';
    return;
  }

  els.batchSelect.innerHTML = state.batches
    .map((batch) => {
      const label = `${batch.name} (${batch.reviewed_count || 0}/${batch.item_count || 0})`;
      return `<option value="${escapeHtml(batch.id)}">${escapeHtml(label)}</option>`;
    })
    .join("");
  els.batchSelect.value = state.selectedBatchId;
}

function renderMetrics() {
  const summary = state.stats?.summary || {};
  els.totalItems.textContent = summary.total_items || 0;
  els.reviewedItems.textContent = summary.reviewed_items || 0;
  els.remainingItems.textContent = summary.unreviewed_items || 0;
  els.sourceCache.textContent = `${summary.cached_source_images || 0}/${summary.total_items || 0}`;
  els.resultCache.textContent = `${summary.cached_result_images || 0}/${summary.total_items || 0}`;

  const batch = selectedBatch();
  if (!batch) {
    els.batchMeta.textContent = "No batch loaded";
    return;
  }
  const imported = batch.imported_at ? new Date(batch.imported_at).toLocaleString() : "";
  els.batchMeta.textContent = `${batch.id} | ${imported}`;
}

function renderFilters() {
  const models = [...new Set(state.items.map((item) => item.model))].sort();
  if (state.filters.model !== "all" && !models.includes(state.filters.model)) {
    state.filters.model = "all";
  }
  els.modelFilter.innerHTML = [
    '<option value="all">All models</option>',
    ...models.map((model) => `<option value="${escapeHtml(model)}">${escapeHtml(model)}</option>`),
  ].join("");
  els.modelFilter.value = state.filters.model;
}

function renderItemList() {
  const visible = filteredItems();
  els.visibleCount.textContent = `${visible.length} visible`;

  if (!visible.length) {
    els.itemList.innerHTML = '<div class="empty-list">No matching items</div>';
    return;
  }

  els.itemList.innerHTML = visible
    .map((item) => {
      const reviewed = isReviewed(item);
      const score = reviewed ? Number(item.overall_score).toFixed(2) : "--";
      return `
        <button class="item-row ${item.id === state.selectedItemId ? "active" : ""}" data-id="${escapeHtml(item.id)}" type="button">
          <div class="row-title">
            <span class="model-pill">${escapeHtml(item.model)}</span>
            <span class="status-pill ${reviewed ? "reviewed" : "unreviewed"}">${reviewed ? score : "Open"}</span>
          </div>
          <div class="row-prompt">${escapeHtml(item.text)}</div>
          <div class="row-title">
            <span>${escapeHtml(item.raw_json_file)} #${item.raw_index + 1}</span>
            <span>${escapeHtml(item.source_fetch_status)}/${escapeHtml(item.result_fetch_status)}</span>
          </div>
        </button>
      `;
    })
    .join("");

  for (const button of els.itemList.querySelectorAll(".item-row")) {
    button.addEventListener("click", () => {
      state.selectedItemId = button.dataset.id;
      render();
    });
  }
}

function imageHtml(item, kind) {
  const isSource = kind === "source";
  const path = isSource ? item.source_image_url : item.result_image_url;
  const status = isSource ? item.source_fetch_status : item.result_fetch_status;
  const error = isSource ? item.source_fetch_error : item.result_fetch_error;
  const loadError = state.imageLoadFailures[imageKey(item.id, kind)];
  if (path && status === "success" && !loadError) {
    return `
      <img
        src="${escapeHtml(path)}"
        alt="${isSource ? "Source image" : "Result image"}"
        data-full="${escapeHtml(path)}"
        data-item-id="${escapeHtml(item.id)}"
        data-image-kind="${kind}"
      />
    `;
  }
  return imageMissingHtml(item, kind, {
    status: loadError ? "failed" : status,
    error: loadError || error || "Image is not cached locally.",
  });
}

function imageMissingHtml(item, kind, details = {}) {
  const isSource = kind === "source";
  const remote = isSource ? item.url : item.result_url;
  const retrying = state.retryingImages.has(imageKey(item.id, kind));
  return `
    <div class="image-missing">
      <strong>${escapeHtml(details.status || "missing")}</strong>
      <p>${escapeHtml(details.error || "Image is not cached locally.")}</p>
      <div class="image-missing-actions">
        <a href="${escapeHtml(remote)}" target="_blank" rel="noreferrer">Open remote URL</a>
        <button
          class="retry-image-button secondary"
          type="button"
          data-item-id="${escapeHtml(item.id)}"
          data-retry-image-kind="${kind}"
          ${retrying ? "disabled" : ""}
        >${retrying ? "Retrying..." : "Retry"}</button>
      </div>
    </div>
  `;
}

function imageKey(itemId, kind) {
  return `${itemId}:${kind}`;
}

function resetOverlayState() {
  state.compareMode = "side-by-side";
  state.overlayOpacity = 55;
  state.overlayTop = "source";
  state.overlayBlink = false;
}

function renderImageCompare(item) {
  return `
    <div class="compare-shell">
      <div class="compare-tabs">
        <button class="compare-tab ${state.compareMode === "side-by-side" ? "active" : ""}" data-compare-mode="side-by-side" type="button">
          Side by Side
        </button>
        <button class="compare-tab ${state.compareMode === "overlay" ? "active" : ""}" data-compare-mode="overlay" type="button">
          Overlay
        </button>
      </div>
      <div id="imageCompareRegion">
        ${state.compareMode === "overlay" ? renderOverlayImages(item) : renderSideBySideImages(item)}
      </div>
    </div>
  `;
}

function renderSideBySideImages(item) {
  return `
    <div class="image-grid">
      <div class="image-box">
        <h3>Source Image</h3>
        <div class="image-frame">${imageHtml(item, "source")}</div>
      </div>
      <div class="image-box">
        <h3>Result Image</h3>
        <div class="image-frame">${imageHtml(item, "result")}</div>
      </div>
    </div>
  `;
}

function renderOverlayImages(item) {
  const sourcePath = item.source_image_url;
  const resultPath = item.result_image_url;
  const sourceLoadError = state.imageLoadFailures[imageKey(item.id, "source")];
  const resultLoadError = state.imageLoadFailures[imageKey(item.id, "result")];
  const sourceReady = sourcePath && item.source_fetch_status === "success" && !sourceLoadError;
  const resultReady = resultPath && item.result_fetch_status === "success" && !resultLoadError;
  if (!sourceReady || !resultReady) {
    return `
      <div class="overlay-unavailable">
        <strong>Overlay unavailable</strong>
        <p>Both cached source and result images must load before overlay comparison is available.</p>
      </div>
      ${!sourceReady ? imageMissingHtml(item, "source", { status: sourceLoadError ? "failed" : item.source_fetch_status, error: sourceLoadError || item.source_fetch_error }) : ""}
      ${!resultReady ? imageMissingHtml(item, "result", { status: resultLoadError ? "failed" : item.result_fetch_status, error: resultLoadError || item.result_fetch_error }) : ""}
    `;
  }

  const topKind = state.overlayTop;
  const baseKind = topKind === "source" ? "result" : "source";
  const topSrc = topKind === "source" ? sourcePath : resultPath;
  const baseSrc = baseKind === "source" ? sourcePath : resultPath;
  const topAlt = topKind === "source" ? "Source image overlay" : "Result image overlay";
  const baseAlt = baseKind === "source" ? "Source image base" : "Result image base";
  const opacity = state.overlayOpacity / 100;
  const swapLabel = topKind === "source" ? "Source over Result" : "Result over Source";

  return `
    <div class="overlay-panel">
      <div class="overlay-tools">
        <label class="overlay-opacity-control">
          <span>Opacity</span>
          <input id="overlayOpacity" type="range" min="0" max="100" step="1" value="${state.overlayOpacity}" />
          <strong id="overlayOpacityValue">${state.overlayOpacity}%</strong>
        </label>
        <button id="overlaySwapButton" class="secondary" type="button">${swapLabel}</button>
        <button id="overlayBlinkButton" class="secondary ${state.overlayBlink ? "active" : ""}" type="button">
          Blink ${state.overlayBlink ? "On" : "Off"}
        </button>
      </div>
      <div class="overlay-stage ${state.overlayBlink ? "blinking" : ""}" style="--overlay-opacity:${opacity}">
        <img
          class="overlay-img base"
          src="${escapeHtml(baseSrc)}"
          alt="${escapeHtml(baseAlt)}"
          data-full="${escapeHtml(baseSrc)}"
          data-size-kind="${baseKind}"
          data-item-id="${escapeHtml(item.id)}"
          data-image-kind="${baseKind}"
        />
        <img
          class="overlay-img top"
          src="${escapeHtml(topSrc)}"
          alt="${escapeHtml(topAlt)}"
          data-full="${escapeHtml(topSrc)}"
          data-size-kind="${topKind}"
          data-item-id="${escapeHtml(item.id)}"
          data-image-kind="${topKind}"
          style="opacity:${opacity}"
        />
      </div>
      <div class="overlay-meta" id="overlayMeta">${escapeHtml(overlayMetaText(item))}</div>
    </div>
  `;
}

function overlayMetaText(item) {
  const sizes = state.imageSizes[item.id];
  if (!sizes?.source || !sizes?.result) {
    return "Image size unavailable";
  }
  const source = `${sizes.source.width} x ${sizes.source.height}`;
  const result = `${sizes.result.width} x ${sizes.result.height}`;
  const aligned =
    sizes.source.width === sizes.result.width && sizes.source.height === sizes.result.height
      ? "Pixel-aligned"
      : "Aspect-fit only, not pixel-perfect";
  return `Source: ${source} | Result: ${result} | ${aligned}`;
}

function loadImageSize(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = src;
  });
}

async function ensureImageSizes(item) {
  if (
    !item.source_image_url ||
    !item.result_image_url ||
    state.imageSizes[item.id] ||
    state.imageLoadFailures[imageKey(item.id, "source")] ||
    state.imageLoadFailures[imageKey(item.id, "result")]
  ) {
    return;
  }
  try {
    const [source, result] = await Promise.all([
      loadImageSize(item.source_image_url),
      loadImageSize(item.result_image_url),
    ]);
    state.imageSizes[item.id] = { source, result };
    const meta = document.querySelector("#overlayMeta");
    if (meta && state.selectedItemId === item.id) {
      meta.textContent = overlayMetaText(item);
    }
  } catch {
    state.imageSizes[item.id] = { source: null, result: null };
  }
}

function selectedItem() {
  return state.items.find((candidate) => candidate.id === state.selectedItemId);
}

function captureReviewDraft(itemId) {
  const formEl = document.querySelector("#evaluationForm");
  if (!formEl || !itemId) return;
  state.reviewDrafts[itemId] = {
    ...readScoreForm(formEl),
    status: formEl.elements.status.value,
    comment: formEl.elements.comment.value,
    tags: [...formEl.querySelectorAll(".tag-button.selected")].map((button) => button.dataset.tag),
  };
}

function draftForItem(item) {
  return state.reviewDrafts[item.id];
}

function scoreFormForItem(item) {
  const draft = draftForItem(item);
  return Object.fromEntries(
    scoreFields.map(({ field }) => [field, draft?.[field] !== undefined ? Number(draft[field]) : scoreValue(item, field)])
  );
}

function renderReviewPane() {
  const item = selectedItem();
  if (!item) {
    els.reviewPane.innerHTML = `
      <div class="empty-state">
        <div>
          <h2>No item selected</h2>
          <p>Select a row from the queue.</p>
        </div>
      </div>
    `;
    return;
  }

  const draft = draftForItem(item);
  const form = scoreFormForItem(item);
  const overall = item.overall_score ? Number(item.overall_score).toFixed(2) : calculateOverall(form);
  const selectedTags = Array.isArray(draft?.tags) ? draft.tags : Array.isArray(item.tags) ? item.tags : [];
  const selectedStatus = draft?.status || item.status;
  const comment = draft?.comment ?? item.comment ?? "";

  els.reviewPane.innerHTML = `
    <div class="review-layout">
      <section class="review-main">
        <div class="review-head">
          <div>
            <h2>${escapeHtml(item.model)}</h2>
            <p>${escapeHtml(item.raw_json_file)} | item ${item.raw_index + 1} | ${escapeHtml(item.id)}</p>
          </div>
        </div>

        ${renderImageCompare(item)}

        <div class="prompt-grid">
          <div class="prompt-box">
            <h3>Original Prompt</h3>
            <pre>${escapeHtml(item.text)}</pre>
          </div>
          <div class="prompt-box">
            <h3>Optimized Prompt</h3>
            <pre>${escapeHtml(item.optimization_prompt)}</pre>
          </div>
        </div>
      </section>

      <form id="evaluationForm" class="evaluation-sidebar">
        <div class="evaluation-sticky">
          <div class="evaluation-summary">
            <div>
              <span>Evaluation</span>
              <strong>${item.evaluation_updated_at ? "Reviewed" : "Open"}</strong>
            </div>
            <div class="score-badge">
              <span>Overall</span>
              <strong id="overallScore">${overall}</strong>
            </div>
          </div>

          <div class="score-grid">
            <div class="score-box">
              <h3>Core Scores</h3>
              ${scoreFields
                .slice(0, 3)
                .map((field) => scoreRow(field, form[field.field]))
                .join("")}
            </div>
            <div class="score-box">
              <h3>Quality Scores</h3>
              ${scoreFields
                .slice(3)
                .map((field) => scoreRow(field, form[field.field]))
                .join("")}
            </div>
          </div>

          <div class="review-controls">
            <div class="comment-box">
              <h3>Status</h3>
              <div class="tag-grid">
                <select id="statusSelect" name="status">
                  ${statusOptions
                    .map(
                      (status) =>
                        `<option value="${status}" ${selectedStatus === status ? "selected" : ""}>${status}</option>`
                    )
                    .join("")}
                </select>
              </div>
            </div>
            <div class="comment-box">
              <h3>Comment</h3>
              <textarea id="commentInput" name="comment" placeholder="Reviewer notes">${escapeHtml(comment)}</textarea>
            </div>
          </div>

          <div class="comment-box tag-box">
            <h3>Tags</h3>
            <div class="tag-grid">
              ${tagOptions
                .map(
                  (tag) => `
                    <button class="tag-button ${selectedTags.includes(tag) ? "selected" : ""}" data-tag="${tag}" type="button">
                      ${tag}
                    </button>
                  `
                )
                .join("")}
            </div>
          </div>

          <div class="save-row">
            <span class="save-note" id="saveNote">${item.evaluation_updated_at ? `Saved ${escapeHtml(new Date(item.evaluation_updated_at).toLocaleString())}` : "Not reviewed"}</span>
            <button id="saveButton" type="submit">Save Review</button>
          </div>
        </div>
      </form>
    </div>
  `;

  const formEl = document.querySelector("#evaluationForm");
  const currentTags = new Set(selectedTags);

  ensureImageSizes(item);

  for (const button of els.reviewPane.querySelectorAll("[data-compare-mode]")) {
    button.addEventListener("click", () => {
      state.compareMode = button.dataset.compareMode;
      render();
    });
  }

  const opacityInput = document.querySelector("#overlayOpacity");
  if (opacityInput) {
    opacityInput.addEventListener("input", () => {
      state.overlayOpacity = Number(opacityInput.value);
      const opacity = state.overlayOpacity / 100;
      const top = document.querySelector(".overlay-img.top");
      const stage = document.querySelector(".overlay-stage");
      const value = document.querySelector("#overlayOpacityValue");
      if (top) top.style.opacity = String(opacity);
      if (stage) stage.style.setProperty("--overlay-opacity", String(opacity));
      if (value) value.textContent = `${state.overlayOpacity}%`;
    });
  }

  const swapButton = document.querySelector("#overlaySwapButton");
  if (swapButton) {
    swapButton.addEventListener("click", () => {
      state.overlayTop = state.overlayTop === "source" ? "result" : "source";
      render();
    });
  }

  const blinkButton = document.querySelector("#overlayBlinkButton");
  if (blinkButton) {
    blinkButton.addEventListener("click", () => {
      state.overlayBlink = !state.overlayBlink;
      render();
    });
  }

  for (const img of els.reviewPane.querySelectorAll("img[data-full]")) {
    img.addEventListener("click", () => openImage(img.dataset.full, img.alt));
    img.addEventListener("error", () => {
      const itemId = img.dataset.itemId;
      const kind = img.dataset.imageKind;
      if (!itemId || !kind) return;
      captureReviewDraft(itemId);
      state.imageLoadFailures[imageKey(itemId, kind)] = "Cached image failed to load locally.";
      render();
    });
  }

  for (const button of els.reviewPane.querySelectorAll("[data-retry-image-kind]")) {
    button.addEventListener("click", () => {
      const itemId = button.dataset.itemId;
      const kind = button.dataset.retryImageKind;
      if (!itemId || !kind) return;
      retryImage(itemId, kind).catch((error) => {
        state.imageLoadFailures[imageKey(itemId, kind)] = error.message;
        render();
      });
    });
  }

  for (const input of formEl.querySelectorAll('input[type="range"]')) {
    input.addEventListener("input", () => {
      const output = formEl.querySelector(`[data-score-value="${input.name}"]`);
      output.textContent = input.value;
      document.querySelector("#overallScore").textContent = calculateOverall(readScoreForm(formEl));
    });
  }

  for (const button of formEl.querySelectorAll(".tag-button")) {
    button.addEventListener("click", () => {
      if (currentTags.has(button.dataset.tag)) {
        currentTags.delete(button.dataset.tag);
        button.classList.remove("selected");
      } else {
        currentTags.add(button.dataset.tag);
        button.classList.add("selected");
      }
    });
  }

  formEl.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveEvaluation(item.id, formEl, [...currentTags]);
  });
}

function scoreRow(scoreField, value) {
  return `
    <div class="score-row">
      <label for="${scoreField.field}">
        ${scoreField.label}
        <small>Weight ${scoreField.weightLabel}. ${scoreField.help}</small>
      </label>
      <input id="${scoreField.field}" name="${scoreField.field}" type="range" min="1" max="5" step="1" value="${value}" />
      <span class="score-value" data-score-value="${scoreField.field}">${value}</span>
    </div>
  `;
}

function renderStats() {
  const byModel = state.stats?.by_model || [];
  if (!byModel.length) {
    els.modelStats.innerHTML = '<p class="muted">No reviewed models yet.</p>';
  } else {
    els.modelStats.innerHTML = byModel
      .map((row) => {
        const score = Number(row.avg_overall_score || 0);
        const percent = Math.max(0, Math.min(100, (score / 5) * 100));
        return `
          <div class="model-stat">
            <header>
              <span>${escapeHtml(row.model)}</span>
              <strong>${row.avg_overall_score ?? "--"}</strong>
            </header>
            <div class="bar"><span style="width:${percent}%"></span></div>
            <small>${row.reviewed_items || 0}/${row.total_items || 0} reviewed</small>
            <small>
              ${scoreFields
                .map(({ shortLabel, field }) => {
                  const statKey = `avg_${field}`;
                  return `${shortLabel} ${row[statKey] ?? "--"}`;
                })
                .join(" | ")}
            </small>
          </div>
        `;
      })
      .join("");
  }

  const tagCounts = state.stats?.tag_counts || [];
  if (!tagCounts.length) {
    els.tagStats.innerHTML = '<p class="muted">No tags yet.</p>';
  } else {
    els.tagStats.innerHTML = tagCounts
      .map(
        (row) => `
          <div class="tag-stat">
            <span>${escapeHtml(row.tag)}</span>
            <strong>${row.count}</strong>
          </div>
        `
      )
      .join("");
  }
}

function readScoreForm(formEl) {
  return Object.fromEntries(scoreFields.map(({ field }) => [field, formEl.elements[field].value]));
}

async function saveEvaluation(itemId, formEl, tags) {
  const payload = {
    ...readScoreForm(formEl),
    status: formEl.elements.status.value,
    comment: formEl.elements.comment.value,
    tags,
  };
  const saveNote = document.querySelector("#saveNote");
  saveNote.textContent = "Saving...";
  await api(`/api/items/${itemId}/evaluation`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  saveNote.textContent = "Saved";
  delete state.reviewDrafts[itemId];
  await loadBatch(state.selectedBatchId, itemId);
}

async function retryImage(itemId, kind) {
  captureReviewDraft(itemId);
  const key = imageKey(itemId, kind);
  state.retryingImages.add(key);
  render();
  try {
    const body = await api(`/api/items/${itemId}/images/${kind}/retry`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    if (body.retry?.fetchStatus === "success") {
      delete state.imageLoadFailures[key];
      delete state.imageSizes[itemId];
    } else {
      state.imageLoadFailures[key] = body.retry?.fetchError || "Image retry failed.";
    }
    await loadBatch(state.selectedBatchId, itemId);
  } finally {
    state.retryingImages.delete(key);
    render();
  }
}

async function loadBatches() {
  const body = await api("/api/batches");
  state.batches = body.batches;
  if (!state.selectedBatchId && state.batches.length) {
    state.selectedBatchId = state.batches[0].id;
  }
  renderBatchSelect();
}

async function loadBatch(batchId, keepSelectedItemId = "", options = {}) {
  if (!batchId) {
    state.items = [];
    state.stats = null;
    render();
    return;
  }
  state.selectedBatchId = batchId;
  if (options.resetFilters) {
    state.filters = {
      model: "all",
      status: "all",
      search: "",
    };
    els.searchInput.value = "";
    els.statusFilter.value = "all";
  }
  const previousSelectedItemId = state.selectedItemId;
  const [itemsBody, statsBody] = await Promise.all([
    api(`/api/batches/${batchId}/items`),
    api(`/api/batches/${batchId}/stats`),
  ]);
  state.items = itemsBody.items;
  state.stats = statsBody.stats;
  const visible = filteredItems();
  state.selectedItemId =
    keepSelectedItemId && state.items.some((item) => item.id === keepSelectedItemId)
      ? keepSelectedItemId
      : visible[0]?.id || state.items[0]?.id || "";
  if (state.selectedItemId !== previousSelectedItemId) {
    resetOverlayState();
  }
  await loadBatches();
  render();
}

function render() {
  renderBatchSelect();
  renderMetrics();
  renderFilters();
  renderItemList();
  renderReviewPane();
  renderStats();
}

async function importBatch() {
  els.importButton.disabled = true;
  els.importButton.textContent = "Importing...";
  try {
    const body = await api("/api/import", {
      method: "POST",
      body: JSON.stringify({ downloadImages: true }),
    });
    state.selectedBatchId = body.batch.id;
    await loadBatch(body.batch.id);
  } finally {
    els.importButton.disabled = false;
    els.importButton.textContent = "Import Resource";
  }
}

function jumpToNextUnreviewed() {
  const visible = filteredItems();
  const currentIndex = visible.findIndex((item) => item.id === state.selectedItemId);
  const next = visible
    .slice(Math.max(currentIndex + 1, 0))
    .concat(visible.slice(0, Math.max(currentIndex + 1, 0)))
    .find((item) => !isReviewed(item));
  if (next) {
    state.selectedItemId = next.id;
    render();
  }
}

function openImage(src, alt) {
  els.dialogImage.src = src;
  els.dialogImage.alt = alt || "";
  els.imageDialog.showModal();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

els.batchSelect.addEventListener("change", () => {
  loadBatch(els.batchSelect.value, "", { resetFilters: true }).catch(showFatalError);
});

els.importButton.addEventListener("click", () => {
  importBatch().catch((error) => {
    alert(error.message);
  });
});

els.modelFilter.addEventListener("change", () => {
  state.filters.model = els.modelFilter.value;
  state.selectedItemId = filteredItems()[0]?.id || "";
  render();
});

els.statusFilter.addEventListener("change", () => {
  state.filters.status = els.statusFilter.value;
  state.selectedItemId = filteredItems()[0]?.id || "";
  render();
});

els.searchInput.addEventListener("input", () => {
  state.filters.search = els.searchInput.value;
  state.selectedItemId = filteredItems()[0]?.id || "";
  render();
});

els.nextUnreviewedButton.addEventListener("click", jumpToNextUnreviewed);
els.closeDialogButton.addEventListener("click", () => els.imageDialog.close());

function showFatalError(error) {
  els.reviewPane.innerHTML = `
    <div class="empty-state">
      <div>
        <h2>Unable to load</h2>
        <p>${escapeHtml(error.message)}</p>
      </div>
    </div>
  `;
}

await loadBatches();
if (state.selectedBatchId) {
  await loadBatch(state.selectedBatchId).catch(showFatalError);
} else {
  render();
}
