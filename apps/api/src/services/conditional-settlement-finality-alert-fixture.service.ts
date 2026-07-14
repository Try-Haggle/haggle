import { createHash, randomUUID } from "node:crypto";
import { sql, type Database } from "@haggle/db";
import { runConditionalSettlementFinalityAlert } from "../jobs/conditional-settlement-finality-alert.js";
import { runWebhookClaimHealthAlert } from "../jobs/webhook-claim-health-alert.js";
import { signWebhookClaimAlertPayload } from "./webhook-claim-alert.service.js";
import { completeWebhookEvent, failWebhookEvent } from "./webhook-event-claim.service.js";
import {
  claimVerifiedConditionalSettlementFinalityAlert,
  getConditionalSettlementFinalityAlertReceiverHealth,
  verifyConditionalSettlementFinalityAlert,
} from "./conditional-settlement-finality-alert-verifier.service.js";
import type { ConditionalSettlementFinalityHealth } from "./conditional-settlement-finality-health.service.js";
import type { WebhookClaimAlertConfig } from "./webhook-claim-alert.service.js";
import {
  claimVerifiedWebhookClaimHealthAlert,
  verifyWebhookClaimHealthAlert,
} from "./webhook-claim-alert-verifier.service.js";

type FixtureStage = "sender_lifecycle" | "finality_receiver_resilience" | "health_alert_delivery"
  | "health_receiver_resilience" | "health_receiver_burst" | "health_receiver_partial_failure"
  | "health_receiver_terminal" | "assertions" | "cleanup";

type FixtureDiagnostics = {
  stages: Array<{ name: FixtureStage; durationMs: number }>;
  totalMs: number;
  slowestStage: FixtureStage | null;
  slowestStageMs: number;
  failureStage: FixtureStage | null;
};

export async function runConditionalSettlementFinalityAlertFixture(db: Database) {
  const source = `haggle-finality-alert-fixture-${randomUUID()}`;
  const receiverSource = `${source}-receiver`;
  const receiverHealthAlertSource = `${source}-receiver-health-alert`;
  const receiverHealthAlertReceiverSource = `${source}-receiver-health-alert-receiver`;
  const secret = "fixture-finality-alert-secret";
  const previousSecret = "fixture-previous-finality-secret";
  const delivered: Array<{ deliveryId: string; timestamp: string; signature: string; body: string }> = [];
  let receiverVerified = 0;
  let receiverReplayBlocked = 0;
  const config = { url: "http://127.0.0.1:9999/finality", secret, timeoutMs: 1000, cooldownMinutes: 15,
    allowInsecureHttp: true, allowPrivateNetwork: true };
  const receiverHealthAlertConfig: WebhookClaimAlertConfig = { url: "http://127.0.0.1:9999/webhook-claim-health",
    secret, timeoutMs: 1000, cooldownMinutes: 15, failedThreshold: 1, staleThreshold: 1,
    retryReadyThreshold: 1, allowInsecureHttp: true, allowPrivateNetwork: true };
  const receiverHealthAlertDeliveries: Array<{ deliveryId: string; timestamp: string; signature: string; body: string }> = [];
  let receiverHealthAlertVerified = 0;
  let receiverHealthAlertReplayBlocked = 0;
  const receiverHealthAlertFetch = async (_url: string | URL | Request, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string>;
    const item = { deliveryId: headers["x-haggle-alert-delivery-id"], timestamp: headers["x-haggle-alert-timestamp"],
      signature: headers["x-haggle-alert-signature"], body: String(init?.body ?? "") };
    receiverHealthAlertDeliveries.push(item);
    const verification = verifyWebhookClaimHealthAlert({ rawBody: item.body, timestamp: item.timestamp,
      deliveryId: item.deliveryId, signature: item.signature, secret, nowMs: Date.parse(item.timestamp) });
    if (!verification.ok) return new Response(JSON.stringify({ error: verification.error }), { status: 401 });
    const delivery = await claimVerifiedWebhookClaimHealthAlert(db, verification, receiverHealthAlertReceiverSource);
    if (delivery.outcome !== "accepted") return new Response(JSON.stringify({ error: delivery.outcome }), { status: 409 });
    await completeWebhookEvent(db, delivery.claim, 202);
    receiverHealthAlertVerified += 1;
    const replay = await claimVerifiedWebhookClaimHealthAlert(db, verification, receiverHealthAlertReceiverSource);
    if (replay.outcome === "replay_completed") receiverHealthAlertReplayBlocked += 1;
    return new Response(JSON.stringify({ accepted: true }), { status: 202, headers: { "content-type": "application/json" } });
  };
  const collectReceiverHealth = async () => {
    const health = await getConditionalSettlementFinalityAlertReceiverHealth(db, receiverSource);
    return { status: health.status, totals: { processing: health.processing, completed: health.completed,
      failed: health.failed, staleProcessing: health.staleProcessing, retryReady: health.retryReady },
      sources: [{ source: "conditional_settlement_finality_receiver", processing: health.processing,
        completed: health.completed, failed: health.failed, staleProcessing: health.staleProcessing,
        retryReady: health.retryReady, maxAttemptCount: health.maxAttemptCount,
        oldestUnfinishedAgeSeconds: health.oldestUnfinishedAgeSeconds }], recordedAt: health.recordedAt };
  };
  const base: ConditionalSettlementFinalityHealth = { status: "healthy", total: 0, pending: 0, unavailable: 0,
    orphanedReceipts: 0, rpcUnavailable: 0, configurationBlocked: 0, overduePending: 0,
    oldestPendingAgeSeconds: null, pendingSlaSeconds: 120, recordedAt: "2026-07-12T00:00:00.000Z" };
  const critical = { ...base, status: "critical" as const, total: 1, unavailable: 1, orphanedReceipts: 1 };
  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string>;
    const item = { deliveryId: headers["x-haggle-alert-delivery-id"], timestamp: headers["x-haggle-alert-timestamp"],
      signature: headers["x-haggle-alert-signature"], body: String(init?.body ?? "") };
    delivered.push(item);
    const verification = verifyConditionalSettlementFinalityAlert({ rawBody: item.body, timestamp: item.timestamp,
      signature: item.signature, deliveryId: item.deliveryId, secret, nowMs: Date.parse(item.timestamp) });
    if (!verification.ok) return new Response(JSON.stringify({ error: verification.error }), { status: 401 });
    const receiverClaim = await claimVerifiedConditionalSettlementFinalityAlert(db, verification, receiverSource);
    if (receiverClaim.outcome !== "accepted") return new Response(JSON.stringify({ error: receiverClaim.outcome }), { status: 409 });
    if (!await completeWebhookEvent(db, receiverClaim.claim, 202)) return new Response(null, { status: 503 });
    receiverVerified += 1;
    const replay = await claimVerifiedConditionalSettlementFinalityAlert(db, verification, receiverSource);
    if (replay.outcome === "replay_completed") receiverReplayBlocked += 1;
    return new Response(JSON.stringify({ accepted: true }), { status: 202, headers: { "content-type": "application/json" } });
  };
  let result: Record<string, unknown> | null = null;
  let cleanup = { deleted: 0, remaining: -1 };
  const fixtureStartedAt = Date.now();
  const diagnostics: FixtureDiagnostics = { stages: [], totalMs: 0, slowestStage: null,
    slowestStageMs: 0, failureStage: null };
  let activeStage: FixtureStage = "sender_lifecycle";
  let activeStageStartedAt = Date.now();
  let activeStageFinished = false;
  let fixtureFailure: unknown = null;
  const startStage = (stage: FixtureStage) => {
    diagnostics.stages.push({ name: activeStage, durationMs: Math.max(0, Date.now() - activeStageStartedAt) });
    activeStage = stage;
    activeStageStartedAt = Date.now();
    activeStageFinished = false;
  };
  const finishActiveStage = () => {
    if (activeStageFinished) return;
    diagnostics.stages.push({ name: activeStage, durationMs: Math.max(0, Date.now() - activeStageStartedAt) });
    activeStageFinished = true;
  };
  try {
    const common = { config, claimSource: source, fetchImpl: fetchImpl as typeof fetch, now: new Date("2026-07-12T00:05:00.000Z") };
    const firing = await runConditionalSettlementFinalityAlert(db, { ...common, collectHealth: async () => critical });
    const duplicateFiring = await runConditionalSettlementFinalityAlert(db, { ...common, collectHealth: async () => critical });
    const recovery = await runConditionalSettlementFinalityAlert(db, { ...common, now: new Date("2026-07-12T00:06:00.000Z"), collectHealth: async () => base });
    const duplicateRecovery = await runConditionalSettlementFinalityAlert(db, { ...common, now: new Date("2026-07-12T00:06:00.000Z"), collectHealth: async () => base });
    const signaturesValid = delivered.every((item) => item.signature === signWebhookClaimAlertPayload(secret, item.timestamp, item.body));
    const conflictItem = delivered[0];
    let payloadConflict = false;
    let rotationOverlapAccepted = false;
    let retiredSecretRejected = false;
    if (conflictItem) {
      const previousSignature = signWebhookClaimAlertPayload(previousSecret, conflictItem.timestamp, conflictItem.body);
      rotationOverlapAccepted = verifyConditionalSettlementFinalityAlert({ rawBody: conflictItem.body,
        timestamp: conflictItem.timestamp, deliveryId: conflictItem.deliveryId, signature: previousSignature,
        secret: [secret, previousSecret], nowMs: Date.parse(conflictItem.timestamp) }).ok;
      retiredSecretRejected = !verifyConditionalSettlementFinalityAlert({ rawBody: conflictItem.body,
        timestamp: conflictItem.timestamp, deliveryId: conflictItem.deliveryId, signature: previousSignature,
        secret, nowMs: Date.parse(conflictItem.timestamp) }).ok;
      const changed = JSON.parse(conflictItem.body) as Record<string, unknown>;
      changed.health = { ...(changed.health as Record<string, unknown>), recordedAt: "2026-07-12T00:00:01.000Z" };
      const conflictBody = JSON.stringify(changed);
      const conflictVerification = verifyConditionalSettlementFinalityAlert({ rawBody: conflictBody,
        timestamp: conflictItem.timestamp, deliveryId: conflictItem.deliveryId,
        signature: signWebhookClaimAlertPayload(secret, conflictItem.timestamp, conflictBody), secret,
        nowMs: Date.parse(conflictItem.timestamp) });
      if (conflictVerification.ok) {
        payloadConflict = (await claimVerifiedConditionalSettlementFinalityAlert(db, conflictVerification, receiverSource)).outcome === "payload_conflict";
      }
    }
    startStage("finality_receiver_resilience");
    const concurrencyTimestamp = "2026-07-12T00:07:00.000Z";
    const concurrencyDeliveryId = `health_${createHash("sha256").update(randomUUID()).digest("hex")}`;
    const concurrencyBody = JSON.stringify({ type: "conditional_settlement_finality.health",
      delivery_id: concurrencyDeliveryId, state: "firing", created_at: concurrencyTimestamp, severity: "warning",
      reasons: ["rpc_unavailable"], health: { ...base, status: "attention", total: 1, unavailable: 1,
        rpcUnavailable: 1, recordedAt: concurrencyTimestamp } });
    const concurrencyVerification = verifyConditionalSettlementFinalityAlert({ rawBody: concurrencyBody,
      timestamp: concurrencyTimestamp, deliveryId: concurrencyDeliveryId,
      signature: signWebhookClaimAlertPayload(secret, concurrencyTimestamp, concurrencyBody), secret,
      nowMs: Date.parse(concurrencyTimestamp) });
    const concurrentClaims = concurrencyVerification.ok
      ? await Promise.all(Array.from({ length: 20 }, () => claimVerifiedConditionalSettlementFinalityAlert(db, concurrencyVerification, receiverSource)))
      : [];
    const concurrentWinners = concurrentClaims.filter((claim) => claim.outcome === "accepted");
    const concurrentBlocked = concurrentClaims.filter((claim) => claim.outcome === "in_progress").length;
    const concurrentCompleted = concurrentWinners.length === 1
      ? await completeWebhookEvent(db, concurrentWinners[0]!.claim, 202) : false;
    const takeoverDeliveryId = `health_${createHash("sha256").update(randomUUID()).digest("hex")}`;
    const takeoverBody = JSON.stringify({ type: "conditional_settlement_finality.health",
      delivery_id: takeoverDeliveryId, state: "firing", created_at: concurrencyTimestamp, severity: "warning",
      reasons: ["configuration_blocked"], health: { ...base, status: "attention", total: 1, unavailable: 1,
        configurationBlocked: 1, recordedAt: concurrencyTimestamp } });
    const takeoverVerification = verifyConditionalSettlementFinalityAlert({ rawBody: takeoverBody,
      timestamp: concurrencyTimestamp, deliveryId: takeoverDeliveryId,
      signature: signWebhookClaimAlertPayload(secret, concurrencyTimestamp, takeoverBody), secret,
      nowMs: Date.parse(concurrencyTimestamp) });
    let staleOwnerFenced = false;
    let takeoverCompleted = false;
    let takeoverAttemptCount = 0;
    if (takeoverVerification.ok) {
      const staleOwner = await claimVerifiedConditionalSettlementFinalityAlert(db, takeoverVerification, receiverSource);
      if (staleOwner.outcome === "accepted") {
        const expired = await db.execute(sql`UPDATE webhook_idempotency SET lease_expires_at = now() - interval '1 second'
          WHERE source = ${receiverSource} AND idempotency_key = ${takeoverDeliveryId}
            AND status = 'PROCESSING' AND claim_id = ${staleOwner.claim.claimId} RETURNING id`) as unknown as Array<{ id: string }>;
        const takeover = expired.length === 1
          ? await claimVerifiedConditionalSettlementFinalityAlert(db, takeoverVerification, receiverSource) : null;
        if (takeover?.outcome === "accepted") {
          takeoverAttemptCount = takeover.claim.attemptCount ?? 0;
          try { await completeWebhookEvent(db, staleOwner.claim, 202); }
          catch (error) { staleOwnerFenced = error instanceof Error && error.message === "WEBHOOK_CLAIM_LOST"; }
          takeoverCompleted = await completeWebhookEvent(db, takeover.claim, 202);
        }
      }
    }
    startStage("health_alert_delivery");
    const retryDeliveryId = `health_${createHash("sha256").update(randomUUID()).digest("hex")}`;
    const retryBody = JSON.stringify({ type: "conditional_settlement_finality.health",
      delivery_id: retryDeliveryId, state: "firing", created_at: concurrencyTimestamp, severity: "warning",
      reasons: ["confirmation_sla_overdue"], health: { ...base, status: "attention", total: 1, pending: 1,
        overduePending: 1, oldestPendingAgeSeconds: 180, recordedAt: concurrencyTimestamp } });
    const retryVerification = verifyConditionalSettlementFinalityAlert({ rawBody: retryBody,
      timestamp: concurrencyTimestamp, deliveryId: retryDeliveryId,
      signature: signWebhookClaimAlertPayload(secret, concurrencyTimestamp, retryBody), secret,
      nowMs: Date.parse(concurrencyTimestamp) });
    let retryBackoffBlocked = false;
    let retryReleased = 0;
    let retryCompleted = false;
    let retryAttemptCount = 0;
    let receiverHealthFiring = "not_run";
    let receiverHealthRecovery = "not_run";
    let receiverHealthDuplicateRecovery = "not_run";
    if (retryVerification.ok) {
      const failedDelivery = await claimVerifiedConditionalSettlementFinalityAlert(db, retryVerification, receiverSource);
      if (failedDelivery.outcome === "accepted") {
        await failWebhookEvent(db, failedDelivery.claim);
        receiverHealthFiring = (await runWebhookClaimHealthAlert(db, { config: receiverHealthAlertConfig,
          claimSource: receiverHealthAlertSource, collectHealth: collectReceiverHealth,
          fetchImpl: receiverHealthAlertFetch as typeof fetch, now: new Date("2026-07-12T00:08:00.000Z") })).status;
        const earlyRetry = await claimVerifiedConditionalSettlementFinalityAlert(db, retryVerification, receiverSource);
        retryBackoffBlocked = earlyRetry.outcome === "retry_backoff" && earlyRetry.retryAfterSeconds >= 1;
        const released = await db.execute(sql`UPDATE webhook_idempotency SET next_attempt_at = now() - interval '1 second'
          WHERE source = ${receiverSource} AND idempotency_key = ${retryDeliveryId}
            AND status = 'FAILED' AND claim_id IS NULL RETURNING id`) as unknown as Array<{ id: string }>;
        retryReleased = released.length;
        const retried = released.length === 1
          ? await claimVerifiedConditionalSettlementFinalityAlert(db, retryVerification, receiverSource) : null;
        if (retried?.outcome === "accepted") {
          retryAttemptCount = retried.claim.attemptCount ?? 0;
          retryCompleted = await completeWebhookEvent(db, retried.claim, 202);
          receiverHealthRecovery = (await runWebhookClaimHealthAlert(db, { config: receiverHealthAlertConfig,
            claimSource: receiverHealthAlertSource, collectHealth: collectReceiverHealth,
            fetchImpl: receiverHealthAlertFetch as typeof fetch, now: new Date("2026-07-12T00:09:00.000Z") })).status;
          const duplicateRecovery = await runWebhookClaimHealthAlert(db, { config: receiverHealthAlertConfig,
            claimSource: receiverHealthAlertSource, collectHealth: collectReceiverHealth,
            fetchImpl: receiverHealthAlertFetch as typeof fetch, now: new Date("2026-07-12T00:09:00.000Z") });
          receiverHealthDuplicateRecovery = duplicateRecovery.status === "skipped" ? duplicateRecovery.reason : duplicateRecovery.status;
        }
      }
    }
    startStage("health_receiver_resilience");
    let receiverHealthAlertConflict = false;
    const receiverHealthAlertConflictItem = receiverHealthAlertDeliveries[0];
    if (receiverHealthAlertConflictItem) {
      const changed = JSON.parse(receiverHealthAlertConflictItem.body) as Record<string, unknown>;
      const sources = changed.sources as Array<Record<string, unknown>>;
      changed.sources = sources.map((entry, index) => index === 0
        ? { ...entry, max_attempt_count: Number(entry.max_attempt_count ?? 0) + 1 } : entry);
      const body = JSON.stringify(changed);
      const verification = verifyWebhookClaimHealthAlert({ rawBody: body,
        timestamp: receiverHealthAlertConflictItem.timestamp, deliveryId: receiverHealthAlertConflictItem.deliveryId,
        signature: signWebhookClaimAlertPayload(secret, receiverHealthAlertConflictItem.timestamp, body), secret,
        nowMs: Date.parse(receiverHealthAlertConflictItem.timestamp) });
      if (verification.ok) {
        receiverHealthAlertConflict = (await claimVerifiedWebhookClaimHealthAlert(db, verification,
          receiverHealthAlertReceiverSource)).outcome === "payload_conflict";
      }
    }
    let receiverHealthConcurrentWinners = 0;
    let receiverHealthConcurrentBlocked = 0;
    let receiverHealthConcurrentCompleted = false;
    let receiverHealthStaleOwnerFenced = false;
    let receiverHealthTakeoverCompleted = false;
    let receiverHealthTakeoverAttemptCount = 0;
    let receiverHealthRetryBackoffBlocked = false;
    let receiverHealthRetryReleased = 0;
    let receiverHealthRetryCompleted = false;
    let receiverHealthRetryAttemptCount = 0;
    const receiverHealthBurstRequests = 1000;
    let receiverHealthBurstAccepted = 0;
    let receiverHealthBurstCompleted = 0;
    let receiverHealthPartialCompleted = 0;
    let receiverHealthPartialFailed = 0;
    let receiverHealthPartialSuccessReplays = 0;
    let receiverHealthPartialBackoffs = 0;
    let receiverHealthPartialReleased = 0;
    let receiverHealthPartialRecovered = 0;
    let receiverHealthPartialAttemptTwo = 0;
    let receiverHealthPartialRecoveryRequests = 0;
    let receiverHealthPartialRecoveryWinners = 0;
    let receiverHealthPartialRecoveryBlocked = 0;
    let receiverHealthInterruptedAttemptTwo = 0;
    let receiverHealthInterruptedAttemptThree = 0;
    let receiverHealthInterruptedOldOwnerFenced = false;
    let receiverHealthInterruptedCompleted = false;
    let receiverHealthTerminalReplays = 0;
    let receiverHealthTerminalAttemptCount = 0;
    let receiverHealthTerminalStatus = "";
    if (receiverHealthAlertConflictItem) {
      const concurrencyDeliveryId = `health_${createHash("sha256").update(randomUUID()).digest("hex")}`;
      const concurrencyPayload = JSON.parse(receiverHealthAlertConflictItem.body) as Record<string, unknown>;
      concurrencyPayload.delivery_id = concurrencyDeliveryId;
      const concurrencyBody = JSON.stringify(concurrencyPayload);
      const concurrencyVerification = verifyWebhookClaimHealthAlert({ rawBody: concurrencyBody,
        timestamp: receiverHealthAlertConflictItem.timestamp, deliveryId: concurrencyDeliveryId,
        signature: signWebhookClaimAlertPayload(secret, receiverHealthAlertConflictItem.timestamp, concurrencyBody), secret,
        nowMs: Date.parse(receiverHealthAlertConflictItem.timestamp) });
      if (concurrencyVerification.ok) {
        const claims = await Promise.all(Array.from({ length: 20 }, () =>
          claimVerifiedWebhookClaimHealthAlert(db, concurrencyVerification, receiverHealthAlertReceiverSource)));
        const winners = claims.filter((claim) => claim.outcome === "accepted");
        receiverHealthConcurrentWinners = winners.length;
        receiverHealthConcurrentBlocked = claims.filter((claim) => claim.outcome === "in_progress").length;
        receiverHealthConcurrentCompleted = winners.length === 1
          ? await completeWebhookEvent(db, winners[0]!.claim, 202) : false;
      }

      const takeoverDeliveryId = `health_${createHash("sha256").update(randomUUID()).digest("hex")}`;
      const takeoverPayload = JSON.parse(receiverHealthAlertConflictItem.body) as Record<string, unknown>;
      takeoverPayload.delivery_id = takeoverDeliveryId;
      const takeoverBody = JSON.stringify(takeoverPayload);
      const takeoverVerification = verifyWebhookClaimHealthAlert({ rawBody: takeoverBody,
        timestamp: receiverHealthAlertConflictItem.timestamp, deliveryId: takeoverDeliveryId,
        signature: signWebhookClaimAlertPayload(secret, receiverHealthAlertConflictItem.timestamp, takeoverBody), secret,
        nowMs: Date.parse(receiverHealthAlertConflictItem.timestamp) });
      if (takeoverVerification.ok) {
        const staleOwner = await claimVerifiedWebhookClaimHealthAlert(db, takeoverVerification, receiverHealthAlertReceiverSource);
        if (staleOwner.outcome === "accepted") {
          const expired = await db.execute(sql`UPDATE webhook_idempotency SET lease_expires_at = now() - interval '1 second'
            WHERE source = ${receiverHealthAlertReceiverSource} AND idempotency_key = ${takeoverDeliveryId}
              AND status = 'PROCESSING' AND claim_id = ${staleOwner.claim.claimId} RETURNING id`) as unknown as Array<{ id: string }>;
          const takeover = expired.length === 1
            ? await claimVerifiedWebhookClaimHealthAlert(db, takeoverVerification, receiverHealthAlertReceiverSource) : null;
          if (takeover?.outcome === "accepted") {
            receiverHealthTakeoverAttemptCount = takeover.claim.attemptCount ?? 0;
            try { await completeWebhookEvent(db, staleOwner.claim, 202); }
            catch (error) { receiverHealthStaleOwnerFenced = error instanceof Error && error.message === "WEBHOOK_CLAIM_LOST"; }
            receiverHealthTakeoverCompleted = await completeWebhookEvent(db, takeover.claim, 202);
          }
        }
      }

      const retryDeliveryId = `health_${createHash("sha256").update(randomUUID()).digest("hex")}`;
      const retryPayload = JSON.parse(receiverHealthAlertConflictItem.body) as Record<string, unknown>;
      retryPayload.delivery_id = retryDeliveryId;
      const retryBody = JSON.stringify(retryPayload);
      const retryVerification = verifyWebhookClaimHealthAlert({ rawBody: retryBody,
        timestamp: receiverHealthAlertConflictItem.timestamp, deliveryId: retryDeliveryId,
        signature: signWebhookClaimAlertPayload(secret, receiverHealthAlertConflictItem.timestamp, retryBody), secret,
        nowMs: Date.parse(receiverHealthAlertConflictItem.timestamp) });
      if (retryVerification.ok) {
        const failedDelivery = await claimVerifiedWebhookClaimHealthAlert(db, retryVerification,
          receiverHealthAlertReceiverSource);
        if (failedDelivery.outcome === "accepted") {
          await failWebhookEvent(db, failedDelivery.claim);
          const earlyRetry = await claimVerifiedWebhookClaimHealthAlert(db, retryVerification,
            receiverHealthAlertReceiverSource);
          receiverHealthRetryBackoffBlocked = earlyRetry.outcome === "retry_backoff"
            && earlyRetry.retryAfterSeconds >= 1;
          const released = await db.execute(sql`UPDATE webhook_idempotency
            SET next_attempt_at = now() - interval '1 second'
            WHERE source = ${receiverHealthAlertReceiverSource} AND idempotency_key = ${retryDeliveryId}
              AND status = 'FAILED' AND claim_id IS NULL RETURNING id`) as unknown as Array<{ id: string }>;
          receiverHealthRetryReleased = released.length;
          const retried = released.length === 1
            ? await claimVerifiedWebhookClaimHealthAlert(db, retryVerification,
                receiverHealthAlertReceiverSource)
            : null;
          if (retried?.outcome === "accepted") {
            receiverHealthRetryAttemptCount = retried.claim.attemptCount ?? 0;
            receiverHealthRetryCompleted = await completeWebhookEvent(db, retried.claim, 202);
          }
        }
      }

      startStage("health_receiver_burst");
      const burstClaims = await Promise.all(Array.from({ length: receiverHealthBurstRequests }, async () => {
        const burstDeliveryId = `health_${createHash("sha256").update(randomUUID()).digest("hex")}`;
        const burstPayload = JSON.parse(receiverHealthAlertConflictItem.body) as Record<string, unknown>;
        burstPayload.delivery_id = burstDeliveryId;
        const burstBody = JSON.stringify(burstPayload);
        const burstVerification = verifyWebhookClaimHealthAlert({ rawBody: burstBody,
          timestamp: receiverHealthAlertConflictItem.timestamp, deliveryId: burstDeliveryId,
          signature: signWebhookClaimAlertPayload(secret, receiverHealthAlertConflictItem.timestamp, burstBody), secret,
          nowMs: Date.parse(receiverHealthAlertConflictItem.timestamp) });
        return burstVerification.ok
          ? claimVerifiedWebhookClaimHealthAlert(db, burstVerification, receiverHealthAlertReceiverSource)
          : null;
      }));
      const acceptedBurstClaims = burstClaims.filter((claim) => claim?.outcome === "accepted");
      receiverHealthBurstAccepted = acceptedBurstClaims.length;
      const burstCompletions = await Promise.all(acceptedBurstClaims.map((claim) =>
        completeWebhookEvent(db, claim.claim, 202)));
      receiverHealthBurstCompleted = burstCompletions.filter(Boolean).length;

      startStage("health_receiver_partial_failure");
      const partialDeliveries = await Promise.all(Array.from({ length: 20 }, async (_, index) => {
        const deliveryId = `health_${createHash("sha256").update(randomUUID()).digest("hex")}`;
        const payload = JSON.parse(receiverHealthAlertConflictItem.body) as Record<string, unknown>;
        payload.delivery_id = deliveryId;
        const body = JSON.stringify(payload);
        const verification = verifyWebhookClaimHealthAlert({ rawBody: body,
          timestamp: receiverHealthAlertConflictItem.timestamp, deliveryId,
          signature: signWebhookClaimAlertPayload(secret, receiverHealthAlertConflictItem.timestamp, body), secret,
          nowMs: Date.parse(receiverHealthAlertConflictItem.timestamp) });
        const claim = verification.ok
          ? await claimVerifiedWebhookClaimHealthAlert(db, verification, receiverHealthAlertReceiverSource)
          : null;
        return { index, deliveryId, verification, claim };
      }));
      const acceptedPartialDeliveries = partialDeliveries.flatMap((item) => item.verification.ok
        && item.claim?.outcome === "accepted"
        ? [{ index: item.index, deliveryId: item.deliveryId, verification: item.verification,
            claim: item.claim.claim }]
        : []);
      await Promise.all(acceptedPartialDeliveries.map(async (item) => {
        if (item.index % 5 === 0) {
          await failWebhookEvent(db, item.claim);
          receiverHealthPartialFailed += 1;
        } else if (await completeWebhookEvent(db, item.claim, 202)) {
          receiverHealthPartialCompleted += 1;
        }
      }));
      const partialReplays = await Promise.all(acceptedPartialDeliveries.map((item) =>
        item.verification.ok
          ? claimVerifiedWebhookClaimHealthAlert(db, item.verification, receiverHealthAlertReceiverSource)
          : null));
      receiverHealthPartialSuccessReplays = partialReplays.filter((claim) => claim?.outcome === "replay_completed").length;
      receiverHealthPartialBackoffs = partialReplays.filter((claim) =>
        claim?.outcome === "retry_backoff" && claim.retryAfterSeconds >= 1).length;
      const failedPartialDeliveries = acceptedPartialDeliveries.filter((item) => item.index % 5 === 0);
      const releasedPartialRows = await Promise.all(failedPartialDeliveries.map((item) => db.execute(sql`
        UPDATE webhook_idempotency SET next_attempt_at = now() - interval '1 second'
        WHERE source = ${receiverHealthAlertReceiverSource} AND idempotency_key = ${item.deliveryId}
          AND status = 'FAILED' AND claim_id IS NULL RETURNING id`) as unknown as Promise<Array<{ id: string }>>));
      receiverHealthPartialReleased = releasedPartialRows.reduce((total, rows) => total + rows.length, 0);
      const recoveredPartialClaimGroups = await Promise.all(failedPartialDeliveries.map(async (item) =>
        item.verification.ok
          ? Promise.all(Array.from({ length: 10 }, () =>
              claimVerifiedWebhookClaimHealthAlert(db, item.verification, receiverHealthAlertReceiverSource)))
          : []));
      const recoveredPartialClaims = recoveredPartialClaimGroups.flat();
      receiverHealthPartialRecoveryRequests = recoveredPartialClaims.length;
      const recoveredPartialWinners = recoveredPartialClaims.filter((claim) => claim.outcome === "accepted");
      receiverHealthPartialRecoveryWinners = recoveredPartialWinners.length;
      receiverHealthPartialRecoveryBlocked = recoveredPartialClaims.filter((claim) => claim.outcome === "in_progress").length;
      receiverHealthPartialAttemptTwo = recoveredPartialWinners.filter((claim) =>
        claim?.outcome === "accepted" && claim.claim.attemptCount === 2).length;
      const recoveredPartialCompletions = await Promise.all(recoveredPartialWinners.map((claim) =>
        completeWebhookEvent(db, claim.claim, 202)));
      receiverHealthPartialRecovered = recoveredPartialCompletions.filter(Boolean).length;

      startStage("health_receiver_terminal");
      const interruptedDeliveryId = `health_${createHash("sha256").update(randomUUID()).digest("hex")}`;
      const interruptedPayload = JSON.parse(receiverHealthAlertConflictItem.body) as Record<string, unknown>;
      interruptedPayload.delivery_id = interruptedDeliveryId;
      const interruptedBody = JSON.stringify(interruptedPayload);
      const interruptedVerification = verifyWebhookClaimHealthAlert({ rawBody: interruptedBody,
        timestamp: receiverHealthAlertConflictItem.timestamp, deliveryId: interruptedDeliveryId,
        signature: signWebhookClaimAlertPayload(secret, receiverHealthAlertConflictItem.timestamp, interruptedBody), secret,
        nowMs: Date.parse(receiverHealthAlertConflictItem.timestamp) });
      if (interruptedVerification.ok) {
        const firstAttempt = await claimVerifiedWebhookClaimHealthAlert(db, interruptedVerification,
          receiverHealthAlertReceiverSource);
        if (firstAttempt.outcome === "accepted") {
          await failWebhookEvent(db, firstAttempt.claim);
          const released = await db.execute(sql`UPDATE webhook_idempotency
            SET next_attempt_at = now() - interval '1 second'
            WHERE source = ${receiverHealthAlertReceiverSource} AND idempotency_key = ${interruptedDeliveryId}
              AND status = 'FAILED' AND claim_id IS NULL RETURNING id`) as unknown as Array<{ id: string }>;
          const secondAttempt = released.length === 1
            ? await claimVerifiedWebhookClaimHealthAlert(db, interruptedVerification,
                receiverHealthAlertReceiverSource)
            : null;
          if (secondAttempt?.outcome === "accepted") {
            receiverHealthInterruptedAttemptTwo = secondAttempt.claim.attemptCount ?? 0;
            const expired = await db.execute(sql`UPDATE webhook_idempotency
              SET lease_expires_at = now() - interval '1 second'
              WHERE source = ${receiverHealthAlertReceiverSource} AND idempotency_key = ${interruptedDeliveryId}
                AND status = 'PROCESSING' AND claim_id = ${secondAttempt.claim.claimId} RETURNING id`) as unknown as Array<{ id: string }>;
            const thirdAttempt = expired.length === 1
              ? await claimVerifiedWebhookClaimHealthAlert(db, interruptedVerification,
                  receiverHealthAlertReceiverSource)
              : null;
            if (thirdAttempt?.outcome === "accepted") {
              receiverHealthInterruptedAttemptThree = thirdAttempt.claim.attemptCount ?? 0;
              try { await completeWebhookEvent(db, secondAttempt.claim, 202); }
              catch (error) {
                receiverHealthInterruptedOldOwnerFenced = error instanceof Error
                  && error.message === "WEBHOOK_CLAIM_LOST";
              }
              receiverHealthInterruptedCompleted = await completeWebhookEvent(db, thirdAttempt.claim, 202);
              if (receiverHealthInterruptedCompleted) {
                const terminalReplays = await Promise.all(Array.from({ length: 20 }, () =>
                  claimVerifiedWebhookClaimHealthAlert(db, interruptedVerification,
                    receiverHealthAlertReceiverSource)));
                receiverHealthTerminalReplays = terminalReplays.filter((claim) =>
                  claim.outcome === "replay_completed").length;
                const terminalRows = await db.execute(sql`SELECT status, attempt_count AS "attemptCount"
                  FROM webhook_idempotency
                  WHERE source = ${receiverHealthAlertReceiverSource}
                    AND idempotency_key = ${interruptedDeliveryId}`) as unknown as Array<{
                      status: string; attemptCount: string | number;
                    }>;
                receiverHealthTerminalStatus = terminalRows[0]?.status ?? "";
                receiverHealthTerminalAttemptCount = Number(terminalRows[0]?.attemptCount ?? 0);
              }
            }
          }
        }
      }
    }
    startStage("assertions");
    const checks: Record<string, boolean> = {
      receiver_health_alert_receiver_verified: receiverHealthAlertVerified === 2,
      receiver_health_alert_receiver_replay_blocked: receiverHealthAlertReplayBlocked === 2,
      receiver_health_alert_receiver_conflict_isolated: receiverHealthAlertConflict,
      receiver_health_alert_receiver_concurrency_single_winner: receiverHealthConcurrentWinners === 1
        && receiverHealthConcurrentBlocked === 19 && receiverHealthConcurrentCompleted,
      receiver_health_alert_receiver_stale_owner_fenced: receiverHealthStaleOwnerFenced
        && receiverHealthTakeoverCompleted && receiverHealthTakeoverAttemptCount === 2,
      receiver_health_alert_receiver_failure_backoff_recovered: receiverHealthRetryBackoffBlocked
        && receiverHealthRetryReleased === 1 && receiverHealthRetryCompleted
        && receiverHealthRetryAttemptCount === 2,
      receiver_health_alert_receiver_unique_burst_completed:
        receiverHealthBurstAccepted === receiverHealthBurstRequests
        && receiverHealthBurstCompleted === receiverHealthBurstRequests,
      receiver_health_alert_receiver_partial_failure_isolated: receiverHealthPartialCompleted === 16
        && receiverHealthPartialFailed === 4 && receiverHealthPartialSuccessReplays === 16
        && receiverHealthPartialBackoffs === 4 && receiverHealthPartialReleased === 4
        && receiverHealthPartialAttemptTwo === 4 && receiverHealthPartialRecovered === 4,
      receiver_health_alert_receiver_partial_recovery_single_winner:
        receiverHealthPartialRecoveryRequests === 40 && receiverHealthPartialRecoveryWinners === 4
        && receiverHealthPartialRecoveryBlocked === 36,
      receiver_health_alert_receiver_interrupted_retry_fenced:
        receiverHealthInterruptedAttemptTwo === 2 && receiverHealthInterruptedAttemptThree === 3
        && receiverHealthInterruptedOldOwnerFenced && receiverHealthInterruptedCompleted,
      receiver_health_alert_receiver_terminal_replay_converged: receiverHealthTerminalReplays === 20
        && receiverHealthTerminalStatus === "COMPLETED" && receiverHealthTerminalAttemptCount === 3,
      critical_firing_delivered: firing.status === "delivered",
      duplicate_firing_blocked: duplicateFiring.status === "skipped",
      recovery_delivered: recovery.status === "recovered",
      duplicate_recovery_blocked: duplicateRecovery.status === "skipped",
      signatures_valid: signaturesValid && delivered.length === 2,
      aggregate_only: delivered.every((item) => !/payment_id|order_id|tx_hash|block_hash/i.test(item.body)),
      receiver_verified: receiverVerified === 2,
      receiver_replay_blocked: receiverReplayBlocked === 2,
      payload_conflict_isolated: payloadConflict,
      receiver_concurrency_single_winner: concurrentWinners.length === 1 && concurrentBlocked === 19 && concurrentCompleted,
      stale_owner_fenced_and_recovered: staleOwnerFenced && takeoverCompleted && takeoverAttemptCount === 2,
      receiver_failure_backoff_recovered: retryBackoffBlocked && retryReleased === 1 && retryCompleted && retryAttemptCount === 2,
      rotation_overlap_and_retirement: rotationOverlapAccepted && retiredSecretRejected,
      receiver_health_alert_firing_recovery: receiverHealthFiring === "delivered" && receiverHealthRecovery === "recovered",
      receiver_health_recovery_duplicate_blocked: receiverHealthDuplicateRecovery === "recovery_already_sent_or_in_progress",
      receiver_health_alert_signatures_valid: receiverHealthAlertDeliveries.length === 2
        && receiverHealthAlertDeliveries.every((item) => item.signature === signWebhookClaimAlertPayload(secret, item.timestamp, item.body)),
    };
    finishActiveStage();
    checks.fixture_diagnostics_complete = diagnostics.stages.length === 8
      && diagnostics.stages.every((stage) => stage.durationMs >= 0);
    result = { pass: Object.values(checks).every(Boolean), checks, deliveries: delivered.length,
      receiver: { verified: receiverVerified, replayBlocked: receiverReplayBlocked, payloadConflict },
      concurrency: { requests: 20, winners: concurrentWinners.length, blocked: concurrentBlocked, completed: concurrentCompleted },
      takeover: { staleOwnerFenced, completed: takeoverCompleted, attemptCount: takeoverAttemptCount },
      retry: { backoffBlocked: retryBackoffBlocked, released: retryReleased, completed: retryCompleted, attemptCount: retryAttemptCount },
      rotation: { overlapAccepted: rotationOverlapAccepted, retiredSecretRejected, overlapSecretCount: 2, retiredSecretCount: 1 },
      receiverHealthAlert: { firing: receiverHealthFiring, recovery: receiverHealthRecovery,
        duplicateRecovery: receiverHealthDuplicateRecovery, deliveries: receiverHealthAlertDeliveries.length,
        receiverVerified: receiverHealthAlertVerified, receiverReplayBlocked: receiverHealthAlertReplayBlocked,
        receiverConflict: receiverHealthAlertConflict,
        concurrency: { requests: 20, winners: receiverHealthConcurrentWinners,
          blocked: receiverHealthConcurrentBlocked, completed: receiverHealthConcurrentCompleted },
        takeover: { staleOwnerFenced: receiverHealthStaleOwnerFenced,
          completed: receiverHealthTakeoverCompleted, attemptCount: receiverHealthTakeoverAttemptCount },
        retry: { backoffBlocked: receiverHealthRetryBackoffBlocked, released: receiverHealthRetryReleased,
          completed: receiverHealthRetryCompleted, attemptCount: receiverHealthRetryAttemptCount },
        burst: { requests: receiverHealthBurstRequests, accepted: receiverHealthBurstAccepted,
          completed: receiverHealthBurstCompleted },
        partialBurst: { requests: 20, initiallyCompleted: receiverHealthPartialCompleted,
          initiallyFailed: receiverHealthPartialFailed, successfulReplays: receiverHealthPartialSuccessReplays,
          backoffs: receiverHealthPartialBackoffs, released: receiverHealthPartialReleased,
          attemptTwo: receiverHealthPartialAttemptTwo, recovered: receiverHealthPartialRecovered,
          recoveryRace: { requests: receiverHealthPartialRecoveryRequests,
            winners: receiverHealthPartialRecoveryWinners, blocked: receiverHealthPartialRecoveryBlocked } },
        interruptedRetry: { attemptTwo: receiverHealthInterruptedAttemptTwo,
          attemptThree: receiverHealthInterruptedAttemptThree,
          oldOwnerFenced: receiverHealthInterruptedOldOwnerFenced,
          completed: receiverHealthInterruptedCompleted,
          terminal: { requests: 20, replays: receiverHealthTerminalReplays,
            status: receiverHealthTerminalStatus, attemptCount: receiverHealthTerminalAttemptCount } } },
      firing: firing.status, duplicateFiring: duplicateFiring.status, recovery: recovery.status,
      duplicateRecovery: duplicateRecovery.status, diagnostics };
  } catch (error) {
    diagnostics.failureStage = activeStage;
    fixtureFailure = error;
  } finally {
    finishActiveStage();
    activeStage = "cleanup";
    activeStageStartedAt = Date.now();
    activeStageFinished = false;
    try {
      const rows = await db.execute(sql`DELETE FROM webhook_idempotency WHERE source = ${source} OR source = ${receiverSource}
        OR source = ${receiverHealthAlertSource} OR source = ${receiverHealthAlertReceiverSource} RETURNING id`) as unknown as Array<{ id: string }>;
      const remaining = await db.execute(sql`SELECT count(*) AS count FROM webhook_idempotency WHERE source = ${source}
        OR source = ${receiverSource} OR source = ${receiverHealthAlertSource}
        OR source = ${receiverHealthAlertReceiverSource}`) as unknown as Array<{ count: string | number }>;
      cleanup = { deleted: rows.length, remaining: Number(remaining[0]?.count ?? -1) };
    } catch (error) {
      diagnostics.failureStage = "cleanup";
      fixtureFailure ??= error;
    }
    finishActiveStage();
    diagnostics.totalMs = Math.max(0, Date.now() - fixtureStartedAt);
    const slowest = diagnostics.stages.reduce<{ name: FixtureStage; durationMs: number } | null>((current, stage) =>
      !current || stage.durationMs > current.durationMs ? stage : current, null);
    diagnostics.slowestStage = slowest?.name ?? null;
    diagnostics.slowestStageMs = slowest?.durationMs ?? 0;
  }
  if (fixtureFailure) throw Object.assign(new Error("FINALITY_ALERT_FIXTURE_FAILED"), {
    code: "FINALITY_ALERT_FIXTURE_FAILED", stage: diagnostics.failureStage, diagnostics,
  });
  if (!result) throw new Error("FINALITY_ALERT_FIXTURE_DID_NOT_RUN");
  return { ...result, cleanup, pass: result.pass === true && cleanup.remaining === 0 };
}
