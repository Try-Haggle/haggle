import type { Database } from "@haggle/db";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { createWebSocketTicketPreValidation } from "../middleware/websocket-ticket-auth.js";
import { registerWebSocketAuthRoutes } from "../routes/websocket-auth.js";

const USER_ID = "00000000-0000-4000-a000-000000000010";

function dbWith(executeResults: unknown[][], error?: Error) {
  const execute = vi.fn().mockImplementation(async () => {
    if (error) throw error;
    return executeResults.shift() ?? [];
  });
  const transaction = vi.fn(async (fn: (tx: { execute: typeof execute }) => unknown) =>
    fn({ execute }),
  );
  return { execute, transaction } as unknown as Database;
}

describe("WebSocket ticket HTTP boundary", () => {
  it("issues a no-store notification ticket for an authenticated user", async () => {
    const app = Fastify();
    app.addHook("onRequest", async (request) => {
      request.user = { id: USER_ID, role: "authenticated" };
    });
    registerWebSocketAuthRoutes(
      app,
      dbWith([[], [], [], [{ expires_at: new Date(Date.now() + 30_000) }]]),
    );
    const response = await app.inject({
      method: "POST",
      url: "/auth/websocket-tickets",
      payload: { channel: "notification" },
    });
    expect(response.statusCode).toBe(201);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      schema_version: "websocket-auth-ticket-v1",
      channel: "notification",
      expires_in_seconds: 30,
    });
    expect(response.json().ticket_protocol).toMatch(/^haggle-ticket\.[A-Za-z0-9_-]{43}$/);
    await app.close();
  });

  it("rejects unauthenticated, extra-field, and non-participant requests", async () => {
    const anonymous = Fastify();
    registerWebSocketAuthRoutes(anonymous, dbWith([]));
    expect(
      (
        await anonymous.inject({
          method: "POST",
          url: "/auth/websocket-tickets",
          payload: { channel: "notification" },
        })
      ).statusCode,
    ).toBe(401);
    await anonymous.close();

    const app = Fastify();
    app.addHook("onRequest", async (request) => {
      request.user = { id: USER_ID };
    });
    registerWebSocketAuthRoutes(app, dbWith([[]]));
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/auth/websocket-tickets",
          payload: { channel: "notification", session_id: USER_ID },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/auth/websocket-tickets",
          payload: { channel: "negotiation", session_id: "11111111-1111-4111-8111-111111111111" },
        })
      ).statusCode,
    ).toBe(403);
    await app.close();
  });

  it("redacts ticket issuance storage failures", async () => {
    const errors = vi.fn();
    const app = Fastify();
    app.log.error = errors as typeof app.log.error;
    app.addHook("onRequest", async (request) => {
      request.user = { id: USER_ID };
    });
    registerWebSocketAuthRoutes(app, dbWith([], new Error("postgresql://secret-host/ticket")));
    const response = await app.inject({
      method: "POST",
      url: "/auth/websocket-tickets",
      payload: { channel: "notification" },
    });
    expect(response.statusCode).toBe(503);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).not.toContain("secret-host");
    expect(errors).toHaveBeenCalled();
    await app.close();
  });

  it("consumes a matching ticket before the handler runs", async () => {
    const app = Fastify();
    app.get(
      "/probe",
      {
        preValidation: createWebSocketTicketPreValidation(
          dbWith([[{ user_id: USER_ID }]]),
          "notification",
        ),
      },
      async (request) => ({ user_id: request.wsTicketUserId }),
    );
    const response = await app.inject({
      method: "GET",
      url: "/probe",
      headers: { "sec-websocket-protocol": `haggle-ticket.${"a".repeat(43)}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ user_id: USER_ID });
    expect(response.headers["cache-control"]).toBe("no-store");
    await app.close();
  });

  it("rejects an untrusted browser origin before consuming its ticket", async () => {
    const db = dbWith([[{ user_id: USER_ID }]]);
    const execute = vi.mocked(db.execute);
    const app = Fastify();
    app.get(
      "/probe",
      {
        preValidation: createWebSocketTicketPreValidation(db, "notification"),
      },
      async (request) => ({ user_id: request.wsTicketUserId }),
    );
    const protocol = `haggle-ticket.${"a".repeat(43)}`;
    const denied = await app.inject({
      method: "GET",
      url: "/probe",
      headers: { origin: "https://evil.example", "sec-websocket-protocol": protocol },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.headers["cache-control"]).toBe("no-store");
    expect(denied.json()).toEqual({ error: "WEBSOCKET_ORIGIN_FORBIDDEN" });
    expect(execute).not.toHaveBeenCalled();

    const allowed = await app.inject({
      method: "GET",
      url: "/probe",
      headers: { origin: "http://127.0.0.1:4177", "sec-websocket-protocol": protocol },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toEqual({ user_id: USER_ID });
    expect(execute).toHaveBeenCalledOnce();
    await app.close();
  });

  it("fails invalid, replayed, and unavailable stores before upgrade", async () => {
    const invalid = Fastify();
    invalid.get(
      "/probe",
      {
        preValidation: createWebSocketTicketPreValidation(dbWith([[]]), "notification"),
      },
      async () => ({ ok: true }),
    );
    expect((await invalid.inject({ method: "GET", url: "/probe" })).statusCode).toBe(401);
    const replayed = await invalid.inject({
      method: "GET",
      url: "/probe",
      headers: { "sec-websocket-protocol": `haggle-ticket.${"a".repeat(43)}` },
    });
    expect(replayed.statusCode).toBe(401);
    expect(replayed.headers["cache-control"]).toBe("no-store");
    await invalid.close();

    const errors = vi.fn();
    const unavailable = Fastify();
    unavailable.log.error = errors as typeof unavailable.log.error;
    unavailable.get(
      "/probe",
      {
        preValidation: createWebSocketTicketPreValidation(
          dbWith([], new Error("postgresql://secret")),
          "notification",
        ),
      },
      async () => ({ ok: true }),
    );
    const failed = await unavailable.inject({
      method: "GET",
      url: "/probe",
      headers: { "sec-websocket-protocol": `haggle-ticket.${"b".repeat(43)}` },
    });
    expect(failed.statusCode).toBe(503);
    expect(failed.body).not.toContain("postgresql");
    expect(errors).toHaveBeenCalled();
    await unavailable.close();
  });
});
