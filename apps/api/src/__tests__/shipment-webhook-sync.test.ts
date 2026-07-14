import fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerShipmentRoutes } from "../routes/shipments.js";

vi.mock("../services/admin-action-log.service.js", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/webhook-event-claim.service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/webhook-event-claim.service.js")>();
  return {
    ...actual,
    claimWebhookEvent: vi.fn().mockResolvedValue({
      outcome: "acquired",
      source: "easypost",
      eventId: "tracker.updated:TRACK123",
      claimId: "33333333-3333-4333-8333-333333333333",
      attemptCount: 1,
    }),
    completeWebhookEvent: vi.fn().mockResolvedValue(true),
    failWebhookEvent: vi.fn().mockResolvedValue(undefined),
    startWebhookClaimHeartbeat: vi.fn(() => vi.fn()),
  };
});

vi.mock("../services/shipment-record.service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/shipment-record.service.js")>();
  return {
    ...actual,
    applyCarrierShipmentEvent: vi.fn().mockImplementation(async (db) => {
      db.updates.push({ status: "DELIVERED" });
      return {
        shipment: {
          id: "ship_1",
          order_id: "ord_1",
          seller_id: "seller_1",
          buyer_id: "buyer_1",
          shipment_type: "outbound",
          status: "DELIVERED",
          carrier: "easypost",
          tracking_number: "TRACK123",
          label_refund_status: "NONE",
          events: [],
          created_at: "2026-04-20T00:00:00.000Z",
          updated_at: "2026-04-20T00:00:00.000Z",
        },
        event: {},
        disposition: "applied",
        stateChanged: true,
        effectsRequired: true,
      };
    }),
  };
});

function createDbMock() {
  const updates: Array<Record<string, unknown>> = [];
  const shipmentRow = {
    id: "ship_1",
    orderId: "ord_1",
    sellerId: "seller_1",
    buyerId: "buyer_1",
    status: "IN_TRANSIT",
    carrier: "easypost",
    trackingNumber: "TRACK123",
    deliveredAt: null,
    createdAt: new Date("2026-04-20T00:00:00.000Z"),
    updatedAt: new Date("2026-04-20T00:00:00.000Z"),
  };
  const releaseRow = {
    id: "rel_1",
    paymentIntentId: "pi_1",
    orderId: "ord_1",
    productAmountMinor: "10000",
    productCurrency: "USD",
    productReleaseStatus: "PENDING_DELIVERY",
    deliveryConfirmedAt: null,
    buyerReviewDeadline: null,
    productReleasedAt: null,
    bufferAmountMinor: "1000",
    bufferCurrency: "USD",
    bufferReleaseStatus: "HELD",
    bufferReleaseDeadline: null,
    apvAdjustmentMinor: "0",
    bufferFinalAmountMinor: null,
    bufferReleasedAt: null,
    createdAt: new Date("2026-04-20T00:00:00.000Z"),
    updatedAt: new Date("2026-04-20T00:00:00.000Z"),
  };

  return {
    updates,
    query: {
      shipments: {
        findFirst: vi.fn().mockResolvedValue(shipmentRow),
      },
      shipmentEvents: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      settlementReleases: {
        findFirst: vi.fn().mockResolvedValue(releaseRow),
      },
      disputeCases: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    },
    update: vi.fn().mockReturnValue({
      set: vi.fn((values: Record<string, unknown>) => {
        updates.push(values);
        return { where: vi.fn().mockResolvedValue([]) };
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
  };
}

describe("shipment EasyPost webhook sync", () => {
  it("syncs delivered webhooks to order status and settlement release review", async () => {
    const app = fastify();
    const db = createDbMock();
    registerShipmentRoutes(app, db as never);
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/shipments/webhooks/easypost",
      payload: {
        description: "tracker.updated",
        result: {
          tracking_code: "TRACK123",
          status: "delivered",
          carrier: "USPS",
          tracking_details: [],
        },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(expect.objectContaining({
      accepted: true,
      tracking_code: "TRACK123",
      new_status: "DELIVERED",
    }));
    expect(db.updates).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "DELIVERED" }),
      expect.objectContaining({ productReleaseStatus: "BUYER_REVIEW" }),
    ]));

    await app.close();
  });
});
