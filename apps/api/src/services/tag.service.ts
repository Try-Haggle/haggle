import {
  eq,
  and,
  tags,
  expertTags,
  tagMergeLog,
  type Database,
} from "@haggle/db";

type TagStatus = "CANDIDATE" | "EMERGING" | "OFFICIAL" | "DEPRECATED";
type MergeReason = "levenshtein" | "synonym" | "manual";

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export async function getTagById(db: Database, tagId: string) {
  const rows = await db
    .select()
    .from(tags)
    .where(eq(tags.id, tagId))
    .limit(1);

  return rows[0] ?? null;
}

export async function getTagByNormalizedName(
  db: Database,
  normalizedName: string,
  category: string,
) {
  const rows = await db
    .select()
    .from(tags)
    .where(
      and(
        eq(tags.normalizedName, normalizedName),
        eq(tags.category, category),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export async function listTags(
  db: Database,
  filters?: { status?: string; category?: string },
) {
  const conditions = [];

  if (filters?.status) {
    conditions.push(eq(tags.status, filters.status as TagStatus));
  }
  if (filters?.category) {
    conditions.push(eq(tags.category, filters.category));
  }

  const rows = await db
    .select()
    .from(tags)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  return rows;
}

export async function createTag(
  db: Database,
  data: {
    name: string;
    normalizedName: string;
    status?: TagStatus;
    category: string;
    parentId?: string;
  },
) {
  const [row] = await db
    .insert(tags)
    .values({
      name: data.name,
      normalizedName: data.normalizedName,
      status: data.status ?? ("CANDIDATE" as TagStatus),
      category: data.category,
      parentId: data.parentId,
    })
    .returning();

  return row;
}

export async function updateTag(
  db: Database,
  tagId: string,
  data: Partial<{
    status: TagStatus;
    useCount: number;
    lastUsedAt: Date;
    parentId: string;
  }>,
) {
  const [row] = await db
    .update(tags)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(tags.id, tagId))
    .returning();

  return row;
}

// ---------------------------------------------------------------------------
// Expert Tags
// ---------------------------------------------------------------------------

export async function getExpertTags(db: Database, tagId: string) {
  const rows = await db
    .select()
    .from(expertTags)
    .where(eq(expertTags.tagId, tagId));

  return rows;
}

export async function getExpertTagsByUser(db: Database, userId: string) {
  const rows = await db
    .select()
    .from(expertTags)
    .where(eq(expertTags.userId, userId));

  return rows;
}

export async function upsertExpertTag(
  db: Database,
  data: {
    userId: string;
    tagId: string;
    category: string;
    caseCount: number;
    accuracy: string;
    qualifiedAt?: Date;
  },
) {
  const existing = await db
    .select()
    .from(expertTags)
    .where(
      and(
        eq(expertTags.userId, data.userId),
        eq(expertTags.tagId, data.tagId),
      ),
    )
    .limit(1);

  if (existing[0]) {
    const [row] = await db
      .update(expertTags)
      .set({
        category: data.category,
        caseCount: data.caseCount,
        accuracy: data.accuracy,
        qualifiedAt: data.qualifiedAt,
        updatedAt: new Date(),
      })
      .where(eq(expertTags.id, existing[0].id))
      .returning();
    return row;
  }

  const [row] = await db
    .insert(expertTags)
    .values({
      userId: data.userId,
      tagId: data.tagId,
      category: data.category,
      caseCount: data.caseCount,
      accuracy: data.accuracy,
      qualifiedAt: data.qualifiedAt,
    })
    .returning();
  return row;
}

// ---------------------------------------------------------------------------
// Merge Log
// ---------------------------------------------------------------------------

export async function createMergeLog(
  db: Database,
  data: {
    sourceTagId: string;
    targetTagId: string;
    reason: MergeReason;
    mergedBy: string;
  },
) {
  const [row] = await db
    .insert(tagMergeLog)
    .values({
      sourceTagId: data.sourceTagId,
      targetTagId: data.targetTagId,
      reason: data.reason as MergeReason,
      mergedBy: data.mergedBy,
    })
    .returning();

  return row;
}
