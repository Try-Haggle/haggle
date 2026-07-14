import { createHash } from "node:crypto";
import type { Database } from "@haggle/db";
import { getShipmentApvCancellationAuditArchiveHealth } from "../services/shipment-apv-payout-cancellation-audit-archive.service.js";
import { evaluateShipmentApvCancellationAuditArchiveAlert, resolveShipmentApvCancellationAuditArchiveAlertConfigFromEnv, sendShipmentApvCancellationAuditArchiveAlert } from "../services/shipment-apv-payout-cancellation-audit-archive-alert.service.js";
import { claimWebhookEvent, completeWebhookEvent, failWebhookEvent, webhookPayloadSha256 } from "../services/webhook-event-claim.service.js";

const ALERT_SOURCE = "haggle-shipment-apv-cancellation-audit-archive-alert";

export async function runShipmentApvCancellationAuditArchiveAlert(db: Database, options: { now?: Date; fetchImpl?: typeof fetch } = {}) {
  const config = resolveShipmentApvCancellationAuditArchiveAlertConfigFromEnv();
  if (!config) return { status: "skipped" as const, reason: "not_configured" as const };
  const now = options.now ?? new Date();
  const health = await getShipmentApvCancellationAuditArchiveHealth(db, now);
  const assessment = evaluateShipmentApvCancellationAuditArchiveAlert(health, config);
  if (!assessment.wouldAlert) return { status: "skipped" as const, reason: "healthy" as const, health, assessment };
  const bucket = Math.floor(now.getTime() / (config.cooldownMinutes * 60_000));
  const cooldownKey = `${assessment.severity}:${[...assessment.reasons].sort().join(",")}:${bucket}`;
  const claim = await claimWebhookEvent(db, { source: ALERT_SOURCE, eventId: `health_${createHash("sha256").update(cooldownKey).digest("hex")}`, payloadSha256: webhookPayloadSha256(cooldownKey) });
  if (claim.outcome !== "acquired") return { status: "skipped" as const, reason: "cooldown_or_in_progress" as const, health, assessment };
  try {
    const alert = await sendShipmentApvCancellationAuditArchiveAlert(health, assessment, { config, fetchImpl: options.fetchImpl, now });
    if (alert.status === "delivered") { await completeWebhookEvent(db, claim, alert.httpStatus ?? 200); return { status: "delivered" as const, health, assessment, alert }; }
    await failWebhookEvent(db, claim); return { status: "failed" as const, health, assessment, alert };
  } catch (error) { await failWebhookEvent(db, claim); throw error; }
}
