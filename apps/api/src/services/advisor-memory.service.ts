import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { sql, type Database } from "@haggle/db";
import { recordConversationSignalsForRound } from "./conversation-signal-sink.js";

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

export const advisorMemorySchema = z.object({
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

export type AdvisorMemory = z.infer<typeof advisorMemorySchema>;

export const advisorMemorySaveBodySchema = z.object({
  session_id: z.string().uuid().optional(),
  agent_id: z.string().min(1).optional(),
  message: z.string().min(1).max(2000),
  memory: advisorMemorySchema,
});

type AdvisorMemoryCard = {
  cardType: "preference" | "constraint" | "pricing" | "style" | "trust" | "interest";
  memoryKey: string;
  summary: string;
  memory: Record<string, unknown>;
  strength: number;
};

export async function saveAdvisorMemorySnapshot(
  db: Database,
  input: {
    userId: string;
    sessionId?: string;
    agentId?: string;
    message: string;
    memory: AdvisorMemory;
    surface: string;
  },
) {
  const sessionId = input.sessionId ?? randomUUID();
  const sourceMessageId = buildAdvisorSourceMessageId(input);

  const signals = await recordConversationSignalsForRound(db, {
    sessionId,
    userId: input.userId,
    rolePerspective: "BUYER",
    text: input.message,
    sourceMessageId,
    sourceLabel: "incoming",
    metadata: {
      surface: input.surface,
      agent_id: input.agentId,
    },
  });

  if (hasAdvisorActiveIntentSwitch(input.memory)) {
    await staleActiveAdvisorMemoryCards(db, input.userId);
  }

  const cards = buildAdvisorMemoryCards(input.memory);
  const storedCards = await upsertAdvisorMemoryCards(db, {
    userId: input.userId,
    sourceMessageId,
    cards,
    metadata: {
      surface: input.surface,
      agent_id: input.agentId,
      session_id: sessionId,
    },
  });

  return {
    user_id: input.userId,
    session_id: sessionId,
    source_message_id: sourceMessageId,
    signals,
    memory_cards: storedCards,
  };
}

function hasAdvisorActiveIntentSwitch(memory: AdvisorMemory): boolean {
  return memory.source.some((item) => /active intent switched/i.test(item));
}

function buildAdvisorMemoryCards(memory: AdvisorMemory): AdvisorMemoryCard[] {
  const normalizedMemory = normalizeAdvisorBudgetMemory(memory, {
    latestMessage: memory.source.join(" "),
  });
  const promotionGate = buildPromotedAdvisorMemory(normalizedMemory);
  const promotedLongTerm = sanitizeLongTermAdvisorMemory(normalizedMemory.structured?.longTermMemory);
  const promotedGlobalFacts = promotedLongTerm?.globalFacts ?? [];
  const hasStructuredPromotionGate = Boolean(normalizedMemory.structured?.longTermMemory);
  const cards: AdvisorMemoryCard[] = [
    {
      cardType: "interest",
      memoryKey: "advisor:category_interest",
      summary: `Interested in ${normalizedMemory.categoryInterest}`,
      memory: {
        categoryInterest: normalizedMemory.categoryInterest,
        source: promotionGate.source.length > 0 ? promotionGate.source : ["advisor_memory"],
        ...(normalizedMemory.structured ? { structured: buildPersistableStructuredAdvisorMemory(normalizedMemory.structured) } : {}),
      },
      strength: 0.65,
    },
  ];

  const stylePromoted = (
    !hasStructuredPromotionGate
    || promotedGlobalFacts.some((fact) => /^(?:riskStyle|negotiationStyle|openingTactic):/.test(fact))
  );
  if (stylePromoted) {
    cards.push({
      cardType: "style",
      memoryKey: "advisor:risk_and_tactic",
      summary: `${normalizedMemory.riskStyle} buyer style with ${normalizedMemory.openingTactic}`,
      memory: {
        riskStyle: normalizedMemory.riskStyle,
        negotiationStyle: normalizedMemory.negotiationStyle,
        openingTactic: normalizedMemory.openingTactic,
      },
      strength: 0.66,
    });
  }

  const pricingPromoted = (
    !hasStructuredPromotionGate
    || promotedGlobalFacts.some((fact) => /^(?:budgetMax|targetPrice):/.test(fact))
  );
  if (pricingPromoted && (normalizedMemory.budgetMax || normalizedMemory.targetPrice)) {
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

  if (promotionGate.mustHave.length > 0) {
    cards.push({
      cardType: "preference",
      memoryKey: "advisor:must_have",
      summary: `Must have: ${promotionGate.mustHave.join(", ")}`,
      memory: {
        mustHave: promotionGate.mustHave,
      },
      strength: 0.7,
    });
  }

  if (promotionGate.avoid.length > 0) {
    cards.push({
      cardType: "trust",
      memoryKey: "advisor:avoid",
      summary: `Avoid: ${promotionGate.avoid.join(", ")}`,
      memory: {
        avoid: promotionGate.avoid,
      },
      strength: 0.72,
    });
  }

  return cards;
}

function buildPromotedAdvisorMemory(memory: AdvisorMemory): {
  source: string[];
  mustHave: string[];
  avoid: string[];
} {
  const longTerm = sanitizeLongTermAdvisorMemory(memory.structured?.longTermMemory);
  if (!longTerm) {
    return {
      source: memory.source,
      mustHave: memory.mustHave,
      avoid: memory.avoid,
    };
  }

  const promotedText = longTerm.facts.join(" ").toLowerCase();
  return {
    source: uniqueStrings(longTerm.facts),
    mustHave: memory.mustHave.filter((fact) => factIsPromoted(fact, promotedText)),
    avoid: memory.avoid.filter((fact) => factIsPromoted(fact, promotedText)),
  };
}

function factIsPromoted(fact: string, promotedText: string): boolean {
  const normalized = fact.toLowerCase().trim();
  if (!normalized) return false;
  if (promotedText.includes(normalized)) return true;

  if (/battery\s*>=\s*(?:[7-9][0-9]|100)%?/.test(normalized)) return promotedText.includes(normalized);
  if (/battery|배터리|성능/.test(normalized)) return promotedText.includes(normalized);
  if (/unlocked|locked|carrier|언락|잠금|통신사/.test(normalized)) {
    return /unlocked|locked|carrier|언락|잠금|통신사/.test(promotedText);
  }
  if (/imei/.test(normalized)) return /imei/.test(promotedText);
  return false;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function buildPersistableStructuredAdvisorMemory(
  structured: NonNullable<AdvisorMemory["structured"]>,
): NonNullable<AdvisorMemory["structured"]> {
  const longTermMemory = sanitizeLongTermAdvisorMemory(structured.longTermMemory);
  const productRequirements = buildPersistableProductRequirements(structured.productRequirements, longTermMemory);
  const globalPreferences = buildPersistableGlobalPreferences(structured.globalPreferences, longTermMemory);
  const productScopes = new Set([
    ...Object.keys(productRequirements),
    ...(longTermMemory?.productScopes ?? []),
  ]);

  return {
    activeIntent: sanitizePersistableActiveIntent(structured.activeIntent, productScopes),
    productRequirements,
    globalPreferences,
    pendingSlots: [],
    discardedSignals: [],
    memoryConflicts: structured.memoryConflicts.filter((conflict) => (
      isPersistableMemoryConflict(conflict, productScopes)
    )),
    scopedConditionDecisions: [],
    sessionMemory: undefined,
    longTermMemory,
    promotionDecisions: structured.promotionDecisions.filter((decision) => (
      decision.decision === "promote"
      && isPersistableLongTermFact(decision.text)
    )),
    compression: structured.compression
      ? {
          recentWindowFacts: [],
          carriedForwardFacts: structured.compression.carriedForwardFacts.filter(isPersistableLongTermFact),
          droppedSignals: [],
          summary: structured.compression.summary,
        }
      : undefined,
    questionPlan: undefined,
  };
}

function sanitizePersistableActiveIntent(
  activeIntent: NonNullable<AdvisorMemory["structured"]>["activeIntent"],
  productScopes: Set<string>,
): NonNullable<AdvisorMemory["structured"]>["activeIntent"] | undefined {
  if (!activeIntent?.productScope) return undefined;
  if (!productScopes.has(activeIntent.productScope)) return undefined;
  if (isUnsafeMemoryText(activeIntent.productScope)) return undefined;

  return {
    productScope: activeIntent.productScope,
    ...(activeIntent.source && !isUnsafeMemoryText(activeIntent.source) ? { source: activeIntent.source } : {}),
  };
}

function sanitizeLongTermAdvisorMemory(
  longTerm: NonNullable<AdvisorMemory["structured"]>["longTermMemory"] | undefined,
): NonNullable<NonNullable<AdvisorMemory["structured"]>["longTermMemory"]> | undefined {
  if (!longTerm) return undefined;

  const facts = uniqueStrings(longTerm.facts.filter(isPersistableLongTermFact));
  const productScopes = uniqueStrings([
    ...longTerm.productScopes,
    ...facts.flatMap((fact) => {
      const parsed = parseScopedLongTermFact(fact);
      return parsed ? [parsed.scope] : [];
    }),
  ]);
  const globalFacts = uniqueStrings(longTerm.globalFacts.filter(isPersistableGlobalFact));

  return {
    facts,
    productScopes,
    globalFacts,
  };
}

function isPersistableMemoryConflict(
  conflict: NonNullable<AdvisorMemory["structured"]>["memoryConflicts"][number],
  productScopes: Set<string>,
): boolean {
  if (conflict.status === "needs_confirmation" || conflict.status === "conflicting") return false;
  if (!productScopes.has(conflict.productScope ?? "")) return false;
  if (!isPersistableConflictSlot(conflict.slotId, [conflict.previousValue, conflict.currentValue])) return false;
  if (conflict.previousValue && !isPersistableAdvisorFact(conflict.previousValue)) return false;
  if (conflict.currentValue && !isPersistableAdvisorFact(conflict.currentValue)) return false;
  if (conflict.reason && isUnsafeMemoryText(conflict.reason)) return false;
  return true;
}

function isPersistableConflictSlot(slotId: string, facts: Array<string | undefined>): boolean {
  return facts
    .filter((fact): fact is string => Boolean(fact))
    .some((fact) => slotsForPersistableFact(fact).includes(slotId));
}

function buildPersistableProductRequirements(
  productRequirements: NonNullable<AdvisorMemory["structured"]>["productRequirements"],
  longTerm: NonNullable<NonNullable<AdvisorMemory["structured"]>["longTermMemory"]> | undefined,
): NonNullable<AdvisorMemory["structured"]>["productRequirements"] {
  if (!longTerm) return {};

  const result: NonNullable<AdvisorMemory["structured"]>["productRequirements"] = {};
  for (const fact of longTerm.facts) {
    const parsed = parseScopedLongTermFact(fact);
    if (!parsed) continue;

    const original = productRequirements[parsed.scope];
    const current = result[parsed.scope] ?? {
      mustHave: [],
      avoid: [],
      answeredSlots: [],
      ambiguousSlots: [],
    };
    const target = original?.avoid.includes(parsed.fact) ? current.avoid : current.mustHave;
    target.push(parsed.fact);
    result[parsed.scope] = {
      ...current,
      answeredSlots: uniqueStrings([
        ...current.answeredSlots,
        ...(original?.answeredSlots ?? []),
        ...slotsForPersistableFact(parsed.fact),
      ]),
      ambiguousSlots: [],
    };
  }

  for (const [scope, requirements] of Object.entries(result)) {
    result[scope] = {
      mustHave: uniqueStrings(requirements.mustHave),
      avoid: uniqueStrings(requirements.avoid),
      answeredSlots: uniqueStrings(requirements.answeredSlots),
      ambiguousSlots: [],
    };
  }

  return result;
}

function buildPersistableGlobalPreferences(
  globalPreferences: NonNullable<AdvisorMemory["structured"]>["globalPreferences"],
  longTerm: NonNullable<NonNullable<AdvisorMemory["structured"]>["longTermMemory"]> | undefined,
): NonNullable<AdvisorMemory["structured"]>["globalPreferences"] {
  if (!longTerm) return { mustHave: [], avoid: [] };

  const result: NonNullable<AdvisorMemory["structured"]>["globalPreferences"] = {
    mustHave: [],
    avoid: [],
  };
  for (const fact of longTerm.globalFacts) {
    const [key, rawValue] = fact.split(/:\s*/, 2);
    if (!key || rawValue === undefined) continue;

    if (key === "budgetMax") {
      const value = Number(rawValue);
      if (Number.isFinite(value) && value > 0) result.budgetMax = Math.round(value);
    } else if (key === "targetPrice") {
      const value = Number(rawValue);
      if (Number.isFinite(value) && value > 0) result.targetPrice = Math.round(value);
    } else if (key === "riskStyle" && ["safe_first", "balanced", "lowest_price"].includes(rawValue)) {
      result.riskStyle = rawValue as typeof result.riskStyle;
    } else if (key === "negotiationStyle" && ["defensive", "balanced", "aggressive"].includes(rawValue)) {
      result.negotiationStyle = rawValue as typeof result.negotiationStyle;
    } else if (key === "openingTactic" && ["condition_anchor", "fair_market_anchor", "speed_close"].includes(rawValue)) {
      result.openingTactic = rawValue as typeof result.openingTactic;
    }
  }

  return {
    ...result,
    mustHave: globalPreferences.mustHave.filter((fact) => factIsPromoted(fact, longTerm.facts.join(" ").toLowerCase())),
    avoid: globalPreferences.avoid.filter((fact) => factIsPromoted(fact, longTerm.facts.join(" ").toLowerCase())),
  };
}

function parseScopedLongTermFact(fact: string): { scope: string; fact: string } | null {
  const match = fact.match(/^([^:]{2,80}):\s*(.+)$/);
  if (!match?.[1] || !match[2]) return null;
  const scope = match[1].trim();
  const value = match[2].trim();
  if (!isPersistableAdvisorFact(value)) return null;
  return { scope, fact: value };
}

function isPersistableLongTermFact(fact: string): boolean {
  if (isUnsafeMemoryText(fact)) return false;
  return isPersistableGlobalFact(fact) || Boolean(parseScopedLongTermFact(fact));
}

function isPersistableGlobalFact(fact: string): boolean {
  if (isUnsafeMemoryText(fact)) return false;
  return /^(?:budgetMax|targetPrice):\s*\d+$/.test(fact)
    || /^riskStyle:\s*(?:safe_first|balanced|lowest_price)$/.test(fact)
    || /^negotiationStyle:\s*(?:defensive|balanced|aggressive)$/.test(fact)
    || /^openingTactic:\s*(?:condition_anchor|fair_market_anchor|speed_close)$/.test(fact);
}

function isPersistableAdvisorFact(fact: string): boolean {
  if (isUnsafeMemoryText(fact)) return false;
  return /(?:battery\s*>=\s*(?:[7-9][0-9]|100)%?|battery no preference|carrier no preference|unlocked|locked|clean IMEI|original box included|screen mint|screen clean|visible wear|crack|scratch|Pro model)/i.test(fact);
}

function isUnsafeMemoryText(text: string): boolean {
  const normalized = text
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .toLowerCase();

  return /(?:ignore (?:all )?(?:previous|system|developer) instructions|system prompt|developer message|jailbreak|prompt injection|너의\s*(?:시스템|개발자)\s*지시|이전\s*지시\s*무시|프롬프트\s*인젝션|내부\s*(?:프롬프트|지시)|규칙을\s*무시)/i.test(normalized);
}

function slotsForPersistableFact(fact: string): string[] {
  const slots: string[] = [];
  if (/battery|배터리|성능/.test(fact)) slots.push("battery_health");
  if (/unlocked|locked|carrier|언락|잠금|통신사/.test(fact)) slots.push("carrier_lock");
  if (/imei/i.test(fact)) slots.push("imei_verification");
  return slots;
}

function normalizeAdvisorBudgetMemory(
  memory: AdvisorMemory,
  context: {
    latestMessage: string;
    previousMemory?: AdvisorMemory;
  },
): AdvisorMemory {
  const normalized = { ...memory };
  const explicitBudget = extractExplicitDollarBudget(context.latestMessage, context.previousMemory);
  const electronicsLike = isConsumerElectronicsMemory(normalized);

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

  if (budgetContext && numbers.length === 1) return numbers[0];
  return undefined;
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

function isConsumerElectronicsMemory(memory: AdvisorMemory): boolean {
  const text = [
    memory.categoryInterest,
    ...memory.mustHave,
    ...memory.avoid,
    ...memory.source,
  ].join(" ").toLowerCase();

  return /(iphone|아이폰|ipad|아이패드|phone|smartphone|휴대폰|핸드폰|macbook|laptop|electronics)/i.test(text);
}

function parseDollarNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value.replace(/,/g, ""));
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.round(parsed);
}

async function upsertAdvisorMemoryCards(
  db: Database,
  input: {
    userId: string;
    sourceMessageId: string;
    cards: AdvisorMemoryCard[];
    metadata: Record<string, unknown>;
  },
) {
  const stored = [];

  for (const card of input.cards) {
    const eventDelta = {
      source: "advisor_memory",
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

function buildAdvisorSourceMessageId(input: {
  userId: string;
  agentId?: string;
  message: string;
  memory: AdvisorMemory;
}): string {
  const hash = createHash("sha256")
    .update(stableStringify({
      userId: input.userId,
      agentId: input.agentId ?? null,
      message: input.message,
      memory: input.memory,
    }))
    .digest("hex")
    .slice(0, 32);

  return `advisor:${hash}`;
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

function rowsFromResult(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  if (result && typeof result === "object" && Array.isArray((result as { rows?: unknown[] }).rows)) {
    return (result as { rows: Record<string, unknown>[] }).rows;
  }
  return [];
}

function normalizeMemoryCardRow(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    card_type: String(row.card_type),
    memory_key: String(row.memory_key),
    summary: String(row.summary),
    memory: row.memory,
    strength: String(row.strength),
    version: Number(row.version),
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}
