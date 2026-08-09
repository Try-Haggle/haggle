/**
 * Category-check learning service (taxonomy cold-start → warm flywheel).
 *
 * Feature ②: for a tag/category the static taxonomy does not cover, the agent-builder
 * asks the question via the LLM every time. When the SAME question recurs for the same
 * category across DISTINCT listings, that is evidence the taxonomy is missing a check —
 * so we record it, and once it clears the promotion thresholds it is served
 * deterministically (no API call) as a SOFT overlay check.
 *
 * Safety posture:
 *  - Promotion requires ≥3 observations from ≥2 distinct sources (one chatty seller
 *    cannot promote anything). Enforced by `promoteLearnedChecks` in @haggle/shared.
 *  - Learned checks are ALWAYS soft — they can never become a blocking deal-breaker.
 *  - Operators can SUPPRESS a row; suppressed checks are never served or re-promoted.
 *  - Recording is best-effort: a failure must never break a builder turn.
 */

import {
  and,
  type Database,
  eq,
  inArray,
  learnedCategoryCheckEvidence,
  learnedCategoryChecks,
  sql,
} from "@haggle/db";
import {
  type LearnedCheck,
  type LearnedCheckObservation,
  matchedCategoryPaths,
  promoteLearnedChecks,
} from "@haggle/shared";

/** Where an observation came from — lets a noisy feeder be identified and disabled. */
export type ObservationOrigin = "BUILDER" | "NEGOTIATION" | "SENSOR" | "UNKNOWN";

export interface RecordObservationInput extends LearnedCheckObservation {
  origin?: ObservationOrigin;
}

/** Promotion thresholds — mirrored from the shared defaults so both paths agree. */
export const PROMOTION_MIN_OCCURRENCES = 3;
export const PROMOTION_MIN_DISTINCT_SOURCES = 2;

/**
 * Namespace for a scope derived from a listing TAG rather than a taxonomy path.
 *
 * Taxonomy paths look like `electronics/phones`, so the prefix makes a tag scope
 * unmistakable and impossible to collide with a real node — including a future node
 * literally named after the tag.
 */
export const TAG_SCOPE_PREFIX = "tag:";

/**
 * Category buckets that identify nothing. Scoping learning to these would pool a brass
 * telescope's questions with a ceramic vase's and serve each to the other.
 */
const GENERIC_SCOPE_TAGS = new Set([
  "other",
  "others",
  "misc",
  "miscellaneous",
  "general",
  "etc",
  "unknown",
  "uncategorized",
  // NOT "기타": it reads as "etc." in a category picker but the taxonomy claims it as a
  // GUITAR alias, so it resolves `instruments` and never reaches this fallback anyway.
  // Listing it here would only mislead the next reader.
]);

/**
 * How many tag scopes one observation may be recorded under.
 *
 * We do NOT try to guess which tag names the item type — for `["vintage", "brass",
 * "1900s"]` any single pick is arbitrary, and picking "1900s" would be worse than
 * useless. Record under each candidate and let the promotion thresholds decide: a tag
 * that genuinely identifies the item recurs across DISTINCT listings ("telescope"),
 * while an incidental attribute does not ("1900s"), so only the meaningful scope ever
 * clears ≥3 occurrences from ≥2 sources. The cap bounds the write amplification.
 */
const MAX_TAG_SCOPES = 3;

function tagScopes(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().toLowerCase();
    if (!tag || GENERIC_SCOPE_TAGS.has(tag) || seen.has(tag)) continue;
    seen.add(tag);
    out.push(`${TAG_SCOPE_PREFIX}${tag}`);
    if (out.length >= MAX_TAG_SCOPES) break;
  }
  return out;
}

/**
 * Where an observation from this listing is RECORDED.
 *
 * A listing that resolves the taxonomy is attributed to its most specific node only —
 * an iPhone question must not be learned onto every electronics listing. A listing that
 * resolves nothing (category "other", no modelled tags) used to be dropped outright,
 * which meant the flywheel never covered the genuinely uncategorised long tail it exists
 * for: a brass telescope could be asked about forever and never learn anything. Those
 * fall back to tag scopes.
 */
export function learningWriteScopes(tags: readonly string[]): string[] {
  const paths = matchedCategoryPaths(tags);
  const mostSpecific = paths.at(-1);
  return mostSpecific ? [mostSpecific] : tagScopes(tags);
}

/**
 * Where checks for this listing are LOOKED UP: every matched node (so a check learned on
 * an ancestor still serves a descendant) plus the listing's tag scopes.
 */
export function learningReadScopes(tags: readonly string[]): string[] {
  return [...matchedCategoryPaths(tags), ...tagScopes(tags)];
}

/**
 * Framing words that carry no topic signal. Nearly every scaffold ask is built from
 * the same skeleton ("Should the agent require ... before closing?"), so leaving these
 * in makes unrelated questions look similar and hides the words that actually differ.
 */
const QUESTION_STOPWORDS = new Set([
  "should",
  "the",
  "agent",
  "require",
  "requires",
  "required",
  "be",
  "being",
  "been",
  "is",
  "are",
  "was",
  "were",
  "am",
  "a",
  "an",
  "of",
  "any",
  "or",
  "and",
  "to",
  "for",
  "do",
  "does",
  "did",
  "done",
  "you",
  "your",
  "yours",
  "it",
  "its",
  "in",
  "on",
  "at",
  "as",
  "with",
  "without",
  "that",
  "this",
  "these",
  "those",
  "there",
  "here",
  "have",
  "has",
  "had",
  "before",
  "after",
  "closing",
  "close",
  "please",
  "would",
  "could",
  "can",
  "will",
  "shall",
  "may",
  "might",
  "must",
  "what",
  "whats",
  "which",
  "who",
  "whom",
  "when",
  "where",
  "how",
  "why",
  "if",
  "not",
  "no",
  "yes",
  "also",
  "just",
  "item",
  "items",
  "product",
  "listing",
  "me",
  "my",
  "i",
  "we",
  "us",
  "they",
  "them",
  "he",
  "she",
  "about",
  "from",
  "into",
  "than",
  "then",
  // Prepositions and particles. The short list above had in/on/at but not these, so
  // "Any haze or fungus INSIDE the lenses?" kept "inside" as if it were a topic word and
  // scored 0.40 against "any INTERNAL haze ON the lenses?" — two phrasings of one check
  // held apart by a function word.
  "inside",
  "outside",
  "within",
  "around",
  "under",
  "over",
  "through",
  "between",
  "near",
  "across",
  "during",
  "per",
  "onto",
  "upon",
  "off",
  "out",
  "up",
  "down",
  "so",
  "but",
  "all",
  "some",
  "more",
  "most",
  "like",
  // Negation stems left behind once a contraction tail is stripped ("doesn't" → "doesn")
  "dont",
  "don",
  "doesn",
  "isn",
  "arent",
  "aren",
  "wasn",
  "weren",
  "won",
  "couldn",
  "shouldn",
  "wouldn",
  "hasn",
  "haven",
  "hadn",
  "didn",
  // Korean particles / common interrogative endings
  "은",
  "는",
  "이",
  "가",
  "을",
  "를",
  "의",
  "에",
  "에서",
  "와",
  "과",
  "도",
  "만",
  "인가요",
  "있나요",
  "없나요",
  "한가요",
  "하나요",
  "입니까",
  "인지",
  "여부",
]);

/**
 * Content words of a question, normalized so wording differences collapse.
 *
 * Sorted + deduped so the result doubles as a canonical identity: "&" becomes "and",
 * and every separator ("loan/lien", "loan-lien", "loan or lien") tokenizes the same.
 * That exact gap is what let a reworded copy of the taxonomy's own lien gate get
 * recorded as a NEW learned check during e2e.
 */
export function questionTokens(text: string): string[] {
  const normalized = text
    .toLowerCase()
    .replace(/&/g, " and ")
    // Drop contraction tails FIRST. Stripping punctuation blindly turns "what's" into
    // "what" + a stray "s", which then counts as a content word and makes two phrasings
    // of one question look different.
    .replace(/['’](s|t|re|ve|ll|d|m)\b/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  if (!normalized) return [];
  const tokens = normalized
    .split(/\s+/)
    // A lone Latin letter is always a fragment, never a topic word. Single Hangul
    // syllables are left alone — the particle list above handles those.
    .filter((t) => t && !/^[a-z]$/.test(t) && !QUESTION_STOPWORDS.has(t));
  return [...new Set(tokens)].sort();
}

/**
 * Jaccard overlap of two questions' content words, 0..1. Set-based rather than
 * sequence-based because a reworded question keeps the same nouns while freely
 * reordering everything around them.
 */
export function questionSimilarity(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const bSet = new Set(b);
  let shared = 0;
  for (const t of a) if (bSet.has(t)) shared++;
  return shared / (a.length + b.length - shared);
}

/**
 * At or above this overlap, a question is treated as one we already ask. Set from the
 * real e2e miss: the recorded lien question and the taxonomy's own `buyerAskKo` reduce
 * to an identical token set (1.0), while genuinely different checks in the same
 * category ("water damage" vs "frame damage") sit near 0.3.
 */
export const LEARNING_DUPLICATE_SIMILARITY = 0.7;

/**
 * At or above this overlap, a new question is folded into a learned check ALREADY stored
 * for the same scope instead of starting its own row.
 *
 * Deliberately lower than `LEARNING_DUPLICATE_SIMILARITY`, because the two comparisons
 * fail in opposite directions. Suppressing against the taxonomy DROPS a signal, so it
 * stays conservative; refusing to cluster leaves every phrasing stuck at one occurrence
 * and nothing ever promotes — which is exactly what the brass-telescope e2e produced:
 * seven rows, all at 1, for what a person reads as three or four checks.
 *
 * Calibrated on those real rows. "And any internal haze on the lenses?" vs "And any
 * fungus or haze on the lenses?" scores 0.50 and must merge; every other pair in that
 * set sits at 0.20 or below, and the earlier "water damage" vs "frame damage" case is
 * 0.33 — all still comfortably separate.
 */
export const LEARNING_CLUSTER_SIMILARITY = 0.5;

/**
 * Stable per-category key for an observation. Mirrors the shared algorithm's precedence
 * (explicit checkId > featureKey > question slug) so the aggregate row and the promoted
 * check agree on identity.
 *
 * The question form keys off NORMALIZED content words, so two phrasings of the same
 * question ("What is its cosmetic condition?" / "What's the cosmetic condition?") pool
 * into one aggregate row and reach the promotion threshold together instead of sitting
 * forever at one occurrence each.
 */
export function observationCheckKey(observation: LearnedCheckObservation): string {
  const explicit = observation.checkId?.trim();
  if (explicit) return explicit.toLowerCase();
  const feature = observation.featureKey?.trim();
  if (feature) return feature.toLowerCase();
  const tokens = questionTokens(observation.questionKo);
  // Punctuation/emoji-only or pure-boilerplate "questions" carry no learnable content —
  // treat as unidentifiable rather than storing a hash-only row.
  if (tokens.length === 0) return "";
  const canonical = tokens.join(" ");
  const slug = canonical
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9가-힣-]/g, "")
    .slice(0, 48);
  if (!slug.replace(/-/g, "")) return "";
  // A hash of the FULL canonical form is always appended so two long questions sharing
  // a 48-char prefix can never pool into one aggregate row.
  return `q-${slug}-${hashText(canonical)}`;
}

/** Deterministic 32-bit FNV-1a hash → base36 (mirrors the shared slug algorithm). */
function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function normalizePath(path: string): string {
  return path
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, "");
}

/**
 * Record one observation. Idempotent per (category, check, source): re-recording from the
 * SAME source bumps nothing, which is what keeps `distinct_source_count` honest.
 *
 * Never throws — the caller is a user-facing builder turn.
 */
/**
 * Fold a reworded question into the check it already belongs to.
 *
 * `observationCheckKey` only pools questions whose normalized token sets are IDENTICAL,
 * so anything the model rephrases starts a fresh row. Across turns that means a scope
 * accumulates near-duplicates that each sit at one occurrence forever and never clear
 * the promotion bar. Compare against what is already stored for this scope and reuse the
 * closest match's key.
 *
 * Returns the fresh key unchanged when nothing is close enough — or when the key came
 * from an explicit checkId/featureKey, which is already canonical and must never be
 * re-pointed at some other row.
 *
 * SUPPRESSED rows are not clustering candidates: an operator silencing one question must
 * not turn that row into a sink that permanently swallows every similar-but-distinct
 * question after it. A verbatim re-ask still lands on the suppressed row by exact key.
 */
async function clusterCheckKey(
  db: Database,
  categoryPath: string,
  freshKey: string,
  question: string,
): Promise<string> {
  if (!freshKey.startsWith("q-")) return freshKey;
  const tokens = questionTokens(question);
  if (tokens.length === 0) return freshKey;

  const rows = await db
    .select({
      checkKey: learnedCategoryChecks.checkKey,
      questionKo: learnedCategoryChecks.questionKo,
      status: learnedCategoryChecks.status,
    })
    .from(learnedCategoryChecks)
    .where(eq(learnedCategoryChecks.categoryPath, categoryPath));

  let bestKey = freshKey;
  let bestScore = 0;
  for (const row of rows) {
    // The row this question would have created anyway — nothing to cluster.
    if (row.checkKey === freshKey) return freshKey;
    if (row.status === "SUPPRESSED") continue;
    const score = questionSimilarity(tokens, questionTokens(row.questionKo));
    if (score >= LEARNING_CLUSTER_SIMILARITY && score > bestScore) {
      bestKey = row.checkKey;
      bestScore = score;
    }
  }
  return bestKey;
}

export async function recordCategoryCheckObservation(
  db: Database,
  input: RecordObservationInput,
): Promise<{ recorded: boolean; reason?: string }> {
  try {
    const categoryPath = normalizePath(input.categoryPath);
    const freshKey = observationCheckKey(input);
    const question = input.questionKo?.trim();
    if (!categoryPath || !freshKey || !question) {
      return { recorded: false, reason: "unidentifiable" };
    }
    const sourceKey = input.sourceId?.trim();
    if (!sourceKey) return { recorded: false, reason: "no_source" };

    const checkKey = await clusterCheckKey(db, categoryPath, freshKey, question);
    // When this observation joined an existing check, that check keeps its own wording —
    // its key was derived from it, so overwriting would leave key and text describing
    // different questions. The exact phrasing asked is preserved on the evidence row.
    const clustered = checkKey !== freshKey;

    // Both writes in ONE transaction. Split across two statements, an evidence insert that
    // succeeded followed by a failed aggregate upsert would mark the source as "already
    // seen" forever — every retry hits onConflictDoNothing, so that source could never be
    // counted again and a check needing exactly 2 sources would stall permanently.
    await db.transaction(async (tx) => {
      // The unique (category, check, source) index makes a repeat from the same source a
      // no-op, so the aggregate below only counts genuinely new sources.
      const inserted = await tx
        .insert(learnedCategoryCheckEvidence)
        .values({
          categoryPath,
          checkKey,
          sourceKey,
          origin: input.origin ?? "UNKNOWN",
          questionKo: question,
        })
        .onConflictDoNothing()
        .returning({ id: learnedCategoryCheckEvidence.id });

      const isNewSource = inserted.length > 0;

      await tx
        .insert(learnedCategoryChecks)
        .values({
          categoryPath,
          checkKey,
          questionKo: question,
          ...(input.featureKey ? { featureKey: input.featureKey } : {}),
          occurrenceCount: 1,
          distinctSourceCount: 1,
        })
        .onConflictDoUpdate({
          target: [learnedCategoryChecks.categoryPath, learnedCategoryChecks.checkKey],
          set: {
            occurrenceCount: sql`${learnedCategoryChecks.occurrenceCount} + 1`,
            // Only a genuinely new source moves the distinct counter.
            distinctSourceCount: isNewSource
              ? sql`${learnedCategoryChecks.distinctSourceCount} + 1`
              : sql`${learnedCategoryChecks.distinctSourceCount}`,
            // Keep the newest phrasing, and attach a featureKey once one is discovered.
            // A clustered observation is the exception: the row's wording is what its key
            // was derived from, so it stays put.
            questionKo: clustered
              ? sql`${learnedCategoryChecks.questionKo}`
              : sql`excluded.question_ko`,
            featureKey: sql`coalesce(${learnedCategoryChecks.featureKey}, excluded.feature_key)`,
            lastSeenAt: new Date(),
            updatedAt: new Date(),
          },
        });
    });

    return { recorded: true };
  } catch (err) {
    // Best-effort: learning must never break the user's turn.
    console.warn(
      "[category-check-learning] record failed:",
      err instanceof Error ? err.message : String(err),
    );
    return { recorded: false, reason: "error" };
  }
}

/**
 * Flip rows that cleared the thresholds to PROMOTED. Idempotent; safe to run on a
 * schedule or opportunistically. SUPPRESSED rows are never promoted.
 */
export async function promoteEligibleCategoryChecks(
  db: Database,
  /**
   * Restrict the sweep to the category paths just observed. The request path passes this
   * so a builder turn does not scan every OBSERVED row in the table; omit it for a
   * scheduled full sweep.
   */
  categoryPaths?: readonly string[],
): Promise<{ promoted: number }> {
  const scoped = categoryPaths?.length
    ? [inArray(learnedCategoryChecks.categoryPath, [...new Set(categoryPaths)])]
    : [];
  const rows = await db
    .update(learnedCategoryChecks)
    .set({ status: "PROMOTED", promotedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(learnedCategoryChecks.status, "OBSERVED"),
        sql`${learnedCategoryChecks.occurrenceCount} >= ${PROMOTION_MIN_OCCURRENCES}`,
        sql`${learnedCategoryChecks.distinctSourceCount} >= ${PROMOTION_MIN_DISTINCT_SOURCES}`,
        ...scoped,
      ),
    )
    .returning({ id: learnedCategoryChecks.id });
  return { promoted: rows.length };
}

/**
 * Load PROMOTED learned checks that apply to a tag set, as the overlay shape
 * `resolveChecksWithLearned` expects.
 *
 * Only the category paths the tags actually resolve to are queried, so this stays a
 * narrow indexed lookup rather than a full-table scan. Returns [] on any failure —
 * a learning outage must degrade to the static taxonomy, never break resolution.
 */
export async function loadPromotedLearnedChecks(
  db: Database,
  tags: readonly string[],
): Promise<LearnedCheck[]> {
  try {
    const scopes = learningReadScopes(tags);
    if (scopes.length === 0) return [];

    const rows = await db
      .select()
      .from(learnedCategoryChecks)
      .where(
        and(
          eq(learnedCategoryChecks.status, "PROMOTED"),
          inArray(learnedCategoryChecks.categoryPath, scopes),
        ),
      );

    // Re-run the shared promotion algorithm over the stored rows so the returned checks
    // are built by ONE authority (soft-forcing, id derivation, static-collision dropping).
    // Exactly the threshold count of synthetic sources is emitted — the DB already proved
    // the real support, and `occurrenceCount` is unbounded, so allocating that many
    // objects on every builder turn would be a live memory/latency leak.
    const observations: LearnedCheckObservation[] = [];
    const supportByCheckId = new Map<string, { occurrences: number; distinctSources: number }>();
    for (const row of rows) {
      supportByCheckId.set(row.checkKey, {
        occurrences: row.occurrenceCount,
        distinctSources: row.distinctSourceCount,
      });
      for (let i = 0; i < PROMOTION_MIN_OCCURRENCES; i++) {
        observations.push({
          categoryPath: row.categoryPath,
          questionKo: row.questionKo,
          checkId: row.checkKey,
          ...(row.featureKey ? { featureKey: row.featureKey } : {}),
          // Synthetic distinct sources — the DB already proved the real threshold.
          sourceId: `stored-${row.id}-${i}`,
        });
      }
    }
    // `promoteLearnedChecks` sets `id` to the observation key, i.e. our stored checkKey.
    // Report the REAL support from the DB rather than the synthetic reconstruction count.
    return promoteLearnedChecks(observations).map((check) => {
      const real = supportByCheckId.get(check.id);
      return real ? { ...check, support: real } : check;
    });
  } catch (err) {
    console.warn(
      "[category-check-learning] load failed, falling back to static taxonomy:",
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }
}
