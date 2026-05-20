import { describe, it, expect } from 'vitest';
import { TemplateMessageRenderer } from '../message-renderer.js';
import type { EngineDecision, BuddyTone } from '../../types.js';

const renderer = new TemplateMessageRenderer();

function render(action: EngineDecision['action'], tone: Partial<BuddyTone> = {}, price?: number) {
  const decision: EngineDecision = { action, reasoning: 'test', price };
  return renderer.render(decision, {
    phase: 'BARGAINING',
    role: 'buyer',
    locale: 'en',
    tone: {
      style: 'professional',
      formality: 'neutral',
      emoji_use: false,
      ...tone,
    },
  });
}

describe('TemplateMessageRenderer', () => {
  it('should render COUNTER with price (minor units → USD)', () => {
    const msg = render('COUNTER', {}, 54000);
    expect(msg).toContain('$540.00');
  });

  it('should render ACCEPT', () => {
    const msg = render('ACCEPT', {}, 60000);
    expect(msg).toContain('600.00');
  });

  it('should render REJECT', () => {
    const msg = render('REJECT');
    expect(msg.length).toBeGreaterThan(5);
  });

  it('should render HOLD', () => {
    const msg = render('HOLD');
    expect(msg.length).toBeGreaterThan(5);
  });

  it('should render DISCOVER', () => {
    const msg = render('DISCOVER');
    expect(msg.length).toBeGreaterThan(5);
  });

  it('should render CONFIRM', () => {
    const msg = render('CONFIRM', {}, 60000);
    expect(msg).toContain('600.00');
  });

  it('should vary by tone style — professional vs casual', () => {
    const professional = render('COUNTER', { style: 'professional' }, 54000);
    const casual = render('COUNTER', { style: 'casual' }, 54000);
    expect(professional).not.toBe(casual);
  });

  it('should vary by tone style — friendly vs assertive', () => {
    const friendly = render('ACCEPT', { style: 'friendly' }, 60000);
    const assertive = render('ACCEPT', { style: 'assertive' }, 60000);
    expect(friendly).not.toBe(assertive);
  });

  it('should vary by tone style — analytical', () => {
    const analytical = render('COUNTER', { style: 'analytical' }, 54000);
    expect(analytical).toContain('market');
  });

  it('should add emoji when enabled', () => {
    const withEmoji = render('ACCEPT', { emoji_use: true }, 60000);
    expect(withEmoji).toMatch(/🤝/);
  });

  it('should not add emoji when disabled', () => {
    const noEmoji = render('ACCEPT', { emoji_use: false }, 60000);
    expect(noEmoji).not.toMatch(/🤝/);
  });

  it('should render non-price terms', () => {
    const decision: EngineDecision = {
      action: 'COUNTER', price: 54000, reasoning: 'test',
      non_price_terms: { shipping_method: 'insured_shipping', warranty_period: '30_days' },
    };
    const msg = renderer.render(decision, {
      phase: 'BARGAINING', role: 'buyer', locale: 'en',
      tone: { style: 'professional', formality: 'neutral', emoji_use: false },
    });
    expect(msg).toContain('shipping_method');
    expect(msg).toContain('insured_shipping');
  });

  it('should render seller DISCOVER differently from buyer', () => {
    const buyerDiscover = renderer.render(
      { action: 'DISCOVER', reasoning: 'test' },
      { phase: 'DISCOVERY', role: 'buyer', locale: 'en',
        tone: { style: 'professional', formality: 'neutral', emoji_use: false } },
    );
    const sellerDiscover = renderer.render(
      { action: 'DISCOVER', reasoning: 'test' },
      { phase: 'DISCOVERY', role: 'seller', locale: 'en',
        tone: { style: 'professional', formality: 'neutral', emoji_use: false } },
    );
    expect(buyerDiscover).not.toBe(sellerDiscover);
  });
});
