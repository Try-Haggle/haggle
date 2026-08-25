import { describe, expect, it } from "vitest";
import { ElectronicsKnowledgeSkill } from "../../skills/electronics-knowledge.js";
import { collectSkillSlots, encodeSkillSlots } from "../skill-slots.js";

describe("encodeSkillSlots", () => {
  it("always opens a Skills home even when empty", () => {
    const text = encodeSkillSlots({});
    expect(text).toContain("## Skills");
    expect(text).toContain("BOX, floor, and HARD criteria still win");
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
    expect(text).toContain("Do not quote a skill dollar hint as your floor");
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
      "price-advisor-v1: suggested $620.00 (advisory)",
      "price-advisor-v1: tactic nibble",
    ]);
  });
});
