import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const manifest = JSON.parse(
  readFileSync(join(root, "packages", "db", "transaction-relations.json"), "utf8"),
);
const migration = readFileSync(
  join(root, "packages", "db", "drizzle", "0141_transaction_relation_integrity.sql"),
  "utf8",
);
const schemaDir = join(root, "packages", "db", "src", "schema");
const schemaSource = readdirSync(schemaDir)
  .filter((file) => file.endsWith(".ts"))
  .map((file) => readFileSync(join(schemaDir, file), "utf8"))
  .join("\n");
const failures = [];
const identifierPattern = /^[a-z][a-z0-9_]*$/u;
const constraints = new Set();
const childColumns = new Set();

for (const relation of manifest.relations ?? []) {
  const values = [
    relation.constraint,
    relation.childTable,
    relation.childColumn,
    relation.parentTable,
    relation.parentColumn,
  ];
  if (values.some((value) => typeof value !== "string" || !identifierPattern.test(value))) {
    failures.push(`Invalid transaction relation identifier: ${JSON.stringify(relation)}`);
    continue;
  }
  if (relation.constraint.length > 63) {
    failures.push(`Constraint exceeds PostgreSQL's 63-byte limit: ${relation.constraint}`);
  }
  if (constraints.has(relation.constraint)) {
    failures.push(`Duplicate transaction constraint: ${relation.constraint}`);
  }
  constraints.add(relation.constraint);

  const childKey = `${relation.childTable}.${relation.childColumn}`;
  if (childColumns.has(childKey)) {
    failures.push(`Transaction child column has multiple parents: ${childKey}`);
  }
  childColumns.add(childKey);

  if (!schemaSource.includes(`name: "${relation.constraint}"`)) {
    failures.push(`Drizzle schema is missing transaction constraint: ${relation.constraint}`);
  }
}

const migrationRelations = [
  ...migration.matchAll(/\('([^']+)', '([^']+)', '([^']+)', '([^']+)', '([^']+)'\)/gu),
].map((match) => match.slice(1).join("|"));
const manifestRelations = (manifest.relations ?? []).map((relation) =>
  [
    relation.constraint,
    relation.childTable,
    relation.childColumn,
    relation.parentTable,
    relation.parentColumn,
  ].join("|"),
);

if (migrationRelations.join("\n") !== manifestRelations.join("\n")) {
  failures.push("0141 transaction relation tuples do not exactly match the manifest.");
}
if (!migration.includes("ON DELETE NO ACTION ON UPDATE NO ACTION NOT VALID")) {
  failures.push("0141 must add transaction foreign keys as NO ACTION NOT VALID.");
}

if (failures.length > 0) {
  console.error("Transaction relation verification failed.");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Transaction relations verified: ${manifestRelations.length} managed constraints.`);
