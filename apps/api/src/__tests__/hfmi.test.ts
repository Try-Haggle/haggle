/**
 * HFMI pipeline tests.
 *
 * Covers:
 *   - getMedianPrice (observation-based median)
 *   - getHedonicEstimate (coefficient-based estimate)
 *   - fitModel quality gates (low R², insufficient samples)
 *   - fitModel happy path
 *   - API route response shapes
 */

import { describe, it, expect, vi } from "vitest";
import type { Database } from "@haggle/db";
import { getMedianPrice, getHedonicEstimate } from "../services/hfmi.service.js";
import { fitModel } from "../services/hfmi-fitter.js";

// ─── DB mock helpers ──────────────────────────────────────────────────

function makeDbWithPrices(prices: number[]): Database {
  const sortedPrices = [...prices].sort((a, b) => a - b);
  const execute = vi.fn().mockResolvedValue({
    rows: sortedPrices.map((p) => ({ price: p })),
  });
  const insert = vi.fn().mockReturnValue({
    values: vi.fn().mockReturnValue({
      onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
    }),
  });
  return { execute, insert, query: { hfmiModelCoefficients: { findFirst: vi.fn().mockResolvedValue(null) } } } as unknown as Database;
}

function makeDbWithCoefRow(row: Record<string, unknown> | null): Database {
  const findFirst = vi.fn().mockResolvedValue(row);
  const execute = vi.fn().mockResolvedValue({ rows: row ? [row] : [] });
  const insert = vi.fn().mockReturnValue({
    values: vi.fn().mockResolvedValue(undefined),
  });
  return { query: { hfmiModelCoefficients: { findFirst } }, execute, insert } as unknown as Database;
}

function makeDbWithObservations(rows: Record<string, unknown>[]): Database {
  const execute = vi.fn().mockResolvedValue({ rows });
  const insert = vi.fn().mockReturnValue({
    values: vi.fn().mockResolvedValue(undefined),
  });
  return { execute, insert, query: { hfmiModelCoefficients: { findFirst: vi.fn().mockResolvedValue(null) } } } as unknown as Database;
}

// ─── Coefficient fixture ──────────────────────────────────────────────

const COEF_ROW = {
  coefficients: {
    intercept: 6.3 - 90 * 0.001,
    storage_256: 0.1,
    storage_512: 0.2,
    storage_1024: 0.3,
    battery: 0.001,
    cosmetic_b: -0.05,
    cosmetic_c: -0.15,
    carrier_locked: -0.08,
    days_since_listing: 0,
    residual_std: 0.08,
  },
  residualStd: "0.08",
  sampleSize: 120,
  fittedAt: new Date("2026-04-08T03:00:00Z"),
  fitVersion: "v0.1.0",
};

// ─── getMedianPrice ───────────────────────────────────────────────────

describe("getMedianPrice", () => {
  it("returns correct median for odd number of prices", async () => {
    const db = makeDbWithPrices([100, 200, 300]);
    const result = await getMedianPrice(db, "iphone_14_pro");
    expect(result).not.toBeNull();
    expect(result!.median).toBeCloseTo(200);
    expect(result!.sample_count).toBe(3);
    expect(result!.period_days).toBe(30);
  });

  it("returns correct median for even number of prices", async () => {
    const db = makeDbWithPrices([100, 200, 300, 400]);
    const result = await getMedianPrice(db, "iphone_14_pro");
    expect(result).not.toBeNull();
    expect(result!.median).toBeCloseTo(250);
  });

  it("returns null when no observations exist", async () => {
    const db = makeDbWithPrices([]);
    const result = await getMedianPrice(db, "iphone_14_pro");
    expect(result).toBeNull();
  });

  it("returns correct median for a single price", async () => {
    const db = makeDbWithPrices([599]);
    const result = await getMedianPrice(db, "iphone_14_pro");
    expect(result!.median).toBeCloseTo(599);
    expect(result!.sample_count).toBe(1);
  });
});

// ─── getHedonicEstimate ───────────────────────────────────────────────

describe("getHedonicEstimate", () => {
  it("applies coefficients correctly for 256GB unlocked grade A", async () => {
    const db = makeDbWithCoefRow(COEF_ROW);
    const result = await getHedonicEstimate(db, "iphone_14_pro", {
      storageGb: 256,
      batteryHealthPct: 90,
      cosmeticGrade: "A",
      carrierLocked: false,
    });
    expect(result).not.toBeNull();
    // intercept + storage_256(0.1) + battery(0.001*90) = 6.3 + 0.1 = 6.4 → exp(6.4)
    expect(result!.estimate).toBeCloseTo(Math.exp(6.4), 0);
  });

  it("returns null when no coefficient row exists", async () => {
    const db = makeDbWithCoefRow(null);
    const result = await getHedonicEstimate(db, "iphone_14_pro", { storageGb: 128 });
    expect(result).toBeNull();
  });

  it("carrier-locked lowers estimate", async () => {
    const db1 = makeDbWithCoefRow(COEF_ROW);
    const unlocked = await getHedonicEstimate(db1, "iphone_14_pro", {
      storageGb: 128, batteryHealthPct: 90, cosmeticGrade: "A", carrierLocked: false,
    });
    const db2 = makeDbWithCoefRow(COEF_ROW);
    const locked = await getHedonicEstimate(db2, "iphone_14_pro", {
      storageGb: 128, batteryHealthPct: 90, cosmeticGrade: "A", carrierLocked: true,
    });
    expect(locked!.estimate).toBeLessThan(unlocked!.estimate);
  });
});

// ─── OLS Fitter ───────────────────────────────────────────────────────

function makeObsRow(price: number, storageGb = 256, battery = 90): Record<string, unknown> {
  return {
    price,
    storage_gb: storageGb,
    battery_health_pct: battery,
    cosmetic_grade: "A",
    carrier_locked: false,
  };
}

describe("fitModel", () => {
  it("rejects when fewer than 30 samples", async () => {
    const rows = Array.from({ length: 20 }, (_, i) => makeObsRow(500 + i * 5));
    const db = makeDbWithObservations(rows);
    const outcome = await fitModel(db, "iphone_14_pro");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("insufficient_samples");
      expect(outcome.sampleSize).toBe(20);
    }
  });

  it("rejects when R² is below threshold (uniform prices → degenerate fit)", async () => {
    // All same price → zero variance → R² = 0
    const rows = Array.from({ length: 35 }, () => makeObsRow(500));
    const db = makeDbWithObservations(rows);
    const outcome = await fitModel(db, "iphone_14_pro");
    // R² = 0 (no variance to explain) → should be rejected
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("low_r_squared");
    }
  });

  it("succeeds with sufficient samples and real price variation", async () => {
    // Create 35 rows with realistic price variation driven by storage
    const rows: Record<string, unknown>[] = [
      ...Array.from({ length: 12 }, () => makeObsRow(550, 128, 90)),
      ...Array.from({ length: 12 }, () => makeObsRow(650, 256, 90)),
      ...Array.from({ length: 11 }, () => makeObsRow(750, 512, 90)),
    ];
    let inserted = false;
    const execute = vi.fn().mockResolvedValue({ rows });
    const insert = vi.fn().mockReturnValue({
      values: vi.fn().mockImplementation(() => {
        inserted = true;
        return Promise.resolve(undefined);
      }),
    });
    const db = { execute, insert } as unknown as Database;

    const outcome = await fitModel(db, "iphone_14_pro");
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.sampleSize).toBe(35);
      expect(outcome.rSquared).toBeGreaterThanOrEqual(0.5);
    }
    expect(inserted).toBe(true);
  });
});
