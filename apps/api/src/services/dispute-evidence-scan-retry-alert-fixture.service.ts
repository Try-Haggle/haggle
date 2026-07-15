import { createHash, randomUUID } from "node:crypto";
import { type Database, sql } from "@haggle/db";
import { runDisputeEvidenceScanRetryAlert } from "../jobs/dispute-evidence-scan-retry-alert.js";
import { getDisputeEvidenceScanRetryHealth } from "./dispute-evidence-scan-retry.service.js";
import {
  type DisputeEvidenceScanRetryAlertConfig,
  type DisputeEvidenceScanRetryAlertSnapshotRetentionHealth,
  type DisputeEvidenceScanRetryAlertSnapshotRetentionJobHealth,
  evaluateDisputeEvidenceScanRetryAlert,
  getDisputeEvidenceScanRetryAlertSenderHealth,
  sendDisputeEvidenceScanRetryAlert,
} from "./dispute-evidence-scan-retry-alert.service.js";
import { getDisputeEvidenceScanRetryAlertSnapshotRetentionHealth } from "./dispute-evidence-scan-retry-alert-snapshot-retention.service.js";
import {
  claimVerifiedDisputeEvidenceScanRetryAlert,
  verifyDisputeEvidenceScanRetryAlert,
} from "./dispute-evidence-scan-retry-alert-verifier.service.js";
import {
  acquireDisputeEvidenceScannerPermit,
  type DisputeEvidenceScannerCircuitConfig,
  finalizeDisputeEvidenceScannerPermit,
  getDisputeEvidenceScannerCircuitHealth,
} from "./dispute-evidence-scanner-circuit.service.js";
import { signWebhookClaimAlertPayload } from "./webhook-claim-alert.service.js";
import {
  claimWebhookEvent,
  completeWebhookEvent,
  webhookPayloadSha256,
} from "./webhook-event-claim.service.js";

interface CapturedAlert {
  rawBody: string;
  timestamp: string;
  signature: string;
  deliveryId: string;
}

export async function runDisputeEvidenceScanRetryAlertFixture(db: Database) {
  const fixtureId = randomUUID();
  const circuitKey = `alert-fixture:${fixtureId}`;
  const source = `haggle-scan-retry-alert-fixture-${fixtureId}`;
  const receiverSource = `haggle-scan-retry-alert-receiver-fixture-${fixtureId}`;
  const secret = "fixture-scan-retry-alert-secret-value";
  const circuitConfig: DisputeEvidenceScannerCircuitConfig = {
    failureThreshold: 3,
    openSeconds: 60,
    permitLeaseSeconds: 30,
    maxConcurrent: 4,
  };
  const [baseline, baselineRetention] = await Promise.all([
    getDisputeEvidenceScanRetryHealth(db),
    getDisputeEvidenceScanRetryAlertSnapshotRetentionHealth(db),
  ]);
  if (
    baseline.totals.retryReady >= 99_999 ||
    baseline.totals.staleProcessing >= 99_999 ||
    baseline.totals.exhausted >= 99_999 ||
    baseline.totals.expiredQuarantined >= 99_999 ||
    baselineRetention.blockedExpired >= 99_999
  ) {
    throw new Error("DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_FIXTURE_BASELINE_TOO_LARGE");
  }
  const config: DisputeEvidenceScanRetryAlertConfig = {
    url: "https://ops.fixture.invalid/scan-retry-alert",
    secret,
    timeoutMs: 1_000,
    cooldownMinutes: 15,
    retryReadyThreshold: baseline.totals.retryReady + 1,
    staleThreshold: baseline.totals.staleProcessing + 1,
    exhaustedThreshold: baseline.totals.exhausted + 1,
    expiredThreshold: baseline.totals.expiredQuarantined + 1,
    retentionBlockedThreshold: baselineRetention.blockedExpired + 1,
    allowInsecureHttp: false,
    allowPrivateNetwork: false,
  };
  const captured: CapturedAlert[] = [];
  let lostResponseReceiverAccepted = 0;
  const captureRequest = (init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const item = {
      rawBody: String(init?.body ?? ""),
      timestamp: headers.get("x-haggle-alert-timestamp") ?? "",
      signature: headers.get("x-haggle-alert-signature") ?? "",
      deliveryId: headers.get("x-haggle-alert-delivery-id") ?? "",
    };
    captured.push(item);
    return item;
  };
  const failingFetch = async (_input: string | URL | Request, init?: RequestInit) => {
    const item = captureRequest(init);
    const verification = verifyDisputeEvidenceScanRetryAlert({
      ...item,
      secret,
      nowMs: Date.parse(item.timestamp),
    });
    if (verification.ok) {
      const claim = await claimVerifiedDisputeEvidenceScanRetryAlert(
        db,
        verification,
        receiverSource,
      );
      lostResponseReceiverAccepted = claim.outcome === "acquired" ? 1 : 0;
    }
    return new Response(null, { status: 503 });
  };
  const fetchImpl = async (_input: string | URL | Request, init?: RequestInit) => {
    captureRequest(init);
    return new Response(null, { status: 204 });
  };
  let result: Record<string, unknown> | null = null;
  let circuitCleanup = 0;
  let senderClaimCleanup = 0;
  let receiverClaimCleanup = 0;
  let snapshotCleanup = 0;
  try {
    const now = new Date("2026-07-14T08:30:00.000Z");
    for (let index = 0; index < circuitConfig.failureThreshold; index += 1) {
      const permit = await acquireDisputeEvidenceScannerPermit(db, {
        now,
        circuitKey,
        config: circuitConfig,
      });
      if (!permit.acquired) {
        throw new Error("DISPUTE_EVIDENCE_SCANNER_ALERT_FIXTURE_PERMIT_FAILED");
      }
      const finalized = await finalizeDisputeEvidenceScannerPermit(db, permit, {
        scannerOperational: false,
        now,
        config: circuitConfig,
      });
      if (!finalized) {
        throw new Error("DISPUTE_EVIDENCE_SCANNER_ALERT_FIXTURE_OPEN_FAILED");
      }
    }
    const failedIncident = await runDisputeEvidenceScanRetryAlert(db, {
      now,
      config,
      claimSource: source,
      circuitKey,
      fetchImpl: failingFetch as typeof fetch,
    });
    const failedAlert = captured[0];
    if (!failedAlert) {
      throw new Error("DISPUTE_EVIDENCE_SCAN_RETRY_FAILED_ALERT_NOT_CAPTURED");
    }
    const senderAfterFailure = await getDisputeEvidenceScanRetryAlertSenderHealth(db, source);
    const backoffRun = await runDisputeEvidenceScanRetryAlert(db, {
      now,
      config,
      claimSource: source,
      circuitKey,
      fetchImpl: fetchImpl as typeof fetch,
    });
    const releasedRows = (await db.execute(sql`
      UPDATE webhook_idempotency
         SET next_attempt_at = now() - interval '1 second'
       WHERE source = ${source}
         AND idempotency_key = ${failedAlert.deliveryId}
         AND status = 'FAILED'
         AND claim_id IS NULL
      RETURNING id
    `)) as unknown as Array<{ id: string }>;
    const senderRetryReady = await getDisputeEvidenceScanRetryAlertSenderHealth(db, source);
    const retryNow = new Date("2026-07-14T08:46:01.000Z");
    const incidentRuns = await Promise.all(
      Array.from({ length: 20 }, () =>
        runDisputeEvidenceScanRetryAlert(db, {
          now: retryNow,
          config,
          claimSource: source,
          circuitKey,
          fetchImpl: fetchImpl as typeof fetch,
        }),
      ),
    );
    const delivered = incidentRuns.filter((item) => item.status === "retried").length;
    const suppressed = incidentRuns.filter(
      (item) =>
        item.status === "skipped" &&
        (item.reason === "snapshot_already_sent_or_in_progress" ||
          item.reason === "recent_incident_cooldown"),
    ).length;
    const senderAfterIncident = await getDisputeEvidenceScanRetryAlertSenderHealth(db, source);
    const incidentAlert = captured[1];
    if (!incidentAlert) {
      throw new Error("DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_FIXTURE_NOT_CAPTURED");
    }
    const incidentVerification = verifyDisputeEvidenceScanRetryAlert({
      ...incidentAlert,
      secret,
      nowMs: retryNow.getTime(),
    });
    if (!incidentVerification.ok) {
      throw new Error("DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_FIXTURE_VERIFY_FAILED");
    }
    const receiverClaims = await Promise.all(
      Array.from({ length: 20 }, () =>
        claimVerifiedDisputeEvidenceScanRetryAlert(db, incidentVerification, receiverSource),
      ),
    );
    const receiverWinners =
      receiverClaims.filter((claim) => claim.outcome === "acquired").length +
      lostResponseReceiverAccepted;
    const receiverReplayBlocked = receiverClaims.filter(
      (claim) => claim.outcome === "duplicate" || claim.outcome === "in_progress",
    ).length;

    const failedVerification = verifyDisputeEvidenceScanRetryAlert({
      ...failedAlert,
      secret,
      nowMs: now.getTime(),
    });

    const tampered = JSON.parse(incidentAlert.rawBody) as Record<string, unknown>;
    (tampered.health as { circuit: { state: string } }).circuit.state = "CLOSED";
    const tamperRejected = !verifyDisputeEvidenceScanRetryAlert({
      ...incidentAlert,
      rawBody: JSON.stringify(tampered),
      signature: signWebhookClaimAlertPayload(
        secret,
        incidentAlert.timestamp,
        JSON.stringify(tampered),
      ),
      secret,
      nowMs: now.getTime(),
    }).ok;

    const recoveryNow = new Date("2026-07-14T08:46:02.000Z");
    const probe = await acquireDisputeEvidenceScannerPermit(db, {
      now: recoveryNow,
      circuitKey,
      config: circuitConfig,
    });
    if (!probe.acquired || probe.kind !== "PROBE") {
      throw new Error("DISPUTE_EVIDENCE_SCANNER_ALERT_FIXTURE_PROBE_FAILED");
    }
    const recovered = await finalizeDisputeEvidenceScannerPermit(db, probe, {
      scannerOperational: true,
      now: recoveryNow,
      config: circuitConfig,
    });
    if (!recovered) {
      throw new Error("DISPUTE_EVIDENCE_SCANNER_ALERT_FIXTURE_RECOVERY_FAILED");
    }
    const recovery = await runDisputeEvidenceScanRetryAlert(db, {
      now: recoveryNow,
      config,
      claimSource: source,
      circuitKey,
      fetchImpl: fetchImpl as typeof fetch,
    });
    const recoveryReplay = await runDisputeEvidenceScanRetryAlert(db, {
      now: recoveryNow,
      config,
      claimSource: source,
      circuitKey,
      fetchImpl: fetchImpl as typeof fetch,
    });
    const senderAfterRecovery = await getDisputeEvidenceScanRetryAlertSenderHealth(db, source);
    const recoveryAlert = captured[2];
    if (!recoveryAlert) {
      throw new Error("DISPUTE_EVIDENCE_SCAN_RETRY_RECOVERY_NOT_CAPTURED");
    }
    const recoveryVerification = verifyDisputeEvidenceScanRetryAlert({
      ...recoveryAlert,
      secret,
      nowMs: recoveryNow.getTime(),
    });
    if (!recoveryVerification.ok) {
      throw new Error("DISPUTE_EVIDENCE_SCAN_RETRY_RECOVERY_VERIFY_FAILED");
    }
    const recoveryReceiverFirst = await claimVerifiedDisputeEvidenceScanRetryAlert(
      db,
      recoveryVerification,
      receiverSource,
    );
    const recoveryReceiverReplay = await claimVerifiedDisputeEvidenceScanRetryAlert(
      db,
      recoveryVerification,
      receiverSource,
    );
    const retentionNow = new Date("2026-07-14T08:46:03.000Z");
    const [healthyRetry, closedCircuit] = await Promise.all([
      getDisputeEvidenceScanRetryHealth(db, { now: retentionNow }),
      getDisputeEvidenceScannerCircuitHealth(db, {
        now: retentionNow,
        circuitKey,
      }),
    ]);
    const retentionState: DisputeEvidenceScanRetryAlertSnapshotRetentionHealth = {
      status: "attention",
      eligibleExpired: 0,
      blockedExpired: config.retentionBlockedThreshold,
      oldestBlockedExpiredAgeSeconds: 60,
      policy: { retentionDays: 30, batchSize: 100, jobEnabled: true, cronEnabled: true },
      containsIdentifiers: false,
      recordedAt: retentionNow.toISOString(),
    };
    const retentionJobState: DisputeEvidenceScanRetryAlertSnapshotRetentionJobHealth = {
      status: "attention",
      lastRunStatus: "FAILED",
      overdue: false,
      leaseStale: false,
      firstObservedAt: "2026-07-13T08:46:03.000Z",
      lastStartedAt: "2026-07-14T08:45:00.000Z",
      lastSucceededAt: "2026-07-13T08:46:03.000Z",
      lastFailedAt: "2026-07-14T08:46:02.000Z",
      lastDeletedSnapshots: 0,
      lastFailureCode: "RETENTION_EXECUTION_FAILED",
      policy: {
        jobEnabled: true,
        cronEnabled: true,
        intervalSeconds: 86_400,
        leaseSeconds: 900,
        maxStartDelaySeconds: 93_600,
      },
      containsIdentifiers: false,
      recordedAt: retentionNow.toISOString(),
    };
    const retentionAssessment = evaluateDisputeEvidenceScanRetryAlert(
      healthyRetry,
      closedCircuit,
      config,
      retentionState,
      retentionJobState,
    );
    const retentionDeliveryId = `health_${createHash("sha256")
      .update(`retention:${fixtureId}`)
      .digest("hex")}`;
    const retentionDelivery = await sendDisputeEvidenceScanRetryAlert(
      healthyRetry,
      closedCircuit,
      retentionAssessment,
      {
        config,
        deliveryId: retentionDeliveryId,
        retention: retentionState,
        retentionJob: retentionJobState,
        fetchImpl: fetchImpl as typeof fetch,
        now: retentionNow,
      },
    );
    const retentionAlert = captured[3];
    if (!retentionAlert) {
      throw new Error("DISPUTE_EVIDENCE_SCAN_RETRY_RETENTION_ALERT_NOT_CAPTURED");
    }
    const retentionVerification = verifyDisputeEvidenceScanRetryAlert({
      ...retentionAlert,
      secret,
      nowMs: retentionNow.getTime(),
    });
    if (!retentionVerification.ok) {
      throw new Error("DISPUTE_EVIDENCE_SCAN_RETRY_RETENTION_VERIFY_FAILED");
    }
    const retentionReceiver = await claimVerifiedDisputeEvidenceScanRetryAlert(
      db,
      retentionVerification,
      receiverSource,
    );
    const retentionTampered = JSON.parse(retentionAlert.rawBody) as {
      health: {
        retention: {
          blocked_expired: number;
          job: {
            status: string;
            last_run_status: string;
          };
        };
      };
    };
    retentionTampered.health.retention.blocked_expired = 0;
    retentionTampered.health.retention.job.status = "healthy";
    retentionTampered.health.retention.job.last_run_status = "SUCCEEDED";
    const retentionTamperedBody = JSON.stringify(retentionTampered);
    const retentionSemanticTamperRejected = !verifyDisputeEvidenceScanRetryAlert({
      ...retentionAlert,
      rawBody: retentionTamperedBody,
      signature: signWebhookClaimAlertPayload(
        secret,
        retentionAlert.timestamp,
        retentionTamperedBody,
      ),
      secret,
      nowMs: retentionNow.getTime(),
    }).ok;
    const staleEventId = `stale_${createHash("sha256")
      .update("scan-retry-alert-sender-stale-fixture")
      .digest("hex")}`;
    const staleOwner = await claimWebhookEvent(db, {
      source,
      eventId: staleEventId,
      payloadSha256: webhookPayloadSha256("scan-retry-alert-stale-claim"),
    });
    if (staleOwner.outcome !== "acquired") {
      throw new Error("DISPUTE_EVIDENCE_SCAN_RETRY_STALE_OWNER_NOT_ACQUIRED");
    }
    await db.execute(sql`
      UPDATE webhook_idempotency
         SET lease_expires_at = now() - interval '1 second'
       WHERE source = ${source}
         AND idempotency_key = ${staleEventId}
         AND status = 'PROCESSING'
         AND claim_id = ${staleOwner.claimId ?? null}
    `);
    const senderWithStale = await getDisputeEvidenceScanRetryAlertSenderHealth(db, source);
    const staleTakeover = await claimWebhookEvent(db, {
      source,
      eventId: staleEventId,
      payloadSha256: webhookPayloadSha256("scan-retry-alert-stale-claim"),
    });
    let staleOwnerFenced = false;
    try {
      await completeWebhookEvent(db, staleOwner, 204);
    } catch (error) {
      staleOwnerFenced = error instanceof Error && error.message === "WEBHOOK_CLAIM_LOST";
    }
    const staleTakeoverCompleted =
      staleTakeover.outcome === "acquired"
        ? await completeWebhookEvent(db, staleTakeover, 204)
        : false;
    const senderAfterStaleRecovery = await getDisputeEvidenceScanRetryAlertSenderHealth(db, source);
    let snapshotMutationRejected = false;
    try {
      await db.execute(sql`
        UPDATE dispute_evidence_scan_retry_alert_snapshots
           SET payload_sha256 = ${"0".repeat(64)}
         WHERE source = ${source}
      `);
    } catch {
      snapshotMutationRejected = true;
    }
    let snapshotDeleteRejected = false;
    try {
      await db.execute(sql`
        DELETE FROM dispute_evidence_scan_retry_alert_snapshots
         WHERE source = ${source}
      `);
    } catch {
      snapshotDeleteRejected = true;
    }
    const serializedPayloads = captured.map((item) => item.rawBody).join("\n");
    const incidentPayload = JSON.parse(incidentAlert.rawBody) as {
      health: {
        circuit: Record<string, unknown>;
        totals: Record<string, number>;
        retention: Record<string, unknown>;
      };
    };
    const retentionPayload = JSON.parse(retentionAlert.rawBody) as {
      schema_version: string;
      severity: string;
      reasons: string[];
      thresholds: { retention_blocked_expired: number };
      health: {
        retention: {
          blocked_expired: number;
          job: {
            active: boolean;
            status: string;
            last_run_status: string;
          };
        };
      };
    };
    const checks = {
      circuitAloneDetectedCritical: incidentRuns.some(
        (item) =>
          item.assessment?.severity === "critical" &&
          item.assessment.reasons.length === 1 &&
          item.assessment.reasons[0] === "scanner_circuit_open",
      ),
      retryQueueBelowThreshold:
        incidentPayload.health.totals.retry_ready < config.retryReadyThreshold &&
        incidentPayload.health.totals.stale_processing < config.staleThreshold &&
        incidentPayload.health.totals.exhausted < config.exhaustedThreshold &&
        incidentPayload.health.totals.expired_quarantined < config.expiredThreshold,
      circuitAggregateIncluded:
        incidentPayload.health.circuit.state === "OPEN" &&
        incidentPayload.health.circuit.consecutive_failures === 3 &&
        incidentPayload.health.circuit.active_permits === 0 &&
        incidentPayload.health.circuit.max_concurrent === 4 &&
        incidentPayload.health.circuit.failure_threshold === 3,
      retentionStateSignedCritical:
        retentionDelivery.status === "delivered" &&
        retentionVerification.ok &&
        retentionReceiver.outcome === "acquired" &&
        retentionPayload.schema_version === "dispute-evidence-scan-retry-alert-v3" &&
        retentionPayload.severity === "critical" &&
        retentionPayload.reasons.join("|") ===
          "alert_snapshot_retention_blocked|alert_snapshot_retention_job_failed" &&
        retentionPayload.thresholds.retention_blocked_expired ===
          config.retentionBlockedThreshold &&
        retentionPayload.health.retention.blocked_expired === config.retentionBlockedThreshold &&
        retentionPayload.health.retention.job.active &&
        retentionPayload.health.retention.job.status === "attention" &&
        retentionPayload.health.retention.job.last_run_status === "FAILED",
      retentionSemanticTamperRejected,
      senderFailureRecorded:
        failedIncident.status === "failed" &&
        senderAfterFailure.status === "warning" &&
        senderAfterFailure.failed === 1 &&
        senderAfterFailure.retryReady === 0 &&
        senderAfterFailure.maxAttemptCount === 1 &&
        senderAfterFailure.snapshotCount === 1,
      senderBackoffBlocked:
        backoffRun.status === "skipped" && backoffRun.reason === "snapshot_retry_backoff",
      senderRetryReadyObserved:
        releasedRows.length === 1 &&
        senderRetryReady.failed === 1 &&
        senderRetryReady.retryReady === 1 &&
        senderRetryReady.retryableSnapshots === 1,
      senderRetryExactlyOnce:
        failedAlert.deliveryId === incidentAlert.deliveryId &&
        senderAfterIncident.status === "healthy" &&
        senderAfterIncident.completed === 1 &&
        senderAfterIncident.failed === 0 &&
        senderAfterIncident.maxAttemptCount === 2 &&
        senderAfterIncident.snapshotCount === 1 &&
        senderAfterIncident.bindingViolations === 0,
      distributedSenderExactlyOnce: delivered === 1 && suppressed === 19,
      retryCrossedCooldownBucket:
        Math.floor(now.getTime() / (config.cooldownMinutes * 60_000)) !==
        Math.floor(retryNow.getTime() / (config.cooldownMinutes * 60_000)),
      semanticSnapshotStableAcrossRetry:
        failedVerification.ok &&
        incidentVerification.ok &&
        failedVerification.payloadSha256 === incidentVerification.payloadSha256 &&
        failedAlert.timestamp !== incidentAlert.timestamp,
      lostResponseReceiverReplaySafe:
        lostResponseReceiverAccepted === 1 &&
        receiverClaims.every((claim) => claim.outcome === "duplicate"),
      snapshotMutationRejected,
      snapshotDeleteRejected,
      signedAggregateDelivered: incidentVerification.ok && incidentVerification.state === "firing",
      receiverExactlyOnce: receiverWinners === 1 && receiverReplayBlocked === 20,
      tamperRejected,
      recoveryDelivered:
        recovery.status === "recovered" && recoveryVerification.state === "recovered",
      duplicateRecoverySuppressed:
        recoveryReplay.status === "skipped" &&
        recoveryReplay.reason === "recovery_already_sent_or_in_progress",
      recoveryReceiverReplayBlocked:
        recoveryReceiverFirst.outcome === "acquired" &&
        recoveryReceiverReplay.outcome === "duplicate",
      senderHealthRecovered:
        senderAfterRecovery.status === "healthy" &&
        senderAfterRecovery.completed === 2 &&
        senderAfterRecovery.failed === 0 &&
        senderAfterRecovery.staleProcessing === 0 &&
        senderAfterRecovery.retryReady === 0 &&
        senderAfterRecovery.snapshotCount === 2 &&
        senderAfterRecovery.missingRetrySnapshots === 0 &&
        senderAfterRecovery.bindingViolations === 0 &&
        senderAfterRecovery.containsIdentifiers === false,
      senderStaleDetectedCritical:
        senderWithStale.status === "critical" &&
        senderWithStale.processing === 1 &&
        senderWithStale.staleProcessing === 1,
      senderStaleReclaimed:
        staleTakeover.outcome === "acquired" &&
        staleTakeover.attemptCount === 2 &&
        staleTakeoverCompleted &&
        senderAfterStaleRecovery.status === "healthy" &&
        senderAfterStaleRecovery.processing === 0 &&
        senderAfterStaleRecovery.staleProcessing === 0 &&
        senderAfterStaleRecovery.completed === 3,
      staleSenderOwnerFenced: staleOwnerFenced,
      exactFourOutboundAttempts: captured.length === 4,
      identifiersExcluded:
        !serializedPayloads.includes(fixtureId) && !serializedPayloads.includes(circuitKey),
      storagePathsExcluded: !serializedPayloads.includes("dispute-evidence/"),
      leaseTokensExcluded:
        !serializedPayloads.includes("lease_token") &&
        !serializedPayloads.includes("lease_expires_at") &&
        !serializedPayloads.includes("claim_id"),
      secretsExcluded: !serializedPayloads.includes(secret),
      realNetworkNotCalled: true,
    };
    const passed = Object.values(checks).filter(Boolean).length;
    result = {
      schemaVersion: "dispute-evidence-scan-retry-alert-fixture-v1",
      status: passed === Object.keys(checks).length ? "pass" : "fail",
      totals: { passed, total: Object.keys(checks).length },
      checks,
      execution: {
        concurrentSenders: 20,
        incidentDeliveries: delivered,
        senderDuplicatesSuppressed: suppressed,
        concurrentReceivers: 20,
        receiverWinners,
        receiverReplaysBlocked: receiverReplayBlocked,
        recoveryDeliveries: recovery.status === "recovered" ? 1 : 0,
        retentionDeliveries: retentionDelivery.status === "delivered" ? 1 : 0,
        failedDeliveryAttempts: failedIncident.status === "failed" ? 1 : 0,
        senderBackoffBlocks: backoffRun.status === "skipped" ? 1 : 0,
        senderRetryAttemptCount: senderAfterIncident.maxAttemptCount,
        retryCrossedCooldownBucket: true,
        immutableSnapshots: senderAfterRecovery.snapshotCount,
        lostResponseReceiverAccepted,
        staleSenderClaims: senderWithStale.staleProcessing,
        staleSenderReclaims: staleTakeover.outcome === "acquired" ? 1 : 0,
        circuitFailures: circuitConfig.failureThreshold,
        circuitProbes: 1,
        outboundAttempts: captured.length,
        injectedTransport: true,
        realNetworkCalled: false,
        databaseChanged: true,
      },
      containsIdentifiers: false,
      containsStoragePaths: false,
      containsLeaseTokens: false,
      containsSecrets: false,
    };
  } finally {
    const circuitRows = (await db.execute(sql`
      DELETE FROM dispute_evidence_scanner_circuits
       WHERE circuit_key = ${circuitKey}
      RETURNING circuit_key
    `)) as unknown as Array<{ circuit_key: string }>;
    circuitCleanup = circuitRows.length;
    snapshotCleanup = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL haggle.allow_test_fixture_cleanup = 'on'`);
      const rows = (await tx.execute(sql`
        DELETE FROM dispute_evidence_scan_retry_alert_snapshots
         WHERE source = ${source}
        RETURNING id
      `)) as unknown as Array<{ id: string }>;
      return rows.length;
    });
    const senderRows = (await db.execute(sql`
      DELETE FROM webhook_idempotency WHERE source = ${source} RETURNING id
    `)) as unknown as Array<{ id: string }>;
    senderClaimCleanup = senderRows.length;
    const receiverRows = (await db.execute(sql`
      DELETE FROM webhook_idempotency WHERE source = ${receiverSource}
      RETURNING id
    `)) as unknown as Array<{ id: string }>;
    receiverClaimCleanup = receiverRows.length;
  }
  if (!result) {
    throw new Error("DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_FIXTURE_RESULT_MISSING");
  }
  if (
    circuitCleanup !== 1 ||
    senderClaimCleanup !== 3 ||
    receiverClaimCleanup !== 3 ||
    snapshotCleanup !== 2
  ) {
    throw Object.assign(new Error("DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_FIXTURE_CLEANUP_FAILED"), {
      diagnostics: {
        circuitCleanup,
        senderClaimCleanup,
        receiverClaimCleanup,
        snapshotCleanup,
      },
    });
  }
  return {
    ...result,
    cleanup: {
      circuitRows: circuitCleanup,
      senderClaims: senderClaimCleanup,
      receiverClaims: receiverClaimCleanup,
      snapshots: snapshotCleanup,
      succeeded: true,
    },
  };
}
