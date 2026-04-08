/**
 * Tag Promotion service — Step 56.
 *
 * Runs two promotion passes driven by `tag_promotion_rules`:
 *   1. Pending suggestions whose occurrence_count ≥ default rule threshold
 *      are auto-approved (creating CANDIDATE tags with category="uncategorized"
 *      or auto-merging into existing tags).
 *   2. Existing CANDIDATE/EMERGING tags are raised one step when their
 *      per-category rule thresholds (min use count + min age days) are met.
 *
 * The whole run is idempotent and records a single `admin_action_log` row
 * of type `promotion.run` whose payload contains the full report.
 */

import {
  type Database,
  adminActionLog,
  and,
  eq,
  gte,
  inArray,
  tagPromotionRules,
  tagSuggestions,
  tags,
} from "@haggle/db";

import { approveSuggestion } from "./tag-suggestion.service.js";

const DEFAULT_RULE_CATEGORY = "default";
const UNCATEGORIZED = "uncategorized";

export interface TagPromotionRule {
  category: string;
  candidateMinUse: number;
  emergingMinUse: number;
  candidateMinAgeDays: number;
  emergingMinAgeDays: number;
  suggestionAutoPromoteCount: number;
  enabled: boolean;
}

export interface PromotionReport {
  suggestionsPromoted: number;
  suggestionsMerged: number;
  tagsCandidateToEmerging: number;
  tagsEmergingToOfficial: number;
  perCategory: Record<
    string,
    { promoted: number; merged: number; raised: number }
  >;
  durationMs: number;
  errors: Array<{ target: string; error: string }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function bumpPerCategory(
  report: Pick<PromotionReport, "perCategory">,
  category: string,
  field: "promoted" | "merged" | "raised",
) {
  const entry = report.perCategory[category] ?? {
    promoted: 0,
    merged: 0,
    raised: 0,
  };
  entry[field] += 1;
  report.perCategory[category] = entry;
}

function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

// ─── Rule lookup ──────────────────────────────────────────────────────

/**
 * Fetch the promotion rule for a category, falling back to "default".
 * Throws if no rule exists at all (operator must seed at least default).
 */
export async function getRuleForCategory(
  db: Database,
  category: string,
): Promise<TagPromotionRule> {
  const rows = await db
    .select()
    .from(tagPromotionRules)
    .where(
      inArray(tagPromotionRules.category, [category, DEFAULT_RULE_CATEGORY]),
    );

  const exact = rows.find((r) => r.category === category);
  const fallback = rows.find((r) => r.category === DEFAULT_RULE_CATEGORY);
  const rule = exact ?? fallback;

  if (!rule) {
    throw new Error(
      `No tag_promotion_rules row for category "${category}" and no "default" fallback seeded`,
    );
  }

  return {
    category: rule.category,
    candidateMinUse: rule.candidateMinUse,
    emergingMinUse: rule.emergingMinUse,
    candidateMinAgeDays: rule.candidateMinAgeDays,
    emergingMinAgeDays: rule.emergingMinAgeDays,
    suggestionAutoPromoteCount: rule.suggestionAutoPromoteCount,
    enabled: rule.enabled,
  };
}

// ─── Phase A: pending suggestions → CANDIDATE tags ────────────────────

type PartialReport = Pick<
  PromotionReport,
  "suggestionsPromoted" | "suggestionsMerged" | "perCategory" | "errors"
>;

/**
 * Phase A: promote pending suggestions into CANDIDATE tags.
 *
 * Intentionally uses ONLY the "default" rule threshold because
 * `tag_suggestions` rows do not carry a category — the created tag is
 * always `category="uncategorized"` and an admin re-classifies later.
 */
export async function promotePendingSuggestions(
  db: Database,
  actorId: string,
): Promise<PartialReport> {
  const report: PartialReport = {
    suggestionsPromoted: 0,
    suggestionsMerged: 0,
    perCategory: {},
    errors: [],
  };

  const defaultRule = await getRuleForCategory(db, DEFAULT_RULE_CATEGORY);
  if (!defaultRule.enabled) return report;

  const pending = await db
    .select()
    .from(tagSuggestions)
    .where(
      and(
        eq(tagSuggestions.status, "PENDING"),
        gte(
          tagSuggestions.occurrenceCount,
          defaultRule.suggestionAutoPromoteCount,
        ),
      ),
    );

  for (const row of pending) {
    try {
      const result = await approveSuggestion(db, row.id, {
        reviewedBy: actorId,
        category: UNCATEGORIZED,
        initialStatus: "CANDIDATE",
      });
      if (!result.ok) {
        report.errors.push({ target: `suggestion:${row.id}`, error: result.error });
        continue;
      }
      if (result.merged) {
        report.suggestionsMerged += 1;
        bumpPerCategory(report, UNCATEGORIZED, "merged");
      } else {
        report.suggestionsPromoted += 1;
        bumpPerCategory(report, UNCATEGORIZED, "promoted");
      }
    } catch (err) {
      report.errors.push({
        target: `suggestion:${row.id}`,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return report;
}

// ─── Phase B: CANDIDATE/EMERGING tags → next tier ─────────────────────

type TagPhaseReport = Pick<
  PromotionReport,
  "tagsCandidateToEmerging" | "tagsEmergingToOfficial" | "perCategory" | "errors"
>;

export async function promoteExistingTags(
  db: Database,
): Promise<TagPhaseReport> {
  const report: TagPhaseReport = {
    tagsCandidateToEmerging: 0,
    tagsEmergingToOfficial: 0,
    perCategory: {},
    errors: [],
  };

  const now = new Date();

  // Cache rule lookups per category.
  const ruleCache = new Map<string, TagPromotionRule>();
  const loadRule = async (category: string): Promise<TagPromotionRule> => {
    const cached = ruleCache.get(category);
    if (cached) return cached;
    const rule = await getRuleForCategory(db, category);
    ruleCache.set(category, rule);
    return rule;
  };

  const rows = await db
    .select()
    .from(tags)
    .where(inArray(tags.status, ["CANDIDATE", "EMERGING"]));

  for (const tag of rows) {
    try {
      const rule = await loadRule(tag.category);
      if (!rule.enabled) continue;

      const ageDays = daysBetween(tag.createdAt, now);

      if (
        tag.status === "CANDIDATE" &&
        tag.useCount >= rule.candidateMinUse &&
        ageDays >= rule.candidateMinAgeDays
      ) {
        // Race-safe: only update if status is still CANDIDATE. A concurrent
        // job that already flipped this row to EMERGING will be a no-op here.
        await db
          .update(tags)
          .set({ status: "EMERGING", updatedAt: now })
          .where(and(eq(tags.id, tag.id), eq(tags.status, "CANDIDATE")));
        report.tagsCandidateToEmerging += 1;
        bumpPerCategory(report, tag.category, "raised");
        continue;
      }

      if (
        tag.status === "EMERGING" &&
        tag.useCount >= rule.emergingMinUse &&
        ageDays >= rule.emergingMinAgeDays
      ) {
        await db
          .update(tags)
          .set({ status: "OFFICIAL", updatedAt: now })
          .where(and(eq(tags.id, tag.id), eq(tags.status, "EMERGING")));
        report.tagsEmergingToOfficial += 1;
        bumpPerCategory(report, tag.category, "raised");
      }
    } catch (err) {
      report.errors.push({
        target: `tag:${tag.id}`,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return report;
}

// ─── Orchestrator ─────────────────────────────────────────────────────

function mergePerCategory(
  a: Record<string, { promoted: number; merged: number; raised: number }>,
  b: Record<string, { promoted: number; merged: number; raised: number }>,
) {
  const out: PromotionReport["perCategory"] = {};
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const av = a[key] ?? { promoted: 0, merged: 0, raised: 0 };
    const bv = b[key] ?? { promoted: 0, merged: 0, raised: 0 };
    out[key] = {
      promoted: av.promoted + bv.promoted,
      merged: av.merged + bv.merged,
      raised: av.raised + bv.raised,
    };
  }
  return out;
}

const EMPTY_SUGGESTION_PHASE: PartialReport = {
  suggestionsPromoted: 0,
  suggestionsMerged: 0,
  perCategory: {},
  errors: [],
};

const EMPTY_TAG_PHASE: TagPhaseReport = {
  tagsCandidateToEmerging: 0,
  tagsEmergingToOfficial: 0,
  perCategory: {},
  errors: [],
};

/**
 * Orchestrates both phases and always records a `promotion.run` row
 * (even on phase failure) so operators can see what happened.
 *
 * Not transactional across phases — partial progress is safe because
 * filters are idempotent and row-level updates are race-guarded.
 */
export async function runPromotionJob(
  db: Database,
  actorId: string,
): Promise<PromotionReport> {
  const started = Date.now();
  const phaseErrors: PromotionReport["errors"] = [];

  let suggestionPhase: PartialReport = EMPTY_SUGGESTION_PHASE;
  try {
    suggestionPhase = await promotePendingSuggestions(db, actorId);
  } catch (err) {
    phaseErrors.push({
      target: "phase:suggestions",
      error: err instanceof Error ? err.message : String(err),
    });
  }

  let tagPhase: TagPhaseReport = EMPTY_TAG_PHASE;
  try {
    tagPhase = await promoteExistingTags(db);
  } catch (err) {
    phaseErrors.push({
      target: "phase:tags",
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const report: PromotionReport = {
    suggestionsPromoted: suggestionPhase.suggestionsPromoted,
    suggestionsMerged: suggestionPhase.suggestionsMerged,
    tagsCandidateToEmerging: tagPhase.tagsCandidateToEmerging,
    tagsEmergingToOfficial: tagPhase.tagsEmergingToOfficial,
    perCategory: mergePerCategory(
      suggestionPhase.perCategory,
      tagPhase.perCategory,
    ),
    durationMs: Date.now() - started,
    errors: [...phaseErrors, ...suggestionPhase.errors, ...tagPhase.errors],
  };

  try {
    await db.insert(adminActionLog).values({
      actorId,
      actionType: "promotion.run",
      targetType: null,
      targetId: null,
      payload: report as unknown as Record<string, unknown>,
    });
  } catch (err) {
    // Logging failure should not fail the whole job — surface in errors.
    report.errors.push({
      target: "admin_action_log",
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return report;
}
