import { type Database, sql } from "@haggle/db";

export interface ConditionalSettlementFinalityHealth {
  status: "healthy" | "attention" | "critical";
  total: number;
  pending: number;
  unavailable: number;
  orphanedReceipts: number;
  rpcUnavailable: number;
  configurationBlocked: number;
  overduePending: number;
  oldestPendingAgeSeconds: number | null;
  pendingSlaSeconds: number;
  recordedAt: string;
}

export function getConditionalSettlementPendingSlaSeconds(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const value = Number(env.HAGGLE_CONDITIONAL_SETTLEMENT_PENDING_SLA_SECONDS);
  return Number.isInteger(value) && value >= 30 && value <= 3600 ? value : 120;
}

export async function getConditionalSettlementFinalityHealth(
  db: Database,
  now = new Date(),
): Promise<ConditionalSettlementFinalityHealth> {
  const slaSeconds = getConditionalSettlementPendingSlaSeconds();
  const nowIso = now.toISOString();
  const rows = (await db.execute(sql`
    SELECT
      count(*) AS total,
      count(*) FILTER (WHERE right(provider_context->'conditional_settlement'->>'status', 22) = '_CONFIRMATIONS_PENDING') AS pending,
      count(*) FILTER (WHERE right(provider_context->'conditional_settlement'->>'status', 21) = '_FINALITY_UNAVAILABLE') AS unavailable,
      count(*) FILTER (WHERE provider_context->'conditional_settlement'->'finality'->>'reason' = 'RECEIPT_BLOCK_NOT_CANONICAL') AS orphaned_receipts,
      count(*) FILTER (WHERE provider_context->'conditional_settlement'->'finality'->>'reason' IN ('CHAIN_HEAD_UNAVAILABLE', 'CANONICAL_BLOCK_UNAVAILABLE')) AS rpc_unavailable,
      count(*) FILTER (WHERE provider_context->'conditional_settlement'->'finality'->>'reason' IN ('INVALID_CONFIRMATION_POLICY', 'RECEIPT_BLOCK_MISSING', 'RECEIPT_BLOCK_HASH_MISSING')) AS configuration_blocked,
      count(*) FILTER (
        WHERE right(provider_context->'conditional_settlement'->>'status', 22) = '_CONFIRMATIONS_PENDING'
          AND updated_at <= ${nowIso}::timestamptz - (${slaSeconds} * interval '1 second')
      ) AS overdue_pending,
      extract(epoch FROM ${nowIso}::timestamptz - min(updated_at) FILTER (
        WHERE right(provider_context->'conditional_settlement'->>'status', 22) = '_CONFIRMATIONS_PENDING'
      )) AS oldest_pending_age_seconds
    FROM payment_intents
    WHERE right(provider_context->'conditional_settlement'->>'status', 22) = '_CONFIRMATIONS_PENDING'
       OR right(provider_context->'conditional_settlement'->>'status', 21) = '_FINALITY_UNAVAILABLE'
  `)) as unknown as Array<Record<string, string | number | null>>;
  const row = rows[0] ?? {};
  const health = {
    total: Number(row.total ?? 0),
    pending: Number(row.pending ?? 0),
    unavailable: Number(row.unavailable ?? 0),
    orphanedReceipts: Number(row.orphaned_receipts ?? 0),
    rpcUnavailable: Number(row.rpc_unavailable ?? 0),
    configurationBlocked: Number(row.configuration_blocked ?? 0),
    overduePending: Number(row.overdue_pending ?? 0),
    oldestPendingAgeSeconds:
      row.oldest_pending_age_seconds === null || row.oldest_pending_age_seconds === undefined
        ? null
        : Math.max(0, Math.round(Number(row.oldest_pending_age_seconds))),
  };
  return {
    status:
      health.orphanedReceipts > 0
        ? "critical"
        : health.unavailable > 0 || health.overduePending > 0
          ? "attention"
          : "healthy",
    ...health,
    pendingSlaSeconds: slaSeconds,
    recordedAt: now.toISOString(),
  };
}
