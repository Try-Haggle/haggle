/**
 * Deposit Refunder — Returns dispute deposits to sellers who win.
 *
 * Rails:
 *   - mock: no-op, just marks as REFUNDED
 *   - usdc: transfers USDC from escrow back to seller wallet via gas relayer
 *   - stripe: crypto onramp refunds are manual (USDC already on-chain)
 *
 * Security: refund only if deposit is DEPOSITED and outcome is seller_favor.
 */

import { isAddress, encodeFunctionData } from "viem";
import { relayTransaction, getRelayerConfig } from "./gas-relayer.js";
import {
  BASE_USDC_ADDRESS,
  BASE_SEPOLIA_USDC_ADDRESS,
} from "@haggle/contracts";
import type { DepositPaymentRail } from "./deposit-collector.js";

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
  return BigInt(amountCents) * 10_000n;
}

// ---------------------------------------------------------------------------
// Refund
// ---------------------------------------------------------------------------

export interface RefundDepositParams {
  deposit_id: string;
  amount_cents: number;
  seller_wallet_address?: string;
  stripe_payment_intent_id?: string;
  rail: DepositPaymentRail;
}

export interface RefundDepositResult {
  tx_hash?: string;
  refund_id?: string;
}

/**
 * Refund a deposit to the seller when they win the dispute.
 *
 * - mock: no-op (returns a synthetic refund_id)
 * - usdc: transfer USDC from escrow wallet back to seller
 * - stripe: record manual refund (crypto onramp refunds are not automated)
 */
export async function refundDeposit(
  params: RefundDepositParams,
): Promise<RefundDepositResult> {
  switch (params.rail) {
    case "mock":
      if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") {
        throw new Error("Mock deposit refunds are disabled in production");
      }
      return {
        refund_id: `mock_refund_${params.deposit_id}_${Date.now()}`,
      };

    case "usdc":
      return refundUsdcDeposit(params);

    case "stripe":
      // Crypto onramp refunds require manual processing — USDC is already on-chain.
      // Record the intent but actual refund must happen via on-chain transfer or support.
      return {
        refund_id: `stripe_manual_refund_${params.deposit_id}_${Date.now()}`,
      };
  }
}

async function refundUsdcDeposit(
  params: RefundDepositParams,
): Promise<RefundDepositResult> {
  if (!params.seller_wallet_address) {
    throw new Error("USDC refund requires seller_wallet_address");
  }
  if (!isAddress(params.seller_wallet_address)) {
    throw new Error("Invalid seller wallet address for refund");
  }

  const relayerConfig = getRelayerConfig();
  if (!relayerConfig.enabled) {
    throw new Error("Gas relayer not configured — required for USDC refund");
  }

  const usdcAddress = getUsdcAddress();
  const amountWei = centsToUsdcWei(params.amount_cents);

  // Transfer USDC from the escrow wallet to the seller.
  // The relayer wallet must hold USDC in escrow (or have approval from escrow).
  // In production, the escrow wallet IS the relayer wallet for deposits.
  const calldata = encodeFunctionData({
    abi: ERC20_TRANSFER_ABI,
    functionName: "transfer",
    args: [
      params.seller_wallet_address as `0x${string}`,
      amountWei,
    ],
  });

  const result = await relayTransaction({
    to: usdcAddress,
    data: calldata,
  });

  return { tx_hash: result.txHash };
}
