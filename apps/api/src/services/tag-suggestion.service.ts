/**
 * Tag Suggestion service — admin queue management for LLM-surfaced
 * missing tags (Step 54).
 *
 * The pending queue is populated by `tag-placement.service.queueProposedTags`.
 * Admins review each suggestion and either:
 *   - approve  → create a new `tags` row (auto-merged if normalized_name
 *                already exists)
 *   - reject   → mark REJECTED, no tag created
 *   - merge    → point at an existing target tag, mark MERGED
 *
 * All mutations are guarded: only PENDING suggestions can transition.
 */

import {
  type Database,
  tagSuggestions,
  tags,
  and,
  asc,
  desc,
  eq,
} from "@haggle/db";

export type SuggestionStatus = "PENDING" | "APPROVED" | "REJECTED" | "MERGED";

export interface ListSuggestionsOptions {
  status?: SuggestionStatus;
  limit?: number;
  offset?: number;
  orderBy?: "occurrence_desc" | "created_desc";
}

// ─── Read ─────────────────────────────────────────────────────────

export async function listSuggestions(
  db: Database,
  options: ListSuggestionsOptions = {},
): Promise<Array<typeof tagSuggestions.$inferSelect>> {
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;
  const orderBy = options.orderBy ?? "occurrence_desc";

  const whereClause = options.status
    ? eq(tagSuggestions.status, options.status)
    : undefined;

  const orderExpr =
    orderBy === "occurrence_desc"
      ? desc(tagSuggestions.occurrenceCount)
      : desc(tagSuggestions.createdAt);

  const rows = await db
    .select()
    .from(tagSuggestions)
    .where(whereClause)
    .orderBy(orderExpr, asc(tagSuggestions.createdAt))
    .limit(limit)
    .offset(offset);

  return rows;
}

export async function getSuggestionById(
  db: Database,
  id: string,
): Promise<typeof tagSuggestions.$inferSelect | null> {
  const rows = await db
    .select()
    .from(tagSuggestions)
    .where(eq(tagSuggestions.id, id))
    .limit(1);
  return rows[0] ?? null;
}

// ─── Mutations ────────────────────────────────────────────────────

/**
 * Approve a pending suggestion.
 *
 * Behaviour:
 *   - If a `tags` row already exists with the same `normalized_name`,
 *     the suggestion is auto-MERGED into it (no new tag created).
 *   - Otherwise, a new `tags` row is created with status CANDIDATE
 *     (or `params.initialStatus`) and the suggestion is marked APPROVED.
 *
 * Returns `{ ok: false }` if the suggestion does not exist or is not PENDING.
 */
export async function approveSuggestion(
  db: Database,
  suggestionId: string,
  params: {
    reviewedBy: string;
    category: string;
    initialStatus?: "CANDIDATE" | "EMERGING" | "OFFICIAL";
  },
): Promise<
  { ok: true; tagId: string; merged: boolean } | { ok: false; error: string }
> {
  const suggestion = await getSuggestionById(db, suggestionId);
  if (!suggestion) return { ok: false, error: "Suggestion not found" };
  if (suggestion.status !== "PENDING") {
    return { ok: false, error: `Already ${suggestion.status}` };
  }

  // Check if a tag with the same normalized name already exists.
  const existing = await db
    .select({ id: tags.id })
    .from(tags)
    .where(eq(tags.normalizedName, suggestion.normalizedLabel))
    .limit(1);

  if (existing.length > 0 && existing[0]) {
    // Auto-merge into the existing tag.
    await db
      .update(tagSuggestions)
      .set({
        status: "MERGED",
        mergedIntoTagId: existing[0].id,
        reviewedBy: params.reviewedBy,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(tagSuggestions.id, suggestionId));
    return { ok: true, tagId: existing[0].id, merged: true };
  }

  // Create a new tag row.
  const [created] = await db
    .insert(tags)
    .values({
      name: suggestion.label,
      normalizedName: suggestion.normalizedLabel,
      category: params.category,
      status: params.initialStatus ?? "CANDIDATE",
      createdBy: "ADMIN",
    })
    .returning({ id: tags.id });

  if (!created) {
    return { ok: false, error: "Failed to create tag" };
  }

  await db
    .update(tagSuggestions)
    .set({
      status: "APPROVED",
      reviewedBy: params.reviewedBy,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(tagSuggestions.id, suggestionId));

  return { ok: true, tagId: created.id, merged: false };
}

/**
 * Reject a pending suggestion. No tag is created.
 */
export async function rejectSuggestion(
  db: Database,
  suggestionId: string,
  reviewedBy: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const suggestion = await getSuggestionById(db, suggestionId);
  if (!suggestion) return { ok: false, error: "Suggestion not found" };
  if (suggestion.status !== "PENDING") {
    return { ok: false, error: `Already ${suggestion.status}` };
  }

  await db
    .update(tagSuggestions)
    .set({
      status: "REJECTED",
      reviewedBy,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(tagSuggestions.id, suggestionId));

  return { ok: true };
}

/**
 * Merge a pending suggestion into an existing target tag.
 */
export async function mergeSuggestion(
  db: Database,
  suggestionId: string,
  targetTagId: string,
  reviewedBy: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const suggestion = await getSuggestionById(db, suggestionId);
  if (!suggestion) return { ok: false, error: "Suggestion not found" };
  if (suggestion.status !== "PENDING") {
    return { ok: false, error: `Already ${suggestion.status}` };
  }

  // Verify target tag exists.
  const target = await db
    .select({ id: tags.id })
    .from(tags)
    .where(eq(tags.id, targetTagId))
    .limit(1);
  if (target.length === 0) {
    return { ok: false, error: "Target tag not found" };
  }

  await db
    .update(tagSuggestions)
    .set({
      status: "MERGED",
      mergedIntoTagId: targetTagId,
      reviewedBy,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(tagSuggestions.id, suggestionId));

  return { ok: true };
}
