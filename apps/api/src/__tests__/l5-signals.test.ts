import { describe, it, expect, beforeEach } from 'vitest';
import {
  StaticL5SignalsProvider,
  getSwappaMedian,
  getL5SignalsProvider,
  setL5SignalsProvider,
  resetL5SignalsProvider,
} from '../services/l5-signals.service.js';

describe('L5 Signals Service', () => {
  beforeEach(() => {
    resetL5SignalsProvider();
  });

  describe('getSwappaMedian', () => {
    it('returns known median for iphone-15-pro-128', () => {
      expect(getSwappaMedian('iphone-15-pro-128')).toBe(85000);
    });

    it('returns known median for iphone-14-pro-256', () => {
      expect(getSwappaMedian('iphone-14-pro-256')).toBe(68000);
    });

    it('returns known median for iphone-13-pro-128', () => {
      expect(getSwappaMedian('iphone-13-pro-128')).toBe(45000);
    });

    it('normalizes model names with spaces', () => {
      expect(getSwappaMedian('iphone 15 pro 128')).toBe(85000);
    });

    it('returns default for unknown model', () => {
      expect(getSwappaMedian('iphone-99-pro-1tb')).toBe(65000);
    });

    it('is case insensitive', () => {
      expect(getSwappaMedian('iPhone-15-Pro-128')).toBe(85000);
    });
  });

  describe('StaticL5SignalsProvider', () => {
    const provider = new StaticL5SignalsProvider();

    it('returns market signals with default condition', async () => {
      const signals = await provider.getMarketSignals({
        category: 'electronics',
        item_model: 'iphone-15-pro-256',
      });

      expect(signals.market).toBeDefined();
      expect(signals.market!.avg_sold_price_30d).toBe(92000);
      expect(signals.market!.price_trend).toBe('stable');
      expect(signals.market!.active_listings_count).toBe(0);
      expect(signals.market!.source_prices).toEqual([]);
    });

    it('returns category signals', async () => {
      const signals = await provider.getMarketSignals({
        category: 'electronics',
        item_model: 'iphone-14-pro-128',
      });

      expect(signals.category).toBeDefined();
      expect(signals.category!.avg_discount_rate).toBe(0.12);
      expect(signals.category!.avg_rounds_to_deal).toBe(4.2);
    });

    it('adjusts price down for fair condition', async () => {
      const signals = await provider.getMarketSignals({
        category: 'electronics',
        item_model: 'iphone-15-pro-128',
        condition: 'fair',
      });

      // 85000 * 0.90 = 76500
      expect(signals.market!.avg_sold_price_30d).toBe(76500);
    });

    it('adjusts price up for mint condition', async () => {
      const signals = await provider.getMarketSignals({
        category: 'electronics',
        item_model: 'iphone-15-pro-128',
        condition: 'mint',
      });

      // 85000 * 1.05 = 89250
      expect(signals.market!.avg_sold_price_30d).toBe(89250);
    });

    it('no adjustment for good condition', async () => {
      const signals = await provider.getMarketSignals({
        category: 'electronics',
        item_model: 'iphone-15-pro-128',
        condition: 'good',
      });

      expect(signals.market!.avg_sold_price_30d).toBe(85000);
    });
  });

  describe('Provider singleton', () => {
    it('returns default StaticL5SignalsProvider', () => {
      const provider = getL5SignalsProvider();
      expect(provider).toBeInstanceOf(StaticL5SignalsProvider);
    });

    it('can be overridden for testing', () => {
      const mockProvider = {
        getMarketSignals: async () => ({
          market: { avg_sold_price_30d: 99999, price_trend: 'rising' as const, active_listings_count: 5, source_prices: [] },
        }),
      };
      setL5SignalsProvider(mockProvider);
      expect(getL5SignalsProvider()).toBe(mockProvider);
    });

    it('resets to default', () => {
      const mockProvider = { getMarketSignals: async () => ({}) };
      setL5SignalsProvider(mockProvider);
      resetL5SignalsProvider();
      expect(getL5SignalsProvider()).toBeInstanceOf(StaticL5SignalsProvider);
    });
  });
});
