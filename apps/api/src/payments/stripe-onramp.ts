/**
 * Stripe Crypto Onramp — fiat → USDC on Base.
 *
 * Flow:
 *   1. Server creates CryptoOnrampSession with destination wallet + amount
 *   2. Client embeds Stripe onramp widget using client_secret
 *   3. User pays with card/bank → Stripe converts to USDC
 *   4. USDC delivered to destination wallet on Base
 *   5. Webhook confirms fulfillment → update payment status
 *
 * Stripe fee: 1.5% (same as Haggle platform fee — total buyer cost ~3%)
 *
 * Ref: https://docs.stripe.com/crypto/onramp/api-reference
 */

// ─── Types ────────────────────────────────────────────────────────────

export interface OnrampSessionParams {
  /** Destination wallet address (seller's or escrow wallet on Base) */
  destinationWallet: string;
  /** Amount in USD cents (e.g., 58500 = $585.00) */
  amountMinor: number;
  /** Buyer's email for pre-filling KYC */
  buyerEmail?: string;
  /** Payment intent ID for correlation */
  paymentIntentId: string;
  /** Client IP for compliance */
  clientIp?: string;
}

export interface OnrampSessionResult {
  /** Stripe session ID */
  sessionId: string;
  /** Client secret for embedding the widget */
  clientSecret: string;
  /** Stripe-hosted URL (alternative to embedded widget) */
  hostedUrl?: string;
  /** Session status */
  status: string;
}

export interface OnrampWebhookEvent {
  type: "crypto.onramp_session.fulfillment_complete" | "crypto.onramp_session.fulfillment_processing" | string;
  data: {
    object: {
      id: string;
      status: string;
      destination_amount: string;
      destination_currency: string;
      destination_network: string;
      metadata?: Record<string, string>;
    };
  };
}

// ─── Config ───────────────────────────────────────────────────────────

export function getStripeConfig() {
  return {
    secretKey: process.env.STRIPE_SECRET_KEY ?? "",
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? "",
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
    enabled: !!process.env.STRIPE_SECRET_KEY,
  };
}

// ─── Session Creation ─────────────────────────────────────────────────

/**
 * Create a Stripe Crypto Onramp session.
 * Returns a client_secret the frontend uses to embed the payment widget.
 */
export async function createOnrampSession(
  params: OnrampSessionParams,
): Promise<OnrampSessionResult> {
  const config = getStripeConfig();
  if (!config.enabled) {
    throw new Error("STRIPE_NOT_CONFIGURED: Set STRIPE_SECRET_KEY");
  }

  const amountUsd = (params.amountMinor / 100).toFixed(2);

  const body = new URLSearchParams();
  body.append("wallet_addresses[ethereum]", params.destinationWallet);
  body.append("destination_currency", "usdc");
  body.append("destination_network", "base");
  body.append("destination_amount", amountUsd);
  if (params.buyerEmail) {
    body.append("customer_information[email]", params.buyerEmail);
  }
  if (params.clientIp) {
    body.append("customer_ip_address", params.clientIp);
  }
  body.append("metadata[payment_intent_id]", params.paymentIntentId);
  body.append("metadata[platform]", "haggle");

  const response = await fetch("https://api.stripe.com/v1/crypto/onramp_sessions", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(config.secretKey + ":").toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({ error: {} })) as { error?: { message?: string } };
    throw new Error(
      `STRIPE_ONRAMP_ERROR: ${response.status} ${errBody.error?.message ?? response.statusText}`,
    );
  }

  const session = (await response.json()) as Record<string, unknown>;

  return {
    sessionId: session.id as string,
    clientSecret: session.client_secret as string,
    hostedUrl: session.redirect_url as string | undefined,
    status: session.status as string,
  };
}

// ─── Webhook Verification ─────────────────────────────────────────────

/**
 * Verify Stripe webhook signature.
 * Uses the standard Stripe webhook signature scheme (v1).
 */
export function verifyStripeWebhook(
  payload: string | Buffer,
  signature: string,
  secret: string,
): boolean {
  const crypto = require("node:crypto");

  // Parse Stripe-Signature header: t=timestamp,v1=signature
  const parts = signature.split(",");
  const timestampPart = parts.find((p: string) => p.startsWith("t="));
  const sigPart = parts.find((p: string) => p.startsWith("v1="));

  if (!timestampPart || !sigPart) return false;

  const timestamp = timestampPart.slice(2);
  const expectedSig = sigPart.slice(3);

  // Compute expected signature
  const signedPayload = `${timestamp}.${typeof payload === "string" ? payload : payload.toString("utf8")}`;
  const computedSig = crypto
    .createHmac("sha256", secret)
    .update(signedPayload)
    .digest("hex");

  // Timing-safe comparison
  const a = Buffer.from(computedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
