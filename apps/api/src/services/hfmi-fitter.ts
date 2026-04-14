/**
 * HFMI OLS (Ordinary Least Squares) Fitter
 *
 * Fits a log-linear hedonic regression on hfmi_price_observations for a given
 * model SKU. Writes fitted coefficients to hfmi_model_coefficients if quality
 * gates pass.
 *
 * Quality gates (§6 of HFMI spec):
 *   - R² ≥ 0.50
 *   - sample_size ≥ 30
 *
 * See docs/mvp/2026-04-08_hfmi-spec.md §6.
 */

import {
  type Database,
  hfmiPriceObservations,
  hfmiModelCoefficients,
  sql,
} from "@haggle/db";
import type { HfmiModelId } from "./hfmi.service.js";

// ─── Quality gates ────────────────────────────────────────────────────

const MIN_R_SQUARED = 0.50;
const MIN_SAMPLE_SIZE = 30;
const FIT_WINDOW_DAYS = 90;
const FIT_VERSION = "v0.1.0";

// ─── Types ────────────────────────────────────────────────────────────

export interface FitResult {
  ok: true;
  model: string;
  sampleSize: number;
  rSquared: number;
  fitVersion: string;
}

export interface FitRejected {
  ok: false;
  reason: "insufficient_samples" | "low_r_squared";
  sampleSize: number;
  rSquared?: number;
}

export type FitOutcome = FitResult | FitRejected;

// Feature vector for one observation
interface FeatureRow {
  logPrice: number;
  storage256: number;
  storage512: number;
  storage1024: number;
  battery: number;
  cosmeticB: number;
  cosmeticC: number;
  carrierLocked: number;
}

// ─── Main fit function ────────────────────────────────────────────────

/**
 * Fit OLS hedonic regression for `model`. Returns FitRejected if quality
 * gates fail; inserts a new row and returns FitResult otherwise.
 */
export async function fitModel(
  db: Database,
  model: HfmiModelId,
): Promise<FitOutcome> {
  const cutoff = new Date(Date.now() - FIT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // ── Load observations ──────────────────────────────────────────────
  const raw = await db.execute(sql`
    SELECT
      observed_price_usd::float8 AS price,
      storage_gb,
      battery_health_pct,
      cosmetic_grade,
      carrier_locked
    FROM ${hfmiPriceObservations}
    WHERE model = ${model}
      AND observed_at > ${cutoff.toISOString()}
  `);

  const rawRows =
    (raw as unknown as { rows?: Record<string, unknown>[] }).rows ??
    (raw as unknown as Record<string, unknown>[]);

  const n = rawRows.length;
  if (n < MIN_SAMPLE_SIZE) {
    return { ok: false, reason: "insufficient_samples", sampleSize: n };
  }

  // ── Build feature matrix ───────────────────────────────────────────
  const rows: FeatureRow[] = rawRows.map((r) => ({
    logPrice: Math.log(Number(r.price)),
    storage256: Number(r.storage_gb) === 256 ? 1 : 0,
    storage512: Number(r.storage_gb) === 512 ? 1 : 0,
    storage1024: Number(r.storage_gb) === 1024 ? 1 : 0,
    battery: Number(r.battery_health_pct ?? 90),
    cosmeticB: r.cosmetic_grade === "B" ? 1 : 0,
    cosmeticC: r.cosmetic_grade === "C" ? 1 : 0,
    carrierLocked: r.carrier_locked ? 1 : 0,
  }));

  // ── OLS via normal equations (X'X)^-1 X'y ─────────────────────────
  // Feature columns: intercept, s256, s512, s1024, battery, gradeB, gradeC, locked
  const K = 8;
  const X: number[][] = rows.map((r) => [
    1, r.storage256, r.storage512, r.storage1024,
    r.battery, r.cosmeticB, r.cosmeticC, r.carrierLocked,
  ]);
  const y: number[] = rows.map((r) => r.logPrice);

  const beta = solveOls(X, y, K);

  // ── R² ────────────────────────────────────────────────────────────
  const yHat = X.map((xi) => dot(xi, beta));
  const yMean = y.reduce((a, b) => a + b, 0) / n;
  const ssTot = y.reduce((acc, yi) => acc + (yi - yMean) ** 2, 0);
  const ssRes = y.reduce((acc, yi, i) => acc + (yi - yHat[i]) ** 2, 0);
  const rSquared = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

  if (rSquared < MIN_R_SQUARED) {
    return { ok: false, reason: "low_r_squared", sampleSize: n, rSquared };
  }

  // ── Residual std (log scale) ───────────────────────────────────────
  const residuals = y.map((yi, i) => yi - yHat[i]);
  const residualVariance =
    residuals.reduce((acc, r) => acc + r ** 2, 0) / Math.max(n - K, 1);
  const residualStd = Math.sqrt(residualVariance);

  // ── Build coefficient record ───────────────────────────────────────
  const coefficients: Record<string, number> = {
    intercept: beta[0],
    storage_256: beta[1],
    storage_512: beta[2],
    storage_1024: beta[3],
    battery: beta[4],
    cosmetic_b: beta[5],
    cosmetic_c: beta[6],
    carrier_locked: beta[7],
    days_since_listing: 0,
    residual_std: residualStd,
  };

  // ── Insert new row ────────────────────────────────────────────────
  await db.insert(hfmiModelCoefficients).values({
    model,
    fittedAt: new Date(),
    coefficients,
    rSquared: rSquared.toFixed(4),
    sampleSize: n,
    residualStd: residualStd.toFixed(6),
    fitVersion: FIT_VERSION,
  });

  return { ok: true, model, sampleSize: n, rSquared, fitVersion: FIT_VERSION };
}

// ─── OLS helpers ──────────────────────────────────────────────────────

/** Compute (X'X)^-1 X'y via Gauss-Jordan elimination. */
function solveOls(X: number[][], y: number[], K: number): number[] {
  // Build X'X (K×K) and X'y (K×1)
  const XtX: number[][] = Array.from({ length: K }, () => new Array(K).fill(0));
  const Xty: number[] = new Array(K).fill(0);

  for (let i = 0; i < X.length; i++) {
    for (let j = 0; j < K; j++) {
      Xty[j] += X[i][j] * y[i];
      for (let k = 0; k < K; k++) {
        XtX[j][k] += X[i][j] * X[i][k];
      }
    }
  }

  // Augmented matrix [XtX | Xty]
  const aug: number[][] = XtX.map((row, i) => [...row, Xty[i]]);

  // Gauss-Jordan elimination
  for (let col = 0; col < K; col++) {
    // Pivot
    let maxRow = col;
    for (let row = col + 1; row < K; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
    }
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];

    const pivot = aug[col][col];
    if (Math.abs(pivot) < 1e-12) continue; // singular or near-singular column

    for (let k = col; k <= K; k++) aug[col][k] /= pivot;

    for (let row = 0; row < K; row++) {
      if (row === col) continue;
      const factor = aug[row][col];
      for (let k = col; k <= K; k++) {
        aug[row][k] -= factor * aug[col][k];
      }
    }
  }

  return aug.map((row) => row[K]);
}

function dot(a: number[], b: number[]): number {
  return a.reduce((acc, ai, i) => acc + ai * b[i], 0);
}
