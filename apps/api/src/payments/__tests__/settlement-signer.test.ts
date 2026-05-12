/**
 * Tests for the EIP-712 Settlement Signature Service.
 *
 * These tests use real viem crypto operations (not mocks) to verify that
 * signatures are valid and recoverable.
 */
import { vi, describe, it, expect, afterEach } from "vitest";

// Unmock viem — we need real crypto for signature verification.
vi.unmock("viem");
vi.unmock("viem/accounts");
vi.unmock("viem/chains");

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { recoverTypedDataAddress, type Address } from "viem";
import {
  CONDITIONAL_SETTLEMENT_EIP712_DOMAIN,
  CONDITIONAL_SETTLEMENT_EIP712_TYPES,
  SETTLEMENT_EIP712_DOMAIN,
  SETTLEMENT_EIP712_TYPES,
} from "@haggle/contracts";
import type { PaymentIntent } from "@haggle/payment-core";
import {
  buildSettlementMessage,
  buildConditionalSettlementMessage,
  buildConditionalReleaseMessage,
  signSettlement,
  signConditionalSettlement,
  signConditionalRelease,
  createSettlementSigner,
  createConditionalSettlementSigner,
  type ConditionalSettlementSignerConfig,
  type SettlementSignerConfig,
} from "../settlement-signer.js";

// ── Test fixtures ────────────────────────────────────────────

const TEST_PRIVATE_KEY = generatePrivateKey();
const TEST_ACCOUNT = privateKeyToAccount(TEST_PRIVATE_KEY);
const TEST_ROUTER_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678" as Address;
const TEST_CONDITIONAL_SETTLEMENT_ADDRESS = "0x9876543210abcdef9876543210abcdef98765432" as Address;
const TEST_ASSET_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address;
const TEST_FEE_WALLET = "0xfeefeefeefeefeefeefeefeefeefeefeefeefee0" as Address;
const TEST_CHAIN_ID = 84532;
const TEST_SIGNER_NONCE = 0n; // On-chain nonce starts at 0

function makeTestIntent(overrides?: Partial<PaymentIntent>): PaymentIntent {
  return {
    id: "pi_test_001",
    order_id: "order_test_001",
    seller_id: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    buyer_id: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    selected_rail: "x402",
    allowed_rails: ["x402"],
    amount: {
      currency: "USDC",
      amount_minor: 100_000_000, // 100 USDC (6 decimals)
    },
    status: "AUTHORIZED",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeConditionalTestIntent(overrides?: Partial<PaymentIntent>): PaymentIntent {
  return makeTestIntent({
    approval_policy_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    agreement_hash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    listing_hash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    ...overrides,
  });
}

function makeTestConfig(overrides?: Partial<SettlementSignerConfig>): SettlementSignerConfig {
  return {
    relayerPrivateKey: TEST_PRIVATE_KEY,
    routerAddress: TEST_ROUTER_ADDRESS,
    chainId: TEST_CHAIN_ID,
    assetAddress: TEST_ASSET_ADDRESS,
    feeWalletAddress: TEST_FEE_WALLET,
    feeBps: 150,
    ...overrides,
  };
}

function makeConditionalTestConfig(
  overrides?: Partial<ConditionalSettlementSignerConfig>,
): ConditionalSettlementSignerConfig {
  return {
    relayerPrivateKey: TEST_PRIVATE_KEY,
    conditionalSettlementAddress: TEST_CONDITIONAL_SETTLEMENT_ADDRESS,
    chainId: TEST_CHAIN_ID,
    assetAddress: TEST_ASSET_ADDRESS,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────

describe("settlement-signer", () => {
  describe("buildSettlementMessage", () => {
    it("produces a message with all required fields", () => {
      const intent = makeTestIntent();
      const config = makeTestConfig();
      const message = buildSettlementMessage(intent, config, TEST_SIGNER_NONCE);

      expect(message.orderId).toMatch(/^0x[0-9a-f]{64}$/);
      expect(message.paymentIntentId).toMatch(/^0x[0-9a-f]{64}$/);
      expect(message.asset).toBe(TEST_ASSET_ADDRESS);
      expect(message.feeWallet).toBe(TEST_FEE_WALLET);
      expect(message.grossAmount).toBe(100_000_000n);
      expect(message.feeAmount).toBe(1_500_000n);
      expect(message.sellerAmount).toBe(98_500_000n);
      expect(message.deadline).toBeGreaterThan(0n);
      expect(message.signerNonce).toBe(TEST_SIGNER_NONCE);
    });

    it("uses the provided on-chain nonce (not a derived value)", () => {
      const intent = makeTestIntent();
      const config = makeTestConfig();
      const nonce = 42n;
      const message = buildSettlementMessage(intent, config, nonce);
      expect(message.signerNonce).toBe(42n);
    });

    it("respects deadline overrides", () => {
      const intent = makeTestIntent();
      const config = makeTestConfig();
      const message = buildSettlementMessage(intent, config, TEST_SIGNER_NONCE, {
        deadline: 999n,
      });
      expect(message.deadline).toBe(999n);
    });

    it("caps deadline offset to MAX_DEADLINE_OFFSET_SECONDS (1 hour)", () => {
      const intent = makeTestIntent();
      const config = makeTestConfig({ deadlineOffsetSeconds: 99999 });
      const message = buildSettlementMessage(intent, config, TEST_SIGNER_NONCE);
      const now = BigInt(Math.floor(Date.now() / 1000));
      // Deadline should be at most 1 hour from now (with a small margin)
      expect(message.deadline).toBeLessThanOrEqual(now + 3600n + 5n);
    });

    it("respects buyer/seller address overrides", () => {
      const intent = makeTestIntent();
      const config = makeTestConfig();
      const buyer = "0x1111111111111111111111111111111111111111" as Address;
      const seller = "0x2222222222222222222222222222222222222222" as Address;

      const message = buildSettlementMessage(intent, config, TEST_SIGNER_NONCE, {
        buyerAddress: buyer,
        sellerAddress: seller,
        sellerWalletAddress: seller,
      });

      expect(message.buyer).toBe(buyer);
      expect(message.seller).toBe(seller);
      expect(message.sellerWallet).toBe(seller);
    });

    it("correctly splits fee amounts and preserves the gross invariant", () => {
      const intent = makeTestIntent({
        amount: { currency: "USDC", amount_minor: 1_000_000 },
      });
      const config = makeTestConfig({ feeBps: 150 });
      const message = buildSettlementMessage(intent, config, TEST_SIGNER_NONCE);

      expect(message.feeAmount).toBe(15_000n);
      expect(message.sellerAmount).toBe(985_000n);
      expect(message.grossAmount).toBe(1_000_000n);
      expect(message.sellerAmount + message.feeAmount).toBe(message.grossAmount);
    });

    it("throws on invalid buyer address (not an Ethereum address)", () => {
      const intent = makeTestIntent({ buyer_id: "user_uuid_not_address" });
      const config = makeTestConfig();
      expect(() => buildSettlementMessage(intent, config, TEST_SIGNER_NONCE)).toThrow(
        "buyer is not a valid Ethereum address",
      );
    });

    it("throws on invalid seller address", () => {
      const intent = makeTestIntent({ seller_id: "user_uuid_not_address" });
      const config = makeTestConfig();
      expect(() => buildSettlementMessage(intent, config, TEST_SIGNER_NONCE)).toThrow(
        "seller is not a valid Ethereum address",
      );
    });

    it("throws on zero amount", () => {
      const intent = makeTestIntent({ amount: { currency: "USDC", amount_minor: 0 } });
      const config = makeTestConfig();
      expect(() => buildSettlementMessage(intent, config, TEST_SIGNER_NONCE)).toThrow(
        "amount_minor must be positive",
      );
    });

    it("throws on feeBps > 1000", () => {
      const intent = makeTestIntent();
      const config = makeTestConfig({ feeBps: 1500 });
      expect(() => buildSettlementMessage(intent, config, TEST_SIGNER_NONCE)).toThrow(
        "feeBps must be 0-1000",
      );
    });

    it("accepts feeBps = 0 (no fee)", () => {
      const intent = makeTestIntent();
      const config = makeTestConfig({ feeBps: 0 });
      const message = buildSettlementMessage(intent, config, TEST_SIGNER_NONCE);
      expect(message.feeAmount).toBe(0n);
      expect(message.sellerAmount).toBe(message.grossAmount);
    });
  });

  describe("signSettlement", () => {
    it("produces a valid EIP-712 signature recoverable to the signer", async () => {
      const intent = makeTestIntent();
      const config = makeTestConfig();
      const message = buildSettlementMessage(intent, config, TEST_SIGNER_NONCE);

      const result = await signSettlement(message, config);

      expect(result.signature).toMatch(/^0x[0-9a-f]+$/);
      expect(result.deadline).toBe(message.deadline);
      expect(result.signer_nonce).toBe(message.signerNonce);

      const recovered = await recoverTypedDataAddress({
        domain: {
          ...SETTLEMENT_EIP712_DOMAIN,
          chainId: TEST_CHAIN_ID,
          verifyingContract: TEST_ROUTER_ADDRESS,
        },
        types: SETTLEMENT_EIP712_TYPES,
        primaryType: "Settlement",
        message,
        signature: result.signature,
      });

      expect(recovered.toLowerCase()).toBe(TEST_ACCOUNT.address.toLowerCase());
    });

    it("produces different signatures for different intents", async () => {
      const config = makeTestConfig();
      const message1 = buildSettlementMessage(makeTestIntent({ id: "pi_a" }), config, TEST_SIGNER_NONCE);
      const message2 = buildSettlementMessage(makeTestIntent({ id: "pi_b" }), config, TEST_SIGNER_NONCE);

      const sig1 = await signSettlement(message1, config);
      const sig2 = await signSettlement(message2, config);

      expect(sig1.signature).not.toBe(sig2.signature);
    });

    it("produces different signatures for different chain IDs (cross-chain replay protection)", async () => {
      const intent = makeTestIntent();
      const baseConfig = makeTestConfig();
      const message = buildSettlementMessage(intent, baseConfig, TEST_SIGNER_NONCE);

      const sigBase = await signSettlement(message, { ...baseConfig, chainId: 8453 });
      const sigSepolia = await signSettlement(message, { ...baseConfig, chainId: 84532 });

      expect(sigBase.signature).not.toBe(sigSepolia.signature);
    });

    it("produces different signatures for different router addresses", async () => {
      const intent = makeTestIntent();
      const config = makeTestConfig();
      const message = buildSettlementMessage(intent, config, TEST_SIGNER_NONCE);

      const sig1 = await signSettlement(message, config);
      const sig2 = await signSettlement(message, {
        ...config,
        routerAddress: "0x9999999999999999999999999999999999999999" as Address,
      });

      expect(sig1.signature).not.toBe(sig2.signature);
    });

    it("nonce=0 produces a valid signature (initial contract state)", async () => {
      const intent = makeTestIntent();
      const config = makeTestConfig();
      const message = buildSettlementMessage(intent, config, 0n);

      const result = await signSettlement(message, config);
      expect(result.signer_nonce).toBe(0n);

      const recovered = await recoverTypedDataAddress({
        domain: {
          ...SETTLEMENT_EIP712_DOMAIN,
          chainId: TEST_CHAIN_ID,
          verifyingContract: TEST_ROUTER_ADDRESS,
        },
        types: SETTLEMENT_EIP712_TYPES,
        primaryType: "Settlement",
        message,
        signature: result.signature,
      });
      expect(recovered.toLowerCase()).toBe(TEST_ACCOUNT.address.toLowerCase());
    });
  });

  describe("conditional settlement signing", () => {
    it("builds a policy-bound conditional settlement message", () => {
      const message = buildConditionalSettlementMessage(
        makeConditionalTestIntent(),
        makeConditionalTestConfig(),
        TEST_SIGNER_NONCE,
        { grantNonce: "grant_nonce_001", expiresAt: 1_900_000_000n },
      );

      expect(message.orderId).toMatch(/^0x[0-9a-f]{64}$/);
      expect(message.paymentIntentId).toMatch(/^0x[0-9a-f]{64}$/);
      expect(message.approvalPolicyHash).toBe(
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      );
      expect(message.agreementHash).toBe(
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      );
      expect(message.listingHash).toBe(
        "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      );
      expect(message.grossAmount).toBe(100_000_000n);
      expect(message.expiresAt).toBe(1_900_000_000n);
      expect(message.signerNonce).toBe(TEST_SIGNER_NONCE);
    });

    it("produces a recoverable ConditionalSettlement EIP-712 signature", async () => {
      const intent = makeConditionalTestIntent();
      const config = makeConditionalTestConfig();
      const message = buildConditionalSettlementMessage(intent, config, TEST_SIGNER_NONCE, {
        grantNonce: "grant_nonce_001",
        expiresAt: 1_900_000_000n,
      });

      const result = await signConditionalSettlement(message, config);

      const recovered = await recoverTypedDataAddress({
        domain: {
          ...CONDITIONAL_SETTLEMENT_EIP712_DOMAIN,
          chainId: TEST_CHAIN_ID,
          verifyingContract: TEST_CONDITIONAL_SETTLEMENT_ADDRESS,
        },
        types: CONDITIONAL_SETTLEMENT_EIP712_TYPES,
        primaryType: "ConditionalSettlement",
        message,
        signature: result.signature,
      });

      expect(result.expires_at).toBe(message.expiresAt);
      expect(result.signer_nonce).toBe(message.signerNonce);
      expect(recovered.toLowerCase()).toBe(TEST_ACCOUNT.address.toLowerCase());
    });

    it("throws when policy hash fields are missing", () => {
      const intent = makeTestIntent();
      expect(() =>
        buildConditionalSettlementMessage(
          intent,
          makeConditionalTestConfig(),
          TEST_SIGNER_NONCE,
          { grantNonce: "grant_nonce_001" },
        ),
      ).toThrow("approval_policy_hash is required");
    });

    it("produces a recoverable Release EIP-712 signature", async () => {
      const config = makeConditionalTestConfig();
      const message = buildConditionalReleaseMessage(
        {
          settlementId: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
          sellerWallet: "0x2222222222222222222222222222222222222222" as Address,
          feeWallet: TEST_FEE_WALLET,
          grossAmountMinor: 100_000_000,
          feeBps: 150,
          deadline: 1_900_000_000n,
        },
        TEST_SIGNER_NONCE,
      );

      const result = await signConditionalRelease(message, config);
      const recovered = await recoverTypedDataAddress({
        domain: {
          ...CONDITIONAL_SETTLEMENT_EIP712_DOMAIN,
          chainId: TEST_CHAIN_ID,
          verifyingContract: TEST_CONDITIONAL_SETTLEMENT_ADDRESS,
        },
        types: CONDITIONAL_SETTLEMENT_EIP712_TYPES,
        primaryType: "Release",
        message,
        signature: result.signature,
      });

      expect(result.deadline).toBe(message.deadline);
      expect(result.signer_nonce).toBe(message.signerNonce);
      expect(message.feeAmount).toBe(1_500_000n);
      expect(message.sellerAmount).toBe(98_500_000n);
      expect(message.sellerAmount + message.feeAmount).toBe(100_000_000n);
      expect(recovered.toLowerCase()).toBe(TEST_ACCOUNT.address.toLowerCase());
    });
  });

  describe("createSettlementSigner", () => {
    const savedEnv: Record<string, string | undefined> = {};

    function setEnv(vars: Record<string, string>) {
      for (const [key, value] of Object.entries(vars)) {
        savedEnv[key] = process.env[key];
        process.env[key] = value;
      }
    }

    function setAllEnv() {
      setEnv({
        HAGGLE_ROUTER_RELAYER_PRIVATE_KEY: TEST_PRIVATE_KEY,
        HAGGLE_SETTLEMENT_ROUTER_ADDRESS: TEST_ROUTER_ADDRESS,
        HAGGLE_X402_USDC_ASSET_ADDRESS: TEST_ASSET_ADDRESS,
        HAGGLE_X402_FEE_WALLET: TEST_FEE_WALLET,
        HAGGLE_X402_NETWORK: "base-sepolia",
        HAGGLE_X402_FEE_BPS: "150",
      });
    }

    afterEach(() => {
      for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      for (const key of Object.keys(savedEnv)) {
        delete savedEnv[key];
      }
    });

    it("throws when HAGGLE_ROUTER_RELAYER_PRIVATE_KEY is missing", () => {
      setAllEnv();
      delete process.env.HAGGLE_ROUTER_RELAYER_PRIVATE_KEY;
      expect(() => createSettlementSigner()).toThrow("HAGGLE_ROUTER_RELAYER_PRIVATE_KEY is required");
    });

    it("throws when HAGGLE_SETTLEMENT_ROUTER_ADDRESS is missing", () => {
      setAllEnv();
      delete process.env.HAGGLE_SETTLEMENT_ROUTER_ADDRESS;
      expect(() => createSettlementSigner()).toThrow("HAGGLE_SETTLEMENT_ROUTER_ADDRESS is required");
    });

    it("throws when HAGGLE_X402_USDC_ASSET_ADDRESS is missing", () => {
      setAllEnv();
      delete process.env.HAGGLE_X402_USDC_ASSET_ADDRESS;
      expect(() => createSettlementSigner()).toThrow("HAGGLE_X402_USDC_ASSET_ADDRESS is required");
    });

    it("throws when HAGGLE_X402_FEE_WALLET is missing", () => {
      setAllEnv();
      delete process.env.HAGGLE_X402_FEE_WALLET;
      expect(() => createSettlementSigner()).toThrow("HAGGLE_X402_FEE_WALLET is required");
    });

    it("throws when feeBps exceeds MAX_FEE_BPS", () => {
      setAllEnv();
      process.env.HAGGLE_X402_FEE_BPS = "2000";
      expect(() => createSettlementSigner()).toThrow("HAGGLE_X402_FEE_BPS must be 0-1000");
    });

    it("throws when feeBps is not an integer basis-point value", () => {
      setAllEnv();
      process.env.HAGGLE_X402_FEE_BPS = "1.5";
      expect(() => createSettlementSigner()).toThrow("HAGGLE_X402_FEE_BPS must be 0-1000");
    });

    it("returns a working signer with nonceOverride (no RPC needed)", async () => {
      setAllEnv();
      const signer = createSettlementSigner({ nonceOverride: 0n });
      const intent = makeTestIntent();
      const result = await signer(intent);

      expect(result.signature).toMatch(/^0x[0-9a-f]+$/);
      expect(result.deadline).toBeGreaterThan(0n);
      expect(result.signer_nonce).toBe(0n);
    });

    it("throws when no RPC URL and no nonceOverride", async () => {
      setAllEnv();
      delete process.env.HAGGLE_BASE_RPC_URL;
      const signer = createSettlementSigner();
      const intent = makeTestIntent();
      await expect(signer(intent)).rejects.toThrow("HAGGLE_BASE_RPC_URL is required");
    });

    it("uses address resolvers when provided", async () => {
      setAllEnv();
      const buyerAddr = "0x1111111111111111111111111111111111111111" as Address;
      const sellerAddr = "0x2222222222222222222222222222222222222222" as Address;

      const signer = createSettlementSigner({
        buyerAddressResolver: () => buyerAddr,
        sellerAddressResolver: () => sellerAddr,
        nonceOverride: 0n,
      });

      const intent = makeTestIntent();
      const result = await signer(intent);

      expect(result.signature).toMatch(/^0x[0-9a-f]+$/);
    });
  });

  describe("createConditionalSettlementSigner", () => {
    const savedEnv: Record<string, string | undefined> = {};

    function setEnv(vars: Record<string, string>) {
      for (const [key, value] of Object.entries(vars)) {
        savedEnv[key] = process.env[key];
        process.env[key] = value;
      }
    }

    function setAllEnv() {
      setEnv({
        HAGGLE_ROUTER_RELAYER_PRIVATE_KEY: TEST_PRIVATE_KEY,
        HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS: TEST_CONDITIONAL_SETTLEMENT_ADDRESS,
        HAGGLE_X402_USDC_ASSET_ADDRESS: TEST_ASSET_ADDRESS,
        HAGGLE_X402_NETWORK: "base-sepolia",
      });
    }

    afterEach(() => {
      for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      for (const key of Object.keys(savedEnv)) {
        delete savedEnv[key];
      }
    });

    it("throws when HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS is missing", () => {
      setAllEnv();
      delete process.env.HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS;
      expect(() => createConditionalSettlementSigner()).toThrow(
        "HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS is required",
      );
    });

    it("returns a working signer with nonceOverride", async () => {
      setAllEnv();
      const signer = createConditionalSettlementSigner({ nonceOverride: 0n });
      const result = await signer(makeConditionalTestIntent(), {
        grantNonce: "grant_nonce_001",
        expiresAt: 1_900_000_000n,
      });

      expect(result.signature).toMatch(/^0x[0-9a-f]+$/);
      expect(result.expires_at).toBe(1_900_000_000n);
      expect(result.signer_nonce).toBe(0n);
    });
  });
});
