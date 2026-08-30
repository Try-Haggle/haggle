/**
 * Do the seller's soft answers actually reach the buyer's agent?
 *
 * First live test found that Quick Setup answers the seller gave on SOFT checks
 * (battery %, storage, scratches) never reached the buyer's agent, so it could not
 * use them as price leverage. This walks the full path those facts now travel:
 * seller criteria → projectSellerFacts (session creation) → listing_context
 * snapshot → extractListingContextMemory (reconstruction) → encodeListingContext
 * (the DECIDE prompt both sides read).
 */

import type { CategoryCriterion } from "@haggle/shared";
import { describe, expect, it } from "vitest";
import { encodeListingContext } from "../../adapters/deepseek-adapter.js";
import type { CoreMemory } from "../../types.js";
import { extractListingContextMemory } from "../memory-reconstructor.js";
import {
  projectSellerFacts,
  SELLER_FACT_STANCE_MAX_LENGTH,
  SELLER_FACTS_MAX_COUNT,
} from "../seller-facts.js";

function criterion(overrides: Partial<CategoryCriterion> & { checkId: string }): CategoryCriterion {
  return {
    questionKo: "질문",
    enforcement: "soft",
    requirement: "optional",
    ...overrides,
  };
}

describe("projectSellerFacts", () => {
  it("projects answered criteria — soft AND required — and drops unanswered ones", () => {
    const facts = projectSellerFacts([
      criterion({ checkId: "battery_health", questionKo: "배터리 성능은?", stance: "85%" }),
      criterion({
        checkId: "imei_esn_clean",
        enforcement: "hard",
        requirement: "required",
        stance: "clean, verified",
      }),
      criterion({ checkId: "storage_capacity" }), // no stance — seller never answered
      criterion({ checkId: "cosmetic_grade", stance: "   " }), // blank = unanswered
    ]);
    expect(facts).toEqual([
      { checkId: "battery_health", question: "배터리 성능은?", stance: "85%" },
      { checkId: "imei_esn_clean", question: "질문", stance: "clean, verified" },
    ]);
  });

  it("dedupes by check id (first wins) so a malformed doubled entry can't repeat", () => {
    const facts = projectSellerFacts([
      criterion({ checkId: "battery_health", stance: "85%" }),
      criterion({ checkId: "battery_health", stance: "99%" }),
    ]);
    expect(facts).toHaveLength(1);
    expect(facts[0]?.stance).toBe("85%");
  });

  it("caps count and stance length so the snapshot can't bloat the prompt", () => {
    const many = Array.from({ length: SELLER_FACTS_MAX_COUNT + 5 }, (_, i) =>
      criterion({ checkId: `check_${i}`, stance: "x".repeat(500) }),
    );
    const facts = projectSellerFacts(many);
    expect(facts).toHaveLength(SELLER_FACTS_MAX_COUNT);
    expect(facts[0]?.stance).toHaveLength(SELLER_FACT_STANCE_MAX_LENGTH);
  });

  it("returns [] for missing seller memory (pre-Phase-G listings)", () => {
    expect(projectSellerFacts(undefined)).toEqual([]);
  });
});

describe("extractListingContextMemory passes seller_facts through", () => {
  it("keeps well-formed facts alongside the other listing fields", () => {
    const out = extractListingContextMemory({
      listing_context: {
        title: "iPhone 15 Pro",
        seller_facts: [{ checkId: "battery_health", question: "배터리 성능은?", stance: "85%" }],
      },
    });
    expect(out?.title).toBe("iPhone 15 Pro");
    expect(out?.seller_facts).toEqual([
      { checkId: "battery_health", question: "배터리 성능은?", stance: "85%" },
    ]);
  });

  it("drops malformed entries so a bad snapshot can't reach the prompt", () => {
    const out = extractListingContextMemory({
      listing_context: {
        title: "iPhone 15 Pro",
        seller_facts: [
          { checkId: "battery_health", stance: "85%" }, // valid, question omitted
          { checkId: "storage_capacity" }, // no stance
          { checkId: "cosmetic_grade", stance: "   " }, // blank stance
          { stance: "orphan" }, // no checkId
          "junk",
          null,
        ],
      },
    });
    expect(out?.seller_facts).toEqual([{ checkId: "battery_health", stance: "85%" }]);
  });

  it("omits the field entirely when absent (pre-Phase-G snapshot)", () => {
    const out = extractListingContextMemory({ listing_context: { title: "iPhone 15 Pro" } });
    expect(out?.seller_facts).toBeUndefined();
  });

  it("keeps the published ask for Decide model routing", () => {
    const out = extractListingContextMemory({
      listing_context: { title: "Vintage hoodie", published_ask_minor: 4500 },
    });
    expect(out?.published_ask_minor).toBe(4500);
  });
});

describe("the seller's facts reach the DECIDE prompt", () => {
  function memoryWithListing(listing: Record<string, unknown>): CoreMemory {
    return { listing_context: listing } as unknown as CoreMemory;
  }

  it("encodes a soft fact the seller stated — the live-test gap", () => {
    const encoded = encodeListingContext(
      memoryWithListing({
        title: "iPhone 15 Pro",
        seller_facts: [
          { checkId: "battery_health", question: "배터리 성능은?", stance: "85%" },
          { checkId: "cosmetic_grade", question: "외관 상태는?", stance: "잔기스 있음" },
        ],
      }),
    );
    expect(encoded).toContain("sellerStatedFacts:");
    expect(encoded).toContain("배터리 성능은? = 85%");
    expect(encoded).toContain("외관 상태는? = 잔기스 있음");
  });

  it("renders nothing extra when there are no facts", () => {
    const encoded = encodeListingContext(memoryWithListing({ title: "iPhone 15 Pro" }));
    expect(encoded ?? "").not.toContain("sellerStatedFacts");
  });
});
