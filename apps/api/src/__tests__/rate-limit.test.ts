import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  globalRateLimit,
  resetRateLimitsForTests,
} from "../middleware/rate-limit.js";

describe("global rate-limit client identity", () => {
  beforeEach(() => resetRateLimitsForTests());
  afterEach(() => resetRateLimitsForTests());

  it("does not let an untrusted X-Forwarded-For header rotate limiter keys", async () => {
    const app = Fastify();
    app.addHook("preHandler", globalRateLimit);
    app.get("/limited", async () => ({ ok: true }));
    await app.ready();

    for (let index = 0; index < 100; index += 1) {
      const response = await app.inject({
        method: "GET",
        url: "/limited",
        headers: { "x-forwarded-for": `203.0.113.${index % 250}` },
      });
      expect(response.statusCode).toBe(200);
    }
    const blocked = await app.inject({
      method: "GET",
      url: "/limited",
      headers: { "x-forwarded-for": "198.51.100.250" },
    });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers["retry-after"]).toBe("60");
    expect(blocked.json()).toMatchObject({ error: "TOO_MANY_REQUESTS" });
    await app.close();
  });

  it("uses forwarded client identity only behind an allowlisted proxy", async () => {
    const app = Fastify({ trustProxy: ["127.0.0.1"] });
    app.addHook("preHandler", globalRateLimit);
    app.get("/limited", async (request) => ({ ip: request.ip }));
    await app.ready();

    for (let index = 0; index < 100; index += 1) {
      const response = await app.inject({
        method: "GET", url: "/limited",
        headers: { "x-forwarded-for": "203.0.113.10" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ip: "203.0.113.10" });
    }
    expect((await app.inject({
      method: "GET", url: "/limited",
      headers: { "x-forwarded-for": "203.0.113.10" },
    })).statusCode).toBe(429);
    expect((await app.inject({
      method: "GET", url: "/limited",
      headers: { "x-forwarded-for": "203.0.113.11" },
    })).statusCode).toBe(200);
    await app.close();
  });
});
