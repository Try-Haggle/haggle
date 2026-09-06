"use client";

import { ArrowRight } from "lucide-react";
import { useState } from "react";
import {
  canStartWithFulfillment,
  emptyFulfillmentValue,
  PreNegotiationFulfillment,
  type PreNegotiationFulfillmentValue,
} from "@/components/shipping/pre-negotiation-fulfillment";
import { Button } from "@/components/ui/button";
import { DEFAULT_SELLER_OFFER } from "@/lib/fulfillment-options";

export default function BuyerFulfillmentPreviewPage() {
  const [fulfillment, setFulfillment] = useState<PreNegotiationFulfillmentValue>(() =>
    emptyFulfillmentValue(DEFAULT_SELLER_OFFER, false),
  );
  const canStart = canStartWithFulfillment(fulfillment);

  return (
    <main className="flex min-h-screen flex-col bg-surface">
      <div className="mx-auto w-full max-w-lg flex-1 px-5 py-10 sm:px-8">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">
          Local preview · buyer landing
        </p>
        <h1 className="mb-3 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          Start negotiation
        </h1>
        <p className="mb-8 text-sm text-ink-muted sm:text-base">
          Same start gate as the public listing page. Delivery address is optional at start — it belongs to checkout/shipping.
        </p>

        <PreNegotiationFulfillment
          signedIn={false}
          offer={DEFAULT_SELLER_OFFER}
          parcel={{ weight_oz: 16, length_in: 10, width_in: 8, height_in: 4 }}
          value={fulfillment}
          onChange={setFulfillment}
        />

        <div className="mt-6">
          <Button fullWidth disabled={!canStart}>
            Start Negotiation
            <ArrowRight className="size-4" aria-hidden="true" />
          </Button>
          {!canStart && (
            <p className="mt-3 text-center text-ink-muted text-sm">
              Choose at least one delivery option to start.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
