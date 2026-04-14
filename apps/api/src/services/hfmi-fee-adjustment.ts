/**
 * HFMI Fee Adjustment — normalizes prices across platforms.
 *
 * Different platforms charge different seller fees:
 *   eBay: ~13%, BackMarket: ~10%, Gazelle: ~8%, Haggle: 1.5%
 *
 * To compare apples to apples, we normalize all prices to
 * "what the seller nets on Haggle's fee structure."
 *
 * Formula: adjusted = observed × (1 - source_fee) / (1 - haggle_fee)
 *
 * Example: eBay $596 → seller nets $596 × 0.87 = $518.52
 *          On Haggle that's $518.52 / 0.985 = $526.42
 *
 * This way, the HFMI median reflects the TRUE value to sellers on Haggle,
 * preventing unfair anchoring from high-fee platform prices.
 */

const HAGGLE_FEE = 0.015; // 1.5%
const HAGGLE_NET = 1 - HAGGLE_FEE; // 0.985

/** Source → approximate seller fee rate */
const SOURCE_FEE_RATES: Record<string, number> = {
  ebay_sold: 0.13,
  ebay_browse: 0.13,
  terapeak_manual: 0.13,
  marketplace_insights: 0.13,
  backmarket: 0.10,
  gazelle: 0.08,
  haggle_internal: 0.015, // already at Haggle fee
};

/**
 * Compute the fee-adjusted price for a given source.
 * Returns what the seller would net on Haggle for the same transaction value.
 */
export function adjustPriceForSource(
  observedPriceUsd: number,
  source: string,
): number {
  const sourceFee = SOURCE_FEE_RATES[source];

  // Unknown source or haggle_internal → no adjustment
  if (sourceFee === undefined || source === "haggle_internal") {
    return observedPriceUsd;
  }

  const sellerNet = observedPriceUsd * (1 - sourceFee);
  const haggleEquivalent = sellerNet / HAGGLE_NET;

  return Math.round(haggleEquivalent * 100) / 100;
}

/**
 * Get the fee rate for a source (for transparency/display).
 */
export function getSourceFeeRate(source: string): number {
  return SOURCE_FEE_RATES[source] ?? 0;
}
