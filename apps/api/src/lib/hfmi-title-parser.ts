/**
 * eBay listing title parser for HFMI feature extraction.
 *
 * Best-effort regex extraction — returns nullable fields when a signal
 * can't be confidently inferred. ~40-60% coverage expected per spec
 * §5.2-§5.3. Null fields are median-imputed at fit time.
 *
 * See docs/mvp/2026-04-08_hfmi-spec.md §5.
 */

export type CosmeticGradeHint = "A" | "B" | "C";

export interface ParsedTitleFeatures {
  storageGb: number | null;
  batteryHealthPct: number | null;
  carrierLocked: boolean | null;
  cosmeticGradeHint: CosmeticGradeHint | null;
  /** True if the title matches an exclusion pattern per §5.4. */
  excluded: boolean;
  /** Exclusion reason, if excluded. */
  excludeReason: string | null;
}

// ─── Exclusion patterns (§5.4) ────────────────────────────────────────

const EXCLUDE_PATTERNS: Array<[RegExp, string]> = [
  [/\bfor\s+parts\b/i, "for_parts"],
  [/\bnot\s+working\b/i, "not_working"],
  [/\bbroken\b/i, "broken"],
  [/\bcracked\b/i, "cracked"],
  [/\bicloud\s*locked\b/i, "icloud_locked"],
  [/\bactivation\s*locked\b/i, "activation_locked"],
  [/\bblacklist(ed)?\b/i, "blacklisted"],
  [/\bbad\s*esn\b/i, "bad_esn"],
  [/\blot\s+of\b/i, "bulk_lot"],
  [/\bbulk\b/i, "bulk"],
  [/\bwholesale\b/i, "wholesale"],
];

// Accessory-only heuristic: title contains accessory word AND no iPhone mention.
const ACCESSORY_ONLY = /\b(case|charger|cable|adapter|screen\s*protector)\b/i;

// ─── Main parser ──────────────────────────────────────────────────────

export function parseEbayTitle(title: string): ParsedTitleFeatures {
  const t = title ?? "";

  // Exclusion check
  for (const [re, reason] of EXCLUDE_PATTERNS) {
    if (re.test(t)) {
      return {
        storageGb: null,
        batteryHealthPct: null,
        carrierLocked: null,
        cosmeticGradeHint: null,
        excluded: true,
        excludeReason: reason,
      };
    }
  }

  // Accessory-only: if accessory keyword present and no "iphone" mention.
  if (ACCESSORY_ONLY.test(t) && !/\biphone\b/i.test(t)) {
    return {
      storageGb: null,
      batteryHealthPct: null,
      carrierLocked: null,
      cosmeticGradeHint: null,
      excluded: true,
      excludeReason: "accessory_only",
    };
  }

  return {
    storageGb: parseStorageGb(t),
    batteryHealthPct: parseBatteryHealthPct(t),
    carrierLocked: parseCarrierLocked(t),
    cosmeticGradeHint: parseCosmeticGradeHint(t),
    excluded: false,
    excludeReason: null,
  };
}

// ─── Field parsers ────────────────────────────────────────────────────

/** Extract storage in GB. Supports 128/256/512 GB and 1TB → 1024. */
export function parseStorageGb(title: string): number | null {
  // 1TB → 1024 (check first, more specific)
  if (/\b1\s*tb\b/i.test(title)) return 1024;
  const m = title.match(/\b(128|256|512)\s*gb\b/i);
  if (m) return parseInt(m[1], 10);
  return null;
}

/**
 * Extract battery health percentage. Common patterns:
 *   "battery 92%", "Battery Health: 95%", "BH 88%", "92% battery"
 * Only accepts values in 50-100 range to filter noise.
 */
export function parseBatteryHealthPct(title: string): number | null {
  // "battery ... N%" or "battery health ... N%" or "BH N%"
  const patterns: RegExp[] = [
    /battery(?:\s*health)?\s*[:\-]?\s*(\d{2,3})\s*%/i,
    /\bbh\s*[:\-]?\s*(\d{2,3})\s*%/i,
    /(\d{2,3})\s*%\s*battery/i,
  ];
  for (const re of patterns) {
    const m = title.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 50 && n <= 100) return n;
    }
  }
  return null;
}

/**
 * Extract carrier lock status. Returns:
 *   true   — explicitly locked / carrier-specific
 *   false  — explicitly unlocked
 *   null   — ambiguous
 */
export function parseCarrierLocked(title: string): boolean | null {
  if (/\bunlocked\b/i.test(title)) return false;
  if (/\b(locked|at\s*&\s*t\s*locked|verizon\s*locked|t-?mobile\s*locked|sprint\s*locked)\b/i.test(title)) {
    return true;
  }
  return null;
}

/**
 * Coarse cosmetic grade hint from title keywords.
 *   A: "mint", "pristine", "like new", "excellent"
 *   B: "very good", "good condition", "used"
 *   C: "fair", "acceptable", "scratched", "scuff"
 * Returns null when no hint.
 */
export function parseCosmeticGradeHint(title: string): CosmeticGradeHint | null {
  if (/\b(mint|pristine|like\s*new|flawless)\b/i.test(title)) return "A";
  if (/\bexcellent\b/i.test(title)) return "A";
  if (/\b(very\s*good|good\s*condition)\b/i.test(title)) return "B";
  if (/\b(fair|acceptable|scratched|scuffs?|scuffed|heavy\s*wear)\b/i.test(title)) return "C";
  return null;
}
