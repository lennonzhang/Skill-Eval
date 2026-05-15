import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const taskRunsDir = path.join(rootDir, "data", "task-runs");
const tasks = new Map();

function nowIso() {
  return new Date().toISOString();
}

function safeTaskId(id) {
  const value = String(id || "").trim();
  if (!value || path.basename(value) !== value || value.includes("/") || value.includes("\\")) return "";
  return value;
}

function taskPath(id) {
  const safeId = safeTaskId(id);
  if (!safeId) return null;
  return path.join(taskRunsDir, `${safeId}.json`);
}

function writeTask(task) {
  mkdirSync(taskRunsDir, { recursive: true });
  writeFileSync(taskPath(task.id), JSON.stringify(task, null, 2), "utf8");
  tasks.set(task.id, task);
  return task;
}

function readTask(id) {
  const safeId = safeTaskId(id);
  if (!safeId) return null;
  if (tasks.has(safeId)) return tasks.get(safeId);
  const filePath = taskPath(safeId);
  if (!filePath || !existsSync(filePath)) return null;
  const task = JSON.parse(readFileSync(filePath, "utf8"));
  tasks.set(task.id, task);
  return task;
}

function mergeTask(task, patch) {
  const timestamp = nowIso();
  return {
    ...task,
    ...patch,
    summary: {
      ...(task.summary || {}),
      ...(patch.summary || {}),
    },
    updatedAt: timestamp,
  };
}

export function createTask(type, metadata = {}) {
  const timestamp = nowIso();
  const id = `${type}-${timestamp.replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  return writeTask({
    id,
    type,
    batchId: metadata.batchId || null,
    sourceFile: metadata.sourceFile || null,
    status: metadata.status || "queued",
    done: metadata.done || 0,
    total: metadata.total || 0,
    message: metadata.message || "",
    error: null,
    summary: metadata.summary || {},
    startedAt: metadata.startedAt || timestamp,
    updatedAt: timestamp,
    finishedAt: null,
  });
}

export function updateTask(id, patch) {
  const task = readTask(id);
  if (!task) return null;
  return writeTask(mergeTask(task, patch));
}

export function finishTask(id, status, patch = {}) {
  return updateTask(id, {
    ...patch,
    status,
    finishedAt: patch.finishedAt || nowIso(),
  });
}

export function getTask(id) {
  return readTask(id);
}

function listTaskFiles() {
  if (!existsSync(taskRunsDir)) return [];
  return readdirSync(taskRunsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(taskRunsDir, entry.name));
}

export function getLatestTask({ type, batchId } = {}) {
  for (const filePath of listTaskFiles()) {
    try {
      const task = JSON.parse(readFileSync(filePath, "utf8"));
      tasks.set(task.id, task);
    } catch {
      // Ignore corrupt local progress snapshots; they are diagnostic artifacts.
    }
  }

  return [...tasks.values()]
    .filter((task) => (!type || task.type === type) && (!batchId || task.batchId === batchId))
    .sort((a, b) => String(b.updatedAt || b.startedAt).localeCompare(String(a.updatedAt || a.startedAt)))[0] || null;
}
