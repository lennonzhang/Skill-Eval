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

async function patchJson(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "PATCH",
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

let { batches } = await getJson("/api/batches");
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

const badUploadName = await postJson("/api/import/upload", {
  fileName: "not-json.txt",
  content: "[]",
  downloadImages: false,
});
if (badUploadName.response.status !== 400) {
  throw new Error(`Upload import with a non-JSON file returned HTTP ${badUploadName.response.status}, expected 400`);
}

const badUploadPreflightName = await postJson("/api/import/upload/preflight", {
  fileName: "not-json.txt",
  content: "[]",
});
if (badUploadPreflightName.response.status !== 400) {
  throw new Error(`Upload preflight with a non-JSON file returned HTTP ${badUploadPreflightName.response.status}, expected 400`);
}

const malformedUpload = await postJson("/api/import/upload", {
  fileName: "smoke-upload.json",
  content: "{not-json",
  downloadImages: false,
});
if (malformedUpload.response.status !== 202 || !malformedUpload.payload.task?.id) {
  throw new Error(`Malformed upload import returned HTTP ${malformedUpload.response.status}, expected 202 task`);
}
const malformedUploadTask = await waitForTask(malformedUpload.payload.task.id, "failed");
if (!malformedUploadTask.error?.includes("not valid JSON")) {
  throw new Error("Malformed upload task did not record the expected JSON failure");
}

const uploadFileName = `smoke-upload-${Date.now()}.json`;
const uploadContent = JSON.stringify([
  {
    model: "smoke-upload-model",
    text: "smoke upload source prompt",
    url: "https://example.test/smoke-upload-source.png",
    optimizationPrompt: "smoke upload optimized prompt",
    resultUrl: "https://example.test/smoke-upload-result.png",
  },
]);
const validUploadPreflight = await postJson("/api/import/upload/preflight", {
  fileName: uploadFileName,
  content: uploadContent,
});
if (validUploadPreflight.response.status !== 200 || validUploadPreflight.payload.preflight?.validRecords !== 1) {
  throw new Error(`Valid upload preflight returned HTTP ${validUploadPreflight.response.status}, expected 200 with one valid record`);
}
if (!validUploadPreflight.payload.preflight.sourceDigest?.startsWith("sha256:")) {
  throw new Error("Valid upload preflight did not return a source digest");
}
const digestMismatchUpload = await postJson("/api/import/upload", {
  fileName: uploadFileName,
  content: uploadContent,
  sourceDigest: "sha256:not-the-same",
  downloadImages: false,
});
if (digestMismatchUpload.response.status !== 202 || !digestMismatchUpload.payload.task?.id) {
  throw new Error(`Digest mismatch upload returned HTTP ${digestMismatchUpload.response.status}, expected 202 task`);
}
const digestMismatchTask = await waitForTask(digestMismatchUpload.payload.task.id, "failed");
if (!digestMismatchTask.error?.includes("Source changed after preflight")) {
  throw new Error("Digest mismatch upload task did not record the expected failure");
}
const validUpload = await postJson("/api/import/upload", {
  fileName: uploadFileName,
  content: uploadContent,
  sourceDigest: validUploadPreflight.payload.preflight.sourceDigest,
  downloadImages: false,
});
if (validUpload.response.status !== 202 || !validUpload.payload.task?.id) {
  throw new Error(`Valid upload import returned HTTP ${validUpload.response.status}, expected 202 task`);
}
const uploadedTask = await waitForTask(validUpload.payload.task.id, "succeeded");
if (!uploadedTask.batchId) {
  throw new Error("Valid upload task did not return a batch id");
}
const uploadedItemsBody = await getJson(`/api/batches/${uploadedTask.batchId}/items`);
if (uploadedItemsBody.items.length !== 1 || uploadedItemsBody.items[0].raw_json_file !== uploadFileName) {
  throw new Error("Uploaded batch items did not match the uploaded JSON");
}
const uploadedBatchBody = await getJson("/api/batches");
const uploadedBatch = uploadedBatchBody.batches.find((candidate) => candidate.id === uploadedTask.batchId);
if (uploadedBatch?.source_dir !== "upload" || uploadedBatch?.source_file !== uploadFileName) {
  throw new Error("Uploaded batch did not record upload source metadata");
}
batches = uploadedBatchBody.batches;
const resourcesAfterUpload = await getJson("/api/resources");
if (resourcesAfterUpload.resources.some((resource) => resource.file === uploadFileName)) {
  throw new Error("Uploaded JSON was unexpectedly listed as a resource file");
}

const archiveResponse = await patchJson(`/api/batches/${uploadedTask.batchId}/archive`, {
  reason: "other",
  note: "smoke archive restore",
});
if (archiveResponse.response.status !== 200 || !archiveResponse.payload.batch?.archived_at) {
  throw new Error(`Archive endpoint returned HTTP ${archiveResponse.response.status}, expected archived batch`);
}
const hiddenAfterArchive = await getJson("/api/batches");
if (hiddenAfterArchive.batches.some((candidate) => candidate.id === uploadedTask.batchId)) {
  throw new Error("Archived batch was not hidden from the default batch list");
}
const visibleArchived = await getJson("/api/batches?includeArchived=1");
if (!visibleArchived.batches.some((candidate) => candidate.id === uploadedTask.batchId && candidate.archived_at)) {
  throw new Error("Archived batch was not visible with includeArchived=1");
}
const restoreResponse = await patchJson(`/api/batches/${uploadedTask.batchId}/restore`, {});
if (restoreResponse.response.status !== 200 || restoreResponse.payload.batch?.archived_at) {
  throw new Error(`Restore endpoint returned HTTP ${restoreResponse.response.status}, expected active batch`);
}
const deletePlanResponse = await postJson(`/api/batches/${uploadedTask.batchId}/delete-plan`, {});
if (deletePlanResponse.response.status !== 200 || deletePlanResponse.payload.plan?.items !== 1) {
  throw new Error(`Delete-plan endpoint returned HTTP ${deletePlanResponse.response.status}, expected one item`);
}
if (deletePlanResponse.payload.plan.artifacts?.some((artifact) => !String(artifact.path).startsWith("data"))) {
  throw new Error("Delete-plan returned an artifact outside data/");
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

const batch = batches.find((candidate) => candidate.id === uploadedTask.batchId) || batches[0];
const { items } = await getJson(`/api/batches/${batch.id}/items`);
if (!Array.isArray(items) || items.length === 0) {
  throw new Error(`Batch ${batch.id} has no items`);
}

const { stats } = await getJson(`/api/batches/${batch.id}/stats`);
const activeItems = items.filter((item) => !item.is_excluded);
const excludedItems = items.filter((item) => item.is_excluded);
if (!stats?.summary || stats.summary.total_items !== activeItems.length) {
  throw new Error("Stats summary does not match item count");
}
if ((stats.summary.excluded_items || 0) !== excludedItems.length) {
  throw new Error("Stats summary does not match excluded item count");
}

const recomputeCounts = await postJson(`/api/batches/${batch.id}/cache-counts/recompute`, {});
if (recomputeCounts.response.status !== 200 || recomputeCounts.payload.batchId !== batch.id) {
  throw new Error(`Cache-count recompute returned HTTP ${recomputeCounts.response.status}, expected 200`);
}
if (recomputeCounts.payload.stats?.summary?.total_items !== activeItems.length) {
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
if (run !== null && !["versioned", "legacy"].includes(run.metadataStatus)) {
  throw new Error("Product-check run status did not include metadataStatus");
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

if (activeItems.length > 0) {
  const exclusionTarget = activeItems[0];
  const statsBeforeExclusion = await getJson(`/api/batches/${batch.id}/stats`);
  let exclusionApplied = false;
  try {
    const badExclusion = await patchJson(`/api/items/${exclusionTarget.id}/exclusion`, {
      excluded: true,
      reason: "not-a-real-reason",
      note: "",
    });
    if (badExclusion.response.status !== 400) {
      throw new Error(`Invalid exclusion returned HTTP ${badExclusion.response.status}, expected 400`);
    }

    const excludeResponse = await patchJson(`/api/items/${exclusionTarget.id}/exclusion`, {
      excluded: true,
      reason: "not_evaluable",
      note: "smoke temporary exclusion",
    });
    if (excludeResponse.response.status !== 200 || !excludeResponse.payload.item?.is_excluded) {
      throw new Error(`Exclude endpoint returned HTTP ${excludeResponse.response.status}, expected excluded item`);
    }
    exclusionApplied = true;

    const excludedList = await getJson(`/api/batches/${batch.id}/items`);
    const excludedItem = excludedList.items.find((item) => item.id === exclusionTarget.id);
    if (!excludedItem?.is_excluded) {
      throw new Error("Excluded item remained missing or active in items API");
    }
    const firstExcludedIndex = excludedList.items.findIndex((item) => item.is_excluded);
    const laterActiveIndex = excludedList.items.findIndex((item, index) => index > firstExcludedIndex && !item.is_excluded);
    if (firstExcludedIndex !== -1 && laterActiveIndex !== -1) {
      throw new Error("Excluded item was not sorted after active items");
    }

    const statsAfterExclusion = await getJson(`/api/batches/${batch.id}/stats`);
    if (statsAfterExclusion.stats.summary.total_items !== statsBeforeExclusion.stats.summary.total_items - 1) {
      throw new Error("Stats total_items did not exclude the temporary item");
    }
    if (statsAfterExclusion.stats.summary.excluded_items !== statsBeforeExclusion.stats.summary.excluded_items + 1) {
      throw new Error("Stats excluded_items did not include the temporary item");
    }
  } finally {
    if (exclusionApplied) {
      const restoreResponse = await patchJson(`/api/items/${exclusionTarget.id}/exclusion`, { excluded: false });
      if (restoreResponse.response.status !== 200 || restoreResponse.payload.item?.is_excluded) {
        throw new Error(`Restore endpoint returned HTTP ${restoreResponse.response.status}, expected active item`);
      }
    }
  }
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
