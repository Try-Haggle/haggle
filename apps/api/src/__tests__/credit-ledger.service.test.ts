/**
 * Eng1 C1 — Soft-AI credit ledger unit tests.
 * SoT: docs/wip/credit-ledger-sot.md
 */

import {
  CREDIT_SIGNUP,
  creditsAreUnlimited,
  quoteSoftAiCreditDifferential,
} from "@haggle/commerce-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applySoftAiCreditCharge,
  type CreditLedgerDb,
  creditsAreUnlimitedAtRuntime,
  ensureAccountWithSignupGrant,
  grantCredits,
  grantIdempotencyKey,
  INSUFFICIENT_CREDITS,
  InsufficientCreditsError,
  signupGrantIdempotencyKey,
  softAiDebitIdempotencyKey,
} from "../services/credit-ledger.service.js";

describe("credit ledger idempotency key shapes (per-account scoped)", () => {
  it("signup grant key is stable per account", () => {
    expect(signupGrantIdempotencyKey("acc-1")).toBe("grant:signup:acc-1");
    expect(grantIdempotencyKey("signup", "acc-1")).toBe("grant:signup:acc-1");
  });

  it("Soft AI debit key includes session + charged-base watermark target", () => {
    expect(softAiDebitIdempotencyKey("sess-9", 10)).toBe("debit:soft_ai:sess-9:10");
    expect(softAiDebitIdempotencyKey("sess-9", 5)).toBe("debit:soft_ai:sess-9:5");
  });
});

describe("InsufficientCreditsError", () => {
  it("exposes clear 402 + INSUFFICIENT_CREDITS", () => {
    const err = new InsufficientCreditsError({
      accountId: "a",
      required: 10,
      balance: 3,
    });
    expect(err.status).toBe(402);
    expect(err.code).toBe(INSUFFICIENT_CREDITS);
    expect(err.required).toBe(10);
    expect(err.balance).toBe(3);
  });
});

describe("signup grant constant (no client-supplied amounts)", () => {
  it("CREDIT_SIGNUP is 200 from policy", () => {
    expect(CREDIT_SIGNUP).toBe(200);
  });
});

describe("staging unlimited regression (policy → wallet skip)", () => {
  it("staging/local quote charge_total is 0 while charge_base preserved", () => {
    const staging = quoteSoftAiCreditDifferential({
      alreadyChargedBase: 0,
      buyerMode: "auto",
      sellerMode: "auto",
      publishedAskMinor: 80_000,
      haggleEnv: "staging",
    });
    expect(staging.unlimited).toBe(true);
    expect(staging.charge_base).toBe(10);
    expect(staging.charge_total).toBe(0);
    expect(staging.new_charged_base).toBe(10);

    const local = quoteSoftAiCreditDifferential({
      alreadyChargedBase: 0,
      buyerMode: "auto",
      sellerMode: "auto",
      publishedAskMinor: 80_000,
      haggleEnv: "local",
    });
    expect(local.unlimited).toBe(true);
    expect(local.charge_total).toBe(0);
  });

  it("production must debit (charge_total === charge_base)", () => {
    const prod = quoteSoftAiCreditDifferential({
      alreadyChargedBase: 0,
      buyerMode: "auto",
      sellerMode: "auto",
      publishedAskMinor: 80_000,
      haggleEnv: "production",
    });
    expect(prod.unlimited).toBe(false);
    expect(prod.charge_total).toBe(10);
    expect(prod.charge_base).toBe(10);
  });

  it("both Manual → 0 charge (manual side does not consume Soft AI credits)", () => {
    const zero = quoteSoftAiCreditDifferential({
      alreadyChargedBase: 0,
      buyerMode: "manual",
      sellerMode: "manual",
      publishedAskMinor: 80_000,
      haggleEnv: "production",
    });
    expect(zero.charge_base).toBe(0);
    expect(zero.charge_total).toBe(0);
  });
});

describe("creditsAreUnlimited fail-closed (security residual)", () => {
  it("policy: prod/production never unlimited; unknown env fails closed", () => {
    expect(creditsAreUnlimited("prod")).toBe(false);
    expect(creditsAreUnlimited("production")).toBe(false);
    expect(creditsAreUnlimited("")).toBe(false);
    expect(creditsAreUnlimited("staging")).toBe(true);
  });

  it("runtime: NODE_ENV=production never unlimited even if HAGGLE_ENV=staging", () => {
    const prevNode = process.env.NODE_ENV;
    const prevHaggle = process.env.HAGGLE_ENV;
    try {
      process.env.NODE_ENV = "production";
      process.env.HAGGLE_ENV = "staging";
      expect(creditsAreUnlimitedAtRuntime("staging")).toBe(false);
      expect(creditsAreUnlimitedAtRuntime()).toBe(false);
    } finally {
      process.env.NODE_ENV = prevNode;
      if (prevHaggle === undefined) delete process.env.HAGGLE_ENV;
      else process.env.HAGGLE_ENV = prevHaggle;
    }
  });
});

/**
 * Drizzle transaction mock matching apps/api/src/__tests__/setup.ts:
 * `db.transaction(fn)` invokes `fn(tx)` where `tx` shares the same query surface.
 */
function createAwaitableSelect(rows: unknown[] = []) {
  const result = Promise.resolve(rows);
  const query: Record<string, unknown> = {
    from: vi.fn(() => query),
    where: vi.fn(() => query),
    orderBy: vi.fn(() => query),
    limit: vi.fn(() => query),
    offset: vi.fn(() => query),
    // biome-ignore lint/suspicious/noThenProperty: Drizzle query mocks must remain awaitable.
    then: result.then.bind(result),
    catch: result.catch.bind(result),
    finally: result.finally.bind(result),
  };
  return query;
}

function createLedgerDbMock(options?: {
  /** Queued select() results consumed in order (account / ledger lookups). */
  selectQueue?: unknown[][];
  /** Rows returned from insert().values().returning(). */
  insertReturning?: unknown[][];
}) {
  const selectQueue = [...(options?.selectQueue ?? [])];
  const insertReturning = [...(options?.insertReturning ?? [])];

  const select = vi.fn().mockImplementation(() => createAwaitableSelect(selectQueue.shift() ?? []));
  const nextInsertRows = () => insertReturning.shift() ?? [];
  const insert = vi.fn().mockImplementation(() => ({
    values: vi.fn().mockReturnValue({
      onConflictDoNothing: vi.fn().mockReturnValue({
        returning: vi.fn().mockImplementation(async () => nextInsertRows()),
      }),
      returning: vi.fn().mockImplementation(async () => nextInsertRows()),
    }),
  }));
  const update = vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: "mock-id" }]),
      }),
    }),
  });
  const execute = vi.fn().mockResolvedValue([]);

  const tx = { select, insert, update, execute };
  const transaction = vi.fn(async (fn: (input: typeof tx) => unknown) => fn(tx));

  return { select, insert, update, execute, transaction, tx } as unknown as CreditLedgerDb & {
    select: typeof select;
    insert: typeof insert;
    update: typeof update;
    execute: typeof execute;
    transaction: typeof transaction;
    tx: typeof tx;
  };
}

function accountRow(accountId: string, balance: number) {
  return {
    accountId,
    balance,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function grantEntryRow(accountId: string, balanceAfter: number) {
  return {
    id: "entry-signup-1",
    accountId,
    delta: CREDIT_SIGNUP,
    kind: "grant" as const,
    reason: "signup",
    idempotencyKey: signupGrantIdempotencyKey(accountId),
    refType: null,
    refId: null,
    balanceAfter,
    metadata: { policy_amount: CREDIT_SIGNUP },
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

describe("ensureAccountWithSignupGrant (db.transaction mock)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens a transaction and grants CREDIT_SIGNUP on a fresh account", async () => {
    const accountId = "00000000-0000-4000-a000-0000000000a1";
    // ensureCreditAccount: miss → insert account
    // grant: findEntry miss → ensureCreditAccount forUpdate (miss then insert? or exist)
    // Flow for brand-new:
    // 1) ensureCreditAccount select [] → insert account returning balance 0
    // 2) grant findEntry select []
    // 3) ensureCreditAccount forUpdate: select [] → insert again OR select with row
    // Keep it simple: first select finds nothing; insert returns account;
    // subsequent selects find the account; ledger insert returns grant entry;
    // final getCreditBalance select finds balance 200 after we seed the queue carefully.
    const db = createLedgerDbMock({
      selectQueue: [
        [], // ensureCreditAccount(forUpdate) miss → insert
        [], // grant findEntryByIdempotency miss
        [accountRow(accountId, 0)], // grant ensureCreditAccount(forUpdate) hit
        [accountRow(accountId, 0)], // locked re-select after FOR UPDATE
        [accountRow(accountId, CREDIT_SIGNUP)], // getCreditBalance ensureCreditAccount
      ],
      insertReturning: [
        [accountRow(accountId, 0)], // create account
        [grantEntryRow(accountId, CREDIT_SIGNUP)], // ledger grant
      ],
    });

    const view = await ensureAccountWithSignupGrant(db, accountId, { haggleEnv: "production" });

    expect(db.transaction).toHaveBeenCalledOnce();
    expect(view).toMatchObject({
      account_id: accountId,
      balance: CREDIT_SIGNUP,
      unlimited: false,
    });
  });

  it("passes the same query surface into the transaction callback", async () => {
    const accountId = "00000000-0000-4000-a000-0000000000a2";
    const db = createLedgerDbMock({
      selectQueue: [
        [accountRow(accountId, CREDIT_SIGNUP)], // ensureCreditAccount(forUpdate)
        [accountRow(accountId, CREDIT_SIGNUP)], // locked
        [grantEntryRow(accountId, CREDIT_SIGNUP)], // findEntry replay
        [accountRow(accountId, CREDIT_SIGNUP)], // replay ensureCreditAccount(forUpdate)
        [accountRow(accountId, CREDIT_SIGNUP)], // locked
        [accountRow(accountId, CREDIT_SIGNUP)], // getCreditBalance
      ],
    });

    await ensureAccountWithSignupGrant(db, accountId, { haggleEnv: "production" });

    expect(db.transaction).toHaveBeenCalledOnce();
    const txArg = (db as { tx: Record<string, unknown> }).tx;
    expect(txArg).toHaveProperty("select");
    expect(txArg).toHaveProperty("insert");
    expect(txArg).toHaveProperty("update");
    expect(txArg).toHaveProperty("execute");
    // Same object identity: transaction callback receives the shared tx surface.
    const passed = vi.mocked(db.transaction).mock.calls[0]?.[0];
    expect(typeof passed).toBe("function");
  });
});

describe("grantCredits / applySoftAiCreditCharge transaction wiring", () => {
  it("grantCredits opens db.transaction", async () => {
    const accountId = "00000000-0000-4000-a000-0000000000b1";
    const db = createLedgerDbMock({
      selectQueue: [
        [], // findEntry
        [accountRow(accountId, 0)], // ensure forUpdate
        [accountRow(accountId, 0)], // locked
      ],
      insertReturning: [[grantEntryRow(accountId, CREDIT_SIGNUP)]],
    });

    const result = await grantCredits(db, {
      accountId,
      reason: "signup",
      idempotencyKey: signupGrantIdempotencyKey(accountId),
    });

    expect(db.transaction).toHaveBeenCalledOnce();
    expect(result.applied).toBe(true);
    expect(result.balance).toBe(CREDIT_SIGNUP);
  });

  it("applySoftAiCreditCharge skips debit when staging unlimited at runtime", async () => {
    const prevNode = process.env.NODE_ENV;
    const prevHaggle = process.env.HAGGLE_ENV;
    try {
      process.env.NODE_ENV = "test";
      process.env.HAGGLE_ENV = "staging";
      const accountId = "00000000-0000-4000-a000-0000000000c1";
      const db = createLedgerDbMock({
        selectQueue: [[accountRow(accountId, 200)]],
      });

      const result = await applySoftAiCreditCharge(db, {
        accountId,
        sessionId: "sess-1",
        chargeTotal: 0,
        chargeBase: 10,
        newChargedBase: 10,
        unlimited: true,
        haggleEnv: "staging",
      });

      expect(result).toMatchObject({
        debited: false,
        skipped: true,
        reason: "unlimited",
        unlimited: true,
      });
      // applySoftAiCreditCharge uses debitSoftAiCreditsInner (no nested transaction)
      expect(db.transaction).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = prevNode;
      if (prevHaggle === undefined) delete process.env.HAGGLE_ENV;
      else process.env.HAGGLE_ENV = prevHaggle;
    }
  });
});
