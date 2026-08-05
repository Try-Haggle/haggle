// Dry-run: expand experiment groups and PRINT what would run — case list,
// counts, and an upper-bound cost/time estimate. Spends NOTHING: no DB, no
// DeepSeek, no server. This is the "look before you pay" preview.
//
// Run (from repo root):
//   npx tsx nego-lab/src/dry-run.ts --group A
//   npx tsx nego-lab/src/dry-run.ts --group A,B --repeat 3
//   npx tsx nego-lab/src/dry-run.ts --group all
import { estimateRun, formatDuration, USD_PER_ROUND_CALL } from "./cost.js";
import { expandGroups, GROUPS } from "./scenarios.js";
import type { ScenarioCase } from "./types.js";

interface Args {
  group: string;
  repeat: number;
}

function parseArgs(argv: string[]): Args {
  let group = "all";
  let repeat = 1;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--group" || arg === "-g") group = argv[++i] ?? group;
    else if (arg === "--repeat" || arg === "-r") repeat = Number(argv[++i] ?? repeat);
  }
  if (!Number.isFinite(repeat) || repeat < 1) repeat = 1;
  return { group, repeat };
}

function main() {
  const { group, repeat } = parseArgs(process.argv.slice(2));

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

  console.log(`\n=== DRY RUN (no negotiations, no cost) ===`);
  console.log(`groups: ${group}   repeat: ${repeat}\n`);

  // Group breakdown.
  const byGroup = new Map<string, number>();
  for (const c of cases) byGroup.set(c.group, (byGroup.get(c.group) ?? 0) + 1);
  for (const [key, count] of byGroup) {
    const title = GROUPS.find((g) => g.key === key)?.title ?? "";
    console.log(`  [${key}] ${title} — ${count} cases`);
  }

  // Per-case listing.
  console.log(`\n--- cases (${cases.length}) ---`);
  for (const c of cases) {
    const attrs = Object.entries(c.item.attributes)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    console.log(
      `  ${c.id}\n` +
        `    ${c.label ?? ""}\n` +
        `    seller=${c.seller.agent}  buyer=${c.buyer.agent} ` +
        `(budget ${c.buyer.budgetMax}, target ${c.buyer.targetPrice}, ` +
        `deadline ${c.buyer.deadlineHours ?? 48}h)\n` +
        `    ask ${c.item.askPrice} / floor ${c.item.floorPrice}  [${attrs}]`,
    );
  }

  // Cost + time estimate.
  const est = estimateRun(cases, repeat);
  console.log(`\n--- estimate (upper bound) ---`);
  console.log(`  negotiations:     ${est.negotiations}  (${est.cases} cases × ${repeat})`);
  console.log(`  max DeepSeek calls: ${est.maxRoundCalls}  (≤8 rounds each)`);
  console.log(
    `  est. cost:        ~$${est.estUsd.toFixed(2)}  ` +
      `(at $${USD_PER_ROUND_CALL}/round measured, upper bound)`,
  );
  console.log(`  est. wall time:   ~${formatDuration(est.estSeconds)}  (sequential)`);
  console.log(`\nNothing was run. To execute, use the runner (Step 3).\n`);
}

main();
