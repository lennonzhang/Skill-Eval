export const ITEM_ROW_HEIGHT = 92;
export const ITEM_OVERSCAN = 8;

export const validStatusFilters = new Set(["all", "active", "unreviewed", "reviewed", "needs_recheck", "failed", "excluded"]);
export const validCacheStatusFilters = new Set(["all", "cached", "failed", "missing", "source_failed", "result_failed"]);
export const validLanguages = new Set(["en", "zh"]);

function listFromParam(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function numberParam(value) {
  if (value === null || value === undefined || value === "") return "";
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : "";
}

export function normalizeReviewFilters(input = {}) {
  const status = String(input.status || "");
  const cacheStatus = String(input.cacheStatus || input.cache || "");
  return {
    model: String(input.model || "all") || "all",
    status: validStatusFilters.has(status) ? status : "all",
    search: String(input.search || input.q || ""),
    scoreMin: numberParam(input.scoreMin),
    scoreMax: numberParam(input.scoreMax),
    tagIncludes: Array.isArray(input.tagIncludes) ? input.tagIncludes.filter(Boolean) : listFromParam(input.tagIncludes),
    tagExcludes: Array.isArray(input.tagExcludes) ? input.tagExcludes.filter(Boolean) : listFromParam(input.tagExcludes),
    reviewer: String(input.reviewer || ""),
    productCheckDeltaMin: numberParam(input.productCheckDeltaMin),
    cacheStatus: validCacheStatusFilters.has(cacheStatus) ? cacheStatus : "all",
  };
}

export function virtualWindow({ total, scrollTop, viewportHeight, rowHeight = ITEM_ROW_HEIGHT, overscan = ITEM_OVERSCAN }) {
  const safeTotal = Math.max(0, Math.floor(Number(total) || 0));
  const safeRowHeight = Math.max(1, Math.floor(Number(rowHeight) || ITEM_ROW_HEIGHT));
  const safeViewportHeight = Math.max(0, Math.floor(Number(viewportHeight) || 0));
  const safeScrollTop = Math.max(0, Math.floor(Number(scrollTop) || 0));
  const safeOverscan = Math.max(0, Math.floor(Number(overscan) || 0));

  if (safeTotal === 0) {
    return {
      startIndex: 0,
      endIndex: 0,
      beforeHeight: 0,
      windowHeight: 0,
      totalHeight: 0,
    };
  }

  const visibleCount = Math.max(1, Math.ceil(safeViewportHeight / safeRowHeight));
  const startIndex = Math.max(0, Math.floor(safeScrollTop / safeRowHeight) - safeOverscan);
  const endIndex = Math.min(safeTotal, startIndex + visibleCount + safeOverscan * 2);

  return {
    startIndex,
    endIndex,
    beforeHeight: startIndex * safeRowHeight,
    windowHeight: (endIndex - startIndex) * safeRowHeight,
    totalHeight: safeTotal * safeRowHeight,
  };
}

export function targetScrollTopForIndex({ index, total, viewportHeight, rowHeight = ITEM_ROW_HEIGHT }) {
  const safeTotal = Math.max(0, Math.floor(Number(total) || 0));
  const safeIndex = Math.max(0, Math.min(safeTotal - 1, Math.floor(Number(index) || 0)));
  const safeRowHeight = Math.max(1, Math.floor(Number(rowHeight) || ITEM_ROW_HEIGHT));
  const safeViewportHeight = Math.max(0, Math.floor(Number(viewportHeight) || 0));
  const maxScrollTop = Math.max(0, safeTotal * safeRowHeight - safeViewportHeight);
  const centered = safeIndex * safeRowHeight - safeViewportHeight / 2 + safeRowHeight / 2;
  return Math.max(0, Math.min(maxScrollTop, Math.round(centered)));
}

export function readReviewUrlState(searchParams) {
  const params = searchParams instanceof URLSearchParams ? searchParams : new URLSearchParams(searchParams || "");
  const status = params.get("status") || "";
  const language = params.get("lang") || "";
  const filters = normalizeReviewFilters({
    model: params.get("model") || "all",
    status,
    search: params.get("q") || "",
    scoreMin: params.get("scoreMin") || "",
    scoreMax: params.get("scoreMax") || "",
    tagIncludes: params.get("tagIncludes") || "",
    tagExcludes: params.get("tagExcludes") || "",
    reviewer: params.get("reviewer") || "",
    productCheckDeltaMin: params.get("pcDelta") || "",
    cacheStatus: params.get("cache") || "all",
  });
  return {
    batchId: params.get("batch") || "",
    itemId: params.get("item") || "",
    model: filters.model,
    status: filters.status,
    search: filters.search,
    filters,
    language: validLanguages.has(language) ? language : "",
    includeArchived: params.get("archived") === "1",
  };
}

export function reviewUrlParamsFromState(state) {
  const params = new URLSearchParams();
  const filters = normalizeReviewFilters(state.filters || {});
  if (state.selectedBatchId) params.set("batch", state.selectedBatchId);
  if (state.selectedItemId) params.set("item", state.selectedItemId);
  if (filters.model && filters.model !== "all") params.set("model", filters.model);
  if (filters.status && filters.status !== "all") params.set("status", filters.status);
  if (filters.search) params.set("q", filters.search);
  if (filters.scoreMin) params.set("scoreMin", filters.scoreMin);
  if (filters.scoreMax) params.set("scoreMax", filters.scoreMax);
  if (filters.tagIncludes.length) params.set("tagIncludes", filters.tagIncludes.join(","));
  if (filters.tagExcludes.length) params.set("tagExcludes", filters.tagExcludes.join(","));
  if (filters.reviewer) params.set("reviewer", filters.reviewer);
  if (filters.productCheckDeltaMin) params.set("pcDelta", filters.productCheckDeltaMin);
  if (filters.cacheStatus && filters.cacheStatus !== "all") params.set("cache", filters.cacheStatus);
  if (state.language && state.language !== "en") params.set("lang", state.language);
  if (state.showArchivedBatches) params.set("archived", "1");
  return params;
}

export function reviewItemQueryParamsFromFilters(filtersInput = {}) {
  const filters = normalizeReviewFilters(filtersInput);
  const params = new URLSearchParams();
  if (filters.model !== "all") params.set("model", filters.model);
  if (filters.status !== "all") params.set("status", filters.status);
  if (filters.search) params.set("q", filters.search);
  if (filters.scoreMin) params.set("scoreMin", filters.scoreMin);
  if (filters.scoreMax) params.set("scoreMax", filters.scoreMax);
  if (filters.tagIncludes.length) params.set("tagIncludes", filters.tagIncludes.join(","));
  if (filters.tagExcludes.length) params.set("tagExcludes", filters.tagExcludes.join(","));
  if (filters.reviewer) params.set("reviewer", filters.reviewer);
  if (filters.productCheckDeltaMin) params.set("productCheckDeltaMin", filters.productCheckDeltaMin);
  if (filters.cacheStatus !== "all") params.set("cacheStatus", filters.cacheStatus);
  return params;
}

export function hasAdvancedReviewFilters(filtersInput = {}) {
  const filters = normalizeReviewFilters(filtersInput);
  return Boolean(
    filters.scoreMin ||
      filters.scoreMax ||
      filters.tagIncludes.length ||
      filters.tagExcludes.length ||
      filters.reviewer ||
      filters.productCheckDeltaMin ||
      filters.cacheStatus !== "all"
  );
}

export function normalizeTaskCard(taskLike) {
  if (!taskLike || typeof taskLike !== "object") return null;
  const done = Math.max(0, Number(taskLike.done || taskLike.summary?.done || 0));
  const total = Math.max(done, Number(taskLike.total || taskLike.summary?.total || 0));
  const status = taskLike.status === "finished" ? "succeeded" : taskLike.status === "stale" ? "failed" : taskLike.status || "running";
  return {
    id: taskLike.id || `${taskLike.type || "task"}-${taskLike.batchId || "local"}`,
    type: taskLike.type || "task",
    scope: taskLike.scope || (taskLike.batchId ? "batch" : "global"),
    batchId: taskLike.batchId || null,
    status,
    done,
    total,
    message: taskLike.message || taskLike.latestMessage || "",
    error: taskLike.error || "",
    summary: taskLike.summary || {},
    startedAt: taskLike.startedAt || null,
    updatedAt: taskLike.updatedAt || null,
    finishedAt: taskLike.finishedAt || null,
    raw: taskLike,
  };
}

export function taskProgressPercent(task) {
  const total = Math.max(0, Number(task?.total || 0));
  if (!total) return 0;
  const done = Math.max(0, Number(task?.done || 0));
  return Math.max(0, Math.min(100, (done / total) * 100));
}
