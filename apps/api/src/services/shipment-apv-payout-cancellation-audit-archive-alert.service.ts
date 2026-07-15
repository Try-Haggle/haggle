import { assertDisputeModuleOutboundUrl } from "./dispute-module-outbound-url.service.js";
import type { ShipmentApvCancellationAuditArchiveHealth } from "./shipment-apv-payout-cancellation-audit-archive.service.js";
import { signWebhookClaimAlertPayload } from "./webhook-claim-alert.service.js";

export interface ShipmentApvCancellationAuditArchiveAlertConfig {
  url: string;
  secret: string;
  timeoutMs: number;
  cooldownMinutes: number;
  staleThreshold: number;
  retryReadyThreshold: number;
  deadLetterThreshold: number;
  overdueUnfinishedThreshold: number;
  allowInsecureHttp: boolean;
  allowPrivateNetwork: boolean;
}

function boundedInteger(raw: string | undefined, fallback: number, min: number, max: number) {
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

export function getShipmentApvCancellationAuditArchiveAlertPolicyStatus() {
  const url = process.env.HAGGLE_AUDIT_ARCHIVE_ALERT_URL?.trim();
  const secret = process.env.HAGGLE_AUDIT_ARCHIVE_ALERT_SECRET ?? "";
  let configurationState: "not_configured" | "partial" | "valid" | "invalid" =
    !url && !secret ? "not_configured" : !url || secret.length < 16 ? "partial" : "valid";
  if (configurationState === "valid" && url) {
    try {
      assertDisputeModuleOutboundUrl(url, {
        label: "audit archive alert",
        allowInsecureHttp: process.env.HAGGLE_AUDIT_ARCHIVE_ALERT_ALLOW_INSECURE_HTTP === "true",
        allowPrivateNetwork:
          process.env.HAGGLE_AUDIT_ARCHIVE_ALERT_ALLOW_PRIVATE_NETWORK === "true",
      });
    } catch {
      configurationState = "invalid";
    }
  }
  return {
    configured: configurationState === "valid",
    configurationState,
    jobEnabled: process.env.ENABLE_SHIPMENT_APV_CANCELLATION_AUDIT_ARCHIVE_ALERT_JOB === "true",
    cooldownMinutes: boundedInteger(
      process.env.HAGGLE_AUDIT_ARCHIVE_ALERT_COOLDOWN_MINUTES,
      15,
      1,
      1440,
    ),
    staleThreshold: boundedInteger(
      process.env.HAGGLE_AUDIT_ARCHIVE_ALERT_STALE_THRESHOLD,
      1,
      1,
      100_000,
    ),
    retryReadyThreshold: boundedInteger(
      process.env.HAGGLE_AUDIT_ARCHIVE_ALERT_RETRY_READY_THRESHOLD,
      5,
      1,
      100_000,
    ),
    deadLetterThreshold: boundedInteger(
      process.env.HAGGLE_AUDIT_ARCHIVE_ALERT_DEAD_LETTER_THRESHOLD,
      1,
      1,
      100_000,
    ),
    overdueUnfinishedThreshold: boundedInteger(
      process.env.HAGGLE_AUDIT_ARCHIVE_ALERT_OVERDUE_UNFINISHED_THRESHOLD,
      1,
      1,
      100_000,
    ),
  };
}

export function resolveShipmentApvCancellationAuditArchiveAlertConfigFromEnv(): ShipmentApvCancellationAuditArchiveAlertConfig | null {
  const url = process.env.HAGGLE_AUDIT_ARCHIVE_ALERT_URL?.trim();
  if (!url) return null;
  const secret = process.env.HAGGLE_AUDIT_ARCHIVE_ALERT_SECRET ?? "";
  if (secret.length < 16)
    throw new Error("audit archive alert secret must be at least 16 characters");
  const policy = getShipmentApvCancellationAuditArchiveAlertPolicyStatus();
  const config = {
    url,
    secret,
    timeoutMs: boundedInteger(process.env.HAGGLE_AUDIT_ARCHIVE_ALERT_TIMEOUT_MS, 5000, 250, 30_000),
    cooldownMinutes: policy.cooldownMinutes,
    staleThreshold: policy.staleThreshold,
    retryReadyThreshold: policy.retryReadyThreshold,
    deadLetterThreshold: policy.deadLetterThreshold,
    overdueUnfinishedThreshold: policy.overdueUnfinishedThreshold,
    allowInsecureHttp: process.env.HAGGLE_AUDIT_ARCHIVE_ALERT_ALLOW_INSECURE_HTTP === "true",
    allowPrivateNetwork: process.env.HAGGLE_AUDIT_ARCHIVE_ALERT_ALLOW_PRIVATE_NETWORK === "true",
  };
  assertDisputeModuleOutboundUrl(config.url, {
    label: "audit archive alert",
    allowInsecureHttp: config.allowInsecureHttp,
    allowPrivateNetwork: config.allowPrivateNetwork,
  });
  return config;
}

export function evaluateShipmentApvCancellationAuditArchiveAlert(
  health: ShipmentApvCancellationAuditArchiveHealth,
  policy: Pick<
    ShipmentApvCancellationAuditArchiveAlertConfig,
    "staleThreshold" | "retryReadyThreshold" | "deadLetterThreshold" | "overdueUnfinishedThreshold"
  >,
) {
  const reasons = [
    ...(health.deadLetter >= policy.deadLetterThreshold ? ["audit_archive_dead_letter"] : []),
    ...(health.staleProcessing >= policy.staleThreshold ? ["audit_archive_stale_processing"] : []),
    ...(health.retryReady >= policy.retryReadyThreshold
      ? ["audit_archive_retry_ready_backlog"]
      : []),
    ...(health.overdueUnfinished >= policy.overdueUnfinishedThreshold
      ? ["audit_archive_unfinished_too_old"]
      : []),
  ];
  return {
    wouldAlert: reasons.length > 0,
    severity: reasons.includes("audit_archive_dead_letter")
      ? ("critical" as const)
      : reasons.length
        ? ("warning" as const)
        : null,
    reasons,
  };
}

export async function sendShipmentApvCancellationAuditArchiveAlert(
  health: ShipmentApvCancellationAuditArchiveHealth,
  assessment: ReturnType<typeof evaluateShipmentApvCancellationAuditArchiveAlert>,
  options: {
    config: ShipmentApvCancellationAuditArchiveAlertConfig;
    fetchImpl?: typeof fetch;
    now?: Date;
  },
) {
  assertDisputeModuleOutboundUrl(options.config.url, {
    label: "audit archive alert",
    allowInsecureHttp: options.config.allowInsecureHttp,
    allowPrivateNetwork: options.config.allowPrivateNetwork,
  });
  const timestamp = (options.now ?? new Date()).toISOString();
  const rawBody = JSON.stringify({
    type: "shipment_apv_cancellation_audit_archive.health",
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
        "x-haggle-alert-type": "shipment_apv_cancellation_audit_archive.health",
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
