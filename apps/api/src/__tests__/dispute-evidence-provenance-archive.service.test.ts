import { describe, expect, it, vi } from "vitest";
import type { DisputeEvidenceProvenanceArchiveRecord } from "../services/dispute-evidence-provenance-archive.service.js";
import {
  deliverDisputeEvidenceProvenanceArchive,
  enqueueDisputeEvidenceProvenanceArchive,
  getDisputeEvidenceProvenanceArchiveHealth,
} from "../services/dispute-evidence-provenance-archive.service.js";

function archive(): DisputeEvidenceProvenanceArchiveRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    archiveKey: `dep_${"a".repeat(64)}`,
    evidenceId: "22222222-2222-4222-8222-222222222222",
    disputeId: "33333333-3333-4333-8333-333333333333",
    payload: { schema: "haggle.dispute-evidence-provenance-archive.v1", evidence: { id: "evidence" } },
    payloadSha256: "b".repeat(64), status: "PROCESSING", attemptCount: 1,
    nextAttemptAt: "2026-07-12T00:00:00.000Z", leaseToken: "44444444-4444-4444-8444-444444444444",
    leaseExpiresAt: "2026-07-12T00:02:00.000Z", lastError: null, httpStatus: null,
    receiptId: null, receiptSha256: null, deliveredAt: null,
    createdAt: "2026-07-12T00:00:00.000Z", updatedAt: "2026-07-12T00:00:00.000Z",
  };
}

const config = { url: "http://127.0.0.1:4177/mock-worm", timeoutMs: 1000, maxAttempts: 3,
  allowInsecureHttp: true, allowPrivateNetwork: true };

describe("dispute evidence provenance archive", () => {
  it("requires complete signed provenance before touching the database", async () => {
    const db = { execute: vi.fn() };
    await expect(enqueueDisputeEvidenceProvenanceArchive(db as never, {
      evidence: {
        id: "22222222-2222-4222-8222-222222222222",
        dispute_id: "33333333-3333-4333-8333-333333333333",
        submitted_by: "buyer", type: "image", created_at: "2026-07-12T00:00:00.000Z",
      },
    })).rejects.toThrow("EVIDENCE_PROVENANCE_ARCHIVE_INPUT_INCOMPLETE");
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("accepts only a receipt with the exact stored payload hash", async () => {
    const value = archive();
    const fetchImpl = vi.fn(async (_url, init?: RequestInit) => new Response(JSON.stringify({
      receipt_id: "worm-receipt-1",
      stored_sha256: new Headers(init?.headers).get("x-haggle-content-sha256"),
    }), { status: 201, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    await expect(deliverDisputeEvidenceProvenanceArchive(value, config, { fetchImpl })).resolves.toMatchObject({
      status: "delivered", receiptId: "worm-receipt-1", receiptSha256: value.payloadSha256,
    });
    expect(fetchImpl).toHaveBeenCalledWith(config.url, expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "idempotency-key": value.archiveKey, "x-haggle-content-sha256": value.payloadSha256 }),
    }));
  });

  it("rejects a successful HTTP response with a mismatched receipt hash", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      receipt_id: "worm-receipt-1", stored_sha256: "0".repeat(64),
    }), { status: 201, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    await expect(deliverDisputeEvidenceProvenanceArchive(archive(), config, { fetchImpl })).resolves.toMatchObject({
      status: "failed", error: "ARCHIVE_RECEIPT_HASH_MISMATCH",
    });
  });

  it("reports a signed-evidence coverage gap as critical", async () => {
    const db = { execute: vi.fn().mockResolvedValue([{
      pending: 0, processing: 0, failed: 0, dead_letter: 0, delivered: 2, stale_processing: 0,
      eligible_evidence: 3, archived_evidence: 2, coverage_gap: 1,
    }]) };
    await expect(getDisputeEvidenceProvenanceArchiveHealth(db as never)).resolves.toMatchObject({
      status: "critical", eligibleEvidence: 3, archivedEvidence: 2, coverageGap: 1, coveragePercent: 66.67,
    });
  });
});
