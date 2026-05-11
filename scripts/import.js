import { importResourceBatch } from "../src/importer.js";
import { initializeDatabase } from "../src/db.js";

initializeDatabase();

const nameArg = process.argv.find((arg) => arg.startsWith("--name="));
const noImages = process.argv.includes("--no-images");
const batchName = nameArg ? nameArg.slice("--name=".length) : undefined;

const result = await importResourceBatch({
  batchName,
  downloadImages: !noImages,
});

console.log(JSON.stringify(result, null, 2));
