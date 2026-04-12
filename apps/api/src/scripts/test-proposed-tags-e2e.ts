/**
 * E2E test: fetch REAL listings from DB → run tag placement + proposals.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... npx tsx apps/api/src/scripts/test-proposed-tags-e2e.ts
 */

import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(import.meta.dirname, "../../../../.env") });
config({ path: resolve(import.meta.dirname, "../../.env"), override: false });

import { createDb, sql } from "@haggle/db";

const DATABASE_URL = process.env.DATABASE_URL;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
if (!DATABASE_URL) { console.error("❌ DATABASE_URL not set"); process.exit(1); }
if (!OPENAI_KEY) { console.error("❌ OPENAI_API_KEY not set"); process.exit(1); }

const db = createDb(DATABASE_URL);

import {
  placeTagsWithLlm,
  type LlmPlacementInput,
} from "../services/tag-placement-llm.service.js";
import type { TagCandidate } from "../services/tag-candidate.service.js";

// ─── Helpers ────────────────────────────────────────────

let totalIn = 0, totalOut = 0, totalMs = 0;

function makeCandFromTag(label: string, idx: number): TagCandidate {
  return {
    id: `existing-${idx}`,
    label,
    normalizedLabel: label.toLowerCase().replace(/\s+/g, "-"),
    idf: Math.max(0.5, 4.0 - idx * 0.3),
    parentIds: [],
    source: ["idf"],
  };
}

function priceBand(snap: Record<string, unknown>): string | null {
  const p = snap.floorPrice ?? snap.targetPrice ?? snap.price ?? snap.priceCents;
  if (!p) return null;
  const usd = typeof p === "number" ? (p > 1000 ? p / 100 : p) : parseFloat(String(p));
  if (isNaN(usd)) return null;
  if (usd < 50) return "$0-$50";
  if (usd < 100) return "$50-$100";
  if (usd < 200) return "$100-$200";
  if (usd < 500) return "$200-$500";
  if (usd < 1000) return "$500-$1000";
  return "$1000+";
}

// ─── Test one listing ───────────────────────────────────

async function testListing(row: Record<string, unknown>, idx: number) {
  const snap = row.snapshot_json as Record<string, unknown>;
  if (!snap) return null;

  const title = String(snap.title ?? "");
  const description = String(snap.description ?? "");
  const category = snap.category ? String(snap.category) : null;
  const condition = snap.condition ? String(snap.condition) : null;
  const existingTags = Array.isArray(snap.tags) ? (snap.tags as string[]) : [];
  const price = priceBand(snap);

  console.log(`\n${"═".repeat(70)}`);
  console.log(`  #${idx + 1}  ${title}`);
  console.log(`${"═".repeat(70)}`);

  // Show the actual listing
  console.log(`\n  📦 LISTING (published ${String(row.published_at).slice(0, 10)})`);
  console.log(`  ├─ title:       "${title}"`);
  console.log(`  ├─ category:    ${category ?? "(none)"}`);
  console.log(`  ├─ condition:   ${condition ?? "(none)"}`);
  console.log(`  ├─ price band:  ${price ?? "(none)"}`);
  console.log(`  ├─ description: "${description.slice(0, 120)}${description.length > 120 ? "..." : ""}"`);
  console.log(`  └─ current tags (${existingTags.length}): ${existingTags.length > 0 ? existingTags.join(", ") : "(none)"}`);

  // Use existing tags as candidates (simulates the real pipeline)
  const candidates = existingTags.map((t, i) => makeCandFromTag(t, i));

  if (candidates.length === 0) {
    console.log(`\n  ⚠️  No existing tags → LLM has NO candidates`);
    console.log(`     (In production, gatherTagCandidates would find some via idf/ngram/embedding)`);
  }

  console.log(`\n  📋 CANDIDATES SENT TO LLM (${candidates.length}):`);
  for (const c of candidates) {
    console.log(`     ${c.label.padEnd(25)} idf=${c.idf.toFixed(1)}`);
  }

  // Call LLM
  const input: LlmPlacementInput = {
    title,
    description,
    category,
    priceBand: price,
    candidates,
  };

  console.log(`\n  🤖 CALLING gpt-4o-mini...`);
  const result = await placeTagsWithLlm(input);

  if (!result.ok) {
    console.log(`  ❌ FAILED: ${result.error.code} — ${result.error.message}`);
    return null;
  }

  totalIn += result.tokensIn;
  totalOut += result.tokensOut;
  totalMs += result.latencyMs;

  // Selected
  const selectedLabels = result.selectedTagIds.map((tid) => {
    const c = candidates.find((x) => x.id === tid);
    return c ? c.label : tid;
  });
  const skippedLabels = candidates
    .filter((c) => !result.selectedTagIds.includes(c.id))
    .map((c) => c.label);

  console.log(`\n  ✅ LLM RESULT  (${result.latencyMs}ms, ${result.tokensIn}+${result.tokensOut} tokens)`);
  console.log(`  ├─ kept (${selectedLabels.length}):    ${selectedLabels.join(", ") || "(none)"}`);
  if (skippedLabels.length > 0) {
    console.log(`  ├─ dropped (${skippedLabels.length}): ${skippedLabels.join(", ")}`);
  }
  console.log(`  ├─ reasoning:  "${result.reasoning}"`);

  // Proposed — THE KEY PART
  console.log(`  └─ 🆕 PROPOSED NEW TAGS (${result.proposedTags.length}):`);
  if (result.proposedTags.length === 0) {
    console.log(`     (none — existing tags fully describe this listing)`);
  } else {
    for (const tag of result.proposedTags) {
      console.log(`     ┌─ "${tag.label}"  [${tag.category}]`);
      console.log(`     └─ reason: ${tag.reason}`);
    }
  }

  // Verdict
  const checks = [
    { ok: result.proposedTags.every((t) => t.label === t.label.toLowerCase() && !t.label.includes(" ")), name: "labels format" },
    { ok: result.proposedTags.every((t) => ["condition","style","size","material","feature","compatibility","other"].includes(t.category)), name: "category enum" },
    { ok: result.proposedTags.every((t) => t.reason.length > 0), name: "reasons present" },
    { ok: result.proposedTags.length <= 3, name: "≤3 proposals" },
    { ok: result.proposedTags.every((t) => !existingTags.includes(t.label)), name: "no duplicates" },
  ];
  const allPass = checks.every((c) => c.ok);
  console.log(`\n  ${allPass ? "✅" : "❌"} CHECKS: ${checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.name}`).join("  │  ")}`);

  return result;
}

// ─── Main ─────────────────────────────────────────────────

async function main() {
  console.log("🔬 E2E Test: Real DB Listings → Tag Placement + New Tag Proposals");
  console.log(`   DB: ${DATABASE_URL!.replace(/\/\/.*@/, "//***@")}`);
  console.log(`   Model: ${process.env.TAG_PLACEMENT_MODEL || "gpt-4o-mini-2024-07-18"}`);

  const rows = await db.execute(sql`
    SELECT id, public_id, snapshot_json, published_at
    FROM listings_published
    ORDER BY published_at DESC
    LIMIT 10
  `) as unknown as Array<Record<string, unknown>>;

  console.log(`\n  Found ${rows.length} published listings:\n`);
  for (const r of rows) {
    const snap = r.snapshot_json as Record<string, unknown>;
    const tags = Array.isArray(snap?.tags) ? snap.tags.length : 0;
    console.log(`    ${String(r.published_at).slice(0, 10)}  ${snap?.title ?? "?"}  (${tags} tags)`);
  }

  let tested = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = await testListing(rows[i]!, i);
    if (r) tested++;
  }

  const cost = (totalIn * 0.15 + totalOut * 0.6) / 1_000_000;
  console.log(`\n\n${"═".repeat(70)}`);
  console.log(`  SUMMARY`);
  console.log(`${"═".repeat(70)}`);
  console.log(`  Listings tested: ${tested}/${rows.length}`);
  console.log(`  Total tokens:    ${totalIn} in + ${totalOut} out = ${totalIn + totalOut}`);
  console.log(`  Total time:      ${(totalMs / 1000).toFixed(1)}s`);
  console.log(`  Est. cost:       $${cost.toFixed(4)}`);
  console.log(`${"═".repeat(70)}\n`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
