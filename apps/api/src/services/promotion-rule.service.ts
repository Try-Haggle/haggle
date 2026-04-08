/**
 * Promotion-rule CRUD + last promotion run lookup (Step 58 Part A).
 *
 * Thin DB wrappers so admin routes don't call Drizzle directly. Keeping
 * these in a service also makes them trivial to mock in route tests.
 */

import {
  type Database,
  adminActionLog,
  desc,
  eq,
  tagPromotionRules,
} from "@haggle/db";

export type PromotionRuleRow = typeof tagPromotionRules.$inferSelect;
export type PromotionRuleInput = {
  candidateMinUse: number;
  emergingMinUse: number;
  candidateMinAgeDays: number;
  emergingMinAgeDays: number;
  suggestionAutoPromoteCount: number;
  enabled: boolean;
};

export async function listPromotionRules(
  db: Database,
): Promise<PromotionRuleRow[]> {
  const rows = await db
    .select()
    .from(tagPromotionRules)
    .orderBy(tagPromotionRules.category);
  return rows as PromotionRuleRow[];
}

export async function getPromotionRule(
  db: Database,
  category: string,
): Promise<PromotionRuleRow | null> {
  const rows = await db
    .select()
    .from(tagPromotionRules)
    .where(eq(tagPromotionRules.category, category));
  return ((rows as unknown[])[0] as PromotionRuleRow | undefined) ?? null;
}

export async function upsertPromotionRule(
  db: Database,
  category: string,
  input: PromotionRuleInput,
): Promise<PromotionRuleRow | null> {
  const values = {
    category,
    candidateMinUse: input.candidateMinUse,
    emergingMinUse: input.emergingMinUse,
    candidateMinAgeDays: input.candidateMinAgeDays,
    emergingMinAgeDays: input.emergingMinAgeDays,
    suggestionAutoPromoteCount: input.suggestionAutoPromoteCount,
    enabled: input.enabled,
    updatedAt: new Date(),
  };

  await db
    .insert(tagPromotionRules)
    .values(values)
    .onConflictDoUpdate({
      target: tagPromotionRules.category,
      set: {
        candidateMinUse: values.candidateMinUse,
        emergingMinUse: values.emergingMinUse,
        candidateMinAgeDays: values.candidateMinAgeDays,
        emergingMinAgeDays: values.emergingMinAgeDays,
        suggestionAutoPromoteCount: values.suggestionAutoPromoteCount,
        enabled: values.enabled,
        updatedAt: values.updatedAt,
      },
    });

  return getPromotionRule(db, category);
}

export async function deletePromotionRule(
  db: Database,
  category: string,
): Promise<void> {
  await db
    .delete(tagPromotionRules)
    .where(eq(tagPromotionRules.category, category));
}

export async function getLastPromotionRun(
  db: Database,
): Promise<typeof adminActionLog.$inferSelect | null> {
  const rows = await db
    .select()
    .from(adminActionLog)
    .where(eq(adminActionLog.actionType, "promotion.run"))
    .orderBy(desc(adminActionLog.createdAt))
    .limit(1);
  return (
    ((rows as unknown[])[0] as typeof adminActionLog.$inferSelect | undefined) ??
    null
  );
}
