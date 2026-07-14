import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebhookClaimHealth } from "../services/webhook-event-claim.service.js";
import {
  buildWebhookClaimAlertPayload,
  evaluateWebhookClaimAlert,
  resolveWebhookClaimAlertConfigFromEnv,
  sendWebhookClaimAlert,
} from "../services/webhook-claim-alert.service.js";

const health: WebhookClaimHealth = {
  status: "critical",
  totals: { processing: 2, completed: 10, failed: 1, staleProcessing: 1, retryReady: 1 },
  sources: [{
    source: "easypost",
    processing: 2,
    completed: 10,
    failed: 1,
    staleProcessing: 1,
    retryReady: 1,
    maxAttemptCount: 3,
    oldestUnfinishedAgeSeconds: 91,
  }],
  recordedAt: "2026-07-12T00:00:00.000Z",
};

const config = {
  url: "https://ops.example/alerts",
  secret: "ops-alert-secret-with-length",
  timeoutMs: 5000,
  cooldownMinutes: 15,
  failedThreshold: 1,
  staleThreshold: 1,
  retryReadyThreshold: 1,
  allowInsecureHttp: false,
  allowPrivateNetwork: false,
};

describe("webhook claim health alerts", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  it("raises a critical alert for stale processing leases", () => {
    expect(evaluateWebhookClaimAlert(health, config)).toEqual({
      wouldAlert: true,
      severity: "critical",
      reasons: ["stale_processing", "failed", "retry_ready"],
    });
  });

  it("builds only aggregate alert payload fields", () => {
    const payload = buildWebhookClaimAlertPayload(
      health,
      evaluateWebhookClaimAlert(health, config),
      new Date("2026-07-12T00:00:00.000Z"),
    );
    const serialized = JSON.stringify(payload);
    expect(payload).toMatchObject({ type: "webhook_claim.health", severity: "critical" });
    expect(payload.state).toBe("firing");
    expect(serialized).not.toContain("eventId");
    expect(serialized).not.toContain("payloadSha256");
    expect(serialized).not.toContain("lastError");
  });

  it("marks recovery payloads explicitly", () => {
    expect(buildWebhookClaimAlertPayload({ ...health, status: "healthy",
      totals: { processing: 0, completed: 11, failed: 0, staleProcessing: 0, retryReady: 0 }, sources: [] },
    { wouldAlert: true, severity: "recovery", reasons: ["webhook_claim_recovered"] })).toMatchObject({
      state: "recovered", severity: "recovery", reasons: ["webhook_claim_recovered"],
    });
  });

  it("sends a signed HTTPS alert", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    const assessment = evaluateWebhookClaimAlert(health, config);
    await expect(sendWebhookClaimAlert(health, assessment, {
      config,
      fetchImpl: fetchMock,
      now: new Date("2026-07-12T00:00:00.000Z"),
    })).resolves.toMatchObject({ status: "delivered", httpStatus: 200 });
    expect(fetchMock).toHaveBeenCalledWith("https://ops.example/alerts", expect.objectContaining({
      method: "POST",
      redirect: "error",
      headers: expect.objectContaining({
        "x-haggle-alert-type": "webhook_claim.health",
        "x-haggle-alert-signature": expect.stringMatching(/^sha256=[0-9a-f]{64}$/),
      }),
    }));
  });

  it("rejects private alert targets by default", async () => {
    await expect(sendWebhookClaimAlert(health, evaluateWebhookClaimAlert(health, config), {
      config: { ...config, url: "https://127.0.0.1/alerts" },
    })).rejects.toThrow("must not target localhost or private network hosts");
  });

  it("requires a signing secret whenever an alert URL is configured", () => {
    process.env.WEBHOOK_CLAIM_ALERT_URL = "https://ops.example/alerts";
    delete process.env.WEBHOOK_CLAIM_ALERT_SECRET;
    expect(() => resolveWebhookClaimAlertConfigFromEnv()).toThrow("secret must be at least 16 characters");
  });
});
