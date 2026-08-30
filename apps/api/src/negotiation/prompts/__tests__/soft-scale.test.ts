import { describe, expect, it } from "vitest";
import type { CoreMemory } from "../../types.js";
import { encodeListingContext } from "../decide-user-prompt.js";
import { detectStorage } from "../soft-scale.js";

function memoryWithListing(listing: Record<string, unknown>): CoreMemory {
  return { listing_context: listing } as unknown as CoreMemory;
}

describe("detectStorage", () => {
  it("reads size from title, tags, and seller facts", () => {
    expect(detectStorage({ title: "iPhone 15 Pro 128GB" })).toBe("128GB");
    expect(detectStorage({ tags: ["256gb"] })).toBe("256GB");
    expect(
      detectStorage({
        seller_facts: [{ checkId: "storage_capacity", stance: "1TB or larger storage" }],
      }),
    ).toBe("1TB");
  });

  it("does not put a rank line on LISTING", () => {
    const encoded = encodeListingContext(
      memoryWithListing({
        title: "iPhone 15 Pro 128GB",
        tags: ["electronics", "iphone"],
        seller_facts: [{ checkId: "storage_capacity", stance: "128GB storage" }],
      }),
    );
    expect(encoded).toContain("128GB");
    expect(encoded ?? "").not.toContain("storageScale");
    expect(encoded ?? "").not.toContain("rank=lowest");
  });
});
