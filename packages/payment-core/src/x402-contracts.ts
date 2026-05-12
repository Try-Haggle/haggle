import type { Hex } from "viem";
import type { BuyerAuthorizationMode, Money, PaymentPartyWallet } from "./types.js";

export interface SettlementRouterQuote {
  quote_id: string;
  network: string;
  asset: "USDC";
  gross_amount: Money;
  seller_amount: Money;
  haggle_fee_amount: Money;
  expires_at: string;
}

export interface SettlementRouterExecutionRequest {
  order_id: string;
  payment_intent_id: string;
  buyer_id: string;
  seller_id: string;
  buyer_authorization_mode: BuyerAuthorizationMode;
  buyer_wallet: PaymentPartyWallet;
  seller_wallet: PaymentPartyWallet;
  haggle_fee_wallet: PaymentPartyWallet;
  gross_amount: Money;
  seller_amount: Money;
  haggle_fee_amount: Money;
  quote_id?: string;
  /** EIP-712 signature from the authorized backend signer (EOA or EIP-1271). */
  signature: Hex;
  /** Unix timestamp deadline after which the signature is invalid. */
  deadline: bigint;
  /** Must match the contract's current signerNonce to prevent replay after key rotation. */
  signer_nonce: bigint;
}

export interface SettlementRouterExecutionResult {
  execution_id: string;
  router_reference: string;
  tx_hash?: string;
  status: "PENDING" | "SETTLED" | "FAILED";
  settled_at?: string;
}

export interface ConditionalSettlementCreateRequest {
  order_id: string;
  payment_intent_id: string;
  approval_policy_hash: string;
  agreement_hash: string;
  listing_hash: string;
  grant_nonce: string;
  buyer_wallet: PaymentPartyWallet;
  seller_wallet: PaymentPartyWallet;
  asset_address: string;
  gross_amount: Money;
  expires_at_unix: bigint;
  signature: Hex;
  signer_nonce: bigint;
}

export interface ConditionalSettlementReleaseRequest {
  settlement_id: string;
  seller_wallet: PaymentPartyWallet;
  haggle_fee_wallet: PaymentPartyWallet;
  seller_amount: Money;
  haggle_fee_amount: Money;
  deadline: bigint;
  signature: Hex;
  signer_nonce: bigint;
}

export interface ConditionalSettlementRefundRequest {
  settlement_id: string;
  deadline: bigint;
  signature: Hex;
  signer_nonce: bigint;
}

export interface ConditionalSettlementResult {
  settlement_id: string;
  contract_reference: string;
  tx_hash?: string;
  status: "PENDING" | "FUNDED" | "RELEASED" | "REFUNDED" | "DISPUTED" | "FAILED";
  updated_at?: string;
}

export interface DisputeAnchorRecord {
  order_id: string;
  dispute_case_id: string;
  evidence_root_hash?: string;
  resolution_hash?: string;
  anchored_at?: string;
  onchain_reference?: string;
}

export interface SettlementRouterCapabilities {
  supports_fee_split: boolean;
  supports_dispute_anchor: boolean;
  supports_reservation_binding: boolean;
}

export interface ConditionalSettlementCapabilities {
  supports_policy_hash_binding: boolean;
  supports_expiry_refund: boolean;
  supports_signed_release: boolean;
  supports_signed_refund: boolean;
  supports_dispute_lock: boolean;
}

/**
 * 장기적으로는 x402-exec 계열과 연결될 수 있지만,
 * 현재 Haggle은 exact + offchain dispute를 기본 전제로 둔다.
 */
export interface SettlementRouterContract {
  readonly network: string;
  readonly asset: "USDC";
  readonly capabilities: SettlementRouterCapabilities;
  quote(request: Omit<SettlementRouterExecutionRequest, "quote_id" | "signature" | "deadline" | "signer_nonce">): Promise<SettlementRouterQuote>;
  execute(request: SettlementRouterExecutionRequest): Promise<SettlementRouterExecutionResult>;
}

export interface ConditionalSettlementContract {
  readonly network: string;
  readonly asset: "USDC";
  readonly address?: string;
  readonly capabilities: ConditionalSettlementCapabilities;
  createAndFund(request: ConditionalSettlementCreateRequest): Promise<ConditionalSettlementResult>;
  release(request: ConditionalSettlementReleaseRequest): Promise<ConditionalSettlementResult>;
  refund(request: ConditionalSettlementRefundRequest): Promise<ConditionalSettlementResult>;
  expire(settlementId: string): Promise<ConditionalSettlementResult>;
  raiseDispute(settlementId: string, evidenceHash: string): Promise<ConditionalSettlementResult>;
}

export interface DisputeRegistryContract {
  readonly network: string;
  anchor(record: DisputeAnchorRecord): Promise<DisputeAnchorRecord>;
}
