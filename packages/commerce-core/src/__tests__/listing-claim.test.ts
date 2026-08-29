import { describe, expect, it } from "vitest";
import {
  canPreparePaymentOnListing,
  canStartNegotiationOnListing,
  evaluateListingClaim,
  type ListingClaimSnapshot,
  toPublicListingHoldState,
} from "../listing-claim.js";

const NOW = "2026-08-28T12:00:00.000Z";
const LATER = "2026-08-28T12:20:00.000Z";
const EARLIER = "2026-08-28T11:50:00.000Z";

const openHold: ListingClaimSnapshot = {
  status: "OPEN",
  lock_kind: "OPEN_HOLD",
  exclusive_buyer_id: null,
  exclusive_until: null,
  funding_buyer_id: null,
  funding_lease_expires_at: null,
  hold_price_minor: null,
  hold_buyer_id: null,
  hold_expires_at: null,
};

describe("evaluateListingClaim", () => {
  it("opens a hold when none exists", () => {
    expect(evaluateListingClaim(null, { type: "open_hold" }, NOW)).toEqual({
      ok: true,
      next: openHold,
    });
  });

  it("stores the standing price on first accept", () => {
    const decision = evaluateListingClaim(
      null,
      {
        type: "open_hold",
        buyer_id: "b1",
        agreed_price_minor: 72_500,
        hold_expires_at: "2026-08-28T14:00:00.000Z",
      },
      NOW,
    );
    expect(decision).toEqual({
      ok: true,
      next: {
        ...openHold,
        hold_price_minor: 72_500,
        hold_buyer_id: "b1",
        hold_expires_at: "2026-08-28T14:00:00.000Z",
      },
    });
  });

  it("keeps the first standing price while the floor is live", () => {
    const held = {
      ...openHold,
      hold_price_minor: 72_500,
      hold_buyer_id: "b1",
      hold_expires_at: "2026-08-28T14:00:00.000Z",
    };
    const decision = evaluateListingClaim(
      held,
      {
        type: "open_hold",
        buyer_id: "b2",
        agreed_price_minor: 80_000,
        hold_expires_at: "2026-08-28T16:00:00.000Z",
      },
      NOW,
    );
    expect(decision).toMatchObject({ ok: true, idempotent: true, next: held });
  });

  it("blocks a later buyer from funding below P+tick", () => {
    const held = {
      ...openHold,
      hold_price_minor: 72_500,
      hold_buyer_id: "b1",
      hold_expires_at: "2026-08-28T14:00:00.000Z",
    };
    expect(
      evaluateListingClaim(
        held,
        { type: "begin_funding", buyer_id: "b2", amount_minor: 73_000 },
        NOW,
      ),
    ).toEqual({ ok: false, error: "LISTING_HOLD_TICK_NOT_MET" });
    expect(
      evaluateListingClaim(
        held,
        { type: "begin_funding", buyer_id: "b1", amount_minor: 72_500 },
        NOW,
      ),
    ).toMatchObject({ ok: true, next: { status: "FUNDING", funding_buyer_id: "b1" } });
    expect(
      evaluateListingClaim(
        held,
        { type: "begin_funding", buyer_id: "b2", amount_minor: 74_500 },
        NOW,
      ),
    ).toMatchObject({ ok: true, next: { funding_buyer_id: "b2" } });
  });

  it("keeps an existing hold when a second session accepts", () => {
    const decision = evaluateListingClaim(openHold, { type: "open_hold" }, NOW);
    expect(decision).toMatchObject({ ok: true, idempotent: true, next: openHold });
  });

  it("lets the first buyer begin funding from an open hold", () => {
    const decision = evaluateListingClaim(openHold, { type: "begin_funding", buyer_id: "b1" }, NOW);
    expect(decision).toEqual({
      ok: true,
      next: { ...openHold, status: "FUNDING", funding_buyer_id: "b1" },
    });
  });

  it("treats a missing claim as an open hold when funding starts", () => {
    const decision = evaluateListingClaim(null, { type: "begin_funding", buyer_id: "b1" }, NOW);
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.next.status).toBe("FUNDING");
      expect(decision.next.funding_buyer_id).toBe("b1");
    }
  });

  it("blocks a second buyer while the funding lease is live", () => {
    const funding: ListingClaimSnapshot = {
      ...openHold,
      status: "FUNDING",
      funding_buyer_id: "b1",
      funding_lease_expires_at: LATER,
    };
    expect(evaluateListingClaim(funding, { type: "begin_funding", buyer_id: "b2" }, NOW)).toEqual({
      ok: false,
      error: "LISTING_FUNDING_IN_PROGRESS",
    });
  });

  it("lets another buyer take over after the funding lease expires", () => {
    const stale: ListingClaimSnapshot = {
      ...openHold,
      status: "FUNDING",
      funding_buyer_id: "b1",
      funding_lease_expires_at: EARLIER,
    };
    const decision = evaluateListingClaim(stale, { type: "begin_funding", buyer_id: "b2" }, NOW);
    expect(decision).toEqual({
      ok: true,
      next: { ...stale, status: "FUNDING", funding_buyer_id: "b2" },
    });
  });

  it("is idempotent when the same buyer begins funding again", () => {
    const funding: ListingClaimSnapshot = {
      ...openHold,
      status: "FUNDING",
      funding_buyer_id: "b1",
      funding_lease_expires_at: LATER,
    };
    const decision = evaluateListingClaim(funding, { type: "begin_funding", buyer_id: "b1" }, NOW);
    expect(decision).toMatchObject({ ok: true, idempotent: true, next: funding });
  });

  it("confirms funded only for the buyer who holds FUNDING", () => {
    const funding: ListingClaimSnapshot = {
      ...openHold,
      status: "FUNDING",
      funding_buyer_id: "b1",
      funding_lease_expires_at: LATER,
    };
    expect(evaluateListingClaim(funding, { type: "confirm_funded", buyer_id: "b1" }, NOW)).toEqual({
      ok: true,
      next: { ...funding, status: "FUNDED" },
    });
    expect(evaluateListingClaim(funding, { type: "confirm_funded", buyer_id: "b2" }, NOW)).toEqual({
      ok: false,
      error: "LISTING_FUNDING_IN_PROGRESS",
    });
    expect(evaluateListingClaim(openHold, { type: "confirm_funded", buyer_id: "b1" }, NOW)).toEqual(
      {
        ok: true,
        next: { ...openHold, status: "FUNDED", funding_buyer_id: "b1" },
      },
    );
  });

  it("releases funding back to an open hold", () => {
    const funding: ListingClaimSnapshot = {
      ...openHold,
      status: "FUNDING",
      funding_buyer_id: "b1",
      funding_lease_expires_at: LATER,
    };
    expect(evaluateListingClaim(funding, { type: "release_funding", buyer_id: "b1" }, NOW)).toEqual(
      {
        ok: true,
        next: openHold,
      },
    );
  });

  it("does not unlock a sold listing on release", () => {
    const funded: ListingClaimSnapshot = {
      ...openHold,
      status: "FUNDED",
      funding_buyer_id: "b1",
    };
    const decision = evaluateListingClaim(funded, { type: "release_funding", buyer_id: "b1" }, NOW);
    expect(decision).toMatchObject({ ok: true, idempotent: true, next: funded });
  });

  it("rejects funding after the listing is sold", () => {
    const funded: ListingClaimSnapshot = {
      ...openHold,
      status: "FUNDED",
      funding_buyer_id: "b1",
    };
    expect(evaluateListingClaim(funded, { type: "begin_funding", buyer_id: "b2" }, NOW)).toEqual({
      ok: false,
      error: "LISTING_SOLD",
    });
  });

  it("keeps exclusive lock unused until acquire_exclusive", () => {
    const exclusiveUntil = "2026-08-29T12:00:00.000Z";
    const decision = evaluateListingClaim(
      openHold,
      { type: "acquire_exclusive", buyer_id: "b1", exclusive_until: exclusiveUntil },
      NOW,
    );
    expect(decision).toEqual({
      ok: true,
      next: {
        status: "EXCLUSIVE",
        lock_kind: "EXCLUSIVE",
        exclusive_buyer_id: "b1",
        exclusive_until: exclusiveUntil,
        funding_buyer_id: null,
        funding_lease_expires_at: null,
        hold_price_minor: null,
        hold_buyer_id: null,
        hold_expires_at: null,
      },
    });
  });

  it("blocks other buyers from funding under a live exclusive lock", () => {
    const exclusive: ListingClaimSnapshot = {
      status: "EXCLUSIVE",
      lock_kind: "EXCLUSIVE",
      exclusive_buyer_id: "b1",
      exclusive_until: LATER,
      funding_buyer_id: null,
      funding_lease_expires_at: null,
      hold_price_minor: null,
      hold_buyer_id: null,
      hold_expires_at: null,
    };
    expect(evaluateListingClaim(exclusive, { type: "begin_funding", buyer_id: "b2" }, NOW)).toEqual(
      {
        ok: false,
        error: "LISTING_EXCLUSIVE_LOCK",
      },
    );
    const owner = evaluateListingClaim(exclusive, { type: "begin_funding", buyer_id: "b1" }, NOW);
    expect(owner.ok).toBe(true);
    if (owner.ok) expect(owner.next.funding_buyer_id).toBe("b1");
  });

  it("releases exclusive funding back to EXCLUSIVE, not OPEN", () => {
    const exclusiveFunding: ListingClaimSnapshot = {
      status: "FUNDING",
      lock_kind: "EXCLUSIVE",
      exclusive_buyer_id: "b1",
      exclusive_until: LATER,
      funding_buyer_id: "b1",
      funding_lease_expires_at: LATER,
      hold_price_minor: null,
      hold_buyer_id: null,
      hold_expires_at: null,
    };
    expect(
      evaluateListingClaim(exclusiveFunding, { type: "release_funding", buyer_id: "b1" }, NOW),
    ).toEqual({
      ok: true,
      next: {
        status: "EXCLUSIVE",
        lock_kind: "EXCLUSIVE",
        exclusive_buyer_id: "b1",
        exclusive_until: LATER,
        funding_buyer_id: null,
        funding_lease_expires_at: null,
        hold_price_minor: null,
        hold_buyer_id: null,
        hold_expires_at: null,
      },
    });
  });
});

describe("listing claim gates", () => {
  it("blocks new negotiations only after FUNDED", () => {
    expect(canStartNegotiationOnListing(null)).toBe(true);
    expect(canStartNegotiationOnListing(openHold)).toBe(true);
    expect(
      canStartNegotiationOnListing({ ...openHold, status: "FUNDING", funding_buyer_id: "b1" }),
    ).toBe(true);
    expect(
      canStartNegotiationOnListing({ ...openHold, status: "FUNDED", funding_buyer_id: "b1" }),
    ).toBe(false);
  });

  it("maps claim status to a public badge without prices", () => {
    expect(toPublicListingHoldState(null)).toBeNull();
    expect(toPublicListingHoldState("OPEN")).toBe("held");
    expect(toPublicListingHoldState("EXCLUSIVE")).toBe("held");
    expect(toPublicListingHoldState("FUNDING")).toBe("funding");
    expect(toPublicListingHoldState("FUNDED")).toBe("sold");
  });

  it("lets anyone prepare against an open hold without a live floor", () => {
    expect(canPreparePaymentOnListing(openHold, "b2", NOW)).toEqual({ ok: true });
    expect(
      canPreparePaymentOnListing(
        { ...openHold, status: "FUNDED", funding_buyer_id: "b1" },
        "b2",
        NOW,
      ),
    ).toEqual({ ok: false, error: "LISTING_SOLD" });
  });
});
