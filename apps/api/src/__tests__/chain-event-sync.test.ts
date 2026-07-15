import { afterEach, describe, expect, it, vi } from "vitest";
import { createChainListenerConfig } from "../chain/event-listener.js";
import { handleConditionalSettlementEvent } from "../chain/handlers/conditional-settlement-handler.js";

const ENV_KEYS = [
  "BASE_RPC_URL",
  "HAGGLE_BASE_RPC_URL",
  "SETTLEMENT_ROUTER_ADDRESS",
  "HAGGLE_SETTLEMENT_ROUTER_ADDRESS",
  "CONDITIONAL_SETTLEMENT_ADDRESS",
  "HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS",
  "DISPUTE_REGISTRY_ADDRESS",
  "HAGGLE_DISPUTE_REGISTRY_ADDRESS",
  "BASE_CHAIN_ID",
] as const;

function snapshotEnv() {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot: Record<string, string | undefined>) {
  for (const key of ENV_KEYS) {
    if (snapshot[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = snapshot[key];
    }
  }
}

describe("chain event sync production wiring", () => {
  const env = snapshotEnv();

  afterEach(() => {
    restoreEnv(env);
    vi.restoreAllMocks();
  });

  it("uses HAGGLE_* contract address env vars for payment-stack deployments", () => {
    process.env.HAGGLE_BASE_RPC_URL = "https://base-sepolia.example";
    process.env.HAGGLE_SETTLEMENT_ROUTER_ADDRESS = "0x1111111111111111111111111111111111111111";
    process.env.HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS =
      "0x2222222222222222222222222222222222222222";
    process.env.HAGGLE_DISPUTE_REGISTRY_ADDRESS = "0x3333333333333333333333333333333333333333";
    process.env.BASE_CHAIN_ID = "84532";

    const config = createChainListenerConfig();

    expect(config).toMatchObject({
      rpcUrl: "https://base-sepolia.example",
      chainId: 84532,
      settlementRouterAddress: "0x1111111111111111111111111111111111111111",
      conditionalSettlementAddress: "0x2222222222222222222222222222222222222222",
      disputeRegistryAddress: "0x3333333333333333333333333333333333333333",
    });
  });

  it("updates payment provider context from conditional settlement events", async () => {
    const set = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) });
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([
            {
              id: "payment-1",
              providerContext: {
                conditional_settlement: {
                  settlement_id:
                    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                  status: "FUNDING_SUBMITTED",
                },
              },
            },
          ]),
        }),
      }),
      update: vi.fn().mockReturnValue({ set }),
    };

    await handleConditionalSettlementEvent(
      db as never,
      {
        transactionHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      } as never,
      {
        eventName: "SettlementFunded",
        args: {
          settlementId: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          orderId: "0x1111111111111111111111111111111111111111111111111111111111111111",
          paymentIntentId: "0x2222222222222222222222222222222222222222222222222222222222222222",
          approvalPolicyHash: "0x3333333333333333333333333333333333333333333333333333333333333333",
          buyer: "0x4444444444444444444444444444444444444444",
          seller: "0x5555555555555555555555555555555555555555",
          asset: "0x6666666666666666666666666666666666666666",
          grossAmount: 100_000_000n,
        },
      },
    );

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        providerContext: expect.objectContaining({
          conditional_settlement: expect.objectContaining({
            settlement_id: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            funding_tx_hash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            status: "FUNDING_CONFIRMED",
            order_id_hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
            payment_intent_id_hash:
              "0x2222222222222222222222222222222222222222222222222222222222222222",
            approval_policy_hash:
              "0x3333333333333333333333333333333333333333333333333333333333333333",
            buyer_wallet: "0x4444444444444444444444444444444444444444",
            seller_wallet: "0x5555555555555555555555555555555555555555",
            asset: "0x6666666666666666666666666666666666666666",
            gross_amount_minor: "100000000",
          }),
        }),
      }),
    );
  });
});
