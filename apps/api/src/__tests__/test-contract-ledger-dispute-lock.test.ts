import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  fundTestContract,
  getTestContractByOrderId,
  lockTestContractForDisputeOpen,
  releaseTestContract,
  resetTestContractLedgerForTests,
  serializeTestContract,
} from "../services/test-contract-ledger.service.js";

const ORDER = "ord_b2_lock";

describe("test-contract-ledger service (fake-money L1 lock)", () => {
  beforeEach(() => {
    resetTestContractLedgerForTests();
  });

  afterEach(() => {
    resetTestContractLedgerForTests();
  });

  it("locks funded escrow for an L1 dispute id and blocks release", () => {
    const funded = fundTestContract({
      order_id: ORDER,
      payment_intent_id: "pi_1",
      amount_minor: 100_000,
    });
    expect(funded.ok).toBe(true);

    const locked = lockTestContractForDisputeOpen(ORDER, "disp_1");
    expect(locked).toMatchObject({ locked: true, idempotent: false });
    if (!locked.locked) throw new Error("expected lock");
    expect(locked.entry.status).toBe("DISPUTED");
    expect(serializeTestContract(locked.entry).invariant_checks.dispute_blocks_buyer_confirm).toBe(
      true,
    );

    const again = lockTestContractForDisputeOpen(ORDER, "disp_1");
    expect(again).toMatchObject({ locked: true, idempotent: true });

    const release = releaseTestContract({ order_id: ORDER });
    expect(release.ok).toBe(false);
    if (release.ok) throw new Error("expected release blocked");
    expect(release.error).toBe("TEST_CONTRACT_NOT_RELEASABLE");
    expect(getTestContractByOrderId(ORDER)?.status).toBe("DISPUTED");
  });

  it("no-ops when there is no fake-money ledger entry", () => {
    expect(lockTestContractForDisputeOpen("missing", "disp_x")).toEqual({
      locked: false,
      reason: "NO_TEST_CONTRACT",
    });
  });
});
