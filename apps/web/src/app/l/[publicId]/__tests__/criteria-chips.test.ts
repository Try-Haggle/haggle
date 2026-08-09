/**
 * ④ Quick-setup taps must be visible in the STRATEGY row.
 *
 * The gap this covers: `applyChoice` writes only to `memory.categoryCriteria`, but the
 * original `extractChips` read none of that — so tapping the picker changed nothing on
 * screen while typing the same fact produced a chip, and the user had no evidence the
 * answer was recorded.
 */

import type { CategoryChoiceQuestion } from "@haggle/shared";
import { describe, expect, it } from "vitest";
import type { NegotiationAgentBuilderMemory } from "@/lib/negotiation-agent-builder-types";
import { extractCriteriaChips } from "../negotiation-agent-builder-chat";

/** A HARD check that nonetheless offers an explicit waiver — the trap case. */
const TITLE_STATUS: CategoryChoiceQuestion = {
  checkId: "title_status",
  question: "Title status?",
  questionKo: "차량 명의 상태는?",
  enforcement: "hard",
  options: [
    { label: "Clean title only", stance: "clean title", requirement: "required" },
    { label: "Doesn't matter", stance: "any title status", requirement: "optional" },
  ],
};

const STORAGE: CategoryChoiceQuestion = {
  checkId: "storage_capacity",
  question: "Storage?",
  questionKo: "저장 용량은?",
  enforcement: "soft",
  options: [{ label: "256GB+", stance: "at least 256gb", requirement: "optional" }],
};

const QUESTIONS = [TITLE_STATUS, STORAGE];

function memoryWith(
  criteria: NonNullable<NegotiationAgentBuilderMemory["categoryCriteria"]>,
): NegotiationAgentBuilderMemory {
  return {
    categoryInterest: "탐색 중",
    mustHave: [],
    avoid: [],
    riskStyle: "balanced",
    negotiationStyle: "balanced",
    openingTactic: "fair_market_anchor",
    questions: [],
    source: [],
    categoryCriteria: criteria,
  } as NegotiationAgentBuilderMemory;
}

describe("extractCriteriaChips", () => {
  it("turns a tapped answer into a chip labelled with the tapped option", () => {
    const chips = extractCriteriaChips(
      memoryWith([
        {
          checkId: "title_status",
          questionKo: "차량 명의 상태는?",
          enforcement: "hard",
          requirement: "required",
          stance: "clean title",
        },
      ]),
      QUESTIONS,
    );
    expect(chips).toHaveLength(1);
    expect(chips[0]?.label).toBe("⛔ Clean title only");
    expect(chips[0]?.category).toBe("constraint");
  });

  it("renders a WAIVER on a hard check as a preference, not a red deal-breaker", () => {
    // Tone must follow the option's requirement. Keying off the check's `enforcement`
    // would paint "Doesn't matter" as a deal-breaker — the opposite of the choice.
    const chips = extractCriteriaChips(
      memoryWith([
        {
          checkId: "title_status",
          questionKo: "차량 명의 상태는?",
          enforcement: "hard",
          requirement: "optional",
          stance: "any title status",
        },
      ]),
      QUESTIONS,
    );
    expect(chips[0]?.label).toBe("✅ Doesn't matter");
    expect(chips[0]?.category).toBe("preference");
  });

  it("chips an optional soft preference too, so every tap leaves a trace", () => {
    const chips = extractCriteriaChips(
      memoryWith([
        {
          checkId: "storage_capacity",
          questionKo: "저장 용량은?",
          enforcement: "soft",
          requirement: "optional",
          stance: "at least 256gb",
        },
      ]),
      QUESTIONS,
    );
    expect(chips[0]?.label).toBe("✅ 256GB+");
  });

  it("ignores a criterion whose stance came from free text, not a tap", () => {
    // The LLM sets stances the picker never offered; those already surface via
    // mustHave/dealBreakers, so inventing a chip here would double-count them.
    const chips = extractCriteriaChips(
      memoryWith([
        {
          checkId: "title_status",
          questionKo: "차량 명의 상태는?",
          enforcement: "hard",
          requirement: "required",
          stance: "rebuilt title with paperwork",
        },
      ]),
      QUESTIONS,
    );
    expect(chips).toEqual([]);
  });

  it("ignores an unanswered criterion (no stance yet)", () => {
    const chips = extractCriteriaChips(
      memoryWith([
        {
          checkId: "title_status",
          questionKo: "차량 명의 상태는?",
          enforcement: "hard",
          requirement: "required",
        },
      ]),
      QUESTIONS,
    );
    expect(chips).toEqual([]);
  });

  it("returns nothing when the item has no quick-setup questions at all", () => {
    const chips = extractCriteriaChips(
      memoryWith([
        {
          checkId: "title_status",
          questionKo: "차량 명의 상태는?",
          enforcement: "hard",
          requirement: "required",
          stance: "clean title",
        },
      ]),
      [],
    );
    expect(chips).toEqual([]);
  });

  it("keeps one chip per check when an answer is changed", () => {
    // applyChoice upserts by check id, so a re-tap replaces rather than appends.
    const chips = extractCriteriaChips(
      memoryWith([
        {
          checkId: "title_status",
          questionKo: "차량 명의 상태는?",
          enforcement: "hard",
          requirement: "optional",
          stance: "any title status",
        },
        {
          checkId: "storage_capacity",
          questionKo: "저장 용량은?",
          enforcement: "soft",
          requirement: "optional",
          stance: "at least 256gb",
        },
      ]),
      QUESTIONS,
    );
    expect(chips.map((c) => c.label)).toEqual(["✅ Doesn't matter", "✅ 256GB+"]);
  });
});
