export const LISTING_STATUSES = ["draft", "published", "expired"] as const;
export const ITEM_CONDITIONS = ["new", "like_new", "good", "fair", "poor"] as const;
export const LISTING_CATEGORIES = [
  "electronics",
  "fashion",
  "home",
  "sports",
  "vehicles",
  "other",
] as const;

// TODO(post-mvp): Add payment-related constants (USDC decimals, escrow timeouts, etc.)
// TODO(post-mvp): Add supported chain IDs for Base L2
