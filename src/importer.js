import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createBatch,
  getItemById,
  initializeDatabase,
  insertItem,
  nowIso,
  updateBatchCounts,
  updateItemCacheStatus,
  updateSingleImageCacheStatus,
} from "./db.js";
import { fetchBinaryWithFallbacks } from "./image-fetch.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const resourceDir = path.join(rootDir, "resource");
const cacheDir = path.join(rootDir, "data", "cache");
const importRunsDir = path.join(rootDir, "data", "import-runs");

const IMAGE_EXTENSIONS = new Map([
  ["image/jpeg", ".jpg"],
  ["image/jpg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
  ["image/avif", ".avif"],
]);
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const DEFAULT_CACHE_WORKERS = 4;

export function normalizeWorkerCount(value, fallback = DEFAULT_CACHE_WORKERS) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.floor(parsed));
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function batchIdForDate(date) {
  const stamp = date.toISOString().replace(/[:.]/g, "-");
  return `batch-${stamp}`;
}

function getContentArray(record) {
  if (Array.isArray(record?.params?.content)) return record.params.content;
  if (Array.isArray(record?.content)) return record.content;
  return [];
}

function extractText(record) {
  if (typeof record.text === "string" && record.text.trim()) return record.text.trim();
  const content = getContentArray(record);
  const textEntry = content.find((entry) => typeof entry?.text === "string" && entry.text.trim());
  return textEntry?.text?.trim() || "";
}

function extractUrl(record) {
  if (typeof record.url === "string" && record.url.trim()) return record.url.trim();
  const content = getContentArray(record);
  const urlEntry = content.find((entry) => typeof entry?.url === "string" && entry.url.trim());
  return urlEntry?.url?.trim() || "";
}

function normalizeRecord(record, rawJsonFile, rawIndex) {
  const model = String(record.model || record.provider || "unknown-model").trim();
  const text = extractText(record);
  const url = extractUrl(record);
  const resultUrl = String(record.resultUrl || record.result_url || "").trim();
  const optimizationPrompt = String(record.optimizationPrompt || record.optimization_prompt || "").trim();

  if (!text || !url || !resultUrl || !optimizationPrompt) {
    const missing = [];
    if (!text) missing.push("text");
    if (!url) missing.push("url");
    if (!resultUrl) missing.push("resultUrl");
    if (!optimizationPrompt) missing.push("optimizationPrompt");
    throw new Error(`Missing required field(s): ${missing.join(", ")}`);
  }

  const importKey = hash([model, text, url, resultUrl, optimizationPrompt].join("\n"));
  return {
    model,
    text,
    url,
    resultUrl,
    optimizationPrompt,
    importKey,
    rawJsonFile,
    rawIndex,
  };
}

function normalizeJsonPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.results)) return payload.results;
  return [payload];
}

function emitProgress(onProgress, event) {
  if (typeof onProgress !== "function") return;
  onProgress({
    at: nowIso(),
    ...event,
  });
}

function imageTypeFromBuffer(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  if (buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.toString("ascii", 0, 6))) {
    return "image/gif";
  }
  if (buffer.length >= 12 && buffer.toString("ascii", 4, 8) === "ftyp" && buffer.toString("ascii", 8, 12).startsWith("avi")) {
    return "image/avif";
  }
  return "";
}

function normalizeImageUpload(contentType, buffer) {
  const declaredType = String(contentType || "").split(";")[0]?.toLowerCase() || "";
  const detectedType = imageTypeFromBuffer(buffer);
  const type = IMAGE_EXTENSIONS.has(detectedType) ? detectedType : declaredType;
  const ext = IMAGE_EXTENSIONS.get(type);
  if (!ext) {
    throw new Error(`Unsupported image content-type: ${declaredType || detectedType || "missing"}`);
  }
  return { type, ext };
}

export async function cacheImage({ url, batchId, itemId, kind }) {
  const itemDir = path.join(cacheDir, batchId, itemId);
  mkdirSync(itemDir, { recursive: true });

  const response = await fetchBinaryWithFallbacks(url, {
    maxBytes: MAX_IMAGE_BYTES,
  });
  const contentType = response.headers.get("content-type")?.split(";")[0]?.toLowerCase() || "";
  const ext = IMAGE_EXTENSIONS.get(contentType);
  if (!ext) {
    throw new Error(`Unsupported image content-type: ${contentType || "missing"}`);
  }

  const relativePath = path.join("data", "cache", batchId, itemId, `${kind}${ext}`);
  const absolutePath = path.join(rootDir, relativePath);

  await writeFile(absolutePath, response.body);
  return relativePath;
}

export async function cacheBrowserUploadedImage({ itemId, kind, buffer, contentType, updateCounts = false }) {
  initializeDatabase();

  if (!["source", "result"].includes(kind)) {
    const error = new Error("Image kind must be source or result");
    error.statusCode = 400;
    throw error;
  }

  const item = getItemById(itemId);
  if (!item) {
    const error = new Error("Item not found");
    error.statusCode = 404;
    throw error;
  }

  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    const error = new Error("Uploaded image body is empty");
    error.statusCode = 400;
    throw error;
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    const error = new Error(`Image exceeds ${MAX_IMAGE_BYTES} bytes`);
    error.statusCode = 413;
    throw error;
  }

  let ext;
  try {
    ({ ext } = normalizeImageUpload(contentType, buffer));
  } catch (error) {
    error.statusCode = 400;
    throw error;
  }

  const itemDir = path.join(cacheDir, item.batch_id, itemId);
  mkdirSync(itemDir, { recursive: true });
  const relativePath = path.join("data", "cache", item.batch_id, itemId, `${kind}${ext}`);
  const absolutePath = path.join(rootDir, relativePath);
  await writeFile(absolutePath, buffer);

  updateSingleImageCacheStatus(itemId, kind, {
    imagePath: relativePath,
    fetchStatus: "success",
    fetchError: null,
  });
  if (updateCounts) {
    updateBatchCounts(item.batch_id);
  }

  return {
    itemId,
    batchId: item.batch_id,
    kind,
    imagePath: relativePath,
    imageUrl: `/${relativePath.replaceAll("\\", "/")}`,
    fetchStatus: "success",
    fetchError: null,
  };
}

export async function retryItemImage(itemId, kind) {
  initializeDatabase();

  if (!["source", "result"].includes(kind)) {
    const error = new Error("Image kind must be source or result");
    error.statusCode = 400;
    throw error;
  }

  const item = getItemById(itemId);
  if (!item) {
    const error = new Error("Item not found");
    error.statusCode = 404;
    throw error;
  }

  const url = kind === "source" ? item.url : item.result_url;
  const existingImagePath = kind === "source" ? item.source_image_path : item.result_image_path;
  const patch = {
    imagePath: existingImagePath,
    fetchStatus: "pending",
    fetchError: null,
  };

  try {
    patch.imagePath = await cacheImage({
      url,
      batchId: item.batch_id,
      itemId,
      kind,
    });
    patch.fetchStatus = "success";
  } catch (error) {
    patch.fetchStatus = "failed";
    patch.fetchError = error instanceof Error ? error.message : String(error);
  }

  updateSingleImageCacheStatus(itemId, kind, patch);
  updateBatchCounts(item.batch_id);

  return {
    itemId,
    batchId: item.batch_id,
    kind,
    imagePath: patch.imagePath,
    imageUrl: patch.imagePath ? `/${patch.imagePath.replaceAll("\\", "/")}` : "",
    fetchStatus: patch.fetchStatus,
    fetchError: patch.fetchError,
  };
}

export function normalizeResourceFileName(file) {
  const value = String(file || "").trim();
  const name = path.basename(value);
  if (!name || name !== value || path.isAbsolute(value) || value.includes("/") || value.includes("\\")) {
    const error = new Error("Resource file must be a JSON file name in resource/");
    error.statusCode = 400;
    throw error;
  }
  if (!name.toLowerCase().endsWith(".json")) {
    const error = new Error(`Resource file must be a JSON file: ${file}`);
    error.statusCode = 400;
    throw error;
  }
  return name;
}

export async function listResourceJsonFiles() {
  const files = (await readdir(resourceDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
    .map(async (entry) => {
      const fileStat = await stat(path.join(resourceDir, entry.name));
      return {
        file: entry.name,
        size: fileStat.size,
        mtime: fileStat.mtime.toISOString(),
      };
    });
  return (await Promise.all(files)).sort((a, b) => a.file.localeCompare(b.file));
}

async function readResourceRecords({ files: selectedFiles = [] } = {}) {
  let files = (await readdir(resourceDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
    .map((entry) => entry.name)
    .sort();

  if (selectedFiles.length > 0) {
    const selected = new Set(selectedFiles.map(normalizeResourceFileName));
    const missing = [...selected].filter((file) => !files.includes(file));
    if (missing.length > 0) {
      const error = new Error(`Resource file not found: ${missing.join(", ")}`);
      error.statusCode = 404;
      throw error;
    }
    files = files.filter((file) => selected.has(file));
  }

  const records = [];
  const errors = [];

  for (const file of files) {
    try {
      const raw = await readFile(path.join(resourceDir, file), "utf8");
      const payload = JSON.parse(raw);
      const items = normalizeJsonPayload(payload);
      items.forEach((item, index) => {
        try {
          records.push(normalizeRecord(item, file, index));
        } catch (error) {
          errors.push({
            file,
            index,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    } catch (error) {
      errors.push({
        file,
        index: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { records, errors, files };
}

async function writeImportRunSummary(batchId, summary) {
  mkdirSync(importRunsDir, { recursive: true });
  const filePath = path.join(importRunsDir, `${batchId}.json`);
  await writeFile(filePath, JSON.stringify(summary, null, 2), "utf8");
  return path.relative(rootDir, filePath);
}

async function cacheRecordImages({ record, batchId, itemId, itemIndex, total, downloadImages, onProgress }) {
  const patch = {
    sourceImagePath: null,
    resultImagePath: null,
    sourceFetchStatus: downloadImages ? "pending" : "skipped",
    resultFetchStatus: downloadImages ? "pending" : "skipped",
    sourceFetchError: null,
    resultFetchError: null,
  };

  if (!downloadImages) {
    return patch;
  }

  async function cacheKind(kind, url) {
    emitProgress(onProgress, {
      type: "import:image-start",
      batchId,
      itemId,
      index: itemIndex,
      total,
      model: record.model,
      imageKind: kind,
    });
    try {
      const imagePath = await cacheImage({
        url,
        batchId,
        itemId,
        kind,
      });
      emitProgress(onProgress, {
        type: "import:image-finish",
        batchId,
        itemId,
        index: itemIndex,
        total,
        model: record.model,
        imageKind: kind,
        imageStatus: "success",
      });
      return imagePath;
    } catch (error) {
      emitProgress(onProgress, {
        type: "import:image-finish",
        batchId,
        itemId,
        index: itemIndex,
        total,
        model: record.model,
        imageKind: kind,
        imageStatus: "failed",
      });
      throw error;
    }
  }

  const [sourceResult, resultResult] = await Promise.allSettled([
    cacheKind("source", record.url),
    cacheKind("result", record.resultUrl),
  ]);

  if (sourceResult.status === "fulfilled") {
    patch.sourceImagePath = sourceResult.value;
    patch.sourceFetchStatus = "success";
  } else {
    patch.sourceFetchStatus = "failed";
    patch.sourceFetchError = sourceResult.reason instanceof Error ? sourceResult.reason.message : String(sourceResult.reason);
  }

  if (resultResult.status === "fulfilled") {
    patch.resultImagePath = resultResult.value;
    patch.resultFetchStatus = "success";
  } else {
    patch.resultFetchStatus = "failed";
    patch.resultFetchError = resultResult.reason instanceof Error ? resultResult.reason.message : String(resultResult.reason);
  }

  return patch;
}

export async function importResourceBatch({ batchName, downloadImages = true, files = [], onProgress, cacheWorkers } = {}) {
  initializeDatabase();

  if (files.length !== 1) {
    const error = new Error("Exactly one resource JSON file must be selected for import");
    error.statusCode = 400;
    throw error;
  }

  const sourceFile = normalizeResourceFileName(files[0]);
  const startedAt = nowIso();
  emitProgress(onProgress, {
    type: "import:start",
    sourceFile,
    downloadImages,
  });
  const { records, errors, files: importedFiles } = await readResourceRecords({ files });
  const date = new Date();
  const batchId = batchIdForDate(date);
  const name = batchName || sourceFile;
  const importedAt = date.toISOString();

  createBatch({
    id: batchId,
    name,
    sourceDir: "resource",
    sourceFile,
    importedAt,
  });
  emitProgress(onProgress, {
    type: "import:parsed",
    batchId,
    sourceFile,
    parsed: records.length,
    parseErrors: errors.length,
  });

  let inserted = 0;
  let duplicate = 0;
  let cachedSource = 0;
  let cachedResult = 0;
  let processed = 0;
  const workerCount = normalizeWorkerCount(cacheWorkers ?? process.env.SKILL_EVAL_CACHE_WORKERS);
  const insertedRecords = [];

  for (const [recordIndex, record] of records.entries()) {
    const itemId = `item-${hash(`${batchId}\n${record.importKey}\n${record.rawJsonFile}\n${record.rawIndex}`)}`;
    const createdAt = nowIso();
    const baseItem = {
      id: itemId,
      batchId,
      rawJsonFile: record.rawJsonFile,
      rawIndex: record.rawIndex,
      model: record.model,
      text: record.text,
      url: record.url,
      resultUrl: record.resultUrl,
      optimizationPrompt: record.optimizationPrompt,
      sourceImagePath: null,
      resultImagePath: null,
      sourceFetchStatus: downloadImages ? "pending" : "skipped",
      resultFetchStatus: downloadImages ? "pending" : "skipped",
      sourceFetchError: null,
      resultFetchError: null,
      importKey: record.importKey,
      createdAt,
    };

    const wasInserted = insertItem(baseItem);
    if (!wasInserted) {
      duplicate += 1;
      processed += 1;
      emitProgress(onProgress, {
        type: "import:item",
        batchId,
        itemId,
        model: record.model,
        index: processed,
        total: records.length,
        inserted,
        duplicate,
        sourceStatus: "duplicate",
        resultStatus: "duplicate",
      });
      continue;
    }
    inserted += 1;
    insertedRecords.push({
      itemId,
      record,
      itemIndex: recordIndex + 1,
    });
  }

  async function finishInsertedRecord(entry) {
    emitProgress(onProgress, {
      type: "import:cache-start",
      batchId,
      itemId: entry.itemId,
      model: entry.record.model,
      index: entry.itemIndex,
      completed: processed,
      total: records.length,
      inserted,
      duplicate,
      cachedSource,
      cachedResult,
    });
    const patch = await cacheRecordImages({
      record: entry.record,
      batchId,
      itemId: entry.itemId,
      itemIndex: entry.itemIndex,
      total: records.length,
      downloadImages,
      onProgress,
    });
    updateItemCacheStatus(entry.itemId, patch);
    cachedSource += patch.sourceFetchStatus === "success" ? 1 : 0;
    cachedResult += patch.resultFetchStatus === "success" ? 1 : 0;
    processed += 1;
    emitProgress(onProgress, {
      type: "import:item",
      batchId,
      itemId: entry.itemId,
      model: entry.record.model,
      index: processed,
      total: records.length,
      inserted,
      duplicate,
      cachedSource,
      cachedResult,
      sourceStatus: patch.sourceFetchStatus,
      resultStatus: patch.resultFetchStatus,
    });
  }

  if (workerCount === 1 || insertedRecords.length <= 1) {
    for (const entry of insertedRecords) {
      await finishInsertedRecord(entry);
    }
  } else {
    const queue = [...insertedRecords];
    const workers = Array.from({ length: Math.min(workerCount, queue.length) }, async () => {
      while (queue.length > 0) {
        const entry = queue.shift();
        if (entry) {
          await finishInsertedRecord(entry);
        }
      }
    });
    await Promise.all(workers);
  }

  updateBatchCounts(batchId);

  const result = {
    batch: {
      id: batchId,
      name,
      importedAt,
      sourceDir: "resource",
      sourceFile,
    },
    files: importedFiles,
    parsed: records.length,
    inserted,
    duplicate,
    cachedSource,
    cachedResult,
    errors,
    cacheDir: path.relative(rootDir, path.join(cacheDir, batchId)),
    modelCounts: records.reduce((acc, record) => {
      acc[record.model] = (acc[record.model] || 0) + 1;
      return acc;
    }, {}),
  };

  result.importRun = await writeImportRunSummary(batchId, {
    batchId,
    sourceFile,
    startedAt,
    finishedAt: nowIso(),
    parsed: result.parsed,
    inserted,
    duplicate,
    cachedSource,
    cachedResult,
    errors,
    cacheDir: result.cacheDir,
    modelCounts: result.modelCounts,
  });
  emitProgress(onProgress, {
    type: "import:finish",
    batchId,
    sourceFile,
    parsed: result.parsed,
    inserted,
    duplicate,
    cachedSource,
    cachedResult,
    parseErrors: errors.length,
    importRun: result.importRun,
  });

  return result;
}
