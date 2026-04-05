/** Default SLA days by product category. */
const SLA_DEFAULTS: Record<string, number> = {
  BOOKS_MEDIA: 3,
  CLOTHING: 3,
  ELECTRONICS_SMALL: 3,
  ELECTRONICS_LARGE: 5,
  COLLECTIBLES: 5,
  LUXURY_FASHION: 5,
  JEWELRY: 5,
  SPORTS_OUTDOOR: 3,
  HOME_GARDEN: 5,
  VEHICLES: 10,
  VEHICLE_PARTS: 5,
  REAL_ESTATE: 14,
  HEAVY_EQUIPMENT: 10,
  MUSICAL_INSTRUMENTS: 5,
  ART: 7,
  OTHER: 5,
};

/** Category-specific minimum SLA days. */
const SLA_MINIMUMS: Record<string, number> = {
  BOOKS_MEDIA: 1,
  CLOTHING: 1,
  ELECTRONICS_SMALL: 1,
  ELECTRONICS_LARGE: 2,
  COLLECTIBLES: 2,
  LUXURY_FASHION: 2,
  JEWELRY: 2,
  SPORTS_OUTDOOR: 1,
  HOME_GARDEN: 2,
  VEHICLES: 5,
  VEHICLE_PARTS: 2,
  REAL_ESTATE: 7,
  HEAVY_EQUIPMENT: 5,
  MUSICAL_INSTRUMENTS: 2,
  ART: 3,
  OTHER: 1,
};

const DEFAULT_SLA_DAYS = 5;
const DEFAULT_MINIMUM_DAYS = 1;

/**
 * Return the default SLA days for a category.
 * Falls back to 5 for unknown categories.
 */
export function getDefaultSlaDays(category: string): number {
  return SLA_DEFAULTS[category] ?? DEFAULT_SLA_DAYS;
}

/**
 * Return the minimum allowed SLA days for a category.
 * Falls back to 1 for unknown categories.
 */
export function getMinimumSlaDays(category: string): number {
  return SLA_MINIMUMS[category] ?? DEFAULT_MINIMUM_DAYS;
}
