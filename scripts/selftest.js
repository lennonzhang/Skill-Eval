import assert from "node:assert/strict";

import { getBatchStats, getBatches, getDatabase, getItemsForBatch, saveEvaluation } from "../src/db.js";

const db = getDatabase();
const batch = getBatches()[0];

if (!batch) {
  throw new Error("No batch found. Run pnpm run import:resource first.");
}

const item = getItemsForBatch(batch.id)[0];
if (!item) {
  throw new Error(`Batch ${batch.id} has no items.`);
}

const before = getBatchStats(batch.id).summary.reviewed_items;

db.exec("BEGIN");
try {
  const evaluation = saveEvaluation(item.id, {
    intent_score: 5,
    source_fidelity_score: 4,
    prompt_optimization_score: 3,
    visual_quality_score: 2,
    technical_quality_score: 1,
    safety_score: 5,
    status: "reviewed",
    tags: ["excellent"],
    comment: "rollback selftest",
  });

  assert.equal(evaluation.overall_score, 3.55);
  assert.deepEqual(evaluation.tags, ["excellent"]);

  const during = getBatchStats(batch.id).summary.reviewed_items;
  assert.equal(during, item.overall_score == null ? before + 1 : before);
} finally {
  db.exec("ROLLBACK");
}

const after = getBatchStats(batch.id).summary.reviewed_items;
assert.equal(after, before);

console.log(
  JSON.stringify(
    {
      ok: true,
      batch: batch.id,
      item: item.id,
      reviewedBefore: before,
      reviewedAfterRollback: after,
    },
    null,
    2
  )
);
