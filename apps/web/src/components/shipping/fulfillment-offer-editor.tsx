"use client";

import { Input } from "@/components/ui/input";
import {
  type FulfillmentMethod,
  type FulfillmentOption,
  METHOD_COPY,
  MVP_ENABLED_FULFILLMENT_METHODS,
  type SellerFulfillmentOffer,
  toggleMethod,
} from "@/lib/fulfillment-options";

function optionFor(
  offer: SellerFulfillmentOffer,
  method: FulfillmentMethod,
): FulfillmentOption | undefined {
  return offer.options.find((option) => option.method === method);
}

export function FulfillmentOfferEditor({
  value,
  onChange,
  audience,
}: {
  value: SellerFulfillmentOffer;
  onChange: (next: SellerFulfillmentOffer) => void;
  audience: "seller" | "buyer";
}) {
  const selected = value.options.map((option) => option.method);

  const setSelected = (method: FulfillmentMethod) => {
    const nextMethods = toggleMethod(selected, method);
    if (nextMethods.length === 0) return;
    const options = nextMethods.map(
      (nextMethod) => optionFor(value, nextMethod) ?? { method: nextMethod },
    );
    const preferred =
      value.preferred && nextMethods.includes(value.preferred) ? value.preferred : nextMethods[0];
    onChange({ options, preferred });
  };

  const updateOption = (method: FulfillmentMethod, patch: Partial<FulfillmentOption>) => {
    onChange({
      ...value,
      options: value.options.map((option) =>
        option.method === method ? { ...option, ...patch } : option,
      ),
    });
  };

  return (
    <div className="space-y-3">
      {MVP_ENABLED_FULFILLMENT_METHODS.map((method) => {
        const checked = selected.includes(method);
        const option = optionFor(value, method);
        const needsDetails = method !== "carrier";
        const lockedOn = MVP_ENABLED_FULFILLMENT_METHODS.length === 1;
        return (
          <div key={method} className="rounded-xl border border-line px-4 py-3">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1"
                checked={checked || lockedOn}
                disabled={lockedOn}
                onChange={() => setSelected(method)}
              />
              <span>
                <span className="block text-sm font-medium text-ink">
                  {METHOD_COPY[method].title}
                </span>
                <span className="mt-0.5 block text-xs text-ink-secondary">
                  {audience === "seller" ? METHOD_COPY[method].seller : METHOD_COPY[method].buyer}
                </span>
              </span>
            </label>
            {checked && !lockedOn && (
              <div className="mt-3 ml-7 space-y-3">
                <label className="flex items-center gap-2 text-xs text-ink-secondary">
                  <input
                    type="radio"
                    name={`fulfillment-preferred-${audience}`}
                    checked={value.preferred === method}
                    onChange={() => onChange({ ...value, preferred: method })}
                  />
                  Default for this {audience === "seller" ? "listing" : "account"}
                </label>
                {needsDetails && (
                  <div className="grid grid-cols-2 gap-3">
                    <label
                      className="text-xs text-ink-muted"
                      htmlFor={`${audience}-${method}-miles`}
                    >
                      Within miles
                      <Input
                        id={`${audience}-${method}-miles`}
                        className="mt-1"
                        inputMode="decimal"
                        value={option?.radius_miles ?? ""}
                        placeholder="10"
                        onChange={(event) => {
                          const miles = Number(event.target.value);
                          updateOption(method, {
                            radius_miles: Number.isFinite(miles) && miles > 0 ? miles : undefined,
                          });
                        }}
                      />
                    </label>
                    <label
                      className="text-xs text-ink-muted"
                      htmlFor={`${audience}-${method}-weight`}
                    >
                      Max weight (lb)
                      <Input
                        id={`${audience}-${method}-weight`}
                        className="mt-1"
                        inputMode="decimal"
                        value={option?.max_weight_lb ?? ""}
                        placeholder="20"
                        onChange={(event) => {
                          const weight = Number(event.target.value);
                          updateOption(method, {
                            max_weight_lb:
                              Number.isFinite(weight) && weight > 0 ? weight : undefined,
                          });
                        }}
                      />
                    </label>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
