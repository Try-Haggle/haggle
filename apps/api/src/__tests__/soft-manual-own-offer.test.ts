/**
 * Real getExecutor() → executeStagedNegotiationRound for a Manual party's own
 * offer. soft-manual-executor-guard.test.ts mocks executor-factory, so these
 * cases stay here and must not mock the executor. The post-guard sentinel is
 * getRoundsBySessionId rejecting with PAST_GUARD.
 */

import type { Database } from "@haggle/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hnpOfferEnvelopeSchema } from "../hnp/envelope-schema.js";
import { buildHostHnpOfferEnvelope } from "../hnp/host-envelope.js";
import { submitHnpOffer } from "../hnp/submit-offer.js";
import { getExecutor } from "../lib/executor-factory.js";
import type { RoundExecutionInput } from "../lib/negotiation-executor.js";
import { executeStagedNegotiationRound } from "../negotiation/pipeline/executor.js";
import {
  SoftManualWaitingError,
  softManualWaitingBodyFromError,
} from "../services/control-mode.service.js";

const {
  mockExecutePipeline,
  mockCreateRound,
  mockUpdateSessionState,
  mockGetRoundsBySessionId,
  mockGetRoundByIdempotencyKey,
} = vi.hoisted(() => ({
  mockExecutePipeline: vi.fn(),
  mockCreateRound: vi.fn(),
  mockUpdateSessionState: vi.fn(),
  mockGetRoundsBySessionId: vi.fn(),
  mockGetRoundByIdempotencyKey: vi.fn(),
}));

vi.mock("../negotiation/pipeline/pipeline.js", () => ({
  executePipeline: (...args: unknown[]) => mockExecutePipeline(...args),
}));

vi.mock("../services/negotiation-round.service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/negotiation-round.service.js")>();
  return {
    ...actual,
    getRoundByIdempotencyKey: (...args: unknown[]) => mockGetRoundByIdempotencyKey(...args),
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

vi.mock("../services/hnp-ingress.service.js", () => ({
  validateHnpIngress: vi.fn(async () => ({ ok: true })),
}));

const PAST_GUARD = "PAST_GUARD";
const SESSION_ID = "00000000-0000-4000-a000-0000000000aa";

function lockedRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: SESSION_ID,
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
    sessionId: SESSION_ID,
    offerPriceMinor: 42_000,
    senderRole: "SELLER",
    idempotencyKey: "idem-own-offer",
    roundData: {},
    nowMs: Date.parse("2026-09-01T00:00:00.000Z"),
    ...overrides,
  };
}

function dbFor(row: Record<string, unknown>) {
  const execute = vi.fn(async () => [row]);
  const select = vi.fn(() => {
    const query = {
      from: () => query,
      where: () => query,
      limit: () => query,
      orderBy: () => query,
      offset: () => query,
      // biome-ignore lint/suspicious/noThenProperty: Drizzle queries are thenable.
      then: (onFulfilled?: (value: unknown[]) => unknown) => Promise.resolve([]).then(onFulfilled),
    };
    return query;
  });
  const tx = { execute, select };
  const db = {
    execute,
    select,
    transaction: vi.fn(async (fn: (inner: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { db: db as unknown as Database, execute };
}

function envelope(senderRole: "BUYER" | "SELLER") {
  return buildHostHnpOfferEnvelope({
    sessionId: SESSION_ID,
    roundNo: 2,
    senderRole,
    priceMinor: 42_000,
    nowMs: Date.now(),
  });
}

describe("submitHnpOffer real executor — Manual own offer", () => {
  beforeEach(() => {
    mockExecutePipeline.mockReset();
    mockCreateRound.mockReset();
    mockUpdateSessionState.mockReset();
    mockGetRoundsBySessionId.mockReset();
    mockGetRoundByIdempotencyKey.mockReset();
    mockExecutePipeline.mockRejectedValue(new Error(PAST_GUARD));
    mockGetRoundsBySessionId.mockResolvedValue([]);
    mockGetRoundByIdempotencyKey.mockResolvedValue(null);
    mockCreateRound.mockResolvedValue({ id: "round-offer-only" });
    mockUpdateSessionState.mockResolvedValue({ status: "ACTIVE", version: 4, currentRound: 3 });
    expect(getExecutor()).toBe(executeStagedNegotiationRound);
  });

  async function submit(rowOverrides: Record<string, unknown>, senderRole: "BUYER" | "SELLER") {
    const { db } = dbFor(lockedRow(rowOverrides));
    return submitHnpOffer(db, envelope(senderRole));
  }

  async function expectPastGuard(
    rowOverrides: Record<string, unknown>,
    senderRole: "BUYER" | "SELLER",
  ) {
    const caught = await submit(rowOverrides, senderRole).then(
      (value) => value,
      (error: unknown) => error,
    );
    expect(caught).not.toBeInstanceOf(SoftManualWaitingError);
    expect(caught).not.toMatchObject({
      ok: false,
      status: 409,
      body: { error: "SOFT_MANUAL_WAITING" },
    });
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe(PAST_GUARD);
    expect(mockExecutePipeline).toHaveBeenCalledOnce();
    expect(mockCreateRound).not.toHaveBeenCalled();
    expect(mockUpdateSessionState).not.toHaveBeenCalled();
  }

  async function expectWaiting(
    rowOverrides: Record<string, unknown>,
    senderRole: "BUYER" | "SELLER",
    party: "buyer" | "seller",
  ) {
    const result = await submit(rowOverrides, senderRole);
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      body: { error: "SOFT_MANUAL_WAITING", party },
    });
    expect(mockExecutePipeline).not.toHaveBeenCalled();
    expect(mockCreateRound).not.toHaveBeenCalled();
    expect(mockUpdateSessionState).not.toHaveBeenCalled();
    expect(mockGetRoundsBySessionId).not.toHaveBeenCalled();
  }

  it("hnp_submit_offer path: Manual buyer own offer passes the Soft Manual guard", async () => {
    await expectPastGuard(
      {
        role: "SELLER",
        buyer_control_mode: "manual",
        seller_control_mode: "auto",
      },
      "BUYER",
    );
  });

  it("hnp_submit_offer path: Manual seller own offer passes the Soft Manual guard", async () => {
    await expectPastGuard(
      {
        role: "BUYER",
        buyer_control_mode: "auto",
        seller_control_mode: "manual",
      },
      "SELLER",
    );
  });

  it("hnp_submit_offer path: AI drafting for the Manual buyer is 409", async () => {
    // Counterpart seller is Auto, locked role is the Manual buyer.
    await expectWaiting(
      {
        role: "BUYER",
        buyer_control_mode: "manual",
        seller_control_mode: "auto",
      },
      "BUYER",
      "buyer",
    );
  });

  it("hnp_submit_offer path: AI drafting for the Manual seller is 409", async () => {
    await expectWaiting(
      {
        role: "SELLER",
        buyer_control_mode: "auto",
        seller_control_mode: "manual",
      },
      "SELLER",
      "seller",
    );
  });

  it("hnp_submit_offer path: counterpart Manual saves an offer-only round", async () => {
    const result = await submit(
      {
        role: "SELLER",
        buyer_control_mode: "auto",
        seller_control_mode: "manual",
      },
      "BUYER",
    );
    expect(result).toMatchObject({
      ok: true,
      decision: "AWAITING_COUNTERPART",
      awaitingManualCounterpart: "seller",
      counterPrice: 42_000,
      idempotent: false,
    });
    expect(mockExecutePipeline).not.toHaveBeenCalled();
    expect(mockCreateRound).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        senderRole: "BUYER",
        priceminor: "42000",
        messageType: "COUNTER",
        metadata: expect.objectContaining({ awaiting_manual_counterpart: "seller" }),
      }),
    );
    expect(mockCreateRound.mock.calls[0]?.[1]).not.toHaveProperty("counterPriceMinor");
    expect(mockCreateRound.mock.calls[0]?.[1]).not.toHaveProperty("decision");
    expect(mockUpdateSessionState).toHaveBeenCalledWith(
      expect.anything(),
      SESSION_ID,
      3,
      expect.objectContaining({ role: "BUYER" }),
    );
    expect(mockUpdateSessionState.mock.calls[0]?.[3]).toMatchObject({
      role: "BUYER",
      currentRound: 3,
      lastOfferPriceMinor: "42000",
    });
    expect(mockUpdateSessionState.mock.calls[0]?.[3]).not.toHaveProperty("status");
  });

  it("hnp_submit_offer path: both Manual still saves the sender offer", async () => {
    const result = await submit(
      {
        role: "BUYER",
        buyer_control_mode: "manual",
        seller_control_mode: "manual",
      },
      "SELLER",
    );
    expect(result).toMatchObject({
      ok: true,
      awaitingManualCounterpart: "buyer",
      decision: "AWAITING_COUNTERPART",
    });
    expect(mockExecutePipeline).not.toHaveBeenCalled();
    expect(mockCreateRound).toHaveBeenCalledOnce();
  });

  it("hnp_submit_offer path: second offer-only from the same sender is 409", async () => {
    mockGetRoundsBySessionId.mockResolvedValue([
      {
        senderRole: "BUYER",
        decision: null,
        counterPriceMinor: null,
        priceminor: "42000",
        metadata: { awaiting_manual_counterpart: "seller" },
        roundNo: 2,
      },
    ]);
    const result = await submit(
      {
        role: "SELLER",
        buyer_control_mode: "auto",
        seller_control_mode: "manual",
      },
      "BUYER",
    );
    expect(result).toEqual({ ok: false, status: 409, body: { error: "NOT_YOUR_TURN" } });
    expect(mockCreateRound).not.toHaveBeenCalled();
    expect(mockExecutePipeline).not.toHaveBeenCalled();
  });

  it("hnp_submit_offer path: same idempotency key replays the offer-only round", async () => {
    mockGetRoundByIdempotencyKey.mockResolvedValue({
      id: "round-existing",
      roundNo: 3,
      decision: null,
      counterPriceMinor: null,
      priceminor: "42000",
      metadata: { awaiting_manual_counterpart: "seller" },
    });
    const result = await submit(
      {
        role: "SELLER",
        seller_control_mode: "manual",
      },
      "BUYER",
    );
    expect(result).toMatchObject({
      ok: true,
      idempotent: true,
      roundId: "round-existing",
      decision: "AWAITING_COUNTERPART",
      awaitingManualCounterpart: "seller",
    });
    expect(result).not.toMatchObject({ status: 409 });
    expect(mockCreateRound).not.toHaveBeenCalled();
  });

  it("hnp_submit_offer path: request flags cannot force or skip the AI reply", async () => {
    const manual = await submitHnpOffer(
      dbFor({
        ...lockedRow({
          role: "SELLER",
          buyer_control_mode: "auto",
          seller_control_mode: "manual",
        }),
      }).db,
      {
        ...envelope("BUYER"),
        force_ai_reply: true,
        skip_ai_reply: false,
        awaiting_manual_counterpart: "buyer",
        softAiInflightClaim: "buyer",
      } as ReturnType<typeof envelope>,
    );
    expect(manual).toMatchObject({
      ok: true,
      awaitingManualCounterpart: "seller",
    });
    expect(mockExecutePipeline).not.toHaveBeenCalled();

    mockCreateRound.mockClear();
    mockExecutePipeline.mockClear();
    const auto = await submitHnpOffer(
      dbFor(
        lockedRow({
          role: "SELLER",
          buyer_control_mode: "manual",
          seller_control_mode: "auto",
        }),
      ).db,
      {
        ...envelope("BUYER"),
        skip_ai_reply: true,
        force_ai_reply: false,
      } as ReturnType<typeof envelope>,
    ).then(
      (value) => value,
      (error: unknown) => error,
    );
    expect(auto).toBeInstanceOf(Error);
    expect((auto as Error).message).toBe(PAST_GUARD);
    expect(mockExecutePipeline).toHaveBeenCalledOnce();
    expect(mockCreateRound).not.toHaveBeenCalled();
  });

  it("zod offer envelope strips skip and claim fields", () => {
    // hnpOfferEnvelopeSchema is z.object(); Zod strips unknown keys by default.
    const parsed = hnpOfferEnvelopeSchema.safeParse({
      ...envelope("BUYER"),
      skip_ai_reply: true,
      force_ai_reply: true,
      awaiting_manual_counterpart: "seller",
      softAiInflightClaim: "buyer",
      role: "SELLER",
      next_role: "SELLER",
      turn: "SELLER",
      acting_role: "SELLER",
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).not.toHaveProperty("skip_ai_reply");
    expect(parsed.data).not.toHaveProperty("force_ai_reply");
    expect(parsed.data).not.toHaveProperty("awaiting_manual_counterpart");
    expect(parsed.data).not.toHaveProperty("softAiInflightClaim");
    expect(parsed.data).not.toHaveProperty("role");
    expect(parsed.data).not.toHaveProperty("next_role");
    expect(parsed.data).not.toHaveProperty("turn");
    expect(parsed.data).not.toHaveProperty("acting_role");
    expect(parsed.data.sender_role).toBe("BUYER");
  });

  it("REST offers input shape: counterpart Manual skips and force flags are ignored", async () => {
    const { db } = dbFor(
      lockedRow({
        role: "SELLER",
        buyer_control_mode: "auto",
        seller_control_mode: "manual",
      }),
    );
    // POST /offers builds this object and never copies body flags or a claim.
    const offerInput = {
      sessionId: SESSION_ID,
      offerPriceMinor: 42_000,
      senderRole: "BUYER" as const,
      idempotencyKey: "idem-rest-shape",
      roundData: {},
      nowMs: Date.now(),
      ...{
        force_ai_reply: true,
        skip_ai_reply: false,
        awaiting_manual_counterpart: "buyer",
      },
    };
    expect(offerInput).not.toHaveProperty("softAiInflightClaim");
    const result = await getExecutor()(db, offerInput);
    expect(result).toMatchObject({
      idempotent: false,
      decision: "AWAITING_COUNTERPART",
      awaitingManualCounterpart: "seller",
      outgoingPrice: 42_000,
      utility: { u_total: 0, v_p: 0, v_t: 0, v_r: 0, v_s: 0 },
    });
    expect(mockExecutePipeline).not.toHaveBeenCalled();
    expect(mockCreateRound).toHaveBeenCalledOnce();
    expect(mockUpdateSessionState.mock.calls[0]?.[3]).toMatchObject({ role: "BUYER" });
  });

  it("role flip uses the sender side and ignores request role fields", async () => {
    const { db } = dbFor(
      lockedRow({
        role: "SELLER",
        buyer_control_mode: "auto",
        seller_control_mode: "manual",
      }),
    );
    const offerInput = {
      sessionId: SESSION_ID,
      offerPriceMinor: 42_000,
      senderRole: "BUYER" as const,
      idempotencyKey: "idem-role-flip",
      roundData: {},
      nowMs: Date.now(),
      ...{
        role: "SELLER",
        next_role: "SELLER",
        turn: "SELLER",
        acting_role: "SELLER",
        sender_role: "SELLER",
      },
    };
    await getExecutor()(db, offerInput);
    expect(mockUpdateSessionState.mock.calls[0]?.[3]).toMatchObject({ role: "BUYER" });
    expect(mockExecutePipeline).not.toHaveBeenCalled();
  });

  it("hnp envelope role fields are stripped and the flip follows sender_role", async () => {
    const parsed = hnpOfferEnvelopeSchema.safeParse({
      ...envelope("BUYER"),
      role: "SELLER",
      next_role: "SELLER",
      turn: "SELLER",
      acting_role: "SELLER",
      sender_role: "BUYER",
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).not.toHaveProperty("role");
    expect(parsed.data).not.toHaveProperty("next_role");
    expect(parsed.data).not.toHaveProperty("turn");
    expect(parsed.data).not.toHaveProperty("acting_role");
    expect(parsed.data.sender_role).toBe("BUYER");
    const result = await submitHnpOffer(
      dbFor(
        lockedRow({
          role: "SELLER",
          buyer_control_mode: "auto",
          seller_control_mode: "manual",
        }),
      ).db,
      parsed.data,
      { requireSignature: false },
    );
    expect(result).toMatchObject({ ok: true, awaitingManualCounterpart: "seller" });
    expect(mockUpdateSessionState.mock.calls[0]?.[3]).toMatchObject({ role: "BUYER" });
    expect(mockExecutePipeline).not.toHaveBeenCalled();
  });

  it("offer-only NEAR_DEAL does not change status or emit an agreement", async () => {
    mockUpdateSessionState.mockResolvedValue({ status: "NEAR_DEAL", version: 4, currentRound: 3 });
    const dispatch = vi.fn();
    const { db } = dbFor(
      lockedRow({
        role: "SELLER",
        status: "NEAR_DEAL",
        buyer_control_mode: "auto",
        seller_control_mode: "manual",
      }),
    );
    const result = await getExecutor()(
      db,
      input({ senderRole: "BUYER", idempotencyKey: "idem-near" }),
      { dispatch } as never,
    );
    expect(result).toMatchObject({
      sessionStatus: "NEAR_DEAL",
      awaitingManualCounterpart: "seller",
    });
    const patch = mockUpdateSessionState.mock.calls[0]?.[3] as Record<string, unknown>;
    expect(patch).not.toHaveProperty("status");
    expect(patch).not.toHaveProperty("agreedPriceMinor");
    expect(JSON.stringify(patch)).not.toContain("agreedPriceMinor");
    expect(dispatch).not.toHaveBeenCalled();
    expect(mockCreateRound).toHaveBeenCalledOnce();
  });

  it("hnp_submit_offer path: spam on an offer-only round inserts nothing", async () => {
    const dispatch = vi.fn();
    const result = await submitHnpOffer(
      dbFor(
        lockedRow({
          role: "SELLER",
          buyer_control_mode: "auto",
          seller_control_mode: "manual",
        }),
      ).db,
      envelope("BUYER"),
      {
        requireSignature: false,
        messageText: "send money via telegram me",
        eventDispatcher: { dispatch } as never,
      },
    );
    expect(result).toEqual({ ok: false, status: 422, body: { error: "OFFER_REJECTED_SPAM" } });
    expect(Object.keys((result as { body: Record<string, unknown> }).body)).toEqual(["error"]);
    expect(JSON.stringify(result)).not.toMatch(
      /floor|target|strategy|utility|reasoning|my_target/i,
    );
    expect(mockCreateRound).not.toHaveBeenCalled();
    expect(mockUpdateSessionState).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(mockExecutePipeline).not.toHaveBeenCalled();
  });

  it("pending Manual counterpart: offer-only flips role then the Manual answer takes the AI path", async () => {
    const first = await submit(
      {
        role: "SELLER",
        buyer_control_mode: "auto",
        seller_control_mode: "auto",
        seller_pending_control_mode: "manual",
      },
      "BUYER",
    );
    expect(first).toMatchObject({
      ok: true,
      awaitingManualCounterpart: "seller",
    });
    expect(mockUpdateSessionState.mock.calls[0]?.[3]).toMatchObject({ role: "BUYER" });
    expect(mockExecutePipeline).not.toHaveBeenCalled();

    mockExecutePipeline.mockClear();
    mockCreateRound.mockClear();
    mockUpdateSessionState.mockClear();
    const second = await submit(
      {
        role: "BUYER",
        buyer_control_mode: "auto",
        seller_control_mode: "auto",
        seller_pending_control_mode: "manual",
      },
      "SELLER",
    ).then(
      (value) => value,
      (error: unknown) => error,
    );
    expect(second).not.toMatchObject({
      ok: false,
      status: 409,
      body: { error: "SOFT_MANUAL_WAITING" },
    });
    expect(second).toBeInstanceOf(Error);
    expect((second as Error).message).toBe(PAST_GUARD);
    expect(mockExecutePipeline).toHaveBeenCalledOnce();
  });

  it("both Manual: off-turn side is 409 and the on-turn side is offer-only", async () => {
    mockGetRoundsBySessionId.mockResolvedValue([
      {
        senderRole: "SELLER",
        decision: "COUNTER",
        counterPriceMinor: "50000",
        priceminor: "42000",
        metadata: { engine: "staged-pipeline" },
        roundNo: 2,
        createdAt: new Date("2026-09-01T00:00:00.000Z"),
      },
    ]);
    const offTurn = await submit(
      {
        role: "BUYER",
        buyer_control_mode: "manual",
        seller_control_mode: "manual",
      },
      "BUYER",
    );
    expect(offTurn).toEqual({ ok: false, status: 409, body: { error: "NOT_YOUR_TURN" } });
    expect(mockCreateRound).not.toHaveBeenCalled();

    mockGetRoundsBySessionId.mockResolvedValue([
      {
        senderRole: "SELLER",
        decision: "COUNTER",
        counterPriceMinor: "50000",
        priceminor: "42000",
        metadata: { engine: "staged-pipeline" },
        roundNo: 2,
        createdAt: new Date("2026-09-01T00:00:00.000Z"),
      },
    ]);
    const onTurn = await submit(
      {
        role: "BUYER",
        buyer_control_mode: "manual",
        seller_control_mode: "manual",
      },
      "SELLER",
    );
    expect(onTurn).toMatchObject({
      ok: true,
      awaitingManualCounterpart: "buyer",
    });
    expect(mockCreateRound).toHaveBeenCalledOnce();
    expect(mockUpdateSessionState.mock.calls[0]?.[3]).toMatchObject({ role: "SELLER" });
    expect(mockExecutePipeline).not.toHaveBeenCalled();
  });

  it("executor: mismatched claim is 409 CONCURRENT_MODIFICATION with no round", async () => {
    const result = await submitHnpOffer(
      dbFor(lockedRow({ role: "SELLER", soft_ai_inflight_party: "seller" })).db,
      envelope("BUYER"),
      { requireSignature: false, softAiInflightClaim: "buyer" },
    );
    expect(result).toEqual({
      ok: false,
      status: 409,
      body: { error: "CONCURRENT_MODIFICATION" },
    });
    expect(mockExecutePipeline).not.toHaveBeenCalled();
    expect(mockCreateRound).not.toHaveBeenCalled();
  });

  it("executor: null inflight marker rejects a claim before any round", async () => {
    const result = await submitHnpOffer(
      dbFor(lockedRow({ role: "SELLER", soft_ai_inflight_party: null })).db,
      envelope("BUYER"),
      { requireSignature: false, softAiInflightClaim: "buyer" },
    );
    expect(result).toEqual({
      ok: false,
      status: 409,
      body: { error: "CONCURRENT_MODIFICATION" },
    });
    expect(mockExecutePipeline).not.toHaveBeenCalled();
    expect(mockCreateRound).not.toHaveBeenCalled();
  });

  it("executor: mismatched claim for a Manual party is SOFT_MANUAL_WAITING", async () => {
    const result = await submitHnpOffer(
      dbFor(
        lockedRow({
          role: "BUYER",
          buyer_control_mode: "manual",
          soft_ai_inflight_party: null,
        }),
      ).db,
      envelope("SELLER"),
      { requireSignature: false, softAiInflightClaim: "buyer" },
    );
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      body: { error: "SOFT_MANUAL_WAITING", party: "buyer" },
    });
    expect(mockExecutePipeline).not.toHaveBeenCalled();
    expect(mockCreateRound).not.toHaveBeenCalled();
  });
});

describe("REST offers executor input without an in-flight claim", () => {
  beforeEach(() => {
    mockExecutePipeline.mockReset();
    mockCreateRound.mockReset();
    mockUpdateSessionState.mockReset();
    mockGetRoundsBySessionId.mockReset();
    mockGetRoundsBySessionId.mockRejectedValue(new Error(PAST_GUARD));
  });

  it("locked role is pending Manual and the sender's counterpart is Auto is 409", async () => {
    // Not produced by the offer-only path: that path flips role onto the sender.
    // Here the locked role itself is the pending-Manual party the AI would draft for.
    const executor = getExecutor();
    const { db } = dbFor(
      lockedRow({
        role: "SELLER",
        buyer_control_mode: "auto",
        seller_control_mode: "auto",
        seller_pending_control_mode: "manual",
        expires_at: "2020-01-01T00:00:00.000Z",
      }),
    );
    const offerInput = input({ senderRole: "SELLER" });
    expect(offerInput).not.toHaveProperty("softAiInflightClaim");
    const err = await executor(db, offerInput).catch((error: unknown) => error);
    expect(err).toBeInstanceOf(SoftManualWaitingError);
    if (!(err instanceof SoftManualWaitingError)) return;
    expect(softManualWaitingBodyFromError(err)).toMatchObject({
      error: "SOFT_MANUAL_WAITING",
      party: "seller",
    });
    expect(mockExecutePipeline).not.toHaveBeenCalled();
    expect(mockCreateRound).not.toHaveBeenCalled();
    expect(mockUpdateSessionState).not.toHaveBeenCalled();
    expect(mockGetRoundsBySessionId).not.toHaveBeenCalled();
  });
});
