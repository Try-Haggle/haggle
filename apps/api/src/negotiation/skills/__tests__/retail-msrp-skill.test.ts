import { afterEach, describe, expect, it } from "vitest";
import { collectSkillSlots, encodeSkillSlots } from "../../prompts/skill-slots.js";
import type { CoreMemory } from "../../types.js";
import {
  detectStorage,
  matchRetailFamily,
  retailMarketLinesForListing,
} from "../retail-msrp-catalog.js";
import {
  getRetailMsrpSkillMode,
  RetailMsrpSkill,
  setRetailMsrpSkillMode,
} from "../retail-msrp-skill.js";
import type { HookContext } from "../skill-types.js";

function memoryWithListing(listing: CoreMemory["listing_context"]): CoreMemory {
  return { listing_context: listing } as CoreMemory;
}

function decideCtx(listing: CoreMemory["listing_context"]): HookContext {
  return {
    stage: "decide",
    memory: memoryWithListing(listing),
    recentFacts: [],
    opponentPattern: null,
    phase: "BARGAINING",
  };
}

describe("retail MSRP catalog", () => {
  it("matches iPhone 15 Pro from title and tags, not Pro Max", () => {
    expect(matchRetailFamily("iPhone 15 Pro 256GB", ["electronics", "iphone-15-pro"])?.id).toBe(
      "iphone-15-pro",
    );
    expect(matchRetailFamily("iPhone 15 Pro Max 256GB", ["iphone-15-pro-max"])?.id).toBe(
      "iphone-15-pro-max",
    );
  });

  it("reads storage from title, tags, and seller facts", () => {
    expect(detectStorage({ title: "iPhone 15 Pro 512GB" })).toBe("512GB");
    expect(detectStorage({ tags: ["256gb"] })).toBe("256GB");
    expect(
      detectStorage({
        seller_facts: [{ checkId: "storage_capacity", stance: "1TB or larger storage" }],
      }),
    ).toBe("1TB");
  });

  it("emits this product's ladder and this copy's new price", () => {
    const lines = retailMarketLinesForListing({
      title: "iPhone 15 Pro 256GB",
      tags: ["electronics", "iphone-15-pro", "256gb"],
    });
    expect(lines[0]).toContain("iPhone 15 Pro new");
    expect(lines[0]).toContain("128GB $999");
    expect(lines[0]).toContain("256GB $1099");
    expect(lines[0]).toContain("512GB $1299");
    expect(lines[0]).toContain("1TB $1499");
    expect(lines[1]).toContain("This copy is 256GB — new was $1099");
    expect(lines[1]).toContain("ask is not storage-adjusted");
    expect(lines[1]).toContain("Not the opening or the settlement");
  });

  it("emits nothing for an unmatched product", () => {
    expect(retailMarketLinesForListing({ title: "Vintage hoodie", tags: ["fashion"] })).toEqual([]);
  });
});

describe("RetailMsrpSkill", () => {
  afterEach(() => setRetailMsrpSkillMode("on"));

  it("lands matched lines in Market, not Valuation", async () => {
    const skill = new RetailMsrpSkill();
    const result = await skill.onHook(
      decideCtx({
        title: "iPhone 15 Pro 128GB",
        tags: ["electronics", "iphone-15-pro"],
      }),
    );
    const slots = collectSkillSlots({
      decide: { marketLines: result.content.marketLines as string[] },
    });
    const text = encodeSkillSlots(slots);
    expect(text).toContain("### Market");
    expect(text).toContain("128GB $999");
    expect(text).toContain("This copy is 128GB — new was $999");
    expect(text).not.toMatch(/### Valuation[\s\S]*\$999/);
    expect(slots.valuation ?? []).toEqual([]);
  });

  it("stays silent when the lab toggle is off", async () => {
    setRetailMsrpSkillMode("off");
    expect(getRetailMsrpSkillMode()).toBe("off");
    const skill = new RetailMsrpSkill();
    const result = await skill.onHook(
      decideCtx({ title: "iPhone 15 Pro 256GB", tags: ["iphone-15-pro"] }),
    );
    expect(result.content).toEqual({});
  });
});
