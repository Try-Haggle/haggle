export const LISTING_STATUSES = ["draft", "published", "expired"] as const;
export const ITEM_CONDITIONS = ["new", "like_new", "good", "fair", "poor"] as const;

export const LISTING_CATEGORIES = [
  "electronics",
  "clothing",
  "furniture",
  "collectibles",
  "sports",
  "vehicles",
  "books",
  "other",
] as const;

export const LISTING_CATEGORY_LABELS: Record<
  (typeof LISTING_CATEGORIES)[number],
  string
> = {
  electronics: "Electronics",
  clothing: "Clothing",
  furniture: "Furniture",
  collectibles: "Collectibles",
  sports: "Sports",
  vehicles: "Vehicles",
  books: "Books",
  other: "Other",
};

// TODO(post-mvp): Add payment-related constants (USDC decimals, escrow timeouts, etc.)
// TODO(post-mvp): Add supported chain IDs for Base L2
