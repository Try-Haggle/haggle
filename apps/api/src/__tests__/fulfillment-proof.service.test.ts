import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FulfillmentRecord } from "../services/fulfillment-record.service.js";
import {
  FulfillmentProofError,
  submitSellerFulfillmentProof,
  transitionFulfillmentForSellerProofSubmit,
} from "../services/fulfillment-proof.service.js";

const mockGetFulfillmentByOrderId = vi.fn();
const mockUpdateFulfillmentRecord = vi.fn();
const mockConfirmFulfillment = vi.fn();
const mockUpdateSettlementReleaseRecord = vi.fn();

vi.mock("../services/fulfillment-record.service.js", () => ({
  getFulfillmentByOrderId: (...args: unknown[]) => mockGetFulfillmentByOrderId(...args),
  updateFulfillmentRecord: (...args: unknown[]) => mockUpdateFulfillmentRecord(...args),
}));

// Guardrail: proof submit must never pull release helpers.
vi.mock("@haggle/payment-core", () => ({
  confirmFulfillment: (...args: unknown[]) => mockConfirmFulfillment(...args),
  confirmDelivery: vi.fn(),
  buyerConfirmReceipt: vi.fn(),
  computeReleasePhase: vi.fn(),
}));

vi.mock("../services/settlement-release.service.js", () => ({
  getSettlementReleaseByOrderId: vi.fn(),
  updateSettlementReleaseRecord: (...args: unknown[]) =>
    mockUpdateSettlementReleaseRecord(...args),
}));

const NOW = "2026-09-06T00:00:00.000Z";

function makeFulfillment(overrides: Partial<FulfillmentRecord> = {}): FulfillmentRecord {
  return {
    id: "ful_001",
    order_id: "ord_001",
    fulfillment_type: "digital_delivery",
    status: "AWAITING_SELLER_ACTION",
    proof_required: true,
    proof_status: "PENDING",
    review_window_hours: 24,
    metadata: {},
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function createInsertDb(returningRow: Record<string, unknown>) {
  const returning = vi.fn().mockResolvedValue([returningRow]);
  const values = vi.fn().mockReturnValue({ returning });
  const insert = vi.fn().mockReturnValue({ values });
  return { db: { insert } as never, insert, values, returning };
}

describe("transitionFulfillmentForSellerProofSubmit", () => {
  it("moves to PROOF_SUBMITTED / SUBMITTED without fulfilled_at", () => {
    const updated = transitionFulfillmentForSellerProofSubmit(makeFulfillment(), NOW);
    expect(updated.status).toBe("PROOF_SUBMITTED");
    expect(updated.proof_status).toBe("SUBMITTED");
    expect(updated.fulfilled_at).toBeUndefined();
    expect(updated.updated_at).toBe(NOW);
  });

  it("rejects proof submit after fulfillment is already FULFILLED", () => {
    expect(() =>
      transitionFulfillmentForSellerProofSubmit(
        makeFulfillment({ status: "FULFILLED", fulfilled_at: NOW }),
        NOW,
      ),
    ).toThrow(FulfillmentProofError);
  });
});

describe("submitSellerFulfillmentProof", () => {
  beforeEach(() => {
    mockGetFulfillmentByOrderId.mockReset();
    mockUpdateFulfillmentRecord.mockReset();
    mockConfirmFulfillment.mockReset();
    mockUpdateSettlementReleaseRecord.mockReset();
  });

  it("stores untrusted proof and does not release funds or start buyer review", async () => {
    const fulfillment = makeFulfillment();
    mockGetFulfillmentByOrderId.mockResolvedValue(fulfillment);
    mockUpdateFulfillmentRecord.mockResolvedValue(undefined);

    const proofRow = {
      id: "fp_001",
      fulfillmentId: fulfillment.id,
      proofKind: "access_grant",
      uri: "supabase://private/proofs/demo",
      sha256: "sha256:abc",
      externalReference: null,
      submittedBy: "seller_001",
      verificationStatus: "PENDING",
      metadata: { platform: "github" },
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    };
    const { db } = createInsertDb(proofRow);

    const result = await submitSellerFulfillmentProof(db, {
      order_id: fulfillment.order_id,
      submitted_by: "seller_001",
      kind: "access_grant",
      uri: "supabase://private/proofs/demo",
      sha256: "sha256:abc",
      metadata: { platform: "github" },
      now: NOW,
    });

    expect(result.proof.verification_status).toBe("PENDING");
    expect(result.proof.proof_kind).toBe("access_grant");
    expect(result.fulfillment.status).toBe("PROOF_SUBMITTED");
    expect(result.fulfillment.proof_status).toBe("SUBMITTED");
    expect(result.fulfillment.fulfilled_at).toBeUndefined();

    expect(mockUpdateFulfillmentRecord).toHaveBeenCalledTimes(1);
    expect(mockUpdateFulfillmentRecord.mock.calls[0][1]).toMatchObject({
      status: "PROOF_SUBMITTED",
      proof_status: "SUBMITTED",
    });

    // Critical A5 invariants: no confirmFulfillment / no settlement release mutation.
    expect(mockConfirmFulfillment).not.toHaveBeenCalled();
    expect(mockUpdateSettlementReleaseRecord).not.toHaveBeenCalled();
  });

  it("requires at least one evidence field", async () => {
    await expect(
      submitSellerFulfillmentProof({ insert: vi.fn() } as never, {
        order_id: "ord_001",
        submitted_by: "seller_001",
        kind: "access_grant",
      }),
    ).rejects.toMatchObject({ code: "PROOF_EVIDENCE_REQUIRED" });
    expect(mockGetFulfillmentByOrderId).not.toHaveBeenCalled();
  });

  it("returns FULFILLMENT_NOT_FOUND when no fulfillment row exists", async () => {
    mockGetFulfillmentByOrderId.mockResolvedValue(null);
    await expect(
      submitSellerFulfillmentProof({ insert: vi.fn() } as never, {
        order_id: "ord_missing",
        submitted_by: "seller_001",
        kind: "access_grant",
        uri: "supabase://private/proofs/x",
      }),
    ).rejects.toMatchObject({ code: "FULFILLMENT_NOT_FOUND" });
  });
});
