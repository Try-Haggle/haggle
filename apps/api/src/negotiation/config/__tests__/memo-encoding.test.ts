import { describe, it, expect } from 'vitest';
import { resolveMemoEncoding } from '../../config.js';

describe('resolveMemoEncoding', () => {
  it('should return codec when encoding is codec', () => {
    expect(resolveMemoEncoding({ encoding: 'codec' })).toBe('codec');
  });

  it('should return raw when encoding is raw', () => {
    expect(resolveMemoEncoding({ encoding: 'raw' })).toBe('raw');
  });

  it('should return codec for auto with no context window info', () => {
    expect(resolveMemoEncoding({ encoding: 'auto' })).toBe('codec');
  });

  it('should return codec for auto with small context window', () => {
    expect(
      resolveMemoEncoding({
        encoding: 'auto',
        modelContextWindow: 128_000,
        tokenCostPerM: 0.01,
      }),
    ).toBe('codec');
  });

  it('should return raw for auto with large context AND cheap tokens', () => {
    expect(
      resolveMemoEncoding({
        encoding: 'auto',
        modelContextWindow: 1_000_000,
        tokenCostPerM: 0.01,
      }),
    ).toBe('raw');
  });

  it('should return codec for auto with large context but expensive tokens', () => {
    expect(
      resolveMemoEncoding({
        encoding: 'auto',
        modelContextWindow: 1_000_000,
        tokenCostPerM: 0.10,
      }),
    ).toBe('codec');
  });

  it('should return codec at exactly 500K context boundary', () => {
    // > 500K required, not >=
    expect(
      resolveMemoEncoding({
        encoding: 'auto',
        modelContextWindow: 500_000,
        tokenCostPerM: 0.01,
      }),
    ).toBe('codec');
  });

  it('should return raw at 500_001 context with cheap tokens', () => {
    expect(
      resolveMemoEncoding({
        encoding: 'auto',
        modelContextWindow: 500_001,
        tokenCostPerM: 0.01,
      }),
    ).toBe('raw');
  });

  it('should return codec at exactly $0.05 token cost boundary', () => {
    // < 0.05 required, not <=
    expect(
      resolveMemoEncoding({
        encoding: 'auto',
        modelContextWindow: 1_000_000,
        tokenCostPerM: 0.05,
      }),
    ).toBe('codec');
  });

  it('should return raw at $0.049 token cost with large context', () => {
    expect(
      resolveMemoEncoding({
        encoding: 'auto',
        modelContextWindow: 1_000_000,
        tokenCostPerM: 0.049,
      }),
    ).toBe('raw');
  });
});
