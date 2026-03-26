import type { ShipmentStatus, Shipment } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EscalationReasonCode =
  | "ITEM_NOT_RECEIVED"
  | "DELIVERY_EXCEPTION"
  | "SHIPMENT_SLA_MISSED"
  | "SELLER_NO_FULFILLMENT";

export interface DisputeCandidate {
  order_id: string;
  reason_code: EscalationReasonCode;
  auto_open: boolean;
  evidence_snapshot: {
    shipment_id: string;
    shipment_status: ShipmentStatus;
    carrier: string;
    tracking_number?: string;
    checked_at: string;
  };
}

export interface EscalationConfig {
  /** Max days a shipment can stay in LABEL_PENDING before triggering escalation. */
  label_pending_max_days: number;
  /** Whether DELIVERY_EXCEPTION automatically opens a dispute. */
  delivery_exception_auto_open: boolean;
  /** Whether SLA miss automatically opens a dispute. */
  sla_miss_auto_open: boolean;
}

export const DEFAULT_ESCALATION_CONFIG: EscalationConfig = {
  label_pending_max_days: 5,
  delivery_exception_auto_open: true,
  sla_miss_auto_open: true,
};

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

function buildSnapshot(shipment: Shipment, now: string): DisputeCandidate["evidence_snapshot"] {
  return {
    shipment_id: shipment.id,
    shipment_status: shipment.status,
    carrier: shipment.carrier,
    tracking_number: shipment.tracking_number,
    checked_at: now,
  };
}

/**
 * Check whether a shipment should trigger a dispute candidate.
 *
 * Rules evaluated in priority order:
 * 1. DELIVERY_EXCEPTION status -> dispute candidate
 * 2. LABEL_PENDING beyond `label_pending_max_days` since approval -> SELLER_NO_FULFILLMENT
 * 3. All other statuses return null (no escalation needed)
 *
 * SLA miss detection is handled separately by sla.ts; this function focuses on
 * status-based escalation that should feed into the dispute pipeline.
 */
export function checkEscalation(
  shipment: Shipment,
  approved_at: string,
  now: string,
  config: EscalationConfig = DEFAULT_ESCALATION_CONFIG,
): DisputeCandidate | null {
  // Terminal / non-problematic states — no escalation
  const noEscalationStatuses: ShipmentStatus[] = [
    "DELIVERED",
    "RETURNED",
    "LABEL_CREATED",
    "IN_TRANSIT",
    "OUT_FOR_DELIVERY",
    "RETURN_IN_TRANSIT",
  ];

  // 1. DELIVERY_EXCEPTION → dispute candidate
  if (shipment.status === "DELIVERY_EXCEPTION") {
    return {
      order_id: shipment.order_id,
      reason_code: "DELIVERY_EXCEPTION",
      auto_open: config.delivery_exception_auto_open,
      evidence_snapshot: buildSnapshot(shipment, now),
    };
  }

  // 2. LABEL_PENDING beyond max days → SELLER_NO_FULFILLMENT
  if (shipment.status === "LABEL_PENDING") {
    const deadline = new Date(approved_at);
    deadline.setDate(deadline.getDate() + config.label_pending_max_days);

    if (new Date(now) > deadline) {
      return {
        order_id: shipment.order_id,
        reason_code: "SELLER_NO_FULFILLMENT",
        auto_open: config.sla_miss_auto_open,
        evidence_snapshot: buildSnapshot(shipment, now),
      };
    }
  }

  // No escalation needed
  return null;
}
