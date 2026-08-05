// Step 3 runner: execute one or more experiment groups for real (DeepSeek + DB)
// behind a cost-approval gate, streaming each result to a JSONL file so a crash
// never loses finished work.
//
// Run (from repo root, with the local test DB):
//   export DATABASE_URL="postgresql://<user>@localhost:5432/haggle_negolab"
//   npx tsx nego-lab/src/run.ts --group A --repeat 3
//   npx tsx nego-lab/src/run.ts --group all --yes        # skip the prompt
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { estimateRun, formatDuration, USD_PER_ROUND_CALL } from "./cost.js";
import { closeLabContext, createLabContext } from "./harness.js";
import { runNegotiation } from "./run-negotiation.js";
import { expandGroups, GROUPS } from "./scenarios.js";
import type { NegotiationResult, ScenarioCase } from "./types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(HERE, "..", "results");

interface Args {
  group: string;
  repeat: number;
  yes: boolean;
  limit: number; // 0 = no cap; else stop after N negotiations (for cheap smoke tests)
}

function parseArgs(argv: string[]): Args {
  let group = "all";
  let repeat = 1;
  let yes = false;
  let limit = 0;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--group" || arg === "-g") group = argv[++i] ?? group;
    else if (arg === "--repeat" || arg === "-r") repeat = Number(argv[++i] ?? repeat);
    else if (arg === "--yes" || arg === "-y") yes = true;
    else if (arg === "--limit" || arg === "-l") limit = Number(argv[++i] ?? limit);
  }
  if (!Number.isFinite(repeat) || repeat < 1) repeat = 1;
  if (!Number.isFinite(limit) || limit < 0) limit = 0;
  return { group, repeat, yes, limit };
}

const money = (minor: number | null): string =>
  minor != null ? `$${(minor / 100).toFixed(2)}` : "—";

/** Full round-by-round dump so a human can audit exactly what the LLM did. */
function printDetail(result: NegotiationResult): void {
  const tokens = result.transcript.reduce((a, r) => a + (r.llmTokensUsed ?? 0), 0);
  console.log(`\n${"─".repeat(72)}`);
  console.log(
    `CASE ${result.caseId}  #${result.repeatIndex}   [group ${result.group}]  ${result.label ?? ""}`,
  );
  console.log(
    `  setup: seller=${result.sellerAgent}  buyer=${result.buyerAgent}  ` +
      `ask=$${result.askPrice} floor=$${result.floorPrice}  ` +
      `budget=$${result.budgetMax} target=$${result.targetPrice}`,
  );
  console.log(`  attributes: ${JSON.stringify(result.attributes)}`);
  console.log(
    `  outcome: ${result.outcome}  final=${result.finalPrice != null ? `$${result.finalPrice}` : "—"}  ` +
      `rounds=${result.rounds}  tokens=${tokens}  est=$${(tokens > 0 ? result.rounds * USD_PER_ROUND_CALL : 0).toFixed(2)}  ` +
      `time=${formatDuration(result.durationMs / 1000)}`,
  );
  if (result.error) console.log(`  ERROR: ${result.error}`);
  if (result.transcript.length) {
    console.log(`  transcript:`);
    for (const r of result.transcript) {
      const price = money(r.priceMinor);
      const counter = r.counterPriceMinor != null ? ` counter=${money(r.counterPriceMinor)}` : "";
      const tok = r.llmTokensUsed != null ? ` ${r.llmTokensUsed}tok` : "";
      console.log(
        `    r${r.roundNo} ${r.senderRole.padEnd(6)} ${r.messageType.padEnd(7)} ` +
          `${price}${counter} → ${r.decision ?? "-"}${tok}`,
      );
      if (r.message) console.log(`         "${r.message}"`);
    }
  }
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

function summarize(results: NegotiationResult[]): void {
  const byGroup = new Map<string, NegotiationResult[]>();
  for (const r of results) {
    const list = byGroup.get(r.group) ?? [];
    list.push(r);
    byGroup.set(r.group, list);
  }
  console.log(`\n=== SUMMARY ===`);
  for (const [key, list] of byGroup) {
    const title = GROUPS.find((g) => g.key === key)?.title ?? "";
    const accepted = list.filter((r) => r.outcome === "ACCEPTED");
    const errors = list.filter((r) => r.error);
    const prices = accepted.map((r) => r.finalPrice ?? 0).filter((p) => p > 0);
    const avgPrice = prices.length
      ? (prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2)
      : "—";
    const avgRounds = list.length
      ? (list.reduce((a, b) => a + b.rounds, 0) / list.length).toFixed(1)
      : "—";
    console.log(
      `  [${key}] ${title}\n` +
        `      runs=${list.length}  accepted=${accepted.length}  errors=${errors.length}  ` +
        `avgPrice=$${avgPrice}  avgRounds=${avgRounds}`,
    );
  }
  // Aggregate cost audit across everything run.
  const totalRounds = results.reduce((a, r) => a + r.rounds, 0);
  const totalTokens = results.reduce(
    (a, r) => a + r.transcript.reduce((s, x) => s + (x.llmTokensUsed ?? 0), 0),
    0,
  );
  console.log(
    `  ── totals: negotiations=${results.length}  rounds=${totalRounds}  ` +
      `tokens=${totalTokens}  est.cost=$${(totalRounds * USD_PER_ROUND_CALL).toFixed(2)}`,
  );
}

async function main() {
  const { group, repeat, yes, limit } = parseArgs(process.argv.slice(2));

  let cases: ScenarioCase[];
  try {
    cases = expandGroups(group);
  } catch (err) {
    console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}\n`);
    console.error("Available groups:");
    for (const g of GROUPS) console.error(`  ${g.key}  ${g.title}`);
    console.error("  all  (every group)\n");
    process.exit(1);
  }

  // Flatten to a task list (case × repeat), then optionally cap for a cheap smoke.
  let tasks = cases.flatMap((c) => Array.from({ length: repeat }, (_, rep) => ({ c, rep })));
  if (limit > 0) tasks = tasks.slice(0, limit);

  const est = estimateRun(
    tasks.map((t) => t.c),
    1,
  );
  console.log(`\n=== RUN PLAN ===`);
  console.log(`  groups: ${group}   repeat: ${repeat}${limit > 0 ? `   limit: ${limit}` : ""}`);
  console.log(
    `  negotiations:     ${tasks.length}${limit > 0 ? `  (capped by --limit ${limit})` : ""}`,
  );
  console.log(`  max DeepSeek calls: ${est.maxRoundCalls}  (≤8 rounds each)`);
  console.log(
    `  est. cost:        ~$${est.estUsd.toFixed(2)}  (at $${USD_PER_ROUND_CALL}/round, upper bound)`,
  );
  console.log(`  est. wall time:   ~${formatDuration(est.estSeconds)}  (sequential)`);

  if (!yes) {
    const ok = await confirm(`\nThis WILL call DeepSeek and cost money. Proceed? [y/N] `);
    if (!ok) {
      console.log("Aborted. Nothing was run.\n");
      process.exit(0);
    }
  }

  mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = join(RESULTS_DIR, `${stamp}.jsonl`);
  console.log(`\nWriting results to: ${outPath}\n`);

  const ctx = await createLabContext();
  const results: NegotiationResult[] = [];
  try {
    let done = 0;
    for (const { c, rep } of tasks) {
      done++;
      console.log(`\n[${done}/${tasks.length}] running ${c.id}${repeat > 1 ? ` #${rep}` : ""} …`);
      const result = await runNegotiation(ctx, c, rep);
      results.push(result);
      appendFileSync(outPath, `${JSON.stringify(result)}\n`);
      printDetail(result); // full audit dump per negotiation
    }
  } finally {
    await closeLabContext(ctx);
  }

  summarize(results);
  console.log(`\nSaved ${results.length} results to ${outPath}\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("run FAILED:", err);
  process.exit(1);
});
