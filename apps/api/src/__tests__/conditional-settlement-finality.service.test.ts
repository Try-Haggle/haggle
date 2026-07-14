import { describe, expect, it, vi } from "vitest";
import {
  conditionalSettlementConfirmationRetry,
  evaluateConditionalSettlementFinality,
  getConditionalSettlementRequiredConfirmations,
  runConditionalSettlementFinalityFixture,
} from "../services/conditional-settlement-finality.service.js";

describe("conditional settlement receipt finality", () => {
  it("uses a bounded strict confirmation policy", () => {
    expect(getConditionalSettlementRequiredConfirmations({})).toBe(2);
    expect(getConditionalSettlementRequiredConfirmations({ HAGGLE_CONDITIONAL_SETTLEMENT_CONFIRMATIONS: "12" })).toBe(12);
    for (const value of ["0", "65", "2.5", " 2", "no"]) {
      expect(() => getConditionalSettlementRequiredConfirmations({ HAGGLE_CONDITIONAL_SETTLEMENT_CONFIRMATIONS: value })).toThrow();
    }
  });

  it("requires a fresh observation key while reusing the transaction hash", () => {
    expect(conditionalSettlementConfirmationRetry()).toEqual({
      after_seconds: 2,
      reuse_transaction_hash: true,
      use_new_idempotency_key: true,
    });
  });

  it("counts the receipt block as the first confirmation", async () => {
    const blockHash = `0x${"ab".repeat(32)}`;
    const client = { getBlockNumber: vi.fn().mockResolvedValue(101n), getBlock: vi.fn().mockResolvedValue({ hash: blockHash }) };
    await expect(evaluateConditionalSettlementFinality({ receiptBlockNumber: 100n, receiptBlockHash: blockHash, client })).resolves.toMatchObject({
      status: "confirmed", ready: true, observed_confirmations: 2, required_confirmations: 2, canonical_block_verified: true,
    });
  });

  it("does not expose RPC errors and fails closed for impossible block order", async () => {
    const unavailable = await evaluateConditionalSettlementFinality({
      receiptBlockNumber: 100n,
      client: { getBlockNumber: async () => { throw new Error("secret RPC URL"); }, getBlock: async () => ({ hash: null }) },
    });
    expect(unavailable).toMatchObject({ status: "unavailable", reason: "CHAIN_HEAD_UNAVAILABLE" });
    expect(JSON.stringify(unavailable)).not.toContain("secret RPC URL");
    await expect(evaluateConditionalSettlementFinality({
      receiptBlockNumber: 101n,
      client: { getBlockNumber: async () => 100n, getBlock: async () => ({ hash: null }) },
    })).resolves.toMatchObject({ status: "unavailable", reason: "CHAIN_HEAD_BEHIND_RECEIPT" });
  });

  it("does not query canonical membership before the threshold and blocks an orphaned receipt at the threshold", async () => {
    const receiptBlockHash = `0x${"ab".repeat(32)}`;
    const getBlock = vi.fn().mockResolvedValue({ hash: `0x${"cd".repeat(32)}` });
    const client = { getBlockNumber: vi.fn().mockResolvedValueOnce(100n).mockResolvedValueOnce(101n), getBlock };
    await expect(evaluateConditionalSettlementFinality({ receiptBlockNumber: 100n, receiptBlockHash, client })).resolves.toMatchObject({ status: "pending" });
    expect(getBlock).not.toHaveBeenCalled();
    await expect(evaluateConditionalSettlementFinality({ receiptBlockNumber: 100n, receiptBlockHash, client })).resolves.toMatchObject({
      status: "unavailable", reason: "RECEIPT_BLOCK_NOT_CANONICAL",
    });
    expect(getBlock).toHaveBeenCalledWith({ blockNumber: 100n });
  });

  it("passes the dashboard fixture", async () => {
    await expect(runConditionalSettlementFinalityFixture()).resolves.toMatchObject({ pass: true });
  });
});
