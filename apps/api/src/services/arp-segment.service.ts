import {
  eq,
  and,
  sql,
  asc,
  isNull,
  arpSegments,
  type Database,
} from "@haggle/db";

export async function getSegment(
  db: Database,
  category?: string,
  amountTier?: string,
  tag?: string,
) {
  const conditions = [];

  if (category != null) {
    conditions.push(eq(arpSegments.category, category));
  } else {
    conditions.push(isNull(arpSegments.category));
  }

  if (amountTier != null) {
    conditions.push(eq(arpSegments.amountTier, amountTier));
  } else {
    conditions.push(isNull(arpSegments.amountTier));
  }

  if (tag != null) {
    conditions.push(eq(arpSegments.tag, tag));
  } else {
    conditions.push(isNull(arpSegments.tag));
  }

  const rows = await db
    .select()
    .from(arpSegments)
    .where(and(...conditions))
    .limit(1);

  return rows[0] ?? null;
}

export async function upsertSegment(
  db: Database,
  data: {
    category?: string;
    amountTier?: string;
    tag?: string;
    reviewHours: string;
    sampleCount: number;
  },
) {
  const existing = await getSegment(db, data.category, data.amountTier, data.tag);

  if (existing) {
    const [row] = await db
      .update(arpSegments)
      .set({
        reviewHours: data.reviewHours,
        sampleCount: data.sampleCount,
        lastAdjustedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(arpSegments.id, existing.id))
      .returning();
    return row;
  }

  const [row] = await db
    .insert(arpSegments)
    .values({
      category: data.category,
      amountTier: data.amountTier,
      tag: data.tag,
      reviewHours: data.reviewHours,
      sampleCount: data.sampleCount,
    })
    .returning();
  return row;
}

export async function listSegments(db: Database) {
  const rows = await db
    .select()
    .from(arpSegments)
    .orderBy(asc(arpSegments.category), asc(arpSegments.amountTier));

  return rows;
}

export async function updateSegmentReviewHours(
  db: Database,
  segmentId: string,
  reviewHours: string,
  sampleCount: number,
) {
  const [row] = await db
    .update(arpSegments)
    .set({
      reviewHours,
      sampleCount,
      lastAdjustedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(arpSegments.id, segmentId))
    .returning();

  return row;
}
