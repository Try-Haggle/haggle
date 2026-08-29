import { describe, expect, it } from "vitest";
import { ElectronicsKnowledgeSkill } from "../../skills/electronics-knowledge.js";
import { collectSkillSlots, encodeSkillSlots, looksLikeFixedDollarTable } from "../skill-slots.js";

describe("encodeSkillSlots", () => {
  it("always opens a Skills home even when empty", () => {
    const text = encodeSkillSlots({});
    expect(text).toContain("## Skills");
    expect(text).toContain("The safety envelope, floor, and HARD criteria still win");
    expect(text).toContain("No skill body this round");
    expect(text).not.toContain("### Knowledge");
  });

  it("labels filled slots and drops empty ones", () => {
    const text = encodeSkillSlots({
      knowledge: ["Category: phones"],
      valuation: ["Battery below 80% usually moves price"],
      tactics: ["condition_trade"],
      advisor: ["advisor-v1: tactic nibble"],
      market: ["hfmi_L2: $620 (advisory)"],
      constraints: ["HARD IMEI_REQUIRED: verify before close"],
      tone: ["Professional. Cite condition terms."],
      services: [],
    });
    expect(text).toContain("### Knowledge");
    expect(text).toContain("### Valuation");
    expect(text).toContain("### Tactics");
    expect(text).toContain("### Advisor");
    expect(text).toContain("### Market");
    expect(text).toContain("### Constraints");
    expect(text).toContain("### Tone");
    expect(text).not.toContain("### Services");
    expect(text).toContain("A Market dollar may move your number");
  });
});

describe("collectSkillSlots", () => {
  it("folds electronics decide + validate hooks into slots", async () => {
    const skill = new ElectronicsKnowledgeSkill();
    const decide = await skill.onHook({
      stage: "decide",
      memory: {} as never,
      recentFacts: [],
      opponentPattern: null,
      phase: "BARGAINING",
    });
    const validate = await skill.onHook({
      stage: "validate",
      memory: {} as never,
      recentFacts: [],
      opponentPattern: null,
      phase: "BARGAINING",
    });
    const respond = await skill.onHook({
      stage: "respond",
      memory: {} as never,
      recentFacts: [],
      opponentPattern: null,
      phase: "BARGAINING",
    });

    const slots = collectSkillSlots({
      llmContext: "This tag opened HARD/SOFT cards above.",
      decide: {
        categoryBrief: String(decide.content.categoryBrief ?? ""),
        valuationRules: decide.content.valuationRules as string[],
        tactics: decide.content.tactics as string[],
      },
      validate: {
        hardRules:
          (validate.content.hardRules as Array<{ rule: string; description: string }>) ?? [],
        softRules:
          (validate.content.softRules as Array<{ rule: string; description: string }>) ?? [],
      },
      market: ["hfmi_L2: $620 (advisory)"],
      toneGuidance: String((respond.content as { toneGuidance?: string }).toneGuidance ?? ""),
    });

    const text = encodeSkillSlots(slots);
    expect(text).toContain("Consumer Electronics");
    expect(text).toContain("condition_trade");
    expect(text).toContain("HARD IMEI_REQUIRED");
    expect(text).toContain("SOFT BATTERY_DISCLOSURE");
    expect(text).toContain("hfmi_L2: $620");
    expect(text).toContain("Professional");
    expect(slots.valuation?.every((line) => !looksLikeFixedDollarTable(line))).toBe(true);
  });

  it("drops category dollar tables from Valuation, including other categories", () => {
    const slots = collectSkillSlots({
      decide: {
        valuationRules: [
          "More storage is usually worth more.",
          "Each storage tier adds ~$50-80 to value. 128GB is baseline.",
          "Each size step adds $40.",
          "Mileage bands: -$200 per 10k miles.",
        ],
      },
    });
    expect(slots.valuation).toEqual(["More storage is usually worth more."]);
    expect(encodeSkillSlots(slots)).not.toMatch(/\$\s*\d/);
  });

  it("folds product retail lines into Market, not Valuation", () => {
    const slots = collectSkillSlots({
      decide: {
        valuationRules: ["More storage is usually worth more."],
        marketLines: [
          "iPhone 15 Pro new (Apple US launch MSRP, 2023-09): 128GB $999 · 256GB $1099",
          "This copy is 256GB — new was $1099. Advisory. Not the opening or the settlement.",
        ],
      },
    });
    expect(slots.market?.some((line) => line.includes("128GB $999"))).toBe(true);
    expect(slots.valuation?.some((line) => line.includes("$999"))).toBe(false);
    expect(encodeSkillSlots(slots)).toContain("### Market");
  });

  it("labels advisor prices as advisory dollars", () => {
    const slots = collectSkillSlots({
      decide: {
        advisories: [
          {
            skillId: "price-advisor-v1",
            recommendedPrice: 62000,
            suggestedTactic: "nibble",
          },
        ],
      },
    });
    expect(slots.advisor).toEqual([
      "price-advisor-v1: curve pace $620.00 this round (advisory — not the deal price)",
      "price-advisor-v1: tactic nibble",
    ]);
  });
});
