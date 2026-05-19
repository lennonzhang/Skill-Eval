export const ITEM_ROW_HEIGHT = 92;
export const ITEM_OVERSCAN = 8;

export const validStatusFilters = new Set(["all", "active", "unreviewed", "reviewed", "excluded"]);
export const validLanguages = new Set(["en", "zh"]);

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
  return {
    batchId: params.get("batch") || "",
    itemId: params.get("item") || "",
    model: params.get("model") || "all",
    status: validStatusFilters.has(status) ? status : "all",
    search: params.get("q") || "",
    language: validLanguages.has(language) ? language : "",
    includeArchived: params.get("archived") === "1",
  };
}

export function reviewUrlParamsFromState(state) {
  const params = new URLSearchParams();
  if (state.selectedBatchId) params.set("batch", state.selectedBatchId);
  if (state.selectedItemId) params.set("item", state.selectedItemId);
  if (state.filters?.model && state.filters.model !== "all") params.set("model", state.filters.model);
  if (state.filters?.status && state.filters.status !== "all") params.set("status", state.filters.status);
  if (state.filters?.search) params.set("q", state.filters.search);
  if (state.language && state.language !== "en") params.set("lang", state.language);
  if (state.showArchivedBatches) params.set("archived", "1");
  return params;
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
