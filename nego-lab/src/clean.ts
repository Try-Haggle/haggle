// Step 5: cleanup helper. The test DB and results/ dir accumulate rows/files
// with every run. This resets them safely. DB truncation is guarded to the
// isolated test DB and enumerated tables only. Costs nothing.
//
// Run (from repo root):
//   npx tsx nego-lab/src/clean.ts --results            # delete results/*.jsonl + *.html
//   DATABASE_URL=...haggle_negolab npx tsx nego-lab/src/clean.ts --db --yes
//   ... --db --results                                 # both
import "../../apps/api/src/config/load-env.js";
import { readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { createDb, sql } from "@haggle/db";

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(HERE, "..", "results");

// Tables written per negotiation. TRUNCATE ... CASCADE clears these + dependents.
const TEST_TABLES = [
  "listing_drafts",
  "listings_published",
  "negotiation_sessions",
  "negotiation_rounds",
];

async function confirm(q: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return ["y", "yes"].includes((await rl.question(q)).trim().toLowerCase());
  } finally {
    rl.close();
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const doResults = argv.includes("--results");
  const doDb = argv.includes("--db");
  const yes = argv.includes("--yes") || argv.includes("-y");

  if (!doResults && !doDb) {
    console.log(
      `\nUsage: clean --results | --db [--yes]\n` +
        `  --results  delete results/*.jsonl and *.html\n` +
        `  --db       TRUNCATE test data (${TEST_TABLES.join(", ")})\n`,
    );
    process.exit(0);
  }

  if (doResults) {
    let removed = 0;
    for (const f of readdirSync(RESULTS_DIR).filter((f) => /\.(jsonl|html)$/.test(f))) {
      rmSync(join(RESULTS_DIR, f));
      removed++;
    }
    console.log(`Removed ${removed} result file(s) from ${RESULTS_DIR}`);
  }

  if (doDb) {
    const dbUrl = process.env.DATABASE_URL ?? "";
    if (!dbUrl.includes("haggle_negolab")) {
      console.error(
        `\n✗ Refusing: DATABASE_URL must be the local test DB (haggle_negolab). Got: ${dbUrl || "<unset>"}\n`,
      );
      process.exit(1);
    }
    if (!yes) {
      const ok = await confirm(
        `This TRUNCATEs ${TEST_TABLES.join(", ")} in ${dbUrl.replace(/:[^:@/]*@/, ":***@")}. Proceed? [y/N] `,
      );
      if (!ok) {
        console.log("Aborted.");
        process.exit(0);
      }
    }
    const db = createDb(dbUrl);
    // Identifiers can't be parameterized; the list is a hardcoded constant above.
    await db.execute(sql.raw(`TRUNCATE TABLE ${TEST_TABLES.join(", ")} RESTART IDENTITY CASCADE`));
    console.log(`Truncated: ${TEST_TABLES.join(", ")}`);
  }

  console.log("");
  process.exit(0);
}

main().catch((err) => {
  console.error("clean FAILED:", err);
  process.exit(1);
});
