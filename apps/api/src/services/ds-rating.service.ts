import {
  eq,
  and,
  inArray,
  dsRatings,
  dsTagSpecializations,
  type Database,
} from "@haggle/db";

type DSTier = "BRONZE" | "SILVER" | "GOLD" | "PLATINUM" | "DIAMOND";
const TIER_ORDER: readonly DSTier[] = ["BRONZE", "SILVER", "GOLD", "PLATINUM", "DIAMOND"];

export async function getDSRating(db: Database, reviewerId: string) {
  const rows = await db
    .select()
    .from(dsRatings)
    .where(eq(dsRatings.reviewerId, reviewerId))
    .limit(1);

  return rows[0] ?? null;
}

export async function upsertDSRating(
  db: Database,
  data: {
    reviewerId: string;
    score: number;
    tier: DSTier;
    voteWeight: string;
    cumulativeCases: number;
    recentCases: number;
    zoneHitRate?: string;
    participationRate?: string;
    uniqueCategories?: number;
    metadata?: Record<string, unknown>;
  },
) {
  const existing = await getDSRating(db, data.reviewerId);

  if (existing) {
    const [row] = await db
      .update(dsRatings)
      .set({
        score: data.score,
        tier: data.tier,
        voteWeight: data.voteWeight,
        cumulativeCases: data.cumulativeCases,
        recentCases: data.recentCases,
        zoneHitRate: data.zoneHitRate,
        participationRate: data.participationRate,
        uniqueCategories: data.uniqueCategories,
        metadata: data.metadata,
        updatedAt: new Date(),
      })
      .where(eq(dsRatings.id, existing.id))
      .returning();
    return row;
  }

  const [row] = await db
    .insert(dsRatings)
    .values({
      reviewerId: data.reviewerId,
      score: data.score,
      tier: data.tier,
      voteWeight: data.voteWeight,
      cumulativeCases: data.cumulativeCases,
      recentCases: data.recentCases,
      zoneHitRate: data.zoneHitRate,
      participationRate: data.participationRate,
      uniqueCategories: data.uniqueCategories,
      metadata: data.metadata,
    })
    .returning();
  return row;
}

export async function getDSPool(db: Database, minTier: DSTier) {
  const minIndex = TIER_ORDER.indexOf(minTier);
  const qualifyingTiers = TIER_ORDER.slice(minIndex >= 0 ? minIndex : 0);

  const rows = await db
    .select()
    .from(dsRatings)
    .where(inArray(dsRatings.tier, [...qualifyingTiers]));

  return rows;
}

export async function getSpecializations(db: Database, reviewerId: string) {
  const rows = await db
    .select()
    .from(dsTagSpecializations)
    .where(eq(dsTagSpecializations.reviewerId, reviewerId));

  return rows;
}

export async function upsertSpecialization(
  db: Database,
  data: {
    reviewerId: string;
    tag: string;
    score: number;
    tier: DSTier;
    caseCount: number;
    zoneHitRate: string;
    qualified: boolean;
  },
) {
  const existing = await db
    .select()
    .from(dsTagSpecializations)
    .where(
      and(
        eq(dsTagSpecializations.reviewerId, data.reviewerId),
        eq(dsTagSpecializations.tag, data.tag),
      ),
    )
    .limit(1);

  if (existing[0]) {
    const [row] = await db
      .update(dsTagSpecializations)
      .set({
        score: data.score,
        tier: data.tier,
        caseCount: data.caseCount,
        zoneHitRate: data.zoneHitRate,
        qualified: data.qualified,
        updatedAt: new Date(),
      })
      .where(eq(dsTagSpecializations.id, existing[0].id))
      .returning();
    return row;
  }

  const [row] = await db
    .insert(dsTagSpecializations)
    .values({
      reviewerId: data.reviewerId,
      tag: data.tag,
      score: data.score,
      tier: data.tier,
      caseCount: data.caseCount,
      zoneHitRate: data.zoneHitRate,
      qualified: data.qualified,
    })
    .returning();
  return row;
}
