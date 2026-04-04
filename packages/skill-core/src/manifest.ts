import type { SkillManifest, HookPoint, SkillCategory, PricingModel } from "./types.js";

export interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
}

const VALID_CATEGORIES: readonly SkillCategory[] = [
  "STRATEGY",
  "DATA",
  "INTERPRETATION",
  "AUTHENTICATION",
  "DISPUTE_RESOLUTION",
];

const VALID_HOOK_POINTS: readonly HookPoint[] = [
  "PRE_SESSION",
  "PRE_ROUND",
  "POST_ROUND",
  "POST_SESSION",
  "ON_DISPUTE_OPEN",
  "ON_DISPUTE_EVIDENCE",
  "ON_LISTING_CREATE",
  "ON_MATCH",
];

const VALID_PRICING_MODELS: readonly PricingModel[] = [
  "FREE",
  "PER_USE",
  "SUBSCRIPTION",
  "REVENUE_SHARE",
];

const SKILL_ID_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;
const SEMVER_REGEX = /^\d+\.\d+\.\d+$/;
const MAX_SKILL_ID_LENGTH = 64;
const MAX_NAME_LENGTH = 128;

export function validateManifest(manifest: SkillManifest): ManifestValidationResult {
  const errors: string[] = [];

  // skillId validation
  if (!manifest.skillId || manifest.skillId.length === 0) {
    errors.push("skillId must be non-empty");
  } else {
    if (manifest.skillId.length > MAX_SKILL_ID_LENGTH) {
      errors.push(`skillId must be at most ${MAX_SKILL_ID_LENGTH} characters`);
    }
    if (!SKILL_ID_REGEX.test(manifest.skillId)) {
      errors.push("skillId must be lowercase alphanumeric with hyphens only");
    }
  }

  // name validation
  if (!manifest.name || manifest.name.length === 0) {
    errors.push("name must be non-empty");
  } else if (manifest.name.length > MAX_NAME_LENGTH) {
    errors.push(`name must be at most ${MAX_NAME_LENGTH} characters`);
  }

  // version validation
  if (!manifest.version || !SEMVER_REGEX.test(manifest.version)) {
    errors.push("version must be valid semver (e.g., 1.0.0)");
  }

  // category validation
  if (!VALID_CATEGORIES.includes(manifest.category)) {
    errors.push(`category must be one of: ${VALID_CATEGORIES.join(", ")}`);
  }

  // hookPoints validation
  if (!manifest.hookPoints || manifest.hookPoints.length === 0) {
    errors.push("hookPoints must contain at least one hook point");
  } else {
    for (const hp of manifest.hookPoints) {
      if (!VALID_HOOK_POINTS.includes(hp)) {
        errors.push(`invalid hookPoint: ${hp}`);
      }
    }
  }

  // supportedCategories validation
  if (!manifest.supportedCategories || manifest.supportedCategories.length === 0) {
    errors.push("supportedCategories must contain at least one category");
  }

  // pricing validation
  if (!manifest.pricing) {
    errors.push("pricing is required");
  } else {
    if (!VALID_PRICING_MODELS.includes(manifest.pricing.model)) {
      errors.push(`pricing.model must be one of: ${VALID_PRICING_MODELS.join(", ")}`);
    }

    if (manifest.pricing.model === "PER_USE") {
      if (manifest.pricing.perUseCents == null || manifest.pricing.perUseCents <= 0) {
        errors.push("PER_USE pricing requires perUseCents > 0");
      }
    }

    if (manifest.pricing.model === "SUBSCRIPTION") {
      if (
        manifest.pricing.monthlySubscriptionCents == null ||
        manifest.pricing.monthlySubscriptionCents <= 0
      ) {
        errors.push("SUBSCRIPTION pricing requires monthlySubscriptionCents > 0");
      }
    }

    if (manifest.pricing.model === "REVENUE_SHARE") {
      if (
        manifest.pricing.revenueSharePercent == null ||
        manifest.pricing.revenueSharePercent < 0 ||
        manifest.pricing.revenueSharePercent > 100
      ) {
        errors.push("REVENUE_SHARE pricing requires revenueSharePercent between 0 and 100");
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function isCompatibleHookPoint(skill: SkillManifest, hookPoint: HookPoint): boolean {
  return skill.hookPoints.includes(hookPoint);
}

/**
 * Check if a skill supports the given product category.
 * Supports wildcard matching: "vehicles.*" matches "vehicles.cars" but NOT "vehicles" alone.
 */
export function isCompatibleCategory(skill: SkillManifest, productCategory: string): boolean {
  for (const supported of skill.supportedCategories) {
    // Exact match
    if (supported === productCategory) {
      return true;
    }

    // Wildcard match: "vehicles.*" matches "vehicles.cars" but not "vehicles"
    if (supported.endsWith(".*")) {
      const prefix = supported.slice(0, -1); // "vehicles."
      if (productCategory.startsWith(prefix) && productCategory.length > prefix.length) {
        return true;
      }
    }
  }
  return false;
}
