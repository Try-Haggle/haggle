import { sql, type Database } from "@haggle/db";
import {
  API_GLOBAL_RATE_LIMIT,
  API_GLOBAL_RATE_LIMIT_WINDOW_SECONDS,
  hashApiRateLimitIdentity,
} from "../lib/api-rate-limit.js";

export interface ApiRateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  requestCount: number;
}

interface ApiRateLimitRow {
  requestCount: number | string;
  retryAfterSeconds: number | string;
}

export async function consumeApiRateLimit(
  db: Database,
  input: {
    scope: string;
    identity: string;
    hmacSecret: string;
    limit?: number;
    windowSeconds?: number;
  },
): Promise<ApiRateLimitResult> {
  const limit = input.limit ?? API_GLOBAL_RATE_LIMIT;
  const windowSeconds = input.windowSeconds
    ?? API_GLOBAL_RATE_LIMIT_WINDOW_SECONDS;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
    throw new Error("INVALID_API_RATE_LIMIT_MAX_REQUESTS");
  }
  if (!Number.isSafeInteger(windowSeconds)
    || windowSeconds < 1
    || windowSeconds > 3_600) {
    throw new Error("INVALID_API_RATE_LIMIT_WINDOW_SECONDS");
  }
  const keyHash = hashApiRateLimitIdentity({
    scope: input.scope,
    identity: input.identity,
    hmacSecret: input.hmacSecret,
  });
  const cappedCount = limit + 1;

  const rows = await db.execute(sql`
    WITH observed_clock AS (
      SELECT clock_timestamp() AS observed_at
    ), current_window AS (
      SELECT observed_at,
        to_timestamp(
          floor(extract(epoch FROM observed_at) / ${windowSeconds})
          * ${windowSeconds}
        ) AS started_at
      FROM observed_clock
    ), consumed AS (
      INSERT INTO api_rate_limit_windows
        (scope, key_hash, window_started_at, request_count, updated_at)
      SELECT ${input.scope}, ${keyHash}, started_at, 1, observed_at
      FROM current_window
      ON CONFLICT (scope, key_hash) DO UPDATE SET
        window_started_at = CASE
          WHEN api_rate_limit_windows.window_started_at
            = (SELECT started_at FROM current_window)
            THEN api_rate_limit_windows.window_started_at
          ELSE (SELECT started_at FROM current_window)
        END,
        request_count = CASE
          WHEN api_rate_limit_windows.window_started_at
            = (SELECT started_at FROM current_window)
            THEN LEAST(api_rate_limit_windows.request_count + 1, ${cappedCount})
          ELSE 1
        END,
        updated_at = (SELECT observed_at FROM current_window)
      RETURNING request_count, window_started_at
    )
    SELECT request_count AS "requestCount",
      GREATEST(1, CEIL(EXTRACT(EPOCH FROM (
        window_started_at + make_interval(secs => ${windowSeconds})
        - (SELECT observed_at FROM current_window)
      ))))::integer AS "retryAfterSeconds"
    FROM consumed
  `) as unknown as ApiRateLimitRow[];

  const row = rows[0];
  if (!row) throw new Error("API_RATE_LIMIT_COUNTER_NOT_RETURNED");
  const requestCount = Number(row.requestCount);
  const retryAfterSeconds = Number(row.retryAfterSeconds);
  if (!Number.isSafeInteger(requestCount) || requestCount < 1
    || !Number.isSafeInteger(retryAfterSeconds)
    || retryAfterSeconds < 1
    || retryAfterSeconds > windowSeconds) {
    throw new Error("API_RATE_LIMIT_COUNTER_INVALID");
  }
  return {
    allowed: requestCount <= limit,
    retryAfterSeconds: requestCount <= limit ? 0 : retryAfterSeconds,
    requestCount,
  };
}
