/**
 * Detect this copy's storage from listing text. Rank/placement is not an engine fact.
 */

export type StorageTier = "128GB" | "256GB" | "512GB" | "1TB";

export interface SoftScaleListing {
  title?: string;
  tags?: string[];
  attributes?: Record<string, unknown>;
  seller_facts?: Array<{ checkId: string; stance: string }>;
}

export function detectStorage(listing?: SoftScaleListing | null): StorageTier | null {
  if (!listing) return null;
  const blobs = [
    listing.title,
    ...(listing.tags ?? []),
    listing.attributes?.storage,
    ...(listing.seller_facts ?? [])
      .filter((f) => f.checkId === "storage_capacity")
      .map((f) => f.stance),
  ]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .join(" ");
  if (/\b1\s*TB\b/i.test(blobs)) return "1TB";
  if (/\b512\s*GB\b/i.test(blobs)) return "512GB";
  if (/\b256\s*GB\b/i.test(blobs)) return "256GB";
  if (/\b128\s*GB\b/i.test(blobs)) return "128GB";
  return null;
}
