import { rmSync } from "node:fs";
import path from "node:path";

import { dataDir, rootDir } from "../src/paths.js";

const relative = path.relative(rootDir, dataDir).replaceAll("\\", "/");
const allowed = relative === ".tmp/playwright-data" || relative.startsWith(".tmp/playwright-data/");

if (!allowed) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: "Refusing to remove a non-test data directory",
        dataDir: relative || ".",
      },
      null,
      2
    )
  );
  process.exit(1);
}

rmSync(dataDir, { recursive: true, force: true });
console.log(
  JSON.stringify(
    {
      ok: true,
      removed: relative,
    },
    null,
    2
  )
);
