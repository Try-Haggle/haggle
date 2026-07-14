import { shippingRateLimitWindows, sql, type Database } from "@haggle/db";

const WINDOW_MS = 60_000;

export interface ShippingRateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  requestCount: number;
  windowStartedAt: Date;
}

export async function consumeShippingRateMissBudget(
  db: Database,
  key: string,
  limit: number,
  now = new Date(),
): Promise<ShippingRateLimitResult> {
  const windowStartedAt = new Date(Math.floor(now.getTime() / WINDOW_MS) * WINDOW_MS);
  const windowStartedAtIso = windowStartedAt.toISOString();
  const cappedCount = limit + 1;
  const [row] = await db
    .insert(shippingRateLimitWindows)
    .values({ key, windowStartedAt, requestCount: 1, updatedAt: now })
    .onConflictDoUpdate({
      target: shippingRateLimitWindows.key,
      set: {
        windowStartedAt,
        requestCount: sql<number>`CASE
          WHEN ${shippingRateLimitWindows.windowStartedAt} = ${windowStartedAtIso}::timestamptz
            THEN LEAST(${shippingRateLimitWindows.requestCount} + 1, ${cappedCount})
          ELSE 1
        END`,
        updatedAt: now,
      },
    })
    .returning();

  if (!row) throw new Error("SHIPPING_RATE_LIMIT_COUNTER_NOT_RETURNED");
  return {
    allowed: row.requestCount <= limit,
    retryAfterSeconds: row.requestCount <= limit
      ? 0
      : Math.max(1, Math.ceil((windowStartedAt.getTime() + WINDOW_MS - now.getTime()) / 1000)),
    requestCount: row.requestCount,
    windowStartedAt: row.windowStartedAt,
  };
}
