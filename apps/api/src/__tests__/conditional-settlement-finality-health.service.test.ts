import type { Database } from "@haggle/db";
import { describe, expect, it, vi } from "vitest";
import {
  getConditionalSettlementFinalityHealth,
  getConditionalSettlementPendingSlaSeconds,
} from "../services/conditional-settlement-finality-health.service.js";

describe("conditional settlement finality health", () => {
  it("bounds the pending SLA", () => {
    expect(getConditionalSettlementPendingSlaSeconds({})).toBe(120);
    expect(
      getConditionalSettlementPendingSlaSeconds({
        HAGGLE_CONDITIONAL_SETTLEMENT_PENDING_SLA_SECONDS: "300",
      }),
    ).toBe(300);
    expect(
      getConditionalSettlementPendingSlaSeconds({
        HAGGLE_CONDITIONAL_SETTLEMENT_PENDING_SLA_SECONDS: "5",
      }),
    ).toBe(120);
  });

  it("reports privacy-bounded critical aggregate for orphaned receipts", async () => {
    const execute = vi.fn().mockResolvedValue([
      {
        total: "4",
        pending: "2",
        unavailable: "2",
        orphaned_receipts: "1",
        rpc_unavailable: "1",
        configuration_blocked: "0",
        overdue_pending: "1",
        oldest_pending_age_seconds: "180.4",
      },
    ]);
    const health = await getConditionalSettlementFinalityHealth(
      { execute } as unknown as Database,
      new Date("2026-07-12T00:00:00.000Z"),
    );
    expect(health).toEqual({
      status: "critical",
      total: 4,
      pending: 2,
      unavailable: 2,
      orphanedReceipts: 1,
      rpcUnavailable: 1,
      configurationBlocked: 0,
      overduePending: 1,
      oldestPendingAgeSeconds: 180,
      pendingSlaSeconds: 120,
      recordedAt: "2026-07-12T00:00:00.000Z",
    });
    expect(JSON.stringify(health)).not.toMatch(/payment|order|tx_hash|block_hash/i);
  });
});
