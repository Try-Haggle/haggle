/**
 * Refund Executor — Routes refunds to the appropriate rail.
 *
 * Rails:
 *   - mock: no-op, returns a synthetic refund_id
 *   - usdc: transfers USDC from escrow to buyer wallet via gas relayer
 *   - stripe: creates a Stripe refund against the original charge
 *
 * Security:
 *   - Amount is always server-computed (never from client)
 *   - Double-refund prevention is the caller's responsibility (check refunds table first)
 */

import { isAddress, encodeFunctionData } from "viem";
import { relayTransaction, getRelayerConfig } from "./gas-relayer.js";
import {
  BASE_USDC_ADDRESS,
  BASE_SEPOLIA_USDC_ADDRESS,
} from "@haggle/contracts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RefundRail = "usdc" | "stripe" | "mock";

export interface ExecuteRefundParams {
  order_id: string;
  buyer_wallet_address?: string;
  amount_cents: number;
  rail: RefundRail;
  reason: string;
  /** Stripe PaymentIntent ID — required for stripe rail */
  stripe_payment_intent_id?: string;
}

export interface ExecuteRefundResult {
  tx_hash?: string;
  refund_id?: string;
}

// ---------------------------------------------------------------------------
// ERC-20 transfer ABI fragment
// ---------------------------------------------------------------------------

const ERC20_TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getUsdcAddress(): `0x${string}` {
  const network = process.env.HAGGLE_X402_NETWORK ?? "base";
  return network === "base-sepolia"
    ? BASE_SEPOLIA_USDC_ADDRESS
    : BASE_USDC_ADDRESS;
}

function centsToUsdcWei(amountCents: number): bigint {
  // USDC has 6 decimals. 1 cent = 10_000 units (1e6 / 100).
  return BigInt(amountCents) * 10_000n;
}

function getRefundMode(): RefundRail {
  const mode = process.env.REFUND_MODE;
  if (mode === "usdc" || mode === "stripe") return mode;
  if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") {
    throw new Error("REFUND_MODE must be usdc or stripe in production");
  }
  return "mock";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Execute a refund to the buyer.
 *
 * - mock: returns a synthetic refund_id (no real money moves)
 * - usdc: transfers USDC from escrow wallet to the buyer's wallet
 * - stripe: creates a Stripe refund if original payment used Stripe
 */
export async function executeRefund(
  params: ExecuteRefundParams,
): Promise<ExecuteRefundResult> {
  // Use the explicitly requested rail, or fall back to env-configured mode
  const rail = params.rail ?? getRefundMode();

  switch (rail) {
    case "mock":
      if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") {
        throw new Error("Mock refunds are disabled in production");
      }
      return {
        refund_id: `mock_refund_${params.order_id}_${Date.now()}`,
      };

    case "usdc":
      return executeUsdcRefund(params);

    case "stripe":
      return executeStripeRefund(params);
  }
}

// ---------------------------------------------------------------------------
// USDC refund
// ---------------------------------------------------------------------------

async function executeUsdcRefund(
  params: ExecuteRefundParams,
): Promise<ExecuteRefundResult> {
  if (!params.buyer_wallet_address) {
    throw new Error("USDC refund requires buyer_wallet_address");
  }
  if (!isAddress(params.buyer_wallet_address)) {
    throw new Error("Invalid buyer wallet address for refund");
  }

  const relayerConfig = getRelayerConfig();
  if (!relayerConfig.enabled) {
    throw new Error("Gas relayer not configured — required for USDC refund");
  }

  const usdcAddress = getUsdcAddress();
  const amountWei = centsToUsdcWei(params.amount_cents);

  const calldata = encodeFunctionData({
    abi: ERC20_TRANSFER_ABI,
    functionName: "transfer",
    args: [
      params.buyer_wallet_address as `0x${string}`,
      amountWei,
    ],
  });

  const result = await relayTransaction({
    to: usdcAddress,
    data: calldata,
  });

  return { tx_hash: result.txHash };
}

// ---------------------------------------------------------------------------
// Stripe refund
// ---------------------------------------------------------------------------

async function executeStripeRefund(
  params: ExecuteRefundParams,
): Promise<ExecuteRefundResult> {
  if (!params.stripe_payment_intent_id) {
    throw new Error("Stripe refund requires stripe_payment_intent_id");
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    throw new Error("STRIPE_SECRET_KEY not configured — required for Stripe refund");
  }

  // Use Stripe API directly via fetch to avoid adding a heavy SDK dependency
  const response = await fetch("https://api.stripe.com/v1/refunds", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${stripeSecretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      payment_intent: params.stripe_payment_intent_id,
      amount: String(params.amount_cents), // Stripe uses smallest currency unit = cents
      reason: "requested_by_customer",
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      `Stripe refund failed: ${(body as Record<string, unknown>).error ?? response.statusText}`,
    );
  }

  const refund = (await response.json()) as { id: string };
  return { refund_id: refund.id };
}
