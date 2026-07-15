import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const outputJson = process.argv.includes("--json");
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("DATABASE_URL is required for existing-table compatibility preflight.");
  process.exit(2);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(join(scriptDir, "..", "transaction-relations.json"), "utf8"),
);
const sql = postgres(connectionString, { max: 1, prepare: false });
const checks = [];

async function tableExists(tableName) {
  const [row] = await sql`SELECT to_regclass(${`public.${tableName}`}) IS NOT NULL AS present`;
  return row?.present === true;
}

async function columnExists(tableName, columnName) {
  const [row] = await sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = ${tableName}
         AND column_name = ${columnName}
    ) AS present
  `;
  return row?.present === true;
}

function record(name, count, detail) {
  checks.push({ name, blockingCount: Number(count ?? 0), detail });
}

try {
  if (await tableExists("dispute_cases")) {
    const [row] = await sql`
      SELECT count(*)::int AS count FROM (
        SELECT order_id FROM dispute_cases
         WHERE status NOT IN ('RESOLVED_BUYER_FAVOR', 'RESOLVED_SELLER_FAVOR', 'PARTIAL_REFUND', 'CLOSED')
         GROUP BY order_id HAVING count(*) > 1
      ) duplicates
    `;
    record("active dispute duplicates", row?.count, "dispute_cases.order_id");
  }

  if (await tableExists("shipment_events")) {
    const [row] = await sql`
      SELECT count(*)::int AS count FROM (
        SELECT shipment_id, event_type, occurred_at FROM shipment_events
         GROUP BY shipment_id, event_type, occurred_at HAVING count(*) > 1
      ) duplicates
    `;
    record(
      "shipment event duplicates",
      row?.count,
      "shipment_events(shipment_id,event_type,occurred_at)",
    );
  }

  if (
    (await tableExists("dispute_evidence")) &&
    (await columnExists("dispute_evidence", "derived_artifacts"))
  ) {
    const hasProvenanceColumn = await columnExists(
      "dispute_evidence",
      "derived_artifacts_provenance",
    );
    const [row] = hasProvenanceColumn
      ? await sql`
          SELECT count(*)::int AS count FROM dispute_evidence
           WHERE derived_artifacts IS NOT NULL AND derived_artifacts_provenance IS NULL
        `
      : await sql`
          SELECT count(*)::int AS count FROM dispute_evidence
           WHERE derived_artifacts IS NOT NULL
        `;
    record(
      "unsigned derived evidence",
      row?.count,
      "migration 0066 would clear derived_artifacts without provenance",
    );
  }

  for (const relation of manifest.relations) {
    if (!(await tableExists(relation.childTable)) || !(await tableExists(relation.parentTable))) {
      continue;
    }
    const [row] = await sql.unsafe(`
      SELECT count(*)::int AS count
        FROM public.${relation.childTable} child_row
        LEFT JOIN public.${relation.parentTable} parent_row
          ON parent_row.${relation.parentColumn} = child_row.${relation.childColumn}
       WHERE child_row.${relation.childColumn} IS NOT NULL
         AND parent_row.${relation.parentColumn} IS NULL
    `);
    record(
      `orphan relation: ${relation.constraint}`,
      row?.count,
      `${relation.childTable}.${relation.childColumn} -> ${relation.parentTable}.${relation.parentColumn}`,
    );
  }
} finally {
  await sql.end();
}

const failures = checks.filter((check) => check.blockingCount > 0);
if (outputJson) {
  console.log(
    JSON.stringify(
      {
        summary: { checkCount: checks.length, failureCount: failures.length },
        checks,
      },
      null,
      2,
    ),
  );
} else {
  console.table(checks);
  if (failures.length === 0) {
    console.log(
      `Existing-table compatibility preflight passed: ${checks.length} checks, 0 blockers.`,
    );
  }
}

if (failures.length > 0) {
  console.error(
    `Existing-table compatibility preflight failed: ${failures.length}/${checks.length} checks have blockers. No migration was run.`,
  );
  process.exit(1);
}
