import { createHash } from "node:crypto";
import type { Database } from "@haggle/db";
import {
  getShipmentApvChaosFailureHealth,
  SHIPMENT_APV_CHAOS_FAILURE_POLICY_VERSION,
} from
  "./shipment-apv-chaos-failure-metric.service.js";

export const SHIPMENT_APV_FAILURE_ALERT_PREVIEW_VERSION =
  "shipment-apv-chaos-failure-alert-preview-v1";
export const SHIPMENT_APV_FAILURE_ALERT_PREVIEW_TTL_SECONDS = 5;
export const SHIPMENT_APV_FAILURE_ALERT_COOLDOWN_MINUTES = 15;

type FailureHealth = Awaited<ReturnType<typeof getShipmentApvChaosFailureHealth>>;

const ACTIVE_REASONS = new Set([
  "rollback_verification_warning",
  "rollback_verification_critical",
  "rollback_failure_isolation_warning",
  "rollback_failure_isolation_critical",
  "fixture_execution_warning",
  "fixture_execution_critical",
]);

function publicStateFingerprint(input: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export function evaluateShipmentApvChaosFailureAlertPreview(health: FailureHealth) {
  const lifecycle = health.lifecycle;
  const activeReasons = health.policy.reasons.filter((reason) => ACTIVE_REASONS.has(reason));
  if (health.policy.version !== SHIPMENT_APV_CHAOS_FAILURE_POLICY_VERSION
    || activeReasons.length !== health.policy.reasons.length
    || (lifecycle.phase === "active" && health.status !== "healthy"
      && activeReasons.length === 0)) {
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_PREVIEW_POLICY_UNAVAILABLE");
  }
  let action: "none" | "review_warning" | "escalate_critical" | "review_recovery" = "none";
  let severity: "healthy" | "warning" | "critical" = "healthy";
  let reasons: string[] = [];

  if (lifecycle.phase === "active" && health.status === "critical") {
    action = "escalate_critical";
    severity = "critical";
    reasons = activeReasons;
  } else if (lifecycle.phase === "active" && health.status === "warning") {
    action = "review_warning";
    severity = "warning";
    reasons = activeReasons;
  } else if (lifecycle.phase === "recovered" && lifecycle.warningObservedAt) {
    action = "review_recovery";
    severity = lifecycle.criticalObservedAt ? "critical" : "warning";
    reasons = [lifecycle.criticalObservedAt
      ? "recovered_from_critical" : "recovered_from_warning"];
  }

  const fingerprintInput = {
    schemaVersion: SHIPMENT_APV_FAILURE_ALERT_PREVIEW_VERSION,
    action,
    severity,
    reasons,
    counts: Object.fromEntries(Object.entries(health.stages)
      .map(([stage, value]) => [stage, value.count])),
    lifecycle: {
      phase: lifecycle.phase,
      firstObservedAt: lifecycle.firstObservedAt,
      warningObservedAt: lifecycle.warningObservedAt,
      criticalObservedAt: lifecycle.criticalObservedAt,
      recoveredAt: lifecycle.recoveredAt,
      lastFailureAt: lifecycle.lastFailureAt,
    },
  };
  const actionable = action !== "none";
  return {
    schemaVersion: SHIPMENT_APV_FAILURE_ALERT_PREVIEW_VERSION,
    mode: "preview_only" as const,
    action,
    severity,
    reasons,
    stateFingerprint: publicStateFingerprint(fingerprintInput),
    validForSeconds: SHIPMENT_APV_FAILURE_ALERT_PREVIEW_TTL_SECONDS,
    approval: {
      required: actionable,
      state: actionable ? "not_requested" as const : "not_required" as const,
    },
    delivery: { enabled: false, attempted: false },
    cooldown: {
      windowMinutes: SHIPMENT_APV_FAILURE_ALERT_COOLDOWN_MINUTES,
      scope: "state_fingerprint" as const,
      enforced: false,
    },
    lifecycle,
    recordedAt: health.recordedAt,
  };
}

export async function getShipmentApvChaosFailureAlertPreview(
  db: Pick<Database, "execute">,
  now = new Date(),
) {
  return evaluateShipmentApvChaosFailureAlertPreview(
    await getShipmentApvChaosFailureHealth(db, now));
}
