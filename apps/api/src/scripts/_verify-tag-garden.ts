import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(import.meta.dirname, "../../../../.env") });
config({ path: resolve(import.meta.dirname, "../../.env"), override: false });

import { createDb, sql } from "@haggle/db";
const db = createDb(process.env.DATABASE_URL!);

async function main() {
  // Summary counts
  const statusCounts = await db.execute(sql`
    SELECT status, COUNT(*)::int AS cnt FROM tags GROUP BY status ORDER BY status
  `);
  console.log("=== Tag Status ===");
  for (const r of statusCounts as any[]) console.log(`  ${r.status}: ${r.cnt}`);

  // Category distribution
  const catCounts = await db.execute(sql`
    SELECT category, COUNT(*)::int AS cnt FROM tags GROUP BY category ORDER BY cnt DESC
  `);
  console.log("\n=== Categories ===");
  for (const r of catCounts as any[]) console.log(`  ${r.category}: ${r.cnt}`);

  // Top 10 by IDF (most distinctive)
  const topIdf = await db.execute(sql`
    SELECT name, status, use_count, idf::float, category FROM tags ORDER BY idf DESC LIMIT 10
  `);
  console.log("\n=== Top 10 IDF (most distinctive) ===");
  for (const r of topIdf as any[]) {
    console.log(`  ${r.name.padEnd(25)} ${r.status.padEnd(10)} uses=${r.use_count}  idf=${Number(r.idf).toFixed(2)}  [${r.category}]`);
  }

  // OFFICIAL tags
  const officials = await db.execute(sql`
    SELECT name, use_count, idf::float, category FROM tags WHERE status='OFFICIAL' ORDER BY use_count DESC
  `);
  console.log("\n=== OFFICIAL Tags (3+ uses) ===");
  for (const r of officials as any[]) {
    console.log(`  ${r.name.padEnd(20)} uses=${String(r.use_count).padEnd(3)} idf=${Number(r.idf).toFixed(2)}  [${r.category}]`);
  }

  // DAG edges
  const edges = await db.execute(sql`
    SELECT p.name AS parent, c.name AS child
    FROM tag_edges e
    JOIN tags p ON p.id = e.parent_tag_id
    JOIN tags c ON c.id = e.child_tag_id
    ORDER BY p.name, c.name
  `);
  console.log("\n=== DAG Edges ===");
  for (const r of edges as any[]) console.log(`  ${r.parent} → ${r.child}`);

  // Total
  const total = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM tags`);
  console.log(`\n📊 Total: ${(total as any[])[0].cnt} tags`);

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
