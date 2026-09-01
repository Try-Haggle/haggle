import { describe, expect, it } from "vitest";
import {
  isMissingNegotiationSessionError,
  isNegotiationSessionId,
  shouldRenderNegotiationNotFound,
} from "./load-buyer-negotiation";

const LOST = "33c78121-5167-4f15-9789-8ab681db4619";

describe("buyer negotiation missing-session handling", () => {
  it("accepts a uuid and rejects junk", () => {
    expect(isNegotiationSessionId(LOST)).toBe(true);
    expect(isNegotiationSessionId("not-a-uuid")).toBe(false);
    expect(isNegotiationSessionId("")).toBe(false);
  });

  it("treats API 404/403/401 as a missing session, not a 500", () => {
    expect(
      isMissingNegotiationSessionError(new Error(`API 404: /negotiations/sessions/${LOST}`)),
    ).toBe(true);
    expect(isMissingNegotiationSessionError(new Error("API 403: /negotiations/sessions/x"))).toBe(
      true,
    );
    expect(isMissingNegotiationSessionError(new Error("API 401: /negotiations/sessions/x"))).toBe(
      true,
    );
    expect(isMissingNegotiationSessionError(new Error("API 500: /negotiations/sessions/x"))).toBe(
      false,
    );
  });

  it("does not 500 on a missing uuid, inaccessible session, or empty payload", () => {
    expect(shouldRenderNegotiationNotFound("not-a-uuid", null, null)).toBe(true);
    expect(
      shouldRenderNegotiationNotFound(
        LOST,
        new Error(`API 404: /negotiations/sessions/${LOST}`),
        null,
      ),
    ).toBe(true);
    expect(
      shouldRenderNegotiationNotFound(
        LOST,
        new Error(`API 403: /negotiations/sessions/${LOST}`),
        null,
      ),
    ).toBe(true);
    expect(shouldRenderNegotiationNotFound(LOST, null, { session: null })).toBe(true);
    expect(
      shouldRenderNegotiationNotFound(LOST, null, {
        session: { id: LOST },
      }),
    ).toBe(false);
    expect(shouldRenderNegotiationNotFound(LOST, new Error("API 500: boom"), null)).toBe(false);
  });
});
