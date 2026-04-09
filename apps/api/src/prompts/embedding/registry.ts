/**
 * Embedding builder registry (Step 62).
 *
 * Resolves a per-category embedding input builder by substring-matching
 * `snapshot.category` against keyword tables. Order: electronics, fashion,
 * default (fallthrough). Default builder remains byte-for-byte identical
 * to the pre-refactor inline `buildEmbeddingInput`.
 */

import { buildDefaultEmbeddingInput } from "./default.js";
import { buildElectronicsEmbeddingInput } from "./electronics.js";
import { buildFashionEmbeddingInput } from "./fashion.js";
import type {
  EmbeddingBuilderEntry,
  EmbeddingInputBuilder,
} from "./types.js";

/**
 * All registered builders, ordered by specificity. "default" MUST be last.
 */
export const EMBEDDING_BUILDERS: readonly EmbeddingBuilderEntry[] = [
  {
    category: "electronics",
    categoryKeywords: [
      "electronic",
      "phone",
      "iphone",
      "android",
      "galaxy",
      "laptop",
      "computer",
      "tablet",
      "headphone",
      "earbud",
    ],
    build: buildElectronicsEmbeddingInput,
  },
  {
    category: "fashion",
    categoryKeywords: [
      "fashion",
      "clothing",
      "apparel",
      "jacket",
      "shoe",
      "sneaker",
      "shirt",
      "dress",
      "pant",
      "accessory",
    ],
    build: buildFashionEmbeddingInput,
  },
  {
    category: "default",
    categoryKeywords: [],
    build: buildDefaultEmbeddingInput,
  },
];

/**
 * Given a snapshot, find the right builder.
 * Rules:
 *  1. Read `snapshot.category` as string; if absent → default.
 *  2. Lowercase + trim. For each entry except default, if any keyword is a
 *     substring → return that builder.
 *  3. Fall through → default.
 * Deterministic. Zero allocations on the hot path beyond a lowercase.
 */
export function resolveEmbeddingBuilder(
  snapshot: Record<string, unknown>,
): EmbeddingInputBuilder {
  const rawCategory = snapshot.category;
  if (typeof rawCategory === "string" && rawCategory.length > 0) {
    const normalized = rawCategory.toLowerCase().trim();
    for (const entry of EMBEDDING_BUILDERS) {
      if (entry.category === "default") continue;
      for (const keyword of entry.categoryKeywords) {
        if (normalized.includes(keyword)) return entry.build;
      }
    }
  }
  return buildDefaultEmbeddingInput;
}
