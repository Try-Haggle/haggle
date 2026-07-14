import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@haggle/db";
import { registerOpsAlertRoutes } from "../routes/ops-alerts.js";
import { signWebhookClaimAlertPayload } from "../services/webhook-claim-alert.service.js";
import { claimWebhookEvent, completeWebhookEvent } from "../services/webhook-event-claim.service.js";

vi.mock("../services/webhook-event-claim.service.js", () => ({ claimWebhookEvent: vi.fn(), completeWebhookEvent: vi.fn() }));

const secret = "cycle61-ops-alert-receiver-secret";
const timestamp = new Date().toISOString();
const deliveryId = `health_${"a".repeat(64)}`;

function payload(id = deliveryId) {
  return JSON.stringify({
    type: "dispute_similarity_review_audit_archive.health", delivery_id: id,
    state: "firing", created_at: timestamp, severity: "critical",
    reasons: ["similarity_audit_archive_dead_letter"], health: { status: "critical", deadLetter: 1 },
  });
}

function signedHeaders(body: string, overrides: Record<string, string> = {}) {
  return {
    "content-type": "application/json",
    "x-haggle-alert-timestamp": timestamp,
    "x-haggle-alert-delivery-id": deliveryId,
    "x-haggle-alert-signature": signWebhookClaimAlertPayload(secret, timestamp, body),
    ...overrides,
  };
}

async function makeApp(role?: "admin" | "authenticated", healthRows: Array<Record<string, unknown>> = []) {
  const app = Fastify();
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
    (request as unknown as { rawBody: Buffer }).rawBody = body as Buffer;
    try { done(null, JSON.parse((body as Buffer).toString("utf8"))); } catch (error) { done(error as Error, undefined); }
  });
  if (role) app.addHook("preHandler", async (request) => {
    request.user = { id: "99999999-9999-4999-8999-999999999999", email: "admin@haggle.ai", role };
  });
  const db = { execute: vi.fn().mockResolvedValue(healthRows) } as unknown as Database;
  registerOpsAlertRoutes(app, db);
  await app.ready();
  return app;
}

describe("ops alert receiver routes", () => {
  afterEach(() => {
    delete process.env.DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_SECRET;
    delete process.env.DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_PREVIOUS_SECRETS;
    vi.clearAllMocks();
  });

  it("accepts and completes the first valid signed delivery", async () => {
    process.env.DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_SECRET = secret;
    vi.mocked(claimWebhookEvent).mockResolvedValueOnce({ outcome: "acquired", source: "receiver", eventId: deliveryId, claimId: "11111111-1111-4111-8111-111111111111", attemptCount: 1 });
    vi.mocked(completeWebhookEvent).mockResolvedValueOnce(true);
    const app = await makeApp();
    const body = payload();
    const response = await app.inject({ method: "POST", url: "/internal/ops/alerts/dispute-similarity-review-audit-archive", headers: signedHeaders(body), payload: body });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ accepted: true, replayed: false, delivery_id: deliveryId, state: "firing", severity: "critical" });
    expect(completeWebhookEvent).toHaveBeenCalledOnce();
    await app.close();
  });

  it("returns an idempotent replay and isolates payload conflict", async () => {
    process.env.DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_SECRET = secret;
    vi.mocked(claimWebhookEvent)
      .mockResolvedValueOnce({ outcome: "duplicate", source: "receiver", eventId: deliveryId })
      .mockResolvedValueOnce({ outcome: "payload_conflict", source: "receiver", eventId: deliveryId });
    const app = await makeApp();
    const body = payload();
    const replay = await app.inject({ method: "POST", url: "/internal/ops/alerts/dispute-similarity-review-audit-archive", headers: signedHeaders(body), payload: body });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual({ accepted: false, replayed: true, delivery_id: deliveryId });
    const conflict = await app.inject({ method: "POST", url: "/internal/ops/alerts/dispute-similarity-review-audit-archive", headers: signedHeaders(body), payload: body });
    expect(conflict.statusCode).toBe(409);
    await app.close();
  });

  it("rejects stale signatures and fails closed when unconfigured", async () => {
    process.env.DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_SECRET = secret;
    const app = await makeApp();
    const body = payload();
    const staleTimestamp = new Date(Date.now() - 6 * 60_000).toISOString();
    const stale = await app.inject({
      method: "POST", url: "/internal/ops/alerts/dispute-similarity-review-audit-archive",
      headers: signedHeaders(body, {
        "x-haggle-alert-timestamp": staleTimestamp,
        "x-haggle-alert-signature": signWebhookClaimAlertPayload(secret, staleTimestamp, body),
      }),
      payload: body,
    });
    expect(stale.statusCode).toBe(401);
    expect(stale.json()).toEqual({ error: "ALERT_TIMESTAMP_OUT_OF_RANGE" });
    delete process.env.DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_SECRET;
    const unconfigured = await app.inject({ method: "POST", url: "/internal/ops/alerts/dispute-similarity-review-audit-archive", headers: signedHeaders(body), payload: body });
    expect(unconfigured.statusCode).toBe(503);
    await app.close();
  });

  it("allows previous-secret verification during rotation", async () => {
    process.env.DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_PREVIOUS_SECRETS = `old-invalid, ${secret}`;
    vi.mocked(claimWebhookEvent).mockResolvedValueOnce({ outcome: "duplicate", source: "receiver", eventId: deliveryId });
    const app = await makeApp();
    const body = payload();
    const response = await app.inject({ method: "POST", url: "/internal/ops/alerts/dispute-similarity-review-audit-archive", headers: signedHeaders(body), payload: body });
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it("returns aggregate receiver health only to admins", async () => {
    process.env.DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_SECRET = secret;
    process.env.DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_PREVIOUS_SECRETS = secret;
    const rows = [{ processing: 0, completed: 2, failed: 0, stale_processing: 0, retry_ready: 0, last_completed_at: "2026-07-12T12:00:00.000Z" }];
    const adminApp = await makeApp("admin", rows);
    const response = await adminApp.inject({ method: "GET", url: "/admin/ops/alerts/dispute-similarity-review-audit-archive/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ receiver_health: { status: "healthy", completed: 2 }, receiver_policy: { configured: true, acceptedSecretCount: 1, timestampToleranceSeconds: 300 } });
    expect(response.body).not.toContain("delivery_id");
    await adminApp.close();
    const userApp = await makeApp("authenticated", rows);
    expect((await userApp.inject({ method: "GET", url: "/admin/ops/alerts/dispute-similarity-review-audit-archive/health" })).statusCode).toBe(403);
    await userApp.close();
  });
});
