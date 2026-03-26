export interface ModuleBoundary {
  name: string;
  owns_entities: string[];
  emits_events: string[];
  consumes_events: string[];
  can_run_as_standalone_service: boolean;
}

export const COMMERCE_MODULE_BOUNDARIES: ModuleBoundary[] = [
  {
    name: "payment",
    owns_entities: ["payment_intent", "payment_authorization", "payment_settlement", "refund"],
    emits_events: ["payment.intent.created", "payment.settlement.settled", "payment.refund.completed"],
    consumes_events: ["negotiation.agreed", "order.created", "dispute.resolution.applied"],
    can_run_as_standalone_service: true,
  },
  {
    name: "shipping",
    owns_entities: ["shipment", "shipment_event", "delivery_estimate"],
    emits_events: ["shipment.created", "shipment.in_transit", "shipment.delivered"],
    consumes_events: ["order.created", "order.canceled"],
    can_run_as_standalone_service: true,
  },
  {
    name: "dispute",
    owns_entities: ["dispute_case", "dispute_evidence", "dispute_resolution"],
    emits_events: ["dispute.opened", "dispute.status.changed", "dispute.resolved"],
    consumes_events: ["payment.chargeback.received", "shipment.delivery_exception", "shipment.delivered"],
    can_run_as_standalone_service: true,
  },
];
