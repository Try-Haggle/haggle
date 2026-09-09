/**
 * Soft AI credit balance — web client shapes (Eng2 C2).
 *
 * SoT: docs/wip/credit-ledger-sot.md §6 (UI surfaces: balance display,
 * insufficient-credits gate; optional quote/grant feedback out of C2 scope).
 * Also: docs/wip/auto-manual-control-mode-sot.md §5 · §5.1.
 *
 * Field shapes match Eng1 C1 ledger read path. Do NOT invent credit math in
 * the web client — server / policy is source of truth for quotes and debits.
 * Until C1 lands, fetch stubs with clear tolerance (no fake balance number).
 */

import { ApiError, api } from "@/lib/api-client";

/** Canonical C1 balance read (Eng2 wires UI here; C1 owns schema). */
export const CREDIT_BALANCE_PATH = "/credits/balance";

/** Stable insufficient error code (SoT §6 / C1). */
export const INSUFFICIENT_CREDITS_CODE = "INSUFFICIENT_CREDITS";

/** CU-ready short labels (SoT §6; agent-surface friendly). */
export const CREDIT_BALANCE_UI = {
  /** Settings / chrome section title */
  sectionTitle: "Soft AI credits",
  /** Compact chrome label prefix */
  stripLabel: "Soft credits",
  /** When balance is known */
  balanceLabel: (n: number) => `Soft credits: ${n}`,
  /** When C1 API unavailable */
  stubLabel: "Soft credits: —",
  /** Staging/local unlimited affordance (SoT §4 / §6) */
  unlimitedLabel: "Unlimited (not debiting)",
  /** Insufficient gate title */
  insufficientTitle: "Insufficient Soft credits",
  /** Insufficient next step */
  insufficientNext: "Add credits or switch Soft to Manual, then try again.",
  /** Stub tolerance note */
  stubNote: "Balance preview — ledger API when C1 lands",
  /** Loading */
  loadingLabel: "Soft credits: …",
} as const;

/**
 * SoT balance read shape (illustrative names from credit-ledger-sot.md §2.1 / §6).
 * C1 may add fields; unknown extras are ignored by the UI.
 */
export type CreditBalanceResponse = {
  /** Non-negative integer Soft credits for the signed-in account. */
  balance: number;
  /** Present when server reports creditsAreUnlimited() (staging/local). */
  unlimited?: boolean;
  account_id?: string;
  actor_id?: string;
  /** Optional currency tag — Soft AI credits only, not fiat/USDC. */
  unit?: "soft_ai_credit";
};

export type CreditBalanceSource = "api" | "stub";

export type CreditBalanceState = {
  source: CreditBalanceSource;
  /** null when stub / unknown — never invent a fake number. */
  balance: number | null;
  unlimited: boolean;
  accountId: string | null;
  /** Stub or fetch failure reason code. */
  reason?: string;
};

export type InsufficientCreditsInfo = {
  code: typeof INSUFFICIENT_CREDITS_CODE;
  message: string;
  /** Server-reported required charge when present — never computed client-side. */
  required: number | null;
  /** Server-reported balance when present. */
  balance: number | null;
};

export function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** Parse C1 balance payload; reject invented / malformed numbers. */
export function parseCreditBalanceResponse(raw: unknown): CreditBalanceResponse | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (!isNonNegativeInt(obj.balance)) return null;
  return {
    balance: obj.balance,
    unlimited: obj.unlimited === true,
    account_id: typeof obj.account_id === "string" ? obj.account_id : undefined,
    actor_id: typeof obj.actor_id === "string" ? obj.actor_id : undefined,
    unit: obj.unit === "soft_ai_credit" ? "soft_ai_credit" : undefined,
  };
}

export function creditBalanceShortLabel(state: CreditBalanceState): string {
  if (state.source === "stub" || state.balance == null) {
    return CREDIT_BALANCE_UI.stubLabel;
  }
  return CREDIT_BALANCE_UI.balanceLabel(state.balance);
}

export function isInsufficientCreditsCode(code: unknown): boolean {
  return code === INSUFFICIENT_CREDITS_CODE;
}

function readOptionalNonNegInt(value: unknown): number | null {
  return isNonNegativeInt(value) ? value : null;
}

/**
 * Map API / start / Auto-ON failures into SoT insufficient UX info.
 * Only trusts server-provided required/balance fields.
 */
export function parseInsufficientCredits(err: unknown): InsufficientCreditsInfo | null {
  if (!(err instanceof ApiError)) return null;
  if (!isInsufficientCreditsCode(err.code)) return null;
  const details = err.details ?? {};
  return {
    code: INSUFFICIENT_CREDITS_CODE,
    message: err.message || CREDIT_BALANCE_UI.insufficientTitle,
    required: readOptionalNonNegInt(details.required ?? details.required_credits),
    balance: readOptionalNonNegInt(details.balance ?? details.current_balance),
  };
}

export function formatInsufficientCreditsMessage(info: InsufficientCreditsInfo): string {
  const parts: string[] = [CREDIT_BALANCE_UI.insufficientTitle];
  if (info.required != null && info.balance != null) {
    parts.push(`Need ${info.required}, have ${info.balance}.`);
  } else if (info.required != null) {
    parts.push(`Need ${info.required}.`);
  } else if (info.message && info.message !== INSUFFICIENT_CREDITS_CODE) {
    parts.push(info.message);
  }
  parts.push(CREDIT_BALANCE_UI.insufficientNext);
  return parts.join(" ");
}

/**
 * GET Soft credit balance for the signed-in account.
 * C1 route: GET /credits/balance
 * If C1 is not on staging yet, returns a stub state (clear tolerance) — no fake math.
 */
export async function fetchCreditBalance(): Promise<CreditBalanceState> {
  try {
    const raw = await api.get<unknown>(CREDIT_BALANCE_PATH);
    const parsed = parseCreditBalanceResponse(raw);
    if (!parsed) {
      return {
        source: "stub",
        balance: null,
        unlimited: false,
        accountId: null,
        reason: "CREDIT_BALANCE_SHAPE_MISMATCH",
      };
    }
    return {
      source: "api",
      balance: parsed.balance,
      unlimited: parsed.unlimited === true,
      accountId: parsed.account_id ?? parsed.actor_id ?? null,
    };
  } catch (err) {
    if (
      err instanceof ApiError &&
      (err.status === 404 || err.status === 501 || err.status === 405)
    ) {
      return {
        source: "stub",
        balance: null,
        unlimited: false,
        accountId: null,
        reason: "CREDIT_BALANCE_API_UNAVAILABLE",
      };
    }
    if (err instanceof ApiError && err.status === 401) {
      return {
        source: "stub",
        balance: null,
        unlimited: false,
        accountId: null,
        reason: "CREDIT_BALANCE_UNAUTHORIZED",
      };
    }
    throw err;
  }
}
