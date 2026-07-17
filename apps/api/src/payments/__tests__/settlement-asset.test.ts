import {
  BASE_MAINNET_USDC_ADDRESS,
  BASE_SEPOLIA_HAGGLE_TEST_USDC_ADDRESS,
  BASE_SEPOLIA_USDC_ADDRESS,
} from "@haggle/shared";
import { describe, expect, it } from "vitest";
import {
  resolveSettlementAssetAddress,
  resolveSettlementAssetProfileId,
} from "../settlement-asset.js";

describe("settlement asset profiles", () => {
  it("resolves staging hUSDC explicitly", () => {
    const env = {
      HAGGLE_SETTLEMENT_ASSET_PROFILE: "base-sepolia-husdc",
      HAGGLE_X402_USDC_ASSET_ADDRESS: BASE_SEPOLIA_HAGGLE_TEST_USDC_ADDRESS,
    };
    expect(resolveSettlementAssetProfileId(env)).toBe("base-sepolia-husdc");
    expect(resolveSettlementAssetAddress(env)).toBe(BASE_SEPOLIA_HAGGLE_TEST_USDC_ADDRESS);
  });

  it("keeps the legacy Base Sepolia fallback on official test USDC", () => {
    const env = { HAGGLE_X402_NETWORK: "base-sepolia" };
    expect(resolveSettlementAssetProfileId(env)).toBe("base-sepolia-usdc");
    expect(resolveSettlementAssetAddress(env)).toBe(BASE_SEPOLIA_USDC_ADDRESS);
  });

  it("keeps the production fallback on official Base USDC", () => {
    expect(resolveSettlementAssetProfileId({})).toBe("base-usdc");
    expect(resolveSettlementAssetAddress({})).toBe(BASE_MAINNET_USDC_ADDRESS);
  });
});
