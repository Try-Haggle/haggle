import { createId } from "./id.js";
import type { CarrierProvider, CarrierTrackingResult, CreateLabelResult } from "./provider.js";
import type { Shipment, ShipmentEvent } from "./types.js";

export class MockCarrierAdapter implements CarrierProvider {
  readonly carrier = "mock_carrier";

  async createLabel(_shipment: Shipment): Promise<CreateLabelResult> {
    return {
      tracking_number: `MOCK-${createId()}`,
      tracking_url: "https://mock-carrier.test/track/MOCK-123",
      label_url: "https://mock-carrier.test/label/MOCK-123",
      carrier_raw_status: "label_created",
    };
  }

  async track(tracking_number: string): Promise<CarrierTrackingResult> {
    return {
      canonical_status: "IN_TRANSIT",
      carrier_raw_status: "in_transit",
      location: "Distribution Center, CA",
      message: `Package ${tracking_number} is in transit`,
      eta: new Date(Date.now() + 3 * 86400_000).toISOString(),
    };
  }

  parseWebhookEvent(raw: Record<string, unknown>): ShipmentEvent | null {
    if (!raw.tracking_number || !raw.status) return null;
    return {
      id: createId("evt"),
      shipment_id: (raw.shipment_id as string) ?? "",
      status: "IN_TRANSIT",
      occurred_at: new Date().toISOString(),
      carrier_raw_status: raw.status as string,
      message: (raw.message as string) ?? undefined,
      location: (raw.location as string) ?? undefined,
    };
  }
}
