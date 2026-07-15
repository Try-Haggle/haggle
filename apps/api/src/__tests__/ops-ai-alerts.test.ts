import { generateKeyPairSync } from "node:crypto";
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
const secret = "cycle65-ai-ops-alert-secret";
const timestamp = new Date().toISOString();
const deliveryId = `health_${"a".repeat(64)}`;
const payload = () =>
  JSON.stringify({
    type: "dispute_ai_audit_archive.health",
    delivery_id: deliveryId,
    state: "firing",
    created_at: timestamp,
    severity: "critical",
    reasons: ["ai_audit_archive_dead_letter"],
    health: { status: "critical", deadLetter: 1 },
  });
const headers = (body: string, overrides: Record<string, string> = {}) => ({
  "content-type": "application/json",
  "x-haggle-alert-timestamp": timestamp,
  "x-haggle-alert-delivery-id": deliveryId,
  "x-haggle-alert-signature": signWebhookClaimAlertPayload(secret, timestamp, body),
  ...overrides,
});
async function makeApp(
  role?: "admin" | "authenticated",
  rows: Array<Record<string, unknown>> = [],
) {
  const app = Fastify();
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
    (request as unknown as { rawBody: Buffer }).rawBody = body as Buffer;
    try {
      done(null, JSON.parse((body as Buffer).toString("utf8")));
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
describe("dispute AI ops alert receiver routes", () => {
  afterEach(() => {
    delete process.env.DISPUTE_AI_AUDIT_ARCHIVE_ALERT_SECRET;
    delete process.env.DISPUTE_AI_AUDIT_ARCHIVE_ALERT_PREVIOUS_SECRETS;
    vi.clearAllMocks();
  });
  it("publishes only trusted public audit key material", async () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    process.env.DISPUTE_AUDIT_SIGNING_PRIVATE_KEY_BASE64 = privateKey
      .export({ format: "der", type: "pkcs8" })
      .toString("base64");
    const app = await makeApp();
    const res = await app.inject({
      method: "GET",
      url: "/.well-known/haggle-dispute-audit-keys.json",
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toContain("max-age=300");
    expect(res.json()).toMatchObject({
      schema: "haggle.dispute-audit-key-registry.v1",
      keys: [{ status: "active", algorithm: "Ed25519" }],
    });
    expect(res.body).not.toContain("private");
    delete process.env.DISPUTE_AUDIT_SIGNING_PRIVATE_KEY_BASE64;
    await app.close();
  });
  it("accepts and completes the first valid delivery", async () => {
    process.env.DISPUTE_AI_AUDIT_ARCHIVE_ALERT_SECRET = secret;
    vi.mocked(claimWebhookEvent).mockResolvedValueOnce({
      outcome: "acquired",
      source: "receiver",
      eventId: deliveryId,
      claimId: "11111111-1111-4111-8111-111111111111",
      attemptCount: 1,
    });
    vi.mocked(completeWebhookEvent).mockResolvedValueOnce(true);
    const app = await makeApp();
    const body = payload();
    const res = await app.inject({
      method: "POST",
      url: "/internal/ops/alerts/dispute-ai-audit-archive",
      headers: headers(body),
      payload: body,
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ accepted: true, replayed: false, state: "firing" });
    expect(completeWebhookEvent).toHaveBeenCalledOnce();
    await app.close();
  });
  it("returns replay 200 and conflict 409", async () => {
    process.env.DISPUTE_AI_AUDIT_ARCHIVE_ALERT_SECRET = secret;
    vi.mocked(claimWebhookEvent)
      .mockResolvedValueOnce({ outcome: "duplicate", source: "x", eventId: deliveryId })
      .mockResolvedValueOnce({ outcome: "payload_conflict", source: "x", eventId: deliveryId });
    const app = await makeApp();
    const body = payload();
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/internal/ops/alerts/dispute-ai-audit-archive",
          headers: headers(body),
          payload: body,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/internal/ops/alerts/dispute-ai-audit-archive",
          headers: headers(body),
          payload: body,
        })
      ).statusCode,
    ).toBe(409);
    await app.close();
  });
  it("rejects stale signatures and fails closed when unconfigured", async () => {
    process.env.DISPUTE_AI_AUDIT_ARCHIVE_ALERT_SECRET = secret;
    const app = await makeApp();
    const body = payload();
    const staleTime = new Date(Date.now() - 360_000).toISOString();
    const stale = await app.inject({
      method: "POST",
      url: "/internal/ops/alerts/dispute-ai-audit-archive",
      headers: headers(body, {
        "x-haggle-alert-timestamp": staleTime,
        "x-haggle-alert-signature": signWebhookClaimAlertPayload(secret, staleTime, body),
      }),
      payload: body,
    });
    expect(stale.statusCode).toBe(401);
    delete process.env.DISPUTE_AI_AUDIT_ARCHIVE_ALERT_SECRET;
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/internal/ops/alerts/dispute-ai-audit-archive",
          headers: headers(body),
          payload: body,
        })
      ).statusCode,
    ).toBe(503);
    await app.close();
  });
  it("accepts a previous secret during rotation", async () => {
    process.env.DISPUTE_AI_AUDIT_ARCHIVE_ALERT_PREVIOUS_SECRETS = `old-invalid, ${secret}`;
    vi.mocked(claimWebhookEvent).mockResolvedValueOnce({
      outcome: "duplicate",
      source: "x",
      eventId: deliveryId,
    });
    const app = await makeApp();
    const body = payload();
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/internal/ops/alerts/dispute-ai-audit-archive",
          headers: headers(body),
          payload: body,
        })
      ).statusCode,
    ).toBe(200);
    await app.close();
  });
  it("returns aggregate health only to admins", async () => {
    process.env.DISPUTE_AI_AUDIT_ARCHIVE_ALERT_SECRET = secret;
    const rows = [
      {
        processing: 0,
        completed: 2,
        failed: 0,
        stale_processing: 0,
        retry_ready: 0,
        last_completed_at: "2026-07-12T12:00:00.000Z",
      },
    ];
    const admin = await makeApp("admin", rows);
    const res = await admin.inject({
      method: "GET",
      url: "/admin/ops/alerts/dispute-ai-audit-archive/health",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      receiver_health: { status: "healthy", completed: 2 },
      receiver_policy: { configured: true, acceptedSecretCount: 1, timestampToleranceSeconds: 300 },
    });
    expect(res.body).not.toContain("delivery_id");
    await admin.close();
    const user = await makeApp("authenticated", rows);
    expect(
      (
        await user.inject({
          method: "GET",
          url: "/admin/ops/alerts/dispute-ai-audit-archive/health",
        })
      ).statusCode,
    ).toBe(403);
    await user.close();
  });
});
