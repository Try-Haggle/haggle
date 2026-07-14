import { createHash, timingSafeEqual } from "node:crypto";
import { type Database, sql } from "@haggle/db";
import { signWebhookClaimAlertPayload } from "./webhook-claim-alert.service.js";
import { claimWebhookEvent, type WebhookEventClaim } from "./webhook-event-claim.service.js";

const DELIVERY_ID_RE = /^(?:health|recovery)_[0-9a-f]{64}$/;
const BODY_KEYS = new Set([
  "type",
  "delivery_id",
  "state",
  "created_at",
  "severity",
  "reasons",
  "totals",
  "sources",
]);
const TOTAL_KEYS = new Set(["processing", "completed", "failed", "staleProcessing", "retryReady"]);
const SOURCE_KEYS = new Set([
  "source",
  "processing",
  "failed",
  "stale_processing",
  "retry_ready",
  "max_attempt_count",
  "oldest_unfinished_age_seconds",
]);
const FIRING_REASONS = ["stale_processing", "failed", "retry_ready"] as const;
const SOURCE_RE = /^[A-Za-z0-9._:-]{1,160}$/;
const MIN_SECRET_LENGTH = 16;
const MAX_SECRET_LENGTH = 128;
export const WEBHOOK_CLAIM_ALERT_MAX_RECEIVER_SECRETS = 4;
export const WEBHOOK_CLAIM_ALERT_RECEIVER_SOURCE = "haggle-webhook-claim-health-alert-receiver";

export function resolveWebhookClaimAlertReceiverSecretsFromEnv() {
  const current = process.env.WEBHOOK_CLAIM_ALERT_SECRET?.trim() ?? "";
  const previousRaw = process.env.WEBHOOK_CLAIM_ALERT_PREVIOUS_SECRETS?.trim() ?? "";
  const previous = previousRaw ? previousRaw.split(",").map((item) => item.trim()) : [];
  if (!current && previous.length)
    throw new Error(
      "webhook claim alert current secret is required when previous secrets are configured",
    );
  const secrets = current ? [current, ...previous] : [];
  if (secrets.some((item) => item.length < MIN_SECRET_LENGTH || item.length > MAX_SECRET_LENGTH)) {
    throw new Error(
      `webhook claim alert receiver secrets must be ${MIN_SECRET_LENGTH}..${MAX_SECRET_LENGTH} characters`,
    );
  }
  if (new Set(secrets).size !== secrets.length)
    throw new Error("webhook claim alert receiver secrets must be unique");
  if (secrets.length > WEBHOOK_CLAIM_ALERT_MAX_RECEIVER_SECRETS) {
    throw new Error(
      `webhook claim alert receiver accepts at most ${WEBHOOK_CLAIM_ALERT_MAX_RECEIVER_SECRETS} secrets`,
    );
  }
  return secrets;
}

export function getWebhookClaimAlertReceiverPolicyStatus() {
  try {
    const secrets = resolveWebhookClaimAlertReceiverSecretsFromEnv();
    return {
      configured: secrets.length > 0,
      configurationState: secrets.length ? ("valid" as const) : ("not_configured" as const),
      acceptedSecretCount: secrets.length,
      maxAcceptedSecretCount: WEBHOOK_CLAIM_ALERT_MAX_RECEIVER_SECRETS,
      timestampToleranceSeconds: 300,
    };
  } catch {
    return {
      configured: false,
      configurationState: "invalid" as const,
      acceptedSecretCount: 0,
      maxAcceptedSecretCount: WEBHOOK_CLAIM_ALERT_MAX_RECEIVER_SECRETS,
      timestampToleranceSeconds: 300,
    };
  }
}

export async function getWebhookClaimAlertReceiverHealth(
  db: Database,
  source = WEBHOOK_CLAIM_ALERT_RECEIVER_SOURCE,
) {
  const rows =
    (await db.execute(sql`SELECT count(*) FILTER (WHERE status = 'PROCESSING')::int AS processing,
    count(*) FILTER (WHERE status = 'COMPLETED')::int AS completed, count(*) FILTER (WHERE status = 'FAILED')::int AS failed,
    count(*) FILTER (WHERE status = 'PROCESSING' AND lease_expires_at <= now())::int AS stale_processing,
    count(*) FILTER (WHERE status = 'FAILED' AND (next_attempt_at IS NULL OR next_attempt_at <= now()))::int AS retry_ready,
    max(completed_at) FILTER (WHERE status = 'COMPLETED') AS last_completed_at
    FROM webhook_idempotency WHERE source = ${source}`)) as unknown as Array<
      Record<string, string | number | Date | null>
    >;
  const row = rows[0] ?? {};
  const failed = Number(row.failed ?? 0);
  const staleProcessing = Number(row.stale_processing ?? 0);
  return {
    status:
      staleProcessing > 0
        ? ("critical" as const)
        : failed > 0
          ? ("warning" as const)
          : ("healthy" as const),
    processing: Number(row.processing ?? 0),
    completed: Number(row.completed ?? 0),
    failed,
    staleProcessing,
    retryReady: Number(row.retry_ready ?? 0),
    lastCompletedAt: row.last_completed_at ? new Date(row.last_completed_at).toISOString() : null,
    recordedAt: new Date().toISOString(),
  };
}

type Verification =
  | {
      ok: true;
      deliveryId: string;
      payloadSha256: string;
      state: "firing" | "recovered";
      severity: "warning" | "critical" | "recovery";
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
function nonnegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validAggregate(body: Record<string, unknown>) {
  const totals = body.totals;
  const sources = body.sources;
  if (
    !totals ||
    typeof totals !== "object" ||
    Array.isArray(totals) ||
    Object.keys(totals).some((key) => !TOTAL_KEYS.has(key)) ||
    [...TOTAL_KEYS].some((key) => !nonnegativeInteger((totals as Record<string, unknown>)[key]))
  )
    return false;
  const total = totals as Record<string, number>;
  if (
    total.staleProcessing > total.processing ||
    total.retryReady > total.failed ||
    !Array.isArray(sources) ||
    sources.length > 100
  )
    return false;
  const names = new Set<string>();
  const sums = { processing: 0, failed: 0, staleProcessing: 0, retryReady: 0 };
  for (const rawSource of sources) {
    if (!rawSource || typeof rawSource !== "object" || Array.isArray(rawSource)) return false;
    const source = rawSource as Record<string, unknown>;
    if (
      Object.keys(source).some((key) => !SOURCE_KEYS.has(key)) ||
      typeof source.source !== "string" ||
      !SOURCE_RE.test(source.source) ||
      names.has(source.source)
    )
      return false;
    names.add(source.source);
    for (const key of [
      "processing",
      "failed",
      "stale_processing",
      "retry_ready",
      "max_attempt_count",
    ]) {
      if (!nonnegativeInteger(source[key])) return false;
    }
    if (
      source.oldest_unfinished_age_seconds !== null &&
      !nonnegativeInteger(source.oldest_unfinished_age_seconds)
    )
      return false;
    if (
      (source.stale_processing as number) > (source.processing as number) ||
      (source.retry_ready as number) > (source.failed as number) ||
      ((source.processing as number) + (source.failed as number) === 0) !==
        (source.oldest_unfinished_age_seconds === null)
    )
      return false;
    sums.processing += source.processing as number;
    sums.failed += source.failed as number;
    sums.staleProcessing += source.stale_processing as number;
    sums.retryReady += source.retry_ready as number;
  }
  return (
    sums.processing === total.processing &&
    sums.failed === total.failed &&
    sums.staleProcessing === total.staleProcessing &&
    sums.retryReady === total.retryReady
  );
}

export function verifyWebhookClaimHealthAlert(input: {
  rawBody: Buffer | string;
  timestamp?: string | string[];
  signature?: string | string[];
  deliveryId?: string | string[];
  secret: string | string[];
  nowMs?: number;
  toleranceMs?: number;
}): Verification {
  const timestamp = single(input.timestamp);
  const signature = single(input.signature);
  const deliveryId = single(input.deliveryId);
  if (!timestamp || !signature || !deliveryId) return { ok: false, error: "MISSING_ALERT_AUTH" };
  if (!DELIVERY_ID_RE.test(deliveryId)) return { ok: false, error: "INVALID_DELIVERY_ID" };
  const timestampMs = Date.parse(timestamp);
  if (!Number.isFinite(timestampMs)) return { ok: false, error: "INVALID_ALERT_TIMESTAMP" };
  if (Math.abs((input.nowMs ?? Date.now()) - timestampMs) > (input.toleranceMs ?? 300_000))
    return { ok: false, error: "ALERT_TIMESTAMP_OUT_OF_RANGE" };
  const raw = Buffer.isBuffer(input.rawBody) ? input.rawBody.toString("utf8") : input.rawBody;
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false, error: "INVALID_ALERT_BODY" };
  }
  if (
    Object.keys(body).some((key) => !BODY_KEYS.has(key)) ||
    body.type !== "webhook_claim.health" ||
    body.delivery_id !== deliveryId ||
    body.created_at !== timestamp ||
    !validAggregate(body) ||
    !Array.isArray(body.reasons) ||
    body.reasons.some((reason) => typeof reason !== "string")
  ) {
    return {
      ok: false,
      error: body.delivery_id !== deliveryId ? "ALERT_DELIVERY_ID_MISMATCH" : "INVALID_ALERT_BODY",
    };
  }
  const state = body.state;
  const severity = body.severity;
  const reasons = body.reasons as string[];
  const totals = body.totals as Record<string, number>;
  const validRecovery =
    state === "recovered" &&
    severity === "recovery" &&
    reasons.length === 1 &&
    reasons[0] === "webhook_claim_recovered" &&
    totals.staleProcessing === 0 &&
    totals.failed === 0 &&
    totals.retryReady === 0;
  const validFiring =
    state === "firing" &&
    (severity === "warning" || severity === "critical") &&
    reasons.length > 0 &&
    new Set(reasons).size === reasons.length &&
    reasons.every((reason) => (FIRING_REASONS as readonly string[]).includes(reason)) &&
    reasons.every((reason) =>
      reason === "stale_processing"
        ? totals.staleProcessing > 0
        : reason === "failed"
          ? totals.failed > 0
          : totals.retryReady > 0,
    ) &&
    (severity === "critical") === reasons.includes("stale_processing");
  if (!validRecovery && !validFiring) return { ok: false, error: "INVALID_ALERT_BODY" };
  const secrets = Array.isArray(input.secret) ? input.secret : [input.secret];
  if (
    !secrets.length ||
    secrets.length > WEBHOOK_CLAIM_ALERT_MAX_RECEIVER_SECRETS ||
    secrets.some((item) => item.length < MIN_SECRET_LENGTH || item.length > MAX_SECRET_LENGTH)
  ) {
    return { ok: false, error: "INVALID_ALERT_SIGNATURE" };
  }
  const received = Buffer.from(signature.startsWith("sha256=") ? signature : `sha256=${signature}`);
  let matched = false;
  for (const secret of secrets) {
    const expected = Buffer.from(signWebhookClaimAlertPayload(secret, timestamp, raw));
    matched =
      (received.length === expected.length && timingSafeEqual(received, expected)) || matched;
  }
  if (!matched) return { ok: false, error: "INVALID_ALERT_SIGNATURE" };
  return {
    ok: true,
    deliveryId,
    payloadSha256: createHash("sha256").update(input.rawBody).digest("hex"),
    state: state as "firing" | "recovered",
    severity: severity as "warning" | "critical" | "recovery",
  };
}

export async function claimVerifiedWebhookClaimHealthAlert(
  db: Database,
  verification: Extract<Verification, { ok: true }>,
  source = WEBHOOK_CLAIM_ALERT_RECEIVER_SOURCE,
): Promise<
  | { outcome: "accepted"; claim: WebhookEventClaim }
  | { outcome: "replay_completed" }
  | { outcome: "in_progress" }
  | { outcome: "retry_backoff"; retryAfterSeconds: number }
  | { outcome: "payload_conflict" }
> {
  const claim = await claimWebhookEvent(db, {
    source,
    eventId: verification.deliveryId,
    payloadSha256: verification.payloadSha256,
  });
  if (claim.outcome === "acquired") return { outcome: "accepted", claim };
  if (claim.outcome === "payload_conflict") return { outcome: "payload_conflict" };
  if (claim.outcome === "duplicate") return { outcome: "replay_completed" };
  if (claim.outcome === "in_progress") return { outcome: "in_progress" };
  return { outcome: "retry_backoff", retryAfterSeconds: claim.retryAfterSeconds ?? 1 };
}
