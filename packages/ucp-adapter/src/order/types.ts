// ============================================================
// UCP Order Types — based on UCP Spec v2026-01-23
// Webhook-driven post-purchase lifecycle management
// ============================================================

export type OrderFulfillmentStatus =
  | 'processing'
  | 'partial'
  | 'fulfilled';

export type FulfillmentEventType =
  | 'processing'
  | 'shipped'
  | 'in_transit'
  | 'delivered'
  | 'failed_attempt'
  | 'canceled'
  | 'returned_to_sender'
  | string; // open-string per spec

export type AdjustmentType =
  | 'refund'
  | 'return'
  | 'credit'
  | 'price_adjustment';

export type AdjustmentStatus =
  | 'pending'
  | 'completed'
  | 'failed';

export interface FulfillmentExpectation {
  method: string;
  destination?: string;
  description?: string;
  fulfillable_on?: string; // ISO 8601
}

export interface FulfillmentEvent {
  id: string;
  type: FulfillmentEventType;
  timestamp: string;
  description?: string;
  tracking_url?: string;
}

export interface OrderLineItem {
  id: string;
  item_id: string;
  title: string;
  quantity: number;
  price: number; // minor units
  fulfillment_status: OrderFulfillmentStatus;
}

export interface OrderAdjustment {
  id: string;
  type: AdjustmentType;
  amount: number; // minor units
  status: AdjustmentStatus;
  reason?: string;
  timestamp: string;
}

export interface Order {
  id: string;
  checkout_id: string;
  permalink_url?: string;
  line_items: OrderLineItem[];
  fulfillment: {
    expectations: FulfillmentExpectation[];
    events: FulfillmentEvent[];
  };
  adjustments: OrderAdjustment[];
  created_at: string;
  updated_at: string;
}

// Webhook payload is always the full Order entity
export interface OrderWebhookPayload {
  order: Order;
}
