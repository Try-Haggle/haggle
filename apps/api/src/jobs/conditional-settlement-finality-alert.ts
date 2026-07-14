import { createHash } from "node:crypto";
import type { Database } from "@haggle/db";
import { getConditionalSettlementFinalityHealth, type ConditionalSettlementFinalityHealth } from "../services/conditional-settlement-finality-health.service.js";
import { claimWebhookEvent, completeWebhookEvent, failWebhookEvent, webhookPayloadSha256 } from "../services/webhook-event-claim.service.js";
import {
  CONDITIONAL_SETTLEMENT_FINALITY_ALERT_SOURCE, evaluateConditionalSettlementFinalityAlert,
  findLatestDeliveredConditionalSettlementFinalityIncident, resolveConditionalSettlementFinalityAlertConfigFromEnv,
  sendConditionalSettlementFinalityAlert, type ConditionalSettlementFinalityAlertConfig,
} from "../services/conditional-settlement-finality-alert.service.js";

export async function runConditionalSettlementFinalityAlert(db: Database, options: {
  now?: Date; fetchImpl?: typeof fetch; config?: ConditionalSettlementFinalityAlertConfig; claimSource?: string;
  collectHealth?: (db: Database, now: Date) => Promise<ConditionalSettlementFinalityHealth>;
} = {}) {
  const config = options.config ?? resolveConditionalSettlementFinalityAlertConfigFromEnv();
  if (!config) return { status: "skipped" as const, reason: "not_configured" as const };
  const now = options.now ?? new Date();
  const source = options.claimSource ?? CONDITIONAL_SETTLEMENT_FINALITY_ALERT_SOURCE;
  const health = await (options.collectHealth ?? getConditionalSettlementFinalityHealth)(db, now);
  const assessment = evaluateConditionalSettlementFinalityAlert(health);
  if (!assessment.wouldAlert) {
    const incident = await findLatestDeliveredConditionalSettlementFinalityIncident(db, source);
    if (!incident) return { status: "skipped" as const, reason: "healthy_no_delivered_incident" as const, health, assessment };
    const recoveryKey = `recovered:${incident.eventId}`;
    const claim = await claimWebhookEvent(db, { source, eventId: `recovery_${createHash("sha256").update(recoveryKey).digest("hex")}`,
      payloadSha256: webhookPayloadSha256(recoveryKey) });
    if (claim.outcome !== "acquired") {
      const reason = claim.outcome === "retry_later" ? "recovery_retry_backoff" as const
        : claim.outcome === "payload_conflict" ? "recovery_claim_payload_conflict" as const
          : "recovery_already_sent_or_in_progress" as const;
      return { status: "skipped" as const, reason, health, assessment };
    }
    const recovery = { wouldAlert: true, severity: "recovery" as const, reasons: ["conditional_settlement_finality_recovered"] };
    try {
      const alert = await sendConditionalSettlementFinalityAlert(health, recovery, { config, deliveryId: claim.eventId, fetchImpl: options.fetchImpl, now });
      if (alert.status === "delivered") { await completeWebhookEvent(db, claim, alert.httpStatus ?? 200); return { status: "recovered" as const, health, assessment: recovery, alert }; }
      await failWebhookEvent(db, claim); return { status: "failed" as const, phase: "recovery" as const, health, assessment: recovery, alert };
    } catch (error) { await failWebhookEvent(db, claim); throw error; }
  }
  const bucket = Math.floor(now.getTime() / (config.cooldownMinutes * 60_000));
  const key = `${assessment.severity}:${assessment.reasons.join(",")}:${bucket}`;
  const claim = await claimWebhookEvent(db, { source, eventId: `health_${createHash("sha256").update(key).digest("hex")}`,
    payloadSha256: webhookPayloadSha256(key) });
  if (claim.outcome !== "acquired") {
    const reason = claim.outcome === "retry_later" ? "delivery_retry_backoff" as const
      : claim.outcome === "payload_conflict" ? "delivery_claim_payload_conflict" as const : "cooldown_or_in_progress" as const;
    return { status: "skipped" as const, reason, health, assessment };
  }
  try {
    const alert = await sendConditionalSettlementFinalityAlert(health, assessment, { config, deliveryId: claim.eventId, fetchImpl: options.fetchImpl, now });
    if (alert.status === "delivered") { await completeWebhookEvent(db, claim, alert.httpStatus ?? 200); return { status: "delivered" as const, health, assessment, alert }; }
    await failWebhookEvent(db, claim); return { status: "failed" as const, health, assessment, alert };
  } catch (error) { await failWebhookEvent(db, claim); throw error; }
}
