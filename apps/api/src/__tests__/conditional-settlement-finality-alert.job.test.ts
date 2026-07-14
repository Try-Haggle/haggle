import type { Database } from "@haggle/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runConditionalSettlementFinalityAlert } from "../jobs/conditional-settlement-finality-alert.js";
import {
  findLatestDeliveredConditionalSettlementFinalityIncident,
  sendConditionalSettlementFinalityAlert,
} from "../services/conditional-settlement-finality-alert.service.js";
import {
  claimWebhookEvent,
  completeWebhookEvent,
  failWebhookEvent,
} from "../services/webhook-event-claim.service.js";

vi.mock("../services/webhook-event-claim.service.js", () => ({
  webhookPayloadSha256: vi.fn(() => "b".repeat(64)),
  claimWebhookEvent: vi.fn(),
  completeWebhookEvent: vi.fn(),
  failWebhookEvent: vi.fn(),
  getWebhookEventClaimLeaseSeconds: vi.fn(() => 60),
}));
vi.mock("../services/conditional-settlement-finality-alert.service.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../services/conditional-settlement-finality-alert.service.js")
    >();
  return {
    ...actual,
    findLatestDeliveredConditionalSettlementFinalityIncident: vi.fn(),
    sendConditionalSettlementFinalityAlert: vi.fn(),
  };
});

const config = {
  url: "http://127.0.0.1:9999/alert",
  secret: "fixture-secret-1234",
  timeoutMs: 1000,
  cooldownMinutes: 15,
  allowInsecureHttp: true,
  allowPrivateNetwork: true,
};
const healthy = {
  status: "healthy" as const,
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
};

beforeEach(() => vi.clearAllMocks());

describe("conditional settlement finality alert job", () => {
  it("claims and delivers one critical incident", async () => {
    vi.mocked(claimWebhookEvent).mockResolvedValue({
      outcome: "acquired",
      source: "test",
      eventId: `health_${"a".repeat(64)}`,
      claimId: "claim",
    });
    vi.mocked(sendConditionalSettlementFinalityAlert).mockResolvedValue({
      status: "delivered",
      httpStatus: 202,
    });
    const result = await runConditionalSettlementFinalityAlert({} as Database, {
      config,
      claimSource: "test",
      collectHealth: async () => ({
        ...healthy,
        status: "critical",
        total: 1,
        unavailable: 1,
        orphanedReceipts: 1,
      }),
    });
    expect(result.status).toBe("delivered");
    expect(completeWebhookEvent).toHaveBeenCalledOnce();
    expect(failWebhookEvent).not.toHaveBeenCalled();
  });

  it("suppresses duplicate incidents through the shared claim", async () => {
    vi.mocked(claimWebhookEvent).mockResolvedValue({
      outcome: "duplicate",
      source: "test",
      eventId: "event",
    });
    const result = await runConditionalSettlementFinalityAlert({} as Database, {
      config,
      claimSource: "test",
      collectHealth: async () => ({
        ...healthy,
        status: "attention",
        total: 1,
        pending: 1,
        overduePending: 1,
      }),
    });
    expect(result).toMatchObject({ status: "skipped", reason: "cooldown_or_in_progress" });
    expect(sendConditionalSettlementFinalityAlert).not.toHaveBeenCalled();
  });

  it("sends recovery only for a delivered incident", async () => {
    vi.mocked(findLatestDeliveredConditionalSettlementFinalityIncident).mockResolvedValue({
      eventId: `health_${"a".repeat(64)}`,
      completedAt: "2026-07-12T00:00:00.000Z",
    });
    vi.mocked(claimWebhookEvent).mockResolvedValue({
      outcome: "acquired",
      source: "test",
      eventId: `recovery_${"b".repeat(64)}`,
      claimId: "claim",
    });
    vi.mocked(sendConditionalSettlementFinalityAlert).mockResolvedValue({
      status: "delivered",
      httpStatus: 200,
    });
    const result = await runConditionalSettlementFinalityAlert({} as Database, {
      config,
      claimSource: "test",
      collectHealth: async () => healthy,
    });
    expect(result.status).toBe("recovered");
    expect(sendConditionalSettlementFinalityAlert).toHaveBeenCalledWith(
      healthy,
      expect.objectContaining({ severity: "recovery" }),
      expect.objectContaining({ deliveryId: `recovery_${"b".repeat(64)}` }),
    );
  });
});
