/**
 * Soft-AI credit ledger wallet (Eng1 C1).
 *
 * Consumes policy quotes from @haggle/commerce-core — does not invent amounts.
 * trust-ledger* is NOT this wallet.
 * SoT: docs/wip/credit-ledger-sot.md
 */

import {
  attendanceGrantAmount,
  CREDIT_GRANTS,
  type CreditGrantReason,
  creditGrantAmount,
  creditsAreUnlimited,
} from "@haggle/commerce-core";
import { and, creditAccounts, creditLedgerEntries, type Database, eq, sql } from "@haggle/db";

export const INSUFFICIENT_CREDITS = "INSUFFICIENT_CREDITS" as const;

export class InsufficientCreditsError extends Error {
  readonly code = INSUFFICIENT_CREDITS;
  readonly status = 402 as const;
  readonly accountId: string;
  readonly required: number;
  readonly balance: number;

  constructor(input: { accountId: string; required: number; balance: number }) {
    super(`Insufficient Soft AI credits: need ${input.required}, balance ${input.balance}`);
    this.name = "InsufficientCreditsError";
    this.accountId = input.accountId;
    this.required = input.required;
    this.balance = input.balance;
  }
}

export type CreditLedgerDb = Pick<
  Database,
  "insert" | "select" | "update" | "execute" | "transaction"
>;

export type CreditAccountView = {
  account_id: string;
  balance: number;
  unlimited: boolean;
};

export type CreditLedgerEntryView = {
  id: string;
  account_id: string;
  delta: number;
  kind: "grant" | "debit";
  reason: string;
  idempotency_key: string;
  ref_type: string | null;
  ref_id: string | null;
  balance_after: number;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

function mapEntry(row: typeof creditLedgerEntries.$inferSelect): CreditLedgerEntryView {
  return {
    id: row.id,
    account_id: row.accountId,
    delta: row.delta,
    kind: row.kind,
    reason: row.reason,
    idempotency_key: row.idempotencyKey,
    ref_type: row.refType ?? null,
    ref_id: row.refId ?? null,
    balance_after: row.balanceAfter,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    created_at: row.createdAt.toISOString(),
  };
}

export function softAiDebitIdempotencyKey(sessionId: string, chargedBaseTarget: number): string {
  return `debit:soft_ai:${sessionId}:${chargedBaseTarget}`;
}

export function signupGrantIdempotencyKey(accountId: string): string {
  return `grant:signup:${accountId}`;
}

export function grantIdempotencyKey(
  reason: CreditGrantReason,
  accountId: string,
  suffix?: string,
): string {
  if (reason === "signup") return signupGrantIdempotencyKey(accountId);
  if (suffix) return `grant:${reason}:${accountId}:${suffix}`;
  return `grant:${reason}:${accountId}`;
}

/** Resolve env for unlimited checks — prefer explicit arg, else process env. */
export function resolveHaggleEnv(haggleEnv?: string): string | undefined {
  return haggleEnv ?? process.env.HAGGLE_ENV;
}

/**
 * Fail-closed unlimited gate for the wallet (security residual).
 * Production Node must always debit even if HAGGLE_ENV is mis-set to staging/local.
 * Policy quotes may still report unlimited flags; the ledger does not fail-open.
 */
export function creditsAreUnlimitedAtRuntime(haggleEnv?: string): boolean {
  const nodeEnv = (process.env.NODE_ENV ?? "").trim().toLowerCase();
  if (nodeEnv === "production") return false;
  return creditsAreUnlimited(resolveHaggleEnv(haggleEnv));
}

/**
 * Ensure credit account row exists. Does not grant.
 * Locks the account row when `forUpdate` (call inside a transaction).
 */
export async function ensureCreditAccount(
  db: CreditLedgerDb,
  accountId: string,
  opts?: { forUpdate?: boolean },
): Promise<{ accountId: string; balance: number; created: boolean }> {
  const existing = await db
    .select()
    .from(creditAccounts)
    .where(eq(creditAccounts.accountId, accountId))
    .limit(1);
  if (existing[0]) {
    if (opts?.forUpdate) {
      await db.execute(
        sql`SELECT account_id FROM credit_accounts WHERE account_id = ${accountId}::uuid FOR UPDATE`,
      );
      const locked = await db
        .select()
        .from(creditAccounts)
        .where(eq(creditAccounts.accountId, accountId))
        .limit(1);
      return {
        accountId,
        balance: locked[0]?.balance ?? existing[0].balance,
        created: false,
      };
    }
    return { accountId, balance: existing[0].balance, created: false };
  }

  try {
    const [row] = await db.insert(creditAccounts).values({ accountId, balance: 0 }).returning();
    if (opts?.forUpdate) {
      await db.execute(
        sql`SELECT account_id FROM credit_accounts WHERE account_id = ${accountId}::uuid FOR UPDATE`,
      );
    }
    return { accountId, balance: row?.balance ?? 0, created: true };
  } catch {
    // Concurrent create — re-read
    if (opts?.forUpdate) {
      await db.execute(
        sql`SELECT account_id FROM credit_accounts WHERE account_id = ${accountId}::uuid FOR UPDATE`,
      );
    }
    const again = await db
      .select()
      .from(creditAccounts)
      .where(eq(creditAccounts.accountId, accountId))
      .limit(1);
    if (!again[0]) throw new Error(`credit account missing after race: ${accountId}`);
    return { accountId, balance: again[0].balance, created: false };
  }
}

/**
 * First-account signup grant (CREDIT_SIGNUP=200). Amount from policy only —
 * never accept client-supplied grant amounts (security residual).
 */
export async function ensureAccountWithSignupGrant(
  db: CreditLedgerDb,
  accountId: string,
  opts?: { haggleEnv?: string },
): Promise<CreditAccountView> {
  return db.transaction(async (tx) => {
    const txDb = tx as unknown as CreditLedgerDb;
    await ensureCreditAccount(txDb, accountId, { forUpdate: true });
    await grantCreditsInner(txDb, {
      accountId,
      reason: "signup",
      idempotencyKey: signupGrantIdempotencyKey(accountId),
    });
    return getCreditBalance(txDb, accountId, opts);
  });
}

export async function getCreditBalance(
  db: CreditLedgerDb,
  accountId: string,
  opts?: { haggleEnv?: string },
): Promise<CreditAccountView> {
  const account = await ensureCreditAccount(db, accountId);
  return {
    account_id: account.accountId,
    balance: account.balance,
    unlimited: creditsAreUnlimitedAtRuntime(opts?.haggleEnv),
  };
}

type AppendResult =
  | { applied: true; entry: CreditLedgerEntryView; balance: number }
  | { applied: false; entry: CreditLedgerEntryView; balance: number; replayed: true };

async function findEntryByIdempotency(
  db: CreditLedgerDb,
  accountId: string,
  idempotencyKey: string,
): Promise<CreditLedgerEntryView | null> {
  const rows = await db
    .select()
    .from(creditLedgerEntries)
    .where(
      and(
        eq(creditLedgerEntries.accountId, accountId),
        eq(creditLedgerEntries.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  return rows[0] ? mapEntry(rows[0]) : null;
}

/**
 * Server-side grant. Amount comes from CREDIT_GRANTS / attendance helper only.
 * Rejects any caller-supplied amount field by not accepting one.
 */
type GrantCreditsInput = {
  accountId: string;
  reason: CreditGrantReason;
  idempotencyKey: string;
  /** Attendance streak including today — only for attendance_daily. */
  consecutiveDays?: number;
  refType?: string;
  refId?: string;
  metadata?: Record<string, unknown>;
};

async function grantCreditsInner(
  db: CreditLedgerDb,
  input: GrantCreditsInput,
): Promise<AppendResult> {
  const amount =
    input.reason === "attendance_daily"
      ? attendanceGrantAmount(input.consecutiveDays ?? 1)
      : creditGrantAmount(input.reason);

  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error(`invalid grant amount for reason ${input.reason}`);
  }
  // Defense in depth: amount must match the known policy table for non-attendance.
  if (input.reason !== "attendance_daily" && amount !== CREDIT_GRANTS[input.reason]) {
    throw new Error(`grant amount drifted from CREDIT_GRANTS for ${input.reason}`);
  }

  const prior = await findEntryByIdempotency(db, input.accountId, input.idempotencyKey);
  if (prior) {
    const bal = await ensureCreditAccount(db, input.accountId, { forUpdate: true });
    return { applied: false, entry: prior, balance: bal.balance, replayed: true };
  }

  const account = await ensureCreditAccount(db, input.accountId, { forUpdate: true });
  const nextBalance = account.balance + amount;
  const [entry] = await db
    .insert(creditLedgerEntries)
    .values({
      accountId: input.accountId,
      delta: amount,
      kind: "grant",
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
      refType: input.refType,
      refId: input.refId,
      balanceAfter: nextBalance,
      metadata: input.metadata ?? { policy_amount: amount },
    })
    .returning();

  await db
    .update(creditAccounts)
    .set({ balance: nextBalance, updatedAt: new Date() })
    .where(eq(creditAccounts.accountId, input.accountId));

  return {
    applied: true,
    entry: mapEntry(entry!),
    balance: nextBalance,
  };
}

/**
 * Server-side grant. Amount comes from CREDIT_GRANTS / attendance helper only.
 * Rejects any caller-supplied amount field by not accepting one.
 * Opens a transaction when called on a root db; pass an existing tx via
 * `grantCreditsInner` paths (ensureAccountWithSignupGrant / apply*).
 */
export async function grantCredits(
  db: CreditLedgerDb,
  input: GrantCreditsInput,
): Promise<AppendResult> {
  return db.transaction(async (tx) => grantCreditsInner(tx as unknown as CreditLedgerDb, input));
}

export type SoftAiDebitInput = {
  accountId: string;
  /** Absolute Soft-AI credits to debit (policy charge_total when debiting). */
  amount: number;
  idempotencyKey: string;
  sessionId: string;
  /** Policy watermark after this charge (new_charged_base). */
  chargedBaseTarget: number;
  haggleEnv?: string;
  metadata?: Record<string, unknown>;
};

export type SoftAiDebitResult =
  | {
      debited: false;
      skipped: true;
      reason: "unlimited" | "zero_charge";
      balance: number;
      unlimited: boolean;
    }
  | {
      debited: true;
      applied: boolean;
      replayed?: boolean;
      entry: CreditLedgerEntryView;
      balance: number;
      unlimited: false;
    };

/**
 * Debit Soft AI credits when !creditsAreUnlimited().
 * Staging/local unlimited → skip balance check & debit (keep policy flags upstream).
 * Production must debit (fail-closed via creditsAreUnlimited).
 */
async function debitSoftAiCreditsInner(
  db: CreditLedgerDb,
  input: SoftAiDebitInput,
): Promise<SoftAiDebitResult> {
  const unlimited = creditsAreUnlimitedAtRuntime(input.haggleEnv);
  const amount = Math.max(0, Math.floor(input.amount));

  if (unlimited) {
    const account = await ensureCreditAccount(db, input.accountId);
    return {
      debited: false,
      skipped: true,
      reason: "unlimited",
      balance: account.balance,
      unlimited: true,
    };
  }

  if (amount === 0) {
    const account = await ensureCreditAccount(db, input.accountId);
    return {
      debited: false,
      skipped: true,
      reason: "zero_charge",
      balance: account.balance,
      unlimited: false,
    };
  }

  const prior = await findEntryByIdempotency(db, input.accountId, input.idempotencyKey);
  if (prior) {
    const bal = await ensureCreditAccount(db, input.accountId, { forUpdate: true });
    return {
      debited: true,
      applied: false,
      replayed: true,
      entry: prior,
      balance: bal.balance,
      unlimited: false as const,
    };
  }

  const account = await ensureCreditAccount(db, input.accountId, { forUpdate: true });
  if (account.balance < amount) {
    throw new InsufficientCreditsError({
      accountId: input.accountId,
      required: amount,
      balance: account.balance,
    });
  }

  const nextBalance = account.balance - amount;
  const [entry] = await db
    .insert(creditLedgerEntries)
    .values({
      accountId: input.accountId,
      delta: -amount,
      kind: "debit",
      reason: "soft_ai",
      idempotencyKey: input.idempotencyKey,
      refType: "negotiation_session",
      refId: input.sessionId,
      balanceAfter: nextBalance,
      metadata: {
        charged_base_target: input.chargedBaseTarget,
        ...(input.metadata ?? {}),
      },
    })
    .returning();

  await db
    .update(creditAccounts)
    .set({ balance: nextBalance, updatedAt: new Date() })
    .where(eq(creditAccounts.accountId, input.accountId));

  return {
    debited: true,
    applied: true,
    entry: mapEntry(entry!),
    balance: nextBalance,
    unlimited: false as const,
  };
}

/**
 * Debit Soft AI credits when !creditsAreUnlimited().
 * Staging/local unlimited → skip balance check & debit (keep policy flags upstream).
 * Production must debit (fail-closed via creditsAreUnlimited).
 * Prefer applySoftAiCreditCharge inside an existing session lock transaction.
 */
export async function debitSoftAiCredits(
  db: CreditLedgerDb,
  input: SoftAiDebitInput,
): Promise<SoftAiDebitResult> {
  return db.transaction(async (tx) =>
    debitSoftAiCreditsInner(tx as unknown as CreditLedgerDb, input),
  );
}

/**
 * Apply Soft AI policy differential to the wallet.
 * Uses charge_total from quoteSoftAiCreditDifferential (0 when unlimited).
 * Manual / both Manual → 0; Auto OFF → no refund (caller does not credit back).
 */
export async function applySoftAiCreditCharge(
  db: CreditLedgerDb,
  input: {
    accountId: string;
    sessionId: string;
    chargeTotal: number;
    chargeBase: number;
    newChargedBase: number;
    unlimited: boolean;
    haggleEnv?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<SoftAiDebitResult> {
  // Defense: never trust a client unlimited flag — re-check runtime env.
  // Fail-closed: if Node is production, debit charge_base even when policy
  // charge_total was zeroed under a misconfigured HAGGLE_ENV=staging.
  const unlimited = creditsAreUnlimitedAtRuntime(input.haggleEnv);
  const amount = unlimited
    ? 0
    : Math.max(0, Math.floor(input.chargeBase > 0 ? input.chargeBase : input.chargeTotal));
  return debitSoftAiCreditsInner(db, {
    accountId: input.accountId,
    amount,
    idempotencyKey: softAiDebitIdempotencyKey(input.sessionId, input.newChargedBase),
    sessionId: input.sessionId,
    chargedBaseTarget: input.newChargedBase,
    haggleEnv: input.haggleEnv,
    metadata: {
      charge_base: input.chargeBase,
      policy_unlimited_flag: input.unlimited,
      ...input.metadata,
    },
  });
}
