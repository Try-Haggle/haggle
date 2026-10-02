/**
 * Lowest-layer Soft Manual guard: executeStagedNegotiationRound re-reads the
 * locked row and refuses to draft for a Manual acting party before any write
 * or LLM call. submitHnpOffer maps that rejection to the 409 body.
 */

import type { Database } from "@haggle/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildHostHnpOfferEnvelope } from "../hnp/host-envelope.js";
import { submitHnpOffer } from "../hnp/submit-offer.js";
import type { RoundExecutionInput } from "../lib/negotiation-executor.js";
import { executeStagedNegotiationRound } from "../negotiation/pipeline/executor.js";
import {
  type ControlModeSessionRow,
  SoftManualWaitingError,
  softAiDraftBlockedUnderLock,
} from "../services/control-mode.service.js";

const {
  mockExecutePipeline,
  mockCreateRound,
  mockUpdateSessionState,
  mockGetRoundsBySessionId,
  mockExecutor,
} = vi.hoisted(() => ({
  mockExecutePipeline: vi.fn(),
  mockCreateRound: vi.fn(),
  mockUpdateSessionState: vi.fn(),
  mockGetRoundsBySessionId: vi.fn(),
  mockExecutor: vi.fn(),
}));

vi.mock("../negotiation/pipeline/pipeline.js", () => ({
  executePipeline: (...args: unknown[]) => mockExecutePipeline(...args),
}));

vi.mock("../services/negotiation-round.service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/negotiation-round.service.js")>();
  return {
    ...actual,
    getRoundByIdempotencyKey: vi.fn(async () => null),
    createRound: (...args: unknown[]) => mockCreateRound(...args),
    getRoundsBySessionId: (...args: unknown[]) => mockGetRoundsBySessionId(...args),
  };
});

vi.mock("../services/negotiation-session.service.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/negotiation-session.service.js")>();
  return {
    ...actual,
    getSessionById: vi.fn(async () => null),
    updateSessionState: (...args: unknown[]) => mockUpdateSessionState(...args),
  };
});

vi.mock("../lib/executor-factory.js", () => ({
  getExecutor: () => mockExecutor,
}));

vi.mock("../services/hnp-ingress.service.js", () => ({
  validateHnpIngress: vi.fn(async () => ({ ok: true })),
}));

const PAST_GUARD = "PAST_GUARD";

function lockedRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "sess-guard",
    role: "BUYER",
    status: "ACTIVE",
    version: 3,
    current_round: 2,
    buyer_id: "buyer-1",
    seller_id: "seller-1",
    buyer_control_mode: "auto",
    seller_control_mode: "auto",
    buyer_pending_control_mode: null,
    seller_pending_control_mode: null,
    soft_ai_inflight_party: null,
    negotiation_agent_snapshot: {},
    expires_at: null,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function input(overrides: Partial<RoundExecutionInput> = {}): RoundExecutionInput {
  return {
    sessionId: "sess-guard",
    offerPriceMinor: 42_000,
    senderRole: "SELLER",
    idempotencyKey: "idem-guard",
    roundData: {},
    nowMs: Date.parse("2026-09-01T00:00:00.000Z"),
    ...overrides,
  };
}

function dbFor(row: Record<string, unknown>) {
  const execute = vi.fn(async () => [row]);
  const db = {
    transaction: vi.fn(async (fn: (tx: { execute: typeof execute }) => Promise<unknown>) =>
      fn({ execute }),
    ),
  };
  return { db: db as unknown as Database, execute };
}

function mapped(overrides: Partial<ControlModeSessionRow> = {}): ControlModeSessionRow {
  return {
    id: "sess-guard",
    buyerId: "buyer-1",
    sellerId: "seller-1",
    status: "ACTIVE",
    version: 3,
    buyerControlMode: "auto",
    sellerControlMode: "auto",
    buyerPendingControlMode: null,
    sellerPendingControlMode: null,
    softAiInflightParty: null,
    buyerSoftAiCreditsCharged: 0,
    sellerManualSince: null,
    sellerManualTimeoutPhase: null,
    negotiationAgentSnapshot: {},
    ...overrides,
  };
}

describe("softAiDraftBlockedUnderLock", () => {
  it("blocks committed Manual even when the caller presents a matching claim", () => {
    const buyerManual = mapped({ buyerControlMode: "manual" });
    expect(softAiDraftBlockedUnderLock(buyerManual, "buyer")).toBe(true);
    expect(softAiDraftBlockedUnderLock(buyerManual, "buyer", { inflightClaim: "buyer" })).toBe(
      true,
    );
    expect(
      softAiDraftBlockedUnderLock(mapped({ sellerControlMode: "manual" }), "seller", {
        inflightClaim: "seller",
      }),
    ).toBe(true);
  });

  it("blocks pending Manual unless the claim matches the acting party", () => {
    const pendingBuyer = mapped({ buyerPendingControlMode: "manual" });
    expect(softAiDraftBlockedUnderLock(pendingBuyer, "buyer")).toBe(true);
    expect(softAiDraftBlockedUnderLock(pendingBuyer, "buyer", { inflightClaim: "seller" })).toBe(
      true,
    );
    expect(softAiDraftBlockedUnderLock(pendingBuyer, "buyer", { inflightClaim: "buyer" })).toBe(
      false,
    );
    expect(
      softAiDraftBlockedUnderLock(mapped({ sellerPendingControlMode: "manual" }), "seller", {
        inflightClaim: "seller",
      }),
    ).toBe(false);
  });

  it("does not block the other party, Auto, or a non-manual pending mode", () => {
    expect(softAiDraftBlockedUnderLock(mapped({ buyerControlMode: "manual" }), "seller")).toBe(
      false,
    );
    expect(softAiDraftBlockedUnderLock(mapped(), "buyer")).toBe(false);
    expect(softAiDraftBlockedUnderLock(mapped({ buyerPendingControlMode: "auto" }), "buyer")).toBe(
      false,
    );
  });

  it("parses a snake_case locked row the same way", () => {
    expect(
      softAiDraftBlockedUnderLock(
        {
          buyer_control_mode: "manual",
          seller_control_mode: "auto",
          status: "ACTIVE",
        },
        "buyer",
      ),
    ).toBe(true);
    expect(
      softAiDraftBlockedUnderLock(
        {
          buyer_control_mode: "auto",
          seller_control_mode: "auto",
          seller_pending_control_mode: "manual",
          status: "ACTIVE",
        },
        "seller",
        { inflightClaim: "seller" },
      ),
    ).toBe(false);
  });
});

describe("executeStagedNegotiationRound Soft Manual guard", () => {
  beforeEach(() => {
    mockExecutePipeline.mockReset();
    mockCreateRound.mockReset();
    mockUpdateSessionState.mockReset();
    mockGetRoundsBySessionId.mockReset();
    mockGetRoundsBySessionId.mockRejectedValue(new Error(PAST_GUARD));
  });

  async function expectBlocked(row: Record<string, unknown>, extra?: Partial<RoundExecutionInput>) {
    const { db, execute } = dbFor(row);
    await expect(executeStagedNegotiationRound(db, input(extra))).rejects.toBeInstanceOf(
      SoftManualWaitingError,
    );
    expect(execute).toHaveBeenCalledOnce();
    expect(mockExecutePipeline).not.toHaveBeenCalled();
    expect(mockCreateRound).not.toHaveBeenCalled();
    expect(mockUpdateSessionState).not.toHaveBeenCalled();
    expect(mockGetRoundsBySessionId).not.toHaveBeenCalled();
  }

  it("throws before any write when the acting role is committed Manual", async () => {
    // Counterpart (seller) is Auto, so this stays on the AI path. Sender matches
    // the locked role, which is Manual — Soft AI must not draft.
    const { db } = dbFor(lockedRow({ role: "BUYER", buyer_control_mode: "manual" }));
    const err = await executeStagedNegotiationRound(db, input({ senderRole: "BUYER" })).catch(
      (error: unknown) => error,
    );
    expect(err).toBeInstanceOf(SoftManualWaitingError);
    expect((err as SoftManualWaitingError).message.startsWith("SOFT_MANUAL_WAITING")).toBe(true);
    expect(err).toMatchObject({
      party: "buyer",
      buyerControlMode: "manual",
      sellerControlMode: "auto",
      sessionStatus: "ACTIVE",
      currentRound: 2,
    });
    expect(mockExecutePipeline).not.toHaveBeenCalled();
    expect(mockCreateRound).not.toHaveBeenCalled();
    expect(mockUpdateSessionState).not.toHaveBeenCalled();
  });

  it("throws on pending Manual without a matching claim and does not expire the session", async () => {
    await expectBlocked(
      lockedRow({
        role: "SELLER",
        seller_control_mode: "auto",
        seller_pending_control_mode: "manual",
        expires_at: "2020-01-01T00:00:00.000Z",
        current_round: 99,
      }),
      { softAiInflightClaim: "buyer" },
    );
  });

  it("lets a matching in-flight claim pass pending Manual without calling the LLM", async () => {
    const { db } = dbFor(
      lockedRow({
        role: "SELLER",
        seller_pending_control_mode: "manual",
        soft_ai_inflight_party: "seller",
      }),
    );
    await expect(
      executeStagedNegotiationRound(db, input({ softAiInflightClaim: "seller" })),
    ).rejects.toThrow(PAST_GUARD);
    expect(mockExecutePipeline).not.toHaveBeenCalled();
    expect(mockCreateRound).not.toHaveBeenCalled();
    expect(mockUpdateSessionState).not.toHaveBeenCalled();
    expect(mockGetRoundsBySessionId).toHaveBeenCalledOnce();
  });

  it("does not block a seller draft when only the buyer is Manual", async () => {
    const { db } = dbFor(
      lockedRow({
        role: "SELLER",
        buyer_control_mode: "manual",
        seller_control_mode: "auto",
      }),
    );
    await expect(executeStagedNegotiationRound(db, input({ senderRole: "BUYER" }))).rejects.toThrow(
      PAST_GUARD,
    );
    expect(mockExecutePipeline).not.toHaveBeenCalled();
    expect(mockCreateRound).not.toHaveBeenCalled();
    expect(mockUpdateSessionState).not.toHaveBeenCalled();
  });
});

describe("submitHnpOffer SoftManualWaitingError mapping", () => {
  beforeEach(() => {
    mockExecutor.mockReset();
  });

  function envelope() {
    return buildHostHnpOfferEnvelope({
      sessionId: "00000000-0000-4000-a000-0000000000aa",
      roundNo: 1,
      senderRole: "BUYER",
      priceMinor: 9_000,
      nowMs: Date.now(),
    });
  }

  it("returns the 409 SOFT_MANUAL_WAITING body and does not rethrow", async () => {
    mockExecutor.mockRejectedValue(
      new SoftManualWaitingError({
        party: "seller",
        buyerControlMode: "auto",
        sellerControlMode: "manual",
        sessionStatus: "ACTIVE",
        currentRound: 4,
      }),
    );
    const result = await submitHnpOffer({} as Database, envelope(), { requireSignature: false });
    expect(result).toEqual({
      ok: false,
      status: 409,
      body: {
        error: "SOFT_MANUAL_WAITING",
        waiting_for_manual: true,
        party: "seller",
        buyer_control_mode: "auto",
        seller_control_mode: "manual",
        session_status: "ACTIVE",
        current_round: 4,
      },
    });
  });

  it("forwards softAiInflightClaim only when the caller passes it", async () => {
    mockExecutor.mockResolvedValue({
      roundId: "round-1",
      roundNo: 1,
      decision: "COUNTER",
      outgoingPrice: 9_000,
      sessionStatus: "ACTIVE",
      idempotent: false,
      utility: {},
    });
    const db = {} as Database;
    await submitHnpOffer(db, envelope(), {
      requireSignature: false,
      softAiInflightClaim: "seller",
    });
    expect(mockExecutor.mock.calls[0]?.[1]).toMatchObject({ softAiInflightClaim: "seller" });

    mockExecutor.mockClear();
    await submitHnpOffer(db, envelope(), { requireSignature: false });
    expect(mockExecutor.mock.calls[0]?.[1]).not.toHaveProperty("softAiInflightClaim");
  });

  it("still throws non-manual executor errors", async () => {
    mockExecutor.mockRejectedValue(new Error("SESSION_TERMINAL: ACCEPTED"));
    await expect(submitHnpOffer({} as Database, envelope())).rejects.toThrow(
      "SESSION_TERMINAL: ACCEPTED",
    );
  });
});
