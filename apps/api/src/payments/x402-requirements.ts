import type { PaymentIntent, X402PaymentRequiredEnvelope, X402PaymentRequirement } from "@haggle/payment-core";

export interface X402RequirementContext {
  resource: string;
  sellerWallet: string;
  network: string;
  assetAddress: string;
}

export function createX402PaymentRequirement(
  intent: PaymentIntent,
  context: X402RequirementContext,
): X402PaymentRequiredEnvelope {
  const requirement: X402PaymentRequirement = {
    x402Version: 1,
    scheme: "exact",
    network: context.network,
    maxAmountRequired: String(intent.amount.amount_minor),
    resource: context.resource,
    description: `Haggle order ${intent.order_id} payment`,
    mimeType: "application/json",
    payTo: context.sellerWallet,
    asset: context.assetAddress,
    maxTimeoutSeconds: 900,
    extra: {
      payment_intent_id: intent.id,
      order_id: intent.order_id,
      buyer_authorization_mode: intent.buyer_authorization_mode ?? "human_wallet",
      rail: intent.selected_rail,
      currency: intent.amount.currency,
    },
  };

  return {
    accepts: [requirement],
  };
}
