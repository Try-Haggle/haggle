import { createHash } from "node:crypto";
import type { Database } from "@haggle/db";
import {
  claimWebhookEvent,
  completeWebhookEvent,
  failWebhookEvent,
  getWebhookClaimHealth,
  webhookPayloadSha256,
} from "../services/webhook-event-claim.service.js";
import {
  evaluateWebhookClaimAlert,
  findLatestDeliveredWebhookClaimIncident,
  resolveWebhookClaimAlertConfigFromEnv,
  sendWebhookClaimAlert,
  WEBHOOK_CLAIM_ALERT_SOURCE,
  type WebhookClaimAlertConfig,
} from "../services/webhook-claim-alert.service.js";
import type { WebhookClaimHealth } from "../services/webhook-event-claim.service.js";

export async function runWebhookClaimHealthAlert(
  db: Database,
  options: { now?: Date; fetchImpl?: typeof fetch; config?: WebhookClaimAlertConfig; claimSource?: string;
    collectHealth?: (db: Database) => Promise<WebhookClaimHealth> } = {},
) {
  const config = options.config ?? resolveWebhookClaimAlertConfigFromEnv();
  if (!config) return { status: "skipped" as const, reason: "not_configured" as const };
  const now = options.now ?? new Date();
  const claimSource = options.claimSource ?? WEBHOOK_CLAIM_ALERT_SOURCE;
  const health = await (options.collectHealth ?? getWebhookClaimHealth)(db);
  const assessment = evaluateWebhookClaimAlert(health, config);
  if (!assessment.wouldAlert) {
    const incident = await findLatestDeliveredWebhookClaimIncident(db, claimSource);
    if (!incident) return { status: "skipped" as const, reason: "healthy_no_delivered_incident" as const, health, assessment };
    const recoveryKey = `recovered:${incident.eventId}`;
    const claim = await claimWebhookEvent(db, { source: claimSource,
      eventId: `recovery_${createHash("sha256").update(recoveryKey).digest("hex")}`,
      payloadSha256: webhookPayloadSha256(recoveryKey) });
    if (claim.outcome !== "acquired") return { status: "skipped" as const,
      reason: "recovery_already_sent_or_in_progress" as const, health, assessment };
    const recoveryAssessment = { wouldAlert: true, severity: "recovery" as const, reasons: ["webhook_claim_recovered"] };
    try {
      const alert = await sendWebhookClaimAlert(health, recoveryAssessment,
        { config, deliveryId: claim.eventId, fetchImpl: options.fetchImpl, now });
      if (alert.status === "delivered") {
        await completeWebhookEvent(db, claim, alert.httpStatus ?? 200);
        return { status: "recovered" as const, health, assessment: recoveryAssessment, alert };
      }
      await failWebhookEvent(db, claim);
      return { status: "failed" as const, phase: "recovery" as const, health, assessment: recoveryAssessment, alert };
    } catch (error) { await failWebhookEvent(db, claim); throw error; }
  }

  const cooldownBucket = Math.floor(now.getTime() / (config.cooldownMinutes * 60_000));
  const cooldownKey = `${assessment.severity}:${[...assessment.reasons].sort().join(",")}:${cooldownBucket}`;
  const eventId = `health_${createHash("sha256").update(cooldownKey).digest("hex")}`;
  const payloadSha256 = webhookPayloadSha256(cooldownKey);
  const claim = await claimWebhookEvent(db, { source: claimSource, eventId, payloadSha256 });
  if (claim.outcome !== "acquired") {
    return { status: "skipped" as const, reason: "cooldown_or_in_progress" as const, health, assessment };
  }

  try {
    const alert = await sendWebhookClaimAlert(health, assessment, { config, deliveryId: claim.eventId, fetchImpl: options.fetchImpl, now });
    if (alert.status === "delivered") {
      await completeWebhookEvent(db, claim, alert.httpStatus ?? 200);
      console.log(`[webhook-claim-health-alert] delivered severity=${assessment.severity} reasons=${assessment.reasons.join(",")}`);
      return { status: "delivered" as const, health, assessment, alert };
    }
    await failWebhookEvent(db, claim);
    console.error(`[webhook-claim-health-alert] delivery failed status=${alert.httpStatus ?? "none"}`);
    return { status: "failed" as const, health, assessment, alert };
  } catch (error) {
    await failWebhookEvent(db, claim);
    throw error;
  }
}
