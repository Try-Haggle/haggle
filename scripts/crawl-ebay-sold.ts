#!/usr/bin/env npx tsx
/**
 * eBay Sold Listings Crawler for HFMI
 *
 * Uses Playwright to scrape eBay sold listings for used iPhones.
 * Parses title/price/condition/date and outputs CSV + SQL for hfmi_price_observations.
 *
 * Usage:
 *   npx playwright install chromium   # first time only
 *   npx tsx scripts/crawl-ebay-sold.ts
 *   npx tsx scripts/crawl-ebay-sold.ts --db   # insert directly to DB
 *
 * Output:
 *   scripts/ebay-sold-data.csv
 *   scripts/ebay-sold-data.sql
 */

import { chromium, type Page } from "playwright";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

// ─── Config ───────────────────────────────────────────────────────────

const MODELS = [
  { query: "iphone+13+pro+unlocked", model: "iphone_13_pro" },
  { query: "iphone+13+pro+max+unlocked", model: "iphone_13_pro_max" },
  { query: "iphone+14+pro+unlocked", model: "iphone_14_pro" },
  { query: "iphone+14+pro+max+unlocked", model: "iphone_14_pro_max" },
  { query: "iphone+15+pro+unlocked", model: "iphone_15_pro" },
  { query: "iphone+15+pro+max+unlocked", model: "iphone_15_pro_max" },
];

// KRW → USD approximate rate (update if needed)
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
  model: string;
  storage_gb: number;
  battery_health_pct: number | null;
  cosmetic_grade: "A" | "B" | "C";
  carrier_locked: boolean;
  observed_price_usd: number;
  observed_at: string;
  external_id: string;
}

// ─── Parsing ──────────────────────────────────────────────────────────

function parseStorage(title: string): number {
  const match = title.match(/(\d+)\s*(?:GB|gb)/i);
  if (!match) return 128; // default for Pro models
  const gb = parseInt(match[1]);
  if ([64, 128, 256, 512, 1024].includes(gb)) return gb;
  if (gb === 1) return 1024; // "1TB"
  return 128;
}

function parseBatteryHealth(title: string): number | null {
  // Look for patterns like "90% BH", "BH 85%", "battery 92%", "85% battery"
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

  // Skip parts/broken/water damage
  if (/parts|not working|broken|water damage|cracked|for repair/i.test(combined)) {
    return "C";
  }

  // Mint / New / Excellent → A
  if (/mint|pristine|flawless|like new|open box|new|excellent/i.test(combined)) {
    return "A";
  }

  // Fair / Acceptable → C
  if (/fair|acceptable|poor|scratches|dents|heavy wear/i.test(combined)) {
    return "C";
  }

  // Good / Very Good / Great → B (default)
  return "B";
}

function parseCarrierLocked(title: string): boolean {
  const lower = title.toLowerCase();
  if (/unlocked|factory unlocked|fully unlocked/i.test(lower)) return false;
  if (/locked|at&t only|verizon only|t-mobile only/i.test(lower)) return true;
  return false; // search query filters for unlocked
}

function parsePriceUsd(priceRaw: string): number | null {
  // Handle KRW format: "KRW800,680.49"
  const krwMatch = priceRaw.match(/KRW\s*([\d,]+\.?\d*)/);
  if (krwMatch) {
    const krw = parseFloat(krwMatch[1].replace(/,/g, ""));
    const usd = Math.round(krw * KRW_TO_USD * 100) / 100;
    return usd > 30 ? usd : null;
  }

  // Handle USD format: "$499.99" or "US $499.99"
  const usdMatch = priceRaw.match(/\$\s*([\d,]+\.?\d*)/);
  if (usdMatch) {
    const usd = parseFloat(usdMatch[1].replace(/,/g, ""));
    return usd > 30 ? usd : null;
  }

  return null;
}

function parseSoldDate(dateStr: string): string {
  // "판매됨  2026년 4월 14일" → ISO date
  const korMatch = dateStr.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
  if (korMatch) {
    const [, y, m, d] = korMatch;
    return new Date(`${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T12:00:00Z`).toISOString();
  }

  // "Sold  Apr 14, 2026"
  const engMatch = dateStr.match(/(\w+)\s+(\d{1,2}),?\s*(\d{4})/);
  if (engMatch) {
    return new Date(`${engMatch[1]} ${engMatch[2]}, ${engMatch[3]}`).toISOString();
  }

  return new Date().toISOString();
}

function shouldSkipListing(title: string): boolean {
  return /parts|not working|broken|water damage|for repair|case|screen protector|charger only/i.test(title);
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

      // English title from rating span
      const ratingSpan = Array.from(item.querySelectorAll("span")).find((s) =>
        s.textContent?.includes("- Apple iPhone"),
      );
      const title = ratingSpan?.textContent?.replace(/^.*?- /, "") || "";
      if (!title) continue;

      // Price
      const price = spans.find((s) => /KRW|USD|\$/.test(s)) || "";

      // Condition
      const condKeywords = [
        "사전 소유",
        "리퍼",
        "개봉",
        "Pre-Owned",
        "Refurbished",
        "Open Box",
      ];
      const condition =
        spans.find((s) => condKeywords.some((c) => s.includes(c))) || "";

      // Sold date
      const soldDate =
        spans.find((s) => s.includes("판매됨") || s.includes("Sold")) || "";

      results.push({ title, priceRaw: price, condition, soldDate });
    }
    return results;
  });
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const useDb = args.includes("--db");

  console.log("eBay Sold Listings Crawler for HFMI");
  console.log(`  Models: ${MODELS.length}`);
  console.log(`  KRW/USD rate: ${(1 / KRW_TO_USD).toFixed(0)}`);
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

  for (const { query, model } of MODELS) {
    // Pre-owned items, sold, sorted by newest
    const url = `https://www.ebay.com/sch/i.html?_nkw=${query}&LH_Sold=1&LH_Complete=1&_sop=13&LH_ItemCondition=4`;
    console.log(`Crawling: ${model}...`);

    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(2000);

      const rawListings = await scrapeSearchPage(page);
      console.log(`  Found ${rawListings.length} raw listings`);

      let parsed = 0;
      for (const raw of rawListings) {
        if (shouldSkipListing(raw.title)) continue;

        const priceUsd = parsePriceUsd(raw.priceRaw);
        if (!priceUsd || priceUsd < 100 || priceUsd > 2000) continue;

        const obs: ParsedObservation = {
          source: "ebay_sold",
          model,
          storage_gb: parseStorage(raw.title),
          battery_health_pct: parseBatteryHealth(raw.title),
          cosmetic_grade: parseCosmeticGrade(raw.title, raw.condition),
          carrier_locked: parseCarrierLocked(raw.title),
          observed_price_usd: priceUsd,
          observed_at: parseSoldDate(raw.soldDate),
          external_id: `ebay_${model}_${seqId++}`,
        };
        allObservations.push(obs);
        parsed++;
      }
      console.log(`  Parsed ${parsed} valid observations`);
    } catch (err) {
      console.error(`  ERROR: ${(err as Error).message}`);
    }

    // Be nice to eBay
    await page.waitForTimeout(1500);
  }

  await browser.close();

  console.log(`\nTotal: ${allObservations.length} observations`);

  if (allObservations.length === 0) {
    console.log("No data scraped. Exiting.");
    process.exit(1);
  }

  // ── Write CSV ───────────────────────────────────────────────────────
  const scriptDir = new URL(".", import.meta.url).pathname;
  const headers = [
    "source", "model", "storage_gb", "battery_health_pct",
    "cosmetic_grade", "carrier_locked", "observed_price_usd",
    "observed_at", "external_id",
  ];
  const csvRows = allObservations.map((o) =>
    [
      o.source, o.model, o.storage_gb, o.battery_health_pct ?? "",
      o.cosmetic_grade, o.carrier_locked, o.observed_price_usd,
      o.observed_at, o.external_id,
    ].join(","),
  );
  const csvPath = resolve(scriptDir, "ebay-sold-data.csv");
  writeFileSync(csvPath, [headers.join(","), ...csvRows].join("\n"));
  console.log(`CSV: ${csvPath}`);

  // ── Write SQL ───────────────────────────────────────────────────────
  const esc = (s: string) => s.replace(/'/g, "''");
  const values = allObservations
    .map(
      (o) =>
        `  ('${esc(o.source)}', '${esc(o.model)}', ${o.storage_gb}, ${o.battery_health_pct ?? "NULL"}, '${esc(o.cosmetic_grade)}', ${o.carrier_locked}, ${o.observed_price_usd}, '${esc(o.observed_at)}', '${esc(o.external_id)}')`,
    )
    .join(",\n");

  const sqlContent = `INSERT INTO hfmi_price_observations
  (source, model, storage_gb, battery_health_pct, cosmetic_grade, carrier_locked, observed_price_usd, observed_at, external_id)
VALUES
${values}
ON CONFLICT (source, external_id) DO NOTHING;\n`;

  const sqlPath = resolve(scriptDir, "ebay-sold-data.sql");
  writeFileSync(sqlPath, sqlContent);
  console.log(`SQL: ${sqlPath}`);

  // ── Price Summary ───────────────────────────────────────────────────
  console.log("\n── Price Summary ──────────────────────────────────");
  for (const { model } of MODELS) {
    const modelObs = allObservations.filter((o) => o.model === model);
    if (modelObs.length === 0) {
      console.log(`  ${model.padEnd(22)} no data`);
      continue;
    }
    const prices = modelObs.map((o) => o.observed_price_usd).sort((a, b) => a - b);
    const median = prices[Math.floor(prices.length / 2)];
    const min = prices[0];
    const max = prices[prices.length - 1];
    console.log(
      `  ${model.padEnd(22)} median=$${median.toFixed(0)}  range=$${min.toFixed(0)}-$${max.toFixed(0)}  n=${prices.length}`,
    );
  }

  // ── DB insert ───────────────────────────────────────────────────────
  if (useDb) {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      console.error("\nERROR: DATABASE_URL not set for --db mode");
      process.exit(1);
    }
    console.log("\nInserting to DB...");
    // Use postgres.js
    const postgres = (await import("postgres")).default;
    const sql = postgres(dbUrl, { max: 1 });
    try {
      for (const obs of allObservations) {
        await sql`
          INSERT INTO hfmi_price_observations
            (source, model, storage_gb, battery_health_pct, cosmetic_grade,
             carrier_locked, observed_price_usd, observed_at, external_id)
          VALUES
            (${obs.source}, ${obs.model}, ${obs.storage_gb}, ${obs.battery_health_pct},
             ${obs.cosmetic_grade}, ${obs.carrier_locked}, ${obs.observed_price_usd},
             ${obs.observed_at}, ${obs.external_id})
          ON CONFLICT (source, external_id) DO NOTHING
        `;
      }
      console.log(`Inserted ${allObservations.length} observations.`);
    } finally {
      await sql.end();
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
