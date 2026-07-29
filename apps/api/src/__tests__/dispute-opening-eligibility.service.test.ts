import { describe, expect, it } from "vitest";
import { evaluateDisputeOpeningEligibility } from "../services/dispute-opening-eligibility.service.js";

const NOW = new Date("2026-07-25T18:00:00.000Z");

function shipment(overrides: Record<string, unknown> = {}) {
  return {
    status: "LABEL_CREATED" as const,
    selected_rate_id: "rate_ground",
    label_created_at: "2026-07-25T16:00:00.000Z",
    metadata: {
      prepared_rate_quotes: [
        {
          id: "rate_ground",
          carrier: "USPS",
          service: "GroundAdvantage",
          est_delivery_days: 3,
        },
      ],
    },
    events: [],
    ...overrides,
  };
}

describe("evaluateDisputeOpeningEligibility", () => {
  it("blocks item-not-received when only a label has been created", () => {
    const result = evaluateDisputeOpeningEligibility({
      reasonCode: "ITEM_NOT_RECEIVED",
      openedBy: "buyer",
      orderStatus: "FULFILLMENT_ACTIVE",
      shipment: shipment(),
      now: NOW,
    });

    expect(result).toMatchObject({
      eligible: false,
      error: "DELIVERY_NOT_DUE",
    });
    expect(result.message).toContain("carrier has not accepted");
  });

  it("uses the selected rate estimate plus a two-day grace period", () => {
    const input = {
      reasonCode: "ITEM_NOT_RECEIVED" as const,
      openedBy: "buyer" as const,
      orderStatus: "FULFILLMENT_ACTIVE",
      shipment: shipment({
        status: "IN_TRANSIT",
        events: [
          {
            id: "evt_transit",
            shipment_id: "shp_1",
            status: "IN_TRANSIT",
            occurred_at: "2026-07-20T18:00:00.000Z",
          },
        ],
      }),
    };

    const beforeGraceEnds = evaluateDisputeOpeningEligibility({
      ...input,
      now: new Date("2026-07-24T17:59:59.000Z"),
    });
    const afterGraceEnds = evaluateDisputeOpeningEligibility({
      ...input,
      now: new Date("2026-07-25T18:00:00.000Z"),
    });

    expect(beforeGraceEnds).toMatchObject({
      eligible: false,
      error: "DELIVERY_NOT_DUE",
      available_at: "2026-07-25T18:00:00.000Z",
    });
    expect(afterGraceEnds.eligible).toBe(true);
  });

  it("allows item-not-received when the carrier says delivered", () => {
    const result = evaluateDisputeOpeningEligibility({
      reasonCode: "ITEM_NOT_RECEIVED",
      openedBy: "buyer",
      orderStatus: "FULFILLMENT_ACTIVE",
      shipment: shipment({ status: "DELIVERED" }),
      now: NOW,
    });

    expect(result.eligible).toBe(true);
  });

  it("requires delivery before item-condition claims", () => {
    const result = evaluateDisputeOpeningEligibility({
      reasonCode: "ITEM_NOT_AS_DESCRIBED",
      openedBy: "buyer",
      orderStatus: "FULFILLMENT_ACTIVE",
      shipment: shipment(),
      now: NOW,
    });

    expect(result).toMatchObject({
      eligible: false,
      error: "ITEM_NOT_DELIVERED",
    });
  });

  it("allows seller non-fulfillment only after its deadline", () => {
    const before = evaluateDisputeOpeningEligibility({
      reasonCode: "SELLER_NO_FULFILLMENT",
      openedBy: "buyer",
      orderStatus: "FULFILLMENT_PENDING",
      shipment: shipment({
        status: "LABEL_PENDING",
        shipment_input_due_at: "2026-07-26T18:00:00.000Z",
      }),
      now: NOW,
    });
    const after = evaluateDisputeOpeningEligibility({
      reasonCode: "SELLER_NO_FULFILLMENT",
      openedBy: "buyer",
      orderStatus: "FULFILLMENT_PENDING",
      shipment: shipment({
        status: "LABEL_PENDING",
        shipment_input_due_at: "2026-07-24T18:00:00.000Z",
      }),
      now: NOW,
    });

    expect(before).toMatchObject({
      eligible: false,
      error: "FULFILLMENT_NOT_DUE",
    });
    expect(after.eligible).toBe(true);
  });

  it("starts a fresh carrier-handoff window when a label is created", () => {
    const result = evaluateDisputeOpeningEligibility({
      reasonCode: "SELLER_NO_FULFILLMENT",
      openedBy: "buyer",
      orderStatus: "FULFILLMENT_ACTIVE",
      shipment: shipment({
        status: "LABEL_CREATED",
        label_created_at: "2026-07-25T16:00:00.000Z",
        shipment_input_due_at: "2026-07-20T16:00:00.000Z",
      }),
      now: NOW,
    });

    expect(result).toMatchObject({
      eligible: false,
      error: "FULFILLMENT_NOT_DUE",
    });
  });

  it("does not allow refund reasons to bypass shipping gates without a refund", () => {
    const result = evaluateDisputeOpeningEligibility({
      reasonCode: "REFUND_DISPUTE",
      openedBy: "buyer",
      orderStatus: "FULFILLMENT_ACTIVE",
      shipment: shipment(),
      now: NOW,
    });

    expect(result).toMatchObject({
      eligible: false,
      error: "REFUND_NOT_RECORDED",
    });
  });
});
