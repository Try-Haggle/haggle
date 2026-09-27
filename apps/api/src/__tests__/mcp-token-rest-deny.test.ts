import { readFileSync } from "node:fs";
import { SOFT_AGREEMENT_ACK_SOURCE_BUYER_UI_CTA, SOFT_AGREEMENT_ACK_VERSION } from "@haggle/shared";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import authPlugin, { type AuthUser, setMcpAccessTokenResolver } from "../middleware/auth.js";
import { denyMcpToken } from "../middleware/require-auth.js";
import { registerClaimRoutes } from "../routes/claim.js";
import { registerNegotiationRoutes } from "../routes/negotiations.js";
import { registerPaymentRoutes } from "../routes/payments.js";
import { registerSettlementApprovalRoutes } from "../routes/settlement-approvals.js";
import { mintGuestBuyerClaimPop } from "../services/guest-buyer-claim-pop.service.js";
import { resetSupabaseJwtVerifierForTests } from "../services/supabase-jwt.service.js";
import { TEST_USER_JWT } from "./helpers.js";

/**
 * A1: MCP OAuth users (tokenKind "mcp") are rejected on REST payment, accept,
 * settlement, and claim routes before any DB access or side effects.
 * The user is installed by the real auth middleware via mcpAccessTokenResolver.
 */

const MCP_TOKEN = "mcp-listings-oauth-access-token";
const MCP_USER: AuthUser = {
  id: "mcp-user-001",
  role: "user",
  tokenKind: "mcp",
  scopes: ["listings"],
};

const SESSION_ID = "sess-poc";
const APPROVAL_ID = "approval-poc";
const PAYMENT_ID = "pay-poc";
const GUEST_BUYER_ID = "33333333-3333-4333-8333-333333333333";

const PREPARE_BODY = {
  settlement_approval_id: "00000000-0000-4000-a000-000000000099",
  soft_agreement_ack: {
    version: SOFT_AGREEMENT_ACK_VERSION,
    source: SOFT_AGREEMENT_ACK_SOURCE_BUYER_UI_CTA,
    terms_hash: `sha256:${"ab".repeat(32)}`,
    attested_at: "2026-09-28T00:00:00.000Z",
  },
};

const OFFER_BODY = {
  price_minor: 10000,
  sender_role: "BUYER" as const,
  idempotency_key: "idem-poc",
};

const PAYMENT_MUTATIONS = [
  `/payments/${PAYMENT_ID}/quote`,
  `/payments/${PAYMENT_ID}/x402/conditional-settlement-request`,
  `/payments/${PAYMENT_ID}/x402/conditional-settlement-funding`,
  `/payments/${PAYMENT_ID}/x402/conditional-settlement-confirmation`,
  `/payments/${PAYMENT_ID}/x402/conditional-refund-request`,
  `/payments/${PAYMENT_ID}/x402/conditional-refund-execution`,
  `/payments/${PAYMENT_ID}/x402/conditional-refund-confirmation`,
  `/payments/${PAYMENT_ID}/x402/conditional-expire-confirmation`,
  `/payments/${PAYMENT_ID}/x402/conditional-dispute-confirmation`,
  `/payments/${PAYMENT_ID}/x402/submit-signature`,
  `/payments/${PAYMENT_ID}/authorize`,
  `/payments/${PAYMENT_ID}/settlement-pending`,
  `/payments/${PAYMENT_ID}/settle`,
  `/payments/${PAYMENT_ID}/fail`,
  `/payments/${PAYMENT_ID}/cancel`,
  `/payments/${PAYMENT_ID}/refund`,
  `/payments/${PAYMENT_ID}/onramp/session`,
] as const;

const ADMIN_PAYMENT_ROUTES = new Set<string>([
  `/payments/${PAYMENT_ID}/x402/conditional-refund-request`,
  `/payments/${PAYMENT_ID}/x402/conditional-refund-execution`,
  `/payments/${PAYMENT_ID}/x402/conditional-refund-confirmation`,
  `/payments/${PAYMENT_ID}/x402/conditional-expire-confirmation`,
  `/payments/${PAYMENT_ID}/x402/conditional-dispute-confirmation`,
]);

const eventDispatch = vi.fn();
const notificationPublish = vi.fn();
const resolveMcpToken = vi.fn(async (token: string): Promise<AuthUser | null> => {
  if (token !== MCP_TOKEN) return null;
  return MCP_USER;
});

function createDb() {
  const findFirst = vi.fn(async () => null);
  const findMany = vi.fn(async () => []);
  const select = vi.fn(() => {
    const result = Promise.resolve([] as unknown[]);
    const query: Record<string, unknown> = {};
    const self = () => query;
    for (const method of [
      "from",
      "where",
      "orderBy",
      "limit",
      "offset",
      "leftJoin",
      "innerJoin",
      "groupBy",
      "set",
      "values",
      "returning",
    ]) {
      query[method] = vi.fn(self);
    }
    // biome-ignore lint/suspicious/noThenProperty: Drizzle query mocks must remain awaitable.
    query.then = result.then.bind(result);
    query.catch = result.catch.bind(result);
    query.finally = result.finally.bind(result);
    return query;
  });
  const insert = vi.fn();
  const update = vi.fn();
  const execute = vi.fn(async () => ({ rowCount: 0, rows: [] }));
  const query = new Proxy(
    {},
    {
      get: () => ({ findFirst, findMany }),
    },
  );
  return { query, select, insert, update, execute, findFirst, findMany, transaction: vi.fn() };
}

type TrackingDb = ReturnType<typeof createDb>;

function expectNoSideEffects(db: TrackingDb) {
  expect(db.findFirst).not.toHaveBeenCalled();
  expect(db.findMany).not.toHaveBeenCalled();
  expect(db.select).not.toHaveBeenCalled();
  expect(db.insert).not.toHaveBeenCalled();
  expect(db.update).not.toHaveBeenCalled();
  expect(db.execute).not.toHaveBeenCalled();
  expect(db.transaction).not.toHaveBeenCalled();
  expect(eventDispatch).not.toHaveBeenCalled();
  expect(notificationPublish).not.toHaveBeenCalled();
}

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

function claimSessionsBody() {
  return {
    guest_buyer_claims: [
      { guest_buyer_id: GUEST_BUYER_ID, pop: mintGuestBuyerClaimPop(GUEST_BUYER_ID) },
    ],
  };
}

function mockReply() {
  const reply = {
    code: vi.fn(),
    send: vi.fn(),
  };
  reply.code.mockReturnValue(reply);
  reply.send.mockReturnValue(reply);
  return reply as unknown as FastifyReply & {
    code: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
  };
}

describe("denyMcpToken", () => {
  it("rejects an MCP OAuth user with 403 MCP_TOKEN_NOT_ALLOWED", async () => {
    const reply = mockReply();
    const request = { user: MCP_USER } as FastifyRequest;
    await denyMcpToken(request, reply);
    expect(reply.code).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith({ error: "MCP_TOKEN_NOT_ALLOWED" });
  });

  it("lets a JWT user pass through", async () => {
    const reply = mockReply();
    const request = {
      user: { id: "jwt-user", role: "user", tokenKind: "jwt" },
    } as FastifyRequest;
    await denyMcpToken(request, reply);
    expect(reply.code).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });

  it("lets an unauthenticated request pass through", async () => {
    const reply = mockReply();
    await denyMcpToken({} as FastifyRequest, reply);
    expect(reply.code).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });
});

describe("MCP token REST deny", () => {
  let app: FastifyInstance;
  let db: TrackingDb;
  const originalEnv = {
    NODE_ENV: process.env.NODE_ENV,
    HAGGLE_ENV: process.env.HAGGLE_ENV,
    VERCEL_ENV: process.env.VERCEL_ENV,
    HAGGLE_SUPABASE_JWT_MODE: process.env.HAGGLE_SUPABASE_JWT_MODE,
    HAGGLE_ALLOW_UNVERIFIED_TEST_JWT: process.env.HAGGLE_ALLOW_UNVERIFIED_TEST_JWT,
    SUPABASE_URL: process.env.SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_JWT_SECRET: process.env.SUPABASE_JWT_SECRET,
  };

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    delete process.env.HAGGLE_ENV;
    delete process.env.VERCEL_ENV;
    process.env.HAGGLE_SUPABASE_JWT_MODE = "test_unverified";
    process.env.HAGGLE_ALLOW_UNVERIFIED_TEST_JWT = "true";
    delete process.env.SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_JWT_SECRET;
    resetSupabaseJwtVerifierForTests();
    setMcpAccessTokenResolver(resolveMcpToken);

    db = createDb();
    app = Fastify({ logger: false });
    await app.register(authPlugin);
    registerPaymentRoutes(app, db as never);
    registerSettlementApprovalRoutes(app, db as never);
    registerClaimRoutes(app, db as never);
    registerNegotiationRoutes(
      app,
      db as never,
      { dispatch: eventDispatch, registerHandler: vi.fn() },
      { publish: notificationPublish },
    );
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    setMcpAccessTokenResolver(null);
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetSupabaseJwtVerifierForTests();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("blocks the PoC sequence before settlement, read, or payment side effects", async () => {
    const accept = await app.inject({
      method: "PATCH",
      url: `/negotiations/sessions/${SESSION_ID}/accept`,
      headers: bearer(MCP_TOKEN),
    });
    expect(accept.statusCode).toBe(403);
    expect(accept.json()).toEqual({ error: "MCP_TOKEN_NOT_ALLOWED" });
    expect(resolveMcpToken).toHaveBeenCalledWith(MCP_TOKEN);
    expectNoSideEffects(db);

    vi.clearAllMocks();
    const approval = await app.inject({
      method: "GET",
      url: `/settlement-approvals/${APPROVAL_ID}`,
      headers: bearer(MCP_TOKEN),
    });
    expect(approval.statusCode).toBe(403);
    expect(approval.json()).toEqual({ error: "MCP_TOKEN_NOT_ALLOWED" });
    expectNoSideEffects(db);

    vi.clearAllMocks();
    const prepare = await app.inject({
      method: "POST",
      url: "/payments/prepare",
      headers: bearer(MCP_TOKEN),
      payload: PREPARE_BODY,
    });
    expect(prepare.statusCode).toBe(403);
    expect(prepare.json()).toEqual({ error: "MCP_TOKEN_NOT_ALLOWED" });
    expectNoSideEffects(db);
  });

  it.each(PAYMENT_MUTATIONS)("MCP token denied on POST %s", async (url) => {
    const res = await app.inject({
      method: "POST",
      url,
      headers: bearer(MCP_TOKEN),
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "MCP_TOKEN_NOT_ALLOWED" });
    expectNoSideEffects(db);
  });

  it("MCP token cannot approve a settlement, claim, offer, or auto-play", async () => {
    const cases = [
      {
        method: "PATCH" as const,
        url: `/settlement-approvals/${APPROVAL_ID}/buyer-approve`,
        payload: {},
      },
      {
        method: "PATCH" as const,
        url: `/settlement-approvals/${APPROVAL_ID}/seller-approve`,
        payload: {},
      },
      { method: "POST" as const, url: "/api/claim", payload: { claimToken: "draft-token" } },
      {
        method: "POST" as const,
        url: "/claim/negotiation-sessions",
        payload: claimSessionsBody(),
      },
      {
        method: "POST" as const,
        url: `/negotiations/sessions/${SESSION_ID}/offers`,
        payload: OFFER_BODY,
      },
      {
        method: "POST" as const,
        url: `/negotiations/sessions/${SESSION_ID}/auto-play/next`,
        payload: {},
      },
    ];

    for (const entry of cases) {
      vi.clearAllMocks();
      const res = await app.inject({
        method: entry.method,
        url: entry.url,
        headers: bearer(MCP_TOKEN),
        payload: entry.payload,
      });
      expect(res.statusCode, entry.url).toBe(403);
      expect(res.json(), entry.url).toEqual({ error: "MCP_TOKEN_NOT_ALLOWED" });
      expectNoSideEffects(db);
    }
  });

  it("JWT users reach the same handlers and are not MCP-denied", async () => {
    const accept = await app.inject({
      method: "PATCH",
      url: `/negotiations/sessions/${SESSION_ID}/accept`,
      headers: bearer(TEST_USER_JWT),
    });
    expect(accept.statusCode).toBe(404);
    expect(accept.json().error).toBe("SESSION_NOT_FOUND");

    const approval = await app.inject({
      method: "GET",
      url: `/settlement-approvals/${APPROVAL_ID}`,
      headers: bearer(TEST_USER_JWT),
    });
    expect(approval.statusCode).toBe(404);
    expect(approval.json().error).toBe("APPROVAL_NOT_FOUND");

    const prepare = await app.inject({
      method: "POST",
      url: "/payments/prepare",
      headers: bearer(TEST_USER_JWT),
      payload: PREPARE_BODY,
    });
    expect(prepare.statusCode).toBe(404);
    expect(prepare.json().error).toBe("SETTLEMENT_APPROVAL_NOT_FOUND");

    const buyer = await app.inject({
      method: "PATCH",
      url: `/settlement-approvals/${APPROVAL_ID}/buyer-approve`,
      headers: bearer(TEST_USER_JWT),
    });
    expect(buyer.statusCode).toBe(404);
    expect(buyer.json().error).toBe("APPROVAL_NOT_FOUND");

    const seller = await app.inject({
      method: "PATCH",
      url: `/settlement-approvals/${APPROVAL_ID}/seller-approve`,
      headers: bearer(TEST_USER_JWT),
    });
    expect(seller.statusCode).toBe(404);
    expect(seller.json().error).toBe("APPROVAL_NOT_FOUND");

    const claim = await app.inject({
      method: "POST",
      url: "/api/claim",
      headers: bearer(TEST_USER_JWT),
      payload: { claimToken: "draft-token" },
    });
    expect(claim.statusCode).toBe(404);
    expect(claim.json().error).toBe("invalid_token");

    const claimSessions = await app.inject({
      method: "POST",
      url: "/claim/negotiation-sessions",
      headers: bearer(TEST_USER_JWT),
      payload: {},
    });
    expect(claimSessions.statusCode).toBe(400);
    expect(claimSessions.json().error).toBe("INVALID_BODY");

    const offer = await app.inject({
      method: "POST",
      url: `/negotiations/sessions/${SESSION_ID}/offers`,
      headers: bearer(TEST_USER_JWT),
      payload: OFFER_BODY,
    });
    expect(offer.statusCode).toBe(404);
    expect(offer.json().error).toBe("SESSION_NOT_FOUND");

    const autoPlay = await app.inject({
      method: "POST",
      url: `/negotiations/sessions/${SESSION_ID}/auto-play/next`,
      headers: bearer(TEST_USER_JWT),
      payload: {},
    });
    expect(autoPlay.statusCode).toBe(404);
    expect(autoPlay.json().error).toBe("SESSION_NOT_FOUND");

    const anonymousAutoPlay = await app.inject({
      method: "POST",
      url: `/negotiations/sessions/${SESSION_ID}/auto-play/next`,
      payload: {},
    });
    expect(anonymousAutoPlay.statusCode).toBe(404);
    expect(anonymousAutoPlay.json().error).toBe("SESSION_NOT_FOUND");
  });

  it.each(PAYMENT_MUTATIONS)("JWT user is not MCP-denied on POST %s", async (url) => {
    const res = await app.inject({
      method: "POST",
      url,
      headers: bearer(TEST_USER_JWT),
      payload: {},
    });
    expect(res.json().error).not.toBe("MCP_TOKEN_NOT_ALLOWED");
    if (ADMIN_PAYMENT_ROUTES.has(url)) {
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe("ADMIN_REQUIRED");
      return;
    }
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("PAYMENT_NOT_FOUND");
  });

  it("does not attach denyMcpToken to the hnp_accept MCP tool", () => {
    const src = readFileSync(new URL("../mcp/tools/index.ts", import.meta.url), "utf8");
    expect(src).toContain('"hnp_accept"');
    expect(src).toContain("applyHnpAccept");
    expect(src).not.toContain("denyMcpToken");
  });
});
