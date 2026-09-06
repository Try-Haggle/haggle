import { describe, expect, it } from "vitest";
import {
  createFundedTestContractEntry,
  isTestContractReleaseBlocked,
  lockTestContractForDispute,
  releaseTestContractToSeller,
  resolveTestContractDispute,
  serializeTestContract,
} from "../test-contract-ledger.js";

const NOW = "2026-09-06T00:00:00.000Z";

function funded() {
  return createFundedTestContractEntry({
    settlement_id: "test_settlement_abc",
    order_id: "ord_1",
    amount_minor: 100_000,
    payment_intent_id: "pi_1",
    now: NOW,
  });
}

describe("test-contract-ledger (fake-money Stage 1)", () => {
  it("funds escrow and exposes Stage 1 invariants", () => {
    const entry = funded();
    expect(entry.status).toBe("FUNDED");
    expect(serializeTestContract(entry).invariant_checks).toEqual({
      funded_before_shipping_or_release: true,
      dispute_blocks_buyer_confirm: false,
      terminal_money_effect: false,
    });
    expect(isTestContractReleaseBlocked(entry)).toBe(false);
  });

  it("locks FUNDED → DISPUTED on L1 dispute open", () => {
    const { entry, idempotent } = lockTestContractForDispute(funded(), "disp_1", NOW);
    expect(idempotent).toBe(false);
    expect(entry.status).toBe("DISPUTED");
    expect(entry.dispute_id).toBe("disp_1");
    expect(entry.events.at(-1)?.type).toBe("dispute_locked");
    expect(isTestContractReleaseBlocked(entry)).toBe(true);
    expect(serializeTestContract(entry).invariant_checks.dispute_blocks_buyer_confirm).toBe(true);
  });

  it("is idempotent for the same dispute lock", () => {
    const locked = lockTestContractForDispute(funded(), "disp_1", NOW).entry;
    const again = lockTestContractForDispute(locked, "disp_1", NOW);
    expect(again.idempotent).toBe(true);
    expect(again.entry.status).toBe("DISPUTED");
  });

  it("refuses release while disputed", () => {
    const locked = lockTestContractForDispute(funded(), "disp_1", NOW).entry;
    expect(() => releaseTestContractToSeller(locked)).toThrow(/Cannot release from DISPUTED/);
  });

  it("resolves buyer_favor to full refund", () => {
    const locked = lockTestContractForDispute(funded(), "disp_1", NOW).entry;
    const { entry } = resolveTestContractDispute(locked, {
      dispute_id: "disp_1",
      outcome: "buyer_favor",
      summary: "L1 buyer favor",
    });
    expect(entry.status).toBe("REFUNDED_TO_BUYER");
    expect(entry.refund_amount_minor).toBe(100_000);
    expect(entry.seller_release_amount_minor).toBe(0);
    expect(serializeTestContract(entry).invariant_checks.terminal_money_effect).toBe(true);
  });
});
