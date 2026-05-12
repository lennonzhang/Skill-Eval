import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  createBatch,
  getBatchStats,
  getBatches,
  getDatabase,
  getItemsForBatch,
  insertItem,
  saveEvaluation,
  updateBatchCounts,
  updateSingleImageCacheStatus,
} from "../src/db.js";
import { calculateOverallScore, EvaluationValidationError, validateEvaluationInput } from "../public/scoring.js";

const db = getDatabase();
const batch = getBatches()[0];

if (!batch) {
  throw new Error("No batch found. Run pnpm run import:resource first.");
}

const item = getItemsForBatch(batch.id)[0];
if (!item) {
  throw new Error(`Batch ${batch.id} has no items.`);
}

const before = getBatchStats(batch.id).summary.reviewed_items;

db.exec("BEGIN");
try {
  const evaluation = saveEvaluation(item.id, {
    product_preservation_score: 5,
    instruction_adherence_score: 4,
    integration_grounding_score: 3,
    prompt_optimization_value_score: 2,
    commercial_quality_score: 1,
    technical_safety_score: 5,
    status: "reviewed",
    tags: ["excellent"],
    comment: "rollback selftest",
  });

  assert.equal(evaluation.overall_score, 3.45);
  assert.deepEqual(evaluation.tags, ["excellent"]);

  const during = getBatchStats(batch.id).summary.reviewed_items;
  assert.equal(during, item.overall_score == null ? before + 1 : before);
} finally {
  db.exec("ROLLBACK");
}

assert.equal(
  calculateOverallScore({
    product_preservation_score: 2,
    instruction_adherence_score: 5,
    integration_grounding_score: 5,
    prompt_optimization_value_score: 5,
    commercial_quality_score: 5,
    technical_safety_score: 5,
  }),
  2.5
);
assert.equal(
  calculateOverallScore({
    product_preservation_score: 5,
    instruction_adherence_score: 2,
    integration_grounding_score: 5,
    prompt_optimization_value_score: 5,
    commercial_quality_score: 5,
    technical_safety_score: 5,
  }),
  3
);
assert.equal(
  calculateOverallScore({
    product_preservation_score: 5,
    instruction_adherence_score: 5,
    integration_grounding_score: 5,
    prompt_optimization_value_score: 5,
    commercial_quality_score: 5,
    technical_safety_score: 1,
  }),
  2
);
assert.throws(
  () =>
    validateEvaluationInput({
      product_preservation_score: 5,
      instruction_adherence_score: 4,
      integration_grounding_score: 3,
      prompt_optimization_value_score: 2,
      commercial_quality_score: 1,
      status: "reviewed",
      tags: ["excellent"],
      comment: "",
    }),
  EvaluationValidationError
);

const after = getBatchStats(batch.id).summary.reviewed_items;
assert.equal(after, before);

const retryBatchId = `selftest-retry-${randomUUID()}`;
const retryItemId = `selftest-item-${randomUUID()}`;

db.exec("BEGIN");
try {
  createBatch({
    id: retryBatchId,
    name: "Selftest retry batch",
    sourceDir: "selftest",
    importedAt: new Date().toISOString(),
  });
  insertItem({
    id: retryItemId,
    batchId: retryBatchId,
    rawJsonFile: "selftest.json",
    rawIndex: 0,
    model: "selftest-model",
    text: "selftest source prompt",
    url: "https://example.test/source.png",
    resultUrl: "https://example.test/result.png",
    optimizationPrompt: "selftest optimized prompt",
    sourceImagePath: null,
    resultImagePath: "data/cache/selftest/result.png",
    sourceFetchStatus: "failed",
    resultFetchStatus: "success",
    sourceFetchError: "initial source failure",
    resultFetchError: null,
    importKey: randomUUID(),
    createdAt: new Date().toISOString(),
  });

  updateBatchCounts(retryBatchId);
  let retryStats = getBatchStats(retryBatchId).summary;
  assert.equal(retryStats.cached_source_images, 0);
  assert.equal(retryStats.cached_result_images, 1);

  updateSingleImageCacheStatus(retryItemId, "source", {
    imagePath: "data/cache/selftest/source.png",
    fetchStatus: "success",
    fetchError: null,
  });
  updateBatchCounts(retryBatchId);

  let retryItem = getItemsForBatch(retryBatchId)[0];
  assert.equal(retryItem.source_fetch_status, "success");
  assert.equal(retryItem.source_fetch_error, null);
  assert.equal(retryItem.source_image_url, "/data/cache/selftest/source.png");
  assert.equal(retryItem.result_fetch_status, "success");
  assert.equal(retryItem.result_image_path, "data/cache/selftest/result.png");

  retryStats = getBatchStats(retryBatchId).summary;
  assert.equal(retryStats.cached_source_images, 1);
  assert.equal(retryStats.cached_result_images, 1);

  updateSingleImageCacheStatus(retryItemId, "result", {
    imagePath: retryItem.result_image_path,
    fetchStatus: "failed",
    fetchError: "retry result failure",
  });
  updateBatchCounts(retryBatchId);

  retryItem = getItemsForBatch(retryBatchId)[0];
  assert.equal(retryItem.source_fetch_status, "success");
  assert.equal(retryItem.source_image_path, "data/cache/selftest/source.png");
  assert.equal(retryItem.result_fetch_status, "failed");
  assert.equal(retryItem.result_image_path, "data/cache/selftest/result.png");
  assert.equal(retryItem.result_fetch_error, "retry result failure");

  retryStats = getBatchStats(retryBatchId).summary;
  assert.equal(retryStats.cached_source_images, 1);
  assert.equal(retryStats.cached_result_images, 0);
  assert.throws(
    () =>
      updateSingleImageCacheStatus(retryItemId, "thumbnail", {
        imagePath: null,
        fetchStatus: "failed",
        fetchError: "bad kind",
      }),
    /Invalid image kind/
  );
} finally {
  db.exec("ROLLBACK");
}

console.log(
  JSON.stringify(
    {
      ok: true,
      batch: batch.id,
      item: item.id,
      reviewedBefore: before,
      reviewedAfterRollback: after,
      retryCacheUpdate: "passed",
    },
    null,
    2
  )
);
