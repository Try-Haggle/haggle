/**
 * Tag Placement Orchestrator — L0~L8 pipeline (Step 53).
 *
 * Combines Steps 50 (pruneAncestorsFromSet), 51 (gatherTagCandidates),
 * and 52 (placeTagsWithLlm) into the full L0~L8 placement pipeline:
 *
 *   L0 Cache lookup   (sha256 key on normalized input + candidate set)
 *   L1 Rules prefix   (MVP skip)
 *   L2 Candidates     (Step 51)
 *   L3 IG prefilter   (ancestor drop + low-IDF cut → maxCandidates)
 *   L4 Ref mapping    (Step 52 internal)
 *   L5 LLM call       (Step 52)
 *   L6 Validate       (Step 52 internal)
 *   L7 DAG cleanup    (Step 50 — only when selected > 1)
 *   L8 Persist        (cache upsert + suggestions queue)
 *
 * Never throws. All error paths return a graceful result with a fully
 * populated trace. Cache HIT skips the LLM entirely. LLM failure falls
 * back to top-N filtered candidates.
 *
 * See handoff/ARCHITECT-BRIEF.md Step 53 and
 * docs/features/tag-system-design.md §3.3.
 */

import { createHash } from "node:crypto";
import { sql, type Database } from "@haggle/db";
import {
  gatherTagCandidates,
  type TagCandidate,
} from "./tag-candidate.service.js";
import { pruneAncestorsFromSet } from "./tag-graph.service.js";
import {
  placeTagsWithLlm,
  TAG_PLACEMENT_MODEL_DEFAULT,
  type ProposedTag,
} from "./tag-placement-llm.service.js";

// ─── Public types ────────────────────────────────────────────────────

export interface PlacementInput {
  title: string;
  description: string;
  category: string | null;
  priceBand?: string | null;
  listingId?: string | null;
  sourceEmbedding?: number[] | null;
}

export interface PlacementTrace {
  cacheHit: boolean;
  candidatesGathered: number;
  candidatesAfterPrefilter: number;
  usedLlm: boolean;
  llmOk: boolean | null;
  llmError?: string;
  fallbackUsed: boolean;
  suggestionsQueued: number;
  latencyMs: {
    candidates: number;
    prefilter: number;
    llm: number | null;
    dagCleanup: number;
    persist: number;
    total: number;
  };
}

export interface PlacementResult {
  selectedTagIds: string[];
  reasoning: string;
  source: "cache" | "llm" | "fallback";
  modelVersion: string | null;
  cacheKey: string;
  trace: PlacementTrace;
}

export interface PlaceListingTagsOptions {
  bypassCache?: boolean;
  maxCandidates?: number;
}

const IDF_FLOOR = 0.5;
const DEFAULT_MAX_CANDIDATES = 20;
const FALLBACK_TAKE = 5;

// ─── computeCacheKey ────────────────────────────────────────────────

export function computeCacheKey(
  input: PlacementInput,
  candidateIds: string[],
  modelVersion: string,
): string {
  const normalized = {
    title: (input.title ?? "").trim().toLowerCase(),
    description: (input.description ?? "").trim().toLowerCase().slice(0, 300),
    category: input.category ?? "",
    candidates: [...candidateIds].sort().join(","),
    model: modelVersion,
  };
  const serialized = JSON.stringify(normalized);
  return createHash("sha256").update(serialized).digest("hex");
}

// ─── prefilterCandidates (L3) ───────────────────────────────────────

export async function prefilterCandidates(
  db: Database,
  candidates: TagCandidate[],
  maxOutput: number,
): Promise<TagCandidate[]> {
  if (candidates.length === 0) return [];

  // Step 1: drop low-IDF (too common) with safety fallback.
  let filtered = candidates.filter((c) => c.idf >= IDF_FLOOR);
  if (filtered.length === 0) filtered = [...candidates];

  // Step 2: ancestor pruning — keep most specific tags only.
  try {
    const ids = filtered.map((c) => c.id);
    const kept = await pruneAncestorsFromSet(db, ids);
    const keptSet = new Set(kept);
    filtered = filtered.filter((c) => keptSet.has(c.id));
  } catch {
    // On graph error, fall through with the IDF-filtered set.
  }

  // Step 3: cap to maxOutput while preserving upstream ordering.
  return filtered.slice(0, maxOutput);
}

// ─── queueProposedTags (L8 part b) ──────────────────────────────────

export async function queueProposedTags(
  db: Database,
  proposed: ProposedTag[],
  firstSeenListingId: string | null,
): Promise<number> {
  if (!proposed || proposed.length === 0) return 0;

  // Dedup by normalized label, drop empties.
  const seen = new Set<string>();
  const deduped: Array<{ label: string; normalized: string; category: string; reason: string }> = [];
  for (const tag of proposed) {
    if (typeof tag?.label !== "string") continue;
    const normalized = tag.label.trim().toLowerCase().replace(/\s+/g, "-");
    if (normalized.length === 0) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push({
      label: tag.label.trim(),
      normalized,
      category: tag.category ?? "other",
      reason: tag.reason ?? "",
    });
  }
  if (deduped.length === 0) return 0;

  let count = 0;
  for (const { label, normalized, category, reason } of deduped) {
    try {
      // tag_suggestions has no metadata column — category/reason go to telemetry only
      await db.execute(sql`
        INSERT INTO tag_suggestions (label, normalized_label, suggested_by, first_seen_listing_id, occurrence_count, status)
        VALUES (${label}, ${normalized}, 'LLM', ${firstSeenListingId}, 1, 'PENDING')
        ON CONFLICT (normalized_label) DO UPDATE
          SET occurrence_count = tag_suggestions.occurrence_count + 1,
              updated_at = NOW()
      `);
      count++;
      // Telemetry: log category and reason for admin context
      console.info(
        `[tag-proposal] queued "${normalized}" category=${category} reason="${reason}" listing=${firstSeenListingId ?? "null"}`,
      );
    } catch {
      // Swallow — suggestion queue is best-effort.
    }
  }
  return count;
}

/**
 * @deprecated Use queueProposedTags instead. Kept for backward compatibility.
 */
export async function queueMissingTags(
  db: Database,
  labels: string[],
  firstSeenListingId: string | null,
): Promise<number> {
  const proposed: ProposedTag[] = labels.map((l) => ({
    label: l,
    category: "other",
    reason: "",
  }));
  return queueProposedTags(db, proposed, firstSeenListingId);
}

// ─── Main orchestrator ──────────────────────────────────────────────

export async function placeListingTags(
  db: Database,
  input: PlacementInput,
  options: PlaceListingTagsOptions = {},
): Promise<PlacementResult> {
  const { bypassCache = false, maxCandidates = DEFAULT_MAX_CANDIDATES } =
    options;
  const startedAt = Date.now();
  const trace: PlacementTrace = {
    cacheHit: false,
    candidatesGathered: 0,
    candidatesAfterPrefilter: 0,
    usedLlm: false,
    llmOk: null,
    fallbackUsed: false,
    suggestionsQueued: 0,
    latencyMs: {
      candidates: 0,
      prefilter: 0,
      llm: null,
      dagCleanup: 0,
      persist: 0,
      total: 0,
    },
  };

  const modelVersion =
    process.env.TAG_PLACEMENT_MODEL || TAG_PLACEMENT_MODEL_DEFAULT;

  const finish = (result: Omit<PlacementResult, "trace">): PlacementResult => {
    trace.latencyMs.total = Math.max(1, Date.now() - startedAt);
    return { ...result, trace };
  };

  // ── L2: gather candidates ───────────────────────────────────────
  let rawCandidates: TagCandidate[] = [];
  const t0 = Date.now();
  try {
    rawCandidates = await gatherTagCandidates(
      db,
      {
        title: input.title,
        description: input.description,
        category: input.category,
        listingId: input.listingId ?? null,
        sourceEmbedding: input.sourceEmbedding ?? null,
      },
      { limit: 40 },
    );
  } catch {
    rawCandidates = [];
  }
  trace.latencyMs.candidates = Date.now() - t0;
  trace.candidatesGathered = rawCandidates.length;

  // ── L3: prefilter ───────────────────────────────────────────────
  let filtered: TagCandidate[] = [];
  const t1 = Date.now();
  try {
    filtered = await prefilterCandidates(db, rawCandidates, maxCandidates);
  } catch {
    filtered = [];
  }
  trace.latencyMs.prefilter = Date.now() - t1;
  trace.candidatesAfterPrefilter = filtered.length;

  const candidateIds = filtered.map((c) => c.id);
  const cacheKey = computeCacheKey(input, candidateIds, modelVersion);

  // ── L0: cache lookup ────────────────────────────────────────────
  if (!bypassCache && filtered.length > 0) {
    try {
      const cached = (await db.execute(sql`
        SELECT selected_tag_ids, reasoning FROM tag_placement_cache WHERE cache_key = ${cacheKey}
      `)) as unknown as Array<{
        selected_tag_ids: string[];
        reasoning: string | null;
      }>;
      const hit = Array.isArray(cached) ? cached[0] : undefined;
      if (hit && Array.isArray(hit.selected_tag_ids)) {
        trace.cacheHit = true;
        try {
          await db.execute(sql`
            UPDATE tag_placement_cache
               SET hit_count = hit_count + 1, last_used_at = NOW()
             WHERE cache_key = ${cacheKey}
          `);
        } catch {
          // hit stats are best-effort.
        }
        return finish({
          selectedTagIds: hit.selected_tag_ids,
          reasoning: hit.reasoning ?? "",
          source: "cache",
          modelVersion,
          cacheKey,
        });
      }
    } catch {
      // Cache read failure → treat as MISS.
    }
  }

  // ── Empty candidate set → graceful fallback ─────────────────────
  if (filtered.length === 0) {
    return finish({
      selectedTagIds: [],
      reasoning: "",
      source: "fallback",
      modelVersion: null,
      cacheKey,
    });
  }

  // ── L4+L5+L6: LLM call ──────────────────────────────────────────
  trace.usedLlm = true;
  const t2 = Date.now();
  let llmResult;
  try {
    llmResult = await placeTagsWithLlm({
      title: input.title,
      description: input.description,
      category: input.category,
      priceBand: input.priceBand ?? null,
      candidates: filtered,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    llmResult = {
      ok: false as const,
      error: { code: "OPENAI_ERROR" as const, message },
      modelVersion,
    };
  }
  trace.latencyMs.llm = Date.now() - t2;

  let selectedIds: string[];
  let reasoning: string;
  let proposedTags: ProposedTag[] = [];

  if (llmResult.ok) {
    trace.llmOk = true;
    selectedIds = llmResult.selectedTagIds;
    reasoning = llmResult.reasoning;
    proposedTags = llmResult.proposedTags;
  } else {
    trace.llmOk = false;
    trace.llmError = llmResult.error.code;
    trace.fallbackUsed = true;
    selectedIds = filtered
      .slice(0, Math.min(FALLBACK_TAKE, filtered.length))
      .map((c) => c.id);
    reasoning = `fallback: ${llmResult.error.code}`;
  }

  // ── L7: DAG cleanup (only when > 1 selected) ────────────────────
  const t3 = Date.now();
  if (selectedIds.length > 1) {
    try {
      selectedIds = await pruneAncestorsFromSet(db, selectedIds);
    } catch {
      // On failure, keep pre-cleanup list.
    }
  }
  trace.latencyMs.dagCleanup = Date.now() - t3;

  // ── L8: persist (cache write + suggestions queue) ───────────────
  const t4 = Date.now();
  // Cache missing_tags column is text[] — store labels only for backward compat
  const missingTagLabels = proposedTags.map((t) => t.label);
  try {
    await db.execute(sql`
      INSERT INTO tag_placement_cache (cache_key, selected_tag_ids, reasoning, missing_tags, model_version, hit_count)
      VALUES (${cacheKey}, ${selectedIds}, ${reasoning}, ${missingTagLabels}, ${modelVersion}, 0)
      ON CONFLICT (cache_key) DO UPDATE
        SET selected_tag_ids = EXCLUDED.selected_tag_ids,
            reasoning = EXCLUDED.reasoning,
            missing_tags = EXCLUDED.missing_tags,
            last_used_at = NOW()
    `);
  } catch {
    // Cache write is best-effort.
  }

  if (proposedTags.length > 0) {
    trace.suggestionsQueued = await queueProposedTags(
      db,
      proposedTags,
      input.listingId ?? null,
    );
  }
  trace.latencyMs.persist = Date.now() - t4;

  return finish({
    selectedTagIds: selectedIds,
    reasoning,
    source: trace.fallbackUsed ? "fallback" : "llm",
    modelVersion,
    cacheKey,
  });
}
