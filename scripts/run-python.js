import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const candidates =
  process.platform === "win32"
    ? [path.join(rootDir, ".venv", "Scripts", "python.exe"), "python"]
    : [path.join(rootDir, ".venv", "bin", "python"), "python3", "python"];

const python = candidates.find((candidate) => candidate === "python" || candidate === "python3" || existsSync(candidate));
if (!python) {
  console.error("Python not found. Create .venv or install python.");
  process.exit(1);
}

const result = spawnSync(python, process.argv.slice(2), {
  cwd: rootDir,
  stdio: "inherit",
  shell: false,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
