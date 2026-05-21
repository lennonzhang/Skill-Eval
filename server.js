import http from "node:http";
import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  archiveBatch,
  batchExists,
  deleteBatchRecord,
  getBatchById,
  getBatchDeleteCounts,
  getBatchBySourceDigest,
  getAuditEvents,
  getAnnotationsForItem,
  getBatchStats,
  getBatches,
  filterBatchItems,
  getItemById,
  getItemsForBatch,
  initializeDatabase,
  itemExists,
  recordAuditEvent,
  restoreBatch,
  saveEvaluation,
  setItemExclusion,
  updateBatchCounts,
} from "./src/db.js";
import {
  cacheBrowserUploadedImage,
  importResourceBatch,
  importUploadedJsonBatch,
  MAX_IMAGE_BYTES,
  MAX_UPLOAD_JSON_BYTES,
  normalizeResourceFileName,
  normalizeUploadedJsonFileName,
  preflightResourceJson,
  preflightUploadedJson,
  retryItemImage,
  listResourceJsonFiles,
} from "./src/importer.js";
import { createTask, finishTask, getLatestTask, getTask, updateTask } from "./src/tasks.js";
import { EvaluationValidationError } from "./public/scoring.js";
import { dataDir, databasePath, productChecksDir, resourceDir } from "./src/paths.js";

const REVIEWER_ID_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/;
const PUBLIC_CACHE_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".bmp"]);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const productCheckWorkers = Math.max(1, Math.floor(Number(process.env.PRODUCT_CHECK_WORKERS || 4)) || 4);
const importCacheWorkers = Math.max(1, Math.floor(Number(process.env.SKILL_EVAL_CACHE_WORKERS || 4)) || 4);
const LOG_LEVELS = new Map([
  ["silent", 0],
  ["warn", 1],
  ["info", 2],
  ["debug", 3],
]);
const logLevelName = LOG_LEVELS.has(process.env.SKILL_EVAL_LOG_LEVEL)
  ? process.env.SKILL_EVAL_LOG_LEVEL
  : process.env.SKILL_EVAL_TEST === "1"
    ? "warn"
    : "info";
const logLevel = LOG_LEVELS.get(logLevelName);
const productCheckJobs = new Map();
const productCheckBuffers = new Map();

initializeDatabase();

function listParam(searchParams, name) {
  return String(searchParams.get(name) || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseItemFilters(searchParams) {
  return {
    model: searchParams.get("model") || "all",
    status: searchParams.get("status") || "all",
    search: searchParams.get("q") || "",
    scoreMin: searchParams.get("scoreMin") || "",
    scoreMax: searchParams.get("scoreMax") || "",
    tagIncludes: listParam(searchParams, "tagIncludes"),
    tagExcludes: listParam(searchParams, "tagExcludes"),
    reviewer: searchParams.get("reviewer") || "",
    productCheckDeltaMin: searchParams.get("productCheckDeltaMin") || "",
    cacheStatus: searchParams.get("cacheStatus") || "all",
  };
}

function nowIso() {
  return new Date().toISOString();
}

function toCount(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function logSeverity(scope, event) {
  if (scope === "http" && event?.event === "request-rejected") {
    return "debug";
  }
  if (event?.error || event?.event === "failed" || event?.event === "task-failed" || String(event?.type || "").endsWith(":fail")) {
    return "warn";
  }
  const type = String(event?.type || event?.event || "");
  if (scope === "import" && ["import:cache-start", "import:item", "import:image-start", "import:image-finish"].includes(type)) {
    return "debug";
  }
  if (scope === "product-check" && event?.stream && event?.event === "product-check:item") {
    return "debug";
  }
  return "info";
}

function shouldLog(scope, event) {
  const severity = logSeverity(scope, event);
  return logLevel >= (LOG_LEVELS.get(severity) ?? LOG_LEVELS.get("info"));
}

function logEvent(scope, event) {
  if (!shouldLog(scope, event)) return;
  console.log(JSON.stringify({ at: nowIso(), scope, ...event }));
}

function sanitizeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function reviewerConfigPath() {
  return path.join(dataDir, "reviewer.json");
}

function normalizeReviewer(input, source = "config") {
  const id = String(input?.id || "").trim();
  const name = String(input?.name || "").trim();
  if (!id && !name) return { id: null, name: null, source: "none" };
  if (!REVIEWER_ID_PATTERN.test(id)) {
    const error = new Error("Reviewer id must be 1-64 characters: letters, numbers, dot, underscore, or dash");
    error.statusCode = 400;
    throw error;
  }
  if (name.length > 120) {
    const error = new Error("Reviewer name must be 120 characters or less");
    error.statusCode = 400;
    throw error;
  }
  return { id, name: name || id, source, locked: source === "env" };
}

function reviewerFromEnv() {
  const raw = String(process.env.SKILL_EVAL_REVIEWER || "").trim();
  if (!raw) return null;
  const separator = raw.indexOf(":");
  if (separator === -1) return normalizeReviewer({ id: raw, name: raw }, "env");
  return normalizeReviewer({ id: raw.slice(0, separator), name: raw.slice(separator + 1) }, "env");
}

function reviewerFromHeaders(req) {
  const id = String(req.headers["x-skill-eval-reviewer-id"] || "").trim();
  let name = String(req.headers["x-skill-eval-reviewer-name"] || "").trim();
  if (name) {
    try {
      name = decodeURIComponent(name);
    } catch {
      const error = new Error("Reviewer name header is malformed");
      error.statusCode = 400;
      throw error;
    }
  }
  if (!id && !name) return null;
  return normalizeReviewer({ id, name }, "browser");
}

function getConfigReviewer() {
  const filePath = reviewerConfigPath();
  if (!existsSync(filePath)) return { id: null, name: null, source: "none", locked: false };
  return normalizeReviewer(JSON.parse(readFileSync(filePath, "utf8")), "config");
}

function getEffectiveReviewer(req = null) {
  const envReviewer = reviewerFromEnv();
  if (envReviewer) return envReviewer;
  if (req) {
    const headerReviewer = reviewerFromHeaders(req);
    if (headerReviewer) return headerReviewer;
  }
  return getConfigReviewer();
}

function saveReviewerConfig(input) {
  if (reviewerFromEnv()) {
    const error = new Error("Reviewer is locked by SKILL_EVAL_REVIEWER");
    error.statusCode = 409;
    throw error;
  }
  const reviewer = normalizeReviewer(input, "config");
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(reviewerConfigPath(), JSON.stringify({ id: reviewer.id, name: reviewer.name, updatedAt: nowIso() }, null, 2), "utf8");
  return reviewer;
}

function reviewerPayload(req = null) {
  const reviewer = getEffectiveReviewer(req);
  return reviewer.id || reviewer.name ? { id: reviewer.id, name: reviewer.name } : null;
}

function healthPayload() {
  const payload = {
    ok: true,
    pid: process.pid,
    test: process.env.SKILL_EVAL_TEST === "1",
  };
  if (payload.test) {
    payload.testRunId = process.env.SKILL_EVAL_TEST_RUN_ID || null;
    payload.dataDir = dataDir;
    payload.resourceDir = resourceDir;
  }
  return payload;
}

function isExpectedHttpError(error) {
  return [400, 403, 404, 409, 413].includes(error?.statusCode);
}

function sendJson(res, statusCode, body) {
  const data = JSON.stringify(body);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(data),
  });
  res.end(data);
}

function sendError(res, statusCode, message, details) {
  sendJson(res, statusCode, { error: message, details });
}

async function readBody(req, maxBytes = 2 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      const error = new Error(`Request body exceeds ${maxBytes} bytes`);
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("Malformed JSON body");
    error.statusCode = 400;
    throw error;
  }
}

async function readBinaryBody(req, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      const error = new Error(`Request body exceeds ${maxBytes} bytes`);
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".avif") return "image/avif";
  return "application/octet-stream";
}

function streamFile(res, filePath) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    sendError(res, 404, "File not found");
    return;
  }

  res.writeHead(200, { "content-type": contentTypeFor(filePath) });
  createReadStream(filePath).pipe(res);
}

function safeJoin(baseDir, requestPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }

  const base = path.resolve(baseDir);
  const target = path.resolve(base, decoded);
  const relative = path.relative(base, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  return target;
}

function safeDataArtifact(relativePath) {
  const normalized = String(relativePath || "").replaceAll("\\", "/");
  const allowed =
    /^cache\/[^/]+\/?$/.test(normalized) ||
    /^import-runs\/[^/]+\.json$/.test(normalized) ||
    /^product-checks\/[^/]+\/?$/.test(normalized);
  if (!allowed) return null;
  const target = safeJoin(dataDir, normalized);
  if (!target) return null;
  return {
    relativePath: path.join("data", ...normalized.split("/")),
    absolutePath: target,
  };
}

function resolvePublicDataFile(requestPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return { statusCode: 403, message: "Invalid data path" };
  }

  const normalized = decoded.replaceAll("\\", "/").replace(/^\/+/, "");
  const productCheckOverlayMatch = normalized.match(
    /^product-checks\/([^/]+)\/overlays\/([^/]+)-(source-mask|material-mask|hole-mask|result-match|diff-heatmap)\.png$/
  );
  if (productCheckOverlayMatch) {
    const [, batchId, itemId] = productCheckOverlayMatch;
    const item = getItemById(itemId);
    if (!getBatchById(batchId, { includeArchived: true }) || !item || item.batch_id !== batchId) {
      return { statusCode: 404, message: "File not found" };
    }
    const filePath = safeJoin(dataDir, normalized);
    if (!filePath) {
      return { statusCode: 403, message: "Invalid data path" };
    }
    return { filePath };
  }

  const match = normalized.match(/^cache\/([^/]+)\/([^/]+)\/(source|result)(\.[A-Za-z0-9]+)$/);
  if (!match) {
    return { statusCode: 404, message: "File not found" };
  }

  const [, batchId, itemId, kind, ext] = match;
  if (!PUBLIC_CACHE_IMAGE_EXTENSIONS.has(ext.toLowerCase())) {
    return { statusCode: 404, message: "File not found" };
  }

  const item = getItemById(itemId);
  if (!item || item.batch_id !== batchId) {
    return { statusCode: 404, message: "File not found" };
  }

  const expectedPath = kind === "source" ? item.source_image_path : item.result_image_path;
  const expectedNormalized = String(expectedPath || "").replaceAll("\\", "/").replace(/^\/+/, "");
  if (!expectedNormalized || expectedNormalized !== `data/${normalized}`) {
    return { statusCode: 404, message: "File not found" };
  }

  const filePath = safeJoin(dataDir, normalized);
  if (!filePath) {
    return { statusCode: 403, message: "Invalid data path" };
  }
  return { filePath };
}

function artifactSize(filePath) {
  if (!existsSync(filePath)) return 0;
  const info = statSync(filePath);
  if (info.isFile()) return info.size;
  if (!info.isDirectory()) return 0;
  let total = 0;
  const stack = [filePath];
  while (stack.length) {
    const current = stack.pop();
    if (!current || !existsSync(current)) continue;
    const currentInfo = statSync(current);
    if (currentInfo.isFile()) {
      total += currentInfo.size;
    } else if (currentInfo.isDirectory()) {
      for (const name of readdirSync(current)) {
        stack.push(path.join(current, name));
      }
    }
  }
  return total;
}

function buildBatchDeletePlan(batchId) {
  const batch = getBatchById(batchId, { includeArchived: true });
  if (!batch) {
    const error = new Error("Batch not found");
    error.statusCode = 404;
    throw error;
  }
  const counts = getBatchDeleteCounts(batchId);
  const artifactCandidates = [
    safeDataArtifact(`cache/${batchId}`),
    safeDataArtifact(`import-runs/${batchId}.json`),
    safeDataArtifact(`product-checks/${batchId}`),
  ].filter(Boolean);
  const artifacts = artifactCandidates.map((artifact) => ({
    path: artifact.relativePath,
    exists: existsSync(artifact.absolutePath),
    bytes: artifactSize(artifact.absolutePath),
  }));
  return {
    batchId,
    batch: {
      id: batch.id,
      name: batch.name,
      sourceDir: batch.source_dir,
      sourceFile: batch.source_file,
      archivedAt: batch.archived_at,
    },
    items: counts.items,
    evaluations: counts.evaluations,
    artifacts,
    totalBytes: artifacts.reduce((sum, artifact) => sum + artifact.bytes, 0),
  };
}

function deleteBatchArtifacts(planOrBatchId) {
  const plan = typeof planOrBatchId === "string" ? buildBatchDeletePlan(planOrBatchId) : planOrBatchId;
  const deletedArtifacts = [];
  const failedArtifacts = [];
  for (const artifact of plan.artifacts) {
    if (!artifact.exists) continue;
    const safe = safeDataArtifact(artifact.path.replace(/^data[\\/]/, ""));
    if (!safe) {
      const error = new Error(`Unsafe artifact path: ${artifact.path}`);
      error.statusCode = 403;
      throw error;
    }
    try {
      rmSync(safe.absolutePath, { recursive: true, force: true });
      deletedArtifacts.push({ path: artifact.path, bytes: artifact.bytes });
    } catch (error) {
      failedArtifacts.push({ path: artifact.path, error: sanitizeError(error) });
    }
  }
  return {
    ...plan,
    artifactCleanup: failedArtifacts.length > 0 ? "partial_failed" : "succeeded",
    deletedArtifacts,
    failedArtifacts,
  };
}

function ensureNoRunningBatchTask(batchId) {
  if (productCheckJobs.has(batchId)) {
    const error = new Error("Batch has a running Product Check task");
    error.statusCode = 409;
    throw error;
  }
}

function audit(event, req = null) {
  try {
    return recordAuditEvent({
      ...event,
      payload: {
        ...(event.payload || {}),
        reviewer: event.payload?.reviewer ?? reviewerPayload(req),
      },
    });
  } catch (error) {
    console.error("audit event failed", error);
    return null;
  }
}

function auditImportPayload({ task, source, sourceFile, result, error }) {
  return {
    taskId: task?.id || null,
    source,
    sourceFile,
    batchId: result?.batch?.id || task?.batchId || null,
    parsed: result?.parsed || 0,
    inserted: result?.inserted || 0,
    duplicate: result?.duplicate || 0,
    parseErrors: result?.errors?.length || 0,
    status: error ? "failed" : result ? "succeeded" : task?.status || "queued",
    error: error ? sanitizeError(error) : null,
  };
}

function normalizeProductCheckPath(productCheck) {
  if (!productCheck || typeof productCheck !== "object") return productCheck;
  if (productCheck.sourceImagePath) {
    productCheck.sourceImageUrl = `/${String(productCheck.sourceImagePath).replaceAll("\\", "/")}`;
  }
  if (productCheck.resultImagePath) {
    productCheck.resultImageUrl = `/${String(productCheck.resultImagePath).replaceAll("\\", "/")}`;
  }
  if (productCheck.overlays && typeof productCheck.overlays === "object") {
    productCheck.overlays = Object.fromEntries(
      Object.entries(productCheck.overlays).map(([key, value]) => [key, `/${String(value).replaceAll("\\", "/")}`])
    );
  }
  return productCheck;
}

function productCheckMetadata(payload) {
  const metadataStatus =
    payload?.algorithmVersion && payload?.thresholdProfileId && payload?.thresholdProfileDigest ? "versioned" : "legacy";
  return {
    metadataStatus,
    algorithmVersion: payload?.algorithmVersion || null,
    thresholdProfileId: payload?.thresholdProfileId || null,
    thresholdProfileDigest: payload?.thresholdProfileDigest || null,
  };
}

async function readProductCheckBatch(batchId) {
  const filePath = safeJoin(productChecksDir, `${batchId}/results.json`);
  if (!filePath) {
    const error = new Error("Invalid product-check path");
    error.statusCode = 403;
    throw error;
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    return null;
  }
  const payload = JSON.parse(await readFile(filePath, "utf8"));
  const items = Array.isArray(payload.items) ? payload.items.map((item) => normalizeProductCheckPath({ ...item })) : [];
  return {
    ...payload,
    ...productCheckMetadata(payload),
    items,
  };
}

function productCheckRunDir(batchId) {
  return path.join(productChecksDir, batchId);
}

function productCheckStatusPath(batchId) {
  return path.join(productCheckRunDir(batchId), "run-status.json");
}

function productCheckLogPath(batchId) {
  return path.join(productCheckRunDir(batchId), "run.log");
}

function normalizeProductCheckStatus(batchId, status) {
  if (!status || typeof status !== "object") return status;
  const checked = toCount(status.checked, toCount(status.summary?.checked));
  const unsupported = toCount(status.unsupported, toCount(status.summary?.unsupported));
  const failed = toCount(status.failed, toCount(status.summary?.failed));
  const done = toCount(status.done, toCount(status.summary?.done, toCount(status.summary?.total, checked + unsupported + failed)));
  const total = toCount(status.total, toCount(status.summary?.total, done));
  return {
    ...status,
    ...productCheckMetadata(status),
    batchId: status.batchId || batchId,
    status: status.status || "unknown",
    done,
    total,
    checked,
    unsupported,
    failed,
    currentItemId: status.currentItemId || null,
    latestMessage: status.latestMessage || "",
    summary: {
      ...(status.summary || {}),
      checked,
      unsupported,
      failed,
      done,
      total,
    },
  };
}

function writeProductCheckStatus(batchId, status) {
  const runDir = productCheckRunDir(batchId);
  mkdirSync(runDir, { recursive: true });
  const normalized = normalizeProductCheckStatus(batchId, status);
  writeFileSync(productCheckStatusPath(batchId), JSON.stringify(normalized, null, 2), "utf8");
  return normalized;
}

function importProgressPatch(event) {
  const summary = {};
  if (typeof event.parsed === "number") summary.parsed = event.parsed;
  if (typeof event.inserted === "number") summary.inserted = event.inserted;
  if (typeof event.duplicate === "number") summary.duplicate = event.duplicate;
  if (typeof event.cachedSource === "number") summary.cachedSource = event.cachedSource;
  if (typeof event.cachedResult === "number") summary.cachedResult = event.cachedResult;
  if (typeof event.parseErrors === "number") summary.parseErrors = event.parseErrors;

  if (event.type === "import:start") {
    return {
      status: "running",
      sourceFile: event.sourceFile,
      message: `Importing ${event.sourceFile}`,
      summary,
    };
  }
  if (event.type === "import:parsed") {
    return {
      status: "running",
      batchId: event.batchId,
      sourceFile: event.sourceFile,
      total: event.parsed || 0,
      message: `Parsed ${event.parsed || 0} item(s)`,
      summary,
    };
  }
  if (event.type === "import:item") {
    const sourceFailed = event.sourceStatus === "failed" ? 1 : 0;
    const resultFailed = event.resultStatus === "failed" ? 1 : 0;
    return {
      status: "running",
      batchId: event.batchId,
      done: event.index || 0,
      total: event.total || 0,
      message: `Imported item ${event.index || 0}/${event.total || 0}`,
      summary: {
        ...summary,
        failedSourceDelta: sourceFailed,
        failedResultDelta: resultFailed,
        latestItemId: event.itemId,
        latestSourceStatus: event.sourceStatus,
        latestResultStatus: event.resultStatus,
        activeItemIndex: null,
        activeItemId: null,
        activeImageKind: null,
        activeImageStatus: null,
      },
    };
  }
  if (event.type === "import:cache-start") {
    return {
      status: "running",
      batchId: event.batchId,
      done: event.completed || 0,
      total: event.total || 0,
      message: `Caching item ${event.index || 0}/${event.total || 0}`,
      summary: {
        ...summary,
        latestItemId: event.itemId,
        activeItemIndex: event.index || null,
        activeItemId: event.itemId,
        activeImageKind: null,
        activeImageStatus: "pending",
      },
    };
  }
  if (event.type === "import:image-start" || event.type === "import:image-finish") {
    const activeSummary =
      event.type === "import:image-start"
        ? {
            activeItemIndex: event.index || null,
            activeItemId: event.itemId,
            activeImageKind: event.imageKind || null,
            activeImageStatus: "pending",
          }
        : {};
    return {
      status: "running",
      batchId: event.batchId,
      message:
        event.type === "import:image-start"
          ? `Caching ${event.imageKind || "image"} image`
          : `${event.imageKind || "image"} image ${event.imageStatus || "finished"}`,
      summary: {
        ...summary,
        latestItemId: event.itemId,
        latestImageKind: event.imageKind || null,
        latestImageStatus: event.type === "import:image-start" ? "pending" : event.imageStatus || "finished",
        ...activeSummary,
      },
    };
  }
  if (event.type === "import:finish") {
    return {
      status: "succeeded",
      batchId: event.batchId,
      sourceFile: event.sourceFile,
      done: event.parsed || 0,
      total: event.parsed || 0,
      message: `Imported ${event.parsed || 0} item(s)`,
      summary: {
        ...summary,
        importRun: event.importRun,
      },
    };
  }
  return {
    message: event.type || "Import progress",
    summary,
  };
}

function updateImportTaskFromProgress(taskId, event, counters) {
  const patch = importProgressPatch(event);
  if (event.type === "import:item") {
    counters.failedSource += event.sourceStatus === "failed" ? 1 : 0;
    counters.failedResult += event.resultStatus === "failed" ? 1 : 0;
    patch.summary = {
      ...(patch.summary || {}),
      failedSource: counters.failedSource,
      failedResult: counters.failedResult,
    };
  }
  updateTask(taskId, patch);
}

function startImportTask({ body, source = "resource", reviewer = null }) {
  const sourceFile = source === "upload" ? body.fileName : body.file;
  const task = createTask("import", {
    sourceFile,
    source,
    status: "queued",
    message: `Queued import ${sourceFile}`,
    summary: {
      parsed: 0,
      inserted: 0,
      duplicate: 0,
      cachedSource: 0,
      cachedResult: 0,
      failedSource: 0,
      failedResult: 0,
      parseErrors: 0,
    },
  });
  audit({
    eventType: "import.start",
    entityType: "task",
    entityId: task.id,
    payload: { ...auditImportPayload({ task, source, sourceFile }), reviewer },
  });
  const counters = { failedSource: 0, failedResult: 0 };

  setImmediate(async () => {
    try {
      const importOptions = {
        batchName: body.name,
        cacheWorkers: body.cacheWorkers || importCacheWorkers,
        downloadImages: body.downloadImages !== false,
        sourceDigest: body.sourceDigest,
        onProgress: (event) => {
          logEvent("import", event);
          updateImportTaskFromProgress(task.id, event, counters);
        },
      };
      const result =
        source === "upload"
          ? await importUploadedJsonBatch({
              ...importOptions,
              content: body.content,
              fileName: sourceFile,
            })
          : await importResourceBatch({
              ...importOptions,
              files: sourceFile ? [sourceFile] : [],
            });
      finishTask(task.id, "succeeded", {
        batchId: result.batch.id,
        done: result.parsed,
        total: result.parsed,
        message: `Imported ${result.parsed} item(s)`,
        summary: {
          parsed: result.parsed,
          inserted: result.inserted,
          duplicate: result.duplicate,
          cachedSource: result.cachedSource,
          cachedResult: result.cachedResult,
          failedSource: counters.failedSource,
          failedResult: counters.failedResult,
          parseErrors: result.errors.length,
          importRun: result.importRun,
        },
      });
      audit({
        eventType: "import.finish",
        entityType: "batch",
        entityId: result.batch.id,
        batchId: result.batch.id,
        payload: { ...auditImportPayload({ task, source, sourceFile, result }), reviewer },
      });
      logEvent("import", {
        event: "task-succeeded",
        taskId: task.id,
        batchId: result.batch.id,
        sourceFile: result.batch.sourceFile,
        sourceDir: result.batch.sourceDir,
      });
    } catch (error) {
      finishTask(task.id, "failed", {
        error: sanitizeError(error),
        message: "Import failed",
      });
      audit({
        eventType: "import.fail",
        entityType: "task",
        entityId: task.id,
        payload: { ...auditImportPayload({ task, source, sourceFile, error }), reviewer },
      });
      logEvent("import", {
        event: "task-failed",
        taskId: task.id,
        sourceFile,
        source,
        error: sanitizeError(error),
      });
    }
  });

  return task;
}

async function readProductCheckStatus(batchId) {
  const filePath = productCheckStatusPath(batchId);
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    return null;
  }
  const status = JSON.parse(await readFile(filePath, "utf8"));
  if (status.status === "running" && status.pid && !productCheckJobs.has(batchId)) {
    try {
      process.kill(status.pid, 0);
    } catch {
      status.status = "stale";
      status.finishedAt = status.finishedAt || nowIso();
      status.error = status.error || "Process is no longer running";
      writeProductCheckStatus(batchId, status);
    }
  }
  return normalizeProductCheckStatus(batchId, status);
}

function readProductCheckStatusSync(batchId) {
  const filePath = productCheckStatusPath(batchId);
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    return null;
  }
  return normalizeProductCheckStatus(batchId, JSON.parse(readFileSync(filePath, "utf8")));
}

async function appendProductCheckLog(batchId, message) {
  const runDir = productCheckRunDir(batchId);
  mkdirSync(runDir, { recursive: true });
  await appendFile(productCheckLogPath(batchId), message, "utf8");
}

function productCheckSummaryFromStatus(status) {
  return {
    total: toCount(status.total),
    done: toCount(status.done),
    checked: toCount(status.checked),
    unsupported: toCount(status.unsupported),
    failed: toCount(status.failed),
  };
}

function updateProductCheckStatusFromEvent(batchId, payload) {
  const current = readProductCheckStatusSync(batchId) || {
    batchId,
    status: "running",
    startedAt: nowIso(),
  };
  const next = {
    ...current,
    updatedAt: nowIso(),
  };

  if (payload.event === "product-check:start") {
    next.status = "running";
    next.done = 0;
    next.total = payload.selected || 0;
    next.checked = 0;
    next.unsupported = 0;
    next.failed = 0;
    next.latestMessage = `Selected ${next.total} item(s)`;
    next.outputDir = payload.outputDir || next.outputDir || null;
    next.workers = payload.workers || next.workers || null;
    next.algorithmVersion = payload.algorithmVersion || next.algorithmVersion || null;
    next.thresholdProfileId = payload.thresholdProfileId || next.thresholdProfileId || null;
    next.thresholdProfileDigest = payload.thresholdProfileDigest || next.thresholdProfileDigest || null;
    next.summary = productCheckSummaryFromStatus(next);
  } else if (payload.event === "product-check:item") {
    const isChecked = payload.status === "checked";
    const isUnsupported = payload.status && payload.status !== "checked";
    next.status = "running";
    next.done = payload.index || (current.done || 0) + 1;
    next.total = payload.total || current.total || 0;
    next.currentIndex = payload.index || next.done;
    next.currentItemOrder = payload.itemOrder || null;
    next.currentItemId = payload.itemId || null;
    next.latestMessage = `${payload.status || "item"} ${next.done}/${next.total}`;
    next.checked = (current.checked || 0) + (isChecked ? 1 : 0);
    next.unsupported = (current.unsupported || 0) + (isUnsupported ? 1 : 0);
    next.failed = current.failed || 0;
    next.latestUnsupportedReason = payload.unsupportedReason || null;
    next.latestSuggestedScore = payload.suggestedScore ?? null;
    next.summary = productCheckSummaryFromStatus(next);
  } else if (payload.event === "product-check:finish") {
    next.status = "succeeded";
    next.done = payload.summary?.total ?? current.total ?? current.done ?? 0;
    next.total = payload.summary?.total ?? current.total ?? next.done;
    next.summary = payload.summary || current.summary || productCheckSummaryFromStatus(next);
    next.latestMessage = "Product Check finished";
    next.output = payload.output || next.output || null;
    next.algorithmVersion = payload.algorithmVersion || next.algorithmVersion || null;
    next.thresholdProfileId = payload.thresholdProfileId || next.thresholdProfileId || null;
    next.thresholdProfileDigest = payload.thresholdProfileDigest || next.thresholdProfileDigest || null;
  } else {
    return;
  }

  writeProductCheckStatus(batchId, next);
}

function forwardProductCheckOutput(batchId, stream, chunk) {
  const incoming = chunk.toString();
  const bufferKey = `${batchId}:${stream}`;
  const text = `${productCheckBuffers.get(bufferKey) || ""}${incoming}`;
  appendProductCheckLog(batchId, incoming).catch((error) => console.error(error));
  const lines = text.split(/\r?\n/);
  productCheckBuffers.set(bufferKey, lines.pop() || "");
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const payload = JSON.parse(line);
      logEvent("product-check", { batchId, stream, ...payload });
      if (stream === "stdout" && payload.event?.startsWith("product-check:")) {
        updateProductCheckStatusFromEvent(batchId, payload);
      }
    } catch {
      logEvent("product-check", { batchId, stream, message: line });
    }
  }
}

async function startProductCheckRun(batchId, { reviewer = null } = {}) {
  if (productCheckJobs.has(batchId)) {
    return { statusCode: 409, status: await readProductCheckStatus(batchId) };
  }
  const existingStatus = await readProductCheckStatus(batchId);
  if (existingStatus?.status === "running") {
    return { statusCode: 409, status: existingStatus };
  }

  const status = writeProductCheckStatus(batchId, {
    batchId,
    status: "running",
    done: 0,
    total: 0,
    checked: 0,
    unsupported: 0,
    failed: 0,
    currentItemId: null,
    latestMessage: "Starting Product Check",
    startedAt: nowIso(),
    updatedAt: nowIso(),
    finishedAt: null,
    pid: null,
    exitCode: null,
    summary: {
      total: 0,
      done: 0,
      checked: 0,
      unsupported: 0,
      failed: 0,
    },
    error: null,
  });
  await writeFile(productCheckLogPath(batchId), "", "utf8");
  logEvent("product-check", { event: "start", batchId });
  audit({
    eventType: "product_check.start",
    entityType: "batch",
    entityId: batchId,
    batchId,
    payload: { workers: productCheckWorkers, reviewer },
  });

  const child = spawn(
    process.execPath,
    [
      "scripts/run-python.js",
      "scripts/product_check.py",
      "--database",
      databasePath,
      "--output-dir",
      productChecksDir,
      "--batch",
      batchId,
      "--visualize",
      "--workers",
      String(productCheckWorkers),
    ],
    {
      cwd: __dirname,
      windowsHide: true,
      shell: false,
    }
  );
  status.pid = child.pid;
  writeProductCheckStatus(batchId, status);
  productCheckJobs.set(batchId, child);
  logEvent("product-check", { event: "spawned", batchId, pid: child.pid });

  child.stdout.on("data", (chunk) => {
    forwardProductCheckOutput(batchId, "stdout", chunk);
  });
  child.stderr.on("data", (chunk) => {
    forwardProductCheckOutput(batchId, "stderr", chunk);
  });
  child.on("error", (error) => {
    const next = {
      ...status,
      status: "failed",
      updatedAt: nowIso(),
      finishedAt: nowIso(),
      exitCode: null,
      error: error.message,
      latestMessage: "Product Check failed",
    };
    productCheckJobs.delete(batchId);
    productCheckBuffers.delete(`${batchId}:stdout`);
    productCheckBuffers.delete(`${batchId}:stderr`);
    writeProductCheckStatus(batchId, next);
    audit({
      eventType: "product_check.fail",
      entityType: "batch",
      entityId: batchId,
      batchId,
      payload: { error: error.message, reviewer },
    });
    logEvent("product-check", { event: "failed", batchId, error: error.message });
  });
  child.on("close", async (code) => {
    productCheckJobs.delete(batchId);
    productCheckBuffers.delete(`${batchId}:stdout`);
    productCheckBuffers.delete(`${batchId}:stderr`);
    let summary = null;
    let error = null;
    if (code === 0) {
      try {
        const productCheck = await readProductCheckBatch(batchId);
        summary = productCheck?.summary || null;
      } catch (readError) {
        error = readError instanceof Error ? readError.message : String(readError);
      }
    } else {
      error = `Product Check exited with code ${code}`;
    }
    const currentStatus = (await readProductCheckStatus(batchId)) || status;
    const next = writeProductCheckStatus(batchId, {
      ...currentStatus,
      batchId,
      status: code === 0 && !error ? "succeeded" : "failed",
      startedAt: currentStatus.startedAt || status.startedAt,
      updatedAt: nowIso(),
      finishedAt: nowIso(),
      pid: child.pid,
      exitCode: code,
      done: summary?.total ?? currentStatus.done ?? currentStatus.total ?? 0,
      total: summary?.total ?? currentStatus.total ?? currentStatus.done ?? 0,
      summary: summary || currentStatus.summary,
      error,
      latestMessage: code === 0 && !error ? "Product Check finished" : "Product Check failed",
    });
    audit({
      eventType: next.status === "succeeded" ? "product_check.finish" : "product_check.fail",
      entityType: "batch",
      entityId: batchId,
      batchId,
      payload: {
        status: next.status,
        exitCode: code,
        summary: next.summary || null,
        error,
        reviewer,
      },
    });
    logEvent("product-check", {
      event: next.status,
      batchId,
      exitCode: code,
      summary,
      error,
    });
  });

  return { statusCode: 202, status };
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, healthPayload());
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/reviewer/me") {
    sendJson(res, 200, { reviewer: getEffectiveReviewer(req) });
    return;
  }

  if (req.method === "PUT" && url.pathname === "/api/reviewer/me") {
    try {
      const body = await readBody(req);
      sendJson(res, 200, { reviewer: saveReviewerConfig(body) });
    } catch (error) {
      if ([400, 409].includes(error?.statusCode)) {
        sendError(res, error.statusCode, error.message);
        return;
      }
      throw error;
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/batches") {
    sendJson(res, 200, { batches: getBatches({ includeArchived: url.searchParams.get("includeArchived") === "1" }) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/batches/by-digest") {
    const digest = url.searchParams.get("digest") || "";
    sendJson(res, 200, { batches: getBatchBySourceDigest(digest) });
    return;
  }

  const taskMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
  if (req.method === "GET" && taskMatch) {
    const task = getTask(taskMatch[1]);
    if (!task) {
      sendError(res, 404, "Task not found");
      return;
    }
    sendJson(res, 200, { task });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/tasks/latest") {
    const type = url.searchParams.get("type") || "";
    const batchId = url.searchParams.get("batchId") || "";
    sendJson(res, 200, { task: getLatestTask({ type, batchId }) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/audit-events") {
    sendJson(res, 200, {
      events: getAuditEvents({
        batchId: url.searchParams.get("batchId") || "",
        itemId: url.searchParams.get("itemId") || "",
        limit: url.searchParams.get("limit") || 100,
      }),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/resources") {
    sendJson(res, 200, { resources: await listResourceJsonFiles() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/import/preflight") {
    const body = await readBody(req);
    if (!body.file) {
      const error = new Error("Exactly one resource JSON file must be selected for preflight");
      error.statusCode = 400;
      throw error;
    }
    sendJson(res, 200, { preflight: await preflightResourceJson({ file: body.file }) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/import/upload/preflight") {
    const body = await readBody(req, MAX_UPLOAD_JSON_BYTES + 1024 * 1024);
    if (!body.fileName) {
      const error = new Error("Exactly one uploaded JSON file must be selected for preflight");
      error.statusCode = 400;
      throw error;
    }
    if (typeof body.content !== "string") {
      const error = new Error("Uploaded JSON content is required");
      error.statusCode = 400;
      throw error;
    }
    sendJson(res, 200, { preflight: preflightUploadedJson({ fileName: body.fileName, content: body.content }) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/import") {
    const body = await readBody(req);
    if (!body.file) {
      const error = new Error("Exactly one resource JSON file must be selected for import");
      error.statusCode = 400;
      throw error;
    }
    body.file = normalizeResourceFileName(body.file);
    logEvent("import", {
      event: "request",
      sourceFile: body.file || null,
      downloadImages: body.downloadImages !== false,
    });
    const task = startImportTask({ body, reviewer: reviewerPayload(req) });
    sendJson(res, 202, { task });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/import/upload") {
    const body = await readBody(req, MAX_UPLOAD_JSON_BYTES + 1024 * 1024);
    if (!body.fileName) {
      const error = new Error("Exactly one uploaded JSON file must be selected for import");
      error.statusCode = 400;
      throw error;
    }
    if (typeof body.content !== "string") {
      const error = new Error("Uploaded JSON content is required");
      error.statusCode = 400;
      throw error;
    }
    body.fileName = normalizeUploadedJsonFileName(body.fileName);
    if (Buffer.byteLength(body.content, "utf8") > MAX_UPLOAD_JSON_BYTES) {
      const error = new Error(`Uploaded JSON exceeds ${MAX_UPLOAD_JSON_BYTES} bytes`);
      error.statusCode = 413;
      throw error;
    }
    logEvent("import", {
      event: "upload-request",
      sourceFile: body.fileName,
      sourceDir: "upload",
      downloadImages: body.downloadImages !== false,
    });
    const task = startImportTask({ body, source: "upload", reviewer: reviewerPayload(req) });
    sendJson(res, 202, { task });
    return;
  }

  const batchItemsMatch = url.pathname.match(/^\/api\/batches\/([^/]+)\/items$/);
  if (req.method === "GET" && batchItemsMatch) {
    const batchId = batchItemsMatch[1];
    const filters = parseItemFilters(url.searchParams);
    const productCheck = await readProductCheckBatch(batchId);
    const productCheckByItemId = new Map((productCheck?.items || []).map((item) => [item.itemId, item]));
    const allItems = getItemsForBatch(batchId);
    const items = filterBatchItems(allItems, filters, productCheckByItemId);
    sendJson(res, 200, {
      items,
      allItems,
      filters,
      summary: {
        totalItems: allItems.length,
        totalMatched: items.length,
      },
    });
    return;
  }

  const batchStatsMatch = url.pathname.match(/^\/api\/batches\/([^/]+)\/stats$/);
  if (req.method === "GET" && batchStatsMatch) {
    const batchId = batchStatsMatch[1];
    sendJson(res, 200, { stats: getBatchStats(batchId) });
    return;
  }

  const productCheckMatch = url.pathname.match(/^\/api\/batches\/([^/]+)\/product-check$/);
  if (req.method === "GET" && productCheckMatch) {
    try {
      const productCheck = await readProductCheckBatch(productCheckMatch[1]);
      sendJson(res, 200, { productCheck });
    } catch (error) {
      if (error?.statusCode === 403) {
        sendError(res, 403, error.message);
        return;
      }
      throw error;
    }
    return;
  }

  const productCheckRunMatch = url.pathname.match(/^\/api\/batches\/([^/]+)\/product-check\/runs$/);
  if (req.method === "POST" && productCheckRunMatch) {
    const batchId = productCheckRunMatch[1];
    if (!batchExists(batchId, { includeArchived: true })) {
      sendError(res, 404, "Batch not found");
      return;
    }
    const run = await startProductCheckRun(batchId, { reviewer: reviewerPayload(req) });
    sendJson(res, run.statusCode, { run: run.status });
    return;
  }

  const productCheckRunLatestMatch = url.pathname.match(/^\/api\/batches\/([^/]+)\/product-check\/runs\/latest$/);
  if (req.method === "GET" && productCheckRunLatestMatch) {
    const batchId = productCheckRunLatestMatch[1];
    sendJson(res, 200, { run: await readProductCheckStatus(batchId) });
    return;
  }

  const cacheCountsMatch = url.pathname.match(/^\/api\/batches\/([^/]+)\/cache-counts\/recompute$/);
  if (req.method === "POST" && cacheCountsMatch) {
    const batchId = cacheCountsMatch[1];
    if (!batchExists(batchId, { includeArchived: true })) {
      sendError(res, 404, "Batch not found");
      return;
    }
    updateBatchCounts(batchId);
    sendJson(res, 200, { batchId, stats: getBatchStats(batchId) });
    return;
  }

  const archiveMatch = url.pathname.match(/^\/api\/batches\/([^/]+)\/archive$/);
  if (req.method === "PATCH" && archiveMatch) {
    const batchId = archiveMatch[1];
    ensureNoRunningBatchTask(batchId);
    const body = await readBody(req);
    const batch = archiveBatch(batchId, body);
    audit({
      eventType: "batch.archive",
      entityType: "batch",
      entityId: batchId,
      batchId,
      payload: {
        reason: batch.archive_reason,
        noteLength: batch.archive_note?.length || 0,
      },
    }, req);
    sendJson(res, 200, { batch, batches: getBatches({ includeArchived: true }) });
    return;
  }

  const restoreMatch = url.pathname.match(/^\/api\/batches\/([^/]+)\/restore$/);
  if (req.method === "PATCH" && restoreMatch) {
    const batchId = restoreMatch[1];
    const batch = restoreBatch(batchId);
    audit({
      eventType: "batch.restore",
      entityType: "batch",
      entityId: batchId,
      batchId,
      payload: {},
    }, req);
    sendJson(res, 200, { batch, batches: getBatches({ includeArchived: true }) });
    return;
  }

  const deletePlanMatch = url.pathname.match(/^\/api\/batches\/([^/]+)\/delete-plan$/);
  if (req.method === "POST" && deletePlanMatch) {
    const batchId = deletePlanMatch[1];
    ensureNoRunningBatchTask(batchId);
    const plan = buildBatchDeletePlan(batchId);
    audit({
      eventType: "batch.delete_plan",
      entityType: "batch",
      entityId: batchId,
      batchId,
      payload: {
        items: plan.items,
        evaluations: plan.evaluations,
        artifacts: plan.artifacts.length,
        totalBytes: plan.totalBytes,
      },
    }, req);
    sendJson(res, 200, { plan });
    return;
  }

  const deleteBatchMatch = url.pathname.match(/^\/api\/batches\/([^/]+)$/);
  if (req.method === "DELETE" && deleteBatchMatch) {
    const batchId = deleteBatchMatch[1];
    ensureNoRunningBatchTask(batchId);
    const body = await readBody(req);
    if (body.confirmBatchId !== batchId) {
      sendError(res, 400, "Batch delete requires confirmBatchId to match the batch id");
      return;
    }
    const plan = buildBatchDeletePlan(batchId);
    const deletedRecord = deleteBatchRecord(batchId);
    const cleanup = deleteBatchArtifacts(plan);
    audit(
      {
        eventType: cleanup.failedArtifacts.length > 0 ? "batch.delete.partial" : "batch.delete",
        entityType: "batch",
        entityId: batchId,
        batchId,
        payload: {
          items: deletedRecord.items,
          evaluations: deletedRecord.evaluations,
          annotations: deletedRecord.annotations,
          artifacts: cleanup.artifacts.length,
          deletedArtifacts: cleanup.deletedArtifacts.length,
          failedArtifacts: cleanup.failedArtifacts.length,
          artifactCleanup: cleanup.artifactCleanup,
          totalBytes: cleanup.totalBytes,
        },
      },
      req
    );
    sendJson(res, cleanup.failedArtifacts.length > 0 ? 207 : 200, {
      deleted: true,
      artifactCleanup: cleanup.artifactCleanup,
      plan: cleanup,
    });
    return;
  }

  const itemAnnotationsMatch = url.pathname.match(/^\/api\/items\/([^/]+)\/annotations$/);
  if (req.method === "GET" && itemAnnotationsMatch) {
    const itemId = itemAnnotationsMatch[1];
    if (!itemExists(itemId)) {
      sendError(res, 404, "Item not found");
      return;
    }
    sendJson(res, 200, { annotations: getAnnotationsForItem(itemId, { limit: url.searchParams.get("limit") || 100 }) });
    return;
  }

  const evaluationMatch = url.pathname.match(/^\/api\/items\/([^/]+)\/evaluation$/);
  if (req.method === "POST" && evaluationMatch) {
    const itemId = evaluationMatch[1];
    if (!itemExists(itemId)) {
      sendError(res, 404, "Item not found");
      return;
    }

    const body = await readBody(req);
    try {
      const reviewer = getEffectiveReviewer(req);
      const evaluation = saveEvaluation(itemId, { ...body, reviewer });
      sendJson(res, 200, { evaluation });
    } catch (error) {
      if (error instanceof EvaluationValidationError) {
        sendError(res, 400, error.message, error.issues);
        return;
      }
      throw error;
    }
    return;
  }

  const exclusionMatch = url.pathname.match(/^\/api\/items\/([^/]+)\/exclusion$/);
  if (req.method === "PATCH" && exclusionMatch) {
    const itemId = exclusionMatch[1];
    try {
      const body = await readBody(req);
      const item = setItemExclusion(itemId, body);
      audit({
        eventType: item.is_excluded ? "item.exclude" : "item.restore",
        entityType: "item",
        entityId: itemId,
        batchId: item.batch_id,
        itemId,
        payload: item.is_excluded
          ? {
              reason: item.exclude_reason,
              noteLength: item.exclude_note?.length || 0,
            }
          : {},
      }, req);
      sendJson(res, 200, { item, stats: getBatchStats(item.batch_id) });
    } catch (error) {
      if ([400, 404].includes(error?.statusCode)) {
        sendError(res, error.statusCode, error.message, error.issues);
        return;
      }
      throw error;
    }
    return;
  }

  const imageRetryMatch = url.pathname.match(/^\/api\/items\/([^/]+)\/images\/(source|result)\/retry$/);
  if (req.method === "POST" && imageRetryMatch) {
    try {
      const retry = await retryItemImage(imageRetryMatch[1], imageRetryMatch[2]);
      sendJson(res, 200, { retry });
    } catch (error) {
      if (error?.statusCode === 400 || error?.statusCode === 404) {
        sendError(res, error.statusCode, error.message);
        return;
      }
      throw error;
    }
    return;
  }

  const browserCacheMatch = url.pathname.match(/^\/api\/items\/([^/]+)\/images\/(source|result)\/browser-cache$/);
  if (req.method === "POST" && browserCacheMatch) {
    try {
      const buffer = await readBinaryBody(req, MAX_IMAGE_BYTES);
      const retry = await cacheBrowserUploadedImage({
        itemId: browserCacheMatch[1],
        kind: browserCacheMatch[2],
        buffer,
        contentType: req.headers["content-type"],
      });
      logEvent("image-cache", {
        event: "browser-cache",
        itemId: retry.itemId,
        batchId: retry.batchId,
        kind: retry.kind,
        bytes: buffer.length,
      });
      audit({
        eventType: "browser_cache.finish",
        entityType: "item",
        entityId: retry.itemId,
        batchId: retry.batchId,
        itemId: retry.itemId,
        payload: {
          kind: retry.kind,
          fetchStatus: retry.fetchStatus,
          bytes: buffer.length,
        },
      }, req);
      sendJson(res, 200, { retry });
    } catch (error) {
      if ([400, 404, 413].includes(error?.statusCode)) {
        sendError(res, error.statusCode, error.message);
        return;
      }
      throw error;
    }
    return;
  }

  sendError(res, 404, "API route not found");
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    if (url.pathname.startsWith("/data/")) {
      const resolved = resolvePublicDataFile(url.pathname.slice("/data/".length));
      if (!resolved.filePath) {
        sendError(res, resolved.statusCode || 404, resolved.message || "File not found");
        return;
      }
      streamFile(res, resolved.filePath);
      return;
    }

    let requestPath = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = safeJoin(publicDir, requestPath.slice(1));
    if (!filePath) {
      sendError(res, 403, "Invalid public path");
      return;
    }

    if (existsSync(filePath) && statSync(filePath).isFile()) {
      streamFile(res, filePath);
      return;
    }

    const indexHtml = await readFile(path.join(publicDir, "index.html"));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(indexHtml);
  } catch (error) {
    if (isExpectedHttpError(error)) {
      logEvent("http", {
        event: "request-rejected",
        method: req.method,
        path: req.url,
        statusCode: error.statusCode,
        error: sanitizeError(error),
      });
      sendError(res, error.statusCode, error.message);
      return;
    }
    console.error(error);
    sendError(res, 500, "Unexpected server error", error instanceof Error ? error.message : String(error));
  }
});

server.listen(port, host, () => {
  const localHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  console.log(`skill-eval running at http://${localHost}:${port}`);
  if (host === "0.0.0.0" || host === "::") {
    console.log(`skill-eval listening on all interfaces; use http://<this-machine-ip>:${port} from the LAN`);
  }
});
