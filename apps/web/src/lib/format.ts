export interface FormatPriceOptions {
  /** Treat `amount` as minor units (cents) and divide by 100. */
  minor?: boolean;
  currency?: string;
}

/** Format a price for display. `formatPrice(850)` → "$850", `formatPrice(9000, { minor: true })` → "$90". */
export function formatPrice(
  amount: number,
  { minor = false, currency = "$" }: FormatPriceOptions = {},
) {
  const value = minor ? amount / 100 : amount;
  return `${currency}${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}
