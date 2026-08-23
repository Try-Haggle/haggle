import { z } from "zod";

export const FULFILLMENT_METHODS = ["carrier", "local_pickup", "porch_drop", "meetup"] as const;
export type FulfillmentMethod = (typeof FULFILLMENT_METHODS)[number];

/** In-person methods stay in the type system; only carrier is live for MVP. */
export const MVP_ENABLED_FULFILLMENT_METHODS = ["carrier"] as const;
export const MVP_FULFILLMENT_ONLY_MESSAGE = "Only carrier shipping is available right now.";

export function isMvpEnabledFulfillmentMethod(method: FulfillmentMethod): boolean {
  return (MVP_ENABLED_FULFILLMENT_METHODS as readonly string[]).includes(method);
}

export const CARRIER_PRIORITIES = ["cheapest", "balanced", "fastest"] as const;
export type CarrierPriority = (typeof CARRIER_PRIORITIES)[number];

const MAX_PARCEL_WEIGHT_OZ = 2400;
const MAX_PARCEL_DIMENSION_IN = 120;

export const listingParcelSchema = z.object({
  weight_oz: z.number().positive().max(MAX_PARCEL_WEIGHT_OZ),
  length_in: z.number().positive().max(MAX_PARCEL_DIMENSION_IN).optional(),
  width_in: z.number().positive().max(MAX_PARCEL_DIMENSION_IN).optional(),
  height_in: z.number().positive().max(MAX_PARCEL_DIMENSION_IN).optional(),
});

export type ListingParcel = z.infer<typeof listingParcelSchema>;

const carrierPrioritySchema = z.enum(CARRIER_PRIORITIES);

const ZIP_RE = /^\d{5}$/;
const STATE_RE = /^[A-Z]{2}$/;

export const buyerShippingAddressSchema = z.object({
  name: z.string().min(1).max(200),
  street1: z.string().min(1).max(200),
  street2: z.string().max(200).optional(),
  city: z.string().min(1).max(200),
  state: z.string().regex(STATE_RE, "state must be 2 uppercase letters"),
  zip: z.string().regex(ZIP_RE, "zip must be 5 digits"),
  country: z.string().min(2).max(2).default("US"),
  phone: z.string().max(32).optional(),
});

export type BuyerShippingAddress = z.infer<typeof buyerShippingAddressSchema>;

const methodSchema = z.enum(FULFILLMENT_METHODS);

export const fulfillmentOptionSchema = z.object({
  method: methodSchema,
  radius_miles: z.number().positive().max(500).optional(),
  max_weight_lb: z.number().positive().max(500).optional(),
});

const sellerFulfillmentOfferObjectSchema = z.object({
  options: z.array(fulfillmentOptionSchema).min(1).max(8),
  preferred: methodSchema.optional(),
});

export const sellerFulfillmentOfferSchema = sellerFulfillmentOfferObjectSchema.superRefine(
  (value, ctx) => {
    if (value.options.some((option) => !isMvpEnabledFulfillmentMethod(option.method))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["options"],
        message: MVP_FULFILLMENT_ONLY_MESSAGE,
      });
    }
    if (value.preferred && !isMvpEnabledFulfillmentMethod(value.preferred)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["preferred"],
        message: MVP_FULFILLMENT_ONLY_MESSAGE,
      });
    }
  },
);

export type SellerFulfillmentOffer = z.infer<typeof sellerFulfillmentOfferObjectSchema>;

const fulfillmentConstraintsSchema = z.object({
  travel_radius_miles: z.number().positive().max(500).optional(),
  max_pickup_weight_lb: z.number().positive().max(500).optional(),
});

const fulfillmentPreferenceObjectSchema = z
  .object({
    methods: z.array(methodSchema).min(1).max(8),
    preferred: methodSchema.optional(),
    buyer_address: buyerShippingAddressSchema.optional(),
    save_address: z.boolean().optional(),
    constraints: fulfillmentConstraintsSchema.optional(),
    seller_offer: sellerFulfillmentOfferSchema.optional(),
    carrier_priority: carrierPrioritySchema.optional(),
    parcel: listingParcelSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.methods.some((method) => !isMvpEnabledFulfillmentMethod(method))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["methods"],
        message: MVP_FULFILLMENT_ONLY_MESSAGE,
      });
    }
    if (value.methods.includes("carrier") && !value.buyer_address) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["buyer_address"],
        message: "A delivery address is required when carrier shipping is on the table.",
      });
    }
    if (value.preferred && !value.methods.includes(value.preferred)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["preferred"],
        message: "Preferred method must be one of the selected methods.",
      });
    }
  });

function normalizeMethod(value: unknown): FulfillmentMethod | null {
  if (value === "buyer_arranged") return "meetup";
  if (
    value === "carrier" ||
    value === "local_pickup" ||
    value === "porch_drop" ||
    value === "meetup"
  ) {
    return value;
  }
  return null;
}

function normalizeIncomingPreference(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const src = raw as Record<string, unknown>;
  const fromLegacy = typeof src.method === "string" && !Array.isArray(src.methods);
  const methods = fromLegacy ? [src.method] : src.methods;
  if (!Array.isArray(methods)) return raw;
  const normalized = methods
    .map(normalizeMethod)
    .filter((method): method is FulfillmentMethod => method !== null);
  const sellerOffer = parseSellerFulfillmentOffer(src.seller_offer);
  const next: Record<string, unknown> = {
    ...src,
    methods: normalized,
    preferred: normalizeMethod(src.preferred) ?? (fromLegacy ? normalized[0] : undefined),
  };
  if (sellerOffer) next.seller_offer = sellerOffer;
  else delete next.seller_offer;
  return next;
}

export const fulfillmentPreferenceSchema = z.preprocess(
  normalizeIncomingPreference,
  fulfillmentPreferenceObjectSchema,
);

export type FulfillmentPreference = z.infer<typeof fulfillmentPreferenceObjectSchema>;

export type FulfillmentType = "physical_shipping" | "local_pickup";

/** Prompt-safe shipping facts. Full street stays off the LLM context. */
export interface FulfillmentContext {
  method: FulfillmentMethod;
  methods: FulfillmentMethod[];
  fulfillment_type: FulfillmentType;
  negotiable: true;
  shipping_included_in_total: true;
  shipping_cost_known: boolean;
  shipping_cost_minor?: number;
  destination?: {
    city: string;
    state: string;
    zip: string;
    country: string;
  };
  constraints?: {
    travel_radius_miles?: number;
    max_pickup_weight_lb?: number;
  };
  seller_options?: Array<{
    method: FulfillmentMethod;
    radius_miles?: number;
    max_weight_lb?: number;
  }>;
  carrier_priority?: CarrierPriority;
  parcel?: ListingParcel;
  rate_note: string;
}

export function fulfillmentTypeForMethod(method: FulfillmentMethod): FulfillmentType {
  return method === "carrier" ? "physical_shipping" : "local_pickup";
}

export function parseSellerFulfillmentOffer(raw: unknown): SellerFulfillmentOffer | undefined {
  const parsed = sellerFulfillmentOfferObjectSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  return coerceSellerOfferToMvp(parsed.data);
}

function coerceSellerOfferToMvp(offer: SellerFulfillmentOffer): SellerFulfillmentOffer {
  const options = offer.options.filter((option) => isMvpEnabledFulfillmentMethod(option.method));
  if (options.length === 0) {
    return { options: [{ method: "carrier" }], preferred: "carrier" };
  }
  const preferred =
    offer.preferred && options.some((option) => option.method === offer.preferred)
      ? offer.preferred
      : options[0]?.method;
  return {
    options,
    ...(preferred ? { preferred } : {}),
  };
}

export function parseListingParcel(raw: unknown): ListingParcel | undefined {
  const parsed = listingParcelSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

export function snapshotFulfillmentFields(
  preference?: FulfillmentPreference,
): Record<string, unknown> {
  if (!preference) return {};
  return {
    fulfillment_context: toFulfillmentContext(preference),
    ...(preference.buyer_address ? { buyer_shipping_address: preference.buyer_address } : {}),
  };
}

export function toFulfillmentContext(preference: FulfillmentPreference): FulfillmentContext {
  const methods = preference.methods;
  const method = preference.preferred ?? methods[0] ?? "carrier";
  const address = preference.buyer_address;
  const includesCarrier = methods.includes("carrier");
  const carrierPriority = includesCarrier ? (preference.carrier_priority ?? "balanced") : undefined;

  return {
    method,
    methods,
    fulfillment_type: fulfillmentTypeForMethod(method),
    negotiable: true,
    shipping_included_in_total: true,
    shipping_cost_known: !includesCarrier,
    ...(includesCarrier ? {} : { shipping_cost_minor: 0 }),
    ...(address
      ? {
          destination: {
            city: address.city,
            state: address.state,
            zip: address.zip,
            country: address.country,
          },
        }
      : {}),
    ...(preference.constraints ? { constraints: preference.constraints } : {}),
    ...(preference.seller_offer
      ? {
          seller_options: preference.seller_offer.options.map((option) => ({
            method: option.method,
            ...(option.radius_miles ? { radius_miles: option.radius_miles } : {}),
            ...(option.max_weight_lb ? { max_weight_lb: option.max_weight_lb } : {}),
          })),
        }
      : {}),
    ...(carrierPriority ? { carrier_priority: carrierPriority } : {}),
    ...(preference.parcel ? { parcel: preference.parcel } : {}),
    rate_note: includesCarrier
      ? `Negotiate inside the buyer's selected methods. Buyer carrier priority: ${carrierPriority}. Carrier rate is confirmed when the seller prepares the parcel. Inaccurate parcel size or weight is the seller's responsibility. Include shipping in the all-in total.`
      : "Negotiate inside the buyer's selected no-carrier methods. The payable amount is the agreed item total unless both sides add shipping.",
  };
}

export function readFulfillmentFromSnapshot(snapshot: Record<string, unknown> | null | undefined): {
  fulfillment_type: FulfillmentType;
  fulfillment_context?: FulfillmentContext;
  buyer_shipping_address?: BuyerShippingAddress;
} {
  const context = extractFulfillmentContext(snapshot);
  const address = extractBuyerShippingAddress(snapshot);
  return {
    fulfillment_type: context?.fulfillment_type ?? "physical_shipping",
    ...(context ? { fulfillment_context: context } : {}),
    ...(address ? { buyer_shipping_address: address } : {}),
  };
}

export function extractFulfillmentContext(
  snapshot: Record<string, unknown> | null | undefined,
): FulfillmentContext | undefined {
  const raw = snapshot?.fulfillment_context;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const src = raw as Record<string, unknown>;
  const methods = (Array.isArray(src.methods) ? src.methods : [src.method])
    .map(normalizeMethod)
    .filter((method): method is FulfillmentMethod => method !== null);
  const method = normalizeMethod(src.method) ?? methods[0];
  if (!method) return undefined;
  const destRaw = src.destination;
  const dest =
    destRaw && typeof destRaw === "object" && !Array.isArray(destRaw)
      ? (destRaw as Record<string, unknown>)
      : null;
  const destination = dest
    ? {
        city: typeof dest.city === "string" ? dest.city : "",
        state: typeof dest.state === "string" ? dest.state : "",
        zip: typeof dest.zip === "string" ? dest.zip : "",
        country: typeof dest.country === "string" ? dest.country : "US",
      }
    : undefined;

  const constraintsRaw =
    src.constraints && typeof src.constraints === "object" && !Array.isArray(src.constraints)
      ? (src.constraints as Record<string, unknown>)
      : null;
  const constraints = constraintsRaw
    ? {
        ...(typeof constraintsRaw.travel_radius_miles === "number"
          ? { travel_radius_miles: constraintsRaw.travel_radius_miles }
          : {}),
        ...(typeof constraintsRaw.max_pickup_weight_lb === "number"
          ? { max_pickup_weight_lb: constraintsRaw.max_pickup_weight_lb }
          : {}),
      }
    : undefined;
  const sellerOptions = Array.isArray(src.seller_options)
    ? src.seller_options.flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const option = item as Record<string, unknown>;
        const optionMethod = normalizeMethod(option.method);
        if (!optionMethod) return [];
        return [
          {
            method: optionMethod,
            ...(typeof option.radius_miles === "number"
              ? { radius_miles: option.radius_miles }
              : {}),
            ...(typeof option.max_weight_lb === "number"
              ? { max_weight_lb: option.max_weight_lb }
              : {}),
          },
        ];
      })
    : [];
  const parcel = parseListingParcel(src.parcel);
  const carrierPriority =
    src.carrier_priority === "cheapest" ||
    src.carrier_priority === "balanced" ||
    src.carrier_priority === "fastest"
      ? src.carrier_priority
      : undefined;

  return {
    method,
    methods: methods.length > 0 ? methods : [method],
    fulfillment_type: fulfillmentTypeForMethod(method),
    negotiable: true,
    shipping_included_in_total: true,
    shipping_cost_known: !methods.includes("carrier") && method !== "carrier",
    ...(method === "carrier" || methods.includes("carrier") ? {} : { shipping_cost_minor: 0 }),
    ...(destination?.city && destination.state && destination.zip ? { destination } : {}),
    ...(constraints && Object.keys(constraints).length > 0 ? { constraints } : {}),
    ...(sellerOptions.length > 0 ? { seller_options: sellerOptions } : {}),
    ...(carrierPriority ? { carrier_priority: carrierPriority } : {}),
    ...(parcel ? { parcel } : {}),
    rate_note:
      typeof src.rate_note === "string"
        ? src.rate_note
        : method === "carrier"
          ? "Carrier rate is confirmed when the seller prepares the parcel."
          : "No carrier shipping.",
  };
}

export function extractBuyerShippingAddress(
  snapshot: Record<string, unknown> | null | undefined,
): BuyerShippingAddress | undefined {
  const parsed = buyerShippingAddressSchema.safeParse(snapshot?.buyer_shipping_address);
  return parsed.success ? parsed.data : undefined;
}
