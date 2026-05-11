import { getDatabase } from "../src/db.js";

if (!process.argv.includes("--yes")) {
  throw new Error("Refusing to clear evaluations without --yes");
}

const db = getDatabase();
const before = db.prepare("SELECT COUNT(*) AS count FROM evaluations").get().count;
db.prepare("DELETE FROM evaluations").run();
const after = db.prepare("SELECT COUNT(*) AS count FROM evaluations").get().count;

console.log(
  JSON.stringify(
    {
      ok: true,
      deleted: before - after,
      remaining: after,
    },
    null,
    2
  )
);
