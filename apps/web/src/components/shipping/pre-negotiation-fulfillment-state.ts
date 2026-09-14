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
 * - default: account has a saved shipping address and we use it for quote/start
 * - new: buyer typed a new address (or had none saved / opted out of saved)
 * - pending: legacy unused gate from the confirm-click flow (kept for defensive checks)
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
  // Legacy pending gate: never start/quote on an unconfirmed empty pending state.
  if (value.addressSource === "pending") return false;
  return isCompleteShippingAddress(value.address);
}
