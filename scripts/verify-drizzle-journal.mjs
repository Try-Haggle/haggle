import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

const drizzleDir = join(process.cwd(), "packages", "db", "drizzle");
const journalPath = join(drizzleDir, "meta", "_journal.json");

// These duplicate numeric prefixes predate this verifier. Migration files are
// immutable once committed, so preserve the known history while rejecting any
// new branch-merge collision.
const legacyDuplicatePrefixes = new Map([
  ["0002", ["0002_add_similar_listings_tables", "0002_phase3_5_tables"]],
  ["0004", ["0004_add_current_step", "0004_data_moat_columns"]],
  ["0005", ["0005_add_draft_name", "0005_data_moat_tables"]],
  ["0024", ["0024_agent_payment_grants", "0024_missing_tables"]],
  ["0025", ["0025_dispute_active_order_unique", "0025_notifications"]],
  ["0026", ["0026_dispute_evidence_uploads", "0026_negotiation_agents_rename_and_extend"]],
  ["0027", ["0027_dispute_module_idempotency", "0027_listing_agent_snapshot_and_agent_id"]],
]);

const sqlTags = readdirSync(drizzleDir)
  .filter((entry) => entry.endsWith(".sql"))
  .map((entry) => basename(entry, ".sql"))
  .sort();

const journal = JSON.parse(readFileSync(journalPath, "utf8"));
const journalEntries = journal.entries ?? [];
const journalTags = journalEntries
  .map((entry) => entry?.tag)
  .filter((tag) => typeof tag === "string")
  .sort();

const missing = sqlTags.filter((tag) => !journalTags.includes(tag));
const stale = journalTags.filter((tag) => !sqlTags.includes(tag));
const duplicateJournalTags = journalTags.filter((tag, index) => journalTags.indexOf(tag) !== index);
const duplicateJournalIndexes = journalEntries
  .map((entry) => entry?.idx)
  .filter((idx, index, indexes) => typeof idx === "number" && indexes.indexOf(idx) !== index);
const nonSequentialJournalIndexes = journalEntries
  .map((entry, index) => ({ actual: entry?.idx, expected: index }))
  .filter(({ actual, expected }) => actual !== expected);
const nonMonotonicJournalTimestamps = journalEntries
  .map((entry, index) => ({
    current: entry?.when,
    previous: index > 0 ? journalEntries[index - 1]?.when : null,
    tag: entry?.tag,
  }))
  .filter(
    ({ current, previous }) =>
      typeof previous === "number" && (typeof current !== "number" || current <= previous),
  );

const tagsByNumericPrefix = new Map();
for (const tag of sqlTags) {
  const prefix = tag.match(/^(\d+)_/u)?.[1];
  if (!prefix) continue;
  const tags = tagsByNumericPrefix.get(prefix) ?? [];
  tags.push(tag);
  tagsByNumericPrefix.set(prefix, tags);
}

const unexpectedDuplicatePrefixes = [];
for (const [prefix, tags] of tagsByNumericPrefix) {
  if (tags.length < 2) continue;
  const allowed = legacyDuplicatePrefixes.get(prefix);
  if (!allowed || allowed.join("\n") !== tags.join("\n")) {
    unexpectedDuplicatePrefixes.push(`${prefix}: ${tags.join(", ")}`);
  }
}

if (
  missing.length ||
  stale.length ||
  duplicateJournalTags.length ||
  duplicateJournalIndexes.length ||
  nonSequentialJournalIndexes.length ||
  nonMonotonicJournalTimestamps.length ||
  unexpectedDuplicatePrefixes.length
) {
  console.error("Drizzle migration journal is out of sync.");
  if (missing.length) console.error(`Missing journal entries: ${missing.join(", ")}`);
  if (stale.length) console.error(`Journal entries without SQL files: ${stale.join(", ")}`);
  if (duplicateJournalTags.length) {
    console.error(`Duplicate journal entries: ${[...new Set(duplicateJournalTags)].join(", ")}`);
  }
  if (duplicateJournalIndexes.length) {
    console.error(`Duplicate journal indexes: ${[...new Set(duplicateJournalIndexes)].join(", ")}`);
  }
  if (nonSequentialJournalIndexes.length) {
    console.error(
      `Non-sequential journal indexes: ${nonSequentialJournalIndexes
        .map(({ actual, expected }) => `${actual ?? "missing"} (expected ${expected})`)
        .join(", ")}`,
    );
  }
  if (nonMonotonicJournalTimestamps.length) {
    console.error(
      `Non-monotonic journal timestamps: ${nonMonotonicJournalTimestamps
        .map(({ tag, current, previous }) => `${tag ?? "missing"}: ${current} <= ${previous}`)
        .join(", ")}`,
    );
  }
  if (unexpectedDuplicatePrefixes.length) {
    console.error(
      `New duplicate migration numeric prefixes: ${unexpectedDuplicatePrefixes.join("; ")}`,
    );
  }
  process.exit(1);
}

console.log(`Drizzle migration journal matches ${sqlTags.length} SQL migration files.`);
