#!/usr/bin/env npx tsx
/**
 * eBay Sold Electronics Crawler — Full Category Sweep
 *
 * Crawls eBay sold listings for iPhones, Samsung, Pixel, MacBooks,
 * iPads, gaming consoles, audio devices.
 *
 * Usage:
 *   npx tsx scripts/crawl-ebay-electronics.ts
 *   npx tsx scripts/crawl-ebay-electronics.ts --db   # insert to DB
 */

import { chromium, type Page } from "playwright";
import { writeFileSync } from "node:fs";
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
  { query: "iphone+13+pro+128gb+unlocked", category: "smartphones", model: "iphone_13_pro", defaultStorageGb: 128 },
  { query: "iphone+13+pro+256gb+unlocked", category: "smartphones", model: "iphone_13_pro", defaultStorageGb: 256 },
  { query: "iphone+13+pro+max+unlocked", category: "smartphones", model: "iphone_13_pro_max" },
  { query: "iphone+14+pro+128gb+unlocked", category: "smartphones", model: "iphone_14_pro", defaultStorageGb: 128 },
  { query: "iphone+14+pro+256gb+unlocked", category: "smartphones", model: "iphone_14_pro", defaultStorageGb: 256 },
  { query: "iphone+14+pro+max+unlocked", category: "smartphones", model: "iphone_14_pro_max" },
  { query: "iphone+15+pro+128gb+unlocked", category: "smartphones", model: "iphone_15_pro", defaultStorageGb: 128 },
  { query: "iphone+15+pro+256gb+unlocked", category: "smartphones", model: "iphone_15_pro", defaultStorageGb: 256 },
  { query: "iphone+15+pro+512gb+unlocked", category: "smartphones", model: "iphone_15_pro", defaultStorageGb: 512 },
  { query: "iphone+15+pro+max+unlocked", category: "smartphones", model: "iphone_15_pro_max" },

  // ── Samsung Galaxy ──────────────────────────────────────────────
  { query: "samsung+galaxy+s24+ultra+unlocked", category: "smartphones", model: "galaxy_s24_ultra" },
  { query: "samsung+galaxy+s24+plus+unlocked", category: "smartphones", model: "galaxy_s24_plus" },
  { query: "samsung+galaxy+s23+ultra+unlocked", category: "smartphones", model: "galaxy_s23_ultra" },
  { query: "samsung+galaxy+s23+plus+unlocked", category: "smartphones", model: "galaxy_s23_plus" },

  // ── Google Pixel ────────────────────────────────────────────────
  { query: "google+pixel+9+pro+unlocked", category: "smartphones", model: "pixel_9_pro" },
  { query: "google+pixel+8+pro+unlocked", category: "smartphones", model: "pixel_8_pro" },

  // ── MacBook ─────────────────────────────────────────────────────
  { query: "macbook+pro+14+m3", category: "laptops", model: "macbook_pro_14_m3" },
  { query: "macbook+pro+14+m2+pro", category: "laptops", model: "macbook_pro_14_m2" },
  { query: "macbook+air+15+m3", category: "laptops", model: "macbook_air_15_m3" },
  { query: "macbook+air+13+m2", category: "laptops", model: "macbook_air_13_m2" },

  // ── iPad ────────────────────────────────────────────────────────
  { query: "ipad+pro+12.9+m2", category: "tablets", model: "ipad_pro_12_m2" },
  { query: "ipad+pro+11+m4", category: "tablets", model: "ipad_pro_11_m4" },
  { query: "ipad+air+m2", category: "tablets", model: "ipad_air_m2" },

  // ── Gaming ──────────────────────────────────────────────────────
  { query: "playstation+5+console+disc", category: "gaming", model: "ps5_disc" },
  { query: "playstation+5+console+digital", category: "gaming", model: "ps5_digital" },
  { query: "nintendo+switch+oled+console", category: "gaming", model: "switch_oled" },
  { query: "steam+deck+512gb", category: "gaming", model: "steam_deck_512" },
  { query: "steam+deck+oled", category: "gaming", model: "steam_deck_oled" },

  // ── Audio ───────────────────────────────────────────────────────
  { query: "airpods+pro+2nd+generation", category: "audio", model: "airpods_pro_2" },
  { query: "airpods+max", category: "audio", model: "airpods_max" },
  { query: "sony+wh-1000xm5", category: "audio", model: "sony_wh1000xm5" },
  { query: "sony+wf-1000xm5", category: "audio", model: "sony_wf1000xm5" },
];

// KRW → USD approximate rate
const KRW_TO_USD = 1 / 1430;

// ─── Types ────────────────────────────────────────────────────────────

interface RawListing {
  title: string;
  priceRaw: string;
  condition: string;
  soldDate: string;
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
  title: string; // keep original title for analysis
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

function parseCosmeticGrade(title: string, condition: string): "A" | "B" | "C" {
  const combined = `${title} ${condition}`.toLowerCase();
  if (/parts|not working|broken|water damage|cracked|for repair|junk|as.is/i.test(combined)) return "C";
  if (/mint|pristine|flawless|like new|open box|sealed|new|excellent/i.test(combined)) return "A";
  if (/fair|acceptable|poor|scratches|dents|heavy wear/i.test(combined)) return "C";
  return "B";
}

function parseCarrierLocked(title: string): boolean {
  if (/unlocked|factory unlocked|fully unlocked/i.test(title)) return false;
  if (/locked|at&t only|verizon only|t-mobile only/i.test(title)) return true;
  return false;
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
  return /parts only|not working|broken|for repair|case only|screen protector|charger only|cable only|box only|manual only|strap only/i.test(title);
}

// ─── Scraper ──────────────────────────────────────────────────────────

async function scrapeSearchPage(page: Page): Promise<RawListing[]> {
  return page.evaluate(() => {
    const items = document.querySelectorAll(".srp-results li");
    const results: Array<{
      title: string;
      priceRaw: string;
      condition: string;
      soldDate: string;
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

      results.push({ title, priceRaw: price, condition, soldDate });
    }
    return results;
  });
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const useDb = args.includes("--db");

  console.log("═══════════════════════════════════════════════════");
  console.log("  eBay Electronics Crawler — Full Category Sweep");
  console.log("═══════════════════════════════════════════════════");
  console.log(`  Targets: ${TARGETS.length} search queries`);
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
  let seqId = 1;
  const categoryStats: Record<string, { queries: number; raw: number; parsed: number }> = {};

  for (const target of TARGETS) {
    const url = `https://www.ebay.com/sch/i.html?_nkw=${target.query}&LH_Sold=1&LH_Complete=1&_sop=13`;
    const label = `${target.category}/${target.model}`;
    process.stdout.write(`  ${label.padEnd(35)}`);

    if (!categoryStats[target.category]) {
      categoryStats[target.category] = { queries: 0, raw: 0, parsed: 0 };
    }
    categoryStats[target.category].queries++;

    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(2000);

      const rawListings = await scrapeSearchPage(page);
      categoryStats[target.category].raw += rawListings.length;

      let parsed = 0;
      for (const raw of rawListings) {
        if (shouldSkipListing(raw.title)) continue;

        const priceUsd = parsePriceUsd(raw.priceRaw);
        if (!priceUsd || priceUsd < 20 || priceUsd > 5000) continue;

        const obs: ParsedObservation = {
          source: "ebay_sold",
          category: target.category,
          model: target.model,
          storage_gb: parseStorage(raw.title, target.defaultStorageGb),
          battery_health_pct: parseBatteryHealth(raw.title),
          cosmetic_grade: parseCosmeticGrade(raw.title, raw.condition),
          carrier_locked: parseCarrierLocked(raw.title),
          observed_price_usd: priceUsd,
          observed_at: parseSoldDate(raw.soldDate),
          external_id: `ebay_${target.model}_${seqId++}`,
          title: raw.title,
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

  await browser.close();

  // ── Category Summary ────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════");
  console.log("  Category Summary");
  console.log("═══════════════════════════════════════════════════");
  let grandTotal = 0;
  for (const [cat, stats] of Object.entries(categoryStats)) {
    console.log(`  ${cat.padEnd(15)} ${stats.queries} queries → ${stats.raw} raw → ${stats.parsed} valid`);
    grandTotal += stats.parsed;
  }
  console.log(`  ${"TOTAL".padEnd(15)} ${TARGETS.length} queries → ${grandTotal} valid observations`);

  if (grandTotal === 0) {
    console.log("\nNo data scraped. Exiting.");
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
    "observed_at", "external_id", "title",
  ];
  const csvRows = allObservations.map((o) =>
    [
      o.source, o.category, o.model, o.storage_gb ?? "",
      o.battery_health_pct ?? "", o.cosmetic_grade, o.carrier_locked,
      o.observed_price_usd, o.observed_at, o.external_id,
      `"${o.title.replace(/"/g, '""')}"`,
    ].join(","),
  );
  const csvPath = resolve(scriptDir, "ebay-electronics-full.csv");
  writeFileSync(csvPath, [headers.join(","), ...csvRows].join("\n"));
  console.log(`\nCSV: ${csvPath}`);

  // ── Write SQL ───────────────────────────────────────────────────
  /** Escape single quotes for safe SQL string interpolation */
  const esc = (s: string) => s.replace(/'/g, "''");

  const sqlValues = allObservations
    .map(
      (o) =>
        `  ('${esc(o.source)}', '${esc(o.model)}', ${o.storage_gb ?? "NULL"}, ${o.battery_health_pct ?? "NULL"}, '${esc(o.cosmetic_grade)}', ${o.carrier_locked}, ${o.observed_price_usd}, '${esc(o.observed_at)}', '${esc(o.external_id)}')`,
    )
    .join(",\n");

  const sqlContent = `-- eBay Electronics Full Crawl — ${new Date().toISOString().slice(0, 10)}
-- ${grandTotal} observations across ${Object.keys(categoryStats).length} categories
INSERT INTO hfmi_price_observations
  (source, model, storage_gb, battery_health_pct, cosmetic_grade, carrier_locked, observed_price_usd, observed_at, external_id)
VALUES
${sqlValues}
ON CONFLICT (source, external_id) DO NOTHING;\n`;

  const sqlPath = resolve(scriptDir, "ebay-electronics-full.sql");
  writeFileSync(sqlPath, sqlContent);
  console.log(`SQL: ${sqlPath}`);

  console.log(`\n✅ Done! ${grandTotal} observations saved.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
