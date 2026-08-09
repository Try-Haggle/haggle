import { describe, expect, it } from "vitest";
import {
  buildAdvisorRequirementPlan,
  resolveTagGardenQuestionForSlot,
} from "../services/tag-garden-requirements.js";

const iphoneListings = [
  {
    title: "iPhone 14 Pro 256GB Space Black",
    condition: "battery 94%, clean IMEI, original box included",
    tags: ["electronics/phones/iphone", "battery_90_plus", "box_included"],
  },
];

function memory(
  overrides: Partial<Parameters<typeof buildAdvisorRequirementPlan>[0]["memory"]> = {},
) {
  return {
    categoryInterest: "iPhone Pro 중고",
    mustHave: [],
    avoid: [],
    source: [],
    ...overrides,
  };
}

describe("Tag Garden advisor requirements", () => {
  it("generalizes beyond iPhone: a vehicles listing gets taxonomy requirement slots (no IMEI)", () => {
    const plan = buildAdvisorRequirementPlan({
      memory: memory({
        categoryInterest: "중고차 알아보는 중",
        budgetMax: 10000,
        source: ["예산은 만 달러 정도"],
      }),
      listings: [
        {
          title: "2019 Toyota Camry",
          condition: "clean title, 40k miles",
          tags: ["toyota-camry", "sedan"],
          category: "vehicles",
        },
      ],
    });
    const ids = plan.requiredSlots.map((s) => s.slotId);
    expect(ids).toContain("mileage");
    expect(ids).toContain("title_status");
    expect(ids).not.toContain("imei_verification");
    // SAT: the taxonomy HARD gate (vehicle title) now blocks so the builder actually
    // asks it; advisory checks (mileage/service) stay soft.
    const enforcementBySlot = new Map(
      plan.requiredSlots
        .filter((s) => s.tagPath === "taxonomy")
        .map((s) => [s.slotId, s.enforcement]),
    );
    expect(enforcementBySlot.get("title_status")).toBe("hard");
    expect(enforcementBySlot.get("mileage")).toBe("soft");
    expect(plan.blockingSlots.map((s) => s.slotId)).toContain("title_status");
  });

  const vehicleListing = {
    title: "2019 Toyota Camry",
    condition: "clean title, 40k miles",
    tags: ["toyota-camry", "sedan"],
    category: "vehicles",
  };

  it("vehicle title gate CLEARS once the buyer addresses it — no wedge", () => {
    const plan = buildAdvisorRequirementPlan({
      memory: memory({
        categoryInterest: "중고차 알아보는 중",
        budgetMax: 10000,
        source: ["명의/등록증 깨끗한 걸로 볼게요"],
      }),
      listings: [vehicleListing],
    });
    expect(plan.blockingSlots.map((s) => s.slotId)).not.toContain("title_status");
  });

  it("vehicle title gate CLEARS when the buyer waves it off (no-preference) — no wedge", () => {
    const plan = buildAdvisorRequirementPlan({
      memory: memory({
        categoryInterest: "중고차 알아보는 중",
        budgetMax: 10000,
        source: ["명의는 상관없어요"],
      }),
      listings: [vehicleListing],
    });
    expect(plan.blockingSlots.map((s) => s.slotId)).not.toContain("title_status");
  });

  const iphoneTaxonomyListing = {
    title: "iPhone 15 Pro 256GB",
    condition: "good",
    tags: ["iphone-15-pro"],
    category: "electronics",
  };

  it("iPhone via taxonomy: IMEI/Find My gates BLOCK (asked) but are satisfiable — no wedge", () => {
    const unanswered = buildAdvisorRequirementPlan({
      memory: memory({ categoryInterest: "electronics", budgetMax: 800, source: ["예산 800"] }),
      listings: [iphoneTaxonomyListing],
    });
    // Now the gate is asked (blocks) — that is the point of SAT.
    expect(unanswered.blockingSlots.map((s) => s.slotId)).toContain("imei_verification");

    // …and answering it clears the block (no infinite re-ask).
    const answered = buildAdvisorRequirementPlan({
      memory: memory({
        categoryInterest: "electronics",
        budgetMax: 800,
        source: ["imei 깨끗한지랑 아이클라우드 해제됐는지 확인할게요"],
      }),
      listings: [iphoneTaxonomyListing],
    });
    expect(answered.blockingSlots.map((s) => s.slotId)).not.toContain("imei_verification");
    expect(answered.blockingSlots.map((s) => s.slotId)).not.toContain("find_my_status");
  });

  it("clothing authenticity gate blocks then clears when addressed — no wedge", () => {
    const clothing = {
      title: "Nike Air Jordan 1",
      condition: "good",
      tags: ["jordan", "sneakers"],
      category: "fashion",
    };
    const unanswered = buildAdvisorRequirementPlan({
      memory: memory({ categoryInterest: "신발", budgetMax: 300, source: ["예산 300"] }),
      listings: [clothing],
    });
    expect(unanswered.blockingSlots.map((s) => s.slotId)).toContain("authenticity");

    const answered = buildAdvisorRequirementPlan({
      memory: memory({
        categoryInterest: "신발",
        budgetMax: 300,
        source: ["정품 택이랑 영수증 있어야 해요"],
      }),
      listings: [clothing],
    });
    expect(answered.blockingSlots.map((s) => s.slotId)).not.toContain("authenticity");
  });

  it("does NOT re-ask a taxonomy gate already asked last turn, whatever the buyer replied (ask once)", () => {
    // Buyer answered the title gate with "rebuilt is okay" — a real answer that lacks
    // the topic keyword. Without ask-once, keyword matching would re-ask "clean title?"
    // and contradict them. askedQuestions carries the gate's question from last turn.
    const plan = buildAdvisorRequirementPlan({
      memory: memory({ categoryInterest: "중고차", budgetMax: 10000, source: ["rebuilt is okay"] }),
      listings: [vehicleListing],
      askedQuestions: ["Should the agent only consider clean-title vehicles?"],
    });
    expect(plan.blockingSlots.map((s) => s.slotId)).not.toContain("title_status");
  });

  it("STILL asks a taxonomy gate that was never asked (ask-once does not suppress the first ask)", () => {
    const plan = buildAdvisorRequirementPlan({
      memory: memory({ categoryInterest: "중고차", budgetMax: 10000, source: ["예산 만불"] }),
      listings: [vehicleListing],
      askedQuestions: [], // nothing asked yet
    });
    expect(plan.blockingSlots.map((s) => s.slotId)).toContain("title_status");
  });

  it("does NOT clear taxonomy safety gates on unrelated messages or a generic no-preference (fail-open guard)", () => {
    // Each of these buyer messages is about something ELSE; the gate must stay blocking.
    const stillBlocks = (
      listing: { title: string; condition: string; tags: string[]; category: string },
      slotId: string,
      source: string[],
    ) => {
      const plan = buildAdvisorRequirementPlan({
        memory: memory({ categoryInterest: "찾는 중", budgetMax: 1000, source }),
        listings: [listing],
      });
      expect(plan.blockingSlots.map((s) => s.slotId)).toContain(slotId);
    };

    // vehicle title: "이전에 봤던 차" (before) and a generic no-preference must NOT clear it.
    stillBlocks(vehicleListing, "title_status", ["이전에 봤던 차 알아봐줘"]);
    stillBlocks(vehicleListing, "title_status", ["딱히 조건 없어요"]);

    const clothing = {
      title: "Nike Air Jordan 1",
      condition: "good",
      tags: ["jordan", "sneakers"],
      category: "fashion",
    };
    // authenticity: "택배"(delivery) must NOT clear it.
    stillBlocks(clothing, "authenticity", ["택배로 받고 싶어요"]);

    // imei: general condition words must NOT clear it.
    stillBlocks(iphoneTaxonomyListing, "imei_verification", ["정상 작동하는 폰이면 좋겠어"]);
    stillBlocks(iphoneTaxonomyListing, "imei_verification", ["수리 이력 없는 걸로 보여줘"]);

    // find_my: carrier-unlock "잠금 해제" must NOT clear the iCloud gate.
    stillBlocks(iphoneTaxonomyListing, "find_my_status", ["통신사 잠금 해제된 걸로"]);
  });

  it("preserves the rich iPhone slots (taxonomy does not override the hardcoded map)", () => {
    const plan = buildAdvisorRequirementPlan({
      memory: memory({ budgetMax: 500, source: ["아이폰 예산 500"] }),
      listings: iphoneListings,
    });
    expect(plan.requiredSlots.map((s) => s.slotId)).toContain("battery_health");
    expect(plan.requiredSlots.every((s) => s.tagPath !== "taxonomy")).toBe(true);
  });

  it("starts with broad shopping intent before budget or model details", () => {
    const plan = buildAdvisorRequirementPlan({
      memory: memory({
        categoryInterest: "탐색 중",
      }),
      listings: [],
    });

    expect(plan.question).toBe("찾고 싶은 제품이나 상황을 편하게 말해주세요.");
    expect(plan.missingSlots[0]?.slotId).toBe("shopping_intent");
  });

  it("asks for budget before generic priorities after the product area is known", () => {
    const plan = buildAdvisorRequirementPlan({
      memory: memory({
        categoryInterest: "iPad 중고",
      }),
      listings: [],
    });

    expect(plan.question).toBe("대략적인 예산 범위는 어느 정도인가요?");
    expect(plan.missingSlots[0]?.slotId).toBe("max_budget");
  });

  it("does not apply iPhone required slots just because an iPhone exists in available listings", () => {
    const plan = buildAdvisorRequirementPlan({
      memory: memory({
        categoryInterest: "MacBook 중고",
      }),
      listings: iphoneListings,
    });

    expect(plan.matchedTags).toEqual([]);
    expect(plan.question).toBe("대략적인 예산 범위는 어느 정도인가요?");
  });

  it("does not treat box preference as satisfying iPhone battery or carrier slots", () => {
    const plan = buildAdvisorRequirementPlan({
      memory: memory({
        budgetMax: 500,
        mustHave: ["original box included"],
        source: ["최대 예산은 500 달러고 박스가 있으면 좋겠어"],
      }),
      listings: iphoneListings,
    });

    expect(plan.question).toBe(
      "중고폰은 배터리 성능에 따라 가격이 꽤 달라져요. 90% 이상만 볼까요, 85% 이상이면 괜찮을까요, 아니면 가격이 좋으면 80%대도 괜찮을까요?",
    );
    expect(plan.missingSlots.map((slot) => slot.slotId)).toEqual([
      "battery_health",
      "carrier_lock",
    ]);
    expect(plan.blockingSlots.map((slot) => slot.slotId)).toEqual([
      "battery_health",
      "carrier_lock",
    ]);
    expect(plan.hasBlockingMissingSlots).toBe(true);
  });

  it("requires an actual battery threshold, not just a vague battery mention", () => {
    const plan = buildAdvisorRequirementPlan({
      memory: memory({
        budgetMax: 500,
        mustHave: ["battery condition matters"],
        source: ["배터리가 중요해"],
      }),
      listings: iphoneListings,
    });

    expect(plan.question).toBe(
      "중고폰은 배터리 성능에 따라 가격이 꽤 달라져요. 90% 이상만 볼까요, 85% 이상이면 괜찮을까요, 아니면 가격이 좋으면 80%대도 괜찮을까요?",
    );
  });

  it("prioritizes hard iPhone slots before soft buyer-priority prompts", () => {
    const plan = buildAdvisorRequirementPlan({
      memory: memory({
        categoryInterest: "iPhone 15 Pro 중고",
        budgetMax: 700,
      }),
      listings: iphoneListings.map((listing) => ({
        ...listing,
        title: "iPhone 15 Pro 256GB Natural Titanium",
      })),
    });

    expect(plan.missingSlots.map((slot) => `${slot.slotId}:${slot.enforcement}`)).toEqual([
      "buyer_priority:soft",
      "battery_health:hard",
      "carrier_lock:hard",
    ]);
    expect(plan.nextSlot?.slotId).toBe("battery_health");
    expect(plan.question).toBe(
      "중고폰은 배터리 성능에 따라 가격이 꽤 달라져요. 90% 이상만 볼까요, 85% 이상이면 괜찮을까요, 아니면 가격이 좋으면 80%대도 괜찮을까요?",
    );
  });

  it("moves to carrier slot after a battery threshold is known", () => {
    const plan = buildAdvisorRequirementPlan({
      memory: memory({
        budgetMax: 500,
        mustHave: ["battery >= 90%"],
        source: ["배터리는 90% 이상이면 좋겠어"],
      }),
      listings: iphoneListings,
    });

    expect(plan.question).toBe("언락 모델이 필수인가요?");
  });

  it("does not let carrier no-preference evidence satisfy the battery hard slot", () => {
    const plan = buildAdvisorRequirementPlan({
      memory: memory({
        categoryInterest: "iPhone 16 Pro 중고",
        budgetMax: 900,
        mustHave: ["carrier no preference"],
        source: ["iPhone 16 Pro carrier no preference"],
      }),
      listings: [
        {
          title: "iPhone 16 Pro 256GB Natural Titanium",
          condition: "good",
          tags: ["electronics/phones/iphone"],
        },
      ],
    });

    expect(plan.nextSlot).toMatchObject({
      slotId: "battery_health",
      questionKo:
        "중고폰은 배터리 성능에 따라 가격이 꽤 달라져요. 90% 이상만 볼까요, 85% 이상이면 괜찮을까요, 아니면 가격이 좋으면 80%대도 괜찮을까요?",
    });
    expect(plan.missingSlots.map((slot) => slot.slotId)).toContain("battery_health");
    expect(plan.missingSlots.map((slot) => slot.slotId)).not.toContain("carrier_lock");
  });

  it("does not let broad no-additional-requirements evidence satisfy product hard slots", () => {
    const plan = buildAdvisorRequirementPlan({
      memory: memory({
        categoryInterest: "iPhone 16 Pro 중고",
        budgetMax: 900,
        source: ["no additional requirements"],
      }),
      listings: [
        {
          title: "iPhone 16 Pro 256GB Natural Titanium",
          condition: "good",
          tags: ["electronics/phones/iphone"],
        },
      ],
    });

    expect(plan.missingSlots.map((slot) => slot.slotId)).not.toContain("buyer_priority");
    expect(plan.missingSlots.map((slot) => slot.slotId)).toEqual([
      "battery_health",
      "carrier_lock",
    ]);
    expect(plan.nextSlot).toMatchObject({
      slotId: "battery_health",
    });
  });

  it("reconfirms hard slot memory when the product scope changed", () => {
    const plan = buildAdvisorRequirementPlan({
      memory: memory({
        categoryInterest: "iPhone 15 Pro 중고",
        budgetMax: 700,
        mustHave: ["battery >= 90%"],
        source: ["iPhone 13 Pro는 배터리 90% 이상이면 좋겠어"],
      }),
      listings: iphoneListings.map((listing) => ({
        ...listing,
        title: "iPhone 15 Pro 256GB Natural Titanium",
      })),
    });

    expect(plan.blockingSlots[0]).toMatchObject({
      slotId: "battery_health",
      enforcement: "hard",
      questionKo:
        "전에 iPhone 13 Pro에서 말한 배터리 조건을 iPhone 15 Pro에도 그대로 적용할까요, 아니면 다시 정할까요?",
    });
  });

  it("uses the latest source product as active scope when category interest contains multiple models", () => {
    const plan = buildAdvisorRequirementPlan({
      memory: memory({
        categoryInterest: "iPhone 13 Pro, iPhone 15 Pro",
        budgetMax: 700,
        mustHave: ["battery >= 90%"],
        source: ["iPhone 13 Pro는 배터리 90% 이상이면 좋겠어", "이번에는 iPhone 15 Pro도 볼게."],
      }),
      listings: [
        {
          title: "iPhone 13 Pro",
          condition: "good",
          tags: ["electronics/phones/iphone"],
        },
        {
          title: "iPhone 15 Pro 256GB Black",
          condition: "good",
          tags: ["electronics/phones/iphone"],
        },
      ],
    });

    expect(plan.nextSlot).toMatchObject({
      slotId: "battery_health",
      questionKo:
        "전에 iPhone 13 Pro에서 말한 배터리 조건을 iPhone 15 Pro에도 그대로 적용할까요, 아니면 다시 정할까요?",
    });
  });

  it("returns to the original hard slot question after scoped condition reuse is rejected", () => {
    const plan = buildAdvisorRequirementPlan({
      memory: memory({
        categoryInterest: "iPhone 13 Pro, iPhone 15 Pro",
        budgetMax: 700,
        mustHave: ["battery >= 90%"],
        source: ["iPhone 13 Pro는 배터리 90% 이상이면 좋겠어", "이번에는 iPhone 15 Pro도 볼게."],
        structured: {
          scopedConditionDecisions: [
            {
              slotId: "battery_health",
              sourceScope: "iPhone 13 Pro",
              targetScope: "iPhone 15 Pro",
              decision: "rejected",
            },
          ],
        },
      }),
      listings: [
        {
          title: "iPhone 13 Pro",
          condition: "good",
          tags: ["electronics/phones/iphone"],
        },
        {
          title: "iPhone 15 Pro 256GB Black",
          condition: "good",
          tags: ["electronics/phones/iphone"],
        },
      ],
    });

    expect(plan.nextSlot).toMatchObject({
      slotId: "battery_health",
      questionKo:
        "중고폰은 배터리 성능에 따라 가격이 꽤 달라져요. 90% 이상만 볼까요, 85% 이상이면 괜찮을까요, 아니면 가격이 좋으면 80%대도 괜찮을까요?",
    });
  });

  it("lets the latest scoped condition decision override an older rejection", () => {
    const plan = buildAdvisorRequirementPlan({
      memory: memory({
        categoryInterest: "iPhone 13 Pro, iPhone 15 Pro",
        budgetMax: 700,
        mustHave: ["battery >= 90%"],
        source: [
          "iPhone 13 Pro는 배터리 90% 이상이면 좋겠어",
          "이번에는 iPhone 15 Pro도 볼게.",
          "iPhone 15 Pro battery >= 90%",
        ],
        structured: {
          scopedConditionDecisions: [
            {
              slotId: "battery_health",
              sourceScope: "iPhone 13 Pro",
              targetScope: "iPhone 15 Pro",
              decision: "rejected",
            },
            {
              slotId: "battery_health",
              sourceScope: "iPhone 13 Pro",
              targetScope: "iPhone 15 Pro",
              decision: "applied",
            },
          ],
        },
      }),
      listings: [
        {
          title: "iPhone 13 Pro",
          condition: "good",
          tags: ["electronics/phones/iphone"],
        },
        {
          title: "iPhone 15 Pro 256GB Black",
          condition: "good",
          tags: ["electronics/phones/iphone"],
        },
      ],
    });

    expect(plan.missingSlots.map((slot) => slot.slotId)).not.toContain("battery_health");
    expect(plan.question).toBe("언락 모델이 필수인가요?");
  });

  it("lets direct active-scope evidence override an older scoped rejection", () => {
    const plan = buildAdvisorRequirementPlan({
      memory: memory({
        categoryInterest: "iPhone 13 Pro, iPhone 15 Pro",
        budgetMax: 700,
        mustHave: ["battery >= 90%"],
        source: [
          "iPhone 13 Pro는 배터리 90% 이상이면 좋겠어",
          "이번에는 iPhone 15 Pro도 볼게.",
          "iPhone 15 Pro는 battery >= 85%",
        ],
        structured: {
          scopedConditionDecisions: [
            {
              slotId: "battery_health",
              sourceScope: "iPhone 13 Pro",
              targetScope: "iPhone 15 Pro",
              decision: "rejected",
            },
          ],
        },
      }),
      listings: [
        {
          title: "iPhone 13 Pro",
          condition: "good",
          tags: ["electronics/phones/iphone"],
        },
        {
          title: "iPhone 15 Pro 256GB Black",
          condition: "good",
          tags: ["electronics/phones/iphone"],
        },
      ],
    });

    expect(plan.missingSlots.map((slot) => slot.slotId)).not.toContain("battery_health");
    expect(plan.question).toBe("언락 모델이 필수인가요?");
  });

  it("lets a newer product source override an older scoped condition decision", () => {
    const plan = buildAdvisorRequirementPlan({
      memory: memory({
        categoryInterest: "iPhone 13 Pro, iPhone 15 Pro, iPhone 16 Pro",
        budgetMax: 900,
        mustHave: ["battery >= 90%"],
        source: [
          "iPhone 13 Pro는 배터리 90% 이상이면 좋겠어",
          "이번에는 iPhone 15 Pro도 볼게.",
          "이번엔 iPhone 16 Pro도 같이 보자.",
        ],
        structured: {
          scopedConditionDecisions: [
            {
              slotId: "battery_health",
              sourceScope: "iPhone 13 Pro",
              targetScope: "iPhone 15 Pro",
              decision: "rejected",
            },
          ],
        },
      }),
      listings: [
        {
          title: "iPhone 15 Pro 256GB Black",
          condition: "good",
          tags: ["electronics/phones/iphone"],
        },
        {
          title: "iPhone 16 Pro 256GB Natural Titanium",
          condition: "good",
          tags: ["electronics/phones/iphone"],
        },
      ],
    });

    expect(plan.nextSlot).toMatchObject({
      slotId: "battery_health",
      questionKo:
        "전에 iPhone 13 Pro에서 말한 배터리 조건을 iPhone 16 Pro에도 그대로 적용할까요, 아니면 다시 정할까요?",
    });
  });

  it("does not reconfirm hard slot memory when the product scope matches", () => {
    const plan = buildAdvisorRequirementPlan({
      memory: memory({
        categoryInterest: "iPhone 15 Pro 중고",
        budgetMax: 700,
        mustHave: ["battery >= 90%"],
        source: ["iPhone 15 Pro는 배터리 90% 이상이면 좋겠어"],
      }),
      listings: iphoneListings.map((listing) => ({
        ...listing,
        title: "iPhone 15 Pro 256GB Natural Titanium",
      })),
    });

    expect(plan.missingSlots.map((slot) => slot.slotId)).not.toContain("battery_health");
    expect(plan.question).toBe("언락 모델이 필수인가요?");
  });

  it("resolves negotiation missing-info slots to Tag Garden questions", () => {
    expect(resolveTagGardenQuestionForSlot("battery_health")).toMatchObject({
      question:
        "중고폰은 배터리 성능에 따라 가격이 꽤 달라져요. 90% 이상만 볼까요, 85% 이상이면 괜찮을까요, 아니면 가격이 좋으면 80%대도 괜찮을까요?",
      slotId: "battery_health",
      enforcement: "hard",
      source: "tag_garden",
    });
    expect(resolveTagGardenQuestionForSlot("verification_status")).toMatchObject({
      question: "거래 확정 전에는 IMEI가 깨끗한지 확인해야 합니다.",
      slotId: "imei_verification",
      source: "tag_garden",
    });
    expect(resolveTagGardenQuestionForSlot("shipping_terms")).toMatchObject({
      tagPath: "terms/logistics",
      source: "tag_garden",
    });
  });
});
