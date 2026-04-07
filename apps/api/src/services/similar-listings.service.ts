import {
  type Database,
  tagIdfCache,
  recommendationLogs,
  sql,
} from "@haggle/db";

// ─── In-Memory Caches ──────────────────────────────────

/** Tag IDF scores: idfMap.get(tag) = idf score */
let idfMap: Map<string, number> = new Map();

/** Load tag_idf_cache table into memory. Call on server startup. */
export async function loadTagIdfCache(db: Database) {
  const rows = await db.select().from(tagIdfCache);
  idfMap = new Map();
  for (const row of rows) {
    idfMap.set(row.tag, Number(row.idfScore));
  }
  console.log(`[similar-listings] Loaded ${rows.length} tag IDF entries`);
}

/** Load caches on server startup. */
export async function loadSimilarListingsCaches(db: Database) {
  await loadTagIdfCache(db);
}

// ─── Getters for use in signal functions ───────────────

export function getTagIdf(tag: string): number {
  return idfMap.get(tag) ?? 1.0; // unknown tag = treat as rare (weight 1.0)
}

// ─── Types ─────────────────────────────────────────────

interface CandidateRow {
  id: string;
  public_id: string;
  draft_id: string;
  snapshot_json: Record<string, unknown>;
  text_embedding: number[];
  image_embedding: number[] | null;
  cosine_similarity: number;
}

interface SignalScores {
  semantic: number;
  image: number;
  tags: number;
  price: number;
}

interface ScoredCandidate {
  candidate: CandidateRow;
  scores: SignalScores;
  compositeScore: number;
}

export interface SimilarListingResult {
  publicId: string;
  title: string;
  category: string | null;
  condition: string | null;
  photoUrl: string | null;
  targetPrice: string | null;
  sellingDeadline: string | null;
  similarityScore: number;
  matchReasons: string[];
  logId: string;
}

// ─── Signal Weights ────────────────────────────────────

const WEIGHTS_DETAIL = {
  semantic: 0.8,
  image: 0, // disabled until better model (DINOv2 or fine-tuned CLIP)
  tags: 0.12,
  price: 0.08,
} as const;

const WEIGHTS_DASHBOARD = {
  semantic: 0.85,
  image: 0,
  tags: 0.15,
  price: 0,
} as const;

const SIMILARITY_THRESHOLD_DETAIL = 0.65; // Detail page: single listing comparison
const SIMILARITY_THRESHOLD_DASHBOARD = 0.5; // Dashboard: same threshold as detail page

// ─── Signal Functions ──────────────────────────────────

/** Signal 1: Semantic similarity (pre-computed in Stage 1) */
function semanticSimilarity(cosineSim: number): number {
  return cosineSim;
}

/** Signal 2: Price proximity using log ratio */
function priceProximity(
  sourcePrice: number | null,
  candidatePrice: number | null,
): number {
  if (
    !sourcePrice ||
    !candidatePrice ||
    sourcePrice <= 0 ||
    candidatePrice <= 0
  )
    return 0.5;
  const logRatio = Math.abs(Math.log10(sourcePrice / candidatePrice));
  return Math.max(0, 1 - logRatio);
}

/** Signal 5: Tag overlap with IDF weighting */
function weightedJaccard(
  sourceTags: string[] | null,
  candidateTags: string[] | null,
): number {
  if (!sourceTags?.length || !candidateTags?.length) return 0;

  const set1 = new Set(sourceTags.map((t) => t.toLowerCase()));
  const set2 = new Set(candidateTags.map((t) => t.toLowerCase()));

  let intersectionWeight = 0;
  let unionWeight = 0;

  const allTags = new Set([...set1, ...set2]);
  for (const tag of allTags) {
    const weight = getTagIdf(tag);
    if (set1.has(tag) && set2.has(tag)) intersectionWeight += weight;
    unionWeight += weight;
  }

  return unionWeight > 0 ? intersectionWeight / unionWeight : 0;
}

/** Signal 7: Image similarity (CLIP cosine — neutral if either embedding missing) */
function imageSimilarity(
  sourceImageEmbedding: number[] | null,
  candidateImageEmbedding: number[] | null,
): number {
  if (!sourceImageEmbedding || !candidateImageEmbedding) return 0.5; // neutral if missing
  return cosineSimilarity(sourceImageEmbedding, candidateImageEmbedding);
}

// ─── Composite Score ───────────────────────────────────

function computeSignalScores(
  source: Record<string, unknown>,
  candidate: CandidateRow,
  sourceImageEmbedding: number[] | null,
): SignalScores {
  const snap = candidate.snapshot_json;
  return {
    semantic: semanticSimilarity(candidate.cosine_similarity),
    image: imageSimilarity(sourceImageEmbedding, candidate.image_embedding),
    tags: weightedJaccard(
      source.tags as string[] | null,
      snap.tags as string[] | null,
    ),
    price: priceProximity(
      source.targetPrice ? Number(source.targetPrice) : null,
      snap.targetPrice ? Number(snap.targetPrice) : null,
    ),
  };
}

interface Weights {
  semantic: number;
  image: number;
  tags: number;
  price: number;
}

function computeCompositeScore(scores: SignalScores, weights: Weights): number {
  return (
    weights.semantic * scores.semantic +
    weights.image * scores.image +
    weights.tags * scores.tags +
    weights.price * scores.price
  );
}

// ─── Match Reasons ─────────────────────────────────────

function generateMatchReasons(scores: SignalScores): string[] {
  const reasons: string[] = [];
  if (scores.semantic >= 0.85) reasons.push("Very similar item");
  if (scores.image >= 0.8) reasons.push("Looks similar");
  if (scores.price >= 0.8) reasons.push("Similar price range");
  if (scores.tags >= 0.5) reasons.push("Matching tags");
  return reasons;
}

// ─── Cosine Similarity (for MMR) ───────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

// ─── Stage 3: MMR Reranking ────────────────────────────

// ─── Main Pipeline ─────────────────────────────────────

export async function findSimilarListings(
  db: Database,
  publishedListingId: string,
  sourceSnapshot: Record<string, unknown>,
  sourceEmbedding: number[],
  sourceImageEmbedding: number[] | null,
  options: {
    limit?: number;
    userId?: string | null;
    threshold?: number;
    excludeViewed?: boolean;
    skipCategoryFilter?: boolean;
    weights?: Weights;
  } = {},
): Promise<ScoredCandidate[]> {
  const {
    limit = 10,
    userId = null,
    excludeViewed = false,
    skipCategoryFilter = false,
    weights = WEIGHTS_DETAIL,
  } = options;

  // Stage 1: Candidate generation via pgvector ANN search
  const embeddingStr = `[${sourceEmbedding.join(",")}]`;

  // Build exclusion clauses
  const userFilter = userId
    ? sql`AND ld.user_id IS DISTINCT FROM ${userId}`
    : sql``;

  // Dashboard mode: no source listing to exclude
  const listingFilter =
    publishedListingId === "__none__"
      ? sql``
      : sql`AND lp.id != ${publishedListingId}`;

  // Exclude already-viewed listings (only for dashboard recommendations)
  const viewedFilter =
    excludeViewed && userId
      ? sql`AND lp.id NOT IN (SELECT published_listing_id FROM buyer_listings WHERE user_id = ${userId})`
      : sql``;

  // Same category filter — only for detail page, not dashboard
  const sourceCategory = sourceSnapshot.category as string | null;
  const categoryFilter =
    !skipCategoryFilter && sourceCategory
      ? sql`AND lp.snapshot_json->>'category' = ${sourceCategory}`
      : sql``;

  const candidates = await db.execute(sql`
    SELECT
      lp.id,
      lp.public_id,
      lp.draft_id,
      lp.snapshot_json,
      le.text_embedding,
      le.image_embedding,
      1 - (le.text_embedding <=> ${embeddingStr}::vector) AS cosine_similarity
    FROM listings_published lp
    JOIN listing_embeddings le ON le.published_listing_id = lp.id
    JOIN listing_drafts ld ON ld.id = lp.draft_id
    WHERE true
      ${listingFilter}
      ${userFilter}
      ${viewedFilter}
      ${categoryFilter}
      AND ld.status = 'published'
      AND (ld.selling_deadline > NOW() OR ld.selling_deadline IS NULL)
      AND le.text_embedding IS NOT NULL
      AND le.status = 'completed'
    ORDER BY le.text_embedding <=> ${embeddingStr}::vector
    LIMIT 100
  `);

  // Parse embedding strings from pgvector raw SQL results
  const rawRows = candidates as unknown as Array<Record<string, unknown>>;
  const rows: CandidateRow[] = rawRows.map(
    (r) =>
      ({
        ...r,
        text_embedding:
          typeof r.text_embedding === "string"
            ? (r.text_embedding as string).slice(1, -1).split(",").map(Number)
            : (r.text_embedding as number[]),
        image_embedding: r.image_embedding
          ? typeof r.image_embedding === "string"
            ? (r.image_embedding as string).slice(1, -1).split(",").map(Number)
            : (r.image_embedding as number[])
          : null,
        cosine_similarity: Number(r.cosine_similarity),
      }) as CandidateRow,
  );

  if (rows.length === 0) return [];

  // Stage 2: Multi-signal scoring
  let scored: ScoredCandidate[] = rows.map((candidate) => {
    const scores = computeSignalScores(
      sourceSnapshot,
      candidate,
      sourceImageEmbedding,
    );
    const compositeScore = computeCompositeScore(scores, weights);
    return { candidate, scores, compositeScore };
  });

  // Filter by minimum similarity threshold
  const threshold = options.threshold ?? SIMILARITY_THRESHOLD_DETAIL;
  scored = scored.filter((s) => s.compositeScore >= threshold);

  if (scored.length === 0) return [];

  // Sort by composite score descending
  scored.sort((a, b) => b.compositeScore - a.compositeScore);

  // Return top results sorted by composite score (highest first)
  return scored.slice(0, limit);
}

// ─── Public API Helper ─────────────────────────────────

export async function getSimilarListingsForPublicId(
  db: Database,
  publicId: string,
  options: { limit?: number; userId?: string | null } = {},
): Promise<{
  listings: SimilarListingResult[];
  meta: Record<string, unknown>;
} | null> {
  // Look up the published listing
  const published = await db.execute<{
    id: string;
    snapshot_json: Record<string, unknown>;
  }>(sql`
    SELECT id, snapshot_json FROM listings_published WHERE public_id = ${publicId}
  `);

  const pubRows = published as unknown as Array<{
    id: string;
    snapshot_json: Record<string, unknown>;
  }>;
  if (pubRows.length === 0) return null;

  const { id: publishedListingId, snapshot_json: sourceSnapshot } = pubRows[0];

  // Get source embeddings (text + image)
  const embRows = await db.execute(sql`
    SELECT text_embedding, image_embedding FROM listing_embeddings
    WHERE published_listing_id = ${publishedListingId}
      AND status = 'completed'
      AND text_embedding IS NOT NULL
  `);

  const embResult = embRows as unknown as Array<Record<string, unknown>>;
  if (embResult.length === 0) {
    // Source listing has no embedding yet
    return {
      listings: [],
      meta: {
        sourcePublicId: publicId,
        totalCandidates: 0,
        algorithm: "multi-signal-v1",
      },
    };
  }

  // pgvector returns embedding as string "[0.1,0.2,...]" via raw SQL — parse to number[]
  const rawTextEmb = embResult[0].text_embedding;
  const sourceEmbedding: number[] =
    typeof rawTextEmb === "string"
      ? (rawTextEmb as string).slice(1, -1).split(",").map(Number)
      : (rawTextEmb as number[]);

  const rawImageEmb = embResult[0].image_embedding;
  const sourceImageEmbedding: number[] | null = rawImageEmb
    ? typeof rawImageEmb === "string"
      ? (rawImageEmb as string).slice(1, -1).split(",").map(Number)
      : (rawImageEmb as number[])
    : null;

  // Run pipeline
  const results = await findSimilarListings(
    db,
    publishedListingId,
    sourceSnapshot,
    sourceEmbedding,
    sourceImageEmbedding,
    options,
  );

  // Save recommendation logs + build response
  const listings: SimilarListingResult[] = [];

  for (let i = 0; i < results.length; i++) {
    const { candidate, scores, compositeScore } = results[i];
    const snap = candidate.snapshot_json;

    // Insert recommendation log
    const [logRow] = await db
      .insert(recommendationLogs)
      .values({
        userId: options.userId ?? undefined,
        context: "detail_page",
        sourceType: "single_listing",
        sourceListingId: publishedListingId,
        recommendedListingId: candidate.id,
        position: i + 1,
        compositeScore: compositeScore.toFixed(4),
        signalScores: scores as unknown as Record<string, number>,
      })
      .returning({ id: recommendationLogs.id });

    listings.push({
      publicId: candidate.public_id,
      title: (snap.title as string) || "",
      category: (snap.category as string) || null,
      condition: (snap.condition as string) || null,
      photoUrl: (snap.photoUrl as string) || null,
      targetPrice: snap.targetPrice ? String(snap.targetPrice) : null,
      sellingDeadline: snap.sellingDeadline
        ? String(snap.sellingDeadline)
        : null,
      similarityScore: Math.round(compositeScore * 100) / 100,
      matchReasons: generateMatchReasons(scores),
      logId: logRow.id,
    });
  }

  return {
    listings,
    meta: {
      sourcePublicId: publicId,
      totalCandidates: results.length,
      algorithm: "multi-signal-v1",
    },
  };
}

// ─── Interest Vector ───────────────────────────────────

const ENGAGEMENT_MULTIPLIER: Record<string, number> = {
  viewed: 1.0,
  negotiating: 3.0,
  completed: 5.0,
  cancelled: 0.5,
};

/** Exponential decay with 24-hour half-life. */
function computeRecencyDecay(lastViewedAt: Date): number {
  const hoursAgo = (Date.now() - lastViewedAt.getTime()) / (1000 * 60 * 60);
  return Math.exp(-0.029 * hoursAgo); // ln(2)/24 ≈ 0.029
}

/** Frequency boost: more views = more interest, capped at 5. */
function computeFrequencyBoost(viewCount: number): number {
  return Math.min(viewCount, 5) / 5;
}

/**
 * Compute and store Interest Vector for a user.
 * Weighted average of recent 50 viewed listings' embeddings.
 * Fire-and-forget — call without await from POST /api/viewed.
 */
export async function recomputeInterestVector(db: Database, userId: string) {
  // Fetch recent 50 viewed listings with their embeddings
  const rows = await db.execute<{
    status: string;
    view_count: number;
    last_viewed_at: string;
    text_embedding: string;
  }>(sql`
    SELECT
      bl.status,
      bl.view_count,
      bl.last_viewed_at,
      le.text_embedding
    FROM buyer_listings bl
    JOIN listing_embeddings le ON le.published_listing_id = bl.published_listing_id
    WHERE bl.user_id = ${userId}
      AND le.status = 'completed'
      AND le.text_embedding IS NOT NULL
    ORDER BY bl.last_viewed_at DESC
    LIMIT 50
  `);

  const viewedRows = rows as unknown as Array<{
    status: string;
    view_count: number;
    last_viewed_at: string;
    text_embedding: string;
  }>;

  if (viewedRows.length === 0) return;

  const dimension = 1536;
  const weighted = new Array(dimension).fill(0);
  let totalWeight = 0;

  for (const row of viewedRows) {
    const embedding =
      typeof row.text_embedding === "string"
        ? row.text_embedding.slice(1, -1).split(",").map(Number)
        : (row.text_embedding as unknown as number[]);

    const recency = computeRecencyDecay(new Date(row.last_viewed_at));
    const engagement = ENGAGEMENT_MULTIPLIER[row.status] ?? 1.0;
    const frequency = computeFrequencyBoost(row.view_count);

    const weight = recency * engagement * frequency;
    totalWeight += weight;

    for (let i = 0; i < dimension; i++) {
      weighted[i] += embedding[i] * weight;
    }
  }

  // Normalize
  if (totalWeight > 0) {
    for (let i = 0; i < dimension; i++) {
      weighted[i] /= totalWeight;
    }
  }

  // Upsert into buyer_interest_vectors
  const vectorStr = `[${weighted.join(",")}]`;
  await db.execute(sql`
    INSERT INTO buyer_interest_vectors (user_id, interest_vector, based_on_count, updated_at)
    VALUES (${userId}, ${vectorStr}::vector, ${viewedRows.length}, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      interest_vector = ${vectorStr}::vector,
      based_on_count = ${viewedRows.length},
      updated_at = NOW()
  `);
}

// ─── Dashboard Recommendations ─────────────────────────

export async function getDashboardRecommendations(
  db: Database,
  userId: string,
  options: { limit?: number } = {},
): Promise<{
  listings: SimilarListingResult[];
  meta: Record<string, unknown>;
}> {
  const { limit = 10 } = options;

  // Fetch Interest Vector
  const ivRows = await db.execute(sql`
    SELECT interest_vector, based_on_count
    FROM buyer_interest_vectors
    WHERE user_id = ${userId}
  `);

  const ivResult = ivRows as unknown as Array<Record<string, unknown>>;

  // No Interest Vector → empty state
  if (!ivResult || ivResult.length === 0 || !ivResult[0]?.interest_vector) {
    return {
      listings: [],
      meta: {
        source: "empty",
        basedOnCount: 0,
        totalCandidates: 0,
        algorithm: "multi-signal-v1",
      },
    };
  }

  const rawVector = ivResult[0].interest_vector as string;
  const basedOnCount = Number(ivResult[0].based_on_count) || 0;
  const interestVector: number[] =
    typeof rawVector === "string"
      ? rawVector.slice(1, -1).split(",").map(Number)
      : (rawVector as unknown as number[]);

  // Build synthetic snapshot from user's viewing history
  // So Stage 2 signals (category, price, condition, tags) have meaningful comparison targets
  const viewedData = await db.execute<{
    category: string | null;
    condition: string | null;
    target_price: string | null;
    tags: string[] | null;
  }>(sql`
    SELECT
      lp.snapshot_json->>'category' AS category,
      lp.snapshot_json->>'condition' AS condition,
      lp.snapshot_json->>'targetPrice' AS target_price,
      CASE WHEN jsonb_typeof(lp.snapshot_json->'tags') = 'array'
        THEN ARRAY(SELECT jsonb_array_elements_text(lp.snapshot_json->'tags'))
        ELSE '{}'::text[]
      END AS tags
    FROM buyer_listings bl
    JOIN listings_published lp ON lp.id = bl.published_listing_id
    WHERE bl.user_id = ${userId}
    ORDER BY bl.last_viewed_at DESC
    LIMIT 50
  `);

  const viewedRows = viewedData as unknown as Array<{
    category: string | null;
    condition: string | null;
    target_price: string | null;
    tags: string[] | null;
  }>;

  // Most common category
  const categoryCounts: Record<string, number> = {};
  for (const r of viewedRows) {
    if (r.category)
      categoryCounts[r.category] = (categoryCounts[r.category] ?? 0) + 1;
  }
  const topCategory =
    Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  // Most common condition
  const conditionCounts: Record<string, number> = {};
  for (const r of viewedRows) {
    if (r.condition)
      conditionCounts[r.condition] = (conditionCounts[r.condition] ?? 0) + 1;
  }
  const topCondition =
    Object.entries(conditionCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  // Average price
  const prices = viewedRows
    .map((r) => Number(r.target_price))
    .filter((p) => p > 0);
  const avgPrice =
    prices.length > 0
      ? prices.reduce((a, b) => a + b, 0) / prices.length
      : null;

  // Merged tags
  const allTags = viewedRows.flatMap((r) => r.tags ?? []);
  const uniqueTags = [...new Set(allTags)];

  const syntheticSnapshot: Record<string, unknown> = {
    category: topCategory,
    condition: topCondition,
    targetPrice: avgPrice ? String(avgPrice.toFixed(2)) : null,
    tags: uniqueTags.slice(0, 10),
  };

  const MIN_RESULTS = 4;

  // First try: exclude viewed listings
  let results = await findSimilarListings(
    db,
    "__none__",
    syntheticSnapshot,
    interestVector,
    null,
    {
      limit,
      userId,
      threshold: SIMILARITY_THRESHOLD_DASHBOARD,
      excludeViewed: true,
      skipCategoryFilter: true,
      weights: WEIGHTS_DASHBOARD,
    },
  );

  // Fallback: if not enough results, include viewed listings to fill
  if (results.length < MIN_RESULTS) {
    const viewedIds = new Set(results.map((r) => r.candidate.id));
    const withViewed = await findSimilarListings(
      db,
      "__none__",
      syntheticSnapshot,
      interestVector,
      null,
      {
        limit,
        userId,
        threshold: SIMILARITY_THRESHOLD_DASHBOARD,
        excludeViewed: false,
        skipCategoryFilter: true,
        weights: WEIGHTS_DASHBOARD,
      },
    );
    // Append only new ones (not already in results)
    for (const r of withViewed) {
      if (!viewedIds.has(r.candidate.id)) {
        results.push(r);
        if (results.length >= limit) break;
      }
    }
  }

  // Save recommendation logs + build response
  const listings: SimilarListingResult[] = [];

  for (let i = 0; i < results.length; i++) {
    const { candidate, scores, compositeScore } = results[i];
    const snap = candidate.snapshot_json;

    const [logRow] = await db
      .insert(recommendationLogs)
      .values({
        userId,
        context: "dashboard",
        sourceType: "interest_vector",
        recommendedListingId: candidate.id,
        position: i + 1,
        compositeScore: compositeScore.toFixed(4),
        signalScores: scores as unknown as Record<string, number>,
      })
      .returning({ id: recommendationLogs.id });

    listings.push({
      publicId: candidate.public_id,
      title: (snap.title as string) || "",
      category: (snap.category as string) || null,
      condition: (snap.condition as string) || null,
      photoUrl: (snap.photoUrl as string) || null,
      targetPrice: snap.targetPrice ? String(snap.targetPrice) : null,
      sellingDeadline: snap.sellingDeadline
        ? String(snap.sellingDeadline)
        : null,
      similarityScore: Math.round(compositeScore * 100) / 100,
      matchReasons: generateMatchReasons(scores),
      logId: logRow.id,
    });
  }

  return {
    listings,
    meta: {
      source: "interest_vector",
      basedOnCount: basedOnCount,
      totalCandidates: results.length,
      algorithm: "multi-signal-v1",
    },
  };
}
