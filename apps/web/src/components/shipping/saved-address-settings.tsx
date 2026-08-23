"use client";

import { useEffect, useState } from "react";
import { Alert, Button } from "@/components/ui";
import { ApiError, api } from "@/lib/api-client";
import {
  type BuyerFulfillmentDefaults,
  DEFAULT_BUYER_DEFAULTS,
  readBuyerFulfillmentDefaults,
  type SellerFulfillmentOffer,
  writeBuyerFulfillmentDefaults,
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
  toApiAddress,
} from "@/lib/shipping-address";
import { CarrierPriorityPicker } from "./carrier-priority-picker";
import { FulfillmentOfferEditor } from "./fulfillment-offer-editor";
import { ShippingAddressFields } from "./shipping-address-fields";

export function SavedAddressSettings() {
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [form, setForm] = useState<ShippingAddressInput>(EMPTY_SHIPPING_ADDRESS);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [defaults, setDefaults] = useState<BuyerFulfillmentDefaults>(DEFAULT_BUYER_DEFAULTS);

  useEffect(() => {
    setDefaults(readBuyerFulfillmentDefaults());
  }, []);

  const offerFromDefaults: SellerFulfillmentOffer = {
    options: defaults.acceptable.map((method) => ({
      method,
      ...(method !== "carrier" && defaults.travel_radius_miles
        ? { radius_miles: defaults.travel_radius_miles }
        : {}),
      ...(method !== "carrier" && defaults.max_pickup_weight_lb
        ? { max_weight_lb: defaults.max_pickup_weight_lb }
        : {}),
    })),
    preferred: defaults.preferred,
  };

  const refreshAddresses = async () => {
    const res = await api.get<{ addresses: SavedAddress[] }>("/users/me/addresses");
    setAddresses(res.addresses ?? []);
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const res = await api.get<{ addresses: SavedAddress[] }>("/users/me/addresses");
      if (!cancelled) setAddresses(res.addresses ?? []);
    };
    (async () => {
      try {
        const pending = readPendingDefaultAddress();
        if (pending) {
          await api.post("/users/me/addresses", {
            ...toApiAddress(pending),
            label: "home",
            is_default: true,
          });
          clearPendingDefaultAddress();
        }
        await load();
      } catch {
        await load().catch(() => {
          if (!cancelled) {
            setMessage({ type: "error", text: "Could not load saved addresses." });
          }
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = async () => {
    if (!isCompleteShippingAddress(form)) {
      setMessage({ type: "error", text: "Name, street, city, state, and ZIP are required." });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await api.post("/users/me/addresses", {
        ...toApiAddress(form),
        label: "home",
        is_default: true,
      });
      setForm(EMPTY_SHIPPING_ADDRESS);
      await refreshAddresses();
      setMessage({ type: "success", text: "Default address saved." });
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      setMessage({ type: "error", text: apiErr?.message ?? "Could not save address." });
    } finally {
      setSaving(false);
    }
  };

  const defaultAddress = addresses.find(isDefaultSavedAddress) ?? addresses[0] ?? null;

  return (
    <section className="rounded-xl border border-line bg-surface-raised p-4 sm:p-6 mb-6">
      <h2 className="text-base sm:text-lg font-semibold text-ink mb-1">Default delivery address</h2>
      <p className="text-sm text-ink-muted mb-4">
        Used before negotiation so shipping can be priced into the deal. You can still enter a
        different address on a listing.
      </p>

      {defaultAddress && (
        <div className="mb-4 rounded-lg border border-line bg-surface-sunken px-3 py-2 text-sm text-ink-secondary">
          <p className="font-medium text-ink">{defaultAddress.name}</p>
          <p>{defaultAddress.street1}</p>
          <p>{formatAddressLine(defaultAddress)}</p>
        </div>
      )}

      <ShippingAddressFields idPrefix="settings-address" value={form} onChange={setForm} />

      {message && (
        <Alert tone={message.type} className="mb-3">
          {message.text}
        </Alert>
      )}

      <Button onClick={handleSave} loading={saving} disabled={!isCompleteShippingAddress(form)}>
        {defaultAddress ? "Replace default address" : "Save default address"}
      </Button>

      <div className="mt-8 border-t border-line pt-6">
        <h3 className="text-sm font-semibold text-ink mb-1">Default delivery methods</h3>
        <p className="text-sm text-ink-muted mb-4">
          Used as the starting set on a listing. You can still pick one method or several before
          each negotiation.
        </p>
        <FulfillmentOfferEditor
          audience="buyer"
          value={offerFromDefaults}
          onChange={(offer) => {
            const next: BuyerFulfillmentDefaults = {
              acceptable: offer.options.map((option) => option.method),
              preferred: offer.preferred,
              travel_radius_miles: offer.options.find((option) => option.radius_miles)
                ?.radius_miles,
              max_pickup_weight_lb: offer.options.find((option) => option.max_weight_lb)
                ?.max_weight_lb,
            };
            setDefaults({
              ...next,
              carrier_priority: defaults.carrier_priority,
            });
            writeBuyerFulfillmentDefaults({
              ...next,
              carrier_priority: defaults.carrier_priority,
            });
          }}
        />
        {defaults.acceptable.includes("carrier") && (
          <div className="mt-6">
            <CarrierPriorityPicker
              value={defaults.carrier_priority ?? "balanced"}
              onChange={(carrier_priority) => {
                const next = { ...defaults, carrier_priority };
                setDefaults(next);
                writeBuyerFulfillmentDefaults(next);
              }}
            />
          </div>
        )}
      </div>
    </section>
  );
}
