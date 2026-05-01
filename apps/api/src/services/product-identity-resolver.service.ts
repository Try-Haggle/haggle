import {
  parseBatteryHealthPct,
  parseCarrierLocked,
  parseStorageGb,
} from "../lib/hfmi-title-parser.js";

export type ProductAlignment =
  | "exact"
  | "variant"
  | "related"
  | "different"
  | "unknown";

export interface ProductIdentity {
  raw: string;
  canonicalFamily?: string;
  model?: string;
  generation?: string;
  variant?: string;
  storageGb?: number;
  batteryHealthPct?: number;
  carrierLocked?: boolean;
  confidence: number;
  evidence: string[];
}

export interface ProductIdentityComparison {
  alignment: ProductAlignment;
  score: number;
  shouldBlockAutoNegotiation: boolean;
  shouldAskConfirmation: boolean;
  reasonCodes: string[];
  remembered: ProductIdentity;
  selected: ProductIdentity;
}

const PRODUCT_PATTERNS: Array<{
  family: string;
  regex: RegExp;
  build: (match: RegExpExecArray) => Partial<ProductIdentity>;
}> = [
  {
    family: "iphone",
    regex: /\b(?:iphone|아이폰)\s*(1[1-9]|[2-9])\s*(pro\s*max|pro|max|plus|mini)?\b/i,
    build: (match) => {
      const generation = match[1];
      const variant = normalizeVariant(match[2]);
      return {
        canonicalFamily: "iphone",
        generation,
        variant,
        model: ["iphone", generation, variant].filter(Boolean).join("_"),
      };
    },
  },
  {
    family: "macbook",
    regex: /\b(?:mac\s*book|맥북)\s*(air|pro)?\s*(\d{2})?\s*(m[1-4])?\b/i,
    build: (match) => {
      const variant = normalizeVariant(match[1]);
      const size = match[2];
      const chip = match[3]?.toLowerCase();
      return {
        canonicalFamily: "macbook",
        generation: chip,
        variant: [variant, size].filter(Boolean).join("_") || undefined,
        model: ["macbook", variant, size, chip].filter(Boolean).join("_"),
      };
    },
  },
  {
    family: "laptop",
    regex: /\b(?:laptop|notebook|노트북)\b/i,
    build: () => ({
      canonicalFamily: "laptop",
      model: "laptop",
    }),
  },
];

export function resolveProductIdentity(input: string): ProductIdentity {
  const raw = input.trim();
  const evidence: string[] = [];
  let identity: ProductIdentity = {
    raw,
    confidence: raw ? 0.2 : 0,
    evidence,
  };

  for (const pattern of PRODUCT_PATTERNS) {
    const match = pattern.regex.exec(raw);
    if (!match) continue;
    const extracted = pattern.build(match);
    identity = {
      ...identity,
      ...extracted,
      confidence: Math.max(identity.confidence, extracted.generation ? 0.86 : 0.62),
    };
    evidence.push(`matched:${pattern.family}`);
    break;
  }

  const storageGb = parseStorageGb(raw);
  if (storageGb !== null) {
    identity.storageGb = storageGb;
    identity.confidence = Math.min(0.96, identity.confidence + 0.04);
    evidence.push("storage");
  }

  const batteryHealthPct = parseBatteryHealthPct(raw);
  if (batteryHealthPct !== null) {
    identity.batteryHealthPct = batteryHealthPct;
    evidence.push("battery_health");
  }

  const carrierLocked = parseCarrierLocked(raw);
  if (carrierLocked !== null) {
    identity.carrierLocked = carrierLocked;
    evidence.push("carrier_lock");
  }

  return identity;
}

export function compareProductIdentity(
  rememberedInput: string | ProductIdentity,
  selectedInput: string | ProductIdentity,
): ProductIdentityComparison {
  const remembered = typeof rememberedInput === "string" ? resolveProductIdentity(rememberedInput) : rememberedInput;
  const selected = typeof selectedInput === "string" ? resolveProductIdentity(selectedInput) : selectedInput;

  const reasonCodes: string[] = [];
  let score = 0;

  if (!remembered.canonicalFamily || !selected.canonicalFamily) {
    return result("unknown", 0.25, true, true, ["identity_uncertain"], remembered, selected);
  }

  if (remembered.canonicalFamily !== selected.canonicalFamily) {
    return result("different", 0.05, false, false, ["different_family"], remembered, selected);
  }
  score += 0.35;

  if (remembered.generation && selected.generation) {
    if (remembered.generation === selected.generation) score += 0.25;
    else reasonCodes.push("different_generation");
  }

  if (remembered.variant && selected.variant) {
    if (remembered.variant === selected.variant) score += 0.16;
    else reasonCodes.push("different_variant");
  } else if (remembered.variant || selected.variant) {
    reasonCodes.push("variant_unspecified");
    score += 0.06;
  }

  if (remembered.storageGb && selected.storageGb) {
    if (remembered.storageGb === selected.storageGb) score += 0.14;
    else reasonCodes.push("different_storage");
  } else if (remembered.storageGb || selected.storageGb) {
    reasonCodes.push("storage_unspecified");
    score += 0.04;
  }

  if (remembered.carrierLocked !== undefined && selected.carrierLocked !== undefined) {
    if (remembered.carrierLocked === selected.carrierLocked) score += 0.06;
    else reasonCodes.push("different_carrier_lock");
  }

  if (remembered.batteryHealthPct && selected.batteryHealthPct) {
    if (Math.abs(remembered.batteryHealthPct - selected.batteryHealthPct) <= 3) score += 0.04;
    else reasonCodes.push("different_battery_health");
  }

  const roundedScore = Math.min(1, Number(score.toFixed(2)));
  if (roundedScore >= 0.9) return result("exact", roundedScore, false, false, reasonCodes, remembered, selected);
  if (roundedScore >= 0.58) return result("variant", roundedScore, false, true, reasonCodes, remembered, selected);
  if (remembered.canonicalFamily === selected.canonicalFamily) {
    return result("related", roundedScore, false, true, reasonCodes, remembered, selected);
  }
  return result("different", roundedScore, false, false, reasonCodes, remembered, selected);
}

function result(
  alignment: ProductAlignment,
  score: number,
  shouldBlockAutoNegotiation: boolean,
  shouldAskConfirmation: boolean,
  reasonCodes: string[],
  remembered: ProductIdentity,
  selected: ProductIdentity,
): ProductIdentityComparison {
  return {
    alignment,
    score,
    shouldBlockAutoNegotiation,
    shouldAskConfirmation,
    reasonCodes,
    remembered,
    selected,
  };
}

function normalizeVariant(value?: string): string | undefined {
  if (!value) return undefined;
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}
