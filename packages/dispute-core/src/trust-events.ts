import type { TrustTriggerEvent } from "@haggle/commerce-core";
import type { DisputeStatus } from "./types.js";

export function trustTriggersForDisputeResolution(status: DisputeStatus): TrustTriggerEvent[] {
  switch (status) {
    case "RESOLVED_BUYER_FAVOR":
      return [
        { module: "dispute", actor_role: "buyer", type: "dispute_win" },
        { module: "dispute", actor_role: "seller", type: "dispute_loss" },
      ];
    case "RESOLVED_SELLER_FAVOR":
      return [
        { module: "dispute", actor_role: "seller", type: "dispute_win" },
        { module: "dispute", actor_role: "buyer", type: "dispute_loss" },
      ];
    default:
      return [];
  }
}
