import { createHash, timingSafeEqual } from "node:crypto";
import { type Database, sql } from "@haggle/db";
import { signWebhookClaimAlertPayload } from "./webhook-claim-alert.service.js";
import { claimWebhookEvent, type WebhookEventClaim } from "./webhook-event-claim.service.js";

const DELIVERY_ID_RE = /^(?:health|recovery)_[0-9a-f]{64}$/;
export const DISPUTE_SIMILARITY_ARCHIVE_ALERT_RECEIVER_SOURCE =
  "haggle-dispute-similarity-review-audit-archive-alert-receiver";

export function resolveDisputeSimilarityArchiveAlertReceiverSecretsFromEnv() {
  const candidates = [
    process.env.DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_SECRET,
    ...(process.env.DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_PREVIOUS_SECRETS?.split(",") ??
      []),
  ];
  return [
    ...new Set(
      candidates
        .map((item) => item?.trim())
        .filter((item): item is string => Boolean(item && item.length >= 16)),
    ),
  ];
}

export function getDisputeSimilarityArchiveAlertReceiverPolicyStatus() {
  const secrets = resolveDisputeSimilarityArchiveAlertReceiverSecretsFromEnv();
  return {
    configured: secrets.length > 0,
    acceptedSecretCount: secrets.length,
    timestampToleranceSeconds: 300,
  };
}

export async function getDisputeSimilarityArchiveAlertReceiverHealth(db: Database) {
  const rows = (await db.execute(sql`
    SELECT count(*) FILTER (WHERE status = 'PROCESSING')::int AS processing,
           count(*) FILTER (WHERE status = 'COMPLETED')::int AS completed,
           count(*) FILTER (WHERE status = 'FAILED')::int AS failed,
           count(*) FILTER (WHERE status = 'PROCESSING' AND lease_expires_at <= now())::int AS stale_processing,
           count(*) FILTER (WHERE status = 'FAILED' AND (next_attempt_at IS NULL OR next_attempt_at <= now()))::int AS retry_ready,
           max(completed_at) FILTER (WHERE status = 'COMPLETED') AS last_completed_at
      FROM webhook_idempotency
     WHERE source = ${DISPUTE_SIMILARITY_ARCHIVE_ALERT_RECEIVER_SOURCE}
  `)) as unknown as Array<Record<string, string | number | Date | null>>;
  const row = rows[0] ?? {};
  const processing = Number(row.processing ?? 0);
  const failed = Number(row.failed ?? 0);
  const staleProcessing = Number(row.stale_processing ?? 0);
  return {
    status:
      staleProcessing > 0
        ? ("critical" as const)
        : failed > 0
          ? ("warning" as const)
          : ("healthy" as const),
    processing,
    completed: Number(row.completed ?? 0),
    failed,
    staleProcessing,
    retryReady: Number(row.retry_ready ?? 0),
    lastCompletedAt: row.last_completed_at ? new Date(row.last_completed_at).toISOString() : null,
    recordedAt: new Date().toISOString(),
  };
}

export type DisputeSimilarityArchiveAlertVerification =
  | {
      ok: true;
      deliveryId: string;
      payloadSha256: string;
      state: "firing" | "recovered";
      severity: "critical" | "warning" | "recovery";
    }
  | {
      ok: false;
      error:
        | "MISSING_ALERT_AUTH"
        | "INVALID_DELIVERY_ID"
        | "INVALID_ALERT_TIMESTAMP"
        | "ALERT_TIMESTAMP_OUT_OF_RANGE"
        | "INVALID_ALERT_BODY"
        | "ALERT_DELIVERY_ID_MISMATCH"
        | "INVALID_ALERT_SIGNATURE";
    };

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function verifyDisputeSimilarityReviewAuditArchiveAlert(input: {
  rawBody: Buffer | string;
  timestamp?: string | string[];
  signature?: string | string[];
  deliveryId?: string | string[];
  secret: string | string[];
  nowMs?: number;
  toleranceMs?: number;
}): DisputeSimilarityArchiveAlertVerification {
  const timestamp = single(input.timestamp);
  const signature = single(input.signature);
  const deliveryId = single(input.deliveryId);
  if (!timestamp || !signature || !deliveryId) return { ok: false, error: "MISSING_ALERT_AUTH" };
  if (!DELIVERY_ID_RE.test(deliveryId)) return { ok: false, error: "INVALID_DELIVERY_ID" };
  const timestampMs = Date.parse(timestamp);
  if (!Number.isFinite(timestampMs)) return { ok: false, error: "INVALID_ALERT_TIMESTAMP" };
  if (Math.abs((input.nowMs ?? Date.now()) - timestampMs) > (input.toleranceMs ?? 5 * 60_000)) {
    return { ok: false, error: "ALERT_TIMESTAMP_OUT_OF_RANGE" };
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(
      Buffer.isBuffer(input.rawBody) ? input.rawBody.toString("utf8") : input.rawBody,
    ) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "INVALID_ALERT_BODY" };
  }
  const state = body.state;
  const severity = body.severity;
  if (
    body.type !== "dispute_similarity_review_audit_archive.health" ||
    body.created_at !== timestamp ||
    (state !== "firing" && state !== "recovered") ||
    (severity !== "critical" && severity !== "warning" && severity !== "recovery") ||
    (state === "recovered" && severity !== "recovery") ||
    (state === "firing" && severity === "recovery")
  ) {
    return { ok: false, error: "INVALID_ALERT_BODY" };
  }
  if (body.delivery_id !== deliveryId) return { ok: false, error: "ALERT_DELIVERY_ID_MISMATCH" };
  const received = Buffer.from(signature.startsWith("sha256=") ? signature : `sha256=${signature}`);
  const secrets = (Array.isArray(input.secret) ? input.secret : [input.secret]).filter(
    (item) => item.length >= 16,
  );
  let matched = false;
  for (const secret of secrets) {
    const expected = Buffer.from(
      signWebhookClaimAlertPayload(
        secret,
        timestamp,
        Buffer.isBuffer(input.rawBody) ? input.rawBody.toString("utf8") : input.rawBody,
      ),
    );
    matched =
      (received.length === expected.length && timingSafeEqual(received, expected)) || matched;
  }
  if (!matched) return { ok: false, error: "INVALID_ALERT_SIGNATURE" };
  return {
    ok: true,
    deliveryId,
    payloadSha256: createHash("sha256").update(input.rawBody).digest("hex"),
    state,
    severity,
  };
}

export async function claimVerifiedDisputeSimilarityArchiveAlert(
  db: Database,
  verification: Extract<DisputeSimilarityArchiveAlertVerification, { ok: true }>,
  source = DISPUTE_SIMILARITY_ARCHIVE_ALERT_RECEIVER_SOURCE,
): Promise<
  | { outcome: "accepted"; claim: WebhookEventClaim }
  | { outcome: "replay_or_in_progress" }
  | { outcome: "payload_conflict" }
> {
  const claim = await claimWebhookEvent(db, {
    source,
    eventId: verification.deliveryId,
    payloadSha256: verification.payloadSha256,
  });
  if (claim.outcome === "acquired") return { outcome: "accepted", claim };
  if (claim.outcome === "payload_conflict") return { outcome: "payload_conflict" };
  return { outcome: "replay_or_in_progress" };
}
