import { sql, type Database } from "@haggle/db";

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

export interface AttemptControlResult {
  allowed: boolean;
  error?: "CONCURRENT_SESSION_LIMIT_EXCEEDED" | "ATTEMPT_LIMIT_EXCEEDED";
  retryAfterSeconds?: number;
  attemptControl: AttemptControlSnapshot;
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

  const rows = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (
          WHERE buyer_id = ${input.buyerPrincipalId}
          AND status IN ('CREATED', 'ACTIVE', 'NEAR_DEAL', 'STALLED', 'WAITING', 'NEGOTIATING_VERSION')
          AND (expires_at IS NULL OR expires_at > ${now})
      )::int AS active_sessions,
      COUNT(*) FILTER (
        WHERE buyer_id = ${input.buyerPrincipalId}
          AND listing_id = ${input.listingId}
          AND status IN ('CREATED', 'ACTIVE', 'NEAR_DEAL', 'STALLED', 'WAITING', 'NEGOTIATING_VERSION')
          AND (expires_at IS NULL OR expires_at > ${now})
      )::int AS active_sessions_on_listing,
      COUNT(*) FILTER (
        WHERE buyer_id = ${input.buyerPrincipalId}
          AND listing_id = ${input.listingId}
          AND created_at >= ${windowStart}
      )::int AS sessions_in_window,
      COUNT(*) FILTER (
        WHERE buyer_id = ${input.buyerPrincipalId}
          AND created_at >= ${dayStart}
      )::int AS marketplace_attempts_today,
      MAX(created_at) FILTER (
        WHERE buyer_id = ${input.buyerPrincipalId}
          AND listing_id = ${input.listingId}
      ) AS last_listing_attempt_at
    FROM negotiation_sessions
    WHERE buyer_id = ${input.buyerPrincipalId}
  `);

  const row = ((rows as unknown as Record<string, unknown>[])[0] ?? {}) as Record<string, unknown>;
  const activeSessions = toInt(row.active_sessions);
  const activeSessionsOnListing = toInt(row.active_sessions_on_listing);
  const sessionsInWindow = toInt(row.sessions_in_window);
  const marketplaceAttemptsToday = toInt(row.marketplace_attempts_today);
  const lastListingAttemptAt = row.last_listing_attempt_at ? new Date(String(row.last_listing_attempt_at)) : null;

  const cooldownRemaining = lastListingAttemptAt
    ? Math.max(0, Math.ceil((lastListingAttemptAt.getTime() + policy.cooldownSeconds * 1000 - now.getTime()) / 1000))
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
    remaining_marketplace_attempts: Math.max(0, policy.marketplaceDailyAttempts - marketplaceAttemptsToday),
    remaining_rounds: policy.maxRoundsPerSession,
    active_sessions: activeSessions,
    active_sessions_on_listing: activeSessionsOnListing,
    retry_after_seconds: cooldownRemaining > 0 ? cooldownRemaining : null,
  };

  if (activeSessionsOnListing >= policy.maxConcurrentSessions) {
    return {
      allowed: false,
      error: "CONCURRENT_SESSION_LIMIT_EXCEEDED",
      attemptControl: snapshot,
    };
  }

  if (
    sessionsInWindow >= policy.maxSessionsPerWindow ||
    marketplaceAttemptsToday >= policy.marketplaceDailyAttempts ||
    cooldownRemaining > 0
  ) {
    return {
      allowed: false,
      error: "ATTEMPT_LIMIT_EXCEEDED",
      retryAfterSeconds: cooldownRemaining || policy.windowSeconds,
      attemptControl: snapshot,
    };
  }

  return { allowed: true, attemptControl: snapshot };
}

function intEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function toInt(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
