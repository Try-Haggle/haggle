import { type Database, sql } from "@haggle/db";

const DEFAULT_BATCH_SIZE = 1_000;
const RETENTION_INTERVAL_SECONDS = 5 * 60;
const ADVISORY_LOCK_KEY = "haggle:websocket-auth-ticket-retention:v1";

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown[] } | null)?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

export interface WebSocketTicketRetentionResult {
  acquired: boolean;
  deleted: number;
  batchSize: number;
}

export async function runWebSocketAuthTicketRetention(
  db: Database,
  options: { batchSize?: number; fixtureUserId?: string } = {},
): Promise<WebSocketTicketRetentionResult> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 10_000) {
    throw new Error("INVALID_WEBSOCKET_TICKET_RETENTION_BATCH_SIZE");
  }
  if (
    options.fixtureUserId !== undefined &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      options.fixtureUserId,
    )
  ) {
    throw new Error("INVALID_WEBSOCKET_TICKET_RETENTION_FIXTURE_USER");
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
      return { acquired: false, deleted: 0, batchSize };
    }

    const deleted = rowsOf(
      await tx.execute(sql`
      WITH expired AS (
        SELECT id
        FROM websocket_auth_tickets
        WHERE expires_at <= clock_timestamp()
          AND (${options.fixtureUserId ?? null}::uuid IS NULL
            OR user_id = ${options.fixtureUserId ?? null}::uuid)
        ORDER BY expires_at ASC, id ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM websocket_auth_tickets ticket
      USING expired
      WHERE ticket.id = expired.id
      RETURNING 1 AS deleted
    `),
    );
    return { acquired: true, deleted: deleted.length, batchSize };
  });
}

export async function getWebSocketAuthTicketRetentionHealth(db: Database) {
  const rows = rowsOf<{
    active_count: string | number;
    expired_count: string | number;
    oldest_expired_age_seconds: string | number | null;
  }>(
    await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE expires_at > clock_timestamp())::text AS active_count,
      count(*) FILTER (WHERE expires_at <= clock_timestamp())::text AS expired_count,
      CASE WHEN count(*) FILTER (WHERE expires_at <= clock_timestamp()) = 0
        THEN NULL
        ELSE floor(extract(epoch FROM (
          clock_timestamp() - min(expires_at) FILTER (
            WHERE expires_at <= clock_timestamp()
          )
        )))::text
      END AS oldest_expired_age_seconds
    FROM websocket_auth_tickets
  `),
  );
  const row = rows[0];
  return {
    status: Number(row?.expired_count ?? 0) === 0 ? "healthy" : "backlog",
    activeCount: Number(row?.active_count ?? 0),
    expiredCount: Number(row?.expired_count ?? 0),
    oldestExpiredAgeSeconds:
      row?.oldest_expired_age_seconds === null || row?.oldest_expired_age_seconds === undefined
        ? null
        : Number(row.oldest_expired_age_seconds),
    recordedAt: new Date().toISOString(),
  } as const;
}

export function getWebSocketAuthTicketRetentionPolicyStatus() {
  return {
    scheduled: process.env.ENABLE_CRON === "true",
    intervalSeconds: RETENTION_INTERVAL_SECONDS,
    runOnStart: true,
    batchSize: DEFAULT_BATCH_SIZE,
    singleton: "postgres_advisory_transaction_lock",
    skipLocked: true,
    containsTicket: false,
    containsHash: false,
    containsUserId: false,
  } as const;
}
