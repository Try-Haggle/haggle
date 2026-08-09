import { type CategoryCriterion, unresolvedSellerRequirements } from "@haggle/shared";
import { describe, expect, it } from "vitest";
import {
  applyBuyerPauseAnswer,
  detectSellerCriteriaPause,
  readSellerCriteriaFromSnapshot,
} from "../seller-criteria-pause.js";

function criterion(overrides: Partial<CategoryCriterion> & { checkId: string }): CategoryCriterion {
  return {
    questionKo: "q",
    enforcement: "hard",
    requirement: "required",
    ...overrides,
  };
}

const SELLER_REQUIRED: CategoryCriterion[] = [
  criterion({
    checkId: "title_status",
    questionKo: "명의/소유권(등록증)이 명확한가요?",
    buyerAskKo: "Should the agent only consider clean-title vehicles?",
  }),
];

describe("detectSellerCriteriaPause", () => {
  it("pauses when the buyer never addressed a seller-required criterion", () => {
    const pause = detectSellerCriteriaPause({
      responderRole: "buyer",
      sellerRequired: SELLER_REQUIRED,
      buyerCriteria: [],
      round: 2,
    });
    expect(pause).not.toBeNull();
    expect(pause?.question).toBe("Should the agent only consider clean-title vehicles?");
    expect(pause?.unresolvedCheckIds).toEqual(["title_status"]);
  });

  it("does not pause once the buyer has a stance on the requirement", () => {
    const pause = detectSellerCriteriaPause({
      responderRole: "buyer",
      sellerRequired: SELLER_REQUIRED,
      buyerCriteria: [criterion({ checkId: "title_status", stance: "clean only" })],
      round: 2,
    });
    expect(pause).toBeNull();
  });

  it("never pauses the seller's turn (the pause only asks the buyer)", () => {
    const pause = detectSellerCriteriaPause({
      responderRole: "seller",
      sellerRequired: SELLER_REQUIRED,
      buyerCriteria: [],
      round: 5,
    });
    expect(pause).toBeNull();
  });

  it("does not pause before minRound (the opening round)", () => {
    expect(
      detectSellerCriteriaPause({
        responderRole: "buyer",
        sellerRequired: SELLER_REQUIRED,
        buyerCriteria: [],
        round: 1,
      }),
    ).toBeNull();
  });

  it("does not pause when the seller declared no required criteria (pre-Phase-G safe)", () => {
    expect(
      detectSellerCriteriaPause({
        responderRole: "buyer",
        sellerRequired: [],
        buyerCriteria: [],
        round: 4,
      }),
    ).toBeNull();
  });

  it("falls back to questionKo when a requirement has no buyerAskKo", () => {
    const pause = detectSellerCriteriaPause({
      responderRole: "buyer",
      sellerRequired: [
        criterion({ checkId: "service_history", questionKo: "정비 이력이 있나요?" }),
      ],
      buyerCriteria: [],
      round: 3,
    });
    expect(pause?.question).toBe("정비 이력이 있나요?");
  });

  it("is a no-op for a non-finite round", () => {
    expect(
      detectSellerCriteriaPause({
        responderRole: "buyer",
        sellerRequired: SELLER_REQUIRED,
        buyerCriteria: [],
        round: Number.NaN,
      }),
    ).toBeNull();
  });

  it("reports every unresolved requirement but asks the first", () => {
    const pause = detectSellerCriteriaPause({
      responderRole: "buyer",
      sellerRequired: [
        criterion({ checkId: "title_status", buyerAskKo: "clean title?" }),
        criterion({ checkId: "service_history", buyerAskKo: "service history?" }),
      ],
      buyerCriteria: [criterion({ checkId: "service_history", stance: "yes" })],
      round: 2,
    });
    // service_history answered → only title_status unresolved.
    expect(pause?.unresolvedCheckIds).toEqual(["title_status"]);
    expect(pause?.question).toBe("clean title?");
  });

  it("lists ALL unresolved requirements' questions (surfaced together)", () => {
    const pause = detectSellerCriteriaPause({
      responderRole: "buyer",
      sellerRequired: [
        criterion({ checkId: "title_status", buyerAskKo: "clean title?" }),
        criterion({ checkId: "coa_authenticity", buyerAskKo: "authentic?" }),
      ],
      buyerCriteria: [],
      round: 2,
    });
    expect(pause?.questions).toEqual(["clean title?", "authentic?"]);
    expect(pause?.question).toBe("clean title?"); // first, for single-question consumers
  });
});

describe("Flow 3 resume — readSellerCriteriaFromSnapshot + applyBuyerPauseAnswer", () => {
  function buyerSnapshot(buyerCriteria: CategoryCriterion[]): Record<string, unknown> {
    return {
      pause_seller_required_criteria: [
        {
          checkId: "title_status",
          questionKo: "명의/소유권(등록증)이 명확한가요?",
          buyerAskKo: "Should the agent only consider clean-title vehicles?",
          enforcement: "hard",
          requirement: "required",
        },
      ],
      buyer_negotiation_agent_builder_memory: { categoryCriteria: buyerCriteria },
    };
  }

  it("reads seller-required + buyer criteria off the snapshot", () => {
    const { sellerRequired, buyerCriteria } = readSellerCriteriaFromSnapshot(buyerSnapshot([]));
    expect(sellerRequired.map((c) => c.checkId)).toEqual(["title_status"]);
    expect(buyerCriteria).toEqual([]);
  });

  it("applies a fallback answer → the unresolved set empties (negotiation can resume)", () => {
    const snap = buyerSnapshot([]);
    const { sellerRequired } = readSellerCriteriaFromSnapshot(snap);
    const unresolvedBefore = unresolvedSellerRequirements(sellerRequired, []);
    expect(unresolvedBefore.map((c) => c.checkId)).toEqual(["title_status"]);

    const { buyerSnapshot: updated, applied } = applyBuyerPauseAnswer(
      snap,
      unresolvedBefore,
      new Map(),
      "yes, clean title only",
    );
    expect(applied).toBe(1);

    const after = readSellerCriteriaFromSnapshot(updated);
    const stance = after.buyerCriteria.find((c) => c.checkId === "title_status")?.stance;
    expect(stance).toBe("yes, clean title only");
    // The resume condition: no more unresolved seller requirements.
    expect(unresolvedSellerRequirements(after.sellerRequired, after.buyerCriteria)).toEqual([]);
  });

  it("explicit per-check stance wins over the fallback and updates an existing criterion", () => {
    const snap = buyerSnapshot([
      {
        checkId: "title_status",
        questionKo: "명의/소유권(등록증)이 명확한가요?",
        enforcement: "hard",
        requirement: "required",
      },
    ]);
    const { sellerRequired } = readSellerCriteriaFromSnapshot(snap);
    const unresolved = unresolvedSellerRequirements(sellerRequired, []);
    const { buyerSnapshot: updated } = applyBuyerPauseAnswer(
      snap,
      unresolved,
      new Map([["title_status", "clean only, verified"]]),
      "ignored fallback",
    );
    const after = readSellerCriteriaFromSnapshot(updated);
    expect(after.buyerCriteria.find((c) => c.checkId === "title_status")?.stance).toBe(
      "clean only, verified",
    );
    // No duplicate criterion created for the same check id.
    expect(after.buyerCriteria.filter((c) => c.checkId === "title_status")).toHaveLength(1);
  });

  it("applies nothing when neither stance nor fallback is given", () => {
    const snap = buyerSnapshot([]);
    const { sellerRequired } = readSellerCriteriaFromSnapshot(snap);
    const unresolved = unresolvedSellerRequirements(sellerRequired, []);
    const { applied } = applyBuyerPauseAnswer(snap, unresolved, new Map(), undefined);
    expect(applied).toBe(0);
  });
});
