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

export interface PreNegotiationFulfillmentValue {
  methods: FulfillmentMethod[];
  preferred?: FulfillmentMethod;
  addressSource: "default" | "new";
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
  return isCompleteShippingAddress(value.address);
}
