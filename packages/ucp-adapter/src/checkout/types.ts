// ============================================================
// UCP Checkout Session Types — based on UCP Spec v2026-01-23
// All monetary amounts in minor units (cents): 2500 = $25.00
// ============================================================

export type CheckoutStatus =
  | 'incomplete'
  | 'requires_escalation'
  | 'ready_for_complete'
  | 'completed'
  | 'canceled';

export type TotalType =
  | 'subtotal'
  | 'fulfillment'
  | 'tax'
  | 'discount'
  | 'total';

export interface Total {
  type: TotalType;
  amount: number; // minor units
}

export interface LineItemProduct {
  id: string;
  title: string;
  price: number; // minor units
  description?: string;
  image_url?: string;
}

export interface LineItem {
  id: string;
  item: LineItemProduct;
  quantity: number;
  totals: Total[];
}

export interface Buyer {
  email?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
}

export interface Address {
  id?: string;
  street_address?: string;
  address_locality?: string;
  address_region?: string;
  postal_code?: string;
  address_country?: string;
}

export interface FulfillmentOption {
  id: string;
  title: string;
  description?: string;
  totals: Total[];
}

export interface FulfillmentGroup {
  id: string;
  line_item_ids?: string[];
  selected_option_id?: string;
  options: FulfillmentOption[];
}

export interface FulfillmentMethod {
  id: string;
  type: 'shipping' | 'pickup' | 'digital';
  line_item_ids?: string[];
  selected_destination_id?: string;
  destinations?: Address[];
  groups?: FulfillmentGroup[];
}

export interface Fulfillment {
  methods: FulfillmentMethod[];
}

export interface PaymentInstrument {
  id: string;
  handler_id: string;
  type: string;
  brand?: string;
  last_digits?: string;
  billing_address?: Address;
  credential?: {
    type: string;
    token: string;
  };
}

export interface PaymentHandler {
  id: string;
  name: string;
  version: string;
  config: Record<string, unknown>;
}

export interface Payment {
  handlers?: PaymentHandler[];
  selected_instrument_id?: string;
  instruments?: PaymentInstrument[];
}

export interface CheckoutLink {
  type: 'terms_of_service' | 'privacy_policy' | 'continue_url';
  url: string;
}

export interface CheckoutMessage {
  type: 'error' | 'warning' | 'info';
  code: string;
  path?: string;
  content: string;
  severity?: 'recoverable' | 'requires_buyer_input' | 'requires_escalation';
}

export interface CheckoutSession {
  id: string;
  status: CheckoutStatus;
  currency: string;
  line_items: LineItem[];
  buyer?: Buyer;
  totals: Total[];
  fulfillment?: Fulfillment;
  payment?: Payment;
  links?: CheckoutLink[];
  messages?: CheckoutMessage[];
  extensions?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// --- Request / Response types ---

export interface CreateCheckoutRequest {
  line_items: Array<{
    item: { id: string; title: string; price?: number };
    quantity: number;
  }>;
  currency: string;
  buyer?: Buyer;
  extensions?: Record<string, unknown>;
}

export interface UpdateCheckoutRequest {
  buyer?: Buyer;
  fulfillment?: Fulfillment;
  payment?: Payment;
  extensions?: Record<string, unknown>;
}

export interface CompleteCheckoutRequest {
  payment: {
    instruments: PaymentInstrument[];
  };
  risk_signals?: Record<string, unknown>;
}

// --- UCP Required Headers ---

export interface UcpRequestHeaders {
  'ucp-agent': string;
  'request-signature'?: string;
  'idempotency-key': string;
  'request-id': string;
  authorization?: string;
}
