/**
 * Tag Placement prompts barrel (Step 61).
 *
 * See handoff/ARCHITECT-BRIEF-step60-62.md §Step 61.
 */

export { TAG_PLACEMENT_SYSTEM_PROMPT } from "./system-prompt.js";
export {
  FEW_SHOT_POOL,
  selectFewShots,
  toChatMessages,
} from "./few-shot-pool.js";
export type { FewShotCategory, FewShotExample } from "./few-shot-pool.js";
