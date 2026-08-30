import { describe, expect, it } from "vitest";
import { encodeCriteriaFewShot } from "../criteria-fewshot.js";
import { buildDecideSystemPrompt } from "../decide-system-prompt.js";
import { encodeTagFamilyFewShot } from "../tag-family-fewshot.js";

describe("criteria few-shot", () => {
  it("keeps the same legend for phones, clothing, and empty listings", () => {
    const phone = encodeTagFamilyFewShot({ tags: ["iphone-17-pro"] });
    const clothing = encodeTagFamilyFewShot({ tags: ["hoodie"], category: "clothing" });
    const empty = encodeTagFamilyFewShot();
    expect(phone).toContain("Criteria — what you are looking at");
    expect(clothing).toContain("Criteria — what you are looking at");
    expect(empty).toContain("Criteria — what you are looking at");
    expect(phone).toContain("HARD means:");
    expect(phone).toContain("SOFT means:");
    expect(phone).toContain("HOLD = pause this close");
    expect(phone).toContain("LISTING.sellerStatedFacts");
    expect(phone).toContain("STRATEGY.requiredCriteria");
    expect(phone).toContain("No script");
  });

  it("sends one card per opened criterion on an iPhone 17 Pro tag", () => {
    const phone = encodeCriteriaFewShot({
      category: "electronics",
      tags: ["iphone-17-pro"],
    });
    expect(phone).toContain("## Criteria cards — this tag");
    expect(phone).toContain("HARD find_my_status");
    expect(phone).toContain("Meaning:");
    expect(phone).toContain("Your move:");
    expect(phone).toContain("What to say:");
    expect(phone).toContain("HARD imei_verification");
    expect(phone).toContain("SOFT battery_health");
    expect(phone).toContain("SOFT storage_capacity");
    expect(phone).toContain("hnp.issue.condition.battery_health");
    expect(phone).toContain("no HNP core issue");
    expect(phone).not.toMatch(/SOFT storage_capacity[\s\S]*\$\d/);
    expect(phone).not.toContain("electronics/phones/iphone");
  });

  it("does not put phone gates on clothing", () => {
    const clothing = encodeCriteriaFewShot({ tags: ["hoodie"], category: "clothing" });
    expect(clothing).not.toContain("find_my_status");
    expect(clothing).not.toContain("imei_verification");
    expect(clothing).toContain("SOFT size —");
  });

  it("puts the per-criterion cards into every Decide system prompt", () => {
    const prompt = buildDecideSystemPrompt("skill context", "seller", {
      category: "electronics",
      tags: ["iphone-17-pro"],
    });
    expect(prompt).toContain("You speak HNP");
    expect(prompt).toContain("Never quote your floor, target, BOX");
    expect(prompt).toContain("Criteria — what you are looking at");
    expect(prompt).toContain("HARD find_my_status");
    expect(prompt).toContain("SOFT battery_health");
    expect(prompt).toContain("skill context");
    expect(prompt).not.toContain("electronics/phones/samsung");
  });
});
