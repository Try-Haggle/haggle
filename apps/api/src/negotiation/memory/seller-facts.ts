import type { CategoryCriterion } from "@haggle/shared";

/** Buyer-safe item facts the seller already stated. Street-level PII never belongs here. */
export function projectSellerFacts(
  criteria: CategoryCriterion[] | undefined,
): Array<{ checkId: string; question?: string; stance: string }> {
  if (!Array.isArray(criteria)) return [];
  return criteria.flatMap((criterion) => {
    if (!criterion || typeof criterion.checkId !== "string") return [];
    if (typeof criterion.stance !== "string" || criterion.stance.trim().length === 0) return [];
    return [
      {
        checkId: criterion.checkId,
        ...(typeof criterion.questionKo === "string" && criterion.questionKo.trim()
          ? { question: criterion.questionKo }
          : {}),
        stance: criterion.stance.trim(),
      },
    ];
  });
}
