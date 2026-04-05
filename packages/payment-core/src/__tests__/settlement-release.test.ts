import { describe, it, expect } from "vitest";
import {
  createSettlementRelease,
  confirmDelivery,
  completeBuyerReview,
  applyApvAdjustment,
  completeBufferRelease,
  computeReleasePhase,
  isFullyReleased,
  BUYER_REVIEW_HOURS,
  buyerConfirmReceipt,
  BUFFER_RELEASE_DAYS,
} from "../settlement-release.js";
import type { SettlementRelease } from "../settlement-release.js";
import type { Money } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PRODUCT: Money = { currency: "USDC", amount_minor: 100_00 };
const BUFFER: Money = { currency: "USDC", amount_minor: 5_00 };
const NOW = "2026-03-01T00:00:00.000Z";

function makeRelease(
  overrides: Partial<SettlementRelease> = {},
): SettlementRelease {
  return {
    ...createSettlementRelease({
      payment_intent_id: "pi_001",
      order_id: "ord_001",
      product_amount: PRODUCT,
      buffer_amount: BUFFER,
      now: NOW,
    }),
    ...overrides,
  };
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

function addHours(iso: string, hours: number): string {
  const d = new Date(iso);
  d.setUTCHours(d.getUTCHours() + hours);
  return d.toISOString();
}

// ===========================================================================
// 1. createSettlementRelease
// ===========================================================================

describe("createSettlementRelease", () => {
  it("creates with correct initial statuses", () => {
    const r = createSettlementRelease({
      payment_intent_id: "pi_001",
      order_id: "ord_001",
      product_amount: PRODUCT,
      buffer_amount: BUFFER,
      now: NOW,
    });
    expect(r.product_release_status).toBe("PENDING_DELIVERY");
    expect(r.buffer_release_status).toBe("HELD");
    expect(r.apv_adjustment_minor).toBe(0);
    expect(r.created_at).toBe(NOW);
    expect(r.updated_at).toBe(NOW);
  });

  it("generates a unique id with sr_ prefix", () => {
    const a = createSettlementRelease({
      payment_intent_id: "pi_001",
      order_id: "ord_001",
      product_amount: PRODUCT,
      buffer_amount: BUFFER,
    });
    const b = createSettlementRelease({
      payment_intent_id: "pi_002",
      order_id: "ord_002",
      product_amount: PRODUCT,
      buffer_amount: BUFFER,
    });
    expect(a.id).toMatch(/^sr_/);
    expect(b.id).toMatch(/^sr_/);
    expect(a.id).not.toBe(b.id);
  });

  it("stores amounts correctly", () => {
    const r = createSettlementRelease({
      payment_intent_id: "pi_001",
      order_id: "ord_001",
      product_amount: { currency: "USDC", amount_minor: 250_00 },
      buffer_amount: { currency: "USDC", amount_minor: 12_50 },
      now: NOW,
    });
    expect(r.product_amount).toEqual({ currency: "USDC", amount_minor: 250_00 });
    expect(r.buffer_amount).toEqual({ currency: "USDC", amount_minor: 12_50 });
    expect(r.payment_intent_id).toBe("pi_001");
    expect(r.order_id).toBe("ord_001");
  });
});

// ===========================================================================
// 2. confirmDelivery
// ===========================================================================

describe("confirmDelivery", () => {
  const DELIVERED_AT = "2026-03-05T12:00:00.000Z";

  it("sets delivery timestamp and deadlines", () => {
    const r = makeRelease();
    const updated = confirmDelivery(r, DELIVERED_AT);
    expect(updated.delivery_confirmed_at).toBe(DELIVERED_AT);
    expect(updated.product_release_status).toBe("BUYER_REVIEW");
  });

  it("sets buyer_review_deadline = delivered_at + 24 hours", () => {
    const r = makeRelease();
    const updated = confirmDelivery(r, DELIVERED_AT);
    expect(updated.buyer_review_deadline).toBe(
      addHours(DELIVERED_AT, BUYER_REVIEW_HOURS),
    );
  });

  it("sets buffer_release_deadline = delivered_at + 14 days", () => {
    const r = makeRelease();
    const updated = confirmDelivery(r, DELIVERED_AT);
    expect(updated.buffer_release_deadline).toBe(
      addDays(DELIVERED_AT, BUFFER_RELEASE_DAYS),
    );
  });

  it("throws if already past PENDING_DELIVERY", () => {
    const r = makeRelease({ product_release_status: "BUYER_REVIEW" });
    expect(() => confirmDelivery(r, DELIVERED_AT)).toThrow(
      /expected "PENDING_DELIVERY"/,
    );
  });
});

// ===========================================================================
// 3. completeBuyerReview
// ===========================================================================

describe("completeBuyerReview", () => {
  function reviewReady(): SettlementRelease {
    const r = makeRelease();
    return confirmDelivery(r, "2026-03-05T12:00:00.000Z");
  }

  it("releases product when deadline passed", () => {
    const r = reviewReady();
    const afterDeadline = addDays("2026-03-05T12:00:00.000Z", 4);
    const updated = completeBuyerReview(r, afterDeadline);
    expect(updated.product_release_status).toBe("RELEASED");
  });

  it("throws when deadline not reached", () => {
    const r = reviewReady();
    const beforeDeadline = "2026-03-06T00:00:00.000Z"; // only 0.5 days later
    expect(() => completeBuyerReview(r, beforeDeadline)).toThrow(
      "buyer review period not yet complete",
    );
  });

  it("throws if not in BUYER_REVIEW status", () => {
    const r = makeRelease({ product_release_status: "PENDING_DELIVERY" });
    expect(() => completeBuyerReview(r, addDays(NOW, 10))).toThrow(
      /expected "BUYER_REVIEW"/,
    );
  });

  it("sets product_released_at", () => {
    const r = reviewReady();
    const releaseTime = addDays("2026-03-05T12:00:00.000Z", 4);
    const updated = completeBuyerReview(r, releaseTime);
    expect(updated.product_released_at).toBe(releaseTime);
  });
});

// ===========================================================================
// 3b. buyerConfirmReceipt
// ===========================================================================

describe("buyerConfirmReceipt", () => {
  function reviewReady(): SettlementRelease {
    const r = makeRelease();
    return confirmDelivery(r, "2026-03-05T12:00:00.000Z");
  }

  it("releases product immediately when buyer confirms", () => {
    const r = reviewReady();
    // Only 1 hour after delivery — well before 24h deadline
    const now = "2026-03-05T13:00:00.000Z";
    const updated = buyerConfirmReceipt(r, now);
    expect(updated.product_release_status).toBe("RELEASED");
    expect(updated.product_released_at).toBe(now);
  });

  it("works even after 24h deadline (still manual confirm)", () => {
    const r = reviewReady();
    const afterDeadline = addHours("2026-03-05T12:00:00.000Z", 48);
    const updated = buyerConfirmReceipt(r, afterDeadline);
    expect(updated.product_release_status).toBe("RELEASED");
  });

  it("throws if not in BUYER_REVIEW status", () => {
    const r = makeRelease({ product_release_status: "PENDING_DELIVERY" });
    expect(() => buyerConfirmReceipt(r, NOW)).toThrow(/expected "BUYER_REVIEW"/);
  });

  it("throws if already RELEASED", () => {
    const r = makeRelease({ product_release_status: "RELEASED" });
    expect(() => buyerConfirmReceipt(r, NOW)).toThrow(/expected "BUYER_REVIEW"/);
  });
});

// ===========================================================================
// 4. applyApvAdjustment
// ===========================================================================

describe("applyApvAdjustment", () => {
  it("records adjustment amount", () => {
    const r = makeRelease();
    const updated = applyApvAdjustment(r, 1_50);
    expect(updated.apv_adjustment_minor).toBe(1_50);
  });

  it("transitions buffer to ADJUSTING", () => {
    const r = makeRelease();
    expect(r.buffer_release_status).toBe("HELD");
    const updated = applyApvAdjustment(r, 1_00);
    expect(updated.buffer_release_status).toBe("ADJUSTING");
  });

  it("accumulates multiple adjustments", () => {
    let r = makeRelease();
    r = applyApvAdjustment(r, 1_00);
    r = applyApvAdjustment(r, 2_00);
    expect(r.apv_adjustment_minor).toBe(3_00);
  });

  it("throws if buffer already RELEASED", () => {
    const r = makeRelease({ buffer_release_status: "RELEASED" });
    expect(() => applyApvAdjustment(r, 1_00)).toThrow(
      /buffer already RELEASED/,
    );
  });
});

// ===========================================================================
// 5. completeBufferRelease
// ===========================================================================

describe("completeBufferRelease", () => {
  function bufferReady(): SettlementRelease {
    let r = makeRelease();
    r = confirmDelivery(r, "2026-03-05T12:00:00.000Z");
    return r;
  }

  it("releases buffer when 14 days passed", () => {
    const r = bufferReady();
    const afterDeadline = addDays("2026-03-05T12:00:00.000Z", 15);
    const updated = completeBufferRelease(r, afterDeadline);
    expect(updated.buffer_release_status).toBe("RELEASED");
    expect(updated.buffer_released_at).toBe(afterDeadline);
  });

  it("calculates final amount (buffer - adjustment)", () => {
    let r = bufferReady();
    r = applyApvAdjustment(r, 2_00);
    const afterDeadline = addDays("2026-03-05T12:00:00.000Z", 15);
    const updated = completeBufferRelease(r, afterDeadline);
    expect(updated.buffer_final_amount_minor).toBe(BUFFER.amount_minor - 2_00);
  });

  it("clamps negative to 0", () => {
    let r = bufferReady();
    r = applyApvAdjustment(r, 999_99); // far exceeds buffer
    const afterDeadline = addDays("2026-03-05T12:00:00.000Z", 15);
    const updated = completeBufferRelease(r, afterDeadline);
    expect(updated.buffer_final_amount_minor).toBe(0);
  });

  it("throws when deadline not reached", () => {
    const r = bufferReady();
    const beforeDeadline = "2026-03-10T00:00:00.000Z";
    expect(() => completeBufferRelease(r, beforeDeadline)).toThrow(
      /deadline not yet reached/,
    );
  });

  it("throws if already RELEASED", () => {
    const r = makeRelease({ buffer_release_status: "RELEASED" });
    expect(() =>
      completeBufferRelease(r, addDays(NOW, 30)),
    ).toThrow(/buffer already RELEASED/);
  });
});

// ===========================================================================
// 6. computeReleasePhase
// ===========================================================================

describe("computeReleasePhase", () => {
  it("PENDING_DELIVERY → AWAITING_DELIVERY", () => {
    const r = makeRelease();
    expect(computeReleasePhase(r)).toBe("AWAITING_DELIVERY");
  });

  it("BUYER_REVIEW → BUYER_REVIEW", () => {
    const r = makeRelease({ product_release_status: "BUYER_REVIEW" });
    expect(computeReleasePhase(r)).toBe("BUYER_REVIEW");
  });

  it("RELEASED + HELD → PRODUCT_RELEASED_BUFFER_HELD", () => {
    const r = makeRelease({
      product_release_status: "RELEASED",
      buffer_release_status: "HELD",
    });
    expect(computeReleasePhase(r)).toBe("PRODUCT_RELEASED_BUFFER_HELD");
  });

  it("RELEASED + ADJUSTING → BUFFER_ADJUSTING", () => {
    const r = makeRelease({
      product_release_status: "RELEASED",
      buffer_release_status: "ADJUSTING",
    });
    expect(computeReleasePhase(r)).toBe("BUFFER_ADJUSTING");
  });

  it("RELEASED + RELEASED → FULLY_RELEASED", () => {
    const r = makeRelease({
      product_release_status: "RELEASED",
      buffer_release_status: "RELEASED",
    });
    expect(computeReleasePhase(r)).toBe("FULLY_RELEASED");
  });
});

// ===========================================================================
// 7. isFullyReleased
// ===========================================================================

describe("isFullyReleased", () => {
  it("true when both released", () => {
    const r = makeRelease({
      product_release_status: "RELEASED",
      buffer_release_status: "RELEASED",
    });
    expect(isFullyReleased(r)).toBe(true);
  });

  it("false otherwise", () => {
    expect(isFullyReleased(makeRelease())).toBe(false);
    expect(
      isFullyReleased(
        makeRelease({
          product_release_status: "RELEASED",
          buffer_release_status: "HELD",
        }),
      ),
    ).toBe(false);
    expect(
      isFullyReleased(
        makeRelease({
          product_release_status: "BUYER_REVIEW",
          buffer_release_status: "RELEASED",
        }),
      ),
    ).toBe(false);
  });
});

// ===========================================================================
// 8. Full lifecycle
// ===========================================================================

describe("full lifecycle", () => {
  it("create → confirmDelivery → completeBuyerReview → applyApvAdjustment → completeBufferRelease → isFullyReleased", () => {
    const deliveredAt = "2026-03-05T12:00:00.000Z";

    // 1. Create
    let r = createSettlementRelease({
      payment_intent_id: "pi_lifecycle",
      order_id: "ord_lifecycle",
      product_amount: PRODUCT,
      buffer_amount: BUFFER,
      now: NOW,
    });
    expect(computeReleasePhase(r)).toBe("AWAITING_DELIVERY");
    expect(isFullyReleased(r)).toBe(false);

    // 2. Confirm delivery
    r = confirmDelivery(r, deliveredAt);
    expect(computeReleasePhase(r)).toBe("BUYER_REVIEW");

    // 3. Complete buyer review (after 3-day deadline)
    const reviewTime = addHours(deliveredAt, BUYER_REVIEW_HOURS + 1);
    r = completeBuyerReview(r, reviewTime);
    expect(computeReleasePhase(r)).toBe("PRODUCT_RELEASED_BUFFER_HELD");

    // 4. Apply APV adjustment
    r = applyApvAdjustment(r, 1_50);
    expect(computeReleasePhase(r)).toBe("BUFFER_ADJUSTING");
    expect(r.apv_adjustment_minor).toBe(1_50);

    // 5. Complete buffer release (after 14-day deadline)
    const bufferTime = addDays(deliveredAt, BUFFER_RELEASE_DAYS + 1);
    r = completeBufferRelease(r, bufferTime);
    expect(computeReleasePhase(r)).toBe("FULLY_RELEASED");
    expect(r.buffer_final_amount_minor).toBe(BUFFER.amount_minor - 1_50);

    // 6. Fully released
    expect(isFullyReleased(r)).toBe(true);
  });
});
