import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateEnv } from "../config/validate-env.js";

const STAGING_ENV = {
  NODE_ENV: "development",
  DATABASE_URL: "postgresql://localhost/haggle_test",
  HAGGLE_ENV: "staging",
  HAGGLE_SETTLEMENT_ASSET_PROFILE: "base-sepolia-husdc",
  HAGGLE_X402_NETWORK: "base-sepolia",
  HAGGLE_X402_WALLET_NETWORK: "eip155:84532",
  BASE_CHAIN_ID: "84532",
  HAGGLE_X402_USDC_ASSET_ADDRESS: "0x579807433033757E895437EEfa9Ae25F387c3fCa",
  HAGGLE_SETTLEMENT_ROUTER_ADDRESS: "0x5652321f6d5d0337f7BD754Ba66000616dA8F228",
  HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS: "0x47228b3B82E3baEF46722aC9475eBfd49Da22a7B",
  HAGGLE_DISPUTE_REGISTRY_ADDRESS: "0x71311522f40981C62C7A930DbaC4e3997adFf8fc",
  HAGGLE_BASE_RPC_URL: "https://sepolia.base.org",
} as const;

const originalEnv = { ...process.env };

describe("validateEnv staging payment network", () => {
  beforeEach(() => {
    Object.assign(process.env, STAGING_ENV);
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  it("accepts the pinned Base Sepolia test-asset configuration", () => {
    expect(() => validateEnv()).not.toThrow();
  });

  it("rejects Base mainnet in staging", () => {
    process.env.HAGGLE_X402_NETWORK = "base";
    process.env.HAGGLE_X402_WALLET_NETWORK = "eip155:8453";
    process.env.BASE_CHAIN_ID = "8453";

    expect(() => validateEnv()).toThrow(/staging must use base-sepolia/);
    expect(() => validateEnv()).toThrow(/staging must use eip155:84532/);
    expect(() => validateEnv()).toThrow(/staging must use 84532/);
  });

  it("rejects official USDC and unknown settlement contracts in hUSDC staging", () => {
    process.env.HAGGLE_X402_USDC_ASSET_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    process.env.HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS =
      "0x1111111111111111111111111111111111111111";

    expect(() => validateEnv()).toThrow(/HAGGLE_X402_USDC_ASSET_ADDRESS/);
    expect(() => validateEnv()).toThrow(/HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS/);
  });

  it("requires an HTTPS Base RPC URL in staging", () => {
    process.env.HAGGLE_BASE_RPC_URL = "http://localhost:8545";
    expect(() => validateEnv()).toThrow(/RPC URL must use https/);
  });

  it("requires live EasyPost credentials when staging physical shipping is enabled", () => {
    process.env.HAGGLE_ENABLE_STAGING_LIVE_SHIPPING = "true";
    delete process.env.EASYPOST_LIVE_API_KEY;
    delete process.env.EASYPOST_LIVE_WEBHOOK_SECRET;
    delete process.env.EASYPOST_API_KEY;
    delete process.env.EASYPOST_WEBHOOK_SECRET;

    expect(() => validateEnv()).toThrow(/EASYPOST_LIVE_API_KEY/);
    expect(() => validateEnv()).toThrow(/EASYPOST_LIVE_WEBHOOK_SECRET/);

    process.env.EASYPOST_LIVE_API_KEY = "EZAK_live_key";
    process.env.EASYPOST_LIVE_WEBHOOK_SECRET = "whsec_live";
    expect(() => validateEnv()).not.toThrow();
  });

  it("accepts only the official Base USDC profile in production", () => {
    Object.assign(process.env, {
      HAGGLE_ENV: "production",
      HAGGLE_SETTLEMENT_ASSET_PROFILE: "base-usdc",
      HAGGLE_X402_NETWORK: "base",
      HAGGLE_X402_WALLET_NETWORK: "eip155:8453",
      BASE_CHAIN_ID: "8453",
      HAGGLE_X402_USDC_ASSET_ADDRESS: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    });
    expect(() => validateEnv()).not.toThrow();

    process.env.HAGGLE_X402_USDC_ASSET_ADDRESS = "0x579807433033757E895437EEfa9Ae25F387c3fCa";
    expect(() => validateEnv()).toThrow(/production must use/);
  });
});
