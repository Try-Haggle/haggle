import type { Database } from "@haggle/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/dispute-evidence-retention.service.js", () => ({
  evidenceRetentionPolicy: vi.fn(() => ({ committedDays: 90, orphanDays: 7, batchSize: 50 })),
  countEligibleEvidenceRetention: vi.fn(),
  claimEvidenceRetentionBatch: vi.fn(),
  retentionClaimStillAuthorized: vi.fn(),
  releaseRetentionClaimForHold: vi.fn(),
  completeEvidenceRetentionDeletion: vi.fn(),
  failEvidenceRetentionDeletion: vi.fn(),
}));

vi.mock("../services/dispute-storage.service.js", () => ({
  deleteDisputeEvidence: vi.fn(),
}));

import { runDisputeEvidenceRetention } from "../jobs/dispute-evidence-retention.js";
import {
  claimEvidenceRetentionBatch,
  completeEvidenceRetentionDeletion,
  countEligibleEvidenceRetention,
  failEvidenceRetentionDeletion,
  releaseRetentionClaimForHold,
  retentionClaimStillAuthorized,
} from "../services/dispute-evidence-retention.service.js";
import { deleteDisputeEvidence } from "../services/dispute-storage.service.js";

const db = {} as Database;
const claim = {
  uploadId: "11111111-1111-4111-8111-111111111111",
  disputeId: "22222222-2222-4222-8222-222222222222",
  storagePath: "dispute-evidence/22222222-2222-4222-8222-222222222222/evidence.jpg",
  claimId: "33333333-3333-4333-8333-333333333333",
  deletionAttempts: 1,
  retentionUntil: new Date("2026-07-01T00:00:00.000Z"),
};

describe("dispute evidence retention job", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(countEligibleEvidenceRetention).mockResolvedValue(1);
    vi.mocked(claimEvidenceRetentionBatch).mockResolvedValue([claim]);
    vi.mocked(retentionClaimStillAuthorized).mockResolvedValue(true);
    vi.mocked(completeEvidenceRetentionDeletion).mockResolvedValue(true);
    vi.mocked(deleteDisputeEvidence).mockResolvedValue(undefined);
  });

  it("supports a deletion-free dry run", async () => {
    const result = await runDisputeEvidenceRetention(db, { dryRun: true });
    expect(result).toEqual({
      dry_run: true,
      eligible: 1,
      claimed: 0,
      deleted: 0,
      failed: 0,
      held: 0,
    });
    expect(claimEvidenceRetentionBatch).not.toHaveBeenCalled();
    expect(deleteDisputeEvidence).not.toHaveBeenCalled();
  });

  it("deletes an authorized storage object and seals the DB state", async () => {
    const result = await runDisputeEvidenceRetention(db);
    expect(deleteDisputeEvidence).toHaveBeenCalledWith(
      "22222222-2222-4222-8222-222222222222/evidence.jpg",
    );
    expect(completeEvidenceRetentionDeletion).toHaveBeenCalledWith(db, claim);
    expect(result).toMatchObject({ claimed: 1, deleted: 1, failed: 0, held: 0 });
  });

  it("releases a claim without deleting when a legal hold wins", async () => {
    vi.mocked(retentionClaimStillAuthorized).mockResolvedValueOnce(false);
    const result = await runDisputeEvidenceRetention(db);
    expect(releaseRetentionClaimForHold).toHaveBeenCalledWith(db, claim);
    expect(deleteDisputeEvidence).not.toHaveBeenCalled();
    expect(result).toMatchObject({ deleted: 0, held: 1 });
  });

  it("records a retryable failure without exposing the provider error", async () => {
    vi.mocked(deleteDisputeEvidence).mockRejectedValueOnce(new Error("secret provider detail"));
    const result = await runDisputeEvidenceRetention(db);
    expect(failEvidenceRetentionDeletion).toHaveBeenCalledWith(db, claim);
    expect(result).toMatchObject({ deleted: 0, failed: 1 });
  });
});
