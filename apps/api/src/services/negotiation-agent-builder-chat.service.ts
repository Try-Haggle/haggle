import { createHash } from "node:crypto";
import { type Database, sql } from "@haggle/db";
import {
  buildCategoryCriteriaScaffold,
  type CategoryCriterion,
  criterionAnswered,
  isTaxonomyCheckId,
  priceSemantics,
} from "@haggle/shared";
// (FastifyInstance import removed — this is now a pure service file)
import { z } from "zod";
import { callLLM } from "../negotiation/adapters/deepseek-client.js";
import { getBuilderLlmModel } from "../negotiation/decide-model.js";
import { getAgentVoiceProfile } from "../negotiation/negotiation-agent-voice-profiles.js";
import {
  type AdvisorCandidatePlan,
  buildAdvisorCandidatePlan,
} from "../services/advisor-candidate-planner.service.js";
import { generateTextEmbedding } from "../services/embedding.service.js";
import {
  buildAdvisorRequirementPlan,
  EMPTY_TAG_REQUIREMENT_PLAN,
  formatTagRequirementPlanForPrompt,
  type LearnedCheckForRequirements,
  type TagRequirementPlan,
  type TagRequirementSlot,
} from "../services/tag-garden-requirements.js";
import {
  LEARNING_DUPLICATE_SIMILARITY,
  learningWriteScopes,
  questionSimilarity,
  questionTokens,
} from "./category-check-learning.service.js";

const DEMO_USER_ID = "11111111-1111-4111-8111-111111111111";
const INPUT_TOKEN_USD = 0.0000002;
const OUTPUT_TOKEN_USD = 0.0000005;

const optionalPositiveIntSchema = z.preprocess(
  (value) => (value === null ? undefined : value),
  z.number().int().positive().optional(),
);

// The LLM emits `null` (not omission) when a signal is absent; coerce to
// undefined so an absent urgency doesn't fail validation.
const optionalStringSchema = z.preprocess(
  (value) => (value === null ? undefined : value),
  z.string().optional(),
);

// Phase G deterministic layer: per-item negotiation criteria keyed to a taxonomy
// check id. WE own checkId/questionKo/enforcement (from the taxonomy scaffold);
// reconcileCategoryCriteria re-authors every field except requirement/stance from the
// scaffold, so this schema is deliberately LENIENT about what the LLM returns. The LLM
// often emits requirement:"" (empty string), which `.default()` does NOT catch (it
// only fills missing/undefined), so we preprocess invalid enum values to the default
// rather than throwing (which surfaced as a 502 on the whole turn).
// Coerce an invalid/empty enum value to undefined (not a hard default), so downstream
// reconcile falls back to the taxonomy scaffold's own default (e.g. a HARD check →
// "required") instead of being forced to a filler value.
const optionalEnum = <T extends string>(allowed: readonly T[]) =>
  z.preprocess(
    (v) => (typeof v === "string" && (allowed as readonly string[]).includes(v) ? v : undefined),
    z.enum(allowed as [T, ...T[]]).optional(),
  );
const categoryCriterionSchema = z.object({
  checkId: z.string().default(""),
  questionKo: z.string().default(""),
  buyerAskKo: optionalStringSchema,
  enforcement: optionalEnum(["hard", "soft"] as const),
  requirement: optionalEnum(["required", "optional"] as const),
  stance: optionalStringSchema,
});

const structuredNegotiationAgentBuilderMemorySchema = z
  .object({
    activeIntent: z
      .object({
        productScope: z.string().optional(),
        source: z.string().optional(),
      })
      .optional(),
    productRequirements: z
      .record(
        z.string(),
        z.object({
          mustHave: z.array(z.string()).default([]),
          avoid: z.array(z.string()).default([]),
          answeredSlots: z.array(z.string()).default([]),
          ambiguousSlots: z.array(z.string()).default([]),
        }),
      )
      .prefault({}),
    globalPreferences: z
      .object({
        mustHave: z.array(z.string()).default([]),
        avoid: z.array(z.string()).default([]),
        budgetMax: optionalPositiveIntSchema,
        targetPrice: optionalPositiveIntSchema,
        riskStyle: z.enum(["safe_first", "balanced", "lowest_price"]).optional(),
        negotiationStyle: z.enum(["defensive", "balanced", "aggressive"]).optional(),
        openingTactic: z.enum(["condition_anchor", "fair_market_anchor", "speed_close"]).optional(),
      })
      .prefault({}),
    pendingSlots: z
      .array(
        z.object({
          slotId: z.string(),
          question: z.string(),
          enforcement: z.enum(["hard", "soft"]),
          productScope: z.string().optional(),
          status: z.enum(["pending", "ambiguous"]),
        }),
      )
      .default([]),
    discardedSignals: z
      .array(
        z.object({
          text: z.string(),
          reason: z.enum(["off_topic", "ambiguous", "noise", "security"]),
          relatedQuestion: z.string().optional(),
        }),
      )
      .default([]),
    memoryConflicts: z
      .array(
        z.object({
          slotId: z.string(),
          productScope: z.string().optional(),
          previousValue: z.string().optional(),
          currentValue: z.string().optional(),
          status: z.enum(["current", "superseded", "conflicting", "needs_confirmation"]),
          resolutionQuestion: z.string().optional(),
          reason: z.string().optional(),
        }),
      )
      .default([]),
    scopedConditionDecisions: z
      .array(
        z.object({
          slotId: z.string(),
          sourceScope: z.string().optional(),
          targetScope: z.string(),
          decision: z.enum(["applied", "rejected"]),
          reason: z.string().optional(),
        }),
      )
      .default([]),
    sessionMemory: z
      .object({
        facts: z.array(z.string()).default([]),
        pendingQuestions: z.array(z.string()).default([]),
        reason: z.string().optional(),
      })
      .optional(),
    longTermMemory: z
      .object({
        facts: z.array(z.string()).default([]),
        productScopes: z.array(z.string()).default([]),
        globalFacts: z.array(z.string()).default([]),
      })
      .optional(),
    promotionDecisions: z
      .array(
        z.object({
          text: z.string(),
          decision: z.enum(["promote", "session_only", "discard"]),
          reason: z.enum([
            "confirmed_product_requirement",
            "explicit_budget",
            "stable_global_preference",
            "pending_hard_slot",
            "ambiguous",
            "off_topic",
            "security",
            "low_information",
          ]),
          target: z.enum(["long_term", "session", "none"]),
          productScope: z.string().optional(),
        }),
      )
      .default([]),
    compression: z
      .object({
        recentWindowFacts: z.array(z.string()).default([]),
        carriedForwardFacts: z.array(z.string()).default([]),
        droppedSignals: z.array(z.string()).default([]),
        summary: z.string(),
      })
      .optional(),
    questionPlan: z
      .object({
        policy: z.object({
          maxQuestionsPerTurn: z.number().int().positive(),
          order: z.array(
            z.enum(["conflict_resolution", "hard_slot", "candidate_narrowing", "soft_slot"]),
          ),
          rationale: z.string(),
        }),
        budget: z.object({
          maxQuestionsPerTurn: z.number().int().positive(),
          used: z.number().int().min(0),
        }),
        askedThisTurn: z.object({
          kind: z.enum(["conflict", "hard_slot", "soft_slot", "candidate", "none"]),
          question: z.string().optional(),
          slotId: z.string().optional(),
          productScope: z.string().optional(),
        }),
        deferred: z
          .array(
            z.object({
              slotId: z.string(),
              question: z.string(),
              enforcement: z.enum(["hard", "soft"]),
              reason: z.enum([
                "question_budget",
                "conflict_resolution_first",
                "lower_priority",
                "already_answered",
              ]),
              productScope: z.string().optional(),
            }),
          )
          .default([]),
      })
      .optional(),
  })
  .prefault({});

const negotiationAgentBuilderMemorySchema = z.object({
  categoryInterest: z.string().min(1),
  budgetMax: optionalPositiveIntSchema,
  targetPrice: optionalPositiveIntSchema,
  mustHave: z.array(z.string()).default([]),
  avoid: z.array(z.string()).default([]),
  // Negotiation-facing signals consumed by the adapter's encodeStrategyContext.
  // dealBreakers: hard non-negotiables. mustEmphasize: leverage points to push.
  // notes: discretionary/ambiguous guidance ("use your judgment"). urgency: a
  // short inferred descriptor of how rushed the principal is.
  dealBreakers: z.array(z.string()).default([]),
  mustEmphasize: z.array(z.string()).default([]),
  notes: z.array(z.string()).default([]),
  // Phase G structured layer (taxonomy-keyed). Distinct from the free-text buckets
  // above, which carry LLM long-tail criteria; this carries the taxonomy checks so
  // the three flows connect by check id (seller declares → buyer mirrors → runtime
  // pauses on gaps).
  categoryCriteria: z.array(categoryCriterionSchema).default([]),
  urgency: optionalStringSchema,
  riskStyle: z.enum(["safe_first", "balanced", "lowest_price"]),
  negotiationStyle: z.enum(["defensive", "balanced", "aggressive"]),
  openingTactic: z.enum(["condition_anchor", "fair_market_anchor", "speed_close"]),
  questions: z.array(z.string()).default([]),
  source: z.array(z.string()).default([]),
  structured: structuredNegotiationAgentBuilderMemorySchema.optional(),
});

/**
 * Durable builder-memory fields worth persisting on an agent. Everything else
 * the chat returns — `structured` (the LLM's per-turn context-engineering
 * scratchpad), `questions` (pending follow-ups), and `source` (raw chat lines)
 * — is session-only and never read at negotiation time, so it is stripped
 * before storage. The kept fields mirror what the negotiation adapter's
 * `encodeStrategyContext` consumes (grok-fast-adapter.ts).
 */
export const PERSISTED_BUILDER_MEMORY_KEYS = [
  "categoryInterest",
  "budgetMax",
  "targetPrice",
  "mustHave",
  "avoid",
  "dealBreakers",
  "mustEmphasize",
  "notes",
  "categoryCriteria",
  "urgency",
  "riskStyle",
  "negotiationStyle",
  "openingTactic",
] as const;

/** Keep only the durable builder-memory fields; drop the session-only blob. */
export function sanitizePersistedBuilderMemory(
  memory: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined {
  if (!memory || typeof memory !== "object") return undefined;
  const out: Record<string, unknown> = {};
  for (const key of PERSISTED_BUILDER_MEMORY_KEYS) {
    if ((memory as Record<string, unknown>)[key] !== undefined) {
      out[key] = (memory as Record<string, unknown>)[key];
    }
  }
  return out;
}

const saveNegotiationAgentBuilderMemoryBodySchema = z.object({
  user_id: z.string().uuid().default(DEMO_USER_ID),
  session_id: z.string().uuid().optional(),
  agent_id: z.string().min(1).optional(),
  message: z.string().min(1).max(2000),
  memory: negotiationAgentBuilderMemorySchema,
});

const advisorListingSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string().optional(),
  condition: z.string(),
  askPriceMinor: z.number().int().positive(),
  floorPriceMinor: z.number().int().positive(),
  marketMedianMinor: z.number().int().positive(),
  tags: z.array(z.string()),
  sellerNote: z.string().optional(),
});

/**
 * The 8 live-adjustable radar numbers (4 weights + 4 curves). Ranges match the
 * preset envelopes; weights are normalized to sum 1 after parsing.
 */
const chatStrategySchema = z.object({
  weights: z.object({
    w_p: z.number().min(0).max(1),
    w_t: z.number().min(0).max(1),
    w_r: z.number().min(0).max(1),
    w_s: z.number().min(0).max(1),
  }),
  alpha: z.number().min(0.3).max(3.0),
  beta: z.number().min(0.3).max(3.0),
  u_threshold: z.number().min(0.3).max(0.85),
  u_aspiration: z.number().min(0.3).max(0.85),
});

export const negotiationAgentBuilderTurnBodySchema = z.object({
  // Production: user_id is optional; the route handler injects request.user.id
  // for authenticated callers and leaves it undefined for anonymous buyers.
  user_id: z.string().uuid().optional(),
  agent_id: z.string().min(1).optional(),
  message: z.string().min(1).max(2000),
  previous_memory: negotiationAgentBuilderMemorySchema,
  listings: z.array(advisorListingSchema).default([]),
  /**
   * Phase G Flow 2: the seller's REQUIRED category criteria for this listing,
   * buyer-safe (check id + ask only). The buyer builder surfaces these so the buyer
   * mirrors the seller's requirements. Empty for the seller side / standalone agents.
   */
  seller_required_criteria: z.array(z.object({ checkId: z.string(), ask: z.string() })).default([]),
  /** Which side the user is on. Drives prompt direction (floor vs ceiling). */
  side: z.enum(["buyer", "seller"]).default("buyer"),
  /** Current radar numbers, so the LLM adjusts from them instead of inventing. */
  current_strategy: chatStrategySchema.optional(),
});

const _presetTuningBodySchema = z.object({
  listing: advisorListingSchema.extend({
    floorPriceMinor: z.number().int().positive().optional(),
    marketMedianMinor: z.number().int().positive().optional(),
    sellerNote: z.string().optional(),
  }),
  memory: negotiationAgentBuilderMemorySchema.optional().nullable(),
  preset_id: z.enum(["safe_buyer", "balanced_closer", "lowest_price", "fast_close"]).optional(),
  price_cap_minor: z.number().int().positive().optional(),
  price_cap: z.number().positive().optional(),
});

const presetDraftTermSchema = z.object({
  termId: z.string(),
  label: z.string(),
  enforcement: z.enum(["hard", "soft", "deal_breaker"]),
  source: z.enum(["listing", "memory", "preset", "tag"]),
  question: z.string(),
  rationale: z.string(),
  checked: z.boolean(),
  confirmedValue: z
    .object({
      value: z.union([z.string(), z.number(), z.boolean()]),
      label: z.string().optional(),
      unit: z.string().optional(),
      source: z.enum(["listing", "memory", "user", "seller_reply"]),
    })
    .optional(),
});

const presetDraftLeverageSchema = z.object({
  termId: z.string(),
  label: z.string(),
  reason: z.string(),
  priceImpactMinor: z.number().int().min(0),
  source: z.enum(["listing", "memory", "preset", "tag"]),
  enabled: z.boolean(),
});

const presetDraftWalkAwaySchema = z.object({
  id: z.string(),
  label: z.string(),
  reason: z.string(),
  source: z.enum(["listing", "memory", "preset", "tag"]),
  enabled: z.boolean(),
});

const presetEngineReviewSchema = z.object({
  cycle: z.literal("design_architecture_implementation_review"),
  status: z.enum(["ready", "needs_user_input", "blocked"]),
  branches: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      outcome: z.enum(["continue", "ask_user", "block"]),
      reason: z.string(),
    }),
  ),
  blockers: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      severity: z.enum(["hard", "soft"]),
      source: z.enum(["listing", "memory", "tag", "security"]),
      reason: z.string(),
    }),
  ),
  nextActions: z.array(
    z.object({
      termId: z.string().optional(),
      label: z.string(),
      control: z.enum(["toggle", "slider", "select", "text"]),
      question: z.string(),
      controlConfig: z
        .object({
          unit: z.string().optional(),
          min: z.number().optional(),
          max: z.number().optional(),
          step: z.number().optional(),
          defaultValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
          placeholder: z.string().optional(),
          options: z
            .array(
              z.object({
                value: z.string(),
                label: z.string(),
              }),
            )
            .optional(),
        })
        .optional(),
    }),
  ),
});

const presetTuningDraftSchema = z.object({
  draftId: z.string(),
  presetId: z.enum(["safe_buyer", "balanced_closer", "lowest_price", "fast_close"]),
  presetLabel: z.string(),
  listing: z.object({
    id: z.string(),
    title: z.string(),
    category: z.string().optional(),
    askPriceMinor: z.number().int().positive(),
    marketMedianMinor: z.number().int().positive().optional(),
    tags: z.array(z.string()),
  }),
  priceCapMinor: z.number().int().positive(),
  openingOfferMinor: z.number().int().positive(),
  maxAgreementMinor: z.number().int().positive(),
  concessionSpeed: z.enum(["slow", "medium", "fast"]),
  riskTolerance: z.enum(["low", "medium", "high"]),
  strategyNotes: z.array(z.string()),
  mustVerify: z.array(presetDraftTermSchema),
  leverage: z.array(presetDraftLeverageSchema),
  walkAway: z.array(presetDraftWalkAwaySchema),
  engineReview: presetEngineReviewSchema.optional(),
  sourceBadges: z.array(z.enum(["listing", "memory", "preset", "tag"])),
  negotiationStartPayload: z.record(z.string(), z.unknown()),
});

const savePresetTuningBodySchema = z.object({
  user_id: z.string().uuid().default(DEMO_USER_ID),
  agent_id: z.string().min(1).optional(),
  draft: presetTuningDraftSchema,
});

const presetTuningFeedbackBodySchema = z.object({
  user_id: z.string().uuid().default(DEMO_USER_ID),
  memory_key: z.string().min(1),
  outcome: z.enum(["accepted", "rejected", "abandoned", "cap_blocked"]),
  final_price_minor: z.number().int().positive().optional(),
  price_cap_minor: z.number().int().positive().optional(),
  application_mode: z.enum(["auto", "manual"]).optional(),
});

/** Loose strategy from the LLM — numbers may be out of range; we clamp later. */
const looseChatStrategySchema = z.object({
  weights: z.object({
    w_p: z.number(),
    w_t: z.number(),
    w_r: z.number(),
    w_s: z.number(),
  }),
  alpha: z.number(),
  beta: z.number(),
  u_threshold: z.number(),
  u_aspiration: z.number(),
});

export const negotiationAgentBuilderTurnResultSchema = z.object({
  memory: negotiationAgentBuilderMemorySchema,
  reply: z.string().min(1),
  reasoning_summary: z.string().optional(),
  /** Optional adjusted radar numbers. Absent when the turn implies no change. */
  strategy: looseChatStrategySchema.optional(),
});

/** Clamp a loose LLM strategy to valid envelopes; normalize weights to sum 1. */
function clampChatStrategy(
  s: z.infer<typeof looseChatStrategySchema>,
): z.infer<typeof chatStrategySchema> {
  const clamp = (n: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));
  const w = s.weights;
  // Floor weights at 0 so a stray negative from the LLM can't produce a
  // negative normalized weight (escaping the [0,1] contract).
  const wp = Math.max(0, w.w_p);
  const wt = Math.max(0, w.w_t);
  const wr = Math.max(0, w.w_r);
  const ws = Math.max(0, w.w_s);
  const sum = wp + wt + wr + ws;
  const norm = sum > 0 ? sum : 1;
  // Cap u_threshold below the envelope max so u_aspiration (= threshold + 0.01)
  // still fits under 0.85 — preserves the strict u_aspiration > u_threshold band.
  const u_threshold = clamp(s.u_threshold, 0.3, 0.84);
  // u_aspiration must exceed u_threshold and stay within envelope.
  const u_aspiration = clamp(Math.max(s.u_aspiration, u_threshold + 0.01), 0.3, 0.85);
  const r4 = (n: number) => Math.round(n * 10000) / 10000;
  return {
    weights: {
      w_p: r4(wp / norm),
      w_t: r4(wt / norm),
      w_r: r4(wr / norm),
      w_s: r4(ws / norm),
    },
    alpha: clamp(s.alpha, 0.3, 3.0),
    beta: clamp(s.beta, 0.3, 3.0),
    u_threshold,
    u_aspiration,
  };
}

const _memoryQuerySchema = z.object({
  user_id: z.string().uuid().default(DEMO_USER_ID),
});

const _resetDemoMemoryQuerySchema = z.object({
  user_id: z.string().uuid().default(DEMO_USER_ID),
});

const _tagGardenIntelligenceQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

const _advisorListingsQuerySchema = z.object({
  q: z.string().trim().max(300).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

type NegotiationAgentBuilderMemory = z.infer<typeof negotiationAgentBuilderMemorySchema>;

type AdvisorDemoListing = {
  id: string;
  title: string;
  category: string;
  condition: string;
  askPriceMinor: number;
  floorPriceMinor: number;
  marketMedianMinor: number;
  tags: string[];
  sellerNote: string;
  sellerTurns: Array<{ seller_price_minor: number; seller_message: string }>;
};

const ADVISOR_TURN_LISTING_CONTEXT_LIMIT = 5;
const ADVISOR_MAX_QUESTIONS_PER_TURN = 3;

type DemoMemoryCard = {
  cardType: "preference" | "constraint" | "pricing" | "style" | "trust" | "interest";
  memoryKey: string;
  summary: string;
  memory: Record<string, unknown>;
  strength: number;
};

async function _listAdvisorDemoListings(
  db: Database,
  options: { q?: string; limit?: number } = {},
): Promise<{
  listings: AdvisorDemoListing[];
  plannerListings: AdvisorDemoListing[];
  totalMatched: number;
  retrieval: {
    mode: "semantic_hybrid" | "keyword";
    semanticApplied: boolean;
    semanticCandidates: number;
    keywordCandidates: number;
  };
}> {
  const limit = Math.min(Math.max(options.limit ?? 8, 1), 20);
  const rows = (await db.execute(sql`
    SELECT
      lp.public_id,
      COALESCE(ld.title, 'Untitled listing') AS title,
      COALESCE(ld.category, 'other') AS category,
      COALESCE(ld.condition, 'used') AS condition,
      COALESCE(ld.target_price::float, 0) AS ask_price,
      COALESCE(ld.floor_price::float, ld.target_price::float * 0.86, 0) AS floor_price,
      COALESCE(ld.tags, ARRAY[]::text[]) AS tags,
      lp.published_at
    FROM listings_published lp
    JOIN listing_drafts ld ON ld.id = lp.draft_id
    WHERE ld.status = 'published'
      AND (ld.selling_deadline IS NULL OR ld.selling_deadline > now())
    ORDER BY lp.published_at DESC
    LIMIT 120
  `)) as unknown as Array<{
    public_id: string;
    title: string;
    category: string;
    condition: string;
    ask_price: number | string | null;
    floor_price: number | string | null;
    tags: string[] | null;
  }>;

  const listings = rows.map(rowToAdvisorListing);
  const ranked = rankAdvisorListings(listings, options.q);
  const semanticRanked = await rankAdvisorListingsByEmbedding(db, options.q, limit).catch(() => []);
  const finalRanked =
    semanticRanked.length > 0
      ? mergeSemanticAndKeywordRankings(semanticRanked, ranked, options.q)
      : ranked;

  return {
    listings: finalRanked.slice(0, limit),
    plannerListings: finalRanked.slice(0, Math.max(limit, 20)),
    totalMatched: finalRanked.length,
    retrieval: {
      mode: semanticRanked.length > 0 ? "semantic_hybrid" : "keyword",
      semanticApplied: semanticRanked.length > 0,
      semanticCandidates: semanticRanked.length,
      keywordCandidates: ranked.length,
    },
  };
}

function rowToAdvisorListing(row: {
  public_id: string;
  title: string;
  category: string;
  condition: string;
  ask_price: number | string | null;
  floor_price: number | string | null;
  tags: string[] | null;
}): AdvisorDemoListing {
  const askPrice = normalizeMajorPrice(row.ask_price, 100);
  const floorPrice = Math.max(
    1,
    Math.min(normalizeMajorPrice(row.floor_price, Math.round(askPrice * 0.86)), askPrice),
  );
  const askPriceMinor = dollarsToMinor(askPrice);
  const floorPriceMinor = dollarsToMinor(floorPrice);
  const marketMedianMinor = askPriceMinor;

  return {
    id: row.public_id,
    title: row.title,
    category: row.category,
    condition: row.condition,
    askPriceMinor,
    floorPriceMinor,
    marketMedianMinor,
    tags: row.tags ?? [],
    sellerNote: buildSellerNote(row.category, row.condition),
    sellerTurns: buildSellerTurns(askPriceMinor, floorPriceMinor),
  };
}

async function rankAdvisorListingsByEmbedding(
  db: Database,
  query: string | undefined,
  limit: number,
): Promise<AdvisorDemoListing[]> {
  if (!query?.trim() || !process.env.OPENAI_API_KEY) return [];

  const queryEmbedding = await generateTextEmbedding(query);
  const embeddingStr = `[${queryEmbedding.join(",")}]`;
  const semanticRows = (await db.execute(sql`
    SELECT
      lp.public_id,
      COALESCE(ld.title, 'Untitled listing') AS title,
      COALESCE(ld.category, 'other') AS category,
      COALESCE(ld.condition, 'used') AS condition,
      COALESCE(ld.target_price::float, 0) AS ask_price,
      COALESCE(ld.floor_price::float, ld.target_price::float * 0.86, 0) AS floor_price,
      COALESCE(ld.tags, ARRAY[]::text[]) AS tags,
      1 - (le.text_embedding <=> ${embeddingStr}::vector) AS semantic_score
    FROM listings_published lp
    JOIN listing_drafts ld ON ld.id = lp.draft_id
    JOIN listing_embeddings le ON le.published_listing_id = lp.id
    WHERE ld.status = 'published'
      AND (ld.selling_deadline IS NULL OR ld.selling_deadline > now())
      AND le.status = 'completed'
      AND le.text_embedding IS NOT NULL
    ORDER BY le.text_embedding <=> ${embeddingStr}::vector
    LIMIT ${Math.max(limit * 4, 24)}
  `)) as unknown as Array<{
    public_id: string;
    title: string;
    category: string;
    condition: string;
    ask_price: number | string | null;
    floor_price: number | string | null;
    tags: string[] | null;
    semantic_score: number | string | null;
  }>;

  const terms = tokenizeSearchQuery(query);
  const brandTerms = terms.filter((term) => SEARCH_BRAND_TERMS.has(term));
  const rows = semanticRows
    .map((row, index) => ({ row, index, semanticScore: Number(row.semantic_score) || 0 }))
    .filter(
      ({ row, semanticScore }) =>
        semanticScore >= 0.3 &&
        (brandTerms.length === 0 || listingMatchesBrandTerms(rowToAdvisorListing(row), brandTerms)),
    )
    .sort((a, b) => b.semanticScore - a.semanticScore || a.index - b.index);

  return rows.map(({ row }) => rowToAdvisorListing(row));
}

function mergeSemanticAndKeywordRankings(
  semanticListings: AdvisorDemoListing[],
  keywordListings: AdvisorDemoListing[],
  query: string | undefined,
): AdvisorDemoListing[] {
  const terms = tokenizeSearchQuery(query ?? "");
  const keywordIndex = new Map(keywordListings.map((listing, index) => [listing.id, index]));
  const combined = new Map<string, { listing: AdvisorDemoListing; score: number }>();

  semanticListings.forEach((listing, index) => {
    combined.set(listing.id, {
      listing,
      score: 1000 - index * 5 + scoreAdvisorListingForQuery(listing, terms),
    });
  });

  keywordListings.forEach((listing, index) => {
    const existing = combined.get(listing.id);
    const keywordScore = 700 - index * 4 + scoreAdvisorListingForQuery(listing, terms);
    combined.set(listing.id, {
      listing,
      score: existing ? existing.score + keywordScore : keywordScore,
    });
  });

  return Array.from(combined.values())
    .sort(
      (a, b) =>
        b.score - a.score ||
        (keywordIndex.get(a.listing.id) ?? Number.MAX_SAFE_INTEGER) -
          (keywordIndex.get(b.listing.id) ?? Number.MAX_SAFE_INTEGER),
    )
    .map((item) => item.listing);
}

function normalizeMajorPrice(value: number | string | null, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function dollarsToMinor(value: number): number {
  return Math.round(value * 100);
}

function buildSellerNote(category: string, condition: string): string {
  return `${category} listing from the live demo DB. Condition: ${condition}.`;
}

function buildSellerTurns(
  askPriceMinor: number,
  floorPriceMinor: number,
): AdvisorDemoListing["sellerTurns"] {
  const firstCounter = Math.max(floorPriceMinor, Math.round(askPriceMinor * 0.96));
  const secondCounter = Math.max(floorPriceMinor, Math.round(askPriceMinor * 0.92));

  return [
    { seller_price_minor: askPriceMinor, seller_message: "등록 가격 기준으로 먼저 보고 싶습니다." },
    { seller_price_minor: firstCounter, seller_message: "조건이 맞으면 조금 조정할 수 있습니다." },
    { seller_price_minor: secondCounter, seller_message: "이 정도면 바로 진행하겠습니다." },
  ];
}

function rankAdvisorListings(listings: AdvisorDemoListing[], query?: string): AdvisorDemoListing[] {
  const terms = tokenizeSearchQuery(query ?? "");
  if (terms.length === 0) return listings;
  const brandTerms = terms.filter((term) => SEARCH_BRAND_TERMS.has(term));

  const scored = listings
    .filter((listing) => brandTerms.length === 0 || listingMatchesBrandTerms(listing, brandTerms))
    .map((listing, index) => ({
      listing,
      index,
      score: scoreAdvisorListingForQuery(listing, terms),
    }))
    .filter((item) => item.score > 0);
  const maxScore = Math.max(...scored.map((item) => item.score), 0);
  const minimumScore = maxScore >= 40 ? Math.max(15, maxScore * 0.25) : 1;

  return scored
    .filter((item) => item.score >= minimumScore)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.listing);
}

function listingMatchesBrandTerms(listing: AdvisorDemoListing, brandTerms: string[]): boolean {
  const text = normalizeSearchText(
    [listing.title, listing.category, listing.condition, ...listing.tags].join(" "),
  );

  return brandTerms.some((brand) => text.includes(brand));
}

function scoreAdvisorListingForQuery(listing: AdvisorDemoListing, terms: string[]): number {
  const title = normalizeSearchText(listing.title);
  const category = normalizeSearchText(listing.category);
  const condition = normalizeSearchText(listing.condition);
  const tags = listing.tags.map(normalizeSearchText);
  let score = 0;

  for (const term of terms) {
    if (title === term) score += 80;
    if (title.includes(term)) score += 40;
    if (tags.some((tag) => tag === term)) score += 30;
    if (tags.some((tag) => tag.includes(term))) score += 18;
    if (category.includes(term)) score += 10;
    if (condition.includes(term)) score += 6;
  }

  if (
    terms.length > 1 &&
    terms.every((term) => title.includes(term) || tags.some((tag) => tag.includes(term)))
  ) {
    score += 30;
  }

  return score;
}

function tokenizeSearchQuery(query: string): string[] {
  const baseTerms = normalizeSearchText(query)
    .replace(/\$?\d+(?:\.\d+)?/g, " ")
    .split(/[\s,.;:!?()[\]{}"'`/\\|<>~@#$%^&*+=]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2 && !SEARCH_STOP_TERMS.has(term));
  const expandedTerms = baseTerms.flatMap((term) => [term, ...(SEARCH_SYNONYMS[term] ?? [])]);

  return Array.from(new Set(expandedTerms)).slice(0, 12);
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, " ").trim();
}

const SEARCH_STOP_TERMS = new Set([
  "중고",
  "제품",
  "상품",
  "찾고",
  "찾는",
  "싶어",
  "좋아",
  "조건",
  "예산",
  "최대",
  "이상",
  "정도",
  "사용",
  "용도",
  "필요",
  "가벼운",
  "있어",
]);

const SEARCH_SYNONYMS: Record<string, string[]> = {
  테슬라: ["tesla"],
  모델3: ["model", "model 3", "model-3"],
  아이폰: ["iphone"],
  휴대폰: ["phone", "smartphone", "iphone"],
  핸드폰: ["phone", "smartphone", "iphone"],
  폰: ["phone", "smartphone", "iphone"],
  맥북: ["macbook"],
  노트북: ["laptop"],
  차: ["car", "vehicle"],
  차량: ["car", "vehicle"],
  자동차: ["car", "vehicle"],
  전기차: ["ev", "electric"],
};

const SEARCH_BRAND_TERMS = new Set([
  "tesla",
  "apple",
  "iphone",
  "macbook",
  "dell",
  "ford",
  "honda",
  "bmw",
  "harley",
]);

/** The taxonomy tags for an item from a builder turn's listings (category + tags). */
function listingTagsForCriteria(listings: Array<{ category?: string; tags: string[] }>): string[] {
  return listings.flatMap((l) =>
    [l.category, ...l.tags].filter((t): t is string => typeof t === "string" && t.length > 0),
  );
}

/**
 * Reconcile the item's category criteria deterministically. The taxonomy scaffold
 * is AUTHORITATIVE for the check set + checkId/questionKo/buyerAskKo/enforcement —
 * the LLM cannot invent, drop, or rename a check. Only `requirement` and `stance`
 * flow from the party (LLM this turn, else carried from previous memory), so a
 * seller/buyer's answers accumulate across turns while the structure stays fixed.
 * Returns [] when there is no listing context (scaffold empty → standalone agent).
 */
export function reconcileCategoryCriteria(
  scaffold: readonly CategoryCriterion[],
  // Loose shapes — parsed criteria may omit requirement/stance (or send them empty).
  // Only checkId is relied on to match; requirement/stance fall back below.
  llmReturned: ReadonlyArray<Partial<CategoryCriterion> & { checkId: string }> | undefined,
  previous: ReadonlyArray<Partial<CategoryCriterion> & { checkId: string }>,
): CategoryCriterion[] {
  const llmById = new Map((llmReturned ?? []).map((c) => [c.checkId, c]));
  const prevById = new Map(previous.map((c) => [c.checkId, c]));

  return scaffold.map((base) => {
    const llm = llmById.get(base.checkId);
    const prev = prevById.get(base.checkId);
    // A taxonomy `hard`-enforcement check is a deterministic safety gate — it
    // materially affects the deal (clean title, IMEI/activation lock, authenticity,
    // theft serial). The generative layer may ESCALATE a soft check to required, but
    // must NEVER downgrade a hard gate to optional: doing so would let a deal-breaker
    // close silently with the buyer never taking a stance, and suppress the
    // mid-negotiation PAUSE that asks them. So hard ⇒ required is pinned here,
    // overriding whatever the LLM (or a prior turn) returned. Soft checks stay
    // party-driven (required only if the party insisted).
    const requirement: CategoryCriterion["requirement"] =
      base.enforcement === "hard"
        ? "required"
        : (llm?.requirement ?? prev?.requirement ?? base.requirement);
    // Non-blank stance from the LLM wins; otherwise carry a non-blank prior stance.
    const stance = llm?.stance?.trim() || prev?.stance?.trim() || undefined;

    const merged: CategoryCriterion = {
      checkId: base.checkId,
      questionKo: base.questionKo,
      enforcement: base.enforcement,
      requirement,
    };
    if (base.buyerAskKo !== undefined) merged.buyerAskKo = base.buyerAskKo;
    if (stance) merged.stance = stance;
    return merged;
  });
}

/**
 * Build the side-aware CATEGORY CRITERIA prompt block. Seller: decide required vs
 * optional + state the fact (verification-framed question). Buyer: record a stance
 * per check (requirement-framed question), and criteria the seller marked required
 * are flagged [SELLER REQUIRES] so the buyer mirrors them (Flow 2). Both sides emit
 * memory.categoryCriteria keyed by the EXACT check ids. Empty string when there are
 * no item criteria (standalone agent) so the caller can inject it unconditionally.
 */
function buildCategoryCriteriaPromptBlock(
  side: "buyer" | "seller",
  criteria: readonly CategoryCriterion[],
  sellerRequired: ReadonlyArray<{ checkId: string; ask: string }>,
): string {
  if (criteria.length === 0) return "";
  const sellerRequiredIds = new Set(sellerRequired.map((c) => c.checkId));
  const lines = criteria
    .map((c) => {
      const ask = side === "buyer" ? (c.buyerAskKo ?? c.questionKo) : c.questionKo;
      const flag = side === "buyer" && sellerRequiredIds.has(c.checkId) ? " [SELLER REQUIRES]" : "";
      const state = criterionAnswered(c)
        ? `SET requirement=${c.requirement} stance="${c.stance}"`
        : side === "seller"
          ? "NEEDS the seller's decision (required vs optional) + their stance"
          : "NEEDS the buyer's stance";
      return `- ${c.checkId} | "${ask}"${flag} | ${state}`;
    })
    .join("\n");

  const intro =
    side === "seller"
      ? `CATEGORY CRITERIA — set these on the agent for THIS item:
- For each criterion below, help the seller decide whether it is a REQUIRED deal-breaker (the agent must hold this line) or an OPTIONAL point to emphasize, and capture the seller's stance (the fact/position, e.g. "clean title, in hand" or "battery 91%").
- Ask about criteria still marked "NEEDS the seller's decision" — one or two per turn, most category-important first. Never re-ask a criterion already SET.`
      : `CATEGORY CRITERIA — record the buyer's stance for THIS item:
- For each criterion below, capture the buyer's stance in memory.categoryCriteria: requirement ("required" if the buyer insists on it, otherwise "optional") plus a short stance.
- Criteria flagged [SELLER REQUIRES] are ones the seller insists on for this item — make sure the buyer has a stance on each (mirror it, or explicitly decline). If one is still unaddressed, ask about it.`;

  return `
${intro}
- Return them in memory.categoryCriteria as {checkId, requirement, stance} using the EXACT checkId values listed. Do NOT invent, rename, or drop check ids; leave a criterion's stance empty until it is answered.
- Keep memory.dealBreakers / memory.mustEmphasize / memory.mustHave / memory.avoid only for long-tail specifics OUTSIDE this list.
Current category criteria for this item:
${lines}`;
}

/**
 * Long-tail generative block (Phase G, 2-layer hybrid). The taxonomy's category
 * criteria are authoritative for standard checks, but they cannot cover every
 * product (the "4–6 digit" specific items). This invites the LLM to elicit ONE
 * product-specific factor the category list omits — advisory only, stored in the
 * free-text buckets, never as an invented hard/safety gate and never in
 * categoryCriteria (the reconcile step structurally drops any non-taxonomy check id
 * the LLM tries to add there). Returned only when there's an item to reason about.
 */
function buildLongTailPromptBlock(side: "buyer" | "seller", hasListingContext: boolean): string {
  if (!hasListingContext) return "";
  const bucket =
    side === "seller"
      ? "memory.mustEmphasize (leverage) or memory.dealBreakers (a firm limit)"
      : "memory.mustHave or memory.avoid";
  return `
PRODUCT-SPECIFIC FACTORS (beyond the category list):
- The category-criteria list is authoritative for standard checks, but this exact product may have an important decision-relevant factor it omits (a niche spec, compatibility, edition/rarity, an issue typical of this product). You MAY ask about at most ONE such factor per turn.
- Record the answer as a short phrase in ${bucket}. It is ADVISORY only: never present a self-invented factor as a mandatory safety/legal gate, and never add it to memory.categoryCriteria (that list is reserved for the standard category checks).
- Skip this entirely when the category list already covers what matters, or nothing important is missing — do not manufacture questions.`;
}

/**
 * Pick the next seller-required criterion the buyer must still address (Flow 2).
 * Skips any the buyer already answered (a stance on that check id) and any asked on
 * the previous turn (ask-once). Returns the buyer-facing ask, or null when the buyer
 * has addressed every seller requirement.
 */
function pickSellerMirrorQuestion(
  sellerRequired: ReadonlyArray<{ checkId: string; ask: string }>,
  buyerCriteria: ReadonlyArray<{ checkId: string; stance?: string }>,
  askedQuestions: readonly string[],
): string | null {
  const answered = new Set(
    buyerCriteria
      .filter((c) => (c.stance?.trim().length ?? 0) > 0)
      .map((criterion) => criterion.checkId),
  );
  for (const requirement of sellerRequired) {
    if (answered.has(requirement.checkId)) continue;
    if (askedQuestions.includes(requirement.ask)) continue;
    return requirement.ask;
  }
  return null;
}

export async function processNegotiationAgentBuilderTurn(
  input: z.infer<typeof negotiationAgentBuilderTurnBodySchema> & {
    /**
     * Feature ②: promoted learned checks for this listing's category, loaded by the
     * ROUTE (which owns DB access) and passed in so this service stays I/O-free.
     * Always advisory — see `taxonomyCategorySlots`.
     */
    learned_checks?: readonly LearnedCheckForRequirements[];
  },
) {
  const initialRequirementPlan = buildAdvisorRequirementPlan({
    memory: input.previous_memory,
    listings: input.listings,
    askedQuestions: input.previous_memory.questions,
    learnedChecks: input.learned_checks ?? [],
  });
  const initialCandidatePlan = buildAdvisorCandidatePlan({
    listings: input.listings,
    budgetKnown: Boolean(input.previous_memory.budgetMax),
    hasBuyerPreference: hasAdvisorBuyerPreference(input.previous_memory),
    memory: input.previous_memory,
  });
  const agentProfile = getAgentVoiceProfile(input.agent_id);
  const sem = priceSemantics(input.side);
  // Standalone reusable agents (e.g. /sell/agents/new, /sell/agents/:id/edit)
  // carry no listing, so there is no asking/floor/budget price to anchor on.
  const hasListingContext = input.listings.length > 0;
  // The buyer requirement/candidate planner is entirely listing + Tag-Garden
  // driven (budget slots, candidate ranking, Korean prompts). A standalone
  // reusable agent has no listing, so skip the planner there exactly like the
  // seller side — otherwise it injects budget/candidate questions that make no
  // sense without a listing. Only a buyer ON a listing uses the planner.
  const usePlanner = input.side === "buyer" && hasListingContext;

  // Phase G deterministic layer: the item's taxonomy criteria, with any stances the
  // party already stated carried forward from previous memory. The SELLER builder
  // actively elicits these (required vs optional + stance). Empty for standalone
  // agents (no listing → no item checks).
  const criteriaScaffold = buildCategoryCriteriaScaffold(listingTagsForCriteria(input.listings));
  const currentCategoryCriteria = reconcileCategoryCriteria(
    criteriaScaffold,
    undefined,
    input.previous_memory.categoryCriteria,
  );
  // Side-aware CATEGORY CRITERIA block (empty for standalone agents with no item).
  // Seller: elicit required/optional + stance. Buyer: record stance + mirror the
  // seller's required criteria (flagged [SELLER REQUIRES]).
  const categoryCriteriaBlock = buildCategoryCriteriaPromptBlock(
    input.side,
    currentCategoryCriteria,
    input.seller_required_criteria,
  );
  // Generative long-tail layer: lets the LLM cover product-specific factors the
  // taxonomy omits (advisory only; structurally barred from categoryCriteria).
  const longTailBlock = buildLongTailPromptBlock(input.side, hasListingContext);

  const advisorSystemPrompt = `You are the Haggle negotiation-agent builder assistant, helping a ${input.side.toUpperCase()} configure their negotiation agent.
Your task is context engineering: update the user's memory from the latest message and decide whether one essential follow-up question is needed.

Side & price direction:
- ${sem.promptHint}
- ${
    input.side === "seller"
      ? hasListingContext
        ? "The seller already set their asking price and floor on the listing. Do not ask about price; never call it a 'budget'."
        : "This is a reusable agent not tied to any listing, so price is decided per-listing later and is unknown now. Do NOT ask about asking price, floor, or budget — gather negotiation posture instead."
      : hasListingContext
        ? "Ask about the user's ideal price and the most they will pay (budget)."
        : "This is a reusable agent not tied to any listing, so budget is decided per-listing later and is unknown now. Do NOT ask for a budget or target price — gather must-haves, deal-breakers, and negotiation style instead."
  }
${
  input.side === "seller"
    ? `HARD SELLER RULES (these OVERRIDE any buyer-oriented rule below):
- NEVER ask the seller for a budget, asking price, or floor.${
        hasListingContext
          ? " They already set their asking price and floor on the listing."
          : " This agent is not tied to a listing yet, so price is set per-listing later — gather negotiation posture (what to emphasize, deal-breakers, how firmly to hold) instead."
      }
- Ask the seller VERIFICATION-framed questions about their own item ("is the title clean?", "what's the battery health?"), never buyer-style "do you require X?" phrasing — the seller can state facts about the thing they are selling.
- Ignore the Tag Garden requirement slots entirely — they are buyer-side.`
    : ""
}
${categoryCriteriaBlock}
${longTailBlock}

Lumen agent voice:
- Agent: ${agentProfile.name} (${agentProfile.role})
- ${agentProfile.prompt}
- Speaks like: ${agentProfile.speaksLike}
- Avoid: ${agentProfile.avoid.join(", ")}
- Apply this voice clearly in English while preserving the user's facts.
- Keep the same register from turn to turn. Do not suddenly become more casual, more polite, or more aggressive than the chosen agent.
- Use at most one signature phrase or metaphor per reply, and skip it if the previous sentence already has enough voice.
- Do not mention lore, profile names, or voice instructions.

Rules:
- Use the user's actual words. Do not invent requirements.
- Preserve previous memory unless the latest message clearly changes it.
- If a condition was stated for a specific product model, preserve that product scope in memory.source.
- If the latest message names a different product model, treat that latest model as the active scope for follow-up decisions instead of silently applying old model-specific conditions.
- Do not preserve unrelated small talk or off-topic text in memory.source.
- Normalize concise constraints into memory.mustHave, e.g. "original box included", "clean IMEI", "unlocked", "battery >= 90%", "screen mint", "Pro model".
- Normalize avoid constraints only for product, seller claim, or condition preferences, e.g. "visible cracks", "low battery", "heavily worn frame".
- Do not store off-platform payment as a buyer avoid item in this demo. Haggle handles protected payment and checkout by default.
- Extract negotiation-facing signals from what the user means (never store raw tone or transcript):
  - memory.dealBreakers: absolute, non-negotiable limits. Strong/absolute wording ("절대", "무조건", "must", "보장", "no exceptions") signals these. The agent must not cross them.
  - memory.mustEmphasize: leverage/selling points the user wants pushed (condition, accessories, rarity, barely used, recent purchase).
  - memory.notes: discretionary or ambiguous guidance to weigh but NOT treat as a hard rule, e.g. "상황 봐서 알아서 해줘", "단골이면 좀 깎아줘", "급하면 양보 가능".
  - memory.urgency: a SHORT inferred descriptor of how rushed/flexible the principal sounds, e.g. "high — wants a fast close" or "low — no rush, hold firm". Infer it from wording; do NOT copy the user's phrasing.
  - Keep these stable across turns; add only when the latest message clearly introduces one, and do not duplicate an item already held in another bucket.
${
  input.side === "buyer"
    ? hasListingContext
      ? `- Infer budgetMax and targetPrice only from explicit budget/price.
- NEVER read a non-price number as budget/price. Mileage ("25000 or under", "under 30k miles"), battery %, model/year, cycle count, storage size, or any measurement is NOT budget — leave budgetMax/targetPrice unchanged for those. Only a number the buyer frames as their spend/budget/price is budgetMax/targetPrice. Record a mileage answer as a preference (e.g. mustHave "mileage <= 25000"), not as budget.
- budgetMax and targetPrice are user-facing USD dollars, not cents. If the buyer says "450", "$450", or "450 dollars", store 450.
- targetPrice should be slightly below budgetMax when reasonable.
- Do not decide required follow-up slots from intuition. Tag Garden requirement slots below are authoritative.
- Slots marked enforcement=hard are blocking: ask missing hard slots before recommending, starting negotiation, or asking softer preference questions.
- To reduce slow back-and-forth, bundle up to three related missing questions in one turn when the buyer can answer them together.
- Slots marked enforcement=soft are helpful but should not block recommendation when stronger candidate-planner work is ready.
- Store each bundled question separately in memory.questions.
- Ask only for the next missing advisor_recommendation slot from Tag Garden requirements.
- If a required question is needed, ask it once as the final question. Do not ask a paraphrase and then the exact same question.
- If the latest user message answers the current question, acknowledge and move forward. Do not repeat the same priority question.
- If the buyer answers "none", "no preference", "doesn't matter", or "don't care" to a pending condition or priority question, treat that slot as answered with no preference. Do not ask it again and do not invent a must-have from it.
- The user is ALREADY on a specific product listing page and wants to negotiate for it. NEVER ask what product they are looking for.
- Do not ask a generic usage/purpose question. Move directly to concrete requirements such as budget, specific condition (must-haves, avoid), or negotiation risk style.
- Do NOT make battery health, carrier unlock, IMEI, or box mandatory by default. They are mandatory only when Tag Garden says the matched item tag requires them.
- If the user says they want box/original box/full package, record "original box included"; box itself is not a required iPhone slot unless Tag Garden marks it required.
- If no advisor_recommendation slot is missing after updating memory, questions must be [].
- CLOSING: this page BUILDS/CONFIGURES the buyer's agent — it does NOT run the negotiation (the user starts that later with a separate "Start Negotiation" button). So when nothing essential is missing, do NOT propose to "start", "begin", or "open" the negotiation, and do NOT say "ready to begin". Instead, confirm the agent is configured and ready, and invite any further input — e.g. "Your agent is set to target $X with a $Y ceiling and a clean/rebuilt-title preference. Anything else you'd like it to prioritize or watch out for?"
- If the budget is below all listing ask prices, keep the budget as stated and explain the negotiation will need a lower anchor or an older/safer-fit model; do not invent missing constraints.`
      : `- This is a reusable buying agent not tied to any listing. Do NOT ask for a budget or target price — budget is set per-listing later.
- Do NOT ask what product they are looking for, and do NOT run product or Tag Garden requirement questions; there is no listing yet.
- Gather durable preferences instead: typical must-haves, deal-breakers, risk style, and how aggressively to negotiate.
- Put preferences in memory.mustHave / memory.avoid and reflect style via negotiationStyle, riskStyle, and openingTactic.
- If the buyer volunteers a budget unprompted, you may still record budgetMax/targetPrice, but never ask for it.
- If nothing essential is missing, questions must be [].
- CLOSING: this page BUILDS/CONFIGURES the agent — it does NOT run any negotiation. Never end a reply flat: when nothing essential is left to ask, say what the agent is now set to do and invite more, e.g. "Your agent will push hard on price and walk away from anything without a receipt. Anything else you want it to prioritize or avoid?". This invitation is not a requirement question, so questions stays [].`
    : `- Do not ask the seller for an asking price or floor${
        hasListingContext
          ? " — they already set them on the listing"
          : " — price is decided per-listing, not on this reusable agent"
      }. Help shape negotiation posture: what to emphasize, deal-breakers, and how firmly to hold.
- Put "what to emphasize" items in memory.mustEmphasize and deal-breakers in memory.dealBreakers.
- If nothing essential is missing, questions must be [].
- If there is anything else worth knowing about THIS item to negotiate it well (history, flaws, included extras, why you're selling), ask for it rather than settling after one answer.
- CLOSING: this page BUILDS/CONFIGURES the seller's agent — it does NOT run the negotiation (the user starts that later with a separate button). Never end a reply flat: acknowledging the answer and stopping leaves the user with no idea whether more input is wanted. When nothing essential is left to ask, say what the agent is now set to do and invite more, e.g. "Your agent will lead with the full service history and hold firm at $8,000. Anything else you want it to emphasize or hold firm on?". This invitation is not a requirement question, so questions stays [].`
}
- Never mention Tag Garden, tags, requirement slots, internal criteria, or context engineering in the user-facing reply.
- Avoid overly dramatic, poetic, or cheesy phrases. Be natural, professional, and direct.
- When asking a follow-up question, ask directly without unnecessary filler.
- Reply in English, naturally, one or two sentences.
- Ask AT MOST ONE question per reply. When several things are still unknown, ask the single most important one now and leave the rest for later turns. Never bundle two asks into one message ("is it working, and how does it look?") — the user answers the last one and the other is silently lost.
- ONE TOPIC per question, not just one question mark. "Tell me about its history, the lens, and the case it comes in." is three questions wearing one sentence; so is any list of things to describe. Pick the one that matters most to the negotiation and ask only that.
- An imperative counts as a question. "Tell me X." / "Describe X." are asks — do not pair one with a second question in the same reply.
- Ask for a FACT the user can state and that changes the negotiation: condition, defects, what's included, verification, why they're selling. Never ask for an open-ended narrative ("What is its story?", "What makes it special?") — the user does not know what to say and the answer cannot be negotiated with.
- Keep each entry in memory.questions to ONE topic. Two topics in one string become one unanswerable question later.
- CRITICAL: write the ENTIRE "reply" in English only — never output Korean (or any non-English) characters. Requirement/candidate questions may be provided to you in Korean; translate them into natural English before asking. The reply must contain zero Korean text.

Return valid JSON only:
{
  "memory": {
    "categoryInterest": string,
    "budgetMax": number optional,
    "targetPrice": number optional,
    "mustHave": string[],
    "avoid": string[],
    "dealBreakers": string[],
    "mustEmphasize": string[],
    "notes": string[],
    "categoryCriteria": [{ "checkId": string, "requirement": "required"|"optional", "stance": string }],
    "urgency": string optional,
    "riskStyle": "safe_first"|"balanced"|"lowest_price",
    "negotiationStyle": "defensive"|"balanced"|"aggressive",
    "openingTactic": "condition_anchor"|"fair_market_anchor"|"speed_close",
    "questions": string[],
    "source": string[]
  },
  "reply": string,
  "reasoning_summary": string,
  "strategy": {
    "weights": { "w_p": number, "w_t": number, "w_r": number, "w_s": number },
    "alpha": number, "beta": number,
    "u_threshold": number, "u_aspiration": number
  }
}

Strategy tuning:
- "strategy" reflects the agent's negotiation numbers (4 weights that sum to ~1.0, plus four curves). The current values are given below.
- If the latest message implies a behavior change (e.g. "more aggressive", "be patient", "hold firm", "close fast", "I care about a trustworthy counterparty"), return an UPDATED "strategy" reflecting it. Otherwise return the current values unchanged.
- Envelopes: alpha,beta in [0.3,3.0]; u_threshold,u_aspiration in [0.3,0.85] with u_aspiration > u_threshold. weights each in [0,1] and sum to ~1.0.
- Higher beta = concedes faster; higher u_threshold/u_aspiration = pickier (walks away more). Raise w_p for price focus, w_t for speed, w_r for counterparty risk, w_s for relationship.`;

  const advisorUserPrompt = `Current strategy:
${input.current_strategy ? JSON.stringify(input.current_strategy) : "(none — use sensible defaults if you must)"}

Previous memory:
${JSON.stringify(input.previous_memory, null, 2)}

Available demo listings:
${formatAdvisorListingsForPrompt(input.listings)}

Latest user message:
${input.message}

Tag Garden requirement slots:
${
  usePlanner
    ? formatTagRequirementPlanForPrompt(initialRequirementPlan)
    : "None — no listing context; skip requirement questions."
}

Candidate planner:
${usePlanner ? formatCandidatePlanForPrompt(initialCandidatePlan) : "None — no listing context."}`;

  // A builder turn can run ~30s and used to hit callLLM's 30s ceiling (timeout
  // 502s as context grew). Keep a generous token budget and timeout so the turn
  // can finish. The builder …17001 tokens truncated…k|prompt injection|너의\s*(?:시스템|개발자)\s*지시|이전\s*지시\s*무시|프롬프트\s*인젝션|내부\s*(?:프롬프트|지시)|규칙을\s*무시)/i.test(
    normalized,
  );
}

function applyScopedConditionConfirmation(
  memory: NegotiationAgentBuilderMemory,
  latestMessage: string,
  previousMemory: NegotiationAgentBuilderMemory,
): NegotiationAgentBuilderMemory {
  if (previousMemory.questions.length === 0) return memory;

  const previousQuestion = previousMemory.questions.join(" ");
  const scopedQuestion = parseScopedConditionQuestion(previousQuestion);
  if (!scopedQuestion) return memory;

  const { sourceScope, conditionName, targetScope } = scopedQuestion;

  if (isRejectScopedConditionAnswer(latestMessage)) {
    const slotId = scopedConditionSlotId(conditionName);
    return {
      ...removeSlotFromNegotiationAgentBuilderMemory(memory, slotId),
      source: unique([...memory.source, ...targetScopeIntentSources(previousMemory, targetScope)]),
      structured: appendScopedConditionDecision(memory.structured ?? previousMemory.structured, {
        slotId,
        sourceScope,
        targetScope,
        decision: "rejected",
        reason: "buyer chose to set a fresh requirement for the new product",
      }),
    };
  }

  if (!isApplyScopedConditionAnswer(latestMessage)) return memory;

  const memoryText = memoryTextFromNegotiationAgentBuilderMemory(previousMemory);
  const appliedFacts: string[] = [];

  if (conditionName === "배터리 조건") {
    const threshold = extractBatteryThresholdLabel(memoryText) ?? "90% 이상";
    const fact = `${targetScope} battery >= ${threshold.replace(/\s*이상$/, "%").replace(/%+$/, "%")}`;
    appliedFacts.push(fact);
    if (!memory.mustHave.some((item) => /battery|배터리|성능/i.test(item))) {
      memory = {
        ...memory,
        mustHave: unique([...memory.mustHave, `battery >= ${threshold}`]),
      };
    }
  } else if (conditionName === "언락/통신사 조건") {
    const carrierFact = `${targetScope} carrier condition same as ${sourceScope}`;
    appliedFacts.push(carrierFact);
  } else {
    appliedFacts.push(`${targetScope} condition same as ${sourceScope}`);
  }

  return {
    ...memory,
    source: unique([...memory.source, ...appliedFacts]),
    structured: appendScopedConditionDecision(memory.structured ?? previousMemory.structured, {
      slotId: scopedConditionSlotId(conditionName),
      sourceScope,
      targetScope,
      decision: "applied",
      reason: "buyer confirmed reuse across product scopes",
    }),
  };
}

function targetScopeIntentSources(
  previousMemory: NegotiationAgentBuilderMemory,
  targetScope: string,
): string[] {
  const targetSources = previousMemory.source.filter(
    (source) =>
      extractStructuredProductScopes(source).includes(targetScope) &&
      normalizeStructuredFacts(source).length === 0,
  );
  return targetSources.length > 0 ? targetSources : [targetScope];
}

function appendScopedConditionDecision(
  structured: NegotiationAgentBuilderMemory["structured"] | undefined,
  decision: NonNullable<
    NegotiationAgentBuilderMemory["structured"]
  >["scopedConditionDecisions"][number],
): NegotiationAgentBuilderMemory["structured"] {
  return {
    activeIntent: structured?.activeIntent,
    productRequirements: structured?.productRequirements ?? {},
    globalPreferences: structured?.globalPreferences ?? { mustHave: [], avoid: [] },
    pendingSlots: structured?.pendingSlots ?? [],
    discardedSignals: structured?.discardedSignals ?? [],
    memoryConflicts: structured?.memoryConflicts ?? [],
    scopedConditionDecisions: uniqueScopedConditionDecisions([
      ...(structured?.scopedConditionDecisions ?? []),
      decision,
    ]),
    sessionMemory: structured?.sessionMemory,
    longTermMemory: structured?.longTermMemory,
    promotionDecisions: structured?.promotionDecisions ?? [],
    compression: structured?.compression,
    questionPlan: structured?.questionPlan,
  };
}

function uniqueScopedConditionDecisions(
  decisions: NonNullable<NegotiationAgentBuilderMemory["structured"]>["scopedConditionDecisions"],
): NonNullable<NegotiationAgentBuilderMemory["structured"]>["scopedConditionDecisions"] {
  const latestByScope = new Map<
    string,
    NonNullable<NegotiationAgentBuilderMemory["structured"]>["scopedConditionDecisions"][number]
  >();
  for (const decision of decisions) {
    const key = `${decision.slotId}:${decision.sourceScope ?? ""}:${decision.targetScope}`;
    latestByScope.delete(key);
    latestByScope.set(key, decision);
  }
  return Array.from(latestByScope.values()).slice(-12);
}

function parseScopedConditionQuestion(
  question: string,
): { sourceScope: string; conditionName: string; targetScope: string } | null {
  const match = question.match(
    /전에\s+(.+?)에서 말한\s+(배터리 조건|언락\/통신사 조건|이 조건)을\s+(.+?)에도 그대로 적용할까요/,
  );
  if (!match) return null;

  const sourceScope = match[1]?.trim();
  const conditionName = match[2]?.trim();
  const targetScope = match[3]?.trim();
  if (!sourceScope || !conditionName || !targetScope) return null;
  return { sourceScope, conditionName, targetScope };
}

function scopedConditionSlotId(conditionName: string): string {
  if (conditionName === "배터리 조건") return "battery_health";
  if (conditionName === "언락/통신사 조건") return "carrier_lock";
  return "buyer_priority";
}

function removeSlotFromNegotiationAgentBuilderMemory(
  memory: NegotiationAgentBuilderMemory,
  slotId: string,
): NegotiationAgentBuilderMemory {
  return {
    ...memory,
    mustHave: memory.mustHave.filter((fact) => !structuredSlotsForFacts([fact]).includes(slotId)),
    avoid: memory.avoid.filter((fact) => !structuredSlotsForFacts([fact]).includes(slotId)),
  };
}

function applyConflictConfirmationAnswer(
  memory: NegotiationAgentBuilderMemory,
  latestMessage: string,
  previousMemory: NegotiationAgentBuilderMemory,
): NegotiationAgentBuilderMemory {
  const pendingConflict = findPendingMemoryConflict(previousMemory);
  if (!pendingConflict?.currentValue || !pendingConflict.previousValue) return memory;

  if (isConfirmConflictAnswer(latestMessage)) {
    return {
      ...memory,
      mustHave: replaceMemoryFact(
        memory.mustHave,
        pendingConflict.previousValue,
        pendingConflict.currentValue,
      ),
      avoid: replaceMemoryFact(
        memory.avoid,
        pendingConflict.previousValue,
        pendingConflict.currentValue,
      ),
      source: unique([
        ...memory.source.filter((item) => !item.includes(pendingConflict.previousValue ?? "")),
        `${pendingConflict.productScope ?? previousMemory.categoryInterest} ${pendingConflict.currentValue}`,
      ]),
    };
  }

  if (isRejectConflictAnswer(latestMessage)) {
    return {
      ...memory,
      mustHave: replaceMemoryFact(
        memory.mustHave,
        pendingConflict.currentValue,
        pendingConflict.previousValue,
      ),
      avoid: replaceMemoryFact(
        memory.avoid,
        pendingConflict.currentValue,
        pendingConflict.previousValue,
      ),
      source: previousMemory.source,
    };
  }

  return memory;
}

function replaceMemoryFact(values: string[], from: string, to: string): string[] {
  const withoutFrom = values.filter((value) => value !== from);
  return unique([...withoutFrom, to]);
}

function applyAmbiguousPendingAnswerGuard(
  memory: NegotiationAgentBuilderMemory,
  latestMessage: string,
  previousMemory: NegotiationAgentBuilderMemory,
): NegotiationAgentBuilderMemory {
  if (!isAmbiguousAnswer(latestMessage) || previousMemory.questions.length === 0) return memory;

  const previousQuestion = previousMemory.questions.join(" ");
  return {
    ...memory,
    mustHave: removeFactsForPendingQuestion(
      memory.mustHave,
      previousQuestion,
      previousMemory.mustHave,
    ),
    avoid: removeFactsForPendingQuestion(memory.avoid, previousQuestion, previousMemory.avoid),
    source: previousMemory.source,
    questions: previousMemory.questions,
  };
}

function removeFactsForPendingQuestion(
  values: string[],
  question: string,
  previousValues: string[],
): string[] {
  const questionKinds = pendingQuestionKinds(question);
  if (questionKinds.length === 0) return values;

  const previous = new Set(previousValues);
  return values.filter((value) => {
    if (previous.has(value)) return true;
    const normalized = value.toLowerCase();
    if (questionKinds.includes("battery") && /battery|배터리|성능/.test(normalized)) return false;
    if (
      questionKinds.includes("carrier") &&
      /unlocked|locked|carrier|언락|잠금|통신사/.test(normalized)
    )
      return false;
    if (
      questionKinds.includes("priority") &&
      /priority|preference|must|avoid|조건|선호|우선|필수|피하/.test(normalized)
    )
      return false;
    return true;
  });
}

function pendingQuestionKinds(question: string): Array<"battery" | "carrier" | "priority"> {
  const kinds: Array<"battery" | "carrier" | "priority"> = [];
  if (/(?:배터리|성능|battery)/i.test(question)) kinds.push("battery");
  if (/(?:언락|잠금|통신사|unlocked|locked|carrier)/i.test(question)) kinds.push("carrier");
  if (kinds.length > 0) return kinds;
  if (/(?:조건|선호|필수|꼭|우선|중요|priority|preference|requirement|must)/i.test(question))
    kinds.push("priority");
  return kinds;
}

function isApplyScopedConditionAnswer(message: string): boolean {
  return /^(?:그대로|그대로\s*적용|같이|똑같이|동일하게|same|apply|yes|응|네|맞아)(?:\s*(?:해|해주세요|해줘|볼게|적용해|적용해줘))?\.?$/i.test(
    message.trim(),
  );
}

function isRejectScopedConditionAnswer(message: string): boolean {
  return /(?:아니|아니야|아니요|ㄴㄴ|다시\s*정|새로\s*정|따로\s*정|다르게|별도로|적용하지\s*마|no|nope|don'?t\s*apply|different|separate)/i.test(
    message.trim(),
  );
}

function isConfirmConflictAnswer(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return (
    /^(?:응|네|맞아|좋아|ㅇㅇ|yes|yep|yeah|ok|okay|바꿔|변경|변경해|그걸로|그 기준으로|그렇게|apply|change)(?:\s*(?:해|해주세요|해줘|할게|가자|적용해|적용해줘|바꿔|바꿔줘))?\.?$/i.test(
      normalized,
    ) || /(?:응|네|yes|ok|okay|좋아).{0,12}(?:바꿔|변경|적용|그걸로|그렇게)/i.test(normalized)
  );
}

function isRejectConflictAnswer(message: string): boolean {
  return /^(?:아니|아니야|ㄴㄴ|no|nope|유지|그대로|기존|원래대로|90|90%|이전)(?:\s*(?:해|해주세요|해줘|둘게|유지해|유지해줘))?\.?$/i.test(
    message.trim(),
  );
}

function isAmbiguousAnswer(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;
  if (isNoPreferenceAnswer(normalized) || isApplyScopedConditionAnswer(normalized)) return false;

  return (
    /^(?:글쎄(?:요)?|잘\s*모르겠(?:어|어요|음)?|모르겠(?:어|어요|음)?|애매(?:해|하네|함)?|아마(?:도)?|maybe|not\s*sure|unsure|depends|it\s*depends|그때\s*봐서|상황(?:에)?\s*따라|적당히|대충|괜찮은\s*걸로|좋은\s*걸로|아무\s*거나는\s*아닌데.*|흠+|음+)\.?$/i.test(
      normalized,
    ) ||
    /(?:글쎄|잘\s*모르겠|모르겠|애매|not\s*sure|unsure|depends|상황(?:에)?\s*따라)/i.test(
      normalized,
    )
  );
}

function extractBatteryThresholdLabel(memoryText: string): string | null {
  const match =
    memoryText.match(/(?:battery|배터리|성능)[^0-9]{0,30}((?:[7-9][0-9]|100)\s*%?)/i) ??
    memoryText.match(/((?:[7-9][0-9]|100)\s*%?)[^a-z0-9가-힣]{0,30}(?:battery|배터리|성능)/i);
  if (!match?.[1]) return null;

  const numeric = match[1].replace(/\s+/g, "");
  return numeric.endsWith("%") ? numeric : `${numeric}%`;
}

function noPreferenceFactsForQuestion(questionText: string): string[] {
  const normalized = questionText.toLowerCase();
  const facts: string[] = [];

  if (/(?:배터리|성능|battery)/i.test(normalized)) {
    facts.push("battery no preference");
  }
  if (/(?:언락|잠금|통신사|unlocked|locked|carrier)/i.test(normalized)) {
    facts.push("carrier no preference");
  }
  if (/(?:조건|선호|필수|꼭|우선|중요|priority|preference|requirement|must)/i.test(normalized)) {
    facts.push("no additional requirements");
  }

  if (facts.length === 0 && replyAsksQuestion(questionText)) {
    facts.push("no additional requirements");
  }

  return unique(facts);
}

function isNoPreferenceAnswer(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;

  return /^(?:없어(?:요)?|없음|없다|아니(?:요)?|상관\s*없(?:어|어요|음)?|무관(?:해|함)?|괜찮(?:아|아요)?|필요\s*없(?:어|어요|음)?|신경\s*안\s*써(?:요)?|아무거나|none|no preference|doesn'?t matter|not important|no need)\.?$/i.test(
    normalized,
  );
}

function hasGeneralNoPreference(memoryText: string): boolean {
  return /(?:no additional requirements|no preference|none|상관\s*없|무관|필요\s*없|신경\s*안\s*써|특별히\s*없|조건\s*없|선호\s*없)/i.test(
    memoryText,
  );
}

function memoryTextFromNegotiationAgentBuilderMemory(
  memory: NegotiationAgentBuilderMemory,
): string {
  return [memory.categoryInterest, ...memory.mustHave, ...memory.avoid, ...memory.source]
    .join(" ")
    .toLowerCase();
}

function replyAsksQuestion(reply: string): boolean {
  return getQuestionWindows(reply).length > 0;
}

/**
 * Openers that make a sentence a request for information even without a question mark.
 * Anchored at the start so "I'll tell me"-style false matches can't happen.
 */
const ASK_IMPERATIVE = /^\s*(tell me|let me know|share|describe|walk me through|give me|list)\b/i;

/**
 * Whether a sentence asks the user for something — by question mark OR by imperative.
 *
 * Counting only question marks missed a real e2e turn: "Tell me what a buyer should
 * appreciate — its history, a flawless lens, the case it nests in. What is its story?"
 * has exactly one "?", so the one-question rule passed it through as a single ask when
 * it was plainly two (and the first bundled three topics).
 */
function sentenceAsks(sentence: string): boolean {
  return replyAsksQuestion(sentence) || ASK_IMPERATIVE.test(sentence);
}

/**
 * Keep at most ONE ask per turn.
 *
 * The planner path already guarantees this: it strips the model's questions and appends
 * exactly one planned slot question. The seller / standalone path returns the raw reply,
 * so nothing stopped a turn like "…is it in flawless working order, or does it hold any
 * fault? And its exterior — has time left any marks on it?" Two asks in one bubble get
 * half-answered (people reply to the last one), and the unanswered half looks answered.
 *
 * "Ask" means `sentenceAsks`, not just a question mark — an imperative request carries
 * the same weight to the reader and used to slip past this entirely.
 *
 * Later asks are dropped; non-ask sentences are kept, so the acknowledgement and context
 * survive. What is dropped is not lost — the model still has it in memory.questions and
 * can raise it on the next turn.
 */
function keepSingleQuestion(reply: string): string {
  const sentences = reply.split(/(?<=[.!?。！？])\s+/);
  let seenAsk = false;
  const kept: string[] = [];
  for (const sentence of sentences) {
    if (sentenceAsks(sentence)) {
      if (seenAsk) continue;
      seenAsk = true;
    }
    kept.push(sentence);
  }
  const out = kept
    .join(" ")
    .replace(/\s{2,}/g, " ")
    .trim();
  // Never hand back an empty reply just because the split behaved unexpectedly.
  return out || reply;
}

/**
 * Guarantee the reply leaves the user with a next move.
 *
 * The requirement planner (`usePlanner`) only runs for a buyer WITH listing context, and
 * it is what appends the next slot question to that side's replies. The seller path and
 * the standalone buyer agent return the model's raw reply, so a turn could end on a flat
 * "Got it, I'll hold firm on that." — the user has no idea whether more input is wanted
 * or the setup is finished. The prompt now asks for an invitation on those branches too,
 * but with no planner behind them there is nothing to catch a turn where the model
 * ignores it, so enforce it here as well.
 *
 * Only appends when the reply asks nothing at all; a model that already ended on an ask
 * is left untouched so we never stack two in one turn. That check has to match
 * `keepSingleQuestion`'s notion of an ask — otherwise a reply ending in "Tell me what to
 * emphasize." reads as ask-free here and gets a second ask bolted on.
 */
function ensureReplyInvitesMore(reply: string, side: "buyer" | "seller"): string {
  const trimmed = reply.trim();
  const asksSomething = trimmed
    .split(/(?<=[.!?。！？])\s+/)
    .some((sentence) => sentenceAsks(sentence));
  if (!trimmed || asksSomething) return reply;
  const invite =
    side === "seller"
      ? "Anything else you want it to emphasize or hold firm on?"
      : "Anything else you want it to prioritize or avoid?";
  return `${trimmed} ${invite}`;
}

function buildNoPreferenceAcknowledgement(
  memory: NegotiationAgentBuilderMemory,
  agentProfileName: string,
): string {
  const product =
    memory.categoryInterest && memory.categoryInterest !== "탐색 중"
      ? memory.categoryInterest
      : "이 제품";
  const agentPrefix = agentProfileName === "팹" ? "좋아." : "알겠습니다.";

  return `${agentPrefix} 추가 조건은 없는 걸로 저장하고, ${product} 기준으로 바로 후보를 좁혀볼게요.`;
}

function parseJSON(raw: string): unknown {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  return JSON.parse(cleaned);
}

function _buildNegotiationAgentBuilderMemoryCards(
  memory: NegotiationAgentBuilderMemory,
): DemoMemoryCard[] {
  const normalizedMemory = normalizeNegotiationAgentBuilderBudgetMemory(memory, {
    latestMessage: memory.source.join(" "),
    listings: [],
  });
  const cards: DemoMemoryCard[] = [
    {
      cardType: "interest",
      memoryKey: "advisor:category_interest",
      summary: `Interested in ${normalizedMemory.categoryInterest}`,
      memory: {
        categoryInterest: normalizedMemory.categoryInterest,
        source: normalizedMemory.source.length > 0 ? normalizedMemory.source : ["advisor_demo"],
      },
      strength: 0.65,
    },
    {
      cardType: "style",
      memoryKey: "advisor:risk_and_tactic",
      summary: `${normalizedMemory.riskStyle} buyer style with ${normalizedMemory.openingTactic}`,
      memory: {
        riskStyle: normalizedMemory.riskStyle,
        negotiationStyle: normalizedMemory.negotiationStyle,
        openingTactic: normalizedMemory.openingTactic,
      },
      strength: 0.66,
    },
  ];

  if (normalizedMemory.budgetMax || normalizedMemory.targetPrice) {
    cards.push({
      cardType: "pricing",
      memoryKey: "advisor:budget_model",
      summary: `Target $${normalizedMemory.targetPrice ?? "?"}, max $${normalizedMemory.budgetMax ?? "?"}`,
      memory: {
        targetPrice: normalizedMemory.targetPrice,
        budgetMax: normalizedMemory.budgetMax,
      },
      strength: 0.72,
    });
  }

  if (normalizedMemory.mustHave.length > 0) {
    cards.push({
      cardType: "preference",
      memoryKey: "advisor:must_have",
      summary: `Must have: ${normalizedMemory.mustHave.join(", ")}`,
      memory: {
        mustHave: normalizedMemory.mustHave,
      },
      strength: 0.7,
    });
  }

  if (normalizedMemory.avoid.length > 0) {
    cards.push({
      cardType: "trust",
      memoryKey: "advisor:avoid",
      summary: `Avoid: ${normalizedMemory.avoid.join(", ")}`,
      memory: {
        avoid: normalizedMemory.avoid,
      },
      strength: 0.72,
    });
  }

  return cards;
}

function _hasNegotiationAgentBuilderActiveIntentSwitch(
  memory: NegotiationAgentBuilderMemory,
): boolean {
  return memory.source.some((item) => /active intent switched/i.test(item));
}

function _buildNegotiationAgentBuilderMemoryFromStoredCards(
  cards: Array<{ summary?: unknown; memory?: unknown; memory_key?: unknown }>,
): NegotiationAgentBuilderMemory | null {
  if (cards.length === 0) return null;

  const memory: NegotiationAgentBuilderMemory = {
    categoryInterest: "탐색 중",
    mustHave: [],
    avoid: [],
    dealBreakers: [],
    mustEmphasize: [],
    notes: [],
    categoryCriteria: [],
    riskStyle: "balanced",
    negotiationStyle: "balanced",
    openingTactic: "fair_market_anchor",
    questions: [],
    source: [],
  };
  let foundUsefulMemory = false;

  for (const card of cards) {
    const data =
      card.memory && typeof card.memory === "object"
        ? (card.memory as Record<string, unknown>)
        : {};
    const memoryKey = stringFrom(card.memory_key) ?? stringFrom(data.normalizedValue) ?? "";
    const isPresetTuningCard =
      memoryKey.startsWith("advisor:preset_tuning:") || memoryKey.startsWith("preset_tuning:");
    const categoryInterest = stringFrom(data.categoryInterest);
    const targetPrice = numberFrom(data.targetPrice);
    const budgetMax = numberFrom(data.budgetMax);
    const mustHave = stringArrayFrom(data.mustHave);
    const avoid = stringArrayFrom(data.avoid);
    const structured = structuredFrom(data.structured);
    const riskStyle = riskStyleFrom(data.riskStyle);
    const negotiationStyle = negotiationStyleFrom(data.negotiationStyle);
    const openingTactic = openingTacticFrom(data.openingTactic);

    if (categoryInterest) {
      memory.categoryInterest = categoryInterest;
      foundUsefulMemory = true;
    }
    if (targetPrice !== undefined) {
      memory.targetPrice = targetPrice;
      foundUsefulMemory = true;
    }
    if (budgetMax !== undefined) {
      memory.budgetMax = budgetMax;
      foundUsefulMemory = true;
    }
    if (mustHave.length > 0) {
      memory.mustHave = unique([...memory.mustHave, ...mustHave]);
      foundUsefulMemory = true;
    }
    if (avoid.length > 0) {
      memory.avoid = unique([...memory.avoid, ...avoid]);
      foundUsefulMemory = true;
    }
    if (structured) {
      memory.structured = mergeStructuredNegotiationAgentBuilderMemory(
        memory.structured,
        structured,
      );
      foundUsefulMemory = true;
    }
    if (riskStyle) {
      memory.riskStyle = riskStyle;
      foundUsefulMemory = true;
    }
    if (negotiationStyle) {
      memory.negotiationStyle = negotiationStyle;
      foundUsefulMemory = true;
    }
    if (openingTactic) {
      memory.openingTactic = openingTactic;
      foundUsefulMemory = true;
    }

    memory.source = unique([
      ...memory.source,
      ...stringArrayFrom(data.source),
      ...(!isPresetTuningCard && typeof card.summary === "string" ? [card.summary] : []),
    ]);
  }

  return foundUsefulMemory
    ? normalizeNegotiationAgentBuilderBudgetMemory(memory, {
        latestMessage: memory.source.join(" "),
        listings: [],
      })
    : null;
}

function normalizeNegotiationAgentBuilderBudgetMemory(
  memory: NegotiationAgentBuilderMemory,
  context: {
    latestMessage: string;
    previousMemory?: NegotiationAgentBuilderMemory;
    listings: Array<{ title: string; category?: string; askPriceMinor: number }>;
  },
): NegotiationAgentBuilderMemory {
  const normalized = { ...memory };
  const explicitBudget = extractExplicitDollarBudget(context.latestMessage, context.previousMemory);
  const electronicsLike = isConsumerElectronicsMemory(normalized, context.listings);
  const latestIsNonBudgetNumeric =
    (hasPercentNumber(context.latestMessage) ||
      hasProductModelNumber(context.latestMessage) ||
      hasMeasurementContext(context.latestMessage, context.previousMemory) ||
      isShortModelAnswerToPendingQuestion(context.latestMessage, context.previousMemory)) &&
    !hasExplicitMoneyUnit(context.latestMessage);

  if (latestIsNonBudgetNumeric) {
    normalized.budgetMax = context.previousMemory?.budgetMax;
    normalized.targetPrice = context.previousMemory?.targetPrice;
  }

  if (explicitBudget !== undefined) {
    const previousBudget = normalized.budgetMax;
    normalized.budgetMax = explicitBudget;
    normalized.targetPrice = normalizeTargetAgainstBudget(
      normalized.targetPrice,
      previousBudget,
      explicitBudget,
    );
    return normalized;
  }

  if (electronicsLike) {
    normalized.budgetMax = normalizeConsumerElectronicsDollarValue(normalized.budgetMax);
    normalized.targetPrice = normalizeConsumerElectronicsDollarValue(normalized.targetPrice);
  }

  if (
    normalized.budgetMax !== undefined &&
    normalized.targetPrice !== undefined &&
    normalized.targetPrice > normalized.budgetMax
  ) {
    normalized.targetPrice = Math.max(1, Math.round(normalized.budgetMax * 0.9));
  }

  return normalized;
}

function extractExplicitDollarBudget(
  message: string,
  previousMemory?: NegotiationAgentBuilderMemory,
): number | undefined {
  const text = message.trim().toLowerCase();
  if (
    hasPercentNumber(text) ||
    hasProductModelNumber(text) ||
    hasMeasurementContext(text, previousMemory) ||
    isShortModelAnswerToPendingQuestion(text, previousMemory)
  )
    return undefined;
  const maxMatch = text.match(
    /(?:max|maximum|budget|예산|최대)[^0-9$]{0,20}(?:\$|usd\s*)?(\d[\d,]*(?:\.\d{1,2})?)/i,
  );
  const maxParsed = parseDollarNumber(maxMatch?.[1]);
  if (maxParsed !== undefined) return maxParsed;

  const qualifiedPatterns = [
    /(?:\$|usd\s*)(\d[\d,]*(?:\.\d{1,2})?)/i,
    /(\d[\d,]*(?:\.\d{1,2})?)\s*(?:usd|dollars?|달러|불)\b/i,
  ];

  for (const pattern of qualifiedPatterns) {
    const match = text.match(pattern);
    const parsed = parseDollarNumber(match?.[1]);
    if (parsed !== undefined) return parsed;
  }

  const numbers = Array.from(text.matchAll(/\b\d[\d,]*(?:\.\d{1,2})?\b/g))
    .map((match) => parseDollarNumber(match[0]))
    .filter((value): value is number => value !== undefined);
  const budgetContext =
    /(?:예산|최대|목표가|가격|budget|max|target|달러라고|불이라고)/i.test(message) ||
    previousMemory?.questions.some((question) =>
      /(?:예산|최대|목표가|가격|budget|max|target)/i.test(question),
    );

  if (budgetContext && numbers.length === 1) {
    const value = numbers[0];
    if (
      value < 100 &&
      !hasExplicitMoneyUnit(text) &&
      !/(?:예산|최대|목표가|budget|max|target)[^0-9$]{0,20}\d{2}/i.test(text)
    ) {
      return undefined;
    }
    return value;
  }
  return undefined;
}

function hasPercentNumber(text: string): boolean {
  return /\b\d{1,3}\s*%|퍼센트|프로\b/i.test(text);
}

function hasProductModelNumber(text: string): boolean {
  return (
    /(?:iphone|아이폰|model|모델)\s*\d{1,2}\b/i.test(text) ||
    /\b\d{1,2}\s*(?:pro\s*max|pro|max|plus|mini)\b/i.test(text)
  );
}

function isShortModelAnswerToPendingQuestion(
  text: string,
  previousMemory?: NegotiationAgentBuilderMemory,
): boolean {
  if (
    !previousMemory?.questions.some((question) => /(?:모델|iphone|아이폰|쪽|우선)/i.test(question))
  )
    return false;
  return /^\s*(?:1[1-9]|[2-9])\s*(?:은|는|로|요|\?)*\s*$/i.test(text.trim());
}

function hasExplicitMoneyUnit(text: string): boolean {
  return /[$]|(?:usd|dollars?|bucks?|달러|불)\b/i.test(text);
}

/**
 * True when a numeric answer is about a NON-price measurement (mileage, cycles, size,
 * storage, specs) rather than budget — either the message itself names the unit, or it
 * answers a previous non-price taxonomy question. Without this, "for mileage, 25000 or
 * under" reads its 25000 as the buyer's budget and corrupts the price ceiling.
 */
function hasMeasurementContext(
  text: string,
  previousMemory?: NegotiationAgentBuilderMemory,
): boolean {
  if (
    /\b(?:mile|miles|mileage|mi|km|kilomet|주행|주행거리|cycle|cycles|사이클|size|사이즈|gb|tb|ram|cpu)\b/i.test(
      text,
    )
  ) {
    return true;
  }
  // A bare number answering a non-price taxonomy gate (mileage/specs/size/service).
  return (
    previousMemory?.questions.some((q) =>
      /mileage|mile|service history|cycle|storage|spec|size|cpu|ram/i.test(q),
    ) ?? false
  );
}

function normalizeTargetAgainstBudget(
  targetPrice: number | undefined,
  previousBudget: number | undefined,
  budgetMax: number,
): number | undefined {
  if (targetPrice === undefined) return Math.max(1, Math.round(budgetMax * 0.9));
  if (targetPrice <= budgetMax && targetPrice > 0) return targetPrice;

  if (previousBudget && previousBudget > 0) {
    const ratio = targetPrice / previousBudget;
    if (ratio > 0.5 && ratio <= 1) return Math.max(1, Math.round(budgetMax * ratio));
  }

  return Math.max(1, Math.round(budgetMax * 0.9));
}

function normalizeConsumerElectronicsDollarValue(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (value >= 10_000 && value <= 5_000_000) {
    const dividedByThousand = value / 1000;
    if (dividedByThousand >= 50 && dividedByThousand <= 5000) return Math.round(dividedByThousand);

    const dividedByHundred = value / 100;
    if (dividedByHundred >= 50 && dividedByHundred <= 5000) return Math.round(dividedByHundred);
  }
  return value;
}

function isConsumerElectronicsMemory(
  memory: NegotiationAgentBuilderMemory,
  listings: Array<{ title: string; category?: string; askPriceMinor: number }>,
): boolean {
  const text = [
    memory.categoryInterest,
    ...memory.mustHave,
    ...memory.avoid,
    ...memory.source,
    ...listings.map((listing) => `${listing.title} ${listing.category}`),
  ]
    .join(" ")
    .toLowerCase();

  if (
    /(iphone|아이폰|ipad|아이패드|phone|smartphone|휴대폰|핸드폰|macbook|laptop|electronics)/i.test(
      text,
    )
  ) {
    return true;
  }

  const prices = listings
    .map((listing) => listing.askPriceMinor / 100)
    .filter((price) => price > 0);
  return prices.length > 0 && Math.max(...prices) <= 5000;
}

function parseDollarNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value.replace(/,/g, ""));
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.round(parsed);
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberFrom(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArrayFrom(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function structuredFrom(value: unknown): NegotiationAgentBuilderMemory["structured"] | undefined {
  const parsed = structuredNegotiationAgentBuilderMemorySchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function mergeStructuredNegotiationAgentBuilderMemory(
  base: NegotiationAgentBuilderMemory["structured"] | undefined,
  next: NonNullable<NegotiationAgentBuilderMemory["structured"]>,
): NegotiationAgentBuilderMemory["structured"] {
  return {
    activeIntent: next.activeIntent ?? base?.activeIntent,
    productRequirements: {
      ...(base?.productRequirements ?? {}),
      ...next.productRequirements,
    },
    globalPreferences: {
      ...(base?.globalPreferences ?? {}),
      ...next.globalPreferences,
    },
    pendingSlots: next.pendingSlots.length > 0 ? next.pendingSlots : (base?.pendingSlots ?? []),
    discardedSignals: uniqueDiscardedSignals([
      ...(base?.discardedSignals ?? []),
      ...next.discardedSignals,
    ]),
    memoryConflicts: [...(base?.memoryConflicts ?? []), ...next.memoryConflicts].slice(-16),
    scopedConditionDecisions: uniqueScopedConditionDecisions([
      ...(base?.scopedConditionDecisions ?? []),
      ...next.scopedConditionDecisions,
    ]),
    sessionMemory: next.sessionMemory ?? base?.sessionMemory,
    longTermMemory: next.longTermMemory ?? base?.longTermMemory,
    promotionDecisions: [...(base?.promotionDecisions ?? []), ...next.promotionDecisions].slice(
      -24,
    ),
    compression: next.compression ?? base?.compression,
  };
}

function uniqueDiscardedSignals(
  signals: NonNullable<NegotiationAgentBuilderMemory["structured"]>["discardedSignals"],
): NonNullable<NegotiationAgentBuilderMemory["structured"]>["discardedSignals"] {
  const seen = new Set<string>();
  const result: NonNullable<NegotiationAgentBuilderMemory["structured"]>["discardedSignals"] = [];
  for (const signal of signals) {
    const key = `${signal.reason}:${signal.text}:${signal.relatedQuestion ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(signal);
  }
  return result.slice(-12);
}

function riskStyleFrom(value: unknown): NegotiationAgentBuilderMemory["riskStyle"] | undefined {
  return value === "safe_first" || value === "balanced" || value === "lowest_price"
    ? value
    : undefined;
}

function negotiationStyleFrom(
  value: unknown,
): NegotiationAgentBuilderMemory["negotiationStyle"] | undefined {
  return value === "defensive" || value === "balanced" || value === "aggressive"
    ? value
    : undefined;
}

function openingTacticFrom(
  value: unknown,
): NegotiationAgentBuilderMemory["openingTactic"] | undefined {
  return value === "condition_anchor" || value === "fair_market_anchor" || value === "speed_close"
    ? value
    : undefined;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values)).slice(0, 12);
}

async function _upsertNegotiationAgentBuilderMemoryCards(
  db: Database,
  input: {
    userId: string;
    sourceMessageId: string;
    cards: DemoMemoryCard[];
    metadata: Record<string, unknown>;
  },
) {
  const stored = [];

  for (const card of input.cards) {
    const eventDelta = {
      source: "advisor_demo",
      sourceMessageId: input.sourceMessageId,
      metadata: input.metadata,
      cardType: card.cardType,
      memoryKey: card.memoryKey,
      summary: card.summary,
    };

    const result = await db.execute(sql`
      WITH existing AS (
        SELECT id, evidence_refs ? ${input.sourceMessageId} AS evidence_seen
        FROM user_memory_cards
        WHERE user_id = ${input.userId}
          AND card_type = ${card.cardType}
          AND memory_key = ${card.memoryKey}
      ),
      upserted AS (
        INSERT INTO user_memory_cards (
          user_id,
          card_type,
          memory_key,
          status,
          summary,
          memory,
          evidence_refs,
          strength,
          version,
          last_reinforced_at,
          expires_at,
          created_at,
          updated_at
        )
        VALUES (
          ${input.userId},
          ${card.cardType},
          ${card.memoryKey},
          'ACTIVE',
          ${card.summary},
          ${JSON.stringify(card.memory)}::jsonb,
          ${JSON.stringify([input.sourceMessageId])}::jsonb,
          ${card.strength.toFixed(4)},
          1,
          NOW(),
          NOW() + interval '365 days',
          NOW(),
          NOW()
        )
        ON CONFLICT (user_id, card_type, memory_key) DO UPDATE
          SET status = 'ACTIVE',
              summary = EXCLUDED.summary,
              memory = CASE
                WHEN user_memory_cards.evidence_refs ? ${input.sourceMessageId}
                  THEN user_memory_cards.memory
                ELSE user_memory_cards.memory || EXCLUDED.memory
              END,
              evidence_refs = CASE
                WHEN user_memory_cards.evidence_refs ? ${input.sourceMessageId}
                  THEN user_memory_cards.evidence_refs
                ELSE (
                  SELECT COALESCE(jsonb_agg(DISTINCT ref), '[]'::jsonb)
                  FROM jsonb_array_elements_text(user_memory_cards.evidence_refs || EXCLUDED.evidence_refs) AS refs(ref)
                )
              END,
              strength = CASE
                WHEN user_memory_cards.evidence_refs ? ${input.sourceMessageId}
                  THEN user_memory_cards.strength
                ELSE LEAST(0.9500, GREATEST(user_memory_cards.strength::numeric, EXCLUDED.strength::numeric) + 0.0300)
              END,
              version = CASE
                WHEN user_memory_cards.evidence_refs ? ${input.sourceMessageId}
                  THEN user_memory_cards.version
                ELSE user_memory_cards.version + 1
              END,
              last_reinforced_at = CASE
                WHEN user_memory_cards.evidence_refs ? ${input.sourceMessageId}
                  THEN user_memory_cards.last_reinforced_at
                ELSE NOW()
              END,
              expires_at = CASE
                WHEN user_memory_cards.evidence_refs ? ${input.sourceMessageId}
                  THEN user_memory_cards.expires_at
                ELSE GREATEST(user_memory_cards.expires_at, EXCLUDED.expires_at)
              END,
              updated_at = CASE
                WHEN user_memory_cards.evidence_refs ? ${input.sourceMessageId}
                  THEN user_memory_cards.updated_at
                ELSE NOW()
              END
        WHERE NOT (user_memory_cards.evidence_refs ? ${input.sourceMessageId})
        RETURNING
          id,
          user_id,
          card_type,
          memory_key,
          summary,
          memory,
          strength,
          version,
          updated_at,
          (xmax = 0) AS created,
          NOT COALESCE((SELECT evidence_seen FROM existing), false) AS should_record_event
      ),
      event AS (
        INSERT INTO user_memory_events (
          user_id,
          card_id,
          event_type,
          delta,
          confidence,
          created_at
        )
        SELECT
          ${input.userId},
          id,
          CASE WHEN created THEN 'CREATED' ELSE 'REINFORCED' END,
          ${JSON.stringify(eventDelta)}::jsonb,
          ${card.strength.toFixed(4)},
          NOW()
        FROM upserted
        WHERE should_record_event
      )
      SELECT * FROM upserted
    `);

    const rows = rowsFromResult(result);
    if (rows[0]) stored.push(normalizeMemoryCardRow(rows[0]));
  }

  return stored;
}

function _presetTuningFeedbackDelta(input: z.infer<typeof presetTuningFeedbackBodySchema>): number {
  if (
    input.outcome === "accepted" &&
    input.final_price_minor &&
    input.price_cap_minor &&
    input.final_price_minor <= input.price_cap_minor
  ) {
    return input.application_mode === "auto" ? 0.035 : 0.045;
  }
  if (input.outcome === "accepted") return 0.015;
  if (input.outcome === "cap_blocked") return -0.01;
  if (input.outcome === "rejected") return -0.025;
  return -0.015;
}

async function _recordPresetTuningFeedback(
  db: Database,
  input: {
    userId: string;
    memoryKey: string;
    outcome: "accepted" | "rejected" | "abandoned" | "cap_blocked";
    delta: number;
    finalPriceMinor?: number;
    priceCapMinor?: number;
    applicationMode?: "auto" | "manual";
  },
) {
  const eventDelta = {
    source: "advisor_demo",
    surface: "developer_demo_preset_tuning_feedback",
    memoryKey: input.memoryKey,
    outcome: input.outcome,
    delta: input.delta,
    finalPriceMinor: input.finalPriceMinor,
    priceCapMinor: input.priceCapMinor,
    applicationMode: input.applicationMode,
  };
  const feedbackPatch = {
    outcome: input.outcome,
    delta: input.delta,
    finalPriceMinor: input.finalPriceMinor,
    priceCapMinor: input.priceCapMinor,
    applicationMode: input.applicationMode,
    recordedAt: new Date().toISOString(),
  };
  const result = await db.execute(sql`
    WITH updated AS (
      UPDATE user_memory_cards
      SET strength = LEAST(0.9500, GREATEST(0.1000, strength::numeric + ${input.delta.toFixed(4)})),
          memory = memory
            || ${JSON.stringify({ lastFeedback: feedbackPatch })}::jsonb
            || jsonb_build_object(
              'feedbackHistory',
              (
                SELECT COALESCE(jsonb_agg(item), '[]'::jsonb)
                FROM (
                  SELECT item
                  FROM jsonb_array_elements(
                    COALESCE(user_memory_cards.memory->'feedbackHistory', '[]'::jsonb)
                    || ${JSON.stringify([feedbackPatch])}::jsonb
                  ) WITH ORDINALITY AS history(item, ord)
                  ORDER BY ord DESC
                  LIMIT 5
                ) recent
              )
            ),
          last_reinforced_at = CASE
            WHEN ${input.delta.toFixed(4)}::numeric > 0 THEN NOW()
            ELSE last_reinforced_at
          END,
          updated_at = NOW()
      WHERE user_id = ${input.userId}
        AND memory_key = ${input.memoryKey}
        AND status = 'ACTIVE'
      RETURNING
        id,
        user_id,
        card_type,
        memory_key,
        summary,
        memory,
        strength,
        version,
        updated_at
    ),
    event AS (
      INSERT INTO user_memory_events (
        user_id,
        card_id,
        event_type,
        delta,
        confidence,
        created_at
      )
      SELECT
        ${input.userId},
        id,
        CASE WHEN ${input.delta.toFixed(4)}::numeric >= 0 THEN 'REINFORCED' ELSE 'SYSTEM_REVIEW' END,
        ${JSON.stringify(eventDelta)}::jsonb,
        ABS(${input.delta.toFixed(4)}::numeric),
        NOW()
      FROM updated
    )
    SELECT * FROM updated
  `);

  return rowsFromResult(result).map(normalizeMemoryCardRow);
}

async function _staleActiveNegotiationAgentBuilderMemoryCards(db: Database, userId: string) {
  await db.execute(sql`
    UPDATE user_memory_cards
    SET status = 'STALE',
        updated_at = NOW()
    WHERE user_id = ${userId}
      AND status = 'ACTIVE'
      AND memory_key LIKE 'advisor:%'
  `);
}

function _buildAdvisorSourceMessageId(
  body: z.infer<typeof saveNegotiationAgentBuilderMemoryBodySchema>,
): string {
  const hash = createHash("sha256")
    .update(
      stableStringify({
        userId: body.user_id,
        agentId: body.agent_id ?? null,
        message: body.message,
        memory: body.memory,
      }),
    )
    .digest("hex")
    .slice(0, 32);

  return `advisor:${hash}`;
}

function _buildPresetTuningSourceMessageId(
  body: z.infer<typeof savePresetTuningBodySchema>,
): string {
  const hash = createHash("sha256")
    .update(
      stableStringify({
        userId: body.user_id,
        agentId: body.agent_id ?? null,
        draft: {
          draftId: body.draft.draftId,
          presetId: body.draft.presetId,
          listingId: body.draft.listing.id,
          priceCapMinor: body.draft.priceCapMinor,
          openingOfferMinor: body.draft.openingOfferMinor,
          mustVerify: body.draft.mustVerify.map((term) => [
            term.termId,
            term.checked,
            term.enforcement,
          ]),
          leverage: body.draft.leverage.map((item) => [item.termId, item.enabled]),
          walkAway: body.draft.walkAway.map((item) => [item.id, item.enabled]),
        },
      }),
    )
    .digest("hex")
    .slice(0, 32);

  return `preset_tuning:${hash}`;
}

function _buildPresetTuningMemoryCard(
  draft: z.infer<typeof presetTuningDraftSchema>,
): DemoMemoryCard {
  const scope = presetTuningScope(draft);
  const enabledLeverage = draft.leverage.filter((item) => item.enabled);
  const enabledWalkAway = draft.walkAway.filter((item) => item.enabled);
  const checkedTerms = draft.mustVerify.filter((term) => term.checked);
  const uncheckedHardTerms = draft.mustVerify.filter(
    (term) => !term.checked && term.enforcement !== "soft",
  );

  return {
    cardType: "preference",
    memoryKey: `advisor:preset_tuning:${scope}`,
    summary: `${draft.presetLabel} for ${scope}: cap $${Math.round(draft.priceCapMinor / 100)}, opening $${Math.round(draft.openingOfferMinor / 100)}`,
    memory: {
      normalizedValue: `preset_tuning:${scope}`,
      productScope: scope,
      listing: draft.listing,
      presetId: draft.presetId,
      presetLabel: draft.presetLabel,
      priceCapMinor: draft.priceCapMinor,
      openingOfferMinor: draft.openingOfferMinor,
      concessionSpeed: draft.concessionSpeed,
      riskTolerance: draft.riskTolerance,
      checkedTerms: checkedTerms.map((term) => ({
        termId: term.termId,
        label: term.label,
        enforcement: term.enforcement,
        confirmedValue: term.confirmedValue,
      })),
      uncheckedHardTerms: uncheckedHardTerms.map((term) => ({
        termId: term.termId,
        label: term.label,
        enforcement: term.enforcement,
      })),
      leverage: enabledLeverage.map((item) => ({
        termId: item.termId,
        label: item.label,
        priceImpactMinor: item.priceImpactMinor,
      })),
      walkAway: enabledWalkAway.map((item) => ({
        id: item.id,
        label: item.label,
      })),
      engineReview: draft.engineReview
        ? {
            status: draft.engineReview.status,
            blockers: draft.engineReview.blockers.map((blocker) => ({
              id: blocker.id,
              label: blocker.label,
              severity: blocker.severity,
            })),
            nextActions: draft.engineReview.nextActions.map((action) => ({
              termId: action.termId,
              label: action.label,
              control: action.control,
              controlConfig: action.controlConfig,
            })),
          }
        : undefined,
      sourceBadges: draft.sourceBadges,
    },
    strength: 0.78,
  };
}

function presetTuningScope(draft: z.infer<typeof presetTuningDraftSchema>): string {
  const tag = draft.listing.tags.find((item) =>
    /iphone|macbook|tesla|laptop|phone|electronics/i.test(item),
  );
  const titleScope = draft.listing.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);

  return (tag || draft.listing.category || titleScope || "default")
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "_");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

async function _listDemoMemoryCards(db: Database, userId: string) {
  const result = await db.execute(sql`
    SELECT
      id,
      user_id,
      card_type,
      memory_key,
      summary,
      memory,
      strength,
      version,
      updated_at
    FROM user_memory_cards
    WHERE user_id = ${userId}
      AND status = 'ACTIVE'
    ORDER BY updated_at DESC
    LIMIT 50
  `);

  return rowsFromResult(result).map(normalizeMemoryCardRow);
}

async function _deleteDemoMemoryData(db: Database, userId: string) {
  const memoryEvents = await db.execute(sql`
    DELETE FROM user_memory_events
    WHERE user_id = ${userId}
    RETURNING id
  `);

  const memoryCards = await db.execute(sql`
    DELETE FROM user_memory_cards
    WHERE user_id = ${userId}
    RETURNING id
  `);

  const marketSignals = await db.execute(sql`
    DELETE FROM conversation_market_signals
    WHERE user_id = ${userId}
    RETURNING id
  `);

  const signalSources = await db.execute(sql`
    DELETE FROM conversation_signal_sources
    WHERE user_id = ${userId}
    RETURNING id
  `);

  return {
    user_memory_events: rowsFromResult(memoryEvents).length,
    user_memory_cards: rowsFromResult(memoryCards).length,
    conversation_market_signals: rowsFromResult(marketSignals).length,
    conversation_signal_sources: rowsFromResult(signalSources).length,
  };
}

function rowsFromResult(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  if (
    result &&
    typeof result === "object" &&
    Array.isArray((result as { rows?: unknown[] }).rows)
  ) {
    return (result as { rows: Record<string, unknown>[] }).rows;
  }
  return [];
}

function normalizeMemoryCardRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    user_id: row.user_id,
    card_type: row.card_type,
    memory_key: row.memory_key,
    summary: row.summary,
    memory: row.memory,
    strength: row.strength,
    version: row.version,
    updated_at: row.updated_at,
  };
}
