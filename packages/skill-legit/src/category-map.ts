import type { LegitAppCategory } from "./types.js";

// ---------------------------------------------------------------------------
// Haggle → LegitApp category mapping
// ---------------------------------------------------------------------------

/**
 * Haggle marketplace categories.
 * A subset that maps to LegitApp's authentication capabilities.
 */
export type HaggleCategory =
  | "sneakers"
  | "streetwear"
  | "handbags"
  | "watches"
  | "jewelry"
  | "electronics"
  | "automotive"
  | "collectibles"
  | "accessories";

const CATEGORY_MAP: Record<HaggleCategory, LegitAppCategory> = {
  sneakers: "sneakers",
  streetwear: "streetwear",
  handbags: "handbags",
  watches: "watches",
  jewelry: "jewelry",
  collectibles: "collectibles",
  accessories: "accessories",
  // LegitApp does not support electronics/automotive — fallback to accessories
  electronics: "accessories",
  automotive: "accessories",
};

/**
 * Map a Haggle marketplace category to the closest LegitApp authentication category.
 *
 * Note: `electronics` and `automotive` are not supported by LegitApp and fall back
 * to `accessories`. Callers should be aware that authentication accuracy may be
 * lower for these fallback categories.
 */
export function mapToLegitCategory(category: HaggleCategory): LegitAppCategory {
  return CATEGORY_MAP[category];
}

/** Categories that fall back because LegitApp has no direct support. */
export const FALLBACK_CATEGORIES: readonly HaggleCategory[] = [
  "electronics",
  "automotive",
] as const;

/** Check whether a Haggle category requires a fallback mapping. */
export function isFallbackCategory(category: HaggleCategory): boolean {
  return (FALLBACK_CATEGORIES as readonly string[]).includes(category);
}
