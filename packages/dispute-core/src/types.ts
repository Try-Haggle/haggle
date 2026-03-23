export type DisputeStatus =
  | "OPEN"
  | "UNDER_REVIEW"
  | "WAITING_FOR_BUYER"
  | "WAITING_FOR_SELLER"
  | "RESOLVED_BUYER_FAVOR"
  | "RESOLVED_SELLER_FAVOR"
  | "PARTIAL_REFUND"
  | "CLOSED";

export interface DisputeEvidence {
  id: string;
  dispute_id: string;
  submitted_by: "buyer" | "seller" | "system";
  type: "text" | "image" | "tracking_snapshot" | "payment_proof" | "other";
  uri?: string;
  text?: string;
  created_at: string;
}

export interface DisputeResolution {
  outcome:
    | "buyer_favor"
    | "seller_favor"
    | "partial_refund"
    | "no_action";
  summary: string;
  refund_amount_minor?: number;
  resolved_at?: string;
}

export interface DisputeCase {
  id: string;
  order_id: string;
  reason_code: string;
  status: DisputeStatus;
  opened_by: "buyer" | "seller" | "system";
  opened_at: string;
  evidence: DisputeEvidence[];
  resolution?: DisputeResolution;
}
