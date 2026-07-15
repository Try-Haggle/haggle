import { createHash } from "node:crypto";
import type { Database } from "@haggle/db";
import { getDisputeEvidenceSimilarityReviewHealth } from "../services/dispute-record.service.js";
import {
  evaluateDisputeSimilarityReviewAlert,
  resolveDisputeSimilarityReviewAlertConfigFromEnv,
  sendDisputeSimilarityReviewAlert,
} from "../services/dispute-similarity-review-alert.service.js";
import {
  claimWebhookEvent,
  completeWebhookEvent,
  failWebhookEvent,
  webhookPayloadSha256,
} from "../services/webhook-event-claim.service.js";

const ALERT_SOURCE = "haggle-dispute-similarity-review-alert";

export async function runDisputeSimilarityReviewAlert(
  db: Database,
  options: { now?: Date; fetchImpl?: typeof fetch } = {},
) {
  const config = resolveDisputeSimilarityReviewAlertConfigFromEnv();
  if (!config) return { status: "skipped" as const, reason: "not_configured" as const };
  const now = options.now ?? new Date();
  const health = await getDisputeEvidenceSimilarityReviewHealth(db, {
    now,
    slaMinutes: config.slaMinutes,
    dueSoonMinutes: config.dueSoonMinutes,
  });
  const assessment = evaluateDisputeSimilarityReviewAlert(health, config);
  if (!assessment.wouldAlert)
    return { status: "skipped" as const, reason: "healthy" as const, health, assessment };
  const bucket = Math.floor(now.getTime() / (config.cooldownMinutes * 60_000));
  const cooldownKey = `${assessment.severity}:${[...assessment.reasons].sort().join(",")}:${bucket}`;
  const eventId = `health_${createHash("sha256").update(cooldownKey).digest("hex")}`;
  const claim = await claimWebhookEvent(db, {
    source: ALERT_SOURCE,
    eventId,
    payloadSha256: webhookPayloadSha256(cooldownKey),
  });
  if (claim.outcome !== "acquired") {
    return {
      status: "skipped" as const,
      reason: "cooldown_or_in_progress" as const,
      health,
      assessment,
    };
  }
  try {
    const alert = await sendDisputeSimilarityReviewAlert(health, assessment, {
      config,
      fetchImpl: options.fetchImpl,
      now,
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
