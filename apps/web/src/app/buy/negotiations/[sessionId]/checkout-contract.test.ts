import { describe, expect, it } from "vitest";
import { getCheckoutCta, isCheckoutReady } from "./checkout-contract";

const SESSION_ID = "00000000-0000-4000-a000-000000000099";
const BUYER_ID = "11111111-1111-4111-8111-111111111111";

const approval = {
  id: SESSION_ID,
  buyer_id: BUYER_ID,
  approval_state: "APPROVED",
  final_amount_minor: "50000",
};

describe("negotiation checkout contract", () => {
  it("shows a claim-first signup action to an accepted guest", () => {
    expect(
      getCheckoutCta({
        sessionId: SESSION_ID,
        sessionStatus: "ACCEPTED",
        userId: null,
      }),
    ).toEqual({
      href: `/sign-up?next=${encodeURIComponent(`/claim/buyer?session_id=${SESSION_ID}`)}`,
      label: "Sign up to checkout",
    });
  });

  it("shows checkout only to the approved buyer of an accepted session", () => {
    expect(
      getCheckoutCta({
        sessionId: SESSION_ID,
        sessionStatus: "ACCEPTED",
        userId: BUYER_ID,
        approval,
      }),
    ).toEqual({
      href: `/buy/negotiations/${SESSION_ID}/checkout`,
      label: "Continue to checkout",
    });

    expect(
      getCheckoutCta({
        sessionId: SESSION_ID,
        sessionStatus: "ACCEPTED",
        userId: "22222222-2222-4222-8222-222222222222",
        approval,
      }),
    ).toBeUndefined();
    expect(
      getCheckoutCta({
        sessionId: SESSION_ID,
        sessionStatus: "REJECTED",
        userId: BUYER_ID,
        approval,
      }),
    ).toBeUndefined();
  });

  it("requires the negotiation and approval amounts to match", () => {
    expect(
      isCheckoutReady({
        sessionId: SESSION_ID,
        sessionStatus: "ACCEPTED",
        negotiatedAmountMinor: "50000",
        hasListing: true,
        userId: BUYER_ID,
        approval,
      }),
    ).toBe(true);

    expect(
      isCheckoutReady({
        sessionId: SESSION_ID,
        sessionStatus: "ACCEPTED",
        negotiatedAmountMinor: "49999",
        hasListing: true,
        userId: BUYER_ID,
        approval,
      }),
    ).toBe(false);
  });
});
