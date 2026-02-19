import { type Database, listingDrafts, eq } from "@haggle/db";

/** Fields that can be patched via haggle_apply_patch. */
const PATCHABLE_FIELDS = [
  "title",
  "description",
  "tags",
  "category",
  "condition",
  "photoUrl",
  "targetPrice",
  "floorPrice",
  "sellingDeadline",
  "strategyConfig",
] as const;

type PatchableField = (typeof PATCHABLE_FIELDS)[number];

/** Partial update payload — only patchable fields allowed. */
export type DraftPatch = Partial<
  Pick<typeof listingDrafts.$inferInsert, PatchableField>
>;

/** Insert a new empty draft row with status "draft". */
export async function createDraft(db: Database) {
  const [row] = await db
    .insert(listingDrafts)
    .values({ status: "draft" })
    .returning();
  return row;
}

/** Fetch a single draft by ID. Returns null if not found. */
export async function getDraftById(db: Database, id: string) {
  const row = await db.query.listingDrafts.findFirst({
    where: (fields, ops) => ops.eq(fields.id, id),
  });
  return row ?? null;
}

/** Update allowed fields on a draft. Returns the updated row, or null if not found. */
export async function patchDraft(
  db: Database,
  id: string,
  patch: DraftPatch,
) {
  // Filter to only patchable fields that are actually present in the patch
  const updates: Record<string, unknown> = {};
  for (const key of PATCHABLE_FIELDS) {
    if (key in patch) {
      updates[key] = patch[key];
    }
  }

  // Empty patch — return current draft without hitting DB for write
  if (Object.keys(updates).length === 0) {
    return getDraftById(db, id);
  }

  // Always bump updatedAt (Drizzle defaultNow only applies on INSERT)
  updates.updatedAt = new Date();

  const [row] = await db
    .update(listingDrafts)
    .set(updates)
    .where(eq(listingDrafts.id, id))
    .returning();

  return row ?? null;
}
