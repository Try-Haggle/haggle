import { createHash } from "node:crypto";
import type { Database } from "@haggle/db";
import { getDisputeSimilarityReviewAuditArchiveHealth } from "../services/dispute-similarity-review-audit-archive.service.js";
import {
  evaluateDisputeSimilarityReviewAuditArchiveAlert,
  findLatestDeliveredDisputeSimilarityReviewAuditArchiveIncident,
  resolveDisputeSimilarityReviewAuditArchiveAlertConfigFromEnv,
  sendDisputeSimilarityReviewAuditArchiveAlert,
  DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_SOURCE,
  type DisputeSimilarityReviewAuditArchiveAlertConfig,
} from "../services/dispute-similarity-review-audit-archive-alert.service.js";
import { claimWebhookEvent, completeWebhookEvent, failWebhookEvent, webhookPayloadSha256 } from "../services/webhook-event-claim.service.js";

export async function runDisputeSimilarityReviewAuditArchiveAlert(db: Database, options: {
  now?: Date;
  fetchImpl?: typeof fetch;
  config?: DisputeSimilarityReviewAuditArchiveAlertConfig;
  claimSource?: string;
} = {}) {
  const config = options.config ?? resolveDisputeSimilarityReviewAuditArchiveAlertConfigFromEnv();
  if (!config) return { status: "skipped" as const, reason: "not_configured" as const };
  const claimSource = options.claimSource ?? DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_SOURCE;
  const now = options.now ?? new Date();
  const health = await getDisputeSimilarityReviewAuditArchiveHealth(db, now);
  const assessment = evaluateDisputeSimilarityReviewAuditArchiveAlert(health, config);
  if (!assessment.wouldAlert) {
    const incident = await findLatestDeliveredDisputeSimilarityReviewAuditArchiveIncident(db, claimSource);
    if (!incident) return { status: "skipped" as const, reason: "healthy_no_delivered_incident" as const, health, assessment };
    const recoveryKey = `recovered:${incident.eventId}`;
    const claim = await claimWebhookEvent(db, {
      source: claimSource,
      eventId: `recovery_${createHash("sha256").update(recoveryKey).digest("hex")}`,
      payloadSha256: webhookPayloadSha256(recoveryKey),
    });
    if (claim.outcome !== "acquired") return { status: "skipped" as const, reason: "recovery_already_sent_or_in_progress" as const, health, assessment };
    const recoveryAssessment = { wouldAlert: true, severity: "recovery" as const, reasons: ["similarity_audit_archive_recovered"] };
    try {
      const alert = await sendDisputeSimilarityReviewAuditArchiveAlert(health, recoveryAssessment, {
        config, deliveryId: claim.eventId, fetchImpl: options.fetchImpl, now,
      });
      if (alert.status === "delivered") {
        await completeWebhookEvent(db, claim, alert.httpStatus ?? 200);
        return { status: "recovered" as const, health, assessment: recoveryAssessment, alert };
      }
      await failWebhookEvent(db, claim);
      return { status: "failed" as const, phase: "recovery" as const, health, assessment: recoveryAssessment, alert };
    } catch (error) {
      await failWebhookEvent(db, claim);
      throw error;
    }
  }
  const bucket = Math.floor(now.getTime() / (config.cooldownMinutes * 60_000));
  const cooldownKey = `${assessment.severity}:${[...assessment.reasons].sort().join(",")}:${bucket}`;
  const claim = await claimWebhookEvent(db, {
    source: claimSource,
    eventId: `health_${createHash("sha256").update(cooldownKey).digest("hex")}`,
    payloadSha256: webhookPayloadSha256(cooldownKey),
  });
  if (claim.outcome !== "acquired") return { status: "skipped" as const, reason: "cooldown_or_in_progress" as const, health, assessment };
  try {
    const alert = await sendDisputeSimilarityReviewAuditArchiveAlert(health, assessment, {
      config, deliveryId: claim.eventId, fetchImpl: options.fetchImpl, now,
    });
    if (alert.status === "delivered") {
      await completeWebhookEvent(db, claim, alert.httpStatus ?? 200);
      return { status: "delivered" as const, health, assessment, alert };
    }
    await failWebhookEvent(db, claim);
    return { status: "failed" as const, health, assessment, alert };
  } catch (error) {
    await failWebhookEvent(db, claim);
    throw error;
  }
}
