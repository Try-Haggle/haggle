/**
 * L5 Signals Service
 *
 * Provides external market data in L5Signals format for pipeline context assembly.
 * Phase 0: Static Swappa median data for iPhone Pro SKUs.
 * Future: SwappaApiProvider, EbayApiProvider, etc.
 */

import type { L5Signals } from '../negotiation/types.js';

// ---------------------------------------------------------------------------
// Provider Interface
// ---------------------------------------------------------------------------

export interface L5SignalsProvider {
  getMarketSignals(params: {
    category: string;
    item_model: string;
    condition?: string;
  }): Promise<L5Signals>;
}

// ---------------------------------------------------------------------------
// Swappa Median Data (Phase 0 hardcoded)
// ---------------------------------------------------------------------------

/** Swappa 30-day median prices in minor units (cents) */
const SWAPPA_MEDIANS: Record<string, number> = {
  'iphone-15-pro-128': 85000,
  'iphone-15-pro-256': 92000,
  'iphone-15-pro-512': 105000,
  'iphone-14-pro-128': 62000,
  'iphone-14-pro-256': 68000,
  'iphone-13-pro-128': 45000,
  'iphone-13-pro-256': 50000,
};

/** Default fallback median for unknown iPhone Pro models */
const DEFAULT_IPHONE_MEDIAN = 65000;

/**
 * Look up Swappa 30-day median price for a given item model.
 * Returns minor units (cents). Falls back to category default.
 */
export function getSwappaMedian(itemModel: string): number {
  const normalized = itemModel.toLowerCase().replace(/\s+/g, '-');
  return SWAPPA_MEDIANS[normalized] ?? DEFAULT_IPHONE_MEDIAN;
}

// ---------------------------------------------------------------------------
// Static L5 Signals Provider (Phase 0)
// ---------------------------------------------------------------------------

/**
 * Phase 0 implementation: hardcoded Swappa baseline data.
 * Provides market signals for iPhone Pro category only.
 */
export class StaticL5SignalsProvider implements L5SignalsProvider {
  async getMarketSignals(params: {
    category: string;
    item_model: string;
    condition?: string;
  }): Promise<L5Signals> {
    const median = getSwappaMedian(params.item_model);

    // Condition adjustment: fair = -10%, good = 0%, mint = +5%
    let conditionMultiplier = 1.0;
    if (params.condition === 'fair') conditionMultiplier = 0.90;
    else if (params.condition === 'mint') conditionMultiplier = 1.05;

    const adjustedMedian = Math.round(median * conditionMultiplier);

    return {
      market: {
        avg_sold_price_30d: adjustedMedian,
        price_trend: 'stable',
        active_listings_count: 0,  // Not implemented in Phase 0
        source_prices: [],          // Not implemented in Phase 0
      },
      category: {
        avg_discount_rate: 0.12,    // Electronics average 12% discount
        avg_rounds_to_deal: 4.2,    // Average 4.2 rounds
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

let _provider: L5SignalsProvider | null = null;

export function getL5SignalsProvider(): L5SignalsProvider {
  if (!_provider) {
    _provider = new StaticL5SignalsProvider();
  }
  return _provider;
}

/** For testing: override the provider */
export function setL5SignalsProvider(provider: L5SignalsProvider): void {
  _provider = provider;
}

/** For testing: reset to default */
export function resetL5SignalsProvider(): void {
  _provider = null;
}
