/**
 * HFMI nightly fit job.
 *
 * For each of the 6 iPhone Pro SKUs:
 *   1. Load trailing-30d observations from `hfmi_price_observations`.
 *   2. Apply Browse→Sold correction factor (0.92) to ebay_browse rows.
 *   3. Impute missing battery_health_pct with the per-SKU median.
 *   4. Build design matrix and fit a hedonic OLS regression on log(price).
 *   5. Compute R², residual std, then write a new row to
 *      `hfmi_model_coefficients`.
 *
 * Runs via cron 03:00 UTC (scheduling is infra; this function is
 * exportable and invoked by the cron wrapper).
 *
 * Note on solver: simple-statistics only exposes simple (single-predictor)
 * linear regression. For the multi-feature hedonic model we need matrix
 * OLS via the normal equations. A compact pure-TS implementation lives
 * below (Gauss-Jordan inversion of X'X). simple-statistics is still used
 * for mean/median/standardDeviation utilities. This deviation is documented
 * in BUILD-LOG Part B.
 *
 * See docs/mvp/2026-04-08_hfmi-spec.md §3, §6.
 */

import {
  type Database,
  hfmiPriceObservations,
  hfmiModelCoefficients,
  sql,
} from "@haggle/db";
import { mean, standardDeviation } from "simple-statistics";

import { HFMI_SKUS } from "./hfmi-ingest.js";

// ─── Config ───────────────────────────────────────────────────────────

export const HFMI_FIT_VERSION = "v0.1.0";
/** Browse API asking-price → sold-price correction factor (§4.2). */
export const BROWSE_TO_SOLD_FACTOR = 0.92;
/** Minimum sample size to publish a new fit (§6.1 step 5). */
export const MIN_SAMPLE_SIZE = 30;
/** Minimum R² to publish a new fit. */
export const MIN_R_SQUARED = 0.5;
/** Trailing window for observations (days). */
export const WINDOW_DAYS = 30;

// Feature vector order MUST match coefficient keys downstream in hfmi.service.ts
const FEATURE_KEYS = [
  "intercept",
  "storage_256",
  "storage_512",
  "storage_1024",
  "battery",
  "cosmetic_b",
  "cosmetic_c",
  "carrier_locked",
  "days_since_listing",
] as const;
type FeatureKey = (typeof FEATURE_KEYS)[number];

// ─── Types ────────────────────────────────────────────────────────────

export interface HfmiFitResult {
  modelId: string;
  sampleSize: number;
  rSquared: number;
  residualStd: number;
  coefficients: Record<FeatureKey | "residual_std", number>;
  published: boolean;
  skipReason?: string;
  error?: string;
}

export interface HfmiFitSummary {
  results: HfmiFitResult[];
  startedAt: Date;
  finishedAt: Date;
}

// ─── Main entry point ────────────────────────────────────────────────

export async function runHfmiFit(
  db: Database,
  opts: { now?: () => Date } = {},
): Promise<HfmiFitSummary> {
  const startedAt = (opts.now ?? (() => new Date()))();
  const cutoff = new Date(startedAt.getTime() - WINDOW_DAYS * 86_400_000);

  const results: HfmiFitResult[] = [];

  for (const sku of HFMI_SKUS) {
    try {
      const rows = await loadObservations(db, sku.modelId, cutoff);
      const result = fitSku(sku.modelId, rows, startedAt);

      if (result.published) {
        await db.insert(hfmiModelCoefficients).values({
          model: sku.modelId,
          fittedAt: startedAt,
          coefficients: result.coefficients,
          rSquared: result.rSquared.toFixed(4),
          sampleSize: result.sampleSize,
          residualStd: result.residualStd.toFixed(6),
          fitVersion: HFMI_FIT_VERSION,
        });
        console.log(
          `[hfmi-fit] ${sku.modelId}: R²=${result.rSquared.toFixed(3)} n=${result.sampleSize} residualStd=${result.residualStd.toFixed(3)}`,
        );
      } else {
        console.warn(
          `[hfmi-fit] ${sku.modelId}: SKIP (${result.skipReason}) n=${result.sampleSize} R²=${result.rSquared.toFixed(3)}`,
        );
      }
      results.push(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[hfmi-fit] ${sku.modelId}: error`, msg);
      results.push({
        modelId: sku.modelId,
        sampleSize: 0,
        rSquared: 0,
        residualStd: 0,
        coefficients: zeroCoefficients(),
        published: false,
        error: msg,
      });
    }
  }

  return { results, startedAt, finishedAt: new Date() };
}

// ─── Observation loader ──────────────────────────────────────────────

interface ObservationRow {
  source: string;
  storageGb: number | null;
  batteryHealthPct: number | null;
  cosmeticGrade: "A" | "B" | "C" | null;
  carrierLocked: boolean;
  priceUsd: number;
  observedAt: Date;
}

async function loadObservations(
  db: Database,
  modelId: string,
  cutoff: Date,
): Promise<ObservationRow[]> {
  // Drizzle raw SQL — avoids needing gte/and operators exported from db index.
  const raw = await db.execute(sql`
    SELECT source, storage_gb, battery_health_pct, cosmetic_grade,
           carrier_locked, observed_price_usd, observed_at
    FROM ${hfmiPriceObservations}
    WHERE model = ${modelId}
      AND observed_at >= ${cutoff}
      AND storage_gb IS NOT NULL
      AND cosmetic_grade IS NOT NULL
      AND observed_price_usd BETWEEN 200 AND 1500
  `);
  const rows = (raw as unknown as { rows?: Record<string, unknown>[] }).rows
    ?? (raw as unknown as Record<string, unknown>[]);
  return (rows as Record<string, unknown>[]).map((r) => ({
    source: String(r.source),
    storageGb: r.storage_gb == null ? null : Number(r.storage_gb),
    batteryHealthPct:
      r.battery_health_pct == null ? null : Number(r.battery_health_pct),
    cosmeticGrade: (r.cosmetic_grade ?? null) as "A" | "B" | "C" | null,
    carrierLocked: Boolean(r.carrier_locked),
    priceUsd: Number(r.observed_price_usd),
    observedAt: new Date(String(r.observed_at)),
  }));
}

// ─── Fit core ─────────────────────────────────────────────────────────

export function fitSku(
  modelId: string,
  rows: ObservationRow[],
  now: Date,
): HfmiFitResult {
  if (rows.length < MIN_SAMPLE_SIZE) {
    return {
      modelId,
      sampleSize: rows.length,
      rSquared: 0,
      residualStd: 0,
      coefficients: zeroCoefficients(),
      published: false,
      skipReason: `sample_size<${MIN_SAMPLE_SIZE}`,
    };
  }

  // Median battery for imputation.
  const batteriesKnown = rows
    .map((r) => r.batteryHealthPct)
    .filter((b): b is number => b != null && b > 0);
  const batteryMedian =
    batteriesKnown.length > 0 ? median(batteriesKnown) : 90;

  // Build y (log corrected price) and X (feature matrix)
  const y: number[] = [];
  const X: number[][] = [];
  for (const r of rows) {
    if (r.storageGb == null || r.cosmeticGrade == null) continue;
    let price = r.priceUsd;
    if (r.source === "ebay_browse") price *= BROWSE_TO_SOLD_FACTOR;
    if (price <= 0) continue;

    const battery = r.batteryHealthPct ?? batteryMedian;
    const daysSince =
      (now.getTime() - r.observedAt.getTime()) / 86_400_000;

    const row = [
      1, // intercept
      r.storageGb === 256 ? 1 : 0,
      r.storageGb === 512 ? 1 : 0,
      r.storageGb === 1024 ? 1 : 0,
      battery,
      r.cosmeticGrade === "B" ? 1 : 0,
      r.cosmeticGrade === "C" ? 1 : 0,
      r.carrierLocked ? 1 : 0,
      Math.max(0, daysSince),
    ];
    X.push(row);
    y.push(Math.log(price));
  }

  if (X.length < MIN_SAMPLE_SIZE) {
    return {
      modelId,
      sampleSize: X.length,
      rSquared: 0,
      residualStd: 0,
      coefficients: zeroCoefficients(),
      published: false,
      skipReason: `usable_rows<${MIN_SAMPLE_SIZE}`,
    };
  }

  let betas: number[];
  try {
    betas = olsNormalEquations(X, y);
  } catch (err) {
    return {
      modelId,
      sampleSize: X.length,
      rSquared: 0,
      residualStd: 0,
      coefficients: zeroCoefficients(),
      published: false,
      skipReason: `solver_failed:${err instanceof Error ? err.message : "unknown"}`,
    };
  }

  // Residuals and R²
  const yHat = X.map((row) => dot(row, betas));
  const residuals = y.map((yi, i) => yi - yHat[i]);
  const ssRes = residuals.reduce((a, r) => a + r * r, 0);
  const yMean = mean(y);
  const ssTot = y.reduce((a, yi) => a + (yi - yMean) ** 2, 0);
  const rSq = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  const residualStd =
    residuals.length > 1 ? standardDeviation(residuals) : 0;

  const coefficients: Record<FeatureKey | "residual_std", number> = {
    intercept: betas[0],
    storage_256: betas[1],
    storage_512: betas[2],
    storage_1024: betas[3],
    battery: betas[4],
    cosmetic_b: betas[5],
    cosmetic_c: betas[6],
    carrier_locked: betas[7],
    days_since_listing: betas[8],
    residual_std: residualStd,
  };

  const published = rSq >= MIN_R_SQUARED && X.length >= MIN_SAMPLE_SIZE;
  return {
    modelId,
    sampleSize: X.length,
    rSquared: rSq,
    residualStd,
    coefficients,
    published,
    skipReason: published ? undefined : `r_squared<${MIN_R_SQUARED}`,
  };
}

// ─── OLS via Normal Equations (pure TS) ──────────────────────────────

/**
 * Solve β̂ = (XᵀX)⁻¹ Xᵀy via Gauss-Jordan elimination.
 * Throws on singular matrix.
 */
export function olsNormalEquations(X: number[][], y: number[]): number[] {
  const n = X.length;
  const p = X[0].length;
  if (n < p) throw new Error("underdetermined system");

  // XtX (p × p) and Xty (p)
  const XtX: number[][] = Array.from({ length: p }, () => Array(p).fill(0));
  const Xty: number[] = Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    const row = X[i];
    const yi = y[i];
    for (let j = 0; j < p; j++) {
      Xty[j] += row[j] * yi;
      for (let k = 0; k < p; k++) {
        XtX[j][k] += row[j] * row[k];
      }
    }
  }

  // Augment [XtX | Xty] and reduce.
  const aug: number[][] = XtX.map((r, i) => [...r, Xty[i]]);
  for (let col = 0; col < p; col++) {
    // Partial pivot
    let pivot = col;
    for (let r = col + 1; r < p; r++) {
      if (Math.abs(aug[r][col]) > Math.abs(aug[pivot][col])) pivot = r;
    }
    if (Math.abs(aug[pivot][col]) < 1e-12) {
      throw new Error("singular XtX");
    }
    if (pivot !== col) {
      [aug[col], aug[pivot]] = [aug[pivot], aug[col]];
    }
    const pv = aug[col][col];
    for (let k = col; k <= p; k++) aug[col][k] /= pv;
    for (let r = 0; r < p; r++) {
      if (r === col) continue;
      const factor = aug[r][col];
      if (factor === 0) continue;
      for (let k = col; k <= p; k++) {
        aug[r][k] -= factor * aug[col][k];
      }
    }
  }
  return aug.map((row) => row[p]);
}

// ─── Utilities ────────────────────────────────────────────────────────

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function zeroCoefficients(): Record<FeatureKey | "residual_std", number> {
  return {
    intercept: 0,
    storage_256: 0,
    storage_512: 0,
    storage_1024: 0,
    battery: 0,
    cosmetic_b: 0,
    cosmetic_c: 0,
    carrier_locked: 0,
    days_since_listing: 0,
    residual_std: 0,
  };
}
