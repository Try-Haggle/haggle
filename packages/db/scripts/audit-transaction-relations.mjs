import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const args = new Set(process.argv.slice(2));
const outputJson = args.has("--json");
const requireValidated = args.has("--require-validated");
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("DATABASE_URL is required for transaction relation audit.");
  process.exit(2);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(join(scriptDir, "..", "transaction-relations.json"), "utf8"),
);
const sql = postgres(connectionString, { max: 1, prepare: false });
const results = [];

try {
  for (const relation of manifest.relations) {
    const [constraint] = await sql`
      SELECT
        constraint_row.convalidated,
        child_attribute.attname AS "childColumn",
        parent_table.relname AS "parentTable",
        parent_attribute.attname AS "parentColumn",
        constraint_row.confdeltype AS "deleteAction",
        constraint_row.confupdtype AS "updateAction"
      FROM pg_constraint constraint_row
      JOIN pg_attribute child_attribute
        ON child_attribute.attrelid = constraint_row.conrelid
       AND child_attribute.attnum = constraint_row.conkey[1]
      JOIN pg_class parent_table ON parent_table.oid = constraint_row.confrelid
      JOIN pg_attribute parent_attribute
        ON parent_attribute.attrelid = constraint_row.confrelid
       AND parent_attribute.attnum = constraint_row.confkey[1]
      WHERE constraint_row.conname = ${relation.constraint}
        AND constraint_row.conrelid = ${`public.${relation.childTable}`}::regclass
        AND constraint_row.contype = 'f'
        AND array_length(constraint_row.conkey, 1) = 1
        AND array_length(constraint_row.confkey, 1) = 1
    `;
    const [orphanResult] = await sql.unsafe(`
      SELECT count(*)::int AS orphan_count
      FROM public.${relation.childTable} child_row
      LEFT JOIN public.${relation.parentTable} parent_row
        ON parent_row.${relation.parentColumn} = child_row.${relation.childColumn}
      WHERE child_row.${relation.childColumn} IS NOT NULL
        AND parent_row.${relation.parentColumn} IS NULL
    `);

    const definitionMatches =
      constraint?.childColumn === relation.childColumn &&
      constraint?.parentTable === relation.parentTable &&
      constraint?.parentColumn === relation.parentColumn &&
      constraint?.deleteAction === "a" &&
      constraint?.updateAction === "a";

    results.push({
      ...relation,
      constraintPresent: Boolean(constraint),
      definitionMatches,
      validated: constraint?.convalidated === true,
      orphanCount: Number(orphanResult?.orphan_count ?? 0),
    });
  }
} finally {
  await sql.end();
}

const failures = results.filter(
  (result) =>
    !result.constraintPresent ||
    !result.definitionMatches ||
    result.orphanCount > 0 ||
    (requireValidated && !result.validated),
);
const notValidated = results.filter((result) => !result.validated).length;

if (outputJson) {
  console.log(
    JSON.stringify(
      {
        version: manifest.version,
        summary: {
          relationCount: results.length,
          failureCount: failures.length,
          orphanCount: results.reduce((count, result) => count + result.orphanCount, 0),
          notValidatedCount: notValidated,
        },
        results,
      },
      null,
      2,
    ),
  );
} else {
  console.table(
    results.map((result) => ({
      owner: result.owner,
      relation: `${result.childTable}.${result.childColumn} -> ${result.parentTable}.${result.parentColumn}`,
      constraint: !result.constraintPresent
        ? "missing"
        : result.definitionMatches
          ? "present"
          : "definition mismatch",
      validation: result.validated ? "VALIDATED" : "NOT VALID",
      orphans: result.orphanCount,
    })),
  );
  if (failures.length === 0) {
    console.log(
      `Transaction relation audit passed: ${results.length} relations, 0 orphans, ${notValidated} awaiting validation.`,
    );
  }
}

if (failures.length > 0) {
  console.error(
    `Transaction relation audit failed for ${failures.length}/${results.length} relations.`,
  );
  process.exit(1);
}
