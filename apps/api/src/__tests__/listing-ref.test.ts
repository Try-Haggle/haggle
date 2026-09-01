import { describe, expect, it } from "vitest";
import { normalizeListingPublicId } from "../lib/listing-ref.js";

describe("normalizeListingPublicId", () => {
  it("keeps a bare slug", () => {
    expect(normalizeListingPublicId("jc6r2T3d")).toBe("jc6r2T3d");
  });

  it("extracts the slug from a staging listing URL", () => {
    expect(normalizeListingPublicId("https://app.staging.tryhaggle.ai/l/jc6r2T3d")).toBe(
      "jc6r2T3d",
    );
  });

  it("extracts the slug from a path", () => {
    expect(normalizeListingPublicId("/l/jc6r2T3d?from=grok")).toBe("jc6r2T3d");
  });
});
