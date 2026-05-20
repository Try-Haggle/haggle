import { eq, listingDrafts, listingsPublished, type Database } from "@haggle/db";
import {
  compileStrategySnapshot,
  type AgentStats,
  type CompiledStrategySnapshot,
} from "@haggle/engine-session";

export interface AdvisorMemorySnapshot {
  budgetMax?: number;
  targetPrice?: number;
  mustHave?: string[];
  avoid?: string[];
  riskStyle?: string;
  negotiationStyle?: string;
  openingTactic?: string;
  // Seller-side advisor (haggle_seller_advisor_turn) shape
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
  sellerStrategy?: CompiledStrategySnapshot;
  sellerAdvisorMemory?: AdvisorMemorySnapshot;
  listingContext?: ListingContext;
  sellerAgentPresetId?: string;
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
  strategyConfig: Record<string, unknown>,
): ListingContext {
  const ctx: ListingContext = {};
  if (base.title) ctx.title = base.title;
  if (base.description) ctx.description = base.description;
  if (base.category) ctx.category = base.category;
  if (base.condition) ctx.condition = base.condition;
  if (base.tags && base.tags.length > 0) ctx.tags = base.tags;
  if (base.photoUrl) ctx.photoUrl = base.photoUrl;
  if (typeof strategyConfig.subtype === "string") ctx.subtype = strategyConfig.subtype;

  const attributes: Record<string, unknown> = {};
  for (const key of CATEGORY_ATTRIBUTE_KEYS) {
    const raw = strategyConfig[key];
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
  strategyConfig: Record<string, unknown>,
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
    const value = strategyConfig[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      stats[key] = value;
      hasStats = true;
    }
  }
  return hasStats ? stats : undefined;
}

export function extractUserPreferenceRef(
  strategyConfig: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const fields = [
    "sellerTimezone",
    "sellingDeadlineLocalDate",
    "sellingDeadlineLocalTime",
    "sellingDeadlineSource",
  ];
  const ref: Record<string, unknown> = {};
  for (const field of fields) {
    if (strategyConfig[field] !== undefined) ref[field] = strategyConfig[field];
  }
  return Object.keys(ref).length > 0 ? ref : undefined;
}

export function extractAdvisorMemory(
  strategyConfig: Record<string, unknown>,
): AdvisorMemorySnapshot | undefined {
  const raw = strategyConfig.advisorMemory;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as AdvisorMemorySnapshot;
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
    strategyConfig: listingDrafts.strategyConfig,
  };

  let row = (
    await db
      .select(columns)
      .from(listingDrafts)
      .where(eq(listingDrafts.id, listingId))
      .limit(1)
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
  const strategyConfig = (row.strategyConfig ?? {}) as Record<string, unknown>;
  const sellerAdvisorMemory = extractAdvisorMemory(strategyConfig);
  const listingContext = extractListingContext(row, strategyConfig);
  const sellerAgentPresetId =
    typeof strategyConfig.preset === "string" ? strategyConfig.preset : undefined;

  const sellerStrategy =
    askPriceMinor && floorPriceMinor
      ? compileStrategySnapshot({
          role: "SELLER",
          userId: row.userId ?? undefined,
          strategyId:
            typeof strategyConfig.preset === "string"
              ? `seller_${strategyConfig.preset}`
              : "seller_compiled",
          preset:
            typeof strategyConfig.preset === "string"
              ? strategyConfig.preset
              : undefined,
          agentStats: extractAgentStats(strategyConfig),
          userPreferences: extractUserPreferenceRef(strategyConfig),
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
    sellerAdvisorMemory,
    listingContext,
    sellerAgentPresetId,
  };
}
