import type { NormalizationType } from "./types.js";

// ---------------------------------------------------------------------------
// Normalization constants
// ---------------------------------------------------------------------------

/** Maximum transaction count for frequency normalization. */
export const FREQUENCY_CAP = 100;

/** Maximum account age in days for age normalization. */
export const AGE_CAP_DAYS = 365;

/** Maximum peer rating value. */
export const RATING_MAX = 5;

// ---------------------------------------------------------------------------
// Normalization functions
// ---------------------------------------------------------------------------

/**
 * Normalizes a rate value (already 0-1). Clamps to [0, 1].
 */
export function normalizeRate(value: number): number {
  return clamp(value, 0, 1);
}

/**
 * Normalizes an inverse rate (lower is better). Returns `1 - value`, clamped to [0, 1].
 */
export function normalizeInverseRate(value: number): number {
  return clamp(1 - value, 0, 1);
}

/**
 * Normalizes transaction frequency: `min(value / FREQUENCY_CAP, 1)`.
 */
export function normalizeFrequency(value: number): number {
  if (value < 0) return 0;
  return Math.min(value / FREQUENCY_CAP, 1);
}

/**
 * Normalizes account age in days: `min(value / AGE_CAP_DAYS, 1)`.
 */
export function normalizeAge(value: number): number {
  if (value < 0) return 0;
  return Math.min(value / AGE_CAP_DAYS, 1);
}

/**
 * Normalizes peer rating: `value / RATING_MAX`, clamped to [0, 1].
 */
export function normalizeRating(value: number): number {
  if (value < 0) return 0;
  return clamp(value / RATING_MAX, 0, 1);
}

// ---------------------------------------------------------------------------
// Unified normalizer
// ---------------------------------------------------------------------------

/**
 * Normalizes a raw input value based on its normalization type.
 * Returns a value in [0, 1] where 1 is the best possible score.
 */
export function normalizeInput(value: number, type: NormalizationType): number {
  switch (type) {
    case "rate":
      return normalizeRate(value);
    case "inverse_rate":
      return normalizeInverseRate(value);
    case "frequency":
      return normalizeFrequency(value);
    case "age":
      return normalizeAge(value);
    case "rating":
      return normalizeRating(value);
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
