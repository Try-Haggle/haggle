import { describe, expect, it } from "vitest";
import { canPurgeWithdrawnListing, listingWithdrawBlockReason } from "../lib/listing-withdraw.js";

describe("listingWithdrawBlockReason", () => {
  it("lets a published listing with no sale or accepted deal withdraw", () => {
    expect(
      listingWithdrawBlockReason({
        draftStatus: "published",
        claimStatus: null,
        hasAcceptedSession: false,
      }),
    ).toBeNull();
  });

  it("treats an already expired listing as already withdrawn", () => {
    expect(
      listingWithdrawBlockReason({
        draftStatus: "expired",
        claimStatus: null,
        hasAcceptedSession: false,
      }),
    ).toBe("ALREADY_WITHDRAWN");
  });

  it("blocks a draft that was never published", () => {
    expect(
      listingWithdrawBlockReason({
        draftStatus: "draft",
        claimStatus: null,
        hasAcceptedSession: false,
      }),
    ).toBe("NOT_PUBLISHED");
  });

  it("blocks funding or funded claims so money movement is not interrupted", () => {
    expect(
      listingWithdrawBlockReason({
        draftStatus: "published",
        claimStatus: "FUNDING",
        hasAcceptedSession: false,
      }),
    ).toBe("LISTING_HAS_ACTIVE_SALE");
    expect(
      listingWithdrawBlockReason({
        draftStatus: "published",
        claimStatus: "FUNDED",
        hasAcceptedSession: false,
      }),
    ).toBe("LISTING_HAS_ACTIVE_SALE");
  });

  it("allows an open hold so unused standing accepts can still be withdrawn", () => {
    expect(
      listingWithdrawBlockReason({
        draftStatus: "published",
        claimStatus: "OPEN",
        hasAcceptedSession: false,
      }),
    ).toBeNull();
  });

  it("blocks an accepted deal", () => {
    expect(
      listingWithdrawBlockReason({
        draftStatus: "published",
        claimStatus: null,
        hasAcceptedSession: true,
      }),
    ).toBe("LISTING_HAS_ACCEPTED_DEAL");
  });
});

describe("canPurgeWithdrawnListing", () => {
  const now = new Date("2026-09-01T00:00:00.000Z");
  const due = new Date("2026-06-02T00:00:00.000Z");

  it("purges only seller-deleted listings after 90 days", () => {
    expect(
      canPurgeWithdrawnListing({
        withdrawnAt: due,
        now,
        hasCommerceOrder: false,
        hasSettlementApproval: false,
        hasActiveSaleClaim: false,
        hasAcceptedSession: false,
      }),
    ).toBe(true);
  });

  it("keeps listings that were never deleted", () => {
    expect(
      canPurgeWithdrawnListing({
        withdrawnAt: null,
        now,
        hasCommerceOrder: false,
        hasSettlementApproval: false,
        hasActiveSaleClaim: false,
        hasAcceptedSession: false,
      }),
    ).toBe(false);
  });

  it("keeps deleted listings until the 90-day clock finishes", () => {
    expect(
      canPurgeWithdrawnListing({
        withdrawnAt: new Date("2026-08-01T00:00:00.000Z"),
        now,
        hasCommerceOrder: false,
        hasSettlementApproval: false,
        hasActiveSaleClaim: false,
        hasAcceptedSession: false,
      }),
    ).toBe(false);
  });

  it("keeps a deleted listing that later grew a money record", () => {
    expect(
      canPurgeWithdrawnListing({
        withdrawnAt: due,
        now,
        hasCommerceOrder: true,
        hasSettlementApproval: false,
        hasActiveSaleClaim: false,
        hasAcceptedSession: false,
      }),
    ).toBe(false);
  });
});
