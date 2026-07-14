import { sql, type Database } from "@haggle/db";

export const SHIPMENT_APV_CHAOS_FAILURE_STAGES = [
  "rollback_verification",
  "rollback_failure_isolation",
  "fixture_execution",
] as const;

export type ShipmentApvChaosFailureStage = typeof SHIPMENT_APV_CHAOS_FAILURE_STAGES[number];

export const SHIPMENT_APV_CHAOS_FAILURE_THRESHOLDS = {
  rollback_verification: { warning: 1, critical: 3 },
  rollback_failure_isolation: { warning: 1, critical: 3 },
  fixture_execution: { warning: 3, critical: 10 },
} as const;
export const SHIPMENT_APV_CHAOS_FAILURE_POLICY_VERSION = "shipment-apv-chaos-failure-policy-v1";

type StageCountMap = Record<ShipmentApvChaosFailureStage, number>;

const MAX_METRIC_COUNT = 2_147_483_647;

function boundedCount(value: unknown) {
  const count = Number(value ?? 0);
  if (!Number.isFinite(count) || count <= 0) return 0;
  return Math.min(Math.trunc(count), MAX_METRIC_COUNT);
}

function isoTimestamp(value: unknown) {
  if (!value) return null;
  const timestamp = new Date(String(value));
  return Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : null;
}

export function evaluateShipmentApvChaosFailurePolicy(counts: StageCountMap) {
  const criticalReasons: string[] = [];
  const warningReasons: string[] = [];
  for (const stage of SHIPMENT_APV_CHAOS_FAILURE_STAGES) {
    const count = boundedCount(counts[stage]);
    const threshold = SHIPMENT_APV_CHAOS_FAILURE_THRESHOLDS[stage];
    if (count >= threshold.critical) criticalReasons.push(`${stage}_critical`);
    else if (count >= threshold.warning) warningReasons.push(`${stage}_warning`);
  }
  const status = criticalReasons.length > 0 ? "critical"
    : warningReasons.length > 0 ? "warning" : "healthy";
  return { status, reasons: [...criticalReasons, ...warningReasons],
    version: SHIPMENT_APV_CHAOS_FAILURE_POLICY_VERSION,
    thresholds: SHIPMENT_APV_CHAOS_FAILURE_THRESHOLDS };
}

export async function recordShipmentApvChaosFailure(
  db: Pick<Database, "execute">,
  input: { stage: ShipmentApvChaosFailureStage; now?: Date },
) {
  if (!SHIPMENT_APV_CHAOS_FAILURE_STAGES.includes(input.stage)) {
    throw new Error("INVALID_SHIPMENT_APV_CHAOS_FAILURE_STAGE");
  }
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const thresholds = SHIPMENT_APV_CHAOS_FAILURE_THRESHOLDS[input.stage];
  const warningOnFirstFailure = thresholds.warning === 1 ? nowIso : null;
  const criticalOnFirstFailure = null;
  await db.execute(sql`WITH recorded AS (
      INSERT INTO shipment_apv_chaos_failure_metrics
        (bucket_start, stage, failure_count, first_failure_at, warning_observed_at,
          critical_observed_at, last_failure_at)
      VALUES (date_trunc('hour', ${nowIso}::timestamptz), ${input.stage}, 1,
        ${nowIso}::timestamptz, ${warningOnFirstFailure}::timestamptz,
        ${criticalOnFirstFailure}::timestamptz, ${nowIso}::timestamptz)
      ON CONFLICT (bucket_start, stage) DO UPDATE SET
        failure_count = least(shipment_apv_chaos_failure_metrics.failure_count + 1, 2147483647),
        first_failure_at = LEAST(shipment_apv_chaos_failure_metrics.first_failure_at,
          EXCLUDED.first_failure_at),
        warning_observed_at = COALESCE(
          shipment_apv_chaos_failure_metrics.warning_observed_at,
          CASE WHEN shipment_apv_chaos_failure_metrics.failure_count + 1 >= ${thresholds.warning}
            THEN GREATEST(shipment_apv_chaos_failure_metrics.first_failure_at,
              EXCLUDED.last_failure_at) END),
        critical_observed_at = COALESCE(
          shipment_apv_chaos_failure_metrics.critical_observed_at,
          CASE WHEN shipment_apv_chaos_failure_metrics.failure_count + 1 >= ${thresholds.critical}
            THEN GREATEST(
              COALESCE(shipment_apv_chaos_failure_metrics.warning_observed_at,
                shipment_apv_chaos_failure_metrics.first_failure_at),
              EXCLUDED.last_failure_at) END),
        last_failure_at = GREATEST(
          shipment_apv_chaos_failure_metrics.last_failure_at, EXCLUDED.last_failure_at)
      RETURNING 1
    )
    DELETE FROM shipment_apv_chaos_failure_metrics
    WHERE bucket_start < date_trunc('hour', ${nowIso}::timestamptz) - interval '30 days'
      AND EXISTS (SELECT 1 FROM recorded)`);
}

export async function getShipmentApvChaosFailureHealth(
  db: Pick<Database, "execute">,
  now = new Date(),
) {
  const rows = await db.execute(sql`SELECT stage,
      least(coalesce(sum(failure_count) FILTER (
        WHERE bucket_start >= date_trunc('hour', ${now.toISOString()}::timestamptz) - interval '23 hours'
      ), 0), 2147483647)::int AS failure_count,
      min(first_failure_at) FILTER (
        WHERE bucket_start >= date_trunc('hour', ${now.toISOString()}::timestamptz) - interval '23 hours'
      ) AS first_failure_at,
      min(warning_observed_at) FILTER (
        WHERE bucket_start >= date_trunc('hour', ${now.toISOString()}::timestamptz) - interval '23 hours'
      ) AS warning_observed_at,
      min(critical_observed_at) FILTER (
        WHERE bucket_start >= date_trunc('hour', ${now.toISOString()}::timestamptz) - interval '23 hours'
      ) AS critical_observed_at,
      max(last_failure_at) FILTER (
        WHERE bucket_start >= date_trunc('hour', ${now.toISOString()}::timestamptz) - interval '23 hours'
      ) AS last_failure_at,
      min(first_failure_at) AS retained_first_failure_at,
      min(warning_observed_at) AS retained_warning_observed_at,
      min(critical_observed_at) AS retained_critical_observed_at,
      max(bucket_start) AS retained_latest_bucket_start,
      max(last_failure_at) AS retained_last_failure_at
    FROM shipment_apv_chaos_failure_metrics
    WHERE bucket_start >= date_trunc('hour', ${now.toISOString()}::timestamptz) - interval '30 days'
    GROUP BY stage`);
  const byStage = new Map<string, Record<string, unknown>>();
  for (const row of rows as unknown as Array<Record<string, unknown>>) {
    if (SHIPMENT_APV_CHAOS_FAILURE_STAGES.includes(row.stage as ShipmentApvChaosFailureStage)) {
      byStage.set(String(row.stage), row);
    }
  }
  const stages = Object.fromEntries(SHIPMENT_APV_CHAOS_FAILURE_STAGES.map((stage) => {
    const row = byStage.get(stage);
    return [stage, { count: boundedCount(row?.failure_count),
      lastFailureAt: isoTimestamp(row?.last_failure_at) }];
  })) as Record<ShipmentApvChaosFailureStage, { count: number; lastFailureAt: string | null }>;
  const total = Math.min(SHIPMENT_APV_CHAOS_FAILURE_STAGES.reduce(
    (sum, stage) => sum + stages[stage].count, 0), MAX_METRIC_COUNT);
  const latest = SHIPMENT_APV_CHAOS_FAILURE_STAGES.map((stage) => stages[stage].lastFailureAt)
    .filter((value): value is string => value !== null).sort().at(-1) ?? null;
  const retainedRows = [...byStage.values()];
  const currentRows = retainedRows.filter((row) => boundedCount(row.failure_count) > 0);
  const lifecycleRows = total > 0 ? currentRows : retainedRows;
  const lifecycleField = (currentField: string, retainedField: string) =>
    total > 0 ? currentField : retainedField;
  const earliest = (field: string) => lifecycleRows.map((row) => isoTimestamp(row[field]))
    .filter((value): value is string => value !== null).sort().at(0) ?? null;
  const retainedLatestBucket = retainedRows.map((row) => isoTimestamp(row.retained_latest_bucket_start))
    .filter((value): value is string => value !== null).sort().at(-1) ?? null;
  const retainedLastFailure = retainedRows.map((row) => isoTimestamp(row.retained_last_failure_at))
    .filter((value): value is string => value !== null).sort().at(-1) ?? null;
  const policy = evaluateShipmentApvChaosFailurePolicy(Object.fromEntries(
    SHIPMENT_APV_CHAOS_FAILURE_STAGES.map((stage) => [stage, stages[stage].count]),
  ) as StageCountMap);
  return {
    status: policy.status,
    windowHours: 24,
    retentionDays: 30,
    total,
    stages,
    policy: { version: policy.version, reasons: policy.reasons, thresholds: policy.thresholds },
    lifecycle: {
      phase: total > 0 ? "active" : retainedLatestBucket ? "recovered" : "clear",
      firstObservedAt: earliest(lifecycleField("first_failure_at", "retained_first_failure_at")),
      warningObservedAt: earliest(lifecycleField(
        "warning_observed_at", "retained_warning_observed_at")),
      criticalObservedAt: earliest(lifecycleField(
        "critical_observed_at", "retained_critical_observed_at")),
      recoveredAt: total === 0 && retainedLatestBucket
        ? new Date(new Date(retainedLatestBucket).getTime() + 24 * 60 * 60_000).toISOString()
        : null,
      lastFailureAt: total > 0 ? latest : retainedLastFailure,
    },
    lastFailureAt: latest,
    recordedAt: now.toISOString(),
  };
}
