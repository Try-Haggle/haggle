import type { Database } from "@haggle/db";
import { expireDisputeSimilarityReviews } from "../services/dispute-similarity-review-expiry.service.js";

export async function runDisputeSimilarityReviewExpiry(db: Database) {
  const result = await expireDisputeSimilarityReviews(db);
  if (result.expired > 0)
    console.log(`[dispute-similarity-review-expiry] expired=${result.expired}`);
  return result;
}
