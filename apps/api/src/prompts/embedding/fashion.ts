/**
 * Fashion embedding input builder (Step 62 Part B).
 *
 * Emphasizes size/material/brand/color/condition — the attributes that
 * matter most for apparel retrieval (Phase 1.5 retention category).
 */

import { getPriceBand } from "./default.js";
import type { EmbeddingInputBuilder } from "./types.js";

export const buildFashionEmbeddingInput: EmbeddingInputBuilder = (
  snapshot: Record<string, unknown>,
): string => {
  const parts: string[] = [];

  if (snapshot.title) parts.push(`[TITLE] ${snapshot.title}`);
  if (snapshot.category) parts.push(`[CATEGORY] ${snapshot.category}`);
  if (snapshot.brand) parts.push(`[BRAND] ${snapshot.brand}`);
  if (snapshot.size) parts.push(`[SIZE] ${snapshot.size}`);
  if (snapshot.color) parts.push(`[COLOR] ${snapshot.color}`);
  if (snapshot.material) parts.push(`[MATERIAL] ${snapshot.material}`);
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
