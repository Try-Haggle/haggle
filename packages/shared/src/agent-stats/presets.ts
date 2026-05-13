/**
 * 6 canonical agent presets — see docs/engine/22_에이전트_스탯_UI_매핑.md §8
 * Each stats sum to 400 (STAT_BUDGET); each value in [10, 90].
 */

import type { AgentPreset } from "./types.js";

export const AGENT_PRESETS: readonly AgentPreset[] = [
  {
    id: "tiger",
    name: "Tiger",
    emoji: "🐯",
    tagline: "I set the price.",
    description:
      "Strong opening, slow concession. Best for competitive categories where holding firm pays off.",
    accentColor: "#ef4444",
    stats: {
      anchoring: 85,
      tenacity: 80,
      resolve: 60,
      market_sense: 40,
      risk_radar: 20,
      scrutiny: 15,
      patience: 55,
      rapport: 45,
    },
  },
  {
    id: "fox",
    name: "Fox",
    emoji: "🦊",
    tagline: "Balanced and adaptive.",
    description:
      "Even-keeled defaults across all stats. Safe starting point for most deals.",
    accentColor: "#f59e0b",
    stats: {
      anchoring: 50,
      tenacity: 50,
      resolve: 50,
      market_sense: 50,
      risk_radar: 50,
      scrutiny: 50,
      patience: 50,
      rapport: 50,
    },
  },
  {
    id: "turtle",
    name: "Turtle",
    emoji: "🐢",
    tagline: "Patience wins.",
    description:
      "Holds firm and waits. Best for non-urgent deals where time is on your side.",
    accentColor: "#10b981",
    stats: {
      anchoring: 25,
      tenacity: 85,
      resolve: 55,
      market_sense: 35,
      risk_radar: 30,
      scrutiny: 40,
      patience: 90,
      rapport: 40,
    },
  },
  {
    id: "owl",
    name: "Owl",
    emoji: "🦉",
    tagline: "Knows the market.",
    description:
      "Heavy use of market data and listing details. Best for high-value items where comps matter.",
    accentColor: "#a855f7",
    stats: {
      anchoring: 45,
      tenacity: 50,
      resolve: 60,
      market_sense: 85,
      risk_radar: 40,
      scrutiny: 80,
      patience: 25,
      rapport: 15,
    },
  },
  {
    id: "dolphin",
    name: "Dolphin",
    emoji: "🐬",
    tagline: "Builds relationships.",
    description:
      "Values rapport and repeat trades. Best for community marketplaces and recurring counterparties.",
    accentColor: "#06b6d4",
    stats: {
      anchoring: 30,
      tenacity: 50,
      resolve: 40,
      market_sense: 50,
      risk_radar: 40,
      scrutiny: 35,
      patience: 65,
      rapport: 90,
    },
  },
  {
    id: "eagle",
    name: "Eagle",
    emoji: "🦅",
    tagline: "Spots the risks.",
    description:
      "High suspicion of low-trust counterparties and incomplete listings. Best for high-value or fraud-prone categories.",
    accentColor: "#3b82f6",
    stats: {
      anchoring: 30,
      tenacity: 60,
      resolve: 70,
      market_sense: 40,
      risk_radar: 80,
      scrutiny: 75,
      patience: 25,
      rapport: 20,
    },
  },
] as const;

/** Look up a preset by id. */
export function getPreset(id: string): AgentPreset | undefined {
  return AGENT_PRESETS.find((p) => p.id === id);
}

/** Default preset (used as fallback when no agent is selected). */
export const DEFAULT_PRESET_ID = "fox";
