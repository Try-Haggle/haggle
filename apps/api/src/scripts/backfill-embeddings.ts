/**
 * Backfill embeddings for all published listings that don't have one yet.
 *
 * Usage:
 *   cd apps/api
 *   npx tsx src/scripts/backfill-embeddings.ts
 *
 * Requires: DATABASE_URL and OPENAI_API_KEY in root .env
 */

import { resolve } from "node:path";
import dotenv from "dotenv";

// Load .env from monorepo root
dotenv.config({ path: resolve(import.meta.dirname, "../../../../.env") });

import { createDb, listingEmbeddings, sql } from "@haggle/db";
import { generateAndStoreEmbedding } from "../services/embedding.service.js";

async function main() {
  const db = createDb(process.env.DATABASE_URL!);

  // Find published listings that have no embedding row yet
  const missing = await db.execute<{ id: string; snapshot_json: Record<string, unknown> }>(sql`
    SELECT lp.id, lp.snapshot_json
    FROM listings_published lp
    LEFT JOIN listing_embeddings le ON le.published_listing_id = lp.id
    WHERE le.id IS NULL
  `);

  const rows = missing as unknown as Array<{ id: string; snapshot_json: Record<string, unknown> }>;

  if (rows.length === 0) {
    console.log("✅ All published listings already have embeddings.");
    return;
  }

  console.log(`Found ${rows.length} listings without embeddings. Processing...`);

  let success = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      // Insert pending row first
      await db
        .insert(listingEmbeddings)
        .values({
          publishedListingId: row.id,
          status: "pending",
          modelVersion: `${process.env.EMBEDDING_MODEL || "text-embedding-3-large"}-v1`,
        })
        .onConflictDoNothing();

      // Generate and store embedding (synchronous for backfill — we want to wait)
      await generateAndStoreEmbedding(db, row.id, row.snapshot_json);
      success++;
      console.log(`  ✅ [${success + failed}/${rows.length}] ${row.snapshot_json.title || row.id}`);

      // Rate limit: wait 12s between items to stay under Replicate's 6 req/min limit
      if (success + failed < rows.length) {
        await new Promise((r) => setTimeout(r, 12_000));
      }
    } catch (err) {
      failed++;
      console.error(`  ❌ [${success + failed}/${rows.length}] ${row.id}:`, err);
    }
  }

  console.log(`\nDone. ✅ ${success} succeeded, ❌ ${failed} failed.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
