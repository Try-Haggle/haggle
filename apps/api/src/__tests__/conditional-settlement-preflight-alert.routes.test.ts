import type { Database } from "@haggle/db";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerOpsAlertRoutes } from "../routes/ops-alerts.js";
import { signWebhookClaimAlertPayload } from "../services/webhook-claim-alert.service.js";
import {
  claimWebhookEvent,
  completeWebhookEvent,
} from "../services/webhook-event-claim.service.js";

vi.mock("../services/webhook-event-claim.service.js", () => ({
  claimWebhookEvent: vi.fn(),
  completeWebhookEvent: vi.fn(),
}));
const secret = "cycle82-preflight-receiver-secret";
const deliveryId = `health_${"a".repeat(64)}`;
function body(timestamp: string) {
  return JSON.stringify({
    type: "conditional_settlement_preflight.health",
    delivery_id: deliveryId,
    state: "firing",
    created_at: timestamp,
    severity: "critical",
    reasons: ["rpc_timeout"],
    health: { status: "unavailable", error_code: "RPC_TIMEOUT" },
  });
}
function headers(raw: string, timestamp: string) {
  return {
    "content-type": "application/json",
    "x-haggle-alert-timestamp": timestamp,
    "x-haggle-alert-delivery-id": deliveryId,
    "x-haggle-alert-signature": signWebhookClaimAlertPayload(secret, timestamp, raw),
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

describe("conditional settlement preflight alert receiver routes", () => {
  afterEach(() => {
    delete process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_SECRET;
    delete process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_PREVIOUS_SECRETS;
    vi.clearAllMocks();
  });

  it("accepts and completes the first valid delivery", async () => {
    process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_SECRET = secret;
    vi.mocked(claimWebhookEvent).mockResolvedValueOnce({
      outcome: "acquired",
      source: "receiver",
      eventId: deliveryId,
      claimId: "11111111-1111-4111-8111-111111111111",
      attemptCount: 1,
    });
    vi.mocked(completeWebhookEvent).mockResolvedValueOnce(true);
    const app = await makeApp();
    const timestamp = new Date().toISOString();
    const raw = body(timestamp);
    const response = await app.inject({
      method: "POST",
      url: "/internal/ops/alerts/conditional-settlement-preflight",
      headers: headers(raw, timestamp),
      payload: raw,
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      accepted: true,
      replayed: false,
      delivery_id: deliveryId,
      state: "firing",
      severity: "critical",
    });
    expect(completeWebhookEvent).toHaveBeenCalledOnce();
    await app.close();
  });

  it("does not acknowledge a delivery when claim completion fails", async () => {
    process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_SECRET = secret;
    vi.mocked(claimWebhookEvent).mockResolvedValueOnce({
      outcome: "acquired",
      source: "receiver",
      eventId: deliveryId,
      claimId: "11111111-1111-4111-8111-111111111111",
      attemptCount: 1,
    });
    vi.mocked(completeWebhookEvent).mockResolvedValueOnce(false);
    const app = await makeApp();
    const timestamp = new Date().toISOString();
    const raw = body(timestamp);
    const response = await app.inject({
      method: "POST",
      url: "/internal/ops/alerts/conditional-settlement-preflight",
      headers: headers(raw, timestamp),
      payload: raw,
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "ALERT_CLAIM_COMPLETION_FAILED" });
    await app.close();
  });

  it("returns idempotent replay and isolates a payload conflict", async () => {
    process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_SECRET = secret;
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
    const first = await app.inject({
      method: "POST",
      url: "/internal/ops/alerts/conditional-settlement-preflight",
      headers: headers(raw, timestamp),
      payload: raw,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ accepted: false, replayed: true });
    const conflict = await app.inject({
      method: "POST",
      url: "/internal/ops/alerts/conditional-settlement-preflight",
      headers: headers(raw, timestamp),
      payload: raw,
    });
    expect(conflict.statusCode).toBe(409);
    await app.close();
  });

  it("fails closed when unconfigured and rejects stale signatures", async () => {
    const app = await makeApp();
    const current = new Date().toISOString();
    const currentRaw = body(current);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/internal/ops/alerts/conditional-settlement-preflight",
          headers: headers(currentRaw, current),
          payload: currentRaw,
        })
      ).statusCode,
    ).toBe(503);
    process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_SECRET = secret;
    const stale = new Date(Date.now() - 301_000).toISOString();
    const staleRaw = body(stale);
    const response = await app.inject({
      method: "POST",
      url: "/internal/ops/alerts/conditional-settlement-preflight",
      headers: headers(staleRaw, stale),
      payload: staleRaw,
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "ALERT_TIMESTAMP_OUT_OF_RANGE" });
    await app.close();
  });

  it("returns aggregate receiver health only to admins", async () => {
    process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_SECRET = secret;
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
      url: "/admin/ops/alerts/conditional-settlement-preflight/health",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      receiver_kind: "conditional_settlement_preflight",
      receiver_health: { status: "healthy", completed: 2 },
      receiver_policy: { configured: true, acceptedSecretCount: 1, timestampToleranceSeconds: 300 },
    });
    expect(response.body).not.toContain(secret);
    await admin.close();
    const user = await makeApp("authenticated", rows);
    expect(
      (
        await user.inject({
          method: "GET",
          url: "/admin/ops/alerts/conditional-settlement-preflight/health",
        })
      ).statusCode,
    ).toBe(403);
    await user.close();
  });
});
