import assert from "node:assert/strict";

import { getBatchStats, getBatches, getDatabase, getItemsForBatch, saveEvaluation } from "../src/db.js";
import { calculateOverallScore, EvaluationValidationError, validateEvaluationInput } from "../public/scoring.js";

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
    product_preservation_score: 5,
    instruction_adherence_score: 4,
    integration_grounding_score: 3,
    prompt_optimization_value_score: 2,
    commercial_quality_score: 1,
    technical_safety_score: 5,
    status: "reviewed",
    tags: ["excellent"],
    comment: "rollback selftest",
  });

  assert.equal(evaluation.overall_score, 3.45);
  assert.deepEqual(evaluation.tags, ["excellent"]);

  const during = getBatchStats(batch.id).summary.reviewed_items;
  assert.equal(during, item.overall_score == null ? before + 1 : before);
} finally {
  db.exec("ROLLBACK");
}

assert.equal(
  calculateOverallScore({
    product_preservation_score: 2,
    instruction_adherence_score: 5,
    integration_grounding_score: 5,
    prompt_optimization_value_score: 5,
    commercial_quality_score: 5,
    technical_safety_score: 5,
  }),
  2.5
);
assert.equal(
  calculateOverallScore({
    product_preservation_score: 5,
    instruction_adherence_score: 2,
    integration_grounding_score: 5,
    prompt_optimization_value_score: 5,
    commercial_quality_score: 5,
    technical_safety_score: 5,
  }),
  3
);
assert.equal(
  calculateOverallScore({
    product_preservation_score: 5,
    instruction_adherence_score: 5,
    integration_grounding_score: 5,
    prompt_optimization_value_score: 5,
    commercial_quality_score: 5,
    technical_safety_score: 1,
  }),
  2
);
assert.throws(
  () =>
    validateEvaluationInput({
      product_preservation_score: 5,
      instruction_adherence_score: 4,
      integration_grounding_score: 3,
      prompt_optimization_value_score: 2,
      commercial_quality_score: 1,
      status: "reviewed",
      tags: ["excellent"],
      comment: "",
    }),
  EvaluationValidationError
);

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
