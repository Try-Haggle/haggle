import { DeepSeekAdapter } from "../../../apps/api/src/negotiation/adapters/deepseek-adapter.js";

const original = DeepSeekAdapter.prototype.buildSystemPrompt;
let extra = "";

export function setFewShot(text: string): void {
  extra = text.trim();
}

export function getFewShot(): string {
  return extra;
}

DeepSeekAdapter.prototype.buildSystemPrompt = function buildSystemPromptWithFewShot(
  skillContext: string,
  role?: "buyer" | "seller",
): string {
  const base = original.call(this, skillContext, role);
  if (!extra) return base;
  return `${base}\n\n## Worked examples (few-shot)\n${extra}`;
};
