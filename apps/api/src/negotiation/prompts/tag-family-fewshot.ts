/**
 * Decide few-shot entry. Delegates to criteria-fewshot.ts so every API call
 * sends the shared legend plus one card per opened criterion.
 * See docs/engine/criteria-and-issues.md.
 */

export type { ListingHint } from "./criteria-fewshot.js";
export { encodeCriteriaFewShot as encodeTagFamilyFewShot } from "./criteria-fewshot.js";
