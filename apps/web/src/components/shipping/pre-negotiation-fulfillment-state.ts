import {
  type BuyerFulfillmentDefaults,
  type CarrierPriority,
  type FulfillmentMethod,
  initialBuyerSelection,
  readBuyerFulfillmentDefaults,
  type SellerFulfillmentOffer,
} from "@/lib/fulfillment-options";
import {
  EMPTY_SHIPPING_ADDRESS,
  isCompleteShippingAddress,
  type ShippingAddressInput,
} from "@/lib/shipping-address";

/**
 * Address gate for physical start:
 * - pending: saved address loaded; buyer has not confirmed this session yet
 * - default: buyer confirmed "use this saved address"
 * - new: buyer chose a different address (or had none saved)
 */
export type AddressSource = "pending" | "default" | "new";

export interface PreNegotiationFulfillmentValue {
  methods: FulfillmentMethod[];
  preferred?: FulfillmentMethod;
  addressSource: AddressSource;
  address: ShippingAddressInput;
  saveAddress: boolean;
  travel_radius_miles?: number;
  max_pickup_weight_lb?: number;
  carrier_priority: CarrierPriority;
}

export function emptyFulfillmentValue(
  offer: SellerFulfillmentOffer | null | undefined,
  signedIn: boolean,
  defaults: BuyerFulfillmentDefaults = readBuyerFulfillmentDefaults(),
): PreNegotiationFulfillmentValue {
  const methods = initialBuyerSelection(offer, defaults);
  return {
    methods,
    preferred:
      defaults.preferred && methods.includes(defaults.preferred) ? defaults.preferred : methods[0],
    addressSource: "new",
    address: EMPTY_SHIPPING_ADDRESS,
    saveAddress: signedIn,
    travel_radius_miles: defaults.travel_radius_miles,
    max_pickup_weight_lb: defaults.max_pickup_weight_lb,
    carrier_priority: defaults.carrier_priority ?? "balanced",
  };
}

export function canStartWithFulfillment(value: PreNegotiationFulfillmentValue): boolean {
  // D1: physical (carrier) needs a complete delivery address before start.
  // Non-carrier / digital no-shipment paths stay exempt.
  if (value.methods.length === 0) return false;
  if (!value.methods.includes("carrier")) return true;
  // Saved-address confirm: do not start until the buyer confirms this session.
  if (value.addressSource === "pending") return false;
  return isCompleteShippingAddress(value.address);
}
