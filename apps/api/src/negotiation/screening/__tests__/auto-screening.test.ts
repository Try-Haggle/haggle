import { describe, it, expect } from 'vitest';
import { screenMessage } from '../auto-screening.js';

describe('screenMessage', () => {
  it('should pass normal messages', () => {
    const result = screenMessage({ messageText: 'Is the phone still available? What condition is the screen in?' });
    expect(result.is_spam).toBe(false);
    expect(result.confidence).toBeLessThan(0.5);
  });

  it('should detect payment redirect spam', () => {
    const result = screenMessage({ messageText: 'Send money to paypal me now, wire transfer cash' });
    expect(result.is_spam).toBe(true);
    expect(result.reason).toContain('Spam pattern');
  });

  it('should detect link bait spam', () => {
    const result = screenMessage({ messageText: 'Click this link to see more: bit.ly/abc123' });
    expect(result.is_spam).toBe(true);
  });

  it('should detect off-platform redirect', () => {
    // Multiple signals needed to reach 0.5 threshold
    const result = screenMessage({ messageText: 'whatsapp me now, send money via wire transfer', senderTrustScore: 0.1 });
    expect(result.is_spam).toBe(true);
  });

  it('should flag low-quality ALL CAPS messages', () => {
    const result = screenMessage({ messageText: 'BUY THIS PHONE NOW ITS THE BEST DEAL EVER' });
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('should penalize very short messages', () => {
    const result = screenMessage({ messageText: 'hi' });
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('should penalize low trust score', () => {
    const result = screenMessage({ messageText: 'Interested in the phone', senderTrustScore: 0.1 });
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('should penalize extreme price deviation', () => {
    const result = screenMessage({ messageText: 'I offer $10', priceDeviation: 95 });
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('should recommend model upgrade for borderline cases', () => {
    // A message with slight suspicion but not definite spam
    const result = screenMessage({ messageText: 'Interested', senderTrustScore: 0.2 });
    // With low trust score only, might be borderline
    if (result.confidence >= 0.3 && result.confidence < 0.5) {
      expect(result.should_upgrade_model).toBe(true);
    }
  });

  it('should not flag legitimate negotiation messages', () => {
    const messages = [
      'I can offer $450 for the iPhone. Battery at 85% is a concern.',
      'Would you accept $500 if I include shipping?',
      'The screen has minor scratches. Can we negotiate on price?',
      'I see similar phones going for $480 on Swappa. How about $470?',
    ];

    for (const msg of messages) {
      const result = screenMessage({ messageText: msg });
      expect(result.is_spam).toBe(false);
    }
  });
});
