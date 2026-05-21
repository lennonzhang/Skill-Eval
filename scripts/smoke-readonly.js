const baseUrl = process.env.SMOKE_BASE_URL || `http://127.0.0.1:${process.env.PORT || 4173}`;

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

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} did not return an object`);
  }
}

const health = await getJson("/api/health");
if (health.ok !== true || typeof health.pid !== "number") {
  throw new Error("Health API did not return a healthy server identity");
}

const html = await getText("/");
if (!html.includes("Skill Eval Review")) {
  throw new Error("Review page did not return expected HTML");
}

const batchesBody = await getJson("/api/batches");
if (!Array.isArray(batchesBody.batches)) {
  throw new Error("Batches API did not return an array");
}

let batch = batchesBody.batches[0];
if (!batch) {
  const archivedBody = await getJson("/api/batches?includeArchived=1");
  if (!Array.isArray(archivedBody.batches)) {
    throw new Error("Archived batches API did not return an array");
  }
  batch = archivedBody.batches[0];
}

let checkedBatch = null;
if (batch?.id) {
  const batchId = encodeURIComponent(batch.id);
  const itemsBody = await getJson(`/api/batches/${batchId}/items`);
  if (!Array.isArray(itemsBody.items)) {
    throw new Error("Batch items API did not return an array");
  }
  const statsBody = await getJson(`/api/batches/${batchId}/stats`);
  assertObject(statsBody.stats, "Batch stats API");
  checkedBatch = {
    id: batch.id,
    items: itemsBody.items.length,
  };
}

console.log(
  JSON.stringify(
    {
      ok: true,
      baseUrl,
      pid: health.pid,
      batches: batchesBody.batches.length,
      checkedBatch,
    },
    null,
    2
  )
);
