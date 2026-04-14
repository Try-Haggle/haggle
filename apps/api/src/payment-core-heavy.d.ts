/**
 * Type declarations for @haggle/payment-core heavy modules.
 *
 * These modules depend on viem + @haggle/contracts and are NOT re-exported
 * from the @haggle/payment-core barrel. We declare them here so that
 * apps/api can import them without pulling the source files into its rootDir.
 */

declare module "@haggle/payment-core/heavy/real-x402-adapter" {
  import type {
    PaymentProvider,
    PaymentPartyWallet,
    BuyerAuthorizationMode,
    PaymentIntent,
    PaymentQuote,
    AuthorizePaymentResult,
    SettlePaymentResult,
    RefundPaymentResult,
    SettlementRouterContract,
    DisputeRegistryContract,
    Refund,
  } from "@haggle/payment-core";

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
    signature: `0x${string}`;
    deadline: bigint;
    signer_nonce: bigint;
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
    resolve_settlement_signature(intent: PaymentIntent): Promise<X402SettlementSignatureContext>;
  }

  export class RealX402Adapter implements PaymentProvider {
    readonly rail: "x402";
    readonly provider: "ai.haggle.x402";
    constructor(config: X402AdapterConfig);
    quote(intent: PaymentIntent): Promise<PaymentQuote>;
    authorize(intent: PaymentIntent): Promise<AuthorizePaymentResult>;
    settle(intent: PaymentIntent): Promise<SettlePaymentResult>;
    refund(intent: PaymentIntent, refund: Refund): Promise<RefundPaymentResult>;
  }
}

declare module "@haggle/payment-core/heavy/viem-contracts" {
  import type {
    SettlementRouterContract,
    SettlementRouterCapabilities,
    SettlementRouterQuote,
    SettlementRouterExecutionRequest,
    SettlementRouterExecutionResult,
    DisputeRegistryContract,
    DisputeAnchorRecord,
  } from "@haggle/payment-core";

  export class ViemSettlementRouterContract implements SettlementRouterContract {
    readonly network: string;
    readonly asset: "USDC";
    readonly capabilities: {
      readonly supports_fee_split: true;
      readonly supports_dispute_anchor: false;
      readonly supports_reservation_binding: true;
    };
    constructor(
      network: string,
      asset: "USDC",
      address: `0x${string}`,
      publicClient: any,
      walletClient: any,
      assetAddress: `0x${string}`,
    );
    quote(
      request: Omit<SettlementRouterExecutionRequest, "quote_id" | "signature" | "deadline" | "signer_nonce">,
    ): Promise<SettlementRouterQuote>;
    execute(
      request: SettlementRouterExecutionRequest,
    ): Promise<SettlementRouterExecutionResult>;
  }

  export class ViemDisputeRegistryContract implements DisputeRegistryContract {
    readonly network: string;
    constructor(
      network: string,
      address: `0x${string}`,
      publicClient: any,
      walletClient: any,
    );
    anchor(record: DisputeAnchorRecord): Promise<DisputeAnchorRecord>;
  }
}
