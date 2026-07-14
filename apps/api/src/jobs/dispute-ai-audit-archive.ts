import type { Database } from "@haggle/db";
import { dispatchDisputeAiAuditArchives, enqueuePendingDisputeAiAudits } from "../services/dispute-ai-audit-archive.service.js";

export async function runDisputeAiAuditArchive(db: Database) {
  const discovered = await enqueuePendingDisputeAiAudits(db);
  const dispatched = await dispatchDisputeAiAuditArchives(db);
  return { discovered, dispatched };
}
