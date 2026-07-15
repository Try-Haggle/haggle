import { assertDisputeModuleOutboundUrl } from "./dispute-module-outbound-url.service.js";
import type { DisputeEvidenceSimilarityReviewHealth } from "./dispute-record.service.js";
import { signWebhookClaimAlertPayload } from "./webhook-claim-alert.service.js";

export interface DisputeSimilarityReviewAlertConfig {
  url: string;
  secret: string;
  timeoutMs: number;
  cooldownMinutes: number;
  overdueThreshold: number;
  expiredThreshold: number;
  slaMinutes: number;
  dueSoonMinutes: number;
  allowInsecureHttp: boolean;
  allowPrivateNetwork: boolean;
}

function boundedInteger(raw: string | undefined, fallback: number, min: number, max: number) {
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

export function getDisputeSimilarityReviewAlertPolicyStatus() {
  const url = process.env.DISPUTE_SIMILARITY_REVIEW_ALERT_URL ?? "";
  const secret = process.env.DISPUTE_SIMILARITY_REVIEW_ALERT_SECRET ?? "";
  const allowInsecureHttp =
    process.env.DISPUTE_SIMILARITY_REVIEW_ALERT_ALLOW_INSECURE_HTTP === "true";
  const allowPrivateNetwork =
    process.env.DISPUTE_SIMILARITY_REVIEW_ALERT_ALLOW_PRIVATE_NETWORK === "true";
  let configurationStatus: "not_configured" | "partial" | "invalid" | "valid" = "not_configured";
  if (url || secret) {
    if (!url || secret.length < 16) configurationStatus = "partial";
    else {
      try {
        assertDisputeModuleOutboundUrl(url, {
          label: "dispute similarity review alert",
          allowInsecureHttp,
          allowPrivateNetwork,
        });
        configurationStatus = "valid";
      } catch {
        configurationStatus = "invalid";
      }
    }
  }
  return {
    configured: configurationStatus === "valid",
    configurationStatus,
    jobEnabled: process.env.ENABLE_DISPUTE_SIMILARITY_REVIEW_ALERT_JOB === "true",
    cooldownMinutes: boundedInteger(
      process.env.DISPUTE_SIMILARITY_REVIEW_ALERT_COOLDOWN_MINUTES,
      15,
      1,
      1440,
    ),
    overdueThreshold: boundedInteger(
      process.env.DISPUTE_SIMILARITY_REVIEW_ALERT_OVERDUE_THRESHOLD,
      1,
      1,
      100_000,
    ),
    expiredThreshold: boundedInteger(
      process.env.DISPUTE_SIMILARITY_REVIEW_ALERT_EXPIRED_THRESHOLD,
      1,
      1,
      100_000,
    ),
    slaMinutes: boundedInteger(process.env.DISPUTE_SIMILARITY_REVIEW_SLA_MINUTES, 15, 1, 1440),
    dueSoonMinutes: boundedInteger(
      process.env.DISPUTE_SIMILARITY_REVIEW_DUE_SOON_MINUTES,
      60,
      1,
      1440,
    ),
  };
}

export function resolveDisputeSimilarityReviewAlertConfigFromEnv(): DisputeSimilarityReviewAlertConfig | null {
  const url = process.env.DISPUTE_SIMILARITY_REVIEW_ALERT_URL;
  if (!url) return null;
  const secret = process.env.DISPUTE_SIMILARITY_REVIEW_ALERT_SECRET ?? "";
  if (secret.length < 16)
    throw new Error("dispute similarity review alert secret must be at least 16 characters");
  const policy = getDisputeSimilarityReviewAlertPolicyStatus();
  const config = {
    url,
    secret,
    timeoutMs: boundedInteger(
      process.env.DISPUTE_SIMILARITY_REVIEW_ALERT_TIMEOUT_MS,
      5000,
      250,
      30_000,
    ),
    ...policy,
    allowInsecureHttp: process.env.DISPUTE_SIMILARITY_REVIEW_ALERT_ALLOW_INSECURE_HTTP === "true",
    allowPrivateNetwork:
      process.env.DISPUTE_SIMILARITY_REVIEW_ALERT_ALLOW_PRIVATE_NETWORK === "true",
  };
  assertDisputeModuleOutboundUrl(config.url, {
    label: "dispute similarity review alert",
    allowInsecureHttp: config.allowInsecureHttp,
    allowPrivateNetwork: config.allowPrivateNetwork,
  });
  return config;
}

export function evaluateDisputeSimilarityReviewAlert(
  health: DisputeEvidenceSimilarityReviewHealth,
  policy: Pick<DisputeSimilarityReviewAlertConfig, "overdueThreshold" | "expiredThreshold">,
) {
  const reasons = [
    ...(health.overdueSla >= policy.overdueThreshold ? ["similarity_review_sla_overdue"] : []),
    ...(health.expiredUnresolved >= policy.expiredThreshold
      ? ["similarity_review_expired_unresolved"]
      : []),
  ];
  return {
    wouldAlert: reasons.length > 0,
    severity: reasons.includes("similarity_review_expired_unresolved")
      ? ("critical" as const)
      : reasons.length
        ? ("warning" as const)
        : null,
    reasons,
  };
}

export async function sendDisputeSimilarityReviewAlert(
  health: DisputeEvidenceSimilarityReviewHealth,
  assessment: ReturnType<typeof evaluateDisputeSimilarityReviewAlert>,
  options: { config: DisputeSimilarityReviewAlertConfig; fetchImpl?: typeof fetch; now?: Date },
) {
  assertDisputeModuleOutboundUrl(options.config.url, {
    label: "dispute similarity review alert",
    allowInsecureHttp: options.config.allowInsecureHttp,
    allowPrivateNetwork: options.config.allowPrivateNetwork,
  });
  const timestamp = (options.now ?? new Date()).toISOString();
  const rawBody = JSON.stringify({
    type: "dispute_similarity_review.health",
    created_at: timestamp,
    severity: assessment.severity,
    reasons: assessment.reasons,
    health,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.config.timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(options.config.url, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-haggle-alert-type": "dispute_similarity_review.health",
        "x-haggle-alert-timestamp": timestamp,
        "x-haggle-alert-signature": signWebhookClaimAlertPayload(
          options.config.secret,
          timestamp,
          rawBody,
        ),
      },
      body: rawBody,
    });
    return {
      status: response.ok ? ("delivered" as const) : ("failed" as const),
      httpStatus: response.status,
    };
  } catch (error) {
    return {
      status: "failed" as const,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}
