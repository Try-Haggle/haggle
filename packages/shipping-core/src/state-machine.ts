import type { ShipmentStatus } from "./types.js";

type ShipmentEventType =
  | "label_create"
  | "ship"
  | "out_for_delivery"
  | "deliver"
  | "exception"
  | "return_ship"
  | "return_complete";

const SHIPMENT_TRANSITIONS: Record<ShipmentStatus, Partial<Record<ShipmentEventType, ShipmentStatus>>> = {
  LABEL_PENDING: { label_create: "LABEL_CREATED" },
  LABEL_CREATED: { ship: "IN_TRANSIT", exception: "DELIVERY_EXCEPTION" },
  IN_TRANSIT: { out_for_delivery: "OUT_FOR_DELIVERY", deliver: "DELIVERED", exception: "DELIVERY_EXCEPTION", return_ship: "RETURN_IN_TRANSIT" },
  OUT_FOR_DELIVERY: { deliver: "DELIVERED", exception: "DELIVERY_EXCEPTION", return_ship: "RETURN_IN_TRANSIT" },
  DELIVERED: {},
  DELIVERY_EXCEPTION: { ship: "IN_TRANSIT", return_ship: "RETURN_IN_TRANSIT" },
  RETURN_IN_TRANSIT: { return_complete: "RETURNED" },
  RETURNED: {},
};

export function transitionShipmentStatus(
  status: ShipmentStatus,
  event: ShipmentEventType,
): ShipmentStatus | null {
  return SHIPMENT_TRANSITIONS[status][event] ?? null;
}
