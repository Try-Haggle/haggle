/**
 * Category profiles for the v1 DefaultEngineSkill.
 *
 * L4a extracted the skill's three category-specific accessors (LLM context,
 * constraints, term declaration) into a CategoryProfile so non-electronics items
 * stop getting iPhone/IMEI content. P3 makes the profile TAXONOMY-DRIVEN: the
 * DECIDE-prompt context is built from the shared category taxonomy (resolveChecks),
 * so any category surfaces its own negotiation checks — not just electronics.
 */

import { type NegotiationCheck, resolveChecks } from "@haggle/shared";
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

/** Format taxonomy checks into an LLM context block for the DECIDE prompt. */
function buildCategoryLLMContext(checks: readonly NegotiationCheck[]): string {
  const lines = checks.map(
    (c) => `- ${c.questionKo} [${c.enforcement === "hard" ? "필수" : "권장"}]`,
  );
  return ["## Category checks — verify/discuss for this item:", ...lines].join("\n");
}

/**
 * Build the session's category profile from the taxonomy (P3, TAX backbone).
 *
 * `resolveChecks` walks the category hierarchy (from resolveItemTags's tags), so
 * any category surfaces its own negotiation checks in the DECIDE prompt. An unknown
 * category (no checks) falls back to the neutral profile. This replaces L4a's static
 * electronics/neutral split and fixes its residual — non-phone electronics (laptops)
 * no longer inherit phone/IMEI hints.
 */
export function resolveCategoryProfile(tags: readonly string[]): CategoryProfile {
  const checks = resolveChecks(tags);
  if (checks.length === 0) return DEFAULT_PROFILE;
  const top = tags.map((t) => t.split("/")[0]).find(Boolean) ?? "category";
  return {
    id: `taxonomy-${top}`,
    llmContext: buildCategoryLLMContext(checks),
    constraints: checks
      .filter((c) => c.enforcement === "hard")
      .map((c) => ({ rule: c.id.toUpperCase(), description: c.questionKo })),
    termDeclaration: { supported_terms: [], category_terms: [], custom_term_handling: "basic" },
  };
}
