import type { PaymentAuthorization, PaymentIntent, PaymentRail, PaymentSettlement, Refund } from "./types.js";

export interface PaymentQuote {
  rail: PaymentRail;
  provider_reference: string;
  amount: PaymentIntent["amount"];
  expires_at?: string;
  metadata?: Record<string, unknown>;
}

export interface AuthorizePaymentResult {
  authorization: PaymentAuthorization;
  metadata?: Record<string, unknown>;
}

export interface SettlePaymentResult {
  settlement: PaymentSettlement;
  metadata?: Record<string, unknown>;
}

export interface RefundPaymentResult {
  refund: Refund;
  metadata?: Record<string, unknown>;
}

export interface PaymentProvider {
  readonly rail: PaymentRail;
  readonly provider: string;
  quote(intent: PaymentIntent): Promise<PaymentQuote>;
  authorize(intent: PaymentIntent): Promise<AuthorizePaymentResult>;
  settle(intent: PaymentIntent): Promise<SettlePaymentResult>;
  refund(intent: PaymentIntent, refund: Refund): Promise<RefundPaymentResult>;
}
