import type {
  PaymentIntent,
  X402PaymentRequiredEnvelope,
  X402PaymentRequirement,
} from "@haggle/payment-core";
import { toSettlementAssetMoney } from "@haggle/shared";

export interface X402RequirementContext {
  resource: string;
  sellerWallet: string;
  paymentReceiver?: string;
  receiverRole?: "seller_wallet" | "payment_receiver" | "conditional_settlement_receiver";
  network: string;
  assetAddress: string;
}

export function createX402PaymentRequirement(
  intent: PaymentIntent,
  context: X402RequirementContext,
): X402PaymentRequiredEnvelope {
  const usdcAmount = toSettlementAssetMoney(intent.amount, "USDC");
  const requirement: X402PaymentRequirement = {
    x402Version: 1,
    scheme: "exact",
    network: context.network,
    maxAmountRequired: String(usdcAmount.amount_minor),
    resource: context.resource,
    description: `Haggle order ${intent.order_id} payment`,
    mimeType: "application/json",
    payTo: context.paymentReceiver ?? context.sellerWallet,
    asset: context.assetAddress,
    maxTimeoutSeconds: 900,
    extra: {
      payment_intent_id: intent.id,
      order_id: intent.order_id,
      grant_id: intent.agent_payment_grant_id,
      approval_policy_hash: intent.approval_policy_hash,
      agreement_hash: intent.agreement_hash,
      listing_hash: intent.listing_hash,
      buyer_authorization_mode: intent.buyer_authorization_mode ?? "human_wallet",
      rail: intent.selected_rail,
      currency: intent.amount.currency,
      settlement_asset: usdcAmount.currency,
      settlement_amount_minor: String(usdcAmount.amount_minor),
      settlement_amount_decimals: usdcAmount.decimals,
      seller_wallet: context.sellerWallet,
      pay_to_role:
        context.receiverRole ?? (context.paymentReceiver ? "payment_receiver" : "seller_wallet"),
    },
  };

  return {
    accepts: [requirement],
  };
}
