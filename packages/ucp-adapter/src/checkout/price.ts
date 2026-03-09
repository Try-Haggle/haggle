// ============================================================
// Price Conversion Utilities
// HNP engine uses float dollars, UCP uses integer minor units
// All conversions happen at the adapter boundary
// ============================================================

/**
 * Convert HNP float dollar amount to UCP minor units (cents).
 * Example: 25.00 → 2500
 */
export function dollarsToMinorUnits(dollars: number): number {
  return Math.round(dollars * 100);
}

/**
 * Convert UCP minor units (cents) to HNP float dollars.
 * Example: 2500 → 25.00
 */
export function minorUnitsToDollars(minorUnits: number): number {
  return minorUnits / 100;
}
