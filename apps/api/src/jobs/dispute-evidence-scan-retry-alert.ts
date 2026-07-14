import { createHash } from "node:crypto";
import type { Database } from "@haggle/db";
import {
  DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_SOURCE,
  createDisputeEvidenceScanRetryAlertSnapshot,
  evaluateDisputeEvidenceScanRetryAlert,
  findLatestDeliveredDisputeEvidenceScanRetryIncident,
  findRetryableDisputeEvidenceScanRetryAlertSnapshot,
  hasRecentDeliveredDisputeEvidenceScanRetryIncident,
  persistDisputeEvidenceScanRetryAlertSnapshot,
  resolveDisputeEvidenceScanRetryAlertConfigFromEnv,
  sendDisputeEvidenceScanRetryAlert,
  type DisputeEvidenceScanRetryAlertConfig,
} from "../services/dispute-evidence-scan-retry-alert.service.js";
import { getDisputeEvidenceScanRetryHealth } from
  "../services/dispute-evidence-scan-retry.service.js";
import { getDisputeEvidenceScannerCircuitHealth } from
  "../services/dispute-evidence-scanner-circuit.service.js";
import { getDisputeEvidenceScanRetryAlertSnapshotRetentionHealth } from
  "../services/dispute-evidence-scan-retry-alert-snapshot-retention.service.js";
import { getDisputeEvidenceScanRetryAlertSnapshotRetentionJobHealth } from
  "./dispute-evidence-scan-retry-alert-snapshot-retention.js";
import {
  claimWebhookEvent,
  completeWebhookEvent,
  failWebhookEvent,
} from "../services/webhook-event-claim.service.js";

export async function runDisputeEvidenceScanRetryAlert(
  db: Database,
  options: {
    now?: Date;
    fetchImpl?: typeof fetch;
    config?: DisputeEvidenceScanRetryAlertConfig;
    claimSource?: string;
    circuitKey?: string;
  } = {},
) {
  const config = options.config
    ?? resolveDisputeEvidenceScanRetryAlertConfigFromEnv();
  if (!config) {
    return { status: "skipped" as const, reason: "not_configured" as const };
  }
  const now = options.now ?? new Date();
  const claimSource = options.claimSource
    ?? DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_SOURCE;
  const [health, circuit, retention, retentionJob] = await Promise.all([
    getDisputeEvidenceScanRetryHealth(db, { now }),
    getDisputeEvidenceScannerCircuitHealth(db, {
      now, circuitKey: options.circuitKey,
    }),
    getDisputeEvidenceScanRetryAlertSnapshotRetentionHealth(db),
    getDisputeEvidenceScanRetryAlertSnapshotRetentionJobHealth(db, now),
  ]);
  const assessment = evaluateDisputeEvidenceScanRetryAlert(
    health, circuit, config, retention, retentionJob,
  );

  const retryable = await findRetryableDisputeEvidenceScanRetryAlertSnapshot(
    db, claimSource,
  );
  if (retryable) {
    const claim = await claimWebhookEvent(db, {
      source: claimSource,
      eventId: retryable.snapshot.delivery_id,
      payloadSha256: retryable.payloadSha256,
    });
    if (claim.outcome !== "acquired") {
      const reason = claim.outcome === "retry_later"
        ? "snapshot_retry_backoff" as const
        : claim.outcome === "payload_conflict"
          ? "snapshot_claim_payload_conflict" as const
          : "snapshot_already_sent_or_in_progress" as const;
      return { status: "skipped" as const, reason, health, circuit };
    }
    const snapshotAssessment = {
      wouldAlert: true,
      severity: retryable.snapshot.severity,
      reasons: retryable.snapshot.reasons,
    };
    try {
      const alert = await sendDisputeEvidenceScanRetryAlert(
        health, circuit, snapshotAssessment,
        {
          config,
          deliveryId: retryable.snapshot.delivery_id,
          snapshot: retryable.snapshot,
          retention,
          retentionJob,
          fetchImpl: options.fetchImpl,
          now,
        },
      );
      if (alert.status === "delivered") {
        await completeWebhookEvent(db, claim, alert.httpStatus ?? 200);
        return {
          status: "retried" as const,
          phase: retryable.snapshot.state === "firing"
            ? "incident" as const : "recovery" as const,
          health,
          circuit,
          assessment: snapshotAssessment,
          alert,
          attemptCount: claim.attemptCount,
        };
      }
      await failWebhookEvent(db, claim);
      return {
        status: "failed" as const,
        phase: "snapshot_retry" as const,
        health,
        circuit,
        assessment: snapshotAssessment,
        alert,
      };
    } catch (error) {
      await failWebhookEvent(db, claim);
      throw error;
    }
  }

  if (!assessment.wouldAlert) {
    const incident = await findLatestDeliveredDisputeEvidenceScanRetryIncident(
      db, claimSource,
    );
    if (!incident) {
      return {
        status: "skipped" as const,
        reason: "healthy_no_delivered_incident" as const,
        health,
        circuit,
        assessment,
      };
    }
    const recoveryKey = `recovered:${incident.eventId}`;
    const deliveryId = `recovery_${createHash("sha256")
      .update(recoveryKey).digest("hex")}`;
    const recoveryAssessment = {
      wouldAlert: true,
      severity: "recovery" as const,
      reasons: ["scanner_scan_retry_and_retention_recovered"],
    };
    const snapshot = createDisputeEvidenceScanRetryAlertSnapshot(
      health, circuit, recoveryAssessment, config, deliveryId,
      retention, retentionJob,
    );
    const persisted = await persistDisputeEvidenceScanRetryAlertSnapshot(
      db, claimSource, snapshot,
    );
    const claim = await claimWebhookEvent(db, {
      source: claimSource,
      eventId: deliveryId,
      payloadSha256: persisted.payloadSha256,
    });
    if (claim.outcome !== "acquired") {
      const reason = claim.outcome === "retry_later"
        ? "recovery_retry_backoff" as const
        : claim.outcome === "payload_conflict"
          ? "recovery_claim_payload_conflict" as const
          : "recovery_already_sent_or_in_progress" as const;
      return {
        status: "skipped" as const,
        reason,
        health,
        circuit,
        assessment,
      };
    }
    try {
      const alert = await sendDisputeEvidenceScanRetryAlert(
        health, circuit, recoveryAssessment,
        {
          config,
          deliveryId: claim.eventId,
          snapshot: persisted.snapshot,
          retention,
          retentionJob,
          fetchImpl: options.fetchImpl,
          now,
        },
      );
      if (alert.status === "delivered") {
        await completeWebhookEvent(db, claim, alert.httpStatus ?? 200);
        return {
          status: "recovered" as const,
          health,
          circuit,
          assessment: recoveryAssessment,
          alert,
        };
      }
      await failWebhookEvent(db, claim);
      return {
        status: "failed" as const,
        phase: "recovery" as const,
        health,
        circuit,
        assessment: recoveryAssessment,
        alert,
      };
    } catch (error) {
      await failWebhookEvent(db, claim);
      throw error;
    }
  }

  if (await hasRecentDeliveredDisputeEvidenceScanRetryIncident(
    db, claimSource, config.cooldownMinutes,
  )) {
    return {
      status: "skipped" as const,
      reason: "recent_incident_cooldown" as const,
      health,
      circuit,
      assessment,
    };
  }

  const bucket = Math.floor(
    now.getTime() / (config.cooldownMinutes * 60_000),
  );
  const cooldownKey = [assessment.severity,
    ...[...assessment.reasons].sort(), String(bucket)].join(":");
  const deliveryId = `health_${createHash("sha256")
    .update(cooldownKey).digest("hex")}`;
  const snapshot = createDisputeEvidenceScanRetryAlertSnapshot(
    health, circuit, assessment, config, deliveryId,
    retention, retentionJob,
  );
  const persisted = await persistDisputeEvidenceScanRetryAlertSnapshot(
    db, claimSource, snapshot,
  );
  const claim = await claimWebhookEvent(db, {
    source: claimSource,
    eventId: deliveryId,
    payloadSha256: persisted.payloadSha256,
  });
  if (claim.outcome !== "acquired") {
    const reason = claim.outcome === "retry_later"
      ? "delivery_retry_backoff" as const
      : claim.outcome === "payload_conflict"
        ? "delivery_claim_payload_conflict" as const
        : "cooldown_or_in_progress" as const;
    return {
      status: "skipped" as const,
      reason,
      health,
      circuit,
      assessment,
    };
  }
  try {
    const alert = await sendDisputeEvidenceScanRetryAlert(
      health, circuit, assessment,
      {
        config,
        deliveryId: claim.eventId,
        snapshot: persisted.snapshot,
        retention,
        retentionJob,
        fetchImpl: options.fetchImpl,
        now,
      },
    );
    if (alert.status === "delivered") {
      await completeWebhookEvent(db, claim, alert.httpStatus ?? 200);
      return {
        status: "delivered" as const, health, circuit, assessment, alert,
      };
    }
    await failWebhookEvent(db, claim);
    return { status: "failed" as const, health, circuit, assessment, alert };
  } catch (error) {
    await failWebhookEvent(db, claim);
    throw error;
  }
}

export async function runDisputeEvidenceScanRetryAlertJob(db: Database) {
  const result = await runDisputeEvidenceScanRetryAlert(db);
  console.log(
    `[dispute-evidence-scan-retry-alert] status=${result.status}`,
  );
  return result;
}
