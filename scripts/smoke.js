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

const html = await getText("/");
if (!html.includes("Skill Eval Review")) {
  throw new Error("Review page did not return expected HTML");
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
