/**
 * Negotiation credit quotes and grant table.
 *
 * This is the policy, not a wallet. A later ledger should debit/credit using
 * these numbers. Do not treat a client flag as payment.
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

export const CREDIT_PRO_ASK_THRESHOLD_MINOR = 10_000;

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
}): NegotiationCreditQuote {
  const unlimited = creditsAreUnlimited(input.haggleEnv);
  const pro = defaultIsPro(input.publishedAskMinor);
  const base = input.role === "seller" ? 0 : pro ? CREDIT_PRO_GAME : CREDIT_FLASH_GAME;
  const ownBetter = input.ownBetterModel === true ? CREDIT_OWN_BETTER_MODEL : 0;
  return {
    role: input.role,
    base,
    own_better_model: ownBetter,
    total: unlimited ? 0 : base + ownBetter,
    default_is_pro: pro,
    unlimited,
  };
}

export function creditGrantAmount(reason: CreditGrantReason): number {
  return CREDIT_GRANTS[reason];
}
