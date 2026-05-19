import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { dataDir, databasePath, rootDir } from "../src/paths.js";

const testSourcePatterns = ["e2e-%", "smoke-upload-%", "selftest-%"];
const testPathPatterns = ["e2e-", "smoke-upload-", "selftest-"];
const relativeDataDir = path.relative(rootDir, dataDir).replaceAll("\\", "/") || ".";
const isolatedTestDataRoot = relativeDataDir.startsWith(".tmp/") || relativeDataDir === ".tmp" || relativeDataDir.startsWith("data-test/");
const strictAudit = process.env.SKILL_EVAL_RESIDUE_STRICT_AUDIT === "1" || !isolatedTestDataRoot;

function findFiles(dir, predicate) {
  if (!existsSync(dir)) return [];
  const results = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    if (!current || !existsSync(current)) continue;
    const info = statSync(current);
    if (info.isDirectory()) {
      for (const name of readdirSync(current)) {
        stack.push(path.join(current, name));
      }
      continue;
    }
    if (predicate(current)) {
      results.push(path.relative(rootDir, current));
    }
  }
  return results.sort();
}

function inspectDatabase() {
  if (!existsSync(databasePath)) {
    return {
      exists: false,
      leftoverBatches: [],
      leftoverAuditEvents: [],
    };
  }

  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const batchSql = `
      SELECT id, source_dir, source_file
      FROM batches
      WHERE source_dir = 'upload'
        AND (${testSourcePatterns.map(() => "source_file LIKE ?").join(" OR ")})
      ORDER BY imported_at DESC
    `;
    const leftoverBatches = db.prepare(batchSql).all(...testSourcePatterns);
    const hasAudit = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'audit_events'")
      .get();
    const leftoverAuditEvents = hasAudit
      ? db
          .prepare(
            `
              SELECT id, event_type, batch_id, item_id, created_at
              FROM audit_events
              WHERE ${testSourcePatterns.map(() => "payload_json LIKE ?").join(" OR ")}
              ORDER BY created_at DESC
              LIMIT 100
            `
          )
          .all(...testPathPatterns.map((pattern) => `%${pattern}%`))
      : [];
    return {
      exists: true,
      leftoverBatches,
      leftoverAuditEvents,
    };
  } finally {
    db.close();
  }
}

function inspectArtifacts() {
  const importRuns = findFiles(path.join(dataDir, "import-runs"), (filePath) =>
    testPathPatterns.some((pattern) => path.basename(filePath).includes(pattern))
  );
  const cacheDirs = existsSync(path.join(dataDir, "cache"))
    ? readdirSync(path.join(dataDir, "cache"), { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && testPathPatterns.some((pattern) => entry.name.includes(pattern)))
        .map((entry) => path.relative(rootDir, path.join(dataDir, "cache", entry.name)))
        .sort()
    : [];
  const productChecks = existsSync(path.join(dataDir, "product-checks"))
    ? readdirSync(path.join(dataDir, "product-checks"), { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && testPathPatterns.some((pattern) => entry.name.includes(pattern)))
        .map((entry) => path.relative(rootDir, path.join(dataDir, "product-checks", entry.name)))
        .sort()
    : [];
  return {
    importRuns,
    cacheDirs,
    productChecks,
  };
}

const database = inspectDatabase();
const artifacts = inspectArtifacts();
const ok =
  database.leftoverBatches.length === 0 &&
  (!strictAudit || database.leftoverAuditEvents.length === 0) &&
  artifacts.importRuns.length === 0 &&
  artifacts.cacheDirs.length === 0 &&
  artifacts.productChecks.length === 0;
const payload = {
  ok,
  dataDir: relativeDataDir,
  databasePath: path.relative(rootDir, databasePath),
  databaseExists: database.exists,
  isolatedTestDataRoot,
  strictAudit,
  leftoverBatches: database.leftoverBatches,
  leftoverAuditEvents: database.leftoverAuditEvents,
  leftoverArtifacts: artifacts,
};

console.log(JSON.stringify(payload, null, 2));
if (!ok) {
  process.exitCode = 1;
}
