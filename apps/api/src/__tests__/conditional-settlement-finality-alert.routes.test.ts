import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@haggle/db";
import { registerOpsAlertRoutes } from "../routes/ops-alerts.js";
import { signWebhookClaimAlertPayload } from "../services/webhook-claim-alert.service.js";
import {
  getConditionalSettlementFinalityAlertReceiverPolicyStatus,
  resolveConditionalSettlementFinalityAlertReceiverSecretsFromEnv,
  verifyConditionalSettlementFinalityAlert,
} from "../services/conditional-settlement-finality-alert-verifier.service.js";
import { claimWebhookEvent, completeWebhookEvent, failWebhookEvent } from "../services/webhook-event-claim.service.js";

vi.mock("../services/webhook-event-claim.service.js", () => ({ claimWebhookEvent: vi.fn(), completeWebhookEvent: vi.fn(), failWebhookEvent: vi.fn() }));
const secret = "cycle92-finality-receiver-secret";
const previousSecret = "cycle92-previous-receiver-secret";
const deliveryId = `health_${"a".repeat(64)}`;
function body(timestamp: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({ type: "conditional_settlement_finality.health", delivery_id: deliveryId, state: "firing",
    created_at: timestamp, severity: "critical", reasons: ["orphaned_receipt"], health: {
      status: "critical", total: 1, pending: 0, unavailable: 1, orphanedReceipts: 1, rpcUnavailable: 0,
      configurationBlocked: 0, overduePending: 0, oldestPendingAgeSeconds: null, pendingSlaSeconds: 120,
      recordedAt: timestamp,
    }, ...extra });
}
function headers(raw: string, timestamp: string, signingSecret = secret) {
  return { "content-type": "application/json", "x-haggle-alert-timestamp": timestamp,
    "x-haggle-alert-delivery-id": deliveryId,
    "x-haggle-alert-signature": signWebhookClaimAlertPayload(signingSecret, timestamp, raw) };
}
async function makeApp(role?: "admin" | "authenticated", rows: Array<Record<string, unknown>> = []) {
  const app = Fastify();
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, raw, done) => {
    (request as unknown as { rawBody: Buffer }).rawBody = raw as Buffer;
    try { done(null, JSON.parse((raw as Buffer).toString("utf8"))); } catch (error) { done(error as Error, undefined); }
  });
  if (role) app.addHook("preHandler", async (request) => {
    request.user = { id: "99999999-9999-4999-8999-999999999999", email: "admin@haggle.ai", role };
  });
  registerOpsAlertRoutes(app, { execute: vi.fn().mockResolvedValue(rows) } as unknown as Database);
  await app.ready(); return app;
}

describe("conditional settlement finality alert receiver routes", () => {
  afterEach(() => {
    delete process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_SECRET;
    delete process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_PREVIOUS_SECRETS;
    vi.clearAllMocks();
  });

  it("accepts and completes a valid current-secret delivery", async () => {
    process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_SECRET = secret;
    vi.mocked(claimWebhookEvent).mockResolvedValue({ outcome: "acquired", source: "receiver", eventId: deliveryId, claimId: "claim" });
    vi.mocked(completeWebhookEvent).mockResolvedValue(true);
    const app = await makeApp(); const timestamp = new Date().toISOString(); const raw = body(timestamp);
    const response = await app.inject({ method: "POST", url: "/internal/ops/alerts/conditional-settlement-finality",
      headers: headers(raw, timestamp), payload: raw });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ accepted: true, replayed: false, state: "firing", severity: "critical" });
    expect(completeWebhookEvent).toHaveBeenCalledOnce(); await app.close();
  });

  it("accepts a previous rotation secret", async () => {
    process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_SECRET = secret;
    process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_PREVIOUS_SECRETS = previousSecret;
    vi.mocked(claimWebhookEvent).mockResolvedValue({ outcome: "acquired", source: "receiver", eventId: deliveryId, claimId: "claim" });
    vi.mocked(completeWebhookEvent).mockResolvedValue(true);
    const app = await makeApp(); const timestamp = new Date().toISOString(); const raw = body(timestamp);
    expect((await app.inject({ method: "POST", url: "/internal/ops/alerts/conditional-settlement-finality",
      headers: headers(raw, timestamp, previousSecret), payload: raw })).statusCode).toBe(202);
    await app.close();
  });

  it("fails closed for invalid rotation configuration without exposing secret material", async () => {
    process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_SECRET = secret;
    process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_PREVIOUS_SECRETS = "short";
    const app = await makeApp(); const timestamp = new Date().toISOString(); const raw = body(timestamp);
    const response = await app.inject({ method: "POST", url: "/internal/ops/alerts/conditional-settlement-finality",
      headers: headers(raw, timestamp), payload: raw });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "OPS_ALERT_RECEIVER_INVALID_CONFIGURATION" });
    expect(response.body).not.toContain("short"); expect(claimWebhookEvent).not.toHaveBeenCalled();
    await app.close();
  });

  it("bounds and validates the complete receiver rotation set", () => {
    delete process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_SECRET;
    process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_PREVIOUS_SECRETS = previousSecret;
    expect(() => resolveConditionalSettlementFinalityAlertReceiverSecretsFromEnv()).toThrow("current secret is required");
    process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_SECRET = secret;
    process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_PREVIOUS_SECRETS = secret;
    expect(() => resolveConditionalSettlementFinalityAlertReceiverSecretsFromEnv()).toThrow("must be unique");
    process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_PREVIOUS_SECRETS = "x".repeat(129);
    expect(() => resolveConditionalSettlementFinalityAlertReceiverSecretsFromEnv()).toThrow("16..128 characters");
    process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_PREVIOUS_SECRETS = [previousSecret, "previous-secret-02", "previous-secret-03"].join(",");
    expect(resolveConditionalSettlementFinalityAlertReceiverSecretsFromEnv()).toHaveLength(4);
    expect(getConditionalSettlementFinalityAlertReceiverPolicyStatus()).toMatchObject({ configurationState: "valid",
      acceptedSecretCount: 4, maxAcceptedSecretCount: 4 });
    const timestamp = new Date().toISOString(); const raw = body(timestamp);
    expect(verifyConditionalSettlementFinalityAlert({ rawBody: raw, timestamp, deliveryId,
      signature: headers(raw, timestamp)["x-haggle-alert-signature"], secret: [secret, previousSecret,
        "previous-secret-02", "previous-secret-03", "previous-secret-04"] }).ok).toBe(false);
  });

  it("returns replay and isolates payload conflicts", async () => {
    process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_SECRET = secret;
    vi.mocked(claimWebhookEvent).mockResolvedValueOnce({ outcome: "duplicate", source: "receiver", eventId: deliveryId })
      .mockResolvedValueOnce({ outcome: "payload_conflict", source: "receiver", eventId: deliveryId });
    const app = await makeApp(); const timestamp = new Date().toISOString(); const raw = body(timestamp);
    expect((await app.inject({ method: "POST", url: "/internal/ops/alerts/conditional-settlement-finality",
      headers: headers(raw, timestamp), payload: raw })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/internal/ops/alerts/conditional-settlement-finality",
      headers: headers(raw, timestamp), payload: raw })).statusCode).toBe(409);
    await app.close();
  });

  it("keeps in-progress and failed deliveries retryable", async () => {
    process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_SECRET = secret;
    vi.mocked(claimWebhookEvent).mockResolvedValueOnce({ outcome: "in_progress", source: "receiver", eventId: deliveryId })
      .mockResolvedValueOnce({ outcome: "retry_later", source: "receiver", eventId: deliveryId, retryAfterSeconds: 7 });
    const app = await makeApp(); const timestamp = new Date().toISOString(); const raw = body(timestamp);
    const inProgress = await app.inject({ method: "POST", url: "/internal/ops/alerts/conditional-settlement-finality",
      headers: headers(raw, timestamp), payload: raw });
    expect(inProgress.statusCode).toBe(503); expect(inProgress.headers["retry-after"]).toBe("2");
    expect(inProgress.json()).toEqual({ error: "ALERT_DELIVERY_IN_PROGRESS", retry_after_seconds: 2 });
    const backoff = await app.inject({ method: "POST", url: "/internal/ops/alerts/conditional-settlement-finality",
      headers: headers(raw, timestamp), payload: raw });
    expect(backoff.statusCode).toBe(503); expect(backoff.headers["retry-after"]).toBe("7");
    expect(backoff.json()).toEqual({ error: "ALERT_RETRY_BACKOFF", retry_after_seconds: 7 });
    await app.close();
  });

  it("rejects signed payloads with unapproved fields", async () => {
    process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_SECRET = secret;
    const app = await makeApp(); const timestamp = new Date().toISOString(); const raw = body(timestamp, { payment_id: "pi_secret" });
    const response = await app.inject({ method: "POST", url: "/internal/ops/alerts/conditional-settlement-finality",
      headers: headers(raw, timestamp), payload: raw });
    expect(response.statusCode).toBe(400); expect(response.json()).toEqual({ error: "INVALID_ALERT_BODY" });
    expect(claimWebhookEvent).not.toHaveBeenCalled(); await app.close();
  });

  it("rejects signed payloads whose aggregate contradicts its reasons", async () => {
    process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_SECRET = secret;
    const app = await makeApp(); const timestamp = new Date().toISOString();
    const parsed = JSON.parse(body(timestamp)) as Record<string, unknown>;
    parsed.health = { ...(parsed.health as Record<string, unknown>), orphanedReceipts: 0, rpcUnavailable: 1, status: "attention" };
    const raw = JSON.stringify(parsed);
    const response = await app.inject({ method: "POST", url: "/internal/ops/alerts/conditional-settlement-finality",
      headers: headers(raw, timestamp), payload: raw });
    expect(response.statusCode).toBe(400); expect(response.json()).toEqual({ error: "INVALID_ALERT_BODY" });
    expect(claimWebhookEvent).not.toHaveBeenCalled(); await app.close();
  });

  it("fails closed when unconfigured or stale and does not acknowledge failed completion", async () => {
    const app = await makeApp(); const current = new Date().toISOString(); const currentRaw = body(current);
    expect((await app.inject({ method: "POST", url: "/internal/ops/alerts/conditional-settlement-finality",
      headers: headers(currentRaw, current), payload: currentRaw })).statusCode).toBe(503);
    process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_SECRET = secret;
    const stale = new Date(Date.now() - 301_000).toISOString(); const staleRaw = body(stale);
    expect((await app.inject({ method: "POST", url: "/internal/ops/alerts/conditional-settlement-finality",
      headers: headers(staleRaw, stale), payload: staleRaw })).statusCode).toBe(401);
    vi.mocked(claimWebhookEvent).mockResolvedValue({ outcome: "acquired", source: "receiver", eventId: deliveryId, claimId: "claim" });
    vi.mocked(completeWebhookEvent).mockResolvedValue(false);
    vi.mocked(failWebhookEvent).mockResolvedValue(undefined);
    const fresh = new Date().toISOString(); const freshRaw = body(fresh);
    expect((await app.inject({ method: "POST", url: "/internal/ops/alerts/conditional-settlement-finality",
      headers: headers(freshRaw, fresh), payload: freshRaw })).statusCode).toBe(503);
    expect(failWebhookEvent).toHaveBeenCalledOnce();
    await app.close();
  });

  it("returns aggregate receiver health only to admins", async () => {
    process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_SECRET = secret;
    const rows = [{ processing: 0, completed: 2, failed: 0, stale_processing: 0, retry_ready: 0,
      last_completed_at: "2026-07-12T20:00:00.000Z" }];
    const admin = await makeApp("admin", rows);
    const response = await admin.inject({ method: "GET", url: "/admin/ops/alerts/conditional-settlement-finality/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ receiver_kind: "conditional_settlement_finality",
      receiver_health: { status: "healthy", completed: 2 },
      receiver_policy: { configured: true, acceptedSecretCount: 1, timestampToleranceSeconds: 300 } });
    expect(response.body).not.toContain(secret); await admin.close();
    const user = await makeApp("authenticated", rows);
    expect((await user.inject({ method: "GET", url: "/admin/ops/alerts/conditional-settlement-finality/health" })).statusCode).toBe(403);
    await user.close();
  });
});
