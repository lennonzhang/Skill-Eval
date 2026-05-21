import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const rootDir = path.resolve(__dirname, "..");
export const resourceDir = resolveFromRoot(process.env.SKILL_EVAL_RESOURCE_DIR, path.join(rootDir, "resource"));

function resolveFromRoot(value, fallback) {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  return path.resolve(path.isAbsolute(raw) ? raw : path.join(rootDir, raw));
}

export const dataDir = resolveFromRoot(process.env.SKILL_EVAL_DATA_DIR, path.join(rootDir, "data"));
export const databasePath = path.join(dataDir, "app.sqlite");
export const cacheDir = path.join(dataDir, "cache");
export const importRunsDir = path.join(dataDir, "import-runs");
export const productChecksDir = path.join(dataDir, "product-checks");
export const taskRunsDir = path.join(dataDir, "task-runs");
export const reportsDir = path.join(dataDir, "reports");

export function dataVirtualPath(...parts) {
  return path.join("data", ...parts);
}

export function dataAbsolutePathFromVirtual(virtualPath) {
  const normalized = String(virtualPath || "").replaceAll("\\", "/");
  const withoutPrefix = normalized.startsWith("data/") ? normalized.slice("data/".length) : normalized;
  return path.join(dataDir, ...withoutPrefix.split("/").filter(Boolean));
}

export function projectRelativePath(filePath) {
  return path.relative(rootDir, filePath);
}
