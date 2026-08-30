import { DeepSeekAdapter } from "../../../apps/api/src/negotiation/adapters/deepseek-adapter.js";
import { setDecideFewShotMode } from "../../../apps/api/src/negotiation/prompts/criteria-fewshot.js";
import type { ListingHint } from "../../../apps/api/src/negotiation/prompts/tag-family-fewshot.js";

const original = DeepSeekAdapter.prototype.buildSystemPrompt;
let extra = "";

export function setLabVariant(variant: "baseline" | "fewshot", extraWorkedExamples = ""): void {
  if (variant === "baseline") {
    setDecideFewShotMode("off");
    extra = "";
    return;
  }
  // Staging Decide is cards on and nothing else. extra is opt-in only.
  setDecideFewShotMode("on");
  extra = extraWorkedExamples.trim();
}

export function setFewShot(text: string): void {
  setLabVariant(text.trim() ? "fewshot" : "baseline", text);
}

export function getFewShot(): string {
  return extra;
}

DeepSeekAdapter.prototype.buildSystemPrompt = function buildSystemPromptWithFewShot(
  skillContext: string,
  role?: "buyer" | "seller",
  listing?: ListingHint | null,
): string {
  const base = original.call(this, skillContext, role, listing);
  if (!extra) return base;
  return `${base}\n\n## Worked examples (few-shot)\n${extra}`;
};
