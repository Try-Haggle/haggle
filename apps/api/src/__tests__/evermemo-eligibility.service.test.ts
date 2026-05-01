import { describe, expect, it, vi } from "vitest";
import {
  evaluateEvermemoEligibility,
  recordEvermemoEligibilitySnapshot,
} from "../services/evermemo-eligibility.service.js";

vi.mock("@haggle/db", () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    raw: strings.join("?"),
    values,
  }),
}));

describe("Evermemo Eligibility Service", () => {
  it("qualifies subscription users", () => {
    expect(
      evaluateEvermemoEligibility({
        userId: "u1",
        monthlyTradeCount: 0,
        subscriptionActive: true,
      }),
    ).toEqual({ eligible: true, reason: "subscription" });
  });

  it("qualifies legendary or mythic buddy users only with trade activity", () => {
    expect(
      evaluateEvermemoEligibility({
        userId: "u1",
        monthlyTradeCount: 4,
        buddy: { rarity: "LEGENDARY" },
      }),
    ).toEqual({ eligible: true, reason: "legendary_buddy_trade_threshold" });

    expect(
      evaluateEvermemoEligibility({
        userId: "u1",
        monthlyTradeCount: 2,
        buddy: { rarity: "MYTHIC" },
      }),
    ).toEqual({ eligible: false, reason: "not_eligible" });
  });

  it("qualifies reviewer participation only with trade activity", () => {
    expect(
      evaluateEvermemoEligibility({
        userId: "u1",
        monthlyTradeCount: 4,
        reviewerParticipationCount: 3,
      }),
    ).toEqual({ eligible: true, reason: "reviewer_trade_threshold" });
  });

  it("records an eligibility snapshot", async () => {
    const execute = vi.fn().mockResolvedValue([]);
    const db = { execute } as unknown as import("@haggle/db").Database;

    await expect(
      recordEvermemoEligibilitySnapshot(db, {
        userId: "44444444-4444-4444-4444-444444444444",
        monthlyTradeCount: 4,
        buddy: {
          id: "55555555-5555-5555-5555-555555555555",
          rarity: "MYTHIC",
        },
      }),
    ).resolves.toEqual({ eligible: true, reason: "mythic_buddy_trade_threshold", recorded: true });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0].raw).toContain("INSERT INTO memory_eligibility_snapshots");
  });
});
