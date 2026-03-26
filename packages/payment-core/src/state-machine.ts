import type { PaymentIntentStatus } from "./types.js";

type PaymentEvent =
  | "quote"
  | "authorize"
  | "mark_settlement_pending"
  | "settle"
  | "fail"
  | "cancel";

const PAYMENT_TRANSITIONS: Record<PaymentIntentStatus, Partial<Record<PaymentEvent, PaymentIntentStatus>>> = {
  CREATED: { quote: "QUOTED", authorize: "AUTHORIZED", cancel: "CANCELED", fail: "FAILED" },
  QUOTED: { authorize: "AUTHORIZED", cancel: "CANCELED", fail: "FAILED" },
  AUTHORIZED: { mark_settlement_pending: "SETTLEMENT_PENDING", cancel: "CANCELED", fail: "FAILED" },
  SETTLEMENT_PENDING: { settle: "SETTLED", fail: "FAILED" },
  SETTLED: {},
  FAILED: {},
  CANCELED: {},
};

export function transitionPaymentIntent(
  status: PaymentIntentStatus,
  event: PaymentEvent,
): PaymentIntentStatus | null {
  return PAYMENT_TRANSITIONS[status][event] ?? null;
}
