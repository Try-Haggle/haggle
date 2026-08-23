"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { FulfillmentOfferEditor } from "@/components/shipping/fulfillment-offer-editor";
import { ListingParcelFields } from "@/components/shipping/listing-parcel-fields";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_SELLER_OFFER,
  EMPTY_LISTING_PARCEL,
  isCompleteListingParcel,
  type ListingParcelInput,
  type SellerFulfillmentOffer,
} from "@/lib/fulfillment-options";

export default function ParcelGuidePreviewPage() {
  const [fulfillmentOffer, setFulfillmentOffer] =
    useState<SellerFulfillmentOffer>(DEFAULT_SELLER_OFFER);
  const [parcel, setParcel] = useState<ListingParcelInput>(EMPTY_LISTING_PARCEL);
  const canProceed =
    !fulfillmentOffer.options.some((option) => option.method === "carrier") ||
    isCompleteListingParcel(parcel);

  return (
    <main className="flex min-h-screen flex-col bg-surface">
      <div className="mx-auto w-full max-w-lg flex-1 px-5 py-10 sm:px-8">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">
          Local preview · listing step 4
        </p>
        <h1 className="mb-3 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          Set your price
        </h1>
        <p className="mb-10 text-sm text-ink-muted sm:text-base">
          Set your asking price and negotiation floor.
        </p>

        <div>
          <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-ink-secondary">
            How can the buyer get it <span className="text-warning">*</span>
          </span>
          <p className="mb-3 text-xs text-ink-muted">
            MVP ships with a carrier. Pickup, porch drop, and meetup will reconnect later. A close
            box size is enough for a rate.
          </p>
          <FulfillmentOfferEditor
            audience="seller"
            value={fulfillmentOffer}
            onChange={setFulfillmentOffer}
          />
          {fulfillmentOffer.options.some((option) => option.method === "carrier") && (
            <div className="mt-5">
              <ListingParcelFields value={parcel} onChange={setParcel} required />
            </div>
          )}
        </div>
      </div>
      <div className="sticky bottom-0 border-t border-line bg-surface px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-8 sm:pt-3 sm:pb-6">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-4">
          <Button variant="secondary" className="w-24 sm:w-28" disabled>
            <ChevronLeft className="size-4" />
            Back
          </Button>
          <Button className="w-24 sm:w-28" disabled={!canProceed}>
            Next
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </main>
  );
}
