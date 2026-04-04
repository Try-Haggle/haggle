import type { Tag, TagConfig, TagCluster, MergeSuggestion } from "./types.js";
import { defaultTagConfig } from "./types.js";

// ---------------------------------------------------------------------------
// Levenshtein Distance (pure implementation, no external libs)
// ---------------------------------------------------------------------------

/**
 * Compute the Levenshtein edit distance between two strings.
 * Uses the Wagner-Fischer dynamic programming algorithm with
 * a single-row optimization for O(min(m,n)) space.
 */
export function levenshtein(a: string, b: string): number {
  // Early termination cases
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Ensure a is the shorter string for space optimization
  if (a.length > b.length) {
    const tmp = a;
    a = b;
    b = tmp;
  }

  const aLen = a.length;
  const bLen = b.length;

  // Single-row DP: previous row values
  const row: number[] = new Array(aLen + 1);
  for (let i = 0; i <= aLen; i++) {
    row[i] = i;
  }

  for (let j = 1; j <= bLen; j++) {
    let prev = row[0];
    row[0] = j;

    for (let i = 1; i <= aLen; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const val = Math.min(
        row[i] + 1, // deletion
        row[i - 1] + 1, // insertion
        prev + cost, // substitution
      );
      prev = row[i];
      row[i] = val;
    }
  }

  return row[aLen];
}

// ---------------------------------------------------------------------------
// Synonym Lookup
// ---------------------------------------------------------------------------

/**
 * Check if two tag names are synonyms according to the synonym map.
 * Returns the canonical form if found, or undefined.
 */
export function findSynonymCanonical(
  name: string,
  synonymMap: Record<string, string[]>,
): string | undefined {
  // Check if the name itself is a canonical key
  if (name in synonymMap) return name;

  // Check if the name appears in any synonym list
  for (const [canonical, synonyms] of Object.entries(synonymMap)) {
    if (synonyms.includes(name)) return canonical;
  }

  return undefined;
}

/**
 * Check if two normalized tag names are synonyms of each other.
 */
export function areSynonyms(
  nameA: string,
  nameB: string,
  synonymMap: Record<string, string[]>,
): boolean {
  const canonA = findSynonymCanonical(nameA, synonymMap);
  const canonB = findSynonymCanonical(nameB, synonymMap);

  if (canonA === undefined || canonB === undefined) return false;
  return canonA === canonB;
}

// ---------------------------------------------------------------------------
// Similar Tag Detection
// ---------------------------------------------------------------------------

/**
 * Find all tags similar to a given tag from a pool of tags.
 * Uses Levenshtein distance to detect near-duplicates within the configured threshold.
 */
export function findSimilarTags(
  target: Tag,
  pool: Tag[],
  config: TagConfig = defaultTagConfig(),
): TagCluster {
  const similar: Tag[] = [];
  const distances: number[] = [];

  for (const candidate of pool) {
    if (candidate.id === target.id) continue;

    const dist = levenshtein(target.normalizedName, candidate.normalizedName);
    if (dist <= config.levenshteinThreshold && dist > 0) {
      similar.push(candidate);
      distances.push(dist);
    }
  }

  return {
    canonical: target,
    similar,
    distances,
  };
}

// ---------------------------------------------------------------------------
// Merge Suggestions
// ---------------------------------------------------------------------------

/**
 * Generate merge suggestions for a set of tags.
 * Identifies pairs that should be merged based on:
 * 1. Levenshtein distance within threshold
 * 2. Synonym map matches
 *
 * Suggestions are deduplicated: if A->B is suggested, B->A is not.
 * The tag with higher useCount is always the target (merge into).
 */
export function suggestMerges(
  tags: Tag[],
  config: TagConfig = defaultTagConfig(),
): MergeSuggestion[] {
  const suggestions: MergeSuggestion[] = [];
  const seen = new Set<string>();

  // O(n^2) pairwise comparison — intentional at MVP tag pool sizes.
  for (let i = 0; i < tags.length; i++) {
    for (let j = i + 1; j < tags.length; j++) {
      const a = tags[i];
      const b = tags[j];
      const pairKey = [a.id, b.id].sort().join("|");

      if (seen.has(pairKey)) continue;

      // Determine source (merge from) and target (merge into)
      // Higher useCount becomes the target
      const [source, target] = a.useCount >= b.useCount ? [b, a] : [a, b];

      // Check Levenshtein distance
      const dist = levenshtein(a.normalizedName, b.normalizedName);
      if (dist > 0 && dist <= config.levenshteinThreshold) {
        seen.add(pairKey);
        suggestions.push({
          source,
          target,
          reason: "levenshtein",
          distance: dist,
        });
        continue;
      }

      // Check synonym map
      if (areSynonyms(a.normalizedName, b.normalizedName, config.synonymMap)) {
        seen.add(pairKey);
        suggestions.push({
          source,
          target,
          reason: "synonym",
        });
      }
    }
  }

  return suggestions;
}
