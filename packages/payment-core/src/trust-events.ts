import type { TrustTriggerEvent } from "@haggle/commerce-core";
import type { PaymentIntentStatus } from "./types.js";

/**
 * Payment stage trust trigger.
 * Approval 이후 결제 단계에서 실패/취소가 나면 buyer default 후보로 본다.
 */
export function trustTriggersForPaymentTransition(
  previous: PaymentIntentStatus,
  next: PaymentIntentStatus,
): TrustTriggerEvent[] {
  if ((next === "FAILED" || next === "CANCELED") && previous !== "SETTLED") {
    return [
      {
        module: "payment",
        actor_role: "buyer",
        type: "buyer_approved_but_not_paid",
      },
    ];
  }

  if (next === "SETTLED") {
    return [
      {
        module: "payment",
        actor_role: "buyer",
        type: "successful_settlement",
      },
      {
        module: "payment",
        actor_role: "seller",
        type: "successful_settlement",
      },
    ];
  }

  return [];
}
