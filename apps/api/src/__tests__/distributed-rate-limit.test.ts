import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/api-rate-limit.service.js", () => ({
  consumeApiRateLimit: vi.fn(),
}));

import { createGlobalRateLimit } from "../middleware/rate-limit.js";
import { consumeApiRateLimit } from "../services/api-rate-limit.service.js";

const consume = vi.mocked(consumeApiRateLimit);

afterEach(() => consume.mockReset());

function buildApp() {
  const app = Fastify({ logger: false });
  app.addHook(
    "preHandler",
    createGlobalRateLimit({
      db: {} as never,
      config: { mode: "postgres", hmacSecret: "h".repeat(32) },
    }),
  );
  app.get("/limited", async () => ({ ok: true }));
  app.get("/health", async () => ({ status: "ok" }));
  return app;
}

describe("distributed global rate-limit hook", () => {
  it("uses the Fastify client IP and returns a bounded 429", async () => {
    consume.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 12,
      requestCount: 101,
    });
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/limited" });
    expect(response.statusCode).toBe(429);
    expect(response.headers["retry-after"]).toBe("12");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      error: "TOO_MANY_REQUESTS",
      retryAfter: 12,
    });
    expect(consume).toHaveBeenCalledWith(expect.anything(), {
      scope: "global_ip",
      identity: "127.0.0.1",
      hmacSecret: "h".repeat(32),
    });
    await app.close();
  });

  it("fails closed without leaking storage errors", async () => {
    consume.mockRejectedValue(new Error("postgres host and SQL details"));
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/limited" });
    expect(response.statusCode).toBe(503);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).not.toContain("postgres");
    expect(response.json()).toEqual({
      error: "RATE_LIMIT_SERVICE_UNAVAILABLE",
    });
    await app.close();
  });

  it("keeps liveness health independent of the limiter store", async () => {
    consume.mockRejectedValue(new Error("down"));
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    expect(consume).not.toHaveBeenCalled();
    await app.close();
  });
});
