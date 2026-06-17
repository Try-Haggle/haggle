import { type Database, eq, listingDrafts, listingsPublished } from "@haggle/db";
import {
  type AgentStats,
  type CompiledNegotiationAgentSnapshot,
  compileNegotiationAgentSnapshot,
} from "@haggle/engine-session";

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
  subtype?: string;
  attributes?: Record<string, unknown>;
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

const CATEGORY_ATTRIBUTE_KEYS = ["phoneAnswers"] as const;

export function extractListingContext(
  base: {
    title?: string | null;
    description?: string | null;
    category?: string | null;
    condition?: string | null;
    tags?: string[] | null;
    photoUrl?: string | null;
  },
  negotiationAgentSnapshot: Record<string, unknown>,
): ListingContext {
  const ctx: ListingContext = {};
  if (base.title) ctx.title = base.title;
  if (base.description) ctx.description = base.description;
  if (base.category) ctx.category = base.category;
  if (base.condition) ctx.condition = base.condition;
  if (base.tags && base.tags.length > 0) ctx.tags = base.tags;
  if (base.photoUrl) ctx.photoUrl = base.photoUrl;
  if (typeof negotiationAgentSnapshot.subtype === "string")
    ctx.subtype = negotiationAgentSnapshot.subtype;

  const attributes: Record<string, unknown> = {};
  for (const key of CATEGORY_ATTRIBUTE_KEYS) {
    const raw = negotiationAgentSnapshot[key];
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (v === null || v === undefined || v === "") continue;
        attributes[k] = v;
      }
    }
  }
  if (Object.keys(attributes).length > 0) ctx.attributes = attributes;

  return ctx;
}

function majorPriceToMinor(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : undefined;
}

export function extractAgentStats(
  negotiationAgentSnapshot: Record<string, unknown>,
): AgentStats | undefined {
  const keys = [
    "priceAggression",
    "patienceLevel",
    "riskTolerance",
    "speedBias",
    "detailFocus",
  ] as const;
  const stats: AgentStats = {};
  let hasStats = false;
  for (const key of keys) {
    const value = negotiationAgentSnapshot[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      stats[key] = value;
      hasStats = true;
    }
  }
  return hasStats ? stats : undefined;
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
          agentStats: extractAgentStats(negotiationAgentSnapshot),
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
