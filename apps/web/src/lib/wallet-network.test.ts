import {
  BASE_MAINNET_USDC_ADDRESS,
  BASE_SEPOLIA_HAGGLE_TEST_USDC_ADDRESS,
  BASE_SEPOLIA_USDC_ADDRESS,
} from "@haggle/shared";
import { describe, expect, it } from "vitest";
import {
  assertConditionalSettlementTarget,
  BASE_SEPOLIA_CONDITIONAL_SETTLEMENT_ADDRESS,
  HAGGLE_WALLET_CHAIN_ID,
  HAGGLE_WALLET_NETWORK,
} from "./wallet-network";

const buyer = "0x0da9Ebd940a2B0bBB91d9A3813F72dfc2FA1A658";

const validTarget = {
  contractAddress: BASE_SEPOLIA_CONDITIONAL_SETTLEMENT_ADDRESS,
  network: HAGGLE_WALLET_NETWORK,
  assetAddress: BASE_SEPOLIA_HAGGLE_TEST_USDC_ADDRESS,
  requestAssetAddress: BASE_SEPOLIA_HAGGLE_TEST_USDC_ADDRESS,
  requestGrossAmount: "10000000",
  expectedGrossAmountMinor: 10_000_000,
  requestBuyerAddress: buyer,
  connectedBuyerAddress: buyer,
};

describe("assertConditionalSettlementTarget", () => {
  it("accepts the pinned Base Sepolia contracts", () => {
    expect(assertConditionalSettlementTarget(validTarget)).toEqual({
      contractAddress: BASE_SEPOLIA_CONDITIONAL_SETTLEMENT_ADDRESS,
      assetAddress: BASE_SEPOLIA_HAGGLE_TEST_USDC_ADDRESS,
    });
  });

  it("accepts the matching CAIP-2 network identifier", () => {
    expect(
      assertConditionalSettlementTarget({
        ...validTarget,
        network: `eip155:${HAGGLE_WALLET_CHAIN_ID}`,
      }),
    ).toBeDefined();
  });

  it("rejects a mainnet network response", () => {
    expect(() => assertConditionalSettlementTarget({ ...validTarget, network: "base" })).toThrow(
      "does not match",
    );
  });

  it("rejects official Base Sepolia USDC in the hUSDC staging profile", () => {
    expect(() =>
      assertConditionalSettlementTarget({
        ...validTarget,
        assetAddress: BASE_SEPOLIA_USDC_ADDRESS,
      }),
    ).toThrow("unexpected settlement asset contract");
  });

  it("rejects a signed tuple that uses another asset", () => {
    expect(() =>
      assertConditionalSettlementTarget({
        ...validTarget,
        requestAssetAddress: BASE_MAINNET_USDC_ADDRESS,
      }),
    ).toThrow("signed settlement uses an unexpected asset contract");
  });

  it("rejects a signed amount that differs from the displayed quote", () => {
    expect(() =>
      assertConditionalSettlementTarget({
        ...validTarget,
        requestGrossAmount: "9000000",
      }),
    ).toThrow("signed settlement amount does not match");
  });

  it("rejects an unexpected settlement contract", () => {
    expect(() =>
      assertConditionalSettlementTarget({
        ...validTarget,
        contractAddress: "0x1111111111111111111111111111111111111111",
      }),
    ).toThrow("unexpected settlement contract");
  });

  it("rejects a request signed for another buyer", () => {
    expect(() =>
      assertConditionalSettlementTarget({
        ...validTarget,
        requestBuyerAddress: "0x2222222222222222222222222222222222222222",
      }),
    ).toThrow("does not match the connected wallet");
  });
});
