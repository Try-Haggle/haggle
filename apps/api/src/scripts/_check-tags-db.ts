import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(import.meta.dirname, "../../../../.env") });
config({ path: resolve(import.meta.dirname, "../../.env"), override: false });

import { createDb, sql } from "@haggle/db";
const db = createDb(process.env.DATABASE_URL!);

// 어떤 테이블이 있는지
const tables = await db.execute(sql`
  SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename
`);
console.log("📋 전체 테이블:");
for (const r of tables as unknown as Array<{tablename: string}>) {
  console.log("  " + r.tablename);
}

// 리스팅에서 실제 사용된 태그
console.log("\n📊 리스팅 snapshot_json.tags 현황:");
const tagStats = await db.execute(sql`
  SELECT elem AS tag, COUNT(*) AS cnt
  FROM listings_published, jsonb_array_elements_text(snapshot_json->'tags') AS elem
  GROUP BY elem
  ORDER BY cnt DESC
  LIMIT 40
`);
for (const r of tagStats as unknown as Array<{tag: string, cnt: string}>) {
  console.log("  " + String(r.cnt).padStart(3) + "x  " + r.tag);
}

// 리스팅 카테고리 분포
console.log("\n📊 리스팅 카테고리 분포:");
const catStats = await db.execute(sql`
  SELECT snapshot_json->>'category' AS cat, COUNT(*) AS cnt
  FROM listings_published
  GROUP BY cat
  ORDER BY cnt DESC
`);
for (const r of catStats as unknown as Array<{cat: string, cnt: string}>) {
  console.log("  " + String(r.cnt).padStart(3) + "x  " + (r.cat || "(none)"));
}

process.exit(0);
