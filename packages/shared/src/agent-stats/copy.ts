/**
 * Stat copy variants for seller and buyer views — see docs/engine/22_에이전트_스탯_UI_매핑.md §5
 *
 * Each stat has a low-end and high-end description. Same stat, different framing
 * depending on whether the user is a seller or a buyer.
 */

import type { RoleCopy } from "./types.js";

export const SELLER_COPY: RoleCopy = {
  anchoring: { lo: "Start near market price", hi: "Open well above market" },
  tenacity: { lo: "Concede quickly", hi: "Hold the line firmly" },
  resolve: { lo: "Just close the deal", hi: "Won't sell below my line" },
  market_sense: { lo: "Focus on their offer", hi: "Heavy use of market data" },
  risk_radar: { lo: "Try low-trust buyers", hi: "Walk from low trust" },
  scrutiny: { lo: "OK with sparse buyer info", hi: "Demand full information" },
  patience: { lo: "Want to close fast", hi: "Can wait it out" },
  rapport: { lo: "Price first", hi: "Value relationships" },
};

export const BUYER_COPY: RoleCopy = {
  anchoring: { lo: "Start near asking price", hi: "Lowball aggressively" },
  tenacity: { lo: "Concede quickly", hi: "Hold the line firmly" },
  resolve: { lo: "Buy if it's decent", hi: "Only the best deals" },
  market_sense: { lo: "Focus on their offer", hi: "Heavy use of market data" },
  risk_radar: { lo: "Try low-trust sellers", hi: "Walk from low trust" },
  scrutiny: { lo: "OK with sparse listings", hi: "Demand full information" },
  patience: { lo: "Want to close fast", hi: "Can wait it out" },
  rapport: { lo: "Price first", hi: "Prefer trusted sellers" },
};

export function copyFor(role: "seller" | "buyer"): RoleCopy {
  return role === "seller" ? SELLER_COPY : BUYER_COPY;
}

/** Display labels for each stat (UI shows these instead of snake_case keys). */
export const STAT_LABELS: Record<string, string> = {
  anchoring: "Anchoring",
  tenacity: "Tenacity",
  resolve: "Resolve",
  market_sense: "Market Sense",
  risk_radar: "Risk Radar",
  scrutiny: "Scrutiny",
  patience: "Patience",
  rapport: "Rapport",
};

/**
 * UI section labels.
 * "Stance" deviates from docs ("Battle Style") — single intentional deviation
 * for cleaner negotiation-domain language. Internal id stays "battle".
 */
export const SECTION_LABELS: Record<string, string> = {
  battle: "Stance",
  intelligence: "Intelligence",
  context: "Context",
};

export const SECTION_SUBTITLES: Record<string, string> = {
  battle: "opening · concession · walk-away",
  intelligence: "market · risk · verification",
  context: "patience · rapport",
};
