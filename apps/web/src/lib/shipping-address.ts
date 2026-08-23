export const PENDING_DEFAULT_ADDRESS_KEY = "haggle:pending-default-address";

export interface ShippingAddressInput {
  name: string;
  street1: string;
  street2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone: string;
}

export const EMPTY_SHIPPING_ADDRESS: ShippingAddressInput = {
  name: "",
  street1: "",
  street2: "",
  city: "",
  state: "",
  zip: "",
  country: "US",
  phone: "",
};

export interface SavedAddress {
  id: string;
  label: string | null;
  name: string;
  street1: string;
  street2: string | null;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone: string | null;
  isDefault?: boolean;
  is_default?: boolean;
}

export function isDefaultSavedAddress(address: SavedAddress): boolean {
  return Boolean(address.isDefault ?? address.is_default);
}

export function savedAddressToInput(address: SavedAddress): ShippingAddressInput {
  return {
    name: address.name,
    street1: address.street1,
    street2: address.street2 ?? "",
    city: address.city,
    state: address.state,
    zip: address.zip,
    country: address.country || "US",
    phone: address.phone ?? "",
  };
}

export function formatAddressLine(address: Pick<ShippingAddressInput, "city" | "state" | "zip">) {
  return `${address.city}, ${address.state} ${address.zip}`;
}

export function isCompleteShippingAddress(address: ShippingAddressInput): boolean {
  return (
    address.name.trim().length > 0 &&
    address.street1.trim().length > 0 &&
    address.city.trim().length > 0 &&
    /^[A-Z]{2}$/.test(address.state.trim()) &&
    /^\d{5}$/.test(address.zip.trim())
  );
}

export function toApiAddress(address: ShippingAddressInput) {
  return {
    name: address.name.trim(),
    street1: address.street1.trim(),
    street2: address.street2.trim() || undefined,
    city: address.city.trim(),
    state: address.state.trim().toUpperCase(),
    zip: address.zip.trim(),
    country: address.country.trim() || "US",
    phone: address.phone.trim() || undefined,
  };
}

export function readPendingDefaultAddress(): ShippingAddressInput | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PENDING_DEFAULT_ADDRESS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ShippingAddressInput>;
    const address: ShippingAddressInput = {
      ...EMPTY_SHIPPING_ADDRESS,
      ...parsed,
      state: (parsed.state ?? "").toUpperCase(),
    };
    return isCompleteShippingAddress(address) ? address : null;
  } catch {
    return null;
  }
}

export function writePendingDefaultAddress(address: ShippingAddressInput) {
  if (typeof window === "undefined") return;
  if (!isCompleteShippingAddress(address)) return;
  window.localStorage.setItem(PENDING_DEFAULT_ADDRESS_KEY, JSON.stringify(toApiAddress(address)));
}

export function clearPendingDefaultAddress() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(PENDING_DEFAULT_ADDRESS_KEY);
}
