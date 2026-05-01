import { createHash } from "node:crypto";
import { runPromptGuard } from "../negotiation/guards/prompt-guard.js";

export type ConversationSignalType =
  | "product_identity"
  | "product_attribute"
  | "condition_claim"
  | "price_anchor"
  | "price_resistance"
  | "deal_blocker"
  | "demand_intent"
  | "term_preference"
  | "trust_risk"
  | "security_threat"
  | "market_outcome"
  | "tag_candidate"
  | "term_candidate";

export type ExtractionMethod = "deterministic" | "model_assisted" | "manual" | "system";
export type PrivacyClass = "public_market" | "user_preference" | "safety" | "private_context";
export type MarketUsefulness = "high" | "medium" | "low" | "none";
export type RolePerspective = "BUYER" | "SELLER" | "SYSTEM" | "UNKNOWN";

export interface ConversationSignalEvidence {
  source: "message" | "round" | "system";
  sourceKey?: string;
  messageId?: string;
  start?: number;
  end?: number;
  textHash?: string;
  rawTextAvailable?: boolean;
}

export interface ConversationSignal {
  type: ConversationSignalType;
  entityType: string;
  entityValue: string;
  normalizedValue: string;
  confidence: number;
  evidence: ConversationSignalEvidence;
  method: ExtractionMethod;
  privacyClass: PrivacyClass;
  marketUsefulness: MarketUsefulness;
  rolePerspective: RolePerspective;
  sourceRoundNo?: number;
  sourceMessageId?: string;
  metadata?: Record<string, unknown>;
}

export interface ExtractConversationSignalsInput {
  text: string;
  rolePerspective?: RolePerspective | "buyer" | "seller" | "system" | "unknown";
  sourceRoundNo?: number;
  sourceMessageId?: string;
}

type SignalDraft = Omit<
  ConversationSignal,
  "method" | "rolePerspective" | "sourceRoundNo" | "sourceMessageId"
>;

type PatternDefinition = {
  regex: RegExp;
  type: ConversationSignalType;
  entityType: string;
  normalizedValue: string;
  confidence: number;
  privacyClass: PrivacyClass;
  marketUsefulness: MarketUsefulness;
  metadata?: Record<string, unknown>;
};

const PRODUCT_PATTERNS: Array<{
  regex: RegExp;
  normalize: (match: RegExpExecArray) => string;
}> = [
  {
    regex: /\biphone\s*(1[1-9]|[2-9])\s*(pro\s*max|pro|max|plus|mini)?\b/gi,
    normalize: (match) => normalizeToken(["iphone", match[1], match[2]].filter(Boolean).join(" ")),
  },
  {
    regex: /\bair\s*pods\s*(pro\s*2|pro|max|3rd\s*gen|2nd\s*gen)?\b/gi,
    normalize: (match) => normalizeToken(["airpods", match[1]].filter(Boolean).join(" ")),
  },
  {
    regex: /\b(?:playstation\s*5|ps5)\s*(digital|disc)?\b/gi,
    normalize: (match) => normalizeToken(["ps5", match[1]].filter(Boolean).join(" ")),
  },
  {
    regex: /\bmac\s*book\s*(air|pro)?\s*(\d{2})?\s*(m[1-4])?\b/gi,
    normalize: (match) => normalizeToken(["macbook", match[1], match[2], match[3]].filter(Boolean).join(" ")),
  },
  {
    regex: /\bsteam\s*deck\s*(oled|\d{3,4}\s*gb)?\b/gi,
    normalize: (match) => normalizeToken(["steam deck", match[1]].filter(Boolean).join(" ")),
  },
  {
    regex: /\b(?:nintendo\s*)?switch\s*(oled|lite)?\b/gi,
    normalize: (match) => normalizeToken(["switch", match[1]].filter(Boolean).join(" ")),
  },
  {
    regex: /\bgalaxy\s*s(2[0-9])\s*(ultra|plus|\+)?\b/gi,
    normalize: (match) => normalizeToken(["galaxy s" + match[1], normalizePlus(match[2])].filter(Boolean).join(" ")),
  },
  {
    regex: /\bpixel\s*(\d)\s*(pro|xl|fold)?\b/gi,
    normalize: (match) => normalizeToken(["pixel", match[1], match[2]].filter(Boolean).join(" ")),
  },
];

const TERM_PATTERNS: PatternDefinition[] = [
  termPattern(/\binsured\s+shipping\b/gi, "shipping", "insured_shipping", 0.88, "high"),
  termPattern(/\b(?:shipping|ship|deliver|delivery)\b/gi, "shipping", "shipping", 0.78, "medium"),
  termPattern(/(?:\b(?:local\s+pickup|pickup|meet\s+locally)\b|직거래)/gi, "fulfillment", "local_pickup", 0.84, "medium"),
  termPattern(/(?:\b(?:return|returns|refund)\b|환불)/gi, "return_policy", "returns_refund", 0.78, "medium"),
  termPattern(/(?:\b(?:warranty|applecare\+?|apple\s*care)\b|보증)/gi, "warranty", "warranty", 0.82, "high"),
  termPattern(/\b(?:escrow|haggle\s+checkout)\b/gi, "payment", "escrow", 0.82, "medium"),
  termPattern(/(?:\b(?:receipt|proof\s+of\s+purchase)\b|영수증)/gi, "proof", "receipt_included", 0.84, "high"),
];

const CONDITION_PATTERNS: PatternDefinition[] = [
  conditionPattern(/\b(?:oem|original)\s+screen\b/gi, "screen", "oem_screen", 0.9, "high"),
  conditionPattern(/\breplacement\s+battery\b/gi, "battery", "replacement_battery", 0.88, "high"),
  conditionPattern(/\b(?:sealed|unopened|new\s+in\s+box|brand\s+new\s+in\s+box)\b/gi, "packaging", "sealed_box", 0.9, "high"),
  conditionPattern(/\b(?:applecare\+?|apple\s*care)\s*(?:active|included|until)?\b/gi, "warranty", "applecare", 0.86, "high"),
  conditionPattern(/\b(?:scratch|scratches|scuff|crack|cracked)\b/gi, "cosmetic", "cosmetic_damage", 0.82, "high"),
  conditionPattern(/\b(?:imei|serial)\s*(?:clean|verified|available)?\b/gi, "verification", "serial_or_imei", 0.82, "medium"),
];

const TRUST_RISK_PATTERNS: PatternDefinition[] = [
  riskPattern(/\b(?:off\s*platform|outside\s+(?:the\s+)?app|text\s+me\s+directly)\b/gi, "channel", "off_platform"),
  riskPattern(/\b(?:paypal\s+friends\s*(?:and|&)\s*family|friends\s*(?:and|&)\s*family)\b/gi, "payment", "paypal_friends_family"),
  riskPattern(/\b(?:wire\s+transfer|bank\s+wire|zelle|venmo|cash\s*app)\b/gi, "payment", "irreversible_payment"),
  riskPattern(/\b(?:whatsapp|telegram|signal)\b/gi, "channel", "external_messaging"),
  riskPattern(/https?:\/\/[^\s]+/gi, "link", "external_link"),
];

const DEMAND_PATTERNS: PatternDefinition[] = [
  demandPattern(/\b(?:need\s+it\s+today|need\s+today|asap|urgent|tonight)\b/gi, "timing", "urgent"),
  demandPattern(/\b(?:comparing|shopping\s+around|looking\s+at\s+another|another\s+listing)\b/gi, "comparison", "comparison_shopping"),
  demandPattern(/\b(?:watchlist|watching|looking\s+for|interested\s+in)\b/gi, "interest", "watchlist_interest"),
];

const DEAL_BLOCKER_PATTERNS: PatternDefinition[] = [
  blockerPattern(/\b(?:deal\s*breaker|must\s+have|required)\b/gi, "requirement", "explicit_requirement"),
  blockerPattern(/\b(?:only\s+if|unless|as\s+long\s+as)\b/gi, "conditional", "conditional_acceptance"),
];

export function extractConversationSignals(
  input: ExtractConversationSignalsInput,
): ConversationSignal[] {
  const text = input.text.trim();
  if (!text) return [];
  if (isLowInformationNoise(text)) return [];

  const signals: ConversationSignal[] = [];
  const rolePerspective = normalizeRolePerspective(input.rolePerspective);

  const add = (draft: SignalDraft) => {
    signals.push({
      ...draft,
      evidence: {
        ...draft.evidence,
        messageId: draft.evidence.messageId ?? input.sourceMessageId,
        sourceKey: draft.evidence.sourceKey ?? input.sourceMessageId,
        rawTextAvailable: true,
      },
      confidence: clampConfidence(draft.confidence),
      method: "deterministic",
      rolePerspective,
      sourceRoundNo: input.sourceRoundNo,
      sourceMessageId: input.sourceMessageId,
    });
  };

  const securityThreat = extractSecurityThreat(text);
  if (securityThreat) {
    add(securityThreat);
    return dedupeSignals(signals);
  }

  extractPrices(text).forEach(add);
  extractPriceResistance(text).forEach(add);
  extractProducts(text).forEach(add);
  extractStorage(text).forEach(add);
  extractBatteryHealth(text).forEach(add);
  extractCarrierAndColor(text).forEach(add);
  extractPatternSignals(text, CONDITION_PATTERNS).forEach(add);
  extractPatternSignals(text, TERM_PATTERNS).forEach((signal) => {
    add(signal);
    add({
      ...signal,
      type: "term_candidate",
      confidence: Math.min(signal.confidence, 0.78),
      marketUsefulness: "medium",
    });
  });
  extractPatternSignals(text, TRUST_RISK_PATTERNS).forEach(add);
  extractPatternSignals(text, DEMAND_PATTERNS).forEach(add);
  extractPatternSignals(text, DEAL_BLOCKER_PATTERNS).forEach(add);
  extractMarketOutcome(text).forEach(add);

  return dedupeSignals(signals);
}

function extractSecurityThreat(text: string): SignalDraft | null {
  const guard = runPromptGuard(text, "message");
  if (guard.safe) return null;

  return {
    type: "security_threat",
    entityType: guard.threat_type ?? "unknown",
    entityValue: guard.matched_pattern ?? guard.threat_type ?? "prompt_guard",
    normalizedValue: `prompt_guard_${guard.threat_type ?? "unknown"}`,
    confidence: Math.max(0.75, guard.threat_score),
    evidence: {
      source: "message",
      textHash: hashText(text),
    },
    privacyClass: "safety",
    marketUsefulness: "none",
    metadata: {
      guard: "prompt_guard",
      threat_type: guard.threat_type,
      threat_score: guard.threat_score,
      matched_pattern: guard.matched_pattern,
    },
  };
}

function isLowInformationNoise(text: string): boolean {
  const normalized = text.normalize("NFKC").trim();
  if (normalized.length < 2) return true;

  const alphaNumeric = normalized.match(/[\p{L}\p{N}]/gu) ?? [];
  if (alphaNumeric.length === 0) return true;

  const compact = normalized.replace(/\s+/g, "");
  if (/^(.)\1{5,}$/u.test(compact)) return true;

  const uniqueChars = new Set(compact.toLowerCase()).size;
  return compact.length >= 12 && uniqueChars <= 2;
}

function extractPrices(text: string): SignalDraft[] {
  const regex = /(?:\$|usd\s*)(\d[\d,]*(?:\.\d{1,2})?)|(\d[\d,]*(?:\.\d{1,2})?)\s*(?:usd|dollars)\b/gi;
  const signals: SignalDraft[] = [];

  for (const match of text.matchAll(regex)) {
    const rawAmount = match[1] ?? match[2];
    if (!rawAmount) continue;
    const cents = parsePriceCents(rawAmount);
    if (!cents) continue;

    signals.push({
      type: "price_anchor",
      entityType: "price",
      entityValue: match[0],
      normalizedValue: String(cents),
      confidence: 0.93,
      evidence: evidenceFromMatch(match),
      privacyClass: "public_market",
      marketUsefulness: "high",
      metadata: { currency: "USD", amount_minor: cents },
    });
  }

  return signals;
}

function extractPriceResistance(text: string): SignalDraft[] {
  const patterns: Array<{ regex: RegExp; boundary: "ceiling" | "floor" }> = [
    {
      regex: /\b(?:won't|wont|can't|cant|cannot|can\s+not)\s+(?:go|do|pay|offer)?\s*(?:any\s*)?(?:more\s+than|above|over)\s*\$(\d[\d,]*(?:\.\d{1,2})?)/gi,
      boundary: "ceiling",
    },
    {
      regex: /\b(?:max|maximum|ceiling|top\s+budget|highest|all\s+i\s+can\s+do)\s*(?:is|:)?\s*\$(\d[\d,]*(?:\.\d{1,2})?)/gi,
      boundary: "ceiling",
    },
    {
      regex: /\b(?:won't|wont|can't|cant|cannot|can\s+not|not)\s+(?:go|take|accept|do)?\s*(?:any\s*)?(?:less\s+than|below|under)\s*\$(\d[\d,]*(?:\.\d{1,2})?)/gi,
      boundary: "floor",
    },
    {
      regex: /\b(?:firm\s+at|firm|lowest|floor)\s*(?:is|at|:)?\s*\$(\d[\d,]*(?:\.\d{1,2})?)/gi,
      boundary: "floor",
    },
  ];

  const signals: SignalDraft[] = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern.regex)) {
      const cents = parsePriceCents(match[1]);
      if (!cents) continue;
      signals.push({
        type: "price_resistance",
        entityType: pattern.boundary,
        entityValue: match[0],
        normalizedValue: `${pattern.boundary}_${cents}`,
        confidence: 0.88,
        evidence: evidenceFromMatch(match),
        privacyClass: "user_preference",
        marketUsefulness: "high",
        metadata: { currency: "USD", amount_minor: cents, boundary: pattern.boundary },
      });
    }
  }

  return signals;
}

function extractProducts(text: string): SignalDraft[] {
  const signals: SignalDraft[] = [];

  for (const pattern of PRODUCT_PATTERNS) {
    for (const match of text.matchAll(pattern.regex)) {
      const normalizedValue = pattern.normalize(match);
      const baseSignal: SignalDraft = {
        type: "product_identity",
        entityType: "product",
        entityValue: match[0],
        normalizedValue,
        confidence: 0.87,
        evidence: evidenceFromMatch(match),
        privacyClass: "public_market",
        marketUsefulness: "high",
      };

      signals.push(baseSignal);
      signals.push({
        ...baseSignal,
        type: "tag_candidate",
        confidence: 0.78,
        marketUsefulness: "medium",
      });
    }
  }

  return signals;
}

function extractStorage(text: string): SignalDraft[] {
  const regex = /\b(\d{2,4})\s*(gb|tb)\b/gi;
  const signals: SignalDraft[] = [];

  for (const match of text.matchAll(regex)) {
    const size = Number(match[1]);
    const unit = match[2]?.toLowerCase();
    if (!Number.isFinite(size) || !unit) continue;
    const gb = unit === "tb" ? size * 1024 : size;

    signals.push({
      type: "product_attribute",
      entityType: "storage",
      entityValue: match[0],
      normalizedValue: `${gb}gb`,
      confidence: 0.88,
      evidence: evidenceFromMatch(match),
      privacyClass: "public_market",
      marketUsefulness: "high",
      metadata: { storage_gb: gb },
    });
  }

  return signals;
}

function extractBatteryHealth(text: string): SignalDraft[] {
  const regex = /(?:\bbattery(?:\s+health)?\b|배터리)\s*(?:is|at|:)?\s*(\d{2,3})\s*%/gi;
  const signals: SignalDraft[] = [];

  for (const match of text.matchAll(regex)) {
    const pct = Number(match[1]);
    if (!Number.isFinite(pct) || pct < 1 || pct > 100) continue;

    signals.push({
      type: "condition_claim",
      entityType: "battery_health",
      entityValue: match[0],
      normalizedValue: `battery_health_${pct}`,
      confidence: 0.9,
      evidence: evidenceFromMatch(match),
      privacyClass: "public_market",
      marketUsefulness: "high",
      metadata: { battery_health_pct: pct },
    });
  }

  return signals;
}

function extractCarrierAndColor(text: string): SignalDraft[] {
  const patterns: PatternDefinition[] = [
    {
      regex: /\b(?:factory\s+)?unlocked\b/gi,
      type: "product_attribute",
      entityType: "carrier",
      normalizedValue: "unlocked",
      confidence: 0.86,
      privacyClass: "public_market",
      marketUsefulness: "high",
    },
    {
      regex: /\b(?:carrier\s+locked|locked\s+to\s+(?:att|at&t|verizon|t-mobile|tmobile))\b/gi,
      type: "product_attribute",
      entityType: "carrier",
      normalizedValue: "carrier_locked",
      confidence: 0.84,
      privacyClass: "public_market",
      marketUsefulness: "high",
    },
    {
      regex: /\b(?:natural\s+titanium|blue\s+titanium|black\s+titanium|space\s+gray|space\s+black|silver|black|white|gold|blue)\b/gi,
      type: "product_attribute",
      entityType: "color",
      normalizedValue: "",
      confidence: 0.72,
      privacyClass: "public_market",
      marketUsefulness: "medium",
    },
  ];

  return extractPatternSignals(text, patterns).map((signal) => {
    if (signal.entityType !== "color") return signal;
    return {
      ...signal,
      normalizedValue: normalizeToken(signal.entityValue),
    };
  });
}

function extractPatternSignals(text: string, patterns: PatternDefinition[]): SignalDraft[] {
  const signals: SignalDraft[] = [];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern.regex)) {
      signals.push({
        type: pattern.type,
        entityType: pattern.entityType,
        entityValue: match[0],
        normalizedValue: pattern.normalizedValue || normalizeToken(match[0]),
        confidence: pattern.confidence,
        evidence: evidenceFromMatch(match),
        privacyClass: pattern.privacyClass,
        marketUsefulness: pattern.marketUsefulness,
        metadata: pattern.metadata,
      });
    }
  }

  return signals;
}

function extractMarketOutcome(text: string): SignalDraft[] {
  const patterns: PatternDefinition[] = [
    {
      regex: /\b(?:accepted|accept|deal|agreed|sold)\b/gi,
      type: "market_outcome",
      entityType: "outcome",
      normalizedValue: "accepted",
      confidence: 0.78,
      privacyClass: "public_market",
      marketUsefulness: "high",
    },
    {
      regex: /\b(?:pass|walk\s+away|no\s+deal|decline|rejected)\b/gi,
      type: "market_outcome",
      entityType: "outcome",
      normalizedValue: "walkaway",
      confidence: 0.76,
      privacyClass: "public_market",
      marketUsefulness: "medium",
    },
  ];

  return extractPatternSignals(text, patterns);
}

function termPattern(
  regex: RegExp,
  entityType: string,
  normalizedValue: string,
  confidence: number,
  marketUsefulness: MarketUsefulness,
): PatternDefinition {
  return {
    regex,
    type: "term_preference",
    entityType,
    normalizedValue,
    confidence,
    privacyClass: "user_preference",
    marketUsefulness,
  };
}

function conditionPattern(
  regex: RegExp,
  entityType: string,
  normalizedValue: string,
  confidence: number,
  marketUsefulness: MarketUsefulness,
): PatternDefinition {
  return {
    regex,
    type: "condition_claim",
    entityType,
    normalizedValue,
    confidence,
    privacyClass: "public_market",
    marketUsefulness,
  };
}

function riskPattern(regex: RegExp, entityType: string, normalizedValue: string): PatternDefinition {
  return {
    regex,
    type: "trust_risk",
    entityType,
    normalizedValue,
    confidence: 0.86,
    privacyClass: "safety",
    marketUsefulness: "low",
  };
}

function demandPattern(regex: RegExp, entityType: string, normalizedValue: string): PatternDefinition {
  return {
    regex,
    type: "demand_intent",
    entityType,
    normalizedValue,
    confidence: 0.74,
    privacyClass: "user_preference",
    marketUsefulness: "medium",
  };
}

function blockerPattern(regex: RegExp, entityType: string, normalizedValue: string): PatternDefinition {
  return {
    regex,
    type: "deal_blocker",
    entityType,
    normalizedValue,
    confidence: 0.78,
    privacyClass: "user_preference",
    marketUsefulness: "medium",
  };
}

function parsePriceCents(rawAmount?: string): number | undefined {
  if (!rawAmount) return undefined;
  const amount = Number(rawAmount.replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  return Math.round(amount * 100);
}

function evidenceFromMatch(match: RegExpMatchArray): ConversationSignalEvidence {
  const start = match.index ?? undefined;
  const text = match[0];
  return {
    source: "message",
    start,
    end: start === undefined ? undefined : start + text.length,
    textHash: hashText(text),
  };
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function normalizeRolePerspective(
  role: ExtractConversationSignalsInput["rolePerspective"],
): RolePerspective {
  if (!role) return "UNKNOWN";
  const upper = role.toUpperCase();
  if (upper === "BUYER" || upper === "SELLER" || upper === "SYSTEM") return upper;
  return "UNKNOWN";
}

function normalizePlus(value?: string): string | undefined {
  if (!value) return undefined;
  return value === "+" ? "plus" : value;
}

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/\+/g, " plus ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

function dedupeSignals(signals: ConversationSignal[]): ConversationSignal[] {
  const byKey = new Map<string, ConversationSignal>();

  for (const signal of signals) {
    const key = [
      signal.type,
      signal.entityType,
      signal.normalizedValue,
      signal.sourceRoundNo ?? "",
      signal.sourceMessageId ?? "",
    ].join(":");
    const existing = byKey.get(key);
    if (!existing || signal.confidence > existing.confidence) {
      byKey.set(key, signal);
    }
  }

  return Array.from(byKey.values());
}
