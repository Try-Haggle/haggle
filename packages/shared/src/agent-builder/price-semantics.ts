/**
 * Price semantics — what the single `priceLimit` field means for each side.
 *
 * Data stays as one neutral field (`ItemContext.priceLimit`); this function is
 * the ONLY place that branches on side. Used by:
 *   - UI labels (slider/input label)
 *   - the builder-chat LLM prompt (tells the model floor vs ceiling)
 *   - the engine direction (maximize vs minimize)
 *
 * All strings here are user/LLM-facing and intentionally in English.
 */

import type { BuilderSide } from "./types.js";

/** Which way the negotiation pushes price. */
export type NegotiationDirection = "maximize" | "minimize";

export interface PriceSemantics {
  /** Label for the priceLimit field. */
  limitLabel: string;
  /** Label for the targetPrice field. */
  targetLabel: string;
  /** Which direction the agent pushes price. */
  direction: NegotiationDirection;
  /** One-line instruction for the LLM prompt. */
  promptHint: string;
}

export function priceSemantics(side: BuilderSide): PriceSemantics {
  if (side === "seller") {
    return {
      limitLabel: "Floor — won't sell below",
      targetLabel: "Asking / ideal price",
      direction: "maximize",
      promptHint:
        "You are on the SELLER side. priceLimit is the FLOOR: never sell below it. Negotiate to keep the price as high as possible above it.",
    };
  }
  return {
    limitLabel: "Max budget — won't pay above",
    targetLabel: "Ideal price",
    direction: "minimize",
    promptHint:
      "You are on the BUYER side. priceLimit is the CEILING (max budget): never pay above it. Negotiate to keep the price as low as possible below it.",
  };
}
