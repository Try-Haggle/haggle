/**
 * Electronics embedding input builder (Step 62 Part B).
 *
 * Emphasizes storage/battery/condition/carrier/model — the attributes
 * that matter most for iPhone Pro retrieval (Phase 0 wedge).
 */

import { getPriceBand } from "./default.js";
import type { EmbeddingInputBuilder } from "./types.js";

const STORAGE_TAG_RE = /^\d+(gb|tb)$/i;

export const buildElectronicsEmbeddingInput: EmbeddingInputBuilder = (
  snapshot: Record<string, unknown>,
): string => {
  const parts: string[] = [];

  if (snapshot.title) parts.push(`[TITLE] ${snapshot.title}`);
  if (snapshot.category) parts.push(`[CATEGORY] ${snapshot.category}`);
  if (snapshot.brand) parts.push(`[BRAND] ${snapshot.brand}`);
  if (snapshot.model) parts.push(`[MODEL] ${snapshot.model}`);

  const tags = snapshot.tags as string[] | null | undefined;

  // Storage: direct field, then tag inspection fallback.
  if (snapshot.storage) {
    parts.push(`[STORAGE] ${snapshot.storage}`);
  } else if (tags?.length) {
    const storageTag = tags.find((t) => STORAGE_TAG_RE.test(t));
    if (storageTag) parts.push(`[STORAGE] ${storageTag}`);
  }

  // Carrier: direct field, then "unlocked" tag fallback.
  if (snapshot.carrier) {
    parts.push(`[CARRIER] ${snapshot.carrier}`);
  } else if (tags?.some((t) => t.toLowerCase() === "unlocked")) {
    parts.push(`[CARRIER] unlocked`);
  }

  if (snapshot.batteryHealth)
    parts.push(`[BATTERY_HEALTH] ${snapshot.batteryHealth}`);
  if (snapshot.condition) parts.push(`[CONDITION] ${snapshot.condition}`);

  if (tags?.length) parts.push(`[TAGS] ${tags.join(", ")}`);

  if (snapshot.description) parts.push(`[DESCRIPTION] ${snapshot.description}`);

  if (snapshot.targetPrice) {
    const band = getPriceBand(Number(snapshot.targetPrice));
    parts.push(`[PRICE_BAND] ${band}`);
  }

  return parts.join("\n");
};
