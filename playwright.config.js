import { defineConfig } from "@playwright/test";
import path from "node:path";

const port = Number(process.env.PORT || 4173);
const testDataDir = process.env.SKILL_EVAL_DATA_DIR || path.join(".tmp", "playwright-data");
const webServerEnv = {
  ...process.env,
  SKILL_EVAL_DATA_DIR: testDataDir,
  SKILL_EVAL_LOG_LEVEL: process.env.SKILL_EVAL_LOG_LEVEL || "warn",
  SKILL_EVAL_TEST: "1",
};

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 8_000,
  },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: process.platform === "win32" ? "pnpm.cmd run dev" : "pnpm run dev",
    env: webServerEnv,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 15_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
