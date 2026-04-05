import type {
  TagConfig,
  ExpertTag,
  ExpertCandidateInput,
} from "./types.js";
import { defaultTagConfig } from "./types.js";

// ---------------------------------------------------------------------------
// Expert Tag Qualification
// ---------------------------------------------------------------------------

/**
 * Check if a user qualifies for expert status on a given tag/category.
 * Requirements (configurable via TagConfig):
 *   - caseCount >= expertMinCases (default: 50)
 *   - accuracy >= expertMinAccuracy (default: 0.85)
 */
export function isExpertQualified(
  candidate: ExpertCandidateInput,
  config: TagConfig = defaultTagConfig(),
): boolean {
  return (
    candidate.caseCount >= config.expertMinCases &&
    candidate.accuracy >= config.expertMinAccuracy
  );
}

/**
 * Attempt to qualify a candidate as an expert.
 * Returns an ExpertTag if qualified, or null if not.
 *
 * @param candidate The candidate input data
 * @param nowIso Current datetime as ISO string (used for qualifiedAt)
 * @param config Tag configuration
 */
// Note: date validation of nowIso is the caller's responsibility.
export function qualifyExpert(
  candidate: ExpertCandidateInput,
  nowIso: string,
  config: TagConfig = defaultTagConfig(),
): ExpertTag | null {
  if (!isExpertQualified(candidate, config)) {
    return null;
  }

  return {
    userId: candidate.userId,
    tagId: candidate.tagId,
    category: candidate.category,
    caseCount: candidate.caseCount,
    accuracy: candidate.accuracy,
    qualifiedAt: nowIso,
  };
}

/**
 * Evaluate multiple candidates and return all who qualify as experts.
 */
export function qualifyExperts(
  candidates: ExpertCandidateInput[],
  nowIso: string,
  config: TagConfig = defaultTagConfig(),
): ExpertTag[] {
  const results: ExpertTag[] = [];
  for (const candidate of candidates) {
    const expert = qualifyExpert(candidate, nowIso, config);
    if (expert !== null) {
      results.push(expert);
    }
  }
  return results;
}
