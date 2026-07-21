/**
 * L4a / HAGGLE-9-B — category profiles for the v1 DefaultEngineSkill.
 *
 * The engine skill's *decision logic* is category-neutral; only three accessors
 * (LLM context, constraints, term declaration) carried hardcoded iPhone/IMEI
 * content that leaked onto every negotiation regardless of category. A
 * CategoryProfile supplies that content so a non-electronics item gets a neutral
 * profile instead of iPhone/IMEI rules.
 */

import { ELECTRONICS_TERMS } from "../term/standard-terms.js";
import type { SkillConstraint, SkillTermDeclaration } from "../types.js";

export interface CategoryProfile {
  id: string;
  llmContext: string;
  constraints: SkillConstraint[];
  termDeclaration: SkillTermDeclaration;
}

/** iPhone / used-phone profile — the historical DefaultEngineSkill content. */
export const ELECTRONICS_PHONE_PROFILE: CategoryProfile = {
  id: "electronics-iphone-pro-v1",
  llmContext: [
    "## Category: Electronics — iPhone Pro",
    "Market: US used iPhone Pro (13/14/15). Reference: Swappa 30d median.",
    "Key factors: battery health, carrier lock, screen condition, storage, cosmetic grade.",
    "IMEI and Find My verification are deal-breakers.",
  ].join("\n"),
  constraints: [
    { rule: "IMEI_REQUIRED", description: "IMEI must be verified before CLOSING phase" },
    { rule: "FIND_MY_REQUIRED", description: "Find My must be disabled before sale" },
    { rule: "BATTERY_THRESHOLD", description: "Battery below 80% triggers mandatory disclosure" },
  ],
  termDeclaration: {
    supported_terms: ELECTRONICS_TERMS.map((t) => t.id),
    category_terms: ELECTRONICS_TERMS,
    custom_term_handling: "basic",
  },
};

/** Neutral profile for non-electronics items — no category-specific rules/terms. */
export const DEFAULT_PROFILE: CategoryProfile = {
  id: "generic-v1",
  llmContext: [
    "## General marketplace item",
    "Judge condition, completeness, and fair market value on the item's own merits.",
    "Raise verification or condition checks only when the item type genuinely calls for them.",
  ].join("\n"),
  constraints: [],
  termDeclaration: {
    supported_terms: [],
    category_terms: [],
    custom_term_handling: "basic",
  },
};

/**
 * Pick a profile from the resolved item tags (lowercase, from resolveItemTags).
 * Only electronics maps to the phone profile; everything else (and no-category)
 * gets the neutral profile — the point of HAGGLE-9-B.
 *
 * Note: the single electronics profile is still phone-flavored, so non-phone
 * electronics currently inherit phone hints. Splitting per electronics subtype is
 * a follow-up (needs more profiles).
 */
export function resolveCategoryProfile(tags: readonly string[]): CategoryProfile {
  const isElectronics = tags.some((t) => t === "electronics" || t.startsWith("electronics/"));
  return isElectronics ? ELECTRONICS_PHONE_PROFILE : DEFAULT_PROFILE;
}
