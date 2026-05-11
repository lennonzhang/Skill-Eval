import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  getBatchStats,
  getBatches,
  getItemsForBatch,
  initializeDatabase,
  saveEvaluation,
} from "./src/db.js";
import { importResourceBatch } from "./src/importer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const dataDir = path.join(__dirname, "data");
const port = Number(process.env.PORT || 4173);

initializeDatabase();

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
  return raw ? JSON.parse(raw) : {};
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
  const decoded = decodeURIComponent(requestPath);
  const target = path.normalize(path.join(baseDir, decoded));
  if (!target.startsWith(baseDir)) {
    return null;
  }
  return target;
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/batches") {
    sendJson(res, 200, { batches: getBatches() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/import") {
    const body = await readBody(req);
    const result = await importResourceBatch({
      batchName: body.name,
      downloadImages: body.downloadImages !== false,
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

  const evaluationMatch = url.pathname.match(/^\/api\/items\/([^/]+)\/evaluation$/);
  if (req.method === "POST" && evaluationMatch) {
    const itemId = evaluationMatch[1];
    const body = await readBody(req);
    const evaluation = saveEvaluation(itemId, body);
    sendJson(res, 200, { evaluation });
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
    sendError(res, 500, "Unexpected server error", error instanceof Error ? error.message : String(error));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`skill-eval running at http://127.0.0.1:${port}`);
});
