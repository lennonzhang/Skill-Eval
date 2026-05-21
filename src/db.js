import { mkdirSync } from "node:fs";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import { calculateOverallScore, scoreFieldNames, validateEvaluationInput } from "../public/scoring.js";
import { databasePath, dataDir } from "./paths.js";

let db;

const evaluationColumns = [
  "id",
  "item_id",
  ...scoreFieldNames,
  "overall_score",
  "status",
  "tags",
  "comment",
  "created_at",
  "updated_at",
  "reviewer_id",
  "reviewer_name",
];
const reviewerColumns = new Set(["reviewer_id", "reviewer_name"]);
const excludeReasons = new Set(["internal_test", "bad_input", "duplicate", "wrong_task", "missing_image", "not_evaluable", "other"]);
const EXCLUDE_NOTE_MAX_LENGTH = 500;
const batchArchiveReasons = new Set(["completed", "bad_import", "duplicate", "deprecated", "other"]);
const BATCH_ARCHIVE_NOTE_MAX_LENGTH = 500;

export function initializeDatabase() {
  if (db) return db;

  mkdirSync(dataDir, { recursive: true });
  db = new DatabaseSync(databasePath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  // Schema source of truth. Keep column intent here instead of a separate schema.sql:
  // batches.source_sha256/content_sha256 record local dataset provenance for reproducible reports.
  // items.raw_json_file/raw_index preserve traceability without storing external URLs in reports.
  // batches.archived_at/archive_reason/archive_note are reversible local lifecycle metadata.
  // items.excluded_at/exclude_reason/exclude_note are soft exclusion metadata; excluded rows stay visible but leave review stats.
  // audit_events stores local, sanitized mutation traces; it is intentionally not cascaded on batch deletion.
  // annotations stores append-only human review history while evaluations remains the latest human review snapshot.
  // evaluations stores human review only; automated Product Check remains advisory file output.
  db.exec(`
    CREATE TABLE IF NOT EXISTS batches (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      source_dir TEXT NOT NULL,
      source_file TEXT,
      source_sha256 TEXT,
      source_size_bytes INTEGER,
      content_sha256 TEXT,
      import_schema_version TEXT,
      imported_at TEXT NOT NULL,
      item_count INTEGER NOT NULL DEFAULT 0,
      cached_source_count INTEGER NOT NULL DEFAULT 0,
      cached_result_count INTEGER NOT NULL DEFAULT 0,
      archived_at TEXT,
      archive_reason TEXT,
      archive_note TEXT,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
      raw_json_file TEXT NOT NULL,
      raw_index INTEGER NOT NULL,
      model TEXT NOT NULL,
      text TEXT NOT NULL,
      url TEXT NOT NULL,
      result_url TEXT NOT NULL,
      optimization_prompt TEXT NOT NULL,
      source_image_path TEXT,
      result_image_path TEXT,
      source_fetch_status TEXT NOT NULL DEFAULT 'pending',
      result_fetch_status TEXT NOT NULL DEFAULT 'pending',
      source_fetch_error TEXT,
      result_fetch_error TEXT,
      import_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      excluded_at TEXT,
      exclude_reason TEXT,
      exclude_note TEXT,
      UNIQUE(batch_id, import_key)
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      batch_id TEXT,
      item_id TEXT,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS annotations (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      batch_id TEXT NOT NULL,
      reviewer_id TEXT,
      reviewer_name TEXT,
      source TEXT NOT NULL DEFAULT 'human',
      status TEXT NOT NULL,
      scores_json TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      comment TEXT,
      overall_score REAL,
      created_at TEXT NOT NULL,
      superseded_by TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_annotations_item_created
      ON annotations(item_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_annotations_batch_created
      ON annotations(batch_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_annotations_reviewer_created
      ON annotations(reviewer_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_audit_events_batch_created
      ON audit_events(batch_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_audit_events_item_created
      ON audit_events(item_id, created_at DESC);

  `);
  ensureBatchSchema();
  ensureItemSchema();
  ensureEvaluationSchema();

  return db;
}

function ensureBatchSchema() {
  const existing = db.prepare("PRAGMA table_info(batches)").all();
  const existingColumns = existing.map((column) => column.name);
  if (!existingColumns.includes("source_file")) {
    // Backfill-compatible migration for databases created before one JSON became one batch.
    db.exec("ALTER TABLE batches ADD COLUMN source_file TEXT");
  }
  if (!existingColumns.includes("archived_at")) {
    db.exec("ALTER TABLE batches ADD COLUMN archived_at TEXT");
  }
  if (!existingColumns.includes("archive_reason")) {
    db.exec("ALTER TABLE batches ADD COLUMN archive_reason TEXT");
  }
  if (!existingColumns.includes("archive_note")) {
    db.exec("ALTER TABLE batches ADD COLUMN archive_note TEXT");
  }
  if (!existingColumns.includes("source_sha256")) {
    db.exec("ALTER TABLE batches ADD COLUMN source_sha256 TEXT");
  }
  if (!existingColumns.includes("source_size_bytes")) {
    db.exec("ALTER TABLE batches ADD COLUMN source_size_bytes INTEGER");
  }
  if (!existingColumns.includes("content_sha256")) {
    db.exec("ALTER TABLE batches ADD COLUMN content_sha256 TEXT");
  }
  if (!existingColumns.includes("import_schema_version")) {
    db.exec("ALTER TABLE batches ADD COLUMN import_schema_version TEXT");
  }
}

function ensureItemSchema() {
  const existing = db.prepare("PRAGMA table_info(items)").all();
  const existingColumns = existing.map((column) => column.name);
  if (!existingColumns.includes("excluded_at")) {
    db.exec("ALTER TABLE items ADD COLUMN excluded_at TEXT");
  }
  if (!existingColumns.includes("exclude_reason")) {
    db.exec("ALTER TABLE items ADD COLUMN exclude_reason TEXT");
  }
  if (!existingColumns.includes("exclude_note")) {
    db.exec("ALTER TABLE items ADD COLUMN exclude_note TEXT");
  }
}

export function migrateEvaluationSchema(database) {
  const existing = database.prepare("PRAGMA table_info(evaluations)").all();
  if (existing.length > 0) {
    const existingColumns = existing.map((column) => column.name);
    const nonReviewerColumns = evaluationColumns.filter((column) => !reviewerColumns.has(column));
    const missingRequiredColumns = nonReviewerColumns.filter((column) => !existingColumns.includes(column));
    if (missingRequiredColumns.length > 0) {
      const error = new Error(
        `Unsafe evaluations schema migration refused: missing required columns ${missingRequiredColumns.join(
          ", "
        )}. Back up app.sqlite and run an explicit migration instead.`
      );
      error.code = "UNSAFE_EVALUATIONS_SCHEMA";
      throw error;
    }

    if (!existingColumns.includes("reviewer_id")) {
      database.exec("ALTER TABLE evaluations ADD COLUMN reviewer_id TEXT");
    }
    if (!existingColumns.includes("reviewer_name")) {
      database.exec("ALTER TABLE evaluations ADD COLUMN reviewer_name TEXT");
    }
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS evaluations (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL UNIQUE REFERENCES items(id) ON DELETE CASCADE,
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
      updated_at TEXT NOT NULL,
      reviewer_id TEXT,
      reviewer_name TEXT
    );
  `);
}

function ensureEvaluationSchema() {
  migrateEvaluationSchema(db);
}

export function getDatabase() {
  return initializeDatabase();
}

export function nowIso() {
  return new Date().toISOString();
}

export function createBatch({
  id,
  name,
  sourceDir,
  sourceFile = "",
  sourceSha256 = null,
  sourceSizeBytes = null,
  contentSha256 = null,
  importSchemaVersion = null,
  importedAt,
  notes = "",
}) {
  getDatabase()
    .prepare(
      `INSERT INTO batches (
        id,
        name,
        source_dir,
        source_file,
        source_sha256,
        source_size_bytes,
        content_sha256,
        import_schema_version,
        imported_at,
        notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      name,
      sourceDir,
      sourceFile,
      sourceSha256,
      sourceSizeBytes,
      contentSha256,
      importSchemaVersion,
      importedAt,
      notes
    );
}

export function insertItem(item) {
  const result = getDatabase()
    .prepare(
      `INSERT OR IGNORE INTO items (
        id,
        batch_id,
        raw_json_file,
        raw_index,
        model,
        text,
        url,
        result_url,
        optimization_prompt,
        source_image_path,
        result_image_path,
        source_fetch_status,
        result_fetch_status,
        source_fetch_error,
        result_fetch_error,
        import_key,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      item.id,
      item.batchId,
      item.rawJsonFile,
      item.rawIndex,
      item.model,
      item.text,
      item.url,
      item.resultUrl,
      item.optimizationPrompt,
      item.sourceImagePath,
      item.resultImagePath,
      item.sourceFetchStatus,
      item.resultFetchStatus,
      item.sourceFetchError,
      item.resultFetchError,
      item.importKey,
      item.createdAt
    );
  return result.changes > 0;
}

export function updateItemCacheStatus(itemId, patch) {
  getDatabase()
    .prepare(
      `UPDATE items
       SET source_image_path = ?,
           result_image_path = ?,
           source_fetch_status = ?,
           result_fetch_status = ?,
           source_fetch_error = ?,
           result_fetch_error = ?
       WHERE id = ?`
    )
    .run(
      patch.sourceImagePath,
      patch.resultImagePath,
      patch.sourceFetchStatus,
      patch.resultFetchStatus,
      patch.sourceFetchError,
      patch.resultFetchError,
      itemId
    );
}

export function updateBatchCounts(batchId) {
  const counts = getDatabase()
    .prepare(
      `SELECT
        COUNT(*) AS item_count,
        SUM(CASE WHEN source_fetch_status = 'success' THEN 1 ELSE 0 END) AS cached_source_count,
        SUM(CASE WHEN result_fetch_status = 'success' THEN 1 ELSE 0 END) AS cached_result_count
       FROM items
       WHERE batch_id = ?
         AND excluded_at IS NULL`
    )
    .get(batchId);

  getDatabase()
    .prepare(
      `UPDATE batches
       SET item_count = ?,
           cached_source_count = ?,
           cached_result_count = ?
       WHERE id = ?`
    )
    .run(
      counts.item_count || 0,
      counts.cached_source_count || 0,
      counts.cached_result_count || 0,
      batchId
    );
}

function batchSelectSql(whereClause = "") {
  return `SELECT
        b.id,
        b.name,
        b.source_dir,
        b.source_file,
        b.source_sha256,
        b.source_size_bytes,
        b.content_sha256,
        b.import_schema_version,
        b.imported_at,
        b.archived_at,
        b.archive_reason,
        b.archive_note,
        b.notes,
        SUM(CASE WHEN i.id IS NOT NULL AND i.excluded_at IS NULL THEN 1 ELSE 0 END) AS item_count,
        SUM(CASE WHEN i.id IS NOT NULL AND i.excluded_at IS NOT NULL THEN 1 ELSE 0 END) AS excluded_count,
        SUM(CASE WHEN i.id IS NOT NULL AND i.excluded_at IS NULL AND e.id IS NOT NULL THEN 1 ELSE 0 END) AS reviewed_count
       FROM batches b
       LEFT JOIN items i ON i.batch_id = b.id
       LEFT JOIN evaluations e ON e.item_id = i.id
       ${whereClause}
       GROUP BY b.id`;
}

export function getBatches({ includeArchived = false } = {}) {
  return getDatabase()
    .prepare(
      `${batchSelectSql("WHERE (? = 1 OR b.archived_at IS NULL)")}
       ORDER BY b.archived_at IS NOT NULL ASC, b.imported_at DESC`
    )
    .all(includeArchived ? 1 : 0);
}

export function getBatchById(batchId, { includeArchived = false } = {}) {
  return (
    getDatabase()
      .prepare(`${batchSelectSql("WHERE b.id = ? AND (? = 1 OR b.archived_at IS NULL)")}`)
      .get(batchId, includeArchived ? 1 : 0) || null
  );
}

export function getBatchBySourceDigest(digest) {
  const normalized = String(digest || "").trim();
  if (!normalized) return [];
  return getDatabase()
    .prepare(
      `${batchSelectSql("WHERE b.source_sha256 = ?")}
       ORDER BY b.imported_at DESC`
    )
    .all(normalized);
}

export function batchExists(batchId, options = {}) {
  return Boolean(getBatchById(batchId, options));
}

function parseLimit(value, fallback = 100) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(500, Math.floor(parsed));
}

export function recordAuditEvent({ eventType, entityType, entityId = null, batchId = null, itemId = null, payload = {} }) {
  const event = {
    id: crypto.randomUUID(),
    event_type: String(eventType || "").trim(),
    entity_type: String(entityType || "").trim(),
    entity_id: entityId || null,
    batch_id: batchId || null,
    item_id: itemId || null,
    payload_json: JSON.stringify(payload || {}),
    created_at: nowIso(),
  };
  if (!event.event_type || !event.entity_type) {
    const error = new Error("Audit event type and entity type are required");
    error.statusCode = 400;
    throw error;
  }
  getDatabase()
    .prepare(
      `INSERT INTO audit_events (
        id,
        event_type,
        entity_type,
        entity_id,
        batch_id,
        item_id,
        payload_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      event.id,
      event.event_type,
      event.entity_type,
      event.entity_id,
      event.batch_id,
      event.item_id,
      event.payload_json,
      event.created_at
    );
  return {
    id: event.id,
    eventType: event.event_type,
    entityType: event.entity_type,
    entityId: event.entity_id,
    batchId: event.batch_id,
    itemId: event.item_id,
    payload: JSON.parse(event.payload_json),
    createdAt: event.created_at,
  };
}

export function getAuditEvents({ batchId = "", itemId = "", limit = 100 } = {}) {
  const clauses = [];
  const args = [];
  if (batchId) {
    clauses.push("batch_id = ?");
    args.push(batchId);
  }
  if (itemId) {
    clauses.push("item_id = ?");
    args.push(itemId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = getDatabase()
    .prepare(
      `SELECT
        id,
        event_type,
        entity_type,
        entity_id,
        batch_id,
        item_id,
        payload_json,
        created_at
       FROM audit_events
       ${where}
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(...args, parseLimit(limit));
  return rows.map((row) => ({
    id: row.id,
    eventType: row.event_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    batchId: row.batch_id,
    itemId: row.item_id,
    payload: JSON.parse(row.payload_json || "{}"),
    createdAt: row.created_at,
  }));
}

function normalizeBatchArchiveInput(input) {
  const reason = String(input?.reason || "other").trim();
  if (!batchArchiveReasons.has(reason)) {
    const error = new Error("Invalid archive reason");
    error.statusCode = 400;
    error.issues = [...batchArchiveReasons].sort();
    throw error;
  }

  const note = String(input?.note || "").trim();
  if (note.length > BATCH_ARCHIVE_NOTE_MAX_LENGTH) {
    const error = new Error(`Archive note must be ${BATCH_ARCHIVE_NOTE_MAX_LENGTH} characters or less`);
    error.statusCode = 400;
    throw error;
  }

  return { reason, note };
}

export function archiveBatch(batchId, input = {}) {
  if (!getBatchById(batchId, { includeArchived: true })) {
    const error = new Error("Batch not found");
    error.statusCode = 404;
    throw error;
  }

  const normalized = normalizeBatchArchiveInput(input);
  getDatabase()
    .prepare(
      `UPDATE batches
       SET archived_at = ?,
           archive_reason = ?,
           archive_note = ?
       WHERE id = ?`
    )
    .run(nowIso(), normalized.reason, normalized.note, batchId);
  return getBatchById(batchId, { includeArchived: true });
}

export function restoreBatch(batchId) {
  if (!getBatchById(batchId, { includeArchived: true })) {
    const error = new Error("Batch not found");
    error.statusCode = 404;
    throw error;
  }

  getDatabase()
    .prepare(
      `UPDATE batches
       SET archived_at = NULL,
           archive_reason = NULL,
           archive_note = NULL
       WHERE id = ?`
    )
    .run(batchId);
  return getBatchById(batchId, { includeArchived: true });
}

export function getBatchDeleteCounts(batchId) {
  if (!getBatchById(batchId, { includeArchived: true })) {
    const error = new Error("Batch not found");
    error.statusCode = 404;
    throw error;
  }

  const row = getDatabase()
    .prepare(
      `SELECT
        COUNT(DISTINCT i.id) AS items,
        COUNT(DISTINCT e.id) AS evaluations,
        COUNT(DISTINCT a.id) AS annotations
       FROM batches b
       LEFT JOIN items i ON i.batch_id = b.id
       LEFT JOIN evaluations e ON e.item_id = i.id
       LEFT JOIN annotations a ON a.item_id = i.id
       WHERE b.id = ?`
    )
    .get(batchId);
  return {
    items: row.items || 0,
    evaluations: row.evaluations || 0,
    annotations: row.annotations || 0,
  };
}

export function deleteBatchRecord(batchId) {
  const database = getDatabase();
  const savepoint = `delete_batch_${crypto.randomUUID().replaceAll("-", "")}`;
  database.exec(`SAVEPOINT ${savepoint}`);
  try {
    const counts = getBatchDeleteCounts(batchId);
    const result = database.prepare("DELETE FROM batches WHERE id = ?").run(batchId);
    if (result.changes === 0) {
      const error = new Error("Batch not found");
      error.statusCode = 404;
      throw error;
    }
    database.exec(`RELEASE ${savepoint}`);
    return { batchId, deleted: true, ...counts };
  } catch (error) {
    database.exec(`ROLLBACK TO ${savepoint}`);
    database.exec(`RELEASE ${savepoint}`);
    throw error;
  }
}

export function getItemsForBatch(batchId) {
  return getDatabase()
    .prepare(
      `SELECT
        i.*,
        e.product_preservation_score,
        e.instruction_adherence_score,
        e.integration_grounding_score,
        e.prompt_optimization_value_score,
        e.commercial_quality_score,
        e.technical_safety_score,
        e.overall_score,
        e.status,
        e.tags,
        e.comment,
        e.updated_at AS evaluation_updated_at,
        e.reviewer_id,
        e.reviewer_name,
        CASE WHEN i.excluded_at IS NULL THEN 0 ELSE 1 END AS is_excluded
       FROM items i
       LEFT JOIN evaluations e ON e.item_id = i.id
       WHERE i.batch_id = ?
       ORDER BY
         CASE WHEN i.excluded_at IS NULL THEN 0 ELSE 1 END ASC,
         i.raw_json_file ASC,
         i.raw_index ASC,
         i.model ASC`
    )
    .all(batchId)
    .map((item) => ({
      ...item,
      tags: item.tags ? JSON.parse(item.tags) : [],
      source_image_url: item.source_image_path ? `/${item.source_image_path.replaceAll("\\", "/")}` : "",
      result_image_url: item.result_image_path ? `/${item.result_image_path.replaceAll("\\", "/")}` : "",
    }));
}

function toNumberFilter(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function matchesCacheStatus(item, cacheStatus) {
  if (!cacheStatus || cacheStatus === "all") return true;
  const source = item.source_fetch_status || "missing";
  const result = item.result_fetch_status || "missing";
  if (cacheStatus === "cached") return source === "success" && result === "success";
  if (cacheStatus === "failed") return source === "failed" || result === "failed";
  if (cacheStatus === "missing") return source !== "success" || result !== "success";
  if (cacheStatus === "source_failed") return source === "failed";
  if (cacheStatus === "result_failed") return result === "failed";
  return true;
}

export function filterBatchItems(items, filters = {}, productCheckByItemId = new Map()) {
  const model = String(filters.model || "all");
  const status = String(filters.status || "all");
  const query = String(filters.search || filters.q || "").trim().toLowerCase();
  const scoreMin = toNumberFilter(filters.scoreMin);
  const scoreMax = toNumberFilter(filters.scoreMax);
  const tagIncludes = Array.isArray(filters.tagIncludes) ? filters.tagIncludes.filter(Boolean) : [];
  const tagExcludes = Array.isArray(filters.tagExcludes) ? filters.tagExcludes.filter(Boolean) : [];
  const reviewer = String(filters.reviewer || "").trim().toLowerCase();
  const productCheckDeltaMin = toNumberFilter(filters.productCheckDeltaMin);
  const cacheStatus = String(filters.cacheStatus || "all");

  return items.filter((item) => {
    const excluded = Boolean(item.is_excluded);
    const reviewed = item.overall_score !== null && item.overall_score !== undefined;
    if (model !== "all" && item.model !== model) return false;
    if (status === "active" && excluded) return false;
    if (status === "excluded" && !excluded) return false;
    if (status === "reviewed" && (excluded || !reviewed || item.status !== "reviewed")) return false;
    if (status === "needs_recheck" && (excluded || item.status !== "needs_recheck")) return false;
    if (status === "failed" && (excluded || item.status !== "failed")) return false;
    if (status === "unreviewed" && (excluded || reviewed)) return false;
    if (scoreMin !== null && (!reviewed || Number(item.overall_score) < scoreMin)) return false;
    if (scoreMax !== null && (!reviewed || Number(item.overall_score) > scoreMax)) return false;
    const tags = Array.isArray(item.tags) ? item.tags : [];
    if (tagIncludes.length && !tagIncludes.every((tag) => tags.includes(tag))) return false;
    if (tagExcludes.length && tagExcludes.some((tag) => tags.includes(tag))) return false;
    if (reviewer) {
      const reviewerText = `${item.reviewer_id || ""} ${item.reviewer_name || ""}`.toLowerCase();
      if (!reviewerText.includes(reviewer)) return false;
    }
    if (!matchesCacheStatus(item, cacheStatus)) return false;
    if (productCheckDeltaMin !== null) {
      const productCheck = productCheckByItemId.get(item.id);
      const suggested = Number(productCheck?.suggestedScore);
      const human = Number(item.product_preservation_score);
      if (!Number.isFinite(suggested) || !Number.isFinite(human)) return false;
      if (Math.abs(suggested - human) < productCheckDeltaMin) return false;
    }
    if (query) {
      const haystack = [
        item.id,
        item.model,
        item.text,
        item.optimization_prompt,
        item.raw_json_file,
        item.exclude_reason,
        item.exclude_note,
        item.reviewer_id,
        item.reviewer_name,
        ...tags,
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

export function getItemById(itemId) {
  return getDatabase().prepare("SELECT * FROM items WHERE id = ?").get(itemId);
}

export function itemExists(itemId) {
  return Boolean(getDatabase().prepare("SELECT 1 FROM items WHERE id = ?").get(itemId));
}

function normalizeExcludeInput(input) {
  const excluded = Boolean(input?.excluded);
  if (!excluded) {
    return {
      excluded: false,
      reason: null,
      note: null,
    };
  }

  const reason = String(input.reason || "").trim();
  if (!excludeReasons.has(reason)) {
    const error = new Error("Invalid exclude reason");
    error.statusCode = 400;
    error.issues = [...excludeReasons].sort();
    throw error;
  }

  const note = String(input.note || "").trim();
  if (note.length > EXCLUDE_NOTE_MAX_LENGTH) {
    const error = new Error(`Exclude note must be ${EXCLUDE_NOTE_MAX_LENGTH} characters or less`);
    error.statusCode = 400;
    throw error;
  }

  return {
    excluded: true,
    reason,
    note,
  };
}

export function setItemExclusion(itemId, input) {
  const item = getItemById(itemId);
  if (!item) {
    const error = new Error("Item not found");
    error.statusCode = 404;
    throw error;
  }

  const normalized = normalizeExcludeInput(input);
  if (normalized.excluded) {
    getDatabase()
      .prepare(
        `UPDATE items
         SET excluded_at = ?,
             exclude_reason = ?,
             exclude_note = ?
         WHERE id = ?`
      )
      .run(nowIso(), normalized.reason, normalized.note, itemId);
  } else {
    getDatabase()
      .prepare(
        `UPDATE items
         SET excluded_at = NULL,
             exclude_reason = NULL,
             exclude_note = NULL
         WHERE id = ?`
      )
      .run(itemId);
  }

  updateBatchCounts(item.batch_id);
  const updated = getItemById(itemId);
  return {
    id: updated.id,
    batch_id: updated.batch_id,
    is_excluded: updated.excluded_at ? 1 : 0,
    excluded_at: updated.excluded_at,
    exclude_reason: updated.exclude_reason,
    exclude_note: updated.exclude_note,
  };
}

export function updateSingleImageCacheStatus(itemId, kind, patch) {
  if (!["source", "result"].includes(kind)) {
    throw new Error(`Invalid image kind: ${kind}`);
  }

  const columnPrefix = kind === "source" ? "source" : "result";
  getDatabase()
    .prepare(
      `UPDATE items
       SET ${columnPrefix}_image_path = ?,
           ${columnPrefix}_fetch_status = ?,
           ${columnPrefix}_fetch_error = ?
       WHERE id = ?`
    )
    .run(patch.imagePath, patch.fetchStatus, patch.fetchError, itemId);
}

export function saveEvaluation(itemId, input) {
  const item = getItemById(itemId);
  if (!item) {
    const error = new Error("Item not found");
    error.statusCode = 404;
    throw error;
  }
  const validInput = validateEvaluationInput(input);
  const reviewerId = input?.reviewer?.id || null;
  const reviewerName = input?.reviewer?.name || null;
  const database = getDatabase();
  const savepoint = `save_evaluation_${crypto.randomUUID().replaceAll("-", "")}`;
  database.exec(`SAVEPOINT ${savepoint}`);
  try {
    const existing = database.prepare("SELECT id, created_at FROM evaluations WHERE item_id = ?").get(itemId);
    const timestamp = nowIso();
    const scores = Object.fromEntries(scoreFieldNames.map((field) => [field, validInput[field]]));
    const evaluation = {
      id: existing?.id || crypto.randomUUID(),
      item_id: itemId,
      ...scores,
      status: validInput.status,
      tags: JSON.stringify(validInput.tags),
      comment: validInput.comment,
      created_at: existing?.created_at || timestamp,
      updated_at: timestamp,
      reviewer_id: reviewerId,
      reviewer_name: reviewerName,
    };
    evaluation.overall_score = calculateOverallScore(evaluation);

    const annotation = {
      id: crypto.randomUUID(),
      item_id: itemId,
      batch_id: item.batch_id,
      reviewer_id: reviewerId,
      reviewer_name: reviewerName,
      source: "human",
      status: evaluation.status,
      scores_json: JSON.stringify(scores),
      tags_json: evaluation.tags,
      comment: evaluation.comment,
      overall_score: evaluation.overall_score,
      created_at: timestamp,
    };

    database
      .prepare(
        `INSERT INTO annotations (
          id,
          item_id,
          batch_id,
          reviewer_id,
          reviewer_name,
          source,
          status,
          scores_json,
          tags_json,
          comment,
          overall_score,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        annotation.id,
        annotation.item_id,
        annotation.batch_id,
        annotation.reviewer_id,
        annotation.reviewer_name,
        annotation.source,
        annotation.status,
        annotation.scores_json,
        annotation.tags_json,
        annotation.comment,
        annotation.overall_score,
        annotation.created_at
      );

    database
      .prepare(
        `INSERT INTO evaluations (
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
          updated_at,
          reviewer_id,
          reviewer_name
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(item_id) DO UPDATE SET
          product_preservation_score = excluded.product_preservation_score,
          instruction_adherence_score = excluded.instruction_adherence_score,
          integration_grounding_score = excluded.integration_grounding_score,
          prompt_optimization_value_score = excluded.prompt_optimization_value_score,
          commercial_quality_score = excluded.commercial_quality_score,
          technical_safety_score = excluded.technical_safety_score,
          overall_score = excluded.overall_score,
          status = excluded.status,
          tags = excluded.tags,
          comment = excluded.comment,
          updated_at = excluded.updated_at,
          reviewer_id = excluded.reviewer_id,
          reviewer_name = excluded.reviewer_name`
      )
      .run(
        evaluation.id,
        evaluation.item_id,
        evaluation.product_preservation_score,
        evaluation.instruction_adherence_score,
        evaluation.integration_grounding_score,
        evaluation.prompt_optimization_value_score,
        evaluation.commercial_quality_score,
        evaluation.technical_safety_score,
        evaluation.overall_score,
        evaluation.status,
        evaluation.tags,
        evaluation.comment,
        evaluation.created_at,
        evaluation.updated_at,
        evaluation.reviewer_id,
        evaluation.reviewer_name
      );

    recordAuditEvent({
      eventType: "evaluation.save",
      entityType: "annotation",
      entityId: annotation.id,
      batchId: item.batch_id,
      itemId,
      payload: {
        annotationId: annotation.id,
        status: evaluation.status,
        overallScore: evaluation.overall_score,
        scoreFieldsPresent: scoreFieldNames.filter((field) => evaluation[field] !== null && evaluation[field] !== undefined),
        tagCount: validInput.tags.length,
        commentLength: validInput.comment.length,
        reviewer: reviewerId || reviewerName ? { id: reviewerId, name: reviewerName } : null,
      },
    });

    database.exec(`RELEASE ${savepoint}`);
    return {
      ...evaluation,
      annotationId: annotation.id,
      tags: JSON.parse(evaluation.tags),
    };
  } catch (error) {
    database.exec(`ROLLBACK TO ${savepoint}`);
    database.exec(`RELEASE ${savepoint}`);
    throw error;
  }
}

export function getAnnotationsForItem(itemId, { limit = 100 } = {}) {
  const rows = getDatabase()
    .prepare(
      `SELECT
        id,
        item_id,
        batch_id,
        reviewer_id,
        reviewer_name,
        source,
        status,
        scores_json,
        tags_json,
        comment,
        overall_score,
        created_at,
        superseded_by
       FROM annotations
       WHERE item_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(itemId, parseLimit(limit));
  return rows.map((row) => ({
    id: row.id,
    itemId: row.item_id,
    batchId: row.batch_id,
    reviewerId: row.reviewer_id,
    reviewerName: row.reviewer_name,
    source: row.source,
    status: row.status,
    scores: JSON.parse(row.scores_json || "{}"),
    tags: JSON.parse(row.tags_json || "[]"),
    comment: row.comment || "",
    overallScore: row.overall_score,
    createdAt: row.created_at,
    supersededBy: row.superseded_by,
  }));
}

export function getBatchStats(batchId) {
  const summary = getDatabase()
    .prepare(
      `SELECT
        SUM(CASE WHEN i.excluded_at IS NULL THEN 1 ELSE 0 END) AS total_items,
        SUM(CASE WHEN i.excluded_at IS NOT NULL THEN 1 ELSE 0 END) AS excluded_items,
        COUNT(i.id) AS all_items,
        SUM(CASE WHEN i.excluded_at IS NULL AND e.id IS NOT NULL THEN 1 ELSE 0 END) AS reviewed_items,
        SUM(CASE WHEN i.excluded_at IS NULL AND i.source_fetch_status = 'success' THEN 1 ELSE 0 END) AS cached_source_images,
        SUM(CASE WHEN i.excluded_at IS NULL AND i.result_fetch_status = 'success' THEN 1 ELSE 0 END) AS cached_result_images
       FROM items i
       LEFT JOIN evaluations e ON e.item_id = i.id
       WHERE i.batch_id = ?`
    )
    .get(batchId);

  const byModel = getDatabase()
    .prepare(
      `SELECT
        i.model,
        COUNT(i.id) AS total_items,
        SUM(CASE WHEN e.id IS NOT NULL THEN 1 ELSE 0 END) AS reviewed_items,
        ROUND(AVG(e.overall_score), 2) AS avg_overall_score,
        ROUND(AVG(e.product_preservation_score), 2) AS avg_product_preservation_score,
        ROUND(AVG(e.instruction_adherence_score), 2) AS avg_instruction_adherence_score,
        ROUND(AVG(e.integration_grounding_score), 2) AS avg_integration_grounding_score,
        ROUND(AVG(e.prompt_optimization_value_score), 2) AS avg_prompt_optimization_value_score,
        ROUND(AVG(e.commercial_quality_score), 2) AS avg_commercial_quality_score,
        ROUND(AVG(e.technical_safety_score), 2) AS avg_technical_safety_score
       FROM items i
       LEFT JOIN evaluations e ON e.item_id = i.id
       WHERE i.batch_id = ?
         AND i.excluded_at IS NULL
       GROUP BY i.model
       ORDER BY avg_overall_score DESC, i.model ASC`
    )
    .all(batchId);

  const evaluatedRows = getDatabase()
    .prepare(
      `SELECT e.tags
       FROM evaluations e
       JOIN items i ON i.id = e.item_id
       WHERE i.batch_id = ?
         AND i.excluded_at IS NULL`
    )
    .all(batchId);

  const tagCounts = new Map();
  for (const row of evaluatedRows) {
    for (const tag of JSON.parse(row.tags || "[]")) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
  }

  return {
    summary: {
      total_items: summary.total_items || 0,
      excluded_items: summary.excluded_items || 0,
      all_items: summary.all_items || 0,
      reviewed_items: summary.reviewed_items || 0,
      unreviewed_items: (summary.total_items || 0) - (summary.reviewed_items || 0),
      cached_source_images: summary.cached_source_images || 0,
      cached_result_images: summary.cached_result_images || 0,
    },
    by_model: byModel,
    tag_counts: [...tagCounts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
  };
}
