/**
 * HFMI query service.
 *
 * Reads the latest fitted coefficients for a SKU from
 * `hfmi_model_coefficients` and returns a median prediction with
 * confidence interval. v0 positioning is REFERENCE ONLY — CI is padded
 * with a ±$35 floor per spec §1.0.
 *
 * See docs/mvp/2026-04-08_hfmi-spec.md §3.2, §8.1.
 */

import {
  type Database,
  hfmiModelCoefficients,
  hfmiPriceObservations,
  sql,
} from "@haggle/db";

// ─── Public types ─────────────────────────────────────────────────────

export type HfmiModelId =
  | "iphone_13_pro"
  | "iphone_13_pro_max"
  | "iphone_14_pro"
  | "iphone_14_pro_max"
  | "iphone_15_pro"
  | "iphone_15_pro_max";

export interface HfmiQueryInput {
  model: HfmiModelId;
  storageGb: number;
  batteryHealthPct?: number;
  cosmeticGrade?: "A" | "B" | "C";
  carrierLocked?: boolean;
}

export interface HfmiQueryResult {
  medianUsd: number;
  confidenceInterval: [number, number];
  sampleSize: number;
  lastRefit: Date;
  coefficientVersion: string;
}

export class HfmiUnavailableError extends Error {
  constructor(reason: string) {
    super(`HFMI unavailable: ${reason}`);
    this.name = "HfmiUnavailableError";
  }
}

// ─── Constants ────────────────────────────────────────────────────────

/** Minimum half-width of confidence interval in USD (§1.0). */
const CI_FLOOR_USD = 35;
/** 95% z-score for normal residuals. */
const Z_95 = 1.96;
/** Default battery health when caller doesn't provide one. */
const DEFAULT_BATTERY_HEALTH = 90;

// ─── Main query ───────────────────────────────────────────────────────

export async function getHfmiMedian(
  db: Database,
  input: HfmiQueryInput,
): Promise<HfmiQueryResult> {
  const row = await loadLatestCoefficients(db, input.model);
  if (!row) {
    throw new HfmiUnavailableError("no_fresh_fit");
  }

  const coef = row.coefficients;
  const battery = input.batteryHealthPct ?? DEFAULT_BATTERY_HEALTH;
  const cosmetic = input.cosmeticGrade ?? "B";
  const carrierLocked = input.carrierLocked ?? false;

  const logP =
    num(coef.intercept) +
    num(coef.storage_256) * (input.storageGb === 256 ? 1 : 0) +
    num(coef.storage_512) * (input.storageGb === 512 ? 1 : 0) +
    num(coef.storage_1024) * (input.storageGb === 1024 ? 1 : 0) +
    num(coef.battery) * battery +
    num(coef.cosmetic_b) * (cosmetic === "B" ? 1 : 0) +
    num(coef.cosmetic_c) * (cosmetic === "C" ? 1 : 0) +
    num(coef.carrier_locked) * (carrierLocked ? 1 : 0) +
    num(coef.days_since_listing) * 0;

  const median = Math.exp(logP);
  const residualStd = Number(row.residualStd) || num(coef.residual_std);
  const rawLow = Math.exp(logP - Z_95 * residualStd);
  const rawHigh = Math.exp(logP + Z_95 * residualStd);

  // Floor the CI width at ±$35
  const halfWidth = Math.max(CI_FLOOR_USD, (rawHigh - rawLow) / 2);
  const ciLow = Math.max(0, median - halfWidth);
  const ciHigh = median + halfWidth;

  return {
    medianUsd: roundUsd(median),
    confidenceInterval: [roundUsd(ciLow), roundUsd(ciHigh)],
    sampleSize: row.sampleSize,
    lastRefit: row.fittedAt,
    coefficientVersion: row.fitVersion,
  };
}

// ─── DB row loader ────────────────────────────────────────────────────

interface LatestCoefficientsRow {
  coefficients: Record<string, number>;
  residualStd: string | number;
  sampleSize: number;
  fittedAt: Date;
  fitVersion: string;
}

async function loadLatestCoefficients(
  db: Database,
  model: HfmiModelId,
): Promise<LatestCoefficientsRow | null> {
  // Use drizzle query builder — findFirst on the table schema.
  const row = await db.query.hfmiModelCoefficients.findFirst({
    where: (fields, ops) =>
      ops.and(
        ops.eq(fields.model, model),
        sql`${fields.rSquared} >= 0.50`,
        sql`${fields.sampleSize} >= 30`,
      ),
    orderBy: (fields, ops) => [ops.desc(fields.fittedAt)],
  });
  // Fallback: direct SELECT if query helper isn't present.
  if (!row) {
    const raw = await db.execute(sql`
      SELECT coefficients, residual_std, sample_size, fitted_at, fit_version
      FROM ${hfmiModelCoefficients}
      WHERE model = ${model}
        AND r_squared >= 0.50
        AND sample_size >= 30
      ORDER BY fitted_at DESC
      LIMIT 1
    `);
    const rows =
      (raw as unknown as { rows?: Record<string, unknown>[] }).rows ??
      (raw as unknown as Record<string, unknown>[]);
    const first = (rows as Record<string, unknown>[])[0];
    if (!first) return null;
    return {
      coefficients: first.coefficients as Record<string, number>,
      residualStd: first.residual_std as string | number,
      sampleSize: Number(first.sample_size),
      fittedAt: new Date(String(first.fitted_at)),
      fitVersion: String(first.fit_version),
    };
  }
  return {
    coefficients: row.coefficients as Record<string, number>,
    residualStd: row.residualStd as unknown as string | number,
    sampleSize: row.sampleSize,
    fittedAt: row.fittedAt,
    fitVersion: row.fitVersion,
  };
}

// ─── Median price from raw observations ───────────────────────────────

export interface MedianPriceResult {
  median: number;
  sample_count: number;
  period_days: 30;
}

/**
 * Compute median observed_price_usd from the last 30 days of observations.
 * Returns null if there are no matching rows.
 */
export async function getMedianPrice(
  db: Database,
  model: string,
  storage?: number,
  condition?: string,
): Promise<MedianPriceResult | null> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Build optional filter fragments
  const storageClause =
    storage !== undefined ? sql` AND storage_gb = ${storage}` : sql``;
  const conditionClause =
    condition === "A" || condition === "B" || condition === "C"
      ? sql` AND cosmetic_grade = ${condition}`
      : sql``;

  const raw = await db.execute(sql`
    SELECT observed_price_usd::float8 AS price
    FROM ${hfmiPriceObservations}
    WHERE model = ${model}
      AND observed_at > ${cutoff.toISOString()}${storageClause}${conditionClause}
    ORDER BY observed_price_usd::float8
  `);

  const rows =
    (raw as unknown as { rows?: Record<string, unknown>[] }).rows ??
    (raw as unknown as Record<string, unknown>[]);

  const prices = (rows as Record<string, unknown>[])
    .map((r) => Number(r.price))
    .filter((p) => p > 0);

  if (prices.length === 0) return null;

  const mid = Math.floor(prices.length / 2);
  const median =
    prices.length % 2 === 0
      ? (prices[mid - 1] + prices[mid]) / 2
      : prices[mid];

  return {
    median: roundUsd(median),
    sample_count: prices.length,
    period_days: 30,
  };
}

// ─── Hedonic estimate from coefficients ───────────────────────────────

export interface HedonicEstimateResult {
  estimate: number;
  sampleSize: number;
  fitVersion: string;
  lastRefit: Date;
}

export interface HedonicParams {
  storageGb: number;
  batteryHealthPct?: number;
  cosmeticGrade?: "A" | "B" | "C";
  carrierLocked?: boolean;
}

/**
 * Apply the latest fitted coefficients to get a hedonic price estimate.
 * Returns null if no qualified fit exists.
 */
export async function getHedonicEstimate(
  db: Database,
  model: string,
  params: HedonicParams,
): Promise<HedonicEstimateResult | null> {
  const row = await loadLatestCoefficients(db, model as HfmiModelId);
  if (!row) return null;

  const coef = row.coefficients;
  const battery = params.batteryHealthPct ?? 90;
  const cosmetic = params.cosmeticGrade ?? "B";
  const carrierLocked = params.carrierLocked ?? false;

  const logP =
    num(coef.intercept) +
    num(coef.storage_256) * (params.storageGb === 256 ? 1 : 0) +
    num(coef.storage_512) * (params.storageGb === 512 ? 1 : 0) +
    num(coef.storage_1024) * (params.storageGb === 1024 ? 1 : 0) +
    num(coef.battery) * battery +
    num(coef.cosmetic_b) * (cosmetic === "B" ? 1 : 0) +
    num(coef.cosmetic_c) * (cosmetic === "C" ? 1 : 0) +
    num(coef.carrier_locked) * (carrierLocked ? 1 : 0);

  return {
    estimate: roundUsd(Math.exp(logP)),
    sampleSize: row.sampleSize,
    fitVersion: row.fitVersion,
    lastRefit: row.fittedAt,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function roundUsd(v: number): number {
  return Math.round(v * 100) / 100;
}
