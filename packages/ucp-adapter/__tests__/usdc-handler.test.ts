import { describe, it, expect } from 'vitest';
import {
  validateUsdcInstrument,
  processUsdcPayment,
  buildUsdcPaymentHandlerEntry,
  USDC_HANDLER_ID,
  DEFAULT_USDC_CONFIG,
} from '../src/index.js';
import type { UsdcPaymentInstrument } from '../src/index.js';

function makeInstrument(overrides?: Partial<UsdcPaymentInstrument>): UsdcPaymentInstrument {
  return {
    id: 'pi_usdc_1',
    handler_id: 'ai.tryhaggle.usdc',
    type: 'crypto',
    chain: 'base',
    wallet_address: '0x1234567890abcdef1234567890abcdef12345678',
    token: 'USDC',
    credential: { type: 'sandbox', token: 'sandbox_test' },
    ...overrides,
  };
}

describe('validateUsdcInstrument', () => {
  it('accepts a valid instrument', () => {
    expect(validateUsdcInstrument(makeInstrument()).ok).toBe(true);
  });

  it('rejects wrong handler_id', () => {
    const result = validateUsdcInstrument(makeInstrument({ handler_id: 'com.google.pay' as any }));
    expect(result.ok).toBe(false);
  });

  it('rejects wrong type', () => {
    const result = validateUsdcInstrument(makeInstrument({ type: 'card' as any }));
    expect(result.ok).toBe(false);
  });

  it('rejects unsupported chain', () => {
    const result = validateUsdcInstrument(makeInstrument({ chain: 'solana' as any }));
    expect(result.ok).toBe(false);
  });

  it('rejects unsupported token', () => {
    const result = validateUsdcInstrument(makeInstrument({ token: 'USDT' as any }));
    expect(result.ok).toBe(false);
  });

  it('rejects short wallet address', () => {
    const result = validateUsdcInstrument(makeInstrument({ wallet_address: '0x123' }));
    expect(result.ok).toBe(false);
  });

  it('rejects missing credential token', () => {
    const result = validateUsdcInstrument(
      makeInstrument({ credential: { type: 'sandbox', token: '' } }),
    );
    expect(result.ok).toBe(false);
  });
});

describe('processUsdcPayment', () => {
  it('processes sandbox payment', () => {
    const result = processUsdcPayment(makeInstrument(), 22000);
    expect(result.ok).toBe(true);
    expect(result.transaction_hash).toMatch(/^0xsandbox_/);
    expect(result.chain).toBe('base');
    expect(result.amount).toBe(22000);
  });

  it('accepts transaction_hash credential', () => {
    const instrument = makeInstrument({
      credential: { type: 'transaction_hash', token: '0xabc123def456' },
    });
    const result = processUsdcPayment(instrument, 22000);
    expect(result.ok).toBe(true);
    expect(result.transaction_hash).toBe('0xabc123def456');
  });

  it('rejects signed_approval (not implemented)', () => {
    const instrument = makeInstrument({
      credential: { type: 'signed_approval', token: 'sig_xyz' },
    });
    const result = processUsdcPayment(instrument, 22000);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not yet implemented');
  });

  it('rejects invalid instrument', () => {
    const instrument = makeInstrument({ chain: 'solana' as any });
    const result = processUsdcPayment(instrument, 22000);
    expect(result.ok).toBe(false);
  });
});

describe('buildUsdcPaymentHandlerEntry', () => {
  it('builds default entry', () => {
    const entry = buildUsdcPaymentHandlerEntry();
    expect(entry.id).toBe('usdc');
    expect(entry.version).toBe('2026-03-01');
    expect(entry.config.supported_chains).toContain('base');
    expect(entry.config.supported_tokens).toContain('USDC');
  });

  it('uses custom config', () => {
    const entry = buildUsdcPaymentHandlerEntry({
      supported_chains: ['ethereum'],
      supported_tokens: ['USDC'],
      settlement_time: 'finalized',
      escrow_enabled: true,
    });
    expect(entry.config.supported_chains).toEqual(['ethereum']);
    expect(entry.config.escrow_enabled).toBe(true);
  });
});

describe('constants', () => {
  it('USDC_HANDLER_ID is correct', () => {
    expect(USDC_HANDLER_ID).toBe('ai.tryhaggle.usdc');
  });

  it('DEFAULT_USDC_CONFIG has base chain', () => {
    expect(DEFAULT_USDC_CONFIG.supported_chains).toContain('base');
  });
});
