/* ─── Buyer Agent Presets ─────────────────────────────────── */

export interface BuyerAgentStats {
  priceAggression: number; // How hard the agent pushes for a lower price
  patienceLevel: number; // Willingness to go multiple rounds
  riskTolerance: number; // Willingness to lowball / walk away
  speedBias: number; // Priority on closing quickly
  detailFocus: number; // How much agent analyzes specs, comps, condition
}

export interface BuyerAgentPreset {
  id: string;
  name: string;
  tagline: string;
  description: string;
  accentColor: string;
  icon: string; // emoji
  stats: BuyerAgentStats;
}

export const DEFAULT_BUYER_STATS: BuyerAgentStats = {
  priceAggression: 50,
  patienceLevel: 50,
  riskTolerance: 50,
  speedBias: 50,
  detailFocus: 50,
};

export const BUYER_AGENT_PRESETS: BuyerAgentPreset[] = [
  {
    id: "price-hunter",
    name: "Price Hunter",
    tagline: "Pushes for the lowest price.",
    description:
      "Relentless. Uses market data and persistence to drive the price down as far as possible. Best when you're patient and want maximum savings.",
    accentColor: "#ef4444",
    icon: "🎯",
    stats: {
      priceAggression: 90,
      patienceLevel: 80,
      riskTolerance: 75,
      speedBias: 20,
      detailFocus: 60,
    },
  },
  {
    id: "smart-trader",
    name: "Smart Trader",
    tagline: "Balanced, analytical approach.",
    description:
      "Considers value, condition, and extras. Makes fair, well-reasoned offers that often land deals without leaving money on the table.",
    accentColor: "#f59e0b",
    icon: "🧠",
    stats: {
      priceAggression: 55,
      patienceLevel: 70,
      riskTolerance: 45,
      speedBias: 50,
      detailFocus: 85,
    },
  },
  {
    id: "fast-closer",
    name: "Fast Closer",
    tagline: "Quick deal, reasonable price.",
    description:
      "Prioritizes closing the deal fast. Skips the back-and-forth and lands at a fair price efficiently. Best when you want the item now.",
    accentColor: "#3b82f6",
    icon: "⚡",
    stats: {
      priceAggression: 35,
      patienceLevel: 20,
      riskTolerance: 30,
      speedBias: 95,
      detailFocus: 40,
    },
  },
  {
    id: "spec-analyst",
    name: "Spec Analyst",
    tagline: "Digs into every detail.",
    description:
      "Inspects condition, specs, and market comps thoroughly to justify a lower price. Uses data-driven arguments the seller's agent can't ignore.",
    accentColor: "#a855f7",
    icon: "🔍",
    stats: {
      priceAggression: 65,
      patienceLevel: 85,
      riskTolerance: 40,
      speedBias: 25,
      detailFocus: 95,
    },
  },
];

export const BUYER_STAT_META: {
  key: keyof BuyerAgentStats;
  label: string;
  color: string;
  gradient: string;
}[] = [
  {
    key: "priceAggression",
    label: "Price Aggression",
    color: "#ef4444",
    gradient: "linear-gradient(90deg, #ef4444, #f87171)",
  },
  {
    key: "patienceLevel",
    label: "Patience Level",
    color: "#10b981",
    gradient: "linear-gradient(90deg, #10b981, #34d399)",
  },
  {
    key: "riskTolerance",
    label: "Risk Tolerance",
    color: "#f59e0b",
    gradient: "linear-gradient(90deg, #f59e0b, #fbbf24)",
  },
  {
    key: "speedBias",
    label: "Speed Bias",
    color: "#3b82f6",
    gradient: "linear-gradient(90deg, #3b82f6, #60a5fa)",
  },
  {
    key: "detailFocus",
    label: "Detail Focus",
    color: "#a855f7",
    gradient: "linear-gradient(90deg, #a855f7, #c084fc)",
  },
];

export const BUYER_RADAR_LABELS = [
  "Price",
  "Patience",
  "Risk",
  "Speed",
  "Detail",
];
