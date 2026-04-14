import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Address, Hex } from "viem";
import { ViemSettlementRouterContract } from "../viem-contracts.js";
import type { SettlementRouterExecutionRequest } from "../x402-contracts.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROUTER_ADDRESS = "0x1234567890123456789012345678901234567890" as Address;
const ASSET_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address;

function makeRequest(overrides: Partial<SettlementRouterExecutionRequest> = {}): SettlementRouterExecutionRequest {
  return {
    order_id: "ord_001",
    payment_intent_id: "pi_001",
    buyer_id: "buyer_001",
    seller_id: "seller_001",
    buyer_authorization_mode: "human_wallet",
    buyer_wallet: { actor_id: "buyer-1", wallet_address: "0xBuyer0000000000000000000000000000000001" as Address, network: "eip155:8453", custody: "external" as const },
    seller_wallet: { actor_id: "seller-1", wallet_address: "0xSeller000000000000000000000000000000001" as Address, network: "eip155:8453", custody: "external" as const },
    haggle_fee_wallet: { actor_id: "haggle", wallet_address: "0xFeeWallet0000000000000000000000000000001" as Address, network: "eip155:8453", custody: "merchant_managed" as const },
    gross_amount: { currency: "USDC", amount_minor: 100_000_000 },
    seller_amount: { currency: "USDC", amount_minor: 98_500_000 },
    haggle_fee_amount: { currency: "USDC", amount_minor: 1_500_000 },
    signature: "0xdeadbeef" as Hex,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
    signer_nonce: BigInt(0),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ViemSettlementRouterContract", () => {
  let capturedArgs: unknown[];
  let publicClient: Record<string, unknown>;
  let walletClient: Record<string, unknown>;
  let contract: ViemSettlementRouterContract;

  beforeEach(() => {
    capturedArgs = [];

    publicClient = {
      simulateContract: vi.fn().mockImplementation(({ args }: { args: unknown[] }) => {
        capturedArgs = args;
        return Promise.resolve({ request: { _captured: args } });
      }),
    };

    walletClient = {
      account: { address: "0xBuyer0000000000000000000000000000000001" as Address },
      writeContract: vi.fn().mockResolvedValue("0xTxHash" as Hex),
    };

    contract = new ViemSettlementRouterContract(
      "base",
      "USDC",
      ROUTER_ADDRESS,
      publicClient,
      walletClient,
      ASSET_ADDRESS,
    );
  });

  it("passes exactly 2 args to simulateContract: [tupleParams, signatureBytes]", async () => {
    const request = makeRequest();
    // writeContract returns a hash; waitForTransactionReceipt is not mocked on purpose —
    // we only care about the simulateContract args shape here.
    (publicClient as any).waitForTransactionReceipt = vi.fn().mockResolvedValue({ status: "success" });
    await contract.execute(request);

    expect(capturedArgs).toHaveLength(2);
  });

  it("first arg is a tuple object with all 12 SettlementParams fields", async () => {
    const request = makeRequest();
    (publicClient as any).waitForTransactionReceipt = vi.fn().mockResolvedValue({ status: "success" });
    await contract.execute(request);

    const params = capturedArgs[0] as Record<string, unknown>;
    expect(params).toHaveProperty("orderId");
    expect(params).toHaveProperty("paymentIntentId");
    expect(params).toHaveProperty("buyer");
    expect(params).toHaveProperty("seller");
    expect(params).toHaveProperty("sellerWallet");
    expect(params).toHaveProperty("feeWallet");
    expect(params).toHaveProperty("asset");
    expect(params).toHaveProperty("grossAmount");
    expect(params).toHaveProperty("sellerAmount");
    expect(params).toHaveProperty("feeAmount");
    expect(params).toHaveProperty("deadline");
    expect(params).toHaveProperty("signerNonce");
  });

  it("second arg is the EIP-712 signature bytes from the request", async () => {
    const request = makeRequest({ signature: "0xabcdef1234" as Hex });
    (publicClient as any).waitForTransactionReceipt = vi.fn().mockResolvedValue({ status: "success" });
    await contract.execute(request);

    expect(capturedArgs[1]).toBe("0xabcdef1234");
  });

  it("deadline and signerNonce are bigints in the tuple", async () => {
    const deadline = BigInt(1999999999);
    const signerNonce = BigInt(3);
    const request = makeRequest({ deadline, signer_nonce: signerNonce });
    (publicClient as any).waitForTransactionReceipt = vi.fn().mockResolvedValue({ status: "success" });
    await contract.execute(request);

    const params = capturedArgs[0] as Record<string, unknown>;
    expect(typeof params.deadline).toBe("bigint");
    expect(typeof params.signerNonce).toBe("bigint");
    expect(params.deadline).toBe(deadline);
    expect(params.signerNonce).toBe(signerNonce);
  });

  it("grossAmount, sellerAmount, feeAmount are bigints in the tuple", async () => {
    const request = makeRequest();
    (publicClient as any).waitForTransactionReceipt = vi.fn().mockResolvedValue({ status: "success" });
    await contract.execute(request);

    const params = capturedArgs[0] as Record<string, unknown>;
    expect(typeof params.grossAmount).toBe("bigint");
    expect(typeof params.sellerAmount).toBe("bigint");
    expect(typeof params.feeAmount).toBe("bigint");
    expect(params.grossAmount).toBe(BigInt(100_000_000));
    expect(params.sellerAmount).toBe(BigInt(98_500_000));
    expect(params.feeAmount).toBe(BigInt(1_500_000));
  });

  it("asset field in tuple matches the injected assetAddress", async () => {
    const request = makeRequest();
    (publicClient as any).waitForTransactionReceipt = vi.fn().mockResolvedValue({ status: "success" });
    await contract.execute(request);

    const params = capturedArgs[0] as Record<string, unknown>;
    expect(params.asset).toBe(ASSET_ADDRESS);
  });
});
