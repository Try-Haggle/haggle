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

    it('classifies conversation type and links extracted information to engine context', () => {
      const result = understand({
        raw_message: 'I can do $780 if battery health is 90% and shipping is insured.',
        sender_role: 'buyer',
      });

      expect(result.conversation_type).toBe('PRICE_NEGOTIATION');
      expect(result.information_links).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ connects_to: 'pricing', entity_type: 'price' }),
          expect.objectContaining({ connects_to: 'condition', entity_type: 'battery_health' }),
          expect.objectContaining({ connects_to: 'terms', entity_type: 'shipping' }),
        ]),
      );
      expect(result.missing_information).toEqual([]);
    });

    it('identifies missing information when the user asks a condition question', () => {
      const result = understand({
        raw_message: 'What is the battery health, is it unlocked, and is shipping included?',
        sender_role: 'buyer',
      });

      expect(result.conversation_type).toBe('INFORMATION_REQUEST');
      expect(result.missing_information).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            slot: 'battery_health',
            question: '중고폰은 배터리 성능에 따라 가격이 꽤 달라져요. 90% 이상만 볼까요, 85% 이상이면 괜찮을까요, 아니면 가격이 좋으면 80%대도 괜찮을까요?',
            question_source: 'tag_garden',
            tag_slot_id: 'battery_health',
            enforcement: 'hard',
            answer_options: ['90% 이상만', '85% 이상까지 허용', '80%대도 가격 좋으면 허용', '상관없음'],
          }),
          expect.objectContaining({
            slot: 'carrier_lock',
            question: '언락 모델이 필수인가요?',
            question_source: 'tag_garden',
            tag_slot_id: 'carrier_lock',
          }),
          expect.objectContaining({
            slot: 'shipping_terms',
            question_source: 'tag_garden',
            tag_slot_id: 'shipping_terms',
          }),
        ]),
      );
    });

    it('flags trust safety risks as high-priority missing information', () => {
      const result = understand({
        raw_message: 'Text me directly and I can pay with Zelle.',
        sender_role: 'buyer',
      });

      expect(result.conversation_type).toBe('TRUST_SAFETY');
      expect(result.information_links).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ connects_to: 'trust' }),
        ]),
      );
      expect(result.missing_information).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ slot: 'payment_safety', priority: 'high' }),
        ]),
      );
    });

    it('handles empty text gracefully', () => {
      const result = understand({
        raw_message: '',
        sender_role: 'buyer',
      });
      expect(result.action_intent).toBe('INFO');
      expect(result.sentiment).toBe('neutral');
      expect(result.price_offer).toBeUndefined();
      expect(result.conversation_type).toBe('READINESS_DISCOVERY');
    });

    it('preserves raw text', () => {
      const msg = 'I would offer $750 for this item';
      const result = understand({ raw_message: msg, sender_role: 'buyer' });
      expect(result.raw_text).toBe(msg);
    });
  });
});
