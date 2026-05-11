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

const html = await getText("/");
if (!html.includes("Skill Eval Review")) {
  throw new Error("Review page did not return expected HTML");
}

const { batches } = await getJson("/api/batches");
if (!Array.isArray(batches) || batches.length === 0) {
  throw new Error("No batches found. Run pnpm run import:resource first.");
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

const firstCachedImage = items
  .flatMap((item) => [item.source_image_url, item.result_image_url])
  .find(Boolean);

if (!firstCachedImage) {
  throw new Error("No cached image path found in imported items");
}

const imageResponse = await fetch(`${baseUrl}${firstCachedImage}`);
if (!imageResponse.ok) {
  throw new Error(`Cached image ${firstCachedImage} returned HTTP ${imageResponse.status}`);
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
    },
    null,
    2
  )
);
