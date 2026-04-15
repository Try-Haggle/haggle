/**
 * EIP-712 Settlement Signature Service
 *
 * Signs settlement data off-chain using the relayer private key.
 * The on-chain SettlementRouter contract verifies this signature
 * via ecrecover before executing the USDC transfer.
 *
 * Security notes:
 * - The relayer private key MUST be kept in a secure env var (HAGGLE_ROUTER_RELAYER_PRIVATE_KEY).
 * - Deadline prevents replay after expiry.
 * - signerNonce prevents replay of the same settlement.
 * - Domain separator (chainId + verifyingContract) prevents cross-chain replay.
 */

import {
  HAGGLE_SETTLEMENT_ROUTER_ABI,
  SETTLEMENT_EIP712_DOMAIN,
  SETTLEMENT_EIP712_TYPES,
} from "@haggle/contracts";
import type { PaymentIntent } from "@haggle/payment-core";
import type { X402SettlementSignatureContext } from "@haggle/payment-core/heavy/real-x402-adapter";
import {
  createPublicClient,
  http,
  isAddress,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";

// ── Helpers ──────────────────────────────────────────────────

function toBytes32(value: string): Hex {
  return keccak256(stringToHex(value));
}

// ── Config ───────────────────────────────────────────────────

/** Maximum fee BPS allowed — matches contract's MAX_FEE_BPS (10%). */
const MAX_FEE_BPS = 1000;

/** Maximum deadline offset: 1 hour from now. */
const MAX_DEADLINE_OFFSET_SECONDS = 3600;

export interface SettlementSignerConfig {
  /** Relayer private key (hex with 0x prefix). */
  relayerPrivateKey: Hex;
  /** Deployed SettlementRouter address. */
  routerAddress: Address;
  /** Chain ID: 8453 (Base) or 84532 (Base Sepolia). */
  chainId: number;
  /** USDC asset address on the target chain. */
  assetAddress: Address;
  /** Fee wallet address for Haggle. */
  feeWalletAddress: Address;
  /** Fee basis points (e.g. 150 = 1.5%). Max: 1000 (10%). */
  feeBps: number;
  /** Settlement deadline offset in seconds from now. Default: 900 (15 min). Max: 3600 (1 hour). */
  deadlineOffsetSeconds?: number;
  /** Base RPC URL for reading on-chain state. */
  rpcUrl?: string;
}

// ── Core ─────────────────────────────────────────────────────

/**
 * Build the Settlement struct values that will be signed and later
 * sent to executeSettlement on-chain. The field names and types
 * match SETTLEMENT_EIP712_TYPES exactly.
 */
export interface SettlementMessage {
  orderId: Hex;
  paymentIntentId: Hex;
  buyer: Address;
  seller: Address;
  sellerWallet: Address;
  feeWallet: Address;
  asset: Address;
  grossAmount: bigint;
  sellerAmount: bigint;
  feeAmount: bigint;
  deadline: bigint;
  signerNonce: bigint;
}

/**
 * Read the current signerNonce from the on-chain SettlementRouter contract.
 * This is a global sequential counter that increments only during signer rotation.
 * All settlements must use the current on-chain nonce to pass validation.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readOnChainSignerNonce(
  routerAddress: Address,
  publicClient: any,
): Promise<bigint> {
  const nonce = await publicClient.readContract({
    address: routerAddress,
    abi: HAGGLE_SETTLEMENT_ROUTER_ABI,
    functionName: "signerNonce",
  });
  return nonce as bigint;
}

function splitAmount(
  amountMinor: number,
  feeBps: number,
): { sellerAmount: number; feeAmount: number } {
  if (feeBps < 0 || feeBps > MAX_FEE_BPS) {
    throw new Error(`feeBps must be 0-${MAX_FEE_BPS}, got ${feeBps}`);
  }
  if (amountMinor <= 0) {
    throw new Error(`amount_minor must be positive, got ${amountMinor}`);
  }
  const feeAmount = Math.floor((amountMinor * feeBps) / 10_000);
  return {
    sellerAmount: amountMinor - feeAmount,
    feeAmount,
  };
}

function validateAddress(value: string, label: string): Address {
  if (!isAddress(value)) {
    throw new Error(`${label} is not a valid Ethereum address: ${value}`);
  }
  return value as Address;
}

/**
 * Build the EIP-712 message from a PaymentIntent and signer config.
 *
 * @param signerNonce - The current on-chain signerNonce from the SettlementRouter.
 *   This is a global sequential counter, NOT a per-intent value.
 */
export function buildSettlementMessage(
  intent: PaymentIntent,
  config: SettlementSignerConfig,
  signerNonce: bigint,
  overrides?: {
    buyerAddress?: Address;
    sellerAddress?: Address;
    sellerWalletAddress?: Address;
    deadline?: bigint;
  },
): SettlementMessage {
  const deadlineOffset = Math.min(
    config.deadlineOffsetSeconds ?? 900,
    MAX_DEADLINE_OFFSET_SECONDS,
  );
  const deadline =
    overrides?.deadline ??
    BigInt(Math.floor(Date.now() / 1000) + deadlineOffset);

  const { sellerAmount, feeAmount } = splitAmount(
    intent.amount.amount_minor,
    config.feeBps,
  );

  const buyer = overrides?.buyerAddress
    ? validateAddress(overrides.buyerAddress, "buyer")
    : validateAddress(intent.buyer_id, "buyer");
  const seller = overrides?.sellerAddress
    ? validateAddress(overrides.sellerAddress, "seller")
    : validateAddress(intent.seller_id, "seller");
  const sellerWallet = overrides?.sellerWalletAddress
    ? validateAddress(overrides.sellerWalletAddress, "sellerWallet")
    : seller;

  return {
    orderId: toBytes32(intent.order_id),
    paymentIntentId: toBytes32(intent.id),
    buyer,
    seller,
    sellerWallet,
    feeWallet: config.feeWalletAddress,
    asset: config.assetAddress,
    grossAmount: BigInt(intent.amount.amount_minor),
    sellerAmount: BigInt(sellerAmount),
    feeAmount: BigInt(feeAmount),
    deadline,
    signerNonce,
  };
}

/**
 * Sign a settlement using EIP-712 typed data.
 *
 * Returns the signature context needed by the RealX402Adapter to call
 * SettlementRouter.executeSettlement on-chain.
 */
export async function signSettlement(
  message: SettlementMessage,
  config: Pick<SettlementSignerConfig, "relayerPrivateKey" | "routerAddress" | "chainId">,
): Promise<X402SettlementSignatureContext> {
  const account = privateKeyToAccount(config.relayerPrivateKey);

  const signature = await account.signTypedData({
    domain: {
      ...SETTLEMENT_EIP712_DOMAIN,
      chainId: config.chainId,
      verifyingContract: config.routerAddress,
    },
    types: SETTLEMENT_EIP712_TYPES,
    primaryType: "Settlement",
    message,
  });

  return {
    signature,
    deadline: message.deadline,
    signer_nonce: message.signerNonce,
  };
}

// ── Factory ──────────────────────────────────────────────────

/**
 * Create the resolve_settlement_signature callback for X402AdapterConfig.
 *
 * Reads config from environment variables and returns a function that
 * signs any PaymentIntent into an X402SettlementSignatureContext.
 *
 * The signer reads the current signerNonce from the on-chain contract
 * before each signing to ensure the nonce matches the contract state.
 */
export function createSettlementSigner(overrides?: {
  buyerAddressResolver?: (intent: PaymentIntent) => Address;
  sellerAddressResolver?: (intent: PaymentIntent) => Address;
  /** Override for testing — inject a fixed nonce instead of reading from chain. */
  nonceOverride?: bigint;
  /** Override for testing — inject a mock public client. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  publicClientOverride?: any;
}): (intent: PaymentIntent) => Promise<X402SettlementSignatureContext> {
  const relayerPrivateKey = process.env.HAGGLE_ROUTER_RELAYER_PRIVATE_KEY as Hex | undefined;
  if (!relayerPrivateKey) {
    throw new Error(
      "HAGGLE_ROUTER_RELAYER_PRIVATE_KEY is required for settlement signing",
    );
  }

  const routerAddress = process.env.HAGGLE_SETTLEMENT_ROUTER_ADDRESS as Address | undefined;
  if (!routerAddress) {
    throw new Error(
      "HAGGLE_SETTLEMENT_ROUTER_ADDRESS is required for settlement signing",
    );
  }

  const network = process.env.HAGGLE_X402_NETWORK ?? "base";
  const chainId = network === "base-sepolia" ? 84532 : 8453;
  const chain = network === "base-sepolia" ? baseSepolia : base;

  const assetAddress = process.env.HAGGLE_X402_USDC_ASSET_ADDRESS as Address | undefined;
  if (!assetAddress) {
    throw new Error(
      "HAGGLE_X402_USDC_ASSET_ADDRESS is required for settlement signing",
    );
  }

  const feeWalletAddress = process.env.HAGGLE_X402_FEE_WALLET as Address | undefined;
  if (!feeWalletAddress) {
    throw new Error(
      "HAGGLE_X402_FEE_WALLET is required for settlement signing",
    );
  }

  const feeBps = Number(process.env.HAGGLE_X402_FEE_BPS ?? "150");
  if (feeBps < 0 || feeBps > MAX_FEE_BPS) {
    throw new Error(
      `HAGGLE_X402_FEE_BPS must be 0-${MAX_FEE_BPS}, got ${feeBps}`,
    );
  }

  const rpcUrl = process.env.HAGGLE_BASE_RPC_URL;

  // Create public client for reading on-chain nonce (unless overridden for tests)
  const publicClient = overrides?.publicClientOverride ?? (
    rpcUrl
      ? createPublicClient({ chain, transport: http(rpcUrl) })
      : null
  );

  const config: SettlementSignerConfig = {
    relayerPrivateKey,
    routerAddress,
    chainId,
    assetAddress,
    feeWalletAddress,
    feeBps,
    rpcUrl,
  };

  return async (intent: PaymentIntent): Promise<X402SettlementSignatureContext> => {
    // Read the current on-chain signerNonce
    let signerNonce: bigint;
    if (overrides?.nonceOverride !== undefined) {
      signerNonce = overrides.nonceOverride;
    } else if (publicClient) {
      signerNonce = await readOnChainSignerNonce(routerAddress, publicClient);
    } else {
      throw new Error(
        "HAGGLE_BASE_RPC_URL is required to read on-chain signerNonce (or provide nonceOverride for testing)",
      );
    }

    const buyerAddress = overrides?.buyerAddressResolver?.(intent);
    const sellerAddress = overrides?.sellerAddressResolver?.(intent);

    const message = buildSettlementMessage(intent, config, signerNonce, {
      buyerAddress,
      sellerAddress,
      sellerWalletAddress: sellerAddress,
    });

    return signSettlement(message, config);
  };
}
