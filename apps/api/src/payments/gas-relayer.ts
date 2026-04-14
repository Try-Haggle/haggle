/**
 * Gas Relayer -- Haggle pays gas fees for better UX.
 * Users only need USDC, no ETH required.
 * Cost: ~$0.001/tx on Base L2.
 *
 * The relayer wallet submits transactions on behalf of users,
 * covering the gas cost from the platform's operational budget.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  type Hash,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RelayRequest {
  /** Target contract address */
  to: string;
  /** Encoded function call data */
  data: string;
  /** ETH value to send (usually 0n for USDC transfers) */
  value?: bigint;
}

export interface RelayResult {
  txHash: string;
  gasUsed: bigint;
  gasCostUsd: number;
}

export interface RelayerConfig {
  enabled: boolean;
  address: string;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function getRelayerEnv() {
  const privateKey = process.env.HAGGLE_ROUTER_RELAYER_PRIVATE_KEY as
    | `0x${string}`
    | undefined;
  const rpcUrl = process.env.HAGGLE_BASE_RPC_URL;
  const network = process.env.HAGGLE_X402_NETWORK ?? "base";

  return { privateKey, rpcUrl, network };
}

/**
 * Returns whether gas relaying is enabled and the relayer's public address.
 * Safe to call even when env vars are missing -- returns disabled state.
 */
export function getRelayerConfig(): RelayerConfig {
  const { privateKey } = getRelayerEnv();

  if (!privateKey) {
    return { enabled: false, address: "" };
  }

  try {
    const account = privateKeyToAccount(privateKey);
    return { enabled: true, address: account.address };
  } catch {
    return { enabled: false, address: "" };
  }
}

// ---------------------------------------------------------------------------
// Relay execution
// ---------------------------------------------------------------------------

/**
 * Submit a transaction on behalf of a user, paying gas from the relayer wallet.
 *
 * @throws if relayer is not configured or transaction fails
 */
export async function relayTransaction(
  request: RelayRequest,
): Promise<RelayResult> {
  const { privateKey, rpcUrl, network } = getRelayerEnv();

  if (!privateKey) {
    throw new Error(
      "Gas relayer not configured: HAGGLE_ROUTER_RELAYER_PRIVATE_KEY is missing",
    );
  }
  if (!rpcUrl) {
    throw new Error(
      "Gas relayer not configured: HAGGLE_BASE_RPC_URL is missing",
    );
  }

  const account = privateKeyToAccount(privateKey);
  const chain = network === "base-sepolia" ? baseSepolia : base;
  const transport = http(rpcUrl);

  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account, chain, transport });

  // Submit the transaction
  const txHash: Hash = await walletClient.sendTransaction({
    to: request.to as `0x${string}`,
    data: request.data as `0x${string}`,
    value: request.value ?? 0n,
    chain,
    account,
  });

  // Wait for the receipt
  const receipt: TransactionReceipt =
    await publicClient.waitForTransactionReceipt({ hash: txHash });

  // Estimate gas cost in USD
  // Base L2 gas is extremely cheap (~$0.001/tx).
  // effectiveGasPrice is in wei; convert to ETH then approximate USD.
  const gasUsed = receipt.gasUsed;
  const effectiveGasPrice = receipt.effectiveGasPrice ?? 0n;
  const gasCostWei = gasUsed * effectiveGasPrice;
  // Convert wei to ETH (1 ETH = 1e18 wei), then to USD at ~$3000/ETH estimate.
  // In production, fetch a live price feed. For Base L2, this is sub-cent.
  const ETH_PRICE_USD = 3000;
  const gasCostEth = Number(gasCostWei) / 1e18;
  const gasCostUsd = Math.round(gasCostEth * ETH_PRICE_USD * 1e6) / 1e6;

  return {
    txHash,
    gasUsed,
    gasCostUsd,
  };
}
