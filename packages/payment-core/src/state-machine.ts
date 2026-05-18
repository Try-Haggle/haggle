import type { PaymentIntentStatus } from "./types.js";

type PaymentEvent =
  | "quote"
  | "authorize"
  | "mark_settlement_pending"
  | "settle"
  | "mark_refunded"
  | "mark_partially_refunded"
  | "mark_disputed"
  | "fail"
  | "cancel"
  | "expire";

const PAYMENT_TRANSITIONS: Record<PaymentIntentStatus, Partial<Record<PaymentEvent, PaymentIntentStatus>>> = {
  CREATED: { quote: "QUOTED", authorize: "AUTHORIZED", cancel: "CANCELED", fail: "FAILED", expire: "EXPIRED" },
  QUOTED: { authorize: "AUTHORIZED", cancel: "CANCELED", fail: "FAILED", expire: "EXPIRED" },
  AUTHORIZED: { mark_settlement_pending: "SETTLEMENT_PENDING", cancel: "CANCELED", fail: "FAILED", expire: "EXPIRED" },
  SETTLEMENT_PENDING: { settle: "SETTLED", fail: "FAILED", expire: "EXPIRED" },
  SETTLED: {
    mark_refunded: "REFUNDED",
    mark_partially_refunded: "PARTIALLY_REFUNDED",
    mark_disputed: "DISPUTED",
  },
  PARTIALLY_REFUNDED: { mark_refunded: "REFUNDED", mark_disputed: "DISPUTED" },
  DISPUTED: { mark_refunded: "REFUNDED", mark_partially_refunded: "PARTIALLY_REFUNDED" },
  REFUNDED: {},
  FAILED: {},
  CANCELED: {},
  EXPIRED: {},
};

export function transitionPaymentIntent(
  status: PaymentIntentStatus,
  event: PaymentEvent,
): PaymentIntentStatus | null {
  return PAYMENT_TRANSITIONS[status][event] ?? null;
}
