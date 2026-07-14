import { transitionShipmentStatus } from "./state-machine.js";
import type { ShipmentStatus } from "./types.js";

export type CarrierEventDisposition =
  | "applied"
  | "observed"
  | "replay_applied"
  | "stale"
  | "terminal"
  | "label_refunded"
  | "invalid_transition";

export interface CarrierEventOrderingDecision {
  disposition: CarrierEventDisposition;
  nextStatus: ShipmentStatus;
  advanceWatermark: boolean;
  stateChanged: boolean;
}

const EVENT_FOR_STATUS: Partial<Record<ShipmentStatus, Parameters<typeof transitionShipmentStatus>[1]>> = {
  LABEL_CREATED: "label_create",
  IN_TRANSIT: "ship",
  OUT_FOR_DELIVERY: "out_for_delivery",
  DELIVERED: "deliver",
  DELIVERY_EXCEPTION: "exception",
  RETURN_IN_TRANSIT: "return_ship",
  RETURNED: "return_complete",
};

const DIRECT_FORWARD_JUMPS = new Set([
  "LABEL_CREATED:OUT_FOR_DELIVERY",
  "LABEL_CREATED:DELIVERED",
  "DELIVERY_EXCEPTION:OUT_FOR_DELIVERY",
  "DELIVERY_EXCEPTION:DELIVERED",
]);

function compareWatermark(
  incomingAt: Date,
  incomingKey: string,
  currentAt: Date | null,
  currentKey: string | null,
): number {
  if (!currentAt) return 1;
  const timeDifference = incomingAt.getTime() - currentAt.getTime();
  if (timeDifference !== 0) return timeDifference;
  return incomingKey.localeCompare(currentKey ?? "");
}

export function resolveCarrierEventOrdering(input: {
  currentStatus: ShipmentStatus;
  incomingStatus: ShipmentStatus;
  incomingOccurredAt: Date;
  incomingEventKey: string;
  lastCarrierEventAt: Date | null;
  lastCarrierEventKey: string | null;
}): CarrierEventOrderingDecision {
  if (input.lastCarrierEventKey === input.incomingEventKey) {
    return {
      disposition: "replay_applied",
      nextStatus: input.currentStatus,
      advanceWatermark: false,
      stateChanged: false,
    };
  }

  if (compareWatermark(
    input.incomingOccurredAt,
    input.incomingEventKey,
    input.lastCarrierEventAt,
    input.lastCarrierEventKey,
  ) <= 0) {
    return {
      disposition: "stale",
      nextStatus: input.currentStatus,
      advanceWatermark: false,
      stateChanged: false,
    };
  }

  if (input.currentStatus === input.incomingStatus) {
    return {
      disposition: "observed",
      nextStatus: input.currentStatus,
      advanceWatermark: true,
      stateChanged: false,
    };
  }

  if (input.currentStatus === "DELIVERED" || input.currentStatus === "RETURNED") {
    return {
      disposition: "terminal",
      nextStatus: input.currentStatus,
      advanceWatermark: false,
      stateChanged: false,
    };
  }

  const eventType = EVENT_FOR_STATUS[input.incomingStatus];
  const transitioned = eventType
    ? transitionShipmentStatus(input.currentStatus, eventType)
    : null;
  if (transitioned === input.incomingStatus || DIRECT_FORWARD_JUMPS.has(`${input.currentStatus}:${input.incomingStatus}`)) {
    return {
      disposition: "applied",
      nextStatus: input.incomingStatus,
      advanceWatermark: true,
      stateChanged: true,
    };
  }

  return {
    disposition: "invalid_transition",
    nextStatus: input.currentStatus,
    advanceWatermark: false,
    stateChanged: false,
  };
}

export function normalizeCarrierEventTime(
  rawOccurredAt: string | undefined,
  receivedAt: Date,
  maximumFutureSkewMs = 10 * 60 * 1000,
): { occurredAt: Date; source: "carrier" | "received_at" } {
  if (!rawOccurredAt) return { occurredAt: receivedAt, source: "received_at" };
  const parsed = new Date(rawOccurredAt);
  if (!Number.isFinite(parsed.getTime()) || parsed.getTime() > receivedAt.getTime() + maximumFutureSkewMs) {
    return { occurredAt: receivedAt, source: "received_at" };
  }
  return { occurredAt: parsed, source: "carrier" };
}
