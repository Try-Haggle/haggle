import fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerAuthenticationRoutes } from "../routes/authentications.js";

const originalEnv = {
  LEGITAPP_API_KEY: process.env.LEGITAPP_API_KEY,
  NODE_ENV: process.env.NODE_ENV,
};

afterEach(() => {
  for (const key of Object.keys(originalEnv) as Array<keyof typeof originalEnv>) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

function buildDb() {
  return {
    query: {},
    insert: () => ({ values: () => ({ returning: async () => [] }) }),
    update: () => ({ set: () => ({ where: async () => [] }) }),
  };
}

describe("authentication production readiness", () => {
  it("does not use mock authentication provider in production", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.LEGITAPP_API_KEY;

    const app = fastify();
    app.addHook("onRequest", async (request) => {
      request.user = { id: "seller_1", role: "authenticated" };
    });
    registerAuthenticationRoutes(app, buildDb() as never);
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/authentications",
      payload: {
        listing_id: "listing_1",
        category: "electronics",
        requester: "seller",
        cost_minor: 1000,
      },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe("AUTH_PROVIDER_NOT_CONFIGURED");

    await app.close();
  });
});
