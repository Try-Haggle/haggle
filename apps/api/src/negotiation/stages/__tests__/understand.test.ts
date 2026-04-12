import { describe, it, expect } from 'vitest';
import { understand, understandFromStructured } from '../understand.js';
import type { UnderstandOutput } from '../../pipeline/types.js';

describe('Stage 1: understand', () => {
  describe('structured input bypass', () => {
    it('returns pre-parsed UnderstandOutput unchanged', () => {
      const parsed: UnderstandOutput = {
        price_offer: 85000,
        action_intent: 'OFFER',
        conditions: {},
        sentiment: 'neutral',
        raw_text: 'Offer: $85000',
      };
      const result = understand(parsed);
      expect(result).toEqual(parsed);
    });
  });

  describe('understandFromStructured', () => {
    it('creates UnderstandOutput from a price', () => {
      const result = understandFromStructured(85000, 'buyer');
      expect(result.price_offer).toBe(85000);
      expect(result.action_intent).toBe('OFFER');
      expect(result.sentiment).toBe('neutral');
    });
  });

  describe('text parsing', () => {
    it('extracts price from dollar amount', () => {
      const result = understand({
        raw_message: 'How about $850 for the phone?',
        sender_role: 'buyer',
      });
      expect(result.price_offer).toBe(850);
      expect(result.action_intent).toBe('COUNTER');
    });

    it('detects ACCEPT intent', () => {
      const result = understand({
        raw_message: 'Deal! I accept your offer.',
        sender_role: 'buyer',
      });
      expect(result.action_intent).toBe('ACCEPT');
      expect(result.sentiment).toBe('positive');
    });

    it('detects REJECT intent', () => {
      const result = understand({
        raw_message: 'I reject this offer. I have to pass.',
        sender_role: 'seller',
      });
      expect(result.action_intent).toBe('REJECT');
      expect(result.sentiment).toBe('negative');
    });

    it('detects QUESTION intent for questions without price', () => {
      const result = understand({
        raw_message: 'What is the battery health?',
        sender_role: 'buyer',
      });
      expect(result.action_intent).toBe('QUESTION');
    });

    it('extracts conditions from text', () => {
      const result = understand({
        raw_message: 'I need warranty and battery health info for $800',
        sender_role: 'buyer',
      });
      expect(result.conditions.warranty_mentioned).toBe(true);
      expect(result.conditions.battery_mentioned).toBe(true);
      expect(result.price_offer).toBe(800);
    });

    it('handles empty text gracefully', () => {
      const result = understand({
        raw_message: '',
        sender_role: 'buyer',
      });
      expect(result.action_intent).toBe('INFO');
      expect(result.sentiment).toBe('neutral');
      expect(result.price_offer).toBeUndefined();
    });

    it('preserves raw text', () => {
      const msg = 'I would offer $750 for this item';
      const result = understand({ raw_message: msg, sender_role: 'buyer' });
      expect(result.raw_text).toBe(msg);
    });
  });
});
