import { importResourceBatch } from "../src/importer.js";
import { initializeDatabase } from "../src/db.js";

initializeDatabase();

const nameArg = process.argv.find((arg) => arg.startsWith("--name="));
const cacheWorkersArg = process.argv.find((arg) => arg.startsWith("--cache-workers="));
const noImages = process.argv.includes("--no-images");
const fileArgs = process.argv
  .filter((arg) => arg.startsWith("--file="))
  .map((arg) => arg.slice("--file=".length))
  .filter(Boolean);
const batchName = nameArg ? nameArg.slice("--name=".length) : undefined;
const cacheWorkers = cacheWorkersArg ? Number(cacheWorkersArg.slice("--cache-workers=".length)) : undefined;

if (fileArgs.length !== 1) {
  console.error(
    "Usage: pnpm run import:resource -- --file=<resource-json-file> [--name=<batch-name>] [--no-images] [--cache-workers=<n>]"
  );
  process.exit(1);
}

const result = await importResourceBatch({
  batchName,
  cacheWorkers,
  downloadImages: !noImages,
  files: fileArgs,
  onProgress: (event) => {
    console.error(JSON.stringify(event));
  },
});

console.log(JSON.stringify(result, null, 2));
