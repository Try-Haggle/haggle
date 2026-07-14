import { type Database, sql } from "@haggle/db";
import type { ConditionalSettlementFinalityHealth } from "./conditional-settlement-finality-health.service.js";
import { assertDisputeModuleOutboundUrl } from "./dispute-module-outbound-url.service.js";
import { signWebhookClaimAlertPayload } from "./webhook-claim-alert.service.js";
import { getWebhookEventClaimLeaseSeconds } from "./webhook-event-claim.service.js";

export const CONDITIONAL_SETTLEMENT_FINALITY_ALERT_SOURCE =
  "haggle-conditional-settlement-finality-alert";
const CLAIM_LEASE_SAFETY_MARGIN_MS = 5000;

export interface ConditionalSettlementFinalityAlertConfig {
  url: string;
  secret: string;
  timeoutMs: number;
  cooldownMinutes: number;
  allowInsecureHttp: boolean;
  allowPrivateNetwork: boolean;
}

export interface ConditionalSettlementFinalityAlertAssessment {
  wouldAlert: boolean;
  severity: "warning" | "critical" | "recovery" | null;
  reasons: string[];
}

function boundedInteger(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

function strictInteger(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
  label: string,
): number {
  if (!raw?.trim()) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`${label} must be ${min}..${max}`);
  return value;
}

export function assertConditionalSettlementFinalityAlertTimingSafe(timeoutMs: number) {
  const claimLeaseSeconds = getWebhookEventClaimLeaseSeconds();
  const maxSafeTimeoutMs = Math.min(
    30_000,
    claimLeaseSeconds * 1000 - CLAIM_LEASE_SAFETY_MARGIN_MS,
  );
  if (timeoutMs > maxSafeTimeoutMs)
    throw new Error(`finality alert timeout must be <= ${maxSafeTimeoutMs}ms`);
  return {
    timeoutMs,
    claimLeaseSeconds,
    maxSafeTimeoutMs,
    safetyMarginMs: CLAIM_LEASE_SAFETY_MARGIN_MS,
    timingSafe: true,
  };
}

export function getConditionalSettlementFinalityAlertPolicyStatus() {
  const url = process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_URL?.trim();
  const secret = process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_SECRET ?? "";
  let configurationState: "not_configured" | "partial" | "valid" | "invalid" =
    !url && !secret ? "not_configured" : !url || secret.length < 16 ? "partial" : "valid";
  let timeoutMs = 5000;
  let timingSafe = true;
  try {
    timeoutMs = strictInteger(
      process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_TIMEOUT_MS,
      5000,
      250,
      30_000,
      "finality alert timeout",
    );
    assertConditionalSettlementFinalityAlertTimingSafe(timeoutMs);
  } catch {
    timingSafe = false;
    configurationState = configurationState === "not_configured" ? configurationState : "invalid";
  }
  if (configurationState === "valid" && url) {
    try {
      assertDisputeModuleOutboundUrl(url, {
        label: "conditional settlement finality alert",
        allowInsecureHttp:
          process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_ALLOW_INSECURE_HTTP === "true",
        allowPrivateNetwork:
          process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_ALLOW_PRIVATE_NETWORK === "true",
      });
    } catch {
      configurationState = "invalid";
    }
  }
  return {
    configured: configurationState === "valid",
    configurationState,
    jobEnabled: process.env.ENABLE_CONDITIONAL_SETTLEMENT_FINALITY_ALERT_JOB === "true",
    cooldownMinutes: boundedInteger(
      process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_COOLDOWN_MINUTES,
      15,
      1,
      1440,
    ),
    timeoutMs,
    claimLeaseSeconds: getWebhookEventClaimLeaseSeconds(),
    timingSafe,
  };
}

export function resolveConditionalSettlementFinalityAlertConfigFromEnv(): ConditionalSettlementFinalityAlertConfig | null {
  const url = process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_URL?.trim();
  if (!url) return null;
  const secret = process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_SECRET ?? "";
  if (secret.length < 16) throw new Error("finality alert secret must be at least 16 characters");
  const timeoutMs = strictInteger(
    process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_TIMEOUT_MS,
    5000,
    250,
    30_000,
    "finality alert timeout",
  );
  assertConditionalSettlementFinalityAlertTimingSafe(timeoutMs);
  const config = {
    url,
    secret,
    timeoutMs,
    cooldownMinutes: boundedInteger(
      process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_COOLDOWN_MINUTES,
      15,
      1,
      1440,
    ),
    allowInsecureHttp:
      process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_ALLOW_INSECURE_HTTP === "true",
    allowPrivateNetwork:
      process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_ALLOW_PRIVATE_NETWORK === "true",
  };
  assertDisputeModuleOutboundUrl(url, {
    label: "conditional settlement finality alert",
    allowInsecureHttp: config.allowInsecureHttp,
    allowPrivateNetwork: config.allowPrivateNetwork,
  });
  return config;
}

export function evaluateConditionalSettlementFinalityAlert(
  health: ConditionalSettlementFinalityHealth,
): ConditionalSettlementFinalityAlertAssessment {
  const reasons = [
    ...(health.orphanedReceipts > 0 ? ["orphaned_receipt"] : []),
    ...(health.rpcUnavailable > 0 ? ["rpc_unavailable"] : []),
    ...(health.configurationBlocked > 0 ? ["configuration_blocked"] : []),
    ...(health.overduePending > 0 ? ["confirmation_sla_overdue"] : []),
  ].sort();
  return {
    wouldAlert: reasons.length > 0,
    severity: reasons.includes("orphaned_receipt") ? "critical" : reasons.length ? "warning" : null,
    reasons,
  };
}

export async function findLatestDeliveredConditionalSettlementFinalityIncident(
  db: Database,
  source = CONDITIONAL_SETTLEMENT_FINALITY_ALERT_SOURCE,
) {
  const rows =
    (await db.execute(sql`SELECT idempotency_key AS event_id, completed_at FROM webhook_idempotency
    WHERE source = ${source} AND status = 'COMPLETED' AND left(idempotency_key, 7) = 'health_'
    ORDER BY completed_at DESC, id DESC LIMIT 1`)) as unknown as Array<{
      event_id: string;
      completed_at: Date | string;
    }>;
  return rows[0]
    ? { eventId: rows[0].event_id, completedAt: new Date(rows[0].completed_at).toISOString() }
    : null;
}

export async function getConditionalSettlementFinalityAlertDeliveryState(
  db: Database,
  source = CONDITIONAL_SETTLEMENT_FINALITY_ALERT_SOURCE,
) {
  const rows = (await db.execute(sql`SELECT
    max(completed_at) FILTER (WHERE left(idempotency_key, 7) = 'health_') AS last_incident_at,
    max(completed_at) FILTER (WHERE left(idempotency_key, 9) = 'recovery_') AS last_recovery_at
    FROM webhook_idempotency WHERE source = ${source} AND status = 'COMPLETED'`)) as unknown as Array<
    Record<string, Date | string | null>
  >;
  const incident = rows[0]?.last_incident_at ? new Date(rows[0].last_incident_at) : null;
  const recovery = rows[0]?.last_recovery_at ? new Date(rows[0].last_recovery_at) : null;
  return {
    incidentOpen: Boolean(incident && (!recovery || recovery < incident)),
    lastIncidentAlertAt: incident?.toISOString() ?? null,
    lastRecoveryAlertAt: recovery?.toISOString() ?? null,
  };
}

export async function sendConditionalSettlementFinalityAlert(
  health: ConditionalSettlementFinalityHealth,
  assessment: ConditionalSettlementFinalityAlertAssessment,
  options: {
    config: ConditionalSettlementFinalityAlertConfig;
    deliveryId: string;
    fetchImpl?: typeof fetch;
    now?: Date;
  },
) {
  assertConditionalSettlementFinalityAlertTimingSafe(options.config.timeoutMs);
  if (!/^(?:health|recovery)_[0-9a-f]{64}$/.test(options.deliveryId))
    throw new Error("invalid finality alert delivery id");
  assertDisputeModuleOutboundUrl(options.config.url, {
    label: "conditional settlement finality alert",
    allowInsecureHttp: options.config.allowInsecureHttp,
    allowPrivateNetwork: options.config.allowPrivateNetwork,
  });
  const timestamp = (options.now ?? new Date()).toISOString();
  const rawBody = JSON.stringify({
    type: "conditional_settlement_finality.health",
    delivery_id: options.deliveryId,
    state: assessment.severity === "recovery" ? "recovered" : "firing",
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
        "x-haggle-alert-type": "conditional_settlement_finality.health",
        "x-haggle-alert-delivery-id": options.deliveryId,
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
  } catch {
    return { status: "failed" as const, error: "request_failed" as const };
  } finally {
    clearTimeout(timeout);
  }
}
