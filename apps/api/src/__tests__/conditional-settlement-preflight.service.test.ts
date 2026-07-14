import type { Address, Hex } from "viem";
import { describe, expect, it, vi } from "vitest";
import {
  type ConditionalSettlementPreflightClient,
  type ConditionalSettlementPreflightConfig,
  runConditionalSettlementPreflight,
  validateConditionalSettlementPreflightConfig,
} from "../services/conditional-settlement-preflight.service.js";

const config: ConditionalSettlementPreflightConfig = {
  network: "base-sepolia",
  rpcUrl: "https://rpc.example.test",
  settlementAddress: "0x1111111111111111111111111111111111111111",
  usdcAddress: "0x2222222222222222222222222222222222222222",
  relayerPrivateKey: `0x${"33".repeat(32)}` as Hex,
};
const signer = "0x4444444444444444444444444444444444444444" as Address;
const now = () => new Date("2026-07-12T17:00:00.000Z");

function client(
  overrides: Partial<ConditionalSettlementPreflightClient> = {},
): ConditionalSettlementPreflightClient {
  return {
    getChainId: vi.fn().mockResolvedValue(84532),
    getBytecode: vi.fn().mockResolvedValue("0x60016000"),
    readContract: vi.fn().mockResolvedValueOnce(signer).mockResolvedValueOnce(true),
    ...overrides,
  };
}

describe("conditional settlement live preflight", () => {
  it("validates production HTTPS and rejects zero credentials", () => {
    expect(
      validateConditionalSettlementPreflightConfig({
        network: "base-sepolia",
        rpcUrl: "http://rpc.example.test",
        settlementAddress: `0x${"00".repeat(20)}`,
        usdcAddress: config.usdcAddress,
        relayerPrivateKey: `0x${"00".repeat(32)}`,
        requireHttps: true,
      }),
    ).toEqual({
      ok: false,
      blockedBy: ["base_rpc", "conditional_settlement_address", "relayer_signer"],
    });
  });

  it("reports ready only when chain, bytecode, signer, and asset allowlist all match", async () => {
    const result = await runConditionalSettlementPreflight(config, {
      client: client(),
      expectedSignerAddress: signer,
      now,
    });
    expect(result).toMatchObject({
      status: "ready",
      ready: true,
      checks: {
        rpc_reachable: true,
        chain_id_match: true,
        settlement_bytecode: true,
        usdc_bytecode: true,
        signer_matches: true,
        usdc_allowed: true,
      },
      blocked_by: [],
      expected_chain_id: 84532,
      observed_chain_id: 84532,
      settlement_bytecode_bytes: 4,
      usdc_bytecode_bytes: 4,
      error_code: null,
      checked_at: "2026-07-12T17:00:00.000Z",
    });
  });

  it("stops contract reads on a chain mismatch", async () => {
    const readContract = vi.fn();
    const result = await runConditionalSettlementPreflight(config, {
      client: client({ getChainId: vi.fn().mockResolvedValue(8453), readContract }),
      expectedSignerAddress: signer,
      now,
    });
    expect(result.status).toBe("blocked");
    expect(result.checks).toMatchObject({ rpc_reachable: true, chain_id_match: false });
    expect(result.blocked_by).toContain("chain_id_match");
    expect(readContract).not.toHaveBeenCalled();
  });

  it("separates signer and allowlist mismatches without exposing values", async () => {
    const mismatchClient = client({
      readContract: vi
        .fn()
        .mockResolvedValueOnce("0x5555555555555555555555555555555555555555")
        .mockResolvedValueOnce(false),
    });
    const result = await runConditionalSettlementPreflight(config, {
      client: mismatchClient,
      expectedSignerAddress: signer,
      now,
    });
    expect(result.status).toBe("blocked");
    expect(result.blocked_by).toEqual(["signer_matches", "usdc_allowed"]);
    expect(JSON.stringify(result)).not.toContain("0x5555555555555555555555555555555555555555");
    expect(JSON.stringify(result)).not.toContain(signer);
  });

  it("returns a bounded unavailable result for RPC failure", async () => {
    const result = await runConditionalSettlementPreflight(config, {
      client: client({
        getChainId: vi.fn().mockRejectedValue(new Error("secret upstream detail")),
      }),
      expectedSignerAddress: signer,
      now,
    });
    expect(result).toMatchObject({
      status: "unavailable",
      ready: false,
      error_code: "RPC_UNAVAILABLE",
    });
    expect(JSON.stringify(result)).not.toContain("secret upstream detail");
    expect(JSON.stringify(result)).not.toContain(config.rpcUrl);
  });

  it("bounds a stalled RPC probe with a timeout", async () => {
    const never = new Promise<number>(() => {});
    const result = await runConditionalSettlementPreflight(config, {
      client: client({ getChainId: vi.fn(() => never) }),
      expectedSignerAddress: signer,
      timeoutMs: 10,
      now,
    });
    expect(result).toMatchObject({ status: "unavailable", error_code: "RPC_TIMEOUT" });
  });
});
