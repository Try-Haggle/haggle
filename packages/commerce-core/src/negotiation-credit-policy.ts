/**
 * Negotiation credit quotes and grant table.
 *
 * This is the policy, not a wallet. A later ledger should debit/credit using
 * these numbers. Do not treat a client flag as payment.
 *
 * Soft control-mode matrix (Eng1 M1 / SoT auto-manual-control-mode-sot.md §5):
 * our Haggle AI Soft turns only — Manual sides do not consume Soft AI credits.
 */

export const CREDIT_SIGNUP = 200;
export const CREDIT_ATTENDANCE_BASE = 10;
export const CREDIT_ATTENDANCE_STREAK_STEP = 1;
export const CREDIT_ATTENDANCE_MAX = 20;
export const CREDIT_FIRST_COMPLETE_LISTING = 20;
export const CREDIT_FUNDED_EACH_SIDE = 10;
export const CREDIT_RELEASE_NO_DISPUTE_EACH = 10;
export const CREDIT_INVITE_FIRST_FUNDED = 40;

export const CREDIT_FLASH_GAME = 4;
export const CREDIT_PRO_GAME = 10;
export const CREDIT_OWN_BETTER_MODEL = 5;

/** Half band when exactly one Soft side uses Haggle AI (Pro 5 / Flash 2). */
export const CREDIT_PRO_HALF = CREDIT_PRO_GAME / 2;
export const CREDIT_FLASH_HALF = CREDIT_FLASH_GAME / 2;

export const CREDIT_PRO_ASK_THRESHOLD_MINOR = 10_000;

export const CREDIT_SOFT_CONTROL_MODES = ["auto", "manual"] as const;
export type SoftControlMode = (typeof CREDIT_SOFT_CONTROL_MODES)[number];

export type SoftAiCreditBand = "full" | "half" | "zero";

/**
 * Test-period bypass. Staging and local do not debit.
 * Production must always debit. Turn this list into `[]` (or stop calling the
 * bypass) before credits go live in production. W2026-08-22-05.
 */
export const CREDIT_UNLIMITED_IS_TEMPORARY = true;
export const CREDIT_UNLIMITED_ENVS = ["local", "staging"] as const;

export const CREDIT_GRANT_REASONS = [
  "signup",
  "attendance_daily",
  "first_complete_listing",
  "funded",
  "release_no_dispute",
  "invite_first_funded",
] as const;

export type CreditGrantReason = (typeof CREDIT_GRANT_REASONS)[number];

export const CREDIT_GRANTS: Record<CreditGrantReason, number> = {
  signup: CREDIT_SIGNUP,
  attendance_daily: CREDIT_ATTENDANCE_BASE,
  first_complete_listing: CREDIT_FIRST_COMPLETE_LISTING,
  funded: CREDIT_FUNDED_EACH_SIDE,
  release_no_dispute: CREDIT_RELEASE_NO_DISPUTE_EACH,
  invite_first_funded: CREDIT_INVITE_FIRST_FUNDED,
};

export interface NegotiationCreditQuote {
  role: "buyer" | "seller";
  base: number;
  own_better_model: number;
  total: number;
  default_is_pro: boolean;
  unlimited: boolean;
  /** Soft AI band when control modes were supplied (buyer quotes). */
  soft_ai_band?: SoftAiCreditBand;
  buyer_control_mode?: SoftControlMode;
  seller_control_mode?: SoftControlMode;
}

function defaultIsPro(publishedAskMinor?: number): boolean {
  return (
    typeof publishedAskMinor !== "number" || publishedAskMinor >= CREDIT_PRO_ASK_THRESHOLD_MINOR
  );
}

function normalizeEnv(haggleEnv?: string): string {
  return (haggleEnv ?? "").trim().toLowerCase();
}

/** True on local/staging during the test period. Always false in production. */
export function creditsAreUnlimited(haggleEnv?: string): boolean {
  if (!CREDIT_UNLIMITED_IS_TEMPORARY) return false;
  const env = normalizeEnv(haggleEnv);
  if (env === "production") return false;
  return (CREDIT_UNLIMITED_ENVS as readonly string[]).includes(env);
}

export function isSoftControlMode(value: unknown): value is SoftControlMode {
  return value === "auto" || value === "manual";
}

/**
 * Our-AI Soft credit band from per-party control modes (SoT §5).
 * Manual sides do not consume Haggle Soft AI credits for that party.
 */
export function softAiCreditBand(
  buyerMode: SoftControlMode,
  sellerMode: SoftControlMode,
): SoftAiCreditBand {
  const buyerAi = buyerMode === "auto";
  const sellerAi = sellerMode === "auto";
  if (buyerAi && sellerAi) return "full";
  if (!buyerAi && !sellerAi) return "zero";
  return "half";
}

export function softAiCreditBase(input: {
  buyerMode: SoftControlMode;
  sellerMode: SoftControlMode;
  publishedAskMinor?: number;
}): { band: SoftAiCreditBand; base: number; default_is_pro: boolean } {
  const pro = defaultIsPro(input.publishedAskMinor);
  const band = softAiCreditBand(input.buyerMode, input.sellerMode);
  const base =
    band === "full"
      ? pro
        ? CREDIT_PRO_GAME
        : CREDIT_FLASH_GAME
      : band === "half"
        ? pro
          ? CREDIT_PRO_HALF
          : CREDIT_FLASH_HALF
        : 0;
  return { band, base, default_is_pro: pro };
}

/**
 * Differential charge when Soft AI work expands (Auto ever ON that lifts the band).
 * Never refunds when Auto turns OFF (SoT §5.1). Callers must lock the session row
 * so two concurrent toggles cannot double-charge (TOCTOU).
 */
export function quoteSoftAiCreditDifferential(input: {
  alreadyChargedBase: number;
  buyerMode: SoftControlMode;
  sellerMode: SoftControlMode;
  publishedAskMinor?: number;
  haggleEnv?: string;
}): {
  band: SoftAiCreditBand;
  target_base: number;
  already_charged_base: number;
  charge_base: number;
  charge_total: number;
  new_charged_base: number;
  default_is_pro: boolean;
  unlimited: boolean;
} {
  const unlimited = creditsAreUnlimited(input.haggleEnv);
  const already = Math.max(0, Math.floor(input.alreadyChargedBase));
  const { band, base: target, default_is_pro } = softAiCreditBase(input);
  const chargeBase = Math.max(0, target - already);
  return {
    band,
    target_base: target,
    already_charged_base: already,
    charge_base: chargeBase,
    charge_total: unlimited ? 0 : chargeBase,
    new_charged_base: already + chargeBase,
    default_is_pro,
    unlimited,
  };
}

/**
 * Daily check-in. Day 1 = 10. Each consecutive day adds 1, capped at 20.
 * `consecutiveDays` is the streak including today (1 on the first check-in).
 */
export function attendanceGrantAmount(consecutiveDays: number): number {
  if (!Number.isInteger(consecutiveDays) || consecutiveDays < 1) {
    return CREDIT_ATTENDANCE_BASE;
  }
  return Math.min(
    CREDIT_ATTENDANCE_MAX,
    CREDIT_ATTENDANCE_BASE + CREDIT_ATTENDANCE_STREAK_STEP * (consecutiveDays - 1),
  );
}

export function quoteNegotiationCredits(input: {
  role: "buyer" | "seller";
  publishedAskMinor?: number;
  /** Server-approved request for a better-than-default model on this side. */
  ownBetterModel?: boolean;
  haggleEnv?: string;
  /**
   * Soft control modes (default Auto/Auto = full band). Buyer quotes use the
   * SoT matrix; seller Soft AI base stays 0 here (seller +5 ownBetter later).
   */
  buyerControlMode?: SoftControlMode;
  sellerControlMode?: SoftControlMode;
}): NegotiationCreditQuote {
  const unlimited = creditsAreUnlimited(input.haggleEnv);
  const buyerMode = input.buyerControlMode ?? "auto";
  const sellerMode = input.sellerControlMode ?? "auto";
  const soft = softAiCreditBase({
    buyerMode,
    sellerMode,
    publishedAskMinor: input.publishedAskMinor,
  });
  const ownBetter = input.ownBetterModel === true ? CREDIT_OWN_BETTER_MODEL : 0;
  // Seller Soft AI drafting is not billed on the buyer Soft matrix; seller
  // ownBetter (+5) remains the only seller line (out of M1 mode toggle scope
  // to require it — still quoted when requested).
  const base = input.role === "seller" ? 0 : soft.base;
  return {
    role: input.role,
    base,
    own_better_model: ownBetter,
    total: unlimited ? 0 : base + ownBetter,
    default_is_pro: soft.default_is_pro,
    unlimited,
    soft_ai_band: soft.band,
    buyer_control_mode: buyerMode,
    seller_control_mode: sellerMode,
  };
}

export function creditGrantAmount(reason: CreditGrantReason): number {
  return CREDIT_GRANTS[reason];
}
