import { sql, type Database } from "@haggle/db";
import { assertDisputeModuleOutboundUrl } from "./dispute-module-outbound-url.service.js";
import { signWebhookClaimAlertPayload } from "./webhook-claim-alert.service.js";
import type { ConditionalSettlementPreflightResult } from "./conditional-settlement-preflight.service.js";
import { getWebhookEventClaimLeaseSeconds } from "./webhook-event-claim.service.js";

export const CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_SOURCE = "haggle-conditional-settlement-preflight-alert";

export interface ConditionalSettlementPreflightAlertSnapshot extends ConditionalSettlementPreflightResult {
  probe_skipped: boolean;
  config_blocked_by: string[];
}

export interface ConditionalSettlementPreflightAlertConfig {
  url: string;
  secret: string;
  timeoutMs: number;
  cooldownMinutes: number;
  allowInsecureHttp: boolean;
  allowPrivateNetwork: boolean;
}

export interface ConditionalSettlementPreflightAlertAssessment {
  wouldAlert: boolean;
  severity: "critical" | "recovery" | null;
  reasons: string[];
}

const CLAIM_LEASE_SAFETY_MARGIN_MS = 5000;

function strictBoundedInteger(raw: string | undefined, fallback: number, min: number, max: number, label: string): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}`);
  }
  return value;
}

export function getConditionalSettlementPreflightAlertTimingPolicy(timeoutMs: number) {
  const claimLeaseSeconds = getWebhookEventClaimLeaseSeconds();
  const maxSafeTimeoutMs = Math.min(30_000, claimLeaseSeconds * 1000 - CLAIM_LEASE_SAFETY_MARGIN_MS);
  return { timeoutMs, claimLeaseSeconds, maxSafeTimeoutMs, safetyMarginMs: CLAIM_LEASE_SAFETY_MARGIN_MS,
    timingSafe: timeoutMs <= maxSafeTimeoutMs };
}

export function assertConditionalSettlementPreflightAlertTimingSafe(timeoutMs: number): void {
  const timing = getConditionalSettlementPreflightAlertTimingPolicy(timeoutMs);
  if (!timing.timingSafe) {
    throw new Error(`conditional settlement preflight alert timeout must be <= ${timing.maxSafeTimeoutMs}ms for the ${timing.claimLeaseSeconds}s claim lease`);
  }
}

function boundedInteger(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

export function getConditionalSettlementPreflightAlertPolicyStatus() {
  const url = process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_URL?.trim();
  const secret = process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_SECRET ?? "";
  let configurationState: "not_configured" | "partial" | "valid" | "invalid" = !url && !secret
    ? "not_configured"
    : !url || secret.length < 16 ? "partial" : "valid";
  const allowInsecureHttp = process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_ALLOW_INSECURE_HTTP === "true";
  const allowPrivateNetwork = process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_ALLOW_PRIVATE_NETWORK === "true";
  let timeoutInputValid = true;
  let timeoutMs: number;
  try {
    timeoutMs = strictBoundedInteger(process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_TIMEOUT_MS, 5000, 250, 30_000,
      "conditional settlement preflight alert timeout");
  } catch {
    timeoutInputValid = false;
    timeoutMs = boundedInteger(process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_TIMEOUT_MS, 5000, 250, 30_000);
  }
  const timing = getConditionalSettlementPreflightAlertTimingPolicy(timeoutMs);
  const timingSafe = timeoutInputValid && timing.timingSafe;
  if (configurationState === "valid" && url) {
    try {
      assertDisputeModuleOutboundUrl(url, {
        label: "conditional settlement preflight alert",
        allowInsecureHttp,
        allowPrivateNetwork,
      });
      if (!timingSafe) throw new Error("unsafe conditional settlement preflight alert timing");
    } catch {
      configurationState = "invalid";
    }
  }
  return {
    configured: configurationState === "valid",
    configurationState,
    jobEnabled: process.env.ENABLE_CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_JOB === "true",
    cooldownMinutes: boundedInteger(process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_COOLDOWN_MINUTES, 15, 1, 1440),
    ...timing,
    timingSafe,
  };
}

export function resolveConditionalSettlementPreflightAlertConfigFromEnv(): ConditionalSettlementPreflightAlertConfig | null {
  const url = process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_URL?.trim();
  if (!url) return null;
  const secret = process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_SECRET ?? "";
  if (secret.length < 16) throw new Error("conditional settlement preflight alert secret must be at least 16 characters");
  const timeoutMs = strictBoundedInteger(process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_TIMEOUT_MS, 5000, 250, 30_000,
    "conditional settlement preflight alert timeout");
  assertConditionalSettlementPreflightAlertTimingSafe(timeoutMs);
  const config = {
    url,
    secret,
    timeoutMs,
    cooldownMinutes: boundedInteger(process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_COOLDOWN_MINUTES, 15, 1, 1440),
    allowInsecureHttp: process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_ALLOW_INSECURE_HTTP === "true",
    allowPrivateNetwork: process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_ALLOW_PRIVATE_NETWORK === "true",
  };
  assertDisputeModuleOutboundUrl(config.url, {
    label: "conditional settlement preflight alert",
    allowInsecureHttp: config.allowInsecureHttp,
    allowPrivateNetwork: config.allowPrivateNetwork,
  });
  return config;
}

export function evaluateConditionalSettlementPreflightAlert(
  snapshot: ConditionalSettlementPreflightAlertSnapshot,
): ConditionalSettlementPreflightAlertAssessment {
  const evaluateLiveChecks = !snapshot.probe_skipped && !snapshot.error_code;
  const reasons = [
    ...snapshot.config_blocked_by.map((reason) => `config_${reason}`),
    ...(snapshot.error_code === "RPC_TIMEOUT" ? ["rpc_timeout"] : []),
    ...(snapshot.error_code === "RPC_UNAVAILABLE" ? ["rpc_unavailable"] : []),
    ...(evaluateLiveChecks && !snapshot.checks.rpc_reachable ? ["rpc_unreachable"] : []),
    ...(evaluateLiveChecks && snapshot.checks.rpc_reachable && !snapshot.checks.chain_id_match ? ["chain_id_mismatch"] : []),
    ...(evaluateLiveChecks && !snapshot.checks.settlement_bytecode ? ["settlement_bytecode_missing"] : []),
    ...(evaluateLiveChecks && !snapshot.checks.usdc_bytecode ? ["usdc_bytecode_missing"] : []),
    ...(evaluateLiveChecks && snapshot.checks.settlement_bytecode && !snapshot.checks.signer_matches ? ["signer_mismatch"] : []),
    ...(evaluateLiveChecks && snapshot.checks.settlement_bytecode && !snapshot.checks.usdc_allowed ? ["usdc_not_allowed"] : []),
  ];
  const uniqueReasons = [...new Set(reasons)].sort();
  return {
    wouldAlert: uniqueReasons.length > 0,
    severity: uniqueReasons.length > 0 ? "critical" : null,
    reasons: uniqueReasons,
  };
}

export async function findLatestDeliveredConditionalSettlementPreflightIncident(
  db: Database,
  source = CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_SOURCE,
) {
  const rows = await db.execute(sql`
    SELECT idempotency_key AS event_id, completed_at
      FROM webhook_idempotency
     WHERE source = ${source} AND status = 'COMPLETED' AND left(idempotency_key, 7) = 'health_'
     ORDER BY completed_at DESC, id DESC LIMIT 1
  `) as unknown as Array<{ event_id: string; completed_at: Date | string }>;
  return rows[0] ? { eventId: rows[0].event_id, completedAt: new Date(rows[0].completed_at).toISOString() } : null;
}

export async function getConditionalSettlementPreflightAlertDeliveryState(
  db: Database,
  source = CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_SOURCE,
) {
  if (typeof (db as { execute?: unknown }).execute !== "function") {
    return { incidentOpen: false, lastIncidentAlertAt: null, lastRecoveryAlertAt: null };
  }
  const rows = await db.execute(sql`
    SELECT max(completed_at) FILTER (WHERE left(idempotency_key, 7) = 'health_') AS last_incident_at,
           max(completed_at) FILTER (WHERE left(idempotency_key, 9) = 'recovery_') AS last_recovery_at
      FROM webhook_idempotency
     WHERE source = ${source} AND status = 'COMPLETED'
  `) as unknown as Array<{ last_incident_at: Date | string | null; last_recovery_at: Date | string | null }>;
  const incident = rows[0]?.last_incident_at ? new Date(rows[0].last_incident_at) : null;
  const recovery = rows[0]?.last_recovery_at ? new Date(rows[0].last_recovery_at) : null;
  return {
    incidentOpen: Boolean(incident && (!recovery || recovery < incident)),
    lastIncidentAlertAt: incident?.toISOString() ?? null,
    lastRecoveryAlertAt: recovery?.toISOString() ?? null,
  };
}

export async function sendConditionalSettlementPreflightAlert(
  snapshot: ConditionalSettlementPreflightAlertSnapshot,
  assessment: ConditionalSettlementPreflightAlertAssessment,
  options: {
    config: ConditionalSettlementPreflightAlertConfig;
    deliveryId: string;
    fetchImpl?: typeof fetch;
    now?: Date;
  },
) {
  assertConditionalSettlementPreflightAlertTimingSafe(options.config.timeoutMs);
  if (!/^(?:health|recovery)_[0-9a-f]{64}$/.test(options.deliveryId)) {
    throw new Error("invalid conditional settlement preflight alert delivery id");
  }
  assertDisputeModuleOutboundUrl(options.config.url, {
    label: "conditional settlement preflight alert",
    allowInsecureHttp: options.config.allowInsecureHttp,
    allowPrivateNetwork: options.config.allowPrivateNetwork,
  });
  const timestamp = (options.now ?? new Date()).toISOString();
  const rawBody = JSON.stringify({
    type: "conditional_settlement_preflight.health",
    delivery_id: options.deliveryId,
    state: assessment.severity === "recovery" ? "recovered" : "firing",
    created_at: timestamp,
    severity: assessment.severity,
    reasons: assessment.reasons,
    health: snapshot,
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
        "x-haggle-alert-type": "conditional_settlement_preflight.health",
        "x-haggle-alert-delivery-id": options.deliveryId,
        "x-haggle-alert-timestamp": timestamp,
        "x-haggle-alert-signature": signWebhookClaimAlertPayload(options.config.secret, timestamp, rawBody),
      },
      body: rawBody,
    });
    return { status: response.ok ? "delivered" as const : "failed" as const, httpStatus: response.status };
  } catch (error) {
    return { status: "failed" as const, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}
