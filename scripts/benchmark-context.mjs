import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const before = JSON.parse(readFileSync(process.argv[2] ?? join(root, "benchmark", "before.json"), "utf8"));
const after = JSON.parse(readFileSync(process.argv[3] ?? join(root, "benchmark", "after.json"), "utf8"));

if (before.environment !== after.environment || before.toolSchemaChars <= 0 || after.toolSchemaChars < 0) {
  throw new Error("Benchmark snapshots must describe the same environment and contain valid schema character counts.");
}

const savedChars = before.toolSchemaChars - after.toolSchemaChars;
process.stdout.write(JSON.stringify({
  before,
  after,
  saved: {
    toolSchemaChars: savedChars,
    toolSchemaPercent: Math.round(savedChars / before.toolSchemaChars * 10000) / 100,
  },
}, null, 2) + "\n");
