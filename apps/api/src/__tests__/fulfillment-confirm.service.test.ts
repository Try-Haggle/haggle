import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  confirmBuyerAccess,
  FulfillmentConfirmError,
  transitionFulfillmentForBuyerAccessConfirm,
} from "../services/fulfillment-confirm.service.js";
import type { FulfillmentRecord } from "../services/fulfillment-record.service.js";

const mockGetFulfillmentByOrderId = vi.fn();
const mockUpdateFulfillmentRecord = vi.fn();
const mockGetSettlementReleaseByOrderId = vi.fn();
const mockUpdateSettlementReleaseRecord = vi.fn();
const mockGetCommerceOrderByOrderId = vi.fn();
const mockGetActiveDisputeByOrderId = vi.fn();
const mockConfirmFulfillment = vi.fn();
const mockBuyerConfirmReceipt = vi.fn();
const mockCompleteBuyerReview = vi.fn();

vi.mock("../services/fulfillment-record.service.js", () => ({
  getFulfillmentByOrderId: (...args: unknown[]) => mockGetFulfillmentByOrderId(...args),
  updateFulfillmentRecord: (...args: unknown[]) => mockUpdateFulfillmentRecord(...args),
}));

vi.mock("../services/settlement-release.service.js", () => ({
  getSettlementReleaseByOrderId: (...args: unknown[]) => mockGetSettlementReleaseByOrderId(...args),
  updateSettlementReleaseRecord: (...args: unknown[]) => mockUpdateSettlementReleaseRecord(...args),
}));

vi.mock("../services/payment-record.service.js", () => ({
  getCommerceOrderByOrderId: (...args: unknown[]) => mockGetCommerceOrderByOrderId(...args),
}));

vi.mock("../services/dispute-record.service.js", () => ({
  getActiveDisputeByOrderId: (...args: unknown[]) => mockGetActiveDisputeByOrderId(...args),
}));

vi.mock("@haggle/payment-core", () => ({
  confirmFulfillment: (...args: unknown[]) => mockConfirmFulfillment(...args),
  buyerConfirmReceipt: (...args: unknown[]) => mockBuyerConfirmReceipt(...args),
  completeBuyerReview: (...args: unknown[]) => mockCompleteBuyerReview(...args),
  computeReleasePhase: vi.fn(),
}));

const NOW = "2026-09-06T01:00:00.000Z";

function makeFulfillment(overrides: Partial<FulfillmentRecord> = {}): FulfillmentRecord {
  return {
    id: "ful_001",
    order_id: "ord_001",
    fulfillment_type: "digital_delivery",
    status: "PROOF_SUBMITTED",
    proof_required: true,
    proof_status: "SUBMITTED",
    review_window_hours: 24,
    metadata: {},
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function makeRelease(overrides: Record<string, unknown> = {}) {
  return {
    id: "release_1",
    payment_intent_id: "payment_1",
    order_id: "ord_001",
    product_amount: { currency: "USDC", amount_minor: 10_000_000 },
    product_release_status: "PENDING_DELIVERY",
    buffer_amount: { currency: "USDC", amount_minor: 0 },
    buffer_release_status: "RELEASED",
    apv_adjustment_minor: 0,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

describe("transitionFulfillmentForBuyerAccessConfirm", () => {
  it("sets FULFILLED and fulfilled_at from PROOF_SUBMITTED", () => {
    const updated = transitionFulfillmentForBuyerAccessConfirm(makeFulfillment(), NOW);
    expect(updated.status).toBe("FULFILLED");
    expect(updated.fulfilled_at).toBe(NOW);
  });

  it("rejects AWAITING_SELLER_ACTION", () => {
    expect(() =>
      transitionFulfillmentForBuyerAccessConfirm(
        makeFulfillment({ status: "AWAITING_SELLER_ACTION", proof_status: "PENDING" }),
        NOW,
      ),
    ).toThrow(FulfillmentConfirmError);
  });
});

describe("confirmBuyerAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCommerceOrderByOrderId.mockResolvedValue({
      id: "ord_001",
      status: "FULFILLMENT_PENDING",
    });
    mockGetActiveDisputeByOrderId.mockResolvedValue(null);
    mockUpdateFulfillmentRecord.mockResolvedValue(undefined);
    mockUpdateSettlementReleaseRecord.mockResolvedValue(undefined);
  });

  it("buyer confirm from PROOF_SUBMITTED starts review without releasing funds", async () => {
    const fulfillment = makeFulfillment();
    const release = makeRelease();
    mockGetFulfillmentByOrderId.mockResolvedValue(fulfillment);
    mockGetSettlementReleaseByOrderId.mockResolvedValue(release);

    const reviewed = {
      ...release,
      product_release_status: "BUYER_REVIEW",
      delivery_confirmed_at: NOW,
      buyer_review_deadline: "2026-09-07T01:00:00.000Z",
      updated_at: NOW,
    };
    mockConfirmFulfillment.mockReturnValue(reviewed);

    const db = {
      query: {
        fulfillmentProofs: {
          findFirst: vi.fn(),
        },
      },
    } as never;

    const result = await confirmBuyerAccess(db, {
      order_id: "ord_001",
      confirmation: "access_received",
      now: NOW,
    });

    expect(result.fulfillment.status).toBe("FULFILLED");
    expect(result.fulfillment.fulfilled_at).toBe(NOW);
    expect(result.buyer_review_started).toBe(true);
    expect(result.auto_released).toBe(false);
    expect(result.settlement_release?.product_release_status).toBe("BUYER_REVIEW");
    expect(result.settlement_release?.product_released_at).toBeUndefined();
    expect(result.settlement_release?.product_amount.amount_minor).toBe(10_000_000);

    expect(mockConfirmFulfillment).toHaveBeenCalledTimes(1);
    expect(mockConfirmFulfillment).toHaveBeenCalledWith(release, NOW);
    expect(mockUpdateSettlementReleaseRecord).toHaveBeenCalledTimes(1);
    expect(mockUpdateSettlementReleaseRecord.mock.calls[0][1]).toMatchObject({
      product_release_status: "BUYER_REVIEW",
    });

    // Critical A6 invariants: no money-move helpers.
    expect(mockBuyerConfirmReceipt).not.toHaveBeenCalled();
    expect(mockCompleteBuyerReview).not.toHaveBeenCalled();
  });

  it("rejects invalid confirmation values", async () => {
    await expect(
      confirmBuyerAccess({} as never, {
        order_id: "ord_001",
        confirmation: "not_valid",
      }),
    ).rejects.toMatchObject({ code: "INVALID_CONFIRMATION" });
    expect(mockGetFulfillmentByOrderId).not.toHaveBeenCalled();
  });

  it("rejects wrong fulfillment status", async () => {
    mockGetFulfillmentByOrderId.mockResolvedValue(
      makeFulfillment({ status: "AWAITING_SELLER_ACTION", proof_status: "PENDING" }),
    );
    await expect(
      confirmBuyerAccess({ query: { fulfillmentProofs: { findFirst: vi.fn() } } } as never, {
        order_id: "ord_001",
        confirmation: "access_received",
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "INVALID_FULFILLMENT_STATUS" });
    expect(mockConfirmFulfillment).not.toHaveBeenCalled();
  });

  it("rejects when an active dispute exists", async () => {
    mockGetFulfillmentByOrderId.mockResolvedValue(makeFulfillment());
    mockGetActiveDisputeByOrderId.mockResolvedValue({ id: "disp_1" });
    await expect(
      confirmBuyerAccess({ query: { fulfillmentProofs: { findFirst: vi.fn() } } } as never, {
        order_id: "ord_001",
        confirmation: "access_received",
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "ORDER_IN_DISPUTE" });
    expect(mockConfirmFulfillment).not.toHaveBeenCalled();
    expect(mockUpdateFulfillmentRecord).not.toHaveBeenCalled();
  });

  it("validates optional proof_id belongs to the fulfillment", async () => {
    mockGetFulfillmentByOrderId.mockResolvedValue(makeFulfillment());
    const findFirst = vi.fn().mockResolvedValue({
      id: "00000000-0000-4000-a000-000000000301",
      fulfillmentId: "other_ful",
    });
    await expect(
      confirmBuyerAccess({ query: { fulfillmentProofs: { findFirst } } } as never, {
        order_id: "ord_001",
        confirmation: "access_received",
        proof_id: "00000000-0000-4000-a000-000000000301",
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "PROOF_FULFILLMENT_MISMATCH" });
  });
});
