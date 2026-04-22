export type ListingStatus = "draft" | "published" | "expired";

export type ListingCategory =
  | "electronics"
  | "clothing"
  | "furniture"
  | "collectibles"
  | "sports"
  | "vehicles"
  | "books"
  | "other";

export type ItemCondition =
  | "new"
  | "like_new"
  | "good"
  | "fair"
  | "poor";

/**
 * TypeScript representation of a listing_drafts DB row (camelCase).
 * Used by: MCP tool responses, service layer functions, and embedded widget data fetching.
 */
export interface ListingDraft {
  id: string;
  status: ListingStatus;
  userId: string | null;
  claimToken: string | null;
  claimExpiresAt: Date | null;
  title: string | null;
  description: string | null;
  tags: string[] | null;
  category: string | null;
  condition: string | null;
  photoUrl: string | null;
  targetPrice: string | null; // numeric(12,2) → string (Drizzle returns string for precision)
  floorPrice: string | null;
  sellingDeadline: Date | null;
  strategyConfig: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}
