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



const creditSchemaPath = join(root, "packages", "db", "src", "schema", "credit-ledger.ts");
const creditMigrationPath = join(root, "packages", "db", "drizzle", "0155_credit_ledger.sql");
const creditSchema = readFileSync(creditSchemaPath, "utf8");
const creditMigration = readFileSync(creditMigrationPath, "utf8");

if (!creditSchema.includes('uniqueIndex("credit_ledger_entries_account_idempotency_key_idx").on(table.accountId, table.idempotencyKey)')) {
  failures.push("credit_ledger_entries must keep idempotency unique per (account_id, idempotency_key)");
}

if (/uniqueIndex\("credit_ledger_entries_idempotency_key_idx"\)\.on\(table\.idempotencyKey\)/.test(creditSchema)) {
  failures.push("credit_ledger_entries must not use a globally unique idempotency_key index");
}

if (!/CREATE UNIQUE INDEX IF NOT EXISTS "credit_ledger_entries_account_idempotency_key_idx"\s+ON "credit_ledger_entries" \("account_id", "idempotency_key"\);/u.test(creditMigration)) {
  failures.push("0155 migration must create composite account/idempotency unique index");
}

if (/CREATE UNIQUE INDEX[^;]*ON "credit_ledger_entries" \("idempotency_key"\)/u.test(creditMigration)) {
  failures.push("0155 migration must not create a globally unique idempotency_key index");
}

if (failures.length) {
  console.error("DB invariant verification failed.");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("DB invariants verified.");
