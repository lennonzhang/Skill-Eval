import assert from "node:assert/strict";

import {
  ITEM_ROW_HEIGHT,
  hasAdvancedReviewFilters,
  normalizeTaskCard,
  normalizeReviewFilters,
  readReviewUrlState,
  reviewItemQueryParamsFromFilters,
  reviewUrlParamsFromState,
  targetScrollTopForIndex,
  taskProgressPercent,
  virtualWindow,
} from "../public/review-utils.js";

const firstWindow = virtualWindow({
  total: 100,
  scrollTop: 0,
  viewportHeight: ITEM_ROW_HEIGHT * 5,
  overscan: 2,
});
assert.deepEqual(firstWindow, {
  startIndex: 0,
  endIndex: 9,
  beforeHeight: 0,
  windowHeight: ITEM_ROW_HEIGHT * 9,
  totalHeight: ITEM_ROW_HEIGHT * 100,
});

const middleWindow = virtualWindow({
  total: 100,
  scrollTop: ITEM_ROW_HEIGHT * 50,
  viewportHeight: ITEM_ROW_HEIGHT * 5,
  overscan: 2,
});
assert.equal(middleWindow.startIndex, 48);
assert.equal(middleWindow.endIndex, 57);
assert.equal(middleWindow.beforeHeight, ITEM_ROW_HEIGHT * 48);

assert.equal(
  targetScrollTopForIndex({
    index: 99,
    total: 100,
    viewportHeight: ITEM_ROW_HEIGHT * 5,
  }),
  ITEM_ROW_HEIGHT * 95
);
assert.equal(targetScrollTopForIndex({ index: -1, total: 0, viewportHeight: 100 }), 0);

const urlState = readReviewUrlState(
  "?batch=batch-1&item=item-2&model=gemini&status=needs_recheck&q=shoe&scoreMax=2.5&tagIncludes=product_changed,artifact&tagExcludes=excellent&reviewer=alice&pcDelta=2&cache=failed&lang=zh&archived=1"
);
assert.deepEqual(urlState, {
  batchId: "batch-1",
  itemId: "item-2",
  model: "gemini",
  status: "needs_recheck",
  search: "shoe",
  filters: {
    model: "gemini",
    status: "needs_recheck",
    search: "shoe",
    scoreMin: "",
    scoreMax: "2.5",
    tagIncludes: ["product_changed", "artifact"],
    tagExcludes: ["excellent"],
    reviewer: "alice",
    productCheckDeltaMin: "2",
    cacheStatus: "failed",
  },
  language: "zh",
  includeArchived: true,
});

const params = reviewUrlParamsFromState({
  selectedBatchId: "batch-1",
  selectedItemId: "item-2",
  filters: {
    model: "gemini",
    status: "needs_recheck",
    search: "shoe",
    scoreMax: "2.5",
    tagIncludes: ["product_changed", "artifact"],
    tagExcludes: ["excellent"],
    reviewer: "alice",
    productCheckDeltaMin: "2",
    cacheStatus: "failed",
  },
  language: "zh",
  showArchivedBatches: true,
});
assert.equal(
  params.toString(),
  "batch=batch-1&item=item-2&model=gemini&status=needs_recheck&q=shoe&scoreMax=2.5&tagIncludes=product_changed%2Cartifact&tagExcludes=excellent&reviewer=alice&pcDelta=2&cache=failed&lang=zh&archived=1"
);

assert.deepEqual(normalizeReviewFilters({ status: "bad", cacheStatus: "nope", scoreMin: "x", tagIncludes: "a,b" }), {
  model: "all",
  status: "all",
  search: "",
  scoreMin: "",
  scoreMax: "",
  tagIncludes: ["a", "b"],
  tagExcludes: [],
  reviewer: "",
  productCheckDeltaMin: "",
  cacheStatus: "all",
});
assert.equal(hasAdvancedReviewFilters({ tagIncludes: ["product_changed"] }), true);
assert.equal(hasAdvancedReviewFilters({ model: "gemini", status: "reviewed" }), false);
assert.equal(
  reviewItemQueryParamsFromFilters({ scoreMax: "2.5", tagIncludes: ["product_changed"], cacheStatus: "failed" }).toString(),
  "scoreMax=2.5&tagIncludes=product_changed&cacheStatus=failed"
);

const normalizedRunningTask = normalizeTaskCard({
  type: "product-check",
  batchId: "batch-1",
  status: "running",
  done: 2,
  total: 4,
  latestMessage: "Checking item",
});
assert.equal(normalizedRunningTask.id, "product-check-batch-1");
assert.equal(normalizedRunningTask.scope, "batch");
assert.equal(normalizedRunningTask.message, "Checking item");
assert.equal(taskProgressPercent(normalizedRunningTask), 50);

const normalizedFinishedTask = normalizeTaskCard({ type: "browser-cache", status: "finished", done: 3, total: 3 });
assert.equal(normalizedFinishedTask.status, "succeeded");
assert.equal(taskProgressPercent(normalizedFinishedTask), 100);

const normalizedStaleTask = normalizeTaskCard({ type: "import", status: "stale", done: 1, total: 0 });
assert.equal(normalizedStaleTask.status, "failed");
assert.equal(normalizedStaleTask.total, 1);

console.log("review-utils selftest passed");
