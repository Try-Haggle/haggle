/**
 * Soft Manual vs auto-play claim race (SoT §3 handoff, §12).
 *
 * In-memory negotiation_sessions row. `transaction()` callbacks run under a
 * mutex so they emulate `SELECT ... FOR UPDATE`. `tx.execute` returns the
 * snake_case row. `update().set().where().returning()` ignores the drizzle
 * where-expression and applies the patch only when `set.version - 1` equals
 * the stored version (every control-mode write sets version to locked+1 and
 * guards on the previous version).
 */

import { CREDIT_PRO_GAME, CREDIT_PRO_HALF } from "@haggle/commerce-core";
import { creditAccounts, creditLedgerEntries, type Database } from "@haggle/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildHostHnpOfferEnvelope, wrapPriceOnlyAsHostEnvelope } from "../hnp/host-envelope.js";
import { normalizeSubmitOffer } from "../hnp/normalize-offer.js";
import { submitHnpOffer } from "../hnp/submit-offer.js";
import { getExecutor } from "../lib/executor-factory.js";
import {
  claimSoftAiInflightUnderLock,
  setPartyControlMode,
} from "../services/control-mode.service.js";
import { applySoftAiCreditCharge } from "../services/credit-ledger.service.js";
import { executeAutoPlayNext } from "../services/execute-auto-play-next.service.js";
import { createNegotiationAutoPlaySetup } from "../services/negotiation-auto-play.service.js";
import { getRoundsBySessionId } from "../services/negotiation-round.service.js";

vi.mock("../services/credit-ledger.service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/credit-ledger.service.js")>();
  return {
    ...actual,
    applySoftAiCreditCharge: vi.fn(actual.applySoftAiCreditCharge),
  };
});

vi.mock("../hnp/submit-offer.js", () => ({
  submitHnpOffer: vi.fn(async () => ({
    ok: true,
    idempotent: false,
    roundId: "round-1",
    roundNo: 1,
    decision: "COUNTER",
    counterPrice: 9_000,
    sessionStatus: "ACTIVE",
    utility: {},
  })),
}));

const { mockExecutePipeline, mockGetRoundByIdempotencyKey } = vi.hoisted(() => ({
  mockExecutePipeline: vi.fn(),
  mockGetRoundByIdempotencyKey: vi.fn(async (..._args: unknown[]) => null as unknown),
}));

vi.mock("../negotiation/pipeline/pipeline.js", () => ({
  executePipeline: mockExecutePipeline,
}));

vi.mock("../services/hnp-ingress.service.js", () => ({
  validateHnpIngress: vi.fn(async () => ({ ok: true })),
}));

vi.mock("../services/negotiation-round.service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/negotiation-round.service.js")>();
  return {
    ...actual,
    getRoundsBySessionId: vi.fn(async () => []),
    getRoundByIdempotencyKey: (db: unknown, sessionId: unknown, key: unknown) =>
      mockGetRoundByIdempotencyKey(db, sessionId, key),
  };
});

const BUYER_ID = "00000000-0000-4000-a000-000000000010";
const SELLER_ID = "00000000-0000-4000-a000-000000000020";
const SESSION_ID = "00000000-0000-4000-a000-0000000000aa";
const ORIGINAL_HAGGLE_ENV = process.env.HAGGLE_ENV;
const DRIZZLE_NAME = Symbol.for("drizzle:Name");
const SEEDED_CREDIT_BALANCE = 200;

type Party = "buyer" | "seller";
type Mode = "auto" | "manual";

type SessionRow = {
  id: string;
  buyerId: string;
  sellerId: string;
  status: string;
  version: number;
  buyerControlMode: Mode;
  sellerControlMode: Mode;
  buyerPendingControlMode: Mode | null;
  sellerPendingControlMode: Mode | null;
  softAiInflightParty: Party | null;
  buyerSoftAiCreditsCharged: number;
  sellerManualSince: Date | null;
  sellerManualTimeoutPhase: "first" | "later" | null;
  negotiationAgentSnapshot: Record<string, unknown>;
  driver: "web" | "mcp";
  currentRound: number;
  role: "BUYER" | "SELLER";
  updatedAt: Date;
  expiresAt: Date | null;
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function cloneRow(row: SessionRow): SessionRow {
  return {
    ...row,
    sellerManualSince: row.sellerManualSince ? new Date(row.sellerManualSince.getTime()) : null,
    updatedAt: new Date(row.updatedAt.getTime()),
    expiresAt: row.expiresAt ? new Date(row.expiresAt.getTime()) : null,
    negotiationAgentSnapshot: structuredClone(row.negotiationAgentSnapshot),
  };
}

function toSnake(row: SessionRow): Record<string, unknown> {
  return {
    id: row.id,
    buyer_id: row.buyerId,
    seller_id: row.sellerId,
    status: row.status,
    version: row.version,
    buyer_control_mode: row.buyerControlMode,
    seller_control_mode: row.sellerControlMode,
    buyer_pending_control_mode: row.buyerPendingControlMode,
    seller_pending_control_mode: row.sellerPendingControlMode,
    soft_ai_inflight_party: row.softAiInflightParty,
    buyer_soft_ai_credits_charged: row.buyerSoftAiCreditsCharged,
    seller_manual_since: row.sellerManualSince ? row.sellerManualSince.toISOString() : null,
    seller_manual_timeout_phase: row.sellerManualTimeoutPhase,
    negotiation_agent_snapshot: row.negotiationAgentSnapshot,
    driver: row.driver,
    role: row.role,
    current_round: row.currentRound,
    rounds_no_concession: 0,
    last_offer_price_minor: null,
    listing_id: "listing-1",
    counterparty_id: row.sellerId,
    created_at: row.updatedAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    expires_at: row.expiresAt ? row.expiresAt.toISOString() : null,
    group_id: null,
    intent_id: null,
    strategy_id: "default",
  };
}

function makeRow(overrides?: Partial<SessionRow>): SessionRow {
  const setup = createNegotiationAutoPlaySetup({
    buyerSnapshot: { side: "buyer" },
    sellerSnapshot: { side: "seller" },
    buyerTargetMinor: 9_000,
    maxRounds: 8,
  });
  return {
    id: SESSION_ID,
    buyerId: BUYER_ID,
    sellerId: SELLER_ID,
    status: "ACTIVE",
    version: 1,
    buyerControlMode: "auto",
    sellerControlMode: "auto",
    buyerPendingControlMode: null,
    sellerPendingControlMode: null,
    softAiInflightParty: null,
    buyerSoftAiCreditsCharged: 10,
    sellerManualSince: null,
    sellerManualTimeoutPhase: null,
    negotiationAgentSnapshot: {
      ...setup.buyerSnapshot,
      listing_context: { published_ask_minor: 80_000 },
    },
    driver: "web",
    currentRound: 0,
    role: "BUYER",
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    expiresAt: null,
    ...overrides,
  };
}

type SelectWait = {
  gate: Promise<void>;
  markStarted: () => void;
  /** When true, return the row snapshotted before `gate` (stale unlocked read). */
  stale: boolean;
};

type CreditAccountRow = {
  accountId: string;
  balance: number;
  createdAt: Date;
  updatedAt: Date;
};

type CreditLedgerRow = {
  id: string;
  accountId: string;
  delta: number;
  kind: "grant" | "debit";
  reason: string;
  idempotencyKey: string;
  refType: string | null;
  refId: string | null;
  balanceAfter: number;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
};

type TableInsert = { table: string; row: Record<string, unknown> };

type RoundRow = {
  id: string;
  sessionId: string;
  roundNo: number;
  senderRole: "BUYER" | "SELLER";
  messageType: string;
  priceminor: string;
  counterPriceMinor: string | null;
  decision: string | null;
  metadata: Record<string, unknown> | null;
  idempotencyKey: string;
  message: string | null;
  utility: unknown;
  createdAt: Date;
};

function roundMatches(round: RoundRow, whereClause: unknown): boolean {
  const pairs: EqPair[] = [];
  collectEqPairs(whereClause, pairs);
  for (const pair of pairs) {
    if (
      (pair.column === "session_id" || pair.column === "sessionId") &&
      pair.value !== round.sessionId
    ) {
      return false;
    }
    if (
      (pair.column === "idempotency_key" || pair.column === "idempotencyKey") &&
      pair.value !== round.idempotencyKey
    ) {
      return false;
    }
  }
  return true;
}

function tableNameOf(table: unknown): string {
  if (table === creditAccounts) return "credit_accounts";
  if (table === creditLedgerEntries) return "credit_ledger_entries";
  if (table && typeof table === "object" && "roundNo" in table && "senderRole" in table) {
    return "negotiation_rounds";
  }
  if (!table || typeof table !== "object") return "negotiation_sessions";
  const direct = (table as Record<symbol, unknown>)[DRIZZLE_NAME];
  if (typeof direct === "string" && direct.length > 0) return direct;
  const seen = new Set<object>();
  let current: object | null = table;
  while (current && !seen.has(current)) {
    seen.add(current);
    for (const sym of Object.getOwnPropertySymbols(current)) {
      const value = (current as Record<symbol, unknown>)[sym];
      if (
        value === "credit_accounts" ||
        value === "credit_ledger_entries" ||
        value === "negotiation_sessions" ||
        value === "negotiation_rounds"
      ) {
        return value;
      }
    }
    current = Object.getPrototypeOf(current);
  }
  return "negotiation_sessions";
}

function inferInsertTable(table: unknown, rows: Record<string, unknown>[]): string {
  const named = tableNameOf(table);
  if (named !== "negotiation_sessions") return named;
  const sample = rows[0];
  if (!sample) return named;
  if ("roundNo" in sample && "senderRole" in sample) return "negotiation_rounds";
  if ("idempotencyKey" in sample || "delta" in sample) return "credit_ledger_entries";
  if ("accountId" in sample && "balance" in sample && !("version" in sample)) {
    return "credit_accounts";
  }
  return named;
}

function sqlText(node: unknown, seen = new Set<unknown>()): string {
  if (!node || typeof node !== "object" || seen.has(node)) return "";
  seen.add(node);
  const rec = node as { value?: unknown; queryChunks?: unknown[] };
  if (Array.isArray(rec.value) && rec.value.every((part) => typeof part === "string")) {
    return rec.value.join("");
  }
  if (Array.isArray(rec.queryChunks)) {
    return rec.queryChunks.map((chunk) => sqlText(chunk, seen)).join("");
  }
  return "";
}

type EqPair = { column: string; value: unknown };

function collectEqPairs(node: unknown, out: EqPair[], seen = new Set<unknown>()) {
  if (!node || typeof node !== "object" || seen.has(node)) return;
  seen.add(node);
  const chunks = (node as { queryChunks?: unknown[] }).queryChunks;
  if (!Array.isArray(chunks)) return;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i] as {
      name?: unknown;
      keyAsName?: unknown;
      table?: unknown;
      value?: unknown;
      encoder?: unknown;
      queryChunks?: unknown[];
    };
    if (
      chunk &&
      typeof chunk === "object" &&
      chunk.table &&
      (typeof chunk.name === "string" || typeof chunk.keyAsName === "string")
    ) {
      const column = typeof chunk.name === "string" ? chunk.name : String(chunk.keyAsName);
      for (let j = i + 1; j < chunks.length; j++) {
        const next = chunks[j] as { value?: unknown; encoder?: unknown; queryChunks?: unknown[] };
        if (!next || typeof next !== "object") continue;
        if (Array.isArray(next.queryChunks)) break;
        if ("encoder" in next && "value" in next) {
          out.push({ column, value: next.value });
          if (typeof chunk.keyAsName === "string" && chunk.keyAsName !== column) {
            out.push({ column: chunk.keyAsName, value: next.value });
          }
          break;
        }
      }
    }
    collectEqPairs(chunk, out, seen);
  }
}

function eqValue(whereClause: unknown, ...columns: string[]): unknown {
  const pairs: EqPair[] = [];
  collectEqPairs(whereClause, pairs);
  return pairs.find((pair) => columns.includes(pair.column))?.value;
}

function createFakeDb(initial: SessionRow) {
  const state: {
    row: SessionRow | null;
    updates: Record<string, unknown>[];
    queued: number;
    selectWait: SelectWait | null;
    holdNext: { gate: Promise<void>; markStarted: () => void } | null;
    accounts: CreditAccountRow[];
    ledger: CreditLedgerRow[];
    inserts: TableInsert[];
    rounds: RoundRow[];
  } = {
    row: initial,
    updates: [],
    queued: 0,
    selectWait: null,
    holdNext: null,
    accounts: [
      {
        accountId: initial.buyerId,
        balance: SEEDED_CREDIT_BALANCE,
        createdAt: new Date("2026-09-01T00:00:00.000Z"),
        updatedAt: new Date("2026-09-01T00:00:00.000Z"),
      },
    ],
    ledger: [],
    inserts: [],
    rounds: [],
  };

  let tail: Promise<void> = Promise.resolve();

  async function readSelect(): Promise<SessionRow[]> {
    const wait = state.selectWait;
    if (wait && state.row) {
      state.selectWait = null;
      const snap = cloneRow(state.row);
      wait.markStarted();
      await wait.gate;
      const chosen = wait.stale ? snap : state.row ? cloneRow(state.row) : null;
      return chosen ? [chosen] : [];
    }
    return state.row ? [cloneRow(state.row)] : [];
  }

  function select() {
    let tableName = "negotiation_sessions";
    let whereClause: unknown;
    let pending: Promise<unknown[]> | null = null;
    const run = () => {
      const pairs: EqPair[] = [];
      collectEqPairs(whereClause, pairs);
      const mentionsLedger = pairs.some(
        (pair) => pair.column === "idempotency_key" || pair.column === "idempotencyKey",
      );
      const mentionsAccount = pairs.some(
        (pair) => pair.column === "account_id" || pair.column === "accountId",
      );
      const resolved =
        tableName === "credit_ledger_entries" || mentionsLedger
          ? "credit_ledger_entries"
          : tableName === "credit_accounts" || mentionsAccount
            ? "credit_accounts"
            : tableName;
      if (resolved === "credit_accounts") {
        const accountId = eqValue(whereClause, "account_id", "accountId");
        const rows = state.accounts.filter(
          (account) => accountId === undefined || account.accountId === accountId,
        );
        return Promise.resolve(rows.map((account) => ({ ...account })));
      }
      if (tableName === "negotiation_rounds") {
        const rows = state.rounds
          .filter((round) => roundMatches(round, whereClause))
          .sort((a, b) => a.roundNo - b.roundNo);
        return Promise.resolve(
          rows.map((round) => ({
            ...round,
            metadata: round.metadata ? { ...round.metadata } : null,
            createdAt: new Date(round.createdAt.getTime()),
          })),
        );
      }
      if (resolved === "credit_ledger_entries") {
        const accountId = eqValue(whereClause, "account_id", "accountId");
        const idempotencyKey = eqValue(whereClause, "idempotency_key", "idempotencyKey");
        const rows = state.ledger.filter(
          (entry) =>
            (accountId === undefined || entry.accountId === accountId) &&
            (idempotencyKey === undefined || entry.idempotencyKey === idempotencyKey),
        );
        return Promise.resolve(
          rows.map((entry) => ({
            ...entry,
            createdAt: entry.createdAt ?? new Date(0),
            metadata: entry.metadata ? { ...entry.metadata } : null,
          })),
        );
      }
      return readSelect();
    };
    const query = {
      from(table: unknown) {
        tableName = tableNameOf(table);
        return query;
      },
      where(clause: unknown) {
        whereClause = clause;
        return query;
      },
      limit() {
        return query;
      },
      orderBy() {
        return query;
      },
      offset() {
        return query;
      },
      // biome-ignore lint/suspicious/noThenProperty: Drizzle query mocks must remain awaitable.
      then(onFulfilled?: (value: unknown[]) => unknown, onRejected?: (reason: unknown) => unknown) {
        pending ??= run();
        return pending.then(onFulfilled, onRejected);
      },
      catch(onRejected?: (reason: unknown) => unknown) {
        pending ??= run();
        return pending.catch(onRejected);
      },
      finally(onFinally?: () => void) {
        pending ??= run();
        return pending.finally(onFinally);
      },
    };
    return query;
  }

  function updateSession() {
    let patch: Record<string, unknown> | null = null;
    const apply = () => {
      if (!state.row || !patch) return [];
      // Ignore the where-expression. Version match is `set.version - 1`.
      if (typeof patch.version === "number" && patch.version - 1 !== state.row.version) {
        return [];
      }
      const next = { ...state.row, ...patch } as SessionRow;
      state.row = next;
      state.updates.push({ ...patch });
      return [cloneRow(next)];
    };
    const chain = {
      set(values: Record<string, unknown>) {
        patch = values;
        return chain;
      },
      where() {
        return chain;
      },
      returning() {
        return Promise.resolve(apply());
      },
    };
    return chain;
  }

  function updateCreditAccount() {
    let patch: Record<string, unknown> | null = null;
    let whereClause: unknown;
    let applied = false;
    let result: CreditAccountRow[] = [];
    const apply = () => {
      if (applied) return result;
      applied = true;
      const accountId = eqValue(whereClause, "account_id", "accountId");
      const account = state.accounts.find((row) => row.accountId === accountId);
      if (!account || !patch) {
        result = [];
        return result;
      }
      if (typeof patch.balance === "number") account.balance = patch.balance;
      if (patch.updatedAt instanceof Date) account.updatedAt = patch.updatedAt;
      result = [{ ...account }];
      return result;
    };
    const chain = {
      set(values: Record<string, unknown>) {
        patch = values;
        return chain;
      },
      where(clause: unknown) {
        whereClause = clause;
        return chain;
      },
      returning() {
        return Promise.resolve(apply());
      },
      // biome-ignore lint/suspicious/noThenProperty: credit balance updates are awaited without returning().
      then(
        onFulfilled?: (value: CreditAccountRow[]) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) {
        return Promise.resolve(apply()).then(onFulfilled, onRejected);
      },
    };
    return chain;
  }

  function update(table?: unknown) {
    if (tableNameOf(table) === "credit_accounts") return updateCreditAccount();
    return updateSession();
  }

  function insert(table?: unknown) {
    return {
      values(raw: Record<string, unknown> | Record<string, unknown>[]) {
        const rows = Array.isArray(raw) ? raw : [raw];
        const tableName = inferInsertTable(table, rows);
        const materialize = () => {
          const inserted: Record<string, unknown>[] = [];
          for (const values of rows) {
            if (tableName === "credit_accounts") {
              const account: CreditAccountRow = {
                accountId: String(values.accountId),
                balance: Number(values.balance ?? 0),
                createdAt: values.createdAt instanceof Date ? values.createdAt : new Date(),
                updatedAt: values.updatedAt instanceof Date ? values.updatedAt : new Date(),
              };
              state.accounts.push(account);
              state.inserts.push({ table: tableName, row: { ...account } });
              inserted.push(account);
            } else if (tableName === "credit_ledger_entries") {
              const entry: CreditLedgerRow = {
                id: typeof values.id === "string" ? values.id : crypto.randomUUID(),
                accountId: String(values.accountId),
                delta: Number(values.delta),
                kind: values.kind === "grant" ? "grant" : "debit",
                reason: String(values.reason),
                idempotencyKey: String(values.idempotencyKey),
                refType: typeof values.refType === "string" ? values.refType : null,
                refId: typeof values.refId === "string" ? values.refId : null,
                balanceAfter: Number(values.balanceAfter),
                metadata:
                  values.metadata && typeof values.metadata === "object"
                    ? (values.metadata as Record<string, unknown>)
                    : null,
                createdAt: values.createdAt instanceof Date ? values.createdAt : new Date(),
              };
              state.ledger.push(entry);
              state.inserts.push({ table: tableName, row: { ...entry } });
              inserted.push(entry);
            } else if (tableName === "negotiation_rounds") {
              const round: RoundRow = {
                id: typeof values.id === "string" ? values.id : crypto.randomUUID(),
                sessionId: String(values.sessionId),
                roundNo: Number(values.roundNo),
                senderRole: values.senderRole === "SELLER" ? "SELLER" : "BUYER",
                messageType: String(values.messageType ?? "OFFER"),
                priceminor: String(values.priceminor),
                counterPriceMinor:
                  values.counterPriceMinor == null ? null : String(values.counterPriceMinor),
                decision: values.decision == null ? null : String(values.decision),
                metadata:
                  values.metadata && typeof values.metadata === "object"
                    ? { ...(values.metadata as Record<string, unknown>) }
                    : null,
                idempotencyKey: String(values.idempotencyKey),
                message: typeof values.message === "string" ? values.message : null,
                utility: values.utility ?? null,
                createdAt: values.createdAt instanceof Date ? values.createdAt : new Date(),
              };
              state.rounds.push(round);
              state.inserts.push({ table: tableName, row: { ...round } });
              inserted.push(round);
            } else {
              state.inserts.push({ table: tableName, row: { ...values } });
              inserted.push(values);
            }
          }
          return inserted;
        };
        return {
          returning: () => Promise.resolve(materialize()),
          onConflictDoNothing: () => ({
            returning: () => Promise.resolve(materialize()),
          }),
        };
      },
    };
  }

  async function execute(query?: unknown) {
    if (sqlText(query).includes("credit_accounts")) return [];
    const hold = state.holdNext;
    if (hold) {
      state.holdNext = null;
      hold.markStarted();
      await hold.gate;
    }
    return state.row ? [toSnake(state.row)] : [];
  }

  function transaction<T>(
    fn: (tx: {
      execute: typeof execute;
      update: typeof update;
      select: typeof select;
      insert: typeof insert;
    }) => Promise<T>,
  ) {
    let release!: () => void;
    const done = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prev = tail;
    tail = done;
    state.queued += 1;
    return prev.then(async () => {
      state.queued -= 1;
      const snap = {
        row: state.row ? cloneRow(state.row) : null,
        rounds: state.rounds.map((round) => ({
          ...round,
          metadata: round.metadata ? { ...round.metadata } : null,
          createdAt: new Date(round.createdAt.getTime()),
        })),
        accounts: state.accounts.map((account) => ({ ...account })),
        ledger: state.ledger.map((entry) => ({ ...entry })),
        inserts: state.inserts.map((entry) => ({ table: entry.table, row: { ...entry.row } })),
        updates: state.updates.map((update) => ({ ...update })),
      };
      try {
        return await fn({ execute, update, select, insert });
      } catch (err) {
        state.row = snap.row;
        state.rounds = snap.rounds;
        state.accounts = snap.accounts;
        state.ledger = snap.ledger;
        state.inserts = snap.inserts;
        state.updates.splice(0, state.updates.length, ...snap.updates);
        throw err;
      } finally {
        release();
      }
    });
  }

  const api = { select, update, execute, insert, transaction };

  return {
    db: api as unknown as Database,
    updates: state.updates,
    queued: () => state.queued,
    row: () => state.row,
    ledger: () => state.ledger,
    ledgerCount: () => state.ledger.length,
    inserts: () => state.inserts,
    rounds: () => state.rounds.map((round) => ({ ...round })),
    replace(next: SessionRow) {
      state.row = next;
    },
    /** Next unlocked session select waits, then returns a pre-wait snapshot or the live row. */
    armSelectWait(gate: Promise<void>, opts: { stale: boolean }) {
      let markStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      state.selectWait = { gate, markStarted, stale: opts.stale };
      return started;
    },
    /** Next session `execute` (row lock) waits while the transaction mutex is still held. */
    armHold(gate: Promise<void>) {
      let markStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      state.holdNext = { gate, markStarted };
      return started;
    },
  };
}

function positiveChargeCount() {
  return vi.mocked(applySoftAiCreditCharge).mock.calls.filter((call) => {
    const input = call[1] as { chargeTotal?: number; chargeBase?: number } | undefined;
    return (input?.chargeTotal ?? 0) > 0 || (input?.chargeBase ?? 0) > 0;
  }).length;
}

function playInput(extra?: {
  priceMinor?: number;
  message?: string;
  expectedDriver?: "web" | "mcp";
}) {
  return {
    sessionId: SESSION_ID,
    actor: { id: BUYER_ID, role: "user" as const },
    expectedDriver: "web" as const,
    ...extra,
  };
}

describe("auto-play claim vs Manual handoff", () => {
  beforeEach(() => {
    process.env.HAGGLE_ENV = "production";
    vi.mocked(applySoftAiCreditCharge).mockClear();
    vi.mocked(submitHnpOffer).mockClear();
    vi.mocked(getRoundsBySessionId).mockReset();
    vi.mocked(getRoundsBySessionId).mockResolvedValue([]);
    mockExecutePipeline.mockReset();
    mockGetRoundByIdempotencyKey.mockReset();
    mockGetRoundByIdempotencyKey.mockResolvedValue(null);
  });

  afterEach(() => {
    if (ORIGINAL_HAGGLE_ENV === undefined) delete process.env.HAGGLE_ENV;
    else process.env.HAGGLE_ENV = ORIGINAL_HAGGLE_ENV;
  });

  it("rejects auto-play after Manual commits, with no inflight and no charge", async () => {
    const fake = createFakeDb(makeRow());
    const patched = await setPartyControlMode(fake.db, {
      sessionId: SESSION_ID,
      actorUserId: SELLER_ID,
      party: "seller",
      controlMode: "manual",
    });
    expect(patched.ok).toBe(true);
    if (!patched.ok) return;
    expect(patched.pending_handoff).toBe(false);
    expect(fake.row()?.sellerControlMode).toBe("manual");
    const versionAfterPatch = fake.row()?.version;

    const claim = await claimSoftAiInflightUnderLock(fake.db, {
      sessionId: SESSION_ID,
      party: "seller",
      expectedVersion: versionAfterPatch ?? 0,
    });
    expect(claim.ok).toBe(false);
    if (claim.ok) return;
    expect(claim.reason).toBe("manual");
    expect(fake.row()?.softAiInflightParty).toBeNull();
    expect(fake.row()?.version).toBe(versionAfterPatch);

    const ledgerBefore = fake.ledgerCount();
    const post = await executeAutoPlayNext(fake.db, playInput());
    expect(post).toMatchObject({
      ok: false,
      status: 409,
      body: {
        error: "SOFT_MANUAL_WAITING",
        waiting_for_manual: true,
        party: "seller",
        buyer_control_mode: "auto",
        seller_control_mode: "manual",
      },
    });
    expect(post.body.error).not.toBe("CONCURRENT_MODIFICATION");
    expect(submitHnpOffer).not.toHaveBeenCalled();
    expect(fake.updates.some((update) => "softAiInflightParty" in update)).toBe(false);
    expect(positiveChargeCount()).toBe(0);
    expect(fake.ledgerCount()).toBe(ledgerBefore);
  });

  it("rejects a second auto-play when Manual is pending on the in-flight party", async () => {
    const fake = createFakeDb(
      makeRow({
        version: 3,
        currentRound: 1,
        buyerControlMode: "auto",
        softAiInflightParty: "buyer",
        buyerPendingControlMode: "manual",
      }),
    );
    vi.mocked(getRoundsBySessionId).mockResolvedValue([
      {
        roundNo: 1,
        senderRole: "BUYER",
        priceminor: "45000",
        counterPriceMinor: null,
        message: null,
      },
    ] as never);

    const before = fake.row()?.version;
    const claim = await claimSoftAiInflightUnderLock(fake.db, {
      sessionId: SESSION_ID,
      party: "buyer",
      expectedVersion: before ?? 0,
    });
    expect(claim).toMatchObject({ ok: false, reason: "manual" });
    expect(fake.row()?.version).toBe(before);
    expect(fake.row()?.softAiInflightParty).toBe("buyer");
    expect(fake.updates.some((update) => update.softAiInflightParty === "buyer")).toBe(false);

    const ledgerBefore = fake.ledgerCount();
    const post = await executeAutoPlayNext(fake.db, playInput());
    expect(post).toMatchObject({
      ok: false,
      status: 409,
      body: {
        error: "SOFT_MANUAL_WAITING",
        waiting_for_manual: true,
        party: "buyer",
        buyer_control_mode: "auto",
        seller_control_mode: "auto",
      },
    });
    expect(submitHnpOffer).not.toHaveBeenCalled();
    expect(fake.row()?.version).toBe(before);
    expect(positiveChargeCount()).toBe(0);
    expect(fake.ledgerCount()).toBe(ledgerBefore);
  });

  it("still claims inflight and returns 201 for a normal Auto post", async () => {
    const fake = createFakeDb(makeRow());
    const post = await executeAutoPlayNext(fake.db, playInput());
    expect(post.ok).toBe(true);
    expect(post.status).toBe(201);
    expect(submitHnpOffer).toHaveBeenCalledOnce();
    expect(vi.mocked(submitHnpOffer).mock.calls[0]?.[2]).toMatchObject({
      softAiInflightClaim: "seller",
    });
    expect(fake.updates.some((update) => update.softAiInflightParty === "seller")).toBe(true);
  });

  it("keeps a buyer Manual user counter off the inflight claim", async () => {
    const fake = createFakeDb(makeRow({ buyerControlMode: "manual" }));
    const post = await executeAutoPlayNext(
      fake.db,
      playInput({ priceMinor: 42_000, message: "I can do 420." }),
    );
    expect(post.ok).toBe(true);
    expect(post.status).toBe(201);
    expect(post.body.error).not.toBe("SOFT_MANUAL_WAITING");
    expect(submitHnpOffer).toHaveBeenCalledOnce();
    expect(vi.mocked(submitHnpOffer).mock.calls[0]?.[2]).not.toHaveProperty("softAiInflightClaim");
    expect(fake.row()?.softAiInflightParty).toBeNull();
    expect(fake.updates.some((update) => "softAiInflightParty" in update)).toBe(false);
  });

  it("returns concurrent when version moved but the party is still Auto", async () => {
    const fake = createFakeDb(makeRow({ version: 4 }));
    const claim = await claimSoftAiInflightUnderLock(fake.db, {
      sessionId: SESSION_ID,
      party: "seller",
      expectedVersion: 1,
    });
    expect(claim).toEqual({ ok: false, reason: "concurrent" });
    expect(fake.row()?.softAiInflightParty).toBeNull();
    expect(fake.row()?.version).toBe(4);
  });

  it("claims a stale inflight marker for the other party when the version matches", async () => {
    const fake = createFakeDb(makeRow({ version: 2, softAiInflightParty: "buyer" }));
    const claim = await claimSoftAiInflightUnderLock(fake.db, {
      sessionId: SESSION_ID,
      party: "seller",
      expectedVersion: 2,
    });
    expect(claim.ok).toBe(true);
    if (!claim.ok) return;
    expect(claim.version).toBe(3);
    expect(fake.row()?.softAiInflightParty).toBe("seller");
    expect(fake.row()?.version).toBe(3);
  });

  it("stale unlocked read still loses to a Manual commit before the claim", async () => {
    const fake = createFakeDb(makeRow());
    const stall = deferred();
    const started = fake.armSelectWait(stall.promise, { stale: true });
    const ledgerBefore = fake.ledgerCount();
    const postP = executeAutoPlayNext(fake.db, playInput());
    await started;

    const patched = await setPartyControlMode(fake.db, {
      sessionId: SESSION_ID,
      actorUserId: SELLER_ID,
      party: "seller",
      controlMode: "manual",
    });
    expect(patched.ok).toBe(true);
    if (patched.ok) expect(patched.pending_handoff).toBe(false);

    stall.resolve();
    const post = await postP;
    expect(post).toMatchObject({
      ok: false,
      status: 409,
      body: {
        error: "SOFT_MANUAL_WAITING",
        waiting_for_manual: true,
        party: "seller",
        buyer_control_mode: "auto",
        seller_control_mode: "manual",
      },
    });
    expect(post.body.error).not.toBe("CONCURRENT_MODIFICATION");
    expect(submitHnpOffer).not.toHaveBeenCalled();
    expect(fake.row()?.softAiInflightParty).toBeNull();
    expect(fake.updates.some((update) => "softAiInflightParty" in update)).toBe(false);
    expect(positiveChargeCount()).toBe(0);
    expect(fake.ledgerCount()).toBe(ledgerBefore);
  });

  it("queues Manual as pending when auto-play wins the row lock first", async () => {
    const fake = createFakeDb(makeRow());
    const hold = deferred();
    const refresh = deferred();
    const lockStarted = fake.armHold(hold.promise);
    const postP = executeAutoPlayNext(fake.db, playInput());
    try {
      await lockStarted;
      fake.armSelectWait(refresh.promise, { stale: false });
      const patchP = setPartyControlMode(fake.db, {
        sessionId: SESSION_ID,
        actorUserId: SELLER_ID,
        party: "seller",
        controlMode: "manual",
      });
      expect(fake.queued()).toBe(1);
      hold.resolve();
      const patched = await patchP;
      expect(patched.ok).toBe(true);
      if (!patched.ok) return;
      expect(patched.pending_handoff).toBe(true);
      expect(patched.applied).toBe(false);
      expect(patched.view.soft_ai_inflight_party).toBe("seller");
      expect(patched.view.seller_pending_control_mode).toBe("manual");
      expect(patched.view.seller_control_mode).toBe("auto");
      refresh.resolve();
      const post = await postP;
      expect(post.ok).toBe(true);
      expect(post.status).toBe(201);
      expect(post.status).not.toBe(404);
      expect(fake.row()?.sellerControlMode).toBe("manual");
      expect(fake.row()?.sellerPendingControlMode).toBeNull();
      expect(fake.row()?.softAiInflightParty).toBeNull();
      expect(fake.updates.some((update) => update.softAiInflightParty === "seller")).toBe(true);
    } finally {
      hold.resolve();
      refresh.resolve();
    }
  });

  it("buyer: stale unlocked read loses to buyer Manual PATCH committed before the claim", async () => {
    const fake = createFakeDb(makeRow({ currentRound: 1 }));
    vi.mocked(getRoundsBySessionId).mockResolvedValue([
      {
        roundNo: 1,
        senderRole: "BUYER",
        priceminor: "45000",
        counterPriceMinor: null,
        message: null,
      },
    ] as never);
    const stall = deferred();
    const started = fake.armSelectWait(stall.promise, { stale: true });
    const ledgerBefore = fake.ledgerCount();
    const postP = executeAutoPlayNext(fake.db, playInput());
    await started;

    const patched = await setPartyControlMode(fake.db, {
      sessionId: SESSION_ID,
      actorUserId: BUYER_ID,
      party: "buyer",
      controlMode: "manual",
    });
    expect(patched.ok).toBe(true);
    if (patched.ok) expect(patched.pending_handoff).toBe(false);

    stall.resolve();
    const post = await postP;
    expect(post).toMatchObject({
      ok: false,
      status: 409,
      body: {
        error: "SOFT_MANUAL_WAITING",
        waiting_for_manual: true,
        party: "buyer",
        buyer_control_mode: "manual",
        seller_control_mode: "auto",
      },
    });
    expect(post.body.error).not.toBe("CONCURRENT_MODIFICATION");
    expect(submitHnpOffer).not.toHaveBeenCalled();
    expect(fake.row()?.softAiInflightParty).toBeNull();
    expect(fake.updates.some((update) => "softAiInflightParty" in update)).toBe(false);
    expect(positiveChargeCount()).toBe(0);
    expect(fake.ledgerCount()).toBe(ledgerBefore);
  });

  it("buyer: concurrent PATCH-to-manual and auto-play via Promise.all", async () => {
    vi.mocked(getRoundsBySessionId).mockResolvedValue([
      {
        roundNo: 1,
        senderRole: "BUYER",
        priceminor: "45000",
        counterPriceMinor: null,
        message: null,
      },
    ] as never);

    let sawManualBeforeClaim = false;
    let sawPostWonLock = false;

    for (let i = 0; i < 20; i++) {
      vi.mocked(applySoftAiCreditCharge).mockClear();
      vi.mocked(submitHnpOffer).mockClear();
      const fake = createFakeDb(makeRow({ currentRound: 1 }));
      const ledgerBefore = fake.ledgerCount();
      const yields = i % 5;
      const postFirst = i % 2 === 0;

      const startPost = () => executeAutoPlayNext(fake.db, playInput());
      const startPatch = () =>
        setPartyControlMode(fake.db, {
          sessionId: SESSION_ID,
          actorUserId: BUYER_ID,
          party: "buyer",
          controlMode: "manual",
        });

      let postP: ReturnType<typeof startPost>;
      let patchP: ReturnType<typeof startPatch>;
      if (postFirst) {
        postP = startPost();
        // Yield so some iterations reach the claim's queued row lock before
        // Manual starts. Stop there: further turns would let the round finish
        // and the PATCH would no longer be racing the claim.
        for (let y = 0; y < 8; y++) {
          await Promise.resolve();
          if (fake.queued() > 0 || fake.row()?.softAiInflightParty != null) break;
        }
        patchP = startPatch();
      } else {
        patchP = startPatch();
        for (let y = 0; y < yields; y++) await Promise.resolve();
        postP = startPost();
      }

      const [post, patched] = await Promise.all([postP, patchP]);
      expect(patched.ok).toBe(true);
      if (!patched.ok) return;

      const manualBeforeClaim =
        fake.row()?.buyerControlMode === "manual" && patched.pending_handoff === false;
      const roundCreated = vi.mocked(submitHnpOffer).mock.calls.length > 0;
      expect(roundCreated && manualBeforeClaim).toBe(false);

      if (manualBeforeClaim) {
        sawManualBeforeClaim = true;
        expect(post).toMatchObject({
          ok: false,
          status: 409,
          body: {
            error: "SOFT_MANUAL_WAITING",
            waiting_for_manual: true,
            party: "buyer",
          },
        });
        expect(submitHnpOffer).not.toHaveBeenCalled();
        expect(positiveChargeCount()).toBe(0);
        expect(fake.ledgerCount()).toBe(ledgerBefore);
        expect(fake.inserts().filter((row) => row.table === "credit_ledger_entries")).toHaveLength(
          0,
        );
      } else {
        sawPostWonLock = true;
        expect(patched.pending_handoff).toBe(true);
        expect(patched.view.buyer_pending_control_mode).toBe("manual");
      }
    }

    expect(sawManualBeforeClaim).toBe(true);
    expect(sawPostWonLock).toBe(true);
  });

  it("PATCH buyer Manual to Auto in a half-band session writes one ledger debit", async () => {
    const fake = createFakeDb(
      makeRow({
        buyerControlMode: "manual",
        sellerControlMode: "auto",
        buyerSoftAiCreditsCharged: CREDIT_PRO_HALF,
      }),
    );
    const ledgerBefore = fake.ledgerCount();
    const patched = await setPartyControlMode(fake.db, {
      sessionId: SESSION_ID,
      actorUserId: BUYER_ID,
      party: "buyer",
      controlMode: "auto",
      haggleEnv: "production",
    });
    expect(patched.ok).toBe(true);
    if (!patched.ok) return;
    expect(patched.applied).toBe(true);
    expect(patched.pending_handoff).toBe(false);
    expect(fake.row()?.buyerControlMode).toBe("auto");
    const ledgerInserts = fake.inserts().filter((row) => row.table === "credit_ledger_entries");
    expect(ledgerInserts).toHaveLength(1);
    expect(fake.ledgerCount()).toBe(ledgerBefore + 1);
    expect(fake.ledger()[0]).toMatchObject({
      kind: "debit",
      reason: "soft_ai",
      delta: -(CREDIT_PRO_GAME - CREDIT_PRO_HALF),
      accountId: BUYER_ID,
    });
    expect(positiveChargeCount()).toBe(1);
  });

  it("mcp play path: Manual committed before the claim writes no round and no ledger row", async () => {
    vi.mocked(getRoundsBySessionId).mockResolvedValue([
      {
        roundNo: 1,
        senderRole: "BUYER",
        priceminor: "45000",
        counterPriceMinor: null,
        message: null,
      },
    ] as never);

    let sawManualBeforeClaim = false;
    let sawPostWonLock = false;

    for (let i = 0; i < 20; i++) {
      vi.mocked(applySoftAiCreditCharge).mockClear();
      vi.mocked(submitHnpOffer).mockClear();
      const fake = createFakeDb(makeRow({ currentRound: 1, driver: "mcp" }));
      const ledgerBefore = fake.ledgerCount();
      const yields = i % 5;
      const postFirst = i % 2 === 0;

      const startPost = () => executeAutoPlayNext(fake.db, playInput({ expectedDriver: "mcp" }));
      const startPatch = () =>
        setPartyControlMode(fake.db, {
          sessionId: SESSION_ID,
          actorUserId: BUYER_ID,
          party: "buyer",
          controlMode: "manual",
        });

      let postP: ReturnType<typeof startPost>;
      let patchP: ReturnType<typeof startPatch>;
      if (postFirst) {
        postP = startPost();
        for (let y = 0; y < 8; y++) {
          await Promise.resolve();
          if (fake.queued() > 0 || fake.row()?.softAiInflightParty != null) break;
        }
        patchP = startPatch();
      } else {
        patchP = startPatch();
        for (let y = 0; y < yields; y++) await Promise.resolve();
        postP = startPost();
      }

      const [post, patched] = await Promise.all([postP, patchP]);
      expect(patched.ok).toBe(true);
      if (!patched.ok) return;
      expect(post.body.error).not.toBe("DRIVER_MISMATCH");

      const manualBeforeClaim =
        fake.row()?.buyerControlMode === "manual" && patched.pending_handoff === false;
      const roundCreated = vi.mocked(submitHnpOffer).mock.calls.length > 0;
      expect(roundCreated && manualBeforeClaim).toBe(false);

      if (manualBeforeClaim) {
        sawManualBeforeClaim = true;
        expect(post).toMatchObject({
          ok: false,
          status: 409,
          body: {
            error: "SOFT_MANUAL_WAITING",
            waiting_for_manual: true,
            party: "buyer",
          },
        });
        expect(submitHnpOffer).not.toHaveBeenCalled();
        expect(positiveChargeCount()).toBe(0);
        expect(fake.ledgerCount()).toBe(ledgerBefore);
        expect(fake.inserts().filter((row) => row.table === "credit_ledger_entries")).toHaveLength(
          0,
        );
      } else {
        sawPostWonLock = true;
        expect(patched.pending_handoff).toBe(true);
        expect(patched.view.buyer_pending_control_mode).toBe("manual");
      }
    }

    expect(sawManualBeforeClaim).toBe(true);
    expect(sawPostWonLock).toBe(true);
  });

  function pipelineCounter() {
    return {
      cost: { tokens: 3 },
      stages: {
        validate: {
          final_decision: {
            action: "COUNTER",
            price: 80_000,
            reasoning: "hold",
            tactic_used: "anchor",
          },
          validation: { ok: true },
        },
        respond: { message: "I can do that range." },
        decide: { reasoning_mode: false },
        context: { briefing: {} },
      },
    };
  }

  async function installRealSubmit() {
    const actual =
      await vi.importActual<typeof import("../hnp/submit-offer.js")>("../hnp/submit-offer.js");
    vi.mocked(submitHnpOffer).mockImplementation(actual.submitHnpOffer);
  }

  it("real executor: Manual PATCH while the LLM runs observes the Phase 3 outcome", async () => {
    await installRealSubmit();
    const fake = createFakeDb(makeRow());
    const ledgerBefore = fake.ledgerCount();
    mockExecutePipeline.mockImplementation(async () => {
      const patched = await setPartyControlMode(fake.db, {
        sessionId: SESSION_ID,
        actorUserId: SELLER_ID,
        party: "seller",
        controlMode: "manual",
      });
      expect(patched.ok).toBe(true);
      if (patched.ok) {
        expect(patched.pending_handoff).toBe(true);
        expect(patched.view.seller_control_mode).toBe("auto");
        expect(patched.view.seller_pending_control_mode).toBe("manual");
      }
      return pipelineCounter();
    });

    const post = await executeAutoPlayNext(fake.db, playInput());
    const rounds = fake.rounds();
    const row = fake.row();

    expect(mockExecutePipeline).toHaveBeenCalledOnce();
    expect(rounds).toHaveLength(0);
    expect(post).toMatchObject({
      ok: false,
      status: 409,
      body: { error: "CONCURRENT_MODIFICATION" },
    });
    expect(row?.sellerControlMode).toBe("manual");
    expect(row?.sellerPendingControlMode).toBeNull();
    expect(row?.softAiInflightParty).toBeNull();
    expect(row?.buyerControlMode).toBe("auto");
    expect(fake.ledgerCount()).toBe(ledgerBefore);
    expect(fake.inserts().filter((entry) => entry.table === "credit_ledger_entries")).toHaveLength(
      0,
    );
  });

  async function raceRestAndHnp(row: SessionRow, sync: "pipeline" | "lock") {
    await installRealSubmit();
    const fake = createFakeDb(row);
    vi.mocked(getRoundsBySessionId).mockImplementation(async () => fake.rounds() as never);
    mockGetRoundByIdempotencyKey.mockImplementation(
      async (_db: unknown, _id: unknown, key: unknown) =>
        fake.rounds().find((round) => round.idempotencyKey === key) ?? null,
    );
    const ledgerBefore = fake.ledgerCount();
    const envelope = buildHostHnpOfferEnvelope({
      sessionId: SESSION_ID,
      roundNo: 1,
      senderRole: "BUYER",
      priceMinor: 42_000,
      nowMs: Date.now(),
      idempotencyKey: "hnp-race-1",
    });
    const restInput = {
      sessionId: SESSION_ID,
      offerPriceMinor: 42_000,
      senderRole: "BUYER" as const,
      idempotencyKey: "rest-race-1",
      roundData: {},
      nowMs: Date.now(),
    };
    const gate = deferred();
    let lockStarted: Promise<void> | null = null;
    if (sync === "pipeline") {
      let prepared = 0;
      mockExecutePipeline.mockImplementation(async () => {
        prepared += 1;
        if (prepared >= 2) gate.resolve();
        await gate.promise;
        return pipelineCounter();
      });
    } else {
      lockStarted = fake.armHold(gate.promise);
    }
    const pending = Promise.allSettled([
      submitHnpOffer(fake.db, envelope, { requireSignature: false }),
      getExecutor()(fake.db, restInput),
    ]);
    if (lockStarted) {
      await lockStarted;
      for (let i = 0; i < 30; i++) {
        if (fake.queued() > 0) break;
        await Promise.resolve();
      }
      gate.resolve();
    }
    const [hnp, rest] = await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("offer race timed out")), 3000);
      }),
    ]);
    return { fake, ledgerBefore, hnp, rest };
  }

  function outcomeOf(settled: PromiseSettledResult<unknown>): "saved" | "conflict" | "other" {
    if (settled.status === "rejected") {
      const reason = settled.reason;
      const message = reason instanceof Error ? reason.message : String(reason);
      if (message.startsWith("NOT_YOUR_TURN") || message.startsWith("CONCURRENT_MODIFICATION")) {
        return "conflict";
      }
      return "other";
    }
    const value = settled.value as { ok?: boolean; status?: number; body?: { error?: string } };
    if (value && value.ok === false && value.status === 409) return "conflict";
    if (value && (value.ok === true || "roundId" in (value as object))) return "saved";
    return "other";
  }

  it("REST offers and hnp_submit_offer: counterpart Auto writes one round", async () => {
    const { fake, ledgerBefore, hnp, rest } = await raceRestAndHnp(makeRow(), "pipeline");
    const outcomes = [outcomeOf(hnp), outcomeOf(rest)].sort();
    expect(outcomes).toEqual(["conflict", "saved"]);
    expect(fake.rounds()).toHaveLength(1);
    expect(fake.ledgerCount()).toBe(ledgerBefore);
    expect(fake.inserts().filter((entry) => entry.table === "credit_ledger_entries")).toHaveLength(
      0,
    );
  });

  it("REST offers and hnp_submit_offer: counterpart Manual writes one offer-only round", async () => {
    const { fake, ledgerBefore, hnp, rest } = await raceRestAndHnp(
      makeRow({ sellerControlMode: "manual", role: "SELLER" }),
      "lock",
    );
    const outcomes = [outcomeOf(hnp), outcomeOf(rest)].sort();
    expect(outcomes).toEqual(["conflict", "saved"]);
    expect(fake.rounds()).toHaveLength(1);
    expect(fake.rounds()[0]?.decision).toBeNull();
    expect(fake.rounds()[0]?.counterPriceMinor).toBeNull();
    expect(fake.rounds()[0]?.metadata).toMatchObject({ awaiting_manual_counterpart: "seller" });
    expect(mockExecutePipeline).not.toHaveBeenCalled();
    expect(fake.ledgerCount()).toBe(ledgerBefore);
  });

  /** Same fields POST /negotiations/sessions/:id/offers passes to getExecutor(). */
  function restOfferInput(idempotencyKey: string) {
    const nowMs = Date.now();
    const envelope = wrapPriceOnlyAsHostEnvelope({
      sessionId: SESSION_ID,
      currentRound: 0,
      senderRole: "BUYER",
      priceMinor: 42_000,
      idempotencyKey,
      nowMs,
    });
    const wrapped = normalizeSubmitOffer({ hnp: envelope }, SESSION_ID, nowMs);
    if (!wrapped.ok) throw new Error("rest offer fixture did not normalize");
    return {
      sessionId: SESSION_ID,
      offerPriceMinor: wrapped.offerPriceMinor,
      messageText: undefined,
      senderRole: wrapped.senderRole,
      idempotencyKey: wrapped.idempotencyKey,
      protocol: wrapped.protocol,
      roundData: {},
      nowMs,
    };
  }

  async function raceSameTurnManual(
    start: (db: ReturnType<typeof createFakeDb>["db"], idempotencyKey: string) => Promise<unknown>,
  ) {
    await installRealSubmit();
    const fake = createFakeDb(makeRow({ sellerControlMode: "manual", role: "SELLER" }));
    vi.mocked(getRoundsBySessionId).mockImplementation(async () => fake.rounds() as never);
    mockGetRoundByIdempotencyKey.mockImplementation(
      async (_db: unknown, _id: unknown, key: unknown) =>
        fake.rounds().find((round) => round.idempotencyKey === key) ?? null,
    );
    const ledgerBefore = fake.ledgerCount();
    const gate = deferred();
    const lockStarted = fake.armHold(gate.promise);
    const pending = Promise.allSettled([
      start(fake.db, "same-turn-a"),
      start(fake.db, "same-turn-b"),
    ]);
    await lockStarted;
    for (let i = 0; i < 30; i++) {
      if (fake.queued() > 0) break;
      await Promise.resolve();
    }
    gate.resolve();
    const settled = await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("offer race timed out")), 3000);
      }),
    ]);
    return { fake, ledgerBefore, settled };
  }

  function expectOneOfferOnlyRound(fake: ReturnType<typeof createFakeDb>, ledgerBefore: number) {
    expect(fake.rounds()).toHaveLength(1);
    expect(fake.rounds()[0]).toMatchObject({
      senderRole: "BUYER",
      decision: null,
      counterPriceMinor: null,
      metadata: { awaiting_manual_counterpart: "seller" },
    });
    expect(mockExecutePipeline).not.toHaveBeenCalled();
    expect(fake.ledgerCount()).toBe(ledgerBefore);
    expect(fake.inserts().filter((entry) => entry.table === "credit_ledger_entries")).toHaveLength(
      0,
    );
  }

  it("REST offers: two same-turn own offers with counterpart Manual → exactly one saved, other 409", async () => {
    const { fake, ledgerBefore, settled } = await raceSameTurnManual((db, idempotencyKey) =>
      getExecutor()(db, restOfferInput(idempotencyKey)),
    );
    const saved = settled.filter((item) => item.status === "fulfilled");
    const rejected = settled.filter((item) => item.status === "rejected");
    expect(saved).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(saved[0]?.status === "fulfilled" && saved[0].value).toMatchObject({
      idempotent: false,
      decision: "AWAITING_COUNTERPART",
      awaitingManualCounterpart: "seller",
    });
    const reason = rejected[0]?.status === "rejected" ? rejected[0].reason : undefined;
    expect(reason).toBeInstanceOf(Error);
    expect((reason as Error).message).toBe("NOT_YOUR_TURN");
    expectOneOfferOnlyRound(fake, ledgerBefore);
  });

  it("hnp_submit_offer: two same-turn own offers with counterpart Manual → exactly one saved, other 409", async () => {
    const { fake, ledgerBefore, settled } = await raceSameTurnManual((db, idempotencyKey) =>
      submitHnpOffer(
        db,
        buildHostHnpOfferEnvelope({
          sessionId: SESSION_ID,
          roundNo: 1,
          senderRole: "BUYER",
          priceMinor: 42_000,
          nowMs: Date.now(),
          idempotencyKey,
        }),
        { requireSignature: false },
      ),
    );
    const values = settled.map((item) => {
      expect(item.status).toBe("fulfilled");
      return item.status === "fulfilled" ? item.value : undefined;
    });
    const winner = values.find((value) => (value as { ok?: boolean }).ok === true);
    const loser = values.find((value) => (value as { ok?: boolean }).ok === false);
    expect(winner).toMatchObject({ ok: true, awaitingManualCounterpart: "seller" });
    expect(loser).toEqual({
      ok: false,
      status: 409,
      body: { error: "NOT_YOUR_TURN" },
    });
    expectOneOfferOnlyRound(fake, ledgerBefore);
  });
});
