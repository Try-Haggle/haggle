import { toSettlementAssetMoney } from "@haggle/shared";
import type { Hex } from "viem";
import { createId } from "./id.js";
import type {
  AuthorizePaymentResult,
  PaymentProvider,
  PaymentQuote,
  RefundPaymentResult,
  SettlePaymentResult,
} from "./provider.js";
import type { BuyerAuthorizationMode, PaymentIntent, PaymentPartyWallet, Refund } from "./types.js";
import type {
  ConditionalSettlementContract,
  DisputeRegistryContract,
  SettlementRouterContract,
  SettlementRouterExecutionRequest,
} from "./x402-contracts.js";

export interface X402SellerPayoutTarget {
  seller_id: string;
  wallet: PaymentPartyWallet;
}

export interface X402BuyerAuthorizationContext {
  buyer_id: string;
  mode: BuyerAuthorizationMode;
  wallet: PaymentPartyWallet;
}

export interface X402FeePolicy {
  fee_bps: number;
  wallet: PaymentPartyWallet;
}

export interface X402SettlementSignatureContext {
  signature: Hex;
  deadline: bigint;
  signer_nonce: bigint;
}

export interface X402AdapterConfig {
  facilitator_url: string;
  network: "base" | "base-sepolia";
  asset: "USDC";
  fee_policy: X402FeePolicy;
  settlement_router: SettlementRouterContract;
  conditional_settlement?: ConditionalSettlementContract;
  dispute_registry?: DisputeRegistryContract;
  resolve_seller_payout_target(sellerId: string): Promise<X402SellerPayoutTarget>;
  resolve_buyer_authorization(intent: PaymentIntent): Promise<X402BuyerAuthorizationContext>;
  /**
   * Resolve the EIP-712 backend signature for a settlement.
   * In production this calls the signing service. In test/mock, returns a stub.
   */
  resolve_settlement_signature(intent: PaymentIntent): Promise<X402SettlementSignatureContext>;
}

function nowIso(): string {
  return new Date().toISOString();
}

const MAX_X402_FEE_BPS = 1000;

function splitAmount(
  amountMinor: number,
  feeBps: number,
): { seller_amount_minor: number; haggle_fee_minor: number } {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new Error(`amount_minor must be positive, got ${amountMinor}`);
  }
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > MAX_X402_FEE_BPS) {
    throw new Error(`fee_bps must be 0-${MAX_X402_FEE_BPS}, got ${feeBps}`);
  }
  const haggle_fee_minor = Math.floor((amountMinor * feeBps) / 10_000);
  return {
    seller_amount_minor: amountMinor - haggle_fee_minor,
    haggle_fee_minor,
  };
}

function toCoreMoney(amount: PaymentIntent["amount"]): PaymentIntent["amount"] {
  return {
    currency: amount.currency,
    amount_minor: amount.amount_minor,
  };
}

export class RealX402Adapter implements PaymentProvider {
  readonly rail = "x402" as const;
  readonly provider = "ai.haggle.x402";

  constructor(private readonly config: X402AdapterConfig) {}

  async quote(intent: PaymentIntent): Promise<PaymentQuote> {
    const buyerAuth = await this.config.resolve_buyer_authorization(intent);
    const sellerTarget = await this.config.resolve_seller_payout_target(intent.seller_id);
    const settlementAmount = toCoreMoney(toSettlementAssetMoney(intent.amount, this.config.asset));
    const { seller_amount_minor, haggle_fee_minor } = splitAmount(
      intent.amount.amount_minor,
      this.config.fee_policy.fee_bps,
    );
    const settlementSplit = splitAmount(
      settlementAmount.amount_minor,
      this.config.fee_policy.fee_bps,
    );

    const quote = await this.config.settlement_router.quote({
      order_id: intent.order_id,
      payment_intent_id: intent.id,
      buyer_id: intent.buyer_id,
      seller_id: intent.seller_id,
      buyer_authorization_mode: buyerAuth.mode,
      buyer_wallet: buyerAuth.wallet,
      seller_wallet: sellerTarget.wallet,
      haggle_fee_wallet: this.config.fee_policy.wallet,
      gross_amount: settlementAmount,
      seller_amount: {
        currency: settlementAmount.currency,
        amount_minor: settlementSplit.seller_amount_minor,
      },
      haggle_fee_amount: {
        currency: settlementAmount.currency,
        amount_minor: settlementSplit.haggle_fee_minor,
      },
    });

    return {
      rail: this.rail,
      provider_reference: quote.quote_id,
      amount: intent.amount,
      expires_at: quote.expires_at,
      metadata: {
        facilitator_url: this.config.facilitator_url,
        network: this.config.network,
        asset: this.config.asset,
        seller_wallet: sellerTarget.wallet.wallet_address,
        haggle_fee_wallet: this.config.fee_policy.wallet.wallet_address,
        buyer_authorization_mode: buyerAuth.mode,
        seller_amount_minor,
        haggle_fee_minor,
        settlement_amount_minor: settlementAmount.amount_minor,
        settlement_seller_amount_minor: settlementSplit.seller_amount_minor,
        settlement_haggle_fee_minor: settlementSplit.haggle_fee_minor,
        conditional_settlement_address: this.config.conditional_settlement?.address,
        conditional_settlement_capabilities: this.config.conditional_settlement?.capabilities,
      },
    };
  }

  async authorize(intent: PaymentIntent): Promise<AuthorizePaymentResult> {
    const buyerAuth = await this.config.resolve_buyer_authorization(intent);

    return {
      authorization: {
        id: createId(),
        payment_intent_id: intent.id,
        rail: this.rail,
        provider_reference: createId("x402_auth"),
        authorized_amount: intent.amount,
        created_at: nowIso(),
      },
      metadata: {
        facilitator_url: this.config.facilitator_url,
        network: this.config.network,
        authorization_mode: buyerAuth.mode,
        buyer_wallet: buyerAuth.wallet.wallet_address,
        authorization_scope: "local_buyer_signing",
      },
    };
  }

  async settle(intent: PaymentIntent): Promise<SettlePaymentResult> {
    const settlementAmount = toCoreMoney(toSettlementAssetMoney(intent.amount, this.config.asset));
    const settlementIntent = {
      ...intent,
      amount: settlementAmount,
    };
    const [buyerAuth, sellerTarget, sigCtx] = await Promise.all([
      this.config.resolve_buyer_authorization(intent),
      this.config.resolve_seller_payout_target(intent.seller_id),
      this.config.resolve_settlement_signature(settlementIntent),
    ]);
    const { seller_amount_minor, haggle_fee_minor } = splitAmount(
      settlementAmount.amount_minor,
      this.config.fee_policy.fee_bps,
    );

    const request: SettlementRouterExecutionRequest = {
      order_id: intent.order_id,
      payment_intent_id: intent.id,
      buyer_id: intent.buyer_id,
      seller_id: intent.seller_id,
      buyer_authorization_mode: buyerAuth.mode,
      buyer_wallet: buyerAuth.wallet,
      seller_wallet: sellerTarget.wallet,
      haggle_fee_wallet: this.config.fee_policy.wallet,
      gross_amount: settlementAmount,
      seller_amount: {
        currency: settlementAmount.currency,
        amount_minor: seller_amount_minor,
      },
      haggle_fee_amount: {
        currency: settlementAmount.currency,
        amount_minor: haggle_fee_minor,
      },
      signature: sigCtx.signature,
      deadline: sigCtx.deadline,
      signer_nonce: sigCtx.signer_nonce,
    };

    const result = await this.config.settlement_router.execute(request);

    return {
      settlement: {
        id: createId(),
        payment_intent_id: intent.id,
        rail: this.rail,
        provider_reference: result.router_reference,
        settled_amount: intent.amount,
        settled_at: result.settled_at,
        status: result.status,
      },
      metadata: {
        execution_id: result.execution_id,
        tx_hash: result.tx_hash,
        network: this.config.network,
        asset: this.config.asset,
        seller_wallet: sellerTarget.wallet.wallet_address,
        haggle_fee_wallet: this.config.fee_policy.wallet.wallet_address,
      },
    };
  }

  async refund(intent: PaymentIntent, refund: Refund): Promise<RefundPaymentResult> {
    return {
      refund: {
        ...refund,
        status: "PENDING",
        updated_at: nowIso(),
      },
      metadata: {
        facilitator_url: this.config.facilitator_url,
        network: this.config.network,
        asset: this.config.asset,
        refund_mode: "business_logic_transfer",
        payment_intent_id: intent.id,
      },
    };
  }

  async anchorDispute(record: Parameters<DisputeRegistryContract["anchor"]>[0]) {
    if (!this.config.dispute_registry) {
      throw new Error("dispute registry is not configured for this x402 adapter");
    }
    return this.config.dispute_registry.anchor(record);
  }
}
