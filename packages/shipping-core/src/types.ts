/**
 * SLA status throughout its lifecycle.
 *
 * ACTIVE       - deadline not yet reached
 * GRACE_PERIOD - past deadline but within grace hours
 * VIOLATED     - past deadline + grace, penalties apply
 * FULFILLED    - shipped before deadline
 * CANCELLED    - auto-cancelled at hard deadline
 */
export type SlaStatus =
  | "ACTIVE"
  | "GRACE_PERIOD"
  | "VIOLATED"
  | "FULFILLED"
  | "CANCELLED";

/** Configuration for an SLA attached to a transaction. */
export interface SlaConfig {
  /** Promised shipping days from approval. */
  sla_days: number;
  /** Product category key (e.g. "ELECTRONICS_SMALL"). */
  category: string;
  /** Hours of grace after deadline before penalties (default 6). */
  grace_hours: number;
  /** Absolute maximum days before auto-cancel (default 14). */
  hard_deadline_days: number;
}

/** Result of validating a proposed SLA value. */
export interface SlaValidationResult {
  valid: boolean;
  proposed_days: number;
  /** The value clamped to the valid range [category_min, 14]. */
  effective_days: number;
  /** Human-readable reason when invalid. */
  reason?: string;
}

/** Full status check result for an SLA at a given point in time. */
export interface SlaCheckResult {
  status: SlaStatus;
  days_elapsed: number;
  /** Days past deadline (0 if not late). */
  days_late: number;
  in_grace_period: boolean;
  /** Compensation rate as a decimal (e.g. 0.02 for 2%). 0 if not violated. */
  compensation_rate: number;
  /** Compensation amount in cents. 0 if not violated. */
  compensation_cents: number;
  can_cancel: boolean;
  /** True when past the hard deadline - triggers auto-cancel. */
  auto_cancel: boolean;
}

/** Compensation details for an SLA violation. */
export interface SlaCompensation {
  days_late: number;
  /** Rate as a decimal (e.g. 0.02). */
  rate: number;
  /** Amount in cents. */
  amount_cents: number;
  /** True if the 20% cap was applied. */
  capped: boolean;
}

// ─── Shipment Tracking Types ─────────────────────────────────

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
  events: ShipmentEvent[];
  delivered_at?: string;
  created_at: string;
  updated_at: string;
}
