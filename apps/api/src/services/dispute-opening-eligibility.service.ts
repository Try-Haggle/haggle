import type { DisputeReasonCode } from "@haggle/dispute-core";
import type { ShipmentEvent, ShipmentStatus } from "@haggle/shipping-core";

const DAY_MS = 24 * 60 * 60 * 1000;
const DELIVERY_GRACE_DAYS = 2;
const DEFAULT_TRANSIT_BUSINESS_DAYS = 7;
const LABEL_HANDOFF_BUSINESS_DAYS = 3;

export interface DisputeEligibilityShipment {
  status: ShipmentStatus;
  selected_rate_id?: string;
  label_created_at?: string;
  shipped_at?: string;
  shipment_input_due_at?: string;
  metadata?: Record<string, unknown>;
  events?: ShipmentEvent[];
}

export interface DisputeOpeningEligibility {
  eligible: boolean;
  error?: string;
  message: string;
  available_at?: string;
}

function validDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addBusinessDays(start: Date, days: number): Date {
  const result = new Date(start);
  let remaining = Math.max(0, Math.ceil(days));
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    const day = result.getUTCDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return result;
}

function firstEventAt(
  shipment: DisputeEligibilityShipment,
  statuses: ShipmentStatus[],
): Date | null {
  const wanted = new Set(statuses);
  const timestamps = (shipment.events ?? [])
    .filter((event) => wanted.has(event.status))
    .map((event) => validDate(event.occurred_at))
    .filter((date): date is Date => date !== null)
    .sort((left, right) => left.getTime() - right.getTime());
  return timestamps[0] ?? null;
}

function selectedEstimatedDeliveryDays(shipment: DisputeEligibilityShipment): number | null {
  const rawRates = shipment.metadata?.prepared_rate_quotes;
  if (!Array.isArray(rawRates)) return null;

  const selectedRateId =
    shipment.selected_rate_id ??
    (typeof shipment.metadata?.easypost_rate_id === "string"
      ? shipment.metadata.easypost_rate_id
      : undefined);
  const selected = rawRates.find((rate) => {
    if (!rate || typeof rate !== "object") return false;
    return selectedRateId
      ? (rate as Record<string, unknown>).id === selectedRateId
      : rawRates.length === 1;
  });
  if (!selected || typeof selected !== "object") return null;

  const days = (selected as Record<string, unknown>).est_delivery_days;
  return typeof days === "number" && Number.isFinite(days) && days >= 0 ? days : null;
}

function unavailable(
  error: string,
  message: string,
  availableAt?: Date | null,
): DisputeOpeningEligibility {
  return {
    eligible: false,
    error,
    message,
    ...(availableAt ? { available_at: availableAt.toISOString() } : {}),
  };
}

function itemNotReceivedEligibility(
  orderStatus: string,
  shipment: DisputeEligibilityShipment | null,
  now: Date,
): DisputeOpeningEligibility {
  if (orderStatus === "DELIVERED" || shipment?.status === "DELIVERED") {
    return {
      eligible: true,
      message:
        "The carrier or order record says delivered, so a buyer may report that the item was not received.",
    };
  }
  if (!shipment) {
    return unavailable(
      "DELIVERY_NOT_DUE",
      "Shipping has not started. Item-not-received disputes are available only after the delivery window.",
    );
  }
  if (shipment.status === "LABEL_PENDING" || shipment.status === "LABEL_CREATED") {
    return unavailable(
      "DELIVERY_NOT_DUE",
      shipment.status === "LABEL_CREATED"
        ? "A label exists, but the carrier has not accepted the parcel. The delivery window has not started."
        : "A shipping label has not been created. The delivery window has not started.",
    );
  }
  if (shipment.status === "DELIVERY_EXCEPTION") {
    return unavailable(
      "USE_DELIVERY_EXCEPTION",
      "The carrier reported a delivery exception. Select Delivery Exception for this issue.",
    );
  }
  if (shipment.status === "RETURN_IN_TRANSIT" || shipment.status === "RETURNED") {
    return unavailable(
      "INVALID_SHIPMENT_PHASE",
      "This shipment is in a return flow and cannot use an item-not-received claim.",
    );
  }

  const transitStartedAt =
    validDate(shipment.shipped_at) ?? firstEventAt(shipment, ["IN_TRANSIT", "OUT_FOR_DELIVERY"]);
  if (!transitStartedAt) {
    return unavailable(
      "DELIVERY_NOT_DUE",
      "The carrier has not recorded parcel acceptance. The delivery window has not started.",
    );
  }

  const estimatedDays = selectedEstimatedDeliveryDays(shipment) ?? DEFAULT_TRANSIT_BUSINESS_DAYS;
  const estimatedDeliveryAt = addBusinessDays(transitStartedAt, estimatedDays);
  const availableAt = new Date(estimatedDeliveryAt.getTime() + DELIVERY_GRACE_DAYS * DAY_MS);
  if (now.getTime() < availableAt.getTime()) {
    return unavailable(
      "DELIVERY_NOT_DUE",
      "The carrier delivery estimate and the two-day reporting grace period have not passed.",
      availableAt,
    );
  }
  return {
    eligible: true,
    message: "The expected delivery window and reporting grace period have passed.",
    available_at: availableAt.toISOString(),
  };
}

function productClaimEligibility(
  orderStatus: string,
  shipment: DisputeEligibilityShipment | null,
): DisputeOpeningEligibility {
  if (orderStatus === "DELIVERED" || shipment?.status === "DELIVERED") {
    return {
      eligible: true,
      message: "The item is recorded as delivered, so its condition can be disputed.",
    };
  }
  return unavailable(
    "ITEM_NOT_DELIVERED",
    "Condition, authenticity, and other item claims are available after delivery.",
  );
}

function sellerNoFulfillmentEligibility(
  shipment: DisputeEligibilityShipment | null,
  now: Date,
): DisputeOpeningEligibility {
  if (!shipment) {
    return unavailable(
      "FULFILLMENT_DEADLINE_UNKNOWN",
      "A fulfillment deadline is not available for this order yet.",
    );
  }
  if (["IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED"].includes(shipment.status)) {
    return unavailable(
      "SHIPMENT_ALREADY_FULFILLED",
      "The carrier has accepted this parcel, so seller non-fulfillment no longer applies.",
    );
  }

  const labelCreatedAt = validDate(shipment.label_created_at);
  const dueAt =
    shipment.status === "LABEL_CREATED" && labelCreatedAt
      ? addBusinessDays(labelCreatedAt, LABEL_HANDOFF_BUSINESS_DAYS)
      : validDate(shipment.shipment_input_due_at);
  if (!dueAt) {
    return unavailable(
      "FULFILLMENT_DEADLINE_UNKNOWN",
      "The seller fulfillment deadline is not available yet.",
    );
  }
  if (now.getTime() < dueAt.getTime()) {
    return unavailable(
      "FULFILLMENT_NOT_DUE",
      "The seller still has time to hand the parcel to the carrier.",
      dueAt,
    );
  }
  return {
    eligible: true,
    message: "The seller fulfillment deadline has passed without carrier acceptance.",
    available_at: dueAt.toISOString(),
  };
}

export function evaluateDisputeOpeningEligibility(input: {
  reasonCode: DisputeReasonCode;
  openedBy: "buyer" | "seller" | "system";
  orderStatus: string;
  shipment: DisputeEligibilityShipment | null;
  now?: Date;
}): DisputeOpeningEligibility {
  const now = input.now ?? new Date();

  if (
    ["ITEM_NOT_RECEIVED", "ITEM_NOT_AS_DESCRIBED", "COUNTERFEIT_CLAIM", "OTHER"].includes(
      input.reasonCode,
    ) &&
    input.openedBy === "seller"
  ) {
    return unavailable(
      "REASON_NOT_AVAILABLE_FOR_PARTY",
      "This reason is available to the buyer for this order.",
    );
  }

  switch (input.reasonCode) {
    case "ITEM_NOT_RECEIVED":
      return itemNotReceivedEligibility(input.orderStatus, input.shipment, now);
    case "ITEM_NOT_AS_DESCRIBED":
    case "COUNTERFEIT_CLAIM":
    case "OTHER":
      return productClaimEligibility(input.orderStatus, input.shipment);
    case "DELIVERY_EXCEPTION":
      return input.shipment?.status === "DELIVERY_EXCEPTION"
        ? { eligible: true, message: "The carrier reported a delivery exception." }
        : unavailable(
            "NO_DELIVERY_EXCEPTION",
            "The carrier has not reported a delivery exception.",
          );
    case "SHIPMENT_SLA_MISSED":
    case "SELLER_NO_FULFILLMENT":
      return sellerNoFulfillmentEligibility(input.shipment, now);
    case "PAYMENT_NOT_COMPLETED":
      return input.orderStatus === "PAYMENT_PENDING"
        ? { eligible: true, message: "The approved payment has not completed." }
        : unavailable("PAYMENT_NOT_PENDING", "This order is not waiting for payment completion.");
    case "REFUND_DISPUTE":
    case "PARTIAL_REFUND_DISPUTE":
      return input.orderStatus === "REFUNDED"
        ? { eligible: true, message: "A recorded refund can be disputed." }
        : unavailable("REFUND_NOT_RECORDED", "A refund has not been recorded for this order.");
  }
}
