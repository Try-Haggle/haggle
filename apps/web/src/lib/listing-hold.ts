export type PublicListingHoldState = "held" | "funding" | "sold";

export function listingHoldLabel(state: PublicListingHoldState | null | undefined): string | null {
  if (state === "held") return "Held";
  if (state === "funding") return "Payment in progress";
  if (state === "sold") return "Sold";
  return null;
}

export function listingHoldHint(state: PublicListingHoldState | null | undefined): string | null {
  if (state === "held") return "A buyer has an agreement. First to pay gets it.";
  if (state === "funding")
    return "Someone is paying now. You can still start — first funded payment wins.";
  if (state === "sold") return "This item sold.";
  return null;
}
