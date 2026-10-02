/**
 * Single source for the eBay seller-fee terms used in marketing comparisons.
 * Scope: US, non-store seller, item price only. Shipping, sales tax, category
 * exceptions and promoted listings are NOT modelled. Do not generalise to
 * categories that are not confirmed against the source page.
 */

export const EBAY_FEE_TERMS = {
  version: "ebay-us-nostore-2026-10-02-v1",
  sourceUrl: "https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822",
  checkedOn: "2026-10-02",
  /** Final value fee rate applied up to the tier cap (processing included, not added again). */
  baseRate: 0.136,
  tierCap: 7500,
  overCapRate: 0.0235,
  fixedFeeAtOrBelowThreshold: 0.3,
  fixedFeeAboveThreshold: 0.4,
  fixedFeeThreshold: 10,
} as const;

/** E = 0.136*min(P,7500) + 0.0235*max(P-7500,0) + (P<=10 ? 0.30 : 0.40) */
export function ebayFeeEstimate(itemPrice: number): number {
  if (!(itemPrice > 0)) return 0;
  const t = EBAY_FEE_TERMS;
  const fixed =
    itemPrice <= t.fixedFeeThreshold ? t.fixedFeeAtOrBelowThreshold : t.fixedFeeAboveThreshold;
  return (
    t.baseRate * Math.min(itemPrice, t.tierCap) +
    t.overCapRate * Math.max(itemPrice - t.tierCap, 0) +
    fixed
  );
}

/** Effective percent of item price (for display only). */
export function ebayFeePercent(itemPrice: number): number {
  return itemPrice > 0 ? (ebayFeeEstimate(itemPrice) / itemPrice) * 100 : 0;
}

/**
 * Categories confirmed against the source page as the general (non-exception) rate.
 * Anything else (Sneakers & Streetwear / Athletic Shoes, Books, Guitars, ...) or
 * unmapped is NOT compared: no eBay figure, banner or share. Extend only after verification.
 */
export const EBAY_VERIFIED_RATE_CATEGORIES: readonly string[] = ["electronics"];

export function isEbayComparable(category: string): boolean {
  return EBAY_VERIFIED_RATE_CATEGORIES.includes(category);
}

export type FeeDifference = { kind: "lower" | "higher" | "none"; amount: number; label: string };

/** diff = estimated eBay fee - Haggle fee. "lower" only when positive after cent rounding. */
export function describeFeeDifference(diff: number): FeeDifference {
  const cents = Math.round(diff * 100);
  const amount = Math.abs(cents) / 100;
  if (cents > 0)
    return { kind: "lower", amount, label: `~$${amount.toFixed(2)} lower fees than eBay est.` };
  if (cents < 0)
    return { kind: "higher", amount, label: `~$${amount.toFixed(2)} higher fees than eBay est.` };
  return { kind: "none", amount: 0, label: "no difference" };
}

/** Rate as a percent string without float noise (0.136 * 100 = 13.600000000000001). */
const pct = (rate: number) => `${Number((rate * 100).toFixed(4))}%`;

export const EBAY_COMPARISON_BADGE = "Demo · assumption-based comparison";

/** Short note placed directly next to each comparison claim. */
export const EBAY_COMPARISON_DISCLAIMER =
  "Hypothetical comparison using standard US eBay rates applied to item price only. " +
  "The eBay estimate excludes shipping, handling and sales tax. Actual fees and the difference may be higher or lower.";

export const HAGGLE_FEE_ASSUMPTION =
  "Illustrative Haggle fee assumption (1.5%), not a transaction quote or realized savings.";

export const DEMO_COMPARISON_DISCLAIMER = `${EBAY_COMPARISON_DISCLAIMER} ${HAGGLE_FEE_ASSUMPTION}`;

/** Full conditions (HAGA-167 meaning), shown beside the comparison, never only in a tooltip. */
export const EBAY_CONDITIONS_TEXT =
  "Assumes a US-registered seller, US buyer and shipping, USD, a standard eBay sale of a single item per order, " +
  "no Store subscription, and no seller discounts, surcharges or promotions. Only categories confirmed at the general rate are compared; " +
  "exception or unconfirmed categories are not shown. The estimate base is item price. " +
  `Model: ${pct(EBAY_FEE_TERMS.baseRate)} up to $${EBAY_FEE_TERMS.tierCap.toLocaleString("en-US")}, ` +
  `${pct(EBAY_FEE_TERMS.overCapRate)} above, plus $${EBAY_FEE_TERMS.fixedFeeAtOrBelowThreshold.toFixed(2)} per order (estimate base $${EBAY_FEE_TERMS.fixedFeeThreshold} or less) or ` +
  `$${EBAY_FEE_TERMS.fixedFeeAboveThreshold.toFixed(2)} (above $${EBAY_FEE_TERMS.fixedFeeThreshold}). ` +
  "The eBay estimate covers the final value fee only; listing, advertising, optional-service, international and currency-conversion costs are excluded. " +
  "eBay itself charges on the total sale amount, including applicable shipping, handling and sales tax, so the real difference can be larger or smaller. " +
  `Source: eBay Selling fees (${EBAY_FEE_TERMS.sourceUrl}) · checked ${EBAY_FEE_TERMS.checkedOn} · terms version ${EBAY_FEE_TERMS.version}.`;

export const EBAY_FAQ_ANSWER =
  "For this illustration, we apply the standard US non-Store final value fee schedule to item price only. " +
  "Actual eBay fees use the total sale amount, including applicable shipping, handling and sales tax, and exceptions apply by category and seller. " +
  `Source and conditions: eBay Selling fees, checked ${EBAY_FEE_TERMS.checkedOn}.`;
