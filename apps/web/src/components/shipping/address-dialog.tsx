"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useFieldErrors } from "@/hooks/use-field-errors";
import { api } from "@/lib/api-client";
import {
  EMPTY_SHIPPING_ADDRESS,
  type ShippingAddressField,
  type ShippingAddressInput,
  toApiAddress,
  validateShippingAddress,
} from "@/lib/shipping-address";
import { ShippingAddressFields } from "./shipping-address-fields";

/**
 * Add a delivery address without leaving the page. The form is the same
 * ShippingAddressFields used inline elsewhere; only the presentation differs.
 * Saves to the address book as the default address.
 */
const ID_PREFIX = "address-dialog";
const fieldId = (field: ShippingAddressField) => `${ID_PREFIX}-${field}`;

export function AddressDialog({
  open,
  onClose,
  onSaved,
  defaultName,
}: {
  open: boolean;
  onClose: () => void;
  /** Called after a successful save, before the dialog closes. */
  onSaved?: () => void;
  /** Prefilled recipient name — usually the account name. */
  defaultName?: string | null;
}) {
  const [form, setForm] = useState<ShippingAddressInput>(() => ({
    ...EMPTY_SHIPPING_ADDRESS,
    name: defaultName ?? "",
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldErrors = useFieldErrors<ShippingAddressField>(fieldId);

  function close() {
    if (saving) return;
    setError(null);
    onClose();
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!fieldErrors.report(validateShippingAddress(form))) return;
    setSaving(true);
    setError(null);
    try {
      await api.post("/users/me/addresses", {
        ...toApiAddress(form),
        label: "home",
        is_default: true,
      });
      onSaved?.();
      setSaving(false);
      onClose();
    } catch {
      setSaving(false);
      setError("Couldn't save the address. Please try again.");
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Add a delivery address"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="address-dialog-form" loading={saving}>
            Save address
          </Button>
        </>
      }
    >
      {/* noValidate: per-field messages instead of the browser's bubbles. */}
      <form id="address-dialog-form" onSubmit={save} noValidate className="space-y-4">
        <p className="pb-1 text-base text-ink-secondary">
          Saved to your account, so a deal can ship as soon as it closes.
        </p>
        <ShippingAddressFields
          idPrefix={ID_PREFIX}
          size="lg"
          value={form}
          onChange={setForm}
          errors={fieldErrors.errors}
          onFieldEdit={fieldErrors.clear}
        />
        {error && <Alert tone="error">{error}</Alert>}
      </form>
    </Modal>
  );
}
