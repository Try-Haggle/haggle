/**
 * Integration test: real OpenAI call with proposed_tags structured output.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... npx tsx apps/api/src/scripts/test-proposed-tags.ts
 */

import { placeTagsWithLlm, type LlmPlacementInput } from "../services/tag-placement-llm.service.js";
import type { TagCandidate } from "../services/tag-candidate.service.js";

// ─── Helpers ─────────────────────────────────────────────

let totalTokensIn = 0;
let totalTokensOut = 0;
let totalLatency = 0;
let scenarioNum = 0;

function makeCand(id: string, label: string, idf: number, parentIds: string[] = []): TagCandidate {
  return {
    id,
    label,
    normalizedLabel: label.toLowerCase().replace(/\s+/g, "-"),
    idf,
    parentIds,
    source: ["idf"],
  };
}

function header(title: string, description: string) {
  scenarioNum++;
  console.log(`\n\n┌${"─".repeat(68)}┐`);
  console.log(`│  #${scenarioNum}  ${title.padEnd(60)}│`);
  console.log(`├${"─".repeat(68)}┤`);
  console.log(`│  ${description.padEnd(66)}│`);
  console.log(`└${"─".repeat(68)}┘`);
}

function printResult(
  result: Awaited<ReturnType<typeof placeTagsWithLlm>>,
  input: LlmPlacementInput,
) {
  if (!result.ok) {
    console.log(`\n  ❌ FAILED: ${result.error.code} — ${result.error.message}`);
    return;
  }

  totalTokensIn += result.tokensIn;
  totalTokensOut += result.tokensOut;
  totalLatency += result.latencyMs;

  // ── Input summary ──
  console.log(`\n  📦 INPUT`);
  console.log(`  ├─ title:    "${input.title}"`);
  console.log(`  ├─ category: ${input.category ?? "(none)"}`);
  console.log(`  ├─ price:    ${input.priceBand ?? "(none)"}`);
  console.log(`  ├─ desc:     "${input.description.slice(0, 80)}${input.description.length > 80 ? "..." : ""}"`);
  console.log(`  └─ candidates (${input.candidates.length}):`);
  for (const c of input.candidates) {
    console.log(`     ${c.id.padEnd(6)} ${c.label.padEnd(28)} idf=${c.idf.toFixed(1)}`);
  }

  // ── LLM response ──
  console.log(`\n  🤖 LLM RESPONSE  (${result.latencyMs}ms, ${result.tokensIn}+${result.tokensOut} tokens)`);

  // Selected
  const selectedLabels = result.selectedTagIds.map((id) => {
    const c = input.candidates.find((x) => x.id === id);
    return c ? `${c.label}` : id;
  });
  console.log(`  ├─ selected (${result.selectedTagIds.length}): ${selectedLabels.join(", ")}`);
  console.log(`  ├─ reasoning: "${result.reasoning}"`);

  // NOT selected
  const notSelected = input.candidates.filter((c) => !result.selectedTagIds.includes(c.id));
  if (notSelected.length > 0) {
    console.log(`  ├─ skipped (${notSelected.length}):  ${notSelected.map((c) => c.label).join(", ")}`);
  }

  // Proposed
  console.log(`  └─ proposed_tags (${result.proposedTags.length}):`);
  if (result.proposedTags.length === 0) {
    console.log(`     (none — candidates fully cover this listing)`);
  } else {
    for (const tag of result.proposedTags) {
      console.log(`     ┌─ label:    "${tag.label}"`);
      console.log(`     ├─ category: ${tag.category}`);
      console.log(`     └─ reason:   "${tag.reason}"`);
    }
  }

  // ── Structural checks ──
  const checks = [
    {
      name: "labels lowercase-hyphenated",
      pass: result.proposedTags.every((t) => t.label === t.label.toLowerCase() && !t.label.includes(" ")),
    },
    {
      name: "categories in enum",
      pass: result.proposedTags.every((t) =>
        ["condition", "style", "size", "material", "feature", "compatibility", "other"].includes(t.category),
      ),
    },
    {
      name: "all reasons non-empty",
      pass: result.proposedTags.every((t) => t.reason.length > 0),
    },
    {
      name: "≤3 proposals",
      pass: result.proposedTags.length <= 3,
    },
    {
      name: "no duplicate of candidate",
      pass: result.proposedTags.every(
        (t) => !input.candidates.some((c) => c.normalizedLabel === t.label),
      ),
    },
  ];
  console.log(`\n  ✅ CHECKS`);
  for (const c of checks) {
    console.log(`  ${c.pass ? "✅" : "❌"} ${c.name}`);
  }
}

// ═══════════════════════════════════════════════════════════
// SCENARIOS
// ═══════════════════════════════════════════════════════════

async function scenario_iPhone() {
  header(
    "iPhone 15 Pro Max — gap: color, eSIM, MagSafe",
    "후보에 기본 스펙만 있고, 색상/eSIM/MagSafe가 빠져 있음",
  );
  const input: LlmPlacementInput = {
    title: "iPhone 15 Pro Max 256GB Natural Titanium Unlocked",
    description:
      "Brand new sealed iPhone 15 Pro Max. 256GB storage, Natural Titanium color. " +
      "Factory unlocked, works with any carrier worldwide. eSIM only (no physical SIM tray). " +
      "Includes original Apple MagSafe charger. Battery health 100%. AppleCare+ eligible.",
    category: "Cell Phones & Smartphones",
    priceBand: "$800-$1200",
    candidates: [
      makeCand("t01", "iphone-15-pro-max", 5.2),
      makeCand("t02", "256gb", 2.1),
      makeCand("t03", "sealed", 3.8),
      makeCand("t04", "unlocked", 2.5),
      makeCand("t05", "apple", 1.2),
      makeCand("t06", "smartphone", 0.8),
      makeCand("t07", "used-like-new", 2.0),
      makeCand("t08", "128gb", 2.0),
    ],
  };
  const result = await placeTagsWithLlm(input);
  printResult(result, input);
}

async function scenario_Jacket() {
  header(
    "1970s Schott Perfecto Leather Jacket — gap: brand, material",
    "빈티지 가죽자켓. 후보에 brand(schott), material(cowhide)이 없음",
  );
  const input: LlmPlacementInput = {
    title: "1970s Schott Perfecto 618 Leather Motorcycle Jacket Size 42",
    description:
      "Authentic vintage Schott Perfecto 618. Size 42, fits like a modern L. " +
      "Black cowhide leather, heavy-duty YKK zippers. Some patina on elbows " +
      "and collar — adds character. Original belt and epaulettes intact. Made in USA.",
    category: "Men's Clothing > Coats & Jackets",
    priceBand: "$200-$500",
    candidates: [
      makeCand("t01", "leather-jacket", 3.0),
      makeCand("t02", "vintage", 2.8),
      makeCand("t03", "size-l", 1.5),
      makeCand("t04", "black", 1.2),
      makeCand("t05", "mens", 0.9),
      makeCand("t06", "outerwear", 0.7),
    ],
  };
  const result = await placeTagsWithLlm(input);
  printResult(result, input);
}

async function scenario_AirPods() {
  header(
    "AirPods Pro 2 USB-C — candidates fully cover",
    "후보가 리스팅을 완전히 커버 → proposed_tags=[] 기대",
  );
  const input: LlmPlacementInput = {
    title: "Apple AirPods Pro 2nd Gen USB-C",
    description: "New sealed AirPods Pro 2nd generation with USB-C charging case.",
    category: "Headphones",
    priceBand: "$100-$200",
    candidates: [
      makeCand("t01", "airpods-pro", 5.5),
      makeCand("t02", "2nd-gen", 3.2),
      makeCand("t03", "usb-c", 2.8),
      makeCand("t04", "sealed", 3.8),
      makeCand("t05", "apple", 1.2),
      makeCand("t06", "wireless-earbuds", 2.0),
      makeCand("t07", "noise-cancelling", 2.5),
      makeCand("t08", "bluetooth", 1.5),
    ],
  };
  const result = await placeTagsWithLlm(input);
  printResult(result, input);
}

async function scenario_GamingPC() {
  header(
    "Custom Gaming PC — gap: many specs not in candidates",
    "GPU/CPU/RAM/SSD 상세 스펙이 후보에 없음. 다수 제안 기대",
  );
  const input: LlmPlacementInput = {
    title: "Custom Gaming PC RTX 4090 i9-14900K 64GB DDR5 2TB NVMe",
    description:
      "Built 2 months ago, barely used. NZXT H7 case, ROG Strix Z790-E motherboard. " +
      "Intel i9-14900K, Corsair Vengeance 64GB DDR5-6000, NVIDIA RTX 4090 Founders Edition. " +
      "2TB Samsung 990 Pro NVMe SSD. Corsair RM1000x PSU. 360mm AIO liquid cooler. " +
      "Windows 11 Pro activated. All original boxes included. RGB everything.",
    category: "Desktop Computers",
    priceBand: "$2000+",
    candidates: [
      makeCand("t01", "gaming-pc", 3.0),
      makeCand("t02", "desktop", 1.5),
      makeCand("t03", "used-like-new", 2.0),
      makeCand("t04", "windows", 1.0),
    ],
  };
  const result = await placeTagsWithLlm(input);
  printResult(result, input);
}

async function scenario_NikeDunks() {
  header(
    "Nike Dunk Low Panda — gap: colorway, size detail",
    "기본 브랜드/모델은 있지만 colorway(panda)와 사이즈가 없음",
  );
  const input: LlmPlacementInput = {
    title: "Nike Dunk Low Retro 'Panda' Black White Size 10.5 DS",
    description:
      "Deadstock Nike Dunk Low Retro in the iconic Panda colorway (Black/White). " +
      "Men's size 10.5 US. Never worn, original box, all laces included. " +
      "Style code DD1391-100. Purchased from Nike SNKRS app.",
    category: "Sneakers",
    priceBand: "$100-$200",
    candidates: [
      makeCand("t01", "nike", 1.5),
      makeCand("t02", "dunk-low", 4.0),
      makeCand("t03", "sneakers", 1.0),
      makeCand("t04", "deadstock", 3.5),
      makeCand("t05", "mens", 0.9),
    ],
  };
  const result = await placeTagsWithLlm(input);
  printResult(result, input);
}

async function scenario_VagueListing() {
  header(
    "Vague listing — minimal info, no category",
    "설명 부실한 리스팅. LLM이 과도한 제안을 안 하는지 확인",
  );
  const input: LlmPlacementInput = {
    title: "Old phone for sale works fine",
    description: "Selling my old phone. It works. Some scratches on the screen. Charger included.",
    category: null,
    priceBand: "$0-$50",
    candidates: [
      makeCand("t01", "used", 1.5),
      makeCand("t02", "smartphone", 0.8),
      makeCand("t03", "charger-included", 2.0),
    ],
  };
  const result = await placeTagsWithLlm(input);
  printResult(result, input);
}

async function scenario_PS5Bundle() {
  header(
    "PS5 Bundle with extras — gap: bundle contents",
    "콘솔+컨트롤러+게임 번들. 후보에 없는 게임 타이틀/액세서리",
  );
  const input: LlmPlacementInput = {
    title: "PS5 Disc Edition Bundle + 2 Controllers + 5 Games",
    description:
      "PlayStation 5 Disc Edition, 825GB. Comes with 2 DualSense controllers (White + Midnight Black). " +
      "Games: Spider-Man 2, God of War Ragnarok, Horizon Forbidden West, Gran Turismo 7, Demon's Souls. " +
      "All discs in perfect condition. Console runs quiet, no coil whine. " +
      "Includes original HDMI cable and power cord. Factory reset, ready to go.",
    category: "Video Game Consoles",
    priceBand: "$400-$600",
    candidates: [
      makeCand("t01", "ps5", 4.5),
      makeCand("t02", "disc-edition", 3.0),
      makeCand("t03", "playstation", 1.5, ["t01"]),
      makeCand("t04", "825gb", 2.0),
      makeCand("t05", "used-good", 1.8),
      makeCand("t06", "gaming-console", 0.9),
    ],
  };
  const result = await placeTagsWithLlm(input);
  printResult(result, input);
}

async function scenario_Korean() {
  header(
    "Korean listing title — 한국어 리스팅",
    "영어가 아닌 입력에서 LLM이 적절히 처리하는지 확인",
  );
  const input: LlmPlacementInput = {
    title: "갤럭시 S24 울트라 512GB 티타늄 그레이 미개봉",
    description:
      "삼성 갤럭시 S24 울트라 512GB 티타늄 그레이. 미개봉 새제품. " +
      "KT 약정 해지 후 공기계. S펜 포함. 한국 정발 모델 SM-S928N.",
    category: "Cell Phones & Smartphones",
    priceBand: "$800-$1200",
    candidates: [
      makeCand("t01", "galaxy-s24-ultra", 5.0),
      makeCand("t02", "512gb", 2.5),
      makeCand("t03", "samsung", 1.3),
      makeCand("t04", "sealed", 3.8),
    ],
  };
  const result = await placeTagsWithLlm(input);
  printResult(result, input);
}

// ─── Main ─────────────────────────────────────────────────

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("❌ OPENAI_API_KEY not set.");
    process.exit(1);
  }

  console.log("🔬 Integration test: proposed_tags structured output");
  console.log(`   Model: ${process.env.TAG_PLACEMENT_MODEL || "gpt-4o-mini-2024-07-18"}`);
  console.log(`   Scenarios: 8`);

  await scenario_iPhone();
  await scenario_Jacket();
  await scenario_AirPods();
  await scenario_GamingPC();
  await scenario_NikeDunks();
  await scenario_VagueListing();
  await scenario_PS5Bundle();
  await scenario_Korean();

  // ── Summary ──
  console.log(`\n\n${"═".repeat(70)}`);
  console.log(`  SUMMARY`);
  console.log(`${"═".repeat(70)}`);
  console.log(`  Scenarios:    ${scenarioNum}`);
  console.log(`  Total tokens: ${totalTokensIn} in + ${totalTokensOut} out = ${totalTokensIn + totalTokensOut}`);
  console.log(`  Total time:   ${(totalLatency / 1000).toFixed(1)}s`);
  const cost = (totalTokensIn * 0.15 + totalTokensOut * 0.6) / 1_000_000;
  console.log(`  Est. cost:    $${cost.toFixed(4)} (gpt-4o-mini pricing)`);
  console.log(`${"═".repeat(70)}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
