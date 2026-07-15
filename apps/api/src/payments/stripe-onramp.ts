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

import { createHmac, timingSafeEqual } from "node:crypto";
import { calculateRetryDelayMs, classifyProviderError } from "@haggle/payment-core";

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
  /** Policy-binding metadata shared with x402 and settlement contracts. */
  metadata?: Record<string, string>;
  /** Client IP for compliance */
  clientIp?: string;
  /** Provider idempotency key for safe retry/session creation. */
  idempotencyKey?: string;
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
  type:
    | "crypto.onramp_session.fulfillment_complete"
    | "crypto.onramp_session.fulfillment_processing"
    | string;
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

async function withStripeRetries<T>(operation: () => Promise<T>): Promise<T> {
  const maxAttempts = 3;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (classifyProviderError(error) !== "retryable" || attempt === maxAttempts - 1) {
        throw error;
      }
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          calculateRetryDelayMs(attempt, {
            baseDelayMs: 150,
            maxDelayMs: 750,
          }),
        ),
      );
    }
  }
  throw lastError;
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
  for (const [key, value] of Object.entries(params.metadata ?? {})) {
    body.append(`metadata[${key}]`, value);
  }

  const response = await withStripeRetries(async () => {
    const candidate = await fetch("https://api.stripe.com/v1/crypto/onramp_sessions", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(config.secretKey + ":").toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
        ...(params.idempotencyKey ? { "Idempotency-Key": params.idempotencyKey } : {}),
      },
      body: body.toString(),
    });
    if (!candidate.ok && classifyProviderError({ status: candidate.status }) === "retryable") {
      throw Object.assign(new Error(`STRIPE_ONRAMP_RETRYABLE_STATUS:${candidate.status}`), {
        status: candidate.status,
      });
    }
    return candidate;
  });

  if (!response.ok) {
    const errBody = (await response.json().catch(() => ({ error: {} }))) as {
      error?: { message?: string };
    };
    throw Object.assign(
      new Error(
        `STRIPE_ONRAMP_ERROR: ${response.status} ${errBody.error?.message ?? response.statusText}`,
      ),
      { status: response.status },
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
  options:
    | number
    | {
        timestampToleranceSeconds?: number;
        nowMs?: number;
      } = 300,
): boolean {
  if (!secret || !signature) return false;

  const timestampToleranceSeconds =
    typeof options === "number" ? options : (options.timestampToleranceSeconds ?? 300);
  const nowMs = typeof options === "number" ? Date.now() : (options.nowMs ?? Date.now());

  // Parse Stripe-Signature header: t=timestamp,v1=signature
  const parts = signature.split(",").map((part: string) => part.trim());
  const timestampPart = parts.find((p: string) => p.startsWith("t="));
  const expectedSigs = parts
    .filter((p: string) => p.startsWith("v1="))
    .map((p: string) => p.slice(3))
    .filter((candidate: string) => /^[0-9a-f]{64}$/i.test(candidate));

  if (!timestampPart || expectedSigs.length === 0) return false;

  const timestamp = timestampPart.slice(2);
  const timestampSeconds = Number(timestamp);
  if (!Number.isSafeInteger(timestampSeconds) || timestampSeconds <= 0) return false;
  const ageSeconds = Math.abs(nowMs / 1000 - timestampSeconds);
  if (ageSeconds > timestampToleranceSeconds) return false;

  // Compute expected signature
  const signedPayload = `${timestamp}.${typeof payload === "string" ? payload : payload.toString("utf8")}`;
  const computedSig = createHmac("sha256", secret).update(signedPayload).digest("hex");

  // Timing-safe comparison
  const a = Buffer.from(computedSig);
  return expectedSigs.some((expectedSig: string) => {
    const b = Buffer.from(expectedSig);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}
