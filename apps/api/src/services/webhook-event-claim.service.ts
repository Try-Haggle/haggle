import { createHash, randomUUID } from "node:crypto";
import { type Database, sql } from "@haggle/db";

export type WebhookClaimOutcome =
  | "acquired"
  | "duplicate"
  | "in_progress"
  | "retry_later"
  | "payload_conflict";

export interface WebhookEventClaim {
  outcome: WebhookClaimOutcome;
  source: string;
  eventId: string;
  claimId?: string;
  attemptCount?: number;
  leaseExpiresAt?: Date;
  retryAfterSeconds?: number;
}

export interface WebhookClaimHealthSource {
  source: string;
  processing: number;
  completed: number;
  failed: number;
  staleProcessing: number;
  retryReady: number;
  maxAttemptCount: number;
  oldestUnfinishedAgeSeconds: number | null;
}

export interface WebhookClaimHealth {
  status: "healthy" | "warning" | "critical";
  totals: Omit<
    WebhookClaimHealthSource,
    "source" | "maxAttemptCount" | "oldestUnfinishedAgeSeconds"
  >;
  sources: WebhookClaimHealthSource[];
  recordedAt: string;
}

export function webhookPayloadSha256(payload: Buffer | string): string {
  return createHash("sha256").update(payload).digest("hex");
}

export function getWebhookEventClaimLeaseSeconds(): number {
  const value = Number(process.env.WEBHOOK_EVENT_CLAIM_LEASE_SECONDS);
  return Number.isInteger(value) && value >= 15 && value <= 900 ? value : 60;
}

export async function getWebhookClaimHealth(db: Database): Promise<WebhookClaimHealth> {
  const rows = (await db.execute(sql`
    SELECT source,
           count(*) FILTER (WHERE status = 'PROCESSING') AS processing,
           count(*) FILTER (WHERE status = 'COMPLETED') AS completed,
           count(*) FILTER (WHERE status = 'FAILED') AS failed,
           count(*) FILTER (
             WHERE status = 'PROCESSING' AND lease_expires_at <= now()
           ) AS stale_processing,
           count(*) FILTER (
             WHERE status = 'FAILED' AND (next_attempt_at IS NULL OR next_attempt_at <= now())
           ) AS retry_ready,
           coalesce(max(attempt_count), 0) AS max_attempt_count,
           extract(epoch FROM now() - min(created_at) FILTER (WHERE status != 'COMPLETED')) AS oldest_unfinished_age_seconds
      FROM webhook_idempotency
     WHERE source <> 'haggle-webhook-claim-alert'
     GROUP BY source
     ORDER BY source
  `)) as unknown as Array<Record<string, string | number | null>>;
  const sources = rows.map((row) => ({
    source: String(row.source),
    processing: Number(row.processing),
    completed: Number(row.completed),
    failed: Number(row.failed),
    staleProcessing: Number(row.stale_processing),
    retryReady: Number(row.retry_ready),
    maxAttemptCount: Number(row.max_attempt_count),
    oldestUnfinishedAgeSeconds:
      row.oldest_unfinished_age_seconds === null
        ? null
        : Math.max(0, Math.round(Number(row.oldest_unfinished_age_seconds))),
  }));
  const totals = sources.reduce(
    (acc, source) => ({
      processing: acc.processing + source.processing,
      completed: acc.completed + source.completed,
      failed: acc.failed + source.failed,
      staleProcessing: acc.staleProcessing + source.staleProcessing,
      retryReady: acc.retryReady + source.retryReady,
    }),
    { processing: 0, completed: 0, failed: 0, staleProcessing: 0, retryReady: 0 },
  );
  return {
    status: totals.staleProcessing > 0 ? "critical" : totals.failed > 0 ? "warning" : "healthy",
    totals,
    sources,
    recordedAt: new Date().toISOString(),
  };
}

export async function claimWebhookEvent(
  db: Database,
  input: { source: string; eventId: string; payloadSha256: string },
): Promise<WebhookEventClaim> {
  const claimId = randomUUID();
  const lease = getWebhookEventClaimLeaseSeconds();
  const rows = (await db.execute(sql`
    INSERT INTO webhook_idempotency
      (idempotency_key, source, status, claim_id, lease_expires_at, attempt_count,
       payload_sha256, processed_at, expires_at, created_at)
    VALUES
      (${input.eventId}, ${input.source}, 'PROCESSING', ${claimId},
       now() + (${lease} * interval '1 second'), 1, ${input.payloadSha256}, now(),
       now() + interval '30 days', now())
    ON CONFLICT (source, idempotency_key) DO UPDATE
       SET status = 'PROCESSING', claim_id = ${claimId},
           lease_expires_at = now() + (${lease} * interval '1 second'),
           attempt_count = webhook_idempotency.attempt_count + 1,
           last_error = NULL, next_attempt_at = NULL
     WHERE (webhook_idempotency.payload_sha256 IS NULL OR webhook_idempotency.payload_sha256 = EXCLUDED.payload_sha256)
       AND (
         (webhook_idempotency.status = 'PROCESSING' AND webhook_idempotency.lease_expires_at <= now())
         OR
         (webhook_idempotency.status = 'FAILED'
           AND (webhook_idempotency.next_attempt_at IS NULL OR webhook_idempotency.next_attempt_at <= now()))
       )
    RETURNING claim_id AS "claimId", attempt_count AS "attemptCount", lease_expires_at AS "leaseExpiresAt"
  `)) as unknown as Array<{
    claimId: string;
    attemptCount: number | string;
    leaseExpiresAt: Date | string;
  }>;
  const acquired = rows[0];
  if (acquired) {
    return {
      outcome: "acquired",
      source: input.source,
      eventId: input.eventId,
      claimId: acquired.claimId,
      attemptCount: Number(acquired.attemptCount),
      leaseExpiresAt:
        acquired.leaseExpiresAt instanceof Date
          ? acquired.leaseExpiresAt
          : new Date(acquired.leaseExpiresAt),
    };
  }
  const existing = (await db.execute(sql`
    SELECT status, payload_sha256 AS "payloadSha256", next_attempt_at AS "nextAttemptAt"
      FROM webhook_idempotency
     WHERE source = ${input.source} AND idempotency_key = ${input.eventId}
     LIMIT 1
  `)) as unknown as Array<{
    status: "PROCESSING" | "COMPLETED" | "FAILED";
    payloadSha256: string | null;
    nextAttemptAt: Date | null;
  }>;
  const current = existing[0];
  if (!current || (current.payloadSha256 && current.payloadSha256 !== input.payloadSha256)) {
    return { outcome: "payload_conflict", source: input.source, eventId: input.eventId };
  }
  if (current.status === "COMPLETED")
    return { outcome: "duplicate", source: input.source, eventId: input.eventId };
  if (current.status === "PROCESSING")
    return { outcome: "in_progress", source: input.source, eventId: input.eventId };
  const nextAttemptMs = current.nextAttemptAt
    ? new Date(current.nextAttemptAt).getTime()
    : Date.now() + 1000;
  const retryAfterSeconds = Number.isFinite(nextAttemptMs)
    ? Math.min(300, Math.max(1, Math.ceil((nextAttemptMs - Date.now()) / 1000)))
    : 1;
  return {
    outcome: "retry_later",
    source: input.source,
    eventId: input.eventId,
    retryAfterSeconds,
  };
}

export async function completeWebhookEvent(
  db: Database,
  claim: WebhookEventClaim,
  responseStatus: number,
): Promise<boolean> {
  if (!claim.claimId) return false;
  const rows = (await db.execute(sql`
    UPDATE webhook_idempotency
       SET status = 'COMPLETED', response_status = ${responseStatus}, completed_at = now(),
           processed_at = now(), claim_id = NULL, lease_expires_at = NULL,
           next_attempt_at = NULL, last_error = NULL
     WHERE source = ${claim.source} AND idempotency_key = ${claim.eventId}
       AND status = 'PROCESSING' AND claim_id = ${claim.claimId}
     RETURNING id
  `)) as unknown as Array<{ id: string }>;
  if (rows.length !== 1) throw new Error("WEBHOOK_CLAIM_LOST");
  return true;
}

export async function renewWebhookEventClaim(
  db: Database,
  claim: WebhookEventClaim,
): Promise<boolean> {
  if (!claim.claimId) return false;
  const lease = getWebhookEventClaimLeaseSeconds();
  const rows = (await db.execute(sql`
    UPDATE webhook_idempotency
       SET lease_expires_at = now() + (${lease} * interval '1 second')
     WHERE source = ${claim.source} AND idempotency_key = ${claim.eventId}
       AND status = 'PROCESSING' AND claim_id = ${claim.claimId}
     RETURNING id
  `)) as unknown as Array<{ id: string }>;
  return rows.length === 1;
}

export function startWebhookClaimHeartbeat(db: Database, claim: WebhookEventClaim): () => void {
  const intervalMs = Math.max(5_000, Math.floor((getWebhookEventClaimLeaseSeconds() * 1000) / 3));
  let stopped = false;
  const timer = setInterval(async () => {
    if (stopped) return;
    try {
      if (!(await renewWebhookEventClaim(db, claim))) {
        stopped = true;
        clearInterval(timer);
      }
    } catch {
      // A transient DB failure leaves the original lease intact; the next
      // provider retry will take over after expiry if this process cannot seal.
    }
  }, intervalMs);
  timer.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

const WEBHOOK_CHAOS_TEST_SOURCE = "haggle-chaos-test";

function assertChaosTestSource(source: string): void {
  if (source !== WEBHOOK_CHAOS_TEST_SOURCE) throw new Error("WEBHOOK_CHAOS_SOURCE_REQUIRED");
}

export async function expireWebhookClaimForChaosTest(
  db: Database,
  source: string,
  eventId: string,
): Promise<void> {
  assertChaosTestSource(source);
  await db.execute(sql`
    UPDATE webhook_idempotency
       SET lease_expires_at = now() - interval '1 second'
     WHERE source = ${source} AND idempotency_key = ${eventId} AND status = 'PROCESSING'
  `);
}

export async function releaseWebhookFailureBackoffForChaosTest(
  db: Database,
  source: string,
  eventId: string,
): Promise<void> {
  assertChaosTestSource(source);
  await db.execute(sql`
    UPDATE webhook_idempotency
       SET next_attempt_at = now() - interval '1 second'
     WHERE source = ${source} AND idempotency_key = ${eventId} AND status = 'FAILED'
  `);
}

export async function cleanupWebhookChaosTestClaims(
  db: Database,
  source: string,
  eventPrefix: string,
): Promise<number> {
  assertChaosTestSource(source);
  if (!/^chaos_[0-9a-f-]{36}_$/.test(eventPrefix)) throw new Error("INVALID_WEBHOOK_CHAOS_PREFIX");
  const rows = (await db.execute(sql`
    DELETE FROM webhook_idempotency
     WHERE source = ${source} AND idempotency_key LIKE ${`${eventPrefix}%`}
    RETURNING id
  `)) as unknown as Array<{ id: string }>;
  return rows.length;
}

export async function failWebhookEvent(db: Database, claim: WebhookEventClaim): Promise<void> {
  if (!claim.claimId) return;
  const delaySeconds = Math.min(300, 2 ** Math.min(claim.attemptCount ?? 1, 8));
  await db.execute(sql`
    UPDATE webhook_idempotency
       SET status = 'FAILED', claim_id = NULL, lease_expires_at = NULL,
           next_attempt_at = now() + (${delaySeconds} * interval '1 second'),
           last_error = 'WEBHOOK_PROCESSING_FAILED'
     WHERE source = ${claim.source} AND idempotency_key = ${claim.eventId}
       AND status = 'PROCESSING' AND claim_id = ${claim.claimId}
  `);
}
