/**
 * Real Stripe Adapter — Crypto Onramp only (fiat card → USDC).
 *
 * Stripe is NOT used for traditional card payments. It is a secondary
 * payment rail for users who need to buy USDC with a credit card before
 * paying on-chain via x402.
 *
 * Flow:
 *   1. authorize() → creates Crypto Onramp session (client_secret returned)
 *   2. Client embeds Stripe onramp widget
 *   3. User pays card → Stripe delivers USDC to destination wallet on Base
 *   4. Webhook: crypto.onramp_session.fulfillment_complete → settle()
 *
 * The `stripe` npm package is used for:
 *   - Creating onramp sessions (with typed API)
 *   - Webhook signature verification (stripe.webhooks.constructEvent)
 *
 * Requires: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET env vars.
 */

import type Stripe from "stripe";
import type {
  PaymentProvider,
  PaymentQuote,
  AuthorizePaymentResult,
  SettlePaymentResult,
  RefundPaymentResult,
} from "@haggle/payment-core";
import type { PaymentIntent, Refund } from "@haggle/payment-core";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface RealStripeAdapterConfig {
  /** Stripe SDK instance — injected to keep this module testable */
  stripe: Stripe;
  /** Stripe webhook signing secret for signature verification */
  webhookSecret: string;
  /** Destination wallet for USDC delivery (escrow or buyer wallet) */
  defaultDestinationWallet?: string;
  /** Destination network — always Base for Haggle */
  destinationNetwork?: string;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class RealStripeAdapter implements PaymentProvider {
  readonly rail = "stripe" as const;
  readonly provider = "ai.haggle.stripe.onramp";

  private readonly stripe: Stripe;
  private readonly webhookSecret: string;
  private readonly destinationNetwork: string;

  constructor(private readonly config: RealStripeAdapterConfig) {
    this.stripe = config.stripe;
    this.webhookSecret = config.webhookSecret;
    this.destinationNetwork = config.destinationNetwork ?? "base";
  }

  /**
   * Quote: return fee information and expiry for the onramp session.
   * No Stripe API call needed — we know the fee structure.
   */
  async quote(intent: PaymentIntent): Promise<PaymentQuote> {
    return {
      rail: this.rail,
      provider_reference: `stripe_quote_${intent.id}`,
      amount: intent.amount,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      metadata: {
        payment_method_types: ["card"],
        mode: "crypto_onramp",
        stripe_fee_pct: 1.5,
        destination_network: this.destinationNetwork,
        destination_currency: "usdc",
      },
    };
  }

  /**
   * Authorize: create a Stripe Crypto Onramp session.
   * Returns the session ID + client_secret for embedding the widget.
   */
  async authorize(intent: PaymentIntent): Promise<AuthorizePaymentResult> {
    const amountUsd = (intent.amount.amount_minor / 100).toFixed(2);

    const destinationWallet = this.config.defaultDestinationWallet;
    if (!destinationWallet || !/^0x[a-fA-F0-9]{40}$/.test(destinationWallet)) {
      throw new Error("defaultDestinationWallet is not configured or is invalid");
    }

    // Use Stripe raw request for crypto onramp (not all SDK versions expose typed methods)
    const session = await this.stripe.rawRequest("POST", "/v1/crypto/onramp_sessions", {
      wallet_addresses: { ethereum: destinationWallet },
      destination_currency: "usdc",
      destination_network: this.destinationNetwork,
      destination_amount: amountUsd,
      metadata: {
        payment_intent_id: intent.id,
        order_id: intent.order_id,
        platform: "haggle",
      },
    });

    const sessionData = JSON.parse(session.content) as {
      id: string;
      client_secret: string;
      status: string;
      redirect_url?: string;
    };

    return {
      authorization: {
        id: sessionData.id,
        payment_intent_id: intent.id,
        rail: this.rail,
        provider_reference: sessionData.id,
        authorized_amount: intent.amount,
        created_at: new Date().toISOString(),
      },
      metadata: {
        onramp_session_id: sessionData.id,
        client_secret: sessionData.client_secret,
        hosted_url: sessionData.redirect_url,
        status: sessionData.status,
        destination_network: this.destinationNetwork,
        destination_currency: "usdc",
      },
    };
  }

  /**
   * Settle: called when Stripe webhook confirms USDC delivery.
   * At this point, the onramp session is already complete — this just records it.
   */
  async settle(intent: PaymentIntent): Promise<SettlePaymentResult> {
    return {
      settlement: {
        id: `settle_${intent.id}_${Date.now()}`,
        payment_intent_id: intent.id,
        rail: this.rail,
        provider_reference: `stripe_onramp_${intent.id}`,
        settled_amount: intent.amount,
        settled_at: new Date().toISOString(),
        status: "SETTLED" as const,
      },
      metadata: {
        settlement_method: "crypto_onramp",
        destination_network: this.destinationNetwork,
        destination_currency: "usdc",
      },
    };
  }

  /**
   * Refund: crypto onramp refunds go through Stripe support.
   * We record the request but actual refund is manual for crypto onramp.
   */
  async refund(intent: PaymentIntent, refund: Refund): Promise<RefundPaymentResult> {
    // Crypto onramp refunds are not automated — USDC is already on-chain.
    // The refund must happen via on-chain transfer or Stripe support.
    return {
      refund: {
        ...refund,
        status: "PENDING" as const,
        updated_at: new Date().toISOString(),
      },
      metadata: {
        refund_method: "manual_crypto_onramp",
        note: "Crypto onramp refunds require manual processing. USDC is already on-chain.",
        original_payment_intent_id: intent.id,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Webhook helpers (exposed for route handler)
  // ---------------------------------------------------------------------------

  /**
   * Verify a Stripe webhook signature and parse the event.
   * Throws if verification fails.
   */
  constructWebhookEvent(payload: string | Buffer, signature: string): Stripe.Event {
    return this.stripe.webhooks.constructEvent(payload, signature, this.webhookSecret);
  }

  /**
   * Check if an event is a crypto onramp fulfillment completion.
   * Note: Stripe SDK types may not include crypto.onramp_session events yet,
   * so we compare against the string value.
   */
  static isOnrampFulfillmentComplete(event: Stripe.Event): boolean {
    return (event.type as string) === "crypto.onramp_session.fulfillment_complete";
  }

  /**
   * Extract the payment_intent_id from onramp session metadata.
   */
  static extractPaymentIntentId(event: Stripe.Event): string | null {
    const obj = event.data.object as unknown as Record<string, unknown>;
    const metadata = obj.metadata as Record<string, string> | undefined;
    return metadata?.payment_intent_id ?? null;
  }
}
