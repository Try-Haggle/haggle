export const FULFILLMENT_METHODS = ["carrier", "local_pickup", "porch_drop", "meetup"] as const;
export type FulfillmentMethod = (typeof FULFILLMENT_METHODS)[number];

/** In-person methods stay in the type system; only carrier is live for MVP. */
export const MVP_ENABLED_FULFILLMENT_METHODS: readonly FulfillmentMethod[] = ["carrier"];

export function isMvpEnabledFulfillmentMethod(method: FulfillmentMethod): boolean {
  return MVP_ENABLED_FULFILLMENT_METHODS.includes(method);
}

export const BUYER_DEFAULTS_KEY = "haggle:fulfillment-defaults";

export const CARRIER_PRIORITIES = ["cheapest", "balanced", "fastest"] as const;
export type CarrierPriority = (typeof CARRIER_PRIORITIES)[number];

export const CARRIER_PRIORITY_COPY: Record<
  CarrierPriority,
  { title: string; description: string }
> = {
  cheapest: {
    title: "Price first",
    description: "Pick the lowest rate. Delivery can take longer.",
  },
  balanced: {
    title: "Balanced",
    description: "A middle option between price and speed.",
  },
  fastest: {
    title: "Speed first",
    description: "Prefer quicker delivery even if it costs more.",
  },
};

export interface ListingParcel {
  weight_oz: number;
  length_in?: number;
  width_in?: number;
  height_in?: number;
}

export interface ListingParcelInput {
  weight_oz: string;
  length_in: string;
  width_in: string;
  height_in: string;
}

export const EMPTY_LISTING_PARCEL: ListingParcelInput = {
  weight_oz: "",
  length_in: "",
  width_in: "",
  height_in: "",
};

export interface ParcelSizeGuide {
  id: string;
  title: string;
  hint: string;
  parcel: Required<ListingParcel>;
}

/** Close-enough boxes so sellers do not have to measure. */
export const PARCEL_SIZE_GUIDES: ParcelSizeGuide[] = [
  {
    id: "phone",
    title: "Phone or small gadget",
    hint: "Padded mailer or original box",
    parcel: { weight_oz: 16, length_in: 8, width_in: 6, height_in: 3 },
  },
  {
    id: "tablet",
    title: "Tablet, book, or game",
    hint: "Thin retail box",
    parcel: { weight_oz: 24, length_in: 12, width_in: 9, height_in: 2 },
  },
  {
    id: "clothes",
    title: "Clothes or hoodie",
    hint: "Poly mailer or flat box",
    parcel: { weight_oz: 24, length_in: 14, width_in: 10, height_in: 4 },
  },
  {
    id: "shoebox",
    title: "Shoebox",
    hint: "A pair of shoes or similar",
    parcel: { weight_oz: 40, length_in: 13, width_in: 8, height_in: 5 },
  },
  {
    id: "small-box",
    title: "Small box",
    hint: "About a kitchen-appliance box",
    parcel: { weight_oz: 80, length_in: 16, width_in: 12, height_in: 8 },
  },
];

export function matchingParcelGuideId(input: ListingParcelInput): string | null {
  const parcel = listingParcelFromInput(input);
  if (!parcel) return null;
  const match = PARCEL_SIZE_GUIDES.find(
    (guide) =>
      guide.parcel.weight_oz === parcel.weight_oz &&
      guide.parcel.length_in === parcel.length_in &&
      guide.parcel.width_in === parcel.width_in &&
      guide.parcel.height_in === parcel.height_in,
  );
  return match?.id ?? null;
}

export interface FulfillmentOption {
  method: FulfillmentMethod;
  radius_miles?: number;
  max_weight_lb?: number;
}

export interface SellerFulfillmentOffer {
  options: FulfillmentOption[];
  preferred?: FulfillmentMethod;
}

export interface BuyerFulfillmentDefaults {
  acceptable: FulfillmentMethod[];
  preferred?: FulfillmentMethod;
  travel_radius_miles?: number;
  max_pickup_weight_lb?: number;
  carrier_priority?: CarrierPriority;
}

export const METHOD_COPY: Record<
  FulfillmentMethod,
  { title: string; seller: string; buyer: string }
> = {
  carrier: {
    title: "Seller ships",
    seller: "I will ship with a carrier. A close box size is enough.",
    buyer: "Have it shipped to my address. Shipping stays inside the all-in price.",
  },
  local_pickup: {
    title: "Buyer picks up",
    seller: "The buyer can come to me and take the item.",
    buyer: "I can go get it if I am close enough.",
  },
  porch_drop: {
    title: "Leave at the door",
    seller: "I can leave it in front of my place for the buyer.",
    buyer: "I can collect it from the seller's door.",
  },
  meetup: {
    title: "Meet nearby",
    seller: "We can meet within a set radius.",
    buyer: "I can meet nearby if the distance and weight work.",
  },
};

export const DEFAULT_SELLER_OFFER: SellerFulfillmentOffer = {
  options: [{ method: "carrier" }],
  preferred: "carrier",
};

export const DEFAULT_BUYER_DEFAULTS: BuyerFulfillmentDefaults = {
  acceptable: ["carrier"],
  preferred: "carrier",
  carrier_priority: "balanced",
};

export function isCarrierPriority(value: unknown): value is CarrierPriority {
  return value === "cheapest" || value === "balanced" || value === "fastest";
}

export function parseListingParcel(raw: unknown): ListingParcel | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  if (typeof src.weight_oz !== "number" || !Number.isFinite(src.weight_oz) || src.weight_oz <= 0) {
    return null;
  }
  const parcel: ListingParcel = { weight_oz: src.weight_oz };
  if (typeof src.length_in === "number" && src.length_in > 0) parcel.length_in = src.length_in;
  if (typeof src.width_in === "number" && src.width_in > 0) parcel.width_in = src.width_in;
  if (typeof src.height_in === "number" && src.height_in > 0) parcel.height_in = src.height_in;
  return parcel;
}

export function listingParcelToInput(parcel: ListingParcel | null | undefined): ListingParcelInput {
  if (!parcel) return EMPTY_LISTING_PARCEL;
  return {
    weight_oz: String(parcel.weight_oz),
    length_in: parcel.length_in != null ? String(parcel.length_in) : "",
    width_in: parcel.width_in != null ? String(parcel.width_in) : "",
    height_in: parcel.height_in != null ? String(parcel.height_in) : "",
  };
}

export function listingParcelFromInput(input: ListingParcelInput): ListingParcel | null {
  const weight = Number(input.weight_oz);
  if (!Number.isFinite(weight) || weight <= 0) return null;
  const parcel: ListingParcel = { weight_oz: weight };
  const length = Number(input.length_in);
  const width = Number(input.width_in);
  const height = Number(input.height_in);
  if (Number.isFinite(length) && length > 0) parcel.length_in = length;
  if (Number.isFinite(width) && width > 0) parcel.width_in = width;
  if (Number.isFinite(height) && height > 0) parcel.height_in = height;
  return parcel;
}

export function isCompleteListingParcel(input: ListingParcelInput): boolean {
  const parcel = listingParcelFromInput(input);
  return Boolean(parcel?.length_in && parcel.width_in && parcel.height_in);
}

export function formatListingParcel(parcel: ListingParcel): string {
  const dims =
    parcel.length_in && parcel.width_in && parcel.height_in
      ? `${parcel.length_in} × ${parcel.width_in} × ${parcel.height_in} in`
      : null;
  return dims ? `${parcel.weight_oz} oz · ${dims}` : `${parcel.weight_oz} oz`;
}

export function isFulfillmentMethod(value: unknown): value is FulfillmentMethod {
  return (
    value === "carrier" || value === "local_pickup" || value === "porch_drop" || value === "meetup"
  );
}

export function normalizeFulfillmentMethod(value: unknown): FulfillmentMethod | null {
  if (value === "buyer_arranged") return "meetup";
  return isFulfillmentMethod(value) ? value : null;
}

export function parseSellerFulfillmentOffer(raw: unknown): SellerFulfillmentOffer | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  const optionsRaw = Array.isArray(src.options) ? src.options : [];
  const options = optionsRaw.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const option = item as Record<string, unknown>;
    const method = normalizeFulfillmentMethod(option.method);
    if (!method) return [];
    const next: FulfillmentOption = { method };
    if (typeof option.radius_miles === "number" && option.radius_miles > 0) {
      next.radius_miles = option.radius_miles;
    }
    if (typeof option.max_weight_lb === "number" && option.max_weight_lb > 0) {
      next.max_weight_lb = option.max_weight_lb;
    }
    return [next];
  });
  if (options.length === 0) return null;
  const preferred = normalizeFulfillmentMethod(src.preferred);
  return coerceSellerOfferToMvp({
    options,
    ...(preferred && options.some((option) => option.method === preferred) ? { preferred } : {}),
  });
}

function coerceSellerOfferToMvp(offer: SellerFulfillmentOffer): SellerFulfillmentOffer {
  const options = offer.options.filter((option) => isMvpEnabledFulfillmentMethod(option.method));
  if (options.length === 0) return DEFAULT_SELLER_OFFER;
  const preferred =
    offer.preferred && options.some((option) => option.method === offer.preferred)
      ? offer.preferred
      : options[0]?.method;
  return {
    options,
    ...(preferred ? { preferred } : {}),
  };
}

export function offeredMethods(
  offer: SellerFulfillmentOffer | null | undefined,
): FulfillmentMethod[] {
  const methods = offer?.options.map((option) => option.method) ?? [
    ...MVP_ENABLED_FULFILLMENT_METHODS,
  ];
  const enabled = methods.filter(isMvpEnabledFulfillmentMethod);
  return enabled.length > 0 ? enabled : [...MVP_ENABLED_FULFILLMENT_METHODS];
}

export function toggleMethod(
  methods: FulfillmentMethod[],
  method: FulfillmentMethod,
): FulfillmentMethod[] {
  return methods.includes(method)
    ? methods.filter((item) => item !== method)
    : [...methods, method];
}

export function readBuyerFulfillmentDefaults(): BuyerFulfillmentDefaults {
  if (typeof window === "undefined") return DEFAULT_BUYER_DEFAULTS;
  try {
    const raw = window.localStorage.getItem(BUYER_DEFAULTS_KEY);
    if (!raw) return DEFAULT_BUYER_DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<BuyerFulfillmentDefaults>;
    const acceptable = (parsed.acceptable ?? [])
      .map(normalizeFulfillmentMethod)
      .filter((method): method is FulfillmentMethod => method !== null)
      .filter(isMvpEnabledFulfillmentMethod);
    return {
      acceptable: acceptable.length > 0 ? acceptable : DEFAULT_BUYER_DEFAULTS.acceptable,
      preferred: (() => {
        const preferred = normalizeFulfillmentMethod(parsed.preferred);
        return preferred && isMvpEnabledFulfillmentMethod(preferred) ? preferred : undefined;
      })(),
      travel_radius_miles:
        typeof parsed.travel_radius_miles === "number" ? parsed.travel_radius_miles : undefined,
      max_pickup_weight_lb:
        typeof parsed.max_pickup_weight_lb === "number" ? parsed.max_pickup_weight_lb : undefined,
      carrier_priority: isCarrierPriority(parsed.carrier_priority)
        ? parsed.carrier_priority
        : DEFAULT_BUYER_DEFAULTS.carrier_priority,
    };
  } catch {
    return DEFAULT_BUYER_DEFAULTS;
  }
}

export function writeBuyerFulfillmentDefaults(defaults: BuyerFulfillmentDefaults) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(BUYER_DEFAULTS_KEY, JSON.stringify(defaults));
}

export function initialBuyerSelection(
  offer: SellerFulfillmentOffer | null | undefined,
  defaults: BuyerFulfillmentDefaults = readBuyerFulfillmentDefaults(),
): FulfillmentMethod[] {
  const available = offeredMethods(offer);
  const overlap = defaults.acceptable.filter((method) => available.includes(method));
  if (overlap.length > 0) return overlap;
  if (offer?.preferred && available.includes(offer.preferred)) return [offer.preferred];
  return available.slice(0, 1);
}
