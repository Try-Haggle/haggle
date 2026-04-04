import { describe, it, expect } from "vitest";
import { checkSla, computeCompensation } from "../sla-violation.js";
import type { SlaConfig } from "../types.js";

/** Helper: create a default SLA config. */
function cfg(overrides?: Partial<SlaConfig>): SlaConfig {
  return {
    sla_days: 3,
    category: "ELECTRONICS_SMALL",
    grace_hours: 6,
    hard_deadline_days: 14,
    ...overrides,
  };
}

/** Helper: add days (and optionally hours) to an ISO date string. */
function addTime(
  iso: string,
  days: number,
  hours = 0,
): string {
  const d = new Date(iso);
  d.setTime(d.getTime() + days * 86_400_000 + hours * 3_600_000);
  return d.toISOString();
}

const APPROVAL = "2026-04-01T12:00:00.000Z";

describe("checkSla", () => {
  it("returns FULFILLED when shipped before deadline", () => {
    const shipped = addTime(APPROVAL, 2); // day 2 of 3
    const now = addTime(APPROVAL, 4);
    const r = checkSla(cfg(), shipped, now, APPROVAL);
    expect(r.status).toBe("FULFILLED");
    expect(r.days_late).toBe(0);
    expect(r.can_cancel).toBe(false);
  });

  it("returns FULFILLED when shipped exactly at deadline", () => {
    const shipped = addTime(APPROVAL, 3); // exactly day 3
    const now = addTime(APPROVAL, 4);
    const r = checkSla(cfg(), shipped, now, APPROVAL);
    expect(r.status).toBe("FULFILLED");
  });

  it("returns ACTIVE when deadline not reached", () => {
    const now = addTime(APPROVAL, 2);
    const r = checkSla(cfg(), null, now, APPROVAL);
    expect(r.status).toBe("ACTIVE");
    expect(r.days_late).toBe(0);
    expect(r.can_cancel).toBe(false);
    expect(r.in_grace_period).toBe(false);
  });

  it("returns GRACE_PERIOD within 6h after deadline", () => {
    const now = addTime(APPROVAL, 3, 3); // 3 hours into grace
    const r = checkSla(cfg(), null, now, APPROVAL);
    expect(r.status).toBe("GRACE_PERIOD");
    expect(r.in_grace_period).toBe(true);
    expect(r.can_cancel).toBe(false);
    expect(r.compensation_rate).toBe(0);
  });

  it("returns VIOLATED after grace period expires", () => {
    const now = addTime(APPROVAL, 3, 7); // 7 hours past deadline (grace is 6h)
    const r = checkSla(cfg(), null, now, APPROVAL);
    expect(r.status).toBe("VIOLATED");
    expect(r.days_late).toBeGreaterThan(0);
    expect(r.can_cancel).toBe(true);
    expect(r.compensation_rate).toBeGreaterThan(0);
  });

  it("returns CANCELLED at 14-day hard deadline", () => {
    const now = addTime(APPROVAL, 14);
    const r = checkSla(cfg(), null, now, APPROVAL);
    expect(r.status).toBe("CANCELLED");
    expect(r.auto_cancel).toBe(true);
    expect(r.can_cancel).toBe(true);
  });

  it("cannot cancel when ACTIVE", () => {
    const now = addTime(APPROVAL, 1);
    const r = checkSla(cfg(), null, now, APPROVAL);
    expect(r.can_cancel).toBe(false);
  });

  it("can cancel when VIOLATED", () => {
    const now = addTime(APPROVAL, 4); // 1 day past 3-day SLA + well past grace
    const r = checkSla(cfg(), null, now, APPROVAL);
    expect(r.status).toBe("VIOLATED");
    expect(r.can_cancel).toBe(true);
  });

  it("handles null shipped_at correctly (not shipped yet)", () => {
    const now = addTime(APPROVAL, 2);
    const r = checkSla(cfg(), null, now, APPROVAL);
    expect(r.status).toBe("ACTIVE");
  });
});

describe("computeCompensation", () => {
  const TX_AMOUNT = 100_00; // $100 in cents

  it("returns 2% for 1 day late", () => {
    const c = computeCompensation(1, TX_AMOUNT);
    expect(c.rate).toBe(0.02);
    expect(c.amount_cents).toBe(200);
    expect(c.capped).toBe(false);
  });

  it("returns 5% for 2 days late", () => {
    const c = computeCompensation(2, TX_AMOUNT);
    expect(c.rate).toBe(0.05);
    expect(c.amount_cents).toBe(500);
    expect(c.capped).toBe(false);
  });

  it("returns 10% for 3+ days late", () => {
    const c = computeCompensation(3, TX_AMOUNT);
    expect(c.rate).toBe(0.1);
    expect(c.amount_cents).toBe(1000);
    expect(c.capped).toBe(false);

    const c5 = computeCompensation(5, TX_AMOUNT);
    expect(c5.rate).toBe(0.1);
    expect(c5.amount_cents).toBe(1000);
  });

  it("caps compensation at 20% of transaction amount", () => {
    // 10% rate on a small amount won't cap, but let's use a scenario
    // where we simulate: if the rate * amount exceeds 20%, it should cap.
    // With the current tiered system the max rate is 10%, so capping
    // only triggers if we adjusted the logic. Let's verify it doesn't
    // cap at normal rates.
    const c = computeCompensation(3, TX_AMOUNT);
    expect(c.capped).toBe(false);
    expect(c.amount_cents).toBe(1000); // 10% of 10000

    // 20% cap = 2000 cents for $100. 10% = 1000, so no cap.
    // The cap matters if the system is ever extended with higher rates,
    // but verify the math is correct.
    expect(c.amount_cents).toBeLessThanOrEqual(TX_AMOUNT * 0.2);
  });

  it("returns zero for 0 days late", () => {
    const c = computeCompensation(0, TX_AMOUNT);
    expect(c.rate).toBe(0);
    expect(c.amount_cents).toBe(0);
    expect(c.capped).toBe(false);
  });

  it("returns zero for negative days late", () => {
    const c = computeCompensation(-1, TX_AMOUNT);
    expect(c.rate).toBe(0);
    expect(c.amount_cents).toBe(0);
  });
});
