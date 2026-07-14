import { generateKeyPairSync, randomUUID } from "node:crypto";
import { sql, type Database } from "@haggle/db";
import { appendDisputeAiAssessmentEvent, disputeAiAuditAdvisoryLockKey } from "./dispute-ai-assessment-event.service.js";
import { verifySignedDisputeAiAuditExport } from "./dispute-ai-audit-export.service.js";
import { runDisputeAiAuditArchiveAlert } from "../jobs/dispute-ai-audit-archive-alert.js";
import { evaluateDisputeAiAuditArchiveAlert } from "./dispute-ai-audit-archive-alert.service.js";
import { claimVerifiedDisputeAiArchiveAlert, verifyDisputeAiAuditArchiveAlert } from "./dispute-ai-audit-archive-alert-verifier.service.js";
import { completeWebhookEvent } from "./webhook-event-claim.service.js";
import {
  normalizeDisputeAuditPublicKeyRecord, verifyTrustedSignedDisputeAiAuditExport,
} from "./dispute-audit-public-key-registry.service.js";
import {
  dispatchDisputeAiAuditArchives, enqueueDisputeAiAuditArchive, enqueuePendingDisputeAiAudits,
  getDisputeAiAuditArchiveCoverage, getDisputeAiAuditArchiveHealth, getDisputeAiAuditDiscoveryFailureHealth,
  getLatestDisputeAiAuditArchive,
  requeueDisputeAiAuditArchive, retryDisputeAiAuditDiscoveryFailure,
} from "./dispute-ai-audit-archive.service.js";

class FixtureRollback extends Error {
  constructor(readonly result: Record<string, unknown>) {
    super("DISPUTE_AI_AUDIT_FIXTURE_ROLLBACK");
  }
}

export async function runDisputeAiAuditArchiveFixture(db: Database) {
  const candidates = await db.execute(sql`
    SELECT dispute.id FROM dispute_cases dispute
     WHERE NOT EXISTS (SELECT 1 FROM dispute_ai_assessment_events event WHERE event.dispute_id = dispute.id)
    ORDER BY dispute.created_at DESC LIMIT 2
  `) as unknown as Array<{ id: string }>;
  const disputeId = candidates[0]?.id;
  const poisonDisputeId = candidates[1]?.id;
  if (!disputeId || !poisonDisputeId) {
    return { pass: false, checks: "0/1", error: "AI_AUDIT_FIXTURE_DISPUTES_NOT_FOUND" };
  }
  const eventId = `cycle62_${randomUUID()}`;
  const poisonEventId = `cycle69_poison_${randomUUID()}`;
  const claimSource = `cycle64-ai-archive-${eventId}`;
  const createdAt = new Date();
  let firstLockReady!: () => void;
  const firstLockAcquired = new Promise<void>((resolve) => { firstLockReady = resolve; });
  const lockKey = disputeAiAuditAdvisoryLockKey(disputeId);
  const firstLock = db.transaction(async (transaction) => {
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
    firstLockReady();
    await transaction.execute(sql`SELECT pg_sleep(0.15)`);
  });
  await firstLockAcquired;
  const tryLockRows = await db.transaction(async (transaction) => transaction.execute(sql`
    SELECT pg_try_advisory_xact_lock(hashtextextended(${lockKey}, 0)) AS acquired
  `)) as unknown as Array<{ acquired: boolean }>;
  const advisoryTryLockRejected = tryLockRows[0]?.acquired === false;
  const lockWaitStarted = Date.now();
  const secondLock = db.transaction(async (transaction) => {
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
  });
  await Promise.all([firstLock, secondLock]);
  const advisoryLockWaitMs = Date.now() - lockWaitStarted;
  const advisoryLockSerialized = advisoryLockWaitMs >= 100;
  const event = {
    id: eventId, disputeId, eventType: "COMPLETED" as const, revision: 1,
    versionId: `version_${randomUUID()}`,
    evidenceSnapshotHash: "e".repeat(64), policyVersion: "cycle62-policy-v1", model: "deepseek-v4-pro",
    contextHash: "c".repeat(64), requestedBy: "cycle62-fixture", forced: false,
    payload: { conclusion: "buyer_favor", confidence: "high", fixture: true },
    createdAt,
  };
  let archiveId: string | null = null;
  let rolledBackResult: Record<string, unknown> | null = null;
  try {
    await db.transaction(async (transaction) => {
      const fixtureDb = transaction as unknown as Database;
      const baselineCoverage = await getDisputeAiAuditArchiveCoverage(fixtureDb, createdAt);
      await fixtureDb.execute(sql`
        INSERT INTO dispute_ai_assessment_events
          (id, dispute_id, event_type, revision, version_id, evidence_snapshot_hash, policy_version,
           model, context_hash, requested_by, forced, payload, created_at, previous_event_hash, event_hash)
        VALUES (${poisonEventId}, ${poisonDisputeId}::uuid, 'COMPLETED', 1, ${`version_${randomUUID()}`},
          ${"e".repeat(64)}, 'cycle69-poison-policy-v1', 'deepseek-v4-pro', ${"c".repeat(64)},
          'cycle69-fixture', false, ${JSON.stringify({ conclusion: "buyer_favor", fixture: true, poison: true })}::jsonb,
          ${new Date(createdAt.getTime() - 100).toISOString()}::timestamptz, NULL, ${"0".repeat(64)})
      `);
      await appendDisputeAiAssessmentEvent(fixtureDb, event);
      const gapCoverage = await getDisputeAiAuditArchiveCoverage(fixtureDb, new Date(createdAt.getTime() + 10));
      let revisionConflictBlocked = false;
      try {
        await appendDisputeAiAssessmentEvent(fixtureDb, {
          ...event, id: `cycle66_revision_${randomUUID()}`, revision: 3,
          versionId: `version_${randomUUID()}`, createdAt: new Date(createdAt.getTime() + 1),
        });
      } catch (error) { revisionConflictBlocked = error instanceof Error && error.message === "AI_AUDIT_REVISION_CONFLICT"; }
      let supersedesConflictBlocked = false;
      try {
        await appendDisputeAiAssessmentEvent(fixtureDb, {
          ...event, id: `cycle66_supersedes_${randomUUID()}`, revision: 2,
          versionId: `version_${randomUUID()}`, supersedesAssessmentId: "wrong-assessment-id",
          createdAt: new Date(createdAt.getTime() + 2),
        });
      } catch (error) { supersedesConflictBlocked = error instanceof Error && error.message === "AI_AUDIT_SUPERSEDES_CONFLICT"; }
      const { privateKey } = generateKeyPairSync("ed25519");
      const discovery = await enqueuePendingDisputeAiAudits(fixtureDb, {
        privateKey, now: createdAt, limit: 100,
      });
      const discoveredArchive = await getLatestDisputeAiAuditArchive(fixtureDb, disputeId);
      if (!discoveredArchive) throw new Error("AI_AUDIT_FIXTURE_HEALTHY_ARCHIVE_NOT_FOUND");
      const first = { outcome: "enqueued" as const, archive: discoveredArchive };
      const coveredCoverage = await getDisputeAiAuditArchiveCoverage(fixtureDb, new Date(createdAt.getTime() + 20));
      archiveId = first.archive.id;
      const firstFailureRows = await fixtureDb.execute(sql`
        SELECT attempt_count FROM dispute_ai_audit_discovery_failures
         WHERE dispute_id = ${poisonDisputeId}::uuid AND event_count = 1 AND status = 'OPEN'
      `) as unknown as Array<{ attempt_count: number }>;
      const suppressed = await enqueuePendingDisputeAiAudits(fixtureDb, {
        privateKey, now: new Date(createdAt.getTime() + 21), limit: 100,
      });
      const retry = await retryDisputeAiAuditDiscoveryFailure(fixtureDb, {
        disputeId: poisonDisputeId, eventCount: 1,
        actorId: "99999999-9999-4999-8999-999999999999",
        reason: "Cycle 69 operator reviewed the invalid chain and requested one controlled retry.",
        now: new Date(createdAt.getTime() + 22),
      });
      const retryRequestedRows = await fixtureDb.execute(sql`
        SELECT status FROM dispute_ai_audit_discovery_failures
         WHERE dispute_id = ${poisonDisputeId}::uuid AND event_count = 1
      `) as unknown as Array<{ status: string }>;
      const rediscovery = await enqueuePendingDisputeAiAudits(fixtureDb, {
        privateKey, now: new Date(createdAt.getTime() + 23), limit: 100,
      });
      const retriedFailureRows = await fixtureDb.execute(sql`
        SELECT attempt_count FROM dispute_ai_audit_discovery_failures
         WHERE dispute_id = ${poisonDisputeId}::uuid AND event_count = 1 AND status = 'OPEN'
      `) as unknown as Array<{ attempt_count: number }>;
      const duplicate = await enqueueDisputeAiAuditArchive(fixtureDb, { disputeId, privateKey, now: createdAt });
      const signatureValid = verifySignedDisputeAiAuditExport(first.archive.payload as any);
      const signedAudit = first.archive.payload as any;
      const generatedAtMs = Date.parse(signedAudit.manifest.generated_at);
      const activeKey = normalizeDisputeAuditPublicKeyRecord({
        public_key_spki_base64: signedAudit.signature.public_key_spki_base64, status: "active",
        not_before: new Date(generatedAtMs - 1000).toISOString(),
      });
      const retiredKey = normalizeDisputeAuditPublicKeyRecord({
        public_key_spki_base64: signedAudit.signature.public_key_spki_base64, status: "retired",
        not_before: new Date(generatedAtMs - 1000).toISOString(), retired_at: new Date(generatedAtMs + 1000).toISOString(),
      });
      const revokedKey = normalizeDisputeAuditPublicKeyRecord({
        public_key_spki_base64: signedAudit.signature.public_key_spki_base64, status: "revoked",
        not_before: new Date(generatedAtMs - 1000).toISOString(), revoked_at: new Date(generatedAtMs + 1000).toISOString(),
      });
      const activeTrust = verifyTrustedSignedDisputeAiAuditExport(signedAudit, [activeKey]);
      const retiredTrust = verifyTrustedSignedDisputeAiAuditExport(signedAudit, [retiredKey]);
      const revokedTrust = verifyTrustedSignedDisputeAiAuditExport(signedAudit, [revokedKey]);
      const baselineHealth = await getDisputeAiAuditArchiveHealth(fixtureDb, createdAt);
      const discoveryFailureHealth = await getDisputeAiAuditDiscoveryFailureHealth(fixtureDb, createdAt);
      const cleanDiscoveryHealth = { ...discoveryFailureHealth, status: "healthy" as const, open: 0,
        retryRequested: 0, unresolved: 0, invalidChain: 0, tooLarge: 0, unsealed: 0,
        oldestOpenAgeSeconds: null };
      const mismatchFetch = (async () => new Response(JSON.stringify({
        receipt_id: "cycle63-ai-audit-bad-receipt", stored_sha256: "0".repeat(64),
      }), { status: 201, headers: { "content-type": "application/json" } })) as typeof fetch;
      const failedDispatch = await dispatchDisputeAiAuditArchives(fixtureDb, {
        config: { url: "http://127.0.0.1:4177/mock-worm", timeoutMs: 1000, maxAttempts: 1, allowInsecureHttp: true, allowPrivateNetwork: true },
        fetchImpl: mismatchFetch, now: new Date(createdAt.getTime() + 500),
      });
      const failedHealth = await getDisputeAiAuditArchiveHealth(fixtureDb, new Date(createdAt.getTime() + 600));
      const alertBodies: Array<Record<string, unknown>> = [];
      const receiverChecks: boolean[] = [];
      const alertConfig = { url: "http://127.0.0.1:4177/mock-alert", secret: "cycle64-ai-archive-alert-secret",
        timeoutMs: 1000, cooldownMinutes: 15, staleThreshold: 1, retryReadyThreshold: 1,
        deadLetterThreshold: 1, overdueUnfinishedThreshold: 1, discoveryUnresolvedThreshold: 1,
        discoveryTooLargeThreshold: 1, allowInsecureHttp: true, allowPrivateNetwork: true };
      const discoveryAlertAssessment = evaluateDisputeAiAuditArchiveAlert(
        baselineHealth, alertConfig, discoveryFailureHealth,
      );
      const alertFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
        const rawBody = String(init?.body ?? "{}"); const headers = new Headers(init?.headers);
        alertBodies.push(JSON.parse(rawBody) as Record<string, unknown>);
        const verified = verifyDisputeAiAuditArchiveAlert({ rawBody,
          timestamp: headers.get("x-haggle-alert-timestamp") ?? undefined,
          signature: headers.get("x-haggle-alert-signature") ?? undefined,
          deliveryId: headers.get("x-haggle-alert-delivery-id") ?? undefined,
          secret: alertConfig.secret, nowMs: Date.parse(headers.get("x-haggle-alert-timestamp") ?? "") });
        if (!verified.ok) { receiverChecks.push(false); return new Response("invalid", { status: 401 }); }
        const receiverSource = `${claimSource}-receiver`;
        const accepted = await claimVerifiedDisputeAiArchiveAlert(fixtureDb, verified, receiverSource);
        if (accepted.outcome !== "accepted") { receiverChecks.push(false); return new Response("conflict", { status: 409 }); }
        await completeWebhookEvent(fixtureDb, accepted.claim, 202);
        const replay = await claimVerifiedDisputeAiArchiveAlert(fixtureDb, verified, receiverSource);
        receiverChecks.push(replay.outcome === "replay_or_in_progress");
        return new Response("accepted", { status: 202 });
      }) as typeof fetch;
      const firingAlert = await runDisputeAiAuditArchiveAlert(fixtureDb, {
        config: alertConfig, fetchImpl: alertFetch, claimSource, discoveryHealth: cleanDiscoveryHealth,
        now: new Date(createdAt.getTime() + 650),
      });
      const requeued = await requeueDisputeAiAuditArchive(fixtureDb, {
        archiveId: first.archive.id, actorId: "99999999-9999-4999-8999-999999999999",
        reason: "Cycle 63 verified that the WORM receipt endpoint recovered.", now: new Date(createdAt.getTime() + 700),
      });
      const payloadPreserved = requeued.outcome === "requeued" && requeued.archive.payloadSha256 === first.archive.payloadSha256;
      const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        return new Response(JSON.stringify({
          receipt_id: "cycle62-ai-audit-receipt",
          stored_sha256: headers.get("x-haggle-content-sha256"),
        }), { status: 201, headers: { "content-type": "application/json" } });
      }) as typeof fetch;
      const dispatch = await dispatchDisputeAiAuditArchives(fixtureDb, {
        config: { url: "http://127.0.0.1:4177/mock-worm", timeoutMs: 1000, maxAttempts: 3, allowInsecureHttp: true, allowPrivateNetwork: true },
        fetchImpl,
        now: new Date(createdAt.getTime() + 1000),
      });
      const recoveredHealth = await getDisputeAiAuditArchiveHealth(fixtureDb, new Date(createdAt.getTime() + 1100));
      const recoveryAlert = await runDisputeAiAuditArchiveAlert(fixtureDb, {
        config: alertConfig, fetchImpl: alertFetch, claimSource, discoveryHealth: cleanDiscoveryHealth,
        now: new Date(createdAt.getTime() + 1150),
      });
      const duplicateRecovery = await runDisputeAiAuditArchiveAlert(fixtureDb, {
        config: alertConfig, fetchImpl: alertFetch, claimSource, discoveryHealth: cleanDiscoveryHealth,
        now: new Date(createdAt.getTime() + 1200),
      });
      const rows = await fixtureDb.execute(sql`
        SELECT status, event_count AS "eventCount", events_sha256 AS "eventsSha256",
               payload_sha256 AS "payloadSha256", receipt_sha256 AS "receiptSha256"
          FROM dispute_ai_audit_outbox WHERE id = ${archiveId}::uuid
      `) as unknown as Array<Record<string, unknown>>;
      const archive = rows[0] ?? {};
      const pass = first.outcome === "enqueued"
        && discovery.isolated >= 1 && discovery.enqueued >= 1
        && firstFailureRows[0]?.attempt_count === 1
        && suppressed.discovered === 0 && suppressed.enqueued === 0 && suppressed.isolated === 0
        && retry.outcome === "retry_enabled" && retryRequestedRows[0]?.status === "RETRY_REQUESTED"
        && rediscovery.isolated === 1
        && retriedFailureRows[0]?.attempt_count === 2
        && discoveryAlertAssessment.wouldAlert && discoveryAlertAssessment.severity === "warning"
        && discoveryAlertAssessment.reasons.includes("ai_audit_discovery_failure_unresolved")
        && duplicate.outcome === "duplicate" && duplicate.archive.id === first.archive.id
        && duplicate.archive.payloadSha256 === first.archive.payloadSha256
        && signatureValid && failedDispatch.deadLettered === 1
        && failedHealth.deadLetter === baselineHealth.deadLetter + 1 && failedHealth.status === "critical"
        && requeued.outcome === "requeued" && payloadPreserved
        && dispatch.delivered === 1 && archive.status === "DELIVERED"
        && recoveredHealth.deadLetter === baselineHealth.deadLetter
        && firingAlert.status === "delivered" && alertBodies[0]?.state === "firing"
        && recoveryAlert.status === "recovered" && alertBodies[1]?.state === "recovered"
        && duplicateRecovery.status === "skipped" && duplicateRecovery.reason === "recovery_already_sent_or_in_progress"
        && receiverChecks.length === 2 && receiverChecks.every(Boolean)
        && activeTrust.valid && retiredTrust.valid && !revokedTrust.valid && revokedTrust.reason === "KEY_REVOKED"
        && gapCoverage.eligibleUnarchived === baselineCoverage.eligibleUnarchived + 2
        && coveredCoverage.eligibleUnarchived === baselineCoverage.eligibleUnarchived + 1
        && coveredCoverage.archivedCurrent === baselineCoverage.archivedCurrent + 1
        && archive.eventCount === 1 && archive.receiptSha256 === archive.payloadSha256;
      throw new FixtureRollback({
        pass: pass && advisoryLockSerialized && advisoryTryLockRejected
          && revisionConflictBlocked && supersedesConflictBlocked,
        checks: pass ? "1/1" : "0/1",
        enqueued: first.outcome === "enqueued",
        poison_isolated: discovery.isolated >= 1 && firstFailureRows[0]?.attempt_count === 1,
        healthy_discovery_continued: discovery.enqueued >= 1 && first.archive.disputeId === disputeId,
        known_failure_suppressed: suppressed.discovered === 0,
        operator_retry_enabled: retry.outcome === "retry_enabled",
        retry_pending_until_worker: retryRequestedRows[0]?.status === "RETRY_REQUESTED",
        retry_reisolated: rediscovery.isolated === 1 && retriedFailureRows[0]?.attempt_count === 2,
        discovery_alert_would_fire: discoveryAlertAssessment.wouldAlert
          && discoveryAlertAssessment.reasons.includes("ai_audit_discovery_failure_unresolved"),
        duplicate_idempotent: duplicate.outcome === "duplicate" && duplicate.archive.id === first.archive.id,
        signature_valid: signatureValid,
        event_count: archive.eventCount ?? 0,
        delivered: archive.status === "DELIVERED",
        receipt_match: archive.receiptSha256 === archive.payloadSha256,
        dead_letter_detected: failedDispatch.deadLettered === 1 && failedHealth.status === "critical",
        requeued: requeued.outcome === "requeued",
        payload_preserved: payloadPreserved,
        health_recovered: recoveredHealth.deadLetter === baselineHealth.deadLetter,
        firing_alert: firingAlert.status === "delivered" && alertBodies[0]?.state === "firing",
        recovery_alert: recoveryAlert.status === "recovered" && alertBodies[1]?.state === "recovered",
        duplicate_alert_blocked: duplicateRecovery.status === "skipped" && duplicateRecovery.reason === "recovery_already_sent_or_in_progress",
        receiver_replay_blocked: receiverChecks.length === 2 && receiverChecks.every(Boolean),
        advisory_lock_serialized: advisoryLockSerialized,
        discovery_try_lock_rejected: advisoryTryLockRejected,
        advisory_lock_wait_ms: advisoryLockWaitMs,
        revision_conflict_blocked: revisionConflictBlocked,
        supersedes_conflict_blocked: supersedesConflictBlocked,
        active_key_trusted: activeTrust.valid,
        retired_key_trusted: retiredTrust.valid && retiredTrust.reason === "TRUSTED_RETIRED_KEY",
        revoked_key_blocked: !revokedTrust.valid && revokedTrust.reason === "KEY_REVOKED",
        coverage_gap_detected: gapCoverage.eligibleUnarchived === baselineCoverage.eligibleUnarchived + 2,
        coverage_restored: coveredCoverage.eligibleUnarchived === baselineCoverage.eligibleUnarchived + 1
          && coveredCoverage.archivedCurrent === baselineCoverage.archivedCurrent + 1,
        archive_cleanup: 0,
        event_cleanup: 0,
        alert_claim_cleanup: 0,
        discovery_failure_cleanup: 0,
        discovery_retry_audit_cleanup: 0,
      });
    });
  } catch (error) {
    if (!(error instanceof FixtureRollback)) throw error;
    rolledBackResult = error.result;
  }
  const remainingArchives = archiveId
    ? await db.execute(sql`SELECT id FROM dispute_ai_audit_outbox WHERE id = ${archiveId}::uuid`)
    : [];
  const remainingEvents = await db.execute(sql`
    SELECT id FROM dispute_ai_assessment_events WHERE id IN (${eventId}, ${poisonEventId})
  `);
  const remainingAlertClaims = await db.execute(sql`SELECT id FROM webhook_idempotency WHERE source IN (${claimSource}, ${`${claimSource}-receiver`})`);
  const remainingDiscoveryFailures = await db.execute(sql`
    SELECT id FROM dispute_ai_audit_discovery_failures WHERE dispute_id = ${poisonDisputeId}::uuid
  `);
  const remainingRetryAudits = await db.execute(sql`
    SELECT id FROM admin_action_log WHERE action_type = 'dispute.ai_audit_discovery_retry'
      AND payload->>'dispute_id' = ${poisonDisputeId}
  `);
  if (!rolledBackResult) throw new Error("DISPUTE_AI_AUDIT_FIXTURE_RESULT_MISSING");
  rolledBackResult.archive_cleanup = remainingArchives.length === 0 ? 1 : 0;
  rolledBackResult.event_cleanup = remainingEvents.length === 0 ? 2 : 0;
  rolledBackResult.alert_claim_cleanup = remainingAlertClaims.length === 0 ? 4 : 0;
  rolledBackResult.discovery_failure_cleanup = remainingDiscoveryFailures.length === 0 ? 1 : 0;
  rolledBackResult.discovery_retry_audit_cleanup = remainingRetryAudits.length === 0 ? 1 : 0;
  rolledBackResult.pass = rolledBackResult.pass === true
    && rolledBackResult.archive_cleanup === 1 && rolledBackResult.event_cleanup === 2
    && rolledBackResult.alert_claim_cleanup === 4
    && rolledBackResult.discovery_failure_cleanup === 1
    && rolledBackResult.discovery_retry_audit_cleanup === 1;
  rolledBackResult.checks = rolledBackResult.pass ? "1/1" : "0/1";
  return rolledBackResult;
}
