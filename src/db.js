import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(rootDir, "data");
const databasePath = path.join(dataDir, "app.sqlite");

let db;

export function initializeDatabase() {
  if (db) return db;

  mkdirSync(dataDir, { recursive: true });
  db = new DatabaseSync(databasePath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS batches (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      source_dir TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      item_count INTEGER NOT NULL DEFAULT 0,
      cached_source_count INTEGER NOT NULL DEFAULT 0,
      cached_result_count INTEGER NOT NULL DEFAULT 0,
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
      UNIQUE(batch_id, import_key)
    );

    CREATE TABLE IF NOT EXISTS evaluations (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL UNIQUE REFERENCES items(id) ON DELETE CASCADE,
      intent_score INTEGER NOT NULL,
      source_fidelity_score INTEGER NOT NULL,
      prompt_optimization_score INTEGER NOT NULL,
      visual_quality_score INTEGER NOT NULL,
      technical_quality_score INTEGER NOT NULL,
      safety_score INTEGER NOT NULL,
      overall_score REAL NOT NULL,
      status TEXT NOT NULL,
      tags TEXT NOT NULL,
      comment TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  return db;
}

export function getDatabase() {
  return initializeDatabase();
}

export function nowIso() {
  return new Date().toISOString();
}

export function createBatch({ id, name, sourceDir, importedAt, notes = "" }) {
  getDatabase()
    .prepare(
      `INSERT INTO batches (id, name, source_dir, imported_at, notes)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(id, name, sourceDir, importedAt, notes);
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
       WHERE batch_id = ?`
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

export function getBatches() {
  return getDatabase()
    .prepare(
      `SELECT
        b.*,
        COUNT(i.id) AS item_count,
        SUM(CASE WHEN e.id IS NOT NULL THEN 1 ELSE 0 END) AS reviewed_count
       FROM batches b
       LEFT JOIN items i ON i.batch_id = b.id
       LEFT JOIN evaluations e ON e.item_id = i.id
       GROUP BY b.id
       ORDER BY b.imported_at DESC`
    )
    .all();
}

export function getItemsForBatch(batchId) {
  return getDatabase()
    .prepare(
      `SELECT
        i.*,
        e.intent_score,
        e.source_fidelity_score,
        e.prompt_optimization_score,
        e.visual_quality_score,
        e.technical_quality_score,
        e.safety_score,
        e.overall_score,
        e.status,
        e.tags,
        e.comment,
        e.updated_at AS evaluation_updated_at
       FROM items i
       LEFT JOIN evaluations e ON e.item_id = i.id
       WHERE i.batch_id = ?
       ORDER BY i.raw_json_file ASC, i.raw_index ASC, i.model ASC`
    )
    .all(batchId)
    .map((item) => ({
      ...item,
      tags: item.tags ? JSON.parse(item.tags) : [],
      source_image_url: item.source_image_path ? `/${item.source_image_path.replaceAll("\\", "/")}` : "",
      result_image_url: item.result_image_path ? `/${item.result_image_path.replaceAll("\\", "/")}` : "",
    }));
}

function clampScore(value, fallback = 3) {
  const score = Number(value ?? fallback);
  if (!Number.isFinite(score)) return fallback;
  return Math.max(1, Math.min(5, Math.round(score)));
}

export function calculateOverallScore(evaluation) {
  return Number(
    (
      evaluation.intent_score * 0.25 +
      evaluation.source_fidelity_score * 0.2 +
      evaluation.prompt_optimization_score * 0.2 +
      evaluation.visual_quality_score * 0.15 +
      evaluation.technical_quality_score * 0.1 +
      evaluation.safety_score * 0.1
    ).toFixed(2)
  );
}

export function saveEvaluation(itemId, input) {
  const existing = getDatabase()
    .prepare("SELECT id, created_at FROM evaluations WHERE item_id = ?")
    .get(itemId);
  const timestamp = nowIso();
  const evaluation = {
    id: existing?.id || crypto.randomUUID(),
    item_id: itemId,
    intent_score: clampScore(input.intent_score),
    source_fidelity_score: clampScore(input.source_fidelity_score),
    prompt_optimization_score: clampScore(input.prompt_optimization_score),
    visual_quality_score: clampScore(input.visual_quality_score),
    technical_quality_score: clampScore(input.technical_quality_score),
    safety_score: clampScore(input.safety_score),
    status: String(input.status || "reviewed"),
    tags: JSON.stringify(Array.isArray(input.tags) ? input.tags : []),
    comment: String(input.comment || ""),
    created_at: existing?.created_at || timestamp,
    updated_at: timestamp,
  };
  evaluation.overall_score = calculateOverallScore(evaluation);

  getDatabase()
    .prepare(
      `INSERT INTO evaluations (
        id,
        item_id,
        intent_score,
        source_fidelity_score,
        prompt_optimization_score,
        visual_quality_score,
        technical_quality_score,
        safety_score,
        overall_score,
        status,
        tags,
        comment,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(item_id) DO UPDATE SET
        intent_score = excluded.intent_score,
        source_fidelity_score = excluded.source_fidelity_score,
        prompt_optimization_score = excluded.prompt_optimization_score,
        visual_quality_score = excluded.visual_quality_score,
        technical_quality_score = excluded.technical_quality_score,
        safety_score = excluded.safety_score,
        overall_score = excluded.overall_score,
        status = excluded.status,
        tags = excluded.tags,
        comment = excluded.comment,
        updated_at = excluded.updated_at`
    )
    .run(
      evaluation.id,
      evaluation.item_id,
      evaluation.intent_score,
      evaluation.source_fidelity_score,
      evaluation.prompt_optimization_score,
      evaluation.visual_quality_score,
      evaluation.technical_quality_score,
      evaluation.safety_score,
      evaluation.overall_score,
      evaluation.status,
      evaluation.tags,
      evaluation.comment,
      evaluation.created_at,
      evaluation.updated_at
    );

  return {
    ...evaluation,
    tags: JSON.parse(evaluation.tags),
  };
}

export function getBatchStats(batchId) {
  const summary = getDatabase()
    .prepare(
      `SELECT
        COUNT(i.id) AS total_items,
        SUM(CASE WHEN e.id IS NOT NULL THEN 1 ELSE 0 END) AS reviewed_items,
        SUM(CASE WHEN i.source_fetch_status = 'success' THEN 1 ELSE 0 END) AS cached_source_images,
        SUM(CASE WHEN i.result_fetch_status = 'success' THEN 1 ELSE 0 END) AS cached_result_images
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
        ROUND(AVG(e.intent_score), 2) AS avg_intent_score,
        ROUND(AVG(e.source_fidelity_score), 2) AS avg_source_fidelity_score,
        ROUND(AVG(e.prompt_optimization_score), 2) AS avg_prompt_optimization_score,
        ROUND(AVG(e.visual_quality_score), 2) AS avg_visual_quality_score,
        ROUND(AVG(e.technical_quality_score), 2) AS avg_technical_quality_score,
        ROUND(AVG(e.safety_score), 2) AS avg_safety_score
       FROM items i
       LEFT JOIN evaluations e ON e.item_id = i.id
       WHERE i.batch_id = ?
       GROUP BY i.model
       ORDER BY avg_overall_score DESC, i.model ASC`
    )
    .all(batchId);

  const evaluatedRows = getDatabase()
    .prepare(
      `SELECT e.tags
       FROM evaluations e
       JOIN items i ON i.id = e.item_id
       WHERE i.batch_id = ?`
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
