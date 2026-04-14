#!/usr/bin/env npx tsx
/**
 * Run HFMI migration + seed in one shot using postgres.js
 *
 * Usage: DATABASE_URL=... npx tsx scripts/run-hfmi-migration.ts
 *   or:  source apps/api/.env && npx tsx scripts/run-hfmi-migration.ts
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL not set");
  console.error("  source apps/api/.env && npx tsx scripts/run-hfmi-migration.ts");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 1 });

async function main() {
  try {
    // ── Step 1: Run migration ────────────────────────────────────────
    console.log("1/3  Running HFMI migration (0011)...");
    const migrationSql = readFileSync(
      resolve(import.meta.dirname!, "../packages/db/drizzle/0011_hfmi_tables.sql"),
      "utf-8",
    );
    await sql.unsafe(migrationSql);
    console.log("     ✅ Tables created");

    // Verify tables
    const tables = await sql`
      SELECT tablename FROM pg_tables
      WHERE tablename LIKE 'hfmi_%'
      ORDER BY tablename
    `;
    console.log(`     Found: ${tables.map((t) => t.tablename).join(", ")}`);

    // ── Step 2: Insert seed data ─────────────────────────────────────
    console.log("\n2/3  Inserting seed data...");
    const seedSql = readFileSync(
      resolve(import.meta.dirname!, "hfmi-seed.sql"),
      "utf-8",
    );
    const result = await sql.unsafe(seedSql);
    console.log(`     ✅ Seed data inserted`);

    // Count rows
    const counts = await sql`
      SELECT model, count(*)::int as cnt
      FROM hfmi_price_observations
      GROUP BY model
      ORDER BY model
    `;
    console.log("\n     Rows per model:");
    let total = 0;
    for (const row of counts) {
      console.log(`       ${String(row.model).padEnd(22)} ${row.cnt} observations`);
      total += row.cnt;
    }
    console.log(`       ${"TOTAL".padEnd(22)} ${total} observations`);

    // ── Step 3: Verify data quality ──────────────────────────────────
    console.log("\n3/3  Data quality check...");
    const stats = await sql`
      SELECT
        model,
        count(*)::int as n,
        round(avg(observed_price_usd::numeric), 2) as avg_price,
        round(min(observed_price_usd::numeric), 2) as min_price,
        round(max(observed_price_usd::numeric), 2) as max_price
      FROM hfmi_price_observations
      GROUP BY model
      ORDER BY model
    `;
    console.log("\n     Model                  N    Avg     Min     Max");
    console.log("     ─────────────────────────────────────────────────");
    for (const row of stats) {
      console.log(
        `     ${String(row.model).padEnd(22)} ${String(row.n).padStart(3)}  $${String(row.avg_price).padStart(6)}  $${String(row.min_price).padStart(6)}  $${String(row.max_price).padStart(6)}`,
      );
    }

    // Check quality gate readiness (need ≥30 per model for OLS fit)
    const belowGate = stats.filter((s) => Number(s.n) < 30);
    if (belowGate.length === 0) {
      console.log("\n     ✅ All models have ≥30 observations — ready for OLS fit!");
    } else {
      console.log(
        `\n     ⚠️  Models below quality gate (need ≥30): ${belowGate.map((s) => s.model).join(", ")}`,
      );
    }

    console.log("\n🎉 Done! Next steps:");
    console.log("   1. Start API server: pnpm --filter @haggle/api dev");
    console.log("   2. Trigger fit: curl -X POST http://localhost:3001/api/hfmi/fit");
    console.log("   3. Query median: curl http://localhost:3001/api/hfmi/iphone_15_pro/median");
  } catch (err) {
    console.error("ERROR:", err);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();
