/**
 * Default embedding input builder (Step 62 Part A).
 *
 * Verbatim copy of the original inline `buildEmbeddingInput` in
 * `apps/api/src/services/embedding.service.ts`. This is the regression
 * safety net: uncategorized listings continue to get byte-for-byte
 * identical embedding input.
 */

import type { EmbeddingInputBuilder } from "./types.js";

/** Price band boundaries for embedding input. */
const PRICE_BANDS: readonly [number, number, string][] = [
  [0, 50, "$0-$50"],
  [50, 100, "$50-$100"],
  [100, 250, "$100-$250"],
  [250, 500, "$250-$500"],
  [500, 1000, "$500-$1000"],
  [1000, 2000, "$1000-$2000"],
  [2000, 3000, "$2000-$3000"],
  [3000, 5000, "$3000-$5000"],
  [5000, Infinity, "$5000+"],
];

/** Convert a price to a discretized band string. */
export function getPriceBand(price: number): string {
  for (const [min, max, label] of PRICE_BANDS) {
    if (price >= min && price < max) return label;
  }
  return "$5000+";
}

/**
 * Build the text input for embedding generation from a listing snapshot.
 * Combines all structured fields into a tagged template so that
 * the embedding captures the full context of the listing.
 */
export const buildDefaultEmbeddingInput: EmbeddingInputBuilder = (
  snapshot: Record<string, unknown>,
): string => {
  const parts: string[] = [];

  if (snapshot.title) parts.push(`[TITLE] ${snapshot.title}`);
  if (snapshot.category) parts.push(`[CATEGORY] ${snapshot.category}`);
  if (snapshot.condition) parts.push(`[CONDITION] ${snapshot.condition}`);

  const tags = snapshot.tags as string[] | null | undefined;
  if (tags?.length) parts.push(`[TAGS] ${tags.join(", ")}`);

  if (snapshot.description) parts.push(`[DESCRIPTION] ${snapshot.description}`);

  if (snapshot.targetPrice) {
    const band = getPriceBand(Number(snapshot.targetPrice));
    parts.push(`[PRICE_BAND] ${band}`);
  }

  return parts.join("\n");
};
