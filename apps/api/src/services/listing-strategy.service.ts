import { type Database, eq, listingDrafts, listingsPublished } from "@haggle/db";
import {
  type CompiledNegotiationAgentSnapshot,
  compileNegotiationAgentSnapshot,
  type EngineParamsInput,
} from "@haggle/engine-session";
import {
  type CategoryCriterion,
  criterionAnswered,
  DEFAULT_NEGOTIATION_AGENT_PRESET_ID,
  type EngineParameters,
  getNegotiationAgentPreset,
  presetToEngineParameters,
  requiredCriteria,
  type SellerProductFact,
  sellerProductFacts,
} from "@haggle/shared";
import { parseListingParcel } from "../lib/negotiation-fulfillment.js";

/** Resolve the canonical default preset's parameters (balancer). */
function defaultEngineParameters(): EngineParameters {
  const preset =
    getNegotiationAgentPreset(DEFAULT_NEGOTIATION_AGENT_PRESET_ID) ??
    getNegotiationAgentPreset("balancer");
  // balancer always exists; the non-null assertion is safe.
  return presetToEngineParameters(preset!);
}

export interface NegotiationAgentBuilderMemorySnapshot {
  budgetMax?: number;
  targetPrice?: number;
  mustHave?: string[];
  avoid?: string[];
  riskStyle?: string;
  negotiationStyle?: string;
  openingTactic?: string;
  // Seller-side advisor (haggle_seller_negotiation_agent_builder_turn) shape
  dealBreakers?: string[];
  mustEmphasize?: string[];
  tone?: string;
  urgency?: string;
  notes?: string[];
  /** Phase G taxonomy-keyed criteria (deterministic layer). */
  categoryCriteria?: CategoryCriterion[];
  [key: string]: unknown;
}

/**
 * Item-level context surfaced to the negotiation LLM. Captures everything a
 * human negotiator would naturally reference: the headline copy, the photo,
 * the category-specific facts the seller filled out in the wizard (phone
 * storage, battery, scratches, carrier lock, etc.).
 */
export interface ListingContext {
  title?: string;
  description?: string;
  category?: string;
  condition?: string;
  tags?: string[];
  photoUrl?: string;
  attributes?: Record<string, unknown>;
  parcel?: {
    weight_oz: number;
    length_in?: number;
    width_in?: number;
    height_in?: number;
  };
}

export interface ListingStrategyContext {
  listingId: string;
  sellerId: string | null;
  listedAtMs: number;
  deadlineAtMs?: number;
  askPriceMinor?: number;
  floorPriceMinor?: number;
  sellerStrategy?: CompiledNegotiationAgentSnapshot;
  sellerNegotiationAgentBuilderMemory?: NegotiationAgentBuilderMemorySnapshot;
  listingContext?: ListingContext;
  sellerNegotiationAgentPresetId?: string;
}

export function extractListingContext(
  base: {
    title?: string | null;
    description?: string | null;
    category?: string | null;
    condition?: string | null;
    tags?: string[] | null;
    photoUrl?: string | null;
  },
  negotiationAgentSnapshot?: Record<string, unknown>,
): ListingContext {
  const ctx: ListingContext = {};
  if (base.title) ctx.title = base.title;
  if (base.description) ctx.description = base.description;
  if (base.category) ctx.category = base.category;
  if (base.condition) ctx.condition = base.condition;
  if (base.tags && base.tags.length > 0) ctx.tags = base.tags;
  if (base.photoUrl) ctx.photoUrl = base.photoUrl;

  const parcel = parseListingParcel(negotiationAgentSnapshot?.parcel);
  if (parcel) ctx.parcel = parcel;

  return ctx;
}

function majorPriceToMinor(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : undefined;
}

function extractWeights(raw: unknown): EngineParameters["weights"] | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const keys = ["w_p", "w_t", "w_r", "w_s"] as const;
  const out: Record<string, number> = {};
  for (const k of keys) {
    const v = r[k];
    if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
    out[k] = v;
  }
  return out as EngineParameters["weights"];
}

function numericFields(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

/**
 * Resolve the agent's personality (the single EngineParameters form) from a
 * stored listing snapshot. Precedence: the snapshot's own `weights`/`engineParams`
 * (written by the agent builder) → the named preset → the balancer default.
 * This guarantees real parameters reach the compiler instead of a flat default.
 */
export function resolveSnapshotParams(
  negotiationAgentSnapshot: Record<string, unknown>,
): EngineParamsInput {
  const presetId =
    typeof negotiationAgentSnapshot.preset === "string"
      ? negotiationAgentSnapshot.preset
      : undefined;
  const preset = presetId ? getNegotiationAgentPreset(presetId) : undefined;
  const base = preset ? presetToEngineParameters(preset) : defaultEngineParameters();

  const weights = extractWeights(negotiationAgentSnapshot.weights) ?? base.weights;
  const overrides = numericFields(negotiationAgentSnapshot.engineParams);

  return { ...base, ...overrides, weights };
}

export function extractUserPreferenceRef(
  negotiationAgentSnapshot: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const fields = [
    "sellerTimezone",
    "sellingDeadlineLocalDate",
    "sellingDeadlineLocalTime",
    "sellingDeadlineSource",
  ];
  const ref: Record<string, unknown> = {};
  for (const field of fields) {
    if (negotiationAgentSnapshot[field] !== undefined) ref[field] = negotiationAgentSnapshot[field];
  }
  return Object.keys(ref).length > 0 ? ref : undefined;
}

export function extractNegotiationAgentBuilderMemory(
  negotiationAgentSnapshot: Record<string, unknown>,
): NegotiationAgentBuilderMemorySnapshot | undefined {
  const raw = negotiationAgentSnapshot.negotiationAgentBuilderMemory;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as NegotiationAgentBuilderMemorySnapshot;
  }
  return undefined;
}

/** A buyer-safe view of one seller-required criterion (check id + ask phrasing). */
export type BuyerVisibleSellerCriterion = { checkId: string; ask: string };

/**
 * The seller's REQUIRED category criteria (Phase G), projected to a buyer-safe
 * view: only the check id + a requirement-framed ask. Optional/leverage criteria,
 * the seller's stance wording, negotiation posture, and floor price stay private
 * (matches the public endpoint's redaction contract). Drives Flow 2 (the buyer
 * builder surfaces "the seller requires X" so the buyer mirrors it) and Flow 3
 * (the mid-negotiation pause's must-resolve set).
 */
/**
 * The seller's answered checks that are product FACTS, for the listing page's
 * spec cards. Category-agnostic: any taxonomy check the seller answered with a
 * canonical option publishes, so a laptop or a bike gets specs the same way a
 * phone does — unlike `phoneAnswers`, which only exists for one subtype.
 * Negotiation posture never rides along; see `sellerProductFacts`.
 */
export function extractSellerProductFacts(
  negotiationAgentSnapshot: Record<string, unknown>,
): SellerProductFact[] {
  const memory = extractNegotiationAgentBuilderMemory(negotiationAgentSnapshot);
  const criteria = memory?.categoryCriteria;
  if (!Array.isArray(criteria)) return [];
  return sellerProductFacts(criteria as CategoryCriterion[]);
}

export function extractSellerRequiredCriteria(
  negotiationAgentSnapshot: Record<string, unknown>,
): BuyerVisibleSellerCriterion[] {
  const memory = extractNegotiationAgentBuilderMemory(negotiationAgentSnapshot);
  const criteria = memory?.categoryCriteria;
  if (!Array.isArray(criteria)) return [];
  // Only criteria the seller DELIBERATELY set — required AND answered (a stated
  // stance). The scaffold defaults every HARD taxonomy check to required with no
  // stance, so without the answered filter the buyer would see "[SELLER REQUIRES]"
  // on checks the seller never actually engaged.
  return requiredCriteria(criteria as CategoryCriterion[])
    .filter(criterionAnswered)
    .map((c) => ({
      checkId: c.checkId,
      ask: c.buyerAskKo ?? c.questionKo,
    }));
}

/**
 * Loads the listing's stored strategy context. Accepts either an internal
 * listing id (draft id) or a published listing id. Returns the seller's
 * compiled strategy snapshot plus the advisor memory captured during the
 * listing wizard's strategy chat.
 */
export async function loadListingStrategyContext(
  db: Database,
  listingId: string,
): Promise<ListingStrategyContext | null> {
  const columns = {
    id: listingDrafts.id,
    userId: listingDrafts.userId,
    title: listingDrafts.title,
    description: listingDrafts.description,
    tags: listingDrafts.tags,
    photoUrl: listingDrafts.photoUrl,
    category: listingDrafts.category,
    condition: listingDrafts.condition,
    createdAt: listingDrafts.createdAt,
    sellingDeadline: listingDrafts.sellingDeadline,
    targetPrice: listingDrafts.targetPrice,
    floorPrice: listingDrafts.floorPrice,
    negotiationAgentSnapshot: listingDrafts.negotiationAgentSnapshot,
  };

  let row = (
    await db.select(columns).from(listingDrafts).where(eq(listingDrafts.id, listingId)).limit(1)
  )[0];

  if (!row) {
    row = (
      await db
        .select(columns)
        .from(listingsPublished)
        .innerJoin(listingDrafts, eq(listingDrafts.id, listingsPublished.draftId))
        .where(eq(listingsPublished.id, listingId))
        .limit(1)
    )[0];
  }

  if (!row) return null;

  const askPriceMinor = majorPriceToMinor(row.targetPrice);
  const floorPriceMinor =
    majorPriceToMinor(row.floorPrice) ??
    (askPriceMinor ? Math.round(askPriceMinor * 0.86) : undefined);
  const negotiationAgentSnapshot = (row.negotiationAgentSnapshot ?? {}) as Record<string, unknown>;
  const sellerNegotiationAgentBuilderMemory =
    extractNegotiationAgentBuilderMemory(negotiationAgentSnapshot);
  const listingContext = extractListingContext(row, negotiationAgentSnapshot);
  const sellerNegotiationAgentPresetId =
    typeof negotiationAgentSnapshot.preset === "string"
      ? negotiationAgentSnapshot.preset
      : undefined;

  const sellerParams = resolveSnapshotParams(negotiationAgentSnapshot);

  const sellerStrategy =
    askPriceMinor && floorPriceMinor
      ? compileNegotiationAgentSnapshot({
          role: "SELLER",
          userId: row.userId ?? undefined,
          strategyId:
            typeof negotiationAgentSnapshot.preset === "string"
              ? `seller_${negotiationAgentSnapshot.preset}`
              : "seller_compiled",
          preset:
            typeof negotiationAgentSnapshot.preset === "string"
              ? negotiationAgentSnapshot.preset
              : undefined,
          params: sellerParams,
          userPreferences: extractUserPreferenceRef(negotiationAgentSnapshot),
          listing: {
            id: row.id,
            category: row.category,
            condition: row.condition,
            targetPriceMinor: askPriceMinor,
            floorPriceMinor,
            listedAtMs: row.createdAt.getTime(),
            deadlineAtMs: row.sellingDeadline?.getTime(),
          },
        })
      : undefined;

  return {
    listingId: row.id,
    sellerId: row.userId ?? null,
    listedAtMs: row.createdAt.getTime(),
    deadlineAtMs: row.sellingDeadline?.getTime(),
    askPriceMinor,
    floorPriceMinor,
    sellerStrategy,
    sellerNegotiationAgentBuilderMemory,
    listingContext,
    sellerNegotiationAgentPresetId,
  };
}
