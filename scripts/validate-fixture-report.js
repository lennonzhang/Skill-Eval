import { readFileSync } from "node:fs";

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

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function assertNumberEqual(actual, expected, message) {
  assert(Number(actual) === Number(expected), `${message}: expected ${expected}, got ${actual}`);
}

const reportPath = argValue("report");
const expectedPath = argValue("expected") || "tests/fixtures/expected/report-metrics.json";
const fixturePath = argValue("fixture") || "tests/fixtures/sanitized-resource.json";

if (!reportPath) {
  throw new Error("Usage: pnpm run fixture:report:validate -- --report=<path-to-report.json>");
}

const reportRaw = readFileSync(reportPath, "utf8");
const report = JSON.parse(reportRaw);
const expected = readJson(expectedPath);
const fixture = readJson(fixturePath);

assert(report.sanitized === true, "Fixture report must be sanitized");
assert(report.batch.sourceSha256, "Fixture report must include sourceSha256");
assert(report.batch.contentSha256, "Fixture report must include contentSha256");
assert(report.evaluations.length === expected.items, `Expected ${expected.items} evaluations rows`);
assert(report.summary.reviewedItems === expected.reviewed, `Expected ${expected.reviewed} reviewed items`);
assert(report.annotations.total === expected.annotations, `Expected ${expected.annotations} annotations`);

for (const [model, modelExpected] of Object.entries(expected.models || {})) {
  const actual = report.models.find((candidate) => candidate.model === model);
  assert(actual, `Missing model summary for ${model}`);
  if (modelExpected.reviewed !== undefined) {
    assert(actual.reviewedItems === modelExpected.reviewed, `Model ${model} reviewed count mismatch`);
  }
  if (modelExpected.overallMean !== undefined) {
    assertNumberEqual(actual.overallMean, modelExpected.overallMean, `Model ${model} overallMean mismatch`);
  }
  for (const [dimension, expectedMean] of Object.entries(modelExpected.dimensions || {})) {
    assert(Object.hasOwn(actual.dimensions || {}, dimension), `Model ${model} missing dimension ${dimension}`);
    assertNumberEqual(actual.dimensions[dimension], expectedMean, `Model ${model} dimension ${dimension} mismatch`);
  }
}

for (const [tag, count] of Object.entries(expected.tags || {})) {
  const actual = report.tags.find((candidate) => candidate.tag === tag);
  assert(actual?.count === count, `Tag ${tag} expected count ${count}`);
}

for (const record of fixture) {
  const prompt = record.text || record.params?.content?.find((part) => part.text)?.text || "";
  const url = record.url || record.params?.content?.find((part) => part.url)?.url || "";
  const resultUrl = record.resultUrl || "";
  const optimizationPrompt = record.optimizationPrompt || "";
  for (const sensitive of [prompt, url, resultUrl, optimizationPrompt].filter(Boolean)) {
    assert(!reportRaw.includes(sensitive), `Fixture report leaked sensitive fixture value: ${sensitive}`);
  }
}

for (const sensitive of ["fixture high quality review", "fixture low preservation review"]) {
  assert(!reportRaw.includes(sensitive), `Fixture report leaked reviewer comment text: ${sensitive}`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      report: reportPath,
      expected: expectedPath,
      items: report.evaluations.length,
      reviewed: report.summary.reviewedItems,
      annotations: report.annotations.total,
    },
    null,
    2
  )
);
