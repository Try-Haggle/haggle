import { describe, expect, it } from "vitest";
import {
  normalizeCarrierEventTime,
  parseEasyPostWebhookPayload,
  resolveCarrierEventOrdering,
} from "../index.js";

const base = {
  currentStatus: "IN_TRANSIT" as const,
  incomingStatus: "OUT_FOR_DELIVERY" as const,
  incomingOccurredAt: new Date("2026-07-12T12:00:00.000Z"),
  incomingEventKey: "evt_2",
  lastCarrierEventAt: new Date("2026-07-12T11:00:00.000Z"),
  lastCarrierEventKey: "evt_1",
};

describe("carrier event ordering", () => {
  it("applies a valid newer transition", () => {
    expect(resolveCarrierEventOrdering(base)).toMatchObject({
      disposition: "applied",
      nextStatus: "OUT_FOR_DELIVERY",
      stateChanged: true,
      advanceWatermark: true,
    });
  });

  it("keeps a newer same-status scan as a watermark observation", () => {
    expect(resolveCarrierEventOrdering({ ...base, incomingStatus: "IN_TRANSIT" })).toMatchObject({
      disposition: "observed",
      nextStatus: "IN_TRANSIT",
      stateChanged: false,
      advanceWatermark: true,
    });
  });

  it("ignores an event older than the applied carrier watermark", () => {
    expect(
      resolveCarrierEventOrdering({
        ...base,
        incomingOccurredAt: new Date("2026-07-12T10:00:00.000Z"),
      }),
    ).toMatchObject({ disposition: "stale", nextStatus: "IN_TRANSIT" });
  });

  it("never regresses delivered or returned terminal states", () => {
    expect(
      resolveCarrierEventOrdering({
        ...base,
        currentStatus: "DELIVERED",
        incomingStatus: "IN_TRANSIT",
      }),
    ).toMatchObject({ disposition: "terminal", nextStatus: "DELIVERED" });
    expect(
      resolveCarrierEventOrdering({
        ...base,
        currentStatus: "RETURNED",
        incomingStatus: "DELIVERED",
      }),
    ).toMatchObject({ disposition: "terminal", nextStatus: "RETURNED" });
  });

  it("allows carrier forward jumps when intermediate scans are missing", () => {
    expect(
      resolveCarrierEventOrdering({
        ...base,
        currentStatus: "LABEL_CREATED",
        incomingStatus: "DELIVERED",
      }),
    ).toMatchObject({ disposition: "applied", nextStatus: "DELIVERED" });
    expect(
      resolveCarrierEventOrdering({
        ...base,
        currentStatus: "DELIVERY_EXCEPTION",
        incomingStatus: "OUT_FOR_DELIVERY",
      }),
    ).toMatchObject({ disposition: "applied", nextStatus: "OUT_FOR_DELIVERY" });
  });

  it("does not leave the return branch for a late delivery scan", () => {
    expect(
      resolveCarrierEventOrdering({
        ...base,
        currentStatus: "RETURN_IN_TRANSIT",
        incomingStatus: "DELIVERED",
      }),
    ).toMatchObject({ disposition: "invalid_transition", nextStatus: "RETURN_IN_TRANSIT" });
  });

  it("uses the event key as a deterministic tie breaker", () => {
    expect(
      resolveCarrierEventOrdering({
        ...base,
        incomingOccurredAt: base.lastCarrierEventAt,
        incomingEventKey: "evt_0",
      }),
    ).toMatchObject({ disposition: "stale" });
    expect(
      resolveCarrierEventOrdering({
        ...base,
        incomingOccurredAt: base.lastCarrierEventAt,
        incomingEventKey: "evt_9",
      }),
    ).toMatchObject({ disposition: "applied" });
  });

  it("falls back to receive time for invalid or excessively future timestamps", () => {
    const receivedAt = new Date("2026-07-12T12:00:00.000Z");
    expect(normalizeCarrierEventTime("invalid", receivedAt)).toEqual({
      occurredAt: receivedAt,
      source: "received_at",
    });
    expect(normalizeCarrierEventTime("2026-07-12T13:00:00.000Z", receivedAt)).toEqual({
      occurredAt: receivedAt,
      source: "received_at",
    });
    expect(normalizeCarrierEventTime("2026-07-12T12:05:00.000Z", receivedAt)).toEqual({
      occurredAt: new Date("2026-07-12T12:05:00.000Z"),
      source: "carrier",
    });
  });

  it("selects the chronologically latest EasyPost detail even when unsorted", () => {
    const parsed = parseEasyPostWebhookPayload({
      description: "tracker.updated",
      result: {
        tracking_code: "EZ100",
        status: "delivered",
        carrier: "USPS",
        tracking_details: [
          {
            message: "Delivered",
            status: "delivered",
            datetime: "2026-07-12T12:00:00.000Z",
            tracking_location: { city: "Denver", state: "CO" },
          },
          { message: "In transit", status: "in_transit", datetime: "2026-07-12T10:00:00.000Z" },
        ],
      },
    });
    expect(parsed).toMatchObject({
      status: "DELIVERED",
      occurred_at: "2026-07-12T12:00:00.000Z",
      carrier_raw_status: "delivered",
      message: "Delivered",
      location: "Denver, CO",
    });
  });
});
