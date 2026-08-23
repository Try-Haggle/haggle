"use client";

import { Field, Input } from "@/components/ui/input";
import type { ShippingAddressInput } from "@/lib/shipping-address";

export function ShippingAddressFields({
  value,
  onChange,
  idPrefix = "shipping",
  disabled = false,
}: {
  value: ShippingAddressInput;
  onChange: (next: ShippingAddressInput) => void;
  idPrefix?: string;
  disabled?: boolean;
}) {
  const set = (field: keyof ShippingAddressInput, next: string) => {
    onChange({
      ...value,
      [field]: field === "state" ? next.toUpperCase() : next,
    });
  };

  return (
    <div className="grid grid-cols-2 gap-x-3">
      <Field
        label="Name"
        htmlFor={`${idPrefix}-name`}
        required
        className="col-span-2 sm:col-span-1"
      >
        <Input
          id={`${idPrefix}-name`}
          value={value.name}
          disabled={disabled}
          autoComplete="name"
          onChange={(event) => set("name", event.target.value)}
        />
      </Field>
      <Field label="Phone" htmlFor={`${idPrefix}-phone`} className="col-span-2 sm:col-span-1">
        <Input
          id={`${idPrefix}-phone`}
          value={value.phone}
          disabled={disabled}
          autoComplete="tel"
          onChange={(event) => set("phone", event.target.value)}
        />
      </Field>
      <Field label="Street" htmlFor={`${idPrefix}-street1`} required className="col-span-2">
        <Input
          id={`${idPrefix}-street1`}
          value={value.street1}
          disabled={disabled}
          autoComplete="address-line1"
          onChange={(event) => set("street1", event.target.value)}
        />
      </Field>
      <Field label="Apt, suite" htmlFor={`${idPrefix}-street2`} className="col-span-2">
        <Input
          id={`${idPrefix}-street2`}
          value={value.street2}
          disabled={disabled}
          autoComplete="address-line2"
          onChange={(event) => set("street2", event.target.value)}
        />
      </Field>
      <Field label="City" htmlFor={`${idPrefix}-city`} required>
        <Input
          id={`${idPrefix}-city`}
          value={value.city}
          disabled={disabled}
          autoComplete="address-level2"
          onChange={(event) => set("city", event.target.value)}
        />
      </Field>
      <Field label="State" htmlFor={`${idPrefix}-state`} required>
        <Input
          id={`${idPrefix}-state`}
          value={value.state}
          disabled={disabled}
          maxLength={2}
          autoComplete="address-level1"
          placeholder="CO"
          onChange={(event) => set("state", event.target.value)}
        />
      </Field>
      <Field label="ZIP" htmlFor={`${idPrefix}-zip`} required className="col-span-2 sm:col-span-1">
        <Input
          id={`${idPrefix}-zip`}
          value={value.zip}
          disabled={disabled}
          maxLength={5}
          inputMode="numeric"
          autoComplete="postal-code"
          onChange={(event) => set("zip", event.target.value.replace(/\D/g, "").slice(0, 5))}
        />
      </Field>
    </div>
  );
}
