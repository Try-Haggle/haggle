import { describe, expect, it, vi } from "vitest";
import {
  deliverDisputeSimilarityReviewAuditArchive,
  getDisputeSimilarityReviewAuditArchiveHealth,
  listDisputeSimilarityReviewAuditArchiveFailures,
  resolveDisputeSimilarityReviewAuditArchiveConfigFromEnv,
  type DisputeSimilarityReviewAuditArchiveConfig,
  type DisputeSimilarityReviewAuditArchiveRecord,
} from "../services/dispute-similarity-review-audit-archive.service.js";
import type { Database } from "@haggle/db";

const archive: DisputeSimilarityReviewAuditArchiveRecord = {
  id: "11111111-1111-4111-8111-111111111111", archiveKey: `dsre_${"a".repeat(64)}`,
  eventId: "22222222-2222-4222-8222-222222222222", payload: { manifest: { event_id: "event-1" } },
  payloadSha256: "b".repeat(64), status: "PROCESSING", attemptCount: 1,
  nextAttemptAt: "2026-07-12T00:00:00.000Z", leaseToken: "33333333-3333-4333-8333-333333333333",
  leaseExpiresAt: "2026-07-12T00:02:00.000Z", lastError: null, httpStatus: null,
  receiptId: null, receiptSha256: null, deliveredAt: null,
  createdAt: "2026-07-12T00:00:00.000Z", updatedAt: "2026-07-12T00:00:00.000Z",
};
const config: DisputeSimilarityReviewAuditArchiveConfig = {
  url: "https://worm.example/audits", timeoutMs: 1000, maxAttempts: 3,
  allowInsecureHttp: false, allowPrivateNetwork: false,
};

describe("dispute similarity review audit WORM archive", () => {
  it("accepts a matching write-once receipt and sends idempotency headers", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      receipt_id: "receipt-1", stored_sha256: archive.payloadSha256,
    }), { status: 201 }));
    await expect(deliverDisputeSimilarityReviewAuditArchive(archive, config, { fetchImpl: fetchImpl as typeof fetch }))
      .resolves.toEqual({ status: "delivered", httpStatus: 201, receiptId: "receipt-1", receiptSha256: archive.payloadSha256 });
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    expect(init.headers).toMatchObject({ "idempotency-key": archive.archiveKey, "x-haggle-content-sha256": archive.payloadSha256 });
  });

  it("rejects a successful HTTP response with a mismatched receipt hash", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      receipt_id: "receipt-1", stored_sha256: "c".repeat(64),
    }), { status: 201 }));
    await expect(deliverDisputeSimilarityReviewAuditArchive(archive, config, { fetchImpl: fetchImpl as typeof fetch }))
      .resolves.toMatchObject({ status: "failed", error: "ARCHIVE_RECEIPT_HASH_MISMATCH" });
  });

  it("rejects oversized receipt bodies", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("x".repeat(16_385), { status: 201 }));
    await expect(deliverDisputeSimilarityReviewAuditArchive(archive, config, { fetchImpl: fetchImpl as typeof fetch }))
      .resolves.toMatchObject({ status: "failed", error: "ARCHIVE_RECEIPT_TOO_LARGE" });
  });

  it("rejects private archive targets without explicit local-test overrides", () => {
    const previous = { ...process.env };
    process.env.HAGGLE_AUDIT_ARCHIVE_URL = "http://127.0.0.1:9000/audits";
    delete process.env.HAGGLE_AUDIT_ARCHIVE_ALLOW_INSECURE_HTTP;
    delete process.env.HAGGLE_AUDIT_ARCHIVE_ALLOW_PRIVATE_NETWORK;
    try { expect(() => resolveDisputeSimilarityReviewAuditArchiveConfigFromEnv()).toThrow(); }
    finally { process.env = previous; }
  });

  it("maps aggregate dead-letter health without identifiers", async () => {
    const execute = vi.fn().mockResolvedValue([{
      pending: 0, processing: 0, failed: 0, dead_letter: 1, stale_processing: 0,
      retry_ready: 0, overdue_unfinished: 1, oldest_unfinished_age_seconds: 1200,
    }]);
    const result = await getDisputeSimilarityReviewAuditArchiveHealth(
      { execute } as unknown as Database, new Date("2026-07-12T01:00:00.000Z"),
    );
    expect(result).toMatchObject({ status: "critical", deadLetter: 1, overdueUnfinished: 1, oldestUnfinishedAgeSeconds: 1200 });
  });

  it("returns payload-free cursor failures and rejects malformed cursors before DB", async () => {
    const row = {
      id: archive.id, archive_key: archive.archiveKey, event_id: archive.eventId,
      payload: archive.payload, payload_sha256: archive.payloadSha256, status: "DEAD_LETTER",
      attempt_count: 3, next_attempt_at: archive.nextAttemptAt, lease_token: null, lease_expires_at: null,
      last_error: "ARCHIVE_RECEIPT_HASH_MISMATCH", http_status: 201, receipt_id: null,
      receipt_sha256: null, delivered_at: null, created_at: archive.createdAt, updated_at: archive.updatedAt,
    };
    const execute = vi.fn().mockResolvedValue([row, { ...row, id: "44444444-4444-4444-8444-444444444444" }]);
    const result = await listDisputeSimilarityReviewAuditArchiveFailures({ execute } as unknown as Database, {
      limit: 1, now: new Date("2026-07-12T01:00:00.000Z"),
    });
    expect(result.items[0]).toMatchObject({ eventId: archive.eventId, status: "DEAD_LETTER", attemptCount: 3 });
    expect(result.nextCursor).toEqual(expect.any(String));
    expect(JSON.stringify(result)).not.toContain("archiveKey");
    expect(JSON.stringify(result)).not.toContain("manifest");
    const noQuery = vi.fn();
    await expect(listDisputeSimilarityReviewAuditArchiveFailures({ execute: noQuery } as unknown as Database, { cursor: "broken" }))
      .rejects.toThrow("INVALID_SIMILARITY_REVIEW_AUDIT_ARCHIVE_FAILURE_CURSOR");
    expect(noQuery).not.toHaveBeenCalled();
  });
});
