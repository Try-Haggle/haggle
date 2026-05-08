import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql, type Database } from "@haggle/db";
import { callLLM } from "../negotiation/adapters/xai-client.js";
import { getAgentVoiceProfile } from "../negotiation/lumen-persona-profiles.js";
import { recordConversationSignalsForRound } from "../services/conversation-signal-sink.js";
import {
  buildAdvisorRequirementPlan,
  formatTagRequirementPlanForPrompt,
  type TagRequirementPlan,
  type TagRequirementSlot,
} from "../services/tag-garden-requirements.js";
import { getTagGardenIntelligenceSnapshot } from "../services/tag-garden-intelligence.service.js";
import {
  buildAdvisorCandidatePlan,
  type AdvisorCandidatePlan,
} from "../services/advisor-candidate-planner.service.js";
import { generateTextEmbedding } from "../services/embedding.service.js";
import { saveAdvisorMemorySnapshot } from "../services/advisor-memory.service.js";
import {
  compilePresetTuningDraft,
  listNegotiationPresets,
} from "../services/preset-tuning.service.js";

const DEMO_USER_ID = "11111111-1111-4111-8111-111111111111";
const INPUT_TOKEN_USD = 0.0000002;
const OUTPUT_TOKEN_USD = 0.0000005;

const optionalPositiveIntSchema = z.preprocess(
  (value) => (value === null ? undefined : value),
  z.number().int().positive().optional(),
);

const structuredAdvisorMemorySchema = z.object({
  activeIntent: z.object({
    productScope: z.string().optional(),
    source: z.string().optional(),
  }).optional(),
  productRequirements: z.record(z.object({
    mustHave: z.array(z.string()).default([]),
    avoid: z.array(z.string()).default([]),
    answeredSlots: z.array(z.string()).default([]),
    ambiguousSlots: z.array(z.string()).default([]),
  })).default({}),
  globalPreferences: z.object({
    mustHave: z.array(z.string()).default([]),
    avoid: z.array(z.string()).default([]),
    budgetMax: optionalPositiveIntSchema,
    targetPrice: optionalPositiveIntSchema,
    riskStyle: z.enum(["safe_first", "balanced", "lowest_price"]).optional(),
    negotiationStyle: z.enum(["defensive", "balanced", "aggressive"]).optional(),
    openingTactic: z.enum(["condition_anchor", "fair_market_anchor", "speed_close"]).optional(),
  }).default({}),
  pendingSlots: z.array(z.object({
    slotId: z.string(),
    question: z.string(),
    enforcement: z.enum(["hard", "soft"]),
    productScope: z.string().optional(),
    status: z.enum(["pending", "ambiguous"]),
  })).default([]),
  discardedSignals: z.array(z.object({
    text: z.string(),
    reason: z.enum(["off_topic", "ambiguous", "noise", "security"]),
    relatedQuestion: z.string().optional(),
  })).default([]),
  memoryConflicts: z.array(z.object({
    slotId: z.string(),
    productScope: z.string().optional(),
    previousValue: z.string().optional(),
    currentValue: z.string().optional(),
    status: z.enum(["current", "superseded", "conflicting", "needs_confirmation"]),
    resolutionQuestion: z.string().optional(),
    reason: z.string().optional(),
  })).default([]),
  scopedConditionDecisions: z.array(z.object({
    slotId: z.string(),
    sourceScope: z.string().optional(),
    targetScope: z.string(),
    decision: z.enum(["applied", "rejected"]),
    reason: z.string().optional(),
  })).default([]),
  sessionMemory: z.object({
    facts: z.array(z.string()).default([]),
    pendingQuestions: z.array(z.string()).default([]),
    reason: z.string().optional(),
  }).optional(),
  longTermMemory: z.object({
    facts: z.array(z.string()).default([]),
    productScopes: z.array(z.string()).default([]),
    globalFacts: z.array(z.string()).default([]),
  }).optional(),
  promotionDecisions: z.array(z.object({
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
  })).default([]),
  compression: z.object({
    recentWindowFacts: z.array(z.string()).default([]),
    carriedForwardFacts: z.array(z.string()).default([]),
    droppedSignals: z.array(z.string()).default([]),
    summary: z.string(),
  }).optional(),
  questionPlan: z.object({
    policy: z.object({
      maxQuestionsPerTurn: z.number().int().positive(),
      order: z.array(z.enum(["conflict_resolution", "hard_slot", "candidate_narrowing", "soft_slot"])),
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
    deferred: z.array(z.object({
      slotId: z.string(),
      question: z.string(),
      enforcement: z.enum(["hard", "soft"]),
      reason: z.enum(["question_budget", "conflict_resolution_first", "lower_priority", "already_answered"]),
      productScope: z.string().optional(),
    })).default([]),
  }).optional(),
}).default({});

const advisorMemorySchema = z.object({
  categoryInterest: z.string().min(1),
  budgetMax: optionalPositiveIntSchema,
  targetPrice: optionalPositiveIntSchema,
  mustHave: z.array(z.string()).default([]),
  avoid: z.array(z.string()).default([]),
  riskStyle: z.enum(["safe_first", "balanced", "lowest_price"]),
  negotiationStyle: z.enum(["defensive", "balanced", "aggressive"]),
  openingTactic: z.enum(["condition_anchor", "fair_market_anchor", "speed_close"]),
  questions: z.array(z.string()).default([]),
  source: z.array(z.string()).default([]),
  structured: structuredAdvisorMemorySchema.optional(),
});

const saveAdvisorMemoryBodySchema = z.object({
  user_id: z.string().uuid().default(DEMO_USER_ID),
  session_id: z.string().uuid().optional(),
  agent_id: z.string().min(1).optional(),
  message: z.string().min(1).max(2000),
  memory: advisorMemorySchema,
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

const advisorTurnBodySchema = z.object({
  user_id: z.string().uuid().default(DEMO_USER_ID),
  agent_id: z.string().min(1).optional(),
  message: z.string().min(1).max(2000),
  previous_memory: advisorMemorySchema,
  listings: z.array(advisorListingSchema).default([]),
});

const presetTuningBodySchema = z.object({
  listing: advisorListingSchema.extend({
    floorPriceMinor: z.number().int().positive().optional(),
    marketMedianMinor: z.number().int().positive().optional(),
    sellerNote: z.string().optional(),
  }),
  memory: advisorMemorySchema.optional().nullable(),
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
  confirmedValue: z.object({
    value: z.union([z.string(), z.number(), z.boolean()]),
    label: z.string().optional(),
    unit: z.string().optional(),
    source: z.enum(["listing", "memory", "user", "seller_reply"]),
  }).optional(),
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
  branches: z.array(z.object({
    id: z.string(),
    label: z.string(),
    outcome: z.enum(["continue", "ask_user", "block"]),
    reason: z.string(),
  })),
  blockers: z.array(z.object({
    id: z.string(),
    label: z.string(),
    severity: z.enum(["hard", "soft"]),
    source: z.enum(["listing", "memory", "tag", "security"]),
    reason: z.string(),
  })),
  nextActions: z.array(z.object({
    termId: z.string().optional(),
    label: z.string(),
    control: z.enum(["toggle", "slider", "select", "text"]),
    question: z.string(),
    controlConfig: z.object({
      unit: z.string().optional(),
      min: z.number().optional(),
      max: z.number().optional(),
      step: z.number().optional(),
      defaultValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
      placeholder: z.string().optional(),
      options: z.array(z.object({
        value: z.string(),
        label: z.string(),
      })).optional(),
    }).optional(),
  })),
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
  negotiationStartPayload: z.record(z.unknown()),
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

const advisorTurnResultSchema = z.object({
  memory: advisorMemorySchema,
  reply: z.string().min(1),
  reasoning_summary: z.string().optional(),
});

const memoryQuerySchema = z.object({
  user_id: z.string().uuid().default(DEMO_USER_ID),
});

const resetDemoMemoryQuerySchema = z.object({
  user_id: z.string().uuid().default(DEMO_USER_ID),
});

const tagGardenIntelligenceQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

const advisorListingsQuerySchema = z.object({
  q: z.string().trim().max(300).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

type AdvisorMemory = z.infer<typeof advisorMemorySchema>;

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

export function registerIntelligenceDemoRoutes(app: FastifyInstance, db: Database) {
  app.post("/intelligence/demo/advisor-turn", async (request, reply) => {
    const parsed = advisorTurnBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_BODY", issues: parsed.error.issues });
    }

    try {
      const result = await analyzeAdvisorTurn(parsed.data);
      return reply.send({
        user_id: parsed.data.user_id,
        agent_id: parsed.data.agent_id,
        ...result,
      });
    } catch (err) {
      request.log.error({ err }, "advisor turn analysis failed");
      return reply.code(502).send({
        error: "ADVISOR_TURN_FAILED",
        message: err instanceof Error ? err.message : "Advisor turn failed",
      });
    }
  });

  app.post("/intelligence/demo/advisor-memory", async (request, reply) => {
    const parsed = saveAdvisorMemoryBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_BODY", issues: parsed.error.issues });
    }

    const body = parsed.data;
    const result = await saveAdvisorMemorySnapshot(db, {
      userId: body.user_id,
      sessionId: body.session_id,
      agentId: body.agent_id,
      message: body.message,
      memory: body.memory,
      surface: "developer_demo_advisor",
    });
    return reply.send(result);
  });

  app.get("/intelligence/demo/negotiation-presets", async () => {
    return { presets: listNegotiationPresets() };
  });

  app.post("/intelligence/demo/preset-tuning-draft", async (request, reply) => {
    const parsed = presetTuningBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_BODY", issues: parsed.error.issues });
    }

    const draft = compilePresetTuningDraft({
      listing: {
        ...parsed.data.listing,
        floorPriceMinor: parsed.data.listing.floorPriceMinor,
        marketMedianMinor: parsed.data.listing.marketMedianMinor,
        sellerNote: parsed.data.listing.sellerNote,
      },
      memory: parsed.data.memory,
      presetId: parsed.data.preset_id,
      priceCapMinor: parsed.data.price_cap_minor ?? (
        parsed.data.price_cap ? dollarsToMinor(parsed.data.price_cap) : undefined
      ),
    });

    return reply.send({ draft });
  });

  app.post("/intelligence/demo/preset-tuning-candidate", async (request, reply) => {
    const parsed = savePresetTuningBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_BODY", issues: parsed.error.issues });
    }

    const body = parsed.data;
    const sourceMessageId = buildPresetTuningSourceMessageId(body);
    const card = buildPresetTuningMemoryCard(body.draft);
    const memoryCards = await upsertAdvisorMemoryCards(db, {
      userId: body.user_id,
      sourceMessageId,
      cards: [card],
      metadata: {
        surface: "developer_demo_preset_tuning",
        agent_id: body.agent_id,
        draft_id: body.draft.draftId,
        listing_id: body.draft.listing.id,
      },
    });

    return reply.send({
      user_id: body.user_id,
      source_message_id: sourceMessageId,
      candidate: card,
      memory_cards: memoryCards,
    });
  });

  app.post("/intelligence/demo/preset-tuning-feedback", async (request, reply) => {
    const parsed = presetTuningFeedbackBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_BODY", issues: parsed.error.issues });
    }

    const body = parsed.data;
    const delta = presetTuningFeedbackDelta(body);
    const memoryCards = await recordPresetTuningFeedback(db, {
      userId: body.user_id,
      memoryKey: body.memory_key,
      outcome: body.outcome,
      delta,
      finalPriceMinor: body.final_price_minor,
      priceCapMinor: body.price_cap_minor,
      applicationMode: body.application_mode,
    });

    return reply.send({
      user_id: body.user_id,
      memory_key: body.memory_key,
      outcome: body.outcome,
      delta,
      memory_cards: memoryCards,
    });
  });

  app.get("/intelligence/demo/memory", async (request, reply) => {
    const parsed = memoryQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_QUERY", issues: parsed.error.issues });
    }

    const cards = await listDemoMemoryCards(db, parsed.data.user_id);
    return reply.send({
      user_id: parsed.data.user_id,
      cards,
      advisor_memory: buildAdvisorMemoryFromStoredCards(cards),
    });
  });

  app.get("/intelligence/demo/tag-garden-intelligence", async (request, reply) => {
    const parsed = tagGardenIntelligenceQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_QUERY", issues: parsed.error.issues });
    }

    const snapshot = await getTagGardenIntelligenceSnapshot(db, {
      limit: parsed.data.limit,
    });
    return reply.send(snapshot);
  });

  app.get("/intelligence/demo/advisor-listings", async (request, reply) => {
    const parsed = advisorListingsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_QUERY", issues: parsed.error.issues });
    }

    const result = await listAdvisorDemoListings(db, parsed.data);
    const advisorPlan = buildAdvisorCandidatePlan({
      listings: result.plannerListings,
      budgetKnown: false,
      hasBuyerPreference: false,
    });
    return reply.send({
      source: "db",
      count: result.totalMatched,
      shown: result.listings.length,
      retrieval: result.retrieval,
      listings: result.listings,
      advisor_plan: advisorPlan,
    });
  });

  app.delete("/intelligence/demo/memory", async (request, reply) => {
    const parsed = resetDemoMemoryQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_QUERY", issues: parsed.error.issues });
    }

    const deleted = await deleteDemoMemoryData(db, parsed.data.user_id);
    return reply.send({ user_id: parsed.data.user_id, deleted });
  });
}

async function listAdvisorDemoListings(
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
  const rows = await db.execute(sql`
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
  `) as unknown as Array<{
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
  const finalRanked = semanticRanked.length > 0
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
  const floorPrice = Math.max(1, Math.min(normalizeMajorPrice(row.floor_price, Math.round(askPrice * 0.86)), askPrice));
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
  const semanticRows = await db.execute(sql`
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
  `) as unknown as Array<{
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
    .filter(({ row, semanticScore }) => semanticScore >= 0.3 && (
      brandTerms.length === 0
        || listingMatchesBrandTerms(rowToAdvisorListing(row), brandTerms)
    ))
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
    .sort((a, b) => (
      b.score - a.score
      || (keywordIndex.get(a.listing.id) ?? Number.MAX_SAFE_INTEGER) - (keywordIndex.get(b.listing.id) ?? Number.MAX_SAFE_INTEGER)
    ))
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

function buildSellerTurns(askPriceMinor: number, floorPriceMinor: number): AdvisorDemoListing["sellerTurns"] {
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
  const text = normalizeSearchText([
    listing.title,
    listing.category,
    listing.condition,
    ...listing.tags,
  ].join(" "));

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

  if (terms.length > 1 && terms.every((term) => title.includes(term) || tags.some((tag) => tag.includes(term)))) {
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
  "테슬라": ["tesla"],
  "모델3": ["model", "model 3", "model-3"],
  "아이폰": ["iphone"],
  "휴대폰": ["phone", "smartphone", "iphone"],
  "핸드폰": ["phone", "smartphone", "iphone"],
  "폰": ["phone", "smartphone", "iphone"],
  "맥북": ["macbook"],
  "노트북": ["laptop"],
  "차": ["car", "vehicle"],
  "차량": ["car", "vehicle"],
  "자동차": ["car", "vehicle"],
  "전기차": ["ev", "electric"],
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

async function analyzeAdvisorTurn(input: z.infer<typeof advisorTurnBodySchema>) {
  const initialRequirementPlan = buildAdvisorRequirementPlan({
    memory: input.previous_memory,
    listings: input.listings,
  });
  const initialCandidatePlan = buildAdvisorCandidatePlan({
    listings: input.listings,
    budgetKnown: Boolean(input.previous_memory.budgetMax),
    hasBuyerPreference: hasAdvisorBuyerPreference(input.previous_memory),
    memory: input.previous_memory,
  });
  const agentProfile = getAgentVoiceProfile(input.agent_id);

  const response = await callLLM(
    `You are the Haggle developer-demo product advisor.
Your task is context engineering: update buyer memory from the latest user message and decide whether one essential follow-up question is needed.

Lumen agent voice:
- Agent: ${agentProfile.name} (${agentProfile.role})
- ${agentProfile.prompt}
- Speaks like: ${agentProfile.speaksLike}
- Avoid: ${agentProfile.avoid.join(", ")}
- Apply this voice clearly in Korean while preserving the buyer's facts.
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
- Infer budgetMax and targetPrice only from explicit budget/price.
- budgetMax and targetPrice are user-facing USD dollars, not cents and not Korean won. If the buyer says "450", "$450", "450 dollars", or "450 달러", store 450.
- targetPrice should be slightly below budgetMax when reasonable.
- Do not decide required follow-up slots from intuition. Tag Garden requirement slots below are authoritative.
- Slots marked enforcement=hard are blocking: ask missing hard slots before recommending, starting negotiation, or asking softer preference questions.
- To reduce slow back-and-forth, bundle up to three related missing questions in one turn when the buyer can answer them together.
- Slots marked enforcement=soft are helpful but should not block recommendation when stronger candidate-planner work is ready.
- Store each bundled question separately in memory.questions.
- Ask only for the next missing advisor_recommendation slot from Tag Garden requirements.
- If a required question is needed, ask it once as the final question. Do not ask a paraphrase and then the exact same question.
- If the latest user message answers the current question, acknowledge and move forward. Do not repeat the same priority question.
- If the buyer answers "없어", "상관없어", "무관", "필요 없어", "신경 안 써", "none", or "no preference" to a pending condition or priority question, treat that slot as answered with no preference. Do not ask it again and do not invent a must-have from it.
- If the product intent already maps to available listings, do not ask a generic usage/purpose question. Move to the next concrete requirement such as budget, trim, condition, or verification.
- Never mention Tag Garden, tags, requirement slots, internal criteria, or context engineering in the user-facing reply.
- Do NOT make battery health, carrier unlock, IMEI, or box mandatory by default. They are mandatory only when Tag Garden says the matched item tag requires them.
- If the user says they want box/original box/full package, record "original box included"; box itself is not a required iPhone slot unless Tag Garden marks it required.
- If no advisor_recommendation slot is missing after updating memory, questions must be [].
- If the budget is below all listing ask prices, keep the budget as stated and explain the negotiation will need a lower anchor or an older/safer-fit model; do not invent missing constraints.
- Reply in Korean, naturally, one or two sentences.

Return valid JSON only:
{
  "memory": {
    "categoryInterest": string,
    "budgetMax": number optional,
    "targetPrice": number optional,
    "mustHave": string[],
    "avoid": string[],
    "riskStyle": "safe_first"|"balanced"|"lowest_price",
    "negotiationStyle": "defensive"|"balanced"|"aggressive",
    "openingTactic": "condition_anchor"|"fair_market_anchor"|"speed_close",
    "questions": string[],
    "source": string[]
  },
  "reply": string,
  "reasoning_summary": string
}`,
    `Previous memory:
${JSON.stringify(input.previous_memory, null, 2)}

Available demo listings:
${formatAdvisorListingsForPrompt(input.listings)}

Latest user message:
${input.message}

Tag Garden requirement slots:
${formatTagRequirementPlanForPrompt(initialRequirementPlan)}

Candidate planner:
${formatCandidatePlanForPrompt(initialCandidatePlan)}`,
	    {
	      correlationId: "intelligence-demo-advisor-turn",
	      maxTokens: 700,
	    },
	  );

  const parsed = advisorTurnResultSchema.parse(parseJSON(response.content));
  const sourceCandidates = parsed.memory.source.length > 0
    ? parsed.memory.source.slice(-7)
    : input.previous_memory.source.slice(-7);
  const parsedSource = unique([
    ...sourceCandidates.filter((source) => shouldKeepAdvisorSource(source, input.previous_memory)),
    ...(shouldKeepAdvisorSource(input.message, input.previous_memory) ? [input.message] : []),
  ]).slice(-8);
  const memory = sanitizeAdvisorMemoryFacts(applyConflictConfirmationAnswer(applyAmbiguousPendingAnswerGuard(applyPendingSlotAnswerScope(applyScopedConditionConfirmation(applyNoPreferenceAnswer(normalizeAdvisorBudgetMemory({
    ...parsed.memory,
    structured: parsed.memory.structured ?? input.previous_memory.structured,
    source: parsedSource,
  }, {
    latestMessage: input.message,
    previousMemory: input.previous_memory,
    listings: input.listings,
  }), input.message, input.previous_memory), input.message, input.previous_memory), input.message, input.previous_memory), input.message, input.previous_memory), input.message, input.previous_memory), input.previous_memory);
  const finalRequirementPlan = buildAdvisorRequirementPlan({
    memory,
    listings: input.listings,
  });
  const finalCandidatePlan = applyRequirementGateToCandidatePlan(buildAdvisorCandidatePlan({
    listings: input.listings,
    budgetKnown: Boolean(memory.budgetMax),
    hasBuyerPreference: hasAdvisorBuyerPreference(memory),
    memory,
  }), finalRequirementPlan);
  let nextQuestions = chooseNextAdvisorQuestions(finalCandidatePlan, finalRequirementPlan, memory);
  const finalMemory = {
    ...memory,
    questions: nextQuestions,
  };
  finalMemory.structured = buildStructuredAdvisorMemory({
    memory: finalMemory,
    previousMemory: input.previous_memory,
    latestMessage: input.message,
    requirementPlan: finalRequirementPlan,
  });
  finalMemory.source = pruneSupersededAdvisorSources(finalMemory.source, finalMemory.structured.memoryConflicts);
  const conflictQuestion = chooseConflictResolutionQuestion(finalMemory.structured);
  if (conflictQuestion) {
    nextQuestions = [conflictQuestion];
    finalMemory.questions = nextQuestions;
  }
  finalMemory.structured.questionPlan = buildStructuredQuestionPlan({
    nextQuestions,
    requirementPlan: finalRequirementPlan,
    structured: finalMemory.structured,
  });
  const reply = buildAdvisorReplyAfterPlanning({
    parsedReply: parsed.reply,
    nextQuestions,
    candidatePlan: finalCandidatePlan,
    requirementPlan: finalRequirementPlan,
    latestMessage: input.message,
    previousMemory: input.previous_memory,
    memory: finalMemory,
    agentProfileName: agentProfile.name,
  });

  return {
    ...parsed,
    memory: finalMemory,
    reply,
    tag_requirements: finalRequirementPlan,
    advisor_plan: finalCandidatePlan,
    turn_cost: buildAdvisorTurnCost(response.usage),
  };
}

function formatAdvisorListingsForPrompt(listings: Array<z.infer<typeof advisorListingSchema>>): string {
  if (listings.length === 0) return "none";

  return listings
    .slice(0, ADVISOR_TURN_LISTING_CONTEXT_LIMIT)
    .map((listing, index) => {
      const tags = listing.tags.slice(0, 8).join(", ") || "none";
      const sellerNote = listing.sellerNote
        ? ` | note=${listing.sellerNote.slice(0, 120)}`
        : "";
      return [
        `${index + 1}. ${listing.title}`,
        `category=${listing.category ?? "unknown"}`,
        `condition=${listing.condition}`,
        `ask=$${(listing.askPriceMinor / 100).toFixed(0)}`,
        `floor=$${(listing.floorPriceMinor / 100).toFixed(0)}`,
        `market=$${(listing.marketMedianMinor / 100).toFixed(0)}`,
        `tags=${tags}${sellerNote}`,
      ].join(" | ");
    })
    .join("\n");
}

function hasAdvisorBuyerPreference(memory: AdvisorMemory): boolean {
  if (memory.mustHave.length > 0 || memory.avoid.length > 0) return true;
  if (hasGeneralNoPreference(memoryTextFromAdvisorMemory(memory))) return true;
  if (memory.riskStyle !== "balanced") return true;
  if (memory.negotiationStyle !== "balanced") return true;
  if (memory.openingTactic !== "fair_market_anchor") return true;

  const memoryText = [
    memory.categoryInterest,
    ...memory.source,
  ].join(" ").toLowerCase();

  return /가격|저렴|싼|최저|lowest|cheap|상태|안전|검증|빠른|speed/.test(memoryText);
}

function chooseNextAdvisorQuestions(
  candidatePlan: AdvisorCandidatePlan,
  requirementPlan: TagRequirementPlan,
  memory: AdvisorMemory,
): string[] {
  if (requirementPlan.blockingSlots.length > 0) {
    const firstBlockingQuestion = requirementPlan.blockingSlots[0]?.questionKo;
    if (firstBlockingQuestion && isScopedConditionConfirmationQuestion(firstBlockingQuestion)) {
      return [firstBlockingQuestion];
    }

    const questions = requirementPlan.blockingSlots
      .slice(0, ADVISOR_MAX_QUESTIONS_PER_TURN)
      .map((slot, index) => (
        index === 0 && candidatePlan.nextAction.question && candidateQuestionSatisfiesBlockingSlot(candidatePlan, slot)
          ? candidatePlan.nextAction.question
          : slot.questionKo
      ));
    return unique(questions);
  }

  if (
    candidatePlan.nextAction.slot === "buyer_priority"
    && hasGeneralNoPreference(memoryTextFromAdvisorMemory(memory))
  ) {
    return [];
  }
  if (candidatePlan.nextAction.question) return [candidatePlan.nextAction.question];
  if (
    candidatePlan.nextAction.action === "recommend"
    && requirementPlan.nextSlot
    && ["shopping_intent", "max_budget", "buyer_priority"].includes(requirementPlan.nextSlot.slotId)
  ) {
    return [];
  }
  return requirementPlan.question ? [requirementPlan.question] : [];
}

function isScopedConditionConfirmationQuestion(question: string): boolean {
  return question.startsWith("전에 ") && question.includes("그대로 적용");
}

function candidateQuestionSatisfiesBlockingSlot(
  candidatePlan: AdvisorCandidatePlan,
  blockingSlot: TagRequirementSlot,
): boolean {
  const candidateSlot = candidatePlan.nextAction.slot;
  if (blockingSlot.slotId === "max_budget") return candidateSlot === "budget";
  if (blockingSlot.slotId === "shopping_intent") {
    return ["search_intent", "product_type", "model_family"].includes(candidateSlot);
  }
  return candidateSlot === blockingSlot.slotId;
}

function applyRequirementGateToCandidatePlan(
  candidatePlan: AdvisorCandidatePlan,
  requirementPlan: TagRequirementPlan,
): AdvisorCandidatePlan {
  const blockingSlot = requirementPlan.blockingSlots[0];
  if (!blockingSlot || candidatePlan.nextAction.reasonCode !== "ready") return candidatePlan;

  return {
    ...candidatePlan,
    nextAction: {
      action: blockingSlot.slotId === "max_budget" ? "ask_budget" : "ask_preference",
      slot: mapRequirementSlotToAdvisorSlot(blockingSlot),
      reasonCode: blockingSlot.slotId === "max_budget" ? "budget_missing" : "preference_missing",
      question: blockingSlot.questionKo,
    },
  };
}

function mapRequirementSlotToAdvisorSlot(slot: TagRequirementSlot): AdvisorCandidatePlan["nextAction"]["slot"] {
  if (slot.slotId === "shopping_intent") return "search_intent";
  if (slot.slotId === "max_budget") return "budget";
  return "buyer_priority";
}

function buildAdvisorReplyAfterPlanning(input: {
  parsedReply: string;
  nextQuestions: string[];
  candidatePlan: AdvisorCandidatePlan;
  requirementPlan: TagRequirementPlan;
  latestMessage: string;
  previousMemory: AdvisorMemory;
  memory: AdvisorMemory;
  agentProfileName: string;
}): string {
  if (input.nextQuestions.length > 0) {
    return sanitizeAdvisorReply(
      mergeAdvisorQuestion(
        input.parsedReply,
        formatBundledAdvisorQuestions(input.nextQuestions),
        input.candidatePlan,
        input.requirementPlan,
      ),
    );
  }

  if (
    isNoPreferenceAnswer(input.latestMessage)
    && input.previousMemory.questions.length > 0
    && replyAsksQuestion(input.parsedReply)
  ) {
    return buildNoPreferenceAcknowledgement(input.memory, input.agentProfileName);
  }

  return sanitizeAdvisorReply(input.parsedReply);
}

function buildAdvisorTurnCost(usage: { prompt_tokens: number; completion_tokens: number }) {
  const prompt = usage.prompt_tokens;
  const completion = usage.completion_tokens;
  const total = prompt + completion;
  const estimatedUsd = (prompt * INPUT_TOKEN_USD) + (completion * OUTPUT_TOKEN_USD);

  return {
    model: process.env.XAI_MODEL ?? "grok-4-fast",
    tokens: {
      prompt,
      completion,
      total,
    },
    estimated_usd: Number(estimatedUsd.toFixed(8)),
    pricing: {
      prompt_usd_per_1m: INPUT_TOKEN_USD * 1_000_000,
      completion_usd_per_1m: OUTPUT_TOKEN_USD * 1_000_000,
    },
  };
}

function mergeAdvisorQuestion(
  reply: string,
  question: string,
  candidatePlan: AdvisorCandidatePlan,
  requirementPlan: TagRequirementPlan,
): string {
  const trimmedReply = reply.trim();
  if (!trimmedReply) return question;
  if (trimmedReply.includes(question)) return trimmedReply;
  if (requirementPlan.hasBlockingMissingSlots) {
    if (
      requirementPlan.nextSlot
      && replyAlreadyAsksForSlot(trimmedReply, requirementPlan.nextSlot)
      && getQuestionSentences(trimmedReply).length <= 1
    ) {
      return trimmedReply;
    }
    if (replyAlreadyAsksSimilarQuestion(trimmedReply, question)) {
      return trimmedReply;
    }
    const withoutConflictingQuestion = stripAdvisorQuestions(trimmedReply);
    const base = withoutConflictingQuestion || "좋아요, 그 기준으로 볼게요.";
    const needsSentenceBreakForBase = !/[.!?。！？]$/.test(base);
    return `${base}${needsSentenceBreakForBase ? "." : ""} ${question}`;
  }
  if (replyAlreadyAsksForAdvisorAction(trimmedReply, candidatePlan)) return trimmedReply;
  if (requirementPlan.nextSlot && replyAlreadyAsksForSlot(trimmedReply, requirementPlan.nextSlot)) return trimmedReply;

  const needsSentenceBreak = !/[.!?。！？]$/.test(trimmedReply);
  return `${trimmedReply}${needsSentenceBreak ? "." : ""} ${question}`;
}

function formatBundledAdvisorQuestions(questions: string[]): string {
  const uniqueQuestions = unique(questions).slice(0, ADVISOR_MAX_QUESTIONS_PER_TURN);
  if (uniqueQuestions.length === 0) return "";
  if (uniqueQuestions.length === 1) return uniqueQuestions[0]!;

  return `이 ${uniqueQuestions.length}가지만 한 번에 알려주세요: ${uniqueQuestions
    .map((question, index) => `${index + 1}) ${question}`)
    .join(" ")}`;
}

function stripAdvisorQuestions(reply: string): string {
  return reply
    .split(/(?<=[.!?。！？])\s+/)
    .filter((sentence) => !replyAsksQuestion(sentence))
    .join(" ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function getQuestionSentences(reply: string): string[] {
  return reply
    .split(/(?<=[.!?。！？])\s+/)
    .filter((sentence) => replyAsksQuestion(sentence));
}

function replyAlreadyAsksForAdvisorAction(reply: string, plan: AdvisorCandidatePlan): boolean {
  const questionWindows = getQuestionWindows(reply);
  if (questionWindows.length === 0) return false;

  const termsBySlot: Record<string, string[]> = {
    search_intent: ["제품", "브랜드", "구체", "찾"],
    product_type: ["본체", "액세서리", "종류"],
    model_family: ["모델", "트림", "세대"],
    price_band: ["가격대", "가격", "범위"],
    condition: ["상태", "컨디션"],
    budget: ["예산", "가격선", "가격", "범위"],
    buyer_priority: ["우선", "가격", "상태", "안전"],
  };
  const terms = termsBySlot[plan.nextAction.slot] ?? [];

  return questionWindows.some((window) => {
    const normalized = normalizeForQuestionMatch(window);
    return terms.some((term) => normalized.includes(normalizeForQuestionMatch(term)));
  });
}

function formatCandidatePlanForPrompt(plan: AdvisorCandidatePlan): string {
  return [
    `candidate_count: ${plan.candidateCount}`,
    `dominant_cluster: ${plan.dominantCluster ? `${plan.dominantCluster.label} (${plan.dominantCluster.count}, share ${plan.dominantCluster.share})` : "none"}`,
    `next_action: ${plan.nextAction.action} | slot=${plan.nextAction.slot} | reason=${plan.nextAction.reasonCode} | question="${plan.nextAction.question ?? "none"}"`,
    "facets:",
    ...plan.facets.map((facet) => (
      `- ${facet.slot} | entropy=${facet.entropy} | values=${facet.values.map((value) => `${value.label}:${value.count}`).join(", ")}`
    )),
  ].join("\n");
}

function replyAlreadyAsksForSlot(reply: string, slot: TagRequirementSlot): boolean {
  const questionWindows = getQuestionWindows(reply);
  if (questionWindows.length === 0) return false;

  const slotTerms = getRequirementSlotTerms(slot);
  return questionWindows.some((window) => {
    const normalizedWindow = normalizeForQuestionMatch(window);
    return slotTerms.some((term) => normalizedWindow.includes(term));
  });
}

function replyAlreadyAsksSimilarQuestion(reply: string, question: string): boolean {
  const questionWindows = getQuestionWindows(reply);
  if (questionWindows.length === 0) return false;

  const targetTokens = getQuestionMatchTokens(question);
  if (targetTokens.length === 0) return false;

  return questionWindows.some((window) => {
    const windowTokens = new Set(getQuestionMatchTokens(window));
    const overlap = targetTokens.filter((token) => windowTokens.has(token));
    return overlap.length >= Math.min(2, targetTokens.length);
  });
}

function getQuestionMatchTokens(value: string): string[] {
  const normalized = value
    .toLowerCase()
    .replace(/[%?？.!。！,，]/g, " ")
    .replace(/[_\-/]+/g, " ");
  return Array.from(new Set(
    (normalized.match(/[a-z0-9]+|[가-힣]+/g) ?? [])
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
      .filter((token) => !["인가요", "까요", "나요", "어요", "해요", "있나요", "어느", "정도"].includes(token)),
  ));
}

function getQuestionWindows(reply: string): string[] {
  const windows: string[] = [];
  const questionMarkPattern = /[?？]/g;
  let match: RegExpExecArray | null;

  while ((match = questionMarkPattern.exec(reply)) !== null) {
    const index = match.index;
    windows.push(reply.slice(Math.max(0, index - 120), Math.min(reply.length, index + 120)));
  }

  for (const sentence of reply.split(/(?<=[.!?。！？])\s+/)) {
    if (/(?:나요|세요|까요|인가요|일까요|뭐예요|뭐에요|주시겠어요|알려주)/.test(sentence)) {
      windows.push(sentence);
    }
  }

  return windows;
}

function getRequirementSlotTerms(slot: TagRequirementSlot): string[] {
  const slotSpecificTerms: Record<string, string[]> = {
    shopping_intent: ["제품", "상품", "찾", "원하", "필요", "상황", "product", "intent"],
    max_budget: ["예산", "최대", "가격대", "얼마", "budget", "maxbudget"],
    buyer_priority: ["용도", "조건", "선호", "필수", "꼭필요", "우선", "피하고", "중요", "priority", "musthave"],
    battery_health: ["배터리", "성능", "퍼센트", "%", "battery", "batteryhealth"],
    carrier_lock: ["언락", "잠금", "통신사", "unlocked", "locked", "carrier", "carrierlock", "factoryunlocked"],
    imei_verification: ["imei", "serial", "시리얼", "블랙리스트", "깨끗", "cleanimei"],
    find_my_status: ["findmy", "나의찾기", "아이클라우드", "icloud", "activationlock"],
  };
  const terms = [
    slot.slotId,
    slot.label,
    slot.questionKo,
    ...slot.aliases,
    ...(slotSpecificTerms[slot.slotId] ?? []),
  ];

  return Array.from(new Set(terms.map(normalizeForQuestionMatch).filter(Boolean)));
}

function normalizeForQuestionMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s"'`.,:;()[\]{}_\-/]+/g, "");
}

function sanitizeAdvisorReply(reply: string): string {
  return reply
    .replace(/(?:Tag Garden|태그 가든|requirement slots?|context engineering)[^.!?。！？]*(?:[.!?。！？]|$)/gi, "")
    .replace(/(^|[\s.!?。！？])됐고[,\s—-]*/g, "$1")
    .replace(/^음,\s*/, "Okay, ")
    .replace(/(^|[\s.,!?。！？])잠깐(?=[\s,.!?。！？]|$)/g, "$1Wait")
    .replace(/(^|[\s.,!?。！？])대박(?=[\s,.!?。！？]|$)/g, "$1whoa")
    .replace(/(^|[\s.,!?。！？])아이고(?=[\s,.!?。！？]|$)/g, "$1oof")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function applyNoPreferenceAnswer(
  memory: AdvisorMemory,
  latestMessage: string,
  previousMemory: AdvisorMemory,
): AdvisorMemory {
  if (!isNoPreferenceAnswer(latestMessage) || previousMemory.questions.length === 0) return memory;

  const previousQuestionText = previousMemory.questions.join(" ");
  const facts = noPreferenceFactsForQuestion(previousQuestionText);
  if (facts.length === 0) return memory;

  return {
    ...memory,
    source: unique([...memory.source, ...facts]),
  };
}

function applyPendingSlotAnswerScope(
  memory: AdvisorMemory,
  latestMessage: string,
  previousMemory: AdvisorMemory,
): AdvisorMemory {
  const pendingSlot = previousMemory.structured?.pendingSlots
    .slice()
    .reverse()
    .find((slot) => slot.productScope && slot.enforcement === "hard");
  if (!pendingSlot?.productScope) return memory;

  if (pendingSlot.slotId === "battery_health") {
    const threshold = extractBatteryThresholdLabel(latestMessage.toLowerCase())
      ?? extractPlainBatteryThresholdFromAnswer(latestMessage, previousMemory);
    if (threshold) {
      const fact = `battery >= ${threshold}`;
      return {
        ...memory,
        mustHave: unique([...memory.mustHave, fact]),
        source: unique([...memory.source, `${pendingSlot.productScope} ${fact}`]),
      };
    }
    if (isNoPreferenceAnswer(latestMessage)) {
      return {
        ...memory,
        source: unique([...memory.source, `${pendingSlot.productScope} battery no preference`]),
      };
    }
  }

  if (pendingSlot.slotId === "carrier_lock") {
    const facts = normalizeStructuredFacts(latestMessage)
      .filter((fact) => structuredSlotsForFacts([fact]).includes("carrier_lock"));
    if (facts.length > 0) {
      return {
        ...memory,
        source: unique([...memory.source, ...facts.map((fact) => `${pendingSlot.productScope} ${fact}`)]),
      };
    }
    if (isNoPreferenceAnswer(latestMessage)) {
      return {
        ...memory,
        source: unique([...memory.source, `${pendingSlot.productScope} carrier no preference`]),
      };
    }
  }

  return memory;
}

function shouldKeepAdvisorSource(source: string, previousMemory: AdvisorMemory): boolean {
  const text = source.trim();
  if (!text) return false;
  if (isSecurityAttackInput(text)) return false;
  if (isNoPreferenceAnswer(text) && previousMemory.questions.length > 0) return true;
  if (isApplyScopedConditionAnswer(text) && previousMemory.questions.length > 0) return false;

  return /(?:iphone|아이폰|ipad|아이패드|macbook|맥북|laptop|노트북|tesla|테슬라|model\s*\d|모델\s*\d|pro\b|budget|예산|target|price|가격|\$\s*\d|\d+\s*(?:usd|dollars?|달러|불)|battery|배터리|성능|unlocked|locked|carrier|언락|잠금|통신사|imei|find\s*my|icloud|아이클라우드|condition|상태|screen|화면|box|박스|damage|wear|active intent|interest|expanded|narrowed|required|preference|confirmed|applied|budget change|search)/i.test(text);
}

function sanitizeAdvisorMemoryFacts(memory: AdvisorMemory, previousMemory: AdvisorMemory): AdvisorMemory {
  return {
    ...memory,
    mustHave: unique(memory.mustHave.filter((fact) => shouldKeepAdvisorFact(fact, previousMemory))),
    avoid: unique(memory.avoid.filter((fact) => shouldKeepAdvisorFact(fact, previousMemory))),
  };
}

function pruneSupersededAdvisorSources(
  sources: string[],
  memoryConflicts: NonNullable<AdvisorMemory["structured"]>["memoryConflicts"],
): string[] {
  const superseded = memoryConflicts.filter((conflict) => (
    conflict.status === "superseded"
    && Boolean(conflict.productScope)
    && Boolean(conflict.previousValue)
    && shouldPruneSupersededConflict(conflict, memoryConflicts)
  ));
  if (superseded.length === 0) return sources;

  return sources.filter((source) => !superseded.some((conflict) => (
    sourceContainsStructuredFact(source, conflict.productScope!, conflict.previousValue!)
  )));
}

function sourceContainsStructuredFact(source: string, productScope: string, fact: string): boolean {
  return (
    extractStructuredProductScopes(source).includes(productScope)
    && normalizeStructuredFacts(source).includes(fact)
  );
}

function pruneSupersededPromotionDecisions(
  decisions: NonNullable<AdvisorMemory["structured"]>["promotionDecisions"],
  memoryConflicts: NonNullable<AdvisorMemory["structured"]>["memoryConflicts"],
): NonNullable<AdvisorMemory["structured"]>["promotionDecisions"] {
  const superseded = memoryConflicts.filter((conflict) => (
    conflict.status === "superseded"
    && Boolean(conflict.productScope)
    && Boolean(conflict.previousValue)
    && shouldPruneSupersededConflict(conflict, memoryConflicts)
  ));
  if (superseded.length === 0) return decisions;

  return decisions.filter((decision) => !superseded.some((conflict) => (
    decision.decision === "promote"
    && decision.productScope === conflict.productScope
    && decision.text === conflict.previousValue
  )));
}

function shouldPruneSupersededConflict(
  conflict: NonNullable<AdvisorMemory["structured"]>["memoryConflicts"][number],
  memoryConflicts: NonNullable<AdvisorMemory["structured"]>["memoryConflicts"],
): boolean {
  if (!conflict.productScope || !conflict.previousValue) return false;
  const latestCurrent = memoryConflicts
    .slice()
    .reverse()
    .find((candidate) => (
      candidate.status === "current"
      && candidate.slotId === conflict.slotId
      && candidate.productScope === conflict.productScope
      && Boolean(candidate.currentValue)
    ));

  return latestCurrent?.currentValue !== conflict.previousValue;
}

function shouldKeepAdvisorFact(fact: string, previousMemory: AdvisorMemory): boolean {
  const text = fact.trim();
  if (!text || isSecurityAttackInput(text)) return false;
  if (text.length < 2) return false;
  if (shouldKeepAdvisorSource(text, previousMemory)) return true;

  return /(?:battery|배터리|성능|unlocked|locked|carrier|언락|잠금|통신사|imei|find\s*my|icloud|아이클라우드|screen|화면|box|박스|damage|wear|crack|scratch|pro model|clean|original)/i.test(text);
}

function buildStructuredAdvisorMemory(input: {
  memory: AdvisorMemory;
  previousMemory: AdvisorMemory;
  latestMessage: string;
  requirementPlan: TagRequirementPlan;
}): NonNullable<AdvisorMemory["structured"]> {
  const previousStructured = input.previousMemory.structured;
  let productRequirements: NonNullable<AdvisorMemory["structured"]>["productRequirements"] = {
    ...(previousStructured?.productRequirements ?? {}),
  };

  const activeIntent = resolveStructuredActiveIntent(input.memory, input.latestMessage);
  const activeScope = activeIntent.productScope;
  if (activeScope && !productRequirements[activeScope]) {
    productRequirements[activeScope] = {
      mustHave: [],
      avoid: [],
      answeredSlots: [],
      ambiguousSlots: [],
    };
  }

  for (const source of input.memory.source) {
    const scopes = extractStructuredProductScopes(source);
    const scopedFacts = normalizeStructuredFacts(source);
    if (scopes.length === 0 || scopedFacts.length === 0) continue;

    for (const scope of scopes) {
      const current = productRequirements[scope] ?? {
        mustHave: [],
        avoid: [],
        answeredSlots: [],
        ambiguousSlots: [],
      };
      productRequirements[scope] = {
        ...current,
        mustHave: unique([...current.mustHave, ...scopedFacts]),
        answeredSlots: unique([...current.answeredSlots, ...structuredSlotsForFacts(scopedFacts)]),
      };
    }
  }

  if (activeScope && productRequirements[activeScope]) {
    productRequirements[activeScope] = {
      ...productRequirements[activeScope],
      mustHave: unique([...productRequirements[activeScope].mustHave, ...input.memory.mustHave]),
      avoid: unique([...productRequirements[activeScope].avoid, ...input.memory.avoid]),
      answeredSlots: unique([
        ...productRequirements[activeScope].answeredSlots,
        ...structuredSlotsForFacts(input.memory.mustHave),
        ...structuredSlotsForFacts(input.memory.avoid),
      ]),
    };
  }

  if (activeScope && isAmbiguousAnswer(input.latestMessage) && input.previousMemory.questions.length > 0) {
    const current = productRequirements[activeScope] ?? {
      mustHave: [],
      avoid: [],
      answeredSlots: [],
      ambiguousSlots: [],
    };
    productRequirements[activeScope] = {
      ...current,
      ambiguousSlots: unique([...current.ambiguousSlots, ...pendingQuestionKinds(input.previousMemory.questions.join(" "))]),
    };
  }

  const conflictResult = applyStructuredConflictHandling({
    productRequirements,
    previousMemory: input.previousMemory,
    latestMessage: input.latestMessage,
    activeScope,
  });
  productRequirements = conflictResult.productRequirements;
  const discardedSignals = buildStructuredDiscardedSignals(input);
  const lifecycle = buildStructuredMemoryLifecycle({
    memory: input.memory,
    latestMessage: input.latestMessage,
    previousMemory: input.previousMemory,
    requirementPlan: input.requirementPlan,
    activeScope,
    productRequirements,
    discardedSignals,
    memoryConflicts: conflictResult.memoryConflicts,
  });

  return {
    activeIntent,
    productRequirements,
    globalPreferences: {
      mustHave: input.memory.mustHave,
      avoid: input.memory.avoid,
      budgetMax: input.memory.budgetMax,
      targetPrice: input.memory.targetPrice,
      riskStyle: input.memory.riskStyle,
      negotiationStyle: input.memory.negotiationStyle,
      openingTactic: input.memory.openingTactic,
    },
    pendingSlots: input.requirementPlan.missingSlots.map((slot) => ({
      slotId: slot.slotId,
      question: slot.questionKo,
      enforcement: slot.enforcement,
      productScope: activeScope,
      status: isAmbiguousAnswer(input.latestMessage) && input.previousMemory.questions.includes(slot.questionKo)
        ? "ambiguous"
        : "pending",
    })),
    discardedSignals,
    memoryConflicts: conflictResult.memoryConflicts,
    scopedConditionDecisions: uniqueScopedConditionDecisions([
      ...(previousStructured?.scopedConditionDecisions ?? []),
      ...(input.memory.structured?.scopedConditionDecisions ?? []),
    ]),
    sessionMemory: lifecycle.sessionMemory,
    longTermMemory: lifecycle.longTermMemory,
    promotionDecisions: lifecycle.promotionDecisions,
    compression: lifecycle.compression,
  };
}

function buildStructuredMemoryLifecycle(input: {
  memory: AdvisorMemory;
  previousMemory: AdvisorMemory;
  latestMessage: string;
  requirementPlan: TagRequirementPlan;
  activeScope?: string;
  productRequirements: NonNullable<AdvisorMemory["structured"]>["productRequirements"];
  discardedSignals: NonNullable<AdvisorMemory["structured"]>["discardedSignals"];
  memoryConflicts: NonNullable<AdvisorMemory["structured"]>["memoryConflicts"];
}): Pick<
  NonNullable<AdvisorMemory["structured"]>,
  "sessionMemory" | "longTermMemory" | "promotionDecisions" | "compression"
> {
  const previousStructured = input.previousMemory.structured;
  const previousLongTerm = previousStructured?.longTermMemory;
  const previousSession = previousStructured?.sessionMemory;
  let promotionDecisions: NonNullable<AdvisorMemory["structured"]>["promotionDecisions"] = [
    ...(previousStructured?.promotionDecisions ?? []),
  ];
  const longTermFacts = new Set(previousLongTerm?.facts ?? []);
  const globalFacts = new Set(previousLongTerm?.globalFacts ?? []);
  const productScopes = new Set(previousLongTerm?.productScopes ?? []);
  const sessionFacts = new Set(previousSession?.facts ?? []);

  for (const conflict of input.memoryConflicts) {
    if (
      conflict.status !== "superseded"
      || !conflict.productScope
      || !conflict.previousValue
      || !shouldPruneSupersededConflict(conflict, input.memoryConflicts)
    ) {
      continue;
    }
    longTermFacts.delete(`${conflict.productScope}: ${conflict.previousValue}`);
  }
  promotionDecisions = pruneSupersededPromotionDecisions(promotionDecisions, input.memoryConflicts);

  const addDecision = (
    text: string,
    decision: "promote" | "session_only" | "discard",
    reason: NonNullable<AdvisorMemory["structured"]>["promotionDecisions"][number]["reason"],
    target: "long_term" | "session" | "none",
    productScope?: string,
  ) => {
    promotionDecisions.push({
      text,
      decision,
      reason,
      target,
      ...(productScope ? { productScope } : {}),
    });
  };

  for (const [scope, requirements] of Object.entries(input.productRequirements)) {
    const facts = unique([...requirements.mustHave, ...requirements.avoid]);
    if (facts.length === 0) continue;
    productScopes.add(scope);
    for (const fact of facts) {
      const scopedFact = `${scope}: ${fact}`;
      longTermFacts.add(scopedFact);
      addDecision(fact, "promote", "confirmed_product_requirement", "long_term", scope);
    }
  }

  if (input.memory.budgetMax) {
    const fact = `budgetMax: ${input.memory.budgetMax}`;
    longTermFacts.add(fact);
    globalFacts.add(fact);
    addDecision(fact, "promote", "explicit_budget", "long_term");
  }
  if (input.memory.targetPrice) {
    const fact = `targetPrice: ${input.memory.targetPrice}`;
    longTermFacts.add(fact);
    globalFacts.add(fact);
    addDecision(fact, "promote", "explicit_budget", "long_term");
  }
  if (input.memory.riskStyle !== "balanced") {
    const fact = `riskStyle: ${input.memory.riskStyle}`;
    longTermFacts.add(fact);
    globalFacts.add(fact);
    addDecision(fact, "promote", "stable_global_preference", "long_term");
  }
  if (input.memory.negotiationStyle !== "balanced") {
    const fact = `negotiationStyle: ${input.memory.negotiationStyle}`;
    longTermFacts.add(fact);
    globalFacts.add(fact);
    addDecision(fact, "promote", "stable_global_preference", "long_term");
  }
  if (input.memory.openingTactic !== "fair_market_anchor") {
    const fact = `openingTactic: ${input.memory.openingTactic}`;
    longTermFacts.add(fact);
    globalFacts.add(fact);
    addDecision(fact, "promote", "stable_global_preference", "long_term");
  }

  for (const slot of input.requirementPlan.missingSlots) {
    if (slot.enforcement === "hard") {
      const pending = `${slot.slotId}: ${slot.questionKo}`;
      sessionFacts.add(pending);
      addDecision(pending, "session_only", "pending_hard_slot", "session", input.activeScope);
    }
  }

  const latestDiscard = input.discardedSignals.at(-1);
  if (latestDiscard?.text === input.latestMessage) {
    const reason = latestDiscard.reason === "security"
      ? "security"
      : latestDiscard.reason === "ambiguous"
        ? "ambiguous"
        : latestDiscard.reason === "off_topic"
          ? "off_topic"
          : "low_information";
    addDecision(input.latestMessage, "discard", reason, "none", input.activeScope);
  } else if (!shouldKeepAdvisorSource(input.latestMessage, input.previousMemory)) {
    addDecision(input.latestMessage, "discard", "low_information", "none", input.activeScope);
  }

  const prunedSessionFacts = pruneSupersededAdvisorSources(Array.from(sessionFacts), input.memoryConflicts);
  const recentWindowFacts = unique(pruneSupersededAdvisorSources(input.memory.source.slice(-6), input.memoryConflicts));
  const carriedForwardFacts = unique([
    ...Array.from(longTermFacts),
    ...prunedSessionFacts,
  ]).slice(-12);
  const droppedSignals = input.discardedSignals
    .slice(-6)
    .map((signal) => `${signal.reason}: ${signal.text}`);
  const pendingQuestions = unique(input.requirementPlan.missingSlots.map((slot) => slot.questionKo));
  const summaryParts = [
    input.activeScope ? `active=${input.activeScope}` : "active=unscoped",
    `longTerm=${longTermFacts.size}`,
    `session=${sessionFacts.size}`,
    pendingQuestions.length > 0 ? `pending=${pendingQuestions.length}` : "pending=0",
    droppedSignals.length > 0 ? `dropped=${droppedSignals.length}` : "dropped=0",
  ];

  return {
    sessionMemory: {
      facts: prunedSessionFacts.slice(-12),
      pendingQuestions,
      reason: "facts that guide this advisor session but are not durable buyer preferences yet",
    },
    longTermMemory: {
      facts: Array.from(longTermFacts).slice(-20),
      productScopes: Array.from(productScopes).slice(-8),
      globalFacts: Array.from(globalFacts).slice(-12),
    },
    promotionDecisions: promotionDecisions.slice(-24),
    compression: {
      recentWindowFacts,
      carriedForwardFacts,
      droppedSignals,
      summary: summaryParts.join(" | "),
    },
  };
}

function chooseConflictResolutionQuestion(
  structured: AdvisorMemory["structured"] | undefined,
): string | null {
  const conflict = structured?.memoryConflicts
    .slice()
    .reverse()
    .find((item) => item.status === "needs_confirmation" && item.resolutionQuestion);
  return conflict?.resolutionQuestion ?? null;
}

function buildStructuredQuestionPlan(input: {
  nextQuestions: string[];
  requirementPlan: TagRequirementPlan;
  structured: NonNullable<AdvisorMemory["structured"]>;
}): NonNullable<AdvisorMemory["structured"]>["questionPlan"] {
  const combinedQuestion = formatBundledAdvisorQuestions(input.nextQuestions);
  const nextQuestionSet = new Set(input.nextQuestions);
  const conflict = input.structured.memoryConflicts
    .slice()
    .reverse()
    .find((item) => item.status === "needs_confirmation" && item.resolutionQuestion && nextQuestionSet.has(item.resolutionQuestion));
  const askedSlots = input.requirementPlan.missingSlots.filter((slot) => (
    nextQuestionSet.has(slot.questionKo)
    || input.nextQuestions.some((question) => questionTextMatchesRequirementSlot(question, slot))
  ));
  const askedSlot = askedSlots[0];
  const askedSlotIds = new Set(askedSlots.map((slot) => slot.slotId));
  const fallbackAskedSlot = input.requirementPlan.missingSlots.find((slot) => slot.questionKo === combinedQuestion)
    ?? input.requirementPlan.missingSlots.find((slot) => (
      combinedQuestion ? questionTextMatchesRequirementSlot(combinedQuestion, slot) : false
    ));
  const primaryAskedSlot = askedSlot ?? fallbackAskedSlot;
  const askedKind = conflict
    ? "conflict"
    : primaryAskedSlot
      ? primaryAskedSlot.enforcement === "hard" ? "hard_slot" : "soft_slot"
      : input.nextQuestions.length > 0
        ? "candidate"
        : "none";
  const maxQuestionsPerTurn = conflict ? 1 : ADVISOR_MAX_QUESTIONS_PER_TURN;
  const deferred = input.requirementPlan.missingSlots
    .filter((slot) => !nextQuestionSet.has(slot.questionKo) && !askedSlotIds.has(slot.slotId))
    .map((slot) => ({
      slotId: slot.slotId,
      question: slot.questionKo,
      enforcement: slot.enforcement,
      reason: questionDeferReason({
        slot,
        conflictActive: Boolean(conflict),
        askedSlot: primaryAskedSlot,
        nextQuestion: combinedQuestion || null,
        blockingSlots: input.requirementPlan.blockingSlots,
      }),
      productScope: input.structured.activeIntent?.productScope,
    }));

  return {
    policy: {
      maxQuestionsPerTurn,
      order: ["conflict_resolution", "hard_slot", "candidate_narrowing", "soft_slot"],
      rationale: "Resolve contradictions first, then bundle blocking hard slots when they can be answered together, then candidate narrowing, and defer lower-priority soft preferences.",
    },
    budget: {
      maxQuestionsPerTurn,
      used: input.nextQuestions.length,
    },
    askedThisTurn: {
      kind: askedKind,
      ...(combinedQuestion ? { question: combinedQuestion } : {}),
      ...(conflict?.slotId || primaryAskedSlot?.slotId ? { slotId: conflict?.slotId ?? primaryAskedSlot?.slotId } : {}),
      ...(conflict?.productScope || input.structured.activeIntent?.productScope
        ? { productScope: conflict?.productScope ?? input.structured.activeIntent?.productScope }
        : {}),
    },
    deferred,
  };
}

function questionTextMatchesRequirementSlot(question: string, slot: TagRequirementSlot): boolean {
  const normalizedQuestion = normalizeForQuestionMatch(question);
  return getRequirementSlotTerms(slot).some((term) => normalizedQuestion.includes(term));
}

function questionDeferReason(input: {
  slot: TagRequirementSlot;
  conflictActive: boolean;
  askedSlot: TagRequirementSlot | undefined;
  nextQuestion: string | null;
  blockingSlots: TagRequirementSlot[];
}): NonNullable<NonNullable<AdvisorMemory["structured"]>["questionPlan"]>["deferred"][number]["reason"] {
  if (input.conflictActive) return "conflict_resolution_first";
  if (
    input.slot.enforcement === "soft"
    && (
      input.askedSlot?.enforcement === "hard"
      || input.blockingSlots.some((slot) => slot.slotId !== input.askedSlot?.slotId)
    )
  ) {
    return "lower_priority";
  }
  if (input.nextQuestion) return "question_budget";
  return "lower_priority";
}

function applyStructuredConflictHandling(input: {
  productRequirements: NonNullable<AdvisorMemory["structured"]>["productRequirements"];
  previousMemory: AdvisorMemory;
  latestMessage: string;
  activeScope?: string;
}): {
  productRequirements: NonNullable<AdvisorMemory["structured"]>["productRequirements"];
  memoryConflicts: NonNullable<AdvisorMemory["structured"]>["memoryConflicts"];
} {
  const memoryConflicts = [...(input.previousMemory.structured?.memoryConflicts ?? [])];
  if (!input.activeScope) {
    return { productRequirements: input.productRequirements, memoryConflicts: memoryConflicts.slice(-16) };
  }

  const current = input.productRequirements[input.activeScope];
  if (!current) {
    return { productRequirements: input.productRequirements, memoryConflicts: memoryConflicts.slice(-16) };
  }

  let nextCurrent = { ...current };
  const pendingConflict = findPendingMemoryConflict(input.previousMemory, input.activeScope);
  if (pendingConflict?.currentValue && pendingConflict.previousValue) {
    const withoutPending = memoryConflicts.filter((conflict) => !sameMemoryConflict(conflict, pendingConflict));
    if (isConfirmConflictAnswer(input.latestMessage)) {
      nextCurrent = addCurrentSlotFact(removeSlotFacts(nextCurrent, pendingConflict.slotId), {
        slotId: pendingConflict.slotId,
        fact: pendingConflict.currentValue,
        list: "mustHave",
      });
      withoutPending.push(
        {
          slotId: pendingConflict.slotId,
          productScope: input.activeScope,
          previousValue: pendingConflict.previousValue,
          currentValue: pendingConflict.currentValue,
          status: "superseded",
          reason: "user confirmed tentative change",
        },
        {
          slotId: pendingConflict.slotId,
          productScope: input.activeScope,
          currentValue: pendingConflict.currentValue,
          status: "current",
          reason: "user confirmed tentative change",
        },
      );
      return {
        productRequirements: {
          ...input.productRequirements,
          [input.activeScope]: nextCurrent,
        },
        memoryConflicts: withoutPending.slice(-16),
      };
    }
    if (isRejectConflictAnswer(input.latestMessage)) {
      nextCurrent = addCurrentSlotFact(removeSlotFacts(nextCurrent, pendingConflict.slotId), {
        slotId: pendingConflict.slotId,
        fact: pendingConflict.previousValue,
        list: "mustHave",
      });
      withoutPending.push({
        slotId: pendingConflict.slotId,
        productScope: input.activeScope,
        currentValue: pendingConflict.previousValue,
        status: "current",
        reason: "user rejected tentative change",
      });
      return {
        productRequirements: {
          ...input.productRequirements,
          [input.activeScope]: nextCurrent,
        },
        memoryConflicts: withoutPending.slice(-16),
      };
    }
  }

  for (const update of detectLatestSlotFacts(input.latestMessage, input.previousMemory)) {
    const previousValue = findSlotFact(nextCurrent, update.slotId);
    if (!previousValue || previousValue === update.fact) continue;

    if (update.needsConfirmation) {
      nextCurrent = removeSlotFact(nextCurrent, update.slotId, update.fact);
      memoryConflicts.push({
        slotId: update.slotId,
        productScope: input.activeScope,
        previousValue,
        currentValue: update.fact,
        status: "needs_confirmation",
        resolutionQuestion: buildConflictResolutionQuestion(input.activeScope, update.slotId, previousValue, update.fact),
        reason: "latest answer was tentative",
      });
      continue;
    }

    nextCurrent = addCurrentSlotFact(removeSlotFacts(nextCurrent, update.slotId), update);
    memoryConflicts.push(
      {
        slotId: update.slotId,
        productScope: input.activeScope,
        previousValue,
        currentValue: update.fact,
        status: "superseded",
        reason: "latest explicit user message changed the requirement",
      },
      {
        slotId: update.slotId,
        productScope: input.activeScope,
        currentValue: update.fact,
        status: "current",
        reason: "latest explicit user message",
      },
    );
  }

  return {
    productRequirements: {
      ...input.productRequirements,
      [input.activeScope]: nextCurrent,
    },
    memoryConflicts: memoryConflicts.slice(-16),
  };
}

function findPendingMemoryConflict(
  memory: AdvisorMemory,
  activeScope?: string,
): NonNullable<AdvisorMemory["structured"]>["memoryConflicts"][number] | null {
  return memory.structured?.memoryConflicts
    .slice()
    .reverse()
    .find((conflict) => (
      conflict.status === "needs_confirmation"
      && (!activeScope || conflict.productScope === activeScope)
      && Boolean(conflict.previousValue)
      && Boolean(conflict.currentValue)
    )) ?? null;
}

function sameMemoryConflict(
  left: NonNullable<AdvisorMemory["structured"]>["memoryConflicts"][number],
  right: NonNullable<AdvisorMemory["structured"]>["memoryConflicts"][number],
): boolean {
  return (
    left.status === right.status
    && left.slotId === right.slotId
    && left.productScope === right.productScope
    && left.previousValue === right.previousValue
    && left.currentValue === right.currentValue
  );
}

function detectLatestSlotFacts(
  latestMessage: string,
  previousMemory: AdvisorMemory,
): Array<{ slotId: string; fact: string; list: "mustHave" | "avoid"; needsConfirmation: boolean }> {
  const facts: Array<{ slotId: string; fact: string; list: "mustHave" | "avoid"; needsConfirmation: boolean }> = [];
  const pushFact = (slotId: string, fact: string) => {
    facts.push({
      slotId,
      fact,
      list: "mustHave",
      needsConfirmation: isTentativeRequirementChange(latestMessage),
    });
  };
  const battery = extractBatteryThresholdLabel(latestMessage.toLowerCase())
    ?? extractPlainBatteryThresholdFromAnswer(latestMessage, previousMemory);
  if (battery) {
    pushFact("battery_health", `battery >= ${battery}`);
  }

  if (isNoPreferenceAnswer(latestMessage)) {
    const pendingKinds = pendingQuestionKinds(previousMemory.questions.join(" "));
    if (pendingKinds.includes("battery")) pushFact("battery_health", "battery no preference");
    if (pendingKinds.includes("carrier")) pushFact("carrier_lock", "carrier no preference");
  }

  for (const fact of normalizeStructuredFacts(latestMessage)) {
    if (facts.some((existing) => existing.fact === fact)) continue;
    if (/battery/.test(fact) && battery) continue;
    for (const slotId of structuredSlotsForFacts([fact])) {
      pushFact(slotId, fact);
    }
  }

  return facts;
}

function extractPlainBatteryThresholdFromAnswer(
  latestMessage: string,
  previousMemory: AdvisorMemory,
): string | null {
  if (!pendingQuestionKinds(previousMemory.questions.join(" ")).includes("battery")) return null;
  const match = latestMessage.match(/\b([7-9][0-9]|100)\s*%?\b/);
  if (!match?.[1]) return null;
  return `${match[1]}%`;
}

function isTentativeRequirementChange(message: string): boolean {
  return /(?:괜찮을까|될까|어때|어떨까|가능할까|봐도\s*돼|maybe|not\s*sure|unsure|could|would|should|상황(?:에)?\s*따라|그때\s*봐서)/i.test(message);
}

function findSlotFact(
  requirements: NonNullable<AdvisorMemory["structured"]>["productRequirements"][string],
  slotId: string,
): string | null {
  const allFacts = [...requirements.mustHave, ...requirements.avoid];
  return allFacts.find((fact) => structuredSlotsForFacts([fact]).includes(slotId)) ?? null;
}

function removeSlotFacts(
  requirements: NonNullable<AdvisorMemory["structured"]>["productRequirements"][string],
  slotId: string,
): NonNullable<AdvisorMemory["structured"]>["productRequirements"][string] {
  return {
    ...requirements,
    mustHave: requirements.mustHave.filter((fact) => !structuredSlotsForFacts([fact]).includes(slotId)),
    avoid: requirements.avoid.filter((fact) => !structuredSlotsForFacts([fact]).includes(slotId)),
  };
}

function removeSlotFact(
  requirements: NonNullable<AdvisorMemory["structured"]>["productRequirements"][string],
  slotId: string,
  factToRemove: string,
): NonNullable<AdvisorMemory["structured"]>["productRequirements"][string] {
  return {
    ...requirements,
    mustHave: requirements.mustHave.filter((fact) => fact !== factToRemove || !structuredSlotsForFacts([fact]).includes(slotId)),
    avoid: requirements.avoid.filter((fact) => fact !== factToRemove || !structuredSlotsForFacts([fact]).includes(slotId)),
  };
}

function addCurrentSlotFact(
  requirements: NonNullable<AdvisorMemory["structured"]>["productRequirements"][string],
  update: { slotId: string; fact: string; list: "mustHave" | "avoid" },
): NonNullable<AdvisorMemory["structured"]>["productRequirements"][string] {
  return {
    ...requirements,
    mustHave: update.list === "mustHave" ? unique([...requirements.mustHave, update.fact]) : requirements.mustHave,
    avoid: update.list === "avoid" ? unique([...requirements.avoid, update.fact]) : requirements.avoid,
    answeredSlots: unique([...requirements.answeredSlots, update.slotId]),
  };
}

function buildConflictResolutionQuestion(
  productScope: string,
  slotId: string,
  previousValue: string,
  currentValue: string,
): string {
  const label = slotId === "battery_health"
    ? "배터리 기준"
    : slotId === "carrier_lock"
      ? "언락/통신사 기준"
      : "조건";
  return `${productScope}의 ${label}을 "${previousValue}"에서 "${currentValue}"로 바꿀까요?`;
}

function resolveStructuredActiveIntent(
  memory: AdvisorMemory,
  latestMessage: string,
): { productScope?: string; source?: string } {
  const latestScopes = extractStructuredProductScopes(latestMessage);
  if (latestScopes.length > 0) return { productScope: latestScopes[latestScopes.length - 1], source: latestMessage };

  for (const source of [...memory.source].reverse()) {
    const scopes = extractStructuredProductScopes(source);
    if (scopes.length > 0) return { productScope: scopes[scopes.length - 1], source };
  }

  const latestScopeDecision = memory.structured?.scopedConditionDecisions.at(-1);
  if (latestScopeDecision) {
    return {
      productScope: latestScopeDecision.targetScope,
      source: `${latestScopeDecision.decision} ${latestScopeDecision.slotId} scope decision`,
    };
  }

  const categoryScopes = extractStructuredProductScopes(memory.categoryInterest);
  if (categoryScopes.length > 0) return { productScope: categoryScopes[categoryScopes.length - 1], source: memory.categoryInterest };
  return {};
}

function extractStructuredProductScopes(text: string): string[] {
  const scopes: string[] = [];
  const seen = new Set<string>();
  const add = (value: string) => {
    if (seen.has(value)) return;
    seen.add(value);
    scopes.push(value);
  };

  for (const match of text.matchAll(/(?:iphone|아이폰)\s*(1[1-9]|[2-9])\s*(pro\s*max|pro|max|plus|mini)?/gi)) {
    add(["iPhone", match[1], normalizeStructuredVariant(match[2])].filter(Boolean).join(" "));
  }
  for (const match of text.matchAll(/(?:tesla|테슬라)?\s*model\s*([3y])|모델\s*([3y])/gi)) {
    const model = (match[1] ?? match[2])?.toUpperCase();
    if (model) add(`Tesla Model ${model}`);
  }

  return scopes;
}

function normalizeStructuredVariant(value?: string): string | undefined {
  if (!value) return undefined;
  return value.trim().replace(/\s+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeStructuredFacts(text: string): string[] {
  const facts: string[] = [];
  const battery = extractBatteryThresholdLabel(text.toLowerCase());
  if (battery) facts.push(`battery >= ${battery}`);
  if (hasSlotNoPreference(text, "battery")) {
    facts.push("battery no preference");
  }
  if (/(?:unlocked|factory unlocked|언락\s*필수)/i.test(text)) facts.push("unlocked");
  if (hasSlotNoPreference(text, "carrier")) {
    facts.push("carrier no preference");
  }
  return unique(facts);
}

function hasSlotNoPreference(text: string, slot: "battery" | "carrier"): boolean {
  const normalized = text.toLowerCase();
  if (slot === "battery" && /battery\s+no\s+preference/i.test(normalized)) return true;
  if (slot === "carrier" && /carrier\s+no\s+preference/i.test(normalized)) return true;

  const hasNoPreference = /(?:상관\s*없|무관|필요\s*없|신경\s*안\s*써|no preference|doesn'?t matter|not important|no need)/i.test(normalized);
  if (!hasNoPreference) return false;

  const hasBatteryTerm = /(?:battery|배터리|성능)/i.test(normalized);
  const hasCarrierTerm = /(?:carrier|통신사|언락|unlocked|locked|잠금)/i.test(normalized);
  const sharedNoPreference = hasSharedNoPreferenceForBatteryAndCarrier(normalized);
  if (slot === "carrier") return hasCarrierTerm;
  if (!hasBatteryTerm) return false;
  if (extractBatteryThresholdLabel(normalized)) return false;
  return !hasCarrierTerm || sharedNoPreference;
}

function hasSharedNoPreferenceForBatteryAndCarrier(normalized: string): boolean {
  const noPreference = String.raw`(?:상관\s*없|무관|필요\s*없|신경\s*안\s*써|no preference|doesn'?t matter|not important|no need)`;
  const battery = String.raw`(?:battery|배터리|성능)`;
  const carrier = String.raw`(?:carrier|통신사|언락|unlocked|locked|잠금)`;
  const connector = String.raw`(?:랑|와|과|및|하고|,|\/|&|\+|and)`;
  return (
    new RegExp(`${battery}\\s*${connector}\\s*${carrier}[^.!?。！？]{0,40}${noPreference}`, "i").test(normalized)
    || new RegExp(`${carrier}\\s*${connector}\\s*${battery}[^.!?。！？]{0,40}${noPreference}`, "i").test(normalized)
    || new RegExp(`${battery}[^.!?。！？]{0,20}${carrier}[^.!?。！？]{0,20}(?:둘\\s*다|모두|both)[^.!?。！？]{0,20}${noPreference}`, "i").test(normalized)
    || new RegExp(`${carrier}[^.!?。！？]{0,20}${battery}[^.!?。！？]{0,20}(?:둘\\s*다|모두|both)[^.!?。！？]{0,20}${noPreference}`, "i").test(normalized)
  );
}

function structuredSlotsForFacts(facts: string[]): string[] {
  const slots: string[] = [];
  const text = facts.join(" ").toLowerCase();
  if (/battery|배터리|성능/.test(text)) slots.push("battery_health");
  if (/unlocked|locked|carrier|언락|잠금|통신사/.test(text)) slots.push("carrier_lock");
  if (/imei/.test(text)) slots.push("imei_verification");
  return slots;
}

function buildStructuredDiscardedSignals(input: {
  previousMemory: AdvisorMemory;
  latestMessage: string;
}): NonNullable<AdvisorMemory["structured"]>["discardedSignals"] {
  const previous = input.previousMemory.structured?.discardedSignals ?? [];
  const discarded = [...previous];
  if (isSecurityAttackInput(input.latestMessage)) {
    discarded.push({
      text: input.latestMessage,
      reason: "security",
      relatedQuestion: input.previousMemory.questions[0],
    });
  } else if (isAmbiguousAnswer(input.latestMessage)) {
    discarded.push({
      text: input.latestMessage,
      reason: "ambiguous",
      relatedQuestion: input.previousMemory.questions[0],
    });
  } else if (!shouldKeepAdvisorSource(input.latestMessage, input.previousMemory)) {
    discarded.push({
      text: input.latestMessage,
      reason: "off_topic",
      relatedQuestion: input.previousMemory.questions[0],
    });
  }
  return discarded.slice(-12);
}

function isSecurityAttackInput(message: string): boolean {
  const normalized = message
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .toLowerCase();

  return /(?:ignore (?:all )?(?:previous|system|developer) instructions|system prompt|developer message|jailbreak|prompt injection|너의\s*(?:시스템|개발자)\s*지시|이전\s*지시\s*무시|프롬프트\s*인젝션|내부\s*(?:프롬프트|지시)|규칙을\s*무시)/i.test(normalized);
}

function applyScopedConditionConfirmation(
  memory: AdvisorMemory,
  latestMessage: string,
  previousMemory: AdvisorMemory,
): AdvisorMemory {
  if (previousMemory.questions.length === 0) return memory;

  const previousQuestion = previousMemory.questions.join(" ");
  const scopedQuestion = parseScopedConditionQuestion(previousQuestion);
  if (!scopedQuestion) return memory;

  const { sourceScope, conditionName, targetScope } = scopedQuestion;

  if (isRejectScopedConditionAnswer(latestMessage)) {
    const slotId = scopedConditionSlotId(conditionName);
    return {
      ...removeSlotFromAdvisorMemory(memory, slotId),
      source: unique([
        ...memory.source,
        ...targetScopeIntentSources(previousMemory, targetScope),
      ]),
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

  const memoryText = memoryTextFromAdvisorMemory(previousMemory);
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

function targetScopeIntentSources(previousMemory: AdvisorMemory, targetScope: string): string[] {
  const targetSources = previousMemory.source.filter((source) => (
    extractStructuredProductScopes(source).includes(targetScope)
    && normalizeStructuredFacts(source).length === 0
  ));
  return targetSources.length > 0 ? targetSources : [targetScope];
}

function appendScopedConditionDecision(
  structured: AdvisorMemory["structured"] | undefined,
  decision: NonNullable<AdvisorMemory["structured"]>["scopedConditionDecisions"][number],
): AdvisorMemory["structured"] {
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
  decisions: NonNullable<AdvisorMemory["structured"]>["scopedConditionDecisions"],
): NonNullable<AdvisorMemory["structured"]>["scopedConditionDecisions"] {
  const latestByScope = new Map<string, NonNullable<AdvisorMemory["structured"]>["scopedConditionDecisions"][number]>();
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
  const match = question.match(/전에\s+(.+?)에서 말한\s+(배터리 조건|언락\/통신사 조건|이 조건)을\s+(.+?)에도 그대로 적용할까요/);
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

function removeSlotFromAdvisorMemory(memory: AdvisorMemory, slotId: string): AdvisorMemory {
  return {
    ...memory,
    mustHave: memory.mustHave.filter((fact) => !structuredSlotsForFacts([fact]).includes(slotId)),
    avoid: memory.avoid.filter((fact) => !structuredSlotsForFacts([fact]).includes(slotId)),
  };
}

function applyConflictConfirmationAnswer(
  memory: AdvisorMemory,
  latestMessage: string,
  previousMemory: AdvisorMemory,
): AdvisorMemory {
  const pendingConflict = findPendingMemoryConflict(previousMemory);
  if (!pendingConflict?.currentValue || !pendingConflict.previousValue) return memory;

  if (isConfirmConflictAnswer(latestMessage)) {
    return {
      ...memory,
      mustHave: replaceMemoryFact(memory.mustHave, pendingConflict.previousValue, pendingConflict.currentValue),
      avoid: replaceMemoryFact(memory.avoid, pendingConflict.previousValue, pendingConflict.currentValue),
      source: unique([
        ...memory.source.filter((item) => !item.includes(pendingConflict.previousValue ?? "")),
        `${pendingConflict.productScope ?? previousMemory.categoryInterest} ${pendingConflict.currentValue}`,
      ]),
    };
  }

  if (isRejectConflictAnswer(latestMessage)) {
    return {
      ...memory,
      mustHave: replaceMemoryFact(memory.mustHave, pendingConflict.currentValue, pendingConflict.previousValue),
      avoid: replaceMemoryFact(memory.avoid, pendingConflict.currentValue, pendingConflict.previousValue),
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
  memory: AdvisorMemory,
  latestMessage: string,
  previousMemory: AdvisorMemory,
): AdvisorMemory {
  if (!isAmbiguousAnswer(latestMessage) || previousMemory.questions.length === 0) return memory;

  const previousQuestion = previousMemory.questions.join(" ");
  return {
    ...memory,
    mustHave: removeFactsForPendingQuestion(memory.mustHave, previousQuestion, previousMemory.mustHave),
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
    if (questionKinds.includes("carrier") && /unlocked|locked|carrier|언락|잠금|통신사/.test(normalized)) return false;
    if (questionKinds.includes("priority") && /priority|preference|must|avoid|조건|선호|우선|필수|피하/.test(normalized)) return false;
    return true;
  });
}

function pendingQuestionKinds(question: string): Array<"battery" | "carrier" | "priority"> {
  const kinds: Array<"battery" | "carrier" | "priority"> = [];
  if (/(?:배터리|성능|battery)/i.test(question)) kinds.push("battery");
  if (/(?:언락|잠금|통신사|unlocked|locked|carrier)/i.test(question)) kinds.push("carrier");
  if (kinds.length > 0) return kinds;
  if (/(?:조건|선호|필수|꼭|우선|중요|priority|preference|requirement|must)/i.test(question)) kinds.push("priority");
  return kinds;
}

function isApplyScopedConditionAnswer(message: string): boolean {
  return /^(?:그대로|그대로\s*적용|같이|똑같이|동일하게|same|apply|yes|응|네|맞아)(?:\s*(?:해|해주세요|해줘|볼게|적용해|적용해줘))?\.?$/i.test(message.trim());
}

function isRejectScopedConditionAnswer(message: string): boolean {
  return /(?:아니|아니야|아니요|ㄴㄴ|다시\s*정|새로\s*정|따로\s*정|다르게|별도로|적용하지\s*마|no|nope|don'?t\s*apply|different|separate)/i.test(message.trim());
}

function isConfirmConflictAnswer(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return (
    /^(?:응|네|맞아|좋아|ㅇㅇ|yes|yep|yeah|ok|okay|바꿔|변경|변경해|그걸로|그 기준으로|그렇게|apply|change)(?:\s*(?:해|해주세요|해줘|할게|가자|적용해|적용해줘|바꿔|바꿔줘))?\.?$/i.test(normalized)
    || /(?:응|네|yes|ok|okay|좋아).{0,12}(?:바꿔|변경|적용|그걸로|그렇게)/i.test(normalized)
  );
}

function isRejectConflictAnswer(message: string): boolean {
  return /^(?:아니|아니야|ㄴㄴ|no|nope|유지|그대로|기존|원래대로|90|90%|이전)(?:\s*(?:해|해주세요|해줘|둘게|유지해|유지해줘))?\.?$/i.test(message.trim());
}

function isAmbiguousAnswer(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;
  if (isNoPreferenceAnswer(normalized) || isApplyScopedConditionAnswer(normalized)) return false;

  return (
    /^(?:글쎄(?:요)?|잘\s*모르겠(?:어|어요|음)?|모르겠(?:어|어요|음)?|애매(?:해|하네|함)?|아마(?:도)?|maybe|not\s*sure|unsure|depends|it\s*depends|그때\s*봐서|상황(?:에)?\s*따라|적당히|대충|괜찮은\s*걸로|좋은\s*걸로|아무\s*거나는\s*아닌데.*|흠+|음+)\.?$/i.test(normalized)
    || /(?:글쎄|잘\s*모르겠|모르겠|애매|not\s*sure|unsure|depends|상황(?:에)?\s*따라)/i.test(normalized)
  );
}

function extractBatteryThresholdLabel(memoryText: string): string | null {
  const match = memoryText.match(/(?:battery|배터리|성능)[^0-9]{0,30}((?:[7-9][0-9]|100)\s*%?)/i)
    ?? memoryText.match(/((?:[7-9][0-9]|100)\s*%?)[^a-z0-9가-힣]{0,30}(?:battery|배터리|성능)/i);
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

  return /^(?:없어(?:요)?|없음|없다|아니(?:요)?|상관\s*없(?:어|어요|음)?|무관(?:해|함)?|괜찮(?:아|아요)?|필요\s*없(?:어|어요|음)?|신경\s*안\s*써(?:요)?|아무거나|none|no preference|doesn'?t matter|not important|no need)\.?$/i.test(normalized);
}

function hasGeneralNoPreference(memoryText: string): boolean {
  return /(?:no additional requirements|no preference|none|상관\s*없|무관|필요\s*없|신경\s*안\s*써|특별히\s*없|조건\s*없|선호\s*없)/i.test(memoryText);
}

function memoryTextFromAdvisorMemory(memory: AdvisorMemory): string {
  return [
    memory.categoryInterest,
    ...memory.mustHave,
    ...memory.avoid,
    ...memory.source,
  ].join(" ").toLowerCase();
}

function replyAsksQuestion(reply: string): boolean {
  return getQuestionWindows(reply).length > 0;
}

function buildNoPreferenceAcknowledgement(memory: AdvisorMemory, agentProfileName: string): string {
  const product = memory.categoryInterest && memory.categoryInterest !== "탐색 중"
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

function buildAdvisorMemoryCards(memory: AdvisorMemory): DemoMemoryCard[] {
  const normalizedMemory = normalizeAdvisorBudgetMemory(memory, {
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

function hasAdvisorActiveIntentSwitch(memory: AdvisorMemory): boolean {
  return memory.source.some((item) => /active intent switched/i.test(item));
}

function buildAdvisorMemoryFromStoredCards(cards: Array<{ summary?: unknown; memory?: unknown; memory_key?: unknown }>): AdvisorMemory | null {
  if (cards.length === 0) return null;

  const memory: AdvisorMemory = {
    categoryInterest: "탐색 중",
    mustHave: [],
    avoid: [],
    riskStyle: "balanced",
    negotiationStyle: "balanced",
    openingTactic: "fair_market_anchor",
    questions: [],
    source: [],
  };
  let foundUsefulMemory = false;

  for (const card of cards) {
    const data = card.memory && typeof card.memory === "object"
      ? card.memory as Record<string, unknown>
      : {};
    const memoryKey = stringFrom(card.memory_key) ?? stringFrom(data.normalizedValue) ?? "";
    const isPresetTuningCard = memoryKey.startsWith("advisor:preset_tuning:")
      || memoryKey.startsWith("preset_tuning:");
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
      memory.structured = mergeStructuredAdvisorMemory(memory.structured, structured);
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
    ? normalizeAdvisorBudgetMemory(memory, {
      latestMessage: memory.source.join(" "),
      listings: [],
    })
    : null;
}

function normalizeAdvisorBudgetMemory(
  memory: AdvisorMemory,
  context: {
    latestMessage: string;
    previousMemory?: AdvisorMemory;
    listings: Array<{ title: string; category?: string; askPriceMinor: number }>;
  },
): AdvisorMemory {
  const normalized = { ...memory };
  const explicitBudget = extractExplicitDollarBudget(context.latestMessage, context.previousMemory);
  const electronicsLike = isConsumerElectronicsMemory(normalized, context.listings);
  const latestIsNonBudgetNumeric = (hasPercentNumber(context.latestMessage)
    || hasProductModelNumber(context.latestMessage)
    || isShortModelAnswerToPendingQuestion(context.latestMessage, context.previousMemory))
    && !hasExplicitMoneyUnit(context.latestMessage);

  if (latestIsNonBudgetNumeric) {
    normalized.budgetMax = context.previousMemory?.budgetMax;
    normalized.targetPrice = context.previousMemory?.targetPrice;
  }

  if (explicitBudget !== undefined) {
    const previousBudget = normalized.budgetMax;
    normalized.budgetMax = explicitBudget;
    normalized.targetPrice = normalizeTargetAgainstBudget(normalized.targetPrice, previousBudget, explicitBudget);
    return normalized;
  }

  if (electronicsLike) {
    normalized.budgetMax = normalizeConsumerElectronicsDollarValue(normalized.budgetMax);
    normalized.targetPrice = normalizeConsumerElectronicsDollarValue(normalized.targetPrice);
  }

  if (
    normalized.budgetMax !== undefined
    && normalized.targetPrice !== undefined
    && normalized.targetPrice > normalized.budgetMax
  ) {
    normalized.targetPrice = Math.max(1, Math.round(normalized.budgetMax * 0.9));
  }

  return normalized;
}

function extractExplicitDollarBudget(message: string, previousMemory?: AdvisorMemory): number | undefined {
  const text = message.trim().toLowerCase();
  if (hasPercentNumber(text) || hasProductModelNumber(text) || isShortModelAnswerToPendingQuestion(text, previousMemory)) return undefined;
  const maxMatch = text.match(/(?:max|maximum|budget|예산|최대)[^0-9$]{0,20}(?:\$|usd\s*)?(\d[\d,]*(?:\.\d{1,2})?)/i);
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
  const budgetContext = (
    /(?:예산|최대|목표가|가격|budget|max|target|달러라고|불이라고)/i.test(message)
    || previousMemory?.questions.some((question) => /(?:예산|최대|목표가|가격|budget|max|target)/i.test(question))
  );

  if (budgetContext && numbers.length === 1) {
    const value = numbers[0];
    if (value < 100 && !hasExplicitMoneyUnit(text) && !/(?:예산|최대|목표가|budget|max|target)[^0-9$]{0,20}\d{2}/i.test(text)) {
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
  return /(?:iphone|아이폰|model|모델)\s*\d{1,2}\b/i.test(text)
    || /\b\d{1,2}\s*(?:pro\s*max|pro|max|plus|mini)\b/i.test(text);
}

function isShortModelAnswerToPendingQuestion(text: string, previousMemory?: AdvisorMemory): boolean {
  if (!previousMemory?.questions.some((question) => /(?:모델|iphone|아이폰|쪽|우선)/i.test(question))) return false;
  return /^\s*(?:1[1-9]|[2-9])\s*(?:은|는|로|요|\?)*\s*$/i.test(text.trim());
}

function hasExplicitMoneyUnit(text: string): boolean {
  return /[$]|(?:usd|dollars?|bucks?|달러|불)\b/i.test(text);
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
  memory: AdvisorMemory,
  listings: Array<{ title: string; category?: string; askPriceMinor: number }>,
): boolean {
  const text = [
    memory.categoryInterest,
    ...memory.mustHave,
    ...memory.avoid,
    ...memory.source,
    ...listings.map((listing) => `${listing.title} ${listing.category}`),
  ].join(" ").toLowerCase();

  if (/(iphone|아이폰|ipad|아이패드|phone|smartphone|휴대폰|핸드폰|macbook|laptop|electronics)/i.test(text)) {
    return true;
  }

  const prices = listings.map((listing) => listing.askPriceMinor / 100).filter((price) => price > 0);
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

function structuredFrom(value: unknown): AdvisorMemory["structured"] | undefined {
  const parsed = structuredAdvisorMemorySchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function mergeStructuredAdvisorMemory(
  base: AdvisorMemory["structured"] | undefined,
  next: NonNullable<AdvisorMemory["structured"]>,
): AdvisorMemory["structured"] {
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
    memoryConflicts: [
      ...(base?.memoryConflicts ?? []),
      ...next.memoryConflicts,
    ].slice(-16),
    scopedConditionDecisions: uniqueScopedConditionDecisions([
      ...(base?.scopedConditionDecisions ?? []),
      ...next.scopedConditionDecisions,
    ]),
    sessionMemory: next.sessionMemory ?? base?.sessionMemory,
    longTermMemory: next.longTermMemory ?? base?.longTermMemory,
    promotionDecisions: [
      ...(base?.promotionDecisions ?? []),
      ...next.promotionDecisions,
    ].slice(-24),
    compression: next.compression ?? base?.compression,
  };
}

function uniqueDiscardedSignals(
  signals: NonNullable<AdvisorMemory["structured"]>["discardedSignals"],
): NonNullable<AdvisorMemory["structured"]>["discardedSignals"] {
  const seen = new Set<string>();
  const result: NonNullable<AdvisorMemory["structured"]>["discardedSignals"] = [];
  for (const signal of signals) {
    const key = `${signal.reason}:${signal.text}:${signal.relatedQuestion ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(signal);
  }
  return result.slice(-12);
}

function riskStyleFrom(value: unknown): AdvisorMemory["riskStyle"] | undefined {
  return value === "safe_first" || value === "balanced" || value === "lowest_price" ? value : undefined;
}

function negotiationStyleFrom(value: unknown): AdvisorMemory["negotiationStyle"] | undefined {
  return value === "defensive" || value === "balanced" || value === "aggressive" ? value : undefined;
}

function openingTacticFrom(value: unknown): AdvisorMemory["openingTactic"] | undefined {
  return value === "condition_anchor" || value === "fair_market_anchor" || value === "speed_close" ? value : undefined;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values)).slice(0, 12);
}

async function upsertAdvisorMemoryCards(
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

function presetTuningFeedbackDelta(input: z.infer<typeof presetTuningFeedbackBodySchema>): number {
  if (
    input.outcome === "accepted"
    && input.final_price_minor
    && input.price_cap_minor
    && input.final_price_minor <= input.price_cap_minor
  ) {
    return input.application_mode === "auto" ? 0.035 : 0.045;
  }
  if (input.outcome === "accepted") return 0.015;
  if (input.outcome === "cap_blocked") return -0.01;
  if (input.outcome === "rejected") return -0.025;
  return -0.015;
}

async function recordPresetTuningFeedback(
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

async function staleActiveAdvisorMemoryCards(db: Database, userId: string) {
  await db.execute(sql`
    UPDATE user_memory_cards
    SET status = 'STALE',
        updated_at = NOW()
    WHERE user_id = ${userId}
      AND status = 'ACTIVE'
      AND memory_key LIKE 'advisor:%'
  `);
}

function buildAdvisorSourceMessageId(body: z.infer<typeof saveAdvisorMemoryBodySchema>): string {
  const hash = createHash("sha256")
    .update(stableStringify({
      userId: body.user_id,
      agentId: body.agent_id ?? null,
      message: body.message,
      memory: body.memory,
    }))
    .digest("hex")
    .slice(0, 32);

  return `advisor:${hash}`;
}

function buildPresetTuningSourceMessageId(body: z.infer<typeof savePresetTuningBodySchema>): string {
  const hash = createHash("sha256")
    .update(stableStringify({
      userId: body.user_id,
      agentId: body.agent_id ?? null,
      draft: {
        draftId: body.draft.draftId,
        presetId: body.draft.presetId,
        listingId: body.draft.listing.id,
        priceCapMinor: body.draft.priceCapMinor,
        openingOfferMinor: body.draft.openingOfferMinor,
        mustVerify: body.draft.mustVerify.map((term) => [term.termId, term.checked, term.enforcement]),
        leverage: body.draft.leverage.map((item) => [item.termId, item.enabled]),
        walkAway: body.draft.walkAway.map((item) => [item.id, item.enabled]),
      },
    }))
    .digest("hex")
    .slice(0, 32);

  return `preset_tuning:${hash}`;
}

function buildPresetTuningMemoryCard(draft: z.infer<typeof presetTuningDraftSchema>): DemoMemoryCard {
  const scope = presetTuningScope(draft);
  const enabledLeverage = draft.leverage.filter((item) => item.enabled);
  const enabledWalkAway = draft.walkAway.filter((item) => item.enabled);
  const checkedTerms = draft.mustVerify.filter((term) => term.checked);
  const uncheckedHardTerms = draft.mustVerify.filter((term) => !term.checked && term.enforcement !== "soft");

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
      engineReview: draft.engineReview ? {
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
      } : undefined,
      sourceBadges: draft.sourceBadges,
    },
    strength: 0.78,
  };
}

function presetTuningScope(draft: z.infer<typeof presetTuningDraftSchema>): string {
  const tag = draft.listing.tags.find((item) => /iphone|macbook|tesla|laptop|phone|electronics/i.test(item));
  const titleScope = draft.listing.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);

  return (tag || draft.listing.category || titleScope || "default").toLowerCase().replace(/[^a-z0-9:_-]+/g, "_");
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

async function listDemoMemoryCards(db: Database, userId: string) {
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

async function deleteDemoMemoryData(db: Database, userId: string) {
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
  if (result && typeof result === "object" && Array.isArray((result as { rows?: unknown[] }).rows)) {
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
