import { describe, expect, it, vi } from "vitest";
import { createShipmentRecord } from "../services/shipment-record.service.js";

function shipmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "ship_1",
    orderId: "order_1",
    sellerId: "seller_1",
    buyerId: "buyer_1",
    shipmentType: "outbound",
    status: "LABEL_PENDING",
    carrier: null,
    trackingNumber: null,
    deliveredAt: null,
    createdAt: new Date("2026-04-23T00:00:00.000Z"),
    updatedAt: new Date("2026-04-23T00:00:00.000Z"),
    ...overrides,
  };
}

function insertMock(result: unknown) {
  const returning = vi.fn();
  if (result instanceof Error) {
    returning.mockRejectedValue(result);
  } else {
    returning.mockResolvedValue([result]);
  }
  const values = vi.fn().mockReturnValue({ returning });
  return { insert: vi.fn().mockReturnValue({ values }), values, returning };
}

describe("shipment-record service", () => {
  it("returns an existing outbound shipment without inserting", async () => {
    const existing = shipmentRow();
    const insert = insertMock(shipmentRow({ id: "ship_new" }));
    const db = {
      query: { shipments: { findFirst: vi.fn().mockResolvedValue(existing) } },
      insert: insert.insert,
    };

    const shipment = await createShipmentRecord(db as never, "order_1", "seller_1", "buyer_1");

    expect(shipment.id).toBe("ship_1");
    expect(insert.insert).not.toHaveBeenCalled();
  });

  it("returns the existing outbound shipment after a unique conflict race", async () => {
    const duplicate = Object.assign(new Error("duplicate"), { code: "23505" });
    const insert = insertMock(duplicate);
    const db = {
      query: {
        shipments: {
          findFirst: vi.fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(shipmentRow()),
        },
      },
      insert: insert.insert,
    };

    const shipment = await createShipmentRecord(db as never, "order_1", "seller_1", "buyer_1");

    expect(shipment.id).toBe("ship_1");
    expect(insert.insert).toHaveBeenCalledTimes(1);
  });

  it("inserts return shipments with return type immediately", async () => {
    const insert = insertMock(shipmentRow({ id: "return_1", shipmentType: "return" }));
    const db = {
      query: { shipments: { findFirst: vi.fn() } },
      insert: insert.insert,
    };

    const shipment = await createShipmentRecord(
      db as never,
      "order_1",
      "seller_1",
      "buyer_1",
      undefined,
      { shipmentType: "return" },
    );

    expect(shipment.shipment_type).toBe("return");
    expect(insert.values).toHaveBeenCalledWith(expect.objectContaining({
      shipmentType: "return",
    }));
  });
});
