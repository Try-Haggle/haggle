import type { Database } from "@haggle/db";
import { runDisputeEvidenceScanRetry } from
  "../services/dispute-evidence-scan-retry.service.js";

export async function runDisputeEvidenceScanRetryJob(
  db: Database,
): Promise<void> {
  const result = await runDisputeEvidenceScanRetry(db);
  if (result.status === "completed" && result.claimed > 0) {
    console.log(
      `[dispute-evidence-scan-retry] claimed=${result.claimed}`
      + ` clean=${result.clean} infected=${result.infected}`
      + ` retry_scheduled=${result.retryScheduled}`
      + ` exhausted=${result.exhausted}`
      + ` stale_finalizers=${result.staleFinalizersRejected}`,
    );
  }
}
