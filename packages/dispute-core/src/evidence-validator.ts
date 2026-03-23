import type { DisputeEvidence } from "./types.js";
import { REASON_CODE_REGISTRY, type DisputeReasonCode } from "./reason-codes.js";

export interface EvidenceValidationResult {
  valid: boolean;
  missing_types: string[];
  warnings: string[];
}

export function validateEvidenceForReasonCode(
  reason_code: DisputeReasonCode,
  evidence: DisputeEvidence[],
): EvidenceValidationResult {
  const metadata = REASON_CODE_REGISTRY[reason_code];
  if (!metadata) {
    return { valid: false, missing_types: [], warnings: [`unknown reason code: ${reason_code}`] };
  }

  const submittedTypes = new Set(evidence.map(e => e.type));
  const missing_types = metadata.requires_evidence_types.filter(t => !submittedTypes.has(t));

  const warnings: string[] = [];
  // Check for empty text evidence
  for (const e of evidence) {
    if (e.type === "text" && (!e.text || e.text.trim().length === 0)) {
      warnings.push(`evidence ${e.id} is text type but has no content`);
    }
    if (e.type === "image" && !e.uri) {
      warnings.push(`evidence ${e.id} is image type but has no URI`);
    }
  }

  return {
    valid: missing_types.length === 0,
    missing_types,
    warnings,
  };
}
