import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { getBatchById, getBatchStats, getDatabase, getItemsForBatch, nowIso } from "../src/db.js";
import { productChecksDir, projectRelativePath, reportsDir } from "../src/paths.js";
import { scoreFields } from "../public/scoring.js";

const SENSITIVE_FIELD_NAMES = [
  "text",
  "url",
  "resultUrl",
  "optimizationPrompt",
  "comment",
  "batchName",
  "sourceDir",
  "sourceFile",
  "rawJsonFile",
  "reviewerId",
  "reviewerName",
  "sourceImagePath",
  "resultImagePath",
  "source_image_url",
  "result_image_url",
];

function argValue(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? "" : process.argv[index + 1] || "";
}

function safeFilePart(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function latestBatchId() {
  const row = getDatabase()
    .prepare(
      `SELECT id
       FROM batches
       WHERE archived_at IS NULL
       ORDER BY imported_at DESC
       LIMIT 1`
    )
    .get();
  return row?.id || "";
}

function numberOrNull(value) {
  return value === null || value === undefined ? null : Number(value);
}

function mean(values) {
  const numbers = values.map(Number).filter(Number.isFinite);
  if (!numbers.length) return null;
  return Number((numbers.reduce((total, value) => total + value, 0) / numbers.length).toFixed(2));
}

function median(values) {
  const numbers = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!numbers.length) return null;
  const middle = Math.floor(numbers.length / 2);
  const value = numbers.length % 2 === 0 ? (numbers[middle - 1] + numbers[middle]) / 2 : numbers[middle];
  return Number(value.toFixed(2));
}

function standardDeviation(values) {
  const numbers = values.map(Number).filter(Number.isFinite);
  if (numbers.length < 2) return null;
  const avg = numbers.reduce((total, value) => total + value, 0) / numbers.length;
  const variance = numbers.reduce((total, value) => total + (value - avg) ** 2, 0) / numbers.length;
  return Number(Math.sqrt(variance).toFixed(2));
}

function scoreRow(item, productCheckByItemId) {
  const productCheck = productCheckByItemId.get(item.id);
  const scores = Object.fromEntries(scoreFields.map((field) => [field.field, numberOrNull(item[field.field])]));
  return {
    itemId: item.id,
    rawIndex: item.raw_index,
    model: item.model,
    isExcluded: Boolean(item.is_excluded),
    status: item.status || "unreviewed",
    overallScore: item.overall_score ?? null,
    productPreservationScore: item.product_preservation_score ?? null,
    instructionAdherenceScore: item.instruction_adherence_score ?? null,
    integrationGroundingScore: item.integration_grounding_score ?? null,
    promptOptimizationValueScore: item.prompt_optimization_value_score ?? null,
    commercialQualityScore: item.commercial_quality_score ?? null,
    technicalSafetyScore: item.technical_safety_score ?? null,
    scores,
    tags: Array.isArray(item.tags) ? item.tags : [],
    evaluationUpdatedAt: item.evaluation_updated_at || null,
    productCheckSuggestedScore: productCheck?.suggestedScore ?? null,
    productCheckStatus: productCheck?.status || null,
  };
}

function annotationCounts(batchId) {
  const row = getDatabase()
    .prepare(
      `SELECT COUNT(*) AS total,
              COUNT(DISTINCT item_id) AS items,
              COUNT(DISTINCT reviewer_id) AS reviewers
       FROM annotations
       WHERE batch_id = ?`
    )
    .get(batchId);
  return {
    total: row.total || 0,
    items: row.items || 0,
    reviewers: row.reviewers || 0,
  };
}

function scoreBuckets(evaluations) {
  const buckets = { low_1_2: 0, mid_3: 0, high_4_5: 0, unrated: 0 };
  for (const item of evaluations) {
    const score = Number(item.overallScore);
    if (!Number.isFinite(score)) buckets.unrated += 1;
    else if (score <= 2) buckets.low_1_2 += 1;
    else if (score < 4) buckets.mid_3 += 1;
    else buckets.high_4_5 += 1;
  }
  return buckets;
}

function readProductCheck(batchId) {
  const filePath = path.join(productChecksDir, batchId, "results.json");
  if (!existsSync(filePath)) {
    return {
      available: false,
      path: null,
      summary: null,
      items: [],
      byItemId: new Map(),
    };
  }
  const payload = JSON.parse(readFileSync(filePath, "utf8"));
  const items = Array.isArray(payload.items) ? payload.items : [];
  return {
    available: true,
    path: projectRelativePath(filePath),
    summary: payload.summary || null,
    items,
    byItemId: new Map(items.map((item) => [item.itemId, item])),
  };
}

function modelSummaries(items) {
  const byModel = new Map();
  for (const item of items) {
    if (!byModel.has(item.model)) byModel.set(item.model, []);
    byModel.get(item.model).push(item);
  }
  return [...byModel.entries()]
    .map(([model, rows]) => {
      const reviewed = rows.filter((row) => row.overallScore !== null && row.overallScore !== undefined);
      const summary = {
        model,
        totalItems: rows.length,
        reviewedItems: reviewed.length,
        overallMean: mean(reviewed.map((row) => row.overallScore)),
        overallMedian: median(reviewed.map((row) => row.overallScore)),
        overallStdDev: standardDeviation(reviewed.map((row) => row.overallScore)),
        dimensions: {},
      };
      for (const field of scoreFields) {
        const key = field.field.replace(/_score$/, "");
        summary.dimensions[key] = mean(reviewed.map((row) => row.scores?.[field.field]));
      }
      return summary;
    })
    .sort((a, b) => (b.overallMean ?? -1) - (a.overallMean ?? -1) || a.model.localeCompare(b.model));
}

function productCheckDisagreements(evaluations) {
  return evaluations
    .filter((item) => item.productCheckSuggestedScore !== null && item.productPreservationScore !== null)
    .map((item) => ({
      itemId: item.itemId,
      model: item.model,
      humanProductPreservationScore: numberOrNull(item.productPreservationScore),
      productCheckSuggestedScore: numberOrNull(item.productCheckSuggestedScore),
      delta: Number((Number(item.productCheckSuggestedScore) - Number(item.productPreservationScore)).toFixed(2)),
      tags: item.tags,
    }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.itemId.localeCompare(b.itemId));
}

function lowScoreItems(evaluations) {
  return evaluations
    .filter((item) => item.overallScore !== null && Number(item.overallScore) <= 2.5)
    .map((item) => ({
      itemId: item.itemId,
      model: item.model,
      overallScore: numberOrNull(item.overallScore),
      status: item.status,
      tags: item.tags,
      productCheckSuggestedScore: numberOrNull(item.productCheckSuggestedScore),
    }))
    .sort((a, b) => a.overallScore - b.overallScore || a.itemId.localeCompare(b.itemId))
    .slice(0, 50);
}

function rubric() {
  return {
    scoreFields: scoreFields.map((field) => ({
      field: field.field,
      label: field.label,
      shortLabel: field.shortLabel,
      weight: field.weight,
      weightLabel: field.weightLabel,
      help: field.help,
    })),
    weights: Object.fromEntries(scoreFields.map((field) => [field.field, field.weight])),
    hardGates: {
      productPreservationScoreAtMost2CapsOverallAt: 2.5,
      instructionAdherenceScoreAtMost2CapsOverallAt: 3,
      technicalSafetyScoreAtMost1CapsOverallAt: 2,
    },
  };
}

function summaryRows(report) {
  const rows = [];
  const push = (scope, model, metric, value, n = "") => {
    rows.push({ batch_id: report.batch.id, scope, model, metric, value: value ?? "", n });
  };
  for (const [metric, value] of Object.entries(report.summary)) {
    push("batch", "all", metric, value, report.summary.totalItems);
  }
  for (const model of report.models) {
    push("model", model.model, "total_items", model.totalItems, model.totalItems);
    push("model", model.model, "reviewed_items", model.reviewedItems, model.reviewedItems);
    push("model", model.model, "overall_mean", model.overallMean, model.reviewedItems);
    push("model", model.model, "overall_median", model.overallMedian, model.reviewedItems);
    push("model", model.model, "overall_std_dev", model.overallStdDev, model.reviewedItems);
    for (const [metric, value] of Object.entries(model.dimensions)) {
      push("model_dimension", model.model, `${metric}_mean`, value, model.reviewedItems);
    }
  }
  for (const tag of report.tags) {
    push("tag", "all", tag.tag, tag.count, tag.count);
  }
  return rows;
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvFromRows(rows) {
  const headers = ["batch_id", "scope", "model", "metric", "value", "n"];
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n") + "\n";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function percent(reviewed, total) {
  if (!total) return "0%";
  return `${Math.round((reviewed / total) * 100)}%`;
}

function htmlReport(report) {
  const modelRows = report.models
    .map(
      (model) => `
        <tr>
          <td>${escapeHtml(model.model)}</td>
          <td>${model.reviewedItems}/${model.totalItems}</td>
          <td>${escapeHtml(model.overallMean ?? "--")}</td>
          <td>${escapeHtml(model.overallMedian ?? "--")}</td>
          <td>${escapeHtml(model.overallStdDev ?? "--")}</td>
        </tr>`
    )
    .join("");
  const tagRows = report.tags
    .map((tag) => `<tr><td>${escapeHtml(tag.tag)}</td><td>${escapeHtml(tag.count)}</td></tr>`)
    .join("");
  const lowRows = report.lowScoreItems
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.itemId)}</td>
          <td>${escapeHtml(item.model)}</td>
          <td>${escapeHtml(item.overallScore)}</td>
          <td>${escapeHtml(item.status)}</td>
          <td>${escapeHtml((item.tags || []).join(", "))}</td>
        </tr>`
    )
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Skill Eval Report ${escapeHtml(report.batch.id)}</title>
  <style>
    :root { color-scheme: light; --bg:#f6f8fb; --surface:#ffffff; --ink:#16202a; --muted:#5c6f82; --line:#d8e0ea; --accent:#1f6f78; --accent-soft:#e4f1f2; font-family:Aptos,"Segoe UI",system-ui,sans-serif; }
    * { box-sizing: border-box; }
    body { margin:0; background:var(--bg); color:var(--ink); }
    main { max-width:1180px; margin:0 auto; padding:24px; }
    header { display:grid; gap:14px; padding:18px 0 14px; border-bottom:2px solid var(--ink); }
    h1 { margin:0; font-size:26px; line-height:1.15; }
    h2 { margin:0 0 10px; font-size:16px; }
    .banner { display:inline-flex; width:max-content; padding:5px 9px; border-radius:999px; background:var(--accent-soft); color:var(--accent); font-size:12px; font-weight:800; text-transform:uppercase; }
    .meta, .kpi-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px; }
    .card, section { border:1px solid var(--line); border-radius:8px; background:var(--surface); }
    .card { padding:12px; }
    .card span { display:block; color:var(--muted); font-size:12px; }
    .card strong { display:block; margin-top:4px; font-size:20px; }
    .kpi-grid { margin-top:14px; }
    section { margin-top:14px; padding:16px; }
    table { width:100%; border-collapse:collapse; font-size:13px; }
    th, td { padding:9px 8px; border-bottom:1px solid var(--line); text-align:left; vertical-align:top; }
    th { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:0; }
    code { font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:12px; }
    .muted { color:var(--muted); }
  </style>
</head>
<body>
  <main>
    <header>
      <span class="banner">Sanitized local report</span>
      <h1>Skill Eval Report</h1>
      <div class="meta">
        <div><span class="muted">Batch</span><br><code>${escapeHtml(report.batch.id)}</code></div>
        <div><span class="muted">Generated</span><br>${escapeHtml(report.generatedAt)}</div>
        <div><span class="muted">Source digest</span><br><code>${escapeHtml(report.batch.sourceSha256 || "legacy")}</code></div>
        <div><span class="muted">Content digest</span><br><code>${escapeHtml(report.batch.contentSha256 || "legacy")}</code></div>
      </div>
    </header>
    <div class="kpi-grid" aria-label="Batch summary">
      <div class="card"><span>Total active</span><strong>${escapeHtml(report.summary.totalItems)}</strong></div>
      <div class="card"><span>Reviewed</span><strong>${escapeHtml(report.summary.reviewedItems)} (${percent(report.summary.reviewedItems, report.summary.totalItems)})</strong></div>
      <div class="card"><span>Excluded</span><strong>${escapeHtml(report.summary.excludedItems)}</strong></div>
      <div class="card"><span>Annotations</span><strong>${escapeHtml(report.annotations.total)}</strong></div>
    </div>
    <section>
      <h2>Model Summary</h2>
      <table><thead><tr><th>Model</th><th>Reviewed</th><th>Mean</th><th>Median</th><th>Std Dev</th></tr></thead><tbody>${modelRows || '<tr><td colspan="5">No reviewed models.</td></tr>'}</tbody></table>
    </section>
    <section>
      <h2>Issue Tags</h2>
      <table><thead><tr><th>Tag</th><th>Count</th></tr></thead><tbody>${tagRows || '<tr><td colspan="2">No tags.</td></tr>'}</tbody></table>
    </section>
    <section>
      <h2>Low Score Items</h2>
      <table><thead><tr><th>Item</th><th>Model</th><th>Overall</th><th>Status</th><th>Tags</th></tr></thead><tbody>${lowRows || '<tr><td colspan="5">No low-score items.</td></tr>'}</tbody></table>
    </section>
  </main>
</body>
</html>
`;
}

const batchArg = argValue("batch") || "latest";
const batchId = batchArg === "latest" ? latestBatchId() : batchArg;
if (!batchId) {
  throw new Error("No batch found. Usage: pnpm run eval:report -- --batch=<batchId|latest>");
}

const batch = getBatchById(batchId, { includeArchived: true });
if (!batch) {
  throw new Error(`Batch not found: ${batchId}`);
}

const stats = getBatchStats(batchId);
const productCheck = readProductCheck(batchId);
const items = getItemsForBatch(batchId);
const evaluations = items.map((item) => scoreRow(item, productCheck.byItemId));
const generatedAt = nowIso();
const runId = `eval-report-${generatedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}-${safeFilePart(batch.id).slice(0, 24)}`;
const outputDir = path.join(reportsDir, runId);
const report = {
  schemaVersion: 1,
  generatedAt,
  sanitized: true,
  batch: {
    id: batch.id,
    sourceSha256: batch.source_sha256 || null,
    sourceSizeBytes: batch.source_size_bytes ?? null,
    contentSha256: batch.content_sha256 || null,
    importSchemaVersion: batch.import_schema_version || null,
    importedAt: batch.imported_at,
    archivedAt: batch.archived_at || null,
  },
  rubric: rubric(),
  summary: {
    totalItems: stats.summary.total_items,
    allItems: stats.summary.all_items,
    excludedItems: stats.summary.excluded_items,
    reviewedItems: stats.summary.reviewed_items,
    unreviewedItems: stats.summary.unreviewed_items,
    cachedSourceImages: stats.summary.cached_source_images,
    cachedResultImages: stats.summary.cached_result_images,
  },
  models: modelSummaries(evaluations.filter((item) => !item.isExcluded)),
  scoreBuckets: scoreBuckets(evaluations.filter((item) => !item.isExcluded)),
  tags: stats.tag_counts,
  annotations: annotationCounts(batchId),
  lowScoreItems: lowScoreItems(evaluations.filter((item) => !item.isExcluded)),
  productCheck: {
    available: productCheck.available,
    path: productCheck.path,
    summary: productCheck.summary,
  },
  productCheckDisagreements: productCheckDisagreements(evaluations.filter((item) => !item.isExcluded)),
  evaluations,
  excludedFields: SENSITIVE_FIELD_NAMES,
};

mkdirSync(outputDir, { recursive: true });
const reportPath = path.join(outputDir, "report.json");
const csvPath = path.join(outputDir, "summary.csv");
const htmlPath = path.join(outputDir, "index.html");
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
writeFileSync(csvPath, csvFromRows(summaryRows(report)), "utf8");
writeFileSync(htmlPath, htmlReport(report), "utf8");

console.log(
  JSON.stringify(
    {
      ok: true,
      batchId: batch.id,
      reportDir: projectRelativePath(outputDir),
      reportJson: projectRelativePath(reportPath),
      summaryCsv: projectRelativePath(csvPath),
      html: projectRelativePath(htmlPath),
      items: report.evaluations.length,
      reviewed: report.summary.reviewedItems,
      annotations: report.annotations.total,
    },
    null,
    2
  )
);
