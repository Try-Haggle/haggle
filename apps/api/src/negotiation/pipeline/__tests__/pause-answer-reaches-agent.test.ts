/**
 * Does answering a pause actually change the negotiation?
 *
 * The buyer is asked because the seller made something non-negotiable. If the answer
 * only lands in a snapshot and never reaches the agent's prompt, the pause is theatre —
 * it costs the user a decision and buys nothing. This walks the real path: the answer is
 * applied to the buyer's criteria, then the same criteria are encoded for DECIDE.
 */

import type { CategoryCriterion } from "@haggle/shared";
import { describe, expect, it } from "vitest";
import { encodeStrategyContext } from "../../adapters/deepseek-adapter.js";
import { applyBuyerPauseAnswer } from "../../phase/seller-criteria-pause.js";
import type { CoreMemory } from "../../types.js";

const REQUIRED: CategoryCriterion[] = [
  {
    checkId: "bed_bugs",
    questionKo: "빈대 흔적이 없는지 검사받았나요?",
    buyerAskKo: "Should the agent require it inspected clear of bed bugs?",
    enforcement: "hard",
    requirement: "required",
  },
  {
    checkId: "mold_mildew",
    questionKo: "곰팡이가 없나요?",
    buyerAskKo: "Should the agent require no mold/mildew?",
    enforcement: "hard",
    requirement: "required",
  },
];

describe("a pause answer is applied per check", () => {
  it("records a DIFFERENT stance for each question", () => {
    // One shared string would have written the same answer to both.
    const { buyerSnapshot, applied } = applyBuyerPauseAnswer(
      { buyer_negotiation_agent_builder_memory: { categoryCriteria: [] } },
      REQUIRED,
      new Map([
        ["bed_bugs", "inspected clear of bed bugs"],
        ["mold_mildew", "no mold-mildew preference"],
      ]),
      undefined,
    );
    expect(applied).toBe(2);
    const criteria = (
      buyerSnapshot.buyer_negotiation_agent_builder_memory as {
        categoryCriteria: CategoryCriterion[];
      }
    ).categoryCriteria;
    expect(criteria.find((c) => c.checkId === "bed_bugs")?.stance).toBe(
      "inspected clear of bed bugs",
    );
    expect(criteria.find((c) => c.checkId === "mold_mildew")?.stance).toBe(
      "no mold-mildew preference",
    );
  });
});

describe("the answered criteria reach the agent's prompt", () => {
  function memoryWithCriteria(criteria: CategoryCriterion[]): CoreMemory {
    return {
      strategy_context: {
        negotiation_agent_builder_memory: { categoryCriteria: criteria },
      },
    } as unknown as CoreMemory;
  }

  it("encodes the stance the buyer chose into the DECIDE strategy block", () => {
    const encoded = encodeStrategyContext(
      memoryWithCriteria([{ ...REQUIRED[0]!, stance: "inspected clear of bed bugs" }]),
    );
    expect(encoded).toContain("inspected clear of bed bugs");
  });

  it("encodes each answer separately when several checks were answered", () => {
    // The whole point of per-check stances: two questions, two different answers.
    const encoded = encodeStrategyContext(
      memoryWithCriteria([
        { ...REQUIRED[0]!, stance: "inspected clear of bed bugs" },
        { ...REQUIRED[1]!, stance: "no mold-mildew preference" },
      ]),
    );
    expect(encoded).toContain("inspected clear of bed bugs");
    expect(encoded).toContain("no mold-mildew preference");
  });

  it("omits a requirement the buyer has not answered", () => {
    // Nothing to tell the agent yet — and it must not look answered.
    const encoded = encodeStrategyContext(memoryWithCriteria([{ ...REQUIRED[0]! }]));
    expect(encoded ?? "").not.toContain("= ");
  });
});
