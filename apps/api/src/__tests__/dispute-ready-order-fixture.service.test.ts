import { describe, expect, it, vi } from "vitest";
import { createDisputeReadyOrderFixture } from "../services/dispute-ready-order-fixture.service.js";

function makeDb(rows: Record<string, unknown>[]) {
  let index = 0;
  const values = vi.fn().mockImplementation((payload: Record<string, unknown>) => {
    const row = {
      ...rows[Math.min(index, rows.length - 1)],
      ...payload,
      id: (rows[Math.min(index, rows.length - 1)] as { id?: string }).id ?? payload.id,
    };
    index += 1;
    return {
      returning: vi.fn().mockResolvedValue([row]),
    };
  });
  const insert = vi.fn().mockReturnValue({ values });
  return { db: { insert } as never, insert, values };
}

describe("createDisputeReadyOrderFixture", () => {
  it("creates approval, DELIVERED order, and SETTLED mock payment without PANs", async () => {
    const approvalId = "11111111-1111-4111-8111-111111111111";
    const orderId = "22222222-2222-4222-8222-222222222222";
    const intentId = "33333333-3333-4333-8333-333333333333";
    const { db, values } = makeDb([
      { id: approvalId },
      { id: orderId },
      { id: intentId },
    ]);

    const result = await createDisputeReadyOrderFixture(db, {
      buyerId: "00000000-0000-4000-a000-000000000010",
      amountMinor: 45_000,
      selectedPaymentRail: "stripe",
      listingId: "44444444-4444-4444-8444-444444444444",
      sellerId: "55555555-5555-4555-8555-555555555555",
    });

    expect(values).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({
      approval_id: approvalId,
      order_id: orderId,
      order_status: "DELIVERED",
      payment_intent_id: intentId,
      payment_intent_status: "SETTLED",
      money_moved: false,
      card_pan_used: false,
      next: { mcp_tool: "haggle_start_dispute", suggested_reason_code: "ITEM_NOT_AS_DESCRIBED" },
    });

    const intentPayload = values.mock.calls[2][0] as Record<string, unknown>;
    expect(intentPayload.status).toBe("SETTLED");
    expect(intentPayload.canonicalStatus).toBe("captured");
    const providerContext = intentPayload.providerContext as Record<string, unknown>;
    expect(providerContext.card_pan_used).toBe(false);
    expect(JSON.stringify(intentPayload)).not.toMatch(/\b4[0-9]{12}(?:[0-9]{3})?\b/);
  });
});
