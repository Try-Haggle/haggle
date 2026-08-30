import {
  canPreparePaymentOnListing,
  canStartNegotiationOnListing,
  evaluateListingClaim,
  HOLD_FLOOR_MS,
  holdFloorExpiresAt,
  type ListingClaimErrorCode,
  type ListingClaimSnapshot,
} from "@haggle/commerce-core";
import { type Database, eq, listingClaims, sql } from "@haggle/db";

type ListingClaimTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export class ListingClaimError extends Error {
  readonly code: ListingClaimErrorCode;

  constructor(code: ListingClaimErrorCode) {
    super(code);
    this.name = "ListingClaimError";
    this.code = code;
  }
}

export const LISTING_CLAIM_HTTP: Record<ListingClaimErrorCode, { status: number; error: string }> =
  {
    LISTING_SOLD: { status: 409, error: "LISTING_SOLD" },
    LISTING_FUNDING_IN_PROGRESS: { status: 409, error: "LISTING_FUNDING_IN_PROGRESS" },
    LISTING_EXCLUSIVE_LOCK: { status: 409, error: "LISTING_EXCLUSIVE_LOCK" },
    LISTING_CLAIM_CONFLICT: { status: 409, error: "LISTING_CLAIM_CONFLICT" },
    LISTING_NOT_HELD: { status: 409, error: "LISTING_NOT_HELD" },
    LISTING_HOLD_TICK_NOT_MET: { status: 409, error: "LISTING_HOLD_TICK_NOT_MET" },
  };

export function getListingClaimFundingLeaseSeconds(): number {
  const value = Number(process.env.LISTING_CLAIM_FUNDING_LEASE_SECONDS);
  return Number.isInteger(value) && value >= 30 && value <= 3600 ? value : 900;
}

export function getListingHoldFloorMs(): number {
  const value = Number(process.env.LISTING_HOLD_FLOOR_SECONDS);
  if (Number.isInteger(value) && value >= 60 && value <= 24 * 60 * 60) {
    return value * 1000;
  }
  return HOLD_FLOOR_MS;
}

type ListingClaimRow = typeof listingClaims.$inferSelect;

function toSnapshot(row: ListingClaimRow): ListingClaimSnapshot {
  return {
    status: row.status,
    lock_kind: row.lockKind,
    exclusive_buyer_id: row.exclusiveBuyerId,
    exclusive_until: row.exclusiveUntil?.toISOString() ?? null,
    funding_buyer_id: row.fundingBuyerId,
    funding_lease_expires_at: row.fundingLeaseExpiresAt?.toISOString() ?? null,
    hold_price_minor: row.holdPriceMinor,
    hold_buyer_id: row.holdBuyerId,
    hold_expires_at: row.holdExpiresAt?.toISOString() ?? null,
  };
}

function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: string; cause?: { code?: string } };
  return candidate.code === "23505" || candidate.cause?.code === "23505";
}

async function lockActiveClaim(
  tx: ListingClaimTx,
  listingId: string,
): Promise<ListingClaimRow | null> {
  await tx.execute(sql`
    SELECT id FROM listing_claims
     WHERE listing_id = ${listingId}
       AND status IN ('OPEN', 'EXCLUSIVE', 'FUNDING', 'FUNDED')
     FOR UPDATE
  `);
  const row = await tx.query.listingClaims.findFirst({
    where: (fields, ops) =>
      ops.and(
        ops.eq(fields.listingId, listingId),
        ops.inArray(fields.status, ["OPEN", "EXCLUSIVE", "FUNDING", "FUNDED"]),
      ),
  });
  return row ?? null;
}

async function persistSnapshot(
  tx: ListingClaimTx,
  row: ListingClaimRow,
  next: ListingClaimSnapshot,
  extras: Partial<typeof listingClaims.$inferInsert>,
): Promise<ListingClaimRow> {
  const [updated] = await tx
    .update(listingClaims)
    .set({
      status: next.status,
      lockKind: next.lock_kind,
      exclusiveBuyerId: next.exclusive_buyer_id,
      exclusiveUntil: next.exclusive_until ? new Date(next.exclusive_until) : null,
      fundingBuyerId: next.funding_buyer_id,
      fundingLeaseExpiresAt: next.funding_lease_expires_at
        ? new Date(next.funding_lease_expires_at)
        : null,
      holdPriceMinor: next.hold_price_minor,
      holdBuyerId: next.hold_buyer_id,
      holdExpiresAt: next.hold_expires_at ? new Date(next.hold_expires_at) : null,
      version: row.version + 1,
      updatedAt: new Date(),
      ...extras,
    })
    .where(eq(listingClaims.id, row.id))
    .returning();
  return updated;
}

export async function getActiveListingClaim(
  db: Database,
  listingId: string,
): Promise<ListingClaimRow | null> {
  return (
    (await db.query.listingClaims.findFirst({
      where: (fields, ops) =>
        ops.and(
          ops.eq(fields.listingId, listingId),
          ops.inArray(fields.status, ["OPEN", "EXCLUSIVE", "FUNDING", "FUNDED"]),
        ),
    })) ?? null
  );
}

export async function assertListingAcceptsNewSession(
  db: Database,
  listingId: string,
): Promise<void> {
  const claim = await getActiveListingClaim(db, listingId);
  if (!canStartNegotiationOnListing(claim ? toSnapshot(claim) : null)) {
    throw new ListingClaimError("LISTING_SOLD");
  }
}

export async function assertListingPayableForPrepare(
  db: Database,
  listingId: string,
  buyerId: string,
  amountMinor?: number,
): Promise<void> {
  const claim = await getActiveListingClaim(db, listingId);
  const gate = canPreparePaymentOnListing(
    claim ? toSnapshot(claim) : null,
    buyerId,
    new Date().toISOString(),
    amountMinor,
  );
  if (!gate.ok) throw new ListingClaimError(gate.error);
}

export async function openListingHold(
  db: Database,
  input: {
    listingId: string;
    sessionId: string;
    buyerId: string;
    sellerId: string;
    agreedPriceMinor: number;
  },
): Promise<ListingClaimRow> {
  const nowIso = new Date().toISOString();
  const holdExpiresAt = holdFloorExpiresAt(nowIso, getListingHoldFloorMs());

  return db.transaction(async (tx) => {
    const existing = await lockActiveClaim(tx, input.listingId);
    const decision = evaluateListingClaim(
      existing ? toSnapshot(existing) : null,
      {
        type: "open_hold",
        buyer_id: input.buyerId,
        agreed_price_minor: input.agreedPriceMinor,
        hold_expires_at: holdExpiresAt,
      },
      nowIso,
    );
    if (!decision.ok) throw new ListingClaimError(decision.error);
    if (existing) {
      if (decision.idempotent) return existing;
      return persistSnapshot(tx, existing, decision.next, {});
    }

    try {
      const [inserted] = await tx
        .insert(listingClaims)
        .values({
          listingId: input.listingId,
          openedBySessionId: input.sessionId,
          openedByBuyerId: input.buyerId,
          sellerId: input.sellerId,
          status: "OPEN",
          lockKind: "OPEN_HOLD",
          holdPriceMinor: decision.next.hold_price_minor,
          holdBuyerId: decision.next.hold_buyer_id,
          holdExpiresAt: decision.next.hold_expires_at
            ? new Date(decision.next.hold_expires_at)
            : null,
        })
        .returning();
      return inserted;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await lockActiveClaim(tx, input.listingId);
      if (!raced) throw error;
      return raced;
    }
  });
}

export async function beginListingFunding(
  db: Database,
  input: {
    listingId: string;
    buyerId: string;
    sellerId: string;
    sessionId: string;
    settlementApprovalId: string;
    paymentIntentId?: string | null;
    amountMinor?: number;
  },
): Promise<ListingClaimRow> {
  const now = new Date();
  const leaseExpires = new Date(now.getTime() + getListingClaimFundingLeaseSeconds() * 1000);

  return db.transaction(async (tx) => {
    let existing = await lockActiveClaim(tx, input.listingId);
    if (!existing) {
      try {
        const [inserted] = await tx
          .insert(listingClaims)
          .values({
            listingId: input.listingId,
            openedBySessionId: input.sessionId,
            openedByBuyerId: input.buyerId,
            sellerId: input.sellerId,
            status: "OPEN",
            lockKind: "OPEN_HOLD",
          })
          .returning();
        existing = inserted;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        existing = await lockActiveClaim(tx, input.listingId);
      }
    }
    if (!existing) throw new ListingClaimError("LISTING_NOT_HELD");

    const decision = evaluateListingClaim(
      toSnapshot(existing),
      { type: "begin_funding", buyer_id: input.buyerId, amount_minor: input.amountMinor },
      now.toISOString(),
    );
    if (!decision.ok) throw new ListingClaimError(decision.error);

    const nextLease =
      decision.idempotent && existing.fundingBuyerId === input.buyerId
        ? existing.fundingLeaseExpiresAt && existing.fundingLeaseExpiresAt > now
          ? existing.fundingLeaseExpiresAt
          : leaseExpires
        : leaseExpires;

    return persistSnapshot(
      tx,
      existing,
      { ...decision.next, funding_lease_expires_at: nextLease.toISOString() },
      {
        fundingSessionId: input.sessionId,
        fundingSettlementApprovalId: input.settlementApprovalId,
        fundingPaymentIntentId: input.paymentIntentId ?? existing.fundingPaymentIntentId,
      },
    );
  });
}

export async function confirmListingFunded(
  db: Database,
  input: {
    listingId: string;
    buyerId: string;
    sessionId?: string | null;
    paymentIntentId?: string | null;
  },
): Promise<ListingClaimRow> {
  return db.transaction(async (tx) => {
    let existing = await lockActiveClaim(tx, input.listingId);
    const decision = evaluateListingClaim(
      existing ? toSnapshot(existing) : null,
      { type: "confirm_funded", buyer_id: input.buyerId },
      new Date().toISOString(),
    );
    if (!decision.ok) throw new ListingClaimError(decision.error);
    if (!existing) {
      const [inserted] = await tx
        .insert(listingClaims)
        .values({
          listingId: input.listingId,
          openedBySessionId: input.sessionId ?? input.buyerId,
          openedByBuyerId: input.buyerId,
          sellerId: input.buyerId,
          status: "FUNDED",
          lockKind: "OPEN_HOLD",
          fundingBuyerId: input.buyerId,
          fundingSessionId: input.sessionId ?? null,
          fundingPaymentIntentId: input.paymentIntentId ?? null,
          fundedAt: new Date(),
        })
        .returning();
      existing = inserted;
      const winnerSessionId = input.sessionId ?? existing.openedBySessionId;
      await tx.execute(sql`
        UPDATE negotiation_sessions
           SET status = 'SUPERSEDED',
               updated_at = now(),
               version = version + 1
         WHERE listing_id = ${input.listingId}
           AND id <> ${winnerSessionId}
           AND status NOT IN ('SUPERSEDED', 'REJECTED', 'EXPIRED')
      `);
      return existing;
    }

    const updated = await persistSnapshot(tx, existing, decision.next, {
      fundedAt: existing.fundedAt ?? new Date(),
      fundingPaymentIntentId: input.paymentIntentId ?? existing.fundingPaymentIntentId,
    });

    const winnerSessionId =
      input.sessionId ?? existing.fundingSessionId ?? existing.openedBySessionId;
    await tx.execute(sql`
      UPDATE negotiation_sessions
         SET status = 'SUPERSEDED',
             updated_at = now(),
             version = version + 1
       WHERE listing_id = ${input.listingId}
         AND id <> ${winnerSessionId}
         AND status NOT IN ('SUPERSEDED', 'REJECTED', 'EXPIRED')
    `);

    return updated;
  });
}

export async function releaseListingFunding(
  db: Database,
  input: { listingId: string; buyerId: string },
): Promise<ListingClaimRow | null> {
  return db.transaction(async (tx) => {
    const existing = await lockActiveClaim(tx, input.listingId);
    if (!existing) return null;
    const decision = evaluateListingClaim(
      toSnapshot(existing),
      { type: "release_funding", buyer_id: input.buyerId },
      new Date().toISOString(),
    );
    if (!decision.ok) throw new ListingClaimError(decision.error);
    if (decision.idempotent && existing.status !== "FUNDING") return existing;
    return persistSnapshot(tx, existing, decision.next, {
      fundingSessionId: null,
      fundingSettlementApprovalId: null,
      fundingPaymentIntentId: null,
    });
  });
}

/**
 * Reserved for the later exclusive-lock credit product. No live caller yet.
 */
export async function acquireExclusiveListingLock(
  db: Database,
  input: { listingId: string; buyerId: string; exclusiveUntil: Date },
): Promise<ListingClaimRow> {
  return db.transaction(async (tx) => {
    const existing = await lockActiveClaim(tx, input.listingId);
    const decision = evaluateListingClaim(
      existing ? toSnapshot(existing) : null,
      {
        type: "acquire_exclusive",
        buyer_id: input.buyerId,
        exclusive_until: input.exclusiveUntil.toISOString(),
      },
      new Date().toISOString(),
    );
    if (!decision.ok) throw new ListingClaimError(decision.error);
    if (!existing) throw new ListingClaimError("LISTING_NOT_HELD");
    return persistSnapshot(tx, existing, decision.next, {});
  });
}
