/**
 * HfmiMarketSkill — Service-type Skill providing fair market price reference.
 *
 * Hooks into 'context' stage to inject HFMI median price from eBay sold
 * listings via the cascading tag→HFMI resolver.
 *
 * Design principle: this is REFERENCE data, not a price constraint.
 * Haggle internal trades will eventually replace external data.
 */

import type { Database } from "@haggle/db";
import type {
  SkillManifest,
  SkillRuntime,
  HookContext,
  HookResult,
} from "./skill-types.js";
import {
  resolveHfmiFromTags,
  extractTagAttributes,
} from "../../services/hfmi-tag-resolver.js";

const manifest: SkillManifest = {
  id: "hfmi-market-v1",
  version: "1.0.0",
  type: "service",
  name: "HFMI Market Data",
  description:
    "Fair market price reference from eBay sold listings. Advisory only — does not constrain negotiation.",
  categoryTags: [
    "electronics",
    "electronics/phones",
    "electronics/tablets",
    "electronics/laptops",
    "electronics/gaming",
    "electronics/audio",
    "smartphones",
    "laptops",
    "tablets",
    "gaming",
    "audio",
  ],
  hooks: ["context"],
  pricing: { model: "free" },
  verification: {
    status: "haggle_verified",
    verifiedAt: "2026-04-14",
    verifiedBy: "haggle-core",
    securityAudit: true,
  },
};

export class HfmiMarketSkill implements SkillRuntime {
  readonly manifest = manifest;

  constructor(private readonly db: Database) {}

  async onHook(context: HookContext): Promise<HookResult> {
    if (context.stage !== "context") {
      return { content: {} };
    }

    try {
      // Extract tag attributes from tag garden or memory
      const tagGarden =
        (context.extra?.tagGarden as
          | Array<{ name: string; category?: string }>
          | Record<string, string>
          | undefined) ?? {};

      const tagAttrs = extractTagAttributes(tagGarden);

      // If no model info from tags, try to extract from memory
      if (!tagAttrs.model && context.memory?.session) {
        const sessionAny = context.memory.session as Record<string, unknown>;
        if (typeof sessionAny.item_model === "string") {
          tagAttrs.model = sessionAny.item_model
            .toLowerCase()
            .replace(/[\s-]+/g, "_");
        }
      }

      if (!tagAttrs.model) {
        return { content: {} };
      }

      const resolution = await resolveHfmiFromTags(this.db, tagAttrs);

      if (!resolution) {
        return {
          content: {
            observations: ["No market data available for this item."],
          },
        };
      }

      return {
        content: {
          marketData: {
            price: resolution.median_usd,
            source: `hfmi_L${resolution.confidence_level}`,
            confidence: resolution.confidence_label,
            sample_count: resolution.sample_count,
            query: resolution.query_used,
            updatedAt: new Date().toISOString(),
          },
          observations: [
            `Market reference: $${resolution.median_usd} median (${resolution.sample_count} recent sold listings, confidence: ${resolution.confidence_label}). This is a reference only — the agreed price between parties is what matters.`,
          ],
        },
      };
    } catch {
      // Non-fatal: market data failure does not block negotiation
      return { content: {} };
    }
  }
}
