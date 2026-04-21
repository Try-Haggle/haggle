/**
 * Deposit Collector — Collects dispute deposits via USDC, Stripe onramp, or mock.
 *
 * Security invariants:
 *   - Amount is ALWAYS server-computed from computeDisputeCost() — never from client
 *   - USDC transferFrom: allowance verified on-chain BEFORE calling transferFrom
 *   - Double-collection prevented: only collect when deposit status is PENDING
 *   - Wallet address validated with isAddress() before any on-chain operation
 *   - Gas paid by Haggle relayer — seller only needs USDC, no ETH
 */

import { isAddress, encodeFunctionData, createPublicClient, http } from "viem";
import { base, baseSepolia } from "viem/chains";
import { relayTransaction, getRelayerConfig } from "./gas-relayer.js";
import { createOnrampSession } from "./stripe-onramp.js";
import {
  BASE_USDC_ADDRESS,
  BASE_SEPOLIA_USDC_ADDRESS,
} from "@haggle/contracts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DepositPaymentRail = "usdc" | "stripe" | "mock";

export interface DepositCollectionRequest {
  deposit_id: string;
  dispute_id: string;
  /** Server-computed amount in USD cents */
  amount_cents: number;
  /** Seller's wallet address — required for USDC rail */
  seller_wallet_address?: string;
  seller_user_id: string;
}

export interface DepositCollectionResult {
  rail: DepositPaymentRail;
  status: "pending" | "completed";
  /** USDC: approval instructions for the seller */
  usdc_approval?: {
    spender_address: string;
    token_address: string;
    amount_wei: string;
    chain_id: number;
  };
  /** Stripe: client_secret for frontend widget embedding */
  stripe_client_secret?: string;
  stripe_payment_intent_id?: string;
  /** Mock: immediately completed */
  mock_tx_id?: string;
}

// ---------------------------------------------------------------------------
// ERC-20 ABI fragments (only what we need)
// ---------------------------------------------------------------------------

const ERC20_ALLOWANCE_ABI = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const ERC20_TRANSFER_FROM_ABI = [
  {
    type: "function",
    name: "transferFrom",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDepositCollectionMode(): DepositPaymentRail {
  const mode = process.env.DEPOSIT_COLLECTION_MODE;
  if (mode === "usdc" || mode === "stripe") return mode;
  return "mock";
}

function getUsdcAddress(): `0x${string}` {
  const network = process.env.HAGGLE_X402_NETWORK ?? "base";
  return network === "base-sepolia"
    ? BASE_SEPOLIA_USDC_ADDRESS
    : BASE_USDC_ADDRESS;
}

function getChainId(): number {
  const network = process.env.HAGGLE_X402_NETWORK ?? "base";
  return network === "base-sepolia" ? 84532 : 8453;
}

/**
 * Convert USD cents to USDC minor units (6 decimals).
 * 100 cents = 1 USD = 1_000_000 USDC minor units.
 */
function centsToUsdcWei(amountCents: number): bigint {
  // 1 cent = 10_000 USDC minor units (6 decimals)
  return BigInt(amountCents) * 10_000n;
}

function getDepositDestinationWallet(): string {
  // Deposit funds go to a Haggle-controlled escrow wallet.
  // This is distinct from the fee wallet — deposits are held and potentially refunded.
  const wallet = process.env.HAGGLE_DEPOSIT_ESCROW_WALLET;
  if (!wallet) {
    throw new Error(
      "HAGGLE_DEPOSIT_ESCROW_WALLET not configured — required for USDC deposit collection",
    );
  }
  if (!isAddress(wallet)) {
    throw new Error("HAGGLE_DEPOSIT_ESCROW_WALLET is not a valid Ethereum address");
  }
  return wallet;
}

// ---------------------------------------------------------------------------
// Initiate
// ---------------------------------------------------------------------------

/**
 * Initiate deposit collection.
 *
 * - mock: immediately mark as DEPOSITED (returns completed status)
 * - usdc: return ERC-20 approval instructions (seller must approve, then call /confirm-usdc)
 * - stripe: create Stripe Crypto Onramp session, return client_secret
 */
export async function initiateDepositCollection(
  req: DepositCollectionRequest,
): Promise<DepositCollectionResult> {
  const rail = getDepositCollectionMode();

  switch (rail) {
    case "mock":
      return {
        rail: "mock",
        status: "completed",
        mock_tx_id: `mock_deposit_${req.deposit_id}_${Date.now()}`,
      };

    case "usdc":
      return initiateUsdcDeposit(req);

    case "stripe":
      return initiateStripeDeposit(req);
  }
}

async function initiateUsdcDeposit(
  req: DepositCollectionRequest,
): Promise<DepositCollectionResult> {
  if (!req.seller_wallet_address) {
    throw new Error("USDC deposit requires seller_wallet_address");
  }
  if (!isAddress(req.seller_wallet_address)) {
    throw new Error("Invalid seller wallet address");
  }

  const relayerConfig = getRelayerConfig();
  if (!relayerConfig.enabled) {
    throw new Error("Gas relayer not configured — required for USDC deposit collection");
  }

  const usdcAddress = getUsdcAddress();
  const chainId = getChainId();
  const amountWei = centsToUsdcWei(req.amount_cents);

  // Return approval instructions — seller must call ERC-20 approve() on USDC
  // to allow our relayer to transferFrom their wallet.
  return {
    rail: "usdc",
    status: "pending",
    usdc_approval: {
      spender_address: relayerConfig.address,
      token_address: usdcAddress,
      amount_wei: amountWei.toString(),
      chain_id: chainId,
    },
  };
}

async function initiateStripeDeposit(
  req: DepositCollectionRequest,
): Promise<DepositCollectionResult> {
  const destinationWallet = getDepositDestinationWallet();

  const session = await createOnrampSession({
    destinationWallet,
    amountMinor: req.amount_cents,
    paymentIntentId: `deposit_${req.deposit_id}`,
  });

  return {
    rail: "stripe",
    status: "pending",
    stripe_client_secret: session.clientSecret,
    stripe_payment_intent_id: session.sessionId,
  };
}

// ---------------------------------------------------------------------------
// Confirm USDC
// ---------------------------------------------------------------------------

/**
 * Confirm USDC deposit after seller has approved the spend.
 *
 * Steps:
 *   1. Verify on-chain allowance >= amount
 *   2. Call transferFrom via gas relayer (Haggle pays gas)
 *   3. Return tx hash
 *
 * @throws if allowance insufficient or transfer fails
 */
export async function confirmUsdcDeposit(params: {
  deposit_id: string;
  seller_wallet_address: string;
  amount_cents: number;
}): Promise<{ tx_hash: string }> {
  if (!isAddress(params.seller_wallet_address)) {
    throw new Error("Invalid seller wallet address");
  }

  const relayerConfig = getRelayerConfig();
  if (!relayerConfig.enabled) {
    throw new Error("Gas relayer not configured");
  }

  const usdcAddress = getUsdcAddress();
  const amountWei = centsToUsdcWei(params.amount_cents);
  const destinationWallet = getDepositDestinationWallet();

  // 1. Verify on-chain allowance
  const rpcUrl = process.env.HAGGLE_BASE_RPC_URL;
  if (!rpcUrl) {
    throw new Error("HAGGLE_BASE_RPC_URL not configured");
  }

  const network = process.env.HAGGLE_X402_NETWORK ?? "base";
  const chain = network === "base-sepolia" ? baseSepolia : base;
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

  const allowance = await publicClient.readContract({
    address: usdcAddress,
    abi: ERC20_ALLOWANCE_ABI,
    functionName: "allowance",
    args: [
      params.seller_wallet_address as `0x${string}`,
      relayerConfig.address as `0x${string}`,
    ],
  });

  if (allowance < amountWei) {
    throw new Error(
      `INSUFFICIENT_ALLOWANCE: seller approved ${allowance.toString()} but need ${amountWei.toString()}`,
    );
  }

  // 2. Execute transferFrom via gas relayer
  const calldata = encodeFunctionData({
    abi: ERC20_TRANSFER_FROM_ABI,
    functionName: "transferFrom",
    args: [
      params.seller_wallet_address as `0x${string}`,
      destinationWallet as `0x${string}`,
      amountWei,
    ],
  });

  const result = await relayTransaction({
    to: usdcAddress,
    data: calldata,
  });

  return { tx_hash: result.txHash };
}
