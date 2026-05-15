import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { importResourceBatch } from "../src/importer.js";
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
import { fetchBinaryWithFallbacks, getConfiguredFetchProxies, getFetchTimeoutMs } from "../src/image-fetch.js";
import { createTask, finishTask, flushAllTasks, getLatestTask, getTask, updateTask } from "../src/tasks.js";
import { calculateOverallScore, EvaluationValidationError, validateEvaluationInput } from "../public/scoring.js";

const db = getDatabase();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const testBatchId = `selftest-batch-${randomUUID()}`;
const testItemId = `selftest-item-${randomUUID()}`;
const now = new Date().toISOString();
const importProgressEvents = [];
const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64"
);

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function runFetchProxySelftest() {
  let proxyRequests = 0;
  const proxy = http.createServer((req, res) => {
    proxyRequests += 1;
    assert.equal(req.method, "GET");
    assert.equal(req.url, "http://127.0.0.1:1/proxy-image.png");
    res.writeHead(200, {
      "content-type": "image/png",
      "content-length": onePixelPng.length,
    });
    res.end(onePixelPng);
  });

  await listen(proxy);
  const proxyUrl = `http://127.0.0.1:${proxy.address().port}`;
  try {
    assert.deepEqual(
      getConfiguredFetchProxies("https://example.test/image.png", {
        SKILL_EVAL_FETCH_PROXY: `${proxyUrl}, http://127.0.0.1:9`,
        HTTPS_PROXY: "http://127.0.0.1:9",
        NO_PROXY: "example.test",
      }),
      [new URL(proxyUrl).href, "http://127.0.0.1:9/"]
    );
    assert.equal(getFetchTimeoutMs({ SKILL_EVAL_FETCH_TIMEOUT_MS: "1500" }), 1500);

    const response = await fetchBinaryWithFallbacks("http://127.0.0.1:1/proxy-image.png", {
      proxyUrls: [proxyUrl],
      preferProxy: false,
      timeoutMs: 1000,
      maxBytes: 1024,
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.deepEqual(response.body, onePixelPng);
    assert.equal(proxyRequests, 1);
    assert.equal(response.attempts.length, 1);
    assert.equal(response.attempts[0].via, "direct");
  } finally {
    await closeServer(proxy);
  }
}
const beforeRollback = getBatchStats(testBatchId).summary;

assert.equal(beforeRollback.total_items, 0);
assert.equal(beforeRollback.reviewed_items, 0);

db.exec("BEGIN");
try {
  createBatch({
    id: testBatchId,
    name: "Selftest synthetic batch",
    sourceDir: "selftest",
    sourceFile: "selftest.json",
    importedAt: now,
  });
  const testBatch = db.prepare("SELECT source_file FROM batches WHERE id = ?").get(testBatchId);
  assert.equal(testBatch.source_file, "selftest.json");
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

await runFetchProxySelftest();

const selftestResourceFile = `selftest-import-${randomUUID()}.json`;
const selftestResourcePath = path.join(rootDir, "resource", selftestResourceFile);
let selftestImportRunPath = "";
mkdirSync(path.dirname(selftestResourcePath), { recursive: true });
writeFileSync(
  selftestResourcePath,
  JSON.stringify([
    {
      model: "selftest-model",
      text: "selftest prompt 1",
      url: "https://example.test/source-1.png",
      optimizationPrompt: "selftest optimized 1",
      resultUrl: "https://example.test/result-1.png",
    },
    {
      model: "selftest-model",
      text: "selftest prompt 2",
      url: "https://example.test/source-2.png",
      optimizationPrompt: "selftest optimized 2",
      resultUrl: "https://example.test/result-2.png",
    },
  ]),
  "utf8"
);
db.exec("BEGIN");
try {
  const importResult = await importResourceBatch({
    batchName: "Selftest no-images import",
    downloadImages: false,
    files: [selftestResourceFile],
    cacheWorkers: 2,
    onProgress: (event) => importProgressEvents.push(event),
  });
  selftestImportRunPath = path.join(rootDir, importResult.importRun);
  assert.equal(importResult.parsed, 2);
  assert.equal(importProgressEvents.some((event) => event.type === "import:cache-start"), true);
  assert.equal(importProgressEvents.filter((event) => event.type === "import:item").length, 2);
  assert.equal(importProgressEvents.at(-1)?.type, "import:finish");
  assert.equal(importProgressEvents.at(-1)?.cachedSource, 0);
} finally {
  db.exec("ROLLBACK");
  if (existsSync(selftestResourcePath)) unlinkSync(selftestResourcePath);
  if (selftestImportRunPath && existsSync(selftestImportRunPath)) unlinkSync(selftestImportRunPath);
}

const task = createTask("selftest", {
  batchId: testBatchId,
  status: "queued",
  summary: { inserted: 0 },
});
assert.equal(getTask(task.id).status, "queued");
updateTask(task.id, {
  status: "running",
  done: 1,
  total: 2,
  summary: { inserted: 1 },
});
let updatedTask = getTask(task.id);
assert.equal(updatedTask.status, "running");
assert.equal(updatedTask.done, 1);
assert.equal(updatedTask.summary.inserted, 1);
updateTask(task.id, {
  status: "running",
  done: 2,
  total: 3,
  summary: { inserted: 2 },
});
flushAllTasks();
updatedTask = getLatestTask({ type: "selftest", batchId: testBatchId });
assert.equal(updatedTask.done, 2);
assert.equal(updatedTask.total, 3);
finishTask(task.id, "succeeded", {
  done: 3,
  total: 3,
  summary: { inserted: 3 },
});
updatedTask = getLatestTask({ type: "selftest", batchId: testBatchId });
assert.equal(updatedTask.id, task.id);
assert.equal(updatedTask.status, "succeeded");
assert.equal(updatedTask.done, 3);

console.log(
  JSON.stringify(
    {
      ok: true,
      batch: testBatchId,
      item: testItemId,
      reviewedBeforeRollback: beforeRollback.reviewed_items,
      reviewedAfterRollback: afterRollback.reviewed_items,
      retryCacheUpdate: "passed",
      proxyFetchFallback: "passed",
      taskStatus: "passed",
    },
    null,
    2
  )
);
