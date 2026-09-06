/**
 * CTO ticket B6: webhook out-of-order — forbid local overwrite before provider re-fetch.
 *
 * Payment webhooks may arrive late or reordered. Handlers must never overwrite local
 * payment status from an event payload alone: re-query provider state first, then
 * apply only when the recheck confirms the mutation. Out-of-order local conditions
 * always require reconciliation and never auto-correct from the stale event.
 */

import type { ProductionPaymentState } from "@haggle/payment-core";

export type PaymentWebhookLegacyStatus =
  | "CREATED"
  | "QUOTED"
  | "AUTHORIZED"
  | "SETTLEMENT_PENDING"
  | "SETTLED"
  | "FAILED"
  | "CANCELED";

export type PaymentWebhookMutation = "settle" | "fail" | "expire";

export type ProviderRecheckResult =
  | { outcome: "confirmed"; providerState: ProductionPaymentState; source: string }
  | { outcome: "inconclusive"; reason: string }
  | { outcome: "unavailable"; reason: string };

export type WebhookLocalOverwriteDecision =
  | { decision: "noop" }
  | { decision: "apply" }
  | { decision: "reconciliation_required"; reason: string };

const CAPTURED_LIKE: ReadonlySet<ProductionPaymentState> = new Set([
  "captured",
  "partially_refunded",
  "refunded",
  "disputed",
]);

export function mutationForWebhookEventType(eventType: string): PaymentWebhookMutation | null {
  switch (eventType) {
    case "settlement.confirmed":
      return "settle";
    case "settlement.failed":
      return "fail";
    case "payment.expired":
      return "expire";
    default:
      return null;
  }
}

export function impliedProviderStateForWebhookMutation(
  mutation: PaymentWebhookMutation,
): ProductionPaymentState {
  switch (mutation) {
    case "settle":
      return "captured";
    case "fail":
      return "failed";
    case "expire":
      return "expired";
  }
}

export function isCapturedLikeProductionState(state: ProductionPaymentState): boolean {
  return CAPTURED_LIKE.has(state);
}

/**
 * Local-only out-of-order detectors (pre-recheck). Non-null means the event must
 * not overwrite local status; caller still re-fetches provider for audit context.
 */
export function settlementWebhookOutOfOrderReason(input: {
  status: PaymentWebhookLegacyStatus;
  productionState: ProductionPaymentState;
}): string | null {
  const { status, productionState } = input;
  if (
    status === "SETTLED" &&
    (productionState === "refunded" ||
      productionState === "partially_refunded" ||
      productionState === "disputed")
  ) {
    return "settlement_confirmed_after_reversal_or_dispute";
  }
  if (status === "AUTHORIZED" || status === "SETTLEMENT_PENDING" || status === "SETTLED") {
    return null;
  }
  if (status === "FAILED" || status === "CANCELED") {
    return "settlement_confirmed_after_terminal_state";
  }
  return "settlement_confirmed_before_authorization";
}

export function terminalWebhookOutOfOrderReason(input: {
  status: PaymentWebhookLegacyStatus;
  productionState: ProductionPaymentState;
  targetAction: "fail" | "expire";
}): string | null {
  const { status, productionState, targetAction } = input;
  if (isCapturedLikeProductionState(productionState) || status === "SETTLED") {
    return "terminal_event_after_local_capture";
  }
  if (targetAction === "fail") {
    if (status === "FAILED") {
      return null;
    }
    if (status === "CANCELED") {
      return "failure_event_after_local_cancel";
    }
    return null;
  }
  if (status === "CANCELED") {
    return null;
  }
  if (status === "FAILED") {
    return "expiry_event_after_local_failure";
  }
  if (status === "SETTLEMENT_PENDING") {
    return "expiry_event_after_settlement_started";
  }
  return null;
}

function providerConfirmsMutation(
  mutation: PaymentWebhookMutation,
  providerState: ProductionPaymentState,
): boolean {
  switch (mutation) {
    case "settle":
      return isCapturedLikeProductionState(providerState) || providerState === "authorized";
    case "fail":
      return providerState === "failed";
    case "expire":
      return providerState === "expired" || providerState === "canceled";
  }
}

function isStatusMutationNoop(
  mutation: PaymentWebhookMutation,
  status: PaymentWebhookLegacyStatus,
): boolean {
  switch (mutation) {
    case "settle":
      return status === "SETTLED";
    case "fail":
      return status === "FAILED";
    case "expire":
      return status === "CANCELED";
  }
}

/**
 * Core B6 invariant: forbid local overwrite before a confirming provider re-fetch.
 * Out-of-order local conditions never auto-apply, even if recheck looks confirming.
 */
export function decideWebhookLocalOverwrite(input: {
  mutation: PaymentWebhookMutation;
  localStatus: PaymentWebhookLegacyStatus;
  outOfOrderReason: string | null;
  providerRecheck: ProviderRecheckResult | null;
}): WebhookLocalOverwriteDecision {
  const { mutation, localStatus, outOfOrderReason, providerRecheck } = input;

  if (outOfOrderReason) {
    return { decision: "reconciliation_required", reason: outOfOrderReason };
  }

  if (isStatusMutationNoop(mutation, localStatus)) {
    return { decision: "noop" };
  }

  if (!providerRecheck) {
    return {
      decision: "reconciliation_required",
      reason: "provider_recheck_required_before_local_overwrite",
    };
  }

  if (providerRecheck.outcome === "unavailable") {
    return {
      decision: "reconciliation_required",
      reason: "provider_recheck_unavailable_before_local_overwrite",
    };
  }

  if (providerRecheck.outcome === "inconclusive") {
    return {
      decision: "reconciliation_required",
      reason: "provider_recheck_inconclusive_before_local_overwrite",
    };
  }

  if (!providerConfirmsMutation(mutation, providerRecheck.providerState)) {
    return {
      decision: "reconciliation_required",
      reason: "provider_recheck_disagrees_with_webhook",
    };
  }

  return { decision: "apply" };
}
