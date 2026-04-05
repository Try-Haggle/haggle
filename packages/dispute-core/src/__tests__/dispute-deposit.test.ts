import { describe, it, expect } from "vitest";
import {
  createDepositRequirement,
  recordDeposit,
  checkDefaultJudgment,
  resolveDeposit,
} from "../dispute-deposit.js";
import { computeDisputeCost } from "../dispute-cost.js";

// ---------------------------------------------------------------------------
// createDepositRequirement
// ---------------------------------------------------------------------------

describe("createDepositRequirement", () => {
  it("creates requirement for Tier 2 — seller only", () => {
    const cost = computeDisputeCost(100_000, 2);
    const req = createDepositRequirement("d-001", 2, cost.cost_cents);

    expect(req.dispute_id).toBe("d-001");
    expect(req.tier).toBe(2);
    expect(req.amount_cents).toBe(cost.cost_cents);
    expect(req.deadline_hours).toBe(48);
    expect(req.seller_deposit).toBeDefined();
    expect((req as any).buyer_deposit).toBeUndefined();
  });

  it("creates requirement for Tier 3 with 72h deadline", () => {
    const cost = computeDisputeCost(100_000, 3);
    const req = createDepositRequirement("d-002", 3, cost.cost_cents);

    expect(req.tier).toBe(3);
    expect(req.deadline_hours).toBe(72);
  });

  it("seller deposit amount matches dispute cost", () => {
    const cost = computeDisputeCost(500_000, 2);
    const req = createDepositRequirement("d-003", 2, cost.cost_cents);

    expect(req.seller_deposit.amount_cents).toBe(cost.cost_cents);
  });

  it("seller deposit starts as PENDING", () => {
    const req = createDepositRequirement("d-005", 2, 2_000);
    expect(req.seller_deposit.status).toBe("PENDING");
  });

  it("throws on non-positive amount", () => {
    expect(() => createDepositRequirement("d-006", 2, 0)).toThrow("amount_cents must be positive");
    expect(() => createDepositRequirement("d-007", 2, -100)).toThrow("amount_cents must be positive");
  });
});

// ---------------------------------------------------------------------------
// recordDeposit
// ---------------------------------------------------------------------------

describe("recordDeposit", () => {
  it("records seller deposit", () => {
    const req = createDepositRequirement("d-010", 2, 2_000);
    const now = "2026-04-01T10:00:00Z";
    const updated = recordDeposit(req, now);

    expect(updated.seller_deposit.status).toBe("DEPOSITED");
    expect(updated.seller_deposit.deposited_at).toBe(now);
  });

  it("throws if seller already deposited", () => {
    let req = createDepositRequirement("d-013", 2, 2_000);
    req = recordDeposit(req, "2026-04-01T10:00:00Z");

    expect(() => recordDeposit(req, "2026-04-01T11:00:00Z"))
      .toThrow("seller deposit is already DEPOSITED");
  });
});

// ---------------------------------------------------------------------------
// checkDefaultJudgment
// ---------------------------------------------------------------------------

describe("checkDefaultJudgment", () => {
  const deadline = "2026-04-02T10:00:00Z";

  it("returns null before deadline", () => {
    const req = createDepositRequirement("d-020", 2, 2_000);
    const result = checkDefaultJudgment(req, deadline, "2026-04-02T09:59:59Z");
    expect(result).toBeNull();
  });

  it("returns null when seller deposited", () => {
    let req = createDepositRequirement("d-021", 2, 2_000);
    req = recordDeposit(req, "2026-04-01T10:00:00Z");

    const result = checkDefaultJudgment(req, deadline, "2026-04-03T00:00:00Z");
    expect(result).toBeNull();
  });

  it("buyer auto-wins when seller doesn't deposit by deadline", () => {
    const req = createDepositRequirement("d-023", 2, 2_000);

    const result = checkDefaultJudgment(req, deadline, "2026-04-03T00:00:00Z");
    expect(result).not.toBeNull();
    expect(result!.winning_party).toBe("buyer");
    expect(result!.reason).toBe("seller_deposit_timeout");
  });
});

// ---------------------------------------------------------------------------
// resolveDeposit
// ---------------------------------------------------------------------------

describe("resolveDeposit", () => {
  it("forfeits seller deposit when seller loses", () => {
    let req = createDepositRequirement("d-030", 2, 2_000);
    req = recordDeposit(req, "2026-04-01T10:00:00Z");

    const now = "2026-04-05T12:00:00Z";
    const resolved = resolveDeposit(req, false, now);

    expect(resolved.seller_deposit.status).toBe("FORFEITED");
    expect(resolved.seller_deposit.resolved_at).toBe(now);
  });

  it("refunds seller deposit when seller wins", () => {
    let req = createDepositRequirement("d-031", 3, 4_000);
    req = recordDeposit(req, "2026-04-01T10:00:00Z");

    const now = "2026-04-05T12:00:00Z";
    const resolved = resolveDeposit(req, true, now);

    expect(resolved.seller_deposit.status).toBe("REFUNDED");
    expect(resolved.seller_deposit.resolved_at).toBe(now);
  });

  it("preserves original deposit amount after resolution", () => {
    let req = createDepositRequirement("d-032", 2, 3_500);
    req = recordDeposit(req, "2026-04-01T10:00:00Z");

    const resolved = resolveDeposit(req, false, "2026-04-05T12:00:00Z");
    expect(resolved.seller_deposit.amount_cents).toBe(3_500);
  });
});
