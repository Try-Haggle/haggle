/**
 * HFMI Tag Resolver — Cascading Tag Garden → HFMI Query
 *
 * Resolves tag garden attributes to the best available HFMI price signal
 * using a cascading specificity strategy:
 *
 *   Level 1: model + storage + condition  (most specific)
 *   Level 2: model + storage
 *   Level 3: model (all variants)
 *   Level 4: series (e.g., all iPhone 15 = Pro + Pro Max)
 *   Level 5: category fallback (e.g., all smartphones)
 *
 * Stops at the first level with ≥ MIN_SAMPLE_SIZE observations.
 *
 * Design principle: this is REFERENCE data, not a price constraint.
 * See memory: "HFMI external data is reference only"
 */

import type { Database } from "@haggle/db";
import { getMedianPrice, type MedianPriceResult } from "./hfmi.service.js";

// ─── Config ───────────────────────────────────────────────────────────

/** Minimum observations needed at a specificity level to trust the median */
const MIN_SAMPLE_SIZE = 10;

// ─── Types ────────────────────────────────────────────────────────────

export interface TagAttributes {
  brand?: string;       // e.g. "apple", "samsung"
  model?: string;       // e.g. "iphone_15_pro", "galaxy_s24_ultra"
  storage_gb?: number;  // e.g. 128, 256, 512
  condition?: string;   // e.g. "A", "B", "C" or "mint", "good", "fair"
  carrier?: string;     // e.g. "unlocked", "att", "verizon"
  category?: string;    // e.g. "smartphones", "laptops", "gaming"
}

export interface HfmiResolution {
  median_usd: number;
  sample_count: number;
  confidence_level: 1 | 2 | 3 | 4 | 5;
  confidence_label: string;
  query_used: string;
}

// ─── Series Mapping ───────────────────────────────────────────────────

/** Group related models into a "series" for Level 4 fallback */
const SERIES_MAP: Record<string, string[]> = {
  // iPhone series
  iphone_15: ["iphone_15_pro", "iphone_15_pro_max"],
  iphone_14: ["iphone_14_pro", "iphone_14_pro_max"],
  iphone_13: ["iphone_13_pro", "iphone_13_pro_max"],

  // Samsung Galaxy S series
  galaxy_s24: ["galaxy_s24_ultra", "galaxy_s24_plus"],
  galaxy_s23: ["galaxy_s23_ultra", "galaxy_s23_plus"],

  // Pixel series
  pixel_9: ["pixel_9_pro"],
  pixel_8: ["pixel_8_pro"],

  // MacBook series
  macbook_m3: ["macbook_pro_14_m3", "macbook_air_15_m3"],
  macbook_m2: ["macbook_pro_14_m2", "macbook_air_13_m2"],

  // iPad series
  ipad_pro: ["ipad_pro_12_m2", "ipad_pro_11_m4"],

  // Gaming
  ps5: ["ps5_disc", "ps5_digital"],
  steam_deck: ["steam_deck_512", "steam_deck_oled"],

  // Audio
  airpods: ["airpods_pro_2", "airpods_max"],
  sony_headphones: ["sony_wh1000xm5", "sony_wf1000xm5"],
};

/** Reverse lookup: model → series key */
const MODEL_TO_SERIES: Record<string, string> = {};
for (const [series, models] of Object.entries(SERIES_MAP)) {
  for (const model of models) {
    MODEL_TO_SERIES[model] = series;
  }
}

/** Category mapping for Level 5 */
const MODEL_TO_CATEGORY: Record<string, string> = {
  // Populated dynamically, but hardcode major ones
  iphone_13_pro: "smartphones", iphone_13_pro_max: "smartphones",
  iphone_14_pro: "smartphones", iphone_14_pro_max: "smartphones",
  iphone_15_pro: "smartphones", iphone_15_pro_max: "smartphones",
  galaxy_s24_ultra: "smartphones", galaxy_s24_plus: "smartphones",
  galaxy_s23_ultra: "smartphones", galaxy_s23_plus: "smartphones",
  pixel_9_pro: "smartphones", pixel_8_pro: "smartphones",
  macbook_pro_14_m3: "laptops", macbook_pro_14_m2: "laptops",
  macbook_air_15_m3: "laptops", macbook_air_13_m2: "laptops",
  ipad_pro_12_m2: "tablets", ipad_pro_11_m4: "tablets", ipad_air_m2: "tablets",
  ps5_disc: "gaming", ps5_digital: "gaming", switch_oled: "gaming",
  steam_deck_512: "gaming", steam_deck_oled: "gaming",
  airpods_pro_2: "audio", airpods_max: "audio",
  sony_wh1000xm5: "audio", sony_wf1000xm5: "audio",
};

// ─── Tag Extraction ───────────────────────────────────────────────────

/** Normalize condition string to A/B/C grade */
function normalizeCondition(condition?: string): string | undefined {
  if (!condition) return undefined;
  const lower = condition.toLowerCase();
  if (/^a$|mint|excellent|like.new|pristine/i.test(lower)) return "A";
  if (/^c$|fair|poor|acceptable/i.test(lower)) return "C";
  if (/^b$|good|great|very.good/i.test(lower)) return "B";
  return "B"; // default to B
}

/**
 * Extract HFMI-relevant attributes from a tag garden.
 * Tag garden format: array of { name, category } or key-value pairs.
 */
export function extractTagAttributes(
  tagGarden: Array<{ name: string; category?: string }> | Record<string, string>,
): TagAttributes {
  const attrs: TagAttributes = {};

  if (Array.isArray(tagGarden)) {
    for (const tag of tagGarden) {
      const name = tag.name.toLowerCase();
      const cat = (tag.category || "").toLowerCase();

      if (cat === "brand" || /^(apple|samsung|google|sony|nintendo|valve)$/i.test(name)) {
        attrs.brand = name;
      } else if (cat === "model" || /iphone|galaxy|pixel|macbook|ipad|ps5|switch|steam.deck|airpods|wh-?1000|wf-?1000/i.test(name)) {
        attrs.model = name.replace(/[\s-]+/g, "_").replace(/_+/g, "_");
      } else if (cat === "storage" || /^\d+\s*(gb|tb)$/i.test(name)) {
        const match = name.match(/(\d+)\s*(gb|tb)/i);
        if (match) {
          attrs.storage_gb = match[2].toLowerCase() === "tb"
            ? parseInt(match[1]) * 1024
            : parseInt(match[1]);
        }
      } else if (cat === "condition" || /mint|excellent|good|fair|grade/i.test(name)) {
        attrs.condition = name;
      } else if (cat === "carrier" || /unlocked|locked|at&?t|verizon|t-?mobile/i.test(name)) {
        attrs.carrier = name;
      } else if (cat === "category") {
        attrs.category = name;
      }
    }
  } else {
    // Key-value format
    if (tagGarden.brand) attrs.brand = tagGarden.brand.toLowerCase();
    if (tagGarden.model) attrs.model = tagGarden.model.toLowerCase().replace(/[\s-]+/g, "_");
    if (tagGarden.storage) {
      const match = tagGarden.storage.match(/(\d+)/);
      if (match) attrs.storage_gb = parseInt(match[1]);
    }
    if (tagGarden.condition) attrs.condition = tagGarden.condition;
    if (tagGarden.carrier) attrs.carrier = tagGarden.carrier;
    if (tagGarden.category) attrs.category = tagGarden.category.toLowerCase();
  }

  return attrs;
}

// ─── Cascading Resolver ───────────────────────────────────────────────

/**
 * Resolve HFMI price signal from tag attributes using cascading specificity.
 * Returns null if no data available at any level.
 */
export async function resolveHfmiFromTags(
  db: Database,
  tags: TagAttributes,
): Promise<HfmiResolution | null> {
  const model = tags.model;
  if (!model) return null;

  const condition = normalizeCondition(tags.condition);

  // Level 1: model + storage + condition
  if (tags.storage_gb && condition) {
    const result = await getMedianPrice(db, model, tags.storage_gb, condition);
    if (result && result.sample_count >= MIN_SAMPLE_SIZE) {
      return {
        median_usd: result.median,
        sample_count: result.sample_count,
        confidence_level: 1,
        confidence_label: "exact_match",
        query_used: `${model}+${tags.storage_gb}GB+${condition}`,
      };
    }
  }

  // Level 2: model + storage
  if (tags.storage_gb) {
    const result = await getMedianPrice(db, model, tags.storage_gb);
    if (result && result.sample_count >= MIN_SAMPLE_SIZE) {
      return {
        median_usd: result.median,
        sample_count: result.sample_count,
        confidence_level: 2,
        confidence_label: "model_storage",
        query_used: `${model}+${tags.storage_gb}GB`,
      };
    }
  }

  // Level 3: model only
  {
    const result = await getMedianPrice(db, model);
    if (result && result.sample_count >= MIN_SAMPLE_SIZE) {
      return {
        median_usd: result.median,
        sample_count: result.sample_count,
        confidence_level: 3,
        confidence_label: "model_all",
        query_used: model,
      };
    }
  }

  // Level 4: series (aggregate sibling models)
  const seriesKey = MODEL_TO_SERIES[model];
  if (seriesKey) {
    const siblings = SERIES_MAP[seriesKey] || [];
    const allPrices: number[] = [];
    let totalCount = 0;

    for (const sibling of siblings) {
      const result = await getMedianPrice(db, sibling);
      if (result && result.sample_count > 0) {
        // Weight each sibling's median by its sample count
        for (let i = 0; i < result.sample_count; i++) {
          allPrices.push(result.median);
        }
        totalCount += result.sample_count;
      }
    }

    if (totalCount >= MIN_SAMPLE_SIZE) {
      allPrices.sort((a, b) => a - b);
      const median = allPrices[Math.floor(allPrices.length / 2)];
      return {
        median_usd: Math.round(median * 100) / 100,
        sample_count: totalCount,
        confidence_level: 4,
        confidence_label: "series_aggregate",
        query_used: `series:${seriesKey} (${siblings.join(", ")})`,
      };
    }
  }

  // Level 5: category fallback — not implemented yet, would need
  // a DB query across all models in the category. For now return null.
  return null;
}
