/**
 * Fake Listing Test — 실제 중고거래 글처럼 작성 + 예상 태그 vs 실제 결과 비교
 *
 * Usage:
 *   npx tsx apps/api/src/scripts/test-fake-listings.ts
 */

import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(import.meta.dirname, "../../.env") });
config({ path: resolve(import.meta.dirname, "../../../../.env"), override: false });

import {
  placeTagsWithLlm,
  type LlmPlacementInput,
} from "../services/tag-placement-llm.service.js";
import type { TagCandidate } from "../services/tag-candidate.service.js";

// ─── Types ───────────────────────────────────────────────

interface TestListing {
  name: string;
  input: LlmPlacementInput;
  expectedProposals: string[];
  expectedReasoning: string;
}

// ─── Helpers ─────────────────────────────────────────────

function makeCand(id: string, label: string, idf: number): TagCandidate {
  return {
    id,
    label,
    normalizedLabel: label.toLowerCase().replace(/\s+/g, "-"),
    idf,
    parentIds: [],
    source: ["idf"],
  };
}

function overlapScore(expected: string[], actual: string[]): {
  matched: string[];
  missed: string[];
  unexpected: string[];
  score: string;
} {
  const actualSet = new Set(actual.map((a) => a.toLowerCase()));
  const expectedSet = new Set(expected.map((e) => e.toLowerCase()));
  const matched = expected.filter((e) => actualSet.has(e.toLowerCase()));
  const missed = expected.filter((e) => !actualSet.has(e.toLowerCase()));
  const unexpected = actual.filter((a) => !expectedSet.has(a.toLowerCase()));
  const total = new Set([...expected, ...actual]).size;
  const pct = total > 0 ? Math.round((matched.length / total) * 100) : 100;
  return { matched, missed, unexpected, score: `${matched.length}/${expected.length} (${pct}%)` };
}

// ─── Test Listings ───────────────────────────────────────

const listings: TestListing[] = [
  {
    name: "AirPods Max — 실사용자 후기",
    input: {
      title: "AirPods Max Silver - barely used, with Smart Case",
      description:
        "Selling my AirPods Max in Silver. Bought from Apple Store 4 months ago. " +
        "Used maybe 10 times total - I just prefer in-ear buds. " +
        "Active Noise Cancellation works flawlessly, spatial audio is incredible for movies. " +
        "Digital Crown and top button work perfectly. Lightning charging cable included. " +
        "Comes with the original Smart Case (has a small scuff on one side, barely noticeable). " +
        "Battery easily lasts 15+ hours. No AppleCare but well within warranty period. " +
        "Will ship in original box with all accessories. Pickup also available in SF Bay Area.",
      category: "Headphones",
      priceBand: "$200-$500",
      candidates: [
        makeCand("t01", "airpods-max", 5.0),
        makeCand("t02", "apple", 1.2),
        makeCand("t03", "headphones", 0.8),
        makeCand("t04", "wireless", 1.5),
        makeCand("t05", "over-ear", 2.5),
      ],
    },
    expectedProposals: ["silver", "barely-used", "noise-cancelling"],
    expectedReasoning:
      "색상(silver), 상태(barely used), 핵심 기능(ANC)이 후보에 없음. " +
      "Lightning, spatial-audio는 너무 세부적이라 안 나올 수도.",
  },
  {
    name: "MacBook Pro M3 — 개발자가 파는 스타일",
    input: {
      title: 'MacBook Pro 14" M3 Pro 18GB/512GB Space Black - mint condition',
      description:
        "Upgrading to M4 so letting this go. MacBook Pro 14-inch, M3 Pro chip (11-core CPU, 14-core GPU), " +
        "18GB unified memory, 512GB SSD. Space Black. 120 battery cycles, 98% battery health. " +
        "Always used with a case and screen protector (both included). Zero scratches or dents. " +
        "Keyboard and trackpad in perfect condition. Liquid Retina XDR display, no dead pixels. " +
        "Includes original MagSafe charger (67W) + 2m USB-C cable + original box. " +
        "Factory reset, ready for new owner. Can show proof of purchase from Apple. " +
        "Local pickup in Manhattan preferred, will ship CONUS with insurance.",
      category: "Laptops",
      priceBand: "$1000+",
      candidates: [
        makeCand("t01", "macbook-pro", 4.5),
        makeCand("t02", "apple", 1.2),
        makeCand("t03", "laptop", 0.8),
        makeCand("t04", "m3-pro", 4.0),
        makeCand("t05", "14-inch", 2.0),
      ],
    },
    expectedProposals: ["space-black", "512gb", "mint-condition"],
    expectedReasoning:
      "색상(space-black), 저장 용량(512gb), 상태(mint)가 후보에 없음. " +
      "18gb, battery-98%도 가능하지만 3개 제한이라 핵심 3개 우선.",
  },
  {
    name: "Jordan 1 Chicago — 스니커즈 리셀러",
    input: {
      title: "Jordan 1 Retro High OG 'Chicago Lost and Found' Size 9.5 VNDS",
      description:
        "Jordan 1 Chicago Lost and Found DZ5485-612. Size 9.5 US Men's. " +
        "VNDS - tried on indoors once on carpet, soles are clean. " +
        "Cracked paint on midsole is factory intentional (part of the vintage aesthetic). " +
        "Comes with OG all: box, extra laces (black + sail), tissue paper, hang tag. " +
        "Box has the vintage-style crush detailing from factory. " +
        "Purchased from SNKRS on release day, can provide receipt screenshot. " +
        "Price is firm, no trades. Ships double-boxed same day. " +
        "Check my feedback - 50+ transactions all 5 stars.",
      category: "Sneakers",
      priceBand: "$200-$500",
      candidates: [
        makeCand("t01", "jordan-1", 4.8),
        makeCand("t02", "nike", 1.5),
        makeCand("t03", "sneakers", 0.9),
        makeCand("t04", "retro", 2.0),
        makeCand("t05", "mens", 0.8),
      ],
    },
    expectedProposals: ["chicago-lost-and-found", "size-9-5", "vnds"],
    expectedReasoning:
      "컬러웨이(chicago-lost-and-found), 사이즈(9.5), 상태(VNDS)가 핵심 누락. " +
      "high-og도 가능하나 jordan-1이 이미 커버.",
  },
  {
    name: "Sony A7IV — 카메라 동호회 스타일",
    input: {
      title: "Sony A7 IV Body Only - 12k shutter count, extras included",
      description:
        "Selling my Sony A7IV (ILCE-7M4) body only. 33MP full-frame, 4K60 video, " +
        "10fps burst, real-time Eye AF for humans and animals. 759-point phase detection AF. " +
        "Shutter count: ~12,000 (rated for 500k). Sensor and EVF are flawless. " +
        "Small wear mark on bottom plate from L-bracket (see photo #7). " +
        "Comes with: original battery (NP-FZ100) + one extra third-party battery, " +
        "original charger, body cap, hot shoe cover, strap, USB-C cable, original box + manual. " +
        "Reason for selling: switching to Sony A7RV for landscape work. " +
        "No lowballers please. Will consider trades for Canon RF glass.",
      category: "Cameras & Photo",
      priceBand: "$1000+",
      candidates: [
        makeCand("t01", "sony", 1.8),
        makeCand("t02", "a7iv", 5.5),
        makeCand("t03", "mirrorless", 2.5),
        makeCand("t04", "full-frame", 3.0),
        makeCand("t05", "camera", 0.7),
      ],
    },
    expectedProposals: ["body-only", "4k60", "low-shutter-count"],
    expectedReasoning:
      "바디 전용(body-only), 비디오 스펙(4K60), 셔터 카운트가 핵심 구매 요소. " +
      "33mp도 가능하나 full-frame이 이미 해상도 맥락 커버.",
  },
  {
    name: "Herman Miller Aeron — 재택근무 정리",
    input: {
      title: "Herman Miller Aeron Size B - Fully Loaded, Remastered (2021)",
      description:
        "WFH setup downsizing. Herman Miller Aeron Remastered (2021 model), Size B. " +
        "Fully loaded: PostureFit SL, adjustable arms, tilt limiter, forward tilt, " +
        "graphite frame, graphite base, size B for 5'2\" to 6'0\". " +
        "Mesh is clean with no sags or tears. All adjustments work perfectly. " +
        "12-year warranty is transferable - still has 7 years remaining. " +
        "Bought directly from Herman Miller ($1,895 + tax new). " +
        "Local pickup only - I'm in Williamsburg, Brooklyn. Cannot ship (too heavy/fragile). " +
        "Will help load into your car/van.",
      category: "Furniture",
      priceBand: "$500-$1000",
      candidates: [
        makeCand("t01", "herman-miller", 4.5),
        makeCand("t02", "aeron", 5.0),
        makeCand("t03", "office-chair", 2.0),
        makeCand("t04", "ergonomic", 2.5),
        makeCand("t05", "used", 1.0),
      ],
    },
    expectedProposals: ["size-b", "fully-loaded", "remastered"],
    expectedReasoning:
      "사이즈(B), 풀옵션(fully-loaded), 리마스터드 모델 구분이 핵심. " +
      "warranty-transferable도 가능하나 너무 세부적.",
  },
];

// ─── Runner ──────────────────────────────────────────────

async function main() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    console.error("❌ OPENAI_API_KEY not set");
    process.exit(1);
  }
  console.log("🧪 Tag Proposal 정답 비교 테스트\n");

  let totalIn = 0,
    totalOut = 0,
    totalMs = 0;
  const verdicts: string[] = [];

  for (let i = 0; i < listings.length; i++) {
    const { name, input, expectedProposals, expectedReasoning } = listings[i]!;

    console.log(`\n${"═".repeat(72)}`);
    console.log(`  #${i + 1}  ${name}`);
    console.log(`${"═".repeat(72)}`);

    // ── 1. 리스팅 원문 ──
    console.log(`\n  📝 리스팅 원문`);
    console.log(`  ┌─ 제목: "${input.title}"`);
    console.log(`  ├─ 카테고리: ${input.category ?? "(없음)"}`);
    console.log(`  ├─ 가격대: ${input.priceBand ?? "(없음)"}`);
    console.log(`  ├─ 설명:`);
    const words = input.description.split(" ");
    let line = "  │    ";
    for (const w of words) {
      if (line.length + w.length > 85) {
        console.log(line);
        line = "  │    " + w;
      } else {
        line += (line.endsWith("    ") ? "" : " ") + w;
      }
    }
    if (line.trim().length > 1) console.log(line);

    // ── 2. 기존 태그 후보 ──
    console.log(`  │`);
    console.log(
      `  └─ 기존 태그 후보 (${input.candidates.length}): ${input.candidates.map((c) => c.label).join(", ")}`,
    );

    // ── 3. 우리 예상 ──
    console.log(`\n  🎯 예상 (우리가 생각하는 정답)`);
    console.log(`  ├─ 제안될 태그: ${expectedProposals.join(", ")}`);
    console.log(`  └─ 근거: ${expectedReasoning}`);

    // ── 4. LLM 호출 ──
    console.log(`\n  🤖 LLM 호출 중...`);
    const result = await placeTagsWithLlm(input);

    if (!result.ok) {
      console.log(`  ❌ FAILED: ${result.error.code} — ${result.error.message}`);
      verdicts.push("❌ ERROR");
      continue;
    }

    totalIn += result.tokensIn;
    totalOut += result.tokensOut;
    totalMs += result.latencyMs;

    const kept = result.selectedTagIds.map((id) => {
      const c = input.candidates.find((x) => x.id === id);
      return c ? c.label : id;
    });
    const dropped = input.candidates
      .filter((c) => !result.selectedTagIds.includes(c.id))
      .map((c) => c.label);
    const actualLabels = result.proposedTags.map((t) => t.label);

    // ── 5. LLM 결과 ──
    console.log(`\n  📊 LLM 결과 (${result.latencyMs}ms, ${result.tokensIn}+${result.tokensOut} tok)`);
    console.log(`  ├─ 유지 (${kept.length}): ${kept.join(", ")}`);
    if (dropped.length > 0) console.log(`  ├─ 제거 (${dropped.length}): ${dropped.join(", ")}`);
    console.log(`  ├─ reasoning: "${result.reasoning}"`);
    console.log(`  └─ 제안된 새 태그 (${result.proposedTags.length}):`);
    if (result.proposedTags.length === 0) {
      console.log(`     (없음)`);
    } else {
      for (const t of result.proposedTags) {
        console.log(`     • "${t.label}"  [${t.category}]`);
        console.log(`       → ${t.reason}`);
      }
    }

    // ── 6. 예상 vs 실제 비교 ──
    const cmp = overlapScore(expectedProposals, actualLabels);
    console.log(`\n  ⚖️  예상 vs 실제`);
    console.log(`  ├─ 예상:    ${expectedProposals.join(", ")}`);
    console.log(`  ├─ 실제:    ${actualLabels.join(", ")}`);
    console.log(`  ├─ 일치:    ${cmp.matched.length > 0 ? cmp.matched.join(", ") : "(없음)"}`);
    if (cmp.missed.length > 0)
      console.log(`  ├─ 누락:    ${cmp.missed.join(", ")}  ← 예상했는데 안 나옴`);
    if (cmp.unexpected.length > 0)
      console.log(`  ├─ 예상밖:  ${cmp.unexpected.join(", ")}  ← 예상 못했는데 나옴`);
    console.log(`  └─ 매칭률:  ${cmp.score}`);

    // ── 7. 판정 ──
    const pct = cmp.matched.length / Math.max(expectedProposals.length, 1);
    let verdict: string;
    if (pct >= 0.67) verdict = "✅ PASS — 핵심 태그 대부분 일치";
    else if (pct >= 0.33) verdict = "🟡 PARTIAL — 일부 일치, 방향은 맞음";
    else if (cmp.unexpected.length > 0 && cmp.unexpected.length <= 3)
      verdict = "🟡 DIVERGENT — 다르지만 합리적일 수 있음";
    else verdict = "❌ FAIL — 예상과 많이 다름";
    console.log(`\n  ${verdict}`);
    verdicts.push(verdict);
  }

  // ── Summary ──
  const cost = (totalIn * 0.15 + totalOut * 0.6) / 1_000_000;
  console.log(`\n\n${"═".repeat(72)}`);
  console.log(`  최종 결과`);
  console.log(`${"═".repeat(72)}`);
  for (let i = 0; i < listings.length; i++) {
    console.log(`  #${i + 1} ${listings[i]!.name.padEnd(35)} ${verdicts[i]}`);
  }
  console.log(`${"─".repeat(72)}`);
  console.log(`  Tokens: ${totalIn} in + ${totalOut} out = ${totalIn + totalOut}`);
  console.log(`  Time:   ${(totalMs / 1000).toFixed(1)}s  │  Cost: $${cost.toFixed(4)}`);
  console.log(`${"═".repeat(72)}\n`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
