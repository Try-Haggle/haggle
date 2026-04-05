import { createHash } from "node:crypto";
import { createId } from "./id.js";
import type {
  PaymentIntent,
  Refund,
  PaymentPartyWallet,
  BuyerAuthorizationMode,
} from "./types.js";
import type {
  AuthorizePaymentResult,
  PaymentProvider,
  PaymentQuote,
  RefundPaymentResult,
  SettlePaymentResult,
} from "./provider.js";
import type {
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

export interface X402AdapterConfig {
  facilitator_url: string;
  network: "base" | "base-sepolia";
  asset: "USDC";
  fee_policy: X402FeePolicy;
  settlement_router: SettlementRouterContract;
  dispute_registry?: DisputeRegistryContract;
  resolve_seller_payout_target(sellerId: string): Promise<X402SellerPayoutTarget>;
  resolve_buyer_authorization(intent: PaymentIntent): Promise<X402BuyerAuthorizationContext>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function createDeterministicHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

function hashApprovalSnapshot(intent: PaymentIntent): string {
  return createDeterministicHash(
    JSON.stringify({
      order_id: intent.order_id,
      payment_intent_id: intent.id,
      seller_id: intent.seller_id,
      buyer_id: intent.buyer_id,
      selected_rail: intent.selected_rail,
      amount: intent.amount,
      authorization_mode: intent.buyer_authorization_mode ?? "human_wallet",
    }),
  );
}

function splitAmount(amountMinor: number, feeBps: number): { seller_amount_minor: number; haggle_fee_minor: number } {
  const haggle_fee_minor = Math.floor((amountMinor * feeBps) / 10_000);
  return {
    seller_amount_minor: amountMinor - haggle_fee_minor,
    haggle_fee_minor,
  };
}

export class RealX402Adapter implements PaymentProvider {
  readonly rail = "x402" as const;
  readonly provider = "ai.haggle.x402";

  constructor(private readonly config: X402AdapterConfig) {}

  async quote(intent: PaymentIntent): Promise<PaymentQuote> {
    const buyerAuth = await this.config.resolve_buyer_authorization(intent);
    const sellerTarget = await this.config.resolve_seller_payout_target(intent.seller_id);
    const { seller_amount_minor, haggle_fee_minor } = splitAmount(
      intent.amount.amount_minor,
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
      gross_amount: intent.amount,
      seller_amount: {
        currency: intent.amount.currency,
        amount_minor: seller_amount_minor,
      },
      haggle_fee_amount: {
        currency: intent.amount.currency,
        amount_minor: haggle_fee_minor,
      },
      reservation_id: undefined,
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
    const buyerAuth = await this.config.resolve_buyer_authorization(intent);
    const sellerTarget = await this.config.resolve_seller_payout_target(intent.seller_id);
    const { seller_amount_minor, haggle_fee_minor } = splitAmount(
      intent.amount.amount_minor,
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
      gross_amount: intent.amount,
      seller_amount: {
        currency: intent.amount.currency,
        amount_minor: seller_amount_minor,
      },
      haggle_fee_amount: {
        currency: intent.amount.currency,
        amount_minor: haggle_fee_minor,
      },
      approval_snapshot_hash: hashApprovalSnapshot(intent),
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
