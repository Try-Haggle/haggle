import {
  getSettlementAssetProfile,
  isSettlementAssetProfileId,
  type SettlementAssetProfileId,
} from "@haggle/shared";
import { type Address, getAddress, isAddress } from "viem";
import { base, baseSepolia } from "wagmi/chains";

export type HaggleWalletNetwork = "base" | "base-sepolia";

export const BASE_SEPOLIA_CONDITIONAL_SETTLEMENT_ADDRESS =
  "0x47228b3B82E3baEF46722aC9475eBfd49Da22a7B" as const;
const configuredAssetProfile = process.env.NEXT_PUBLIC_HAGGLE_SETTLEMENT_ASSET_PROFILE;
const defaultAssetProfile: SettlementAssetProfileId =
  process.env.NEXT_PUBLIC_HAGGLE_WALLET_NETWORK === "base" ? "base-usdc" : "base-sepolia-husdc";

// hUSDC is the fail-closed default. Mainnet requires the explicit base-usdc profile.
export const HAGGLE_SETTLEMENT_ASSET_PROFILE: SettlementAssetProfileId =
  configuredAssetProfile && isSettlementAssetProfileId(configuredAssetProfile)
    ? configuredAssetProfile
    : defaultAssetProfile;
export const HAGGLE_SETTLEMENT_ASSET = getSettlementAssetProfile(HAGGLE_SETTLEMENT_ASSET_PROFILE);
export const HAGGLE_WALLET_NETWORK: HaggleWalletNetwork =
  HAGGLE_SETTLEMENT_ASSET.chainId === base.id ? "base" : "base-sepolia";
export const HAGGLE_WALLET_CHAIN = HAGGLE_WALLET_NETWORK === "base" ? base : baseSepolia;
export const HAGGLE_WALLET_CHAIN_ID = HAGGLE_WALLET_CHAIN.id;
export const HAGGLE_SETTLEMENT_ASSET_ADDRESS = HAGGLE_SETTLEMENT_ASSET.address;

const configuredConditionalSettlementAddress =
  process.env.NEXT_PUBLIC_CONDITIONAL_SETTLEMENT_ADDRESS;

export const HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS: Address | null =
  HAGGLE_WALLET_NETWORK === "base-sepolia"
    ? BASE_SEPOLIA_CONDITIONAL_SETTLEMENT_ADDRESS
    : configuredConditionalSettlementAddress && isAddress(configuredConditionalSettlementAddress)
      ? getAddress(configuredConditionalSettlementAddress)
      : null;

interface ConditionalSettlementTarget {
  contractAddress: string;
  network: string;
  assetAddress: string;
  requestAssetAddress: string;
  requestGrossAmount: string;
  expectedGrossAmountMinor: number;
  requestBuyerAddress: string;
  connectedBuyerAddress: string;
}

export function assertConditionalSettlementTarget({
  contractAddress,
  network,
  assetAddress,
  requestAssetAddress,
  requestGrossAmount,
  expectedGrossAmountMinor,
  requestBuyerAddress,
  connectedBuyerAddress,
}: ConditionalSettlementTarget): { contractAddress: Address; assetAddress: Address } {
  const acceptedNetworks = new Set([HAGGLE_WALLET_NETWORK, `eip155:${HAGGLE_WALLET_CHAIN_ID}`]);
  if (!acceptedNetworks.has(network)) {
    throw new Error(
      `Payment request network ${network} does not match ${HAGGLE_WALLET_CHAIN.name}.`,
    );
  }
  if (!HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS) {
    throw new Error("The conditional settlement contract is not configured for this network.");
  }
  if (!isAddress(contractAddress)) {
    throw new Error("The conditional settlement contract address is invalid.");
  }
  if (getAddress(contractAddress) !== getAddress(HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS)) {
    throw new Error("The payment request returned an unexpected settlement contract.");
  }
  if (
    !isAddress(assetAddress) ||
    getAddress(assetAddress) !== getAddress(HAGGLE_SETTLEMENT_ASSET_ADDRESS)
  ) {
    throw new Error("The payment request returned an unexpected settlement asset contract.");
  }
  if (
    !isAddress(requestAssetAddress) ||
    getAddress(requestAssetAddress) !== getAddress(HAGGLE_SETTLEMENT_ASSET_ADDRESS)
  ) {
    throw new Error("The signed settlement uses an unexpected asset contract.");
  }
  if (!Number.isSafeInteger(expectedGrossAmountMinor) || expectedGrossAmountMinor <= 0) {
    throw new Error("The displayed settlement amount is invalid.");
  }
  try {
    if (BigInt(requestGrossAmount) !== BigInt(expectedGrossAmountMinor)) {
      throw new Error("The signed settlement amount does not match the displayed quote.");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("does not match")) throw error;
    throw new Error("The signed settlement amount is invalid.");
  }
  if (
    !isAddress(requestBuyerAddress) ||
    !isAddress(connectedBuyerAddress) ||
    getAddress(requestBuyerAddress) !== getAddress(connectedBuyerAddress)
  ) {
    throw new Error("The payment request buyer does not match the connected wallet.");
  }

  return {
    contractAddress: getAddress(contractAddress),
    assetAddress: getAddress(assetAddress),
  };
}
