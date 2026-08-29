// Experiment scenario definitions (Step 2). PURE DATA — no DB, no DeepSeek.
// Each group varies ONE axis at a time (OFAT) off a shared baseline so results
// are attributable to a single change. Expanding a group is free; only the
// runner (Step 3) spends money by actually negotiating.

import type { AgentPreset, ItemSpec, ScenarioCase } from "./types.js";
import { AGENT_PRESETS } from "./types.js";

// ---------------------------------------------------------------------------
// Baseline: the fixed backdrop every group starts from. A group overrides only
// the axis it studies; everything else stays at these values.
// ---------------------------------------------------------------------------
const BASE_ITEM: ItemSpec = {
  title: "iPhone 15 Pro 256GB",
  category: "electronics",
  condition: "good",
  askPrice: 900,
  floorPrice: 780,
  deadlineHours: 7 * 24,
  attributes: {
    storage: "256GB",
    batteryHealth: "90%",
    scratches: "none",
    carrierLock: "unlocked",
  },
};

const BASE_SELLER_AGENT: AgentPreset = "balancer";
const BASE_BUYER = { agent: "balancer" as AgentPreset, budgetMax: 850, targetPrice: 800 };

/** Deep-ish clone of the baseline item so a variation can't mutate shared state. */
function cloneItem(overrides: Partial<ItemSpec> = {}): ItemSpec {
  return {
    ...BASE_ITEM,
    ...overrides,
    attributes: { ...BASE_ITEM.attributes, ...(overrides.attributes ?? {}) },
  };
}

// ---------------------------------------------------------------------------
// Group A — agent matrix: every seller preset × every buyer preset (4×4 = 16).
// Item + prices fixed; only the two agents change. Answers "which agent
// pairing lands where?".
// ---------------------------------------------------------------------------
function groupAgentMatrix(): ScenarioCase[] {
  const cases: ScenarioCase[] = [];
  for (const seller of AGENT_PRESETS) {
    for (const buyer of AGENT_PRESETS) {
      cases.push({
        id: `A-${seller}-x-${buyer}`,
        group: "A",
        label: `${seller}(S) × ${buyer}(B)`,
        item: cloneItem(),
        seller: { agent: seller },
        buyer: { ...BASE_BUYER, agent: buyer },
      });
    }
  }
  return cases;
}

// ---------------------------------------------------------------------------
// Attribute sweeps (B/C/D): agents fixed at baseline, one phone attribute
// swept across levels. Answers "how does this one fact move the final price?".
// ---------------------------------------------------------------------------
function attributeSweep(group: string, attrKey: string, levels: string[]): ScenarioCase[] {
  return levels.map((level) => ({
    id: `${group}-${attrKey}-${slug(level)}`,
    group,
    label: `${attrKey}=${level}`,
    item: cloneItem({
      ...(attrKey === "storage" ? { title: `iPhone 15 Pro ${level}` } : {}),
      attributes: { [attrKey]: level },
    }),
    seller: { agent: BASE_SELLER_AGENT },
    buyer: { ...BASE_BUYER },
  }));
}

const groupBattery = () =>
  attributeSweep("B", "batteryHealth", ["100%", "90%", "85%", "80%", "75%"]);

const groupScratches = () =>
  attributeSweep("C", "scratches", [
    "none",
    "minor hairline on screen",
    "visible scratches on back",
    "cracked corner",
  ]);

/**
 * Group D listings are different SKUs. The published ask already differs by
 * storage — that is the seller's list price, not an engine SOFT table.
 * 256GB keeps the old $900 seed. Steps follow 15 Pro launch gaps (−$100 / +$200 / +$200).
 * Buyer envelope scales with the ask so a $880 buyer is not tested against a $1300 1TB.
 */
const STORAGE_LISTINGS: Record<
  string,
  { ask: number; floor: number; budget: number; target: number }
> = {
  "128GB": { ask: 800, floor: 700, budget: 780, target: 620 },
  "256GB": { ask: 900, floor: 780, budget: 880, target: 700 },
  "512GB": { ask: 1100, floor: 950, budget: 1075, target: 850 },
  "1TB": { ask: 1300, floor: 1130, budget: 1270, target: 1010 },
};

const groupStorage = () =>
  attributeSweep("D", "storage", ["128GB", "256GB", "512GB", "1TB"]).map((c) => {
    const storage = String(c.item.attributes.storage ?? "");
    const prices = STORAGE_LISTINGS[storage] ?? STORAGE_LISTINGS["256GB"];
    return {
      ...c,
      item: cloneItem({
        ...c.item,
        title: `iPhone 15 Pro ${storage}`,
        askPrice: prices.ask,
        floorPrice: prices.floor,
        attributes: c.item.attributes,
      }),
      buyer: { ...c.buyer, budgetMax: prices.budget, targetPrice: prices.target },
    };
  });

// ---------------------------------------------------------------------------
// Group E — buyer pressure: agents/attributes fixed, buyer budget + deadline
// swept. Answers "how do tighter budget / shorter clock move the outcome?".
// ---------------------------------------------------------------------------
function groupPressure(): ScenarioCase[] {
  const levels = [
    { label: "loose budget, long clock", budgetMax: 880, deadlineHours: 72 },
    { label: "mid budget, mid clock", budgetMax: 830, deadlineHours: 24 },
    { label: "tight budget, short clock", budgetMax: 800, deadlineHours: 6 },
  ];
  return levels.map((l, i) => ({
    id: `E-pressure-${i}`,
    group: "E",
    label: l.label,
    item: cloneItem(),
    seller: { agent: BASE_SELLER_AGENT },
    buyer: {
      ...BASE_BUYER,
      budgetMax: l.budgetMax,
      targetPrice: Math.min(BASE_BUYER.targetPrice, l.budgetMax - 30),
      deadlineHours: l.deadlineHours,
    },
  }));
}

// ---------------------------------------------------------------------------
// Registry: the runner + dry-run pick groups from here by key.
// ---------------------------------------------------------------------------
export interface GroupDef {
  key: string;
  title: string;
  build: () => ScenarioCase[];
}

export const GROUPS: GroupDef[] = [
  { key: "A", title: "Agent matrix (seller × buyer, 4×4)", build: groupAgentMatrix },
  { key: "B", title: "Battery health sweep", build: groupBattery },
  { key: "C", title: "Scratches sweep", build: groupScratches },
  { key: "D", title: "Storage sweep", build: groupStorage },
  { key: "E", title: "Buyer pressure sweep", build: groupPressure },
];

/** Expand one group ("A") or "all" into a flat case list. Throws on unknown key. */
export function expandGroups(selector: string): ScenarioCase[] {
  if (selector.toLowerCase() === "all") {
    return GROUPS.flatMap((g) => g.build());
  }
  const keys = selector.split(",").map((k) => k.trim().toUpperCase());
  const cases: ScenarioCase[] = [];
  for (const key of keys) {
    const group = GROUPS.find((g) => g.key === key);
    if (!group) {
      const known = GROUPS.map((g) => g.key).join(", ");
      throw new Error(`unknown group "${key}". Known groups: ${known}, all`);
    }
    cases.push(...group.build());
  }
  return cases;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
