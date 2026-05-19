import { expect, test } from "@playwright/test";

function makeRecords(count, prefix) {
  return Array.from({ length: count }, (_, index) => ({
    model: index % 2 === 0 ? "e2e-model-a" : "e2e-model-b",
    text: `${prefix} source prompt ${String(index + 1).padStart(3, "0")}`,
    url: `https://example.test/${prefix}/source-${index + 1}.png`,
    optimizationPrompt: `${prefix} optimized prompt ${String(index + 1).padStart(3, "0")}`,
    resultUrl: `https://example.test/${prefix}/result-${index + 1}.png`,
  }));
}

async function postJson(request, path, body) {
  const response = await request.post(path, { data: body });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function waitForTask(request, taskId, expectedStatus = "succeeded") {
  const deadline = Date.now() + 12_000;
  let latest = null;
  while (Date.now() < deadline) {
    const response = await request.get(`/api/tasks/${encodeURIComponent(taskId)}`);
    latest = await response.json();
    if (latest.task?.status === expectedStatus) return latest.task;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Task ${taskId} did not reach ${expectedStatus}: ${JSON.stringify(latest)}`);
}

async function createUploadedBatch(request, { count, prefix }) {
  const fileName = `${prefix}-${Date.now()}.json`;
  const content = JSON.stringify(makeRecords(count, prefix));
  const preflight = await postJson(request, "/api/import/upload/preflight", { fileName, content });
  expect(preflight.response.status()).toBe(200);
  expect(preflight.payload.preflight.validRecords).toBe(count);

  const upload = await postJson(request, "/api/import/upload", {
    fileName,
    content,
    sourceDigest: preflight.payload.preflight.sourceDigest,
    downloadImages: false,
  });
  expect(upload.response.status()).toBe(202);

  const task = await waitForTask(request, upload.payload.task.id);
  const itemsResponse = await request.get(`/api/batches/${encodeURIComponent(task.batchId)}/items`);
  expect(itemsResponse.status()).toBe(200);
  const { items } = await itemsResponse.json();
  expect(items).toHaveLength(count);
  return { batchId: task.batchId, items };
}

async function deleteBatch(request, batchId) {
  if (!batchId) return;
  await request.delete(`/api/batches/${encodeURIComponent(batchId)}`, {
    data: { confirmBatchId: batchId },
  });
}

test.describe("review workbench", () => {
  test("restores URL state, virtualizes the queue, and jumps back to the selected item", async ({ page, request }) => {
    const { batchId, items } = await createUploadedBatch(request, {
      count: 120,
      prefix: "e2e-url-virtual",
    });
    try {
      const target = items[79];
      await page.goto(`/?batch=${encodeURIComponent(batchId)}&item=${encodeURIComponent(target.id)}&status=all&lang=zh`);

      await expect(page.locator("#languageSelect")).toHaveValue("zh");
      await expect(page.locator("#batchSelect")).toHaveValue(batchId);
      await expect(page.locator("#reviewPane")).toContainText(target.id);

      await page.waitForFunction(() => document.querySelectorAll(".item-row").length > 0);
      const renderedRows = await page.locator(".item-row").count();
      expect(renderedRows).toBeLessThan(45);
      await expect(page.locator(`.item-row.active[data-id="${target.id}"]`)).toBeVisible();

      await page.locator("#itemList").evaluate((element) => {
        element.scrollTop = 0;
        element.dispatchEvent(new Event("scroll"));
      });
      await page.waitForFunction(
        (id) => !document.querySelector(`.item-row.active[data-id="${id}"]`),
        target.id
      );

      await page.locator("#scrollCurrentItemButton").click();
      await expect(page.locator(`.item-row.active[data-id="${target.id}"]`)).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`batch=${encodeURIComponent(batchId)}`));
      await expect(page).toHaveURL(new RegExp(`item=${encodeURIComponent(target.id)}`));
    } finally {
      await deleteBatch(request, batchId);
    }
  });

  test("selects the next active item after excluding the current item", async ({ page, request }) => {
    const { batchId, items } = await createUploadedBatch(request, {
      count: 5,
      prefix: "e2e-exclude-next",
    });
    try {
      const first = items[0];
      const second = items[1];
      await page.goto(`/?batch=${encodeURIComponent(batchId)}&item=${encodeURIComponent(first.id)}&status=all`);
      await expect(page.locator("#reviewPane")).toContainText(first.id);

      await page.locator('#excludeForm select[name="reason"]').selectOption("not_evaluable");
      await page.locator('#excludeForm button[type="submit"]').click();

      await expect(page.locator("#reviewPane")).toContainText(second.id);
      await expect(page).toHaveURL(new RegExp(`item=${encodeURIComponent(second.id)}`));

      const itemsResponse = await request.get(`/api/batches/${encodeURIComponent(batchId)}/items`);
      const body = await itemsResponse.json();
      expect(body.items.at(-1).id).toBe(first.id);
      expect(body.items.at(-1).is_excluded).toBe(1);

      const auditResponse = await request.get(`/api/audit-events?itemId=${encodeURIComponent(first.id)}&limit=5`);
      const auditBody = await auditResponse.json();
      expect(auditBody.events.some((event) => event.eventType === "item.exclude")).toBe(true);
    } finally {
      await deleteBatch(request, batchId);
    }
  });

  test("keeps the review workbench layout stable @visual", async ({ page, request }, testInfo) => {
    const { batchId, items } = await createUploadedBatch(request, {
      count: 16,
      prefix: "e2e-visual-layout",
    });
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/?batch=${encodeURIComponent(batchId)}&item=${encodeURIComponent(items[0].id)}&status=all&lang=en`);

      await expect(page.locator("#reviewPane")).toContainText(items[0].id);
      const bodyOverflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(bodyOverflowX).toBeLessThanOrEqual(1);

      const queueBox = await page.locator(".queue").boundingBox();
      const reviewBox = await page.locator("#reviewPane").boundingBox();
      const workspaceBox = await page.locator(".workspace").boundingBox();
      expect(queueBox).not.toBeNull();
      expect(reviewBox).not.toBeNull();
      expect(workspaceBox).not.toBeNull();
      expect(reviewBox.width).toBeGreaterThan(queueBox.width * 1.8);
      expect(Math.abs(queueBox.y - reviewBox.y)).toBeLessThanOrEqual(2);

      const rowHeights = await page.locator(".item-row").evaluateAll((rows) =>
        rows.slice(0, 3).map((row) => Math.round(row.getBoundingClientRect().height))
      );
      expect(rowHeights.every((height) => height === 92)).toBe(true);

      await testInfo.attach("review-workbench-layout", {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
    } finally {
      await deleteBatch(request, batchId);
    }
  });
});
