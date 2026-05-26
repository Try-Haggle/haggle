import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "../packages/db/node_modules/postgres/src/index.js";

const DRIZZLE_DIR = join(process.cwd(), "packages", "db", "drizzle");
const BASELINE_TAG = "0023_scope_round_idempotency";
const TARGET_START_TAG = "0024_agent_payment_grants";
const TARGET_END_TAG = "0032_payment_operation_in_progress_intent_lock";
const REQUIRED_BASELINE_TABLES = [
  "listing_drafts",
  "listings_published",
  "buyer_listings",
  "commerce_orders",
  "payment_intents",
  "payment_authorizations",
  "payment_settlements",
  "refunds",
  "settlement_approvals",
  "settlement_releases",
  "negotiation_sessions",
  "negotiation_rounds",
  "webhook_idempotency",
];
const REQUIRED_PAYMENT_INTENT_COLUMNS = [
  "id",
  "order_id",
  "seller_id",
  "buyer_id",
  "selected_rail",
  "allowed_rails",
  "buyer_authorization_mode",
  "currency",
  "amount_minor",
  "status",
  "provider_context",
  "created_at",
  "updated_at",
];
const SUPPORTED_PAYMENT_STATUSES = [
  "CREATED",
  "QUOTED",
  "AUTHORIZED",
  "SETTLEMENT_PENDING",
  "SETTLED",
  "FAILED",
  "CANCELED",
];

function parseArgs() {
  const args = new Set(process.argv.slice(2));
  return {
    apply: args.has("--apply"),
    dryRun: !args.has("--apply"),
    envFile: process.argv
      .slice(2)
      .find((arg) => arg.startsWith("--env-file="))
      ?.slice("--env-file=".length),
  };
}

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const env = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  }
  return env;
}

function getDatabaseUrl(envFile) {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const candidates = [envFile, ".env", "apps/api/.env"].filter(Boolean);
  for (const candidate of candidates) {
    const value = readEnvFile(candidate).DATABASE_URL;
    if (value) return value;
  }
  throw new Error("DATABASE_URL is required. Set it in the environment or pass --env-file=<path>.");
}

function readMigrations() {
  const journal = JSON.parse(readFileSync(join(DRIZZLE_DIR, "meta", "_journal.json"), "utf8"));
  return journal.entries.map((entry) => {
    const query = readFileSync(join(DRIZZLE_DIR, `${entry.tag}.sql`), "utf8");
    return {
      tag: entry.tag,
      when: entry.when,
      hash: createHash("sha256").update(query).digest("hex"),
      statements: query.split("--> statement-breakpoint").filter((statement) => statement.trim()),
    };
  });
}

function migrationRange(migrations, startTag, endTag) {
  const start = migrations.findIndex((migration) => migration.tag === startTag);
  const end = migrations.findIndex((migration) => migration.tag === endTag);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Invalid migration range: ${startTag}..${endTag}`);
  }
  return migrations.slice(start, end + 1);
}

async function preflight(sql) {
  const tables = await sql`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_type = 'BASE TABLE'
      and table_name in ${sql(REQUIRED_BASELINE_TABLES)}
  `;
  const foundTables = new Set(tables.map((row) => row.table_name));
  const missingTables = REQUIRED_BASELINE_TABLES.filter((table) => !foundTables.has(table));

  const columns = await sql`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'payment_intents'
      and column_name in ${sql(REQUIRED_PAYMENT_INTENT_COLUMNS)}
  `;
  const foundColumns = new Set(columns.map((row) => row.column_name));
  const missingColumns = REQUIRED_PAYMENT_INTENT_COLUMNS.filter((column) => !foundColumns.has(column));

  const badStatuses = await sql`
    select status, count(*)::int as count
    from payment_intents
    where status not in ${sql(SUPPORTED_PAYMENT_STATUSES)}
    group by status
    order by status
  `;

  const duplicateActivePaymentIntents = await sql`
    select order_id, count(*)::int as count
    from payment_intents
    where status not in ('FAILED', 'CANCELED')
    group by order_id
    having count(*) > 1
    limit 10
  `;

  const failures = [];
  if (missingTables.length) failures.push(`missing baseline tables: ${missingTables.join(", ")}`);
  if (missingColumns.length) failures.push(`payment_intents missing columns: ${missingColumns.join(", ")}`);
  if (badStatuses.length) {
    failures.push(`unsupported payment_intents statuses: ${badStatuses.map((row) => `${row.status}(${row.count})`).join(", ")}`);
  }
  if (duplicateActivePaymentIntents.length) {
    failures.push(`duplicate active payment_intents by order_id: ${duplicateActivePaymentIntents.length} sample rows`);
  }

  if (failures.length) {
    throw new Error(`Production DB preflight failed:\n- ${failures.join("\n- ")}`);
  }

  return {
    baselineTables: foundTables.size,
    paymentIntentColumns: foundColumns.size,
    unsupportedPaymentStatuses: badStatuses.length,
    duplicateActivePaymentIntentSamples: duplicateActivePaymentIntents.length,
  };
}

async function getLastMigration(tx) {
  const rows = await tx`
    select id, hash, created_at
    from drizzle.__drizzle_migrations
    order by created_at desc
    limit 1
  `;
  return rows[0] ?? null;
}

async function insertMigrationRecord(tx, migration) {
  await tx`
    insert into drizzle.__drizzle_migrations (hash, created_at)
    values (${migration.hash}, ${migration.when})
  `;
}

async function main() {
  const args = parseArgs();
  const databaseUrl = getDatabaseUrl(args.envFile);
  const migrations = readMigrations();
  const baseline = migrationRange(migrations, migrations[0].tag, BASELINE_TAG);
  const targets = migrationRange(migrations, TARGET_START_TAG, TARGET_END_TAG);
  const baselineCutoff = baseline.at(-1).when;

  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    const preflightResult = await preflight(sql);
    console.log(`preflight ok: ${JSON.stringify(preflightResult)}`);

    await sql.begin(async (tx) => {
      await tx`set local lock_timeout = '5s'`;
      await tx`set local statement_timeout = '60s'`;
      await tx`select pg_advisory_xact_lock(hashtext('haggle-production-db-migrations'))`;
      await tx`create schema if not exists drizzle`;
      await tx`
        create table if not exists drizzle.__drizzle_migrations (
          id serial primary key,
          hash text not null,
          created_at bigint
        )
      `;

      let lastMigration = await getLastMigration(tx);
      if (!lastMigration) {
        for (const migration of baseline) await insertMigrationRecord(tx, migration);
        lastMigration = { created_at: baselineCutoff };
        console.log(`baseline recorded: ${baseline.length} migrations through ${BASELINE_TAG}`);
      } else if (Number(lastMigration.created_at) < baselineCutoff) {
        throw new Error(`Existing Drizzle history is older than ${BASELINE_TAG}; manual review required.`);
      }

      let applied = 0;
      for (const migration of targets) {
        if (Number(lastMigration.created_at) >= migration.when) continue;
        for (const statement of migration.statements) await tx.unsafe(statement);
        await insertMigrationRecord(tx, migration);
        lastMigration = { created_at: migration.when };
        applied += 1;
        console.log(`applied: ${migration.tag}`);
      }

      if (args.dryRun) {
        console.log(`dry-run ok: ${applied} target migrations applied in transaction; rolling back`);
        throw new Error("ROLLBACK_DRY_RUN_OK");
      }

      console.log(`apply ok: ${applied} target migrations committed`);
    });
  } catch (error) {
    if (error?.message === "ROLLBACK_DRY_RUN_OK") return;
    throw error;
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
