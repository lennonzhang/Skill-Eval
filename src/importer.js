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
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

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

export async function cacheImage({ url, batchId, itemId, kind }) {
  const itemDir = path.join(cacheDir, batchId, itemId);
  mkdirSync(itemDir, { recursive: true });

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type")?.split(";")[0]?.toLowerCase() || "";
  const ext = IMAGE_EXTENSIONS.get(contentType);
  if (!ext) {
    throw new Error(`Unsupported image content-type: ${contentType || "missing"}`);
  }

  const relativePath = path.join("data", "cache", batchId, itemId, `${kind}${ext}`);
  const absolutePath = path.join(rootDir, relativePath);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error(`Image exceeds ${MAX_IMAGE_BYTES} bytes`);
  }

  await writeFile(absolutePath, buffer);
  return relativePath;
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

export async function importResourceBatch({ batchName, downloadImages = true, files = [] } = {}) {
  initializeDatabase();

  if (files.length !== 1) {
    const error = new Error("Exactly one resource JSON file must be selected for import");
    error.statusCode = 400;
    throw error;
  }

  const sourceFile = normalizeResourceFileName(files[0]);
  const startedAt = nowIso();
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

  let inserted = 0;
  let duplicate = 0;
  let cachedSource = 0;
  let cachedResult = 0;

  for (const record of records) {
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
      continue;
    }
    inserted += 1;

    if (!downloadImages) continue;

    const patch = {
      sourceImagePath: null,
      resultImagePath: null,
      sourceFetchStatus: "pending",
      resultFetchStatus: "pending",
      sourceFetchError: null,
      resultFetchError: null,
    };

    try {
      patch.sourceImagePath = await cacheImage({
        url: record.url,
        batchId,
        itemId,
        kind: "source",
      });
      patch.sourceFetchStatus = "success";
      cachedSource += 1;
    } catch (error) {
      patch.sourceFetchStatus = "failed";
      patch.sourceFetchError = error instanceof Error ? error.message : String(error);
    }

    try {
      patch.resultImagePath = await cacheImage({
        url: record.resultUrl,
        batchId,
        itemId,
        kind: "result",
      });
      patch.resultFetchStatus = "success";
      cachedResult += 1;
    } catch (error) {
      patch.resultFetchStatus = "failed";
      patch.resultFetchError = error instanceof Error ? error.message : String(error);
    }

    updateItemCacheStatus(itemId, patch);
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

  return result;
}
