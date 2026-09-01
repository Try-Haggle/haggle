import { describe, expect, it } from "vitest";
import { DEFAULT_API_CORS_ORIGINS, isCorsOriginAllowed } from "../config/runtime.js";
import { defaultListingSellingDeadline, validateDraft } from "../services/draft.service.js";

describe("Grok listing publish path", () => {
  it("defaults the selling deadline to 7 days so text clients can publish without a widget", () => {
    const now = new Date("2026-08-31T18:00:00.000Z");
    expect(defaultListingSellingDeadline(now).toISOString()).toBe("2026-09-07T18:00:00.000Z");
  });

  it("still requires a title and asking price before publish", () => {
    const errors = validateDraft({
      title: "  ",
      targetPrice: null,
      sellingDeadline: defaultListingSellingDeadline(),
    } as never);
    expect(errors.map((error) => error.field)).toEqual(["title", "targetPrice"]);
  });

  it("allows Grok browser origins in production CORS", () => {
    const corsAllowedOrigins = new Set<string>(DEFAULT_API_CORS_ORIGINS);
    expect(isCorsOriginAllowed("https://grok.com", { isProduction: true, corsAllowedOrigins })).toBe(
      true,
    );
    expect(
      isCorsOriginAllowed("https://accounts.x.ai", { isProduction: true, corsAllowedOrigins }),
    ).toBe(true);
  });
});
