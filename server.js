import http from "node:http";
import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  getBatchStats,
  getBatches,
  getItemsForBatch,
  initializeDatabase,
  itemExists,
  saveEvaluation,
} from "./src/db.js";
import {
  cacheBrowserUploadedImage,
  importResourceBatch,
  MAX_IMAGE_BYTES,
  normalizeResourceFileName,
  retryItemImage,
} from "./src/importer.js";
import { listResourceJsonFiles } from "./src/importer.js";
import { createTask, finishTask, getLatestTask, getTask, updateTask } from "./src/tasks.js";
import { EvaluationValidationError } from "./public/scoring.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const dataDir = path.join(__dirname, "data");
const productChecksDir = path.join(dataDir, "product-checks");
const port = Number(process.env.PORT || 4173);
const productCheckJobs = new Map();
const productCheckBuffers = new Map();

initializeDatabase();

function nowIso() {
  return new Date().toISOString();
}

function toCount(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function logEvent(scope, event) {
  console.log(JSON.stringify({ at: nowIso(), scope, ...event }));
}

function sanitizeError(error) {
  return error instanceof Error ? error.message : String(error);
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

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
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

function startImportTask({ body }) {
  const sourceFile = body.file;
  const task = createTask("import", {
    sourceFile,
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
  const counters = { failedSource: 0, failedResult: 0 };

  setImmediate(async () => {
    try {
      const result = await importResourceBatch({
        batchName: body.name,
        downloadImages: body.downloadImages !== false,
        files: sourceFile ? [sourceFile] : [],
        onProgress: (event) => {
          logEvent("import", event);
          updateImportTaskFromProgress(task.id, event, counters);
        },
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
      logEvent("import", {
        event: "task-succeeded",
        taskId: task.id,
        batchId: result.batch.id,
        sourceFile: result.batch.sourceFile,
      });
    } catch (error) {
      finishTask(task.id, "failed", {
        error: sanitizeError(error),
        message: "Import failed",
      });
      logEvent("import", {
        event: "task-failed",
        taskId: task.id,
        sourceFile,
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
    next.summary = productCheckSummaryFromStatus(next);
  } else if (payload.event === "product-check:item") {
    const isChecked = payload.status === "checked";
    const isUnsupported = payload.status && payload.status !== "checked";
    next.status = "running";
    next.done = payload.index || (current.done || 0) + 1;
    next.total = payload.total || current.total || 0;
    next.currentIndex = payload.index || next.done;
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

async function startProductCheckRun(batchId) {
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

  const child = spawn(
    process.execPath,
    ["scripts/run-python.js", "scripts/product_check.py", "--batch", batchId, "--visualize"],
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
  if (req.method === "GET" && url.pathname === "/api/batches") {
    sendJson(res, 200, { batches: getBatches() });
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

  if (req.method === "GET" && url.pathname === "/api/resources") {
    sendJson(res, 200, { resources: await listResourceJsonFiles() });
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
    const task = startImportTask({ body });
    sendJson(res, 202, { task });
    return;
  }

  const batchItemsMatch = url.pathname.match(/^\/api\/batches\/([^/]+)\/items$/);
  if (req.method === "GET" && batchItemsMatch) {
    const batchId = batchItemsMatch[1];
    sendJson(res, 200, { items: getItemsForBatch(batchId) });
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
    if (!getBatches().some((batch) => batch.id === batchId)) {
      sendError(res, 404, "Batch not found");
      return;
    }
    const run = await startProductCheckRun(batchId);
    sendJson(res, run.statusCode, { run: run.status });
    return;
  }

  const productCheckRunLatestMatch = url.pathname.match(/^\/api\/batches\/([^/]+)\/product-check\/runs\/latest$/);
  if (req.method === "GET" && productCheckRunLatestMatch) {
    const batchId = productCheckRunLatestMatch[1];
    sendJson(res, 200, { run: await readProductCheckStatus(batchId) });
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
      const evaluation = saveEvaluation(itemId, body);
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
      const filePath = safeJoin(dataDir, url.pathname.slice("/data/".length));
      if (!filePath) {
        sendError(res, 403, "Invalid data path");
        return;
      }
      streamFile(res, filePath);
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
    console.error(error);
    if (error?.statusCode === 400 || error?.statusCode === 404 || error?.statusCode === 409) {
      sendError(res, error.statusCode, error.message);
      return;
    }
    sendError(res, 500, "Unexpected server error", error instanceof Error ? error.message : String(error));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`skill-eval running at http://127.0.0.1:${port}`);
});
