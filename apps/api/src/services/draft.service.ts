import { randomBytes } from "node:crypto";
import { type Database, listingDrafts, listingsPublished, eq, and, gt } from "@haggle/db";

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

  // Drizzle timestamp columns expect Date objects, not strings
  if (typeof updates.sellingDeadline === "string") {
    updates.sellingDeadline = new Date(updates.sellingDeadline);
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

// ─── Validation ─────────────────────────────────────────────

export interface ValidationError {
  field: string;
  message: string;
  step: number;
}

/** Validate that all required fields are present for publishing. */
export function validateDraft(
  draft: NonNullable<Awaited<ReturnType<typeof getDraftById>>>,
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!draft.title?.trim()) {
    errors.push({ field: "title", message: "Title is required", step: 1 });
  }
  if (!draft.targetPrice) {
    errors.push({
      field: "targetPrice",
      message: "Asking price is required",
      step: 2,
    });
  }
  if (!draft.sellingDeadline) {
    errors.push({
      field: "sellingDeadline",
      message: "Selling deadline is required",
      step: 2,
    });
  }

  return errors;
}

// ─── Publishing ─────────────────────────────────────────────

/** Generate a short URL-safe public ID (8 chars). */
function generatePublicId(): string {
  return randomBytes(6).toString("base64url").slice(0, 8);
}

/** Generate a claim token (32 chars). */
function generateClaimToken(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * Publish a validated draft:
 * 1. Insert snapshot into listings_published
 * 2. Update draft status to "published" + set claim token
 * Returns the published record, or null if draft not found.
 */
export async function publishDraft(db: Database, draftId: string) {
  const draft = await getDraftById(db, draftId);
  if (!draft) return null;

  if (draft.status === "published") {
    throw new Error("Draft is already published");
  }

  const publicId = generatePublicId();

  // Only generate claim token if no user is linked (ChatGPT widget flow)
  const needsClaim = !draft.userId;
  const claimToken = needsClaim ? generateClaimToken() : null;
  const claimExpiresAt = needsClaim
    ? new Date(Date.now() + 24 * 60 * 60 * 1000) // 24h
    : null;

  // Insert published snapshot
  const [published] = await db
    .insert(listingsPublished)
    .values({
      publicId,
      draftId: draft.id,
      snapshotJson: draft as unknown as Record<string, unknown>,
    })
    .returning();

  // Update draft status (+ claim info only if needed)
  const updateSet: Record<string, unknown> = {
    status: "published",
    updatedAt: new Date(),
  };
  if (claimToken) {
    updateSet.claimToken = claimToken;
    updateSet.claimExpiresAt = claimExpiresAt;
  }

  const [updatedDraft] = await db
    .update(listingDrafts)
    .set(updateSet)
    .where(eq(listingDrafts.id, draftId))
    .returning();

  return {
    publicId,
    shareUrl: `${process.env.PUBLIC_APP_URL || "http://localhost:3000"}/l/${publicId}`,
    ...(claimToken && {
      claimToken,
      claimExpiresAt: claimExpiresAt!.toISOString(),
    }),
    draft: updatedDraft,
    published,
  };
}

// ─── Dashboard Queries ──────────────────────────────────────

/** Fetch all published listings for a given user, with their public share URL. */
export async function getListingsByUserId(db: Database, userId: string) {
  const drafts = await db
    .select({
      id: listingDrafts.id,
      title: listingDrafts.title,
      category: listingDrafts.category,
      condition: listingDrafts.condition,
      photoUrl: listingDrafts.photoUrl,
      targetPrice: listingDrafts.targetPrice,
      status: listingDrafts.status,
      strategyConfig: listingDrafts.strategyConfig,
      createdAt: listingDrafts.createdAt,
      publicId: listingsPublished.publicId,
    })
    .from(listingDrafts)
    .innerJoin(listingsPublished, eq(listingsPublished.draftId, listingDrafts.id))
    .where(eq(listingDrafts.userId, userId))
    .orderBy(listingDrafts.createdAt);

  return drafts;
}

/** Fetch a single listing by draft ID + userId (ownership check). */
export async function getListingByIdForUser(db: Database, id: string, userId: string) {
  const rows = await db
    .select({
      id: listingDrafts.id,
      title: listingDrafts.title,
      description: listingDrafts.description,
      category: listingDrafts.category,
      condition: listingDrafts.condition,
      photoUrl: listingDrafts.photoUrl,
      targetPrice: listingDrafts.targetPrice,
      floorPrice: listingDrafts.floorPrice,
      tags: listingDrafts.tags,
      status: listingDrafts.status,
      strategyConfig: listingDrafts.strategyConfig,
      sellingDeadline: listingDrafts.sellingDeadline,
      createdAt: listingDrafts.createdAt,
      publicId: listingsPublished.publicId,
    })
    .from(listingDrafts)
    .innerJoin(listingsPublished, eq(listingsPublished.draftId, listingDrafts.id))
    .where(and(eq(listingDrafts.id, id), eq(listingDrafts.userId, userId)));

  return rows[0] ?? null;
}

// ─── Public Listing (Buyer) ─────────────────────────────────

/** Fetch a published listing by its public_id. No auth required. */
export async function getPublishedListingByPublicId(
  db: Database,
  publicId: string,
) {
  const rows = await db
    .select({
      id: listingsPublished.id,
      publicId: listingsPublished.publicId,
      publishedAt: listingsPublished.publishedAt,
      sellerId: listingDrafts.userId,
      title: listingDrafts.title,
      description: listingDrafts.description,
      category: listingDrafts.category,
      condition: listingDrafts.condition,
      photoUrl: listingDrafts.photoUrl,
      targetPrice: listingDrafts.targetPrice,
      tags: listingDrafts.tags,
      strategyConfig: listingDrafts.strategyConfig,
      sellingDeadline: listingDrafts.sellingDeadline,
    })
    .from(listingsPublished)
    .innerJoin(listingDrafts, eq(listingDrafts.id, listingsPublished.draftId))
    .where(eq(listingsPublished.publicId, publicId));

  return rows[0] ?? null;
}

// ─── Claim ──────────────────────────────────────────────────

export type ClaimResult =
  | { ok: true; draftId: string }
  | { ok: false; error: "invalid_token" | "expired" | "already_claimed" };

/**
 * Claim a listing by verifying the claim token and linking the user.
 * - Token must match a published draft
 * - Token must not be expired (claim_expires_at > now)
 * - Draft must not already be claimed (user_id must be null)
 */
export async function claimListing(
  db: Database,
  claimToken: string,
  userId: string,
): Promise<ClaimResult> {
  // Find draft with matching, non-expired claim token
  const draft = await db.query.listingDrafts.findFirst({
    where: (fields, ops) =>
      ops.and(
        ops.eq(fields.claimToken, claimToken),
        ops.eq(fields.status, "published"),
      ),
  });

  if (!draft) {
    return { ok: false, error: "invalid_token" };
  }

  // Check if already claimed
  if (draft.userId) {
    return { ok: false, error: "already_claimed" };
  }

  // Check expiry
  if (draft.claimExpiresAt && draft.claimExpiresAt < new Date()) {
    return { ok: false, error: "expired" };
  }

  // Link user_id to the draft
  await db
    .update(listingDrafts)
    .set({
      userId,
      updatedAt: new Date(),
    })
    .where(eq(listingDrafts.id, draft.id));

  return { ok: true, draftId: draft.id };
}
