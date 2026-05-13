import { importResourceBatch } from "../src/importer.js";
import { initializeDatabase } from "../src/db.js";

initializeDatabase();

const nameArg = process.argv.find((arg) => arg.startsWith("--name="));
const noImages = process.argv.includes("--no-images");
const fileArgs = process.argv
  .filter((arg) => arg.startsWith("--file="))
  .map((arg) => arg.slice("--file=".length))
  .filter(Boolean);
const batchName = nameArg ? nameArg.slice("--name=".length) : undefined;

if (fileArgs.length !== 1) {
  console.error("Usage: pnpm run import:resource -- --file=<resource-json-file> [--name=<batch-name>] [--no-images]");
  process.exit(1);
}

const result = await importResourceBatch({
  batchName,
  downloadImages: !noImages,
  files: fileArgs,
});

console.log(JSON.stringify(result, null, 2));
