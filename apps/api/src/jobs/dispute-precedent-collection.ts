import type { Database } from "@haggle/db";
import { collectDisputePrecedentCandidates } from "../services/dispute-precedent.service.js";

export async function runDisputePrecedentCollection(
  db: Database,
): Promise<{ scanned: number; inserted: number }> {
  return collectDisputePrecedentCandidates(db);
}
