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

/**
 * Source → seller fee rate (total take rate including payment processing).
 *
 * Sources (verified 2026-04):
 *   eBay:       13.25% FVF (electronics/cell phones/computers, non-store, ≤$7500)
 *               + $0.40 per order (ignored for simplicity on $100+ items)
 *               Ref: ebay.com/help/selling/fees-credits-invoices/selling-fees
 *               Note: "Electronics" broad category = 12.9%, but Cell Phones &
 *               Computers subcategories = 13.25%. We use 13.25% as conservative.
 *               Gaming consoles also ~13.25%.
 *
 *   BackMarket: 10% flat commission on all sales
 *               Ref: help.backmarket.com — "Quality Assurance Fee"
 *
 *   Swappa:     3% seller fee + 3.49% PayPal + $0.49 ≈ 6.5% effective
 *               Ref: swappa.com/about/fees
 *
 *   Gazelle:    Buyback model, ~15-25% below market (use 20% as estimate)
 *               Not directly comparable — treated as 20% discount
 *
 *   Haggle:     1.5% platform fee
 */
const SOURCE_FEE_RATES: Record<string, number> = {
  ebay_sold: 0.1325,       // 13.25% FVF (cell phones, computers, gaming consoles)
  ebay_browse: 0.1325,     // same as sold listings
  terapeak_manual: 0.1325, // eBay data source
  marketplace_insights: 0.1325,
  backmarket: 0.10,        // 10% flat commission
  swappa: 0.065,           // 3% Swappa + 3.49% PayPal + $0.49
  gazelle: 0.20,           // buyback discount ~20%
  haggle_internal: 0.015,  // our fee — no adjustment needed
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
