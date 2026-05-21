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

const comparePath = argValue("compare");
const expectedPath = argValue("expected");
if (!comparePath) {
  throw new Error("Usage: pnpm run eval:compare:validate -- --compare=<path-to-compare.json>");
}

const raw = readFileSync(comparePath, "utf8");
const compare = JSON.parse(raw);
const expected = expectedPath ? JSON.parse(readFileSync(expectedPath, "utf8")) : null;

assert(compare.schemaVersion === 1, "schemaVersion must be 1");
assert(compare.sanitized === true, "sanitized must be true");
assert(compare.generatedAt, "generatedAt is required");
assert(compare.inputs?.batchId || (compare.inputs?.batchA && compare.inputs?.batchB), "inputs batch identity is required");
assert(compare.inputs?.labelA, "inputs.labelA is required");
assert(compare.inputs?.labelB, "inputs.labelB is required");
assert(compare.matching && typeof compare.matching === "object", "matching is required");
assert(compare.summary && typeof compare.summary === "object", "summary is required");
assert(Array.isArray(compare.dimensions), "dimensions must be an array");
assert(Array.isArray(compare.tags), "tags must be an array");
assert(Array.isArray(compare.warnings), "warnings must be an array");

for (const forbidden of [
  "text",
  "url",
  "resultUrl",
  "optimizationPrompt",
  "comment",
  "reviewerName",
  "sourceImagePath",
  "resultImagePath",
  "source_image_url",
  "result_image_url",
]) {
  assert(!raw.includes(`"${forbidden}":`), `Compare JSON unexpectedly contains sensitive field ${forbidden}`);
}

if (expected) {
  if (expected.modelA !== undefined) assert(compare.inputs.modelA === expected.modelA, "modelA mismatch");
  if (expected.modelB !== undefined) assert(compare.inputs.modelB === expected.modelB, "modelB mismatch");
  if (expected.itemsA !== undefined) assert(compare.summary.itemsA === expected.itemsA, "itemsA mismatch");
  if (expected.itemsB !== undefined) assert(compare.summary.itemsB === expected.itemsB, "itemsB mismatch");
  if (expected.overallMeanA !== undefined) assert(Number(compare.summary.overallMeanA) === Number(expected.overallMeanA), "overallMeanA mismatch");
  if (expected.overallMeanB !== undefined) assert(Number(compare.summary.overallMeanB) === Number(expected.overallMeanB), "overallMeanB mismatch");
  if (expected.aggregateDelta !== undefined) assert(Number(compare.summary.aggregateDelta) === Number(expected.aggregateDelta), "aggregateDelta mismatch");
  if (expected.matchedItems !== undefined) assert(compare.matching.matchedItems === expected.matchedItems, "matchedItems mismatch");
  for (const warning of expected.warnings || []) {
    assert(compare.warnings.some((actual) => String(actual).includes(warning)), `missing expected warning: ${warning}`);
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      compare: comparePath,
      batchId: compare.inputs.batchId,
      modelA: compare.inputs.modelA,
      modelB: compare.inputs.modelB,
      matchedItems: compare.matching.matchedItems,
    },
    null,
    2
  )
);
