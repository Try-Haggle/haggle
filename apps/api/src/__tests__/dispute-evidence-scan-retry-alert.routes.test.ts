import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@haggle/db";
import { registerOpsAlertRoutes } from "../routes/ops-alerts.js";
import { signWebhookClaimAlertPayload } from
  "../services/webhook-claim-alert.service.js";
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

const secret = "scan-retry-receiver-current-secret";
const previousSecret = "scan-retry-receiver-previous-secret";
const deliveryId = `health_${"e".repeat(64)}`;

function body(timestamp: string, overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    schema_version: "dispute-evidence-scan-retry-alert-v3",
    type: "dispute_evidence_scan_retry.health",
    delivery_id: deliveryId,
    state: "firing",
    created_at: timestamp,
    severity: "critical",
    reasons: ["alert_snapshot_retention_blocked"],
    thresholds: {
      retry_ready: 10,
      stale_processing: 1,
      exhausted: 1,
      expired_quarantined: 1,
      retention_blocked_expired: 1,
    },
    health: {
      totals: {
        quarantined: 0,
        pending: 0,
        failed: 0,
        processing: 0,
        stale_processing: 0,
        retry_ready: 0,
        exhausted: 0,
        expired_quarantined: 0,
      },
      oldest_unresolved_age_seconds: null,
      circuit: {
        state: "CLOSED",
        consecutive_failures: 0,
        active_permits: 0,
        max_concurrent: 4,
        failure_threshold: 3,
      },
      retention: {
        eligible_expired: 0,
        blocked_expired: 1,
        oldest_blocked_expired_age_seconds: 60,
        job: {
          active: false,
          status: "inactive",
          last_run_status: "FAILED",
          overdue: false,
          lease_stale: false,
          last_deleted_snapshots: 0,
          interval_seconds: 86_400,
          max_start_delay_seconds: 93_600,
        },
      },
    },
    ...overrides,
  });
}

function headers(raw: string, timestamp: string, signingSecret = secret) {
  return {
    "content-type": "application/json",
    "x-haggle-alert-timestamp": timestamp,
    "x-haggle-alert-delivery-id": deliveryId,
    "x-haggle-alert-signature": signWebhookClaimAlertPayload(
      signingSecret, timestamp, raw,
    ),
  };
}

async function makeApp(
  role?: "admin" | "authenticated",
  rows: Array<Record<string, unknown>> | Error = [],
) {
  const app = Fastify();
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (request, raw, done) => {
      (request as unknown as { rawBody: Buffer }).rawBody = raw as Buffer;
      try {
        done(null, JSON.parse((raw as Buffer).toString("utf8")));
      } catch (error) {
        done(error as Error, undefined);
      }
    },
  );
  if (role) {
    app.addHook("preHandler", async (request) => {
      request.user = {
        id: "99999999-9999-4999-8999-999999999999",
        email: "admin@haggle.ai",
        role,
      };
    });
  }
  registerOpsAlertRoutes(app, {
    execute: rows instanceof Error
      ? vi.fn().mockRejectedValue(rows)
      : vi.fn().mockResolvedValue(rows),
  } as unknown as Database);
  await app.ready();
  return app;
}

describe("dispute evidence scan retry alert receiver routes", () => {
  afterEach(() => {
    delete process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_SECRET;
    delete process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_PREVIOUS_SECRETS;
    vi.clearAllMocks();
  });

  it("accepts and completes a valid aggregate-only delivery", async () => {
    process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_SECRET = secret;
    vi.mocked(claimWebhookEvent).mockResolvedValue({
      outcome: "acquired", source: "receiver", eventId: deliveryId,
      claimId: "claim", attemptCount: 1,
    });
    vi.mocked(completeWebhookEvent).mockResolvedValue(true);
    const app = await makeApp();
    const timestamp = new Date().toISOString();
    const raw = body(timestamp);
    const response = await app.inject({
      method: "POST",
      url: "/internal/ops/alerts/dispute-evidence-scan-retry",
      headers: headers(raw, timestamp),
      payload: raw,
    });
    expect(response.statusCode).toBe(202);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      accepted: true, replayed: false, state: "firing", severity: "critical",
    });
    expect(claimWebhookEvent).toHaveBeenCalledWith(expect.anything(), {
      source: "haggle-dispute-evidence-scan-retry-alert-receiver",
      eventId: deliveryId,
      payloadSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(completeWebhookEvent).toHaveBeenCalledOnce();
    await app.close();
  });

  it("accepts one previous rotation secret", async () => {
    process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_SECRET = secret;
    process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_PREVIOUS_SECRETS =
      previousSecret;
    vi.mocked(claimWebhookEvent).mockResolvedValue({
      outcome: "acquired", source: "receiver", eventId: deliveryId,
      claimId: "claim", attemptCount: 1,
    });
    vi.mocked(completeWebhookEvent).mockResolvedValue(true);
    const app = await makeApp();
    const timestamp = new Date().toISOString();
    const raw = body(timestamp);
    const response = await app.inject({
      method: "POST",
      url: "/internal/ops/alerts/dispute-evidence-scan-retry",
      headers: headers(raw, timestamp, previousSecret),
      payload: raw,
    });
    expect(response.statusCode).toBe(202);
    await app.close();
  });

  it("fails closed for missing or invalid receiver configuration", async () => {
    const app = await makeApp();
    const timestamp = new Date().toISOString();
    const raw = body(timestamp);
    expect((await app.inject({
      method: "POST",
      url: "/internal/ops/alerts/dispute-evidence-scan-retry",
      headers: headers(raw, timestamp), payload: raw,
    })).statusCode).toBe(503);
    process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_SECRET = secret;
    process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_PREVIOUS_SECRETS = "short";
    const invalid = await app.inject({
      method: "POST",
      url: "/internal/ops/alerts/dispute-evidence-scan-retry",
      headers: headers(raw, timestamp), payload: raw,
    });
    expect(invalid.statusCode).toBe(503);
    expect(invalid.json()).toEqual({
      error: "OPS_ALERT_RECEIVER_INVALID_CONFIGURATION",
    });
    expect(invalid.body).not.toContain("short");
    expect(claimWebhookEvent).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects non-JSON and oversized bodies before claim storage", async () => {
    process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_SECRET = secret;
    const app = await makeApp();
    const timestamp = new Date().toISOString();
    const raw = body(timestamp);
    const unsupported = await app.inject({
      method: "POST",
      url: "/internal/ops/alerts/dispute-evidence-scan-retry",
      headers: { ...headers(raw, timestamp), "content-type": "text/plain" },
      payload: raw,
    });
    expect(unsupported.statusCode).toBe(415);
    expect(unsupported.headers["cache-control"]).toBe("no-store");
    expect(unsupported.json()).toEqual({ error: "UNSUPPORTED_MEDIA_TYPE" });

    const oversized = body(timestamp, { padding: "x".repeat(17 * 1024) });
    const tooLarge = await app.inject({
      method: "POST",
      url: "/internal/ops/alerts/dispute-evidence-scan-retry",
      headers: headers(oversized, timestamp),
      payload: oversized,
    });
    expect(tooLarge.statusCode).toBe(413);
    expect(tooLarge.headers["cache-control"]).toBe("no-store");
    expect(claimWebhookEvent).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns completed replay and isolates payload conflict", async () => {
    process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_SECRET = secret;
    vi.mocked(claimWebhookEvent)
      .mockResolvedValueOnce({
        outcome: "duplicate", source: "receiver", eventId: deliveryId,
      })
      .mockResolvedValueOnce({
        outcome: "payload_conflict", source: "receiver", eventId: deliveryId,
      });
    const app = await makeApp();
    const timestamp = new Date().toISOString();
    const raw = body(timestamp);
    const request = {
      method: "POST" as const,
      url: "/internal/ops/alerts/dispute-evidence-scan-retry",
      headers: headers(raw, timestamp), payload: raw,
    };
    expect((await app.inject(request)).statusCode).toBe(200);
    expect((await app.inject(request)).statusCode).toBe(409);
    expect(completeWebhookEvent).not.toHaveBeenCalled();
    await app.close();
  });

  it("keeps processing and failed deliveries retryable", async () => {
    process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_SECRET = secret;
    vi.mocked(claimWebhookEvent)
      .mockResolvedValueOnce({
        outcome: "in_progress", source: "receiver", eventId: deliveryId,
      })
      .mockResolvedValueOnce({
        outcome: "retry_later", source: "receiver", eventId: deliveryId,
        retryAfterSeconds: 7,
      });
    const app = await makeApp();
    const timestamp = new Date().toISOString();
    const raw = body(timestamp);
    const request = {
      method: "POST" as const,
      url: "/internal/ops/alerts/dispute-evidence-scan-retry",
      headers: headers(raw, timestamp), payload: raw,
    };
    const processing = await app.inject(request);
    expect(processing.statusCode).toBe(503);
    expect(processing.headers["retry-after"]).toBe("2");
    const backoff = await app.inject(request);
    expect(backoff.statusCode).toBe(503);
    expect(backoff.headers["retry-after"]).toBe("7");
    await app.close();
  });

  it("rejects stale, tampered, and semantically contradictory bodies", async () => {
    process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_SECRET = secret;
    const app = await makeApp();
    const staleTimestamp = new Date(Date.now() - 301_000).toISOString();
    const staleRaw = body(staleTimestamp);
    expect((await app.inject({
      method: "POST",
      url: "/internal/ops/alerts/dispute-evidence-scan-retry",
      headers: headers(staleRaw, staleTimestamp), payload: staleRaw,
    })).statusCode).toBe(401);
    const timestamp = new Date().toISOString();
    const raw = body(timestamp, { evidence_id: "hidden" });
    expect((await app.inject({
      method: "POST",
      url: "/internal/ops/alerts/dispute-evidence-scan-retry",
      headers: headers(raw, timestamp), payload: raw,
    })).statusCode).toBe(400);
    const contradictory = JSON.parse(body(timestamp)) as {
      health: { retention: { blocked_expired: number } };
    };
    contradictory.health.retention.blocked_expired = 0;
    const contradictoryRaw = JSON.stringify(contradictory);
    expect((await app.inject({
      method: "POST",
      url: "/internal/ops/alerts/dispute-evidence-scan-retry",
      headers: headers(contradictoryRaw, timestamp),
      payload: contradictoryRaw,
    })).statusCode).toBe(400);
    expect(claimWebhookEvent).not.toHaveBeenCalled();
    await app.close();
  });

  it("records completion failure for bounded retry", async () => {
    process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_SECRET = secret;
    vi.mocked(claimWebhookEvent).mockResolvedValue({
      outcome: "acquired", source: "receiver", eventId: deliveryId,
      claimId: "claim", attemptCount: 1,
    });
    vi.mocked(completeWebhookEvent).mockRejectedValue(
      new Error("WEBHOOK_CLAIM_LOST"),
    );
    vi.mocked(failWebhookEvent).mockResolvedValue(undefined);
    const app = await makeApp();
    const timestamp = new Date().toISOString();
    const raw = body(timestamp);
    const response = await app.inject({
      method: "POST",
      url: "/internal/ops/alerts/dispute-evidence-scan-retry",
      headers: headers(raw, timestamp), payload: raw,
    });
    expect(response.statusCode).toBe(503);
    expect(response.headers["retry-after"]).toBe("2");
    expect(failWebhookEvent).toHaveBeenCalledOnce();
    await app.close();
  });

  it("redacts receiver claim storage failures", async () => {
    process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_SECRET = secret;
    vi.mocked(claimWebhookEvent).mockRejectedValue(
      new Error("postgres://private-user:private-password@db.internal"),
    );
    const app = await makeApp();
    const timestamp = new Date().toISOString();
    const raw = body(timestamp);
    const response = await app.inject({
      method: "POST",
      url: "/internal/ops/alerts/dispute-evidence-scan-retry",
      headers: headers(raw, timestamp), payload: raw,
    });
    expect(response.statusCode).toBe(503);
    expect(response.headers["retry-after"]).toBe("2");
    expect(response.json()).toEqual({
      error: "ALERT_RECEIVER_UNAVAILABLE", retry_after_seconds: 2,
    });
    expect(response.body).not.toMatch(/private|postgres|internal/);
    await app.close();
  });

  it("returns identifier-free receiver health only to admins", async () => {
    process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_SECRET = secret;
    const rows = [{
      processing: 0, completed: 2, failed: 0, staleProcessing: 0,
      retryReady: 0, maxAttemptCount: 2,
      oldestUnfinishedAgeSeconds: null,
      lastCompletedAt: "2026-07-14T08:30:00.000Z",
    }];
    const admin = await makeApp("admin", rows);
    const response = await admin.inject({
      method: "GET",
      url: "/admin/ops/alerts/dispute-evidence-scan-retry/health",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      receiver_kind: "dispute_evidence_scan_retry",
      receiver_health: {
        status: "healthy", completed: 2, containsIdentifiers: false,
      },
      receiver_policy: {
        configured: true, acceptedSecretCount: 1,
        timestampToleranceSeconds: 300,
      },
    });
    expect(response.body).not.toMatch(/delivery_id|claim_id|source|secret/);
    await admin.close();
    const nonAdmin = await makeApp("authenticated", rows);
    expect((await nonAdmin.inject({
      method: "GET",
      url: "/admin/ops/alerts/dispute-evidence-scan-retry/health",
    })).statusCode).toBe(403);
    await nonAdmin.close();
  });

  it("redacts receiver health storage failures", async () => {
    process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_SECRET = secret;
    const app = await makeApp(
      "admin", new Error("postgres://private-user@db.internal"),
    );
    const response = await app.inject({
      method: "GET",
      url: "/admin/ops/alerts/dispute-evidence-scan-retry/health",
    });
    expect(response.statusCode).toBe(503);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      error: "OPS_ALERT_RECEIVER_HEALTH_UNAVAILABLE",
    });
    expect(response.body).not.toMatch(/private|postgres|internal/);
    await app.close();
  });
});
