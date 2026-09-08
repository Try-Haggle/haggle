/**
 * Soft Auto/Manual control_mode (Eng1 M1).
 *
 * SoT: docs/wip/auto-manual-control-mode-sot.md
 * - Party-only toggle (cannot set counterpart)
 * - Soft AI credit quote/differential via @haggle/commerce-core
 * - Handoff after in-flight Soft AI for that party
 * - Seller Manual timeout → Soft Auto resume (+ notify stub)
 * Hard Authority / 1.5% fee / seller +5 untouched.
 */

import {
  isSoftControlMode,
  quoteNegotiationCredits,
  quoteSoftAiCreditDifferential,
  type SoftControlMode,
} from "@haggle/commerce-core";
import { and, type Database, eq, negotiationSessions, sql } from "@haggle/db";

export const SELLER_MANUAL_FIRST_TIMEOUT_MS = 30 * 60 * 1000;
export const SELLER_MANUAL_LATER_TIMEOUT_MS = 2 * 60 * 60 * 1000;

export type ControlModeParty = "buyer" | "seller";
export type SellerManualTimeoutPhase = "first" | "later";

export type ControlModeSessionRow = {
  id: string;
  buyerId: string;
  sellerId: string;
  status: string;
  version: number;
  buyerControlMode: SoftControlMode;
  sellerControlMode: SoftControlMode;
  buyerPendingControlMode: SoftControlMode | null;
  sellerPendingControlMode: SoftControlMode | null;
  softAiInflightParty: ControlModeParty | null;
  buyerSoftAiCreditsCharged: number;
  sellerManualSince: Date | null;
  sellerManualTimeoutPhase: SellerManualTimeoutPhase | null;
  negotiationAgentSnapshot: Record<string, unknown>;
};

export type ControlModeView = {
  buyer_control_mode: SoftControlMode;
  seller_control_mode: SoftControlMode;
  buyer_pending_control_mode: SoftControlMode | null;
  seller_pending_control_mode: SoftControlMode | null;
  soft_ai_inflight_party: ControlModeParty | null;
  buyer_soft_ai_credits_charged: number;
  seller_manual_since: string | null;
  seller_manual_timeout_phase: SellerManualTimeoutPhase | null;
  credit_quote: ReturnType<typeof quoteNegotiationCredits>;
  last_credit_charge?: {
    charge_base: number;
    charge_total: number;
    band: string;
    unlimited: boolean;
  };
};

export type SetControlModeResult =
  | { ok: true; applied: boolean; pending_handoff: boolean; view: ControlModeView }
  | {
      ok: false;
      status: 403 | 404 | 409;
      error:
        | "SESSION_NOT_FOUND"
        | "SESSION_ACTOR_MISMATCH"
        | "PARTY_ONLY_CONTROL_MODE"
        | "INVALID_CONTROL_MODE"
        | "SESSION_TERMINAL"
        | "CONCURRENT_MODIFICATION";
      message?: string;
    };

const TERMINAL = new Set(["ACCEPTED", "REJECTED", "EXPIRED", "SUPERSEDED", "FAILED_COMPATIBILITY"]);

type TxDb = {
  execute: Database["execute"];
  update: Database["update"];
};

function asMode(value: unknown, fallback: SoftControlMode = "auto"): SoftControlMode {
  return isSoftControlMode(value) ? value : fallback;
}

function mapLockedRow(raw: Record<string, unknown>): ControlModeSessionRow {
  return {
    id: String(raw.id),
    buyerId: String(raw.buyer_id),
    sellerId: String(raw.seller_id),
    status: String(raw.status),
    version: Number(raw.version),
    buyerControlMode: asMode(raw.buyer_control_mode),
    sellerControlMode: asMode(raw.seller_control_mode),
    buyerPendingControlMode: isSoftControlMode(raw.buyer_pending_control_mode)
      ? raw.buyer_pending_control_mode
      : null,
    sellerPendingControlMode: isSoftControlMode(raw.seller_pending_control_mode)
      ? raw.seller_pending_control_mode
      : null,
    softAiInflightParty:
      raw.soft_ai_inflight_party === "buyer" || raw.soft_ai_inflight_party === "seller"
        ? raw.soft_ai_inflight_party
        : null,
    buyerSoftAiCreditsCharged: Number(raw.buyer_soft_ai_credits_charged ?? 0),
    sellerManualSince: raw.seller_manual_since ? new Date(String(raw.seller_manual_since)) : null,
    sellerManualTimeoutPhase:
      raw.seller_manual_timeout_phase === "first" || raw.seller_manual_timeout_phase === "later"
        ? raw.seller_manual_timeout_phase
        : null,
    negotiationAgentSnapshot:
      (raw.negotiation_agent_snapshot as Record<string, unknown> | null) ?? {},
  };
}

function mapDrizzleRow(row: typeof negotiationSessions.$inferSelect): ControlModeSessionRow {
  return {
    id: row.id,
    buyerId: row.buyerId,
    sellerId: row.sellerId,
    status: row.status,
    version: row.version,
    buyerControlMode: asMode(row.buyerControlMode),
    sellerControlMode: asMode(row.sellerControlMode),
    buyerPendingControlMode: isSoftControlMode(row.buyerPendingControlMode)
      ? row.buyerPendingControlMode
      : null,
    sellerPendingControlMode: isSoftControlMode(row.sellerPendingControlMode)
      ? row.sellerPendingControlMode
      : null,
    softAiInflightParty:
      row.softAiInflightParty === "buyer" || row.softAiInflightParty === "seller"
        ? row.softAiInflightParty
        : null,
    buyerSoftAiCreditsCharged: row.buyerSoftAiCreditsCharged ?? 0,
    sellerManualSince: row.sellerManualSince ?? null,
    sellerManualTimeoutPhase:
      row.sellerManualTimeoutPhase === "first" || row.sellerManualTimeoutPhase === "later"
        ? row.sellerManualTimeoutPhase
        : null,
    negotiationAgentSnapshot: (row.negotiationAgentSnapshot as Record<string, unknown>) ?? {},
  };
}

export function partyForActor(
  actorUserId: string,
  session: Pick<ControlModeSessionRow, "buyerId" | "sellerId">,
): ControlModeParty | null {
  if (actorUserId === session.buyerId) return "buyer";
  if (actorUserId === session.sellerId) return "seller";
  return null;
}

export function publishedAskMinorFromSnapshot(
  snapshot: Record<string, unknown> | null | undefined,
): number | undefined {
  const ctx = snapshot?.listing_context as { published_ask_minor?: unknown } | undefined;
  if (typeof ctx?.published_ask_minor === "number") return ctx.published_ask_minor;
  const auto = snapshot?.auto_play_context as
    | { buyerSnapshot?: { listing_context?: { published_ask_minor?: unknown } } }
    | undefined;
  const nested = auto?.buyerSnapshot?.listing_context?.published_ask_minor;
  if (typeof nested === "number") return nested;
  return undefined;
}

export function buildControlModeView(
  session: ControlModeSessionRow,
  opts?: {
    charge?: ReturnType<typeof quoteSoftAiCreditDifferential>;
    haggleEnv?: string;
  },
): ControlModeView {
  const ask = publishedAskMinorFromSnapshot(session.negotiationAgentSnapshot);
  const credit_quote = quoteNegotiationCredits({
    role: "buyer",
    publishedAskMinor: ask,
    buyerControlMode: session.buyerControlMode,
    sellerControlMode: session.sellerControlMode,
    haggleEnv: opts?.haggleEnv ?? process.env.HAGGLE_ENV,
  });
  return {
    buyer_control_mode: session.buyerControlMode,
    seller_control_mode: session.sellerControlMode,
    buyer_pending_control_mode: session.buyerPendingControlMode,
    seller_pending_control_mode: session.sellerPendingControlMode,
    soft_ai_inflight_party: session.softAiInflightParty,
    buyer_soft_ai_credits_charged: session.buyerSoftAiCreditsCharged,
    seller_manual_since: session.sellerManualSince?.toISOString() ?? null,
    seller_manual_timeout_phase: session.sellerManualTimeoutPhase,
    credit_quote,
    ...(opts?.charge
      ? {
          last_credit_charge: {
            charge_base: opts.charge.charge_base,
            charge_total: opts.charge.charge_total,
            band: opts.charge.band,
            unlimited: opts.charge.unlimited,
          },
        }
      : {}),
  };
}

export function sellerManualTimeoutMs(phase: SellerManualTimeoutPhase | null | undefined): number {
  return phase === "later" ? SELLER_MANUAL_LATER_TIMEOUT_MS : SELLER_MANUAL_FIRST_TIMEOUT_MS;
}

export function isSellerManualTimedOut(
  session: Pick<
    ControlModeSessionRow,
    "sellerControlMode" | "sellerManualSince" | "sellerManualTimeoutPhase"
  >,
  nowMs = Date.now(),
): boolean {
  if (session.sellerControlMode !== "manual" || !session.sellerManualSince) return false;
  const elapsed = nowMs - session.sellerManualSince.getTime();
  return elapsed >= sellerManualTimeoutMs(session.sellerManualTimeoutPhase);
}

async function lockSession(tx: TxDb, sessionId: string): Promise<ControlModeSessionRow | null> {
  const rows = await tx.execute(
    sql`SELECT * FROM negotiation_sessions WHERE id = ${sessionId}::uuid FOR UPDATE`,
  );
  const row = (rows as unknown as Record<string, unknown>[])[0];
  return row ? mapLockedRow(row) : null;
}

function nextSellerManualFields(
  party: ControlModeParty,
  nextMode: SoftControlMode,
  prev: ControlModeSessionRow,
  now: Date,
): {
  sellerManualSince: Date | null;
  sellerManualTimeoutPhase: SellerManualTimeoutPhase | null;
} {
  if (party !== "seller") {
    return {
      sellerManualSince: prev.sellerManualSince,
      sellerManualTimeoutPhase: prev.sellerManualTimeoutPhase,
    };
  }
  if (nextMode === "manual") {
    const hadPrior =
      prev.sellerManualTimeoutPhase === "later" ||
      prev.sellerManualTimeoutPhase === "first" ||
      prev.sellerManualSince != null;
    return {
      sellerManualSince: now,
      sellerManualTimeoutPhase: hadPrior ? "later" : "first",
    };
  }
  return {
    sellerManualSince: null,
    sellerManualTimeoutPhase:
      prev.sellerManualTimeoutPhase === "first"
        ? "later"
        : (prev.sellerManualTimeoutPhase ?? "later"),
  };
}

async function applyModes(
  tx: TxDb,
  session: ControlModeSessionRow,
  nextBuyer: SoftControlMode,
  nextSeller: SoftControlMode,
  opts: {
    clearBuyerPending: boolean;
    clearSellerPending: boolean;
    sellerManualSince: Date | null;
    sellerManualTimeoutPhase: SellerManualTimeoutPhase | null;
    haggleEnv?: string;
    now: Date;
  },
): Promise<{
  row: ControlModeSessionRow;
  charge: ReturnType<typeof quoteSoftAiCreditDifferential>;
} | null> {
  const ask = publishedAskMinorFromSnapshot(session.negotiationAgentSnapshot);
  const charge = quoteSoftAiCreditDifferential({
    alreadyChargedBase: session.buyerSoftAiCreditsCharged,
    buyerMode: nextBuyer,
    sellerMode: nextSeller,
    publishedAskMinor: ask,
    haggleEnv: opts.haggleEnv ?? process.env.HAGGLE_ENV,
  });

  const [row] = await tx
    .update(negotiationSessions)
    .set({
      buyerControlMode: nextBuyer,
      sellerControlMode: nextSeller,
      buyerPendingControlMode: opts.clearBuyerPending ? null : session.buyerPendingControlMode,
      sellerPendingControlMode: opts.clearSellerPending ? null : session.sellerPendingControlMode,
      buyerSoftAiCreditsCharged: charge.new_charged_base,
      sellerManualSince: opts.sellerManualSince,
      sellerManualTimeoutPhase: opts.sellerManualTimeoutPhase,
      version: session.version + 1,
      updatedAt: opts.now,
    })
    .where(
      and(eq(negotiationSessions.id, session.id), eq(negotiationSessions.version, session.version)),
    )
    .returning();

  if (!row) return null;
  return { row: mapDrizzleRow(row), charge };
}

/**
 * Party-only Soft control_mode toggle with credit differential under row lock.
 */
export async function setPartyControlMode(
  db: Database,
  input: {
    sessionId: string;
    actorUserId: string;
    party: ControlModeParty;
    controlMode: SoftControlMode;
    haggleEnv?: string;
    nowMs?: number;
  },
): Promise<SetControlModeResult> {
  if (!isSoftControlMode(input.controlMode)) {
    return { ok: false, status: 409, error: "INVALID_CONTROL_MODE" };
  }

  return db.transaction(async (tx) => {
    const session = await lockSession(tx as unknown as TxDb, input.sessionId);
    if (!session) {
      return { ok: false, status: 404, error: "SESSION_NOT_FOUND" };
    }
    if (TERMINAL.has(session.status)) {
      return { ok: false, status: 409, error: "SESSION_TERMINAL" };
    }
    const actorParty = partyForActor(input.actorUserId, session);
    if (!actorParty) {
      return { ok: false, status: 403, error: "SESSION_ACTOR_MISMATCH" };
    }
    if (actorParty !== input.party) {
      return {
        ok: false,
        status: 403,
        error: "PARTY_ONLY_CONTROL_MODE",
        message: "Cannot set counterpart Soft control_mode",
      };
    }

    const now = new Date(input.nowMs ?? Date.now());
    const inflight = session.softAiInflightParty === input.party;

    if (inflight) {
      const [row] = await tx
        .update(negotiationSessions)
        .set({
          ...(input.party === "buyer"
            ? { buyerPendingControlMode: input.controlMode }
            : { sellerPendingControlMode: input.controlMode }),
          version: session.version + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(negotiationSessions.id, session.id),
            eq(negotiationSessions.version, session.version),
          ),
        )
        .returning();
      if (!row) {
        return { ok: false, status: 409, error: "CONCURRENT_MODIFICATION" };
      }
      return {
        ok: true,
        applied: false,
        pending_handoff: true,
        view: buildControlModeView(mapDrizzleRow(row), { haggleEnv: input.haggleEnv }),
      };
    }

    const nextBuyer = input.party === "buyer" ? input.controlMode : session.buyerControlMode;
    const nextSeller = input.party === "seller" ? input.controlMode : session.sellerControlMode;

    if (nextBuyer === session.buyerControlMode && nextSeller === session.sellerControlMode) {
      // Clear stale pending for this party if any
      if (
        (input.party === "buyer" && session.buyerPendingControlMode) ||
        (input.party === "seller" && session.sellerPendingControlMode)
      ) {
        const [row] = await tx
          .update(negotiationSessions)
          .set({
            ...(input.party === "buyer"
              ? { buyerPendingControlMode: null }
              : { sellerPendingControlMode: null }),
            version: session.version + 1,
            updatedAt: now,
          })
          .where(
            and(
              eq(negotiationSessions.id, session.id),
              eq(negotiationSessions.version, session.version),
            ),
          )
          .returning();
        if (!row) {
          return { ok: false, status: 409, error: "CONCURRENT_MODIFICATION" };
        }
        return {
          ok: true,
          applied: true,
          pending_handoff: false,
          view: buildControlModeView(mapDrizzleRow(row), { haggleEnv: input.haggleEnv }),
        };
      }
      return {
        ok: true,
        applied: true,
        pending_handoff: false,
        view: buildControlModeView(session, { haggleEnv: input.haggleEnv }),
      };
    }

    const manualFields = nextSellerManualFields(input.party, input.controlMode, session, now);
    const applied = await applyModes(tx as unknown as TxDb, session, nextBuyer, nextSeller, {
      clearBuyerPending: input.party === "buyer",
      clearSellerPending: input.party === "seller",
      sellerManualSince: manualFields.sellerManualSince,
      sellerManualTimeoutPhase: manualFields.sellerManualTimeoutPhase,
      haggleEnv: input.haggleEnv,
      now,
    });
    if (!applied) {
      return { ok: false, status: 409, error: "CONCURRENT_MODIFICATION" };
    }
    return {
      ok: true,
      applied: true,
      pending_handoff: false,
      view: buildControlModeView(applied.row, {
        charge: applied.charge,
        haggleEnv: input.haggleEnv,
      }),
    };
  });
}

/** Mark Soft AI in-flight for handoff serialization (party Soft drafting). */
export async function markSoftAiInflight(
  db: Database,
  sessionId: string,
  party: ControlModeParty,
  expectedVersion: number,
): Promise<boolean> {
  const [row] = await db
    .update(negotiationSessions)
    .set({
      softAiInflightParty: party,
      version: expectedVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(eq(negotiationSessions.id, sessionId), eq(negotiationSessions.version, expectedVersion)),
    )
    .returning({ id: negotiationSessions.id });
  return Boolean(row);
}

/**
 * Clear Soft AI in-flight and apply any pending control_mode for that party
 * (credit differential under lock).
 */
export async function clearSoftAiInflightAndApplyPending(
  db: Database,
  input: { sessionId: string; party: ControlModeParty; haggleEnv?: string; nowMs?: number },
): Promise<ControlModeView | null> {
  return db.transaction(async (tx) => {
    const session = await lockSession(tx as unknown as TxDb, input.sessionId);
    if (!session) return null;
    const now = new Date(input.nowMs ?? Date.now());
    const pending =
      input.party === "buyer" ? session.buyerPendingControlMode : session.sellerPendingControlMode;

    if (
      !pending ||
      pending === (input.party === "buyer" ? session.buyerControlMode : session.sellerControlMode)
    ) {
      const [row] = await tx
        .update(negotiationSessions)
        .set({
          softAiInflightParty: null,
          ...(input.party === "buyer"
            ? { buyerPendingControlMode: null }
            : { sellerPendingControlMode: null }),
          version: session.version + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(negotiationSessions.id, session.id),
            eq(negotiationSessions.version, session.version),
          ),
        )
        .returning();
      return row ? buildControlModeView(mapDrizzleRow(row), { haggleEnv: input.haggleEnv }) : null;
    }

    const nextBuyer = input.party === "buyer" ? pending : session.buyerControlMode;
    const nextSeller = input.party === "seller" ? pending : session.sellerControlMode;
    const manualFields = nextSellerManualFields(input.party, pending, session, now);

    // Clear inflight in same update as mode apply
    const ask = publishedAskMinorFromSnapshot(session.negotiationAgentSnapshot);
    const charge = quoteSoftAiCreditDifferential({
      alreadyChargedBase: session.buyerSoftAiCreditsCharged,
      buyerMode: nextBuyer,
      sellerMode: nextSeller,
      publishedAskMinor: ask,
      haggleEnv: input.haggleEnv ?? process.env.HAGGLE_ENV,
    });
    const [row] = await tx
      .update(negotiationSessions)
      .set({
        softAiInflightParty: null,
        buyerControlMode: nextBuyer,
        sellerControlMode: nextSeller,
        buyerPendingControlMode: null,
        sellerPendingControlMode: null,
        buyerSoftAiCreditsCharged: charge.new_charged_base,
        sellerManualSince: manualFields.sellerManualSince,
        sellerManualTimeoutPhase: manualFields.sellerManualTimeoutPhase,
        version: session.version + 1,
        updatedAt: now,
      })
      .where(
        and(
          eq(negotiationSessions.id, session.id),
          eq(negotiationSessions.version, session.version),
        ),
      )
      .returning();
    return row
      ? buildControlModeView(mapDrizzleRow(row), { charge, haggleEnv: input.haggleEnv })
      : null;
  });
}

export type NotifySellerManualTimeout = (input: {
  sessionId: string;
  sellerId: string;
  buyerId: string;
  reason: "seller_manual_timeout";
}) => Promise<void> | void;

/** Default stub — real catalog event can replace later (ticket allows stub). */
export async function stubNotifySellerManualTimeoutResume(
  input: Parameters<NotifySellerManualTimeout>[0],
): Promise<void> {
  console.info("[control-mode] seller Soft Auto resume after Manual timeout", {
    session_id: input.sessionId,
    seller_id: input.sellerId,
  });
}

/**
 * Soft Auto resume when seller Manual watchdog fires. Charges differential if needed.
 */
export async function resumeSellerSoftAutoAfterTimeout(
  db: Database,
  input: {
    sessionId: string;
    haggleEnv?: string;
    nowMs?: number;
    notify?: NotifySellerManualTimeout;
  },
): Promise<{ resumed: boolean; view: ControlModeView | null }> {
  const notify = input.notify ?? stubNotifySellerManualTimeoutResume;
  return db.transaction(async (tx) => {
    const session = await lockSession(tx as unknown as TxDb, input.sessionId);
    if (!session) return { resumed: false, view: null };
    if (TERMINAL.has(session.status))
      return { resumed: false, view: buildControlModeView(session) };
    const nowMs = input.nowMs ?? Date.now();
    if (!isSellerManualTimedOut(session, nowMs)) {
      return {
        resumed: false,
        view: buildControlModeView(session, { haggleEnv: input.haggleEnv }),
      };
    }

    // If seller Soft AI somehow in-flight, queue Auto via pending
    if (session.softAiInflightParty === "seller") {
      const [row] = await tx
        .update(negotiationSessions)
        .set({
          sellerPendingControlMode: "auto",
          version: session.version + 1,
          updatedAt: new Date(nowMs),
        })
        .where(
          and(
            eq(negotiationSessions.id, session.id),
            eq(negotiationSessions.version, session.version),
          ),
        )
        .returning();
      return {
        resumed: false,
        view: row ? buildControlModeView(mapDrizzleRow(row), { haggleEnv: input.haggleEnv }) : null,
      };
    }

    const now = new Date(nowMs);
    const manualFields = nextSellerManualFields("seller", "auto", session, now);
    const applied = await applyModes(
      tx as unknown as TxDb,
      session,
      session.buyerControlMode,
      "auto",
      {
        clearBuyerPending: false,
        clearSellerPending: true,
        sellerManualSince: manualFields.sellerManualSince,
        sellerManualTimeoutPhase: manualFields.sellerManualTimeoutPhase,
        haggleEnv: input.haggleEnv,
        now,
      },
    );
    if (!applied) return { resumed: false, view: null };
    await notify({
      sessionId: session.id,
      sellerId: session.sellerId,
      buyerId: session.buyerId,
      reason: "seller_manual_timeout",
    });
    return {
      resumed: true,
      view: buildControlModeView(applied.row, {
        charge: applied.charge,
        haggleEnv: input.haggleEnv,
      }),
    };
  });
}

/**
 * Initial Soft AI credit charge at session create (default both Auto → full band).
 * Extends existing quote path; does not invent a parallel wallet.
 */
export function initialBuyerSoftAiCharge(input: {
  publishedAskMinor?: number;
  buyerControlMode?: SoftControlMode;
  sellerControlMode?: SoftControlMode;
  haggleEnv?: string;
}): ReturnType<typeof quoteSoftAiCreditDifferential> {
  return quoteSoftAiCreditDifferential({
    alreadyChargedBase: 0,
    buyerMode: input.buyerControlMode ?? "auto",
    sellerMode: input.sellerControlMode ?? "auto",
    publishedAskMinor: input.publishedAskMinor,
    haggleEnv: input.haggleEnv,
  });
}

export function controlModeFromSessionRecord(session: {
  buyerControlMode?: string | null;
  sellerControlMode?: string | null;
  buyerPendingControlMode?: string | null;
  sellerPendingControlMode?: string | null;
  softAiInflightParty?: string | null;
  buyerSoftAiCreditsCharged?: number | null;
  sellerManualSince?: Date | null;
  sellerManualTimeoutPhase?: string | null;
  buyerId: string;
  sellerId: string;
  id: string;
  status: string;
  version: number;
  negotiationAgentSnapshot?: Record<string, unknown> | null;
}): ControlModeSessionRow {
  return {
    id: session.id,
    buyerId: session.buyerId,
    sellerId: session.sellerId,
    status: session.status,
    version: session.version,
    buyerControlMode: asMode(session.buyerControlMode),
    sellerControlMode: asMode(session.sellerControlMode),
    buyerPendingControlMode: isSoftControlMode(session.buyerPendingControlMode)
      ? session.buyerPendingControlMode
      : null,
    sellerPendingControlMode: isSoftControlMode(session.sellerPendingControlMode)
      ? session.sellerPendingControlMode
      : null,
    softAiInflightParty:
      session.softAiInflightParty === "buyer" || session.softAiInflightParty === "seller"
        ? session.softAiInflightParty
        : null,
    buyerSoftAiCreditsCharged: session.buyerSoftAiCreditsCharged ?? 0,
    sellerManualSince: session.sellerManualSince ?? null,
    sellerManualTimeoutPhase:
      session.sellerManualTimeoutPhase === "first" || session.sellerManualTimeoutPhase === "later"
        ? session.sellerManualTimeoutPhase
        : null,
    negotiationAgentSnapshot: session.negotiationAgentSnapshot ?? {},
  };
}
