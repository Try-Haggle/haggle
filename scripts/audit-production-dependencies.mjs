import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const baselinePath = fileURLToPath(new URL("../.security/audit-baseline.json", import.meta.url));
const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));

const audit = spawnSync("pnpm", ["audit", "--prod", "--json"], {
  encoding: "utf8",
  maxBuffer: 100 * 1024 * 1024,
});

let report;
try {
  report = JSON.parse(audit.stdout);
} catch {
  console.error("Could not parse pnpm audit output. The security gate fails closed.");
  if (audit.stderr) console.error(audit.stderr.trim());
  process.exit(1);
}

const advisories = Object.entries(report.advisories ?? {}).map(([id, value]) => ({
  id,
  moduleName: value.module_name,
  severity: value.severity,
  title: value.title,
}));
const blocking = advisories.filter(
  ({ severity }) => severity === "critical" || severity === "high",
);
const today = process.env.SECURITY_AUDIT_DATE ?? new Date().toISOString().slice(0, 10);
const failures = [];

for (const advisory of blocking) {
  if (advisory.severity === "critical") {
    failures.push(`${advisory.id} critical ${advisory.moduleName}: ${advisory.title}`);
    continue;
  }

  const exception = baseline.advisories?.[advisory.id];
  if (!exception) {
    failures.push(`${advisory.id} NEW high ${advisory.moduleName}: ${advisory.title}`);
    continue;
  }
  if (exception.package !== advisory.moduleName) {
    failures.push(
      `${advisory.id} baseline package mismatch: expected ${exception.package}, found ${advisory.moduleName}`,
    );
    continue;
  }
  if (today > exception.expires) {
    failures.push(
      `${advisory.id} expired on ${exception.expires} (${advisory.moduleName}): ${advisory.title}`,
    );
  }
}

const activeIds = new Set(advisories.map(({ id }) => id));
const cleared = Object.keys(baseline.advisories ?? {}).filter((id) => !activeIds.has(id));
const counts = report.metadata?.vulnerabilities ?? {};

console.log(
  `Production dependency audit: ${counts.critical ?? 0} critical, ${counts.high ?? 0} high, ${counts.moderate ?? 0} moderate, ${counts.low ?? 0} low.`,
);
console.log(
  `Temporary high-severity exceptions expire individually; new high and every critical advisory fail immediately. Audit date: ${today}.`,
);
if (cleared.length > 0) {
  console.log(`Cleared baseline advisories (remove from baseline): ${cleared.join(", ")}`);
}

if (failures.length > 0) {
  console.error("\nDependency security gate failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Security gate passed with ${blocking.length} tracked high/critical advisories.`);
