import http from "node:http";
import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
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
import { importResourceBatch, retryItemImage } from "./src/importer.js";
import { listResourceJsonFiles } from "./src/importer.js";
import { EvaluationValidationError } from "./public/scoring.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const dataDir = path.join(__dirname, "data");
const productChecksDir = path.join(dataDir, "product-checks");
const port = Number(process.env.PORT || 4173);
const productCheckJobs = new Map();

initializeDatabase();

function nowIso() {
  return new Date().toISOString();
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

function writeProductCheckStatus(batchId, status) {
  const runDir = productCheckRunDir(batchId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(productCheckStatusPath(batchId), JSON.stringify(status, null, 2), "utf8");
  return status;
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
  return status;
}

async function appendProductCheckLog(batchId, message) {
  const runDir = productCheckRunDir(batchId);
  mkdirSync(runDir, { recursive: true });
  await appendFile(productCheckLogPath(batchId), message, "utf8");
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
    startedAt: nowIso(),
    finishedAt: null,
    pid: null,
    exitCode: null,
    summary: null,
    error: null,
  });
  await writeFile(productCheckLogPath(batchId), "", "utf8");

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

  child.stdout.on("data", (chunk) => {
    appendProductCheckLog(batchId, chunk.toString()).catch((error) => console.error(error));
  });
  child.stderr.on("data", (chunk) => {
    appendProductCheckLog(batchId, chunk.toString()).catch((error) => console.error(error));
  });
  child.on("error", (error) => {
    const next = {
      ...status,
      status: "failed",
      finishedAt: nowIso(),
      exitCode: null,
      error: error.message,
    };
    productCheckJobs.delete(batchId);
    writeProductCheckStatus(batchId, next);
  });
  child.on("close", async (code) => {
    productCheckJobs.delete(batchId);
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
    writeProductCheckStatus(batchId, {
      batchId,
      status: code === 0 && !error ? "succeeded" : "failed",
      startedAt: status.startedAt,
      finishedAt: nowIso(),
      pid: child.pid,
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

  if (req.method === "GET" && url.pathname === "/api/resources") {
    sendJson(res, 200, { resources: await listResourceJsonFiles() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/import") {
    const body = await readBody(req);
    const result = await importResourceBatch({
      batchName: body.name,
      downloadImages: body.downloadImages !== false,
      files: body.file ? [body.file] : [],
    });
    sendJson(res, 200, result);
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
