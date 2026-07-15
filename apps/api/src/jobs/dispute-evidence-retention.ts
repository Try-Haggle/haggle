import type { Database } from "@haggle/db";
import { stripDisputeEvidenceBucket } from "../lib/dispute-storage-paths.js";
import {
  claimEvidenceRetentionBatch,
  completeEvidenceRetentionDeletion,
  countEligibleEvidenceRetention,
  evidenceRetentionPolicy,
  failEvidenceRetentionDeletion,
  releaseRetentionClaimForHold,
  retentionClaimStillAuthorized,
} from "../services/dispute-evidence-retention.service.js";
import { deleteDisputeEvidence } from "../services/dispute-storage.service.js";

export async function runDisputeEvidenceRetention(
  db: Database,
  options: { dryRun?: boolean } = {},
): Promise<{
  dry_run: boolean;
  eligible: number;
  claimed: number;
  deleted: number;
  failed: number;
  held: number;
}> {
  const policy = evidenceRetentionPolicy();
  const eligible = await countEligibleEvidenceRetention(db, policy);
  if (options.dryRun)
    return { dry_run: true, eligible, claimed: 0, deleted: 0, failed: 0, held: 0 };
  const claims = await claimEvidenceRetentionBatch(db, policy);
  let deleted = 0;
  let failed = 0;
  let held = 0;
  for (const claim of claims) {
    if (!(await retentionClaimStillAuthorized(db, claim))) {
      await releaseRetentionClaimForHold(db, claim);
      held += 1;
      continue;
    }
    try {
      await deleteDisputeEvidence(stripDisputeEvidenceBucket(claim.storagePath));
      if (await completeEvidenceRetentionDeletion(db, claim)) deleted += 1;
      else failed += 1;
    } catch {
      await failEvidenceRetentionDeletion(db, claim);
      failed += 1;
    }
  }
  return { dry_run: false, eligible, claimed: claims.length, deleted, failed, held };
}
