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
  CONDITIONAL_SETTLEMENT_EIP712_DOMAIN,
  CONDITIONAL_SETTLEMENT_EIP712_TYPES,
  HAGGLE_CONDITIONAL_SETTLEMENT_ABI,
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
import {
  calculateSellerFeeSplit,
  MAX_HAGGLE_FEE_BPS,
  readHaggleFeeBpsFromEnv,
} from "./fee-policy.js";

// ── Helpers ──────────────────────────────────────────────────

function toBytes32(value: string): Hex {
  return keccak256(stringToHex(value));
}

function toPolicyBytes32(value: string): Hex {
  const normalized = value.startsWith("sha256:") ? `0x${value.slice("sha256:".length)}` : value;
  if (/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    return normalized as Hex;
  }
  return toBytes32(value);
}

// ── Config ───────────────────────────────────────────────────

/** Maximum fee BPS allowed — matches contract's MAX_FEE_BPS (10%). */
const MAX_FEE_BPS = MAX_HAGGLE_FEE_BPS;

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

export interface ConditionalSettlementSignerConfig {
  /** Relayer private key (hex with 0x prefix). */
  relayerPrivateKey: Hex;
  /** Deployed HaggleConditionalSettlement address. */
  conditionalSettlementAddress: Address;
  /** Chain ID: 8453 (Base) or 84532 (Base Sepolia). */
  chainId: number;
  /** USDC asset address on the target chain. */
  assetAddress: Address;
  /** Funding expiry offset in seconds from now. Default: 24 hours. Max: 30 days. */
  expiresOffsetSeconds?: number;
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

export interface ConditionalSettlementMessage {
  orderId: Hex;
  paymentIntentId: Hex;
  approvalPolicyHash: Hex;
  agreementHash: Hex;
  listingHash: Hex;
  grantNonce: Hex;
  buyer: Address;
  seller: Address;
  asset: Address;
  grossAmount: bigint;
  expiresAt: bigint;
  signerNonce: bigint;
}

export interface ConditionalSettlementSignatureContext {
  signature: Hex;
  expires_at: bigint;
  signer_nonce: bigint;
  message: ConditionalSettlementMessage;
}

export interface ConditionalReleaseMessage {
  settlementId: Hex;
  sellerWallet: Address;
  feeWallet: Address;
  sellerAmount: bigint;
  feeAmount: bigint;
  deadline: bigint;
  signerNonce: bigint;
}

export interface ConditionalReleaseSignatureContext {
  signature: Hex;
  deadline: bigint;
  signer_nonce: bigint;
  message: ConditionalReleaseMessage;
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

async function readConditionalSettlementSignerNonce(
  conditionalSettlementAddress: Address,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  publicClient: any,
): Promise<bigint> {
  const nonce = await publicClient.readContract({
    address: conditionalSettlementAddress,
    abi: HAGGLE_CONDITIONAL_SETTLEMENT_ABI,
    functionName: "signerNonce",
  });
  return nonce as bigint;
}

function splitAmount(
  amountMinor: number,
  feeBps: number,
): { sellerAmount: number; feeAmount: number } {
  const { sellerAmountMinor, feeAmountMinor } = calculateSellerFeeSplit(amountMinor, feeBps);
  return {
    sellerAmount: sellerAmountMinor,
    feeAmount: feeAmountMinor,
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

export function buildConditionalSettlementMessage(
  intent: PaymentIntent,
  config: ConditionalSettlementSignerConfig,
  signerNonce: bigint,
  params: {
    buyerAddress?: Address;
    sellerAddress?: Address;
    grantNonce: string;
    approvalPolicyHash?: string;
    agreementHash?: string;
    listingHash?: string;
    expiresAt?: bigint;
  },
): ConditionalSettlementMessage {
  const maxOffset = 30 * 24 * 60 * 60;
  const expiresOffset = Math.min(params.expiresAt ? 0 : config.expiresOffsetSeconds ?? 24 * 60 * 60, maxOffset);
  const expiresAt = params.expiresAt ?? BigInt(Math.floor(Date.now() / 1000) + expiresOffset);
  const approvalPolicyHash = params.approvalPolicyHash ?? intent.approval_policy_hash;
  const agreementHash = params.agreementHash ?? intent.agreement_hash;
  const listingHash = params.listingHash ?? intent.listing_hash;

  if (!approvalPolicyHash) {
    throw new Error("approval_policy_hash is required for conditional settlement signing");
  }
  if (!agreementHash) {
    throw new Error("agreement_hash is required for conditional settlement signing");
  }
  if (!listingHash) {
    throw new Error("listing_hash is required for conditional settlement signing");
  }
  if (!params.grantNonce) {
    throw new Error("grantNonce is required for conditional settlement signing");
  }
  if (intent.amount.amount_minor <= 0) {
    throw new Error(`amount_minor must be positive, got ${intent.amount.amount_minor}`);
  }

  const buyer = params.buyerAddress
    ? validateAddress(params.buyerAddress, "buyer")
    : validateAddress(intent.buyer_id, "buyer");
  const seller = params.sellerAddress
    ? validateAddress(params.sellerAddress, "seller")
    : validateAddress(intent.seller_id, "seller");

  return {
    orderId: toPolicyBytes32(intent.order_id),
    paymentIntentId: toPolicyBytes32(intent.id),
    approvalPolicyHash: toPolicyBytes32(approvalPolicyHash),
    agreementHash: toPolicyBytes32(agreementHash),
    listingHash: toPolicyBytes32(listingHash),
    grantNonce: toPolicyBytes32(params.grantNonce),
    buyer,
    seller,
    asset: config.assetAddress,
    grossAmount: BigInt(intent.amount.amount_minor),
    expiresAt,
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

export async function signConditionalSettlement(
  message: ConditionalSettlementMessage,
  config: Pick<ConditionalSettlementSignerConfig, "relayerPrivateKey" | "conditionalSettlementAddress" | "chainId">,
): Promise<ConditionalSettlementSignatureContext> {
  const account = privateKeyToAccount(config.relayerPrivateKey);

  const signature = await account.signTypedData({
    domain: {
      ...CONDITIONAL_SETTLEMENT_EIP712_DOMAIN,
      chainId: config.chainId,
      verifyingContract: config.conditionalSettlementAddress,
    },
    types: CONDITIONAL_SETTLEMENT_EIP712_TYPES,
    primaryType: "ConditionalSettlement",
    message,
  });

  return {
    signature,
    expires_at: message.expiresAt,
    signer_nonce: message.signerNonce,
    message,
  };
}

export async function signConditionalRelease(
  message: ConditionalReleaseMessage,
  config: Pick<ConditionalSettlementSignerConfig, "relayerPrivateKey" | "conditionalSettlementAddress" | "chainId">,
): Promise<ConditionalReleaseSignatureContext> {
  const account = privateKeyToAccount(config.relayerPrivateKey);

  const signature = await account.signTypedData({
    domain: {
      ...CONDITIONAL_SETTLEMENT_EIP712_DOMAIN,
      chainId: config.chainId,
      verifyingContract: config.conditionalSettlementAddress,
    },
    types: CONDITIONAL_SETTLEMENT_EIP712_TYPES,
    primaryType: "Release",
    message,
  });

  return {
    signature,
    deadline: message.deadline,
    signer_nonce: message.signerNonce,
    message,
  };
}

export function buildConditionalReleaseMessage(
  params: {
    settlementId: string;
    sellerWallet: Address;
    feeWallet: Address;
    grossAmountMinor: number;
    feeBps: number;
    deadline?: bigint;
  },
  signerNonce: bigint,
): ConditionalReleaseMessage {
  const { sellerAmountMinor, feeAmountMinor } = calculateSellerFeeSplit(
    params.grossAmountMinor,
    params.feeBps,
  );
  return {
    settlementId: toPolicyBytes32(params.settlementId),
    sellerWallet: validateAddress(params.sellerWallet, "sellerWallet"),
    feeWallet: validateAddress(params.feeWallet, "feeWallet"),
    sellerAmount: BigInt(sellerAmountMinor),
    feeAmount: BigInt(feeAmountMinor),
    deadline: params.deadline ?? BigInt(Math.floor(Date.now() / 1000) + 900),
    signerNonce,
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

  const feeBps = readHaggleFeeBpsFromEnv();

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

export function createConditionalSettlementSigner(overrides?: {
  buyerAddressResolver?: (intent: PaymentIntent) => Address;
  sellerAddressResolver?: (intent: PaymentIntent) => Address;
  /** Override for testing — inject a fixed nonce instead of reading from chain. */
  nonceOverride?: bigint;
  /** Override for testing — inject a mock public client. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  publicClientOverride?: any;
}): (
  intent: PaymentIntent,
  params: {
    grantNonce: string;
    approvalPolicyHash?: string;
    agreementHash?: string;
    listingHash?: string;
    expiresAt?: bigint;
  },
) => Promise<ConditionalSettlementSignatureContext> {
  const relayerPrivateKey = process.env.HAGGLE_ROUTER_RELAYER_PRIVATE_KEY as Hex | undefined;
  if (!relayerPrivateKey) {
    throw new Error(
      "HAGGLE_ROUTER_RELAYER_PRIVATE_KEY is required for conditional settlement signing",
    );
  }

  const conditionalSettlementAddress = process.env.HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS as Address | undefined;
  if (!conditionalSettlementAddress) {
    throw new Error(
      "HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS is required for conditional settlement signing",
    );
  }

  const network = process.env.HAGGLE_X402_NETWORK ?? "base";
  const chainId = network === "base-sepolia" ? 84532 : 8453;
  const chain = network === "base-sepolia" ? baseSepolia : base;

  const assetAddress = process.env.HAGGLE_X402_USDC_ASSET_ADDRESS as Address | undefined;
  if (!assetAddress) {
    throw new Error(
      "HAGGLE_X402_USDC_ASSET_ADDRESS is required for conditional settlement signing",
    );
  }

  const rpcUrl = process.env.HAGGLE_BASE_RPC_URL;
  const publicClient = overrides?.publicClientOverride ?? (
    rpcUrl
      ? createPublicClient({ chain, transport: http(rpcUrl) })
      : null
  );

  const config: ConditionalSettlementSignerConfig = {
    relayerPrivateKey,
    conditionalSettlementAddress,
    chainId,
    assetAddress,
    rpcUrl,
  };

  return async (
    intent: PaymentIntent,
    params: {
      grantNonce: string;
      approvalPolicyHash?: string;
      agreementHash?: string;
      listingHash?: string;
      expiresAt?: bigint;
    },
  ): Promise<ConditionalSettlementSignatureContext> => {
    let signerNonce: bigint;
    if (overrides?.nonceOverride !== undefined) {
      signerNonce = overrides.nonceOverride;
    } else if (publicClient) {
      signerNonce = await readConditionalSettlementSignerNonce(conditionalSettlementAddress, publicClient);
    } else {
      throw new Error(
        "HAGGLE_BASE_RPC_URL is required to read conditional settlement signerNonce (or provide nonceOverride for testing)",
      );
    }

    const buyerAddress = overrides?.buyerAddressResolver?.(intent);
    const sellerAddress = overrides?.sellerAddressResolver?.(intent);
    const message = buildConditionalSettlementMessage(intent, config, signerNonce, {
      ...params,
      buyerAddress,
      sellerAddress,
    });

    return signConditionalSettlement(message, config);
  };
}

export function createConditionalReleaseSigner(overrides?: {
  nonceOverride?: bigint;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  publicClientOverride?: any;
}): (params: {
  settlementId: string;
  sellerWallet: Address;
  feeWallet: Address;
  grossAmountMinor: number;
  feeBps: number;
  deadline?: bigint;
}) => Promise<ConditionalReleaseSignatureContext> {
  const relayerPrivateKey = process.env.HAGGLE_ROUTER_RELAYER_PRIVATE_KEY as Hex | undefined;
  if (!relayerPrivateKey) {
    throw new Error(
      "HAGGLE_ROUTER_RELAYER_PRIVATE_KEY is required for conditional release signing",
    );
  }

  const conditionalSettlementAddress = process.env.HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS as Address | undefined;
  if (!conditionalSettlementAddress) {
    throw new Error(
      "HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS is required for conditional release signing",
    );
  }

  const network = process.env.HAGGLE_X402_NETWORK ?? "base";
  const chainId = network === "base-sepolia" ? 84532 : 8453;
  const chain = network === "base-sepolia" ? baseSepolia : base;
  const rpcUrl = process.env.HAGGLE_BASE_RPC_URL;
  const publicClient = overrides?.publicClientOverride ?? (
    rpcUrl
      ? createPublicClient({ chain, transport: http(rpcUrl) })
      : null
  );

  const config: ConditionalSettlementSignerConfig = {
    relayerPrivateKey,
    conditionalSettlementAddress,
    chainId,
    assetAddress: "0x0000000000000000000000000000000000000000",
    rpcUrl,
  };

  return async (params) => {
    let signerNonce: bigint;
    if (overrides?.nonceOverride !== undefined) {
      signerNonce = overrides.nonceOverride;
    } else if (publicClient) {
      signerNonce = await readConditionalSettlementSignerNonce(conditionalSettlementAddress, publicClient);
    } else {
      throw new Error(
        "HAGGLE_BASE_RPC_URL is required to read conditional settlement signerNonce (or provide nonceOverride for testing)",
      );
    }

    const message = buildConditionalReleaseMessage(params, signerNonce);
    return signConditionalRelease(message, config);
  };
}
