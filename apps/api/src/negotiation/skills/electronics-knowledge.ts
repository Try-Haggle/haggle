/**
 * skills/electronics-knowledge.ts
 *
 * Tag-matched knowledge skill for electronics.
 * Clothing/vehicles get their own skill on the same interface, or empty slots.
 * Pure data — no strategy recommendations, no coaching, no fixed $ tables.
 *
 * HARD rules come from the opened taxonomy checks. IMEI / activation lock
 * are phone gates. They must not appear on AirPods, chargers, or Kindles.
 */

import { resolveChecks } from "@haggle/shared";
import { ELECTRONICS_TERMS } from "../term/standard-terms.js";
import type { CoreMemory } from "../types.js";
import { resolveItemTags } from "./skill-stack.js";
import type {
  DecideHookResult,
  HookContext,
  HookResult,
  RespondHookResult,
  SkillManifest,
  SkillRuntime,
  UnderstandHookResult,
  ValidateHookResult,
} from "./skill-types.js";

const manifest: SkillManifest = {
  id: "electronics-knowledge-v1",
  version: "1.0.0",
  type: "knowledge",
  name: "Electronics Knowledge",
  description:
    "Term definitions, valuation rules, and verification requirements for consumer electronics.",
  categoryTags: [
    "electronics",
    "electronics/phones",
    "electronics/tablets",
    "electronics/laptops",
    "electronics/wearables",
    "electronics/audio",
    "electronics/gaming",
    "electronics/cameras",
    "electronics/components",
  ],
  hooks: ["understand", "decide", "validate", "respond"],
  pricing: { model: "free" },
  verification: {
    status: "haggle_verified",
    verifiedAt: "2026-04-14",
    verifiedBy: "haggle-core",
    securityAudit: true,
  },
};

const PHONE_ONLY_TERM_IDS = new Set(["imei_verification", "find_my_status", "carrier_lock"]);

function listingTags(ctx: HookContext): string[] {
  return resolveItemTags(ctx.memory.listing_context as CoreMemory["listing_context"]);
}

function openedChecks(ctx: HookContext) {
  return resolveChecks(listingTags(ctx));
}

function termsForListing(ctx: HookContext) {
  const checks = openedChecks(ctx);
  const openedIds = new Set(checks.map((c) => c.id));
  if (openedIds.size === 0) {
    return ELECTRONICS_TERMS.filter((t) => !PHONE_ONLY_TERM_IDS.has(t.id));
  }
  return ELECTRONICS_TERMS.filter((t) => openedIds.has(t.id));
}

function buildTermHints(ctx: HookContext) {
  return termsForListing(ctx).map((t) => ({
    id: t.id,
    parseAs: t.value_type as "number" | "enum" | "boolean" | "string",
    range: t.value_range,
    unit: t.unit,
  }));
}

function buildValuationRules(ctx: HookContext): string[] {
  return termsForListing(ctx)
    .filter((t) => t.evaluate_hint)
    .map((t) => t.evaluate_hint);
}

function rulesFromChecks(ctx: HookContext, enforcement: "hard" | "soft") {
  return openedChecks(ctx)
    .filter((c) => c.enforcement === enforcement)
    .map((c) => ({ rule: c.id.toUpperCase(), description: c.questionKo }));
}

export class ElectronicsKnowledgeSkill implements SkillRuntime {
  readonly manifest = manifest;

  async onHook(context: HookContext): Promise<HookResult> {
    switch (context.stage) {
      case "understand":
        return this.onUnderstand(context);
      case "decide":
        return this.onDecide(context);
      case "validate":
        return this.onValidate(context);
      case "respond":
        return this.onRespond();
      default:
        return { content: {} };
    }
  }

  private onUnderstand(ctx: HookContext): UnderstandHookResult {
    return {
      content: {
        termHints: buildTermHints(ctx),
        parsingContext:
          "Parse only terms that this listing's opened checks use. Do not invent IMEI or carrier lock unless those cards are open.",
      },
    };
  }

  private onDecide(ctx: HookContext): DecideHookResult {
    const checks = openedChecks(ctx);
    const hard = checks.filter((c) => c.enforcement === "hard").length;
    const soft = checks.filter((c) => c.enforcement === "soft").length;
    return {
      content: {
        categoryBrief: [
          "Category: consumer electronics (US used market).",
          `This tag opened ${hard} HARD and ${soft} SOFT criteria.`,
          "Use only the opened cards. Do not invent phone gates (IMEI, activation lock) unless those cards are open.",
        ].join(" "),
        valuationRules: buildValuationRules(ctx),
        tactics: [
          "anchoring",
          "reciprocal_concession",
          "condition_trade",
          "time_pressure_close",
          "nibble",
          "bundling",
        ],
      },
    };
  }

  private onValidate(ctx: HookContext): ValidateHookResult {
    return {
      content: {
        hardRules: rulesFromChecks(ctx, "hard"),
        softRules: rulesFromChecks(ctx, "soft"),
      },
    };
  }

  private onRespond(): RespondHookResult {
    return {
      content: {
        toneGuidance:
          "Professional. Reference market data when justifying price. Use condition terms accurately.",
        terminology: {
          mint: "like-new condition",
          DS: "deadstock / brand new sealed",
          OEM: "original equipment manufacturer parts",
          unlocked: "not carrier-locked, works with any carrier",
        },
      },
    };
  }
}
