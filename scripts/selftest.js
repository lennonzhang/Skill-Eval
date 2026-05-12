import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  createBatch,
  getBatchStats,
  getDatabase,
  getItemsForBatch,
  insertItem,
  saveEvaluation,
  updateBatchCounts,
  updateSingleImageCacheStatus,
} from "../src/db.js";
import { calculateOverallScore, EvaluationValidationError, validateEvaluationInput } from "../public/scoring.js";

const db = getDatabase();
const testBatchId = `selftest-batch-${randomUUID()}`;
const testItemId = `selftest-item-${randomUUID()}`;
const now = new Date().toISOString();
const beforeRollback = getBatchStats(testBatchId).summary;

assert.equal(beforeRollback.total_items, 0);
assert.equal(beforeRollback.reviewed_items, 0);

db.exec("BEGIN");
try {
  createBatch({
    id: testBatchId,
    name: "Selftest synthetic batch",
    sourceDir: "selftest",
    importedAt: now,
  });
  insertItem({
    id: testItemId,
    batchId: testBatchId,
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
    createdAt: now,
  });

  updateBatchCounts(testBatchId);
  let testStats = getBatchStats(testBatchId).summary;
  assert.equal(testStats.total_items, 1);
  assert.equal(testStats.reviewed_items, 0);
  assert.equal(testStats.cached_source_images, 0);
  assert.equal(testStats.cached_result_images, 1);

  const evaluation = saveEvaluation(testItemId, {
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

  testStats = getBatchStats(testBatchId).summary;
  assert.equal(testStats.reviewed_items, 1);

  updateSingleImageCacheStatus(testItemId, "source", {
    imagePath: "data/cache/selftest/source.png",
    fetchStatus: "success",
    fetchError: null,
  });
  updateBatchCounts(testBatchId);

  let testItem = getItemsForBatch(testBatchId)[0];
  assert.equal(testItem.source_fetch_status, "success");
  assert.equal(testItem.source_fetch_error, null);
  assert.equal(testItem.source_image_url, "/data/cache/selftest/source.png");
  assert.equal(testItem.result_fetch_status, "success");
  assert.equal(testItem.result_image_path, "data/cache/selftest/result.png");

  testStats = getBatchStats(testBatchId).summary;
  assert.equal(testStats.cached_source_images, 1);
  assert.equal(testStats.cached_result_images, 1);

  updateSingleImageCacheStatus(testItemId, "result", {
    imagePath: testItem.result_image_path,
    fetchStatus: "failed",
    fetchError: "retry result failure",
  });
  updateBatchCounts(testBatchId);

  testItem = getItemsForBatch(testBatchId)[0];
  assert.equal(testItem.source_fetch_status, "success");
  assert.equal(testItem.source_image_path, "data/cache/selftest/source.png");
  assert.equal(testItem.result_fetch_status, "failed");
  assert.equal(testItem.result_image_path, "data/cache/selftest/result.png");
  assert.equal(testItem.result_fetch_error, "retry result failure");

  testStats = getBatchStats(testBatchId).summary;
  assert.equal(testStats.cached_source_images, 1);
  assert.equal(testStats.cached_result_images, 0);
  assert.throws(
    () =>
      updateSingleImageCacheStatus(testItemId, "thumbnail", {
        imagePath: null,
        fetchStatus: "failed",
        fetchError: "bad kind",
      }),
    /Invalid image kind/
  );
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

const afterRollback = getBatchStats(testBatchId).summary;
assert.equal(afterRollback.total_items, 0);
assert.equal(afterRollback.reviewed_items, 0);

console.log(
  JSON.stringify(
    {
      ok: true,
      batch: testBatchId,
      item: testItemId,
      reviewedBeforeRollback: beforeRollback.reviewed_items,
      reviewedAfterRollback: afterRollback.reviewed_items,
      retryCacheUpdate: "passed",
    },
    null,
    2
  )
);
