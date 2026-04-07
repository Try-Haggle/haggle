import { createHash } from "node:crypto";
import OpenAI from "openai";
import Replicate from "replicate";
import {
  type Database,
  listingsPublished,
  listingEmbeddings,
  eq,
  sql,
} from "@haggle/db";

// ─── OpenAI Client (lazy init to allow dotenv to load first) ───

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

function getEmbeddingModel(): string {
  return process.env.EMBEDDING_MODEL || "text-embedding-3-large";
}

function getEmbeddingDimensions(): number {
  return parseInt(process.env.EMBEDDING_DIMENSIONS || "1536", 10);
}

// ─── Replicate Client (lazy init for image embeddings) ──

let _replicate: Replicate | null = null;
function getReplicate(): Replicate {
  if (!_replicate) {
    _replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
  }
  return _replicate;
}

// ─── Text Embedding Generation ─────────────────────────

/** Call OpenAI Embeddings API to convert text into a vector. */
export async function generateTextEmbedding(text: string): Promise<number[]> {
  const response = await getOpenAI().embeddings.create({
    model: getEmbeddingModel(),
    input: text,
    dimensions: getEmbeddingDimensions(),
  });
  return response.data[0].embedding;
}

// ─── Image Embedding Generation (Replicate CLIP) ───────

/** Call Replicate CLIP API to convert an image URL into a 512-dim vector. */
export async function generateImageEmbedding(
  imageUrl: string,
): Promise<number[]> {
  const output = await getReplicate().run(
    "andreasjansson/clip-features:75b33f253f7714a281ad3e9b28f63e3232d583716ef6718f2e46641077ea040a",
    { input: { inputs: imageUrl } },
  );
  // Output is an array of { embedding: number[], input: string }
  const results = output as Array<{ embedding: number[]; input: string }>;
  if (!results?.[0]?.embedding) {
    throw new Error("CLIP API returned no embedding");
  }
  return results[0].embedding;
}

// ─── Embedding Input Construction ──────────────────────

/** Price band boundaries for embedding input. */
const PRICE_BANDS: readonly [number, number, string][] = [
  [0, 50, "$0-$50"],
  [50, 100, "$50-$100"],
  [100, 250, "$100-$250"],
  [250, 500, "$250-$500"],
  [500, 1000, "$500-$1000"],
  [1000, 2000, "$1000-$2000"],
  [2000, 3000, "$2000-$3000"],
  [3000, 5000, "$3000-$5000"],
  [5000, Infinity, "$5000+"],
];

/** Convert a price to a discretized band string. */
export function getPriceBand(price: number): string {
  for (const [min, max, label] of PRICE_BANDS) {
    if (price >= min && price < max) return label;
  }
  return "$5000+";
}

/**
 * Build the text input for embedding generation from a listing snapshot.
 * Combines all structured fields into a tagged template so that
 * the embedding captures the full context of the listing.
 */
export function buildEmbeddingInput(snapshot: Record<string, unknown>): string {
  const parts: string[] = [];

  if (snapshot.title) parts.push(`[TITLE] ${snapshot.title}`);
  if (snapshot.category) parts.push(`[CATEGORY] ${snapshot.category}`);
  if (snapshot.condition) parts.push(`[CONDITION] ${snapshot.condition}`);

  const tags = snapshot.tags as string[] | null | undefined;
  if (tags?.length) parts.push(`[TAGS] ${tags.join(", ")}`);

  if (snapshot.description) parts.push(`[DESCRIPTION] ${snapshot.description}`);

  if (snapshot.targetPrice) {
    const band = getPriceBand(Number(snapshot.targetPrice));
    parts.push(`[PRICE_BAND] ${band}`);
  }

  return parts.join("\n");
}

// ─── Hash for Cache Invalidation ───────────────────────

/** SHA-256 hash of the embedding input text. Used to detect changes. */
export function computeTextHash(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

// ─── Snapshot Lookup ───────────────────────────────────

/** Fetch snapshot_json from listings_published by published listing ID. */
export async function getSnapshotByPublishedId(
  db: Database,
  publishedListingId: string,
): Promise<Record<string, unknown> | null> {
  const row = await db.query.listingsPublished.findFirst({
    where: (fields, ops) => ops.eq(fields.id, publishedListingId),
    columns: { snapshotJson: true },
  });
  return (row?.snapshotJson as Record<string, unknown>) ?? null;
}

// ─── Embedding Pipeline ────────────────────────────────

/**
 * Trigger embedding generation for a published listing.
 * - Pending row insertion is awaited (guarantees retry tracking).
 * - Actual embedding generation is fire-and-forget (does not block publish response).
 */
export async function triggerEmbeddingGeneration(
  db: Database,
  publishedListingId: string,
  snapshot: Record<string, unknown>,
) {
  // 1. Insert pending row — await to guarantee tracking
  await db
    .insert(listingEmbeddings)
    .values({
      publishedListingId,
      status: "pending",
      modelVersion: `${getEmbeddingModel()}-v1`,
    })
    .onConflictDoNothing();

  // 2. Generate embedding — fire-and-forget (don't await)
  generateAndStoreEmbedding(db, publishedListingId, snapshot).catch(() => {
    // Failure is handled inside generateAndStoreEmbedding (status='failed')
  });
}

/**
 * Actually generate the embedding and store it.
 * On success: status='completed', embedding saved.
 * On failure: status='failed', retry_count incremented.
 */
export async function generateAndStoreEmbedding(
  db: Database,
  publishedListingId: string,
  snapshot: Record<string, unknown>,
) {
  const input = buildEmbeddingInput(snapshot);
  const hash = computeTextHash(input);

  // Check if already completed with same hash
  const existing = await db
    .select()
    .from(listingEmbeddings)
    .where(eq(listingEmbeddings.publishedListingId, publishedListingId))
    .limit(1);

  if (existing[0]?.textHash === hash && existing[0]?.status === "completed")
    return;

  try {
    const textEmbedding = await generateTextEmbedding(input);

    // Generate image embedding if photo URL exists
    const photoUrl = snapshot.photoUrl as string | null;
    let imageEmbedding: number[] | null = null;
    let imageHash: string | null = null;
    if (photoUrl) {
      try {
        imageEmbedding = await generateImageEmbedding(photoUrl);
        imageHash = computeTextHash(photoUrl);
      } catch (imgErr) {
        // Image embedding failure doesn't block text embedding
        console.warn(
          `[embedding] Image embedding failed for ${publishedListingId}, continuing with text only:`,
          imgErr instanceof Error ? imgErr.message : imgErr,
        );
      }
    }

    // Build update using raw SQL to handle vector types properly
    if (imageEmbedding) {
      const imageVectorStr = `[${imageEmbedding.join(",")}]`;
      await db.execute(sql`
        UPDATE listing_embeddings SET
          text_embedding = ${`[${textEmbedding.join(",")}]`}::vector,
          image_embedding = ${imageVectorStr}::vector,
          text_hash = ${hash},
          image_hash = ${imageHash},
          status = 'completed',
          model_version = ${`${getEmbeddingModel()}-v1`},
          updated_at = NOW()
        WHERE published_listing_id = ${publishedListingId}
      `);
    } else {
      await db.execute(sql`
        UPDATE listing_embeddings SET
          text_embedding = ${`[${textEmbedding.join(",")}]`}::vector,
          text_hash = ${hash},
          status = 'completed',
          model_version = ${`${getEmbeddingModel()}-v1`},
          updated_at = NOW()
        WHERE published_listing_id = ${publishedListingId}
      `);
    }
  } catch (err) {
    console.error(
      `[embedding] Failed for ${publishedListingId}:`,
      err instanceof Error ? err.message : err,
    );
    const retryCount = (existing[0]?.retryCount ?? 0) + 1;
    await db
      .update(listingEmbeddings)
      .set({
        status: retryCount >= 5 ? "dead" : "failed",
        retryCount,
        failedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(listingEmbeddings.publishedListingId, publishedListingId));
  }
}
