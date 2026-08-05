// Step 5: preflight doctor. Run this BEFORE a paid batch to catch setup problems
// (wrong DB, missing API key, un-pushed schema) while it's still free — instead
// of discovering them mid-run after spending money. Read-only, costs nothing.
//
// Run (from repo root):
//   DATABASE_URL="postgresql://<user>@localhost:5432/haggle_negolab" \
//     npx tsx nego-lab/src/doctor.ts
import "../../apps/api/src/config/load-env.js";
import { createDb, sql } from "@haggle/db";

interface Check {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
}

async function main() {
  const checks: Check[] = [];

  // 1. DATABASE_URL points at the isolated test DB.
  const dbUrl = process.env.DATABASE_URL ?? "";
  const dbOk = dbUrl.includes("haggle_negolab");
  checks.push({
    name: "DATABASE_URL → test DB",
    ok: dbOk,
    detail: dbOk ? dbUrl.replace(/:[^:@/]*@/, ":***@") : dbUrl || "<unset>",
    fix: 'export DATABASE_URL="postgresql://<user>@localhost:5432/haggle_negolab"',
  });

  // 2. DeepSeek API key present (loaded from repo-root .env).
  const keyOk = Boolean(process.env.DEEPSEEK_API_KEY);
  checks.push({
    name: "DEEPSEEK_API_KEY set",
    ok: keyOk,
    detail: keyOk ? "present" : "missing",
    fix: "add DEEPSEEK_API_KEY to the repo-root .env",
  });

  // 3+4. DB reachable and core tables exist (only if the URL is safe to touch).
  if (dbOk) {
    try {
      const db = createDb(dbUrl);
      await db.execute(sql`select 1`);
      checks.push({ name: "DB reachable", ok: true, detail: "connected" });

      const need = [
        "listing_drafts",
        "listings_published",
        "negotiation_sessions",
        "negotiation_rounds",
      ];
      const missing: string[] = [];
      for (const t of need) {
        const res = await db.execute(sql`select to_regclass(${"public." + t}) as reg`);
        // postgres-js returns rows as an array directly; node-postgres wraps in { rows }.
        const rows = (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as {
          reg: string | null;
        }[];
        if (!rows[0]?.reg) missing.push(t);
      }
      checks.push({
        name: "schema pushed (core tables)",
        ok: missing.length === 0,
        detail:
          missing.length === 0
            ? `${need.length}/${need.length} present`
            : `missing: ${missing.join(", ")}`,
        fix: "pnpm --filter @haggle/db db:push  (with DATABASE_URL set)",
      });
    } catch (err) {
      checks.push({
        name: "DB reachable",
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
        fix: "start Postgres (see README §2.1 / §10) and confirm the port",
      });
    }
  }

  console.log(`\n=== nego-lab preflight ===`);
  for (const c of checks) {
    const mark = c.ok ? "✓" : "✗";
    console.log(`  ${mark} ${c.name}: ${c.detail}`);
    if (!c.ok && c.fix) console.log(`      fix: ${c.fix}`);
  }
  const allOk = checks.every((c) => c.ok);
  console.log(
    allOk
      ? `\nAll checks passed. Safe to run a paid batch.\n`
      : `\nSome checks failed — fix them before running a paid batch.\n`,
  );
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error("doctor FAILED:", err);
  process.exit(1);
});
