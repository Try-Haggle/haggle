// ---------------------------------------------------------------------------
// Tag Status Lifecycle
// ---------------------------------------------------------------------------

export type TagStatus = "CANDIDATE" | "EMERGING" | "OFFICIAL" | "DEPRECATED";

// ---------------------------------------------------------------------------
// Tag
// ---------------------------------------------------------------------------

export interface Tag {
  id: string;
  name: string;
  normalizedName: string;
  status: TagStatus;
  category: string;
  useCount: number;
  createdAt: string;
  lastUsedAt: string;
  parentId?: string;
}

// ---------------------------------------------------------------------------
// Tag Config (all thresholds injectable, with defaults)
// ---------------------------------------------------------------------------

export interface TagConfig {
  /** Min uses to promote CANDIDATE -> EMERGING */
  candidateToEmergingUses: number;
  /** Min uses to promote EMERGING -> OFFICIAL */
  emergingToOfficialUses: number;
  /** Days unused before auto-deprecation */
  deprecationDaysUnused: number;
  /** Max length for a tag name after normalization */
  maxTagLength: number;
  /** Levenshtein distance threshold for similar tag detection */
  levenshteinThreshold: number;
  /** Min cases for expert tag qualification */
  expertMinCases: number;
  /** Min accuracy for expert tag qualification */
  expertMinAccuracy: number;
  /** Synonym map: key is canonical form, values are synonyms */
  synonymMap: Record<string, string[]>;
}

export function defaultTagConfig(): TagConfig {
  return {
    candidateToEmergingUses: 10,
    emergingToOfficialUses: 50,
    deprecationDaysUnused: 90,
    maxTagLength: 50,
    levenshteinThreshold: 2,
    expertMinCases: 50,
    expertMinAccuracy: 0.85,
    synonymMap: {},
  };
}

// ---------------------------------------------------------------------------
// Tag Cluster (similar/duplicate tag grouping)
// ---------------------------------------------------------------------------

export interface TagCluster {
  canonical: Tag;
  similar: Tag[];
  distances: number[];
}

// ---------------------------------------------------------------------------
// Merge Suggestion
// ---------------------------------------------------------------------------

export interface MergeSuggestion {
  source: Tag;
  target: Tag;
  reason: "levenshtein" | "synonym";
  distance?: number;
}

// ---------------------------------------------------------------------------
// Expert Tag
// ---------------------------------------------------------------------------

export interface ExpertTag {
  userId: string;
  tagId: string;
  category: string;
  caseCount: number;
  accuracy: number;
  qualifiedAt: string;
}

// ---------------------------------------------------------------------------
// Expert Qualification Input
// ---------------------------------------------------------------------------

export interface ExpertCandidateInput {
  userId: string;
  tagId: string;
  category: string;
  caseCount: number;
  accuracy: number;
}

// ---------------------------------------------------------------------------
// Validation Result
// ---------------------------------------------------------------------------

export interface TagValidationResult {
  valid: boolean;
  normalized: string;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Lifecycle Transition Result
// ---------------------------------------------------------------------------

export interface LifecycleResult {
  tag: Tag;
  previousStatus: TagStatus;
  newStatus: TagStatus;
  transitioned: boolean;
  reason: string;
}
