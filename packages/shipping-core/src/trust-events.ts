import type { TrustTriggerEvent } from "@haggle/commerce-core";

export function trustTriggersForShipmentSlaMiss(): TrustTriggerEvent[] {
  return [
    {
      module: "shipping",
      actor_role: "seller",
      type: "shipment_input_sla_missed",
    },
  ];
}

export function trustTriggersForSellerFulfillmentFailure(): TrustTriggerEvent[] {
  return [
    {
      module: "shipping",
      actor_role: "seller",
      type: "seller_approved_but_not_fulfilled",
    },
  ];
}
