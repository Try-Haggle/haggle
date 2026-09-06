import { describe, expect, it } from "vitest";
import {
  mintGuestBuyerClaimPop,
  verifyGuestBuyerClaimPop,
} from "../services/guest-buyer-claim-pop.service.js";

const SECRET = "unit-test-guest-buyer-claim-pop-secret!!";
const GUEST = "33333333-3333-4333-8333-333333333333";

describe("guest-buyer-claim-pop", () => {
  it("mints a stable PoP for a guest buyer id", () => {
    const a = mintGuestBuyerClaimPop(GUEST, SECRET);
    const b = mintGuestBuyerClaimPop(GUEST, SECRET);
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(32);
  });

  it("accepts the minted PoP and rejects knowledge-alone / wrong pop", () => {
    const pop = mintGuestBuyerClaimPop(GUEST, SECRET);
    expect(verifyGuestBuyerClaimPop(GUEST, pop, SECRET)).toBe(true);
    expect(verifyGuestBuyerClaimPop(GUEST, undefined, SECRET)).toBe(false);
    expect(verifyGuestBuyerClaimPop(GUEST, "x".repeat(43), SECRET)).toBe(false);
    expect(verifyGuestBuyerClaimPop("44444444-4444-4444-8444-444444444444", pop, SECRET)).toBe(
      false,
    );
  });
});
