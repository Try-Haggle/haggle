import { createHash } from "node:crypto";
import type { Database } from "@haggle/db";
import {
  getShipmentApvFailureAlertReceiverManifestArchiveIntentHealth,
  SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_FRESHNESS_SLA_SECONDS,
  SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_HEALTH_SCHEMA_VERSION,
} from
  "./shipment-apv-chaos-failure-alert-receiver-manifest-archive-intent-health.service.js";

export const SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_ALERT_PREVIEW_VERSION =
  "shipment-apv-failure-alert-receiver-manifest-archive-alert-preview-v1";
export const SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_ALERT_PREVIEW_TTL_SECONDS =
  5;

type ArchiveHealth = Awaited<ReturnType<
  typeof getShipmentApvFailureAlertReceiverManifestArchiveIntentHealth>>;

const VIOLATION_REASONS = [
  ["binding", "archive_intent_binding_violation"],
  ["blockers", "archive_intent_blocker_violation"],
  ["unsafeSideEffect", "archive_intent_side_effect_violation"],
  ["timestamp", "archive_intent_timestamp_violation"],
  ["sourceLimit", "archive_source_limit_violation"],
] as const;

function invalid() {
  throw new Error(
    "SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_ALERT_PREVIEW_HEALTH_INVALID");
}

function count(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid();
  return Number(value);
}

function optionalCount(value: unknown) {
  return value === null ? null : count(value);
}

function validateHealth(health: ArchiveHealth) {
  if (health.schemaVersion
      !== SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_HEALTH_SCHEMA_VERSION
    || health.containsRawIdentifiers !== false
    || health.httpRequestCreated !== false
    || health.networkDelivered !== false
    || health.externalReceiptVerified !== false
    || health.productionAccepted !== false
    || !Number.isFinite(Date.parse(health.observedAt))) invalid();

  const totals = {
    intents: count(health.totals.intents),
    latestReceiptRevision: optionalCount(health.totals.latestReceiptRevision),
    latestIntentRevision: optionalCount(health.totals.latestIntentRevision),
    currentSourceEntries: count(health.totals.currentSourceEntries),
  };
  const violations = {
    binding: count(health.violations.binding),
    blockers: count(health.violations.blockers),
    unsafeSideEffect: count(health.violations.unsafeSideEffect),
    timestamp: count(health.violations.timestamp),
    sourceLimit: count(health.violations.sourceLimit),
  };
  const criticalCount = Object.values(violations)
    .reduce((sum, value) => sum + value, 0);
  const age = optionalCount(health.freshness.latestIntentAgeSeconds);
  const stale = age !== null
    && age > SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_FRESHNESS_SLA_SECONDS;
  const covered = health.coverage.currentReceiptIntentCovered;
  if (typeof covered !== "boolean"
    || health.coverage.missingCurrentArchiveIntent !== !covered
    || health.freshness.slaSeconds
      !== SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_FRESHNESS_SLA_SECONDS
    || health.freshness.stale !== stale
    || health.criticalCount !== criticalCount
    || violations.sourceLimit !== (totals.currentSourceEntries > 1000 ? 1 : 0)
    || (covered && (totals.latestReceiptRevision === null
      || totals.latestIntentRevision !== totals.latestReceiptRevision))
    || (!covered && totals.latestIntentRevision !== null)) invalid();

  const expectedStatus = criticalCount > 0 ? "critical"
    : !covered || stale ? "warning" : "healthy";
  if (health.status !== expectedStatus) invalid();
  return { totals, violations, criticalCount, covered, age, stale };
}

function fingerprint(value: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function evaluateShipmentApvFailureAlertReceiverManifestArchiveAlertPreview(
  health: ArchiveHealth,
) {
  const checked = validateHealth(health);
  const reasons: string[] = [];
  for (const [key, reason] of VIOLATION_REASONS) {
    if (checked.violations[key] > 0) reasons.push(reason);
  }
  if (!checked.covered) reasons.push("current_archive_intent_missing");
  if (checked.stale) reasons.push("archive_intent_stale");

  const action = health.status === "critical" ? "escalate_critical" as const
    : health.status === "warning" ? "review_warning" as const : "none" as const;
  const actionable = action !== "none";
  const state = {
    schemaVersion:
      SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_ALERT_PREVIEW_VERSION,
    action,
    severity: health.status,
    reasons,
    totals: checked.totals,
    violations: checked.violations,
    coverage: { currentReceiptIntentCovered: checked.covered },
    freshness: {
      slaSeconds:
        SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_FRESHNESS_SLA_SECONDS,
      stale: checked.stale,
    },
  };

  return {
    schemaVersion:
      SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_ALERT_PREVIEW_VERSION,
    mode: "preview_only" as const,
    action,
    severity: health.status,
    reasons,
    stateFingerprint: fingerprint(state),
    validForSeconds:
      SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_ALERT_PREVIEW_TTL_SECONDS,
    approval: {
      required: actionable,
      state: actionable ? "not_requested" as const : "not_required" as const,
    },
    delivery: {
      endpointConfigured: false,
      enabled: false,
      attempted: false,
      networkDelivered: false,
      externalReceiptVerified: false,
      productionAccepted: false,
    },
    payload: { created: false, signed: false },
    health: {
      status: health.status,
      totals: checked.totals,
      violations: checked.violations,
      criticalCount: checked.criticalCount,
      coverage: {
        currentReceiptIntentCovered: checked.covered,
        missingCurrentArchiveIntent: !checked.covered,
      },
      freshness: {
        slaSeconds:
          SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_FRESHNESS_SLA_SECONDS,
        latestIntentAgeSeconds: checked.age,
        stale: checked.stale,
      },
    },
    containsRawIdentifiers: false,
    observedAt: health.observedAt,
  };
}

export async function getShipmentApvFailureAlertReceiverManifestArchiveAlertPreview(
  db: Pick<Database, "execute">,
) {
  return evaluateShipmentApvFailureAlertReceiverManifestArchiveAlertPreview(
    await getShipmentApvFailureAlertReceiverManifestArchiveIntentHealth(db));
}
