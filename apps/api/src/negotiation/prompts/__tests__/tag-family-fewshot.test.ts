import { enrichTagsWithTaxonomy } from "@haggle/shared";
import { afterEach, describe, expect, it } from "vitest";
import { encodeCriteriaFewShot, setDecideFewShotMode } from "../criteria-fewshot.js";
import { buildDecideSystemPrompt } from "../decide-system-prompt.js";
import { encodeTagFamilyFewShot } from "../tag-family-fewshot.js";

describe("criteria few-shot", () => {
  afterEach(() => {
    setDecideFewShotMode("on");
  });

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
    expect(phone).toContain("not a storage-adjusted price");
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

  it("uses the same unadjusted-ask SOFT rule for phones, clothing, and vehicles", () => {
    const phone = encodeTagFamilyFewShot({ tags: ["iphone-17-pro"] });
    const clothing = encodeTagFamilyFewShot({ tags: ["hoodie"], category: "clothing" });
    const vehicles = encodeTagFamilyFewShot({ tags: ["sedan"], category: "vehicles" });
    for (const text of [phone, clothing, vehicles]) {
      expect(text).toContain("The published ask is not already adjusted for SOFT answers");
      expect(text).toContain("Price THIS copy from supply and demand");
      expect(text).toContain("No $/step table and no rank placement");
      expect(text).not.toContain("storageScale");
      expect(text).not.toContain("$50-80");
    }
    expect(clothing).toContain("not already size-adjusted");
    expect(vehicles).toContain("not already mileage-adjusted");
    const hoodiePrompt = buildDecideSystemPrompt("", "buyer", {
      tags: ["hoodie"],
      category: "clothing",
    });
    const sedanPrompt = buildDecideSystemPrompt("", "buyer", {
      tags: ["sedan"],
      category: "vehicles",
    });
    expect(hoodiePrompt).toContain("The published ask is not already adjusted for SOFT answers");
    expect(sedanPrompt).toContain("The published ask is not already adjusted for SOFT answers");
    expect(hoodiePrompt).not.toContain("storageScale");
    expect(sedanPrompt).not.toContain("storageScale");
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

  it("opens storage_capacity cards when the listing is tagged like a staging iPhone", () => {
    const { tags } = enrichTagsWithTaxonomy(
      ["electronics", "iphone-15-pro", "128gb"],
      "iPhone 15 Pro 128GB",
    );
    expect(tags).toEqual(expect.arrayContaining(["electronics", "iphone-15-pro"]));
    const cards = encodeCriteriaFewShot({ category: "electronics", tags });
    expect(cards).toContain("SOFT storage_capacity");
    expect(cards).toContain("HARD find_my_status");
    expect(cards).toContain("HARD imei_verification");
  });

  it("can turn criteria cards off for A/B labs without changing production default", () => {
    const listing = { category: "electronics", tags: ["iphone-17-pro"] };
    expect(encodeCriteriaFewShot(listing)).toContain("SOFT storage_capacity");

    setDecideFewShotMode("off");
    expect(encodeCriteriaFewShot(listing)).toBe("");
    const offPrompt = buildDecideSystemPrompt("skill context", "seller", listing);
    expect(offPrompt).not.toContain("SOFT storage_capacity");
    expect(offPrompt).not.toContain("Criteria — what you are looking at");
    expect(offPrompt).toContain("You speak HNP");

    setDecideFewShotMode("on");
    expect(encodeCriteriaFewShot(listing)).toContain("SOFT storage_capacity");
  });

  it("keeps the shared legend and changes only the cards by product tag", () => {
    const phone = buildDecideSystemPrompt("", "buyer", { tags: ["iphone-17-pro"] });
    const hoodie = buildDecideSystemPrompt("", "buyer", {
      tags: ["hoodie"],
      category: "clothing",
    });
    const phoneLegend = phone.slice(
      phone.indexOf("## HARD vs SOFT"),
      phone.indexOf("## Criteria cards"),
    );
    const hoodieLegend = hoodie.slice(
      hoodie.indexOf("## HARD vs SOFT"),
      hoodie.indexOf("## Criteria cards"),
    );
    expect(phoneLegend).toBe(hoodieLegend);
    expect(phone).toContain("SOFT storage_capacity");
    expect(hoodie).toContain("SOFT size —");
    expect(hoodie).not.toContain("SOFT storage_capacity");
  });

  it("puts the same SOFT supply-and-demand rule on buyer and seller", () => {
    const listing = { category: "electronics", tags: ["iphone-15-pro"] };
    const buyer = buildDecideSystemPrompt("", "buyer", listing);
    const seller = buildDecideSystemPrompt("", "seller", listing);
    expect(buyer).toContain("You are the BUYER");
    expect(seller).toContain("You are the SELLER");
    expect(buyer).toContain("Price THIS copy from supply and demand");
    expect(seller).toContain("Price THIS copy from supply and demand");
    expect(buyer.indexOf("## Protocol")).toBe(0);
    expect(buyer.indexOf("## Output")).toBeLessThan(buyer.indexOf("## Role"));
    expect(buyer.indexOf("## Role")).toBeGreaterThan(buyer.indexOf("SOFT storage_capacity"));
    expect(buyer.slice(0, buyer.indexOf("## Role"))).toBe(
      seller.slice(0, seller.indexOf("## Role")),
    );
  });
});
