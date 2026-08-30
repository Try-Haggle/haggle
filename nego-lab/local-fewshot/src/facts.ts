import {
  buildBuyerChoiceQuestions,
  buildCategoryCriteriaScaffold,
  buildSellerChoiceQuestions,
  type CategoryCriterion,
  enrichTagsWithTaxonomy,
} from "@haggle/shared";
import type { ItemSpec } from "../../src/types.js";

/** Seller-wizard category. Staging listings do not use "phone". */
export const STAGING_LISTING_CATEGORY = "electronics";

function storageStance(value: unknown): string {
  const raw = String(value ?? "").toUpperCase();
  if (raw.includes("1TB")) return "1TB or larger storage";
  if (raw.includes("512")) return "512GB storage";
  if (raw.includes("128")) return "128GB storage";
  return "256GB storage";
}

function batteryStance(value: unknown): string {
  const n = Number(String(value ?? "").replace("%", ""));
  if (Number.isFinite(n) && n >= 90) return "battery health 90% or higher";
  if (Number.isFinite(n) && n >= 80) return "battery health between 80% and 89%";
  if (Number.isFinite(n)) return "battery health below 80%";
  return "battery health not checked";
}

function scratchStance(value: unknown): string {
  const raw = String(value ?? "").toLowerCase();
  if (!raw || raw === "none") return "mint screen, no marks";
  if (raw.includes("crack")) return "screen cracked or has dead pixels";
  return "screen has minor scratches";
}

function lockStance(value: unknown): string {
  const raw = String(value ?? "").toLowerCase();
  if (raw.includes("lock") && !raw.includes("unlock")) return "locked to a carrier";
  return "carrier-unlocked";
}

/** Attribute sweeps override storage / battery / screen / lock when those cards exist. */
function attributeOverrides(attributes: ItemSpec["attributes"]): Record<string, string> {
  const out: Record<string, string> = {};
  if (attributes.storage != null) out.storage_capacity = storageStance(attributes.storage);
  if (attributes.batteryHealth != null)
    out.battery_health = batteryStance(attributes.batteryHealth);
  if (attributes.scratches != null) out.screen_condition = scratchStance(attributes.scratches);
  if (attributes.carrierLock != null) out.carrier_lock = lockStance(attributes.carrierLock);
  if (attributes.condition != null) {
    out.working_status = "fully working, no functional defects";
  }
  return out;
}

function firstOptionStance(options: Array<{ stance: string }> | undefined): string | undefined {
  return options?.[0]?.stance;
}

/**
 * Fill every opened HARD (and any attribute-overridden SOFT) from taxonomy
 * options. AirPods get authenticity + Find My unpaired — not IMEI.
 */
function fillCriteria(
  tags: string[],
  attributes: ItemSpec["attributes"],
  side: "seller" | "buyer",
): CategoryCriterion[] {
  const overrides = attributeOverrides(attributes);
  const questions =
    side === "seller" ? buildSellerChoiceQuestions(tags) : buildBuyerChoiceQuestions(tags);
  const optionById = new Map(questions.map((q) => [q.checkId, q.options]));
  return buildCategoryCriteriaScaffold(tags).map((c) => {
    const stance =
      overrides[c.checkId] ??
      (c.enforcement === "hard" ? firstOptionStance(optionById.get(c.checkId)) : undefined);
    if (!stance) return c;
    return {
      ...c,
      stance,
      requirement: c.enforcement === "hard" ? ("required" as const) : c.requirement,
    };
  });
}

export interface PublishedSellerListing {
  category: typeof STAGING_LISTING_CATEGORY;
  tags: string[];
  categoryCriteria: CategoryCriterion[];
}

/**
 * Same assembly as staging auto-detect degrade + seller builder:
 * category + title → enrichTagsWithTaxonomy (tag garden)
 * tags → buildCategoryCriteriaScaffold → every HARD filled
 */
export function buildPublishedSellerListing(item: ItemSpec): PublishedSellerListing {
  const { tags } = enrichTagsWithTaxonomy([STAGING_LISTING_CATEGORY], item.title);
  return {
    category: STAGING_LISTING_CATEGORY,
    tags,
    categoryCriteria: fillCriteria(tags, item.attributes, "seller"),
  };
}

export function buildBuyerBriefing(item: ItemSpec): CategoryCriterion[] {
  const { tags } = enrichTagsWithTaxonomy([STAGING_LISTING_CATEGORY], item.title);
  return fillCriteria(tags, item.attributes, "buyer");
}

/** @deprecated use buildPublishedSellerListing — kept for older lab callers */
export function attributesToCriteria(attributes: ItemSpec["attributes"]): CategoryCriterion[] {
  return buildPublishedSellerListing({
    title: "iPhone 15 Pro 256GB",
    category: STAGING_LISTING_CATEGORY,
    condition: "good",
    askPrice: 900,
    floorPrice: 780,
    deadlineHours: 7 * 24,
    attributes,
  }).categoryCriteria;
}

export const LAB_PARCEL = { weight_oz: 16, length_in: 8, width_in: 5, height_in: 2 };

export const LAB_SELLER_OFFER = {
  options: [{ method: "carrier" as const }],
  preferred: "carrier" as const,
};

export const LAB_FULFILLMENT = {
  methods: ["carrier" as const],
  preferred: "carrier" as const,
  carrier_priority: "balanced" as const,
  buyer_address: {
    name: "Lab Buyer",
    street1: "100 Main St",
    city: "Denver",
    state: "CO",
    zip: "80202",
    country: "US",
  },
};
