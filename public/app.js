import { calculateOverallScore, scoreFields, statusOptions, tagOptions } from "./scoring.js";

const translations = {
  en: {
    "app.title": "Skill Eval Review",
    "app.language": "Language",
    "app.batch": "Batch",
    "actions.importResource": "Import Resource",
    "actions.importing": "Importing...",
    "actions.runProductCheck": "Run Product Check",
    "actions.runningProductCheck": "Running...",
    "actions.nextUnreviewed": "Next Unreviewed",
    "actions.close": "Close",
    "actions.saveReview": "Save Review",
    "actions.retry": "Retry",
    "actions.retrying": "Retrying...",
    "actions.browserCache": "Browser Cache",
    "actions.browserCaching": "Browser caching...",
    "actions.openRemoteUrl": "Open remote URL",
    "task.import": "Import",
    "task.productCheck": "Product Check",
    "task.browserCache": "Browser Cache",
    "task.queued": "Queued",
    "task.running": "Running",
    "task.succeeded": "Done",
    "task.failed": "Failed",
    "task.partial": "Partial",
    "task.progress": "{done}/{total}",
    "task.importSummary": "inserted {inserted} · source {cachedSource} · result {cachedResult} · failed {failed}",
    "task.importActive": "Caching item {index}: {kind} {status}",
    "task.importActiveItem": "Caching item {index}",
    "task.productCheckSummary": "checked {checked} · unsupported {unsupported} · failed {failed}",
    "task.browserCacheSummary": "recovered {success} · failed {failed}",
    "metrics.aria": "Batch statistics",
    "metrics.total": "Total",
    "metrics.reviewed": "Reviewed",
    "metrics.remaining": "Remaining",
    "metrics.sourceCache": "Source Cache",
    "metrics.resultCache": "Result Cache",
    "filters.aria": "Review filters",
    "filters.model": "Model",
    "filters.status": "Status",
    "filters.all": "All",
    "filters.unreviewed": "Unreviewed",
    "filters.reviewed": "Reviewed",
    "filters.search": "Search",
    "filters.searchPlaceholder": "Prompt, tag, file...",
    "filters.allModels": "All models",
    "queue.aria": "Items",
    "queue.title": "Items",
    "queue.visible": "{count} visible",
    "queue.noMatching": "No matching items",
    "review.open": "Open",
    "review.reviewed": "Reviewed",
    "review.notReviewed": "Not reviewed",
    "review.saved": "Saved",
    "review.saving": "Saving...",
    "review.savedAt": "Saved {time}",
    "review.noItemTitle": "No item selected",
    "review.noItemBody": "Select a row from the queue.",
    "review.itemMeta": "{file} | item {index} | {id}",
    "review.evaluation": "Evaluation",
    "review.overall": "Overall",
    "review.coreScores": "Core Scores",
    "review.qualityScores": "Quality Scores",
    "review.status": "Status",
    "review.comment": "Comment",
    "review.commentPlaceholder": "Reviewer notes",
    "review.tags": "Tags",
    "review.originalPrompt": "Original Prompt",
    "review.optimizedPrompt": "Optimized Prompt",
    "productCheck.title": "Product Check",
    "productCheck.none": "No product-check result for this batch.",
    "productCheck.noItem": "No product-check result for this item.",
    "productCheck.score": "Suggested Score",
    "productCheck.confidence": "Confidence",
    "productCheck.status": "Status",
    "productCheck.unsupported": "Unsupported",
    "productCheck.meanDiff": "Mean diff",
    "productCheck.p90Diff": "P90 diff",
    "productCheck.ssim": "SSIM",
    "productCheck.ncc": "NCC",
    "productCheck.offset": "Offset",
    "productCheck.sourceMask": "Source mask",
    "productCheck.resultMatch": "Result match",
    "productCheck.diffHeatmap": "Diff heatmap",
    "productCheck.runStatus": "Product Check",
    "productCheck.notRun": "not run",
    "resources.none": "No JSON files",
    "empty.initialTitle": "Select or import a batch",
    "empty.initialBody": "Use the batch menu or import local resource JSON to begin.",
    "empty.noBatch": "No batch loaded",
    "empty.noBatches": "No batches",
    "stats.aria": "Model statistics",
    "stats.modelScores": "Model Scores",
    "stats.issueTags": "Issue Tags",
    "stats.noReviewedModels": "No reviewed models yet.",
    "stats.noTags": "No tags yet.",
    "stats.reviewedCount": "{reviewed}/{total} reviewed",
    "image.source": "Source Image",
    "image.result": "Result Image",
    "image.sourceAlt": "Source image",
    "image.resultAlt": "Result image",
    "image.notCached": "Image is not cached locally.",
    "image.localLoadFailed": "Cached image failed to load locally.",
    "image.retryFailed": "Image retry failed.",
    "image.browserCacheFailed": "Browser cache failed.",
    "image.browserCacheCors": "Browser fetch could not read this image. The remote host may block CORS for page scripts.",
    "image.browserCacheHttp": "Browser fetch returned HTTP {status}.",
    "image.closeAria": "Close image",
    "fetch.success": "success",
    "fetch.failed": "failed",
    "fetch.pending": "pending",
    "fetch.skipped": "skipped",
    "fetch.missing": "missing",
    "compare.sideBySide": "Side by Side",
    "compare.overlay": "Overlay",
    "overlay.unavailableTitle": "Overlay unavailable",
    "overlay.unavailableBody": "Both cached source and result images must load before overlay comparison is available.",
    "overlay.sourceAlt": "Source image overlay",
    "overlay.resultAlt": "Result image overlay",
    "overlay.sourceBaseAlt": "Source image base",
    "overlay.resultBaseAlt": "Result image base",
    "overlay.opacity": "Opacity",
    "overlay.sourceOverResult": "Source over Result",
    "overlay.resultOverSource": "Result over Source",
    "overlay.blinkOn": "Blink On",
    "overlay.blinkOff": "Blink Off",
    "overlay.sizeUnavailable": "Image size unavailable",
    "overlay.pixelAligned": "Pixel-aligned",
    "overlay.aspectFitOnly": "Aspect-fit only, not pixel-perfect",
    "overlay.meta": "Source: {source} | Result: {result} | {aligned}",
    "error.unableTitle": "Unable to load",
    "score.weight": "Weight {weight}. {help}",
    "score.product_preservation_score.label": "Product preservation",
    "score.product_preservation_score.help": "Subject pixels, pose, size, position, identity, and silhouette remain unchanged.",
    "score.instruction_adherence_score.label": "Instruction adherence",
    "score.instruction_adherence_score.help": "Result follows the original prompt and optimized prompt without adding forbidden elements.",
    "score.integration_grounding_score.label": "Scene integration",
    "score.integration_grounding_score.help": "Background, contact shadows, occlusion, lighting, and perspective make the fixed product feel grounded.",
    "score.prompt_optimization_value_score.label": "Optimization value",
    "score.prompt_optimization_value_score.help": "Optimized prompt adds useful constraints and clarity without over-constraining or drifting from intent.",
    "score.commercial_quality_score.label": "Commercial quality",
    "score.commercial_quality_score.help": "Image is attractive, premium, clean, and usable for ecommerce or marketing review.",
    "score.technical_safety_score.label": "Technical and safety",
    "score.technical_safety_score.help": "No severe artifacts, broken geometry, unsafe content, brand-risk elements, or unreadable generated text.",
    "status.reviewed": "reviewed",
    "status.needs_recheck": "needs_recheck",
    "status.failed": "failed",
  },
  zh: {
    "app.title": "Skill Eval 评审",
    "app.language": "语言",
    "app.batch": "批次",
    "actions.importResource": "导入资源",
    "actions.importing": "导入中...",
    "actions.runProductCheck": "运行产品检查",
    "actions.runningProductCheck": "检查中...",
    "actions.nextUnreviewed": "下一个未评审",
    "actions.close": "关闭",
    "actions.saveReview": "保存评审",
    "actions.retry": "重试",
    "actions.retrying": "重试中...",
    "actions.browserCache": "浏览器缓存",
    "actions.browserCaching": "浏览器缓存中...",
    "actions.openRemoteUrl": "打开远程链接",
    "task.import": "导入",
    "task.productCheck": "产品检查",
    "task.browserCache": "浏览器缓存",
    "task.queued": "排队中",
    "task.running": "运行中",
    "task.succeeded": "完成",
    "task.failed": "失败",
    "task.partial": "部分完成",
    "task.progress": "{done}/{total}",
    "task.importSummary": "新增 {inserted} · 原图 {cachedSource} · 结果 {cachedResult} · 失败 {failed}",
    "task.importActive": "正在缓存第 {index} 条：{kind} {status}",
    "task.importActiveItem": "正在缓存第 {index} 条",
    "task.productCheckSummary": "已检查 {checked} · 不支持 {unsupported} · 失败 {failed}",
    "task.browserCacheSummary": "恢复 {success} · 失败 {failed}",
    "metrics.aria": "批次统计",
    "metrics.total": "总数",
    "metrics.reviewed": "已评审",
    "metrics.remaining": "剩余",
    "metrics.sourceCache": "原图缓存",
    "metrics.resultCache": "结果缓存",
    "filters.aria": "评审筛选",
    "filters.model": "模型",
    "filters.status": "状态",
    "filters.all": "全部",
    "filters.unreviewed": "未评审",
    "filters.reviewed": "已评审",
    "filters.search": "搜索",
    "filters.searchPlaceholder": "提示词、标签、文件...",
    "filters.allModels": "全部模型",
    "queue.aria": "条目",
    "queue.title": "条目",
    "queue.visible": "显示 {count} 条",
    "queue.noMatching": "没有匹配条目",
    "review.open": "待评审",
    "review.reviewed": "已评审",
    "review.notReviewed": "未评审",
    "review.saved": "已保存",
    "review.saving": "保存中...",
    "review.savedAt": "已保存 {time}",
    "review.noItemTitle": "未选择条目",
    "review.noItemBody": "从左侧队列选择一条记录。",
    "review.itemMeta": "{file} | 第 {index} 条 | {id}",
    "review.evaluation": "评审",
    "review.overall": "总分",
    "review.coreScores": "核心评分",
    "review.qualityScores": "质量评分",
    "review.status": "状态",
    "review.comment": "备注",
    "review.commentPlaceholder": "评审备注",
    "review.tags": "标签",
    "review.originalPrompt": "原始提示词",
    "review.optimizedPrompt": "优化提示词",
    "productCheck.title": "产品检查",
    "productCheck.none": "当前批次还没有产品检查结果。",
    "productCheck.noItem": "当前条目没有产品检查结果。",
    "productCheck.score": "建议分",
    "productCheck.confidence": "置信度",
    "productCheck.status": "状态",
    "productCheck.unsupported": "不支持原因",
    "productCheck.meanDiff": "平均差异",
    "productCheck.p90Diff": "P90 差异",
    "productCheck.ssim": "SSIM",
    "productCheck.ncc": "NCC",
    "productCheck.offset": "偏移",
    "productCheck.sourceMask": "原图蒙版",
    "productCheck.resultMatch": "结果匹配",
    "productCheck.diffHeatmap": "差异热图",
    "productCheck.runStatus": "产品检查",
    "productCheck.notRun": "未运行",
    "empty.initialTitle": "选择或导入批次",
    "empty.initialBody": "使用批次菜单，或导入本地 resource JSON 开始。",
    "empty.noBatch": "未加载批次",
    "empty.noBatches": "没有批次",
    "stats.aria": "模型统计",
    "stats.modelScores": "模型分数",
    "stats.issueTags": "问题标签",
    "stats.noReviewedModels": "还没有已评审模型。",
    "stats.noTags": "还没有标签。",
    "stats.reviewedCount": "已评审 {reviewed}/{total}",
    "image.source": "原图",
    "image.result": "结果图",
    "image.sourceAlt": "原图",
    "image.resultAlt": "结果图",
    "image.notCached": "图片未缓存到本地。",
    "image.localLoadFailed": "本地缓存图片加载失败。",
    "image.retryFailed": "图片重试失败。",
    "image.browserCacheFailed": "浏览器缓存失败。",
    "image.browserCacheCors": "浏览器 fetch 无法读取这张图片，远端可能禁止页面脚本跨域读取。",
    "image.browserCacheHttp": "浏览器 fetch 返回 HTTP {status}。",
    "image.closeAria": "关闭图片",
    "fetch.success": "成功",
    "fetch.failed": "失败",
    "fetch.pending": "等待中",
    "fetch.skipped": "已跳过",
    "fetch.missing": "缺失",
    "compare.sideBySide": "并排",
    "compare.overlay": "叠图",
    "overlay.unavailableTitle": "叠图不可用",
    "overlay.unavailableBody": "原图和结果图都已缓存且可加载后，才能使用叠图对比。",
    "overlay.sourceAlt": "原图叠图",
    "overlay.resultAlt": "结果图叠图",
    "overlay.sourceBaseAlt": "原图底图",
    "overlay.resultBaseAlt": "结果图底图",
    "overlay.opacity": "透明度",
    "overlay.sourceOverResult": "原图在上",
    "overlay.resultOverSource": "结果图在上",
    "overlay.blinkOn": "闪烁 开",
    "overlay.blinkOff": "闪烁 关",
    "overlay.sizeUnavailable": "图片尺寸不可用",
    "overlay.pixelAligned": "像素对齐",
    "overlay.aspectFitOnly": "仅按比例适配，非像素级对齐",
    "overlay.meta": "原图: {source} | 结果图: {result} | {aligned}",
    "error.unableTitle": "加载失败",
    "score.weight": "权重 {weight}。{help}",
    "score.product_preservation_score.label": "产品保真",
    "score.product_preservation_score.help": "主体像素、姿态、尺寸、位置、身份和轮廓保持不变。",
    "score.instruction_adherence_score.label": "指令遵循",
    "score.instruction_adherence_score.help": "结果遵循原始提示词和优化提示词，且不添加禁止元素。",
    "score.integration_grounding_score.label": "场景融合",
    "score.integration_grounding_score.help": "背景、接触阴影、遮挡、光照和透视让固定产品自然落位。",
    "score.prompt_optimization_value_score.label": "提示词优化价值",
    "score.prompt_optimization_value_score.help": "优化提示词增加了有用约束和清晰度，同时不过度约束或偏离意图。",
    "score.commercial_quality_score.label": "商业质感",
    "score.commercial_quality_score.help": "图像美观、高级、干净，可用于电商或营销评审。",
    "score.technical_safety_score.label": "技术与安全",
    "score.technical_safety_score.help": "无严重伪影、几何错误、不安全内容、品牌风险元素或不可读生成文字。",
    "status.reviewed": "已评审",
    "status.needs_recheck": "需复查",
    "status.failed": "失败",
    "resources.none": "没有 JSON 文件",
  },
};

function initialLanguage() {
  const saved = localStorage.getItem("skill-eval-language");
  if (saved && translations[saved]) return saved;
  return navigator.language?.toLowerCase().startsWith("zh") ? "zh" : "en";
}

const state = {
  language: initialLanguage(),
  batches: [],
  resources: [],
  selectedResourceFile: "",
  selectedBatchId: "",
  items: [],
  stats: null,
  productCheck: null,
  productCheckRun: null,
  productCheckPolling: null,
  importTask: null,
  importTaskPolling: null,
  taskProgressRenderTimer: null,
  selectedItemId: "",
  compareMode: "side-by-side",
  overlayOpacity: 55,
  overlayTop: "source",
  overlayBlink: false,
  imageSizes: {},
  imageLoadFailures: {},
  retryingImages: new Set(),
  browserCachingImages: new Set(),
  autoBrowserCacheAttempted: new Set(),
  autoBrowserCacheRun: null,
  reviewDrafts: {},
  filters: {
    model: "all",
    status: "all",
    search: "",
  },
};

const els = {
  languageSelect: document.querySelector("#languageSelect"),
  batchMeta: document.querySelector("#batchMeta"),
  taskProgressStrip: document.querySelector("#taskProgressStrip"),
  batchSelect: document.querySelector("#batchSelect"),
  resourceSelect: document.querySelector("#resourceSelect"),
  importButton: document.querySelector("#importButton"),
  runProductCheckButton: document.querySelector("#runProductCheckButton"),
  totalItems: document.querySelector("#totalItems"),
  reviewedItems: document.querySelector("#reviewedItems"),
  remainingItems: document.querySelector("#remainingItems"),
  sourceCache: document.querySelector("#sourceCache"),
  resultCache: document.querySelector("#resultCache"),
  modelFilter: document.querySelector("#modelFilter"),
  statusFilter: document.querySelector("#statusFilter"),
  searchInput: document.querySelector("#searchInput"),
  nextUnreviewedButton: document.querySelector("#nextUnreviewedButton"),
  visibleCount: document.querySelector("#visibleCount"),
  itemList: document.querySelector("#itemList"),
  reviewPane: document.querySelector("#reviewPane"),
  modelStats: document.querySelector("#modelStats"),
  tagStats: document.querySelector("#tagStats"),
  imageDialog: document.querySelector("#imageDialog"),
  dialogImage: document.querySelector("#dialogImage"),
  closeDialogButton: document.querySelector("#closeDialogButton"),
};

function t(key, values = {}) {
  const template = translations[state.language]?.[key] ?? translations.en[key] ?? key;
  return Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value ?? "")),
    template
  );
}

function translatedStatus(status) {
  return t(`status.${status}`);
}

function translatedFetchStatus(status) {
  return t(`fetch.${status || "missing"}`);
}

function scoreLabel(scoreField) {
  return t(`score.${scoreField.field}.label`);
}

function scoreHelp(scoreField) {
  return t(`score.${scoreField.field}.help`);
}

function applyStaticTranslations() {
  document.documentElement.lang = state.language === "zh" ? "zh-CN" : "en";
  document.title = t("app.title");
  els.languageSelect.value = state.language;

  for (const element of document.querySelectorAll("[data-i18n]")) {
    element.textContent = t(element.dataset.i18n);
  }
  for (const element of document.querySelectorAll("[data-i18n-placeholder]")) {
    element.placeholder = t(element.dataset.i18nPlaceholder);
  }
  for (const element of document.querySelectorAll("[data-i18n-aria-label]")) {
    element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel));
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options,
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error || "Request failed");
  }
  return body;
}

function scoreValue(item, field) {
  return Number(item[field] || 3);
}

function calculateOverall(form) {
  return calculateOverallScore(Object.fromEntries(scoreFields.map(({ field }) => [field, Number(form[field])]))).toFixed(2);
}

function isReviewed(item) {
  return item.overall_score !== null && item.overall_score !== undefined;
}

function selectedBatch() {
  return state.batches.find((batch) => batch.id === state.selectedBatchId);
}

function filteredItems() {
  const query = state.filters.search.trim().toLowerCase();
  return state.items.filter((item) => {
    if (state.filters.model !== "all" && item.model !== state.filters.model) return false;
    if (state.filters.status === "reviewed" && !isReviewed(item)) return false;
    if (state.filters.status === "unreviewed" && isReviewed(item)) return false;
    if (!query) return true;
    const haystack = [
      item.model,
      item.text,
      item.optimization_prompt,
      item.raw_json_file,
      ...(Array.isArray(item.tags) ? item.tags : []),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });
}

function renderBatchSelect() {
  if (!state.batches.length) {
    els.batchSelect.innerHTML = `<option value="">${escapeHtml(t("empty.noBatches"))}</option>`;
    return;
  }

  els.batchSelect.innerHTML = state.batches
    .map((batch) => {
      const label = `${batch.name} (${batch.reviewed_count || 0}/${batch.item_count || 0})`;
      return `<option value="${escapeHtml(batch.id)}">${escapeHtml(label)}</option>`;
    })
    .join("");
  els.batchSelect.value = state.selectedBatchId;
}

function renderResourceSelect() {
  if (!state.resources.length) {
    els.resourceSelect.innerHTML = `<option value="">${escapeHtml(t("resources.none"))}</option>`;
    return;
  }
  els.resourceSelect.innerHTML = state.resources
    .map((resource) => `<option value="${escapeHtml(resource.file)}">${escapeHtml(resource.file)}</option>`)
    .join("");
  if (!state.selectedResourceFile || !state.resources.some((resource) => resource.file === state.selectedResourceFile)) {
    state.selectedResourceFile = state.resources[0].file;
  }
  els.resourceSelect.value = state.selectedResourceFile;
}

function renderMetrics() {
  const summary = state.stats?.summary || {};
  els.totalItems.textContent = summary.total_items || 0;
  els.reviewedItems.textContent = summary.reviewed_items || 0;
  els.remainingItems.textContent = summary.unreviewed_items || 0;
  els.sourceCache.textContent = `${summary.cached_source_images || 0}/${summary.total_items || 0}`;
  els.resultCache.textContent = `${summary.cached_result_images || 0}/${summary.total_items || 0}`;

  const batch = selectedBatch();
  if (!batch) {
    els.batchMeta.textContent = t("empty.noBatch");
    return;
  }
  const imported = batch.imported_at ? new Date(batch.imported_at).toLocaleString() : "";
  const sourceFile = batch.source_file ? ` | ${batch.source_file}` : "";
  const runStatus = state.productCheckRun?.status || (state.productCheck ? "succeeded" : t("productCheck.notRun"));
  els.batchMeta.textContent = `${batch.id}${sourceFile} | ${imported} | ${t("productCheck.runStatus")}: ${runStatus}`;

  els.runProductCheckButton.disabled = !state.selectedBatchId || state.productCheckRun?.status === "running";
  els.runProductCheckButton.textContent =
    state.productCheckRun?.status === "running" ? t("actions.runningProductCheck") : t("actions.runProductCheck");
}

function normalizeTaskStatus(status) {
  if (status === "finished") return "succeeded";
  if (status === "stale") return "failed";
  return status || "running";
}

function taskLabel(task) {
  if (task.type === "import") return t("task.import");
  if (task.type === "product-check") return t("task.productCheck");
  return t("task.browserCache");
}

function taskDone(task) {
  return Math.max(0, Number(task.done || 0));
}

function taskTotal(task) {
  return Math.max(taskDone(task), Number(task.total || 0));
}

function taskPercent(task) {
  const total = taskTotal(task);
  if (!total) return 0;
  return Math.max(0, Math.min(100, (taskDone(task) / total) * 100));
}

function importTaskSummary(task) {
  const summary = task.summary || {};
  const failed = Number(summary.failedSource || 0) + Number(summary.failedResult || 0);
  return t("task.importSummary", {
    inserted: summary.inserted || 0,
    cachedSource: summary.cachedSource || 0,
    cachedResult: summary.cachedResult || 0,
    failed,
  });
}

function importTaskMessage(task) {
  const summary = task.summary || {};
  if (task.status === "running" && summary.activeItemIndex) {
    if (summary.activeImageKind) {
      return t("task.importActive", {
        index: summary.activeItemIndex,
        kind: t(`image.${summary.activeImageKind}`),
        status: t(`fetch.${summary.activeImageStatus || "pending"}`),
      });
    }
    return t("task.importActiveItem", { index: summary.activeItemIndex });
  }
  return task.error || task.message || task.latestMessage || importTaskSummary(task);
}

function productCheckTaskSummary(run) {
  const summary = run.summary || {};
  return t("task.productCheckSummary", {
    checked: summary.checked ?? run.checked ?? 0,
    unsupported: summary.unsupported ?? run.unsupported ?? 0,
    failed: summary.failed ?? run.failed ?? 0,
  });
}

function browserCacheTaskSummary(run) {
  return t("task.browserCacheSummary", {
    success: run.success || 0,
    failed: run.failed || 0,
  });
}

function taskSummary(task) {
  if (task.type === "import") return importTaskSummary(task);
  if (task.type === "product-check") return productCheckTaskSummary(task);
  return browserCacheTaskSummary(task);
}

function taskCards() {
  const cards = [];
  if (state.importTask) {
    cards.push({ ...state.importTask, type: "import" });
  }
  if (state.productCheckRun && state.selectedBatchId && state.productCheckRun.batchId === state.selectedBatchId) {
    cards.push({ ...state.productCheckRun, type: "product-check" });
  }
  if (state.autoBrowserCacheRun && state.autoBrowserCacheRun.batchId === state.selectedBatchId) {
    const status =
      state.autoBrowserCacheRun.status === "finished" && state.autoBrowserCacheRun.failed > 0 ? "partial" : state.autoBrowserCacheRun.status;
    cards.push({ ...state.autoBrowserCacheRun, status, type: "browser-cache" });
  }
  return cards;
}

function renderTaskProgress() {
  if (!els.taskProgressStrip) return;
  const cards = taskCards().filter((task) => ["queued", "running", "succeeded", "failed", "finished", "partial", "stale"].includes(task.status));
  if (cards.length === 0) {
    els.taskProgressStrip.innerHTML = "";
    els.taskProgressStrip.hidden = true;
    return;
  }
  els.taskProgressStrip.hidden = false;
  els.taskProgressStrip.innerHTML = cards
    .map((task) => {
      const status = normalizeTaskStatus(task.status);
      const done = taskDone(task);
      const total = taskTotal(task);
      const message = task.type === "import" ? importTaskMessage(task) : task.error || task.message || task.latestMessage || taskSummary(task);
      return `
        <article class="task-card ${escapeHtml(status)}">
          <div class="task-card-head">
            <strong>${escapeHtml(taskLabel(task))}</strong>
            <span>${escapeHtml(t(`task.${status}`))}</span>
          </div>
          <div class="task-card-progress" aria-label="${escapeHtml(t("task.progress", { done, total }))}">
            <span style="width:${taskPercent(task)}%"></span>
          </div>
          <div class="task-card-meta">
            <span>${escapeHtml(t("task.progress", { done, total }))}</span>
            <span>${escapeHtml(taskSummary(task))}</span>
          </div>
          <p>${escapeHtml(message)}</p>
        </article>
      `;
    })
    .join("");
}

function scheduleTaskProgressRender() {
  if (state.taskProgressRenderTimer) return;
  state.taskProgressRenderTimer = setTimeout(() => {
    state.taskProgressRenderTimer = null;
    renderTaskProgress();
  }, 150);
}

function renderFilters() {
  const models = [...new Set(state.items.map((item) => item.model))].sort();
  if (state.filters.model !== "all" && !models.includes(state.filters.model)) {
    state.filters.model = "all";
  }
  els.modelFilter.innerHTML = [
    `<option value="all">${escapeHtml(t("filters.allModels"))}</option>`,
    ...models.map((model) => `<option value="${escapeHtml(model)}">${escapeHtml(model)}</option>`),
  ].join("");
  els.modelFilter.value = state.filters.model;
}

function renderItemList() {
  const visible = filteredItems();
  els.visibleCount.textContent = t("queue.visible", { count: visible.length });

  if (!visible.length) {
    els.itemList.innerHTML = `<div class="empty-list">${escapeHtml(t("queue.noMatching"))}</div>`;
    return;
  }

  els.itemList.innerHTML = visible
    .map((item) => {
      const reviewed = isReviewed(item);
      const score = reviewed ? Number(item.overall_score).toFixed(2) : "--";
      return `
        <button class="item-row ${item.id === state.selectedItemId ? "active" : ""}" data-id="${escapeHtml(item.id)}" type="button">
          <div class="row-title">
            <span class="model-pill">${escapeHtml(item.model)}</span>
            <span class="status-pill ${reviewed ? "reviewed" : "unreviewed"}">${reviewed ? score : t("review.open")}</span>
          </div>
          <div class="row-prompt">${escapeHtml(item.text)}</div>
          <div class="row-title">
            <span>${escapeHtml(item.raw_json_file)} #${item.raw_index + 1}</span>
            <span>${escapeHtml(translatedFetchStatus(item.source_fetch_status))}/${escapeHtml(translatedFetchStatus(item.result_fetch_status))}</span>
          </div>
        </button>
      `;
    })
    .join("");

  for (const button of els.itemList.querySelectorAll(".item-row")) {
    button.addEventListener("click", () => {
      state.selectedItemId = button.dataset.id;
      render();
    });
  }
}

function imageHtml(item, kind) {
  const isSource = kind === "source";
  const path = isSource ? item.source_image_url : item.result_image_url;
  const status = isSource ? item.source_fetch_status : item.result_fetch_status;
  const error = isSource ? item.source_fetch_error : item.result_fetch_error;
  const loadError = state.imageLoadFailures[imageKey(item.id, kind)];
  if (path && status === "success" && !loadError) {
    return `
      <img
        src="${escapeHtml(path)}"
        alt="${escapeHtml(isSource ? t("image.sourceAlt") : t("image.resultAlt"))}"
        data-full="${escapeHtml(path)}"
        data-item-id="${escapeHtml(item.id)}"
        data-image-kind="${kind}"
      />
    `;
  }
  return imageMissingHtml(item, kind, {
    status: translatedFetchStatus(loadError ? "failed" : status),
    error: loadError || error || t("image.notCached"),
  });
}

function imageMissingHtml(item, kind, details = {}) {
  const isSource = kind === "source";
  const remote = isSource ? item.url : item.result_url;
  const key = imageKey(item.id, kind);
  const retrying = state.retryingImages.has(key);
  const browserCaching = state.browserCachingImages.has(key);
  return `
    <div class="image-missing">
      <strong>${escapeHtml(details.status || translatedFetchStatus("missing"))}</strong>
      <p>${escapeHtml(details.error || t("image.notCached"))}</p>
      <div class="image-missing-actions">
        <a href="${escapeHtml(remote)}" target="_blank" rel="noreferrer">${escapeHtml(t("actions.openRemoteUrl"))}</a>
        <button
          class="retry-image-button secondary"
          type="button"
          data-item-id="${escapeHtml(item.id)}"
          data-retry-image-kind="${kind}"
          ${retrying ? "disabled" : ""}
        >${retrying ? t("actions.retrying") : t("actions.retry")}</button>
        <button
          class="browser-cache-image-button secondary"
          type="button"
          data-item-id="${escapeHtml(item.id)}"
          data-browser-cache-image-kind="${kind}"
          ${browserCaching ? "disabled" : ""}
        >${browserCaching ? t("actions.browserCaching") : t("actions.browserCache")}</button>
      </div>
    </div>
  `;
}

function imageKey(itemId, kind) {
  return `${itemId}:${kind}`;
}

function resetOverlayState() {
  state.compareMode = "side-by-side";
  state.overlayOpacity = 55;
  state.overlayTop = "source";
  state.overlayBlink = false;
}

function renderImageCompare(item) {
  return `
    <div class="compare-shell">
      <div class="compare-tabs">
        <button class="compare-tab ${state.compareMode === "side-by-side" ? "active" : ""}" data-compare-mode="side-by-side" type="button">
          ${escapeHtml(t("compare.sideBySide"))}
        </button>
        <button class="compare-tab ${state.compareMode === "overlay" ? "active" : ""}" data-compare-mode="overlay" type="button">
          ${escapeHtml(t("compare.overlay"))}
        </button>
      </div>
      <div id="imageCompareRegion">
        ${state.compareMode === "overlay" ? renderOverlayImages(item) : renderSideBySideImages(item)}
      </div>
    </div>
  `;
}

function renderSideBySideImages(item) {
  return `
    <div class="image-grid">
      <div class="image-box">
        <h3>${escapeHtml(t("image.source"))}</h3>
        <div class="image-frame">${imageHtml(item, "source")}</div>
      </div>
      <div class="image-box">
        <h3>${escapeHtml(t("image.result"))}</h3>
        <div class="image-frame">${imageHtml(item, "result")}</div>
      </div>
    </div>
  `;
}

function renderOverlayImages(item) {
  const sourcePath = item.source_image_url;
  const resultPath = item.result_image_url;
  const sourceLoadError = state.imageLoadFailures[imageKey(item.id, "source")];
  const resultLoadError = state.imageLoadFailures[imageKey(item.id, "result")];
  const sourceReady = sourcePath && item.source_fetch_status === "success" && !sourceLoadError;
  const resultReady = resultPath && item.result_fetch_status === "success" && !resultLoadError;
  if (!sourceReady || !resultReady) {
    return `
      <div class="overlay-unavailable">
        <strong>${escapeHtml(t("overlay.unavailableTitle"))}</strong>
        <p>${escapeHtml(t("overlay.unavailableBody"))}</p>
      </div>
      ${!sourceReady ? imageMissingHtml(item, "source", { status: translatedFetchStatus(sourceLoadError ? "failed" : item.source_fetch_status), error: sourceLoadError || item.source_fetch_error }) : ""}
      ${!resultReady ? imageMissingHtml(item, "result", { status: translatedFetchStatus(resultLoadError ? "failed" : item.result_fetch_status), error: resultLoadError || item.result_fetch_error }) : ""}
    `;
  }

  const topKind = state.overlayTop;
  const baseKind = topKind === "source" ? "result" : "source";
  const topSrc = topKind === "source" ? sourcePath : resultPath;
  const baseSrc = baseKind === "source" ? sourcePath : resultPath;
  const topAlt = topKind === "source" ? t("overlay.sourceAlt") : t("overlay.resultAlt");
  const baseAlt = baseKind === "source" ? t("overlay.sourceBaseAlt") : t("overlay.resultBaseAlt");
  const opacity = state.overlayOpacity / 100;
  const swapLabel = topKind === "source" ? t("overlay.sourceOverResult") : t("overlay.resultOverSource");

  return `
    <div class="overlay-panel">
      <div class="overlay-tools">
        <label class="overlay-opacity-control">
          <span>${escapeHtml(t("overlay.opacity"))}</span>
          <input id="overlayOpacity" type="range" min="0" max="100" step="1" value="${state.overlayOpacity}" />
          <strong id="overlayOpacityValue">${state.overlayOpacity}%</strong>
        </label>
        <button id="overlaySwapButton" class="secondary" type="button">${swapLabel}</button>
        <button id="overlayBlinkButton" class="secondary ${state.overlayBlink ? "active" : ""}" type="button">
          ${escapeHtml(state.overlayBlink ? t("overlay.blinkOn") : t("overlay.blinkOff"))}
        </button>
      </div>
      <div class="overlay-stage ${state.overlayBlink ? "blinking" : ""}" style="--overlay-opacity:${opacity}">
        <img
          class="overlay-img base"
          src="${escapeHtml(baseSrc)}"
          alt="${escapeHtml(baseAlt)}"
          data-full="${escapeHtml(baseSrc)}"
          data-size-kind="${baseKind}"
          data-item-id="${escapeHtml(item.id)}"
          data-image-kind="${baseKind}"
        />
        <img
          class="overlay-img top"
          src="${escapeHtml(topSrc)}"
          alt="${escapeHtml(topAlt)}"
          data-full="${escapeHtml(topSrc)}"
          data-size-kind="${topKind}"
          data-item-id="${escapeHtml(item.id)}"
          data-image-kind="${topKind}"
          style="opacity:${opacity}"
        />
      </div>
      <div class="overlay-meta" id="overlayMeta">${escapeHtml(overlayMetaText(item))}</div>
    </div>
  `;
}

function overlayMetaText(item) {
  const sizes = state.imageSizes[item.id];
  if (!sizes?.source || !sizes?.result) {
    return t("overlay.sizeUnavailable");
  }
  const source = `${sizes.source.width} x ${sizes.source.height}`;
  const result = `${sizes.result.width} x ${sizes.result.height}`;
  const aligned =
    sizes.source.width === sizes.result.width && sizes.source.height === sizes.result.height
      ? t("overlay.pixelAligned")
      : t("overlay.aspectFitOnly");
  return t("overlay.meta", { source, result, aligned });
}

function loadImageSize(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = src;
  });
}

async function ensureImageSizes(item) {
  if (
    !item.source_image_url ||
    !item.result_image_url ||
    state.imageSizes[item.id] ||
    state.imageLoadFailures[imageKey(item.id, "source")] ||
    state.imageLoadFailures[imageKey(item.id, "result")]
  ) {
    return;
  }
  try {
    const [source, result] = await Promise.all([
      loadImageSize(item.source_image_url),
      loadImageSize(item.result_image_url),
    ]);
    state.imageSizes[item.id] = { source, result };
    const meta = document.querySelector("#overlayMeta");
    if (meta && state.selectedItemId === item.id) {
      meta.textContent = overlayMetaText(item);
    }
  } catch {
    state.imageSizes[item.id] = { source: null, result: null };
  }
}

function selectedItem() {
  return state.items.find((candidate) => candidate.id === state.selectedItemId);
}

function selectedProductCheckItem(itemId) {
  const items = state.productCheck?.items || [];
  return items.find((candidate) => candidate.itemId === itemId);
}

function formatMetric(value) {
  if (value === null || value === undefined || value === "") return "--";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return String(value);
}

function productCheckImageHtml(productCheck, key, labelKey) {
  const src = productCheck?.overlays?.[key];
  if (!src) return "";
  return `
    <button class="product-check-image" type="button" data-product-check-full="${escapeHtml(src)}" aria-label="${escapeHtml(t(labelKey))}">
      <img src="${escapeHtml(src)}" alt="${escapeHtml(t(labelKey))}" />
      <span>${escapeHtml(t(labelKey))}</span>
    </button>
  `;
}

function renderProductCheck(item) {
  if (!state.productCheck) {
    return `
      <section class="product-check-panel">
        <h3>${escapeHtml(t("productCheck.title"))}</h3>
        <p class="muted">${escapeHtml(t("productCheck.none"))}</p>
      </section>
    `;
  }

  const productCheck = selectedProductCheckItem(item.id);
  if (!productCheck) {
    return `
      <section class="product-check-panel">
        <h3>${escapeHtml(t("productCheck.title"))}</h3>
        <p class="muted">${escapeHtml(t("productCheck.noItem"))}</p>
      </section>
    `;
  }

  const metrics = productCheck.metrics || {};
  const bestOffset = metrics.bestOffset || {};
  const tags = productCheck.tags || [];
  const score = productCheck.suggestedScore ?? "N/A";
  const unsupported = productCheck.unsupportedReason || "supported";

  return `
    <section class="product-check-panel">
      <div class="product-check-head">
        <h3>${escapeHtml(t("productCheck.title"))}</h3>
        <div class="product-check-score">${escapeHtml(score)}</div>
      </div>
      <div class="product-check-summary">
        <span>${escapeHtml(t("productCheck.status"))}: ${escapeHtml(productCheck.status)}</span>
        <span>${escapeHtml(t("productCheck.confidence"))}: ${escapeHtml(productCheck.confidence)}</span>
        <span>${escapeHtml(t("productCheck.unsupported"))}: ${escapeHtml(unsupported)}</span>
      </div>
      <div class="product-check-tags">
        ${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("") || "<span>no-tags</span>"}
      </div>
      <div class="product-check-metrics">
        <div><span>${escapeHtml(t("productCheck.meanDiff"))}</span><strong>${escapeHtml(formatMetric(metrics.meanAbsDiff))}</strong></div>
        <div><span>${escapeHtml(t("productCheck.p90Diff"))}</span><strong>${escapeHtml(formatMetric(metrics.p90AbsDiff))}</strong></div>
        <div><span>${escapeHtml(t("productCheck.ssim"))}</span><strong>${escapeHtml(formatMetric(metrics.ssim))}</strong></div>
        <div><span>${escapeHtml(t("productCheck.ncc"))}</span><strong>${escapeHtml(formatMetric(metrics.ncc))}</strong></div>
        <div><span>${escapeHtml(t("productCheck.offset"))}</span><strong>${escapeHtml(formatMetric(bestOffset.dx))}, ${escapeHtml(formatMetric(bestOffset.dy))}</strong></div>
      </div>
      <div class="product-check-images">
        ${productCheckImageHtml(productCheck, "sourceMask", "productCheck.sourceMask")}
        ${productCheckImageHtml(productCheck, "resultMatch", "productCheck.resultMatch")}
        ${productCheckImageHtml(productCheck, "diffHeatmap", "productCheck.diffHeatmap")}
      </div>
    </section>
  `;
}

function captureReviewDraft(itemId) {
  const formEl = document.querySelector("#evaluationForm");
  if (!formEl || !itemId) return;
  state.reviewDrafts[itemId] = {
    ...readScoreForm(formEl),
    status: formEl.elements.status.value,
    comment: formEl.elements.comment.value,
    tags: [...formEl.querySelectorAll(".tag-button.selected")].map((button) => button.dataset.tag),
  };
}

function draftForItem(item) {
  return state.reviewDrafts[item.id];
}

function scoreFormForItem(item) {
  const draft = draftForItem(item);
  return Object.fromEntries(
    scoreFields.map(({ field }) => [field, draft?.[field] !== undefined ? Number(draft[field]) : scoreValue(item, field)])
  );
}

function renderReviewPane() {
  const item = selectedItem();
  if (!item) {
    els.reviewPane.innerHTML = `
      <div class="empty-state">
        <div>
          <h2>${escapeHtml(t("review.noItemTitle"))}</h2>
          <p>${escapeHtml(t("review.noItemBody"))}</p>
        </div>
      </div>
    `;
    return;
  }

  const draft = draftForItem(item);
  const form = scoreFormForItem(item);
  const overall = item.overall_score ? Number(item.overall_score).toFixed(2) : calculateOverall(form);
  const selectedTags = Array.isArray(draft?.tags) ? draft.tags : Array.isArray(item.tags) ? item.tags : [];
  const selectedStatus = draft?.status || item.status;
  const comment = draft?.comment ?? item.comment ?? "";

  els.reviewPane.innerHTML = `
    <div class="review-layout">
      <section class="review-main">
        <div class="review-head">
          <div>
            <h2>${escapeHtml(item.model)}</h2>
            <p>${escapeHtml(t("review.itemMeta", { file: item.raw_json_file, index: item.raw_index + 1, id: item.id }))}</p>
          </div>
        </div>

        ${renderImageCompare(item)}

        ${renderProductCheck(item)}

        <div class="prompt-grid">
          <div class="prompt-box">
            <h3>${escapeHtml(t("review.originalPrompt"))}</h3>
            <pre>${escapeHtml(item.text)}</pre>
          </div>
          <div class="prompt-box">
            <h3>${escapeHtml(t("review.optimizedPrompt"))}</h3>
            <pre>${escapeHtml(item.optimization_prompt)}</pre>
          </div>
        </div>
      </section>

      <form id="evaluationForm" class="evaluation-sidebar">
        <div class="evaluation-sticky">
          <div class="evaluation-summary">
            <div>
              <span>${escapeHtml(t("review.evaluation"))}</span>
              <strong>${item.evaluation_updated_at ? t("review.reviewed") : t("review.open")}</strong>
            </div>
            <div class="score-badge">
              <span>${escapeHtml(t("review.overall"))}</span>
              <strong id="overallScore">${overall}</strong>
            </div>
          </div>

          <div class="score-grid">
            <div class="score-box">
              <h3>${escapeHtml(t("review.coreScores"))}</h3>
              ${scoreFields
                .slice(0, 3)
                .map((field) => scoreRow(field, form[field.field]))
                .join("")}
            </div>
            <div class="score-box">
              <h3>${escapeHtml(t("review.qualityScores"))}</h3>
              ${scoreFields
                .slice(3)
                .map((field) => scoreRow(field, form[field.field]))
                .join("")}
            </div>
          </div>

          <div class="review-controls">
            <div class="comment-box">
              <h3>${escapeHtml(t("review.status"))}</h3>
              <div class="tag-grid">
                <select id="statusSelect" name="status">
                  ${statusOptions
                    .map(
                      (status) =>
                        `<option value="${status}" ${selectedStatus === status ? "selected" : ""}>${translatedStatus(status)}</option>`
                    )
                    .join("")}
                </select>
              </div>
            </div>
            <div class="comment-box">
              <h3>${escapeHtml(t("review.comment"))}</h3>
              <textarea id="commentInput" name="comment" placeholder="${escapeHtml(t("review.commentPlaceholder"))}">${escapeHtml(comment)}</textarea>
            </div>
          </div>

          <div class="comment-box tag-box">
            <h3>${escapeHtml(t("review.tags"))}</h3>
            <div class="tag-grid">
              ${tagOptions
                .map(
                  (tag) => `
                    <button class="tag-button ${selectedTags.includes(tag) ? "selected" : ""}" data-tag="${tag}" type="button">
                      ${tag}
                    </button>
                  `
                )
                .join("")}
            </div>
          </div>

          <div class="save-row">
            <span class="save-note" id="saveNote">${item.evaluation_updated_at ? escapeHtml(t("review.savedAt", { time: new Date(item.evaluation_updated_at).toLocaleString() })) : escapeHtml(t("review.notReviewed"))}</span>
            <button id="saveButton" type="submit">${escapeHtml(t("actions.saveReview"))}</button>
          </div>
        </div>
      </form>
    </div>
  `;

  const formEl = document.querySelector("#evaluationForm");
  const currentTags = new Set(selectedTags);

  ensureImageSizes(item);

  for (const button of els.reviewPane.querySelectorAll("[data-compare-mode]")) {
    button.addEventListener("click", () => {
      state.compareMode = button.dataset.compareMode;
      render();
    });
  }

  const opacityInput = document.querySelector("#overlayOpacity");
  if (opacityInput) {
    opacityInput.addEventListener("input", () => {
      state.overlayOpacity = Number(opacityInput.value);
      const opacity = state.overlayOpacity / 100;
      const top = document.querySelector(".overlay-img.top");
      const stage = document.querySelector(".overlay-stage");
      const value = document.querySelector("#overlayOpacityValue");
      if (top) top.style.opacity = String(opacity);
      if (stage) stage.style.setProperty("--overlay-opacity", String(opacity));
      if (value) value.textContent = `${state.overlayOpacity}%`;
    });
  }

  const swapButton = document.querySelector("#overlaySwapButton");
  if (swapButton) {
    swapButton.addEventListener("click", () => {
      state.overlayTop = state.overlayTop === "source" ? "result" : "source";
      render();
    });
  }

  const blinkButton = document.querySelector("#overlayBlinkButton");
  if (blinkButton) {
    blinkButton.addEventListener("click", () => {
      state.overlayBlink = !state.overlayBlink;
      render();
    });
  }

  for (const img of els.reviewPane.querySelectorAll("img[data-full]")) {
    img.addEventListener("click", () => openImage(img.dataset.full, img.alt));
    img.addEventListener("error", () => {
      const itemId = img.dataset.itemId;
      const kind = img.dataset.imageKind;
      if (!itemId || !kind) return;
      captureReviewDraft(itemId);
      state.imageLoadFailures[imageKey(itemId, kind)] = t("image.localLoadFailed");
      render();
    });
  }

  for (const button of els.reviewPane.querySelectorAll("[data-product-check-full]")) {
    button.addEventListener("click", () => openImage(button.dataset.productCheckFull, button.textContent.trim()));
  }

  for (const button of els.reviewPane.querySelectorAll("[data-retry-image-kind]")) {
    button.addEventListener("click", () => {
      const itemId = button.dataset.itemId;
      const kind = button.dataset.retryImageKind;
      if (!itemId || !kind) return;
      retryImage(itemId, kind).catch((error) => {
        state.imageLoadFailures[imageKey(itemId, kind)] = error.message;
        render();
      });
    });
  }

  for (const button of els.reviewPane.querySelectorAll("[data-browser-cache-image-kind]")) {
    button.addEventListener("click", () => {
      const itemId = button.dataset.itemId;
      const kind = button.dataset.browserCacheImageKind;
      if (!itemId || !kind) return;
      cacheImageFromBrowser(itemId, kind).catch((error) => {
        state.imageLoadFailures[imageKey(itemId, kind)] = error.message;
        render();
      });
    });
  }

  for (const input of formEl.querySelectorAll('input[type="range"]')) {
    input.addEventListener("input", () => {
      const output = formEl.querySelector(`[data-score-value="${input.name}"]`);
      output.textContent = input.value;
      document.querySelector("#overallScore").textContent = calculateOverall(readScoreForm(formEl));
    });
  }

  for (const button of formEl.querySelectorAll(".tag-button")) {
    button.addEventListener("click", () => {
      if (currentTags.has(button.dataset.tag)) {
        currentTags.delete(button.dataset.tag);
        button.classList.remove("selected");
      } else {
        currentTags.add(button.dataset.tag);
        button.classList.add("selected");
      }
    });
  }

  formEl.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveEvaluation(item.id, formEl, [...currentTags]);
  });
}

function scoreRow(scoreField, value) {
  return `
    <div class="score-row">
      <label for="${scoreField.field}">
        ${escapeHtml(scoreLabel(scoreField))}
        <small>${escapeHtml(t("score.weight", { weight: scoreField.weightLabel, help: scoreHelp(scoreField) }))}</small>
      </label>
      <input id="${scoreField.field}" name="${scoreField.field}" type="range" min="1" max="5" step="1" value="${value}" />
      <span class="score-value" data-score-value="${scoreField.field}">${value}</span>
    </div>
  `;
}

function renderStats() {
  const byModel = state.stats?.by_model || [];
  if (!byModel.length) {
    els.modelStats.innerHTML = `<p class="muted">${escapeHtml(t("stats.noReviewedModels"))}</p>`;
  } else {
    els.modelStats.innerHTML = byModel
      .map((row) => {
        const score = Number(row.avg_overall_score || 0);
        const percent = Math.max(0, Math.min(100, (score / 5) * 100));
        return `
          <div class="model-stat">
            <header>
              <span>${escapeHtml(row.model)}</span>
              <strong>${row.avg_overall_score ?? "--"}</strong>
            </header>
            <div class="bar"><span style="width:${percent}%"></span></div>
            <small>${escapeHtml(t("stats.reviewedCount", { reviewed: row.reviewed_items || 0, total: row.total_items || 0 }))}</small>
            <small>
              ${scoreFields
                .map(({ shortLabel, field }) => {
                  const statKey = `avg_${field}`;
                  return `${shortLabel} ${row[statKey] ?? "--"}`;
                })
                .join(" | ")}
            </small>
          </div>
        `;
      })
      .join("");
  }

  const tagCounts = state.stats?.tag_counts || [];
  if (!tagCounts.length) {
    els.tagStats.innerHTML = `<p class="muted">${escapeHtml(t("stats.noTags"))}</p>`;
  } else {
    els.tagStats.innerHTML = tagCounts
      .map(
        (row) => `
          <div class="tag-stat">
            <span>${escapeHtml(row.tag)}</span>
            <strong>${row.count}</strong>
          </div>
        `
      )
      .join("");
  }
}

function readScoreForm(formEl) {
  return Object.fromEntries(scoreFields.map(({ field }) => [field, formEl.elements[field].value]));
}

async function saveEvaluation(itemId, formEl, tags) {
  const payload = {
    ...readScoreForm(formEl),
    status: formEl.elements.status.value,
    comment: formEl.elements.comment.value,
    tags,
  };
  const saveNote = document.querySelector("#saveNote");
  saveNote.textContent = t("review.saving");
  await api(`/api/items/${itemId}/evaluation`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  saveNote.textContent = t("review.saved");
  delete state.reviewDrafts[itemId];
  await loadBatch(state.selectedBatchId, itemId);
}

async function retryImage(itemId, kind) {
  captureReviewDraft(itemId);
  const key = imageKey(itemId, kind);
  state.retryingImages.add(key);
  render();
  try {
    const body = await api(`/api/items/${itemId}/images/${kind}/retry`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    if (body.retry?.fetchStatus === "success") {
      delete state.imageLoadFailures[key];
      delete state.imageSizes[itemId];
    } else {
      state.imageLoadFailures[key] = body.retry?.fetchError || t("image.retryFailed");
    }
    await loadBatch(state.selectedBatchId, itemId);
  } finally {
    state.retryingImages.delete(key);
    render();
  }
}

function remoteImageUrl(item, kind) {
  return kind === "source" ? item.url : item.result_url;
}

function needsBrowserCache(item, kind) {
  const status = kind === "source" ? item.source_fetch_status : item.result_fetch_status;
  const path = kind === "source" ? item.source_image_url : item.result_image_url;
  return status === "failed" && !path;
}

function browserCacheCandidates(batchId) {
  const candidates = [];
  for (const item of state.items) {
    for (const kind of ["source", "result"]) {
      const key = imageKey(item.id, kind);
      if (!needsBrowserCache(item, kind)) continue;
      if (state.autoBrowserCacheAttempted.has(key)) continue;
      if (state.browserCachingImages.has(key)) continue;
      candidates.push({ batchId, item, kind, key });
    }
  }
  return candidates;
}

async function runBrowserCacheWorker(queue, run) {
  while (queue.length > 0 && run === state.autoBrowserCacheRun && run.status === "running") {
    const candidate = queue.shift();
    state.autoBrowserCacheAttempted.add(candidate.key);
    state.browserCachingImages.add(candidate.key);
    scheduleTaskProgressRender();
    try {
      await browserCacheImageRequest(candidate.item, candidate.kind);
      delete state.imageLoadFailures[candidate.key];
      delete state.imageSizes[candidate.item.id];
      run.success += 1;
    } catch (error) {
      run.failed += 1;
      state.imageLoadFailures[candidate.key] = error instanceof Error ? error.message : String(error);
    } finally {
      run.done += 1;
      state.browserCachingImages.delete(candidate.key);
      scheduleTaskProgressRender();
    }
  }
}

async function startAutoBrowserCache(batchId) {
  if (!batchId || state.autoBrowserCacheRun?.status === "running") return;
  const queue = browserCacheCandidates(batchId);
  if (queue.length === 0) return;

  const run = {
    batchId,
    status: "running",
    total: queue.length,
    done: 0,
    success: 0,
    failed: 0,
  };
  state.autoBrowserCacheRun = run;
  renderTaskProgress();

  const concurrency = Math.min(2, queue.length);
  await Promise.all(Array.from({ length: concurrency }, () => runBrowserCacheWorker(queue, run)));
  if (run !== state.autoBrowserCacheRun) return;
  run.status = "finished";
  renderTaskProgress();
  if (run.success > 0 && state.selectedBatchId === batchId) {
    await recomputeCacheCounts(batchId);
    await loadBatch(batchId, state.selectedItemId, { skipAutoBrowserCache: true });
  }
}

function cancelAutoBrowserCache(batchId) {
  const run = state.autoBrowserCacheRun;
  if (!run || run.status !== "running" || run.batchId === batchId) return;
  run.status = "cancelled";
  state.autoBrowserCacheRun = null;
}

async function browserCacheImageRequest(item, kind) {
  let imageResponse;
  try {
    imageResponse = await fetch(remoteImageUrl(item, kind), {
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
    });
  } catch {
    throw new Error(t("image.browserCacheCors"));
  }

  if (!imageResponse.ok) {
    throw new Error(t("image.browserCacheHttp", { status: imageResponse.status }));
  }

  const blob = await imageResponse.blob();
  const uploadResponse = await fetch(`/api/items/${encodeURIComponent(item.id)}/images/${kind}/browser-cache`, {
    method: "POST",
    headers: {
      "content-type": blob.type || imageResponse.headers.get("content-type") || "application/octet-stream",
    },
    body: blob,
  });
  const body = await uploadResponse.json().catch(() => ({}));
  if (!uploadResponse.ok) {
    throw new Error(body.error || t("image.browserCacheFailed"));
  }
  if (body.retry?.fetchStatus !== "success") {
    throw new Error(body.retry?.fetchError || t("image.browserCacheFailed"));
  }
  return body.retry;
}

async function recomputeCacheCounts(batchId) {
  if (!batchId) return null;
  return api(`/api/batches/${encodeURIComponent(batchId)}/cache-counts/recompute`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

async function cacheImageFromBrowser(itemId, kind) {
  const item = state.items.find((candidate) => candidate.id === itemId);
  if (!item) throw new Error("Item not found");

  captureReviewDraft(itemId);
  const key = imageKey(itemId, kind);
  state.browserCachingImages.add(key);
  render();
  try {
    await browserCacheImageRequest(item, kind);
    await recomputeCacheCounts(state.selectedBatchId);
    delete state.imageLoadFailures[key];
    delete state.imageSizes[itemId];
    await loadBatch(state.selectedBatchId, itemId, { skipAutoBrowserCache: true });
  } finally {
    state.browserCachingImages.delete(key);
    render();
  }
}

async function loadBatches() {
  const body = await api("/api/batches");
  state.batches = body.batches;
  if (!state.selectedBatchId && state.batches.length) {
    state.selectedBatchId = state.batches[0].id;
  }
  renderBatchSelect();
}

async function loadResources() {
  const body = await api("/api/resources");
  state.resources = body.resources;
  renderResourceSelect();
}

async function loadProductCheckRun(batchId) {
  if (!batchId) {
    state.productCheckRun = null;
    return;
  }
  const body = await api(`/api/batches/${batchId}/product-check/runs/latest`);
  state.productCheckRun = body.run;
}

function startProductCheckPolling() {
  if (state.productCheckPolling) {
    clearInterval(state.productCheckPolling);
    state.productCheckPolling = null;
  }
  if (state.productCheckRun?.status !== "running" || !state.selectedBatchId) return;
  state.productCheckPolling = setInterval(async () => {
    try {
      await loadProductCheckRun(state.selectedBatchId);
      if (state.productCheckRun?.status !== "running") {
        clearInterval(state.productCheckPolling);
        state.productCheckPolling = null;
        const productCheckBody = await api(`/api/batches/${state.selectedBatchId}/product-check`);
        state.productCheck = productCheckBody.productCheck;
      }
      render();
    } catch (error) {
      console.error(error);
    }
  }, 2000);
}

function stopImportTaskPolling() {
  if (state.importTaskPolling) {
    clearInterval(state.importTaskPolling);
    state.importTaskPolling = null;
  }
}

async function loadImportTask(taskId) {
  const body = await api(`/api/tasks/${encodeURIComponent(taskId)}`);
  state.importTask = body.task;
  return body.task;
}

function startImportTaskPolling(taskId) {
  stopImportTaskPolling();
  state.importTaskPolling = setInterval(async () => {
    try {
      const task = await loadImportTask(taskId);
      if (task.status !== "queued" && task.status !== "running") {
        stopImportTaskPolling();
        els.importButton.disabled = false;
        els.importButton.textContent = t("actions.importResource");
        if (task.status === "succeeded" && task.batchId) {
          state.selectedBatchId = task.batchId;
          await loadBatch(task.batchId);
        } else {
          render();
        }
        return;
      }
      render();
    } catch (error) {
      stopImportTaskPolling();
      state.importTask = {
        ...(state.importTask || { type: "import", done: 0, total: 0, summary: {} }),
        status: "failed",
        error: error.message,
      };
      els.importButton.disabled = false;
      els.importButton.textContent = t("actions.importResource");
      render();
    }
  }, 1000);
}

async function loadBatch(batchId, keepSelectedItemId = "", options = {}) {
  if (!batchId) {
    cancelAutoBrowserCache("");
    state.items = [];
    state.stats = null;
    state.productCheck = null;
    state.productCheckRun = null;
    render();
    return;
  }
  cancelAutoBrowserCache(batchId);
  state.selectedBatchId = batchId;
  if (options.resetFilters) {
    state.filters = {
      model: "all",
      status: "all",
      search: "",
    };
    els.searchInput.value = "";
    els.statusFilter.value = "all";
  }
  const previousSelectedItemId = state.selectedItemId;
  const [itemsBody, statsBody, productCheckBody, productCheckRunBody] = await Promise.all([
    api(`/api/batches/${batchId}/items`),
    api(`/api/batches/${batchId}/stats`),
    api(`/api/batches/${batchId}/product-check`),
    api(`/api/batches/${batchId}/product-check/runs/latest`),
  ]);
  state.items = itemsBody.items;
  state.stats = statsBody.stats;
  state.productCheck = productCheckBody.productCheck;
  state.productCheckRun = productCheckRunBody.run;
  const visible = filteredItems();
  state.selectedItemId =
    keepSelectedItemId && state.items.some((item) => item.id === keepSelectedItemId)
      ? keepSelectedItemId
      : visible[0]?.id || state.items[0]?.id || "";
  if (state.selectedItemId !== previousSelectedItemId) {
    resetOverlayState();
  }
  await loadBatches();
  startProductCheckPolling();
  render();
  if (!options.skipAutoBrowserCache) {
    startAutoBrowserCache(batchId).catch((error) => console.error(error));
  }
}

function render() {
  applyStaticTranslations();
  renderBatchSelect();
  renderResourceSelect();
  renderMetrics();
  renderTaskProgress();
  renderFilters();
  renderItemList();
  renderReviewPane();
  renderStats();
}

async function importBatch() {
  if (!state.selectedResourceFile) {
    alert("Select a resource JSON file first.");
    return;
  }
  els.importButton.disabled = true;
  els.importButton.textContent = t("actions.importing");
  try {
    const body = await api("/api/import", {
      method: "POST",
      body: JSON.stringify({ file: state.selectedResourceFile, downloadImages: true }),
    });
    state.importTask = body.task;
    render();
    startImportTaskPolling(body.task.id);
  } catch (error) {
    els.importButton.disabled = false;
    els.importButton.textContent = t("actions.importResource");
    throw error;
  }
}

async function runProductCheck() {
  if (!state.selectedBatchId) return;
  els.runProductCheckButton.disabled = true;
  els.runProductCheckButton.textContent = t("actions.runningProductCheck");
  try {
    const body = await api(`/api/batches/${state.selectedBatchId}/product-check/runs`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    state.productCheckRun = body.run;
    startProductCheckPolling();
    render();
  } catch (error) {
    alert(error.message);
  } finally {
    renderMetrics();
  }
}

function jumpToNextUnreviewed() {
  const visible = filteredItems();
  const currentIndex = visible.findIndex((item) => item.id === state.selectedItemId);
  const next = visible
    .slice(Math.max(currentIndex + 1, 0))
    .concat(visible.slice(0, Math.max(currentIndex + 1, 0)))
    .find((item) => !isReviewed(item));
  if (next) {
    state.selectedItemId = next.id;
    render();
  }
}

function openImage(src, alt) {
  els.dialogImage.src = src;
  els.dialogImage.alt = alt || "";
  els.imageDialog.showModal();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

els.batchSelect.addEventListener("change", () => {
  loadBatch(els.batchSelect.value, "", { resetFilters: true }).catch(showFatalError);
});

els.languageSelect.addEventListener("change", () => {
  captureReviewDraft(state.selectedItemId);
  state.language = els.languageSelect.value;
  localStorage.setItem("skill-eval-language", state.language);
  render();
});

els.resourceSelect.addEventListener("change", () => {
  state.selectedResourceFile = els.resourceSelect.value;
});

els.importButton.addEventListener("click", () => {
  importBatch().catch((error) => {
    alert(error.message);
  });
});

els.runProductCheckButton.addEventListener("click", () => {
  runProductCheck().catch((error) => {
    alert(error.message);
  });
});

els.modelFilter.addEventListener("change", () => {
  state.filters.model = els.modelFilter.value;
  state.selectedItemId = filteredItems()[0]?.id || "";
  render();
});

els.statusFilter.addEventListener("change", () => {
  state.filters.status = els.statusFilter.value;
  state.selectedItemId = filteredItems()[0]?.id || "";
  render();
});

els.searchInput.addEventListener("input", () => {
  state.filters.search = els.searchInput.value;
  state.selectedItemId = filteredItems()[0]?.id || "";
  render();
});

els.nextUnreviewedButton.addEventListener("click", jumpToNextUnreviewed);
els.closeDialogButton.addEventListener("click", () => els.imageDialog.close());

function showFatalError(error) {
  els.reviewPane.innerHTML = `
    <div class="empty-state">
      <div>
        <h2>${escapeHtml(t("error.unableTitle"))}</h2>
        <p>${escapeHtml(error.message)}</p>
      </div>
    </div>
  `;
}

await loadResources().catch(showFatalError);
await loadBatches();
if (state.selectedBatchId) {
  await loadBatch(state.selectedBatchId).catch(showFatalError);
} else {
  render();
}
