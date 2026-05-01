import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const schemaPath = join(root, "packages", "db", "src", "schema", "negotiation-sessions.ts");
const migrationPath = join(root, "packages", "db", "drizzle", "0023_scope_round_idempotency.sql");

const schema = readFileSync(schemaPath, "utf8");
const migration = readFileSync(migrationPath, "utf8");

const failures = [];

if (!schema.includes('uniqueIndex("negotiation_rounds_session_idempotency_key_idx").on(table.sessionId, table.idempotencyKey)')) {
  failures.push("negotiation_rounds must keep idempotency unique per (session_id, idempotency_key)");
}

if (schema.includes('uniqueIndex("negotiation_rounds_idempotency_key_idx").on(table.idempotencyKey)')) {
  failures.push("negotiation_rounds must not use a globally unique idempotency_key index");
}

if (!/DROP INDEX IF EXISTS negotiation_rounds_idempotency_key_idx;/u.test(migration)) {
  failures.push("0023 migration must drop the legacy global idempotency index");
}

if (!/CREATE UNIQUE INDEX IF NOT EXISTS negotiation_rounds_session_idempotency_key_idx\s+ON negotiation_rounds \(session_id, idempotency_key\);/u.test(migration)) {
  failures.push("0023 migration must create the composite session/idempotency index");
}

if (failures.length) {
  console.error("DB invariant verification failed.");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("DB invariants verified.");
