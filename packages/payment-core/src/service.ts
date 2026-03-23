import type { TrustTriggerEvent } from "@haggle/commerce-core";
import { createId } from "./id.js";
import { transitionPaymentIntent } from "./state-machine.js";
import { trustTriggersForPaymentTransition } from "./trust-events.js";
import type {
  Money,
  PaymentAuthorization,
  BuyerAuthorizationMode,
  PaymentIntent,
  PaymentIntentStatus,
  PaymentRail,
  PaymentSettlement,
  Refund,
} from "./types.js";
import type { PaymentProvider, PaymentQuote, RefundPaymentResult } from "./provider.js";

export interface CreatePaymentIntentInput {
  order_id: string;
  seller_id: string;
  buyer_id: string;
  selected_rail: PaymentRail;
  allowed_rails?: PaymentRail[];
  buyer_authorization_mode?: BuyerAuthorizationMode;
  amount: Money;
  now?: string;
}

export interface PaymentServiceResult<T> {
  intent: PaymentIntent;
  value?: T;
  metadata?: Record<string, unknown>;
  trust_triggers: TrustTriggerEvent[];
}

function nowIso(now?: string): string {
  return now ?? new Date().toISOString();
}

function transitionOrThrow(status: PaymentIntentStatus, event: Parameters<typeof transitionPaymentIntent>[1]): PaymentIntentStatus {
  const next = transitionPaymentIntent(status, event);
  if (!next) {
    throw new Error(`invalid payment transition: ${status} -> ${event}`);
  }
  return next;
}

export class PaymentService {
  constructor(private readonly providers: Partial<Record<PaymentRail, PaymentProvider>>) {}

  createIntent(input: CreatePaymentIntentInput): PaymentIntent {
    const createdAt = nowIso(input.now);
    return {
      id: createId(),
      order_id: input.order_id,
      seller_id: input.seller_id,
      buyer_id: input.buyer_id,
      selected_rail: input.selected_rail,
      allowed_rails: input.allowed_rails ?? [input.selected_rail],
      buyer_authorization_mode: input.buyer_authorization_mode,
      amount: input.amount,
      status: "CREATED",
      created_at: createdAt,
      updated_at: createdAt,
    };
  }

  async quoteIntent(intent: PaymentIntent, now?: string): Promise<PaymentServiceResult<PaymentQuote>> {
    const provider = this.resolveProvider(intent.selected_rail);
    const quote = await provider.quote(intent);
    const nextIntent = this.withStatus(intent, transitionOrThrow(intent.status, "quote"), now);
    return {
      intent: nextIntent,
      value: quote,
      metadata: quote.metadata,
      trust_triggers: trustTriggersForPaymentTransition(intent.status, nextIntent.status),
    };
  }

  async authorizeIntent(intent: PaymentIntent, now?: string): Promise<PaymentServiceResult<PaymentAuthorization>> {
    const provider = this.resolveProvider(intent.selected_rail);
    const result = await provider.authorize(intent);
    const nextIntent = this.withStatus(intent, transitionOrThrow(intent.status, "authorize"), now);
    return {
      intent: nextIntent,
      value: result.authorization,
      metadata: result.metadata,
      trust_triggers: trustTriggersForPaymentTransition(intent.status, nextIntent.status),
    };
  }

  markSettlementPending(intent: PaymentIntent, now?: string): PaymentServiceResult<undefined> {
    const nextIntent = this.withStatus(intent, transitionOrThrow(intent.status, "mark_settlement_pending"), now);
    return {
      intent: nextIntent,
      trust_triggers: trustTriggersForPaymentTransition(intent.status, nextIntent.status),
    };
  }

  async settleIntent(intent: PaymentIntent, now?: string): Promise<PaymentServiceResult<PaymentSettlement>> {
    const provider = this.resolveProvider(intent.selected_rail);
    const result = await provider.settle(intent);
    const nextIntent = this.withStatus(intent, transitionOrThrow(intent.status, "settle"), now);
    return {
      intent: nextIntent,
      value: result.settlement,
      metadata: result.metadata,
      trust_triggers: trustTriggersForPaymentTransition(intent.status, nextIntent.status),
    };
  }

  cancelIntent(intent: PaymentIntent, now?: string): PaymentServiceResult<undefined> {
    const nextIntent = this.withStatus(intent, transitionOrThrow(intent.status, "cancel"), now);
    return {
      intent: nextIntent,
      trust_triggers: trustTriggersForPaymentTransition(intent.status, nextIntent.status),
    };
  }

  failIntent(intent: PaymentIntent, now?: string): PaymentServiceResult<undefined> {
    const nextIntent = this.withStatus(intent, transitionOrThrow(intent.status, "fail"), now);
    return {
      intent: nextIntent,
      trust_triggers: trustTriggersForPaymentTransition(intent.status, nextIntent.status),
    };
  }

  async refundIntent(intent: PaymentIntent, refund: Refund): Promise<RefundPaymentResult> {
    const provider = this.resolveProvider(intent.selected_rail);
    return provider.refund(intent, refund);
  }

  private resolveProvider(rail: PaymentRail): PaymentProvider {
    const provider = this.providers[rail];
    if (!provider) {
      throw new Error(`no payment provider registered for rail: ${rail}`);
    }
    return provider;
  }

  private withStatus(intent: PaymentIntent, status: PaymentIntentStatus, now?: string): PaymentIntent {
    return {
      ...intent,
      status,
      updated_at: nowIso(now),
    };
  }
}
