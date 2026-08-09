/**
 * Feature ② serving path: a PROMOTED learned check becomes a deterministic planner slot,
 * so a warmed category no longer needs the LLM to think of the question.
 *
 * The safety contract is what these tests pin: learned checks are advisory-only, never
 * override the curated taxonomy, and are inert when nothing has been learned.
 */

import { describe, expect, it } from "vitest";
import {
  buildAdvisorRequirementPlan,
  type LearnedCheckForRequirements,
} from "../services/tag-garden-requirements.js";

const MEMORY = {
  categoryInterest: "탐색 중",
  mustHave: [],
  avoid: [],
  source: [],
};

/** A furniture listing — its taxonomy root is soft-only, so slots are easy to read. */
const LISTING = { title: "Oak dining table", condition: "good", tags: [], category: "furniture" };

const LEARNED: LearnedCheckForRequirements = {
  id: "q-조립-설명서가-있나요",
  questionKo: "조립 설명서가 있나요?",
};

function slots(learnedChecks: LearnedCheckForRequirements[] = []) {
  return buildAdvisorRequirementPlan({
    memory: MEMORY,
    listings: [LISTING],
    learnedChecks,
  }).requiredSlots;
}

describe("learned checks in the requirement plan", () => {
  it("is inert when nothing has been learned (pure static taxonomy)", () => {
    const before = slots();
    expect(before.some((s) => s.tagPath === "taxonomy-learned")).toBe(false);
    // Default arg path behaves the same as an explicit empty list.
    expect(
      buildAdvisorRequirementPlan({ memory: MEMORY, listings: [LISTING] }).requiredSlots.length,
    ).toBe(before.length);
  });

  it("serves a promoted learned check as an extra slot", () => {
    const after = slots([LEARNED]);
    const learnedSlot = after.find((s) => s.slotId === LEARNED.id);
    expect(learnedSlot).toBeDefined();
    expect(learnedSlot?.questionKo).toBe(LEARNED.questionKo);
    expect(learnedSlot?.tagPath).toBe("taxonomy-learned");
  });

  it("a learned check is ALWAYS soft — it can never block the flow", () => {
    const learnedSlot = slots([LEARNED]).find((s) => s.slotId === LEARNED.id);
    expect(learnedSlot?.enforcement).toBe("soft");
    // …and therefore never appears among blocking slots.
    const plan = buildAdvisorRequirementPlan({
      memory: MEMORY,
      listings: [LISTING],
      learnedChecks: [LEARNED],
    });
    expect(plan.blockingSlots.some((s) => s.slotId === LEARNED.id)).toBe(false);
  });

  it("prefers the buyer-framed question when the learned check has one", () => {
    const withAsk: LearnedCheckForRequirements = {
      ...LEARNED,
      buyerAskKo: "Do you require assembly instructions?",
    };
    const learnedSlot = slots([withAsk]).find((s) => s.slotId === withAsk.id);
    expect(learnedSlot?.questionKo).toBe("Do you require assembly instructions?");
  });

  it("never overrides a curated taxonomy check with the same id", () => {
    const staticSlots = slots();
    const collidingId = staticSlots.find((s) => s.tagPath === "taxonomy")?.slotId;
    expect(collidingId).toBeDefined();

    const after = slots([{ id: collidingId!, questionKo: "HIJACKED" }]);
    const matching = after.filter((s) => s.slotId === collidingId);
    expect(matching).toHaveLength(1);
    expect(matching[0]?.questionKo).not.toBe("HIJACKED");
    expect(matching[0]?.tagPath).toBe("taxonomy");
  });

  it("is ordered after the curated questions (lower priority)", () => {
    const after = slots([LEARNED]);
    const learnedSlot = after.find((s) => s.slotId === LEARNED.id);
    const curated = after.filter((s) => s.tagPath === "taxonomy");
    expect(curated.length).toBeGreaterThan(0);
    for (const c of curated) {
      expect(c.priority).toBeLessThanOrEqual(learnedSlot?.priority ?? Number.POSITIVE_INFINITY);
    }
  });

  it("does not apply when a listing has no category/tags to resolve", () => {
    const plan = buildAdvisorRequirementPlan({
      memory: MEMORY,
      listings: [{ title: "x", condition: "good", tags: [] }],
      learnedChecks: [LEARNED],
    });
    expect(plan.requiredSlots.some((s) => s.slotId === LEARNED.id)).toBe(false);
  });
});
