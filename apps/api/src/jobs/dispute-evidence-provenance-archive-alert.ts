import { createHash } from "node:crypto";
import type { Database } from "@haggle/db";
import { getDisputeEvidenceProvenanceArchiveHealth } from "../services/dispute-evidence-provenance-archive.service.js";
import {
  DISPUTE_EVIDENCE_PROVENANCE_ARCHIVE_ALERT_SOURCE,
  evaluateDisputeEvidenceProvenanceArchiveAlert,
  findLatestDeliveredDisputeEvidenceProvenanceArchiveIncident,
  resolveDisputeEvidenceProvenanceArchiveAlertConfigFromEnv,
  sendDisputeEvidenceProvenanceArchiveAlert,
  type DisputeEvidenceProvenanceArchiveAlertConfig,
} from "../services/dispute-evidence-provenance-archive-alert.service.js";
import { claimWebhookEvent, completeWebhookEvent, failWebhookEvent, webhookPayloadSha256 } from "../services/webhook-event-claim.service.js";

export async function runDisputeEvidenceProvenanceArchiveAlert(db: Database, options: {
  now?: Date; fetchImpl?: typeof fetch; config?: DisputeEvidenceProvenanceArchiveAlertConfig; claimSource?: string;
} = {}) {
  const config = options.config ?? resolveDisputeEvidenceProvenanceArchiveAlertConfigFromEnv();
  if (!config) return { status: "skipped" as const, reason: "not_configured" as const };
  const claimSource = options.claimSource ?? DISPUTE_EVIDENCE_PROVENANCE_ARCHIVE_ALERT_SOURCE;
  const now = options.now ?? new Date();
  const health = await getDisputeEvidenceProvenanceArchiveHealth(db, now);
  const assessment = evaluateDisputeEvidenceProvenanceArchiveAlert(health, config);
  if (!assessment.wouldAlert) {
    const incident = await findLatestDeliveredDisputeEvidenceProvenanceArchiveIncident(db, claimSource);
    if (!incident) return { status: "skipped" as const, reason: "healthy_no_delivered_incident" as const, health, assessment };
    const recoveryKey = `recovered:${incident.eventId}`;
    const claim = await claimWebhookEvent(db, { source: claimSource,
      eventId: `recovery_${createHash("sha256").update(recoveryKey).digest("hex")}`,
      payloadSha256: webhookPayloadSha256(recoveryKey) });
    if (claim.outcome !== "acquired") return { status: "skipped" as const, reason: "recovery_already_sent_or_in_progress" as const, health, assessment };
    const recovery = { wouldAlert: true, severity: "recovery" as const, reasons: ["evidence_provenance_archive_recovered"] };
    try {
      const alert = await sendDisputeEvidenceProvenanceArchiveAlert(health, recovery, { config, deliveryId: claim.eventId, fetchImpl: options.fetchImpl, now });
      if (alert.status === "delivered") { await completeWebhookEvent(db, claim, alert.httpStatus ?? 200); return { status: "recovered" as const, health, assessment: recovery, alert }; }
      await failWebhookEvent(db, claim); return { status: "failed" as const, phase: "recovery" as const, health, assessment: recovery, alert };
    } catch (error) { await failWebhookEvent(db, claim); throw error; }
  }
  const bucket = Math.floor(now.getTime() / (config.cooldownMinutes * 60_000));
  const cooldownKey = `${assessment.severity}:${[...assessment.reasons].sort().join(",")}:${bucket}`;
  const claim = await claimWebhookEvent(db, { source: claimSource,
    eventId: `health_${createHash("sha256").update(cooldownKey).digest("hex")}`,
    payloadSha256: webhookPayloadSha256(cooldownKey) });
  if (claim.outcome !== "acquired") return { status: "skipped" as const, reason: "cooldown_or_in_progress" as const, health, assessment };
  try {
    const alert = await sendDisputeEvidenceProvenanceArchiveAlert(health, assessment, { config, deliveryId: claim.eventId, fetchImpl: options.fetchImpl, now });
    if (alert.status === "delivered") { await completeWebhookEvent(db, claim, alert.httpStatus ?? 200); return { status: "delivered" as const, health, assessment, alert }; }
    await failWebhookEvent(db, claim); return { status: "failed" as const, health, assessment, alert };
  } catch (error) { await failWebhookEvent(db, claim); throw error; }
}
