import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertListingAcceptsNewSession,
  assertListingPayableForPrepare,
  beginListingFunding,
  confirmListingFunded,
  ListingClaimError,
  openListingHold,
  releaseListingFunding,
} from "../services/listing-claim.service.js";

type ClaimRow = {
  id: string;
  listingId: string;
  openedBySessionId: string;
  openedByBuyerId: string;
  sellerId: string;
  status: "OPEN" | "EXCLUSIVE" | "FUNDING" | "FUNDED";
  lockKind: "OPEN_HOLD" | "EXCLUSIVE";
  exclusiveBuyerId: string | null;
  exclusiveUntil: Date | null;
  fundingBuyerId: string | null;
  fundingSessionId: string | null;
  fundingSettlementApprovalId: string | null;
  fundingPaymentIntentId: string | null;
  fundingLeaseExpiresAt: Date | null;
  fundedAt: Date | null;
  holdPriceMinor: number | null;
  holdBuyerId: string | null;
  holdExpiresAt: Date | null;
  version: number;
};

function makeRow(overrides: Partial<ClaimRow> = {}): ClaimRow {
  return {
    id: "claim-1",
    listingId: "listing-1",
    openedBySessionId: "session-a",
    openedByBuyerId: "buyer-a",
    sellerId: "seller-1",
    status: "OPEN",
    lockKind: "OPEN_HOLD",
    exclusiveBuyerId: null,
    exclusiveUntil: null,
    fundingBuyerId: null,
    fundingSessionId: null,
    fundingSettlementApprovalId: null,
    fundingPaymentIntentId: null,
    fundingLeaseExpiresAt: null,
    fundedAt: null,
    holdPriceMinor: null,
    holdBuyerId: null,
    holdExpiresAt: null,
    version: 1,
    ...overrides,
  };
}

function createDb(initial: ClaimRow | null) {
  let row = initial;
  const execute = vi.fn().mockResolvedValue([]);
  const tx = {
    execute,
    query: {
      listingClaims: {
        findFirst: vi.fn(async () => row),
      },
    },
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(async () => {
          row = makeRow();
          return [row];
        }),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Partial<ClaimRow>) => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => {
            row = { ...(row ?? makeRow()), ...values, version: (row?.version ?? 1) + 1 };
            return [row];
          }),
        })),
      })),
    })),
  };

  return {
    db: {
      transaction: async (fn: (inner: typeof tx) => Promise<unknown>) => fn(tx),
      query: tx.query,
    } as never,
    tx,
    getRow: () => row,
  };
}

describe("listing-claim.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens a hold when the listing has none", async () => {
    const { db } = createDb(null);
    const claim = await openListingHold(db, {
      listingId: "listing-1",
      sessionId: "session-a",
      buyerId: "buyer-a",
      sellerId: "seller-1",
      agreedPriceMinor: 72_500,
    });
    expect(claim.status).toBe("OPEN");
    expect(claim.lockKind).toBe("OPEN_HOLD");
  });

  it("reuses the open hold when a second session accepts", async () => {
    const existing = makeRow({
      holdPriceMinor: 72_500,
      holdBuyerId: "buyer-a",
      holdExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    const { db, tx } = createDb(existing);
    const claim = await openListingHold(db, {
      listingId: "listing-1",
      sessionId: "session-b",
      buyerId: "buyer-b",
      sellerId: "seller-1",
      agreedPriceMinor: 80_000,
    });
    expect(claim).toBe(existing);
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it("lets the first buyer take FUNDING and blocks the second while the lease is live", async () => {
    const { db, getRow } = createDb(makeRow());
    const first = await beginListingFunding(db, {
      listingId: "listing-1",
      buyerId: "buyer-a",
      sellerId: "seller-1",
      sessionId: "session-a",
      settlementApprovalId: "session-a",
      paymentIntentId: "pi-a",
    });
    expect(first.status).toBe("FUNDING");
    expect(first.fundingBuyerId).toBe("buyer-a");

    const leased = createDb({
      ...getRow()!,
      status: "FUNDING",
      fundingBuyerId: "buyer-a",
      fundingLeaseExpiresAt: new Date(Date.now() + 60_000),
    });
    await expect(
      beginListingFunding(leased.db, {
        listingId: "listing-1",
        buyerId: "buyer-b",
        sellerId: "seller-1",
        sessionId: "session-b",
        settlementApprovalId: "session-b",
      }),
    ).rejects.toMatchObject({ code: "LISTING_FUNDING_IN_PROGRESS" });
  });

  it("confirms FUNDED for the funding buyer and supersedes other sessions", async () => {
    const { db, tx } = createDb(
      makeRow({
        status: "FUNDING",
        fundingBuyerId: "buyer-a",
        fundingSessionId: "session-a",
        fundingLeaseExpiresAt: new Date(Date.now() + 60_000),
      }),
    );
    const funded = await confirmListingFunded(db, {
      listingId: "listing-1",
      buyerId: "buyer-a",
      sessionId: "session-a",
      paymentIntentId: "pi-a",
    });
    expect(funded.status).toBe("FUNDED");
    expect(tx.execute.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("releases FUNDING back to OPEN", async () => {
    const { db } = createDb(
      makeRow({
        status: "FUNDING",
        fundingBuyerId: "buyer-a",
        fundingLeaseExpiresAt: new Date(Date.now() + 60_000),
      }),
    );
    const released = await releaseListingFunding(db, {
      listingId: "listing-1",
      buyerId: "buyer-a",
    });
    expect(released?.status).toBe("OPEN");
    expect(released?.fundingBuyerId).toBeNull();
  });

  it("blocks a new session and prepare after FUNDED", async () => {
    const { db } = createDb(makeRow({ status: "FUNDED", fundingBuyerId: "buyer-a" }));
    await expect(assertListingAcceptsNewSession(db, "listing-1")).rejects.toBeInstanceOf(
      ListingClaimError,
    );
    await expect(assertListingPayableForPrepare(db, "listing-1", "buyer-b")).rejects.toMatchObject({
      code: "LISTING_SOLD",
    });
  });
});
