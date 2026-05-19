import { calculateOverallScore, scoreFields, statusOptions, tagOptions } from "./scoring.js";
import {
  ITEM_OVERSCAN,
  ITEM_ROW_HEIGHT,
  normalizeTaskCard,
  readReviewUrlState,
  reviewUrlParamsFromState,
  targetScrollTopForIndex,
  taskProgressPercent,
  virtualWindow,
} from "./review-utils.js";

const excludeReasons = ["bad_input", "duplicate", "wrong_task", "missing_image", "not_evaluable", "other"];

const translations = {
  en: {
    "app.title": "Skill Eval Review",
    "app.language": "Language",
    "app.batch": "Batch",
    "actions.importResource": "Import Resource",
    "actions.importUpload": "Import Upload",
    "actions.importing": "Importing...",
    "actions.chooseJson": "Choose JSON",
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
    "actions.exclude": "Exclude",
    "actions.restore": "Restore",
    "actions.cancel": "Cancel",
    "actions.scrollCurrent": "Current",
    "batch.archive": "Archive",
    "batch.restore": "Restore",
    "batch.delete": "Delete",
    "batch.showArchived": "Archived",
    "batch.archived": "Archived",
    "batch.archiveConfirm": "Archive this batch?",
    "batch.restoreConfirm": "Restore this batch?",
    "batch.deleteConfirm": "Type the full batch id to delete local records and artifacts:",
    "batch.deleteMismatch": "Batch id did not match. Delete cancelled.",
    "batch.deletePlan": "Delete plan",
    "batch.deletePlanSummary": "{items} items | {evaluations} evaluations | {bytes} local bytes",
    "preflight.title": "Import Preflight",
    "preflight.running": "Checking JSON...",
    "preflight.ready": "{valid}/{total} valid | {invalid} invalid | {models} model(s)",
    "preflight.digest": "digest {digest}",
    "preflight.duplicates": "{count} duplicate record(s)",
    "preflight.errors": "{count} error(s), showing first {shown}",
    "preflight.failed": "Preflight failed",
    "preflight.required": "Run preflight before import.",
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
    "metrics.excluded": "Excluded",
    "filters.aria": "Review filters",
    "filters.model": "Model",
    "filters.status": "Status",
    "filters.all": "All",
    "filters.active": "All active",
    "filters.unreviewed": "Unreviewed",
    "filters.reviewed": "Reviewed",
    "filters.excluded": "Excluded",
    "filters.allIncludingExcluded": "All incl. excluded",
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
    "review.excluded": "Excluded",
    "review.excludeReason": "Reason",
    "review.excludeNote": "Note",
    "review.excludeNotePlaceholder": "Optional note",
    "review.excludeConfirm": "Exclude item",
    "review.excludeDescription": "Excluded items remain visible but do not count toward review statistics.",
    "review.excludeState": "This item is excluded from statistics and review progress.",
    "review.excludeSaved": "Exclusion updated",
    "review.reason.bad_input": "Bad input",
    "review.reason.duplicate": "Duplicate",
    "review.reason.wrong_task": "Wrong task",
    "review.reason.missing_image": "Missing image",
    "review.reason.not_evaluable": "Not evaluable",
    "review.reason.other": "Other",
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
    "productCheck.version": "Version",
    "productCheck.profile": "Profile",
    "productCheck.legacy": "legacy result",
    "resources.none": "No JSON files",
    "upload.none": "No file selected",
    "upload.invalidJson": "Choose a .json file.",
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
    "actions.importUpload": "导入上传",
    "actions.importing": "导入中...",
    "actions.chooseJson": "选择 JSON",
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
    "actions.exclude": "排除",
    "actions.restore": "恢复",
    "actions.cancel": "取消",
    "actions.scrollCurrent": "回到当前",
    "batch.archive": "归档",
    "batch.restore": "恢复",
    "batch.delete": "删除",
    "batch.showArchived": "归档",
    "batch.archived": "已归档",
    "batch.archiveConfirm": "确认归档此批次？",
    "batch.restoreConfirm": "确认恢复此批次？",
    "batch.deleteConfirm": "输入完整 batch id 以删除本地记录和产物：",
    "batch.deleteMismatch": "batch id 不匹配，已取消删除。",
    "batch.deletePlan": "删除计划",
    "batch.deletePlanSummary": "{items} 条 item | {evaluations} 条评审 | {bytes} 本地产物",
    "preflight.title": "导入预检",
    "preflight.running": "正在检查 JSON...",
    "preflight.ready": "{valid}/{total} 条可导入 | {invalid} 条异常 | {models} 个模型",
    "preflight.digest": "摘要 {digest}",
    "preflight.duplicates": "{count} 条重复记录",
    "preflight.errors": "{count} 条错误，显示前 {shown} 条",
    "preflight.failed": "预检失败",
    "preflight.required": "请先完成预检再导入。",
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
    "metrics.excluded": "已排除",
    "filters.aria": "评审筛选",
    "filters.model": "模型",
    "filters.status": "状态",
    "filters.all": "全部",
    "filters.active": "全部未排除",
    "filters.unreviewed": "未评审",
    "filters.reviewed": "已评审",
    "filters.excluded": "已排除",
    "filters.allIncludingExcluded": "包含已排除",
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
    "review.excluded": "已排除",
    "review.excludeReason": "原因",
    "review.excludeNote": "备注",
    "review.excludeNotePlaceholder": "可选备注",
    "review.excludeConfirm": "排除条目",
    "review.excludeDescription": "已排除条目仍可查看，但不参与评审统计。",
    "review.excludeState": "此条目已从统计和评审进度中排除。",
    "review.excludeSaved": "排除状态已更新",
    "review.reason.bad_input": "输入异常",
    "review.reason.duplicate": "重复条目",
    "review.reason.wrong_task": "任务不符",
    "review.reason.missing_image": "图片缺失",
    "review.reason.not_evaluable": "不可评审",
    "review.reason.other": "其他",
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
    "productCheck.version": "版本",
    "productCheck.profile": "Profile",
    "productCheck.legacy": "旧结果",
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
    "upload.none": "未选择文件",
    "upload.invalidJson": "请选择 .json 文件。",
  },
};

const initialUrlState = readReviewUrlState(window.location.search);

function initialLanguage() {
  if (initialUrlState.language && translations[initialUrlState.language]) return initialUrlState.language;
  const saved = localStorage.getItem("skill-eval-language");
  if (saved && translations[saved]) return saved;
  return navigator.language?.toLowerCase().startsWith("zh") ? "zh" : "en";
}

const state = {
  language: initialLanguage(),
  batches: [],
  resources: [],
  selectedResourceFile: "",
  selectedUploadFile: null,
  selectedUploadContent: "",
  showArchivedBatches: initialUrlState.includeArchived,
  preflight: null,
  preflightSource: "",
  preflightError: "",
  preflightPending: false,
  selectedBatchId: initialUrlState.batchId,
  items: [],
  stats: null,
  productCheck: null,
  productCheckRun: null,
  productCheckPolling: null,
  importTask: null,
  importTaskPolling: null,
  taskProgressRenderTimer: null,
  urlSyncTimer: null,
  itemListRenderFrame: null,
  itemListScrollTop: 0,
  selectedItemId: initialUrlState.itemId,
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
    model: initialUrlState.model,
    status: initialUrlState.status,
    search: initialUrlState.search,
  },
};

const els = {
  languageSelect: document.querySelector("#languageSelect"),
  batchMeta: document.querySelector("#batchMeta"),
  taskProgressStrip: document.querySelector("#taskProgressStrip"),
  preflightPanel: document.querySelector("#preflightPanel"),
  batchSelect: document.querySelector("#batchSelect"),
  scrollCurrentItemButton: document.querySelector("#scrollCurrentItemButton"),
  showArchivedBatches: document.querySelector("#showArchivedBatches"),
  archiveBatchButton: document.querySelector("#archiveBatchButton"),
  restoreBatchButton: document.querySelector("#restoreBatchButton"),
  deleteBatchButton: document.querySelector("#deleteBatchButton"),
  resourceSelect: document.querySelector("#resourceSelect"),
  uploadJsonInput: document.querySelector("#uploadJsonInput"),
  uploadJsonMeta: document.querySelector("#uploadJsonMeta"),
  importButton: document.querySelector("#importButton"),
  uploadImportButton: document.querySelector("#uploadImportButton"),
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

function isExcluded(item) {
  return Boolean(item?.is_excluded);
}

function selectedBatch() {
  return state.batches.find((batch) => batch.id === state.selectedBatchId);
}

function syncFilterControls() {
  els.searchInput.value = state.filters.search;
  els.modelFilter.value = state.filters.model;
  els.statusFilter.value = state.filters.status;
}

function writeUrlState({ replace = true } = {}) {
  const params = reviewUrlParamsFromState(state);
  const query = params.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
  if (nextUrl === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
  const method = replace ? "replaceState" : "pushState";
  window.history[method]({}, "", nextUrl);
}

function scheduleUrlStateSync() {
  if (state.urlSyncTimer) {
    clearTimeout(state.urlSyncTimer);
  }
  state.urlSyncTimer = setTimeout(() => {
    state.urlSyncTimer = null;
    writeUrlState({ replace: true });
  }, 200);
}

function filteredItems() {
  const query = state.filters.search.trim().toLowerCase();
  return state.items.filter((item) => {
    const excluded = isExcluded(item);
    if (state.filters.model !== "all" && item.model !== state.filters.model) return false;
    if (state.filters.status === "active" && excluded) return false;
    if (state.filters.status === "excluded" && !excluded) return false;
    if (state.filters.status === "reviewed" && (excluded || !isReviewed(item))) return false;
    if (state.filters.status === "unreviewed" && (excluded || isReviewed(item))) return false;
    if (!query) return true;
    const haystack = [
      item.model,
      item.text,
      item.optimization_prompt,
      item.raw_json_file,
      item.exclude_reason,
      item.exclude_note,
      ...(Array.isArray(item.tags) ? item.tags : []),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });
}

function nextItemIdAfterExclusion(itemId) {
  const visible = filteredItems();
  const currentIndex = visible.findIndex((item) => item.id === itemId);
  const orderedCandidates =
    currentIndex >= 0
      ? visible.slice(currentIndex + 1).concat(visible.slice(0, currentIndex))
      : visible;
  const nextVisibleTask = orderedCandidates.find((item) => item.id !== itemId && !isExcluded(item));
  if (nextVisibleTask) return nextVisibleTask.id;

  return state.items.find((item) => item.id !== itemId && !isExcluded(item))?.id || "";
}

function renderBatchSelect() {
  if (!state.batches.length) {
    els.batchSelect.innerHTML = `<option value="">${escapeHtml(t("empty.noBatches"))}</option>`;
    return;
  }

  els.batchSelect.innerHTML = state.batches
    .map((batch) => {
      const archived = batch.archived_at ? ` [${t("batch.archived")}]` : "";
      const label = `${batch.name}${archived} (${batch.reviewed_count || 0}/${batch.item_count || 0})`;
      return `<option value="${escapeHtml(batch.id)}">${escapeHtml(label)}</option>`;
    })
    .join("");
  els.batchSelect.value = state.selectedBatchId;
  els.showArchivedBatches.checked = state.showArchivedBatches;
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

function formatFileSize(bytes) {
  const value = Number(bytes || 0);
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.ceil(value / 1024)} KB`;
  return `${value} B`;
}

function renderUploadImport() {
  const file = state.selectedUploadFile;
  els.uploadJsonMeta.textContent = file ? `${file.name} · ${formatFileSize(file.size)}` : t("upload.none");
  const busy = Boolean(state.importTask && ["queued", "running"].includes(state.importTask.status));
  const uploadReady = state.preflightSource === "upload" && state.preflight?.validRecords > 0 && !state.preflightError;
  const resourceReady = state.preflightSource === "resource" && state.preflight?.validRecords > 0 && !state.preflightError;
  els.uploadImportButton.disabled = !file || busy || !uploadReady;
  els.importButton.disabled = !state.selectedResourceFile || busy || !resourceReady;
}

function renderPreflight() {
  if (!els.preflightPanel) return;
  if (state.preflightPending) {
    els.preflightPanel.hidden = false;
    els.preflightPanel.className = "preflight-panel";
    els.preflightPanel.innerHTML = `<div class="preflight-head"><strong>${escapeHtml(t("preflight.title"))}</strong><span>${escapeHtml(t("preflight.running"))}</span></div>`;
    return;
  }
  if (state.preflightError) {
    els.preflightPanel.hidden = false;
    els.preflightPanel.className = "preflight-panel failed";
    els.preflightPanel.innerHTML = `<div class="preflight-head"><strong>${escapeHtml(t("preflight.failed"))}</strong><span>${escapeHtml(state.preflightError)}</span></div>`;
    return;
  }
  const preflight = state.preflight;
  if (!preflight) {
    els.preflightPanel.innerHTML = "";
    els.preflightPanel.hidden = true;
    return;
  }
  const modelCount = Object.keys(preflight.modelCounts || {}).length;
  const shortDigest = String(preflight.sourceDigest || "").slice(0, 19);
  const errors = preflight.errors || [];
  const shownErrors = errors.slice(0, 20);
  els.preflightPanel.hidden = false;
  els.preflightPanel.className = "preflight-panel ready";
  els.preflightPanel.innerHTML = `
    <div class="preflight-head">
      <strong>${escapeHtml(t("preflight.title"))}</strong>
      <span>${escapeHtml(preflight.sourceFile)}</span>
      <span>${escapeHtml(t("preflight.digest", { digest: shortDigest }))}</span>
    </div>
    <div class="preflight-metrics">
      <span>${escapeHtml(
        t("preflight.ready", {
          valid: preflight.validRecords,
          total: preflight.totalRecords,
          invalid: preflight.invalidRecords,
          models: modelCount,
        })
      )}</span>
      ${preflight.duplicates?.withinFile ? `<span>${escapeHtml(t("preflight.duplicates", { count: preflight.duplicates.withinFile }))}</span>` : ""}
    </div>
    ${
      errors.length
        ? `<div class="preflight-errors"><span>${escapeHtml(t("preflight.errors", { count: errors.length, shown: shownErrors.length }))}</span>${shownErrors
            .map((error) => `<span>#${Number(error.index) + 1}: ${escapeHtml(error.message)}</span>`)
            .join("")}</div>`
        : ""
    }
  `;
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
    els.runProductCheckButton.disabled = true;
    els.runProductCheckButton.textContent = t("actions.runProductCheck");
    els.archiveBatchButton.disabled = true;
    els.restoreBatchButton.disabled = true;
    els.deleteBatchButton.disabled = true;
    return;
  }
  const imported = batch.imported_at ? new Date(batch.imported_at).toLocaleString() : "";
  const sourceFile = batch.source_file ? ` | ${batch.source_file}` : "";
  const excluded = Number(summary.excluded_items || batch.excluded_count || 0);
  const excludedText = excluded ? ` | ${t("metrics.excluded")}: ${excluded}` : "";
  const runStatus = state.productCheckRun?.status || (state.productCheck ? "succeeded" : t("productCheck.notRun"));
  els.batchMeta.textContent = `${batch.id}${sourceFile} | ${imported}${excludedText} | ${t("productCheck.runStatus")}: ${runStatus}`;

  els.runProductCheckButton.disabled = !state.selectedBatchId || state.productCheckRun?.status === "running";
  els.runProductCheckButton.textContent =
    state.productCheckRun?.status === "running" ? t("actions.runningProductCheck") : t("actions.runProductCheck");
  const archived = Boolean(batch.archived_at);
  els.archiveBatchButton.disabled = archived;
  els.restoreBatchButton.disabled = !archived;
  els.deleteBatchButton.disabled = state.productCheckRun?.status === "running";
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
  if (!task) return "";
  if (task.type === "import") return importTaskSummary(task);
  if (task.type === "product-check") return productCheckTaskSummary(task);
  return browserCacheTaskSummary(task);
}

function taskCards() {
  const cards = [];
  if (state.importTask) {
    cards.push(normalizeTaskCard({ ...state.importTask, type: "import" }));
  }
  if (state.productCheckRun && state.selectedBatchId && state.productCheckRun.batchId === state.selectedBatchId) {
    cards.push(normalizeTaskCard({ ...state.productCheckRun, type: "product-check" }));
  }
  if (state.autoBrowserCacheRun && state.autoBrowserCacheRun.batchId === state.selectedBatchId) {
    const status =
      state.autoBrowserCacheRun.status === "finished" && state.autoBrowserCacheRun.failed > 0 ? "partial" : state.autoBrowserCacheRun.status;
    cards.push(normalizeTaskCard({ ...state.autoBrowserCacheRun, status, type: "browser-cache" }));
  }
  return cards.filter(Boolean);
}

function renderTaskProgress() {
  if (!els.taskProgressStrip) return;
  const cards = taskCards().filter((task) => ["queued", "running", "succeeded", "failed", "partial"].includes(task.status));
  if (cards.length === 0) {
    els.taskProgressStrip.innerHTML = "";
    els.taskProgressStrip.hidden = true;
    return;
  }
  els.taskProgressStrip.hidden = false;
  els.taskProgressStrip.innerHTML = cards
    .map((task) => {
      const status = normalizeTaskStatus(task.status);
      const done = task.done;
      const total = task.total;
      const message = task.type === "import" ? importTaskMessage(task.raw) : task.error || task.message || taskSummary(task.raw);
      return `
        <article class="task-card ${escapeHtml(status)}">
          <div class="task-card-head">
            <strong>${escapeHtml(taskLabel(task))}</strong>
            <span>${escapeHtml(t(`task.${status}`))}</span>
          </div>
          <div class="task-card-progress" aria-label="${escapeHtml(t("task.progress", { done, total }))}">
            <span style="width:${taskProgressPercent(task)}%"></span>
          </div>
          <div class="task-card-meta">
            <span>${escapeHtml(t("task.progress", { done, total }))}</span>
            <span>${escapeHtml(taskSummary(task.raw))}</span>
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
  const statusFilterOptions = [
    ["all", t("filters.allIncludingExcluded")],
    ["active", t("filters.active")],
    ["unreviewed", t("filters.unreviewed")],
    ["reviewed", t("filters.reviewed")],
    ["excluded", t("filters.excluded")],
  ];
  if (!statusFilterOptions.some(([value]) => value === state.filters.status)) {
    state.filters.status = "all";
  }
  els.modelFilter.innerHTML = [
    `<option value="all">${escapeHtml(t("filters.allModels"))}</option>`,
    ...models.map((model) => `<option value="${escapeHtml(model)}">${escapeHtml(model)}</option>`),
  ].join("");
  els.modelFilter.value = state.filters.model;
  els.statusFilter.innerHTML = statusFilterOptions
    .map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`)
    .join("");
  syncFilterControls();
}

function selectedItemInVisibleList(visible = filteredItems()) {
  return Boolean(state.selectedItemId && visible.some((item) => item.id === state.selectedItemId));
}

function updateScrollCurrentButton(visible = filteredItems()) {
  els.scrollCurrentItemButton.disabled = !selectedItemInVisibleList(visible);
}

function resetItemListScroll() {
  state.itemListScrollTop = 0;
  els.itemList.scrollTop = 0;
  if (state.itemListRenderFrame) {
    cancelAnimationFrame(state.itemListRenderFrame);
    state.itemListRenderFrame = null;
  }
}

function scheduleItemListRender() {
  if (state.itemListRenderFrame) return;
  state.itemListRenderFrame = requestAnimationFrame(() => {
    state.itemListRenderFrame = null;
    state.itemListScrollTop = els.itemList.scrollTop;
    renderItemList();
  });
}

function renderItemList() {
  const visible = filteredItems();
  els.visibleCount.textContent = t("queue.visible", { count: visible.length });
  const viewportHeight = els.itemList.clientHeight || 480;

  if (!visible.length) {
    els.itemList.innerHTML = `<div class="empty-list">${escapeHtml(t("queue.noMatching"))}</div>`;
    updateScrollCurrentButton(visible);
    return;
  }

  const windowState = virtualWindow({
    total: visible.length,
    scrollTop: state.itemListScrollTop,
    viewportHeight,
    rowHeight: ITEM_ROW_HEIGHT,
    overscan: ITEM_OVERSCAN,
  });
  const visibleSlice = visible.slice(windowState.startIndex, windowState.endIndex);

  els.itemList.innerHTML = `
    <div class="virtual-list-spacer" style="height:${windowState.totalHeight}px">
      <div class="virtual-list-window" style="transform:translateY(${windowState.beforeHeight}px)">
        ${visibleSlice
    .map((item) => {
      const reviewed = isReviewed(item);
      const excluded = isExcluded(item);
      const score = reviewed ? Number(item.overall_score).toFixed(2) : "--";
      const statusClass = excluded ? "excluded" : reviewed ? "reviewed" : "unreviewed";
      const statusLabel = excluded ? t("review.excluded") : reviewed ? score : t("review.open");
      const rowMeta = excluded && item.exclude_reason ? t(`review.reason.${item.exclude_reason}`) : translatedFetchStatus(item.source_fetch_status);
      return `
        <button class="item-row ${item.id === state.selectedItemId ? "active" : ""} ${excluded ? "excluded" : ""}" data-id="${escapeHtml(item.id)}" type="button">
          <div class="row-title">
            <span class="model-pill">${escapeHtml(item.model)}</span>
            <span class="status-pill ${statusClass}">${escapeHtml(statusLabel)}</span>
          </div>
          <div class="row-prompt">${escapeHtml(item.text)}</div>
          <div class="row-title">
            <span>${escapeHtml(item.raw_json_file)} #${item.raw_index + 1}</span>
            <span>${escapeHtml(rowMeta)}/${escapeHtml(translatedFetchStatus(item.result_fetch_status))}</span>
          </div>
        </button>
      `;
    })
    .join("")}
      </div>
    </div>
  `;

  for (const button of els.itemList.querySelectorAll(".item-row")) {
    button.addEventListener("click", () => {
      state.selectedItemId = button.dataset.id;
      scheduleUrlStateSync();
      render();
    });
  }
  updateScrollCurrentButton(visible);
}

function scrollCurrentItemIntoView(behavior = "smooth") {
  if (!state.selectedItemId) return;
  const visible = filteredItems();
  const index = visible.findIndex((item) => item.id === state.selectedItemId);
  if (index < 0) {
    updateScrollCurrentButton();
    return;
  }
  const top = targetScrollTopForIndex({
    index,
    total: visible.length,
    viewportHeight: els.itemList.clientHeight || 480,
    rowHeight: ITEM_ROW_HEIGHT,
  });
  state.itemListScrollTop = top;
  els.itemList.scrollTo({ top, behavior });
  renderItemList();
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
  const runMetadata = state.productCheck || state.productCheckRun || {};
  const metadata =
    runMetadata.metadataStatus === "legacy"
      ? t("productCheck.legacy")
      : [
          runMetadata.algorithmVersion ? `${t("productCheck.version")}: ${runMetadata.algorithmVersion}` : "",
          runMetadata.thresholdProfileId ? `${t("productCheck.profile")}: ${runMetadata.thresholdProfileId}` : "",
        ]
          .filter(Boolean)
          .join(" | ");
  if (!state.productCheck) {
    return `
      <section class="product-check-panel">
        <h3>${escapeHtml(t("productCheck.title"))}</h3>
        ${metadata ? `<p class="muted">${escapeHtml(metadata)}</p>` : ""}
        <p class="muted">${escapeHtml(t("productCheck.none"))}</p>
      </section>
    `;
  }

  const productCheck = selectedProductCheckItem(item.id);
  if (!productCheck) {
    return `
      <section class="product-check-panel">
        <h3>${escapeHtml(t("productCheck.title"))}</h3>
        ${metadata ? `<p class="muted">${escapeHtml(metadata)}</p>` : ""}
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
      ${metadata ? `<p class="muted">${escapeHtml(metadata)}</p>` : ""}
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
  const item = state.items.find((candidate) => candidate.id === itemId);
  if (isExcluded(item)) return;
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
  const excluded = isExcluded(item);

  els.reviewPane.innerHTML = `
    <div class="review-layout">
      <section class="review-main">
        <div class="review-head">
          <div>
            <h2>${escapeHtml(item.model)}</h2>
            <p>${escapeHtml(t("review.itemMeta", { file: item.raw_json_file, index: item.raw_index + 1, id: item.id }))}</p>
          </div>
        </div>

        ${renderExclusionPanel(item)}

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

      <form id="evaluationForm" class="evaluation-sidebar ${excluded ? "excluded" : ""}">
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
                    <button class="tag-button ${selectedTags.includes(tag) ? "selected" : ""}" data-tag="${tag}" type="button" ${excluded ? "disabled" : ""}>
                      ${tag}
                    </button>
                  `
                )
                .join("")}
            </div>
          </div>

          <div class="save-row">
            <span class="save-note" id="saveNote">${item.evaluation_updated_at ? escapeHtml(t("review.savedAt", { time: new Date(item.evaluation_updated_at).toLocaleString() })) : escapeHtml(t("review.notReviewed"))}</span>
            <button id="saveButton" type="submit" ${excluded ? "disabled" : ""}>${escapeHtml(t("actions.saveReview"))}</button>
          </div>
        </div>
      </form>
    </div>
  `;

  const formEl = document.querySelector("#evaluationForm");
  const currentTags = new Set(selectedTags);
  if (excluded) {
    for (const control of formEl.querySelectorAll("input, select, textarea")) {
      control.disabled = true;
    }
  }

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
    if (isExcluded(item)) return;
    await saveEvaluation(item.id, formEl, [...currentTags]);
  });

  const excludeForm = document.querySelector("#excludeForm");
  if (excludeForm) {
    excludeForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(excludeForm);
      const nextItemId = nextItemIdAfterExclusion(item.id);
      try {
        await updateItemExclusion(item.id, {
          excluded: true,
          reason: formData.get("reason"),
          note: formData.get("note"),
          nextItemId,
        });
      } catch (error) {
        alert(error.message);
      }
    });
  }

  const restoreButton = document.querySelector("#restoreButton");
  if (restoreButton) {
    restoreButton.addEventListener("click", () => {
      updateItemExclusion(item.id, { excluded: false }).catch((error) => alert(error.message));
    });
  }
}

function renderExclusionPanel(item) {
  if (isExcluded(item)) {
    const reason = item.exclude_reason ? t(`review.reason.${item.exclude_reason}`) : t("review.excluded");
    const note = item.exclude_note ? `<p class="exclude-note">${escapeHtml(item.exclude_note)}</p>` : "";
    return `
      <aside class="exclude-panel exclude-panel--locked">
        <div class="exclude-panel-copy">
          <span class="exclude-kicker">${escapeHtml(t("review.excluded"))}</span>
          <strong>${escapeHtml(reason)}</strong>
          <p>${escapeHtml(t("review.excludeState"))}</p>
          ${note}
        </div>
        <div class="exclude-actions">
          <button id="restoreButton" class="secondary" type="button">${escapeHtml(t("actions.restore"))}</button>
        </div>
      </aside>
    `;
  }

  return `
    <form id="excludeForm" class="exclude-panel exclude-panel--active">
      <div class="exclude-panel-copy">
        <span class="exclude-kicker">${escapeHtml(t("actions.exclude"))}</span>
        <strong>${escapeHtml(t("review.excludeConfirm"))}</strong>
        <p>${escapeHtml(t("review.excludeDescription"))}</p>
      </div>
      <label class="exclude-field exclude-field--reason">
        <span>${escapeHtml(t("review.excludeReason"))}</span>
        <select name="reason" required>
          ${excludeReasons
            .map((reason) => `<option value="${escapeHtml(reason)}">${escapeHtml(t(`review.reason.${reason}`))}</option>`)
            .join("")}
        </select>
      </label>
      <label class="exclude-field exclude-field--note">
        <span>${escapeHtml(t("review.excludeNote"))}</span>
        <textarea name="note" maxlength="500" rows="1" placeholder="${escapeHtml(t("review.excludeNotePlaceholder"))}"></textarea>
      </label>
      <div class="exclude-actions">
        <button class="secondary" type="submit">${escapeHtml(t("review.excludeConfirm"))}</button>
      </div>
    </form>
  `;
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

async function updateItemExclusion(itemId, payload) {
  captureReviewDraft(itemId);
  const keepSelectedItemId = payload.nextItemId || itemId;
  const body = await api(`/api/items/${encodeURIComponent(itemId)}/exclusion`, {
    method: "PATCH",
    body: JSON.stringify({
      excluded: payload.excluded,
      reason: payload.reason,
      note: payload.note,
    }),
  });
  state.stats = body.stats;
  delete state.reviewDrafts[itemId];
  await loadBatch(state.selectedBatchId, keepSelectedItemId, { skipAutoBrowserCache: true });
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
  const body = await api(`/api/batches${state.showArchivedBatches ? "?includeArchived=1" : ""}`);
  state.batches = body.batches;
  if (state.selectedBatchId && !state.batches.some((batch) => batch.id === state.selectedBatchId)) {
    state.selectedBatchId = "";
  }
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
        els.uploadImportButton.textContent = t("actions.importUpload");
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
      els.uploadImportButton.textContent = t("actions.importUpload");
      render();
    }
  }, 1000);
}

async function loadBatch(batchId, keepSelectedItemId = "", options = {}) {
  if (!batchId) {
    cancelAutoBrowserCache("");
    state.selectedBatchId = "";
    state.selectedItemId = "";
    state.items = [];
    state.stats = null;
    state.productCheck = null;
    state.productCheckRun = null;
    resetItemListScroll();
    render();
    scheduleUrlStateSync();
    return;
  }
  cancelAutoBrowserCache(batchId);
  const previousBatchId = state.selectedBatchId;
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
  const keepVisibleItem = keepSelectedItemId && visible.some((item) => item.id === keepSelectedItemId);
  state.selectedItemId = keepVisibleItem ? keepSelectedItemId : visible[0]?.id || state.items[0]?.id || "";
  if (previousBatchId !== batchId || options.resetFilters) {
    resetItemListScroll();
  }
  if (state.selectedItemId !== previousSelectedItemId) {
    resetOverlayState();
  }
  await loadBatches();
  startProductCheckPolling();
  render();
  scheduleUrlStateSync();
  if (options.scrollToSelected) {
    scrollCurrentItemIntoView("auto");
  }
  if (!options.skipAutoBrowserCache) {
    startAutoBrowserCache(batchId).catch((error) => console.error(error));
  }
}

function render() {
  applyStaticTranslations();
  renderBatchSelect();
  renderResourceSelect();
  renderUploadImport();
  renderPreflight();
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
  if (state.preflightSource !== "resource" || !state.preflight?.sourceDigest) {
    alert(t("preflight.required"));
    return;
  }
  els.importButton.disabled = true;
  els.importButton.textContent = t("actions.importing");
  try {
    const body = await api("/api/import", {
      method: "POST",
      body: JSON.stringify({ file: state.selectedResourceFile, sourceDigest: state.preflight.sourceDigest, downloadImages: true }),
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

async function importUploadedBatch() {
  const file = state.selectedUploadFile;
  if (!file) {
    alert(t("upload.none"));
    return;
  }
  if (!file.name.toLowerCase().endsWith(".json")) {
    alert(t("upload.invalidJson"));
    return;
  }
  if (state.preflightSource !== "upload" || !state.preflight?.sourceDigest) {
    alert(t("preflight.required"));
    return;
  }

  els.importButton.disabled = true;
  els.uploadImportButton.disabled = true;
  els.uploadImportButton.textContent = t("actions.importing");
  try {
    const content = state.selectedUploadContent || (await file.text());
    const body = await api("/api/import/upload", {
      method: "POST",
      body: JSON.stringify({
        fileName: file.name,
        content,
        sourceDigest: state.preflight.sourceDigest,
        downloadImages: true,
      }),
    });
    state.importTask = body.task;
    render();
    startImportTaskPolling(body.task.id);
  } catch (error) {
    els.importButton.disabled = false;
    els.uploadImportButton.disabled = false;
    els.uploadImportButton.textContent = t("actions.importUpload");
    throw error;
  }
}

async function runResourcePreflight() {
  if (!state.selectedResourceFile) return;
  state.preflightPending = true;
  state.preflightError = "";
  state.preflight = null;
  state.preflightSource = "resource";
  render();
  try {
    const body = await api("/api/import/preflight", {
      method: "POST",
      body: JSON.stringify({ file: state.selectedResourceFile }),
    });
    state.preflight = body.preflight;
  } catch (error) {
    state.preflightError = error.message;
  } finally {
    state.preflightPending = false;
    render();
  }
}

async function runUploadPreflight() {
  const file = state.selectedUploadFile;
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".json")) {
    state.preflightSource = "upload";
    state.preflight = null;
    state.preflightError = t("upload.invalidJson");
    render();
    return;
  }
  state.preflightPending = true;
  state.preflightError = "";
  state.preflight = null;
  state.preflightSource = "upload";
  render();
  try {
    state.selectedUploadContent = await file.text();
    const body = await api("/api/import/upload/preflight", {
      method: "POST",
      body: JSON.stringify({ fileName: file.name, content: state.selectedUploadContent }),
    });
    state.preflight = body.preflight;
  } catch (error) {
    state.preflightError = error.message;
  } finally {
    state.preflightPending = false;
    render();
  }
}

async function archiveSelectedBatch() {
  const batch = selectedBatch();
  if (!batch || !confirm(t("batch.archiveConfirm"))) return;
  await api(`/api/batches/${encodeURIComponent(batch.id)}/archive`, {
    method: "PATCH",
    body: JSON.stringify({ reason: "other", note: "" }),
  });
  await loadBatches();
  await loadBatch(state.selectedBatchId || "");
}

async function restoreSelectedBatch() {
  const batch = selectedBatch();
  if (!batch || !confirm(t("batch.restoreConfirm"))) return;
  await api(`/api/batches/${encodeURIComponent(batch.id)}/restore`, {
    method: "PATCH",
    body: JSON.stringify({}),
  });
  await loadBatches();
  await loadBatch(batch.id);
}

async function deleteSelectedBatch() {
  const batch = selectedBatch();
  if (!batch) return;
  const planBody = await api(`/api/batches/${encodeURIComponent(batch.id)}/delete-plan`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  const plan = planBody.plan;
  const typed = prompt(
    `${t("batch.deletePlan")}\n${t("batch.deletePlanSummary", {
      items: plan.items,
      evaluations: plan.evaluations,
      bytes: formatFileSize(plan.totalBytes),
    })}\n\n${t("batch.deleteConfirm")}`,
    ""
  );
  if (typed !== batch.id) {
    if (typed !== null) alert(t("batch.deleteMismatch"));
    return;
  }
  await api(`/api/batches/${encodeURIComponent(batch.id)}`, {
    method: "DELETE",
    body: JSON.stringify({ confirmBatchId: batch.id }),
  });
  state.selectedBatchId = "";
  state.selectedItemId = "";
  await loadBatches();
  await loadBatch(state.batches[0]?.id || "");
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
    .find((item) => !isExcluded(item) && !isReviewed(item));
  if (next) {
    state.selectedItemId = next.id;
    scheduleUrlStateSync();
    render();
    scrollCurrentItemIntoView();
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
  loadBatch(els.batchSelect.value, "", { resetFilters: true, scrollToSelected: true }).catch(showFatalError);
});

els.scrollCurrentItemButton.addEventListener("click", scrollCurrentItemIntoView);

els.itemList.addEventListener("scroll", scheduleItemListRender);

els.showArchivedBatches.addEventListener("change", () => {
  state.showArchivedBatches = els.showArchivedBatches.checked;
  loadBatches()
    .then(() => loadBatch(state.selectedBatchId || state.batches[0]?.id || "", state.selectedItemId, { scrollToSelected: true }))
    .catch(showFatalError);
});

els.archiveBatchButton.addEventListener("click", () => {
  archiveSelectedBatch().catch((error) => alert(error.message));
});

els.restoreBatchButton.addEventListener("click", () => {
  restoreSelectedBatch().catch((error) => alert(error.message));
});

els.deleteBatchButton.addEventListener("click", () => {
  deleteSelectedBatch().catch((error) => alert(error.message));
});

els.languageSelect.addEventListener("change", () => {
  captureReviewDraft(state.selectedItemId);
  state.language = els.languageSelect.value;
  localStorage.setItem("skill-eval-language", state.language);
  scheduleUrlStateSync();
  render();
});

els.resourceSelect.addEventListener("change", () => {
  state.selectedResourceFile = els.resourceSelect.value;
  runResourcePreflight().catch((error) => {
    state.preflightError = error.message;
    render();
  });
});

els.uploadJsonInput.addEventListener("change", () => {
  state.selectedUploadFile = els.uploadJsonInput.files?.[0] || null;
  state.selectedUploadContent = "";
  runUploadPreflight().catch((error) => {
    state.preflightError = error.message;
    render();
  });
});

els.importButton.addEventListener("click", () => {
  importBatch().catch((error) => {
    alert(error.message);
  });
});

els.uploadImportButton.addEventListener("click", () => {
  importUploadedBatch().catch((error) => {
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
  resetItemListScroll();
  scheduleUrlStateSync();
  render();
});

els.statusFilter.addEventListener("change", () => {
  state.filters.status = els.statusFilter.value;
  const visible = filteredItems();
  if (!visible.some((item) => item.id === state.selectedItemId)) {
    state.selectedItemId = visible[0]?.id || "";
  }
  resetItemListScroll();
  scheduleUrlStateSync();
  render();
});

els.searchInput.addEventListener("input", () => {
  state.filters.search = els.searchInput.value;
  state.selectedItemId = filteredItems()[0]?.id || "";
  resetItemListScroll();
  scheduleUrlStateSync();
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
if (state.selectedResourceFile) {
  await runResourcePreflight().catch(showFatalError);
}
if (state.selectedBatchId) {
  await loadBatch(state.selectedBatchId, initialUrlState.itemId, { scrollToSelected: true }).catch(showFatalError);
} else {
  render();
  writeUrlState({ replace: true });
}
