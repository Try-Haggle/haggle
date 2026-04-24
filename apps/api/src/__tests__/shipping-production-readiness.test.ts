import fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerShipmentRoutes } from "../routes/shipments.js";

const originalEnv = {
  EASYPOST_API_KEY: process.env.EASYPOST_API_KEY,
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
    update: () => ({ set: () => ({ where: async () => [] }) }),
    insert: () => ({ values: async () => undefined }),
    delete: () => ({ where: async () => undefined }),
  };
}

describe("shipping production readiness", () => {
  it("does not return mock rates in production when EasyPost is not configured", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.EASYPOST_API_KEY;

    const app = fastify();
    app.addHook("onRequest", async (request) => {
      request.user = { id: "seller_1", role: "authenticated" };
    });
    registerShipmentRoutes(app, buildDb() as never);
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/shipments/rates",
      payload: {
        from_address: {
          name: "Seller",
          street1: "1 Market St",
          city: "San Francisco",
          state: "CA",
          zip: "94105",
          country: "US",
        },
        to_address: {
          name: "Buyer",
          street1: "2 Main St",
          city: "Denver",
          state: "CO",
          zip: "80202",
          country: "US",
        },
        parcel: {
          weight_oz: 16,
        },
      },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe("REAL_SHIPPING_PROVIDER_UNAVAILABLE");

    await app.close();
  });

  it("does not accept generic carrier webhooks in production", async () => {
    process.env.NODE_ENV = "production";

    const app = fastify();
    registerShipmentRoutes(app, buildDb() as never);
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/shipments/webhooks/unknown-carrier",
      payload: { hello: "world" },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("CARRIER_WEBHOOK_NOT_CONFIGURED");

    await app.close();
  });
});
