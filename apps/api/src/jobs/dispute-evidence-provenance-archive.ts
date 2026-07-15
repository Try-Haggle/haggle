import type { Database } from "@haggle/db";
import { dispatchDisputeEvidenceProvenanceArchives } from "../services/dispute-evidence-provenance-archive.service.js";

export async function runDisputeEvidenceProvenanceArchive(db: Database) {
  return dispatchDisputeEvidenceProvenanceArchives(db);
}
