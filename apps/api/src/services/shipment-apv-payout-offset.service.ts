import { createHash } from "node:crypto";
import { sql, type Database } from "@haggle/db";

export interface ShipmentApvPayoutOffsetRecord {
  id: string;
  settlement_release_id: string;
  order_id: string;
  seller_id: string;
  currency: string;
  seller_liability_minor: number;
  applied_offset_minor: number;
  unapplied_liability_minor: number;
  evidence_manifest_sha256: string;
  request_id: string;
  allocation_version: number;
  status: "RESERVED" | "APPLIED" | "CANCELLED";
  release_tx_hash?: string;
  signature_deadline?: string;
  reservation_expires_at: string;
  cancelled_at?: string;
}

export interface ShipmentApvSellerLiabilityRecord {
  id: string;
  seller_id: string;
  source_settlement_release_id: string;
  source_order_id: string;
  currency: string;
  original_amount_minor: number;
  remaining_amount_minor: number;
  status: "OPEN" | "PARTIAL" | "SETTLED";
  evidence_manifest_sha256: string;
  version: number;
}

export interface ShipmentApvPayoutReservationHealth {
  status: "healthy" | "attention";
  expiredReserved: number;
  signedExpired: number;
  unsignedExpired: number;
  affectedSellers: number;
  appliedOffsetMinor: number;
  oldestExpiredAgeSeconds: number | null;
  recordedAt: string;
}

export interface ExpiredShipmentApvPayoutReservation {
  offsetId: string;
  settlementReleaseId: string;
  orderId: string;
  sellerId: string;
  currency: string;
  appliedOffsetMinor: number;
  signed: boolean;
  expiredAt: string;
  expiredAgeSeconds: number;
  createdAt: string;
}

interface ExpiredReservationCursor {
  expiredAt: string;
  id: string;
}

function decodeExpiredReservationCursor(value: string): ExpiredReservationCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<ExpiredReservationCursor>;
    if (typeof parsed.expiredAt !== "string" || !Number.isFinite(Date.parse(parsed.expiredAt))
      || typeof parsed.id !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parsed.id)) {
      throw new Error("invalid cursor payload");
    }
    return { expiredAt: new Date(parsed.expiredAt).toISOString(), id: parsed.id };
  } catch {
    throw new Error("INVALID_APV_PAYOUT_RESERVATION_CURSOR");
  }
}

function encodeExpiredReservationCursor(cursor: ExpiredReservationCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export type ShipmentApvPayoutOffsetResult =
  | { outcome: "reserved" | "applied" | "duplicate"; offset: ShipmentApvPayoutOffsetRecord }
  | { outcome: "not_found" | "pending_revision" | "snapshot_conflict" | "request_conflict" };

function numeric(value: unknown): number {
  return Number(value ?? 0);
}

function mapOffset(row: Record<string, unknown>): ShipmentApvPayoutOffsetRecord {
  return {
    id: String(row.id),
    settlement_release_id: String(row.settlement_release_id),
    order_id: String(row.order_id),
    seller_id: String(row.seller_id),
    currency: String(row.currency),
    seller_liability_minor: numeric(row.seller_liability_minor),
    applied_offset_minor: numeric(row.applied_offset_minor),
    unapplied_liability_minor: numeric(row.unapplied_liability_minor),
    evidence_manifest_sha256: String(row.evidence_manifest_sha256),
    request_id: String(row.request_id),
    allocation_version: numeric(row.allocation_version),
    status: String(row.status) as ShipmentApvPayoutOffsetRecord["status"],
    release_tx_hash: typeof row.release_tx_hash === "string" ? row.release_tx_hash : undefined,
    signature_deadline: row.signature_deadline ? new Date(String(row.signature_deadline)).toISOString() : undefined,
    reservation_expires_at: new Date(String(row.reservation_expires_at)).toISOString(),
    cancelled_at: row.cancelled_at ? new Date(String(row.cancelled_at)).toISOString() : undefined,
  };
}

function mapLiability(row: Record<string, unknown>): ShipmentApvSellerLiabilityRecord {
  return {
    id: String(row.id),
    seller_id: String(row.seller_id),
    source_settlement_release_id: String(row.source_settlement_release_id),
    source_order_id: String(row.source_order_id),
    currency: String(row.currency),
    original_amount_minor: numeric(row.original_amount_minor),
    remaining_amount_minor: numeric(row.remaining_amount_minor),
    status: String(row.status) as ShipmentApvSellerLiabilityRecord["status"],
    evidence_manifest_sha256: String(row.evidence_manifest_sha256),
    version: numeric(row.version),
  };
}

export async function listShipmentApvSellerLiabilities(
  db: Database,
  sellerId: string,
): Promise<ShipmentApvSellerLiabilityRecord[]> {
  const rows = await db.execute(sql`
    SELECT * FROM shipment_apv_seller_liabilities
     WHERE seller_id = ${sellerId}
     ORDER BY CASE status WHEN 'OPEN' THEN 0 WHEN 'PARTIAL' THEN 1 ELSE 2 END,
              created_at ASC, id ASC
  `) as unknown as Array<Record<string, unknown>>;
  return rows.map(mapLiability);
}

export async function getShipmentApvPayoutReservationHealth(
  db: Database,
  now = new Date(),
): Promise<ShipmentApvPayoutReservationHealth> {
  const nowIso = now.toISOString();
  const rows = await db.execute(sql`
    SELECT COUNT(*)::int AS expired_reserved,
           COUNT(*) FILTER (WHERE signature_deadline IS NOT NULL)::int AS signed_expired,
           COUNT(*) FILTER (WHERE signature_deadline IS NULL)::int AS unsigned_expired,
           COUNT(DISTINCT seller_id)::int AS affected_sellers,
           COALESCE(SUM(applied_offset_minor), 0) AS applied_offset_minor,
           MAX(EXTRACT(EPOCH FROM (${nowIso}::timestamptz - COALESCE(signature_deadline, reservation_expires_at))))::int
             AS oldest_expired_age_seconds
      FROM shipment_apv_payout_offsets
     WHERE status = 'RESERVED'
       AND COALESCE(signature_deadline, reservation_expires_at) < ${nowIso}::timestamptz
  `) as unknown as Array<Record<string, unknown>>;
  const row = rows[0] ?? {};
  const expiredReserved = numeric(row.expired_reserved);
  return {
    status: expiredReserved > 0 ? "attention" : "healthy",
    expiredReserved,
    signedExpired: numeric(row.signed_expired),
    unsignedExpired: numeric(row.unsigned_expired),
    affectedSellers: numeric(row.affected_sellers),
    appliedOffsetMinor: numeric(row.applied_offset_minor),
    oldestExpiredAgeSeconds: row.oldest_expired_age_seconds === null || row.oldest_expired_age_seconds === undefined
      ? null
      : numeric(row.oldest_expired_age_seconds),
    recordedAt: nowIso,
  };
}

export async function listExpiredShipmentApvPayoutReservations(
  db: Database,
  input: { limit?: number; cursor?: string; now?: Date } = {},
) {
  const limit = Number.isInteger(input.limit) ? Math.min(100, Math.max(1, input.limit!)) : 20;
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const cursor = input.cursor ? decodeExpiredReservationCursor(input.cursor) : null;
  const cursorClause = cursor ? sql`
    AND (
      COALESCE(signature_deadline, reservation_expires_at) > ${cursor.expiredAt}::timestamptz
      OR (
        COALESCE(signature_deadline, reservation_expires_at) = ${cursor.expiredAt}::timestamptz
        AND id > ${cursor.id}::uuid
      )
    )
  ` : sql``;
  const rows = await db.execute(sql`
    SELECT id, settlement_release_id, order_id, seller_id, currency, applied_offset_minor,
           signature_deadline IS NOT NULL AS signed,
           COALESCE(signature_deadline, reservation_expires_at) AS expired_at,
           EXTRACT(EPOCH FROM (${nowIso}::timestamptz - COALESCE(signature_deadline, reservation_expires_at)))::int
             AS expired_age_seconds,
           created_at
      FROM shipment_apv_payout_offsets
     WHERE status = 'RESERVED'
       AND COALESCE(signature_deadline, reservation_expires_at) < ${nowIso}::timestamptz
       ${cursorClause}
     ORDER BY COALESCE(signature_deadline, reservation_expires_at) ASC, id ASC
     LIMIT ${limit + 1}
  `) as unknown as Array<Record<string, unknown>>;
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const items: ExpiredShipmentApvPayoutReservation[] = pageRows.map((row) => ({
    offsetId: String(row.id),
    settlementReleaseId: String(row.settlement_release_id),
    orderId: String(row.order_id),
    sellerId: String(row.seller_id),
    currency: String(row.currency),
    appliedOffsetMinor: numeric(row.applied_offset_minor),
    signed: Boolean(row.signed),
    expiredAt: new Date(String(row.expired_at)).toISOString(),
    expiredAgeSeconds: numeric(row.expired_age_seconds),
    createdAt: new Date(String(row.created_at)).toISOString(),
  }));
  const last = items.at(-1);
  return {
    items,
    nextCursor: hasMore && last ? encodeExpiredReservationCursor({ expiredAt: last.expiredAt, id: last.offsetId }) : null,
    recordedAt: nowIso,
  };
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; cause?: unknown };
  return candidate.code === "23505" || isUniqueViolation(candidate.cause);
}

function evidenceManifestSha256(rows: Array<Record<string, unknown>>): string {
  const canonical = rows.map((row) => ({
    adjustment_id: String(row.adjustment_id),
    revision_number: numeric(row.revision_number),
    payload_sha256: String(row.payload_sha256),
    evidence_sha256: typeof row.evidence_sha256 === "string" ? row.evidence_sha256 : null,
    status: String(row.status),
    decision: typeof row.decision === "string" ? row.decision : null,
    seller_liability_minor: numeric(row.seller_liability_minor),
  }));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function liabilityManifestSha256(rows: Array<Record<string, unknown>>): string {
  return createHash("sha256").update(JSON.stringify(rows.map((row) => ({
    id: String(row.id),
    source_release_id: String(row.source_settlement_release_id),
    source_order_id: String(row.source_order_id),
    evidence_manifest_sha256: String(row.evidence_manifest_sha256),
    original_amount_minor: numeric(row.original_amount_minor),
    remaining_amount_minor: numeric(row.remaining_amount_minor),
    available_amount_minor: numeric(row.available_amount_minor),
  })))).digest("hex");
}

export function computeShipmentApvPayoutOffset(sellerLiabilityMinor: number, maxOffsetMinor: number) {
  if (!Number.isSafeInteger(sellerLiabilityMinor) || sellerLiabilityMinor < 0
    || !Number.isSafeInteger(maxOffsetMinor) || maxOffsetMinor < 0) {
    throw new Error("APV payout values must be nonnegative safe integers");
  }
  const appliedOffsetMinor = Math.min(sellerLiabilityMinor, maxOffsetMinor);
  return {
    sellerLiabilityMinor,
    appliedOffsetMinor,
    unappliedLiabilityMinor: sellerLiabilityMinor - appliedOffsetMinor,
  };
}

export async function reserveShipmentApvPayoutOffset(
  db: Database,
  input: { settlementReleaseId: string; requestId: string; maxOffsetMinor: number },
): Promise<ShipmentApvPayoutOffsetResult> {
  if (!Number.isSafeInteger(input.maxOffsetMinor) || input.maxOffsetMinor < 0) {
    return { outcome: "snapshot_conflict" };
  }
  try {
    return await db.transaction(async (tx) => {
      const releaseRows = await tx.execute(sql`
        SELECT release.*, orders.seller_id
          FROM settlement_releases AS release
          JOIN commerce_orders AS orders ON orders.id = release.order_id
         WHERE release.id = ${input.settlementReleaseId}
         FOR UPDATE OF release
      `) as unknown as Array<Record<string, unknown>>;
      const release = releaseRows[0];
      if (!release) return { outcome: "not_found" } as const;
      const existingRows = await tx.execute(sql`
        SELECT * FROM shipment_apv_payout_offsets
         WHERE settlement_release_id = ${input.settlementReleaseId}
           AND status IN ('RESERVED', 'APPLIED')
         FOR UPDATE
      `) as unknown as Array<Record<string, unknown>>;
      if (existingRows[0]) {
        const existing = mapOffset(existingRows[0]);
        return existing.request_id === input.requestId
          ? { outcome: "duplicate", offset: existing } as const
          : { outcome: "snapshot_conflict" } as const;
      }

      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(hashtextextended(${`apv-liability:${String(release.seller_id)}`}, 0))
      `);
      const pendingRows = await tx.execute(sql`
        SELECT revision.id
          FROM shipment_apv_adjustment_revisions AS revision
          JOIN shipment_apv_adjustments AS adjustment ON adjustment.id = revision.adjustment_id
         WHERE adjustment.settlement_release_id = ${input.settlementReleaseId}
           AND revision.status = 'PENDING_REVIEW'
         LIMIT 1
      `) as unknown as Array<Record<string, unknown>>;
      if (pendingRows[0]) return { outcome: "pending_revision" } as const;

      const liabilityRows = await tx.execute(sql`
        SELECT COALESCE(SUM(seller_liability_minor), 0) AS seller_liability_minor
          FROM shipment_apv_adjustments
         WHERE settlement_release_id = ${input.settlementReleaseId}
      `) as unknown as Array<Record<string, unknown>>;
      const sellerLiabilityMinor = numeric(liabilityRows[0]?.seller_liability_minor);
      const evidenceRows = await tx.execute(sql`
        SELECT adjustment.id AS adjustment_id, revision.revision_number, revision.payload_sha256,
               revision.evidence_sha256, revision.status, revision.decision, revision.seller_liability_minor
          FROM shipment_apv_adjustments AS adjustment
          JOIN shipment_apv_adjustment_revisions AS revision ON revision.adjustment_id = adjustment.id
         WHERE adjustment.settlement_release_id = ${input.settlementReleaseId}
         ORDER BY adjustment.id, revision.revision_number
      `) as unknown as Array<Record<string, unknown>>;
      const currentEvidenceManifest = evidenceManifestSha256(evidenceRows);
      if (sellerLiabilityMinor > 0) {
        await tx.execute(sql`
          INSERT INTO shipment_apv_seller_liabilities
            (seller_id, source_settlement_release_id, source_order_id, currency,
             original_amount_minor, remaining_amount_minor, evidence_manifest_sha256,
             status, version, created_at, updated_at)
          VALUES
            (${String(release.seller_id)}, ${input.settlementReleaseId}, ${String(release.order_id)},
             ${String(release.product_currency)}, ${sellerLiabilityMinor}, ${sellerLiabilityMinor},
             ${currentEvidenceManifest}, 'OPEN', 0, now(), now())
          ON CONFLICT (source_settlement_release_id) DO NOTHING
        `);
      }

      const liabilities = await tx.execute(sql`
        SELECT liability.*,
               GREATEST(liability.remaining_amount_minor - COALESCE(reserved.amount_minor, 0), 0) AS available_amount_minor
          FROM shipment_apv_seller_liabilities AS liability
          LEFT JOIN (
            SELECT seller_liability_id, SUM(amount_minor) AS amount_minor
              FROM shipment_apv_payout_offset_allocations
             WHERE status = 'RESERVED'
             GROUP BY seller_liability_id
          ) AS reserved ON reserved.seller_liability_id = liability.id
         WHERE liability.seller_id = ${String(release.seller_id)}
           AND liability.currency = ${String(release.product_currency)}
           AND liability.remaining_amount_minor > 0
         ORDER BY liability.created_at ASC, liability.id ASC
         FOR UPDATE OF liability
      `) as unknown as Array<Record<string, unknown>>;
      const totalAvailableMinor = liabilities.reduce((sum, row) => sum + numeric(row.available_amount_minor), 0);
      const { appliedOffsetMinor, unappliedLiabilityMinor } = computeShipmentApvPayoutOffset(
        totalAvailableMinor,
        input.maxOffsetMinor,
      );
      const manifestSha256 = liabilityManifestSha256(liabilities);

      const rows = await tx.execute(sql`
        INSERT INTO shipment_apv_payout_offsets
          (settlement_release_id, order_id, seller_id, currency, seller_liability_minor,
           applied_offset_minor, unapplied_liability_minor, evidence_manifest_sha256,
           request_id, allocation_version, status, reservation_expires_at, created_at, updated_at)
        VALUES
          (${input.settlementReleaseId}, ${String(release.order_id)}, ${String(release.seller_id)},
           ${String(release.product_currency)}, ${totalAvailableMinor}, ${appliedOffsetMinor},
           ${unappliedLiabilityMinor}, ${manifestSha256}, ${input.requestId}, 1, 'RESERVED',
           now() + interval '5 minutes', now(), now())
        RETURNING *
      `) as unknown as Array<Record<string, unknown>>;
      const offset = mapOffset(rows[0]!);
      let remainingToReserve = appliedOffsetMinor;
      for (const liability of liabilities) {
        if (remainingToReserve <= 0) break;
        const amountMinor = Math.min(remainingToReserve, numeric(liability.available_amount_minor));
        if (amountMinor <= 0) continue;
        await tx.execute(sql`
          INSERT INTO shipment_apv_payout_offset_allocations
            (payout_offset_id, seller_liability_id, amount_minor, status, created_at)
          VALUES (${offset.id}, ${String(liability.id)}, ${amountMinor}, 'RESERVED', now())
        `);
        remainingToReserve -= amountMinor;
      }
      if (remainingToReserve !== 0) throw new Error("APV_PAYOUT_ALLOCATION_INCOMPLETE");
      return { outcome: "reserved", offset } as const;
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { outcome: "request_conflict" };
    throw error;
  }
}

export async function completeShipmentApvPayoutOffset(
  db: Database,
  input: { settlementReleaseId: string; payoutOffsetId: string; releaseTxHash: string },
): Promise<ShipmentApvPayoutOffsetResult> {
  return db.transaction(async (tx) => {
    const rows = await tx.execute(sql`
      SELECT * FROM shipment_apv_payout_offsets
       WHERE settlement_release_id = ${input.settlementReleaseId}
         AND id = ${input.payoutOffsetId}
       FOR UPDATE
    `) as unknown as Array<Record<string, unknown>>;
    const existing = rows[0];
    if (!existing) return { outcome: "not_found" } as const;
    if (existing.status === "APPLIED") {
      return existing.release_tx_hash === input.releaseTxHash
        ? { outcome: "duplicate", offset: mapOffset(existing) } as const
        : { outcome: "snapshot_conflict" } as const;
    }
    if (numeric(existing.allocation_version) >= 1) {
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(hashtextextended(${`apv-liability:${String(existing.seller_id)}`}, 0))
      `);
      const allocations = await tx.execute(sql`
        SELECT allocation.*, liability.remaining_amount_minor
          FROM shipment_apv_payout_offset_allocations AS allocation
          JOIN shipment_apv_seller_liabilities AS liability ON liability.id = allocation.seller_liability_id
         WHERE allocation.payout_offset_id = ${String(existing.id)} AND allocation.status = 'RESERVED'
         ORDER BY allocation.created_at ASC, allocation.id ASC
         FOR UPDATE OF allocation, liability
      `) as unknown as Array<Record<string, unknown>>;
      const allocationTotal = allocations.reduce((sum, row) => sum + numeric(row.amount_minor), 0);
      if (allocationTotal !== numeric(existing.applied_offset_minor)) {
        throw new Error("APV_PAYOUT_ALLOCATION_TOTAL_MISMATCH");
      }
      for (const allocation of allocations) {
        const amountMinor = numeric(allocation.amount_minor);
        if (numeric(allocation.remaining_amount_minor) < amountMinor) {
          throw new Error("APV_SELLER_LIABILITY_UNDERFLOW");
        }
        await tx.execute(sql`
          UPDATE shipment_apv_seller_liabilities
             SET remaining_amount_minor = remaining_amount_minor - ${amountMinor},
                 status = CASE
                   WHEN remaining_amount_minor - ${amountMinor} = 0 THEN 'SETTLED'
                   WHEN remaining_amount_minor - ${amountMinor} < original_amount_minor THEN 'PARTIAL'
                   ELSE 'OPEN'
                 END,
                 settled_at = CASE WHEN remaining_amount_minor - ${amountMinor} = 0 THEN now() ELSE NULL END,
                 version = version + 1, updated_at = now()
           WHERE id = ${String(allocation.seller_liability_id)}
        `);
      }
      await tx.execute(sql`
        UPDATE shipment_apv_payout_offset_allocations
           SET status = 'APPLIED', applied_at = now()
         WHERE payout_offset_id = ${String(existing.id)} AND status = 'RESERVED'
      `);
    }
    const updatedRows = await tx.execute(sql`
      UPDATE shipment_apv_payout_offsets
         SET status = 'APPLIED', release_tx_hash = ${input.releaseTxHash}, applied_at = now(), updated_at = now()
       WHERE settlement_release_id = ${input.settlementReleaseId} AND status = 'RESERVED'
      RETURNING *
    `) as unknown as Array<Record<string, unknown>>;
    if (!updatedRows[0]) throw new Error("APV_PAYOUT_OFFSET_CLAIM_LOST");
    return { outcome: "applied", offset: mapOffset(updatedRows[0]) } as const;
  });
}

export async function bindShipmentApvPayoutOffsetSignature(
  db: Database,
  input: { settlementReleaseId: string; payoutOffsetId: string; deadlineUnix: number },
) {
  if (!Number.isSafeInteger(input.deadlineUnix) || input.deadlineUnix <= 0) return { outcome: "snapshot_conflict" } as const;
  return db.transaction(async (tx) => {
    const rows = await tx.execute(sql`
      SELECT * FROM shipment_apv_payout_offsets
       WHERE id = ${input.payoutOffsetId} AND settlement_release_id = ${input.settlementReleaseId}
       FOR UPDATE
    `) as unknown as Array<Record<string, unknown>>;
    const existing = rows[0];
    if (!existing) return { outcome: "not_found" } as const;
    if (existing.status !== "RESERVED") return { outcome: "invalid_state" } as const;
    if (existing.signature_deadline) {
      const existingUnix = Math.floor(new Date(String(existing.signature_deadline)).getTime() / 1000);
      return existingUnix === input.deadlineUnix
        ? { outcome: "duplicate", offset: mapOffset(existing) } as const
        : { outcome: "snapshot_conflict" } as const;
    }
    const updated = await tx.execute(sql`
      UPDATE shipment_apv_payout_offsets
         SET signature_deadline = to_timestamp(${input.deadlineUnix}),
             reservation_expires_at = to_timestamp(${input.deadlineUnix}), updated_at = now()
       WHERE id = ${input.payoutOffsetId} AND status = 'RESERVED'
      RETURNING *
    `) as unknown as Array<Record<string, unknown>>;
    return { outcome: "bound", offset: mapOffset(updated[0]!) } as const;
  });
}

export interface CancelExpiredShipmentApvPayoutOffsetInput {
    settlementReleaseId: string;
    payoutOffsetId: string;
    actorId: string;
    reason: string;
    onchainState: "FUNDED" | "RELEASED" | "REFUNDED" | "DISPUTED" | "NONE";
    approvalRequestId?: string;
    now?: Date;
}

export async function cancelExpiredShipmentApvPayoutOffsetInTransaction(
  tx: Pick<Database, "execute">,
  input: CancelExpiredShipmentApvPayoutOffsetInput,
) {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  if (input.onchainState !== "FUNDED") return { outcome: "onchain_state_conflict" } as const;
  if (input.reason.trim().length < 12 || input.reason.length > 500) return { outcome: "invalid_reason" } as const;
    const rows = await tx.execute(sql`
      SELECT * FROM shipment_apv_payout_offsets
       WHERE id = ${input.payoutOffsetId} AND settlement_release_id = ${input.settlementReleaseId}
       FOR UPDATE
    `) as unknown as Array<Record<string, unknown>>;
    const existing = rows[0];
    if (!existing) return { outcome: "not_found" } as const;
    if (existing.status === "CANCELLED") return { outcome: "duplicate", offset: mapOffset(existing) } as const;
    if (existing.status !== "RESERVED") return { outcome: "invalid_state" } as const;
    const expiry = new Date(String(existing.signature_deadline ?? existing.reservation_expires_at));
    if (!Number.isFinite(expiry.getTime()) || now.getTime() <= expiry.getTime()) {
      return { outcome: "not_expired" } as const;
    }
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${`apv-liability:${String(existing.seller_id)}`}, 0))
    `);
    await tx.execute(sql`
      UPDATE shipment_apv_payout_offset_allocations
         SET status = 'CANCELLED', cancelled_at = ${nowIso}::timestamptz
       WHERE payout_offset_id = ${input.payoutOffsetId} AND status = 'RESERVED'
    `);
    const cancelled = await tx.execute(sql`
      UPDATE shipment_apv_payout_offsets
         SET status = 'CANCELLED', cancelled_at = ${nowIso}::timestamptz, cancelled_by = ${input.actorId},
             cancellation_reason = ${input.reason.trim()}, updated_at = ${nowIso}::timestamptz
       WHERE id = ${input.payoutOffsetId} AND status = 'RESERVED'
      RETURNING *
    `) as unknown as Array<Record<string, unknown>>;
    if (!cancelled[0]) throw new Error("APV_PAYOUT_CANCELLATION_CLAIM_LOST");
    await tx.execute(sql`
      INSERT INTO admin_action_log (actor_id, action_type, target_type, target_id, payload, created_at)
      VALUES (
        ${input.actorId}::uuid,
        'shipment.apv_payout_reservation_cancel',
        'shipment_apv_payout_offset',
        ${input.payoutOffsetId},
        jsonb_build_object(
          'settlement_release_id', ${input.settlementReleaseId}::text,
          'onchain_state', ${input.onchainState}::text,
          'applied_offset_minor', ${numeric(existing.applied_offset_minor)}::numeric,
          'signature_deadline', ${existing.signature_deadline ? String(existing.signature_deadline) : ""}::text,
          'approval_request_id', ${input.approvalRequestId ?? ""}::text,
          'reason', ${input.reason.trim()}::text
        ),
        ${nowIso}::timestamptz
      )
    `);
    return { outcome: "cancelled", offset: mapOffset(cancelled[0]) } as const;
}

export async function cancelExpiredShipmentApvPayoutOffset(
  db: Database,
  input: CancelExpiredShipmentApvPayoutOffsetInput,
) {
  return db.transaction(async (tx) => {
    return cancelExpiredShipmentApvPayoutOffsetInTransaction(tx, input);
  });
}
