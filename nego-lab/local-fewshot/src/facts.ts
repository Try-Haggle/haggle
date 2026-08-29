import {
  buildCategoryCriteriaScaffold,
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

/**
 * Stances a published iPhone listing would have after the seller builder.
 * Attribute sweeps override storage / battery / screen / lock.
 * HARD gates use the first clean sellerOption so auto-play is not PAUSE'd.
 */
function stancesFromAttributes(attributes: ItemSpec["attributes"]): Record<string, string> {
  const out: Record<string, string> = {
    working_status: "fully working, no functional defects",
    cosmetic_grade: scratchStance(attributes.scratches),
    imei_verification: "clean IMEI, not blacklisted, verifiable",
    find_my_status: "Find My / activation lock is off",
    financing_paid_off: "fully paid off, no balance",
    water_damage: "no liquid damage, LCI clean",
  };
  if (attributes.storage != null) out.storage_capacity = storageStance(attributes.storage);
  if (attributes.batteryHealth != null)
    out.battery_health = batteryStance(attributes.batteryHealth);
  if (attributes.scratches != null) out.screen_condition = scratchStance(attributes.scratches);
  if (attributes.carrierLock != null) out.carrier_lock = lockStance(attributes.carrierLock);
  return out;
}

export interface PublishedSellerListing {
  category: typeof STAGING_LISTING_CATEGORY;
  tags: string[];
  categoryCriteria: CategoryCriterion[];
}

/**
 * Same assembly as staging auto-detect degrade + seller builder:
 * category + title → enrichTagsWithTaxonomy (tag garden)
 * tags → buildCategoryCriteriaScaffold → seller stances
 */
export function buildPublishedSellerListing(item: ItemSpec): PublishedSellerListing {
  const { tags } = enrichTagsWithTaxonomy([STAGING_LISTING_CATEGORY], item.title);
  const stanceByCheck = stancesFromAttributes(item.attributes);
  const categoryCriteria = buildCategoryCriteriaScaffold(tags).map((c) => {
    const stance = stanceByCheck[c.checkId];
    return stance ? { ...c, stance } : c;
  });
  return { category: STAGING_LISTING_CATEGORY, tags, categoryCriteria };
}

/** Buyer Quick Setup answers for seller HARD gates so auto-play is not PAUSE'd. */
const BUYER_HARD_STANCES: Record<string, string> = {
  imei_verification: "clean IMEI required — not lost or blacklisted",
  financing_paid_off: "fully paid off — no outstanding carrier financing",
  find_my_status: "Find My / activation lock must be off before closing",
  water_damage: "no liquid/water damage — LCI not tripped",
};

export function buildBuyerBriefing(item: ItemSpec): CategoryCriterion[] {
  const { tags } = enrichTagsWithTaxonomy([STAGING_LISTING_CATEGORY], item.title);
  return buildCategoryCriteriaScaffold(tags).map((c) => {
    const stance = BUYER_HARD_STANCES[c.checkId];
    return stance ? { ...c, stance, requirement: "required" as const } : c;
  });
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
