import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const fixtureSource = path.join(rootDir, "tests", "fixtures", "sanitized-resource.json");
const fixtureExpected = path.join(rootDir, "tests", "fixtures", "expected", "report-metrics.json");
const compareExpected = path.join(rootDir, "tests", "fixtures", "expected", "compare-metrics.json");
const testRunId = `smoke-fixture-${process.pid}-${Date.now()}`;
const dataDir = path.join(rootDir, ".tmp", `smoke-fixture-data-${testRunId}`);
const resourceDir = path.join(dataDir, "resource");
const fixtureTarget = path.join(resourceDir, "sanitized-resource.json");

function commandSpec(command, args) {
  if (process.platform !== "win32") return { command, args };
  return { command: "cmd.exe", args: ["/c", command, ...args] };
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const spec = commandSpec(command, args);
    const child = spawn(spec.command, spec.args, {
      cwd: rootDir,
      stdio: "inherit",
      ...options,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

async function waitForServer({ baseUrl, server, expected }) {
  const deadline = Date.now() + 12_000;
  let exited = false;
  let exitCode = null;
  server.once("exit", (code) => {
    exited = true;
    exitCode = code;
  });
  server.stdout?.on("data", (chunk) => process.stdout.write(chunk));
  server.stderr?.on("data", (chunk) => process.stderr.write(chunk));

  while (Date.now() < deadline) {
    if (exited) {
      throw new Error(`Fixture server exited before it became healthy; code=${exitCode}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        const health = await response.json();
        if (
          health.test === true &&
          health.testRunId === expected.testRunId &&
          path.resolve(health.dataDir) === path.resolve(expected.dataDir) &&
          path.resolve(health.resourceDir) === path.resolve(expected.resourceDir)
        ) {
          return health;
        }
        throw new Error(`Unexpected server identity at ${baseUrl}: ${JSON.stringify(health)}`);
      }
    } catch (error) {
      if (String(error?.message || "").startsWith("Unexpected server identity")) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Fixture server did not start at ${baseUrl}`);
}

async function stopServer(server) {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  server.kill();
  await Promise.race([
    new Promise((resolve) => server.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);
  if (server.exitCode === null && server.signalCode === null) {
    server.kill("SIGKILL");
  }
}

async function getJson(baseUrl, route) {
  const response = await fetch(`${baseUrl}${route}`);
  if (!response.ok) {
    throw new Error(`${route} returned HTTP ${response.status}`);
  }
  return response.json();
}

async function postJson(baseUrl, route, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${route} returned HTTP ${response.status}: ${payload.error || "request failed"}`);
  }
  return payload;
}

async function latestBatchId(baseUrl) {
  const body = await getJson(baseUrl, "/api/batches");
  const batch = body.batches?.[0];
  if (!batch?.id) throw new Error("Fixture import did not create a visible batch");
  return batch.id;
}

async function writeFixtureEvaluations(baseUrl, batchId) {
  const body = await getJson(baseUrl, `/api/batches/${encodeURIComponent(batchId)}/items`);
  const items = body.items || [];
  if (items.length !== 2) {
    throw new Error(`Fixture batch expected 2 items, got ${items.length}`);
  }
  const byModel = new Map(items.map((item) => [item.model, item]));
  const first = byModel.get("fixture-model-a");
  const second = byModel.get("fixture-model-b");
  if (!first || !second) {
    throw new Error("Fixture batch is missing expected fixture models");
  }
  await postJson(baseUrl, `/api/items/${encodeURIComponent(first.id)}/evaluation`, {
    product_preservation_score: 5,
    instruction_adherence_score: 5,
    integration_grounding_score: 4,
    prompt_optimization_value_score: 4,
    commercial_quality_score: 5,
    technical_safety_score: 5,
    status: "reviewed",
    tags: ["excellent"],
    comment: "fixture high quality review",
  });
  await postJson(baseUrl, `/api/items/${encodeURIComponent(second.id)}/evaluation`, {
    product_preservation_score: 2,
    instruction_adherence_score: 3,
    integration_grounding_score: 2,
    prompt_optimization_value_score: 3,
    commercial_quality_score: 2,
    technical_safety_score: 4,
    status: "needs_recheck",
    tags: ["product_changed"],
    comment: "fixture low preservation review",
  });
  const annotations = await Promise.all(
    items.map((item) => getJson(baseUrl, `/api/items/${encodeURIComponent(item.id)}/annotations`))
  );
  const annotationCount = annotations.reduce((total, entry) => total + (entry.annotations?.length || 0), 0);
  if (annotationCount !== 2) {
    throw new Error(`Fixture evaluations expected 2 annotations, got ${annotationCount}`);
  }
}

async function assertFixtureFilters(baseUrl, batchId) {
  const lowScore = await getJson(
    baseUrl,
    `/api/batches/${encodeURIComponent(batchId)}/items?scoreMax=2.5&tagIncludes=product_changed&status=needs_recheck`
  );
  if (lowScore.items?.length !== 1 || lowScore.items[0].model !== "fixture-model-b") {
    throw new Error("Fixture compound filter did not isolate fixture-model-b");
  }
  const highScore = await getJson(
    baseUrl,
    `/api/batches/${encodeURIComponent(batchId)}/items?scoreMin=4&tagExcludes=product_changed&status=reviewed`
  );
  if (highScore.items?.length !== 1 || highScore.items[0].model !== "fixture-model-a") {
    throw new Error("Fixture high-score filter did not isolate fixture-model-a");
  }
}

async function latestReportPath() {
  const reportsDir = path.join(dataDir, "reports");
  const candidates = readdirSync(reportsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("eval-report-"))
    .map((entry) => {
      const reportPath = path.join(reportsDir, entry.name, "report.json");
      return { reportPath, mtimeMs: statSync(reportPath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (!candidates.length) throw new Error("No fixture report.json was generated");
  return candidates[0].reportPath;
}

async function latestComparePath() {
  const reportsDir = path.join(dataDir, "reports");
  const candidates = readdirSync(reportsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("eval-compare-"))
    .map((entry) => {
      const comparePath = path.join(reportsDir, entry.name, "compare.json");
      return { comparePath, mtimeMs: statSync(comparePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (!candidates.length) throw new Error("No fixture compare.json was generated");
  return candidates[0].comparePath;
}

rmSync(dataDir, { recursive: true, force: true });
mkdirSync(resourceDir, { recursive: true });
copyFileSync(fixtureSource, fixtureTarget);

const port = String(await getFreePort());
const baseUrl = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  HOST: "127.0.0.1",
  PORT: port,
  SKILL_EVAL_DATA_DIR: dataDir,
  SKILL_EVAL_RESOURCE_DIR: resourceDir,
  SKILL_EVAL_TEST: "1",
  SKILL_EVAL_TEST_RUN_ID: testRunId,
  SKILL_EVAL_LOG_LEVEL: "warn",
  SKILL_EVAL_REVIEWER: "fixture-reviewer:Fixture Reviewer",
};

const server = spawn(process.execPath, ["server.js"], {
  cwd: rootDir,
  env,
  stdio: ["ignore", "pipe", "pipe"],
});

try {
  await waitForServer({ baseUrl, server, expected: { testRunId, dataDir, resourceDir } });
  env.SMOKE_BASE_URL = baseUrl;
  await run(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["run", "smoke"], { env });
  await run(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["run", "import:resource", "--", "--file=sanitized-resource.json", "--no-images"], { env });
  const batchId = await latestBatchId(baseUrl);
  await writeFixtureEvaluations(baseUrl, batchId);
  await assertFixtureFilters(baseUrl, batchId);
  await run(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["run", "eval:report", "--", `--batch=${batchId}`], { env });
  const latestReport = await latestReportPath();
  await run(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["run", "eval:report:validate", "--", `--report=${latestReport}`], { env });
  await run(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    ["run", "fixture:report:validate", "--", `--report=${latestReport}`, `--expected=${fixtureExpected}`, `--fixture=${fixtureSource}`],
    { env }
  );
  await run(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    ["run", "eval:compare", "--", `--batch=${batchId}`, "--model-a=fixture-model-a", "--model-b=fixture-model-b"],
    { env }
  );
  const latestCompare = await latestComparePath();
  await run(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    ["run", "eval:compare:validate", "--", `--compare=${latestCompare}`, `--expected=${compareExpected}`],
    { env }
  );
  await run(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["run", "test:residue"], { env });
} finally {
  await stopServer(server);
  rmSync(dataDir, { recursive: true, force: true });
}
