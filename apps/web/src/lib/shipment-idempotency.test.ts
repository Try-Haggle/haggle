import { describe, expect, it } from "vitest";
import { createShipmentMutationHeaders } from "./shipment-idempotency";

describe("createShipmentMutationHeaders", () => {
  it("binds the idempotency key to the shipment, operation, and selected rate", () => {
    expect(
      createShipmentMutationHeaders("purchase-label", "shipment-id", "rate-id", "attempt-id"),
    ).toEqual({
      "Idempotency-Key": "shipment-purchase-label-shipment-id-rate-id-attempt-id",
    });
  });

  it("uses a distinct key for each explicit purchase attempt", () => {
    const first = createShipmentMutationHeaders("purchase-label", "shipment-id", "rate-id");
    const second = createShipmentMutationHeaders("purchase-label", "shipment-id", "rate-id");

    expect(first["Idempotency-Key"]).not.toBe(second["Idempotency-Key"]);
  });
});
