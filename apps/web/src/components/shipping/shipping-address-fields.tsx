"use client";

import { Field, Input } from "@/components/ui/input";
import { formatUsPhone } from "@/lib/phone";
import type { ShippingAddressField, ShippingAddressInput } from "@/lib/shipping-address";

/**
 * The delivery-address form, used inline (settings, before a negotiation) and
 * inside AddressDialog. Follows the app's form rules: placeholders, required
 * asterisks, `shipping`-section autocomplete, and per-field errors wired to
 * the inputs (red border + message + aria-describedby).
 */
export function ShippingAddressFields({
  value,
  onChange,
  idPrefix = "shipping",
  disabled = false,
  size = "md",
  errors = {},
  onFieldEdit,
}: {
  value: ShippingAddressInput;
  onChange: (next: ShippingAddressInput) => void;
  idPrefix?: string;
  disabled?: boolean;
  size?: "md" | "lg";
  /** Per-field messages, e.g. from validateShippingAddress. */
  errors?: Partial<Record<ShippingAddressField, string>>;
  /** Called as a field is edited, so its error can be cleared. */
  onFieldEdit?: (field: ShippingAddressField) => void;
}) {
  const set = (field: ShippingAddressField, next: string) => {
    onFieldEdit?.(field);
    onChange({
      ...value,
      [field]: field === "state" ? next.toUpperCase() : next,
    });
  };

  const id = (field: ShippingAddressField) => `${idPrefix}-${field}`;
  // Shared props for one field: id, error state and its description.
  const wire = (field: ShippingAddressField) => ({
    id: id(field),
    size,
    disabled,
    invalid: Boolean(errors[field]),
    "aria-describedby": errors[field] ? `${id(field)}-error` : undefined,
  });

  return (
    <div className="grid grid-cols-2 gap-x-3">
      <Field
        label="Name"
        htmlFor={id("name")}
        required
        error={errors.name}
        className="col-span-2 sm:col-span-1"
      >
        <Input
          {...wire("name")}
          value={value.name}
          placeholder="Full name"
          autoComplete="shipping name"
          required
          onChange={(event) => set("name", event.target.value)}
        />
      </Field>
      <Field
        label="Phone"
        htmlFor={id("phone")}
        error={errors.phone}
        className="col-span-2 sm:col-span-1"
      >
        <Input
          {...wire("phone")}
          type="tel"
          inputMode="tel"
          value={value.phone}
          placeholder="(555) 123-4567"
          autoComplete="shipping tel-national"
          // Digits only, formatted as typed; 14 = "(555) 123-4567".
          maxLength={14}
          // Tabular figures + case-sensitive forms: the hyphen and brackets sit
          // at the digits' middle instead of down at lowercase height.
          className="tabular-nums [font-feature-settings:'case'_1,'tnum'_1]"
          onChange={(event) => set("phone", formatUsPhone(event.target.value))}
        />
      </Field>
      <Field
        label="Street"
        htmlFor={id("street1")}
        required
        error={errors.street1}
        className="col-span-2"
      >
        <Input
          {...wire("street1")}
          value={value.street1}
          placeholder="123 Main St"
          autoComplete="shipping address-line1"
          required
          onChange={(event) => set("street1", event.target.value)}
        />
      </Field>
      <Field label="Apt, suite" htmlFor={id("street2")} className="col-span-2">
        <Input
          {...wire("street2")}
          value={value.street2}
          placeholder="Apt 4B (optional)"
          autoComplete="shipping address-line2"
          onChange={(event) => set("street2", event.target.value)}
        />
      </Field>
      <Field
        label="City"
        htmlFor={id("city")}
        required
        error={errors.city}
        className="col-span-2 sm:col-span-1"
      >
        <Input
          {...wire("city")}
          value={value.city}
          placeholder="Denver"
          autoComplete="shipping address-level2"
          required
          onChange={(event) => set("city", event.target.value)}
        />
      </Field>
      <Field label="State" htmlFor={id("state")} required error={errors.state}>
        <Input
          {...wire("state")}
          value={value.state}
          maxLength={2}
          placeholder="CO"
          autoComplete="shipping address-level1"
          required
          onChange={(event) => set("state", event.target.value)}
        />
      </Field>
      <Field label="ZIP" htmlFor={id("zip")} required error={errors.zip}>
        <Input
          {...wire("zip")}
          value={value.zip}
          maxLength={5}
          inputMode="numeric"
          placeholder="80202"
          autoComplete="shipping postal-code"
          required
          onChange={(event) => set("zip", event.target.value.replace(/\D/g, "").slice(0, 5))}
        />
      </Field>
    </div>
  );
}
