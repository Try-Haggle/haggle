import { afterEach, describe, expect, it } from "vitest";
import {
  clearGuestBuyerClaims,
  GUEST_BUYER_CLAIM_STORAGE_KEY,
  readGuestBuyerClaims,
  stashGuestBuyerClaim,
} from "./guest-buyer-claim-storage";

afterEach(() => {
  clearGuestBuyerClaims();
});

describe("guest-buyer-claim-storage", () => {
  it("stashes id+PoP and ignores legacy id-only entries", () => {
    window.localStorage.setItem(
      GUEST_BUYER_CLAIM_STORAGE_KEY,
      JSON.stringify(["33333333-3333-4333-8333-333333333333"]),
    );
    expect(readGuestBuyerClaims()).toEqual([]);

    stashGuestBuyerClaim("33333333-3333-4333-8333-333333333333", "p".repeat(43));
    expect(readGuestBuyerClaims()).toEqual([
      {
        guest_buyer_id: "33333333-3333-4333-8333-333333333333",
        pop: "p".repeat(43),
      },
    ]);
  });

  it("does not stash without a PoP", () => {
    stashGuestBuyerClaim("33333333-3333-4333-8333-333333333333", "short");
    expect(readGuestBuyerClaims()).toEqual([]);
  });
});
