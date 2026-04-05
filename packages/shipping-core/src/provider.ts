import type { Shipment, ShipmentEvent, ShipmentStatus } from "./types.js";

// ---------------------------------------------------------------------------
// Address / Parcel / LabelRequest — used for actual label generation
// ---------------------------------------------------------------------------

export interface Address {
  name: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone?: string;
}

export interface Parcel {
  weight_oz: number;
  length_in?: number;
  width_in?: number;
  height_in?: number;
}

export interface LabelRequest {
  from_address: Address;
  to_address: Address;
  parcel: Parcel;
  /** e.g. "Ground", "Priority" — default: cheapest rate */
  service_level?: string;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

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
  /** Rate in minor units (cents). e.g. $5.50 → 550 */
  rate_minor?: number;
  /** Service name, e.g. "GroundAdvantage", "Priority" */
  service?: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface CarrierProvider {
  readonly carrier: string;
  createLabel(shipment: Shipment, request?: LabelRequest): Promise<CreateLabelResult>;
  track(tracking_number: string): Promise<CarrierTrackingResult>;
  parseWebhookEvent(raw: Record<string, unknown>): ShipmentEvent | null;
}
