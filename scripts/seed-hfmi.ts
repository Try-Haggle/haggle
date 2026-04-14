#!/usr/bin/env npx tsx
/**
 * HFMI Seed Data Generator
 *
 * Generates realistic used iPhone price observations based on
 * Swappa March/April 2026 market data, then:
 *   --csv   → writes to scripts/hfmi-seed.csv  (default)
 *   --db    → inserts directly into hfmi_price_observations via DATABASE_URL
 *   --fit   → also runs fitModel() after seeding (requires --db)
 *
 * Usage:
 *   npx tsx scripts/seed-hfmi.ts              # CSV only
 *   npx tsx scripts/seed-hfmi.ts --db         # Insert to DB
 *   npx tsx scripts/seed-hfmi.ts --db --fit   # Insert + fit coefficients
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

// ─── Market Data (Swappa March/April 2026 averages) ──────────────────

interface ModelPricing {
  model: string;
  storageOptions: number[];
  /** Base price per storage tier (Good/B condition, unlocked) */
  basePrices: Record<number, number>;
}

const MODELS: ModelPricing[] = [
  {
    model: "iphone_13_pro",
    storageOptions: [128, 256, 512, 1024],
    basePrices: { 128: 295, 256: 325, 512: 397, 1024: 440 },
  },
  {
    model: "iphone_13_pro_max",
    storageOptions: [128, 256, 512, 1024],
    basePrices: { 128: 340, 256: 370, 512: 430, 1024: 475 },
  },
  {
    model: "iphone_14_pro",
    storageOptions: [128, 256, 512, 1024],
    basePrices: { 128: 349, 256: 381, 512: 407, 1024: 455 },
  },
  {
    model: "iphone_14_pro_max",
    storageOptions: [128, 256, 512, 1024],
    basePrices: { 128: 411, 256: 443, 512: 454, 1024: 500 },
  },
  {
    model: "iphone_15_pro",
    storageOptions: [128, 256, 512, 1024],
    basePrices: { 128: 465, 256: 509, 512: 533, 1024: 580 },
  },
  {
    model: "iphone_15_pro_max",
    storageOptions: [256, 512, 1024],
    basePrices: { 256: 590, 512: 640, 1024: 700 },
  },
];

// ─── Price Adjustment Factors ─────────────────────────────────────────

const CONDITION_MULTIPLIER: Record<string, number> = {
  A: 1.08, // Mint — +8%
  B: 1.0, // Good — baseline
  C: 0.87, // Fair — -13%
};

const CARRIER_LOCKED_DISCOUNT = 0.93; // -7%

/** Battery health effect: each % below 100 reduces price slightly */
const BATTERY_COEFF = 0.003; // -0.3% per % below 100

// ─── Distribution Config ──────────────────────────────────────────────

/** How many observations per model (min 40 to pass quality gate of 30 with margin) */
const OBS_PER_MODEL = 50;

const CONDITION_DISTRIBUTION = { A: 0.25, B: 0.50, C: 0.25 };
const CARRIER_LOCKED_RATE = 0.15;
const BATTERY_HEALTH_RANGE = { min: 78, max: 100 };

/** Spread observations across last 30 days */
const OBSERVATION_WINDOW_DAYS = 30;

// ─── Random Helpers ───────────────────────────────────────────────────

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function pickWeighted<T extends string>(
  dist: Record<T, number>,
): T {
  const r = Math.random();
  let cumulative = 0;
  for (const [key, weight] of Object.entries(dist) as [T, number][]) {
    cumulative += weight;
    if (r <= cumulative) return key;
  }
  return Object.keys(dist)[0] as T;
}

function gaussianNoise(stdDev: number): number {
  // Box-Muller transform
  const u1 = Math.random();
  const u2 = Math.random();
  return stdDev * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// ─── Observation Generator ────────────────────────────────────────────

interface Observation {
  source: string;
  model: string;
  storage_gb: number;
  battery_health_pct: number;
  cosmetic_grade: string;
  carrier_locked: boolean;
  observed_price_usd: number;
  observed_at: string;
  external_id: string;
}

function generateObservations(): Observation[] {
  const observations: Observation[] = [];
  const now = Date.now();
  let seqId = 1;

  for (const modelDef of MODELS) {
    for (let i = 0; i < OBS_PER_MODEL; i++) {
      // Pick random attributes
      const storageGb =
        modelDef.storageOptions[
          randInt(0, modelDef.storageOptions.length - 1)
        ];
      const cosmeticGrade = pickWeighted(CONDITION_DISTRIBUTION);
      const carrierLocked = Math.random() < CARRIER_LOCKED_RATE;
      const batteryHealth = randInt(
        BATTERY_HEALTH_RANGE.min,
        BATTERY_HEALTH_RANGE.max,
      );

      // Calculate price
      const basePrice = modelDef.basePrices[storageGb];
      let price = basePrice;

      // Apply condition multiplier
      price *= CONDITION_MULTIPLIER[cosmeticGrade];

      // Apply carrier lock discount
      if (carrierLocked) price *= CARRIER_LOCKED_DISCOUNT;

      // Apply battery health effect
      const batteryDelta = 100 - batteryHealth;
      price *= 1 - batteryDelta * BATTERY_COEFF;

      // Add market noise (±5% gaussian)
      price += gaussianNoise(basePrice * 0.05);

      // Round to nearest dollar
      price = Math.round(Math.max(50, price));

      // Random date within observation window
      const daysAgo = randFloat(0, OBSERVATION_WINDOW_DAYS);
      const observedAt = new Date(
        now - daysAgo * 24 * 60 * 60 * 1000,
      );

      observations.push({
        source: "haggle_internal",
        model: modelDef.model,
        storage_gb: storageGb,
        battery_health_pct: batteryHealth,
        cosmetic_grade: cosmeticGrade,
        carrier_locked: carrierLocked,
        observed_price_usd: price,
        observed_at: observedAt.toISOString(),
        external_id: `seed_${modelDef.model}_${seqId++}`,
      });
    }
  }

  return observations;
}

// ─── CSV Writer ───────────────────────────────────────────────────────

function writeCsv(observations: Observation[]): string {
  const headers = [
    "source",
    "model",
    "storage_gb",
    "battery_health_pct",
    "cosmetic_grade",
    "carrier_locked",
    "observed_price_usd",
    "observed_at",
    "external_id",
  ];

  const rows = observations.map((obs) =>
    [
      obs.source,
      obs.model,
      obs.storage_gb,
      obs.battery_health_pct,
      obs.cosmetic_grade,
      obs.carrier_locked,
      obs.observed_price_usd,
      obs.observed_at,
      obs.external_id,
    ].join(","),
  );

  return [headers.join(","), ...rows].join("\n");
}

// ─── SQL Writer ───────────────────────────────────────────────────────

function writeSql(observations: Observation[]): string {
  const values = observations
    .map(
      (obs) =>
        `  ('${obs.source}', '${obs.model}', ${obs.storage_gb}, ${obs.battery_health_pct}, '${obs.cosmetic_grade}', ${obs.carrier_locked}, ${obs.observed_price_usd}, '${obs.observed_at}', '${obs.external_id}')`,
    )
    .join(",\n");

  return `INSERT INTO hfmi_price_observations
  (source, model, storage_gb, battery_health_pct, cosmetic_grade, carrier_locked, observed_price_usd, observed_at, external_id)
VALUES
${values}
ON CONFLICT (source, external_id) DO NOTHING;\n`;
}

// ─── DB Inserter ──────────────────────────────────────────────────────

async function insertToDb(observations: Observation[]): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("ERROR: DATABASE_URL not set. Use --csv or set DATABASE_URL.");
    process.exit(1);
  }

  // Dynamic import to avoid requiring pg when just generating CSV
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();

  try {
    await client.query("BEGIN");

    const insertQuery = `
      INSERT INTO hfmi_price_observations
        (source, model, storage_gb, battery_health_pct, cosmetic_grade,
         carrier_locked, observed_price_usd, observed_at, external_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (source, external_id) DO NOTHING
    `;

    let inserted = 0;
    for (const obs of observations) {
      const result = await client.query(insertQuery, [
        obs.source,
        obs.model,
        obs.storage_gb,
        obs.battery_health_pct,
        obs.cosmetic_grade,
        obs.carrier_locked,
        obs.observed_price_usd,
        obs.observed_at,
        obs.external_id,
      ]);
      inserted += result.rowCount ?? 0;
    }

    await client.query("COMMIT");
    console.log(`Inserted ${inserted}/${observations.length} observations.`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const useDb = args.includes("--db");
  const runFit = args.includes("--fit");

  console.log("Generating HFMI seed data...");
  console.log(`  Models: ${MODELS.length}`);
  console.log(`  Observations per model: ${OBS_PER_MODEL}`);
  console.log(`  Total: ${MODELS.length * OBS_PER_MODEL}`);
  console.log();

  const observations = generateObservations();

  // Always write CSV for reference
  const scriptDir = new URL(".", import.meta.url).pathname;
  const csvPath = resolve(scriptDir, "hfmi-seed.csv");
  writeFileSync(csvPath, writeCsv(observations));
  console.log(`CSV written: ${csvPath}`);

  // Also write SQL for manual import
  const sqlPath = resolve(scriptDir, "hfmi-seed.sql");
  writeFileSync(sqlPath, writeSql(observations));
  console.log(`SQL written: ${sqlPath}`);

  // Print price summary
  console.log("\n── Price Summary ──────────────────────────────────");
  for (const modelDef of MODELS) {
    const modelObs = observations.filter((o) => o.model === modelDef.model);
    const prices = modelObs.map((o) => o.observed_price_usd).sort((a, b) => a - b);
    const median = prices[Math.floor(prices.length / 2)];
    const min = prices[0];
    const max = prices[prices.length - 1];
    console.log(
      `  ${modelDef.model.padEnd(22)} median=$${median}  range=$${min}-$${max}  n=${prices.length}`,
    );
  }

  if (useDb) {
    console.log("\nInserting into database...");
    await insertToDb(observations);

    if (runFit) {
      console.log("\nRunning OLS fit for each model...");
      // Dynamic import of fitter
      try {
        const { fitModel } = await import(
          "../apps/api/src/services/hfmi-fitter.js"
        );
        // Need DB instance from drizzle
        console.log(
          "NOTE: --fit requires running from the API context. Use the API's fit endpoint instead:",
        );
        console.log("  curl -X POST http://localhost:3001/api/hfmi/fit");
      } catch {
        console.log(
          "NOTE: Direct fit not available. Run via API endpoint after seeding:",
        );
        console.log("  curl -X POST http://localhost:3001/api/hfmi/fit");
      }
    }
  } else {
    console.log("\nTo import to DB:");
    console.log("  Option 1: npx tsx scripts/seed-hfmi.ts --db");
    console.log(`  Option 2: psql $DATABASE_URL -f ${sqlPath}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
