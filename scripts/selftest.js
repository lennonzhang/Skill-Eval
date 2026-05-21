import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { importResourceBatch, importUploadedJsonBatch, preflightUploadedJson } from "../src/importer.js";
import { reportsDir } from "../src/paths.js";
import {
  archiveBatch,
  createBatch,
  deleteBatchRecord,
  getBatchById,
  getBatchDeleteCounts,
  getBatchBySourceDigest,
  getBatchStats,
  getBatches,
  getDatabase,
  getAuditEvents,
  getAnnotationsForItem,
  getItemsForBatch,
  insertItem,
  migrateEvaluationSchema,
  recordAuditEvent,
  restoreBatch,
  saveEvaluation,
  setItemExclusion,
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
const secondTestItemId = `selftest-item-${randomUUID()}`;
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
  const defaultBatchIds = getBatches().map((batch) => batch.id);
  assert.ok(defaultBatchIds.includes(testBatchId));
  const archivedBatch = archiveBatch(testBatchId, { reason: "other", note: "selftest archive" });
  assert.equal(archivedBatch.archive_reason, "other");
  assert.ok(archivedBatch.archived_at);
  assert.equal(getBatches().some((batch) => batch.id === testBatchId), false);
  assert.equal(getBatches({ includeArchived: true }).some((batch) => batch.id === testBatchId), true);
  const restoredBatch = restoreBatch(testBatchId);
  assert.equal(restoredBatch.archived_at, null);
  assert.ok(getBatches().some((batch) => batch.id === testBatchId));
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
  insertItem({
    id: secondTestItemId,
    batchId: testBatchId,
    rawJsonFile: "selftest.json",
    rawIndex: 1,
    model: "selftest-model",
    text: "selftest second source prompt",
    url: "https://example.test/source-2.png",
    resultUrl: "https://example.test/result-2.png",
    optimizationPrompt: "selftest second optimized prompt",
    sourceImagePath: null,
    resultImagePath: "data/cache/selftest/result-2.png",
    sourceFetchStatus: "failed",
    resultFetchStatus: "success",
    sourceFetchError: "initial source failure",
    resultFetchError: null,
    importKey: randomUUID(),
    createdAt: now,
  });

  updateBatchCounts(testBatchId);
  let testStats = getBatchStats(testBatchId).summary;
  assert.equal(testStats.total_items, 2);
  assert.equal(testStats.all_items, 2);
  assert.equal(testStats.excluded_items, 0);
  assert.equal(testStats.reviewed_items, 0);
  assert.equal(testStats.cached_source_images, 0);
  assert.equal(testStats.cached_result_images, 2);

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
    reviewer: { id: "selftest-reviewer", name: "Selftest Reviewer" },
  });

  assert.equal(evaluation.overall_score, 3.45);
  assert.deepEqual(evaluation.tags, ["excellent"]);
  assert.equal(evaluation.reviewer_id, "selftest-reviewer");
  assert.equal(evaluation.reviewer_name, "Selftest Reviewer");
  assert.ok(evaluation.annotationId);

  const annotations = getAnnotationsForItem(testItemId);
  assert.equal(annotations.length, 1);
  assert.equal(annotations[0].id, evaluation.annotationId);
  assert.equal(annotations[0].reviewerId, "selftest-reviewer");
  assert.equal(annotations[0].scores.product_preservation_score, 5);
  assert.deepEqual(annotations[0].tags, ["excellent"]);

  const updatedEvaluation = saveEvaluation(testItemId, {
    product_preservation_score: 4,
    instruction_adherence_score: 4,
    integration_grounding_score: 4,
    prompt_optimization_value_score: 4,
    commercial_quality_score: 4,
    technical_safety_score: 4,
    status: "reviewed",
    tags: ["artifact"],
    comment: "rollback selftest update",
    reviewer: { id: "second-reviewer", name: "Second Reviewer" },
  });
  assert.equal(updatedEvaluation.overall_score, 4);
  assert.equal(updatedEvaluation.reviewer_id, "second-reviewer");
  const annotationHistory = getAnnotationsForItem(testItemId);
  assert.equal(annotationHistory.length, 2);
  assert.equal(annotationHistory[0].id, updatedEvaluation.annotationId);
  assert.equal(annotationHistory[0].reviewerId, "second-reviewer");
  assert.equal(annotationHistory[1].id, evaluation.annotationId);
  const latestItem = getItemsForBatch(testBatchId).find((item) => item.id === testItemId);
  assert.equal(latestItem.overall_score, 4);
  assert.equal(latestItem.reviewer_id, "second-reviewer");

  testStats = getBatchStats(testBatchId).summary;
  assert.equal(testStats.reviewed_items, 1);
  assert.deepEqual(getBatchDeleteCounts(testBatchId), { items: 2, evaluations: 1, annotations: 2 });

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
  assert.equal(testStats.cached_result_images, 2);

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
  assert.equal(testStats.cached_result_images, 1);
  assert.throws(
    () =>
      updateSingleImageCacheStatus(testItemId, "thumbnail", {
        imagePath: null,
        fetchStatus: "failed",
        fetchError: "bad kind",
      }),
    /Invalid image kind/
  );

  let byModel = getBatchStats(testBatchId).by_model[0];
  assert.equal(byModel.total_items, 2);
  assert.equal(byModel.reviewed_items, 1);
  assert.deepEqual(getBatchStats(testBatchId).tag_counts, [{ tag: "artifact", count: 1 }]);

  const excludedItem = setItemExclusion(testItemId, {
    excluded: true,
    reason: "internal_test",
    note: "exclude from selftest stats",
  });
  assert.equal(excludedItem.is_excluded, 1);
  assert.equal(excludedItem.exclude_reason, "internal_test");
  assert.equal(excludedItem.exclude_note, "exclude from selftest stats");

  const orderedItems = getItemsForBatch(testBatchId);
  assert.equal(orderedItems.length, 2);
  assert.equal(orderedItems[0].id, secondTestItemId);
  assert.equal(orderedItems[1].id, testItemId);
  assert.equal(orderedItems[1].is_excluded, 1);

  testStats = getBatchStats(testBatchId).summary;
  assert.equal(testStats.total_items, 1);
  assert.equal(testStats.excluded_items, 1);
  assert.equal(testStats.all_items, 2);
  assert.equal(testStats.reviewed_items, 0);
  assert.equal(testStats.cached_source_images, 0);
  assert.equal(testStats.cached_result_images, 1);
  byModel = getBatchStats(testBatchId).by_model[0];
  assert.equal(byModel.total_items, 1);
  assert.equal(byModel.reviewed_items, 0);
  assert.deepEqual(getBatchStats(testBatchId).tag_counts, []);

  assert.throws(
    () =>
      setItemExclusion(secondTestItemId, {
        excluded: true,
        reason: "not-a-real-reason",
        note: "",
      }),
    /Invalid exclude reason/
  );
  assert.throws(
    () =>
      setItemExclusion(secondTestItemId, {
        excluded: true,
        reason: "other",
        note: "x".repeat(501),
      }),
    /500 characters or less/
  );

  const restoredItem = setItemExclusion(testItemId, { excluded: false });
  assert.equal(restoredItem.is_excluded, 0);
  testStats = getBatchStats(testBatchId).summary;
  assert.equal(testStats.total_items, 2);
  assert.equal(testStats.excluded_items, 0);
  assert.equal(testStats.reviewed_items, 1);

  const reportPath = path.join(reportsDir, `selftest-report-${randomUUID()}.json`);
  const sanitizedReport = {
    schemaVersion: "1",
    generatedAt: now,
    sanitized: true,
    batch: {
      id: testBatchId,
      sourceSha256: "sha256:selftest",
      contentSha256: "sha256:selftest-content",
    },
    summary: getBatchStats(testBatchId).summary,
    evaluations: getItemsForBatch(testBatchId).map((item) => ({
      itemId: item.id,
      rawJsonFile: item.raw_json_file,
      rawIndex: item.raw_index,
      model: item.model,
      overallScore: item.overall_score ?? null,
      tags: Array.isArray(item.tags) ? item.tags : [],
    })),
    excludedFields: ["text", "url", "resultUrl", "optimizationPrompt", "comment", "sourceImagePath", "resultImagePath"],
  };
  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(sanitizedReport, null, 2)}\n`, "utf8");
  const reportText = readFileSync(reportPath, "utf8");
  assert.equal(reportText.includes("selftest source prompt"), false);
  assert.equal(reportText.includes("https://example.test/source.png"), false);
  assert.equal(reportText.includes("rollback selftest"), false);
  unlinkSync(reportPath);

  const auditEvent = recordAuditEvent({
    eventType: "selftest.event",
    entityType: "batch",
    entityId: testBatchId,
    batchId: testBatchId,
    itemId: testItemId,
    payload: { count: 1, note: "rollback-safe audit" },
  });
  assert.equal(auditEvent.eventType, "selftest.event");
  assert.equal(auditEvent.payload.count, 1);
  const auditEvents = getAuditEvents({ batchId: testBatchId, limit: 5 });
  const selftestAuditEvent = auditEvents.find((event) => event.eventType === "selftest.event");
  assert.ok(selftestAuditEvent);
  assert.equal(selftestAuditEvent.itemId, testItemId);
  assert.deepEqual(selftestAuditEvent.payload, { count: 1, note: "rollback-safe audit" });
  const evaluationAuditEvents = auditEvents.filter((event) => event.eventType === "evaluation.save");
  assert.equal(evaluationAuditEvents.length, 2);
  assert.ok(evaluationAuditEvents.some((event) => event.payload.commentLength === "rollback selftest".length));
  assert.ok(evaluationAuditEvents.some((event) => event.payload.commentLength === "rollback selftest update".length));
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

const migrationDb = new DatabaseSync(":memory:");
migrationDb.exec(`
  CREATE TABLE evaluations (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL UNIQUE,
    product_preservation_score INTEGER NOT NULL,
    instruction_adherence_score INTEGER NOT NULL,
    integration_grounding_score INTEGER NOT NULL,
    prompt_optimization_value_score INTEGER NOT NULL,
    commercial_quality_score INTEGER NOT NULL,
    technical_safety_score INTEGER NOT NULL,
    overall_score REAL NOT NULL,
    status TEXT NOT NULL,
    tags TEXT NOT NULL,
    comment TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  INSERT INTO evaluations (
    id,
    item_id,
    product_preservation_score,
    instruction_adherence_score,
    integration_grounding_score,
    prompt_optimization_value_score,
    commercial_quality_score,
    technical_safety_score,
    overall_score,
    status,
    tags,
    comment,
    created_at,
    updated_at
  ) VALUES (
    'legacy-eval',
    'legacy-item',
    5,
    5,
    5,
    5,
    5,
    5,
    5,
    'reviewed',
    '["excellent"]',
    'keep me',
    '2026-01-01T00:00:00.000Z',
    '2026-01-01T00:00:00.000Z'
  );
`);
migrateEvaluationSchema(migrationDb);
const migratedColumns = migrationDb.prepare("PRAGMA table_info(evaluations)").all().map((column) => column.name);
assert.ok(migratedColumns.includes("reviewer_id"));
assert.ok(migratedColumns.includes("reviewer_name"));
const migratedEvaluation = migrationDb.prepare("SELECT id, comment FROM evaluations").get();
assert.equal(migratedEvaluation.id, "legacy-eval");
assert.equal(migratedEvaluation.comment, "keep me");
migrationDb.close();

const unsafeMigrationDb = new DatabaseSync(":memory:");
unsafeMigrationDb.exec(`
  CREATE TABLE evaluations (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL
  );
  INSERT INTO evaluations (id, item_id, status) VALUES ('unsafe-eval', 'unsafe-item', 'reviewed');
`);
assert.throws(() => migrateEvaluationSchema(unsafeMigrationDb), /Unsafe evaluations schema migration refused/);
const unsafeEvaluation = unsafeMigrationDb.prepare("SELECT id, status FROM evaluations").get();
assert.equal(unsafeEvaluation.id, "unsafe-eval");
assert.equal(unsafeEvaluation.status, "reviewed");
unsafeMigrationDb.close();

const afterRollback = getBatchStats(testBatchId).summary;
assert.equal(afterRollback.total_items, 0);
assert.equal(afterRollback.reviewed_items, 0);
assert.equal(getBatchById(testBatchId, { includeArchived: true }), null);
assert.equal(getAuditEvents({ batchId: testBatchId, limit: 5 }).length, 0);

db.exec("BEGIN");
try {
  const deleteBatchId = `selftest-delete-batch-${randomUUID()}`;
  const deleteItemId = `selftest-delete-item-${randomUUID()}`;
  createBatch({
    id: deleteBatchId,
    name: "Selftest delete batch",
    sourceDir: "selftest",
    sourceFile: "selftest-delete.json",
    importedAt: now,
  });
  insertItem({
    id: deleteItemId,
    batchId: deleteBatchId,
    rawJsonFile: "selftest-delete.json",
    rawIndex: 0,
    model: "selftest-model",
    text: "delete source prompt",
    url: "https://example.test/delete-source.png",
    resultUrl: "https://example.test/delete-result.png",
    optimizationPrompt: "delete optimized prompt",
    sourceImagePath: null,
    resultImagePath: null,
    sourceFetchStatus: "skipped",
    resultFetchStatus: "skipped",
    sourceFetchError: null,
    resultFetchError: null,
    importKey: randomUUID(),
    createdAt: now,
  });
  saveEvaluation(deleteItemId, {
    product_preservation_score: 5,
    instruction_adherence_score: 5,
    integration_grounding_score: 5,
    prompt_optimization_value_score: 5,
    commercial_quality_score: 5,
    technical_safety_score: 5,
    status: "reviewed",
    tags: ["excellent"],
    comment: "delete selftest",
  });
  assert.deepEqual(getBatchDeleteCounts(deleteBatchId), { items: 1, evaluations: 1, annotations: 1 });
  deleteBatchRecord(deleteBatchId);
  assert.equal(getBatchById(deleteBatchId, { includeArchived: true }), null);
  assert.equal(getItemsForBatch(deleteBatchId).length, 0);
} finally {
  db.exec("ROLLBACK");
}

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

db.exec("BEGIN");
try {
  const uploadContent = JSON.stringify([
    {
      provider: "selftest-upload-model",
      params: {
        content: [
          { text: "selftest uploaded prompt" },
          { url: "https://example.test/upload-source.png" },
        ],
      },
      optimizationPrompt: "selftest uploaded optimized prompt",
      resultUrl: "https://example.test/upload-result.png",
    },
  ]);
  const uploadPreflight = preflightUploadedJson({
    fileName: "selftest-upload.json",
    content: uploadContent,
  });
  assert.equal(uploadPreflight.source, "upload");
  assert.equal(uploadPreflight.sourceFile, "selftest-upload.json");
  assert.equal(uploadPreflight.totalRecords, 1);
  assert.equal(uploadPreflight.validRecords, 1);
  assert.equal(uploadPreflight.invalidRecords, 0);
  assert.ok(uploadPreflight.sourceDigest.startsWith("sha256:"));
  assert.ok(uploadPreflight.contentDigest.startsWith("sha256:"));
  assert.equal(uploadPreflight.importSchemaVersion, "1");

  const uploadResult = await importUploadedJsonBatch({
    fileName: "selftest-upload.json",
    content: uploadContent,
    sourceDigest: uploadPreflight.sourceDigest,
    downloadImages: false,
  });
  assert.equal(uploadResult.batch.sourceDir, "upload");
  assert.equal(uploadResult.batch.sourceFile, "selftest-upload.json");
  assert.equal(uploadResult.batch.sourceSha256, uploadPreflight.sourceDigest);
  assert.equal(uploadResult.batch.sourceSizeBytes, Buffer.byteLength(uploadContent, "utf8"));
  assert.equal(uploadResult.batch.contentSha256, uploadPreflight.contentDigest);
  assert.equal(uploadResult.batch.importSchemaVersion, "1");
  assert.equal(getBatchBySourceDigest(uploadPreflight.sourceDigest).some((batch) => batch.id === uploadResult.batch.id), true);
  assert.equal(uploadResult.parsed, 1);
  assert.equal(uploadResult.inserted, 1);
  const uploadedItem = getItemsForBatch(uploadResult.batch.id)[0];
  assert.equal(uploadedItem.model, "selftest-upload-model");
  assert.equal(uploadedItem.raw_json_file, "selftest-upload.json");
  assert.equal(uploadedItem.source_fetch_status, "skipped");
  assert.equal(existsSync(path.join(rootDir, "resource", "selftest-upload.json")), false);
  if (uploadResult.importRun) {
    const uploadImportRunPath = path.join(rootDir, uploadResult.importRun);
    if (existsSync(uploadImportRunPath)) unlinkSync(uploadImportRunPath);
  }

  const uploadWithBadItem = await importUploadedJsonBatch({
    fileName: "selftest-upload-bad.json",
    content: JSON.stringify([{ model: "missing-fields" }]),
    downloadImages: false,
  });
  assert.equal(uploadWithBadItem.parsed, 0);
  assert.equal(uploadWithBadItem.inserted, 0);
  assert.equal(uploadWithBadItem.errors.length, 1);
  if (uploadWithBadItem.importRun) {
    const badUploadImportRunPath = path.join(rootDir, uploadWithBadItem.importRun);
    if (existsSync(badUploadImportRunPath)) unlinkSync(badUploadImportRunPath);
  }

  await assert.rejects(
    () =>
      importUploadedJsonBatch({
        fileName: "selftest-upload.txt",
        content: "[]",
        downloadImages: false,
      }),
    /Resource file must be a JSON file/
  );
  await assert.rejects(
    () =>
      importUploadedJsonBatch({
        fileName: "selftest-upload.json",
        content: "{not-json",
        downloadImages: false,
      }),
    /not valid JSON/
  );
  await assert.rejects(
    () =>
      importUploadedJsonBatch({
        fileName: "selftest-upload.json",
        content: uploadContent,
        sourceDigest: "sha256:not-the-same",
        downloadImages: false,
      }),
    /Source changed after preflight/
  );
} finally {
  db.exec("ROLLBACK");
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
