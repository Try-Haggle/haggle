import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../middleware/auth.js";
import { mintGuestBuyerClaimPop } from "../services/guest-buyer-claim-pop.service.js";

vi.mock("@haggle/db", () => {
  const join = (parts: unknown[], sep: { raw: string }) => ({
    __op: "join",
    parts,
    sep,
  });
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => ({
    raw: strings.join("?"),
    values,
  });
  return {
    sql: Object.assign(tag, { join }),
  };
});

vi.mock("../services/draft.service.js", () => ({
  claimListing: vi.fn(),
}));

import { registerClaimRoutes } from "../routes/claim.js";

interface FakeDb {
  execute: ReturnType<typeof vi.fn>;
}

function buildApp(db: FakeDb, user?: AuthUser) {
  const app = Fastify();
  app.decorateRequest("user", undefined);
  app.addHook("onRequest", async (request) => {
    request.user = user;
  });
  registerClaimRoutes(app, db as unknown as import("@haggle/db").Database);
  return app;
}

const USER: AuthUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "u@h.test",
  role: "user",
};

const VALID_GUEST_A = "33333333-3333-4333-8333-333333333333";
const VALID_GUEST_B = "44444444-4444-4444-8444-444444444444";
const POP_SECRET = "t".repeat(32);

function popFor(guestBuyerId: string): string {
  return mintGuestBuyerClaimPop(guestBuyerId, POP_SECRET);
}

function claimsPayload(entries: Array<{ guest_buyer_id: string; pop?: string }>): {
  guest_buyer_claims: Array<{ guest_buyer_id: string; pop: string }>;
} {
  return {
    guest_buyer_claims: entries.map((e) => ({
      guest_buyer_id: e.guest_buyer_id,
      pop: e.pop ?? popFor(e.guest_buyer_id),
    })),
  };
}

let db: FakeDb;
beforeEach(() => {
  db = { execute: vi.fn() };
  process.env.GUEST_BUYER_CLAIM_POP_SECRET = POP_SECRET;
});

describe("POST /claim/negotiation-sessions", () => {
  it("requires auth", async () => {
    const app = buildApp(db);
    const res = await app.inject({
      method: "POST",
      url: "/claim/negotiation-sessions",
      payload: claimsPayload([{ guest_buyer_id: VALID_GUEST_A }]),
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("rejects body without guest_buyer_claims array", async () => {
    const app = buildApp(db, USER);
    const res = await app.inject({
      method: "POST",
      url: "/claim/negotiation-sessions",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_BODY");
    await app.close();
  });

  it("rejects guest_buyer_ids-only body (knowledge alone must not claim)", async () => {
    const app = buildApp(db, USER);
    const res = await app.inject({
      method: "POST",
      url: "/claim/negotiation-sessions",
      payload: { guest_buyer_ids: [VALID_GUEST_A] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_BODY");
    expect(db.execute).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects claim without PoP field", async () => {
    const app = buildApp(db, USER);
    const res = await app.inject({
      method: "POST",
      url: "/claim/negotiation-sessions",
      payload: {
        guest_buyer_claims: [{ guest_buyer_id: VALID_GUEST_A }],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_BODY");
    expect(db.execute).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects claim with invalid PoP (reject-without-valid-PoP)", async () => {
    const app = buildApp(db, USER);
    const res = await app.inject({
      method: "POST",
      url: "/claim/negotiation-sessions",
      payload: claimsPayload([{ guest_buyer_id: VALID_GUEST_A, pop: "x".repeat(43) }]),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("POP_REQUIRED");
    expect(db.execute).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects non-uuid entries", async () => {
    const app = buildApp(db, USER);
    const res = await app.inject({
      method: "POST",
      url: "/claim/negotiation-sessions",
      payload: claimsPayload([{ guest_buyer_id: "not-a-uuid", pop: "x".repeat(43) }]),
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("returns ok with 0 when the caller's own id is the only entry", async () => {
    const app = buildApp(db, USER);
    const res = await app.inject({
      method: "POST",
      url: "/claim/negotiation-sessions",
      payload: claimsPayload([{ guest_buyer_id: USER.id }]),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, claimed_count: 0 });
    // No SQL should have run.
    expect(db.execute).not.toHaveBeenCalled();
    await app.close();
  });

  it("executes an UPDATE and returns the rowCount on success-with-PoP", async () => {
    db.execute.mockResolvedValueOnce({ rowCount: 2 });
    const app = buildApp(db, USER);
    const res = await app.inject({
      method: "POST",
      url: "/claim/negotiation-sessions",
      payload: claimsPayload([
        { guest_buyer_id: VALID_GUEST_A },
        { guest_buyer_id: VALID_GUEST_B },
      ]),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, claimed_count: 2 });
    expect(db.execute).toHaveBeenCalledTimes(1);
    const statement = db.execute.mock.calls[0]?.[0] as { raw?: string };
    expect(statement.raw).toContain("UPDATE negotiation_sessions");
    expect(statement.raw).toContain("UPDATE settlement_approvals");
    expect(statement.raw).toContain("FROM commerce_orders");
    expect(statement.raw).not.toContain("UPDATE commerce_orders");
    await app.close();
  });

  it("returns the claimed session count from the atomic claim statement", async () => {
    db.execute.mockResolvedValueOnce([{ claimed_count: 2, claimed_approval_count: 1 }]);
    const app = buildApp(db, USER);
    const res = await app.inject({
      method: "POST",
      url: "/claim/negotiation-sessions",
      payload: claimsPayload([
        { guest_buyer_id: VALID_GUEST_A },
        { guest_buyer_id: VALID_GUEST_B },
      ]),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, claimed_count: 2 });
    await app.close();
  });

  it("rejects more than 64 claims", async () => {
    const ids = Array.from(
      { length: 65 },
      (_, i) => `${"0".repeat(8 - String(i).length)}${i}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
    );
    const app = buildApp(db, USER);
    const res = await app.inject({
      method: "POST",
      url: "/claim/negotiation-sessions",
      payload: claimsPayload(ids.map((guest_buyer_id) => ({ guest_buyer_id }))),
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
