import { describe, expect, it } from "vitest";
import { DisabledSettlementRouterContract } from "../scaffold-contracts.js";
import type { SettlementRouterExecutionRequest } from "../x402-contracts.js";

function makeExecutionRequest(): SettlementRouterExecutionRequest {
  const wallet = {
    actor_id: "actor",
    wallet_address: "0x1111111111111111111111111111111111111111",
    network: "eip155:84532",
    custody: "external" as const,
  };
  return {
    order_id: "order-1",
    payment_intent_id: "payment-1",
    buyer_id: "buyer-1",
    seller_id: "seller-1",
    buyer_authorization_mode: "human_wallet",
    buyer_wallet: wallet,
    seller_wallet: wallet,
    haggle_fee_wallet: wallet,
    gross_amount: { currency: "USDC", amount_minor: 100_000 },
    seller_amount: { currency: "USDC", amount_minor: 98_500 },
    haggle_fee_amount: { currency: "USDC", amount_minor: 1_500 },
    signature: "0x1234",
    deadline: 1n,
    signer_nonce: 0n,
  };
}

describe("DisabledSettlementRouterContract", () => {
  it("still produces quotes for payment review metadata", async () => {
    const router = new DisabledSettlementRouterContract("base-sepolia", "USDC");
    const request = makeExecutionRequest();

    const quote = await router.quote(request);

    expect(quote).toMatchObject({
      network: "base-sepolia",
      asset: "USDC",
      gross_amount: request.gross_amount,
      seller_amount: request.seller_amount,
      haggle_fee_amount: request.haggle_fee_amount,
    });
  });

  it("fails closed before server-side router execution", async () => {
    const router = new DisabledSettlementRouterContract(
      "base-sepolia",
      "USDC",
      "conditional settlement required",
    );

    await expect(router.execute(makeExecutionRequest())).rejects.toThrow(
      "SETTLEMENT_ROUTER_EXECUTION_DISABLED:conditional settlement required",
    );
  });
});
