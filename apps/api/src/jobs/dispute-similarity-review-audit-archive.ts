import type { Database } from "@haggle/db";
import {
  dispatchDisputeSimilarityReviewAuditArchives,
  enqueuePendingDisputeSimilarityReviewAudits,
} from "../services/dispute-similarity-review-audit-archive.service.js";

export async function runDisputeSimilarityReviewAuditArchive(db: Database) {
  const queued = await enqueuePendingDisputeSimilarityReviewAudits(db);
  const delivered = await dispatchDisputeSimilarityReviewAuditArchives(db);
  if (queued.enqueued > 0 || (delivered.status === "processed" && delivered.claimed > 0)) {
    console.log(`[dispute-similarity-review-audit-archive] enqueued=${queued.enqueued} claimed=${delivered.claimed} delivered=${delivered.delivered}`);
  }
  return { queued, delivered };
}
