import type { Database } from "@haggle/db";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerOpsAlertRoutes } from "../routes/ops-alerts.js";
import { signWebhookClaimAlertPayload } from "../services/webhook-claim-alert.service.js";
import {
  claimWebhookEvent,
  completeWebhookEvent,
  failWebhookEvent,
} from "../services/webhook-event-claim.service.js";

vi.mock("../services/webhook-event-claim.service.js", () => ({
  claimWebhookEvent: vi.fn(),
  completeWebhookEvent: vi.fn(),
  failWebhookEvent: vi.fn(),
}));
const secret = "webhook-claim-receiver-secret";
const previousSecret = "webhook-claim-previous-secret";
const deliveryId = `health_${"d".repeat(64)}`;

function body(timestamp: string, overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: "webhook_claim.health",
    delivery_id: deliveryId,
    state: "firing",
    created_at: timestamp,
    severity: "critical",
    reasons: ["stale_processing", "failed", "retry_ready"],
    totals: { processing: 1, completed: 10, failed: 1, staleProcessing: 1, retryReady: 1 },
    sources: [
      {
        source: "conditional_settlement_finality_receiver",
        processing: 1,
        failed: 1,
        stale_processing: 1,
        retry_ready: 1,
        max_attempt_count: 2,
        oldest_unfinished_age_seconds: 90,
      },
    ],
    ...overrides,
  });
}
function headers(raw: string, timestamp: string, signingSecret = secret) {
  return {
    "content-type": "application/json",
    "x-haggle-alert-timestamp": timestamp,
    "x-haggle-alert-delivery-id": deliveryId,
    "x-haggle-alert-signature": signWebhookClaimAlertPayload(signingSecret, timestamp, raw),
  };
}
async function makeApp(
  role?: "admin" | "authenticated",
  rows: Array<Record<string, unknown>> = [],
) {
  const app = Fastify();
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, raw, done) => {
    (request as unknown as { rawBody: Buffer }).rawBody = raw as Buffer;
    try {
      done(null, JSON.parse((raw as Buffer).toString("utf8")));
    } catch (error) {
      done(error as Error, undefined);
    }
  });
  if (role)
    app.addHook("preHandler", async (request) => {
      request.user = { id: "99999999-9999-4999-8999-999999999999", email: "admin@haggle.ai", role };
    });
  registerOpsAlertRoutes(app, { execute: vi.fn().mockResolvedValue(rows) } as unknown as Database);
  await app.ready();
  return app;
}

describe("webhook claim health alert receiver routes", () => {
  afterEach(() => {
    delete process.env.WEBHOOK_CLAIM_ALERT_SECRET;
    delete process.env.WEBHOOK_CLAIM_ALERT_PREVIOUS_SECRETS;
    vi.clearAllMocks();
  });

  it("accepts and completes a valid aggregate firing delivery", async () => {
    process.env.WEBHOOK_CLAIM_ALERT_SECRET = secret;
    vi.mocked(claimWebhookEvent).mockResolvedValue({
      outcome: "acquired",
      source: "receiver",
      eventId: deliveryId,
      claimId: "claim",
    });
    vi.mocked(completeWebhookEvent).mockResolvedValue(true);
    const app = await makeApp();
    const timestamp = new Date().toISOString();
    const raw = body(timestamp);
    const response = await app.inject({
      method: "POST",
      url: "/internal/ops/alerts/webhook-claim-health",
      headers: headers(raw, timestamp),
      payload: raw,
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      accepted: true,
      state: "firing",
      severity: "critical",
    });
    expect(completeWebhookEvent).toHaveBeenCalledOnce();
    await app.close();
  });

  it("accepts a recovery signed by an overlap secret", async () => {
    process.env.WEBHOOK_CLAIM_ALERT_SECRET = secret;
    process.env.WEBHOOK_CLAIM_ALERT_PREVIOUS_SECRETS = previousSecret;
    vi.mocked(claimWebhookEvent).mockResolvedValue({
      outcome: "acquired",
      source: "receiver",
      eventId: deliveryId,
      claimId: "claim",
    });
    vi.mocked(completeWebhookEvent).mockResolvedValue(true);
    const app = await makeApp();
    const timestamp = new Date().toISOString();
    const raw = body(timestamp, {
      state: "recovered",
      severity: "recovery",
      reasons: ["webhook_claim_recovered"],
      totals: { processing: 0, completed: 11, failed: 0, staleProcessing: 0, retryReady: 0 },
      sources: [],
    });
    const response = await app.inject({
      method: "POST",
      url: "/internal/ops/alerts/webhook-claim-health",
      headers: headers(raw, timestamp, previousSecret),
      payload: raw,
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ state: "recovered", severity: "recovery" });
    await app.close();
  });

  it("returns completed replay and isolates payload conflicts", async () => {
    process.env.WEBHOOK_CLAIM_ALERT_SECRET = secret;
    vi.mocked(claimWebhookEvent)
      .mockResolvedValueOnce({ outcome: "duplicate", source: "receiver", eventId: deliveryId })
      .mockResolvedValueOnce({
        outcome: "payload_conflict",
        source: "receiver",
        eventId: deliveryId,
      });
    const app = await makeApp();
    const timestamp = new Date().toISOString();
    const raw = body(timestamp);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/internal/ops/alerts/webhook-claim-health",
          headers: headers(raw, timestamp),
          payload: raw,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/internal/ops/alerts/webhook-claim-health",
          headers: headers(raw, timestamp),
          payload: raw,
        })
      ).statusCode,
    ).toBe(409);
    await app.close();
  });

  it("keeps in-progress and failed deliveries retryable", async () => {
    process.env.WEBHOOK_CLAIM_ALERT_SECRET = secret;
    vi.mocked(claimWebhookEvent)
      .mockResolvedValueOnce({ outcome: "in_progress", source: "receiver", eventId: deliveryId })
      .mockResolvedValueOnce({
        outcome: "retry_later",
        source: "receiver",
        eventId: deliveryId,
        retryAfterSeconds: 7,
      });
    const app = await makeApp();
    const timestamp = new Date().toISOString();
    const raw = body(timestamp);
    const processing = await app.inject({
      method: "POST",
      url: "/internal/ops/alerts/webhook-claim-health",
      headers: headers(raw, timestamp),
      payload: raw,
    });
    expect(processing.statusCode).toBe(503);
    expect(processing.headers["retry-after"]).toBe("2");
    const backoff = await app.inject({
      method: "POST",
      url: "/internal/ops/alerts/webhook-claim-health",
      headers: headers(raw, timestamp),
      payload: raw,
    });
    expect(backoff.statusCode).toBe(503);
    expect(backoff.headers["retry-after"]).toBe("7");
    await app.close();
  });

  it("rejects signed unknown fields and contradictory aggregates before claiming", async () => {
    process.env.WEBHOOK_CLAIM_ALERT_SECRET = secret;
    const app = await makeApp();
    const timestamp = new Date().toISOString();
    const extra = body(timestamp, { payment_id: "secret-id" });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/internal/ops/alerts/webhook-claim-health",
          headers: headers(extra, timestamp),
          payload: extra,
        })
      ).statusCode,
    ).toBe(400);
    const parsed = JSON.parse(body(timestamp)) as Record<string, unknown>;
    parsed.totals = { ...(parsed.totals as Record<string, unknown>), processing: 2 };
    const mismatch = JSON.stringify(parsed);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/internal/ops/alerts/webhook-claim-health",
          headers: headers(mismatch, timestamp),
          payload: mismatch,
        })
      ).statusCode,
    ).toBe(400);
    expect(claimWebhookEvent).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects stale, invalid signatures, and invalid receiver configuration", async () => {
    process.env.WEBHOOK_CLAIM_ALERT_SECRET = secret;
    const app = await makeApp();
    const stale = new Date(Date.now() - 301_000).toISOString();
    const staleRaw = body(stale);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/internal/ops/alerts/webhook-claim-health",
          headers: headers(staleRaw, stale),
          payload: staleRaw,
        })
      ).statusCode,
    ).toBe(401);
    const current = new Date().toISOString();
    const currentRaw = body(current);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/internal/ops/alerts/webhook-claim-health",
          headers: headers(currentRaw, current, "wrong-secret-with-length"),
          payload: currentRaw,
        })
      ).statusCode,
    ).toBe(401);
    process.env.WEBHOOK_CLAIM_ALERT_PREVIOUS_SECRETS = "short";
    const invalid = await app.inject({
      method: "POST",
      url: "/internal/ops/alerts/webhook-claim-health",
      headers: headers(currentRaw, current),
      payload: currentRaw,
    });
    expect(invalid.statusCode).toBe(503);
    expect(invalid.json()).toEqual({ error: "OPS_ALERT_RECEIVER_INVALID_CONFIGURATION" });
    await app.close();
  });

  it("marks completion failures retryable", async () => {
    process.env.WEBHOOK_CLAIM_ALERT_SECRET = secret;
    vi.mocked(claimWebhookEvent).mockResolvedValue({
      outcome: "acquired",
      source: "receiver",
      eventId: deliveryId,
      claimId: "claim",
    });
    vi.mocked(completeWebhookEvent).mockRejectedValue(new Error("db unavailable"));
    vi.mocked(failWebhookEvent).mockResolvedValue(undefined);
    const app = await makeApp();
    const timestamp = new Date().toISOString();
    const raw = body(timestamp);
    const response = await app.inject({
      method: "POST",
      url: "/internal/ops/alerts/webhook-claim-health",
      headers: headers(raw, timestamp),
      payload: raw,
    });
    expect(response.statusCode).toBe(503);
    expect(response.headers["retry-after"]).toBe("2");
    expect(failWebhookEvent).toHaveBeenCalledOnce();
    await app.close();
  });

  it("returns aggregate receiver health only to admins", async () => {
    process.env.WEBHOOK_CLAIM_ALERT_SECRET = secret;
    const rows = [
      {
        processing: 0,
        completed: 2,
        failed: 0,
        stale_processing: 0,
        retry_ready: 0,
        last_completed_at: "2026-07-12T20:00:00.000Z",
      },
    ];
    const admin = await makeApp("admin", rows);
    const response = await admin.inject({
      method: "GET",
      url: "/admin/ops/alerts/webhook-claim-health/health",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      receiver_kind: "webhook_claim_health",
      receiver_health: { status: "healthy", completed: 2 },
      receiver_policy: { configured: true, acceptedSecretCount: 1, maxAcceptedSecretCount: 4 },
    });
    expect(response.body).not.toContain(secret);
    await admin.close();
    const user = await makeApp("authenticated", rows);
    expect(
      (await user.inject({ method: "GET", url: "/admin/ops/alerts/webhook-claim-health/health" }))
        .statusCode,
    ).toBe(403);
    await user.close();
  });
});
