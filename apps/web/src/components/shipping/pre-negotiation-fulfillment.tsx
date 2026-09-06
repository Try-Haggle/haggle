"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { SelectableOptionCard } from "@/components/ui/selectable-option-card";
import { api } from "@/lib/api-client";
import {
  type FulfillmentMethod,
  formatListingParcel,
  type ListingParcel,
  METHOD_COPY,
  offeredMethods,
  type SellerFulfillmentOffer,
  toggleMethod,
} from "@/lib/fulfillment-options";
import {
  clearPendingDefaultAddress,
  EMPTY_SHIPPING_ADDRESS,
  formatAddressLine,
  isCompleteShippingAddress,
  isDefaultSavedAddress,
  readPendingDefaultAddress,
  type SavedAddress,
  type ShippingAddressInput,
  savedAddressToInput,
  toApiAddress,
} from "@/lib/shipping-address";
import { CarrierPriorityPicker } from "./carrier-priority-picker";
import type { PreNegotiationFulfillmentValue } from "./pre-negotiation-fulfillment-state";
import { ShippingAddressFields } from "./shipping-address-fields";

export {
  canStartWithFulfillment,
  emptyFulfillmentValue,
  type PreNegotiationFulfillmentValue,
} from "./pre-negotiation-fulfillment-state";

export function PreNegotiationFulfillment({
  signedIn,
  offer,
  parcel,
  value,
  onChange,
}: {
  signedIn: boolean;
  offer: SellerFulfillmentOffer | null;
  parcel?: ListingParcel | null;
  value: PreNegotiationFulfillmentValue;
  onChange: (next: PreNegotiationFulfillmentValue) => void;
}) {
  const available = offeredMethods(offer);
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const defaultAddress = savedAddresses.find(isDefaultSavedAddress) ?? savedAddresses[0] ?? null;
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);
  onChangeRef.current = onChange;
  valueRef.current = value;

  useEffect(() => {
    if (!signedIn) return;
    const pending = readPendingDefaultAddress();
    const persistPending = pending
      ? api
          .post("/users/me/addresses", {
            ...toApiAddress(pending),
            label: "home",
            is_default: true,
          })
          .then(() => clearPendingDefaultAddress())
          .catch(() => undefined)
      : Promise.resolve();

    persistPending
      .then(() => api.get<{ addresses: SavedAddress[] }>("/users/me/addresses"))
      .then((res) => {
        const addresses = res.addresses ?? [];
        setSavedAddresses(addresses);
        const preferred = addresses.find(isDefaultSavedAddress) ?? addresses[0];
        if (!preferred) return;
        onChangeRef.current({
          ...valueRef.current,
          addressSource: "default",
          address: savedAddressToInput(preferred),
        });
      })
      .catch(() => {
        // Guest-like fallback: the buyer can type a new address.
      });
  }, [signedIn]);

  const setMethods = (method: FulfillmentMethod) => {
    const methods = toggleMethod(value.methods, method);
    if (methods.length === 0) return;
    onChange({
      ...value,
      methods,
      preferred:
        value.preferred && methods.includes(value.preferred) ? value.preferred : methods[0],
    });
  };

  const needsAddress = value.methods.includes("carrier");
  const needsTravel = value.methods.some((method) => method !== "carrier");

  return (
    <section className="rounded-2xl border border-line bg-surface-raised p-6">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-ink-muted">
        Delivery before you negotiate
      </p>
      <h2 className="text-lg font-semibold text-ink">
        {available.length === 1 && available[0] === "carrier"
          ? "Where should this ship?"
          : "What ways can this deal close?"}
      </h2>
      <p className="mt-2 text-sm text-ink-secondary">
        {available.length === 1 && available[0] === "carrier"
          ? "This listing ships with a carrier. Pickup and meetup will come later."
          : "Pick one default, or keep several options open. The agents only negotiate inside this set."}
        {available.length > 1 && offer
          ? " These are the methods the seller offered on the listing."
          : available.length > 1
            ? " The seller did not lock methods, so you can start from any of these."
            : ""}
        {parcel ? ` Seller parcel: ${formatListingParcel(parcel)}.` : ""}
      </p>

      {available.length > 1 && (
        <div className="mt-4 grid gap-3">
          {available.map((method) => {
            const sellerOption = offer?.options.find((option) => option.method === method);
            const selected = value.methods.includes(method);
            const details = [
              sellerOption?.radius_miles ? `seller: within ${sellerOption.radius_miles} mi` : null,
              sellerOption?.max_weight_lb ? `up to ${sellerOption.max_weight_lb} lb` : null,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <div key={method} className="space-y-2">
                <SelectableOptionCard
                  selected={selected}
                  title={METHOD_COPY[method].title}
                  description={`${METHOD_COPY[method].buyer}${details ? ` ${details}.` : ""}`}
                  onClick={() => setMethods(method)}
                />
                {selected && (
                  <label className="ml-1 flex items-center gap-2 text-xs text-ink-secondary">
                    <input
                      type="radio"
                      name="buyer-fulfillment-preferred"
                      checked={value.preferred === method}
                      onChange={() => onChange({ ...value, preferred: method })}
                    />
                    Start from this one
                  </label>
                )}
              </div>
            );
          })}
        </div>
      )}

      {needsTravel && (
        <div className="mt-5 grid grid-cols-2 gap-3">
          <label className="text-xs text-ink-muted" htmlFor="buyer-travel-miles">
            I can travel (miles)
            <Input
              id="buyer-travel-miles"
              className="mt-1"
              inputMode="decimal"
              value={value.travel_radius_miles ?? ""}
              placeholder="10"
              onChange={(event) => {
                const miles = Number(event.target.value);
                onChange({
                  ...value,
                  travel_radius_miles: Number.isFinite(miles) && miles > 0 ? miles : undefined,
                });
              }}
            />
          </label>
          <label className="text-xs text-ink-muted" htmlFor="buyer-carry-lb">
            I can carry (lb)
            <Input
              id="buyer-carry-lb"
              className="mt-1"
              inputMode="decimal"
              value={value.max_pickup_weight_lb ?? ""}
              placeholder="20"
              onChange={(event) => {
                const weight = Number(event.target.value);
                onChange({
                  ...value,
                  max_pickup_weight_lb: Number.isFinite(weight) && weight > 0 ? weight : undefined,
                });
              }}
            />
          </label>
        </div>
      )}

      {needsAddress && (
        <div className="mt-5">
          <CarrierPriorityPicker
            value={value.carrier_priority}
            onChange={(carrier_priority) => onChange({ ...value, carrier_priority })}
          />
        </div>
      )}

      {needsAddress && (
        <div className="mt-5 space-y-4">
          {defaultAddress && (
            <div className="grid gap-3">
              <SelectableOptionCard
                selected={value.addressSource === "default"}
                title={`Use ${defaultAddress.label ?? "saved"} address`}
                description={`${defaultAddress.name} · ${formatAddressLine(defaultAddress)}`}
                onClick={() =>
                  onChange({
                    ...value,
                    addressSource: "default",
                    address: savedAddressToInput(defaultAddress),
                  })
                }
              />
              <SelectableOptionCard
                selected={value.addressSource === "new"}
                title="Ship to a different address"
                description="Enter a new destination for this deal."
                onClick={() =>
                  onChange({
                    ...value,
                    addressSource: "new",
                    address: value.addressSource === "new" ? value.address : EMPTY_SHIPPING_ADDRESS,
                    saveAddress: signedIn,
                  })
                }
              />
            </div>
          )}

          {(value.addressSource === "new" || !defaultAddress) && (
            <ShippingAddressFields
              idPrefix="nego-ship"
              value={value.address}
              onChange={(address) => onChange({ ...value, address })}
            />
          )}

          {signedIn && (value.addressSource === "new" || !defaultAddress) && (
            <label className="flex items-center gap-2 text-sm text-ink-secondary">
              <input
                type="checkbox"
                checked={value.saveAddress}
                onChange={(event) => onChange({ ...value, saveAddress: event.target.checked })}
              />
              Save as my default address
            </label>
          )}

          <p className="text-xs text-ink-muted">
            Exact carrier dollars wait on the seller&apos;s parcel. That uncertainty is the
            seller&apos;s responsibility, not a surprise fee after you pay.
          </p>
        </div>
      )}
    </section>
  );
}
