export type OrderPhase =
  | "NEGOTIATION"
  | "APPROVAL"
  | "PAYMENT"
  | "FULFILLMENT"
  | "DELIVERY"
  | "COMPLETED"
  | "IN_DISPUTE"
  | "CANCELED"
  | "REFUNDED";

export interface OrderState {
  phase: OrderPhase;
  approval_state?: string;
  payment_status?: string;
  shipment_status?: string;
  dispute_status?: string;
  product_release_status?: "PENDING_DELIVERY" | "BUYER_REVIEW" | "RELEASED";
  buffer_release_status?: "HELD" | "ADJUSTING" | "RELEASED";
}

export type OrderAction =
  | { type: "create_payment_intent" }
  | { type: "await_shipment_input" }
  | { type: "check_shipment_sla" }
  | { type: "await_delivery" }
  | { type: "complete_order" }
  | { type: "open_dispute"; reason_code: string }
  | { type: "process_refund" }
  | { type: "start_buyer_review" }
  | { type: "release_product_payment" }
  | { type: "release_weight_buffer" }
  | { type: "no_action" };

/**
 * Given the current state of all modules, determine what should happen next.
 *
 * This is a pure function — no side effects, no DB access.
 * Callers are responsible for executing the returned action.
 */
export function determineNextAction(state: OrderState): OrderAction {
  switch (state.phase) {
    case "NEGOTIATION":
      return { type: "no_action" };

    case "APPROVAL":
      if (state.approval_state === "APPROVED") {
        return { type: "create_payment_intent" };
      }
      if (state.approval_state === "DECLINED" || state.approval_state === "EXPIRED") {
        return { type: "no_action" };
      }
      return { type: "no_action" };

    case "PAYMENT":
      if (state.payment_status === "SETTLED") {
        return { type: "await_shipment_input" };
      }
      if (state.payment_status === "FAILED" || state.payment_status === "EXPIRED") {
        return { type: "no_action" };
      }
      return { type: "no_action" };

    case "FULFILLMENT":
      if (state.shipment_status === "IN_TRANSIT") {
        return { type: "await_delivery" };
      }
      if (state.shipment_status === "SLA_MISSED") {
        return { type: "open_dispute", reason_code: "SHIPMENT_SLA_MISSED" };
      }
      return { type: "check_shipment_sla" };

    case "DELIVERY":
      if (state.shipment_status === "DELIVERED") {
        if (state.product_release_status === "PENDING_DELIVERY") {
          return { type: "start_buyer_review" };
        }
        if (state.product_release_status === "BUYER_REVIEW") {
          return { type: "release_product_payment" };
        }
        return { type: "complete_order" };
      }
      if (state.shipment_status === "DELIVERY_EXCEPTION") {
        return { type: "open_dispute", reason_code: "DELIVERY_EXCEPTION" };
      }
      return { type: "await_delivery" };

    case "COMPLETED":
      if (state.buffer_release_status === "HELD" || state.buffer_release_status === "ADJUSTING") {
        return { type: "release_weight_buffer" };
      }
      return { type: "no_action" };

    case "IN_DISPUTE":
      if (state.dispute_status === "RESOLVED_REFUND") {
        return { type: "process_refund" };
      }
      if (state.dispute_status === "RESOLVED_NO_REFUND") {
        return { type: "complete_order" };
      }
      return { type: "no_action" };

    case "CANCELED":
      return { type: "no_action" };

    case "REFUNDED":
      return { type: "no_action" };
  }
}

/**
 * Derive the correct OrderPhase from the combination of module statuses.
 *
 * Priority order (highest to lowest):
 *   1. Dispute overrides everything except terminal states
 *   2. Shipment/delivery status determines fulfillment phases
 *   3. Payment status determines payment phase
 *   4. Approval status determines approval phase
 */
export function computeOrderPhase(state: Omit<OrderState, "phase">): OrderPhase {
  // Terminal: refund completed
  if (state.payment_status === "REFUNDED") {
    return "REFUNDED";
  }

  // Terminal: canceled before payment
  if (state.approval_state === "DECLINED" || state.approval_state === "EXPIRED") {
    if (!state.payment_status || state.payment_status === "NONE") {
      return "CANCELED";
    }
  }

  if (state.payment_status === "CANCELED") {
    return "CANCELED";
  }

  // Active dispute overrides fulfillment/delivery
  if (state.dispute_status && state.dispute_status !== "NONE") {
    if (state.dispute_status === "RESOLVED_REFUND") {
      return "REFUNDED";
    }
    if (state.dispute_status === "RESOLVED_NO_REFUND") {
      return "COMPLETED";
    }
    return "IN_DISPUTE";
  }

  // Delivery phase
  if (state.shipment_status === "DELIVERED") {
    // If product_release_status is present and not yet RELEASED, stay in DELIVERY
    if (
      state.product_release_status !== undefined &&
      state.product_release_status !== "RELEASED"
    ) {
      return "DELIVERY";
    }
    return "COMPLETED";
  }
  if (state.shipment_status === "DELIVERY_EXCEPTION") {
    return "DELIVERY";
  }
  if (state.shipment_status === "IN_TRANSIT" || state.shipment_status === "OUT_FOR_DELIVERY") {
    return "DELIVERY";
  }

  // Fulfillment phase — shipment info provided but not yet in transit
  if (
    state.shipment_status === "LABEL_CREATED" ||
    state.shipment_status === "PENDING_PICKUP" ||
    state.shipment_status === "SLA_MISSED"
  ) {
    return "FULFILLMENT";
  }

  // Payment settled → waiting for fulfillment
  if (state.payment_status === "SETTLED") {
    return "FULFILLMENT";
  }

  // Payment in progress
  if (
    state.payment_status === "INTENT_CREATED" ||
    state.payment_status === "AUTHORIZED" ||
    state.payment_status === "PENDING"
  ) {
    return "PAYMENT";
  }

  // Approval complete → payment needed
  if (state.approval_state === "APPROVED") {
    return "PAYMENT";
  }

  // Approval in progress
  if (
    state.approval_state &&
    state.approval_state !== "NEGOTIATING" &&
    state.approval_state !== "NONE"
  ) {
    return "APPROVAL";
  }

  // Default: still negotiating
  return "NEGOTIATION";
}
