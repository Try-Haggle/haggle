import type { DisputeCase } from "@haggle/dispute-core";
import { describe, expect, it, vi } from "vitest";
import { escalationIssue, withReviewRoundLock } from "../services/dispute-review-round.service.js";

function dispute(tier: number, extra: Partial<DisputeCase> = {}): DisputeCase {
  return {
    id: "d1",
    order_id: "o1",
    reason_code: "OTHER",
    opened_by: "buyer",
    opened_at: "2026-09-26T00:00:00Z",
    evidence: [],
    status: "UNDER_REVIEW",
    metadata: {
      tier,
      review_phase: "ACTIVE",
      ai_resolution_assessor: { status: "COMPLETED" },
      panel_review_evaluation: { tier: 2, ready: true },
    },
    ...extra,
  } as DisputeCase;
}

describe("review escalation policy", () => {
  it.each([1, 2])("accepts completed tier %i", (tier) =>
    expect(escalationIssue(dispute(tier), tier)).toBeNull());
  it.each([
    "CLOSED",
    "RESOLVED_BUYER_FAVOR",
    "RESOLVED_SELLER_FAVOR",
    "PARTIAL_REFUND",
  ] as const)("does not reopen settled %s", (status) =>
    expect(escalationIssue(dispute(2, { status }))).toBe("DISPUTE_ALREADY_RESOLVED"));
  it("blocks a stale tab from skipping a tier", () =>
    expect(escalationIssue(dispute(2), 1)).toBe("REVIEW_TIER_CHANGED"));
  it("stops at T3", () => expect(escalationIssue(dispute(3))).toBe("MAX_TIER_REACHED"));
  it("requires an AI decision for T2", () =>
    expect(escalationIssue(dispute(1, { metadata: { tier: 1 } }))).toBe(
      "T1_ASSESSMENT_NOT_COMPLETED",
    ));
  it("does not count the old tier's decision", () =>
    expect(
      escalationIssue(
        dispute(2, {
          metadata: {
            tier: 2,
            review_phase: "ACTIVE",
            panel_review_evaluation: { ready: true, tier: 1 },
          },
        }),
      ),
    ).toBe("PANEL_REVIEW_NOT_READY"));
  it("requires fresh evidence assessment", () => {
    const d = dispute(1);
    d.metadata = { ...d.metadata, ai_assessment_stale: true };
    expect(escalationIssue(d)).toBe("ASSESSMENT_STALE");
  });
  it("does not bypass an open operator appeal", () => {
    const d = dispute(2);
    d.metadata = { ...d.metadata, appeal_review: { status: "OPEN" } };
    expect(escalationIssue(d)).toBe("APPEAL_REVIEW_REQUIRED");
  });
  it("holds the case row lock until the mutation finishes", async () => {
    const events: string[] = [];
    const tx = {
      select: () => ({
        from: () => ({
          where: () => ({
            for: async (kind: string) => {
              events.push(kind);
            },
          }),
        }),
      }),
    };
    const db = {
      transaction: vi.fn(async (run) => {
        events.push("begin");
        const value = await run(tx);
        events.push("commit");
        return value;
      }),
    };
    expect(
      await withReviewRoundLock(db as never, "d1", async (received) => {
        expect(received).toBe(tx);
        events.push("mutation");
        return 42;
      }),
    ).toBe(42);
    expect(events).toEqual(["begin", "update", "mutation", "commit"]);
  });
});
