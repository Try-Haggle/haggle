/**
 * Product-matched new-retail MSRP. Advisory Market facts only.
 * Do not use as opening or settlement. Unmatched listings emit nothing.
 */

import { detectStorage, type StorageTier } from "../prompts/soft-scale.js";

export type { StorageTier };

export interface RetailFamily {
  id: string;
  label: string;
  matchTags: string[];
  matchTitle: RegExp;
  source: string;
  asOf: string;
  newByStorage: Partial<Record<StorageTier, number>>;
}

/** More specific families first (Pro Max before Pro). Apple US launch MSRP. */
export const RETAIL_FAMILIES: RetailFamily[] = [
  {
    id: "iphone-16-pro-max",
    label: "iPhone 16 Pro Max",
    matchTags: ["iphone-16-pro-max"],
    matchTitle: /iphone\s*16\s*pro\s*max/i,
    source: "Apple US launch MSRP",
    asOf: "2024-09",
    newByStorage: { "256GB": 1199, "512GB": 1399, "1TB": 1599 },
  },
  {
    id: "iphone-16-pro",
    label: "iPhone 16 Pro",
    matchTags: ["iphone-16-pro"],
    matchTitle: /iphone\s*16\s*pro/i,
    source: "Apple US launch MSRP",
    asOf: "2024-09",
    newByStorage: { "128GB": 999, "256GB": 1099, "512GB": 1299, "1TB": 1499 },
  },
  {
    id: "iphone-15-pro-max",
    label: "iPhone 15 Pro Max",
    matchTags: ["iphone-15-pro-max"],
    matchTitle: /iphone\s*15\s*pro\s*max/i,
    source: "Apple US launch MSRP",
    asOf: "2023-09",
    newByStorage: { "256GB": 1199, "512GB": 1399, "1TB": 1599 },
  },
  {
    id: "iphone-15-pro",
    label: "iPhone 15 Pro",
    matchTags: ["iphone-15-pro"],
    matchTitle: /iphone\s*15\s*pro/i,
    source: "Apple US launch MSRP",
    asOf: "2023-09",
    newByStorage: { "128GB": 999, "256GB": 1099, "512GB": 1299, "1TB": 1499 },
  },
  {
    id: "iphone-15",
    label: "iPhone 15",
    matchTags: ["iphone-15"],
    matchTitle: /iphone\s*15(?!\s*pro)/i,
    source: "Apple US launch MSRP",
    asOf: "2023-09",
    newByStorage: { "128GB": 799, "256GB": 899, "512GB": 1099 },
  },
];

export interface RetailListingHint {
  title?: string;
  tags?: string[];
  attributes?: Record<string, unknown>;
  seller_facts?: Array<{ checkId: string; stance: string }>;
}

export function matchRetailFamily(title?: string, tags?: string[]): RetailFamily | null {
  const tagSet = new Set((tags ?? []).map((t) => t.trim().toLowerCase()));
  for (const family of RETAIL_FAMILIES) {
    if (family.matchTags.some((t) => tagSet.has(t))) return family;
  }
  const hay = title ?? "";
  for (const family of RETAIL_FAMILIES) {
    if (family.matchTitle.test(hay)) return family;
  }
  return null;
}

export { detectStorage };

export function formatRetailMarketLines(
  family: RetailFamily,
  storage: StorageTier | null,
): string[] {
  const ladder = (Object.entries(family.newByStorage) as Array<[StorageTier, number]>)
    .map(([tier, usd]) => `${tier} $${usd}`)
    .join(" · ");
  const lines = [`${family.label} new (${family.source}, ${family.asOf}): ${ladder}`];
  const thisNew = storage ? family.newByStorage[storage] : undefined;
  if (storage && thisNew != null) {
    lines.push(
      `This copy is ${storage} — new was $${thisNew}. This listing's ask is not storage-adjusted. Advisory. Not the opening or the settlement.`,
    );
  } else {
    lines.push("Advisory new-retail ladder for this product. Not the opening or the settlement.");
  }
  return lines;
}

export function retailMarketLinesForListing(listing?: RetailListingHint | null): string[] {
  const family = matchRetailFamily(listing?.title, listing?.tags);
  if (!family) return [];
  return formatRetailMarketLines(family, detectStorage(listing));
}
