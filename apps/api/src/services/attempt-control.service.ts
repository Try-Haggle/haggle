import type { Database } from "@haggle/db";
import { sql } from "drizzle-orm";

export interface AttemptControlPolicy {
  scope: "buyer_per_listing";
  principalType: "authenticated_credential";
  maxConcurrentSessions: number;
  maxSessionsPerWindow: number;
  windowSeconds: number;
  cooldownSeconds: number;
  maxRoundsPerSession: number;
  marketplaceDailyAttempts: number;
  entitlementSource: "free";
}

export interface AttemptControlSnapshot {
  scope: AttemptControlPolicy["scope"];
  principal_type: AttemptControlPolicy["principalType"];
  max_concurrent_sessions: number;
  max_sessions_per_window: number;
  window_seconds: number;
  cooldown_seconds: number;
  max_rounds_per_session: number;
  marketplace_daily_attempts: number;
  entitlement_source: AttemptControlPolicy["entitlementSource"];
  remaining_sessions: number;
  remaining_marketplace_attempts: number;
  remaining_rounds: number;
  active_sessions: number;
  active_sessions_on_listing: number;
  retry_after_seconds: number | null;
}

export type AttemptControlBlockRule =
  | "concurrent_on_listing"
  | "buyer_listing_window"
  | "marketplace_daily"
  | "listing_cooldown";

export type AttemptControlError =
  | "CONCURRENT_SESSION_LIMIT_EXCEEDED"
  | "ATTEMPT_LIMIT_EXCEEDED"
  | "ATTEMPT_WINDOW_EXCEEDED"
  | "MARKETPLACE_ATTEMPT_LIMIT_EXCEEDED"
  | "ATTEMPT_COOLDOWN";

export interface AttemptControlResult {
  allowed: boolean;
  error?: AttemptControlError;
  rule?: AttemptControlBlockRule;
  retryAfterSeconds?: number;
  attemptControl: AttemptControlSnapshot;
}

export function isAttemptControlRateLimited(error: AttemptControlError | undefined): boolean {
  return (
    error === "ATTEMPT_LIMIT_EXCEEDED" ||
    error === "ATTEMPT_WINDOW_EXCEEDED" ||
    error === "MARKETPLACE_ATTEMPT_LIMIT_EXCEEDED" ||
    error === "ATTEMPT_COOLDOWN"
  );
}

export function defaultAttemptControlPolicy(): AttemptControlPolicy {
  return {
    scope: "buyer_per_listing",
    principalType: "authenticated_credential",
    maxConcurrentSessions: intEnv("HNP_MAX_CONCURRENT_BUYER_LISTING_SESSIONS", 1),
    maxSessionsPerWindow: intEnv("HNP_MAX_BUYER_LISTING_SESSIONS_PER_WINDOW", 3),
    windowSeconds: intEnv("HNP_ATTEMPT_WINDOW_SECONDS", 86_400),
    cooldownSeconds: intEnv("HNP_ATTEMPT_COOLDOWN_SECONDS", 43_200),
    maxRoundsPerSession: intEnv("HNP_MAX_ROUNDS_PER_SESSION", 10),
    marketplaceDailyAttempts: intEnv("HNP_MARKETPLACE_DAILY_ATTEMPTS", 5),
    entitlementSource: "free",
  };
}

export async function evaluateAttemptControl(
  db: Database,
  input: {
    buyerPrincipalId: string;
    listingId: string;
    nowMs?: number;
    policy?: AttemptControlPolicy;
  },
): Promise<AttemptControlResult> {
  const policy = input.policy ?? defaultAttemptControlPolicy();
  const now = new Date(input.nowMs ?? Date.now());
  const windowStart = new Date(now.getTime() - policy.windowSeconds * 1000);
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  // drizzle + postgres-js cannot bind JS Date in raw sql`` — it throws in Bind().
  const nowIso = now.toISOString();
  const windowStartIso = windowStart.toISOString();
  const dayStartIso = dayStart.toISOString();

  const rows = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (
          WHERE buyer_id = ${input.buyerPrincipalId}::uuid
          AND status IN ('CREATED', 'ACTIVE', 'NEAR_DEAL', 'STALLED', 'WAITING', 'NEGOTIATING_VERSION')
          AND (expires_at IS NULL OR expires_at > ${nowIso}::timestamptz)
      )::int AS active_sessions,
      COUNT(*) FILTER (
        WHERE buyer_id = ${input.buyerPrincipalId}::uuid
          AND listing_id = ${input.listingId}::uuid
          AND status IN ('CREATED', 'ACTIVE', 'NEAR_DEAL', 'STALLED', 'WAITING', 'NEGOTIATING_VERSION')
          AND (expires_at IS NULL OR expires_at > ${nowIso}::timestamptz)
      )::int AS active_sessions_on_listing,
      COUNT(*) FILTER (
        WHERE buyer_id = ${input.buyerPrincipalId}::uuid
          AND listing_id = ${input.listingId}::uuid
          AND created_at >= ${windowStartIso}::timestamptz
      )::int AS sessions_in_window,
      COUNT(*) FILTER (
        WHERE buyer_id = ${input.buyerPrincipalId}::uuid
          AND created_at >= ${dayStartIso}::timestamptz
      )::int AS marketplace_attempts_today,
      MAX(created_at) FILTER (
        WHERE buyer_id = ${input.buyerPrincipalId}::uuid
          AND listing_id = ${input.listingId}::uuid
      ) AS last_listing_attempt_at
    FROM negotiation_sessions
    WHERE buyer_id = ${input.buyerPrincipalId}::uuid
  `);

  const row = firstExecuteRow(rows);
  const activeSessions = toInt(row.active_sessions);
  const activeSessionsOnListing = toInt(row.active_sessions_on_listing);
  const sessionsInWindow = toInt(row.sessions_in_window);
  const marketplaceAttemptsToday = toInt(row.marketplace_attempts_today);
  const lastListingAttemptAt = row.last_listing_attempt_at
    ? new Date(String(row.last_listing_attempt_at))
    : null;

  const cooldownRemaining = lastListingAttemptAt
    ? Math.max(
        0,
        Math.ceil(
          (lastListingAttemptAt.getTime() + policy.cooldownSeconds * 1000 - now.getTime()) / 1000,
        ),
      )
    : 0;

  const snapshot: AttemptControlSnapshot = {
    scope: policy.scope,
    principal_type: policy.principalType,
    max_concurrent_sessions: policy.maxConcurrentSessions,
    max_sessions_per_window: policy.maxSessionsPerWindow,
    window_seconds: policy.windowSeconds,
    cooldown_seconds: policy.cooldownSeconds,
    max_rounds_per_session: policy.maxRoundsPerSession,
    marketplace_daily_attempts: policy.marketplaceDailyAttempts,
    entitlement_source: policy.entitlementSource,
    remaining_sessions: Math.max(0, policy.maxSessionsPerWindow - sessionsInWindow),
    remaining_marketplace_attempts: Math.max(
      0,
      policy.marketplaceDailyAttempts - marketplaceAttemptsToday,
    ),
    remaining_rounds: policy.maxRoundsPerSession,
    active_sessions: activeSessions,
    active_sessions_on_listing: activeSessionsOnListing,
    retry_after_seconds: cooldownRemaining > 0 ? cooldownRemaining : null,
  };

  if (activeSessionsOnListing >= policy.maxConcurrentSessions) {
    return {
      allowed: false,
      error: "CONCURRENT_SESSION_LIMIT_EXCEEDED",
      rule: "concurrent_on_listing",
      attemptControl: snapshot,
    };
  }

  if (sessionsInWindow >= policy.maxSessionsPerWindow) {
    return {
      allowed: false,
      error: "ATTEMPT_WINDOW_EXCEEDED",
      rule: "buyer_listing_window",
      retryAfterSeconds: cooldownRemaining || policy.windowSeconds,
      attemptControl: snapshot,
    };
  }

  if (marketplaceAttemptsToday >= policy.marketplaceDailyAttempts) {
    const msUntilUtcDayEnd = dayStart.getTime() + 86_400_000 - now.getTime();
    return {
      allowed: false,
      error: "MARKETPLACE_ATTEMPT_LIMIT_EXCEEDED",
      rule: "marketplace_daily",
      retryAfterSeconds: Math.max(1, Math.ceil(msUntilUtcDayEnd / 1000)),
      attemptControl: snapshot,
    };
  }

  // listing_cooldown (HNP_ATTEMPT_COOLDOWN_SECONDS, default 12h) is not an
  // attempt-count gate. remaining_sessions>0 + remaining_marketplace>0 +
  // active 0 must start (joUdQ7Tw / #111). Do not 429 ATTEMPT_LIMIT with
  // retry_after ~3h from leftover last_listing_attempt_at after a rejected
  // CREATED session. B10: concurrent/overlapping starts in that state must
  // also never false-block via listing_cooldown; once an active session
  // exists, the next evaluate names concurrent_on_listing instead.
  return { allowed: true, attemptControl: snapshot };
}

/**
 * C2: close evaluate→createSession TOCTOU.
 * Serialize buyer+listing start under a transaction-scoped advisory lock, then
 * re-evaluate before the caller inserts. Race loser surfaces the recheck block
 * (typically concurrent_on_listing) instead of silent double-create / wrong cooldown.
 */
export async function withBuyerListingStartGate<T>(
  db: Database,
  input: {
    buyerPrincipalId: string;
    listingId: string;
    nowMs?: number;
    policy?: AttemptControlPolicy;
  },
  run: (tx: Database, attemptControl: AttemptControlSnapshot) => Promise<T>,
): Promise<
  | { ok: true; value: T; attemptControl: AttemptControlSnapshot }
  | { ok: false; attemptResult: AttemptControlResult }
> {
  return db.transaction(async (tx) => {
    const lockKey = `haggle.buyer-listing-start.v1:${input.buyerPrincipalId}:${input.listingId}`;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);

    const recheck = await evaluateAttemptControl(tx as Database, {
      buyerPrincipalId: input.buyerPrincipalId,
      listingId: input.listingId,
      nowMs: input.nowMs,
      policy: input.policy,
    });
    if (!recheck.allowed) {
      return { ok: false as const, attemptResult: recheck };
    }

    const value = await run(tx as Database, recheck.attemptControl);
    return { ok: true as const, value, attemptControl: recheck.attemptControl };
  });
}

function intEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function toInt(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstExecuteRow(result: unknown): Record<string, unknown> {
  if (Array.isArray(result)) {
    return (result[0] ?? {}) as Record<string, unknown>;
  }
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return (rows[0] ?? {}) as Record<string, unknown>;
  }
  return {};
}
