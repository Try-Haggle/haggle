import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DisputeCase, DisputeResolution } from "@haggle/dispute-core";
import { finalizeDisputeResolution } from "../services/dispute-resolution-finalizer.js";
import {
  createRefundRecord,
  getCommerceOrderByOrderId,
  getPaymentIntentByOrderId,
  updateCommerceOrderStatus,
} from "../services/payment-record.service.js";
import {
  createDisputeResolutionRecord,
  updateDisputeRecord,
} from "../services/dispute-record.service.js";
import {
  getDepositByDisputeId,
  updateDepositStatus,
} from "../services/dispute-deposit.service.js";
import { createPaymentServiceFromEnv } from "../payments/providers.js";
import { executeRefund } from "../payments/refund-executor.js";
import { refundDeposit } from "../payments/deposit-refunder.js";

vi.mock("../services/payment-record.service.js", () => ({
  createRefundRecord: vi.fn().mockResolvedValue(null),
  getCommerceOrderByOrderId: vi.fn().mockResolvedValue({
    id: "ord_1",
    buyerId: "buyer_1",
    sellerId: "seller_1",
    amountMinor: "10000",
  }),
  getPaymentIntentByOrderId: vi.fn(),
  getPaymentIntentRowById: vi.fn().mockResolvedValue(null),
  updateCommerceOrderStatus: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/dispute-record.service.js", () => ({
  createDisputeResolutionRecord: vi.fn().mockResolvedValue(null),
  updateDisputeRecord: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/dispute-deposit.service.js", () => ({
  getDepositByDisputeId: vi.fn().mockResolvedValue(null),
  updateDepositStatus: vi.fn().mockResolvedValue(null),
}));

vi.mock("../payments/providers.js", () => ({
  createPaymentServiceFromEnv: vi.fn(),
}));

vi.mock("../payments/refund-executor.js", () => ({
  executeRefund: vi.fn(),
}));

vi.mock("../payments/deposit-refunder.js", () => ({
  refundDeposit: vi.fn(),
}));

vi.mock("../chain/dispute-anchoring.js", () => ({
  anchorDisputeOnChain: vi.fn().mockResolvedValue({ tx_hash: "0xanchor" }),
  computeEvidenceMerkleRoot: vi.fn().mockReturnValue("0xevidence"),
  computeResolutionHash: vi.fn().mockReturnValue("0xresolution"),
}));

const mockCreatePaymentServiceFromEnv = vi.mocked(createPaymentServiceFromEnv);
const mockGetPaymentIntentByOrderId = vi.mocked(getPaymentIntentByOrderId);
const mockGetCommerceOrderByOrderId = vi.mocked(getCommerceOrderByOrderId);
const mockCreateRefundRecord = vi.mocked(createRefundRecord);
const mockUpdateCommerceOrderStatus = vi.mocked(updateCommerceOrderStatus);
const mockUpdateDisputeRecord = vi.mocked(updateDisputeRecord);
const mockCreateDisputeResolutionRecord = vi.mocked(createDisputeResolutionRecord);
const mockExecuteRefund = vi.mocked(executeRefund);
const mockGetDepositByDisputeId = vi.mocked(getDepositByDisputeId);
const mockUpdateDepositStatus = vi.mocked(updateDepositStatus);
const mockRefundDeposit = vi.mocked(refundDeposit);

function createDbMock() {
  const updateWhere = vi.fn().mockResolvedValue([]);
  const set = vi.fn().mockReturnValue({ where: updateWhere });
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
    update: vi.fn().mockReturnValue({ set }),
    query: {
      userWallets: {
        findFirst: vi.fn().mockResolvedValue({
          walletAddress: "0x0000000000000000000000000000000000000001",
        }),
      },
    },
    __updateSet: set,
  };
}

function dispute(overrides: Partial<DisputeCase> = {}): DisputeCase {
  return {
    id: "disp_1",
    order_id: "ord_1",
    reason_code: "ITEM_NOT_AS_DESCRIBED",
    status: "UNDER_REVIEW",
    opened_by: "buyer",
    opened_at: new Date().toISOString(),
    evidence: [],
    metadata: { tier: 2 },
    ...overrides,
  } as DisputeCase;
}

function resolution(overrides: Partial<DisputeResolution> = {}): DisputeResolution {
  return {
    outcome: "partial_refund",
    summary: "refund",
    refund_amount_minor: 2500,
    resolved_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("finalizeDisputeResolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCommerceOrderByOrderId.mockResolvedValue({
      id: "ord_1",
      buyerId: "buyer_1",
      sellerId: "seller_1",
      amountMinor: "10000",
    } as Awaited<ReturnType<typeof getCommerceOrderByOrderId>>);
  });

  it("does not mark an order refunded when the real refund execution fails", async () => {
    const db = createDbMock();
    mockGetPaymentIntentByOrderId.mockResolvedValue({
      id: "pi_1",
      order_id: "ord_1",
      seller_id: "seller_1",
      buyer_id: "buyer_1",
      selected_rail: "x402",
      allowed_rails: ["x402"],
      amount: { currency: "USD", amount_minor: 10000 },
      status: "SETTLED",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    mockCreatePaymentServiceFromEnv.mockReturnValue({
      refundIntent: vi.fn().mockResolvedValue({
        refund: {
          id: "refund_1",
          payment_intent_id: "pi_1",
          amount: { currency: "USD", amount_minor: 2500 },
          reason_code: "dispute_partial_refund",
          status: "PENDING",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        metadata: { provider_reference: "provider_ref_1" },
      }),
    } as unknown as ReturnType<typeof createPaymentServiceFromEnv>);
    mockExecuteRefund.mockRejectedValue(new Error("relayer down"));

    await expect(finalizeDisputeResolution(db as never, dispute(), resolution()))
      .rejects.toThrow("relayer down");

    expect(mockCreateRefundRecord).toHaveBeenCalled();
    expect(mockExecuteRefund).toHaveBeenCalled();
    expect(db.__updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: "FAILED" }));
    expect(mockUpdateCommerceOrderStatus).not.toHaveBeenCalledWith(expect.anything(), "ord_1", "REFUNDED");
    expect(mockUpdateDisputeRecord).not.toHaveBeenCalled();
    expect(mockCreateDisputeResolutionRecord).not.toHaveBeenCalled();
  });

  it("persists the resolution and refunded order only after refund execution succeeds", async () => {
    const db = createDbMock();
    mockGetPaymentIntentByOrderId.mockResolvedValue({
      id: "pi_1",
      order_id: "ord_1",
      seller_id: "seller_1",
      buyer_id: "buyer_1",
      selected_rail: "x402",
      allowed_rails: ["x402"],
      amount: { currency: "USD", amount_minor: 10000 },
      status: "SETTLED",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    mockCreatePaymentServiceFromEnv.mockReturnValue({
      refundIntent: vi.fn().mockResolvedValue({
        refund: {
          id: "refund_1",
          payment_intent_id: "pi_1",
          amount: { currency: "USD", amount_minor: 2500 },
          reason_code: "dispute_partial_refund",
          status: "PENDING",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        metadata: { provider_reference: "provider_ref_1" },
      }),
    } as unknown as ReturnType<typeof createPaymentServiceFromEnv>);
    mockExecuteRefund.mockResolvedValue({ tx_hash: "0xrefunded" });

    await finalizeDisputeResolution(db as never, dispute(), resolution());

    expect(db.__updateSet).toHaveBeenCalledWith(expect.objectContaining({
      status: "COMPLETED",
      providerReference: "0xrefunded",
    }));
    expect(mockUpdateCommerceOrderStatus).toHaveBeenCalledWith(expect.anything(), "ord_1", "REFUNDED");
    expect(mockUpdateDisputeRecord).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      status: "PARTIAL_REFUND",
      metadata: expect.objectContaining({ pending_anchor: true }),
    }));
    expect(mockCreateDisputeResolutionRecord).toHaveBeenCalledWith(expect.anything(), "disp_1", expect.objectContaining({
      outcome: "partial_refund",
    }));
  });

  it("does not close seller-favor disputes when deposit refund fails", async () => {
    const db = createDbMock();
    mockGetDepositByDisputeId.mockResolvedValue({
      id: "dep_1",
      disputeId: "disp_1",
      tier: 2,
      amountCents: 500,
      status: "DEPOSITED",
      metadata: {
        rail: "usdc",
        wallet_address: "0x0000000000000000000000000000000000000001",
      },
    } as unknown as Awaited<ReturnType<typeof getDepositByDisputeId>>);
    mockRefundDeposit.mockRejectedValue(new Error("deposit refund failed"));

    await expect(finalizeDisputeResolution(
      db as never,
      dispute(),
      resolution({ outcome: "seller_favor", refund_amount_minor: 0 }),
    )).rejects.toThrow("deposit refund failed");

    expect(mockRefundDeposit).toHaveBeenCalled();
    expect(mockUpdateDepositStatus).not.toHaveBeenCalled();
    expect(mockUpdateCommerceOrderStatus).not.toHaveBeenCalledWith(expect.anything(), "ord_1", "CLOSED");
    expect(mockUpdateDisputeRecord).not.toHaveBeenCalled();
    expect(mockCreateDisputeResolutionRecord).not.toHaveBeenCalled();
  });
});
