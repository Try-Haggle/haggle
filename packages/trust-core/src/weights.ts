import type { WeightConfig, TrustInputKey, TrustRole, InputConfig } from "./types.js";

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

export const WEIGHTS_VERSION = "v1.0";

// ---------------------------------------------------------------------------
// Default Weight Configuration
// ---------------------------------------------------------------------------

export const DEFAULT_WEIGHT_CONFIG: WeightConfig = {
  transaction_completion_rate: {
    weight: 0.20,
    direction: "higher",
    normalization: "rate",
    applies_to_seller: true,
    applies_to_buyer: true,
  },
  dispute_win_rate: {
    weight: 0.18,
    direction: "higher",
    normalization: "rate",
    applies_to_seller: true,
    applies_to_buyer: true,
  },
  dispute_rate: {
    weight: 0.15,
    direction: "lower",
    normalization: "inverse_rate",
    applies_to_seller: true,
    applies_to_buyer: true,
  },
  sla_compliance_rate: {
    weight: 0.12,
    direction: "higher",
    normalization: "rate",
    applies_to_seller: true,
    applies_to_buyer: false,
  },
  cancellation_rate: {
    weight: 0.12,
    direction: "lower",
    normalization: "inverse_rate",
    applies_to_seller: true,
    applies_to_buyer: true,
  },
  auto_confirm_rate: {
    weight: 0.08,
    direction: "higher",
    normalization: "rate",
    applies_to_seller: false,
    applies_to_buyer: true,
  },
  peer_rating: {
    weight: 0.08,
    direction: "higher",
    normalization: "rating",
    applies_to_seller: true,
    applies_to_buyer: true,
  },
  transaction_frequency: {
    weight: 0.04,
    direction: "higher",
    normalization: "frequency",
    applies_to_seller: true,
    applies_to_buyer: true,
  },
  account_age_days: {
    weight: 0.03,
    direction: "higher",
    normalization: "age",
    applies_to_seller: true,
    applies_to_buyer: true,
  },
};

// ---------------------------------------------------------------------------
// Role-based filtering
// ---------------------------------------------------------------------------

/**
 * Returns the subset of input keys applicable to the given role.
 */
export function getApplicableKeys(
  config: WeightConfig,
  role: TrustRole,
): TrustInputKey[] {
  const keys = Object.keys(config) as TrustInputKey[];
  if (role === "combined") return keys;

  return keys.filter((key) => {
    const cfg = config[key];
    if (role === "seller") return cfg.applies_to_seller;
    return cfg.applies_to_buyer;
  });
}

// ---------------------------------------------------------------------------
// Weight redistribution
// ---------------------------------------------------------------------------

/**
 * Given applicable keys and which ones have defined values, redistribute
 * weights so they sum to 1.0. Returns a map of key → redistributed weight.
 *
 * If no keys have data, returns an empty map.
 */
export function redistributeWeights(
  config: WeightConfig,
  applicableKeys: TrustInputKey[],
  definedKeys: TrustInputKey[],
): Map<TrustInputKey, number> {
  const result = new Map<TrustInputKey, number>();

  if (definedKeys.length === 0) return result;

  // Sum the weights of defined keys (within applicable set)
  const activeKeys = definedKeys.filter((k) => applicableKeys.includes(k));
  if (activeKeys.length === 0) return result;

  const totalWeight = activeKeys.reduce((sum, key) => sum + config[key].weight, 0);

  if (totalWeight === 0) return result;

  for (const key of activeKeys) {
    result.set(key, config[key].weight / totalWeight);
  }

  return result;
}

/**
 * Returns the InputConfig for a given key.
 */
export function getInputConfig(
  config: WeightConfig,
  key: TrustInputKey,
): InputConfig {
  return config[key];
}
