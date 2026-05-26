import { describe, expect, it, vi } from "vitest";
import { assertPaymentReadyForExecution } from "@haggle/payment-core";
import {
  completePaymentOperationIdempotencyRecord,
  createPaymentSettlementRecord,
  getActivePaymentIntentByOrderId,
  getInProgressPaymentOperationForIntent,
  getPaymentSettlementByPaymentIntentId,
  getSettlementApprovalById,
} from "../services/payment-record.service.js";

function buildDb(row: unknown) {
  return {
    query: {
      settlementApprovals: {
        findFirst: vi.fn().mockResolvedValue(row),
      },
    },
  };
}

function paymentSettlementRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "settlement_123",
    paymentIntentId: "pi_123",
    rail: "x402",
    providerReference: "tx_123",
    settledAmountMinor: "1000",
    currency: "USD",
    status: "SETTLED",
    settledAt: new Date("2026-05-07T12:00:00.000Z"),
    createdAt: new Date("2026-05-07T12:00:00.000Z"),
    ...overrides,
  };
}

function buildSettlementDb(returningRows: unknown[], existingRow: unknown = null) {
  const returning = vi.fn().mockResolvedValue(returningRows);
  const onConflictDoNothing = vi.fn().mockReturnValue({ returning });
  const values = vi.fn().mockReturnValue({ onConflictDoNothing });
  const insert = vi.fn().mockReturnValue({ values });

  return {
    insert,
    query: {
      paymentSettlements: {
        findFirst: vi.fn().mockResolvedValue(existingRow),
      },
    },
    _mocks: { values, onConflictDoNothing, returning },
  };
}

function buildUpdateDb() {
  const where = vi.fn().mockResolvedValue([]);
  const set = vi.fn().mockReturnValue({ where });
  const update = vi.fn().mockReturnValue({ set });
  return { update, _mocks: { set, where } };
}

describe("payment-record.service", () => {
  it("maps an accepted negotiation approval row into a payment-ready settlement approval", async () => {
    const sessionId = "00000000-0000-4000-a000-000000000099";
    const listingId = "00000000-0000-4000-a000-000000000011";
    const buyerId = "00000000-0000-4000-a000-000000000022";
    const sellerId = "00000000-0000-4000-a000-000000000033";
    const acceptedAt = new Date("2026-05-07T12:00:00.000Z");
    const row = {
      id: sessionId,
      listingId,
      sellerId,
      buyerId,
      approvalState: "APPROVED",
      sellerApprovalMode: "AUTO_WITHIN_POLICY",
      selectedPaymentRail: "x402",
      currency: "USD",
      finalAmountMinor: "50000",
      holdKind: null,
      heldSnapshotPriceMinor: null,
      heldSnapshotUtility: null,
      heldAt: null,
      holdReason: null,
      resumeRepriceRequired: true,
      reservedUntil: null,
      buyerApprovedAt: acceptedAt,
      sellerApprovedAt: acceptedAt,
      shipmentInputDueAt: null,
      termsSnapshot: {
        session_id: sessionId,
        listing_id: listingId,
        agreed_price_minor: 50_000,
        final_amount_minor: 50_000,
        buyer_id: buyerId,
        seller_id: sellerId,
        selected_payment_rail: "x402",
        currency: "USD",
        seller_policy_shipment_input_due_days: 3,
        seller_policy_median_response_minutes: 30,
        seller_policy_p95_response_minutes: 120,
        seller_policy_reliable_fast_responder: true,
        negotiated_at: acceptedAt.toISOString(),
      },
      createdAt: acceptedAt,
      updatedAt: acceptedAt,
    };
    const db = buildDb(row);

    const approval = await getSettlementApprovalById(db as never, sessionId);

    expect(db.query.settlementApprovals.findFirst).toHaveBeenCalled();
    if (!approval) {
      throw new Error("expected settlement approval to be mapped");
    }
    expect(approval).toMatchObject({
      id: sessionId,
      approval_state: "APPROVED",
      buyer_approved_at: acceptedAt.toISOString(),
      seller_approved_at: acceptedAt.toISOString(),
      seller_policy: {
        mode: "AUTO_WITHIN_POLICY",
        fulfillment_sla: { shipment_input_due_days: 3 },
        responsiveness: {
          median_response_minutes: 30,
          p95_response_minutes: 120,
          reliable_fast_responder: true,
        },
      },
      terms: {
        listing_id: listingId,
        seller_id: sellerId,
        buyer_id: buyerId,
        final_amount_minor: 50_000,
        currency: "USD",
        selected_payment_rail: "x402",
      },
    });

    const ready = assertPaymentReadyForExecution(approval, {
      actor_id: buyerId,
      actor_role: "buyer",
    });

    expect(ready).toMatchObject({
      settlement_approval_id: sessionId,
      listing_id: listingId,
      seller_id: sellerId,
      buyer_id: buyerId,
      amount_minor: 50_000,
      currency: "USD",
      selected_rail: "x402",
    });
  });

  it("maps the active payment intent lookup for an order", async () => {
    const now = new Date("2026-05-07T12:00:00.000Z");
    const orderId = "00000000-0000-4000-a000-000000000088";
    const row = {
      id: "00000000-0000-4000-a000-000000000066",
      orderId,
      sellerId: "00000000-0000-4000-a000-000000000033",
      buyerId: "00000000-0000-4000-a000-000000000022",
      selectedRail: "x402",
      allowedRails: ["x402", "stripe"],
      buyerAuthorizationMode: "human_wallet",
      currency: "USD",
      amountMinor: "50000",
      status: "CREATED",
      agentPaymentGrantId: "00000000-0000-4000-a000-000000000077",
      approvalPolicyHash: "sha256:policy",
      agreementHash: "sha256:agreement",
      listingHash: "sha256:listing",
      providerContext: null,
      createdAt: now,
      updatedAt: now,
    };
    const db = {
      query: {
        paymentIntents: {
          findFirst: vi.fn().mockResolvedValue(row),
        },
      },
    };

    const intent = await getActivePaymentIntentByOrderId(db as never, orderId);

    expect(db.query.paymentIntents.findFirst).toHaveBeenCalled();
    expect(intent).toMatchObject({
      id: row.id,
      order_id: orderId,
      seller_id: row.sellerId,
      buyer_id: row.buyerId,
      selected_rail: "x402",
      amount: { currency: "USD", amount_minor: 50_000 },
      status: "CREATED",
      production_status: "pending",
      agent_payment_grant_id: row.agentPaymentGrantId,
      approval_policy_hash: row.approvalPolicyHash,
    });
  });

  it("fails closed when persisted legacy and canonical payment states conflict", async () => {
    const now = new Date("2026-05-07T12:00:00.000Z");
    const db = {
      query: {
        paymentIntents: {
          findFirst: vi.fn().mockResolvedValue({
            id: "00000000-0000-4000-a000-000000000066",
            orderId: "00000000-0000-4000-a000-000000000088",
            sellerId: "00000000-0000-4000-a000-000000000033",
            buyerId: "00000000-0000-4000-a000-000000000022",
            selectedRail: "x402",
            allowedRails: ["x402", "stripe"],
            buyerAuthorizationMode: "human_wallet",
            currency: "USD",
            amountMinor: "50000",
            status: "CANCELED",
            canonicalStatus: "captured",
            agentPaymentGrantId: null,
            approvalPolicyHash: null,
            agreementHash: null,
            listingHash: null,
            providerContext: null,
            createdAt: now,
            updatedAt: now,
          }),
        },
      },
    };

    await expect(getActivePaymentIntentByOrderId(db as never, "00000000-0000-4000-a000-000000000088"))
      .rejects
      .toThrow("incompatible payment statuses: legacy=CANCELED production=captured");
  });

  it("creates and maps a payment settlement record", async () => {
    const row = paymentSettlementRow();
    const db = buildSettlementDb([row]);

    const settlement = await createPaymentSettlementRecord(db as never, {
      id: "settlement_123",
      payment_intent_id: "pi_123",
      rail: "x402",
      provider_reference: "tx_123",
      settled_amount: { currency: "USD", amount_minor: 1000 },
      settled_at: "2026-05-07T12:00:00.000Z",
      status: "SETTLED",
    });

    expect(db._mocks.values).toHaveBeenCalledWith(expect.objectContaining({
      id: "settlement_123",
      paymentIntentId: "pi_123",
      providerReference: "tx_123",
      settledAmountMinor: "1000",
      status: "SETTLED",
    }));
    expect(settlement).toEqual({
      id: "settlement_123",
      payment_intent_id: "pi_123",
      rail: "x402",
      provider_reference: "tx_123",
      settled_amount: { currency: "USD", amount_minor: 1000 },
      settled_at: "2026-05-07T12:00:00.000Z",
      status: "SETTLED",
    });
  });

  it("returns the existing settlement record on payment-intent conflict", async () => {
    const existing = paymentSettlementRow({ id: "settlement_existing" });
    const db = buildSettlementDb([], existing);

    const settlement = await createPaymentSettlementRecord(db as never, {
      id: "settlement_retry",
      payment_intent_id: "pi_123",
      rail: "x402",
      provider_reference: "tx_retry",
      settled_amount: { currency: "USD", amount_minor: 1000 },
      settled_at: "2026-05-07T12:00:00.000Z",
      status: "SETTLED",
    });

    expect(db.query.paymentSettlements.findFirst).toHaveBeenCalled();
    expect(settlement).toMatchObject({
      id: "settlement_existing",
      payment_intent_id: "pi_123",
      provider_reference: "tx_123",
    });
  });

  it("fails settlement creation when conflict fallback cannot find a row", async () => {
    const db = buildSettlementDb([], null);

    await expect(createPaymentSettlementRecord(db as never, {
      id: "settlement_retry",
      payment_intent_id: "pi_missing",
      rail: "x402",
      provider_reference: "tx_retry",
      settled_amount: { currency: "USD", amount_minor: 1000 },
      settled_at: "2026-05-07T12:00:00.000Z",
      status: "SETTLED",
    })).rejects.toThrow("PAYMENT_SETTLEMENT_RECORD_NOT_CREATED:pi_missing");
  });

  it("looks up a settlement record by payment intent id", async () => {
    const row = paymentSettlementRow({ paymentIntentId: "pi_lookup" });
    const db = {
      query: {
        paymentSettlements: {
          findFirst: vi.fn().mockResolvedValue(row),
        },
      },
    };

    const settlement = await getPaymentSettlementByPaymentIntentId(db as never, "pi_lookup");

    expect(db.query.paymentSettlements.findFirst).toHaveBeenCalled();
    expect(settlement).toMatchObject({
      payment_intent_id: "pi_lookup",
      provider_reference: "tx_123",
      settled_amount: { currency: "USD", amount_minor: 1000 },
    });
  });

  it("completes an in-progress payment idempotency record in place", async () => {
    const db = buildUpdateDb();

    await completePaymentOperationIdempotencyRecord(db as never, "payment.capture", "idem-capture-1", {
      responseStatus: 200,
      responseBody: {
        intent: { id: "pi_123", status: "SETTLED" },
      },
    });

    expect(db.update).toHaveBeenCalled();
    expect(db._mocks.set).toHaveBeenCalledWith({
      responseStatus: 200,
      responseBody: {
        intent: { id: "pi_123", status: "SETTLED" },
      },
    });
    expect(db._mocks.where).toHaveBeenCalled();
  });

  it("finds an in-progress payment operation for the same intent across operations", async () => {
    const row = {
      operation: "payment.capture",
      idempotencyKey: "idem-existing",
      paymentIntentId: "pi_123",
      responseStatus: 409,
      responseBody: { error: "PAYMENT_OPERATION_IN_PROGRESS" },
    };
    const db = {
      query: {
        paymentOperationIdempotency: {
          findFirst: vi.fn().mockResolvedValue(row),
        },
      },
    };

    const result = await getInProgressPaymentOperationForIntent(
      db as never,
      "pi_123",
      "idem-new",
    );

    expect(db.query.paymentOperationIdempotency.findFirst).toHaveBeenCalled();
    expect(result).toBe(row);
  });

  it("ignores completed payment operation records when checking per-intent lock", async () => {
    const db = {
      query: {
        paymentOperationIdempotency: {
          findFirst: vi.fn().mockResolvedValue({
            operation: "payment.capture",
            idempotencyKey: "idem-existing",
            paymentIntentId: "pi_123",
            responseStatus: 409,
            responseBody: { intent: { id: "pi_123", status: "SETTLED" } },
          }),
        },
      },
    };

    const result = await getInProgressPaymentOperationForIntent(
      db as never,
      "pi_123",
      "idem-new",
    );

    expect(result).toBeNull();
  });
});
