import type { Shipment, ShipmentEvent, ShipmentStatus } from "./types.js";

export interface CarrierTrackingResult {
  canonical_status: ShipmentStatus;
  carrier_raw_status: string;
  location?: string;
  message?: string;
  eta?: string;
  delivered_at?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateLabelResult {
  tracking_number: string;
  tracking_url?: string;
  label_url?: string;
  carrier_raw_status: string;
  metadata?: Record<string, unknown>;
}

export interface CarrierProvider {
  readonly carrier: string;
  createLabel(shipment: Shipment): Promise<CreateLabelResult>;
  track(tracking_number: string): Promise<CarrierTrackingResult>;
  parseWebhookEvent(raw: Record<string, unknown>): ShipmentEvent | null;
}
