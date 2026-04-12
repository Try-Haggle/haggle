/**
 * Tag Candidate Service — L2 of the tag placement pipeline.
 *
 * Gathers up to `limit` (default 40) candidate tags for a listing from
 * three independent routes:
 *
 *   (a) tags used by the most similar listings (by embedding cosine)
 *   (b) global top-N tags by IDF score
 *   (c) tags whose normalized name or alias appears as a word-level
 *       n-gram in the listing title
 *
 * The candidates are then merged, deduplicated, and ranked. The LLM
 * (Step 52) MUST select from this set — it cannot invent new tags.
 *
 * Pure DB layer. No LLM / HTTP calls. Function exports.
 *
 * Step 51 — see handoff/ARCHITECT-BRIEF.md and
 * docs/features/tag-system-design.md §3.3 L2, §4.
 */

import { sql, type Database } from "@haggle/db";
import { getTagIdf } from "./similar-listings.service.js";

// ─── Types ───────────────────────────────────────────────────────────

export interface TagCandidate {
  id: string;
  label: string;
  normalizedLabel: string;
  idf: number;
  parentIds: string[];
  source: Array<"similar" | "idf" | "ngram">;
}

export interface CandidateGatherInput {
  title: string;
  description: string;
  category: string | null;
  /** If already published, used to look up its embedding from listing_embeddings. */
  listingId?: string | null;
  /** If supplied, takes precedence over listingId lookup. */
  sourceEmbedding?: number[] | null;
}

export interface CandidateGatherOptions {
  limit?: number;
  similarListingsK?: number;
  idfTopN?: number;
  ngramMinLen?: number;
  ngramMaxLen?: number;
}

// ─── Internal helpers ────────────────────────────────────────────────

/** Lowercase + trim + collapse internal whitespace runs. */
function normalizeTagName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Tokenize a string by whitespace + ASCII punctuation. */
function tokenize(s: string): string[] {
  return s
    .split(/[\s,.;:!?()\[\]{}"'`/\\|<>~@#$%^&*+=\-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/**
 * Build all sliding word-level n-grams of length [minLen, maxLen]
 * from the given tokens. Returns normalized strings.
 */
function buildNgrams(
  tokens: string[],
  minLen: number,
  maxLen: number,
): string[] {
  const out = new Set<string>();
  const lo = Math.max(1, minLen);
  const hi = Math.max(lo, maxLen);
  // Always also include unigrams (length 1) so single-word tags match
  // even when minLen > 1.
  for (let n = 1; n <= hi; n++) {
    if (n < lo && n !== 1) continue;
    for (let i = 0; i + n <= tokens.length; i++) {
      const slice = tokens.slice(i, i + n).join(" ");
      const norm = normalizeTagName(slice);
      if (norm.length > 0) out.add(norm);
    }
  }
  return Array.from(out);
}

// ─── Route (a): similar listings ─────────────────────────────────────

/**
 * Returns the union of `snapshot_json.tags` arrays from the top-K
 * published listings most similar (by text_embedding cosine) to the
 * input. If neither sourceEmbedding nor a resolvable listingId
 * embedding is available, returns [] (graceful fallback).
 */
export async function gatherFromSimilarListings(
  db: Database,
  input: CandidateGatherInput,
  k: number,
): Promise<string[]> {
  let embedding = input.sourceEmbedding ?? null;

  // If caller didn't pass an embedding, try to fetch one for listingId.
  if ((!embedding || embedding.length === 0) && input.listingId) {
    try {
      const rows = (await db.execute(sql`
        SELECT text_embedding
          FROM listing_embeddings
         WHERE published_listing_id = ${input.listingId}
           AND status = 'completed'
           AND text_embedding IS NOT NULL
         LIMIT 1
      `)) as unknown as Array<{ text_embedding: unknown }>;
      if (rows.length > 0) {
        const raw = rows[0].text_embedding;
        embedding =
          typeof raw === "string"
            ? raw.slice(1, -1).split(",").map(Number)
            : (raw as number[]);
      }
    } catch {
      // graceful: caller-supplied embedding wasn't available
      embedding = null;
    }
  }

  if (!embedding || embedding.length === 0) return [];

  const embStr = `[${embedding.join(",")}]`;
  const excludeId = input.listingId ?? "00000000-0000-0000-0000-000000000000";

  let rows: Array<{ tags: unknown }>;
  try {
    rows = (await db.execute(sql`
      SELECT
        CASE WHEN jsonb_typeof(lp.snapshot_json->'tags') = 'array'
          THEN ARRAY(SELECT jsonb_array_elements_text(lp.snapshot_json->'tags'))
          ELSE '{}'::text[]
        END AS tags
        FROM listings_published lp
        JOIN listing_embeddings le ON le.published_listing_id = lp.id
       WHERE lp.id != ${excludeId}
         AND le.status = 'completed'
         AND le.text_embedding IS NOT NULL
       ORDER BY le.text_embedding <=> ${embStr}::vector
       LIMIT ${k}
    `)) as unknown as Array<{ tags: unknown }>;
  } catch {
    return [];
  }

  const out = new Set<string>();
  for (const row of rows) {
    const tagArr = Array.isArray(row.tags) ? (row.tags as string[]) : [];
    for (const t of tagArr) {
      if (typeof t === "string" && t.length > 0) out.add(t);
    }
  }
  return Array.from(out);
}

// ─── Route (b): IDF top-N ────────────────────────────────────────────

/**
 * Returns the global top-N tag labels from `tag_idf_cache`, ordered
 * by `idf_score` descending. No category filter — category-aware IDF
 * is post-MVP.
 */
export async function gatherFromIdfTop(
  db: Database,
  n: number,
): Promise<string[]> {
  if (n <= 0) return [];
  let rows: Array<{ tag: string }>;
  try {
    rows = (await db.execute(sql`
      SELECT tag
        FROM tag_idf_cache
       ORDER BY idf_score DESC
       LIMIT ${n}
    `)) as unknown as Array<{ tag: string }>;
  } catch {
    return [];
  }
  return rows.map((r) => r.tag).filter((t): t is string => !!t);
}

// ─── Route (c): title n-gram match ───────────────────────────────────

/**
 * Tokenize the title (whitespace/punctuation), build word-level
 * n-grams of length [minLen, maxLen], and match them (case-insensitive)
 * against `tags.normalized_name` or any element of `tags.aliases`.
 *
 * Returns the matched `tags.name` strings (deduped).
 */
export async function gatherFromTitleNgram(
  db: Database,
  title: string,
  minLen: number,
  maxLen: number,
): Promise<string[]> {
  const tokens = tokenize(title);
  if (tokens.length === 0) return [];
  const ngrams = buildNgrams(tokens, minLen, maxLen);
  if (ngrams.length === 0) return [];

  let rows: Array<{ name: string }>;
  try {
    rows = (await db.execute(sql`
      SELECT DISTINCT name
        FROM tags
       WHERE normalized_name = ANY(${ngrams}::text[])
          OR aliases && ${ngrams}::text[]
    `)) as unknown as Array<{ name: string }>;
  } catch {
    return [];
  }
  return rows.map((r) => r.name).filter((n): n is string => !!n);
}

// ─── Resolve labels → TagCandidate rows ──────────────────────────────

/**
 * Look up each label in `tags` (matched on `name` OR `normalized_name`),
 * attach IDF (preferring tag_idf_cache, falling back to tags.idf, then
 * 1.0), attach direct parents from tag_edges, and stamp `source`.
 *
 * Unknown labels are silently dropped (LLM cannot pick them anyway).
 */
export async function resolveLabelsToCandidates(
  db: Database,
  labels: string[],
  source: "similar" | "idf" | "ngram",
): Promise<TagCandidate[]> {
  if (labels.length === 0) return [];

  // Build the deduped lookup sets — match either the original string
  // (e.g., snapshot_json.tags entries) or its normalized form.
  const dedupedRaw = Array.from(new Set(labels.filter((l) => !!l)));
  const dedupedNorm = Array.from(
    new Set(dedupedRaw.map((l) => normalizeTagName(l))),
  );

  let rows: Array<{
    id: string;
    name: string;
    normalized_name: string;
    idf: string | number | null;
  }>;
  try {
    rows = (await db.execute(sql`
      SELECT id, name, normalized_name, idf
        FROM tags
       WHERE name = ANY(${dedupedRaw}::text[])
          OR normalized_name = ANY(${dedupedNorm}::text[])
    `)) as unknown as Array<{
      id: string;
      name: string;
      normalized_name: string;
      idf: string | number | null;
    }>;
  } catch {
    return [];
  }

  if (rows.length === 0) return [];

  // Fetch parents for all matched tag ids in one query.
  const ids = rows.map((r) => r.id);
  let parentRows: Array<{ child_tag_id: string; parent_tag_id: string }>;
  try {
    parentRows = (await db.execute(sql`
      SELECT child_tag_id, parent_tag_id
        FROM tag_edges
       WHERE child_tag_id = ANY(${ids}::uuid[])
    `)) as unknown as Array<{
      child_tag_id: string;
      parent_tag_id: string;
    }>;
  } catch {
    parentRows = [];
  }
  const parentsByChild = new Map<string, string[]>();
  for (const p of parentRows) {
    const list = parentsByChild.get(p.child_tag_id) ?? [];
    list.push(p.parent_tag_id);
    parentsByChild.set(p.child_tag_id, list);
  }

  // Fetch IDF overrides from tag_idf_cache for the matched names.
  const matchedNames = Array.from(new Set(rows.map((r) => r.name)));
  let idfRows: Array<{ tag: string; idf_score: string | number }>;
  try {
    idfRows = (await db.execute(sql`
      SELECT tag, idf_score
        FROM tag_idf_cache
       WHERE tag = ANY(${matchedNames}::text[])
    `)) as unknown as Array<{ tag: string; idf_score: string | number }>;
  } catch {
    idfRows = [];
  }
  const idfByName = new Map<string, number>();
  for (const r of idfRows) {
    idfByName.set(r.tag, Number(r.idf_score));
  }

  return rows.map((r): TagCandidate => {
    // Priority: tag_idf_cache row > in-memory getTagIdf > tags.idf > 1.0
    let idf: number;
    if (idfByName.has(r.name)) {
      idf = idfByName.get(r.name)!;
    } else {
      const memoryIdf = getTagIdf(r.name);
      if (memoryIdf !== 1.0) {
        idf = memoryIdf;
      } else if (r.idf != null && Number(r.idf) > 0) {
        idf = Number(r.idf);
      } else {
        idf = 1.0;
      }
    }
    return {
      id: r.id,
      label: r.name,
      normalizedLabel: r.normalized_name,
      idf,
      parentIds: parentsByChild.get(r.id) ?? [],
      source: [source],
    };
  });
}

// ─── Main entrypoint ─────────────────────────────────────────────────

/**
 * Gather candidates from all 3 routes, dedupe by tag id (unioning the
 * `source` arrays), sort by (multi-source > single-source, higher idf
 * as tiebreaker), and cap to `limit` (default 40).
 *
 * Always returns a TagCandidate[]; never throws for data issues.
 */
export async function gatherTagCandidates(
  db: Database,
  input: CandidateGatherInput,
  options: CandidateGatherOptions = {},
): Promise<TagCandidate[]> {
  const {
    limit = 40,
    similarListingsK = 20,
    idfTopN = 30,
    ngramMinLen = 2,
    ngramMaxLen = 4,
  } = options;

  const [similarLabels, idfLabels, ngramLabels] = await Promise.all([
    gatherFromSimilarListings(db, input, similarListingsK),
    gatherFromIdfTop(db, idfTopN),
    gatherFromTitleNgram(db, input.title, ngramMinLen, ngramMaxLen),
  ]);

  const [a, b, c] = await Promise.all([
    resolveLabelsToCandidates(db, similarLabels, "similar"),
    resolveLabelsToCandidates(db, idfLabels, "idf"),
    resolveLabelsToCandidates(db, ngramLabels, "ngram"),
  ]);

  const merged = new Map<string, TagCandidate>();
  for (const cand of [...a, ...b, ...c]) {
    const existing = merged.get(cand.id);
    if (existing) {
      for (const s of cand.source) {
        if (!existing.source.includes(s)) existing.source.push(s);
      }
    } else {
      merged.set(cand.id, { ...cand, source: [...cand.source] });
    }
  }

  const sorted = [...merged.values()].sort((x, y) => {
    if (y.source.length !== x.source.length) {
      return y.source.length - x.source.length;
    }
    return y.idf - x.idf;
  });

  return sorted.slice(0, limit);
}
