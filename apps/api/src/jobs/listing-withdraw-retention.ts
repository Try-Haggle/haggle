import { type Database, sql } from "@haggle/db";
import { LISTING_WITHDRAW_RETENTION_DAYS } from "../lib/listing-withdraw.js";

const DEFAULT_BATCH_SIZE = 50;
const ADVISORY_LOCK_KEY = "haggle:listing-withdraw-retention:v1";

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown[] } | null)?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

export interface ListingWithdrawRetentionResult {
  acquired: boolean;
  deleted: number;
  retentionDays: number;
  batchSize: number;
}

export async function runListingWithdrawRetention(
  db: Database,
  options: { retentionDays?: number; batchSize?: number } = {},
): Promise<ListingWithdrawRetentionResult> {
  const retentionDays = options.retentionDays ?? LISTING_WITHDRAW_RETENTION_DAYS;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 1 || retentionDays > 365) {
    throw new Error("INVALID_LISTING_WITHDRAW_RETENTION_DAYS");
  }
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1_000) {
    throw new Error("INVALID_LISTING_WITHDRAW_RETENTION_BATCH_SIZE");
  }

  return db.transaction(async (tx) => {
    const lock = rowsOf<{ acquired: boolean }>(
      await tx.execute(sql`
        SELECT pg_try_advisory_xact_lock(
          hashtextextended(${ADVISORY_LOCK_KEY}, 0)
        ) AS acquired
      `),
    );
    if (lock[0]?.acquired !== true) {
      return { acquired: false, deleted: 0, retentionDays, batchSize };
    }

    const deleted = rowsOf<{ deleted: number }>(
      await tx.execute(sql`
        WITH due AS (
          SELECT ld.id AS draft_id, lp.id AS published_id
          FROM listing_drafts ld
          JOIN listings_published lp ON lp.draft_id = ld.id
          WHERE ld.withdrawn_at IS NOT NULL
            AND ld.withdrawn_at <= now() - make_interval(days => ${retentionDays})
            AND NOT EXISTS (
              SELECT 1 FROM commerce_orders o WHERE o.listing_id = lp.id
            )
            AND NOT EXISTS (
              SELECT 1 FROM settlement_approvals a WHERE a.listing_id = lp.id
            )
            AND NOT EXISTS (
              SELECT 1 FROM listing_claims c
              WHERE c.listing_id = lp.id AND c.status IN ('FUNDING', 'FUNDED')
            )
            AND NOT EXISTS (
              SELECT 1 FROM negotiation_sessions s
              WHERE s.listing_id = lp.id AND s.status = 'ACCEPTED'
            )
          ORDER BY ld.withdrawn_at ASC
          LIMIT ${batchSize}
        ),
        deleted_views AS (
          DELETE FROM buyer_listings bl
          USING due
          WHERE bl.published_listing_id = due.published_id
        ),
        deleted_claims AS (
          DELETE FROM listing_claims c
          USING due
          WHERE c.listing_id = due.published_id
        ),
        deleted_published AS (
          DELETE FROM listings_published lp
          USING due
          WHERE lp.id = due.published_id
        ),
        deleted_drafts AS (
          DELETE FROM listing_drafts ld
          USING due
          WHERE ld.id = due.draft_id
          RETURNING ld.id
        )
        SELECT count(*)::int AS deleted FROM deleted_drafts
      `),
    );

    return {
      acquired: true,
      deleted: Number(deleted[0]?.deleted ?? 0),
      retentionDays,
      batchSize,
    };
  });
}
