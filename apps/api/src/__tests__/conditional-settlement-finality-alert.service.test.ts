import { afterEach, describe, expect, it, vi } from "vitest";
import {
  evaluateConditionalSettlementFinalityAlert,
  getConditionalSettlementFinalityAlertPolicyStatus,
  sendConditionalSettlementFinalityAlert,
} from "../services/conditional-settlement-finality-alert.service.js";
import type { ConditionalSettlementFinalityHealth } from "../services/conditional-settlement-finality-health.service.js";

const health = (
  patch: Partial<ConditionalSettlementFinalityHealth> = {},
): ConditionalSettlementFinalityHealth => ({
  status: "healthy",
  total: 0,
  pending: 0,
  unavailable: 0,
  orphanedReceipts: 0,
  rpcUnavailable: 0,
  configurationBlocked: 0,
  overduePending: 0,
  oldestPendingAgeSeconds: null,
  pendingSlaSeconds: 120,
  recordedAt: "2026-07-12T00:00:00.000Z",
  ...patch,
});

afterEach(() => vi.unstubAllEnvs());

describe("conditional settlement finality alert", () => {
  it("classifies orphaned receipts as critical and backlog as warning", () => {
    expect(
      evaluateConditionalSettlementFinalityAlert(health({ orphanedReceipts: 1 })),
    ).toMatchObject({ severity: "critical", reasons: ["orphaned_receipt"] });
    expect(
      evaluateConditionalSettlementFinalityAlert(health({ rpcUnavailable: 1, overduePending: 2 })),
    ).toMatchObject({
      severity: "warning",
      reasons: ["confirmation_sla_overdue", "rpc_unavailable"],
    });
    expect(evaluateConditionalSettlementFinalityAlert(health())).toMatchObject({
      wouldAlert: false,
      severity: null,
    });
  });

  it("sends only aggregate health with HMAC metadata", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 202 }));
    const deliveryId = `health_${"a".repeat(64)}`;
    const result = await sendConditionalSettlementFinalityAlert(
      health({ orphanedReceipts: 1, total: 1 }),
      { wouldAlert: true, severity: "critical", reasons: ["orphaned_receipt"] },
      {
        config: {
          url: "http://127.0.0.1:9999/alert",
          secret: "fixture-secret-1234",
          timeoutMs: 1000,
          cooldownMinutes: 15,
          allowInsecureHttp: true,
          allowPrivateNetwork: true,
        },
        deliveryId,
        fetchImpl,
        now: new Date("2026-07-12T00:00:00.000Z"),
      },
    );
    expect(result).toMatchObject({ status: "delivered", httpStatus: 202 });
    const [, request] = fetchImpl.mock.calls[0];
    expect(request.headers["x-haggle-alert-type"]).toBe("conditional_settlement_finality.health");
    expect(request.headers["x-haggle-alert-signature"]).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(JSON.parse(request.body)).toMatchObject({
      type: "conditional_settlement_finality.health",
      delivery_id: deliveryId,
      health: { total: 1, orphanedReceipts: 1 },
    });
    expect(request.body).not.toMatch(/payment_id|order_id|tx_hash|block_hash/i);
  });

  it("reports configuration state without exposing endpoint or secret", () => {
    vi.stubEnv("CONDITIONAL_SETTLEMENT_FINALITY_ALERT_URL", "https://ops.example.com/finality");
    vi.stubEnv("CONDITIONAL_SETTLEMENT_FINALITY_ALERT_SECRET", "fixture-secret-1234");
    const policy = getConditionalSettlementFinalityAlertPolicyStatus();
    expect(policy).toMatchObject({
      configured: true,
      configurationState: "valid",
      timingSafe: true,
    });
    expect(JSON.stringify(policy)).not.toContain("ops.example.com");
    expect(JSON.stringify(policy)).not.toContain("fixture-secret");
  });
});
