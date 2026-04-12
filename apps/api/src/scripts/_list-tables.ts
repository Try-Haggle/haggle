import { createDb, sql } from "@haggle/db";
const url = process.env.DATABASE_URL;
if (!url) { console.error("no DATABASE_URL"); process.exit(1); }
const db = createDb(url);
const tables = await db.execute(sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`);
for (const r of tables as unknown as Array<{ tablename: string }>) {
  console.log(r.tablename);
}
process.exit(0);
