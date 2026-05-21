import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { getBatchById, getDatabase, getItemsForBatch, nowIso } from "../src/db.js";
import { projectRelativePath, reportsDir } from "../src/paths.js";
import { scoreFields } from "../public/scoring.js";

const TIE_THRESHOLD = 0.1;

function argValue(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? "" : process.argv[index + 1] || "";
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

function safeFilePart(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function mean(values) {
  const numbers = values.map(Number).filter(Number.isFinite);
  if (!numbers.length) return null;
  return Number((numbers.reduce((total, value) => total + value, 0) / numbers.length).toFixed(2));
}

function percent(value, total) {
  if (!total) return 0;
  return Number((value / total).toFixed(4));
}

function reviewedActive(items, model = "") {
  return items.filter(
    (item) =>
      !item.is_excluded &&
      item.overall_score !== null &&
      item.overall_score !== undefined &&
      (!model || item.model === model)
  );
}

function rowForItem(item) {
  return {
    itemId: item.id,
    rawIndex: item.raw_index,
    model: item.model,
    status: item.status || "unreviewed",
    overallScore: item.overall_score ?? null,
    scores: Object.fromEntries(scoreFields.map((field) => [field.field, item[field.field] ?? null])),
    tags: Array.isArray(item.tags) ? item.tags : [],
  };
}

function aggregate(rows) {
  return {
    items: rows.length,
    overallMean: mean(rows.map((item) => item.overall_score)),
    dimensions: Object.fromEntries(scoreFields.map((field) => [field.field.replace(/_score$/, ""), mean(rows.map((item) => item[field.field]))])),
  };
}

function matchRows(rowsA, rowsB) {
  const importKeyMatches = matchByField(rowsA, rowsB, "import_key", "import_key");
  if (importKeyMatches.matched.length) return importKeyMatches;
  return matchByField(rowsA, rowsB, "raw_index", "raw_index");
}

function matchByField(rowsA, rowsB, field, strategy) {
  const byKey = new Map(rowsB.map((item) => [item[field], item]));
  const matched = [];
  const unmatchedA = [];
  const matchedB = new Set();
  for (const itemA of rowsA) {
    const itemB = byKey.get(itemA[field]);
    if (!itemB) {
      unmatchedA.push(rowForItem(itemA));
      continue;
    }
    matchedB.add(itemB.id);
    matched.push({ a: itemA, b: itemB });
  }
  const unmatchedB = rowsB.filter((item) => !matchedB.has(item.id)).map(rowForItem);
  return { matched, unmatchedA, unmatchedB, strategy };
}

function pairedSummary(pairs) {
  let winsA = 0;
  let winsB = 0;
  let ties = 0;
  const deltas = [];
  for (const pair of pairs) {
    const delta = Number((Number(pair.a.overall_score) - Number(pair.b.overall_score)).toFixed(2));
    deltas.push(delta);
    if (Math.abs(delta) < TIE_THRESHOLD) ties += 1;
    else if (delta > 0) winsA += 1;
    else winsB += 1;
  }
  return {
    matchedItems: pairs.length,
    meanDelta: mean(deltas),
    winRateA: percent(winsA, pairs.length),
    winRateB: percent(winsB, pairs.length),
    tieRate: percent(ties, pairs.length),
  };
}

function dimensionDeltas(rowsA, rowsB, pairs) {
  const pairedByField = Object.fromEntries(
    scoreFields.map((field) => [
      field.field.replace(/_score$/, ""),
      mean(pairs.map((pair) => Number(pair.a[field.field]) - Number(pair.b[field.field]))),
    ])
  );
  return scoreFields.map((field) => {
    const key = field.field.replace(/_score$/, "");
    const meanA = mean(rowsA.map((item) => item[field.field]));
    const meanB = mean(rowsB.map((item) => item[field.field]));
    return {
      field: field.field,
      metric: key,
      label: field.label,
      meanA,
      meanB,
      aggregateDelta: meanA === null || meanB === null ? null : Number((meanA - meanB).toFixed(2)),
      pairedDelta: pairedByField[key],
    };
  });
}

function tagCounts(rows) {
  const counts = new Map();
  for (const row of rows) {
    for (const tag of Array.isArray(row.tags) ? row.tags : []) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return counts;
}

function tagDeltas(rowsA, rowsB) {
  const countsA = tagCounts(rowsA);
  const countsB = tagCounts(rowsB);
  const tags = new Set([...countsA.keys(), ...countsB.keys()]);
  return [...tags]
    .map((tag) => ({
      tag,
      countA: countsA.get(tag) || 0,
      countB: countsB.get(tag) || 0,
      delta: (countsA.get(tag) || 0) - (countsB.get(tag) || 0),
    }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.tag.localeCompare(b.tag));
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function summaryCsv(compare) {
  const rows = [
    ["scope", "metric", "value"],
    ["summary", "overallMeanA", compare.summary.overallMeanA],
    ["summary", "overallMeanB", compare.summary.overallMeanB],
    ["summary", "aggregateDelta", compare.summary.aggregateDelta],
    ["summary", "matchedItems", compare.matching.matchedItems],
    ["summary", "winRateA", compare.summary.winRateA],
    ["summary", "winRateB", compare.summary.winRateB],
    ["summary", "tieRate", compare.summary.tieRate],
    ...compare.dimensions.map((row) => ["dimension", `${row.metric}.aggregateDelta`, row.aggregateDelta]),
  ];
  return rows.map((row) => row.map(csvEscape).join(",")).join("\n") + "\n";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function htmlReport(compare) {
  const dimensionRows = compare.dimensions
    .map(
      (row) => `<tr><td>${escapeHtml(row.label)}</td><td>${escapeHtml(row.meanA)}</td><td>${escapeHtml(row.meanB)}</td><td>${escapeHtml(row.aggregateDelta)}</td><td>${escapeHtml(row.pairedDelta ?? "--")}</td></tr>`
    )
    .join("");
  const warningRows = compare.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Skill Eval Compare</title>
  <style>
    :root { color-scheme: light; --bg:#f6f8fb; --surface:#fff; --ink:#16202a; --muted:#5c6f82; --line:#d8e0ea; --accent:#1f6f78; font-family:Aptos,"Segoe UI",system-ui,sans-serif; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--bg); color:var(--ink); }
    main { max-width:1100px; margin:0 auto; padding:24px; }
    header { padding-bottom:14px; border-bottom:2px solid var(--ink); }
    h1 { margin:0; font-size:26px; }
    .kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:10px; margin-top:14px; }
    .kpi, section { border:1px solid var(--line); border-radius:8px; background:var(--surface); }
    .kpi { padding:12px; }
    .kpi span { display:block; color:var(--muted); font-size:12px; }
    .kpi strong { display:block; margin-top:4px; font-size:22px; }
    section { margin-top:14px; padding:16px; }
    table { width:100%; border-collapse:collapse; font-size:13px; }
    th, td { padding:9px 8px; border-bottom:1px solid var(--line); text-align:left; }
    th { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:0; }
    code { font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:12px; }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Skill Eval Compare</h1>
      <p><code>${escapeHtml(compare.inputs.batchId || `${compare.inputs.batchA} / ${compare.inputs.batchB}`)}</code> · ${escapeHtml(compare.inputs.labelA)} vs ${escapeHtml(compare.inputs.labelB)}</p>
    </header>
    <div class="kpis">
      <div class="kpi"><span>Mean A</span><strong>${escapeHtml(compare.summary.overallMeanA)}</strong></div>
      <div class="kpi"><span>Mean B</span><strong>${escapeHtml(compare.summary.overallMeanB)}</strong></div>
      <div class="kpi"><span>Delta</span><strong>${escapeHtml(compare.summary.aggregateDelta)}</strong></div>
      <div class="kpi"><span>Matched</span><strong>${escapeHtml(compare.matching.matchedItems)}</strong></div>
    </div>
    ${warningRows ? `<section><h2>Warnings</h2><ul>${warningRows}</ul></section>` : ""}
    <section>
      <h2>Dimensions</h2>
      <table><thead><tr><th>Dimension</th><th>A</th><th>B</th><th>Aggregate delta</th><th>Paired delta</th></tr></thead><tbody>${dimensionRows}</tbody></table>
    </section>
  </main>
</body>
</html>
`;
}

const batchArg = argValue("batch") || "";
const batchAArg = argValue("batch-a") || "";
const batchBArg = argValue("batch-b") || "";
const batchId = (batchArg || (!batchAArg && !batchBArg ? "latest" : "")) === "latest" ? latestBatchId() : batchArg;
const modelA = argValue("model-a");
const modelB = argValue("model-b");
const isBatchCompare = Boolean(batchAArg || batchBArg);
if (isBatchCompare && (!batchAArg || !batchBArg)) {
  throw new Error("Batch comparison requires --batch-a=<batchId> and --batch-b=<batchId>");
}
if (!isBatchCompare && (!batchId || !modelA || !modelB)) {
  throw new Error("Usage: pnpm run eval:compare -- --batch=<batchId|latest> --model-a=<model> --model-b=<model> OR --batch-a=<id> --batch-b=<id>");
}

const batchAId = isBatchCompare ? batchAArg : batchId;
const batchBId = isBatchCompare ? batchBArg : batchId;
const batchA = getBatchById(batchAId, { includeArchived: true });
const batchB = getBatchById(batchBId, { includeArchived: true });
if (!batchA) throw new Error(`Batch not found: ${batchAId}`);
if (!batchB) throw new Error(`Batch not found: ${batchBId}`);

const itemsA = getItemsForBatch(batchAId);
const itemsB = isBatchCompare ? getItemsForBatch(batchBId) : itemsA;
const rowsA = reviewedActive(itemsA, modelA);
const rowsB = reviewedActive(itemsB, modelB);
if (!rowsA.length || !rowsB.length) {
  throw new Error(`Both sides must have reviewed active items. A=${rowsA.length}, B=${rowsB.length}`);
}

const matching = matchRows(rowsA, rowsB);
const aggregateA = aggregate(rowsA);
const aggregateB = aggregate(rowsB);
const paired = pairedSummary(matching.matched);
const warnings = [];
if (matching.matched.length < 5) warnings.push("low_matched_sample: fewer than 5 paired items; use aggregate metrics carefully");
if (matching.matched.length === 0) warnings.push("no_paired_items: import_key/raw_index matching found no pairs; paired win rates are zero");
const generatedAt = nowIso();
const labelA = modelA || batchAId;
const labelB = modelB || batchBId;
const compare = {
  schemaVersion: 1,
  sanitized: true,
  generatedAt,
  mode: isBatchCompare ? "batch" : "model",
  inputs: {
    batchId: isBatchCompare ? null : batchId,
    batchA: isBatchCompare ? batchAId : null,
    batchB: isBatchCompare ? batchBId : null,
    modelA,
    modelB,
    labelA,
    labelB,
    sourceSha256A: batchA.source_sha256 || null,
    sourceSha256B: batchB.source_sha256 || null,
    contentSha256A: batchA.content_sha256 || null,
    contentSha256B: batchB.content_sha256 || null,
  },
  matching: {
    strategy: matching.strategy,
    matchedItems: matching.matched.length,
    unmatchedA: matching.unmatchedA.length,
    unmatchedB: matching.unmatchedB.length,
  },
  summary: {
    itemsA: aggregateA.items,
    itemsB: aggregateB.items,
    overallMeanA: aggregateA.overallMean,
    overallMeanB: aggregateB.overallMean,
    aggregateDelta:
      aggregateA.overallMean === null || aggregateB.overallMean === null
        ? null
        : Number((aggregateA.overallMean - aggregateB.overallMean).toFixed(2)),
    winRateA: paired.winRateA,
    winRateB: paired.winRateB,
    tieRate: paired.tieRate,
    pairedMeanDelta: paired.meanDelta,
  },
  dimensions: dimensionDeltas(rowsA, rowsB, matching.matched),
  tags: tagDeltas(rowsA, rowsB),
  lowScoreItems: {
    modelA: rowsA.filter((item) => Number(item.overall_score) <= 2.5).map(rowForItem).slice(0, 50),
    modelB: rowsB.filter((item) => Number(item.overall_score) <= 2.5).map(rowForItem).slice(0, 50),
  },
  matchedItems: matching.matched.map((pair) => ({
    itemA: rowForItem(pair.a),
    itemB: rowForItem(pair.b),
    overallDelta: Number((Number(pair.a.overall_score) - Number(pair.b.overall_score)).toFixed(2)),
  })),
  warnings,
};

const runId = `eval-compare-${generatedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}-${safeFilePart(labelA)}-vs-${safeFilePart(labelB)}`;
const outputDir = path.join(reportsDir, runId);
mkdirSync(outputDir, { recursive: true });
const comparePath = path.join(outputDir, "compare.json");
const csvPath = path.join(outputDir, "summary.csv");
const htmlPath = path.join(outputDir, "index.html");
writeFileSync(comparePath, `${JSON.stringify(compare, null, 2)}\n`, "utf8");
writeFileSync(csvPath, summaryCsv(compare), "utf8");
writeFileSync(htmlPath, htmlReport(compare), "utf8");

console.log(
  JSON.stringify(
    {
      ok: true,
      batchId: isBatchCompare ? null : batchId,
      batchA: isBatchCompare ? batchAId : null,
      batchB: isBatchCompare ? batchBId : null,
      compareDir: projectRelativePath(outputDir),
      compareJson: projectRelativePath(comparePath),
      summaryCsv: projectRelativePath(csvPath),
      html: projectRelativePath(htmlPath),
      matchedItems: compare.matching.matchedItems,
      warnings: compare.warnings,
    },
    null,
    2
  )
);
