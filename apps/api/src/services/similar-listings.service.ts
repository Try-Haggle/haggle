import { type Database, categoryRelatedness, tagIdfCache, listingEmbeddings, recommendationLogs, sql } from "@haggle/db";

// ─── In-Memory Caches ──────────────────────────────────

/** Category relatedness matrix: categoryRelatednessMap[from][to] = score */
let categoryRelatednessMap: Record<string, Record<string, number>> = {};

/** Tag IDF scores: idfMap.get(tag) = idf score */
let idfMap: Map<string, number> = new Map();

/** Load category_relatedness table into memory. Call on server startup. */
export async function loadCategoryRelatedness(db: Database) {
  const rows = await db.select().from(categoryRelatedness);
  categoryRelatednessMap = {};
  for (const row of rows) {
    if (!categoryRelatednessMap[row.categoryFrom]) {
      categoryRelatednessMap[row.categoryFrom] = {};
    }
    categoryRelatednessMap[row.categoryFrom][row.categoryTo] = Number(row.score);
  }
  console.log(`[similar-listings] Loaded ${rows.length} category relatedness entries`);
}

/** Load tag_idf_cache table into memory. Call on server startup. */
export async function loadTagIdfCache(db: Database) {
  const rows = await db.select().from(tagIdfCache);
  idfMap = new Map();
  for (const row of rows) {
    idfMap.set(row.tag, Number(row.idfScore));
  }
  console.log(`[similar-listings] Loaded ${rows.length} tag IDF entries`);
}

/** Reload both caches. Call on server startup. */
export async function loadSimilarListingsCaches(db: Database) {
  await loadCategoryRelatedness(db);
  await loadTagIdfCache(db);
}

// ─── Getters for use in signal functions ───────────────

export function getCategoryRelatedness(from: string, to: string): number {
  return categoryRelatednessMap[from]?.[to] ?? 0.0;
}

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
  category: number;
  price: number;
  condition: number;
  tags: number;
  temporal: number;
  image: number;
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

const WEIGHTS = {
  semantic: 0.40,
  category: 0.20,
  tags: 0.15,
  price: 0.12,
  condition: 0.05,
  temporal: 0.05,
  image: 0.03,
} as const;

const MINIMUM_SIMILARITY_THRESHOLD = 0.55;

// ─── Signal Functions ──────────────────────────────────

/** Signal 1: Semantic similarity (pre-computed in Stage 1) */
function semanticSimilarity(cosineSim: number): number {
  return cosineSim;
}

/** Signal 2: Category match using DB-loaded relatedness map */
function categoryMatch(source: string | null, candidate: string | null): number {
  if (!source || !candidate) return 0.5;
  return getCategoryRelatedness(source, candidate);
}

/** Signal 3: Price proximity using log ratio */
function priceProximity(sourcePrice: number | null, candidatePrice: number | null): number {
  if (!sourcePrice || !candidatePrice || sourcePrice <= 0 || candidatePrice <= 0) return 0.5;
  const logRatio = Math.abs(Math.log10(sourcePrice / candidatePrice));
  return Math.max(0, 1 - logRatio);
}

/** Signal 4: Condition proximity using ordinal distance */
const CONDITION_ORDER: Record<string, number> = {
  new: 4,
  like_new: 3,
  good: 2,
  fair: 1,
  poor: 0,
};

function conditionProximity(source: string | null, candidate: string | null): number {
  if (!source || !candidate) return 0.5;
  const s = CONDITION_ORDER[source] ?? 2;
  const c = CONDITION_ORDER[candidate] ?? 2;
  return 1 - Math.abs(s - c) / 4;
}

/** Signal 5: Tag overlap with IDF weighting */
function weightedJaccard(sourceTags: string[] | null, candidateTags: string[] | null): number {
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

/** Signal 6: Temporal relevance (deadline decay) */
function temporalRelevance(sellingDeadline: string | null): number {
  if (!sellingDeadline) return 0.5;

  const now = Date.now();
  const deadline = new Date(sellingDeadline).getTime();
  const remaining = deadline - now;

  if (remaining <= 0) return 0;

  const ONE_DAY = 24 * 60 * 60 * 1000;
  const THIRTY_DAYS = 30 * ONE_DAY;

  if (remaining < ONE_DAY) return 0.2;
  if (remaining < 3 * ONE_DAY) return 0.5;
  if (remaining > THIRTY_DAYS) return 1.0;

  return 0.5 + 0.5 * ((remaining - 3 * ONE_DAY) / (THIRTY_DAYS - 3 * ONE_DAY));
}

/** Signal 7: Image similarity (Phase 1: neutral, Phase 2: CLIP cosine) */
function imageSimilarity(
  _sourceImageEmbedding: number[] | null,
  _candidateImageEmbedding: number[] | null,
): number {
  return 0.5; // Phase 1: always neutral
}

// ─── Composite Score ───────────────────────────────────

function computeSignalScores(
  source: Record<string, unknown>,
  candidate: CandidateRow,
): SignalScores {
  const snap = candidate.snapshot_json;
  return {
    semantic: semanticSimilarity(candidate.cosine_similarity),
    category: categoryMatch(source.category as string | null, snap.category as string | null),
    price: priceProximity(
      source.targetPrice ? Number(source.targetPrice) : null,
      snap.targetPrice ? Number(snap.targetPrice) : null,
    ),
    condition: conditionProximity(source.condition as string | null, snap.condition as string | null),
    tags: weightedJaccard(source.tags as string[] | null, snap.tags as string[] | null),
    temporal: temporalRelevance(snap.sellingDeadline as string | null),
    image: imageSimilarity(null, null),
  };
}

function computeCompositeScore(scores: SignalScores): number {
  return (
    WEIGHTS.semantic * scores.semantic +
    WEIGHTS.category * scores.category +
    WEIGHTS.tags * scores.tags +
    WEIGHTS.price * scores.price +
    WEIGHTS.condition * scores.condition +
    WEIGHTS.temporal * scores.temporal +
    WEIGHTS.image * scores.image
  );
}

// ─── Match Reasons ─────────────────────────────────────

function generateMatchReasons(scores: SignalScores): string[] {
  const reasons: string[] = [];
  if (scores.category >= 0.8) reasons.push("Same category");
  if (scores.price >= 0.8) reasons.push("Similar price range");
  if (scores.condition >= 0.75) reasons.push("Similar condition");
  if (scores.tags >= 0.5) reasons.push("Matching tags");
  if (scores.semantic >= 0.85) reasons.push("Very similar item");
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

function mmrRerank(
  candidates: ScoredCandidate[],
  topK: number,
  lambda: number = 0.7,
): ScoredCandidate[] {
  const selected: ScoredCandidate[] = [];
  const remaining = [...candidates];

  while (selected.length < topK && remaining.length > 0) {
    let bestIdx = -1;
    let bestMmrScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      const relevance = cand.compositeScore;

      const maxSimToSelected =
        selected.length === 0
          ? 0
          : Math.max(
              ...selected.map((s) =>
                cosineSimilarity(cand.candidate.text_embedding, s.candidate.text_embedding),
              ),
            );

      const mmrScore = lambda * relevance - (1 - lambda) * maxSimToSelected;

      if (mmrScore > bestMmrScore) {
        bestMmrScore = mmrScore;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      selected.push(remaining[bestIdx]);
      remaining.splice(bestIdx, 1);
    }
  }

  return selected;
}

// ─── Main Pipeline ─────────────────────────────────────

export async function findSimilarListings(
  db: Database,
  publishedListingId: string,
  sourceSnapshot: Record<string, unknown>,
  sourceEmbedding: number[],
  options: {
    limit?: number;
    userId?: string | null;
  } = {},
): Promise<ScoredCandidate[]> {
  const { limit = 10, userId = null } = options;

  // Stage 1: Candidate generation via pgvector ANN search
  const embeddingStr = `[${sourceEmbedding.join(",")}]`;

  // Build user exclusion clause: only apply when userId is provided (authenticated user)
  // When userId is null (public/anonymous), don't filter by user — otherwise NULL user_id
  // listings get excluded because NULL IS DISTINCT FROM NULL = FALSE
  const userFilter = userId
    ? sql`AND ld.user_id IS DISTINCT FROM ${userId}`
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
    WHERE lp.id != ${publishedListingId}
      ${userFilter}
      AND ld.status = 'published'
      AND (ld.selling_deadline > NOW() OR ld.selling_deadline IS NULL)
      AND le.text_embedding IS NOT NULL
      AND le.status = 'completed'
    ORDER BY le.text_embedding <=> ${embeddingStr}::vector
    LIMIT 100
  `);

  // Parse embedding strings from pgvector raw SQL results
  const rawRows = candidates as unknown as Array<Record<string, unknown>>;
  const rows: CandidateRow[] = rawRows.map((r) => ({
    ...r,
    text_embedding: typeof r.text_embedding === "string"
      ? (r.text_embedding as string).slice(1, -1).split(",").map(Number)
      : (r.text_embedding as number[]),
    image_embedding: r.image_embedding
      ? typeof r.image_embedding === "string"
        ? (r.image_embedding as string).slice(1, -1).split(",").map(Number)
        : (r.image_embedding as number[])
      : null,
    cosine_similarity: Number(r.cosine_similarity),
  } as CandidateRow));

  if (rows.length === 0) return [];

  // Stage 2: Multi-signal scoring
  let scored: ScoredCandidate[] = rows.map((candidate) => {
    const scores = computeSignalScores(sourceSnapshot, candidate);
    const compositeScore = computeCompositeScore(scores);
    return { candidate, scores, compositeScore };
  });

  // Filter by minimum similarity threshold
  scored = scored.filter((s) => s.compositeScore >= MINIMUM_SIMILARITY_THRESHOLD);

  if (scored.length === 0) return [];

  // Sort by composite score descending
  scored.sort((a, b) => b.compositeScore - a.compositeScore);

  // Stage 3: MMR reranking for diversity
  const reranked = mmrRerank(scored, limit);

  return reranked;
}

// ─── Public API Helper ─────────────────────────────────

export async function getSimilarListingsForPublicId(
  db: Database,
  publicId: string,
  options: { limit?: number; userId?: string | null } = {},
): Promise<{ listings: SimilarListingResult[]; meta: Record<string, unknown> } | null> {
  // Look up the published listing
  const published = await db.execute<{
    id: string;
    snapshot_json: Record<string, unknown>;
  }>(sql`
    SELECT id, snapshot_json FROM listings_published WHERE public_id = ${publicId}
  `);

  const pubRows = published as unknown as Array<{ id: string; snapshot_json: Record<string, unknown> }>;
  if (pubRows.length === 0) return null;

  const { id: publishedListingId, snapshot_json: sourceSnapshot } = pubRows[0];

  // Get source embedding
  const embRows = await db.execute<{ text_embedding: number[] }>(sql`
    SELECT text_embedding FROM listing_embeddings
    WHERE published_listing_id = ${publishedListingId}
      AND status = 'completed'
      AND text_embedding IS NOT NULL
  `);

  const embResult = embRows as unknown as Array<{ text_embedding: number[] }>;
  if (embResult.length === 0) {
    // Source listing has no embedding yet
    return { listings: [], meta: { sourcePublicId: publicId, totalCandidates: 0, algorithm: "multi-signal-v1" } };
  }

  // pgvector returns embedding as string "[0.1,0.2,...]" via raw SQL — parse to number[]
  const rawEmb = embResult[0].text_embedding;
  const sourceEmbedding: number[] = typeof rawEmb === "string"
    ? (rawEmb as string).slice(1, -1).split(",").map(Number)
    : rawEmb;

  // Run pipeline
  const results = await findSimilarListings(db, publishedListingId, sourceSnapshot, sourceEmbedding, options);

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
      sellingDeadline: snap.sellingDeadline ? String(snap.sellingDeadline) : null,
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
