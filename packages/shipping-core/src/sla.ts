import type { TrustTriggerEvent } from "@haggle/commerce-core";
import type { Shipment } from "./types.js";
import { trustTriggersForShipmentSlaMiss, trustTriggersForSellerFulfillmentFailure } from "./trust-events.js";

export interface ShipmentSlaConfig {
  shipment_input_due_days: number;
}

export const DEFAULT_SLA_CONFIG: ShipmentSlaConfig = {
  shipment_input_due_days: 2,
};

export function computeShipmentInputDueAt(
  approved_at: string,
  config: ShipmentSlaConfig = DEFAULT_SLA_CONFIG,
): string {
  const date = new Date(approved_at);
  date.setDate(date.getDate() + config.shipment_input_due_days);
  return date.toISOString();
}

export type SlaViolationType = "shipment_input_sla_missed" | "seller_fulfillment_failure";

export interface SlaCheckResult {
  violated: boolean;
  violation_type?: SlaViolationType;
  trust_triggers: TrustTriggerEvent[];
}

export function checkShipmentInputSla(
  shipment: Shipment,
  approved_at: string,
  now: string,
  config: ShipmentSlaConfig = DEFAULT_SLA_CONFIG,
): SlaCheckResult {
  if (shipment.status !== "LABEL_PENDING") {
    return { violated: false, trust_triggers: [] };
  }

  const dueAt = computeShipmentInputDueAt(approved_at, config);
  if (new Date(now) <= new Date(dueAt)) {
    return { violated: false, trust_triggers: [] };
  }

  return {
    violated: true,
    violation_type: "shipment_input_sla_missed",
    trust_triggers: trustTriggersForShipmentSlaMiss(),
  };
}

export function checkSellerFulfillment(
  shipment: Shipment,
  approved_at: string,
  now: string,
  fulfillment_deadline_days: number = 7,
): SlaCheckResult {
  const terminal = ["DELIVERED", "RETURNED"] as const;
  if (terminal.includes(shipment.status as (typeof terminal)[number])) {
    return { violated: false, trust_triggers: [] };
  }

  const deadline = new Date(approved_at);
  deadline.setDate(deadline.getDate() + fulfillment_deadline_days);

  if (new Date(now) <= deadline) {
    return { violated: false, trust_triggers: [] };
  }

  return {
    violated: true,
    violation_type: "seller_fulfillment_failure",
    trust_triggers: trustTriggersForSellerFulfillmentFailure(),
  };
}
