const baseUrl = process.env.SMOKE_BASE_URL || "http://127.0.0.1:4173";

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}`);
  }
  return response.json();
}

async function getText(path) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}`);
  }
  return response.text();
}

async function postJson(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function waitForTask(taskId, expectedStatus) {
  const deadline = Date.now() + 8000;
  let latest = null;
  while (Date.now() < deadline) {
    const { task } = await getJson(`/api/tasks/${taskId}`);
    latest = task;
    if (task.status === expectedStatus) return task;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Task ${taskId} did not reach ${expectedStatus}; latest=${JSON.stringify(latest)}`);
}

const html = await getText("/");
if (!html.includes("Skill Eval Review")) {
  throw new Error("Review page did not return expected HTML");
}
if (!html.includes("taskProgressStrip")) {
  throw new Error("Review page did not include the task progress strip");
}

const missingTask = await fetch(`${baseUrl}/api/tasks/not-a-real-task`);
if (missingTask.status !== 404) {
  throw new Error(`Missing task returned HTTP ${missingTask.status}, expected 404`);
}

const { batches } = await getJson("/api/batches");
if (!Array.isArray(batches)) {
  throw new Error("Batches API did not return an array");
}

const { resources } = await getJson("/api/resources");
if (!Array.isArray(resources) || resources.some((resource) => !resource.file?.endsWith(".json"))) {
  throw new Error("Resources API did not return JSON files");
}

const badImport = await postJson("/api/import", {
  downloadImages: false,
});
if (badImport.response.status !== 400) {
  throw new Error(`Import without a file returned HTTP ${badImport.response.status}, expected 400`);
}

const nonJsonImport = await postJson("/api/import", {
  file: "not-json.txt",
  downloadImages: false,
});
if (nonJsonImport.response.status !== 400) {
  throw new Error(`Import with a non-JSON file returned HTTP ${nonJsonImport.response.status}, expected 400`);
}

const missingJsonImport = await postJson("/api/import", {
  file: "smoke-missing-resource.json",
  downloadImages: false,
});
if (missingJsonImport.response.status !== 202 || !missingJsonImport.payload.task?.id) {
  throw new Error(`Import with a missing JSON file returned HTTP ${missingJsonImport.response.status}, expected 202 task`);
}
const failedImportTask = await waitForTask(missingJsonImport.payload.task.id, "failed");
if (!failedImportTask.error?.includes("Resource file not found")) {
  throw new Error("Missing JSON import task did not record the expected failure");
}

if (batches.length === 0) {
  const missingItem = await postJson("/api/items/not-a-real-item/evaluation", {
    product_preservation_score: 5,
    instruction_adherence_score: 4,
    integration_grounding_score: 3,
    prompt_optimization_value_score: 2,
    commercial_quality_score: 1,
    technical_safety_score: 5,
    status: "reviewed",
    tags: ["excellent"],
    comment: "missing item smoke",
  });
  if (missingItem.response.status !== 404) {
    throw new Error(`Missing item returned HTTP ${missingItem.response.status}, expected 404`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        batches: 0,
        mode: "empty-database",
      },
      null,
      2
    )
  );
  process.exit(0);
}

const batch = batches[0];
const { items } = await getJson(`/api/batches/${batch.id}/items`);
if (!Array.isArray(items) || items.length === 0) {
  throw new Error(`Batch ${batch.id} has no items`);
}

const { stats } = await getJson(`/api/batches/${batch.id}/stats`);
if (!stats?.summary || stats.summary.total_items !== items.length) {
  throw new Error("Stats summary does not match item count");
}

const recomputeCounts = await postJson(`/api/batches/${batch.id}/cache-counts/recompute`, {});
if (recomputeCounts.response.status !== 200 || recomputeCounts.payload.batchId !== batch.id) {
  throw new Error(`Cache-count recompute returned HTTP ${recomputeCounts.response.status}, expected 200`);
}
if (recomputeCounts.payload.stats?.summary?.total_items !== items.length) {
  throw new Error("Cache-count recompute stats did not match item count");
}

const { productCheck } = await getJson(`/api/batches/${batch.id}/product-check`);
if (productCheck !== null) {
  if (!productCheck?.summary || !Array.isArray(productCheck.items)) {
    throw new Error("Product-check API did not return the expected shape");
  }
  if (productCheck.summary.total !== productCheck.items.length) {
    throw new Error("Product-check summary does not match item count");
  }
}

const { run } = await getJson(`/api/batches/${batch.id}/product-check/runs/latest`);
if (run !== null && run.batchId !== batch.id) {
  throw new Error("Product-check run status batch id mismatch");
}
if (run !== null && (!("status" in run) || !("done" in run) || !("total" in run) || !("summary" in run))) {
  throw new Error("Product-check run status did not include status/done/total/summary");
}

const invalidEvaluation = await postJson(`/api/items/${items[0].id}/evaluation`, {
  product_preservation_score: 5,
  instruction_adherence_score: 4,
  integration_grounding_score: 3,
  prompt_optimization_value_score: 2,
  commercial_quality_score: 1,
  status: "reviewed",
  tags: ["excellent"],
  comment: "missing technical_safety_score",
});
if (invalidEvaluation.response.status !== 400) {
  throw new Error(`Invalid evaluation returned HTTP ${invalidEvaluation.response.status}, expected 400`);
}

const missingItem = await postJson("/api/items/not-a-real-item/evaluation", {
  product_preservation_score: 5,
  instruction_adherence_score: 4,
  integration_grounding_score: 3,
  prompt_optimization_value_score: 2,
  commercial_quality_score: 1,
  technical_safety_score: 5,
  status: "reviewed",
  tags: ["excellent"],
  comment: "missing item smoke",
});
if (missingItem.response.status !== 404) {
  throw new Error(`Missing item returned HTTP ${missingItem.response.status}, expected 404`);
}

const traversalResponse = await fetch(`${baseUrl}/data/..%2Fserver.js`);
if (![403, 404].includes(traversalResponse.status)) {
  throw new Error(`Traversal probe returned HTTP ${traversalResponse.status}, expected 403 or 404`);
}

const firstCachedImage = items
  .flatMap((item) => [item.source_image_url, item.result_image_url])
  .find(Boolean);

if (firstCachedImage) {
  const imageResponse = await fetch(`${baseUrl}${firstCachedImage}`);
  if (!imageResponse.ok) {
    throw new Error(`Cached image ${firstCachedImage} returned HTTP ${imageResponse.status}`);
  }
}

const models = [...new Set(items.map((item) => item.model))].sort();
const failedImages = items.filter(
  (item) => item.source_fetch_status !== "success" || item.result_fetch_status !== "success"
);

console.log(
  JSON.stringify(
    {
      ok: true,
      baseUrl,
      batch: batch.id,
      items: items.length,
      reviewed: stats.summary.reviewed_items,
      models,
      failedImages: failedImages.length,
      productCheckItems: productCheck?.items?.length || 0,
    },
    null,
    2
  )
);
