import type { UserMemoryBrief } from "./user-memory-card.service.js";
import {
  compareProductIdentity,
  type ProductIdentityComparison,
} from "./product-identity-resolver.service.js";

export type NegotiationReadinessRole = "BUYER" | "SELLER";

export interface NegotiationReadinessInput {
  role: NegotiationReadinessRole;
  strategySnapshot: Record<string, unknown>;
  memoryBrief?: UserMemoryBrief | null;
  /** Explicit selected/listing product text when available. Falls back to strategy snapshot item/title fields. */
  selectedProductText?: string;
  /** Caller-set confirmation that the remembered-vs-selected product difference is intentional. */
  productIdentityConfirmed?: boolean;
}

export interface NegotiationReadinessResult {
  ready: boolean;
  missing_slots: string[];
  reason: string | null;
  question: string | null;
  source_summary: {
    strategy_snapshot: boolean;
    memory_cards: number;
  };
  product_identity_gate?: ProductIdentityGateResult | null;
}

export interface ProductIdentityGateResult {
  status: "pass" | "confirm" | "observe" | "block";
  reason: string | null;
  question: string | null;
  comparison: ProductIdentityComparison | null;
}

const UNKNOWN_INTENT_VALUES = new Set(["", "unknown", "not specified", "탐색 중"]);

export function evaluateNegotiationStartReadiness(
  input: NegotiationReadinessInput,
): NegotiationReadinessResult {
  if (input.role === "SELLER") {
    return readyResult(input, []);
  }

  const strategyFacts = flattenStrategyFacts(input.strategySnapshot);
  const memoryFacts = flattenMemoryFacts(input.memoryBrief);
  const allFacts = [...strategyFacts, ...memoryFacts];
  const productIdentityGate = evaluateProductIdentityGate(input, strategyFacts, memoryFacts);
  const missing: string[] = [];

  if (!hasProductIntent(strategyFacts, memoryFacts)) {
    missing.push("product_intent");
  }
  if (!hasBudgetBoundary(allFacts)) {
    missing.push("budget_boundary");
  }
  if (!hasBuyerPriority(allFacts)) {
    missing.push("buyer_priority");
  }
  if (
    productIdentityGate.status === "confirm"
    && !input.productIdentityConfirmed
  ) {
    missing.push("product_identity_confirmation");
  }
  if (productIdentityGate.status === "block") {
    missing.push("product_identity_uncertain");
  }

  if (missing.length === 0) return readyResult(input, [], productIdentityGate);

  return {
    ready: false,
    missing_slots: missing,
    reason: buildReadinessReason(missing, productIdentityGate),
    question: buildReadinessQuestion(missing, productIdentityGate),
    source_summary: buildSourceSummary(input),
    product_identity_gate: productIdentityGate,
  };
}

function readyResult(
  input: NegotiationReadinessInput,
  missingSlots: string[],
  productIdentityGate: ProductIdentityGateResult | null = null,
): NegotiationReadinessResult {
  return {
    ready: missingSlots.length === 0,
    missing_slots: missingSlots,
    reason: null,
    question: null,
    source_summary: buildSourceSummary(input),
    product_identity_gate: productIdentityGate,
  };
}

function buildSourceSummary(input: NegotiationReadinessInput): NegotiationReadinessResult["source_summary"] {
  return {
    strategy_snapshot: Object.keys(input.strategySnapshot).length > 0,
    memory_cards: input.memoryBrief?.items.length ?? 0,
  };
}

function hasProductIntent(strategyFacts: string[], memoryFacts: string[]): boolean {
  const strategyIntent = strategyFacts.some((fact) => {
    const [key, value] = splitFact(fact);
    if (!/(item|title|product|listing|category|intent|query|search)/i.test(key)) return false;
    return !UNKNOWN_INTENT_VALUES.has(value.trim().toLowerCase());
  });
  if (strategyIntent) return true;

  return memoryFacts.some((fact) => (
    /(?:cardtype:interest|demand_intent|shopping intent|product|listing|category|iphone|아이폰|tesla|테슬라)/i.test(fact)
  ));
}

function hasBudgetBoundary(facts: string[]): boolean {
  return facts.some((fact) => {
    const [key, value] = splitFact(fact);
    if (/(?:^|\.)(?:alpha|weights?)(?:\.|$)/i.test(key)) return false;
    if (/(budget|target|ceiling|max|price|floor|reservation|willingness)/i.test(key)) {
      return hasMonetaryNumber(value) || /\$|usd|dollar|달러|불|ceiling|budget/i.test(value);
    }
    return /(?:budget|ceiling|max|target|price|예산|최대|목표가).*(?:\$|usd|dollar|달러|불|\d)/i.test(fact);
  });
}

function hasBuyerPriority(facts: string[]): boolean {
  return facts.some((fact) => {
    const [key, value] = splitFact(fact);
    if (/(must|avoid|priority|preference|constraint|requirement|concern|risk|tactic|condition|deal.?breaker)/i.test(key)) {
      return value.trim().length > 0 && !UNKNOWN_INTENT_VALUES.has(value.trim().toLowerCase());
    }
    return /(?:must have|avoid|preference|constraint|requirement|deal breaker|priority|battery|unlocked|imei|damage|no additional requirements|no preference|필수|피하|조건|우선|배터리|언락|손상|상관\s*없|무관|필요\s*없|신경\s*안\s*써|특별히\s*없|조건\s*없|선호\s*없)/i.test(fact);
  });
}

function buildReadinessReason(missing: string[], productIdentityGate?: ProductIdentityGateResult): string {
  if (missing.includes("product_identity_confirmation")) {
    return productIdentityGate?.reason ?? "NEGOTIATION_READINESS_INCOMPLETE: product identity needs confirmation.";
  }
  if (missing.includes("product_identity_uncertain")) {
    return productIdentityGate?.reason ?? "NEGOTIATION_READINESS_INCOMPLETE: product identity is uncertain.";
  }
  if (missing.includes("product_intent")) return "NEGOTIATION_READINESS_INCOMPLETE: product intent is missing.";
  if (missing.includes("budget_boundary")) return "NEGOTIATION_READINESS_INCOMPLETE: buyer budget boundary is missing.";
  if (missing.includes("buyer_priority")) return "NEGOTIATION_READINESS_INCOMPLETE: buyer priority or constraint is missing.";
  return "NEGOTIATION_READINESS_INCOMPLETE";
}

function buildReadinessQuestion(missing: string[], productIdentityGate?: ProductIdentityGateResult): string {
  if (missing.includes("product_identity_confirmation")) {
    return productIdentityGate?.question ?? "Your saved target and selected product differ. Should I negotiate this selected product?";
  }
  if (missing.includes("product_identity_uncertain")) {
    return productIdentityGate?.question ?? "Which exact product should I negotiate for?";
  }
  if (missing.includes("product_intent")) return "What product or category should I negotiate for?";
  if (missing.includes("budget_boundary")) return "What is your target price or maximum budget?";
  if (missing.includes("buyer_priority")) return "What matters most before I negotiate: price, condition, safety, or a specific requirement?";
  return "What should I clarify before starting negotiation?";
}

function evaluateProductIdentityGate(
  input: NegotiationReadinessInput,
  strategyFacts: string[],
  memoryFacts: string[],
): ProductIdentityGateResult {
  const selectedProduct = input.selectedProductText ?? extractSelectedProductText(strategyFacts);
  const rememberedProduct = extractRememberedProductText(memoryFacts);

  if (!selectedProduct || !rememberedProduct) {
    return { status: "pass", reason: null, question: null, comparison: null };
  }

  const comparison = compareProductIdentity(rememberedProduct, selectedProduct);
  if (comparison.alignment === "unknown" && comparison.shouldBlockAutoNegotiation) {
    return {
      status: "block",
      reason: "NEGOTIATION_READINESS_INCOMPLETE: selected product identity is uncertain.",
      question: "Which exact product should I negotiate for?",
      comparison,
    };
  }

  if (comparison.shouldAskConfirmation && comparison.alignment !== "different") {
    return {
      status: "confirm",
      reason: `NEGOTIATION_READINESS_INCOMPLETE: remembered product and selected product differ (${comparison.reasonCodes.join(", ") || comparison.alignment}).`,
      question: buildProductIdentityQuestion(comparison),
      comparison,
    };
  }

  if (comparison.alignment === "different") {
    return {
      status: "observe",
      reason: null,
      question: null,
      comparison,
    };
  }

  return { status: "pass", reason: null, question: null, comparison };
}

function extractSelectedProductText(strategyFacts: string[]): string | undefined {
  return extractProductFactValue(strategyFacts, /(item|title|product|listing|query|search|model)/i);
}

function extractRememberedProductText(memoryFacts: string[]): string | undefined {
  return extractProductFactValue(memoryFacts, /(categoryinterest|category_interest|product|intent|demand_intent|shopping intent|model|iphone|아이폰|macbook|맥북|laptop|노트북)/i);
}

function extractProductFactValue(facts: string[], keyPattern: RegExp): string | undefined {
  for (const fact of facts) {
    const [key, value] = splitFact(fact);
    if (!keyPattern.test(key) && !keyPattern.test(fact)) continue;
    const normalized = value.trim();
    if (!normalized || UNKNOWN_INTENT_VALUES.has(normalized.toLowerCase())) continue;
    if (!/(iphone|아이폰|macbook|맥북|laptop|노트북|ipad|아이패드|tesla|테슬라|model\s*\d|\bps5\b|airpods)/i.test(normalized)) continue;
    return normalized;
  }
  return undefined;
}

function buildProductIdentityQuestion(comparison: ProductIdentityComparison): string {
  const remembered = comparison.remembered.model?.replace(/_/g, " ") ?? comparison.remembered.raw;
  const selected = comparison.selected.model?.replace(/_/g, " ") ?? comparison.selected.raw;
  if (comparison.reasonCodes.includes("different_storage")) {
    return `You previously targeted ${remembered}, but this selected product differs by storage. Should I negotiate ${selected}?`;
  }
  if (comparison.reasonCodes.includes("different_generation")) {
    return `You previously targeted ${remembered}, but this selected product is ${selected}. Should I negotiate this selected product?`;
  }
  return `Your saved target is ${remembered}, but the selected product is ${selected}. Should I negotiate this selected product?`;
}

function flattenStrategyFacts(value: unknown, path = "strategy"): string[] {
  if (value == null) return [];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [`${path}:${String(value)}`];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flattenStrategyFacts(item, `${path}.${index}`));
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => (
      flattenStrategyFacts(child, `${path}.${key}`)
    ));
  }
  return [];
}

function flattenMemoryFacts(brief?: UserMemoryBrief | null): string[] {
  if (!brief) return [];

  return brief.items.flatMap((item) => [
    `cardType:${item.cardType}`,
    `memoryKey:${item.memoryKey}`,
    `summary:${item.summary}`,
    ...flattenStrategyFacts(item.memory, "memory"),
  ]);
}

function splitFact(fact: string): [string, string] {
  const index = fact.indexOf(":");
  if (index === -1) return ["", fact];
  return [fact.slice(0, index), fact.slice(index + 1)];
}

function hasMonetaryNumber(value: string): boolean {
  const matches = value.match(/[0-9][0-9,]*(?:\.[0-9]+)?/g) ?? [];
  return matches.some((match) => Number(match.replace(/,/g, "")) >= 2);
}
