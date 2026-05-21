import { readFileSync } from "node:fs";

const REQUIRED_TOP_LEVEL = [
  "schemaVersion",
  "sanitized",
  "generatedAt",
  "batch",
  "rubric",
  "summary",
  "models",
  "scoreBuckets",
  "tags",
  "annotations",
  "productCheck",
  "productCheckDisagreements",
  "evaluations",
  "excludedFields",
];

const REQUIRED_EXCLUDED_FIELDS = [
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
];

function argValue(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? "" : process.argv[index + 1] || "";
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const reportPath = argValue("report");
if (!reportPath) {
  throw new Error("Usage: pnpm run eval:report:validate -- --report=<path-to-report.json>");
}

const raw = readFileSync(reportPath, "utf8");
const report = JSON.parse(raw);

for (const field of REQUIRED_TOP_LEVEL) {
  assert(Object.hasOwn(report, field), `Missing top-level report field: ${field}`);
}

assert(report.schemaVersion === 1, "schemaVersion must be 1");
assert(report.sanitized === true, "sanitized must be true");
assert(typeof report.generatedAt === "string" && report.generatedAt.length > 0, "generatedAt must be a non-empty string");
assert(report.batch && typeof report.batch.id === "string" && report.batch.id, "batch.id is required");
assert(!Object.hasOwn(report.batch, "name"), "sanitized batch must not include name");
assert(!Object.hasOwn(report.batch, "sourceDir"), "sanitized batch must not include sourceDir");
assert(!Object.hasOwn(report.batch, "sourceFile"), "sanitized batch must not include sourceFile");
assert(Array.isArray(report.rubric.scoreFields), "rubric.scoreFields must be an array");
assert(report.rubric.weights && typeof report.rubric.weights === "object", "rubric.weights is required");
assert(report.rubric.hardGates && typeof report.rubric.hardGates === "object", "rubric.hardGates is required");
assert(Number.isFinite(Number(report.summary.totalItems)), "summary.totalItems must be numeric");
assert(Number.isFinite(Number(report.summary.reviewedItems)), "summary.reviewedItems must be numeric");
assert(Array.isArray(report.models), "models must be an array");
assert(report.scoreBuckets && typeof report.scoreBuckets === "object", "scoreBuckets is required");
assert(Array.isArray(report.tags), "tags must be an array");
assert(report.annotations && typeof report.annotations === "object", "annotations is required");
assert(report.productCheck && typeof report.productCheck === "object", "productCheck is required");
assert(Array.isArray(report.lowScoreItems), "lowScoreItems must be an array");
assert(Array.isArray(report.productCheckDisagreements), "productCheckDisagreements must be an array");
assert(Array.isArray(report.evaluations), "evaluations must be an array");
assert(Array.isArray(report.excludedFields), "excludedFields must be an array");

for (const field of REQUIRED_EXCLUDED_FIELDS) {
  assert(report.excludedFields.includes(field), `excludedFields must include ${field}`);
}

for (const model of report.models) {
  assert(model.dimensions && typeof model.dimensions === "object", `model ${model.model || ""} dimensions are required`);
  for (const field of report.rubric.scoreFields) {
    const metric = field.field.replace(/_score$/, "");
    assert(Object.hasOwn(model.dimensions, metric), `model ${model.model || ""} missing dimension ${metric}`);
  }
}

for (const row of report.evaluations) {
  assert(!Object.hasOwn(row, "rawJsonFile"), "evaluation rows must not include rawJsonFile");
  assert(!Object.hasOwn(row, "reviewerId"), "evaluation rows must not include reviewerId");
  assert(!Object.hasOwn(row, "reviewerName"), "evaluation rows must not include reviewerName");
  if (row.status !== "unreviewed") {
    assert(row.scores && typeof row.scores === "object", `evaluation ${row.itemId || ""} scores are required`);
  }
}

for (const forbidden of [
  "optimizationPrompt",
  "resultUrl",
  "sourceImagePath",
  "resultImagePath",
  "sourceFile",
  "sourceDir",
  "rawJsonFile",
  "reviewerId",
  "reviewerName",
]) {
  assert(!raw.includes(`"${forbidden}":`), `Report JSON unexpectedly contains sensitive field ${forbidden}`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      report: reportPath,
      batchId: report.batch.id,
      items: report.evaluations.length,
      reviewed: report.summary.reviewedItems,
    },
    null,
    2
  )
);
