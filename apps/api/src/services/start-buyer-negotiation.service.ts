import { quoteNegotiationCredits } from "@haggle/commerce-core";
import { and, type Database, eq, userSavedAddresses } from "@haggle/db";
import { compileNegotiationAgentSnapshot, type EngineParamsInput } from "@haggle/engine-session";
import {
  buildCategoryCriteriaScaffold,
  type CategoryCriterion,
  type EngineParameters,
  getNegotiationAgentPreset,
  presetToEngineParameters,
} from "@haggle/shared";
import { z } from "zod";
import {
  type BuyerShippingAddress,
  type FulfillmentPreference,
  fulfillmentPreferenceSchema,
  parseListingParcel,
  parseSellerFulfillmentOffer,
  snapshotFulfillmentFields,
} from "../lib/negotiation-fulfillment.js";
import { isDecideCatalogModel, resolveDecideModel } from "../negotiation/decide-model.js";
import { projectSellerFacts } from "../negotiation/memory/seller-facts.js";
import {
  BUYER_CRITERIA_REQUIRED,
  buyerCriteriaRequiredReject,
  buyerHasAnsweredCriteria,
} from "../negotiation/phase/seller-criteria-pause.js";
import {
  type AttemptControlSnapshot,
  defaultAttemptControlPolicy,
  evaluateAttemptControl,
  isAttemptControlRateLimited,
} from "./attempt-control.service.js";
import { getPublishedListingByRef } from "./draft.service.js";
import {
  assertListingAcceptsNewSession,
  LISTING_CLAIM_HTTP,
  ListingClaimError,
} from "./listing-claim.service.js";
import {
  extractSellerRequiredCriteria,
  loadListingStrategyContext,
} from "./listing-strategy.service.js";
import { createNegotiationAutoPlaySetup } from "./negotiation-auto-play.service.js";
import { createSession, type NegotiationDriver } from "./negotiation-session.service.js";

const buyerCriterionInputSchema = z.object({
  checkId: z.string().min(1).max(80),
  stance: z.string().max(2000).optional(),
  questionKo: z.string().max(500).optional(),
  buyerAskKo: z.string().max(500).optional(),
  enforcement: z.enum(["hard", "soft"]).optional(),
  requirement: z.enum(["required", "optional"]).optional(),
});

export const startBuyerNegotiationSchema = z.object({
  listing_public_id: z.string().min(1),
  negotiation_agent_preset_id: z.string().min(1),
  agent_weights: z.record(z.number()).optional(),
  agent_overrides: z.record(z.unknown()).optional(),
  negotiation_agent_builder_memory: z
    .object({
      budgetMax: z.number().positive().optional(),
      targetPrice: z.number().positive().optional(),
      mustHave: z.array(z.string()).optional(),
      avoid: z.array(z.string()).optional(),
      riskStyle: z.string().optional(),
      negotiationStyle: z.string().optional(),
      openingTactic: z.string().optional(),
      categoryInterest: z.string().optional(),
      questions: z.array(z.string()).optional(),
      source: z.array(z.string()).optional(),
    })
    .passthrough()
    .optional(),
  /** Wizard-before-start answers for seller required criteria (IMEI/완납/침수/Find My). */
  buyerCriteria: z.array(buyerCriterionInputSchema).max(40).optional(),
  deadline_hours: z
    .number()
    .positive()
    .max(24 * 14)
    .optional(),
  fulfillment: fulfillmentPreferenceSchema.optional(),
  pro_model_credit: z.boolean().optional(),
  requested_model: z.string().min(1).max(80).optional(),
});

export type StartBuyerNegotiationBody = z.infer<typeof startBuyerNegotiationSchema>;

export type StartBuyerNegotiationResult =
  | {
      ok: true;
      status: 202;
      body: {
        session_id: string;
        status: string;
        run_token: string;
        guest_buyer_id?: string;
        attempt_control?: AttemptControlSnapshot;
        chat_url?: string;
        driver: NegotiationDriver;
      };
    }
  | { ok: false; status: number; body: Record<string, unknown> };

export async function startBuyerNegotiation(
  db: Database,
  input: {
    body: StartBuyerNegotiationBody;
    buyerId: string;
    isGuest: boolean;
    driver: NegotiationDriver;
    allowGuest: boolean;
    chatUrl?: string;
  },
): Promise<StartBuyerNegotiationResult> {
  if (input.isGuest && !input.allowGuest) {
    return { ok: false, status: 401, body: { error: "AUTH_REQUIRED" } };
  }

  const body = input.body;
  const buyer = { id: input.buyerId };

  const listing = await getPublishedListingByRef(db, body.listing_public_id);
  if (!listing) {
    return { ok: false, status: 404, body: { error: "LISTING_NOT_FOUND" } };
  }
  if (!listing.sellerId) {
    return { ok: false, status: 409, body: { error: "LISTING_UNCLAIMED" } };
  }
  if (!input.isGuest && listing.sellerId === buyer.id) {
    return { ok: false, status: 403, body: { error: "BUYER_IS_SELLER" } };
  }

  const listingContext = await loadListingStrategyContext(db, listing.id);
  if (!listingContext?.askPriceMinor || !listingContext.floorPriceMinor) {
    return { ok: false, status: 409, body: { error: "LISTING_STRATEGY_INCOMPLETE" } };
  }

  const askMinor = listingContext.askPriceMinor;
  const floorMinor = listingContext.floorPriceMinor;
  const listedAtMs = listingContext.listedAtMs;
  const nowMs = Date.now();
  if (listingContext.deadlineAtMs && listingContext.deadlineAtMs <= nowMs) {
    return {
      ok: false,
      status: 409,
      body: {
        error: "LISTING_NEGOTIATION_EXPIRED",
        message: "This listing's negotiation window has ended.",
      },
    };
  }
  const buyerDeadlineMs = nowMs + (body.deadline_hours ?? 24) * 60 * 60 * 1000;
  const effectiveDeadlineMs = listingContext.deadlineAtMs
    ? Math.min(buyerDeadlineMs, listingContext.deadlineAtMs)
    : buyerDeadlineMs;
  const timeTotalMs = Math.max(1, effectiveDeadlineMs - listedAtMs);

  const advisor = body.negotiation_agent_builder_memory;
  const budgetMaxMinor = toMinorOrUndefined(advisor?.budgetMax);
  const targetPriceMinor = toMinorOrUndefined(advisor?.targetPrice);
  const buyerReservation = budgetMaxMinor ?? askMinor;
  const buyerTarget = targetPriceMinor ?? Math.max(floorMinor, Math.round(askMinor * 0.9));
  if (buyerTarget >= buyerReservation) {
    return { ok: false, status: 400, body: { error: "INVALID_PRICE_RANGE" } };
  }

  // Required listing criteria must 409 before ATTEMPT_LIMIT / credit / marketplace-attempt.
  // Empty start: no session, no attempt consumed (joUdQ7Tw).
  const listingSnapshot =
    (listing.negotiationAgentSnapshot as Record<string, unknown> | null) ?? {};
  const snapshotRequired = extractSellerRequiredCriteria(listingSnapshot);
  const rawBuyerCriteriaEarly =
    body.buyerCriteria ?? (advisor as { categoryCriteria?: unknown } | undefined)?.categoryCriteria;
  if (
    snapshotRequired.length > 0 &&
    !buyerHasAnsweredCriteria(
      Array.isArray(rawBuyerCriteriaEarly) ? (rawBuyerCriteriaEarly as CategoryCriterion[]) : [],
    )
  ) {
    return {
      ok: false,
      status: 409,
      body: {
        error: BUYER_CRITERIA_REQUIRED,
        message:
          "Answer seller required criteria (IMEI/완납/침수/Find My) in the start wizard via buyerCriteria before play_next. Do not use answer_pause.",
        required_check_ids: snapshotRequired.map((c) => c.checkId),
        required_criteria: snapshotRequired,
      },
    };
  }

  let attemptControl: AttemptControlSnapshot | undefined;
  if (!input.isGuest) {
    const attemptResult = await evaluateAttemptControl(db, {
      buyerPrincipalId: buyer.id,
      listingId: listing.id,
    });
    attemptControl = attemptResult.attemptControl;
    if (!attemptResult.allowed) {
      return {
        ok: false,
        status: isAttemptControlRateLimited(attemptResult.error) ? 429 : 409,
        body: {
          error: attemptResult.error,
          rule: attemptResult.rule,
          attempt_control: attemptResult.attemptControl,
          retry_after: attemptResult.retryAfterSeconds,
        },
      };
    }
  }

  const styleDefaults = mapStyleToDefaults(advisor?.negotiationStyle);
  const sellerStrategy = listingContext.sellerStrategy;
  const sellerNegotiationAgentBuilderMemory = listingContext.sellerNegotiationAgentBuilderMemory;
  if (!sellerStrategy) {
    return { ok: false, status: 409, body: { error: "LISTING_STRATEGY_INCOMPLETE" } };
  }

  const buyerRequestedStrategy = {
    style: styleDefaults.style,
    p_reservation: buyerReservation,
    p_target: buyerTarget,
    p_initial: buyerTarget,
    t_max: timeTotalMs,
    created_at_ms: listedAtMs,
    deadline_at_ms: effectiveDeadlineMs,
    alpha: styleDefaults.alpha,
    thresholds: styleDefaults.thresholds,
    concession: styleDefaults.concession,
    agent: {
      preset_id: body.negotiation_agent_preset_id,
      weights: body.agent_weights ?? null,
      overrides: body.agent_overrides ?? null,
    },
    ...(advisor ? { negotiation_agent_builder_memory: advisor } : {}),
  };

  const AUTO_PLAY_MAX_ROUNDS = Math.min(
    8,
    attemptControl?.max_rounds_per_session ?? defaultAttemptControlPolicy().maxRoundsPerSession,
  );

  const buyerParams = resolveRequestedTuning(
    body.negotiation_agent_preset_id,
    body.agent_weights,
    body.agent_overrides,
  );

  const buyerCompiled = compileNegotiationAgentSnapshot({
    role: "BUYER",
    userId: buyer.id,
    strategyId: `buyer_${body.negotiation_agent_preset_id}`,
    preset: body.negotiation_agent_preset_id,
    params: buyerParams,
    listing: {
      id: listing.id,
      category: null,
      condition: null,
      targetPriceMinor: buyerTarget,
      floorPriceMinor: buyerReservation,
      listedAtMs,
      deadlineAtMs: effectiveDeadlineMs,
    },
    nowMs,
  });

  const listingContextSnapshot = listingContext.listingContext;
  const sellerFacts = projectSellerFacts(
    sellerNegotiationAgentBuilderMemory?.categoryCriteria as CategoryCriterion[] | undefined,
  );
  const sharedListingContext = {
    ...((listingContextSnapshot as object | undefined) ?? {}),
    ...(sellerFacts.length > 0 ? { seller_facts: sellerFacts } : {}),
    published_ask_minor: askMinor,
  };
  const sellerNegotiationAgentPresetId = listingContext.sellerNegotiationAgentPresetId;
  const defaultRoute = resolveDecideModel({ publishedAskMinor: askMinor });
  const listingRequestedModel =
    typeof listingSnapshot?.seller_requested_model === "string"
      ? listingSnapshot.seller_requested_model.trim()
      : undefined;
  const sellerAllowedModel =
    listingRequestedModel && isDecideCatalogModel(listingRequestedModel)
      ? listingRequestedModel
      : defaultRoute.model;
  const sellerOwnBetter = sellerAllowedModel !== defaultRoute.model;
  const buyerCreditQuote = quoteNegotiationCredits({
    role: "buyer",
    publishedAskMinor: askMinor,
    haggleEnv: process.env.HAGGLE_ENV,
  });
  const sellerCreditQuote = quoteNegotiationCredits({
    role: "seller",
    publishedAskMinor: askMinor,
    ownBetterModel: sellerOwnBetter,
    haggleEnv: process.env.HAGGLE_ENV,
  });
  const listingOffer = parseSellerFulfillmentOffer(listingSnapshot?.sellerFulfillmentOffer);
  const listingParcel =
    parseListingParcel(listingSnapshot?.parcel) ?? listingContext.listingContext?.parcel;
  let fulfillment = body.fulfillment as FulfillmentPreference | undefined;
  if (fulfillment && listingOffer) {
    const allowed = new Set(listingOffer.options.map((option) => option.method));
    const methods = fulfillment.methods.filter((method) => allowed.has(method));
    if (methods.length === 0) {
      return {
        ok: false,
        status: 400,
        body: {
          error: "FULFILLMENT_NOT_OFFERED",
          message: "Choose at least one delivery method the seller offered.",
        },
      };
    }
    fulfillment = {
      ...fulfillment,
      methods,
      preferred:
        fulfillment.preferred && methods.includes(fulfillment.preferred)
          ? fulfillment.preferred
          : methods[0],
      seller_offer: fulfillment.seller_offer ?? listingOffer,
    };
  }
  if (fulfillment && (listingParcel || fulfillment.methods.includes("carrier"))) {
    fulfillment = {
      ...fulfillment,
      ...(listingParcel ? { parcel: fulfillment.parcel ?? listingParcel } : {}),
      ...(fulfillment.methods.includes("carrier")
        ? { carrier_priority: fulfillment.carrier_priority ?? "balanced" }
        : {}),
    };
  }
  const fulfillmentFields = snapshotFulfillmentFields(fulfillment);
  const sellerSnapshot: Record<string, unknown> = {
    ...sellerStrategy,
    max_rounds: AUTO_PLAY_MAX_ROUNDS,
    agent_weights: sellerStrategy.weights,
    agent_overrides: {
      alpha: sellerStrategy.alpha,
      beta: sellerStrategy.beta,
      u_threshold: sellerStrategy.u_threshold,
      u_aspiration: sellerStrategy.u_aspiration,
      anchor_ratio: sellerStrategy.anchor_ratio,
      v_t_floor: sellerStrategy.v_t_floor,
      w_rep: sellerStrategy.w_rep,
      v_s_base: sellerStrategy.v_s_base,
      n_threshold: sellerStrategy.n_threshold,
    },
    ...(sellerNegotiationAgentBuilderMemory
      ? { seller_negotiation_agent_builder_memory: sellerNegotiationAgentBuilderMemory }
      : {}),
    listing_context: sharedListingContext,
    ...(sellerNegotiationAgentPresetId
      ? { negotiation_agent_preset_id: sellerNegotiationAgentPresetId }
      : {}),
    allowed_model: sellerAllowedModel,
    credit_quote: sellerCreditQuote,
    buyer_requested_strategy: buyerRequestedStrategy,
    ...fulfillmentFields,
  };
  // Same source as the web wizard: listing.negotiationAgentSnapshot via
  // extractSellerRequiredCriteria. listingContext memory is not the gate -
  // required checks without a seller stance on that memory were dropped, the
  // gate became a no-op, and createSession still ran.
  const sellerRequiredCriteria: CategoryCriterion[] = snapshotRequired.map((c) => {
    const projected: CategoryCriterion = {
      checkId: c.checkId,
      questionKo: c.ask,
      enforcement: "hard",
      requirement: "required",
    };
    if (c.ask) projected.buyerAskKo = c.ask;
    return projected;
  });
  const buyerTags = [
    (listingContextSnapshot as { category?: string } | undefined)?.category,
    ...((listingContextSnapshot as { tags?: string[] } | undefined)?.tags ?? []),
  ].filter((tag): tag is string => typeof tag === "string" && tag.length > 0);
  const rawBuyerCriteria =
    body.buyerCriteria ?? (advisor as { categoryCriteria?: unknown } | undefined)?.categoryCriteria;
  const cleanedBuyerCriteria = sanitizeBuyerCriteriaInput(
    rawBuyerCriteria,
    buyerTags,
    sellerRequiredCriteria,
  );
  let buyerAdvisor = advisor;
  if (cleanedBuyerCriteria) {
    buyerAdvisor = { ...(advisor ?? {}), categoryCriteria: cleanedBuyerCriteria };
  }
  const buyerSnapshot: Record<string, unknown> = {
    ...buyerCompiled,
    max_rounds: AUTO_PLAY_MAX_ROUNDS,
    ...(buyerAdvisor ? { buyer_negotiation_agent_builder_memory: buyerAdvisor } : {}),
    ...(sellerRequiredCriteria.length > 0
      ? { pause_seller_required_criteria: sellerRequiredCriteria }
      : {}),
    listing_context: sharedListingContext,
    allowed_model: defaultRoute.model,
    credit_quote: buyerCreditQuote,
    negotiation_agent_preset_id: body.negotiation_agent_preset_id,
    ...(body.agent_weights ? { agent_weights: body.agent_weights } : {}),
    ...(body.agent_overrides ? { agent_overrides: body.agent_overrides } : {}),
    buyer_requested_strategy: buyerRequestedStrategy,
    ...fulfillmentFields,
  };

  // Listing snapshot is the web-wizard source. Required + empty buyerCriteria
  // rejects with no session; do not 202 after createSession.
  if (snapshotRequired.length > 0 && !buyerHasAnsweredCriteria(cleanedBuyerCriteria ?? [])) {
    return {
      ok: false,
      status: 409,
      body: {
        error: BUYER_CRITERIA_REQUIRED,
        message:
          "Answer seller required criteria (IMEI/완납/침수/Find My) in the start wizard via buyerCriteria before play_next. Do not use answer_pause.",
        required_check_ids: snapshotRequired.map((c) => c.checkId),
        required_criteria: snapshotRequired,
      },
    };
  }

  const criteriaReject = buyerCriteriaRequiredReject(buyerSnapshot);
  if (criteriaReject) {
    return { ok: false, status: 409, body: criteriaReject };
  }

  const strategyId = sellerStrategy.compiler.selected_playbook;
  const expiresAt = new Date(effectiveDeadlineMs);
  const autoPlay = createNegotiationAutoPlaySetup({
    buyerSnapshot,
    sellerSnapshot,
    buyerTargetMinor: buyerTarget,
    maxRounds: AUTO_PLAY_MAX_ROUNDS,
  });

  try {
    await assertListingAcceptsNewSession(db, listing.id);
  } catch (error) {
    if (error instanceof ListingClaimError) {
      const mapped = LISTING_CLAIM_HTTP[error.code];
      return {
        ok: false,
        status: mapped.status,
        body: { error: mapped.error, message: error.code },
      };
    }
    throw error;
  }
  const session = await createSession(db, {
    listingId: listing.id,
    strategyId,
    role: "SELLER",
    buyerId: buyer.id,
    sellerId: listing.sellerId,
    counterpartyId: buyer.id,
    negotiationAgentSnapshot: autoPlay.sellerSnapshot,
    expiresAt,
    driver: input.driver,
  });

  if (!input.isGuest && body.fulfillment?.save_address && body.fulfillment.buyer_address) {
    await saveBuyerDefaultAddress(db, buyer.id, body.fulfillment.buyer_address).catch((err) => {
      console.error("[negotiations] save default address failed:", (err as Error).message);
    });
  }

  return {
    ok: true,
    status: 202,
    body: {
      session_id: session.id,
      status: session.status,
      run_token: autoPlay.runToken,
      driver: input.driver,
      ...(input.isGuest ? { guest_buyer_id: buyer.id } : {}),
      ...(attemptControl ? { attempt_control: attemptControl } : {}),
      ...(input.chatUrl ? { chat_url: input.chatUrl } : {}),
    },
  };
}

function sanitizeBuyerCriteriaInput(
  raw: unknown,
  tags: string[],
  sellerRequired: readonly CategoryCriterion[],
): CategoryCriterion[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const scaffoldById = new Map(buildCategoryCriteriaScaffold(tags).map((c) => [c.checkId, c]));
  const requiredById = new Map(sellerRequired.map((c) => [c.checkId, c]));
  return (raw as Array<{ checkId?: unknown; stance?: unknown }>)
    .filter((c) => typeof c?.checkId === "string")
    .slice(0, 40)
    .flatMap((c) => {
      const checkId = c.checkId as string;
      const base = scaffoldById.get(checkId) ?? requiredById.get(checkId);
      if (!base) return [];
      const merged: CategoryCriterion = {
        ...base,
        requirement: base.enforcement === "hard" ? "required" : base.requirement,
      };
      if (typeof c.stance === "string" && c.stance.trim().length > 0) {
        merged.stance = c.stance.trim();
      }
      return [merged];
    });
}

function toMinorOrUndefined(value: number | undefined | null): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(value * 100);
}

const ENGINE_PARAM_KEYS = [
  "alpha",
  "beta",
  "u_threshold",
  "u_aspiration",
  "anchor_ratio",
  "v_t_floor",
  "w_rep",
  "v_s_base",
  "n_threshold",
  "late_round_aggression_modifier",
  "gamma",
] as const;

function pickNumericFields(raw: Record<string, unknown> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw) return out;
  for (const key of ENGINE_PARAM_KEYS) {
    const v = raw[key];
    if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
  }
  return out;
}

function defaultEngineParameters(): EngineParameters {
  const preset = getNegotiationAgentPreset("balancer");
  return presetToEngineParameters(preset!);
}

function resolveRequestedTuning(
  presetId: string | undefined,
  weights: Record<string, number> | undefined,
  overrides: Record<string, unknown> | undefined,
): EngineParamsInput {
  const preset = presetId ? getNegotiationAgentPreset(presetId) : undefined;
  const base = preset ? presetToEngineParameters(preset) : defaultEngineParameters();
  const overrideParams = pickNumericFields(overrides);

  const resolvedWeights =
    weights && ["w_p", "w_t", "w_r", "w_s"].every((k) => typeof weights[k] === "number")
      ? {
          w_p: weights.w_p as number,
          w_t: weights.w_t as number,
          w_r: weights.w_r as number,
          w_s: weights.w_s as number,
        }
      : base.weights;

  return { ...base, ...overrideParams, weights: resolvedWeights };
}

function mapStyleToDefaults(style: string | undefined): {
  style: string;
  alpha: { price: number; time: number; reputation: number; satisfaction: number };
  thresholds: { accept: number; counter: number; reject: number; near_deal: number };
  concession: { beta: number; k: number };
} {
  switch (style) {
    case "aggressive":
      return {
        style: "aggressive",
        alpha: { price: 0.55, time: 0.15, reputation: 0.15, satisfaction: 0.15 },
        thresholds: { accept: 0.82, counter: 0.5, reject: 0.25, near_deal: 0.75 },
        concession: { beta: 0.35, k: 0.8 },
      };
    case "defensive":
      return {
        style: "patient",
        alpha: { price: 0.4, time: 0.15, reputation: 0.3, satisfaction: 0.15 },
        thresholds: { accept: 0.7, counter: 0.4, reject: 0.18, near_deal: 0.65 },
        concession: { beta: 0.5, k: 1.0 },
      };
    default:
      return {
        style: "balanced",
        alpha: { price: 0.4, time: 0.25, reputation: 0.2, satisfaction: 0.15 },
        thresholds: { accept: 0.78, counter: 0.45, reject: 0.2, near_deal: 0.72 },
        concession: { beta: 0.6, k: 1.2 },
      };
  }
}

async function saveBuyerDefaultAddress(
  db: Database,
  userId: string,
  address: BuyerShippingAddress,
) {
  await db
    .update(userSavedAddresses)
    .set({ isDefault: false })
    .where(and(eq(userSavedAddresses.userId, userId), eq(userSavedAddresses.isDefault, true)));

  await db.insert(userSavedAddresses).values({
    userId,
    label: "home",
    name: address.name,
    street1: address.street1,
    street2: address.street2 ?? null,
    city: address.city,
    state: address.state,
    zip: address.zip,
    country: address.country,
    phone: address.phone ?? null,
    isDefault: true,
  });
}
