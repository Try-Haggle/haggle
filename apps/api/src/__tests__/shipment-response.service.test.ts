import { describe, expect, it } from "vitest";
import { shipmentForViewer } from "../services/shipment-response.service.js";

const outboundShipment = {
  id: "shipment-1",
  seller_id: "seller-1",
  buyer_id: "buyer-1",
  shipment_type: "outbound",
  label_url: "https://labels.test/outbound.pdf",
  label_qr_code_url: "https://labels.test/outbound-qr.png",
  label_qr_code_available: true,
  tracking_number: "TRACK123",
  metadata: {
    shipping_execution_mode: "integration_manual",
    label_qr_code_url: "https://labels.test/outbound-qr.png",
    label_qr_code_form_id: "form-1",
    label_qr_code_status: "created",
    label_print_methods: ["pdf", "usps_label_broker_qr"],
  },
};

describe("shipmentForViewer", () => {
  it("removes outbound label and QR assets from the buyer response", () => {
    const result = shipmentForViewer(outboundShipment, { id: "buyer-1" });

    expect(result).not.toHaveProperty("label_url");
    expect(result).not.toHaveProperty("label_qr_code_url");
    expect(result).not.toHaveProperty("label_qr_code_available");
    expect(result.metadata).not.toHaveProperty("label_qr_code_url");
    expect(result.metadata).not.toHaveProperty("label_qr_code_form_id");
    expect(result.metadata).not.toHaveProperty("label_qr_code_status");
    expect(result.metadata).not.toHaveProperty("label_print_methods");
    expect(result.tracking_number).toBe("TRACK123");
  });

  it("keeps outbound label assets for the seller without mutating the source", () => {
    const buyerResult = shipmentForViewer(outboundShipment, { id: "buyer-1" });
    const sellerResult = shipmentForViewer(outboundShipment, { id: "seller-1" });

    expect(buyerResult).not.toBe(outboundShipment);
    expect(sellerResult).toBe(outboundShipment);
    expect(sellerResult.label_url).toBe("https://labels.test/outbound.pdf");
    expect(outboundShipment.metadata.label_qr_code_url).toBe("https://labels.test/outbound-qr.png");
  });

  it("keeps return-label assets for the buyer who must fulfill the return", () => {
    const returnShipment = { ...outboundShipment, shipment_type: "return" };

    expect(shipmentForViewer(returnShipment, { id: "buyer-1" })).toBe(returnShipment);
    expect(shipmentForViewer(returnShipment, { id: "seller-1" })).not.toHaveProperty("label_url");
  });

  it("keeps label assets for an admin", () => {
    expect(shipmentForViewer(outboundShipment, { id: "admin-1", role: "admin" })).toBe(
      outboundShipment,
    );
  });
});
