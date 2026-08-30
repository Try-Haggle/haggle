import "./lock-env.js";

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { formatLlmSpend, type LlmSpendSnapshot } from "../../../apps/api/src/lib/llm-cost.js";
import { setRetailMsrpSkillMode } from "../../../apps/api/src/negotiation/skills/retail-msrp-skill.js";
import { estimateRun, formatDuration } from "../../src/cost.js";
import { closeLabContext, createLabContext } from "../../src/harness.js";
import { expandGroups } from "../../src/scenarios.js";
import type { NegotiationResult } from "../../src/types.js";
import { runOne } from "./run-one.js";

const lockedUrl = (globalThis as { __fewshotLabDatabaseUrl?: string }).__fewshotLabDatabaseUrl;
if (lockedUrl) process.env.DATABASE_URL = lockedUrl;

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const RESULTS_DIR = join(ROOT, "results");

function arg(name: string, fallback: string): string {
  const idx = process.argv.findIndex((a) => a === `--${name}` || a === `-${name[0]}`);
  if (idx >= 0 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith("-")) {
    return process.argv[idx + 1];
  }
  return fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`) || process.argv.includes(`-${name[0]}`);
}

function money(v: number | null): string {
  return v == null ? "—" : `$${v.toFixed(2)}`;
}

function tokenSum(r: NegotiationResult): number {
  if (r.spend) return r.spend.promptTokens + r.spend.completionTokens;
  return (r.transcript ?? []).reduce((n, t) => n + (t.llmTokensUsed ?? 0), 0);
}

function spendSum(rows: NegotiationResult[]): LlmSpendSnapshot {
  return rows.reduce<LlmSpendSnapshot>(
    (acc, r) => {
      const s = r.spend;
      if (!s) return acc;
      return {
        calls: acc.calls + s.calls,
        promptTokens: acc.promptTokens + s.promptTokens,
        completionTokens: acc.completionTokens + s.completionTokens,
        cacheHitTokens: acc.cacheHitTokens + s.cacheHitTokens,
        cacheMissTokens: acc.cacheMissTokens + s.cacheMissTokens,
        usd: acc.usd + s.usd,
        peakCalls: acc.peakCalls + s.peakCalls,
        model: s.model || acc.model,
      };
    },
    {
      calls: 0,
      promptTokens: 0,
      completionTokens: 0,
      cacheHitTokens: 0,
      cacheMissTokens: 0,
      usd: 0,
      peakCalls: 0,
      model: "",
    },
  );
}

async function main(): Promise<void> {
  const group = arg("group", "D");
  const repeat = Math.max(1, Number(arg("repeat", "1")) || 1);
  const retailAb = hasFlag("retail-ab");
  const variants = retailAb ? (["no-retail", "retail-msrp"] as const) : (["staging"] as const);
  const cases = expandGroups(group);
  const est = estimateRun(cases, repeat * variants.length);

  console.log(
    `스테이징 경로  ·  group ${group}  ·  ${cases.length} cases × ${repeat} × ${variants.join("/")}`,
  );
  console.log("publishDraft + 태그 가든 + start + auto-play + Decide 카드 on. fewshot.md 없음.");
  if (retailAb) {
    console.log(
      "A/B: no-retail = 신제품 시세 스킬 끔 · retail-msrp = 해당 제품 용량별 신제품 MSRP를 Market에만.",
    );
  }
  console.log(
    `협상 ${est.negotiations}건  ·  상한 약 $${est.estUsd.toFixed(2)}  ·  ${formatDuration(est.estSeconds)}`,
  );
  for (const c of cases) {
    console.log(
      `  - ${c.id}  ${c.label}  ${c.item.title}  ask $${c.item.askPrice} / floor $${c.item.floorPrice}  budget $${c.buyer.budgetMax} target $${c.buyer.targetPrice}`,
    );
  }

  if (hasFlag("dry-run") || hasFlag("estimate")) {
    console.log("dry-run. DeepSeek를 호출하지 않았습니다.");
    return;
  }

  if (!(process.env.DATABASE_URL ?? "").includes("haggle_negolab")) {
    throw new Error("export DATABASE_URL to the local haggle_negolab DB first.");
  }

  if (!hasFlag("yes")) {
    const rl = createInterface({ input, output });
    const answer = await rl.question("실행할까요? [y/N] ");
    rl.close();
    if (answer.trim().toLowerCase() !== "y") {
      console.log("취소. DeepSeek를 호출하지 않았습니다.");
      return;
    }
  }

  mkdirSync(RESULTS_DIR, { recursive: true });
  const jobId = `staging-${group}-${new Date().toISOString().replace(/[:.]/g, "")}`;
  const outPath = join(RESULTS_DIR, `${jobId}.jsonl`);
  const results: NegotiationResult[] = [];
  const ctx = await createLabContext();

  try {
    for (const variant of variants) {
      setRetailMsrpSkillMode(variant === "no-retail" ? "off" : "on");
      for (const c of cases) {
        for (let i = 0; i < repeat; i++) {
          const row = await runOne(ctx, c, variant, i);
          results.push(row);
          appendFileSync(outPath, `${JSON.stringify(row)}\n`);
          const spend = row.spend ? formatLlmSpend(row.spend) : `tokens=${tokenSum(row)}`;
          console.log(`${variant}  ${c.label}  ${row.outcome}  ${money(row.finalPrice)}  ${spend}`);
        }
      }
    }
  } finally {
    setRetailMsrpSkillMode("on");
    await closeLabContext(ctx);
  }

  const tokens = results.reduce((n, r) => n + tokenSum(r), 0);
  const rounds = results.reduce((n, r) => n + (r.rounds ?? 0), 0);
  const spend = spendSum(results);
  writeFileSync(
    join(RESULTS_DIR, `${jobId}.summary.json`),
    JSON.stringify({ results, tokens, rounds, variants, spend }, null, 2),
  );
  console.log(`\n저장: ${outPath}`);
  console.log(`라운드 ${rounds}  ·  ${formatLlmSpend(spend)}`);
  if (retailAb) printRetailCompare(results);
}

function printRetailCompare(results: NegotiationResult[]): void {
  const byKey = new Map<string, NegotiationResult[]>();
  for (const r of results) {
    const key = `${r.group}:${r.attributes?.storage ?? r.caseId}`;
    const list = byKey.get(key) ?? [];
    list.push(r);
    byKey.set(key, list);
  }
  console.log("\n비교 (no-retail → retail-msrp)");
  for (const [key, rows] of byKey) {
    const off = rows.find((r) => r.caseId.endsWith(":no-retail"));
    const on = rows.find((r) => r.caseId.endsWith(":retail-msrp"));
    if (!off || !on) continue;
    console.log(
      `  ${key}  ${off.outcome} ${money(off.finalPrice)}  →  ${on.outcome} ${money(on.finalPrice)}`,
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
