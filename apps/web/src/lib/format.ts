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

/** Format a nullable string price (API `targetPrice`). null/empty → "$0". */
export function formatPriceStr(price: string | null | undefined, options: FormatPriceOptions = {}) {
  if (!price) return `${options.currency ?? "$"}0`;
  return formatPrice(Number(price), options);
}

const CONDITION_LABELS: Record<string, string> = {
  new: "New",
  like_new: "Like New",
  good: "Good",
  fair: "Fair",
  poor: "Poor",
};

/** Map an item condition enum to a display label. */
export function formatCondition(condition: string | null | undefined): string {
  if (!condition) return "";
  return CONDITION_LABELS[condition] ?? condition;
}

/** Relative time from now: "Just now", "5m ago", "3h ago", "2d ago", then a locale date. */
export function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}
