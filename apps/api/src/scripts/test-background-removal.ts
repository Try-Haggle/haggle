/**
 * Test: Does background removal improve CLIP image similarity?
 *
 * Compares image similarity scores for Sony WH-1000XM5 against all electronics listings:
 *   - Original images (current embeddings)
 *   - Background-removed images (new embeddings via rembg → CLIP)
 *
 * Usage:
 *   cd apps/api
 *   npx tsx src/scripts/test-background-removal.ts
 */

import "../config/load-env.js";
import { createDb, sql } from "@haggle/db";
import Replicate from "replicate";

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

// ─── Helpers ────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0,
    magA = 0,
    magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

async function removeBackground(imageUrl: string): Promise<string> {
  const output = await replicate.run(
    "cjwbw/rembg:fb8af171cfa1616ddcf1242c093f9c46bcada5ad4cf6f2fbe8b81b330ec5c003",
    { input: { image: imageUrl } },
  );
  return String(output); // returns URL of background-removed image
}

async function getClipEmbedding(imageUrl: string): Promise<number[]> {
  const output = await replicate.run(
    "andreasjansson/clip-features:75b33f253f7714a281ad3e9b28f63e3232d583716ef6718f2e46641077ea040a",
    { input: { inputs: imageUrl } },
  );
  const results = output as Array<{ embedding: number[]; input: string }>;
  if (!results?.[0]?.embedding) throw new Error("CLIP returned no embedding");
  return results[0].embedding;
}

// ─── Main ───────────────────────────────────────────────

async function main() {
  const db = createDb(process.env.DATABASE_URL!);

  // Get Sony headphone + all electronics listings with their image embeddings and photo URLs
  const rows = await db.execute(sql`
    SELECT
      lp.public_id,
      lp.snapshot_json->>'title' AS title,
      lp.snapshot_json->>'photoUrl' AS photo_url,
      le.image_embedding
    FROM listings_published lp
    JOIN listing_embeddings le ON le.published_listing_id = lp.id
    WHERE lp.snapshot_json->>'category' = 'electronics'
      AND le.image_embedding IS NOT NULL
    ORDER BY lp.snapshot_json->>'title'
  `);

  const listings = rows as unknown as Array<{
    public_id: string;
    title: string;
    photo_url: string;
    image_embedding: string | number[];
  }>;

  // Parse embeddings
  const parsed = listings.map((l) => ({
    ...l,
    embedding:
      typeof l.image_embedding === "string"
        ? l.image_embedding.slice(1, -1).split(",").map(Number)
        : l.image_embedding,
  }));

  // Find Sony headphone as source
  const source = parsed.find((l) => l.public_id === "E7ZWE-Cw");
  if (!source) {
    console.error("Sony headphone listing not found");
    process.exit(1);
  }

  const others = parsed.filter((l) => l.public_id !== "E7ZWE-Cw");

  console.log(`\n🎧 Source: ${source.title}`);
  console.log(`📊 Comparing against ${others.length} electronics listings\n`);

  // Step 1: Current scores (original images)
  console.log("── Step 1: Computing current image similarity (original) ──\n");
  const originalScores = others.map((l) => ({
    title: l.title,
    score: cosineSimilarity(source.embedding, l.embedding),
  }));

  // Step 2: Background removal + new CLIP embeddings
  console.log("── Step 2: Background removal → CLIP (this takes a few minutes) ──\n");

  // Remove background from source image first
  console.log(`  🔄 Removing background: ${source.title}...`);
  const sourceBgRemoved = await removeBackground(source.photo_url);
  await new Promise((r) => setTimeout(r, 12_000)); // rate limit

  console.log(`  🔄 Getting CLIP embedding for bg-removed source...`);
  const sourceNewEmb = await getClipEmbedding(sourceBgRemoved);
  await new Promise((r) => setTimeout(r, 12_000));

  const newScores: Array<{ title: string; score: number }> = [];

  for (let i = 0; i < others.length; i++) {
    const listing = others[i];
    console.log(`  🔄 [${i + 1}/${others.length}] ${listing.title}...`);

    try {
      const bgRemoved = await removeBackground(listing.photo_url);
      await new Promise((r) => setTimeout(r, 12_000));

      const newEmb = await getClipEmbedding(bgRemoved);
      await new Promise((r) => setTimeout(r, 12_000));

      const score = cosineSimilarity(sourceNewEmb, newEmb);
      newScores.push({ title: listing.title, score });
    } catch (err) {
      console.error(`    ❌ Failed: ${err instanceof Error ? err.message : err}`);
      newScores.push({ title: listing.title, score: -1 });
    }
  }

  // Step 3: Comparison table
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("📊 COMPARISON: Original vs Background-Removed (Sony WH-1000XM5)");
  console.log("══════════════════════════════════════════════════════════════\n");

  const combined = originalScores.map((orig) => {
    const newScore = newScores.find((n) => n.title === orig.title);
    const diff = newScore && newScore.score >= 0 ? newScore.score - orig.score : null;
    return {
      title: orig.title,
      original: orig.score,
      bgRemoved: newScore?.score ?? -1,
      diff,
    };
  });

  // Sort by original score descending
  combined.sort((a, b) => b.original - a.original);

  console.log("Title".padEnd(45) + "Original".padEnd(12) + "BG-Removed".padEnd(12) + "Diff");
  console.log("-".repeat(75));

  for (const row of combined) {
    const orig = row.original.toFixed(4);
    const bgr = row.bgRemoved >= 0 ? row.bgRemoved.toFixed(4) : "FAILED";
    const diff = row.diff !== null ? (row.diff >= 0 ? "+" : "") + row.diff.toFixed(4) : "N/A";
    console.log(`${row.title.padEnd(45)}${orig.padEnd(12)}${bgr.padEnd(12)}${diff}`);
  }

  console.log("\n✅ Test complete.\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
