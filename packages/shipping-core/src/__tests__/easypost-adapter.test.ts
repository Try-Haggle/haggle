import { describe, expect, it, vi } from "vitest";
import type { LabelRequest } from "../provider.js";
import type { Shipment, ShipmentStatus } from "../types.js";

// ---------------------------------------------------------------------------
// Mock the @easypost/api module — we never want real API calls in tests
// ---------------------------------------------------------------------------
vi.mock("@easypost/api", () => {
  return {
    default: class EasyPostClient {
      Tracker = {
        create: async (params: any) => {
          const testStatuses: Record<string, string> = {
            EZ1000000001: "pre_transit",
            EZ2000000002: "in_transit",
            EZ3000000003: "out_for_delivery",
            EZ4000000004: "delivered",
          };
          const status = testStatuses[params.tracking_code] ?? "unknown";
          return {
            id: `trk_${status}`,
            tracking_code: params.tracking_code,
            status,
            carrier: params.carrier ?? "USPS",
            public_url: "https://track.example.com/mock",
            tracking_details: [
              {
                datetime: "2026-07-21T12:00:00.000Z",
                message: `Test tracker is ${status}`,
              },
            ],
          };
        },
      };
      Shipment = {
        create: async (_params: any) => ({
          id: "shp_mock",
          rates: [
            {
              id: "rate_1",
              rate: "5.50",
              carrier: "USPS",
              service: "GroundAdvantage",
            },
            {
              id: "rate_2",
              rate: "12.00",
              carrier: "USPS",
              service: "Priority",
            },
          ],
          lowestRate: () => ({
            id: "rate_1",
            rate: "5.50",
            carrier: "USPS",
            service: "GroundAdvantage",
          }),
        }),
        buy: async (shipmentId: string, _rate: any) => ({
          id: shipmentId,
          tracking_code: "EZMOCK123456",
          status: "pre_transit",
          tracker: { public_url: "https://track.example.com/EZMOCK123456" },
          postage_label: {
            label_url: "https://labels.example.com/EZMOCK123456.pdf",
          },
        }),
      };
    },
  };
});

import { EasyPostCarrierAdapter, mapEasyPostStatus } from "../easypost-adapter.js";
import { parseEasyPostWebhookPayload, verifyEasyPostWebhook } from "../easypost-webhook.js";

// ===========================================================================
// 1. mapEasyPostStatus
// ===========================================================================

describe("mapEasyPostStatus", () => {
  const cases: [string, ShipmentStatus][] = [
    ["pre_transit", "LABEL_CREATED"],
    ["in_transit", "IN_TRANSIT"],
    ["out_for_delivery", "OUT_FOR_DELIVERY"],
    ["delivered", "DELIVERED"],
    ["return_to_sender", "RETURN_IN_TRANSIT"],
    ["failure", "DELIVERY_EXCEPTION"],
    ["unknown", "IN_TRANSIT"],
    ["available_for_pickup", "OUT_FOR_DELIVERY"],
    ["error", "DELIVERY_EXCEPTION"],
  ];

  it.each(cases)('maps EasyPost status "%s" → "%s"', (easypostStatus, expectedCanonical) => {
    expect(mapEasyPostStatus(easypostStatus)).toBe(expectedCanonical);
  });

  it('falls back to "IN_TRANSIT" for an unrecognised status string', () => {
    expect(mapEasyPostStatus("some_future_status")).toBe("IN_TRANSIT");
  });

  it('falls back to "IN_TRANSIT" for an empty string', () => {
    expect(mapEasyPostStatus("")).toBe("IN_TRANSIT");
  });
});

// ===========================================================================
// 2. parseEasyPostWebhookPayload
// ===========================================================================

describe("parseEasyPostWebhookPayload", () => {
  it("parses a valid tracking update webhook payload", () => {
    const payload = {
      description: "tracker.updated",
      result: {
        id: "trk_abc123",
        tracking_code: "EP1234567890",
        status: "in_transit",
        carrier: "USPS",
        tracking_details: [
          {
            message: "Arrived at USPS facility",
            status: "in_transit",
            datetime: "2026-03-10T14:30:00Z",
            tracking_location: {
              city: "Los Angeles",
              state: "CA",
              country: "US",
            },
          },
        ],
        est_delivery_date: "2026-03-14T00:00:00Z",
      },
    };

    const result = parseEasyPostWebhookPayload(payload);
    expect(result).not.toBeNull();
    expect(result!.tracking_code).toBe("EP1234567890");
    expect(result!.status).toBe("IN_TRANSIT");
    expect(result!.carrier).toBe("USPS");
    expect(result!.est_delivery_date).toBe("2026-03-14T00:00:00Z");
    expect(result!.tracking_details).toHaveLength(1);
    expect(result!.tracking_details[0].city).toBe("Los Angeles");
    expect(result!.tracking_details[0].state).toBe("CA");
  });

  it("returns null when tracking_code is missing from result", () => {
    const payload = {
      description: "tracker.updated",
      result: {
        id: "trk_abc123",
        status: "in_transit",
        carrier: "USPS",
      },
    };
    expect(parseEasyPostWebhookPayload(payload)).toBeNull();
  });

  it("returns null for an empty payload", () => {
    expect(parseEasyPostWebhookPayload({})).toBeNull();
  });

  it("returns null when result is missing entirely", () => {
    const payload = { description: "tracker.updated" };
    expect(parseEasyPostWebhookPayload(payload)).toBeNull();
  });

  it("returns null when carrier is missing", () => {
    const payload = {
      description: "tracker.updated",
      result: {
        tracking_code: "EP0000000000",
        status: "in_transit",
        // no carrier
      },
    };
    expect(parseEasyPostWebhookPayload(payload)).toBeNull();
  });

  it("maps various statuses correctly through the payload", () => {
    const statuses: [string, ShipmentStatus][] = [
      ["pre_transit", "LABEL_CREATED"],
      ["delivered", "DELIVERED"],
      ["failure", "DELIVERY_EXCEPTION"],
      ["out_for_delivery", "OUT_FOR_DELIVERY"],
      ["return_to_sender", "RETURN_IN_TRANSIT"],
    ];

    for (const [epStatus, expected] of statuses) {
      const payload = {
        description: "tracker.updated",
        result: {
          id: "trk_test",
          tracking_code: "EP0000000000",
          status: epStatus,
          carrier: "USPS",
          tracking_details: [],
        },
      };
      const result = parseEasyPostWebhookPayload(payload);
      expect(result).not.toBeNull();
      expect(result!.status).toBe(expected);
    }
  });

  it("extracts tracking details with location", () => {
    const payload = {
      description: "tracker.updated",
      result: {
        id: "trk_abc",
        tracking_code: "EP1111111111",
        status: "in_transit",
        carrier: "FedEx",
        tracking_details: [
          {
            message: "Departed origin facility",
            status: "in_transit",
            datetime: "2026-03-09T08:00:00Z",
            tracking_location: { city: "Memphis", state: "TN" },
          },
          {
            message: "In transit to next facility",
            status: "in_transit",
            datetime: "2026-03-10T12:00:00Z",
            tracking_location: { city: "Dallas", state: "TX" },
          },
        ],
        est_delivery_date: "2026-03-12T00:00:00Z",
      },
    };

    const result = parseEasyPostWebhookPayload(payload);
    expect(result).not.toBeNull();
    expect(result!.tracking_details).toHaveLength(2);
    expect(result!.tracking_details[1].city).toBe("Dallas");
    expect(result!.tracking_details[1].state).toBe("TX");
  });

  it("handles payload with null result gracefully", () => {
    const payload = { description: "tracker.updated", result: null };
    expect(parseEasyPostWebhookPayload(payload as any)).toBeNull();
  });
});

// ===========================================================================
// 3. verifyEasyPostWebhook
// ===========================================================================

describe("verifyEasyPostWebhook", () => {
  const webhookSecret = "whsec_test_secret_key";

  it("returns true for a valid HMAC-SHA256 signature", async () => {
    const body = JSON.stringify({ description: "tracker.updated", result: {} });

    const crypto = await import("node:crypto");
    const hmac = crypto.createHmac("sha256", webhookSecret);
    hmac.update(body);
    const signature = hmac.digest("hex");

    const headers = { "x-hmac-signature": signature };
    expect(verifyEasyPostWebhook(body, headers, webhookSecret)).toBe(true);
  });

  it("returns true with hmac-sha256-hex= prefix", async () => {
    const body = JSON.stringify({ description: "test" });

    const crypto = await import("node:crypto");
    const hmac = crypto.createHmac("sha256", webhookSecret);
    hmac.update(body);
    const signature = `hmac-sha256-hex=${hmac.digest("hex")}`;

    const headers = { "x-hmac-signature": signature };
    expect(verifyEasyPostWebhook(body, headers, webhookSecret)).toBe(true);
  });

  it("returns true for a valid v2 signature with timestamp and path", async () => {
    const body = JSON.stringify({ description: "tracker.updated", result: {} });
    const timestamp = "Tue, 19 Aug 2025 20:37:09 -0000";
    const path = "/shipments/webhooks/easypost";
    const method = "POST";

    const crypto = await import("node:crypto");
    const hmac = crypto.createHmac("sha256", webhookSecret);
    hmac.update(`${timestamp}${method}${path}${body}`, "utf8");
    const signature = `hmac-sha256-hex=${hmac.digest("hex")}`;

    const headers = {
      "x-timestamp": timestamp,
      "x-path": path,
      "x-hmac-signature-v2": signature,
    };

    expect(
      verifyEasyPostWebhook(body, headers, webhookSecret, {
        method,
        now: new Date("2025-08-19T20:37:30Z"),
      }),
    ).toBe(true);
  });

  it("returns false for an expired v2 signature", async () => {
    const body = JSON.stringify({ description: "tracker.updated", result: {} });
    const timestamp = "Tue, 19 Aug 2025 20:37:09 -0000";
    const path = "/shipments/webhooks/easypost";

    const crypto = await import("node:crypto");
    const hmac = crypto.createHmac("sha256", webhookSecret);
    hmac.update(`${timestamp}POST${path}${body}`, "utf8");

    const headers = {
      "x-timestamp": timestamp,
      "x-path": path,
      "x-hmac-signature-v2": `hmac-sha256-hex=${hmac.digest("hex")}`,
    };

    expect(
      verifyEasyPostWebhook(body, headers, webhookSecret, {
        method: "POST",
        now: new Date("2025-08-19T20:39:30Z"),
      }),
    ).toBe(false);
  });

  it("returns false for a v2 signature with the wrong path", async () => {
    const body = JSON.stringify({ description: "tracker.updated", result: {} });
    const timestamp = "Tue, 19 Aug 2025 20:37:09 -0000";

    const crypto = await import("node:crypto");
    const hmac = crypto.createHmac("sha256", webhookSecret);
    hmac.update(`${timestamp}POST/other-path${body}`, "utf8");

    const headers = {
      "x-timestamp": timestamp,
      "x-path": "/shipments/webhooks/easypost",
      "x-hmac-signature-v2": `hmac-sha256-hex=${hmac.digest("hex")}`,
    };

    expect(
      verifyEasyPostWebhook(body, headers, webhookSecret, {
        method: "POST",
        now: new Date("2025-08-19T20:37:30Z"),
      }),
    ).toBe(false);
  });

  it("returns false for an invalid signature", () => {
    const body = JSON.stringify({ description: "tracker.updated", result: {} });
    const headers = {
      "x-hmac-signature": "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    };
    expect(verifyEasyPostWebhook(body, headers, webhookSecret)).toBe(false);
  });

  it("returns false when signature header is missing", () => {
    const body = JSON.stringify({ description: "tracker.updated" });
    expect(verifyEasyPostWebhook(body, {}, webhookSecret)).toBe(false);
  });

  it("returns false for empty signature", () => {
    const body = JSON.stringify({ description: "tracker.updated" });
    const headers = { "x-hmac-signature": "" };
    expect(verifyEasyPostWebhook(body, headers, webhookSecret)).toBe(false);
  });
});

// ===========================================================================
// 4. EasyPostCarrierAdapter — label generation
// ===========================================================================

describe("EasyPost test key detection", () => {
  it.each([
    ["EZTK_test_key", true],
    ["EZTEST_legacy_fixture", true],
    ["EZAK_production_key", false],
    ["", false],
  ])("classifies %s", async (apiKey, expected) => {
    const { isEasyPostTestApiKey } = await import("../easypost-adapter.js");
    expect(isEasyPostTestApiKey(apiKey)).toBe(expected);
  });
});

describe("EasyPostCarrierAdapter label generation", () => {
  const config = { api_key: "EZTK_test", is_test: true };
  const adapter = new EasyPostCarrierAdapter(config);

  const mockShipment: Shipment = {
    id: "shp_001",
    order_id: "ord_001",
    carrier: "easypost",
    status: "LABEL_PENDING",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    events: [],
  };

  const mockRequest: LabelRequest = {
    from_address: {
      name: "Seller",
      street1: "123 Main St",
      city: "LA",
      state: "CA",
      zip: "90001",
      country: "US",
    },
    to_address: {
      name: "Buyer",
      street1: "456 Oak Ave",
      city: "NYC",
      state: "NY",
      zip: "10001",
      country: "US",
    },
    parcel: { weight_oz: 16 },
  };

  it("creates label with tracking number and label URL", async () => {
    const result = await adapter.createLabel(mockShipment, mockRequest);
    expect(result.tracking_number).toBe("EZMOCK123456");
    expect(result.label_url).toBe("https://labels.example.com/EZMOCK123456.pdf");
    expect(result.tracking_url).toBe("https://track.example.com/EZMOCK123456");
  });

  it("selects cheapest rate by default", async () => {
    const result = await adapter.createLabel(mockShipment, mockRequest);
    expect(result.rate_minor).toBe(550); // $5.50 * 100
    expect(result.service).toBe("GroundAdvantage");
  });

  it("returns easypost metadata", async () => {
    const result = await adapter.createLabel(mockShipment, mockRequest);
    expect(result.metadata?.easypost_shipment_id).toBe("shp_mock");
    expect(result.metadata?.easypost_carrier).toBe("USPS");
  });

  it("falls back to tracker-only when no request provided", async () => {
    const shipmentWithTracking: Shipment = {
      ...mockShipment,
      tracking_number: "EXISTING123",
    };
    const result = await adapter.createLabel(shipmentWithTracking);
    expect(result.tracking_number).toBe("EXISTING123");
    expect(result.label_url).toBeUndefined();
  });

  it("throws when no request and no tracking number", async () => {
    await expect(adapter.createLabel(mockShipment)).rejects.toThrow(/no tracking_number/);
  });
});

describe("EasyPostCarrierAdapter test tracking", () => {
  it("verifies EasyPost's delivered test fixture", async () => {
    const adapter = new EasyPostCarrierAdapter({ api_key: "EZTK_test", is_test: true });
    const result = await adapter.trackTestStatus("delivered");

    expect(result.canonical_status).toBe("DELIVERED");
    expect(result.carrier_raw_status).toBe("delivered");
    expect(result.metadata).toMatchObject({
      easypost_tracker_id: "trk_delivered",
      easypost_test_tracking_code: "EZ4000000004",
      easypost_test_status_verified: true,
    });
  });

  it("rejects test fixtures when configured with a production key", async () => {
    const adapter = new EasyPostCarrierAdapter({ api_key: "EZAK_live", is_test: false });
    await expect(adapter.trackTestStatus("delivered")).rejects.toThrow(/requires a test API key/);
  });
});
