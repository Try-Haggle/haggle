import { createId } from "./id.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProductReleaseStatus =
  | "PENDING_DELIVERY"
  | "BUYER_REVIEW"
  | "RELEASED";

export type BufferReleaseStatus = "HELD" | "ADJUSTING" | "RELEASED";

export type OverallReleasePhase =
  | "AWAITING_DELIVERY"
  | "BUYER_REVIEW"
  | "PRODUCT_RELEASED_BUFFER_HELD"
  | "BUFFER_ADJUSTING"
  | "FULLY_RELEASED";

import type { Money } from "./types.js";

export interface SettlementRelease {
  id: string;
  payment_intent_id: string;
  order_id: string;

  // Phase 1: Product payment
  product_amount: Money;
  product_release_status: ProductReleaseStatus;
  delivery_confirmed_at?: string;
  buyer_review_deadline?: string; // delivery_confirmed_at + 3 days
  product_released_at?: string;

  // Phase 2: Weight buffer
  buffer_amount: Money;
  buffer_release_status: BufferReleaseStatus;
  buffer_release_deadline?: string; // delivery_confirmed_at + 14 days
  apv_adjustment_minor: number; // USPS weight correction amount (default 0)
  buffer_released_at?: string;
  buffer_final_amount_minor?: number; // buffer - apv_adjustment (set on release)

  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Buyer has 24 hours to inspect and confirm (or dispute). Auto-confirms after. */
export const BUYER_REVIEW_HOURS = 24;
export const BUFFER_RELEASE_DAYS = 14;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

function addHours(isoDate: string, hours: number): string {
  const d = new Date(isoDate);
  d.setUTCHours(d.getUTCHours() + hours);
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

export function createSettlementRelease(params: {
  payment_intent_id: string;
  order_id: string;
  product_amount: Money;
  buffer_amount: Money;
  now?: string;
}): SettlementRelease {
  const now = params.now ?? new Date().toISOString();
  return {
    id: createId("sr"),
    payment_intent_id: params.payment_intent_id,
    order_id: params.order_id,
    product_amount: { ...params.product_amount },
    product_release_status: "PENDING_DELIVERY",
    buffer_amount: { ...params.buffer_amount },
    buffer_release_status: "HELD",
    apv_adjustment_minor: 0,
    created_at: now,
    updated_at: now,
  };
}

export function confirmDelivery(
  release: SettlementRelease,
  delivered_at: string,
): SettlementRelease {
  if (release.product_release_status !== "PENDING_DELIVERY") {
    throw new Error(
      `Cannot confirm delivery: product_release_status is "${release.product_release_status}", expected "PENDING_DELIVERY"`,
    );
  }
  return {
    ...release,
    product_amount: { ...release.product_amount },
    buffer_amount: { ...release.buffer_amount },
    delivery_confirmed_at: delivered_at,
    buyer_review_deadline: addHours(delivered_at, BUYER_REVIEW_HOURS),
    buffer_release_deadline: addDays(delivered_at, BUFFER_RELEASE_DAYS),
    product_release_status: "BUYER_REVIEW",
    updated_at: delivered_at,
  };
}

export function completeBuyerReview(
  release: SettlementRelease,
  now: string,
): SettlementRelease {
  if (release.product_release_status !== "BUYER_REVIEW") {
    throw new Error(
      `Cannot complete buyer review: product_release_status is "${release.product_release_status}", expected "BUYER_REVIEW"`,
    );
  }
  if (
    !release.buyer_review_deadline ||
    new Date(now) < new Date(release.buyer_review_deadline)
  ) {
    throw new Error("buyer review period not yet complete");
  }
  return {
    ...release,
    product_amount: { ...release.product_amount },
    buffer_amount: { ...release.buffer_amount },
    product_release_status: "RELEASED",
    product_released_at: now,
    updated_at: now,
  };
}

/**
 * Buyer explicitly confirms receipt. Releases product payment immediately
 * regardless of whether the 24h deadline has passed.
 */
export function buyerConfirmReceipt(
  release: SettlementRelease,
  now: string,
): SettlementRelease {
  if (release.product_release_status !== "BUYER_REVIEW") {
    throw new Error(
      `Cannot confirm receipt: product_release_status is "${release.product_release_status}", expected "BUYER_REVIEW"`,
    );
  }
  return {
    ...release,
    product_amount: { ...release.product_amount },
    buffer_amount: { ...release.buffer_amount },
    product_release_status: "RELEASED",
    product_released_at: now,
    updated_at: now,
  };
}

export function applyApvAdjustment(
  release: SettlementRelease,
  adjustment_minor: number,
): SettlementRelease {
  if (release.buffer_release_status === "RELEASED") {
    throw new Error("Cannot apply APV adjustment: buffer already RELEASED");
  }
  return {
    ...release,
    product_amount: { ...release.product_amount },
    buffer_amount: { ...release.buffer_amount },
    apv_adjustment_minor: release.apv_adjustment_minor + adjustment_minor,
    buffer_release_status: "ADJUSTING",
    updated_at: new Date().toISOString(),
  };
}

export function completeBufferRelease(
  release: SettlementRelease,
  now: string,
): SettlementRelease {
  if (release.buffer_release_status === "RELEASED") {
    throw new Error("Cannot release buffer: buffer already RELEASED");
  }
  if (
    !release.buffer_release_deadline ||
    new Date(now) < new Date(release.buffer_release_deadline)
  ) {
    throw new Error(
      "Cannot release buffer: buffer release deadline not yet reached",
    );
  }
  const finalAmount = Math.max(
    0,
    release.buffer_amount.amount_minor - release.apv_adjustment_minor,
  );
  return {
    ...release,
    product_amount: { ...release.product_amount },
    buffer_amount: { ...release.buffer_amount },
    buffer_release_status: "RELEASED",
    buffer_released_at: now,
    buffer_final_amount_minor: finalAmount,
    updated_at: now,
  };
}

export function computeReleasePhase(
  release: SettlementRelease,
): OverallReleasePhase {
  if (release.product_release_status === "PENDING_DELIVERY") {
    return "AWAITING_DELIVERY";
  }
  if (release.product_release_status === "BUYER_REVIEW") {
    return "BUYER_REVIEW";
  }
  // product is RELEASED
  if (release.buffer_release_status === "HELD") {
    return "PRODUCT_RELEASED_BUFFER_HELD";
  }
  if (release.buffer_release_status === "ADJUSTING") {
    return "BUFFER_ADJUSTING";
  }
  return "FULLY_RELEASED";
}

export function isFullyReleased(release: SettlementRelease): boolean {
  return (
    release.product_release_status === "RELEASED" &&
    release.buffer_release_status === "RELEASED"
  );
}
