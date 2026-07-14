import { type Database, sql } from "@haggle/db";

const RETENTION_HOURS = 24;
const DEFAULT_BATCH_SIZE = 1_000;

export interface ApiRateLimitRetentionResult {
  deleted: number;
  retentionHours: number;
  batchSize: number;
}

export async function runApiRateLimitRetention(
  db: Database,
  options: {
    retentionHours?: number;
    batchSize?: number;
    scope?: string;
  } = {},
): Promise<ApiRateLimitRetentionResult> {
  const retentionHours = options.retentionHours ?? RETENTION_HOURS;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  if (!Number.isSafeInteger(retentionHours) || retentionHours < 1 || retentionHours > 24 * 30) {
    throw new Error("INVALID_API_RATE_LIMIT_RETENTION_HOURS");
  }
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 10_000) {
    throw new Error("INVALID_API_RATE_LIMIT_RETENTION_BATCH_SIZE");
  }
  if (options.scope !== undefined && !/^[a-z0-9:_-]{1,64}$/i.test(options.scope)) {
    throw new Error("INVALID_API_RATE_LIMIT_RETENTION_SCOPE");
  }

  const rows = (await db.execute(sql`
    WITH expired AS (
      SELECT ctid
      FROM api_rate_limit_windows
      WHERE updated_at < clock_timestamp()
        - make_interval(hours => ${retentionHours})
        AND (${options.scope ?? null}::text IS NULL
          OR scope = ${options.scope ?? null})
      ORDER BY updated_at
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    )
    DELETE FROM api_rate_limit_windows target
    USING expired
    WHERE target.ctid = expired.ctid
    RETURNING 1 AS deleted
  `)) as unknown as Array<{ deleted: number | string }>;

  return { deleted: rows.length, retentionHours, batchSize };
}
