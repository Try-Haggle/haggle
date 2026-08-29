/**
 * Product-matched new-retail MSRP → ## Skills → Market.
 * Advisory only. Unmatched products emit nothing. Not a category $ table.
 */

import { retailMarketLinesForListing } from "./retail-msrp-catalog.js";
import type {
  DecideHookResult,
  HookContext,
  HookResult,
  SkillManifest,
  SkillRuntime,
} from "./skill-types.js";

const manifest: SkillManifest = {
  id: "retail-msrp-v1",
  version: "1.0.0",
  type: "service",
  name: "Retail MSRP",
  description:
    "New-retail launch prices for the matched product, by storage. Advisory — not the deal price.",
  categoryTags: ["electronics", "electronics/phones", "electronics/tablets", "smartphones"],
  hooks: ["decide"],
  pricing: { model: "free" },
  verification: {
    status: "haggle_verified",
    verifiedAt: "2026-08-26",
    verifiedBy: "haggle-core",
    securityAudit: true,
  },
};

export type RetailMsrpMode = "on" | "off";

let retailMsrpMode: RetailMsrpMode = "on";

/** Process-local toggle for A/B labs. Production stays on. */
export function setRetailMsrpSkillMode(mode: RetailMsrpMode): void {
  retailMsrpMode = mode === "off" ? "off" : "on";
}

export function getRetailMsrpSkillMode(): RetailMsrpMode {
  return retailMsrpMode;
}

export class RetailMsrpSkill implements SkillRuntime {
  readonly manifest = manifest;

  async onHook(context: HookContext): Promise<HookResult> {
    if (context.stage !== "decide") return { content: {} };
    if (retailMsrpMode === "off") return { content: {} };
    return this.onDecide(context);
  }

  private onDecide(ctx: HookContext): DecideHookResult {
    const lines = retailMarketLinesForListing(ctx.memory?.listing_context);
    if (lines.length === 0) return { content: {} };
    return { content: { marketLines: lines } };
  }
}
