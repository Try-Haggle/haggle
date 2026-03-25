// ─── Types ───────────────────────────────────────────────────────────────────

export interface WeightTier {
  label: string;
  max_weight_oz: number;
  rate_minor: number;
}

export interface WeightBufferResult {
  declared_weight_oz: number;
  declared_tier: WeightTier;
  next_tier: WeightTier | null;
  buffer_amount_minor: number;
}

export interface ApvAdjustmentResult {
  declared_weight_oz: number;
  actual_weight_oz: number;
  declared_tier: WeightTier;
  actual_tier: WeightTier;
  adjustment_minor: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** USPS Ground Advantage Zone 5 commercial rates (2026 approximate). */
export const USPS_GROUND_WEIGHT_TIERS: WeightTier[] = [
  { label: "up to 4 oz", max_weight_oz: 4, rate_minor: 450 },
  { label: "up to 8 oz", max_weight_oz: 8, rate_minor: 500 },
  { label: "up to 12 oz", max_weight_oz: 12, rate_minor: 550 },
  { label: "up to 1 lb", max_weight_oz: 16, rate_minor: 600 },
  { label: "up to 2 lb", max_weight_oz: 32, rate_minor: 750 },
  { label: "up to 3 lb", max_weight_oz: 48, rate_minor: 900 },
  { label: "up to 5 lb", max_weight_oz: 80, rate_minor: 1100 },
  { label: "up to 7 lb", max_weight_oz: 112, rate_minor: 1400 },
  { label: "up to 10 lb", max_weight_oz: 160, rate_minor: 1700 },
  { label: "up to 15 lb", max_weight_oz: 240, rate_minor: 2200 },
  { label: "up to 20 lb", max_weight_oz: 320, rate_minor: 2800 },
];

// ─── Functions ───────────────────────────────────────────────────────────────

/**
 * Find the weight tier that covers the given weight.
 * Throws if the weight exceeds all tiers.
 */
export function findWeightTier(
  weight_oz: number,
  tiers: WeightTier[] = USPS_GROUND_WEIGHT_TIERS,
): WeightTier {
  for (const tier of tiers) {
    if (weight_oz <= tier.max_weight_oz) {
      return tier;
    }
  }
  const max = tiers[tiers.length - 1];
  throw new Error(
    `Weight ${weight_oz} oz exceeds maximum tier (${max.max_weight_oz} oz)`,
  );
}

/**
 * Compute the weight-proportional buffer between the declared tier and the
 * next tier up.  If the declared weight is already in the heaviest tier the
 * buffer is 0.
 */
export function computeWeightBuffer(
  declared_weight_oz: number,
  tiers: WeightTier[] = USPS_GROUND_WEIGHT_TIERS,
): WeightBufferResult {
  const declared_tier = findWeightTier(declared_weight_oz, tiers);
  const tierIndex = tiers.indexOf(declared_tier);
  const next_tier = tierIndex < tiers.length - 1 ? tiers[tierIndex + 1] : null;
  const buffer_amount_minor = next_tier
    ? next_tier.rate_minor - declared_tier.rate_minor
    : 0;

  return {
    declared_weight_oz,
    declared_tier,
    next_tier,
    buffer_amount_minor,
  };
}

/**
 * Compute the APV (Address / Package Verification) adjustment when the actual
 * weight lands in a higher tier than declared.  Returns 0 if same tier or
 * lighter.
 */
export function computeApvAdjustment(
  declared_weight_oz: number,
  actual_weight_oz: number,
  tiers: WeightTier[] = USPS_GROUND_WEIGHT_TIERS,
): ApvAdjustmentResult {
  const declared_tier = findWeightTier(declared_weight_oz, tiers);
  const actual_tier = findWeightTier(actual_weight_oz, tiers);
  const adjustment_minor =
    actual_tier.rate_minor > declared_tier.rate_minor
      ? actual_tier.rate_minor - declared_tier.rate_minor
      : 0;

  return {
    declared_weight_oz,
    actual_weight_oz,
    declared_tier,
    actual_tier,
    adjustment_minor,
  };
}
