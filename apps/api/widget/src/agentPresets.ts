/* ─── Agent Preset Data ─────────────────────────────────── */

export interface AgentStats {
  priceAggression: number;
  patienceLevel: number;
  riskTolerance: number;
  speedBias: number;
  detailFocus: number;
}

export interface AgentPreset {
  id: string;
  name: string;
  tagline: string;
  description: string;
  accentColor: string;
  stats: AgentStats;
}

export const DEFAULT_STATS: AgentStats = {
  priceAggression: 50,
  patienceLevel: 50,
  riskTolerance: 50,
  speedBias: 50,
  detailFocus: 50,
};

export const AGENT_PRESETS: AgentPreset[] = [
  {
    id: "gatekeeper",
    name: "The Gatekeeper",
    tagline: "Holds the line. Rarely budges.",
    description:
      "Defends your asking price with logic and confidence. Best for high-demand items or when you're not in a rush.",
    accentColor: "#ef4444",
    stats: {
      priceAggression: 85,
      patienceLevel: 90,
      riskTolerance: 20,
      speedBias: 30,
      detailFocus: 75,
    },
  },
  {
    id: "diplomat",
    name: "The Diplomat",
    tagline: "Meets buyers halfway. Closes more.",
    description:
      "Balances getting a fair price with closing deals. Adapts to the buyer's style.",
    accentColor: "#f59e0b",
    stats: {
      priceAggression: 55,
      patienceLevel: 70,
      riskTolerance: 50,
      speedBias: 50,
      detailFocus: 60,
    },
  },
  {
    id: "storyteller",
    name: "The Storyteller",
    tagline: "Sells the value, not just the price.",
    description:
      "Emphasizes condition, accessories, and item value to justify the price rather than just discounting.",
    accentColor: "#a855f7",
    stats: {
      priceAggression: 60,
      patienceLevel: 80,
      riskTolerance: 35,
      speedBias: 25,
      detailFocus: 95,
    },
  },
  {
    id: "dealmaker",
    name: "The Dealmaker",
    tagline: "Fast deals. Done. Move on.",
    description:
      "Prioritizes closing quickly. Willing to give modest discounts for a quick, committed buyer.",
    accentColor: "#eab308",
    stats: {
      priceAggression: 40,
      patienceLevel: 25,
      riskTolerance: 75,
      speedBias: 95,
      detailFocus: 35,
    },
  },
];

export const STAT_META: {
  key: keyof AgentStats;
  label: string;
  color: string;
  gradient: string;
}[] = [
  {
    key: "priceAggression",
    label: "Price Aggression",
    color: "#06b6d4",
    gradient: "linear-gradient(90deg, #06b6d4, #22d3ee)",
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
    color: "#ef4444",
    gradient: "linear-gradient(90deg, #ef4444, #f87171)",
  },
];

export const RADAR_LABELS = ["Price", "Patience", "Risk", "Speed", "Detail"];
