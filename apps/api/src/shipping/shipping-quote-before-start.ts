/**
 * D2 — shipping quote must succeed before negotiation start (physical / carrier).
 *
 * - Quote only (never purchase a label; no real money).
 * - EasyPost test/mock keys only — EZAK fail-closed (A9 spirit).
 * - Digital / A4 no-shipment path skips this gate.
 */
import { isNoShippingFulfillment, normalizeFulfillmentType } from "@haggle/commerce-core";
import {
  classifyEasyPostApiKey,
  type EasyPostKeyMode,
  isEasyPostTestApiKey,
} from "@haggle/shipping-core";
import type {
  BuyerShippingAddress,
  CarrierPriority,
  FulfillmentPreference,
  ListingParcel,
} from "../lib/negotiation-fulfillment.js";
import {
  EASYPOST_TEST_LABEL_DEFAULT_FROM,
  EASYPOST_TEST_LABEL_DEFAULT_PARCEL,
} from "./easypost-test-label.js";
import {
  assertStagingEasyPostTestLabelKeysAllowed,
  classifyEasyPostKeyMode,
  isStagingLiveEasyPostKeysForbiddenError,
  resolveEasyPostTestLabelCandidateKey,
  STAGING_LIVE_EASYPOST_KEYS_FORBIDDEN,
} from "./shipping-execution-mode.js";

export const SHIPPING_QUOTE_ADDRESS_REQUIRED = "SHIPPING_QUOTE_ADDRESS_REQUIRED" as const;
export const SHIPPING_QUOTE_FAILED = "SHIPPING_QUOTE_FAILED" as const;
export const SHIPPING_QUOTE_INCOMPLETE = "SHIPPING_QUOTE_INCOMPLETE" as const;

export type ShippingQuoteBeforeStartSource = "easypost_test" | "mock";

export interface ShippingQuoteRate {
  carrier: string;
  service: string;
  rate: string;
  rate_minor: number;
  est_delivery_days: number | null;
}

export interface ShippingQuoteBeforeStartResult {
  source: ShippingQuoteBeforeStartSource;
  key_mode: EasyPostKeyMode;
  money_charged: false;
  label_purchased: false;
  rate_minor: number;
  carrier: string;
  service: string;
  est_delivery_days: number | null;
  carrier_priority: CarrierPriority;
  rates: ShippingQuoteRate[];
  quoted_at: string;
}

export type ShippingQuoteBeforeStartErrorCode =
  | typeof SHIPPING_QUOTE_ADDRESS_REQUIRED
  | typeof SHIPPING_QUOTE_FAILED
  | typeof SHIPPING_QUOTE_INCOMPLETE
  | typeof STAGING_LIVE_EASYPOST_KEYS_FORBIDDEN;

export class ShippingQuoteBeforeStartError extends Error {
  readonly code: ShippingQuoteBeforeStartErrorCode;
  readonly statusCode: number;

  constructor(code: ShippingQuoteBeforeStartErrorCode, message: string, statusCode = 409) {
    super(message);
    this.name = "ShippingQuoteBeforeStartError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function readListingFulfillmentType(
  listingSnapshot: Record<string, unknown> | null | undefined,
): ReturnType<typeof normalizeFulfillmentType> {
  const listingContext =
    listingSnapshot?.listing_context &&
    typeof listingSnapshot.listing_context === "object" &&
    !Array.isArray(listingSnapshot.listing_context)
      ? (listingSnapshot.listing_context as Record<string, unknown>)
      : null;
  return normalizeFulfillmentType(
    listingSnapshot?.fulfillment_type ?? listingContext?.fulfillment_type,
  );
}

/**
 * Physical carrier starts require a successful quote. Digital / A4 no-shipment skips.
 * When fulfillment is omitted, D2 does not steal D1's address-required scope.
 */
export function startRequiresShippingQuote(input: {
  listingSnapshot?: Record<string, unknown> | null;
  fulfillment?: FulfillmentPreference;
}): boolean {
  const listingType = readListingFulfillmentType(input.listingSnapshot);
  if (isNoShippingFulfillment(listingType)) {
    return false;
  }
  const fulfillment = input.fulfillment;
  if (!fulfillment) return false;
  return fulfillment.methods.includes("carrier");
}

export function selectRateByCarrierPriority(
  rates: ShippingQuoteRate[],
  priority: CarrierPriority,
): ShippingQuoteRate | null {
  if (rates.length === 0) return null;
  const sortedByPrice = [...rates].sort((a, b) => a.rate_minor - b.rate_minor);

  if (priority === "cheapest") {
    return sortedByPrice[0] ?? null;
  }

  if (priority === "fastest") {
    return (
      [...rates].sort((a, b) => {
        const aDays = a.est_delivery_days ?? Number.POSITIVE_INFINITY;
        const bDays = b.est_delivery_days ?? Number.POSITIVE_INFINITY;
        if (aDays !== bDays) return aDays - bDays;
        return a.rate_minor - b.rate_minor;
      })[0] ?? null
    );
  }

  // balanced: prefer a mid-tier service (Priority) when present, else median by price
  const priorityService = rates.find(
    (rate) => /priority/i.test(rate.service) && !/express/i.test(rate.service),
  );
  if (priorityService) return priorityService;
  return sortedByPrice[Math.floor((sortedByPrice.length - 1) / 2)] ?? null;
}

const MOCK_RATES: ShippingQuoteRate[] = [
  {
    carrier: "USPS",
    service: "GroundAdvantage",
    rate: "5.50",
    rate_minor: 550,
    est_delivery_days: 5,
  },
  {
    carrier: "USPS",
    service: "Priority",
    rate: "8.25",
    rate_minor: 825,
    est_delivery_days: 3,
  },
  {
    carrier: "USPS",
    service: "Express",
    rate: "26.35",
    rate_minor: 2635,
    est_delivery_days: 1,
  },
  {
    carrier: "UPS",
    service: "Ground",
    rate: "9.50",
    rate_minor: 950,
    est_delivery_days: 5,
  },
  {
    carrier: "FedEx",
    service: "Ground",
    rate: "9.75",
    rate_minor: 975,
    est_delivery_days: 5,
  },
];

export interface QuoteShippingBeforeStartInput {
  to_address: BuyerShippingAddress;
  from_address?: {
    name: string;
    street1: string;
    street2?: string;
    city: string;
    state: string;
    zip: string;
    country: string;
    phone?: string;
  };
  parcel?: ListingParcel;
  carrier_priority?: CarrierPriority;
  env?: Partial<NodeJS.ProcessEnv>;
  /** Injectable rate fetch for unit tests — must not purchase labels. */
  fetchRates?: (args: {
    apiKey: string;
    from_address: NonNullable<QuoteShippingBeforeStartInput["from_address"]>;
    to_address: BuyerShippingAddress;
    parcel: ListingParcel;
  }) => Promise<ShippingQuoteRate[]>;
}

function mockRates(): ShippingQuoteRate[] {
  return MOCK_RATES.map((rate) => ({ ...rate }));
}

async function fetchEasyPostTestRates(
  apiKey: string,
  from_address: NonNullable<QuoteShippingBeforeStartInput["from_address"]>,
  to_address: BuyerShippingAddress,
  parcel: ListingParcel,
): Promise<ShippingQuoteRate[]> {
  const EasyPost = (await import("@easypost/api")).default;
  const client = new EasyPost(apiKey);
  const epShipment = await client.Shipment.create({
    from_address: {
      name: from_address.name,
      street1: from_address.street1,
      street2: from_address.street2,
      city: from_address.city,
      state: from_address.state,
      zip: from_address.zip,
      country: from_address.country,
    },
    to_address: {
      name: to_address.name,
      street1: to_address.street1,
      street2: to_address.street2,
      city: to_address.city,
      state: to_address.state,
      zip: to_address.zip,
      country: to_address.country,
    },
    parcel: {
      weight: parcel.weight_oz,
      length: parcel.length_in,
      width: parcel.width_in,
      height: parcel.height_in,
    },
  });

  return (epShipment.rates ?? []).map(
    (r: {
      carrier?: string;
      service?: string;
      rate?: string;
      est_delivery_days?: number | null;
    }) => ({
      carrier: r.carrier ?? "unknown",
      service: r.service ?? "unknown",
      rate: r.rate ?? "0",
      rate_minor: Math.round(parseFloat(r.rate ?? "0") * 100),
      est_delivery_days: r.est_delivery_days ?? null,
    }),
  );
}

/**
 * Quote shipping for negotiation start. Never buys a label.
 * Test key (EZTK) or mock only — live EZAK fail-closed.
 */
export async function quoteShippingBeforeStart(
  input: QuoteShippingBeforeStartInput,
): Promise<ShippingQuoteBeforeStartResult> {
  const env = input.env ?? process.env;
  const candidateKey = resolveEasyPostTestLabelCandidateKey(env);
  const keyMode = classifyEasyPostKeyMode(candidateKey ?? undefined);
  const carrierPriority = input.carrier_priority ?? "balanced";
  const fromAddress = input.from_address ?? EASYPOST_TEST_LABEL_DEFAULT_FROM;
  const parcel = input.parcel ?? EASYPOST_TEST_LABEL_DEFAULT_PARCEL;

  assertStagingEasyPostTestLabelKeysAllowed({ HAGGLE_ENV: env.HAGGLE_ENV }, keyMode);
  if (keyMode === "live") {
    throw new ShippingQuoteBeforeStartError(
      STAGING_LIVE_EASYPOST_KEYS_FORBIDDEN,
      `${STAGING_LIVE_EASYPOST_KEYS_FORBIDDEN}: Shipping quote before start forbids live (EZAK) keys. Use EASYPOST_TEST_API_KEY or mock.`,
      503,
    );
  }

  let rates: ShippingQuoteRate[] = [];
  let source: ShippingQuoteBeforeStartSource = "mock";

  if (keyMode === "test" && candidateKey && isEasyPostTestApiKey(candidateKey)) {
    try {
      rates = input.fetchRates
        ? await input.fetchRates({
            apiKey: candidateKey,
            from_address: fromAddress,
            to_address: input.to_address,
            parcel,
          })
        : await fetchEasyPostTestRates(candidateKey, fromAddress, input.to_address, parcel);
      source = "easypost_test";
    } catch (error) {
      if (isStagingLiveEasyPostKeysForbiddenError(error)) throw error;
      throw new ShippingQuoteBeforeStartError(
        SHIPPING_QUOTE_FAILED,
        `Shipping quote failed before negotiation start: ${(error as Error).message}`,
      );
    }
  } else {
    // missing / unknown → deterministic mock rates (never call EasyPost with a non-test key)
    rates = input.fetchRates
      ? await input.fetchRates({
          apiKey: "",
          from_address: fromAddress,
          to_address: input.to_address,
          parcel,
        })
      : mockRates();
    source = "mock";
  }

  if (!Array.isArray(rates) || rates.length === 0) {
    throw new ShippingQuoteBeforeStartError(
      SHIPPING_QUOTE_INCOMPLETE,
      "Shipping quote returned no rates; cannot start negotiation without a confirmed shipping fee.",
    );
  }

  const incomplete = rates.some(
    (rate) =>
      !Number.isFinite(rate.rate_minor) ||
      rate.rate_minor < 0 ||
      typeof rate.carrier !== "string" ||
      typeof rate.service !== "string",
  );
  if (incomplete) {
    throw new ShippingQuoteBeforeStartError(
      SHIPPING_QUOTE_INCOMPLETE,
      "Shipping quote rates are incomplete; cannot start negotiation without a confirmed shipping fee.",
    );
  }

  const selected = selectRateByCarrierPriority(rates, carrierPriority);
  if (!selected || !Number.isFinite(selected.rate_minor)) {
    throw new ShippingQuoteBeforeStartError(
      SHIPPING_QUOTE_INCOMPLETE,
      "Could not select a shipping rate for the buyer carrier priority.",
    );
  }

  return {
    source,
    key_mode: keyMode === "test" ? "test" : classifyEasyPostApiKey(candidateKey),
    money_charged: false,
    label_purchased: false,
    rate_minor: selected.rate_minor,
    carrier: selected.carrier,
    service: selected.service,
    est_delivery_days: selected.est_delivery_days,
    carrier_priority: carrierPriority,
    rates,
    quoted_at: new Date().toISOString(),
  };
}

export function shippingQuoteRejectBody(
  error: ShippingQuoteBeforeStartError,
): Record<string, unknown> {
  return {
    error: error.code,
    message: error.message,
    money_charged: false,
    label_purchased: false,
  };
}
