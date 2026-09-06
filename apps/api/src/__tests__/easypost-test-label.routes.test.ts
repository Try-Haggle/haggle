import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShipmentRow } from "../services/shipment-record.service.js";
import { AUTH_HEADERS, closeTestApp, getTestApp } from "./helpers.js";

const mockGetShipmentById = vi.fn();

vi.mock("../services/shipment-record.service.js", async () => {
  const actual = await vi.importActual<typeof import("../services/shipment-record.service.js")>(
    "../services/shipment-record.service.js",
  );
  return {
    ...actual,
    getShipmentById: (...args: unknown[]) => mockGetShipmentById(...args),
  };
});

describe("POST /shipments/:id/test-label (A9)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await getTestApp();
  });

  afterAll(async () => {
    await closeTestApp();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects physical_live shipments on the one-step test-label path", async () => {
    const shipment = {
      id: "shp_physical_test_label",
      order_id: "ord_physical_test_label",
      seller_id: "test-user-001",
      buyer_id: "buyer-001",
      status: "LABEL_PENDING",
      carrier: "easypost",
      events: [],
      metadata: {
        shipping_execution_mode: "physical_live",
        shipping_provider_environment: "live",
      },
    } as unknown as ShipmentRow;
    mockGetShipmentById.mockResolvedValueOnce(shipment).mockResolvedValueOnce(shipment);

    const res = await app.inject({
      method: "POST",
      url: `/shipments/${shipment.id}/test-label`,
      headers: AUTH_HEADERS,
      payload: {},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "TEST_LABEL_FORBIDDEN_FOR_PHYSICAL_LIVE" });
  });

  it("returns 503 STAGING_LIVE_EASYPOST_KEYS_FORBIDDEN when staging candidate key is live", async () => {
    const shipment = {
      id: "shp_live_key_test_label",
      order_id: "ord_live_key_test_label",
      seller_id: "test-user-001",
      buyer_id: "buyer-001",
      status: "LABEL_PENDING",
      carrier: "easypost",
      events: [],
      metadata: {
        shipping_execution_mode: "integration_manual",
        shipping_provider_environment: "test",
      },
    } as unknown as ShipmentRow;
    mockGetShipmentById.mockResolvedValueOnce(shipment).mockResolvedValueOnce(shipment);

    const previous = {
      HAGGLE_ENV: process.env.HAGGLE_ENV,
      EASYPOST_TEST_API_KEY: process.env.EASYPOST_TEST_API_KEY,
      EASYPOST_API_KEY: process.env.EASYPOST_API_KEY,
      EASYPOST_LIVE_API_KEY: process.env.EASYPOST_LIVE_API_KEY,
    };
    process.env.HAGGLE_ENV = "staging";
    process.env.EASYPOST_TEST_API_KEY = "EZAK_live_misconfigured";
    delete process.env.EASYPOST_API_KEY;

    try {
      const res = await app.inject({
        method: "POST",
        url: `/shipments/${shipment.id}/test-label`,
        headers: AUTH_HEADERS,
        payload: {},
      });

      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({
        error: "STAGING_LIVE_EASYPOST_KEYS_FORBIDDEN",
      });
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
