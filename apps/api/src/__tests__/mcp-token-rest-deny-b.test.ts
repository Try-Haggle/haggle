import { buyerConfirmReceipt } from "@haggle/payment-core";
import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import authPlugin, { type AuthUser, setMcpAccessTokenResolver } from "../middleware/auth.js";
import { registerAddressRoutes } from "../routes/addresses.js";
import { registerDisputeRoutes } from "../routes/disputes.js";
import { registerGroupRoutes } from "../routes/groups.js";
import { registerMcpOauthRoutes } from "../routes/mcp-oauth.js";
import { registerNegotiationRoutes } from "../routes/negotiations.js";
import { registerOrderRoutes } from "../routes/orders.js";
import { registerReviewerRoutes } from "../routes/reviewer.js";
import { registerSettlementReleaseRoutes } from "../routes/settlement-releases.js";
import { registerShipmentRoutes } from "../routes/shipments.js";
import { registerWalletRoutes } from "../routes/wallets.js";
import { evaluateDisputePanel } from "../services/dispute-panel-evaluate.service.js";
import {
  exchangeMcpAuthorizationCode,
  issueMcpAuthorizationCode,
  refreshMcpAccessToken,
} from "../services/mcp-oauth.service.js";
import { updateSettlementReleaseRecord } from "../services/settlement-release.service.js";
import { resetSupabaseJwtVerifierForTests } from "../services/supabase-jwt.service.js";
import { TEST_USER_JWT } from "./helpers.js";

/**
 * A1 follow-up: MCP OAuth tokens are denied on the additional fund-moving,
 * consent, address, shipment, dispute, and negotiation routes before side effects.
 */

vi.mock("@haggle/payment-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@haggle/payment-core")>();
  return {
    ...actual,
    buyerConfirmReceipt: vi.fn(actual.buyerConfirmReceipt),
  };
});

vi.mock("../services/settlement-release.service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/settlement-release.service.js")>();
  return {
    ...actual,
    updateSettlementReleaseRecord: vi.fn(actual.updateSettlementReleaseRecord),
  };
});

vi.mock("../services/dispute-panel-evaluate.service.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/dispute-panel-evaluate.service.js")>();
  return {
    ...actual,
    evaluateDisputePanel: vi.fn(actual.evaluateDisputePanel),
  };
});

vi.mock("../services/mcp-oauth.service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/mcp-oauth.service.js")>();
  return {
    ...actual,
    issueMcpAuthorizationCode: vi.fn(actual.issueMcpAuthorizationCode),
    exchangeMcpAuthorizationCode: vi.fn(actual.exchangeMcpAuthorizationCode),
    refreshMcpAccessToken: vi.fn(actual.refreshMcpAccessToken),
  };
});

const MCP_TOKEN = "mcp-listings-oauth-access-token";
const MCP_USER: AuthUser = {
  id: "mcp-user-001",
  role: "user",
  tokenKind: "mcp",
  scopes: ["listings"],
};

const ORDER_ID = "order-poc";
const DISPUTE_ID = "dispute-poc";
const RELEASE_ID = "release-poc";
const SESSION_ID = "sess-poc";
const GROUP_ID = "group-poc";
const SHIPMENT_ID = "shipment-poc";
const WALLET_ID = "wallet-poc";

const CONSENT_BODY = {
  client_id: "mcp_client_poc",
  redirect_uri: "https://client.example/callback",
  code_challenge: "a".repeat(43),
  code_challenge_method: "S256",
  scope: "listings",
  state: "xyz",
};

type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

type GuardedRoute = {
  id: string;
  method: HttpMethod;
  url: string;
  payload?: Record<string, unknown>;
  jwtStatus: number;
  jwtError: string | null;
};

const GUARDED_ROUTES: GuardedRoute[] = [
  {
    id: "b1-confirm-delivery",
    method: "POST",
    url: `/orders/${ORDER_ID}/confirm-delivery`,
    payload: { confirmed: true },
    jwtStatus: 404,
    jwtError: "ORDER_NOT_FOUND",
  },
  {
    id: "fulfillment-confirm",
    method: "POST",
    url: `/orders/${ORDER_ID}/fulfillment/confirm`,
    payload: { confirmation: "access_received" },
    jwtStatus: 404,
    jwtError: "ORDER_NOT_FOUND",
  },
  {
    id: "fulfillment-proofs",
    method: "POST",
    url: `/orders/${ORDER_ID}/fulfillment/proofs`,
    payload: { kind: "link", uri: "https://example.com/proof" },
    jwtStatus: 404,
    jwtError: "ORDER_NOT_FOUND",
  },
  {
    id: "b2-oauth-consent",
    method: "POST",
    url: "/oauth/consent",
    payload: CONSENT_BODY,
    jwtStatus: 400,
    jwtError: "UNKNOWN_CLIENT",
  },
  {
    id: "order-address-post",
    method: "POST",
    url: `/orders/${ORDER_ID}/addresses`,
    payload: {
      role: "buyer",
      name: "Ada",
      street1: "1 Main",
      city: "Austin",
      state: "TX",
      zip: "78701",
    },
    jwtStatus: 404,
    jwtError: "ORDER_NOT_FOUND",
  },
  {
    id: "order-address-get",
    method: "GET",
    url: `/orders/${ORDER_ID}/addresses`,
    jwtStatus: 404,
    jwtError: "ORDER_NOT_FOUND",
  },
  {
    id: "me-addresses",
    method: "GET",
    url: "/users/me/addresses",
    jwtStatus: 200,
    jwtError: null,
  },
  {
    id: "shipments-post",
    method: "POST",
    url: "/shipments",
    payload: {},
    jwtStatus: 400,
    jwtError: "INVALID_SHIPMENT_REQUEST",
  },
  {
    id: "apv-adjustment-decision",
    method: "POST",
    url: "/shipments/apv-adjustments/adjustment-poc/decision",
    payload: {},
    jwtStatus: 403,
    jwtError: "ADMIN_REQUIRED",
  },
  {
    id: "apv-revision-decision",
    method: "POST",
    url: "/shipments/apv-revisions/revision-poc/decision",
    payload: {},
    jwtStatus: 403,
    jwtError: "ADMIN_REQUIRED",
  },
  {
    id: "order-disputes",
    method: "POST",
    url: `/orders/${ORDER_ID}/disputes`,
    payload: {},
    jwtStatus: 400,
    jwtError: "INVALID_DISPUTE_REQUEST",
  },
  {
    id: "disputes-post",
    method: "POST",
    url: "/disputes",
    payload: {},
    jwtStatus: 400,
    jwtError: "INVALID_DISPUTE_REQUEST",
  },
  {
    id: "dispute-close",
    method: "POST",
    url: `/disputes/${DISPUTE_ID}/close`,
    payload: {},
    jwtStatus: 404,
    jwtError: "DISPUTE_NOT_FOUND",
  },
  {
    id: "dispute-deposit",
    method: "POST",
    url: `/disputes/${DISPUTE_ID}/deposit`,
    payload: {},
    jwtStatus: 404,
    jwtError: "DISPUTE_NOT_FOUND",
  },
  {
    id: "dispute-deposit-usdc",
    method: "POST",
    url: `/disputes/${DISPUTE_ID}/deposit/confirm-usdc`,
    payload: {},
    jwtStatus: 404,
    jwtError: "DISPUTE_NOT_FOUND",
  },
  {
    id: "conditional-release-request",
    method: "POST",
    url: `/settlement-releases/${RELEASE_ID}/conditional-release-request`,
    payload: {},
    jwtStatus: 404,
    jwtError: "SETTLEMENT_RELEASE_NOT_FOUND",
  },
  {
    id: "conditional-release-execution",
    method: "POST",
    url: `/settlement-releases/${RELEASE_ID}/conditional-release-execution`,
    payload: {},
    jwtStatus: 404,
    jwtError: "SETTLEMENT_RELEASE_NOT_FOUND",
  },
  {
    id: "conditional-release-confirmation",
    method: "POST",
    url: `/settlement-releases/${RELEASE_ID}/conditional-release-confirmation`,
    payload: {},
    jwtStatus: 404,
    jwtError: "SETTLEMENT_RELEASE_NOT_FOUND",
  },
  {
    id: "reject",
    method: "PATCH",
    url: `/negotiations/sessions/${SESSION_ID}/reject`,
    payload: {},
    jwtStatus: 404,
    jwtError: "SESSION_NOT_FOUND",
  },
  {
    id: "control-mode",
    method: "PATCH",
    url: `/negotiations/sessions/${SESSION_ID}/control-mode`,
    payload: { control_mode: "manual" },
    jwtStatus: 404,
    jwtError: "SESSION_NOT_FOUND",
  },
  {
    id: "create-session",
    method: "POST",
    url: "/negotiations/sessions",
    payload: {},
    jwtStatus: 400,
    jwtError: "INVALID_SESSION_REQUEST",
  },
  {
    id: "start",
    method: "POST",
    url: "/negotiations/start",
    payload: {},
    jwtStatus: 400,
    jwtError: "INVALID_START_REQUEST",
  },
  {
    id: "pause-answer",
    method: "POST",
    url: `/negotiations/sessions/${SESSION_ID}/pause/answer`,
    payload: {},
    jwtStatus: 404,
    jwtError: "SESSION_NOT_FOUND",
  },
  {
    id: "orchestrate",
    method: "POST",
    url: `/negotiations/groups/${GROUP_ID}/orchestrate`,
    payload: {},
    jwtStatus: 404,
    jwtError: "GROUP_NOT_FOUND",
  },
  {
    id: "group-cancel",
    method: "PATCH",
    url: `/negotiations/groups/${GROUP_ID}/cancel`,
    payload: {},
    jwtStatus: 404,
    jwtError: "GROUP_NOT_FOUND",
  },
  {
    id: "bl1-buyer-confirm",
    method: "POST",
    url: `/settlement-releases/by-order/${ORDER_ID}/buyer-confirm`,
    payload: {},
    jwtStatus: 404,
    jwtError: "ORDER_NOT_FOUND",
  },
  {
    id: "complete-test-buffer",
    method: "POST",
    url: `/settlement-releases/by-order/${ORDER_ID}/complete-test-buffer`,
    payload: {},
    jwtStatus: 404,
    jwtError: "ORDER_NOT_FOUND",
  },
  {
    id: "wallets-post",
    method: "POST",
    url: "/wallets",
    payload: {},
    jwtStatus: 400,
    jwtError: "INVALID_WALLET_REQUEST",
  },
  {
    id: "wallets-delete",
    method: "DELETE",
    url: `/wallets/${WALLET_ID}`,
    jwtStatus: 404,
    jwtError: "WALLET_NOT_FOUND",
  },
  {
    id: "shipment-event",
    method: "POST",
    url: `/shipments/${SHIPMENT_ID}/event`,
    payload: {},
    jwtStatus: 404,
    jwtError: "SHIPMENT_NOT_FOUND",
  },
  {
    id: "reviewer-vote",
    method: "POST",
    url: `/reviewer/assignments/${DISPUTE_ID}/vote`,
    payload: {},
    jwtStatus: 400,
    jwtError: "INVALID_VOTE",
  },
];

const GUEST_ROUTES: GuardedRoute[] = [
  {
    id: "guest-start",
    method: "POST",
    url: "/negotiations/start",
    payload: {},
    jwtStatus: 400,
    jwtError: "INVALID_START_REQUEST",
  },
  {
    id: "guest-pause-answer",
    method: "POST",
    url: `/negotiations/sessions/${SESSION_ID}/pause/answer`,
    payload: {},
    jwtStatus: 404,
    jwtError: "SESSION_NOT_FOUND",
  },
];

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
  const del = vi.fn(() => {
    const result = Promise.resolve([] as unknown[]);
    const query: Record<string, unknown> = {};
    const self = () => query;
    for (const method of ["where", "returning"]) {
      query[method] = vi.fn(self);
    }
    // biome-ignore lint/suspicious/noThenProperty: Drizzle query mocks must remain awaitable.
    query.then = result.then.bind(result);
    query.catch = result.catch.bind(result);
    query.finally = result.finally.bind(result);
    return query;
  });
  const execute = vi.fn(async () => ({ rowCount: 0, rows: [] }));
  const query = new Proxy(
    {},
    {
      get: () => ({ findFirst, findMany }),
    },
  );
  return {
    query,
    select,
    insert,
    update,
    delete: del,
    execute,
    findFirst,
    findMany,
    transaction: vi.fn(),
  };
}

type TrackingDb = ReturnType<typeof createDb>;

function expectNoSideEffects(db: TrackingDb) {
  expect(db.findFirst).not.toHaveBeenCalled();
  expect(db.findMany).not.toHaveBeenCalled();
  expect(db.select).not.toHaveBeenCalled();
  expect(db.insert).not.toHaveBeenCalled();
  expect(db.update).not.toHaveBeenCalled();
  expect(db.delete).not.toHaveBeenCalled();
  expect(db.execute).not.toHaveBeenCalled();
  expect(db.transaction).not.toHaveBeenCalled();
  expect(eventDispatch).not.toHaveBeenCalled();
  expect(notificationPublish).not.toHaveBeenCalled();
}

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function injectRoute(
  app: FastifyInstance,
  route: Pick<GuardedRoute, "method" | "url" | "payload">,
  headers?: Record<string, string>,
) {
  return app.inject({
    method: route.method,
    url: route.url,
    headers,
    ...(route.payload !== undefined ? { payload: route.payload } : {}),
  });
}

describe("MCP token REST deny (additional routes)", () => {
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
    const dispatcher = { dispatch: eventDispatch, registerHandler: vi.fn() };
    registerOrderRoutes(app, db as never);
    registerAddressRoutes(app, db as never);
    registerShipmentRoutes(app, db as never);
    registerDisputeRoutes(app, db as never);
    registerSettlementReleaseRoutes(app, db as never);
    registerWalletRoutes(app, db as never);
    registerReviewerRoutes(app, db as never);
    registerMcpOauthRoutes(app, db as never);
    registerNegotiationRoutes(app, db as never, dispatcher, { publish: notificationPublish });
    registerGroupRoutes(app, db as never, dispatcher);
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

  it.each(GUARDED_ROUTES)("MCP token denied on $method $url", async (route) => {
    const res = await injectRoute(app, route, bearer(MCP_TOKEN));
    expect(res.statusCode, route.id).toBe(403);
    expect(res.json(), route.id).toEqual({ error: "MCP_TOKEN_NOT_ALLOWED" });
    expect(res.json(), route.id).not.toHaveProperty("code");
    expect(res.json(), route.id).not.toHaveProperty("redirect_to");
    expect(resolveMcpToken, route.id).toHaveBeenCalledWith(MCP_TOKEN);
    expectNoSideEffects(db);

    if (route.id === "b1-confirm-delivery" || route.id === "bl1-buyer-confirm") {
      expect(buyerConfirmReceipt).not.toHaveBeenCalled();
      expect(updateSettlementReleaseRecord).not.toHaveBeenCalled();
    }
    if (route.id === "wallets-post" || route.id === "wallets-delete") {
      expect(db.insert).not.toHaveBeenCalled();
      expect(db.delete).not.toHaveBeenCalled();
    }
    if (route.id === "reviewer-vote") {
      expect(db.select).not.toHaveBeenCalled();
      expect(db.update).not.toHaveBeenCalled();
      expect(evaluateDisputePanel).not.toHaveBeenCalled();
    }
    if (route.id === "b2-oauth-consent") {
      expect(issueMcpAuthorizationCode).not.toHaveBeenCalled();
      expect(exchangeMcpAuthorizationCode).not.toHaveBeenCalled();
      expect(refreshMcpAccessToken).not.toHaveBeenCalled();
    }
  });

  it.each(GUARDED_ROUTES)("JWT user is not MCP-denied on $method $url", async (route) => {
    const res = await injectRoute(app, route, bearer(TEST_USER_JWT));
    const body = res.json() as { error?: string; addresses?: unknown };
    expect(body.error, route.id).not.toBe("MCP_TOKEN_NOT_ALLOWED");
    expect(res.statusCode, route.id).toBe(route.jwtStatus);
    if (route.jwtError) {
      expect(body.error, route.id).toBe(route.jwtError);
    } else {
      expect(body, route.id).toEqual({ addresses: [] });
    }
    if (route.id === "b2-oauth-consent") {
      expect(body).not.toHaveProperty("code");
      expect(body).not.toHaveProperty("redirect_to");
      expect(issueMcpAuthorizationCode).toHaveBeenCalledTimes(1);
      expect(exchangeMcpAuthorizationCode).not.toHaveBeenCalled();
      expect(refreshMcpAccessToken).not.toHaveBeenCalled();
    }
  });

  it.each(GUEST_ROUTES)("guest $method $url is unchanged and not MCP-denied", async (route) => {
    const res = await injectRoute(app, route);
    const body = res.json() as { error?: string };
    expect(body.error, route.id).not.toBe("MCP_TOKEN_NOT_ALLOWED");
    expect(res.statusCode, route.id).toBe(route.jwtStatus);
    expect(body.error, route.id).toBe(route.jwtError);
    expect(issueMcpAuthorizationCode).not.toHaveBeenCalled();
    expect(buyerConfirmReceipt).not.toHaveBeenCalled();
    expect(updateSettlementReleaseRecord).not.toHaveBeenCalled();
  });
});
