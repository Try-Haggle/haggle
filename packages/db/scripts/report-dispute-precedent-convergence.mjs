import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { evaluateDisputePrecedentConvergence } from "./lib/dispute-precedent-convergence.mjs";

const inputFlag = process.argv.find((argument) => argument.startsWith("--manifest="));
const OUTCOMES = new Set([
  "buyer_favor",
  "seller_favor",
  "partial_refund",
  "no_action",
  "escalate",
]);
const manifestPath = inputFlag?.slice("--manifest=".length);
if (!manifestPath) {
  console.error("--manifest=<path> is required for dispute precedent convergence reporting.");
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required for dispute precedent convergence reporting.");
  process.exit(2);
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const startedAt = Date.parse(manifest.started_at);
const endedAt = manifest.ended_at === undefined ? undefined : Date.parse(manifest.ended_at);
if (
  manifest.schema_version !== "dispute-precedent-convergence-manifest-v1" ||
  !Array.isArray(manifest.cases) ||
  manifest.cases.length === 0 ||
  typeof manifest.started_at !== "string" ||
  !Number.isFinite(startedAt) ||
  (manifest.ended_at !== undefined &&
    (typeof manifest.ended_at !== "string" || !Number.isFinite(endedAt) || endedAt <= startedAt)) ||
  (manifest.required_repeats !== undefined &&
    (!Number.isInteger(manifest.required_repeats) || manifest.required_repeats < 2))
) {
  console.error("Invalid convergence manifest.");
  process.exit(2);
}

const seenCaseKeys = new Set();
const seenDisputeIds = new Set();
for (const testCase of manifest.cases) {
  if (
    typeof testCase.case_key !== "string" ||
    !/^[a-z0-9][a-z0-9_-]{2,63}$/i.test(testCase.case_key) ||
    typeof testCase.dispute_id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      testCase.dispute_id,
    ) ||
    typeof testCase.reason_code !== "string" ||
    !OUTCOMES.has(testCase.expected_outcome)
  ) {
    console.error("Invalid case entry in convergence manifest.");
    process.exit(2);
  }
  if (seenCaseKeys.has(testCase.case_key) || seenDisputeIds.has(testCase.dispute_id)) {
    console.error("Convergence manifest case keys and dispute IDs must be unique.");
    process.exit(2);
  }
  seenCaseKeys.add(testCase.case_key);
  seenDisputeIds.add(testCase.dispute_id);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
const cases = [];
try {
  for (const testCase of manifest.cases) {
    const disputes = await sql`
      SELECT reason_code
        FROM dispute_cases
       WHERE id = ${testCase.dispute_id}::uuid
       LIMIT 1
    `;
    if (disputes.length !== 1) {
      throw new Error(`Convergence case not found: ${testCase.case_key}`);
    }
    if (disputes[0].reason_code !== testCase.reason_code) {
      throw new Error(`Convergence case reason mismatch: ${testCase.case_key}`);
    }
    const events = manifest.ended_at
      ? await sql`
          SELECT payload
            FROM dispute_ai_assessment_events
           WHERE dispute_id = ${testCase.dispute_id}::uuid
             AND event_type = 'COMPLETED'
             AND created_at >= ${manifest.started_at}::timestamptz
             AND created_at <= ${manifest.ended_at}::timestamptz
           ORDER BY created_at ASC, revision ASC NULLS LAST
        `
      : await sql`
          SELECT payload
            FROM dispute_ai_assessment_events
           WHERE dispute_id = ${testCase.dispute_id}::uuid
             AND event_type = 'COMPLETED'
             AND created_at >= ${manifest.started_at}::timestamptz
           ORDER BY created_at ASC, revision ASC NULLS LAST
        `;
    cases.push({
      case_key: testCase.case_key,
      reason_code: testCase.reason_code,
      expected_outcome: testCase.expected_outcome,
      runs: events.map((event) => event.payload),
    });
  }
} finally {
  await sql.end();
}

const report = evaluateDisputePrecedentConvergence(cases, {
  requiredRepeats: manifest.required_repeats ?? 3,
});
console.log(JSON.stringify({ wave: manifest.wave ?? "unnamed", ...report }, null, 2));
if (process.argv.includes("--require-pass") && !report.pass) process.exitCode = 1;
