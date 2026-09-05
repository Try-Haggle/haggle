/**
 * Shared commerce-order gate for opening disputes.
 * Used by HTTP dispute routes and MCP haggle_start_dispute so testers
 * see the same blocking reason when payment has not settled.
 */

export const DISPUTABLE_ORDER_STATUSES = [
  "PAID",
  "FULFILLMENT_PENDING",
  "FULFILLMENT_ACTIVE",
  "DELIVERED",
  "IN_DISPUTE",
] as const;

export type DisputableOrderStatus = (typeof DISPUTABLE_ORDER_STATUSES)[number];

export interface DisputeOrderGateResult {
  disputable: boolean;
  order_status: string;
  blocking_gate?: string;
  message: string;
  hint?: string;
  /** Staging/local dogfood path — no real money or card PANs. */
  staging_fixture?: {
    endpoint: string;
    env_flag: string;
    notes: string[];
  };
}

const DISPUTABLE_SET = new Set<string>(DISPUTABLE_ORDER_STATUSES);

const STAGING_FIXTURE_HINT = {
  endpoint: "POST /tools/payment-test/dispute-ready-order",
  env_flag: "HAGGLE_ENABLE_PAYMENT_TEST_TOOLS",
  notes: [
    "Non-production: fixture is available to any authenticated UUID user.",
    "Production/staging with NODE_ENV=production: requires admin + HAGGLE_ENABLE_PAYMENT_TEST_TOOLS=true.",
    "Creates a mock SETTLED payment + DELIVERED order for dogfood. No real money, no card PANs.",
    "Then call haggle_start_dispute (MCP) or POST /orders/:orderId/disputes; upload evidence on the web.",
  ],
} as const;

function gateForStatus(
  orderStatus: string,
): Pick<DisputeOrderGateResult, "blocking_gate" | "message"> {
  switch (orderStatus) {
    case "APPROVED":
    case "PAYMENT_PENDING":
      return {
        blocking_gate: "payment_not_settled",
        message:
          "Order payment has not settled. Dispute open requires order status PAID (or later fulfillment/delivered). haggle_create_checkout only returns a web URL and does not settle Stripe Onramp or move money.",
      };
    case "REFUNDED":
      return {
        blocking_gate: "order_refunded",
        message:
          "This order is already REFUNDED. Open a refund-related dispute only when policy allows, or use a fresh paid/test order.",
      };
    case "CLOSED":
    case "CANCELED":
      return {
        blocking_gate: "order_terminal",
        message: `Order status ${orderStatus} is terminal and not disputable.`,
      };
    default:
      return {
        blocking_gate: "order_status_not_disputable",
        message: `Order status ${orderStatus} is not disputable. Allowed: ${DISPUTABLE_ORDER_STATUSES.join(", ")}.`,
      };
  }
}

/** True when commerce order status alone allows opening (or replaying) a dispute. */
export function isDisputableOrderStatus(orderStatus: string): boolean {
  return DISPUTABLE_SET.has(orderStatus);
}

/**
 * Describe why start_dispute is blocked (or confirm it is clear of the order-status gate).
 * Does not evaluate reason-code / shipment eligibility — that stays in dispute-opening-eligibility.
 */
export function describeDisputeOrderGate(orderStatus: string): DisputeOrderGateResult {
  if (isDisputableOrderStatus(orderStatus)) {
    return {
      disputable: true,
      order_status: orderStatus,
      message: "Order status allows opening a dispute (subject to reason-code eligibility).",
    };
  }

  const { blocking_gate, message } = gateForStatus(orderStatus);
  return {
    disputable: false,
    order_status: orderStatus,
    blocking_gate,
    message,
    hint:
      blocking_gate === "payment_not_settled"
        ? "Use the staging payment-test dispute-ready-order fixture, or complete mock/test settlement (STRIPE_MODE=mock / HAGGLE_X402_MODE=mock) until the order is PAID."
        : undefined,
    staging_fixture:
      blocking_gate === "payment_not_settled" || blocking_gate === "order_status_not_disputable"
        ? { ...STAGING_FIXTURE_HINT }
        : undefined,
  };
}
