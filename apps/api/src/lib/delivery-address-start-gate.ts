/**
 * D1: physical (shipment-required) listing starts need a delivery address
 * before createSession. Digital / A4 no-shipment paths stay exempt.
 *
 * Detection:
 * - Listing snapshot `fulfillment_type` in A4 no-shipment set
 *   (digital_delivery, local_pickup, external_platform_transfer,
 *   onchain_transfer) → digital → address not required.
 * - Otherwise, buyer fulfillment with `carrier` → physical_shipping →
 *   address required.
 * - No fulfillment body → not this gate (MCP / digital / legacy starts
 *   without a shipping preference).
 */
import { isNoShippingFulfillment, normalizeFulfillmentType } from "@haggle/commerce-core";
import type { FulfillmentPreference } from "./negotiation-fulfillment.js";

export const DELIVERY_ADDRESS_REQUIRED = "DELIVERY_ADDRESS_REQUIRED";

export function isDigitalNoShipmentListing(
  listingSnapshot: Record<string, unknown> | null | undefined,
): boolean {
  const raw = listingSnapshot?.fulfillment_type;
  if (raw == null) return false;
  return isNoShippingFulfillment(normalizeFulfillmentType(raw));
}

/** True when this start is physical shipping and must collect an address. */
export function isPhysicalDeliveryAddressRequired(
  fulfillment: FulfillmentPreference | undefined,
  listingSnapshot?: Record<string, unknown> | null,
): boolean {
  if (isDigitalNoShipmentListing(listingSnapshot)) return false;
  if (!fulfillment) return false;
  return fulfillment.methods.includes("carrier");
}

export function deliveryAddressRequiredReject(input: {
  fulfillment: FulfillmentPreference | undefined;
  listingSnapshot?: Record<string, unknown> | null;
}): { error: typeof DELIVERY_ADDRESS_REQUIRED; message: string } | null {
  if (!isPhysicalDeliveryAddressRequired(input.fulfillment, input.listingSnapshot)) {
    return null;
  }
  if (input.fulfillment?.buyer_address) return null;
  return {
    error: DELIVERY_ADDRESS_REQUIRED,
    message:
      "Add a delivery address before starting negotiation on a physical listing. Digital (no-shipment) listings do not require an address.",
  };
}
