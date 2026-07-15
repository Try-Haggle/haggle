import type { Database } from "@haggle/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deliverShipmentApvCancellationAuditArchive,
  enqueueShipmentApvCancellationAuditArchive,
  getShipmentApvCancellationAuditArchiveDeliveryPolicyStatus,
  getShipmentApvCancellationAuditArchiveHealth,
  listShipmentApvCancellationAuditArchiveFailures,
  requeueShipmentApvCancellationAuditArchive,
  type ShipmentApvCancellationAuditArchiveConfig,
  type ShipmentApvCancellationAuditArchiveRecord,
} from "../services/shipment-apv-payout-cancellation-audit-archive.service.js";

const archive: ShipmentApvCancellationAuditArchiveRecord = {
  id: "11111111-1111-4111-8111-111111111111",
  archiveKey: `apvca_${"a".repeat(64)}`,
  cancellationRequestId: "22222222-2222-4222-8222-222222222222",
  payload: { manifest: { schema: "haggle.shipment-apv-payout-cancellation-audit.v1" } },
  payloadSha256: "b".repeat(64),
  status: "PROCESSING",
  attemptCount: 1,
  nextAttemptAt: "2026-07-12T00:00:00.000Z",
  leaseToken: "33333333-3333-4333-8333-333333333333",
  leaseExpiresAt: "2026-07-12T00:02:00.000Z",
  lastError: null,
  httpStatus: null,
  receiptId: null,
  receiptSha256: null,
  deliveredAt: null,
  createdAt: "2026-07-12T00:00:00.000Z",
  updatedAt: "2026-07-12T00:00:00.000Z",
};
const config: ShipmentApvCancellationAuditArchiveConfig = {
  url: "https://archive.example/audits",
  bearerToken: "archive-token",
  timeoutMs: 5000,
  maxAttempts: 3,
  allowInsecureHttp: false,
  allowPrivateNetwork: false,
};

describe("shipment APV cancellation audit archive delivery", () => {
  afterEach(() => {
    delete process.env.HAGGLE_AUDIT_ARCHIVE_URL;
    delete process.env.HAGGLE_AUDIT_ARCHIVE_ALLOW_INSECURE_HTTP;
    delete process.env.HAGGLE_AUDIT_ARCHIVE_ALLOW_PRIVATE_NETWORK;
  });
  it("accepts a receipt only when the write-once store confirms the exact payload hash", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          receipt_id: "worm_receipt_1",
          stored_sha256: archive.payloadSha256,
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    );
    await expect(
      deliverShipmentApvCancellationAuditArchive(archive, config, { fetchImpl: fetchMock }),
    ).resolves.toEqual({
      status: "delivered",
      httpStatus: 201,
      receiptId: "worm_receipt_1",
      receiptSha256: archive.payloadSha256,
    });
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.headers).toMatchObject({
      "idempotency-key": archive.archiveKey,
      "x-haggle-content-sha256": archive.payloadSha256,
      authorization: "Bearer archive-token",
    });
  });

  it("rejects a successful HTTP response with a mismatched storage receipt", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          receipt_id: "worm_receipt_2",
          stored_sha256: "c".repeat(64),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    await expect(
      deliverShipmentApvCancellationAuditArchive(archive, config, { fetchImpl: fetchMock }),
    ).resolves.toMatchObject({ status: "failed", error: "ARCHIVE_RECEIPT_HASH_MISMATCH" });
  });

  it("blocks private archive destinations unless explicitly allowed", async () => {
    await expect(
      deliverShipmentApvCancellationAuditArchive(archive, {
        ...config,
        url: "https://127.0.0.1/audits",
      }),
    ).rejects.toThrow("must not target localhost or private network hosts");
  });

  it("refuses to archive a non-terminal lifecycle", async () => {
    await expect(
      enqueueShipmentApvCancellationAuditArchive({} as Database, {
        cancellationRequestId: archive.cancellationRequestId,
        events: [],
      }),
    ).rejects.toThrow("APV_PAYOUT_CANCELLATION_AUDIT_NOT_FINAL");
  });

  it("rejects an oversized receipt response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("x".repeat(16_385), { status: 200 }));
    await expect(
      deliverShipmentApvCancellationAuditArchive(archive, config, { fetchImpl: fetchMock }),
    ).resolves.toMatchObject({ status: "failed", error: "ARCHIVE_RECEIPT_TOO_LARGE" });
  });

  it("requeues only delivery state while preserving the signed payload hash and auditing once", async () => {
    const row = {
      id: archive.id,
      archive_key: archive.archiveKey,
      cancellation_request_id: archive.cancellationRequestId,
      payload: archive.payload,
      payload_sha256: archive.payloadSha256,
      status: "DEAD_LETTER",
      attempt_count: 3,
      next_attempt_at: archive.nextAttemptAt,
      lease_token: null,
      lease_expires_at: null,
      last_error: "HTTP 503",
      http_status: 503,
      receipt_id: null,
      receipt_sha256: null,
      delivered_at: null,
      created_at: archive.createdAt,
      updated_at: archive.updatedAt,
    };
    const execute = vi
      .fn()
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([
        { ...row, status: "PENDING", attempt_count: 0, last_error: null, http_status: null },
      ])
      .mockResolvedValueOnce([]);
    const db = {
      transaction: (callback: (tx: { execute: typeof execute }) => unknown) =>
        callback({ execute }),
    } as unknown as Database;
    const result = await requeueShipmentApvCancellationAuditArchive(db, {
      cancellationRequestId: archive.cancellationRequestId,
      actorId: "99999999-9999-4999-8999-999999999999",
      reason: "External archive endpoint recovered after maintenance.",
      now: new Date("2026-07-12T01:00:00.000Z"),
    });
    expect(result).toMatchObject({
      outcome: "requeued",
      archive: {
        status: "PENDING",
        attemptCount: 0,
        payloadSha256: archive.payloadSha256,
        payload: archive.payload,
      },
    });
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("marks an old pending archive as attention before it dead-letters", async () => {
    const execute = vi.fn().mockResolvedValue([
      {
        pending: 1,
        processing: 0,
        failed: 0,
        dead_letter: 0,
        stale_processing: 0,
        retry_ready: 0,
        overdue_unfinished: 1,
        oldest_unfinished_age_seconds: 901,
      },
    ]);
    const result = await getShipmentApvCancellationAuditArchiveHealth(
      { execute } as unknown as Database,
      new Date("2026-07-12T01:00:00.000Z"),
    );
    expect(result).toMatchObject({
      status: "attention",
      pending: 1,
      overdueUnfinished: 1,
      unfinishedMaxAgeMinutes: 15,
      oldestUnfinishedAgeSeconds: 901,
    });
  });

  it("distinguishes missing, invalid, and valid delivery configuration", () => {
    expect(getShipmentApvCancellationAuditArchiveDeliveryPolicyStatus().configurationState).toBe(
      "not_configured",
    );
    process.env.HAGGLE_AUDIT_ARCHIVE_URL = "http://archive.example/audits";
    expect(getShipmentApvCancellationAuditArchiveDeliveryPolicyStatus().configurationState).toBe(
      "invalid",
    );
    process.env.HAGGLE_AUDIT_ARCHIVE_URL = "https://archive.example/audits";
    expect(getShipmentApvCancellationAuditArchiveDeliveryPolicyStatus()).toMatchObject({
      configured: true,
      configurationState: "valid",
    });
  });

  it("lists failed archives with an opaque cursor and without signed payloads", async () => {
    const row = (id: string, createdAt: string) => ({
      id,
      archive_key: `apvca_${"a".repeat(64)}`,
      cancellation_request_id: archive.cancellationRequestId,
      payload: { secret: "not returned" },
      payload_sha256: archive.payloadSha256,
      status: "DEAD_LETTER",
      attempt_count: 3,
      next_attempt_at: createdAt,
      lease_token: null,
      lease_expires_at: null,
      last_error: "HTTP 503",
      http_status: 503,
      receipt_id: null,
      receipt_sha256: null,
      delivered_at: null,
      created_at: createdAt,
      updated_at: createdAt,
    });
    const execute = vi
      .fn()
      .mockResolvedValue([
        row("11111111-1111-4111-8111-111111111111", "2026-07-12T00:00:00.000Z"),
        row("22222222-2222-4222-8222-222222222222", "2026-07-12T00:01:00.000Z"),
      ]);
    const result = await listShipmentApvCancellationAuditArchiveFailures(
      { execute } as unknown as Database,
      { limit: 1, now: new Date("2026-07-12T01:00:00.000Z") },
    );
    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toEqual(expect.any(String));
    expect(result.items[0]).not.toHaveProperty("payload");
    expect(JSON.stringify(result)).not.toContain("not returned");
  });

  it("rejects a malformed failure cursor before querying the database", async () => {
    const execute = vi.fn();
    await expect(
      listShipmentApvCancellationAuditArchiveFailures({ execute } as unknown as Database, {
        cursor: "broken",
      }),
    ).rejects.toThrow("INVALID_APV_AUDIT_ARCHIVE_FAILURE_CURSOR");
    expect(execute).not.toHaveBeenCalled();
  });
});
