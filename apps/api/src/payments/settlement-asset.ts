import {
  getSettlementAssetProfile,
  isSettlementAssetProfileId,
  type SettlementAssetProfileId,
} from "@haggle/shared";
import type { Address } from "viem";

const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export function resolveSettlementAssetProfileId(
  env: NodeJS.ProcessEnv = process.env,
): SettlementAssetProfileId {
  const configured = env.HAGGLE_SETTLEMENT_ASSET_PROFILE?.trim();
  if (configured && isSettlementAssetProfileId(configured)) return configured;
  return env.HAGGLE_X402_NETWORK === "base-sepolia" ? "base-sepolia-usdc" : "base-usdc";
}

export function resolveSettlementAssetAddress(env: NodeJS.ProcessEnv = process.env): Address {
  const configured = env.HAGGLE_X402_USDC_ASSET_ADDRESS?.trim();
  if (configured && EVM_ADDRESS_PATTERN.test(configured)) return configured as Address;
  return getSettlementAssetProfile(resolveSettlementAssetProfileId(env)).address;
}
