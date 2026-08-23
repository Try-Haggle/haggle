import type { ActiveTerm, FulfillmentContextMemory, ListingContextMemory } from "../types.js";

function parcelFrom(
  fulfillment?: FulfillmentContextMemory,
  listingParcel?: ListingContextMemory["parcel"],
): NonNullable<ListingContextMemory["parcel"]> | undefined {
  return fulfillment?.parcel ?? listingParcel;
}

function formatParcelDims(parcel: NonNullable<ListingContextMemory["parcel"]>): string | undefined {
  if (
    typeof parcel.length_in !== "number" ||
    typeof parcel.width_in !== "number" ||
    typeof parcel.height_in !== "number"
  ) {
    return undefined;
  }
  return `${parcel.length_in}x${parcel.width_in}x${parcel.height_in}in`;
}

/** Structured engine terms from the pre-negotiation fulfillment set. */
export function buildFulfillmentActiveTerms(
  fulfillment?: FulfillmentContextMemory,
  listingParcel?: ListingContextMemory["parcel"],
): ActiveTerm[] {
  const parcel = parcelFrom(fulfillment, listingParcel);
  if (!fulfillment && !parcel) return [];

  const terms: ActiveTerm[] = [];
  const methods = fulfillment?.methods?.length
    ? fulfillment.methods
    : fulfillment?.method
      ? [fulfillment.method === "buyer_arranged" ? "meetup" : fulfillment.method]
      : [];
  const opening = fulfillment?.method === "buyer_arranged" ? "meetup" : fulfillment?.method;

  if (methods.length > 0) {
    terms.push({
      term_id: "shipping_method",
      category: "LOGISTICS",
      display_name: "배송 방법",
      status: methods.length === 1 ? "proposed" : "unresolved",
      value: methods.length === 1 ? methods[0] : methods.join(","),
      proposed_by: "buyer",
      round_introduced: 0,
    });
  }

  if (fulfillment) {
    terms.push({
      term_id: "shipping_cost_split",
      category: "FINANCIAL",
      display_name: "배송비 부담",
      status: "agreed",
      value: "included_in_total",
      proposed_by: "protocol",
      round_introduced: 0,
    });
  }

  if (methods.includes("carrier") || opening === "carrier") {
    terms.push({
      term_id: "carrier_service_priority",
      category: "LOGISTICS",
      display_name: "택배 우선순위",
      status: "proposed",
      value: fulfillment?.carrier_priority ?? "balanced",
      proposed_by: "buyer",
      round_introduced: 0,
    });
  }

  if (typeof parcel?.weight_oz === "number") {
    terms.push({
      term_id: "parcel_weight_oz",
      category: "LOGISTICS",
      display_name: "소포 무게",
      status: "agreed",
      value: parcel.weight_oz,
      proposed_by: "seller",
      round_introduced: 0,
    });
  }

  const dims = parcel ? formatParcelDims(parcel) : undefined;
  if (dims) {
    terms.push({
      term_id: "parcel_dims",
      category: "LOGISTICS",
      display_name: "소포 크기",
      status: "agreed",
      value: dims,
      proposed_by: "seller",
      round_introduced: 0,
    });
  }

  return terms;
}

export function summarizeFulfillmentTerms(terms: ActiveTerm[]): string {
  if (terms.length === 0) return "";
  return terms
    .map((term) =>
      term.value !== undefined ? `${term.display_name}=${String(term.value)}` : term.display_name,
    )
    .join("; ");
}
