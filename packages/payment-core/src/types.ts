export type PaymentRail = "x402" | "stripe";
export type BuyerAuthorizationMode = "human_wallet" | "agent_wallet";

export type PaymentIntentStatus =
  | "CREATED"
  | "QUOTED"
  | "AUTHORIZED"
  | "SETTLEMENT_PENDING"
  | "SETTLED"
  | "FAILED"
  | "CANCELED";

export type RefundStatus =
  | "REQUESTED"
  | "PENDING"
  | "COMPLETED"
  | "FAILED";

export interface Money {
  currency: string;
  amount_minor: number;
}

export interface PaymentIntent {
  id: string;
  order_id: string;
  seller_id: string;
  buyer_id: string;
  /**
   * seller 정책과 negotiation 결과를 거쳐 결제 실행 단계에 들어온 확정 rail.
   */
  selected_rail: PaymentRail;
  allowed_rails: PaymentRail[];
  buyer_authorization_mode?: BuyerAuthorizationMode;
  amount: Money;
  status: PaymentIntentStatus;
  created_at: string;
  updated_at: string;
}

export interface PaymentPartyWallet {
  actor_id: string;
  wallet_address: string;
  network: string;
  custody: "external" | "agent_wallet" | "merchant_managed";
}

export interface PaymentAuthorization {
  id: string;
  payment_intent_id: string;
  rail: PaymentRail;
  provider_reference: string;
  authorized_amount: Money;
  created_at: string;
}

export interface PaymentSettlement {
  id: string;
  payment_intent_id: string;
  rail: PaymentRail;
  provider_reference: string;
  settled_amount: Money;
  settled_at?: string;
  status: "PENDING" | "SETTLED" | "FAILED";
}

export interface Refund {
  id: string;
  payment_intent_id: string;
  amount: Money;
  reason_code: string;
  status: RefundStatus;
  created_at: string;
  updated_at: string;
}

export interface PaymentProviderCapabilities {
  rail: PaymentRail;
  provider: string;
  supports_authorize: boolean;
  supports_capture: boolean;
  supports_refund: boolean;
  preferred: boolean;
}

export const DEFAULT_PAYMENT_CAPABILITIES: PaymentProviderCapabilities[] = [
  {
    rail: "x402",
    provider: "ai.haggle.x402",
    supports_authorize: true,
    supports_capture: true,
    supports_refund: true,
    preferred: true,
  },
  {
    rail: "stripe",
    provider: "ai.haggle.stripe",
    supports_authorize: true,
    supports_capture: true,
    supports_refund: true,
    preferred: false,
  },
];
