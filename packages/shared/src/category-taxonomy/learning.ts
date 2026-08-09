/**
 * Dynamic taxonomy learning (L7 / H7) — the "Tag Garden gets smarter" half of the
 * category backbone.
 *
 * The static CATEGORY_TAXONOMY (taxonomy.ts) is the seeded "what to ask per
 * category" set. This module adds the *dynamic* half: when a particular
 * negotiation question keeps being needed for a category but is NOT already a
 * taxonomy default, it is learned and promoted into that category's checks.
 *
 * Design constraints (Group 2 loop discipline):
 *  - PURE + deterministic + additive. The static taxonomy is never mutated; the
 *    overlay (resolveChecksWithLearned) is a *separate* function so resolveChecks
 *    keeps byte-identical behavior.
 *  - Promoted checks are ALWAYS soft/non-blocking. A learned check has no
 *    satisfaction logic, so a hard one would wedge the buyer builder forever
 *    (the P12 lesson). Enforcement escalation is a deliberate later step.
 *  - Shadow / unconsumed in production for now. The observation source (sensor
 *    "mentioned but no matching check" signals, builder ad-hoc questions) is wired
 *    in a later slice behind a real store — see the // TODO(observation-source) seam
 *    in recordCheckObservation.
 */

import { getCategoryNode, matchedCategoryPaths } from "./taxonomy.js";
import type { NegotiationCheck } from "./types.js";

/**
 * One recorded instance that a question/check was needed for a category, from a
 * single source (a negotiation session, a builder conversation, a listing…).
 * Multiple observations of the same check from *distinct* sources are what drive
 * promotion — one chatty session must not promote anything on its own.
 */
export interface LearnedCheckObservation {
  /** Category node this was observed under, e.g. "electronics/phones" or "vehicles". */
  categoryPath: string;
  /** The question that was needed (human, Korean). */
  questionKo: string;
  /** Optional engine feature key if the observed question maps to a FEATURE_SCHEMA key. */
  featureKey?: string;
  /** Optional stable check id; when absent a slug is derived from the question. */
  checkId?: string;
  /** Distinct source identifier (session id, listing id, user id…). */
  sourceId: string;
}

/** A check that has been learned + promoted for a category. */
export interface LearnedCheck extends NegotiationCheck {
  /** Category node the learned check attaches to. */
  categoryPath: string;
  /** Evidence behind the promotion. */
  support: {
    occurrences: number;
    distinctSources: number;
  };
}

export interface PromotionOptions {
  /** Total observations required before a check can promote. Default 3. */
  minOccurrences?: number;
  /** Distinct sources required (guards against one loud session). Default 2. */
  minDistinctSources?: number;
}

const DEFAULT_MIN_OCCURRENCES = 3;
const DEFAULT_MIN_DISTINCT_SOURCES = 2;

/** Store abstraction so the promotion algorithm is decoupled from persistence. */
export interface LearnedCheckStore {
  record(observation: LearnedCheckObservation): void;
  observations(): LearnedCheckObservation[];
}

/**
 * Default in-memory store. Deterministic (insertion order preserved); swap for a
 * DB-backed store when the observation source is wired live.
 */
export function createInMemoryLearnedCheckStore(): LearnedCheckStore {
  const rows: LearnedCheckObservation[] = [];
  return {
    record(observation) {
      rows.push({ ...observation });
    },
    observations() {
      return rows.slice();
    },
  };
}

/**
 * Record a single observation into a store.
 *
 * // TODO(observation-source): production callers do not exist yet. The intended
 * feeders are (1) the sensor (L3) when the opponent/user *mentions* something with
 * no matching taxonomy check/feature for the category, and (2) builder ad-hoc
 * questions. Those live behind DB persistence (protected boundary) and land in a
 * follow-up slice; this seam keeps the promotion brain testable in the meantime.
 */
export function recordCheckObservation(
  store: LearnedCheckStore,
  observation: LearnedCheckObservation,
): void {
  store.record(observation);
}

/**
 * Normalize a category path so casing / trailing slashes cannot defeat the static
 * dedup guard or the overlay's path matching. Static nodes and matchedCategoryPaths
 * are lowercase and slash-trimmed, so learned observations must be too.
 */
function normalizeCategoryPath(path: string): string {
  return path.trim().toLowerCase().replace(/\/+$/g, "").replace(/^\/+/g, "");
}

/** Deterministic 32-bit FNV-1a hash → base36. Disambiguates slug collisions. */
function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Derive a stable, deterministic slug id from a question when no checkId/featureKey
 * is given. A hash of the FULL question is always appended so two different
 * questions (even ones sharing a 48-char prefix, or emoji/punctuation-only ones that
 * slugify to empty) never collide into the same learned check.
 */
function slugFromQuestion(questionKo: string): string {
  const normalized = questionKo.trim().toLowerCase();
  const slug = normalized
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `learned:${slug ? `${slug}-` : ""}${hashText(normalized)}`;
}

/**
 * Grouping key for observations of "the same check" within a category. Returns null
 * when the observation cannot identify a check at all (no checkId, no featureKey, and
 * a blank question) — such observations are unusable and dropped rather than promoted
 * as an empty-question check.
 */
function observationKey(observation: LearnedCheckObservation): string | null {
  if (observation.checkId) return observation.checkId;
  if (observation.featureKey) return observation.featureKey;
  if (observation.questionKo.trim()) return slugFromQuestion(observation.questionKo);
  return null;
}

/** All ancestor paths of a path (inclusive), e.g. a/b/c -> [a, a/b, a/b/c]. */
function ancestorPaths(path: string): string[] {
  const parts = path.split("/");
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
}

/**
 * Is this check id / feature key already a *static* taxonomy default at this
 * category path (or any ancestor)? If so it is already known — not new learning —
 * and must not be re-promoted.
 */
function staticallyKnown(categoryPath: string, key: string, featureKey?: string): boolean {
  for (const path of ancestorPaths(categoryPath)) {
    const node = getCategoryNode(path);
    if (!node) continue;
    for (const check of node.checks) {
      if (check.id === key) return true;
      if (featureKey && check.featureKey === featureKey) return true;
    }
  }
  return false;
}

/**
 * The promotion brain: fold observations into learned checks. A check promotes for
 * a category only when it clears BOTH thresholds (total occurrences and distinct
 * sources) and is not already a static taxonomy default there. Pure + deterministic:
 * output is sorted by categoryPath then check id.
 */
export function promoteLearnedChecks(
  observations: readonly LearnedCheckObservation[],
  options: PromotionOptions = {},
): LearnedCheck[] {
  const minOccurrences = options.minOccurrences ?? DEFAULT_MIN_OCCURRENCES;
  const minDistinctSources = options.minDistinctSources ?? DEFAULT_MIN_DISTINCT_SOURCES;

  type Bucket = {
    categoryPath: string;
    key: string;
    questionKo: string;
    featureKey?: string;
    occurrences: number;
    sources: Set<string>;
  };
  const buckets = new Map<string, Bucket>();

  for (const observation of observations) {
    const categoryPath = normalizeCategoryPath(observation.categoryPath);
    if (!categoryPath) continue;
    const key = observationKey(observation);
    if (!key) continue; // unidentifiable observation (no checkId/featureKey/question)
    const bucketId = `${categoryPath} ${key}`;
    let bucket = buckets.get(bucketId);
    if (!bucket) {
      bucket = {
        categoryPath,
        key,
        questionKo: observation.questionKo,
        featureKey: observation.featureKey,
        occurrences: 0,
        sources: new Set(),
      };
      buckets.set(bucketId, bucket);
    }
    bucket.occurrences += 1;
    bucket.sources.add(observation.sourceId);
    // Keep the latest non-empty question / featureKey seen for this bucket.
    if (observation.questionKo.trim()) bucket.questionKo = observation.questionKo;
    if (observation.featureKey) bucket.featureKey = observation.featureKey;
  }

  const promoted: LearnedCheck[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.occurrences < minOccurrences) continue;
    if (bucket.sources.size < minDistinctSources) continue;
    if (staticallyKnown(bucket.categoryPath, bucket.key, bucket.featureKey)) continue;

    promoted.push({
      id: bucket.key,
      questionKo: bucket.questionKo,
      featureKey: bucket.featureKey,
      // Learned checks are always advisory — no satisfaction logic exists, so a
      // hard one would wedge the builder (P12 lesson). Escalation is a later step.
      enforcement: "soft",
      categoryPath: bucket.categoryPath,
      support: {
        occurrences: bucket.occurrences,
        distinctSources: bucket.sources.size,
      },
    });
  }

  return promoted.sort(
    (a, b) => a.categoryPath.localeCompare(b.categoryPath) || a.id.localeCompare(b.id),
  );
}

/**
 * Overlay: the static taxonomy checks for a tag set PLUS any learned checks whose
 * category node the tags resolve to (same matching + inheritance as resolveChecks).
 * Static checks win on id collision; learned checks are appended (soft), sorted by
 * id for determinism. resolveChecks itself is untouched — this is purely additive.
 */
export function resolveChecksWithLearned(
  tags: readonly string[],
  learned: readonly LearnedCheck[],
  base: readonly NegotiationCheck[],
): NegotiationCheck[] {
  const applicablePaths = new Set(matchedCategoryPaths(tags));
  const seen = new Set(base.map((c) => c.id));

  const extra = learned
    .filter((l) => applicablePaths.has(l.categoryPath) && !seen.has(l.id))
    .map<NegotiationCheck>((l) => ({
      id: l.id,
      questionKo: l.questionKo,
      featureKey: l.featureKey,
      enforcement: "soft",
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  // Dedup within the learned extras too (two learned checks could share an id
  // across category paths that both resolved).
  const deduped: NegotiationCheck[] = [];
  for (const check of extra) {
    if (seen.has(check.id)) continue;
    seen.add(check.id);
    deduped.push(check);
  }

  return [...base, ...deduped];
}
