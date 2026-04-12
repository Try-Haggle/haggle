import { createDb, sql } from "@haggle/db";
const url = process.env.DATABASE_URL;
if (!url) { console.error("no DATABASE_URL"); process.exit(1); }
const db = createDb(url);

// Sample listings from snapshot_json
console.log("Published listings (snapshot_json):\n");
const rows = await db.execute(sql`
  SELECT id, public_id, snapshot_json, published_at
  FROM listings_published
  ORDER BY published_at DESC LIMIT 10
`);

for (const r of rows as unknown as Array<Record<string, unknown>>) {
  const snap = r.snapshot_json as Record<string, unknown> | null;
  console.log(`═══════════════════════════════════════════`);
  console.log(`  id:          ${r.id}`);
  console.log(`  public_id:   ${r.public_id}`);
  console.log(`  published:   ${r.published_at}`);
  if (snap) {
    console.log(`  title:       ${snap.title ?? "(none)"}`);
    console.log(`  category:    ${snap.category ?? "(none)"}`);
    console.log(`  price:       ${snap.price ?? snap.priceCents ?? snap.price_minor ?? "(none)"}`);
    console.log(`  condition:   ${snap.condition ?? "(none)"}`);
    const desc = String(snap.description ?? "");
    console.log(`  description: "${desc.slice(0, 150)}${desc.length > 150 ? "..." : ""}"`);
    console.log(`  tags:        ${snap.tags ? JSON.stringify(snap.tags) : "(none)"}`);
    console.log(`  snap keys:   ${Object.keys(snap).join(", ")}`);
  } else {
    console.log(`  snapshot:    null`);
  }
  console.log();
}

process.exit(0);
