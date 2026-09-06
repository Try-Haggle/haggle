/**
 * Provider re-fetch for payment webhook local-status decisions (CTO ticket B6).
 *
 * Never talks to live card/PAN rails from tests. Live production without a stored
 * provider snapshot stays unavailable so handlers forbid local overwrite and
 * require reconciliation instead of guessing from the webhook payload alone.
 */

import { isProductionPaymentState, type ProductionPaymentState } from "@haggle/payment-core";
import {
  impliedProviderStateForWebhookMutation,
  mutationForWebhookEventType,
  type ProviderRecheckResult,
} from "../lib/payment-webhook-out-of-order-guard.js";
import { requiresRealPaymentProviders } from "../payments/provider-runtime-policy.js";

export type PaymentWebhookProviderRecheckInput = {
  provider: "stripe" | "x402";
  paymentIntentId: string;
  eventType: string;
  providerContext?: Record<string, unknown> | null;
};

export type PaymentWebhookProviderRecheckFn = (
  input: PaymentWebhookProviderRecheckInput,
) => Promise<ProviderRecheckResult>;

let testOverride: PaymentWebhookProviderRecheckFn | null = null;

/** Test-only injection. Pass null to restore the default implementation. */
export function setPaymentWebhookProviderRecheckForTests(
  fn: PaymentWebhookProviderRecheckFn | null,
): void {
  testOverride = fn;
}

function readProviderStateFromContext(
  providerContext: Record<string, unknown> | null | undefined,
): ProductionPaymentState | null {
  if (!providerContext || typeof providerContext !== "object") {
    return null;
  }

  const direct = providerContext.provider_status;
  if (isProductionPaymentState(direct)) {
    return direct;
  }

  const nested = providerContext.provider_recheck;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const nestedState = (nested as Record<string, unknown>).provider_status;
    if (isProductionPaymentState(nestedState)) {
      return nestedState;
    }
  }

  return null;
}

async function defaultRecheckPaymentProviderStatus(
  input: PaymentWebhookProviderRecheckInput,
): Promise<ProviderRecheckResult> {
  const fromContext = readProviderStateFromContext(input.providerContext ?? null);
  if (fromContext) {
    return {
      outcome: "confirmed",
      providerState: fromContext,
      source: "provider_context",
    };
  }

  // Production/live: do not invent provider truth from the webhook event alone.
  if (requiresRealPaymentProviders()) {
    return {
      outcome: "unavailable",
      reason: "provider_live_recheck_unavailable",
    };
  }

  const mutation = mutationForWebhookEventType(input.eventType);
  if (!mutation) {
    return { outcome: "inconclusive", reason: "unknown_webhook_event" };
  }

  // Mock/test rails only: imply provider state from the event type so happy-path
  // dogfood keeps working. Out-of-order local guards still forbid overwrite.
  return {
    outcome: "confirmed",
    providerState: impliedProviderStateForWebhookMutation(mutation),
    source: "mock_event_implied",
  };
}

export async function recheckPaymentProviderStatus(
  input: PaymentWebhookProviderRecheckInput,
): Promise<ProviderRecheckResult> {
  if (testOverride) {
    return testOverride(input);
  }
  return defaultRecheckPaymentProviderStatus(input);
}
