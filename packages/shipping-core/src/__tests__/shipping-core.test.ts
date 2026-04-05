import { describe, it, expect, beforeEach } from "vitest";
import { transitionShipmentStatus } from "../state-machine.js";
import {
  computeShipmentInputDueAt,
  checkShipmentInputSla,
  checkSellerFulfillment,
  DEFAULT_SLA_CONFIG,
} from "../sla.js";
import { ShippingService } from "../service.js";
import { MockCarrierAdapter } from "../mock-carrier-adapter.js";
import {
  trustTriggersForShipmentSlaMiss,
  trustTriggersForSellerFulfillmentFailure,
} from "../trust-events.js";
import {
  checkEscalation,
  DEFAULT_ESCALATION_CONFIG,
} from "../escalation.js";
import type { EscalationConfig } from "../escalation.js";
import type { Shipment, ShipmentStatus } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeShipment(overrides: Partial<Shipment> = {}): Shipment {
  const now = "2026-03-01T00:00:00.000Z";
  return {
    id: "shp_test-1",
    order_id: "ord_test-1",
    carrier: "mock_carrier",
    status: "LABEL_PENDING",
    created_at: now,
    updated_at: now,
    events: [],
    ...overrides,
  };
}

function daysFromNow(base: string, days: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

// ===========================================================================
// 1. State Machine
// ===========================================================================

describe("transitionShipmentStatus", () => {
  describe("valid transitions", () => {
    const validCases: [ShipmentStatus, string, ShipmentStatus][] = [
      // From LABEL_PENDING
      ["LABEL_PENDING", "label_create", "LABEL_CREATED"],

      // From LABEL_CREATED
      ["LABEL_CREATED", "ship", "IN_TRANSIT"],
      ["LABEL_CREATED", "exception", "DELIVERY_EXCEPTION"],

      // From IN_TRANSIT
      ["IN_TRANSIT", "out_for_delivery", "OUT_FOR_DELIVERY"],
      ["IN_TRANSIT", "deliver", "DELIVERED"],
      ["IN_TRANSIT", "exception", "DELIVERY_EXCEPTION"],
      ["IN_TRANSIT", "return_ship", "RETURN_IN_TRANSIT"],

      // From OUT_FOR_DELIVERY
      ["OUT_FOR_DELIVERY", "deliver", "DELIVERED"],
      ["OUT_FOR_DELIVERY", "exception", "DELIVERY_EXCEPTION"],
      ["OUT_FOR_DELIVERY", "return_ship", "RETURN_IN_TRANSIT"],

      // From DELIVERY_EXCEPTION
      ["DELIVERY_EXCEPTION", "ship", "IN_TRANSIT"],
      ["DELIVERY_EXCEPTION", "return_ship", "RETURN_IN_TRANSIT"],

      // From RETURN_IN_TRANSIT
      ["RETURN_IN_TRANSIT", "return_complete", "RETURNED"],
    ];

    it.each(validCases)(
      "%s + %s => %s",
      (status, event, expected) => {
        const result = transitionShipmentStatus(status, event as any);
        expect(result).toBe(expected);
      },
    );
  });

  describe("invalid transitions return null", () => {
    const invalidCases: [ShipmentStatus, string][] = [
      // LABEL_PENDING only accepts label_create
      ["LABEL_PENDING", "ship"],
      ["LABEL_PENDING", "deliver"],
      ["LABEL_PENDING", "out_for_delivery"],
      ["LABEL_PENDING", "exception"],
      ["LABEL_PENDING", "return_ship"],
      ["LABEL_PENDING", "return_complete"],

      // LABEL_CREATED does not accept deliver, out_for_delivery, return_complete
      ["LABEL_CREATED", "label_create"],
      ["LABEL_CREATED", "deliver"],
      ["LABEL_CREATED", "out_for_delivery"],
      ["LABEL_CREATED", "return_complete"],

      // DELIVERED is a terminal state
      ["DELIVERED", "label_create"],
      ["DELIVERED", "ship"],
      ["DELIVERED", "deliver"],
      ["DELIVERED", "out_for_delivery"],
      ["DELIVERED", "exception"],
      ["DELIVERED", "return_ship"],
      ["DELIVERED", "return_complete"],

      // RETURNED is a terminal state
      ["RETURNED", "label_create"],
      ["RETURNED", "ship"],
      ["RETURNED", "deliver"],
      ["RETURNED", "out_for_delivery"],
      ["RETURNED", "exception"],
      ["RETURNED", "return_ship"],
      ["RETURNED", "return_complete"],

      // IN_TRANSIT does not accept label_create or return_complete
      ["IN_TRANSIT", "label_create"],
      ["IN_TRANSIT", "return_complete"],

      // OUT_FOR_DELIVERY does not accept label_create, ship, return_complete
      ["OUT_FOR_DELIVERY", "label_create"],
      ["OUT_FOR_DELIVERY", "ship"],
      ["OUT_FOR_DELIVERY", "return_complete"],

      // DELIVERY_EXCEPTION does not accept label_create, deliver, out_for_delivery, return_complete
      ["DELIVERY_EXCEPTION", "label_create"],
      ["DELIVERY_EXCEPTION", "deliver"],
      ["DELIVERY_EXCEPTION", "out_for_delivery"],
      ["DELIVERY_EXCEPTION", "return_complete"],

      // RETURN_IN_TRANSIT only accepts return_complete
      ["RETURN_IN_TRANSIT", "label_create"],
      ["RETURN_IN_TRANSIT", "ship"],
      ["RETURN_IN_TRANSIT", "deliver"],
      ["RETURN_IN_TRANSIT", "out_for_delivery"],
      ["RETURN_IN_TRANSIT", "exception"],
      ["RETURN_IN_TRANSIT", "return_ship"],
    ];

    it.each(invalidCases)(
      "%s + %s => null",
      (status, event) => {
        const result = transitionShipmentStatus(status, event as any);
        expect(result).toBeNull();
      },
    );
  });
});

// ===========================================================================
// 2. SLA
// ===========================================================================

describe("SLA", () => {
  const approvedAt = "2026-03-01T12:00:00.000Z";

  describe("computeShipmentInputDueAt", () => {
    it("adds default 2 days to approved_at", () => {
      const due = computeShipmentInputDueAt(approvedAt);
      expect(due).toBe(new Date("2026-03-03T12:00:00.000Z").toISOString());
    });

    it("uses custom config days", () => {
      const due = computeShipmentInputDueAt(approvedAt, {
        shipment_input_due_days: 5,
      });
      expect(due).toBe(new Date("2026-03-06T12:00:00.000Z").toISOString());
    });

    it("handles zero days", () => {
      const due = computeShipmentInputDueAt(approvedAt, {
        shipment_input_due_days: 0,
      });
      expect(due).toBe(new Date(approvedAt).toISOString());
    });
  });

  describe("checkShipmentInputSla", () => {
    it("returns not violated when status is not LABEL_PENDING", () => {
      const shipment = makeShipment({ status: "LABEL_CREATED" });
      const result = checkShipmentInputSla(
        shipment,
        approvedAt,
        daysFromNow(approvedAt, 10),
      );
      expect(result.violated).toBe(false);
      expect(result.trust_triggers).toEqual([]);
    });

    it("returns not violated when now is before due date", () => {
      const shipment = makeShipment({ status: "LABEL_PENDING" });
      const now = daysFromNow(approvedAt, 1); // 1 day < 2 day default
      const result = checkShipmentInputSla(shipment, approvedAt, now);
      expect(result.violated).toBe(false);
      expect(result.trust_triggers).toEqual([]);
    });

    it("returns not violated when now equals due date", () => {
      const shipment = makeShipment({ status: "LABEL_PENDING" });
      const now = daysFromNow(approvedAt, 2); // exactly at deadline
      const result = checkShipmentInputSla(shipment, approvedAt, now);
      expect(result.violated).toBe(false);
      expect(result.trust_triggers).toEqual([]);
    });

    it("returns violated when now is past due date", () => {
      const shipment = makeShipment({ status: "LABEL_PENDING" });
      const now = daysFromNow(approvedAt, 3); // 3 days > 2 day default
      const result = checkShipmentInputSla(shipment, approvedAt, now);
      expect(result.violated).toBe(true);
      expect(result.violation_type).toBe("shipment_input_sla_missed");
      expect(result.trust_triggers.length).toBeGreaterThan(0);
    });

    it("uses custom config for due date calculation", () => {
      const shipment = makeShipment({ status: "LABEL_PENDING" });
      const config = { shipment_input_due_days: 5 };
      // 4 days in: not violated with 5-day config
      const now4 = daysFromNow(approvedAt, 4);
      expect(checkShipmentInputSla(shipment, approvedAt, now4, config).violated).toBe(false);
      // 6 days in: violated
      const now6 = daysFromNow(approvedAt, 6);
      expect(checkShipmentInputSla(shipment, approvedAt, now6, config).violated).toBe(true);
    });
  });

  describe("checkSellerFulfillment", () => {
    it("returns not violated when shipment is DELIVERED", () => {
      const shipment = makeShipment({ status: "DELIVERED" });
      const now = daysFromNow(approvedAt, 30);
      const result = checkSellerFulfillment(shipment, approvedAt, now);
      expect(result.violated).toBe(false);
    });

    it("returns not violated when shipment is RETURNED", () => {
      const shipment = makeShipment({ status: "RETURNED" });
      const now = daysFromNow(approvedAt, 30);
      const result = checkSellerFulfillment(shipment, approvedAt, now);
      expect(result.violated).toBe(false);
    });

    it("returns not violated when within deadline", () => {
      const shipment = makeShipment({ status: "IN_TRANSIT" });
      const now = daysFromNow(approvedAt, 5); // 5 < 7 default
      const result = checkSellerFulfillment(shipment, approvedAt, now);
      expect(result.violated).toBe(false);
    });

    it("returns not violated when exactly at deadline", () => {
      const shipment = makeShipment({ status: "IN_TRANSIT" });
      const now = daysFromNow(approvedAt, 7);
      const result = checkSellerFulfillment(shipment, approvedAt, now);
      expect(result.violated).toBe(false);
    });

    it("returns violated when past deadline and not delivered/returned", () => {
      const shipment = makeShipment({ status: "IN_TRANSIT" });
      const now = daysFromNow(approvedAt, 8);
      const result = checkSellerFulfillment(shipment, approvedAt, now);
      expect(result.violated).toBe(true);
      expect(result.violation_type).toBe("seller_fulfillment_failure");
      expect(result.trust_triggers.length).toBeGreaterThan(0);
    });

    it("uses custom fulfillment deadline days", () => {
      const shipment = makeShipment({ status: "LABEL_PENDING" });
      // 4 days with 3-day deadline => violated
      const now = daysFromNow(approvedAt, 4);
      const result = checkSellerFulfillment(shipment, approvedAt, now, 3);
      expect(result.violated).toBe(true);
    });

    it("detects violation for LABEL_PENDING past deadline", () => {
      const shipment = makeShipment({ status: "LABEL_PENDING" });
      const now = daysFromNow(approvedAt, 10);
      const result = checkSellerFulfillment(shipment, approvedAt, now);
      expect(result.violated).toBe(true);
    });

    it("detects violation for DELIVERY_EXCEPTION past deadline", () => {
      const shipment = makeShipment({ status: "DELIVERY_EXCEPTION" });
      const now = daysFromNow(approvedAt, 10);
      const result = checkSellerFulfillment(shipment, approvedAt, now);
      expect(result.violated).toBe(true);
    });
  });
});

// ===========================================================================
// 3. Trust Events
// ===========================================================================

describe("trust events", () => {
  describe("trustTriggersForShipmentSlaMiss", () => {
    it("returns a trigger with module=shipping, actor_role=seller", () => {
      const triggers = trustTriggersForShipmentSlaMiss();
      expect(triggers).toHaveLength(1);
      expect(triggers[0]).toEqual({
        module: "shipping",
        actor_role: "seller",
        type: "shipment_input_sla_missed",
      });
    });
  });

  describe("trustTriggersForSellerFulfillmentFailure", () => {
    it("returns a trigger with module=shipping, actor_role=seller", () => {
      const triggers = trustTriggersForSellerFulfillmentFailure();
      expect(triggers).toHaveLength(1);
      expect(triggers[0]).toEqual({
        module: "shipping",
        actor_role: "seller",
        type: "seller_approved_but_not_fulfilled",
      });
    });
  });
});

// ===========================================================================
// 4. MockCarrierAdapter
// ===========================================================================

describe("MockCarrierAdapter", () => {
  let adapter: MockCarrierAdapter;

  beforeEach(() => {
    adapter = new MockCarrierAdapter();
  });

  it("has carrier name 'mock_carrier'", () => {
    expect(adapter.carrier).toBe("mock_carrier");
  });

  describe("createLabel", () => {
    it("returns a label result with tracking number and URL", async () => {
      const shipment = makeShipment();
      const result = await adapter.createLabel(shipment);
      expect(result.tracking_number).toMatch(/^MOCK-/);
      expect(result.tracking_url).toContain("mock-carrier.test");
      expect(result.label_url).toContain("mock-carrier.test");
      expect(result.carrier_raw_status).toBe("label_created");
    });
  });

  describe("track", () => {
    it("returns IN_TRANSIT status with location", async () => {
      const result = await adapter.track("MOCK-123");
      expect(result.canonical_status).toBe("IN_TRANSIT");
      expect(result.carrier_raw_status).toBe("in_transit");
      expect(result.location).toBeDefined();
      expect(result.message).toContain("MOCK-123");
      expect(result.eta).toBeDefined();
    });
  });

  describe("parseWebhookEvent", () => {
    it("returns null when tracking_number is missing", () => {
      const result = adapter.parseWebhookEvent({ status: "in_transit" });
      expect(result).toBeNull();
    });

    it("returns null when status is missing", () => {
      const result = adapter.parseWebhookEvent({ tracking_number: "MOCK-123" });
      expect(result).toBeNull();
    });

    it("returns event when tracking_number and status are present", () => {
      const result = adapter.parseWebhookEvent({
        tracking_number: "MOCK-123",
        status: "in_transit",
        shipment_id: "shp_1",
        message: "Package picked up",
        location: "Warehouse A",
      });
      expect(result).not.toBeNull();
      expect(result!.status).toBe("IN_TRANSIT");
      expect(result!.shipment_id).toBe("shp_1");
      expect(result!.carrier_raw_status).toBe("in_transit");
      expect(result!.message).toBe("Package picked up");
      expect(result!.location).toBe("Warehouse A");
    });

    it("defaults shipment_id to empty string when not provided", () => {
      const result = adapter.parseWebhookEvent({
        tracking_number: "MOCK-123",
        status: "in_transit",
      });
      expect(result).not.toBeNull();
      expect(result!.shipment_id).toBe("");
    });
  });
});

// ===========================================================================
// 5. ShippingService
// ===========================================================================

describe("ShippingService", () => {
  let service: ShippingService;
  let mockAdapter: MockCarrierAdapter;

  beforeEach(() => {
    mockAdapter = new MockCarrierAdapter();
    service = new ShippingService({ mock_carrier: mockAdapter });
  });

  describe("createShipment", () => {
    it("creates a shipment with LABEL_PENDING status", () => {
      const shipment = service.createShipment({
        order_id: "ord_1",
        carrier: "mock_carrier",
        now: "2026-03-01T00:00:00.000Z",
      });
      expect(shipment.order_id).toBe("ord_1");
      expect(shipment.carrier).toBe("mock_carrier");
      expect(shipment.status).toBe("LABEL_PENDING");
      expect(shipment.id).toMatch(/^shp_/);
      expect(shipment.events).toEqual([]);
      expect(shipment.created_at).toBe("2026-03-01T00:00:00.000Z");
      expect(shipment.updated_at).toBe("2026-03-01T00:00:00.000Z");
    });

    it("uses current time when now is not provided", () => {
      const before = Date.now();
      const shipment = service.createShipment({
        order_id: "ord_1",
        carrier: "mock_carrier",
      });
      const after = Date.now();
      const createdTime = new Date(shipment.created_at).getTime();
      expect(createdTime).toBeGreaterThanOrEqual(before);
      expect(createdTime).toBeLessThanOrEqual(after);
    });
  });

  describe("createLabel", () => {
    it("transitions from LABEL_PENDING to LABEL_CREATED", async () => {
      const shipment = service.createShipment({
        order_id: "ord_1",
        carrier: "mock_carrier",
        now: "2026-03-01T00:00:00.000Z",
      });
      const result = await service.createLabel(
        shipment,
        "2026-03-01T01:00:00.000Z",
      );
      expect(result.shipment.status).toBe("LABEL_CREATED");
      expect(result.shipment.tracking_number).toMatch(/^MOCK-/);
      expect(result.shipment.tracking_url).toBeDefined();
      expect(result.shipment.events).toHaveLength(1);
      expect(result.shipment.events[0].status).toBe("LABEL_CREATED");
      expect(result.shipment.events[0].message).toBe("Label created");
      expect(result.trust_triggers).toEqual([]);
    });

    it("throws when called on non-LABEL_PENDING shipment", async () => {
      const shipment = makeShipment({ status: "IN_TRANSIT" });
      await expect(service.createLabel(shipment)).rejects.toThrow(
        /invalid shipment transition/,
      );
    });

    it("throws when carrier is not registered", async () => {
      const shipment = makeShipment({ carrier: "unknown_carrier" });
      await expect(service.createLabel(shipment)).rejects.toThrow(
        /no carrier provider registered/,
      );
    });
  });

  describe("recordEvent", () => {
    it("transitions status and appends event", () => {
      const shipment = makeShipment({ status: "LABEL_CREATED" });
      const result = service.recordEvent(
        shipment,
        "ship",
        { message: "Picked up", location: "Warehouse" },
        "2026-03-02T00:00:00.000Z",
      );
      expect(result.shipment.status).toBe("IN_TRANSIT");
      expect(result.shipment.events).toHaveLength(1);
      expect(result.shipment.events[0].message).toBe("Picked up");
      expect(result.shipment.events[0].location).toBe("Warehouse");
      expect(result.shipment.updated_at).toBe("2026-03-02T00:00:00.000Z");
    });

    it("sets delivered_at when transitioning to DELIVERED", () => {
      const shipment = makeShipment({ status: "IN_TRANSIT" });
      const ts = "2026-03-05T14:00:00.000Z";
      const result = service.recordEvent(shipment, "deliver", {}, ts);
      expect(result.shipment.status).toBe("DELIVERED");
      expect(result.shipment.delivered_at).toBe(ts);
    });

    it("does not set delivered_at for non-DELIVERED transitions", () => {
      const shipment = makeShipment({ status: "IN_TRANSIT" });
      const result = service.recordEvent(shipment, "out_for_delivery");
      expect(result.shipment.delivered_at).toBeUndefined();
    });

    it("throws on invalid transition", () => {
      const shipment = makeShipment({ status: "DELIVERED" });
      expect(() =>
        service.recordEvent(shipment, "ship"),
      ).toThrow(/invalid shipment transition/);
    });

    it("accumulates events across multiple recordEvent calls", () => {
      let shipment = makeShipment({ status: "LABEL_CREATED" });
      let result = service.recordEvent(shipment, "ship", { message: "Shipped" });
      shipment = result.shipment;
      result = service.recordEvent(shipment, "out_for_delivery", { message: "OFD" });
      shipment = result.shipment;
      result = service.recordEvent(shipment, "deliver", { message: "Delivered" });
      expect(result.shipment.events).toHaveLength(3);
      expect(result.shipment.status).toBe("DELIVERED");
    });
  });

  describe("trackShipment", () => {
    it("throws when shipment has no tracking number", async () => {
      const shipment = makeShipment({ status: "LABEL_CREATED" });
      await expect(service.trackShipment(shipment)).rejects.toThrow(
        /cannot track shipment without tracking number/,
      );
    });

    it("returns unchanged shipment when carrier status matches current", async () => {
      // MockCarrierAdapter.track always returns IN_TRANSIT
      const shipment = makeShipment({
        status: "IN_TRANSIT",
        tracking_number: "MOCK-123",
      });
      const result = await service.trackShipment(shipment);
      expect(result.shipment.status).toBe("IN_TRANSIT");
      expect(result.shipment.events).toHaveLength(0); // no new event
    });

    it("transitions shipment when carrier reports a new status", async () => {
      // MockCarrierAdapter.track returns IN_TRANSIT, so LABEL_CREATED -> IN_TRANSIT
      const shipment = makeShipment({
        status: "LABEL_CREATED",
        tracking_number: "MOCK-123",
      });
      const result = await service.trackShipment(
        shipment,
        "2026-03-03T00:00:00.000Z",
      );
      expect(result.shipment.status).toBe("IN_TRANSIT");
      expect(result.shipment.events).toHaveLength(1);
    });
  });

  describe("processWebhook", () => {
    it("returns null when carrier cannot parse webhook", () => {
      const shipment = makeShipment({
        status: "LABEL_CREATED",
        tracking_number: "MOCK-123",
      });
      // Missing required fields
      const result = service.processWebhook(shipment, {});
      expect(result).toBeNull();
    });

    it("processes valid webhook and transitions status", () => {
      const shipment = makeShipment({
        status: "LABEL_CREATED",
        tracking_number: "MOCK-123",
      });
      // MockCarrierAdapter.parseWebhookEvent returns status=IN_TRANSIT
      const result = service.processWebhook(shipment, {
        tracking_number: "MOCK-123",
        status: "in_transit",
        shipment_id: shipment.id,
      });
      expect(result).not.toBeNull();
      expect(result!.shipment.status).toBe("IN_TRANSIT");
      expect(result!.shipment.events).toHaveLength(1);
    });

    it("throws when carrier is not registered", () => {
      const shipment = makeShipment({ carrier: "unknown" });
      expect(() => service.processWebhook(shipment, {})).toThrow(
        /no carrier provider registered/,
      );
    });
  });

  describe("full lifecycle: create -> label -> ship -> deliver", () => {
    it("completes the entire shipment lifecycle", async () => {
      // Step 1: Create shipment
      let shipment = service.createShipment({
        order_id: "ord_lifecycle",
        carrier: "mock_carrier",
        now: "2026-03-01T00:00:00.000Z",
      });
      expect(shipment.status).toBe("LABEL_PENDING");

      // Step 2: Create label
      const labelResult = await service.createLabel(
        shipment,
        "2026-03-01T01:00:00.000Z",
      );
      shipment = labelResult.shipment;
      expect(shipment.status).toBe("LABEL_CREATED");
      expect(shipment.tracking_number).toBeDefined();

      // Step 3: Ship
      const shipResult = service.recordEvent(
        shipment,
        "ship",
        { message: "Package picked up", location: "Origin Facility" },
        "2026-03-02T10:00:00.000Z",
      );
      shipment = shipResult.shipment;
      expect(shipment.status).toBe("IN_TRANSIT");

      // Step 4: Out for delivery
      const ofdResult = service.recordEvent(
        shipment,
        "out_for_delivery",
        { message: "Out for delivery", location: "Local Hub" },
        "2026-03-04T08:00:00.000Z",
      );
      shipment = ofdResult.shipment;
      expect(shipment.status).toBe("OUT_FOR_DELIVERY");

      // Step 5: Deliver
      const deliverResult = service.recordEvent(
        shipment,
        "deliver",
        { message: "Delivered to front door", location: "Destination" },
        "2026-03-04T14:00:00.000Z",
      );
      shipment = deliverResult.shipment;
      expect(shipment.status).toBe("DELIVERED");
      expect(shipment.delivered_at).toBe("2026-03-04T14:00:00.000Z");
      expect(shipment.events).toHaveLength(4); // label + ship + ofd + deliver
    });
  });

  describe("exception and return lifecycle", () => {
    it("handles exception -> return flow", async () => {
      // Start with a shipped package
      let shipment = makeShipment({
        status: "IN_TRANSIT",
        tracking_number: "MOCK-456",
      });

      // Exception occurs
      const exResult = service.recordEvent(
        shipment,
        "exception",
        { message: "Address not found" },
        "2026-03-03T00:00:00.000Z",
      );
      shipment = exResult.shipment;
      expect(shipment.status).toBe("DELIVERY_EXCEPTION");

      // Return initiated
      const returnResult = service.recordEvent(
        shipment,
        "return_ship",
        { message: "Return to sender" },
        "2026-03-04T00:00:00.000Z",
      );
      shipment = returnResult.shipment;
      expect(shipment.status).toBe("RETURN_IN_TRANSIT");

      // Return completed
      const returnedResult = service.recordEvent(
        shipment,
        "return_complete",
        { message: "Returned to warehouse" },
        "2026-03-06T00:00:00.000Z",
      );
      shipment = returnedResult.shipment;
      expect(shipment.status).toBe("RETURNED");
      expect(shipment.events).toHaveLength(3);
    });

    it("handles exception -> reship flow", () => {
      let shipment = makeShipment({ status: "IN_TRANSIT" });

      const exResult = service.recordEvent(shipment, "exception");
      shipment = exResult.shipment;
      expect(shipment.status).toBe("DELIVERY_EXCEPTION");

      // Re-ship after fixing address
      const reshipResult = service.recordEvent(shipment, "ship");
      shipment = reshipResult.shipment;
      expect(shipment.status).toBe("IN_TRANSIT");
    });
  });
});

// ===========================================================================
// 6. Escalation
// ===========================================================================

describe("checkEscalation", () => {
  const approvedAt = "2026-03-01T00:00:00.000Z";

  describe("DELIVERY_EXCEPTION triggers dispute candidate", () => {
    it("returns DELIVERY_EXCEPTION candidate with auto_open=true by default", () => {
      const shipment = makeShipment({
        status: "DELIVERY_EXCEPTION",
        tracking_number: "TRK-001",
      });
      const now = daysFromNow(approvedAt, 3);
      const result = checkEscalation(shipment, approvedAt, now);

      expect(result).not.toBeNull();
      expect(result!.reason_code).toBe("DELIVERY_EXCEPTION");
      expect(result!.auto_open).toBe(true);
      expect(result!.order_id).toBe("ord_test-1");
      expect(result!.evidence_snapshot.shipment_id).toBe("shp_test-1");
      expect(result!.evidence_snapshot.shipment_status).toBe("DELIVERY_EXCEPTION");
      expect(result!.evidence_snapshot.carrier).toBe("mock_carrier");
      expect(result!.evidence_snapshot.tracking_number).toBe("TRK-001");
      expect(result!.evidence_snapshot.checked_at).toBe(now);
    });

    it("respects delivery_exception_auto_open=false config", () => {
      const shipment = makeShipment({ status: "DELIVERY_EXCEPTION" });
      const now = daysFromNow(approvedAt, 3);
      const config: EscalationConfig = {
        ...DEFAULT_ESCALATION_CONFIG,
        delivery_exception_auto_open: false,
      };
      const result = checkEscalation(shipment, approvedAt, now, config);

      expect(result).not.toBeNull();
      expect(result!.reason_code).toBe("DELIVERY_EXCEPTION");
      expect(result!.auto_open).toBe(false);
    });
  });

  describe("LABEL_PENDING beyond max days triggers SELLER_NO_FULFILLMENT", () => {
    it("returns SELLER_NO_FULFILLMENT when LABEL_PENDING exceeds default 5 days", () => {
      const shipment = makeShipment({ status: "LABEL_PENDING" });
      const now = daysFromNow(approvedAt, 6); // 6 > 5 default
      const result = checkEscalation(shipment, approvedAt, now);

      expect(result).not.toBeNull();
      expect(result!.reason_code).toBe("SELLER_NO_FULFILLMENT");
      expect(result!.auto_open).toBe(true);
      expect(result!.order_id).toBe("ord_test-1");
      expect(result!.evidence_snapshot.shipment_status).toBe("LABEL_PENDING");
    });

    it("returns null when LABEL_PENDING is within max days", () => {
      const shipment = makeShipment({ status: "LABEL_PENDING" });
      const now = daysFromNow(approvedAt, 4); // 4 < 5 default
      const result = checkEscalation(shipment, approvedAt, now);
      expect(result).toBeNull();
    });

    it("returns null when LABEL_PENDING is exactly at max days", () => {
      const shipment = makeShipment({ status: "LABEL_PENDING" });
      const now = daysFromNow(approvedAt, 5); // exactly 5 = not exceeded
      const result = checkEscalation(shipment, approvedAt, now);
      expect(result).toBeNull();
    });

    it("respects custom label_pending_max_days config", () => {
      const shipment = makeShipment({ status: "LABEL_PENDING" });
      const config: EscalationConfig = {
        ...DEFAULT_ESCALATION_CONFIG,
        label_pending_max_days: 3,
      };
      // 4 days > 3 day config => escalation
      const now4 = daysFromNow(approvedAt, 4);
      expect(checkEscalation(shipment, approvedAt, now4, config)).not.toBeNull();
      expect(checkEscalation(shipment, approvedAt, now4, config)!.reason_code).toBe(
        "SELLER_NO_FULFILLMENT",
      );

      // 2 days < 3 day config => no escalation
      const now2 = daysFromNow(approvedAt, 2);
      expect(checkEscalation(shipment, approvedAt, now2, config)).toBeNull();
    });

    it("respects sla_miss_auto_open=false config", () => {
      const shipment = makeShipment({ status: "LABEL_PENDING" });
      const now = daysFromNow(approvedAt, 6);
      const config: EscalationConfig = {
        ...DEFAULT_ESCALATION_CONFIG,
        sla_miss_auto_open: false,
      };
      const result = checkEscalation(shipment, approvedAt, now, config);

      expect(result).not.toBeNull();
      expect(result!.auto_open).toBe(false);
    });
  });

  describe("normal statuses return null", () => {
    it("returns null for IN_TRANSIT", () => {
      const shipment = makeShipment({ status: "IN_TRANSIT" });
      const now = daysFromNow(approvedAt, 10);
      expect(checkEscalation(shipment, approvedAt, now)).toBeNull();
    });

    it("returns null for DELIVERED", () => {
      const shipment = makeShipment({ status: "DELIVERED" });
      const now = daysFromNow(approvedAt, 10);
      expect(checkEscalation(shipment, approvedAt, now)).toBeNull();
    });

    it("returns null for LABEL_CREATED", () => {
      const shipment = makeShipment({ status: "LABEL_CREATED" });
      const now = daysFromNow(approvedAt, 10);
      expect(checkEscalation(shipment, approvedAt, now)).toBeNull();
    });

    it("returns null for OUT_FOR_DELIVERY", () => {
      const shipment = makeShipment({ status: "OUT_FOR_DELIVERY" });
      const now = daysFromNow(approvedAt, 10);
      expect(checkEscalation(shipment, approvedAt, now)).toBeNull();
    });

    it("returns null for RETURNED", () => {
      const shipment = makeShipment({ status: "RETURNED" });
      const now = daysFromNow(approvedAt, 10);
      expect(checkEscalation(shipment, approvedAt, now)).toBeNull();
    });

    it("returns null for RETURN_IN_TRANSIT", () => {
      const shipment = makeShipment({ status: "RETURN_IN_TRANSIT" });
      const now = daysFromNow(approvedAt, 10);
      expect(checkEscalation(shipment, approvedAt, now)).toBeNull();
    });
  });

  describe("evidence snapshot completeness", () => {
    it("includes tracking_number when present", () => {
      const shipment = makeShipment({
        status: "DELIVERY_EXCEPTION",
        tracking_number: "TRACK-999",
      });
      const now = daysFromNow(approvedAt, 2);
      const result = checkEscalation(shipment, approvedAt, now);
      expect(result!.evidence_snapshot.tracking_number).toBe("TRACK-999");
    });

    it("omits tracking_number when not present", () => {
      const shipment = makeShipment({ status: "DELIVERY_EXCEPTION" });
      const now = daysFromNow(approvedAt, 2);
      const result = checkEscalation(shipment, approvedAt, now);
      expect(result!.evidence_snapshot.tracking_number).toBeUndefined();
    });
  });
});
