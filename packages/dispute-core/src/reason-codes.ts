export type DisputeReasonCode =
  | "ITEM_NOT_RECEIVED"
  | "ITEM_NOT_AS_DESCRIBED"
  | "PAYMENT_NOT_COMPLETED"
  | "SHIPMENT_SLA_MISSED"
  | "DELIVERY_EXCEPTION"
  | "SELLER_NO_FULFILLMENT"
  | "REFUND_DISPUTE"
  | "PARTIAL_REFUND_DISPUTE"
  | "COUNTERFEIT_CLAIM"
  | "OTHER";

export interface ReasonCodeMetadata {
  code: DisputeReasonCode;
  label: string;
  auto_open_eligible: boolean;
  default_opener: "buyer" | "seller" | "system";
  requires_evidence_types: Array<"text" | "image" | "tracking_snapshot" | "payment_proof">;
}

export const REASON_CODE_REGISTRY: Record<DisputeReasonCode, ReasonCodeMetadata> = {
  ITEM_NOT_RECEIVED: {
    code: "ITEM_NOT_RECEIVED",
    label: "Item not received",
    auto_open_eligible: true,
    default_opener: "buyer",
    requires_evidence_types: ["tracking_snapshot"],
  },
  ITEM_NOT_AS_DESCRIBED: {
    code: "ITEM_NOT_AS_DESCRIBED",
    label: "Item not as described",
    auto_open_eligible: false,
    default_opener: "buyer",
    requires_evidence_types: ["text", "image"],
  },
  PAYMENT_NOT_COMPLETED: {
    code: "PAYMENT_NOT_COMPLETED",
    label: "Payment not completed after approval",
    auto_open_eligible: true,
    default_opener: "system",
    requires_evidence_types: ["payment_proof"],
  },
  SHIPMENT_SLA_MISSED: {
    code: "SHIPMENT_SLA_MISSED",
    label: "Shipment info not provided within SLA",
    auto_open_eligible: true,
    default_opener: "system",
    requires_evidence_types: [],
  },
  DELIVERY_EXCEPTION: {
    code: "DELIVERY_EXCEPTION",
    label: "Delivery exception occurred",
    auto_open_eligible: true,
    default_opener: "system",
    requires_evidence_types: ["tracking_snapshot"],
  },
  SELLER_NO_FULFILLMENT: {
    code: "SELLER_NO_FULFILLMENT",
    label: "Seller did not fulfill after approval",
    auto_open_eligible: true,
    default_opener: "system",
    requires_evidence_types: [],
  },
  REFUND_DISPUTE: {
    code: "REFUND_DISPUTE",
    label: "Refund request disputed",
    auto_open_eligible: false,
    default_opener: "buyer",
    requires_evidence_types: ["text", "payment_proof"],
  },
  PARTIAL_REFUND_DISPUTE: {
    code: "PARTIAL_REFUND_DISPUTE",
    label: "Partial refund amount disputed",
    auto_open_eligible: false,
    default_opener: "buyer",
    requires_evidence_types: ["text"],
  },
  COUNTERFEIT_CLAIM: {
    code: "COUNTERFEIT_CLAIM",
    label: "Item claimed to be counterfeit",
    auto_open_eligible: false,
    default_opener: "buyer",
    requires_evidence_types: ["text", "image"],
  },
  OTHER: {
    code: "OTHER",
    label: "Other",
    auto_open_eligible: false,
    default_opener: "buyer",
    requires_evidence_types: ["text"],
  },
};
