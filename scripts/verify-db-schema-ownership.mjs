import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const dbDir = join(root, "packages", "db");
const schemaDir = join(dbDir, "src", "schema");
const migrationDir = join(dbDir, "drizzle");
const ownershipPath = join(dbDir, "schema-ownership.json");
const configPath = join(dbDir, "drizzle.config.ts");
const indexPath = join(schemaDir, "index.ts");
const journalPath = join(migrationDir, "meta", "_journal.json");

const ownership = JSON.parse(readFileSync(ownershipPath, "utf8"));
const journal = JSON.parse(readFileSync(journalPath, "utf8"));
const failures = [];

function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/--.*$/gmu, "");
}

function identifier(match, quotedIndex, bareIndex) {
  return match[quotedIndex] ?? match[bareIndex];
}

function sorted(values) {
  return [...values].sort();
}

function sameValues(left, right) {
  return sorted(left).join("\n") === sorted(right).join("\n");
}

const declarations = new Map();
const schemaFiles = readdirSync(schemaDir)
  .filter((entry) => entry.endsWith(".ts") && entry !== "index.ts")
  .sort();

for (const file of schemaFiles) {
  const source = readFileSync(join(schemaDir, file), "utf8");
  for (const match of source.matchAll(/pgTable\(\s*["'`]([^"'`]+)/gu)) {
    const table = match[1];
    const existing = declarations.get(table);
    if (existing) failures.push(`Table ${table} is declared in both ${existing} and ${file}.`);
    else declarations.set(table, file);
  }
}

const createdTables = new Set();
const createHistory = new Map();
const observedRenames = new Map();
const createPattern =
  /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(?:"public"|public)\.)?(?:"([A-Za-z_][A-Za-z0-9_]*)"|([A-Za-z_][A-Za-z0-9_]*))/giu;
const renamePattern =
  /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:"([A-Za-z_][A-Za-z0-9_]*)"|([A-Za-z_][A-Za-z0-9_]*))\s+RENAME\s+TO\s+(?:"([A-Za-z_][A-Za-z0-9_]*)"|([A-Za-z_][A-Za-z0-9_]*))/giu;

for (const entry of journal.entries ?? []) {
  if (typeof entry?.tag !== "string") continue;
  const sqlPath = join(migrationDir, `${entry.tag}.sql`);
  const sql = stripSqlComments(readFileSync(sqlPath, "utf8"));

  for (const match of sql.matchAll(createPattern)) {
    const table = identifier(match, 1, 2);
    createdTables.add(table);
    const history = createHistory.get(table) ?? [];
    history.push(entry.tag);
    createHistory.set(table, history);
  }

  for (const match of sql.matchAll(renamePattern)) {
    const from = identifier(match, 1, 2);
    const to = identifier(match, 3, 4);
    observedRenames.set(from, to);
    if (!createdTables.delete(from)) {
      failures.push(`Migration ${entry.tag} renames unknown table ${from} to ${to}.`);
      continue;
    }
    createdTables.add(to);
    const history = createHistory.get(from) ?? [];
    createHistory.delete(from);
    createHistory.set(to, history);
  }
}

const expectedRenames = new Map(Object.entries(ownership.expectedRenames ?? {}));
if (!sameValues(observedRenames.keys(), expectedRenames.keys())) {
  failures.push("Observed migration rename sources do not match schema-ownership.json.");
}
for (const [from, to] of expectedRenames) {
  if (observedRenames.get(from) !== to) {
    failures.push(`Expected table rename ${from} -> ${to} was not found.`);
  }
}

const allowedRepeatedCreates = ownership.allowedRepeatedCreates ?? {};
const repeatedCreates = new Map(
  [...createHistory].filter(([, migrations]) => migrations.length > 1),
);
if (!sameValues(repeatedCreates.keys(), Object.keys(allowedRepeatedCreates))) {
  failures.push("Repeated CREATE TABLE names do not match the historical allowlist.");
}
for (const [table, migrations] of repeatedCreates) {
  const allowed = allowedRepeatedCreates[table] ?? [];
  if (!sameValues(migrations, allowed)) {
    failures.push(`Repeated CREATE TABLE history for ${table} changed: ${migrations.join(", ")}.`);
  }
}

const rawSqlTables = [];
for (const domain of ownership.rawSqlOwnedDomains ?? []) {
  if (!domain.domain || !domain.owner || !Array.isArray(domain.tables)) {
    failures.push("Every raw SQL domain must include domain, owner, and tables.");
    continue;
  }
  rawSqlTables.push(...domain.tables);
}
const duplicateRawTables = rawSqlTables.filter(
  (table, index) => rawSqlTables.indexOf(table) !== index,
);
if (duplicateRawTables.length) {
  failures.push(
    `Raw SQL tables have multiple owners: ${sorted(new Set(duplicateRawTables)).join(", ")}.`,
  );
}

const migrationOnlyTables = sorted([...createdTables].filter((table) => !declarations.has(table)));
if (!sameValues(migrationOnlyTables, rawSqlTables)) {
  const unknown = migrationOnlyTables.filter((table) => !rawSqlTables.includes(table));
  const stale = rawSqlTables.filter((table) => !migrationOnlyTables.includes(table));
  if (unknown.length) failures.push(`Migration-only tables lack an owner: ${unknown.join(", ")}.`);
  if (stale.length) failures.push(`Raw SQL ownership entries are stale: ${stale.join(", ")}.`);
}

const schemaOnlyTables = sorted(
  [...declarations.keys()].filter((table) => !createdTables.has(table)),
);
if (schemaOnlyTables.length) {
  failures.push(`Drizzle tables lack a migration: ${schemaOnlyTables.join(", ")}.`);
}

const configuredFiles = new Set(
  [...readFileSync(configPath, "utf8").matchAll(/"\.\/dist\/schema\/([^"\n]+\.js)"/gu)].map(
    (match) => match[1].replace(/\.js$/u, ".ts"),
  ),
);
const tableSchemaFiles = new Set(declarations.values());
const missingConfigFiles = sorted(
  [...tableSchemaFiles].filter((file) => !configuredFiles.has(file)),
);
const staleConfigFiles = sorted([...configuredFiles].filter((file) => !tableSchemaFiles.has(file)));
if (missingConfigFiles.length) {
  failures.push(`Drizzle config omits schema files: ${missingConfigFiles.join(", ")}.`);
}
if (staleConfigFiles.length) {
  failures.push(`Drizzle config has stale schema files: ${staleConfigFiles.join(", ")}.`);
}

const indexSource = readFileSync(indexPath, "utf8")
  .replace(/\/\*[\s\S]*?\*\//gu, "")
  .replace(/\/\/.*$/gmu, "");
const exportedFiles = new Set(
  [...indexSource.matchAll(/from\s+["']\.\/([^"']+)\.js["']/gu)].map((match) => `${match[1]}.ts`),
);
const missingExports = sorted([...tableSchemaFiles].filter((file) => !exportedFiles.has(file)));
if (missingExports.length) {
  failures.push(`Schema barrel omits table files: ${missingExports.join(", ")}.`);
}

if (failures.length) {
  console.error("DB schema ownership verification failed.");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `DB schema ownership verified: ${createdTables.size} migration tables, ` +
    `${declarations.size} Drizzle tables, ${rawSqlTables.length} raw SQL tables.`,
);
