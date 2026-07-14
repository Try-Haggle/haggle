import { describe, expect, it, vi } from "vitest";
import type { Database } from "@haggle/db";
import { applyCarrierShipmentEvent } from "../services/shipment-record.service.js";

function baseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    orderId: "22222222-2222-4222-8222-222222222222",
    sellerId: "33333333-3333-4333-8333-333333333333",
    buyerId: "44444444-4444-4444-8444-444444444444",
    status: "IN_TRANSIT",
    shipmentType: "outbound",
    carrier: "easypost",
    trackingNumber: "EZ100",
    labelCreatedAt: null,
    shippedAt: null,
    deliveredAt: null,
    lastCarrierEventAt: new Date("2026-07-12T10:00:00.000Z"),
    lastCarrierEventKey: "evt_1",
    shipmentInputDueAt: null,
    shippingFeeMinor: null,
    currency: "USD",
    declaredWeightOz: null,
    parcelLengthIn: null,
    parcelWidthIn: null,
    parcelHeightIn: null,
    parcelWeightOz: null,
    selectedRateId: null,
    labelUrl: null,
    labelRefundStatus: "NONE",
    labelRefundClaimId: null,
    labelRefundLeaseExpiresAt: null,
    labelRefundAttemptCount: 0,
    labelRefundRequestedAt: null,
    labelRefundUpdatedAt: null,
    rateMinor: null,
    metadata: {},
    createdAt: new Date("2026-07-10T00:00:00.000Z"),
    updatedAt: new Date("2026-07-12T10:00:00.000Z"),
    ...overrides,
  };
}

function statefulDb(initialRow: ReturnType<typeof baseRow>, conflictOnce?: () => void) {
  const state = { row: initialRow, events: [] as Array<Record<string, unknown>>, updateCalls: 0 };
  const db = {
    query: {
      shipments: { findFirst: vi.fn(async () => state.row) },
      shipmentEvents: { findMany: vi.fn(async () => state.events) },
    },
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => {
            state.updateCalls += 1;
            if (state.updateCalls === 1 && conflictOnce) {
              conflictOnce();
              return [];
            }
            Object.assign(state.row, values);
            return [{ id: state.row.id }];
          }),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((values: Record<string, unknown>) => ({
        onConflictDoNothing: vi.fn(async () => {
          if (!state.events.some((event) => event.id === values.id)) {
            state.events.push({
              ...values,
              occurredAt: values.occurredAt,
              createdAt: new Date(),
            });
          }
        }),
      })),
    })),
  } as unknown as Database;
  return { db, state };
}

const input = {
  shipmentId: "11111111-1111-4111-8111-111111111111",
  eventKey: "evt_2",
  incomingStatus: "OUT_FOR_DELIVERY" as const,
  occurredAt: new Date("2026-07-12T11:00:00.000Z"),
  carrierRawStatus: "out_for_delivery",
  message: "Out for delivery",
  location: "Denver, CO",
  timestampSource: "carrier" as const,
};

describe("shipment carrier event DB ordering", () => {
  it("atomically advances the watermark and stores ordering audit metadata", async () => {
    const { db, state } = statefulDb(baseRow());
    const result = await applyCarrierShipmentEvent(db, input);
    expect(result).toMatchObject({ disposition: "applied", stateChanged: true, effectsRequired: true });
    expect(result?.shipment.events[0]).toMatchObject({
      message: "Out for delivery",
      location: "Denver, CO",
      ordering_disposition: "applied",
    });
    expect(state.row).toMatchObject({
      status: "OUT_FOR_DELIVERY",
      lastCarrierEventAt: input.occurredAt,
      lastCarrierEventKey: "evt_2",
    });
    expect(state.events[0]?.payload).toMatchObject({
      state_changed: true,
      ordering_disposition: "applied",
      provider_event_key: "evt_2",
    });
  });

  it("preserves a stale event for audit without changing shipment state", async () => {
    const { db, state } = statefulDb(baseRow());
    const result = await applyCarrierShipmentEvent(db, {
      ...input,
      occurredAt: new Date("2026-07-12T09:00:00.000Z"),
    });
    expect(result).toMatchObject({ disposition: "stale", stateChanged: false, effectsRequired: false });
    expect(state.row.status).toBe("IN_TRANSIT");
    expect(state.updateCalls).toBe(0);
    expect(state.events[0]?.payload).toMatchObject({ ordering_disposition: "stale" });
  });

  it("re-evaluates after a CAS conflict and never overwrites a newer delivery", async () => {
    const row = baseRow();
    const created = statefulDb(row, () => {
      Object.assign(row, {
        status: "DELIVERED",
        deliveredAt: new Date("2026-07-12T12:00:00.000Z"),
        lastCarrierEventAt: new Date("2026-07-12T12:00:00.000Z"),
        lastCarrierEventKey: "evt_delivered",
      });
    });
    const result = await applyCarrierShipmentEvent(created.db, input);
    expect(result).toMatchObject({ disposition: "stale", stateChanged: false });
    expect(created.state.row.status).toBe("DELIVERED");
    expect(created.state.updateCalls).toBe(1);
  });

  it("recognizes a retried applied event so downstream effects can resume", async () => {
    const { db, state } = statefulDb(baseRow({
      status: "OUT_FOR_DELIVERY",
      lastCarrierEventAt: input.occurredAt,
      lastCarrierEventKey: input.eventKey,
    }));
    const result = await applyCarrierShipmentEvent(db, input);
    expect(result).toMatchObject({ disposition: "replay_applied", stateChanged: false, effectsRequired: true });
    expect(state.updateCalls).toBe(0);
    expect(state.events).toHaveLength(1);
  });

  it("advances a repeated delivered observation without moving the original delivery time", async () => {
    const originalDeliveredAt = new Date("2026-07-12T11:00:00.000Z");
    const { db, state } = statefulDb(baseRow({
      status: "DELIVERED",
      deliveredAt: originalDeliveredAt,
      lastCarrierEventAt: originalDeliveredAt,
      lastCarrierEventKey: "evt_delivered_1",
    }));
    const result = await applyCarrierShipmentEvent(db, {
      ...input,
      eventKey: "evt_delivered_2",
      incomingStatus: "DELIVERED",
      occurredAt: new Date("2026-07-12T12:00:00.000Z"),
      carrierRawStatus: "delivered",
    });
    expect(result).toMatchObject({ disposition: "observed", stateChanged: false, effectsRequired: false });
    expect(state.row.deliveredAt).toEqual(originalDeliveredAt);
    expect(state.row.lastCarrierEventAt).toEqual(new Date("2026-07-12T12:00:00.000Z"));
  });

  it("audits but never applies carrier events after a label refund is confirmed", async () => {
    const { db, state } = statefulDb(baseRow({
      status: "LABEL_PENDING",
      labelRefundStatus: "REFUNDED",
      lastCarrierEventAt: null,
      lastCarrierEventKey: null,
    }));
    const result = await applyCarrierShipmentEvent(db, {
      ...input,
      incomingStatus: "LABEL_CREATED",
      carrierRawStatus: "pre_transit",
    });
    expect(result).toMatchObject({ disposition: "label_refunded", stateChanged: false, effectsRequired: false });
    expect(state.row.status).toBe("LABEL_PENDING");
    expect(state.updateCalls).toBe(0);
    expect(state.events[0]?.payload).toMatchObject({ ordering_disposition: "label_refunded" });
  });
});
