import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

const drizzleDir = join(process.cwd(), "packages", "db", "drizzle");
const journalPath = join(drizzleDir, "meta", "_journal.json");

const sqlTags = readdirSync(drizzleDir)
  .filter((entry) => entry.endsWith(".sql"))
  .map((entry) => basename(entry, ".sql"))
  .sort();

const journal = JSON.parse(readFileSync(journalPath, "utf8"));
const journalTags = (journal.entries ?? [])
  .map((entry) => entry?.tag)
  .filter((tag) => typeof tag === "string")
  .sort();

const missing = sqlTags.filter((tag) => !journalTags.includes(tag));
const stale = journalTags.filter((tag) => !sqlTags.includes(tag));
const duplicateJournalTags = journalTags.filter((tag, index) => journalTags.indexOf(tag) !== index);

if (missing.length || stale.length || duplicateJournalTags.length) {
  console.error("Drizzle migration journal is out of sync.");
  if (missing.length) console.error(`Missing journal entries: ${missing.join(", ")}`);
  if (stale.length) console.error(`Journal entries without SQL files: ${stale.join(", ")}`);
  if (duplicateJournalTags.length) {
    console.error(`Duplicate journal entries: ${[...new Set(duplicateJournalTags)].join(", ")}`);
  }
  process.exit(1);
}

console.log(`Drizzle migration journal matches ${sqlTags.length} SQL migration files.`);
