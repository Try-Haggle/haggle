import { describe, it, expect, vi } from "vitest";
import {
  getHfmiMedian,
  HfmiUnavailableError,
} from "../services/hfmi.service.js";
import type { Database } from "@haggle/db";

// Build a mocked db object shaped for the service's call pattern.
function makeDb(row: Record<string, unknown> | null): Database {
  const findFirst = vi.fn().mockResolvedValue(row);
  const execute = vi.fn().mockResolvedValue({ rows: row ? [row] : [] });
  return {
    query: { hfmiModelCoefficients: { findFirst } },
    execute,
  } as unknown as Database;
}

// Toy coefficients that produce a deterministic prediction.
// log(price) at baseline (128GB, grade A, unlocked, today) = 6.3  →  median ≈ $544.57
const BASELINE_COEF = {
  intercept: 6.3 - 90 * 0.001, // subtract battery contribution at 90
  storage_256: 0.1,
  storage_512: 0.2,
  storage_1024: 0.3,
  battery: 0.001,
  cosmetic_b: -0.05,
  cosmetic_c: -0.15,
  carrier_locked: -0.08,
  days_since_listing: 0,
  residual_std: 0.08,
};

const BASELINE_ROW = {
  coefficients: BASELINE_COEF,
  residualStd: "0.08",
  residual_std: "0.08",
  sampleSize: 120,
  sample_size: 120,
  fittedAt: new Date("2026-04-08T03:00:00Z"),
  fitted_at: "2026-04-08T03:00:00Z",
  fitVersion: "v0.1.0",
  fit_version: "v0.1.0",
};

describe("getHfmiMedian", () => {
  it("throws HfmiUnavailableError when no fit row exists", async () => {
    const db = makeDb(null);
    await expect(
      getHfmiMedian(db, { model: "iphone_14_pro", storageGb: 256 }),
    ).rejects.toBeInstanceOf(HfmiUnavailableError);
  });

  it("returns a median for 128GB grade A unlocked baseline", async () => {
    const db = makeDb(BASELINE_ROW);
    const result = await getHfmiMedian(db, {
      model: "iphone_14_pro",
      storageGb: 128,
      batteryHealthPct: 90,
      cosmeticGrade: "A",
      carrierLocked: false,
    });
    expect(result.medianUsd).toBeCloseTo(Math.exp(6.3), 1);
    expect(result.sampleSize).toBe(120);
    expect(result.coefficientVersion).toBe("v0.1.0");
  });

  it("applies storage premium for 256GB", async () => {
    const db = makeDb(BASELINE_ROW);
    const base = await getHfmiMedian(db, {
      model: "iphone_14_pro", storageGb: 128, batteryHealthPct: 90, cosmeticGrade: "A",
    });
    const db2 = makeDb(BASELINE_ROW);
    const bumped = await getHfmiMedian(db2, {
      model: "iphone_14_pro", storageGb: 256, batteryHealthPct: 90, cosmeticGrade: "A",
    });
    expect(bumped.medianUsd).toBeGreaterThan(base.medianUsd);
    // +10% log bump ≈ 10.5% in price
    expect(bumped.medianUsd / base.medianUsd).toBeCloseTo(Math.exp(0.1), 2);
  });

  it("applies carrier-lock discount", async () => {
    const db = makeDb(BASELINE_ROW);
    const unlocked = await getHfmiMedian(db, {
      model: "iphone_14_pro", storageGb: 128, batteryHealthPct: 90, cosmeticGrade: "A", carrierLocked: false,
    });
    const db2 = makeDb(BASELINE_ROW);
    const locked = await getHfmiMedian(db2, {
      model: "iphone_14_pro", storageGb: 128, batteryHealthPct: 90, cosmeticGrade: "A", carrierLocked: true,
    });
    expect(locked.medianUsd).toBeLessThan(unlocked.medianUsd);
  });

  it("applies ±$35 CI floor when residual_std is tiny", async () => {
    const tight = {
      ...BASELINE_ROW,
      coefficients: { ...BASELINE_COEF, residual_std: 0.001 },
      residualStd: "0.001",
    };
    const db = makeDb(tight);
    const result = await getHfmiMedian(db, {
      model: "iphone_14_pro", storageGb: 128, batteryHealthPct: 90, cosmeticGrade: "A",
    });
    const [lo, hi] = result.confidenceInterval;
    const halfWidth = (hi - lo) / 2;
    expect(halfWidth).toBeGreaterThanOrEqual(35);
  });

  it("CI floor does not apply when natural CI is wider", async () => {
    const wide = {
      ...BASELINE_ROW,
      coefficients: { ...BASELINE_COEF, residual_std: 0.3 },
      residualStd: "0.3",
    };
    const db = makeDb(wide);
    const result = await getHfmiMedian(db, {
      model: "iphone_14_pro", storageGb: 128, batteryHealthPct: 90, cosmeticGrade: "A",
    });
    const [lo, hi] = result.confidenceInterval;
    expect((hi - lo) / 2).toBeGreaterThan(35);
  });

  it("defaults battery to 90 when not provided", async () => {
    const db = makeDb(BASELINE_ROW);
    const r1 = await getHfmiMedian(db, {
      model: "iphone_14_pro", storageGb: 128, cosmeticGrade: "A",
    });
    const db2 = makeDb(BASELINE_ROW);
    const r2 = await getHfmiMedian(db2, {
      model: "iphone_14_pro", storageGb: 128, batteryHealthPct: 90, cosmeticGrade: "A",
    });
    expect(r1.medianUsd).toBeCloseTo(r2.medianUsd, 2);
  });
});
