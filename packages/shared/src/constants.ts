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

export const LISTING_CATEGORY_LABELS: Record<(typeof LISTING_CATEGORIES)[number], string> = {
  electronics: "Electronics",
  clothing: "Clothing",
  furniture: "Furniture",
  collectibles: "Collectibles",
  sports: "Sports",
  vehicles: "Vehicles",
  books: "Books",
  other: "Other",
};

export const PAYMENT_DISCLOSURE_VERSION = "haggle-payment-disclosure-v1";

export const PAYMENT_DISCLOSURE_TEXT =
  "Haggle creates buyer-approved payment rules. Haggle does not custody keys or funds. USDC is used only as a payment asset, not an investment. Stripe may be used as a fallback rail.";

export const PAYMENT_DISCLOSURE_TEXT_HASH =
  "sha256:87f9e030385bbc246bef2157f3888df0ec28fd241c125d67604d09ed165fbe48";

// TODO(post-mvp): Add payment-related constants (USDC decimals, escrow timeouts, etc.)
// TODO(post-mvp): Add supported chain IDs for Base L2

/** Soft → Hard checkout gate: buyer must click 이대로 결제 in the web UI. */
export const SOFT_AGREEMENT_ACK_VERSION = "haggle-soft-agreement-ack-v1";

/** Only buyer UI CTA may attest Soft terms. Tool/MCP/agent attest is rejected. */
export const SOFT_AGREEMENT_ACK_SOURCE_BUYER_UI_CTA = "buyer_ui_cta" as const;

export const SOFT_AGREEMENT_ACK_SOURCES = [SOFT_AGREEMENT_ACK_SOURCE_BUYER_UI_CTA] as const;
