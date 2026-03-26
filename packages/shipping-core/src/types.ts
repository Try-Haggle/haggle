export type ShipmentStatus =
  | "LABEL_PENDING"
  | "LABEL_CREATED"
  | "IN_TRANSIT"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "DELIVERY_EXCEPTION"
  | "RETURN_IN_TRANSIT"
  | "RETURNED";

export interface ShipmentEvent {
  id: string;
  shipment_id: string;
  status: ShipmentStatus;
  occurred_at: string;
  carrier_raw_status?: string;
  message?: string;
  location?: string;
}

export interface Shipment {
  id: string;
  order_id: string;
  carrier: string;
  tracking_number?: string;
  tracking_url?: string;
  status: ShipmentStatus;
  eta?: string;
  delivered_at?: string;
  created_at: string;
  updated_at: string;
  events: ShipmentEvent[];
}
