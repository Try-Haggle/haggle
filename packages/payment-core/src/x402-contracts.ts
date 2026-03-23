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
  approval_snapshot_hash: string;
  reservation_id?: string;
}

export interface SettlementRouterExecutionResult {
  execution_id: string;
  router_reference: string;
  tx_hash?: string;
  status: "PENDING" | "SETTLED" | "FAILED";
  settled_at?: string;
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

/**
 * 장기적으로는 x402-exec 계열과 연결될 수 있지만,
 * 현재 Haggle은 exact + offchain dispute를 기본 전제로 둔다.
 */
export interface SettlementRouterContract {
  readonly network: string;
  readonly asset: "USDC";
  readonly capabilities: SettlementRouterCapabilities;
  quote(request: Omit<SettlementRouterExecutionRequest, "quote_id" | "approval_snapshot_hash">): Promise<SettlementRouterQuote>;
  execute(request: SettlementRouterExecutionRequest): Promise<SettlementRouterExecutionResult>;
}

export interface DisputeRegistryContract {
  readonly network: string;
  anchor(record: DisputeAnchorRecord): Promise<DisputeAnchorRecord>;
}
