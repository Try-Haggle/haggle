#!/usr/bin/env npx tsx
/**
 * eBay Sold Electronics Market Data Collector — Full Category Sweep
 *
 * Collects eBay sold listing data for iPhones, Samsung, Pixel, MacBooks,
 * iPads, gaming consoles, audio devices.
 *
 * Usage:
 *   npx tsx scripts/crawl-ebay-electronics.ts
 *   npx tsx scripts/crawl-ebay-electronics.ts --db   # insert to DB
 */

import { chromium, type Page } from "playwright";
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

// ─── Config ───────────────────────────────────────────────────────────

interface SearchTarget {
  query: string;
  category: string;
  model: string;
  defaultStorageGb?: number;
}

const TARGETS: SearchTarget[] = [
  // ── iPhones (existing + deeper) ─────────────────────────────────
  { query: "iphone+12+pro+128gb+unlocked", category: "smartphones", model: "iphone_12_pro", defaultStorageGb: 128 },
  { query: "iphone+12+pro+max+unlocked", category: "smartphones", model: "iphone_12_pro_max" },
  { query: "iphone+13+128gb+unlocked", category: "smartphones", model: "iphone_13", defaultStorageGb: 128 },
  { query: "iphone+13+pro+128gb+unlocked", category: "smartphones", model: "iphone_13_pro", defaultStorageGb: 128 },
  { query: "iphone+13+pro+256gb+unlocked", category: "smartphones", model: "iphone_13_pro", defaultStorageGb: 256 },
  { query: "iphone+13+pro+max+unlocked", category: "smartphones", model: "iphone_13_pro_max" },
  { query: "iphone+14+128gb+unlocked", category: "smartphones", model: "iphone_14", defaultStorageGb: 128 },
  { query: "iphone+14+pro+128gb+unlocked", category: "smartphones", model: "iphone_14_pro", defaultStorageGb: 128 },
  { query: "iphone+14+pro+256gb+unlocked", category: "smartphones", model: "iphone_14_pro", defaultStorageGb: 256 },
  { query: "iphone+14+pro+max+unlocked", category: "smartphones", model: "iphone_14_pro_max" },
  { query: "iphone+15+128gb+unlocked", category: "smartphones", model: "iphone_15", defaultStorageGb: 128 },
  { query: "iphone+15+plus+unlocked", category: "smartphones", model: "iphone_15_plus" },
  { query: "iphone+15+pro+128gb+unlocked", category: "smartphones", model: "iphone_15_pro", defaultStorageGb: 128 },
  { query: "iphone+15+pro+256gb+unlocked", category: "smartphones", model: "iphone_15_pro", defaultStorageGb: 256 },
  { query: "iphone+15+pro+512gb+unlocked", category: "smartphones", model: "iphone_15_pro", defaultStorageGb: 512 },
  { query: "iphone+15+pro+max+unlocked", category: "smartphones", model: "iphone_15_pro_max" },
  { query: "iphone+16+128gb+unlocked", category: "smartphones", model: "iphone_16", defaultStorageGb: 128 },
  { query: "iphone+16+pro+128gb+unlocked", category: "smartphones", model: "iphone_16_pro", defaultStorageGb: 128 },
  { query: "iphone+16+pro+max+unlocked", category: "smartphones", model: "iphone_16_pro_max" },

  // ── Samsung Galaxy ──────────────────────────────────────────────
  { query: "samsung+galaxy+s25+ultra+unlocked", category: "smartphones", model: "galaxy_s25_ultra" },
  { query: "samsung+galaxy+s25+plus+unlocked", category: "smartphones", model: "galaxy_s25_plus" },
  { query: "samsung+galaxy+s24+ultra+unlocked", category: "smartphones", model: "galaxy_s24_ultra" },
  { query: "samsung+galaxy+s24+plus+unlocked", category: "smartphones", model: "galaxy_s24_plus" },
  { query: "samsung+galaxy+s23+ultra+unlocked", category: "smartphones", model: "galaxy_s23_ultra" },
  { query: "samsung+galaxy+s23+plus+unlocked", category: "smartphones", model: "galaxy_s23_plus" },
  { query: "samsung+galaxy+z+fold+6+unlocked", category: "smartphones", model: "galaxy_z_fold_6" },
  { query: "samsung+galaxy+z+flip+6+unlocked", category: "smartphones", model: "galaxy_z_flip_6" },

  // ── Google Pixel ────────────────────────────────────────────────
  { query: "google+pixel+9+pro+unlocked", category: "smartphones", model: "pixel_9_pro" },
  { query: "google+pixel+9+pro+xl+unlocked", category: "smartphones", model: "pixel_9_pro_xl" },
  { query: "google+pixel+8+pro+unlocked", category: "smartphones", model: "pixel_8_pro" },
  { query: "google+pixel+8+unlocked", category: "smartphones", model: "pixel_8" },

  // ── MacBook ─────────────────────────────────────────────────────
  { query: "macbook+air+13+m4", category: "laptops", model: "macbook_air_13_m4" },
  { query: "macbook+air+15+m4", category: "laptops", model: "macbook_air_15_m4" },
  { query: "macbook+pro+14+m3", category: "laptops", model: "macbook_pro_14_m3" },
  { query: "macbook+pro+16+m3", category: "laptops", model: "macbook_pro_16_m3" },
  { query: "macbook+pro+14+m2+pro", category: "laptops", model: "macbook_pro_14_m2" },
  { query: "macbook+pro+16+m2+pro", category: "laptops", model: "macbook_pro_16_m2" },
  { query: "macbook+air+15+m3", category: "laptops", model: "macbook_air_15_m3" },
  { query: "macbook+air+13+m2", category: "laptops", model: "macbook_air_13_m2" },

  // ── iPad ────────────────────────────────────────────────────────
  { query: "ipad+pro+13+m4", category: "tablets", model: "ipad_pro_13_m4" },
  { query: "ipad+pro+12.9+m2", category: "tablets", model: "ipad_pro_12_m2" },
  { query: "ipad+pro+11+m4", category: "tablets", model: "ipad_pro_11_m4" },
  { query: "ipad+air+13+m2", category: "tablets", model: "ipad_air_13_m2" },
  { query: "ipad+air+m2", category: "tablets", model: "ipad_air_m2" },
  { query: "ipad+mini+6th+generation", category: "tablets", model: "ipad_mini_6" },

  // ── Gaming ──────────────────────────────────────────────────────
  { query: "playstation+5+console+disc", category: "gaming", model: "ps5_disc" },
  { query: "playstation+5+console+digital", category: "gaming", model: "ps5_digital" },
  { query: "xbox+series+x+console", category: "gaming", model: "xbox_series_x" },
  { query: "xbox+series+s+console", category: "gaming", model: "xbox_series_s" },
  { query: "nintendo+switch+oled+console", category: "gaming", model: "switch_oled" },
  { query: "steam+deck+512gb", category: "gaming", model: "steam_deck_512" },
  { query: "steam+deck+oled", category: "gaming", model: "steam_deck_oled" },
  { query: "asus+rog+ally+z1+extreme", category: "gaming", model: "rog_ally_z1_extreme" },

  // ── Audio ───────────────────────────────────────────────────────
  { query: "airpods+pro+2nd+generation", category: "audio", model: "airpods_pro_2" },
  { query: "airpods+max", category: "audio", model: "airpods_max" },
  { query: "bose+quietcomfort+ultra+headphones", category: "audio", model: "bose_qc_ultra" },
  { query: "sony+wh-1000xm5", category: "audio", model: "sony_wh1000xm5" },
  { query: "sony+wh-1000xm4", category: "audio", model: "sony_wh1000xm4" },
  { query: "sony+wf-1000xm5", category: "audio", model: "sony_wf1000xm5" },
];

// KRW → USD approximate rate
const KRW_TO_USD = 1 / 1430;
const HAGGLE_FEE_RATE = 0.015;

// eBay.com Basic/Premium/Anchor/Enterprise Store final value fee rates.
// Source snapshot: eBay Store selling fees page, category-specific rates.
const EBAY_CATEGORY_FEE_RATES: Record<string, number> = {
  smartphones: 0.0935, // Cell Phones & Accessories
  laptops: 0.0735, // Laptops & Netbooks
  tablets: 0.0735, // Tablets & eBook Readers
  gaming: 0.0735, // Video Game Consoles
  audio: 0.0935, // Consumer Electronics
};

const MIN_PRICE_BY_CATEGORY: Record<string, number> = {
  smartphones: 80,
  laptops: 250,
  tablets: 180,
  gaming: 120,
  audio: 50,
};

// ─── Types ────────────────────────────────────────────────────────────

interface RawListing {
  title: string;
  priceRaw: string;
  condition: string;
  soldDate: string;
  itemUrl: string;
  itemId: string | null;
}

interface ParsedObservation {
  source: string;
  category: string;
  model: string;
  storage_gb: number | null;
  battery_health_pct: number | null;
  cosmetic_grade: "A" | "B" | "C";
  carrier_locked: boolean;
  observed_price_usd: number;
  observed_at: string;
  external_id: string;
  title: string;
  item_url: string;
  condition_source: string;
  condition_confidence: number;
  condition_reasons: string[];
  carrier_lock_status: "locked" | "unlocked" | "unknown";
  carrier_lock_confidence: number;
}

interface Estimate<T> {
  value: T;
  source: string;
  confidence: number;
  reasons: string[];
}

interface CrawlOptions {
  limitTargets: number | null;
  maxPages: number;
  outputPrefix: string;
  targetModel: string | null;
}

// ─── Parsing ──────────────────────────────────────────────────────────

function parseStorage(title: string, defaultGb?: number): number | null {
  const tbMatch = title.match(/(\d)\s*TB/i);
  if (tbMatch) return parseInt(tbMatch[1]) * 1024;

  const match = title.match(/(\d+)\s*(?:GB|gb)/i);
  if (match) {
    const gb = parseInt(match[1]);
    if ([16, 32, 64, 128, 256, 512, 1024].includes(gb)) return gb;
  }
  return defaultGb ?? null;
}

function parseBatteryHealth(title: string): number | null {
  const match = title.match(/(\d{2,3})\s*%\s*(?:BH|battery|batt)/i)
    || title.match(/(?:BH|battery|batt)\s*[\s:]*(\d{2,3})\s*%/i);
  if (match) {
    const val = parseInt(match[1]);
    if (val >= 50 && val <= 100) return val;
  }
  return null;
}

function parseCosmeticGrade(title: string, condition: string): Estimate<"A" | "B" | "C"> {
  const combined = `${title} ${condition}`.toLowerCase();
  if (/parts|not working|broken|broke|water damage|cracked|flicker|for repair|junk|as.is|bad esn|blacklist|icloud locked/i.test(combined)) {
    return { value: "C", source: "damage_keyword", confidence: 0.95, reasons: ["damage_or_parts_keyword"] };
  }
  if (/fair|acceptable|poor|scratches|dents|heavy wear|crack/i.test(combined)) {
    return { value: "C", source: "wear_keyword", confidence: 0.82, reasons: ["visible_wear_keyword"] };
  }
  if (/new|sealed|brand new|open box|like new|mint|pristine|flawless|excellent/i.test(combined)) {
    return { value: "A", source: condition ? "search_condition" : "title_keyword", confidence: 0.82, reasons: ["premium_condition_keyword"] };
  }
  if (/very good|good|pre-owned|pre owned|used|refurbished|renewed/i.test(combined)) {
    return { value: "B", source: condition ? "search_condition" : "title_keyword", confidence: 0.72, reasons: ["standard_used_condition_keyword"] };
  }
  return { value: "B", source: "fallback", confidence: 0.4, reasons: ["no_specific_condition_signal"] };
}

function parseCarrierLocked(title: string): Estimate<boolean> {
  if (/unlocked|factory unlocked|fully unlocked|sim free/i.test(title)) {
    return { value: false, source: "title_keyword", confidence: 0.9, reasons: ["unlocked_keyword"] };
  }
  if (/(?:carrier|sim|network)\s+locked|locked to|at&t only|verizon only|t-mobile only|sprint only/i.test(title)) {
    return { value: true, source: "title_keyword", confidence: 0.86, reasons: ["locked_carrier_keyword"] };
  }
  if (/\b(?:at&t|verizon|t-mobile|sprint|cricket|boost|metro pcs|metropcs)\b/i.test(title)) {
    return { value: true, source: "carrier_mention", confidence: 0.65, reasons: ["carrier_mentioned_without_unlocked"] };
  }
  return { value: false, source: "unknown_default", confidence: 0.2, reasons: ["no_carrier_lock_signal"] };
}

function parsePriceUsd(priceRaw: string): number | null {
  const krwMatch = priceRaw.match(/KRW\s*([\d,]+\.?\d*)/);
  if (krwMatch) {
    const krw = parseFloat(krwMatch[1].replace(/,/g, ""));
    const usd = Math.round(krw * KRW_TO_USD * 100) / 100;
    return usd > 10 ? usd : null;
  }
  const usdMatch = priceRaw.match(/\$\s*([\d,]+\.?\d*)/);
  if (usdMatch) {
    const usd = parseFloat(usdMatch[1].replace(/,/g, ""));
    return usd > 10 ? usd : null;
  }
  return null;
}

function parseSoldDate(dateStr: string): string {
  const korMatch = dateStr.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
  if (korMatch) {
    const [, y, m, d] = korMatch;
    return new Date(`${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T12:00:00Z`).toISOString();
  }
  const engMatch = dateStr.match(/(\w+)\s+(\d{1,2}),?\s*(\d{4})/);
  if (engMatch) {
    return new Date(`${engMatch[1]} ${engMatch[2]}, ${engMatch[3]}`).toISOString();
  }
  return new Date().toISOString();
}

function shouldSkipListing(title: string): boolean {
  return /parts only|for parts|parts[\/\s-]*repair|not working|broken|for repair|repair only|salvage|no audio|hinge issue|replacement parts?|headband assembly|hanger repair|screen protector|case only|cover only|charger only|cable only|box only|manual only|strap only|disc drive for|console cover|trackpad cable|touchpad cable|charging port|laptop sleeve|sleeve case|hub adapter|shell case|hard shell|bad esn|blacklist|icloud locked/i.test(title);
}

function categoryPriceFloor(category: string): number {
  return MIN_PRICE_BY_CATEGORY[category] ?? 20;
}

function matchesTargetModel(title: string, target: SearchTarget): boolean {
  const normalized = title.toLowerCase().replace(/[^a-z0-9+.\s-]/g, " ").replace(/\s+/g, " ");
  const has = (...terms: string[]) => terms.every((term) => normalized.includes(term));

  switch (target.model) {
    case "iphone_12_pro":
      return has("iphone", "12", "pro") && !normalized.includes("pro max");
    case "iphone_12_pro_max":
      return has("iphone", "12", "pro max");
    case "iphone_13":
      return has("iphone", "13") && !normalized.includes("pro") && !normalized.includes("mini");
    case "iphone_13_pro":
      return has("iphone", "13", "pro") && !normalized.includes("pro max");
    case "iphone_13_pro_max":
      return has("iphone", "13", "pro max");
    case "iphone_14":
      return has("iphone", "14") && !normalized.includes("pro") && !normalized.includes("plus");
    case "iphone_14_pro":
      return has("iphone", "14", "pro") && !normalized.includes("pro max");
    case "iphone_14_pro_max":
      return has("iphone", "14", "pro max");
    case "iphone_15":
      return has("iphone", "15") && !normalized.includes("pro") && !normalized.includes("plus");
    case "iphone_15_plus":
      return has("iphone", "15", "plus");
    case "iphone_15_pro":
      return has("iphone", "15", "pro") && !normalized.includes("pro max");
    case "iphone_15_pro_max":
      return has("iphone", "15", "pro max");
    case "iphone_16":
      return has("iphone", "16") && !normalized.includes("pro") && !normalized.includes("plus");
    case "iphone_16_pro":
      return has("iphone", "16", "pro") && !normalized.includes("pro max");
    case "iphone_16_pro_max":
      return has("iphone", "16", "pro max");
    case "galaxy_s25_ultra":
      return has("s25", "ultra");
    case "galaxy_s25_plus":
      return has("s25") && (normalized.includes("plus") || normalized.includes("s25+"));
    case "galaxy_s24_ultra":
      return has("s24", "ultra");
    case "galaxy_s24_plus":
      return has("s24") && (normalized.includes("plus") || normalized.includes("s24+"));
    case "galaxy_s23_ultra":
      return has("s23", "ultra");
    case "galaxy_s23_plus":
      return has("s23") && (normalized.includes("plus") || normalized.includes("s23+"));
    case "galaxy_z_fold_6":
      return has("fold", "6") && normalized.includes("galaxy");
    case "galaxy_z_flip_6":
      return has("flip", "6") && normalized.includes("galaxy");
    case "pixel_9_pro":
      return has("pixel", "9", "pro") && !normalized.includes("xl");
    case "pixel_9_pro_xl":
      return has("pixel", "9", "pro") && normalized.includes("xl");
    case "pixel_8_pro":
      return has("pixel", "8", "pro");
    case "pixel_8":
      return has("pixel", "8") && !normalized.includes("pro");
    case "macbook_air_13_m4":
      return has("macbook", "air", "13", "m4");
    case "macbook_air_15_m4":
      return has("macbook", "air", "15", "m4");
    case "macbook_pro_14_m3":
      return has("macbook", "pro", "14", "m3");
    case "macbook_pro_16_m3":
      return has("macbook", "pro", "16", "m3");
    case "macbook_pro_14_m2":
      return has("macbook", "pro", "14") && (normalized.includes("m2 pro") || normalized.includes("m2"));
    case "macbook_pro_16_m2":
      return has("macbook", "pro", "16") && (normalized.includes("m2 pro") || normalized.includes("m2"));
    case "macbook_air_15_m3":
      return has("macbook", "air", "15", "m3");
    case "macbook_air_13_m2":
      return has("macbook", "air", "13", "m2");
    case "ipad_pro_13_m4":
      return has("ipad", "pro", "13", "m4");
    case "ipad_pro_12_m2":
      return has("ipad", "pro") && (normalized.includes("12.9") || normalized.includes("12 9")) && normalized.includes("m2");
    case "ipad_pro_11_m4":
      return has("ipad", "pro", "11", "m4");
    case "ipad_air_13_m2":
      return has("ipad", "air", "13", "m2");
    case "ipad_air_m2":
      return has("ipad", "air", "m2");
    case "ipad_mini_6":
      return has("ipad", "mini") && (normalized.includes("6th") || normalized.includes("6 "));
    case "ps5_disc":
      return (has("playstation 5") || has("ps5")) && normalized.includes("console") && !normalized.includes("digital");
    case "ps5_digital":
      return (has("playstation 5") || has("ps5")) && normalized.includes("digital");
    case "xbox_series_x":
      return has("xbox", "series x");
    case "xbox_series_s":
      return has("xbox", "series s");
    case "switch_oled":
      return has("switch", "oled");
    case "steam_deck_512":
      return has("steam", "deck", "512");
    case "steam_deck_oled":
      return has("steam", "deck", "oled");
    case "rog_ally_z1_extreme":
      return has("rog", "ally") && (normalized.includes("z1 extreme") || normalized.includes("z1"));
    case "airpods_pro_2":
      return has("airpods", "pro") && (normalized.includes("2nd") || normalized.includes("2 "));
    case "airpods_max":
      return has("airpods", "max");
    case "bose_qc_ultra":
      return has("bose") && normalized.includes("ultra");
    case "sony_wh1000xm5":
      return normalized.includes("wh-1000xm5") || normalized.includes("wh1000xm5");
    case "sony_wh1000xm4":
      return normalized.includes("wh-1000xm4") || normalized.includes("wh1000xm4");
    case "sony_wf1000xm5":
      return normalized.includes("wf-1000xm5") || normalized.includes("wf1000xm5");
    default:
      return true;
  }
}

function feeAdjustForHaggle(observedPriceUsd: number, category: string): number {
  const ebayFeeRate = EBAY_CATEGORY_FEE_RATES[category] ?? 0.136;
  return Math.round((observedPriceUsd * (1 - ebayFeeRate) / (1 - HAGGLE_FEE_RATE)) * 100) / 100;
}

function stableExternalId(raw: RawListing, target: SearchTarget): string {
  if (raw.itemId) return `ebay_${raw.itemId}`;
  const fingerprint = `${target.model}|${raw.title}|${raw.priceRaw}|${raw.soldDate}`;
  return `ebay_${createHash("sha1").update(fingerprint).digest("hex").slice(0, 16)}`;
}

function carrierLockStatus(estimate: Estimate<boolean>): "locked" | "unlocked" | "unknown" {
  if (estimate.source === "unknown_default") return "unknown";
  return estimate.value ? "locked" : "unlocked";
}

function getArgValue(args: string[], name: string): string | null {
  const prefix = `${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function parseOptions(args: string[]): CrawlOptions {
  const limitTargetsRaw = getArgValue(args, "--limit-targets");
  const maxPagesRaw = getArgValue(args, "--max-pages");
  const outputPrefix = getArgValue(args, "--output-prefix") ?? "ebay-electronics-full";
  const targetModel = getArgValue(args, "--target-model");
  const maxPages = Math.max(1, Math.min(5, Number(maxPagesRaw ?? 1) || 1));
  const limitTargets = limitTargetsRaw == null ? null : Math.max(1, Number(limitTargetsRaw) || 1);
  return { limitTargets, maxPages, outputPrefix, targetModel };
}

function searchUrl(target: SearchTarget, pageNumber: number): string {
  const params = new URLSearchParams({
    _nkw: target.query.replace(/\+/g, " "),
    LH_Sold: "1",
    LH_Complete: "1",
    _sop: "13",
    _ipg: "240",
    _pgn: String(pageNumber),
  });
  return `https://www.ebay.com/sch/i.html?${params.toString()}`;
}

// ─── Market Data Collection ───────────────────────────────────────────

async function collectSearchPage(page: Page): Promise<RawListing[]> {
  return page.evaluate(() => {
    const items = document.querySelectorAll(".srp-results li");
    const results: Array<{
      title: string;
      priceRaw: string;
      condition: string;
      soldDate: string;
      itemUrl: string;
      itemId: string | null;
    }> = [];

    for (const item of items) {
      const spans = Array.from(item.querySelectorAll("span"))
        .map((s) => s.textContent?.trim())
        .filter(Boolean) as string[];
      if (spans.length < 3) continue;

      // Title — try English from rating span, or fallback to main title
      const ratingSpan = Array.from(item.querySelectorAll("span")).find((s) =>
        /^- /.test(s.textContent?.trim() ?? ""),
      );
      let title = ratingSpan?.textContent?.replace(/^.*?- /, "") || "";
      if (!title) {
        // Fallback: second or third span often has the title
        title = spans.find(s => s.length > 20 && !/판매됨|Sold|KRW|\$|별 /.test(s)) || "";
      }
      if (!title || title.length < 10) continue;

      const price = spans.find((s) => /KRW|USD|\$/.test(s)) || "";
      const condKeywords = ["사전 소유", "리퍼", "개봉", "Pre-Owned", "Refurbished", "Open Box", "새 상품", "New"];
      const condition = spans.find((s) => condKeywords.some((c) => s.includes(c))) || "";
      const soldDate = spans.find((s) => s.includes("판매됨") || s.includes("Sold")) || "";
      const link = item.querySelector<HTMLAnchorElement>("a.s-item__link[href], a[href*='/itm/']");
      const itemUrl = link?.href?.split("?")[0] ?? "";
      const itemId = itemUrl.match(/\/itm\/(?:[^/]+\/)?(\d{9,})/)?.[1] ?? null;

      results.push({ title, priceRaw: price, condition, soldDate, itemUrl, itemId });
    }
    return results;
  });
}

async function collectSearchPageWithRetry(page: Page): Promise<RawListing[]> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.waitForSelector(".srp-results li", { timeout: 10000 });
      return await collectSearchPage(page);
    } catch (err) {
      lastError = err;
      await page.waitForTimeout(750 * attempt);
    }
  }
  throw lastError;
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const useDb = args.includes("--db");
  const options = parseOptions(args);
  const targetPool = options.targetModel == null
    ? TARGETS
    : TARGETS.filter((target) => target.model === options.targetModel);
  const selectedTargets = options.limitTargets == null ? targetPool : targetPool.slice(0, options.limitTargets);

  if (selectedTargets.length === 0) {
    console.error(`No targets matched ${options.targetModel ?? "the selected filters"}`);
    process.exit(1);
  }

  console.log("═══════════════════════════════════════════════════");
  console.log("  eBay Electronics Market Data Collector — Full Category Sweep");
  console.log("═══════════════════════════════════════════════════");
  console.log(`  Targets: ${selectedTargets.length}/${TARGETS.length} search queries`);
  console.log(`  Pages/target: ${options.maxPages}`);
  console.log(`  Output: scripts/${options.outputPrefix}.csv + .sql`);
  console.log(`  KRW/USD: ${(1 / KRW_TO_USD).toFixed(0)}`);
  console.log();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    locale: "en-US",
  });
  const page = await context.newPage();

  const allObservations: ParsedObservation[] = [];
  const seenExternalIds = new Set<string>();
  const categoryStats: Record<string, { queries: number; pages: number; raw: number; parsed: number }> = {};

  for (const target of selectedTargets) {
    const label = `${target.category}/${target.model}`;

    if (!categoryStats[target.category]) {
      categoryStats[target.category] = { queries: 0, pages: 0, raw: 0, parsed: 0 };
    }
    categoryStats[target.category].queries++;

    for (let pageNumber = 1; pageNumber <= options.maxPages; pageNumber++) {
      const url = searchUrl(target, pageNumber);
      process.stdout.write(`  ${`${label} p${pageNumber}`.padEnd(38)}`);

      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(2000);

        const rawListings = await collectSearchPageWithRetry(page);
        categoryStats[target.category].pages++;
        categoryStats[target.category].raw += rawListings.length;

        let parsed = 0;
        for (const raw of rawListings) {
          if (shouldSkipListing(raw.title)) continue;
          if (!matchesTargetModel(raw.title, target)) continue;

          const priceUsd = parsePriceUsd(raw.priceRaw);
          if (!priceUsd || priceUsd < categoryPriceFloor(target.category) || priceUsd > 5000) continue;

          const conditionEstimate = parseCosmeticGrade(raw.title, raw.condition);
          const carrierEstimate = parseCarrierLocked(raw.title);
          const externalId = stableExternalId(raw, target);
          if (seenExternalIds.has(externalId)) continue;
          seenExternalIds.add(externalId);

          const obs: ParsedObservation = {
            source: "ebay_sold",
            category: target.category,
            model: target.model,
            storage_gb: parseStorage(raw.title, target.defaultStorageGb),
            battery_health_pct: parseBatteryHealth(raw.title),
            cosmetic_grade: conditionEstimate.value,
            carrier_locked: carrierEstimate.value,
            observed_price_usd: priceUsd,
            observed_at: parseSoldDate(raw.soldDate),
            external_id: externalId,
            title: raw.title,
            item_url: raw.itemUrl,
            condition_source: conditionEstimate.source,
            condition_confidence: conditionEstimate.confidence,
            condition_reasons: conditionEstimate.reasons,
            carrier_lock_status: carrierLockStatus(carrierEstimate),
            carrier_lock_confidence: carrierEstimate.confidence,
          };
          allObservations.push(obs);
          parsed++;
        }
        categoryStats[target.category].parsed += parsed;
        console.log(`${rawListings.length} raw → ${parsed} valid`);
      } catch (err) {
        console.log(`ERROR: ${(err as Error).message.slice(0, 60)}`);
      }

      // Rate limiting — be nice to eBay
      await page.waitForTimeout(1500 + Math.random() * 1000);
    }
  }

  await browser.close();

  // ── Category Summary ────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════");
  console.log("  Category Summary");
  console.log("═══════════════════════════════════════════════════");
  let grandTotal = 0;
  for (const [cat, stats] of Object.entries(categoryStats)) {
    console.log(`  ${cat.padEnd(15)} ${stats.queries} queries / ${stats.pages} pages → ${stats.raw} raw → ${stats.parsed} valid`);
    grandTotal += stats.parsed;
  }
  console.log(`  ${"TOTAL".padEnd(15)} ${selectedTargets.length} queries → ${grandTotal} valid observations`);

  if (grandTotal === 0) {
    console.log("\nNo data collected. Exiting.");
    process.exit(1);
  }

  // ── Model Price Summary ─────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════");
  console.log("  Price Summary by Model");
  console.log("═══════════════════════════════════════════════════");

  const modelGroups = new Map<string, number[]>();
  for (const obs of allObservations) {
    const key = `${obs.category}/${obs.model}`;
    if (!modelGroups.has(key)) modelGroups.set(key, []);
    modelGroups.get(key)!.push(obs.observed_price_usd);
  }

  for (const [key, prices] of [...modelGroups.entries()].sort()) {
    prices.sort((a, b) => a - b);
    const n = prices.length;
    const median = prices[Math.floor(n / 2)];
    const mean = prices.reduce((a, b) => a + b, 0) / n;
    const min = prices[0];
    const max = prices[n - 1];
    console.log(
      `  ${key.padEnd(40)} n=${String(n).padStart(3)}  median=$${median.toFixed(0).padStart(6)}  mean=$${mean.toFixed(0).padStart(6)}  range=$${min.toFixed(0)}-$${max.toFixed(0)}`,
    );
  }

  // ── Write CSV ───────────────────────────────────────────────────
  const scriptDir = new URL(".", import.meta.url).pathname;
  const headers = [
    "source", "category", "model", "storage_gb", "battery_health_pct",
    "cosmetic_grade", "carrier_locked", "observed_price_usd",
    "observed_at", "external_id", "condition_source", "condition_confidence",
    "carrier_lock_status", "carrier_lock_confidence", "item_url", "title",
  ];
  const csvRows = allObservations.map((o) =>
    [
      o.source, o.category, o.model, o.storage_gb ?? "",
      o.battery_health_pct ?? "", o.cosmetic_grade, o.carrier_locked,
      o.observed_price_usd, o.observed_at, o.external_id,
      o.condition_source, o.condition_confidence,
      o.carrier_lock_status, o.carrier_lock_confidence,
      `"${o.item_url.replace(/"/g, '""')}"`,
      `"${o.title.replace(/"/g, '""')}"`,
    ].join(","),
  );
  const csvPath = resolve(scriptDir, `${options.outputPrefix}.csv`);
  writeFileSync(csvPath, [headers.join(","), ...csvRows].join("\n"));
  console.log(`\nCSV: ${csvPath}`);

  // ── Write SQL ───────────────────────────────────────────────────
  /** Escape single quotes for safe SQL string interpolation */
  const esc = (s: string) => s.replace(/'/g, "''");

  const sqlValues = allObservations
    .map(
      (o) => {
        const adjusted = feeAdjustForHaggle(o.observed_price_usd, o.category);
        const rawPayload = {
          category: o.category,
          title: o.title,
          item_url: o.item_url || null,
          condition_source: o.condition_source,
          condition_confidence: o.condition_confidence,
          condition_reasons: o.condition_reasons,
          carrier_lock_status: o.carrier_lock_status,
          carrier_lock_confidence: o.carrier_lock_confidence,
        };
        return `  ('${esc(o.source)}', '${esc(o.model)}', ${o.storage_gb ?? "NULL"}, ${o.battery_health_pct ?? "NULL"}, '${esc(o.cosmetic_grade)}', ${o.carrier_locked}, ${o.observed_price_usd}, ${adjusted}, '${esc(o.observed_at)}', '${esc(o.external_id)}', '${esc(JSON.stringify(rawPayload))}'::jsonb)`;
      },
    )
    .join(",\n");

  const sqlContent = `-- eBay Electronics Full Crawl — ${new Date().toISOString().slice(0, 10)}
-- ${grandTotal} observations across ${Object.keys(categoryStats).length} categories
-- Prices fee-adjusted by category: eBay category fee → Haggle 1.5% equivalent
INSERT INTO hfmi_price_observations
  (source, model, storage_gb, battery_health_pct, cosmetic_grade, carrier_locked, observed_price_usd, adjusted_price_usd, observed_at, external_id, raw_payload)
VALUES
${sqlValues}
ON CONFLICT (source, external_id) DO NOTHING;\n`;

  const sqlPath = resolve(scriptDir, `${options.outputPrefix}.sql`);
  writeFileSync(sqlPath, sqlContent);
  console.log(`SQL: ${sqlPath}`);

  console.log(`\n✅ Done! ${grandTotal} observations saved.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
