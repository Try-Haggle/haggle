import { randomBytes } from "node:crypto";
import {
  type Database,
  listingDrafts,
  listingsPublished,
  tags,
  eq,
  and,
  or,
  gt,
  gte,
  lt,
  lte,
  isNull,
  isNotNull,
  desc,
  asc,
  inArray,
  sql,
} from "@haggle/db";
import { placeListingTags } from "./tag-placement.service.js";
import { triggerEmbeddingGeneration } from "./embedding.service.js";

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
  "currentStep",
  "draftName",
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

  // ── Tag placement (best-effort) ──
  // Failure here must NOT fail publish. Updates snapshot_json.tags
  // with LLM-selected tag labels when successful.
  try {
    const placement = await placeListingTags(db, {
      title: draft.title ?? "",
      description: draft.description ?? "",
      category: draft.category ?? null,
      priceBand: null, // MVP: skip
      listingId: published.id,
      sourceEmbedding: null, // embedding not yet available at publish time
    });

    if (placement.selectedTagIds.length > 0) {
      // Resolve ids → labels for snapshot update
      const tagRows = await db
        .select({ id: tags.id, name: tags.name })
        .from(tags)
        .where(inArray(tags.id, placement.selectedTagIds));
      const labels = tagRows.map((r) => r.name);

      if (labels.length > 0) {
        const updatedSnapshot = {
          ...(published.snapshotJson as Record<string, unknown>),
          tags: labels,
        };
        await db
          .update(listingsPublished)
          .set({ snapshotJson: updatedSnapshot })
          .where(eq(listingsPublished.id, published.id));
      }
    }
  } catch (err) {
    // Placement failure must NOT fail publish.
    console.warn(
      `[publish] tag placement failed for listing ${published.id}:`,
      err,
    );
  }

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

  // Trigger embedding generation (pending row: await, OpenAI call: fire-and-forget)
  await triggerEmbeddingGeneration(
    db,
    published.id,
    published.snapshotJson as Record<string, unknown>,
  );

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

// ─── Draft Listing (for resume) ─────────────────────────────

/** Fetch all in-progress drafts for a given user. */
export async function getDraftsByUserId(db: Database, userId: string) {
  const rows = await db
    .select()
    .from(listingDrafts)
    .where(and(eq(listingDrafts.userId, userId), eq(listingDrafts.status, "draft")))
    .orderBy(listingDrafts.updatedAt);

  return rows;
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

export type ListPublishedSort = "newest" | "price_asc" | "price_desc";

/**
 * Build a case-insensitive substring match against the listing's title or
 * any of its tags. LIKE wildcards in user input are escaped so the search
 * is treated as a literal substring.
 */
function buildSearchClause(q: string) {
  const escaped = q.replace(/[\\%_]/g, "\\$&");
  const like = `%${escaped}%`;
  return sql`(${listingDrafts.title} ILIKE ${like} OR EXISTS (SELECT 1 FROM unnest(${listingDrafts.tags}) AS t WHERE t ILIKE ${like}))`;
}

/**
 * List published listings for public browsing. No auth required.
 * Filters out expired drafts and listings past their sellingDeadline.
 * Returns only fields safe for public exposure (no floorPrice, strategyConfig, or sellerId).
 *
 * Cursor format is sort-aware:
 *   - newest:       sortKey = publishedAt ISO string
 *   - price_asc/desc: sortKey = targetPrice numeric string
 * The route layer is responsible for encoding/decoding cursor strings.
 */
export async function listPublishedListings(
  db: Database,
  opts: {
    categories?: string[];
    minPrice?: number;
    maxPrice?: number;
    conditions?: string[];
    q?: string;
    sort?: ListPublishedSort;
    limit?: number;
    cursor?: { sortKey: string; publicId: string };
  } = {},
) {
  const limit = Math.min(Math.max(opts.limit ?? 40, 1), 100);
  const sort: ListPublishedSort = opts.sort ?? "newest";
  const now = new Date();

  const where = [
    eq(listingDrafts.status, "published"),
    or(isNull(listingDrafts.sellingDeadline), gt(listingDrafts.sellingDeadline, now)),
  ];

  if (opts.categories && opts.categories.length > 0) {
    where.push(inArray(listingDrafts.category, opts.categories));
  }

  if (opts.minPrice !== undefined) {
    where.push(gte(listingDrafts.targetPrice, String(opts.minPrice)));
  }
  if (opts.maxPrice !== undefined) {
    where.push(lte(listingDrafts.targetPrice, String(opts.maxPrice)));
  }

  if (opts.conditions && opts.conditions.length > 0) {
    where.push(inArray(listingDrafts.condition, opts.conditions));
  }

  const trimmedQ = opts.q?.trim();
  if (trimmedQ) {
    where.push(buildSearchClause(trimmedQ));
  }

  // When sorting by price, exclude rows with NULL targetPrice so cursor
  // pagination has a stable key.
  if (sort !== "newest") {
    where.push(isNotNull(listingDrafts.targetPrice));
  }

  if (opts.cursor) {
    const { sortKey, publicId: cursorPublicId } = opts.cursor;
    if (sort === "newest") {
      const cursorDate = new Date(sortKey);
      where.push(
        or(
          lt(listingsPublished.publishedAt, cursorDate),
          and(
            eq(listingsPublished.publishedAt, cursorDate),
            lt(listingsPublished.publicId, cursorPublicId),
          ),
        ),
      );
    } else if (sort === "price_asc") {
      where.push(
        or(
          gt(listingDrafts.targetPrice, sortKey),
          and(
            eq(listingDrafts.targetPrice, sortKey),
            gt(listingsPublished.publicId, cursorPublicId),
          ),
        ),
      );
    } else {
      // price_desc
      where.push(
        or(
          lt(listingDrafts.targetPrice, sortKey),
          and(
            eq(listingDrafts.targetPrice, sortKey),
            lt(listingsPublished.publicId, cursorPublicId),
          ),
        ),
      );
    }
  }

  const orderBy =
    sort === "price_asc"
      ? [asc(listingDrafts.targetPrice), asc(listingsPublished.publicId)]
      : sort === "price_desc"
        ? [desc(listingDrafts.targetPrice), desc(listingsPublished.publicId)]
        : [desc(listingsPublished.publishedAt), desc(listingsPublished.publicId)];

  const rows = await db
    .select({
      publicId: listingsPublished.publicId,
      publishedAt: listingsPublished.publishedAt,
      title: listingDrafts.title,
      category: listingDrafts.category,
      condition: listingDrafts.condition,
      photoUrl: listingDrafts.photoUrl,
      targetPrice: listingDrafts.targetPrice,
      tags: listingDrafts.tags,
    })
    .from(listingsPublished)
    .innerJoin(listingDrafts, eq(listingDrafts.id, listingsPublished.draftId))
    .where(and(...where))
    .orderBy(...orderBy)
    .limit(limit);

  return rows;
}

// Log-spaced "nice" boundaries used both for the price-range query and
// the dynamic preset bucket histogram. Buckets are [-inf, 25), [25, 50),
// ..., [100000, +inf). The shape is intentionally coarse at the high end
// where data is sparse and dense at the low end where most listings live.
const PRICE_BUCKET_EDGES = [
  25, 50, 100, 200, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000,
];

/**
 * Compute the top-N most populated price buckets matching the given
 * category/condition filters (price filter excluded, since these drive
 * the preset chips). Returns buckets sorted by ascending price.
 *
 * When fewer than `minTotal` priced listings match, returns []
 * — sparse data makes the "most concentrated" presets misleading.
 */
export async function getPublishedPriceBuckets(
  db: Database,
  opts: { categories?: string[]; conditions?: string[]; q?: string } = {},
  topN = 5,
  minTotal = 6,
): Promise<Array<{ min: number; max: number | null; count: number }>> {
  const now = new Date();
  const where = [
    eq(listingDrafts.status, "published"),
    or(isNull(listingDrafts.sellingDeadline), gt(listingDrafts.sellingDeadline, now)),
    isNotNull(listingDrafts.targetPrice),
  ];

  if (opts.categories && opts.categories.length > 0) {
    where.push(inArray(listingDrafts.category, opts.categories));
  }
  if (opts.conditions && opts.conditions.length > 0) {
    where.push(inArray(listingDrafts.condition, opts.conditions));
  }
  const trimmedQ = opts.q?.trim();
  if (trimmedQ) {
    where.push(buildSearchClause(trimmedQ));
  }

  // Build one COUNT FILTER per bucket so we get the histogram in a single round trip.
  const fields: Record<string, ReturnType<typeof sql<string>>> = {};
  fields.b0 = sql<string>`COUNT(*) FILTER (WHERE ${listingDrafts.targetPrice} < ${PRICE_BUCKET_EDGES[0]})`;
  for (let i = 0; i < PRICE_BUCKET_EDGES.length - 1; i++) {
    const lo = PRICE_BUCKET_EDGES[i];
    const hi = PRICE_BUCKET_EDGES[i + 1];
    fields[`b${i + 1}`] = sql<string>`COUNT(*) FILTER (WHERE ${listingDrafts.targetPrice} >= ${lo} AND ${listingDrafts.targetPrice} < ${hi})`;
  }
  const lastEdge = PRICE_BUCKET_EDGES[PRICE_BUCKET_EDGES.length - 1];
  fields[`b${PRICE_BUCKET_EDGES.length}`] = sql<string>`COUNT(*) FILTER (WHERE ${listingDrafts.targetPrice} >= ${lastEdge})`;

  const [row] = await db
    .select(fields)
    .from(listingsPublished)
    .innerJoin(listingDrafts, eq(listingDrafts.id, listingsPublished.draftId))
    .where(and(...where));

  if (!row) return [];

  const buckets: Array<{ min: number; max: number | null; count: number }> = [];
  buckets.push({ min: 0, max: PRICE_BUCKET_EDGES[0], count: Number(row.b0) });
  for (let i = 0; i < PRICE_BUCKET_EDGES.length - 1; i++) {
    buckets.push({
      min: PRICE_BUCKET_EDGES[i],
      max: PRICE_BUCKET_EDGES[i + 1],
      count: Number(row[`b${i + 1}`]),
    });
  }
  buckets.push({
    min: lastEdge,
    max: null,
    count: Number(row[`b${PRICE_BUCKET_EDGES.length}`]),
  });

  const total = buckets.reduce((sum, b) => sum + b.count, 0);
  if (total < minTotal) return [];

  return buckets
    .filter((b) => b.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, topN)
    .sort((a, b) => a.min - b.min);
}

/**
 * Compute min/max targetPrice across published, non-expired listings
 * matching the given category/condition filters. Used to drive a price
 * range slider on the browse page. Returns null when no priced listings
 * match.
 */
export async function getPublishedPriceRange(
  db: Database,
  opts: { categories?: string[]; conditions?: string[]; q?: string } = {},
): Promise<{ min: number; max: number } | null> {
  const now = new Date();
  const where = [
    eq(listingDrafts.status, "published"),
    or(isNull(listingDrafts.sellingDeadline), gt(listingDrafts.sellingDeadline, now)),
    isNotNull(listingDrafts.targetPrice),
  ];

  if (opts.categories && opts.categories.length > 0) {
    where.push(inArray(listingDrafts.category, opts.categories));
  }
  if (opts.conditions && opts.conditions.length > 0) {
    where.push(inArray(listingDrafts.condition, opts.conditions));
  }
  const trimmedQ = opts.q?.trim();
  if (trimmedQ) {
    where.push(buildSearchClause(trimmedQ));
  }

  const [row] = await db
    .select({
      min: sql<string | null>`MIN(${listingDrafts.targetPrice})`,
      max: sql<string | null>`MAX(${listingDrafts.targetPrice})`,
    })
    .from(listingsPublished)
    .innerJoin(listingDrafts, eq(listingDrafts.id, listingsPublished.draftId))
    .where(and(...where));

  if (!row || row.min === null || row.max === null) return null;
  const min = Number(row.min);
  const max = Number(row.max);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return { min, max };
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
