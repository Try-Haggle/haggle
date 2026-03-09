import { describe, it, expect } from 'vitest';
import { negotiateCapabilities } from '../src/index.js';
import type { UcpCapabilityEntry } from '../src/index.js';

function cap(version: string, ext?: string): UcpCapabilityEntry[] {
  return [{ version, extends: ext }];
}

describe('negotiateCapabilities', () => {
  const bVersion = '2026-01-23';
  const pVersion = '2026-01-23';

  it('returns intersection of matching capabilities', () => {
    const business = {
      'dev.ucp.shopping.checkout': cap(bVersion),
      'dev.ucp.shopping.order': cap(bVersion),
    };
    const platform = {
      'dev.ucp.shopping.checkout': cap(pVersion),
      'dev.ucp.shopping.fulfillment': cap(pVersion),
    };

    const result = negotiateCapabilities(business, platform, bVersion, pVersion);

    expect(result).not.toBeNull();
    expect(result!.capabilities).toHaveLength(1);
    expect(result!.capabilities[0].name).toBe('dev.ucp.shopping.checkout');
  });

  it('prunes extensions when parent is missing', () => {
    const business = {
      'dev.ucp.shopping.checkout': cap(bVersion),
      'dev.ucp.shopping.discount': cap(bVersion, 'dev.ucp.shopping.checkout'),
      'ai.tryhaggle.negotiation': cap('2026-03-01', 'dev.ucp.shopping.checkout'),
    };
    // Platform does NOT support checkout → extensions should be pruned
    const platform = {
      'dev.ucp.shopping.discount': cap(pVersion, 'dev.ucp.shopping.checkout'),
      'ai.tryhaggle.negotiation': cap('2026-03-01', 'dev.ucp.shopping.checkout'),
    };

    const result = negotiateCapabilities(business, platform, bVersion, pVersion);

    expect(result).not.toBeNull();
    // discount and negotiation match, but their parent (checkout) is missing
    // → both get pruned
    expect(result!.capabilities).toHaveLength(0);
  });

  it('keeps extensions when parent is in intersection', () => {
    const business = {
      'dev.ucp.shopping.checkout': cap(bVersion),
      'dev.ucp.shopping.discount': cap(bVersion, 'dev.ucp.shopping.checkout'),
      'ai.tryhaggle.negotiation': cap('2026-03-01', 'dev.ucp.shopping.checkout'),
    };
    const platform = {
      'dev.ucp.shopping.checkout': cap(pVersion),
      'dev.ucp.shopping.discount': cap(pVersion, 'dev.ucp.shopping.checkout'),
      'ai.tryhaggle.negotiation': cap('2026-03-01', 'dev.ucp.shopping.checkout'),
    };

    const result = negotiateCapabilities(business, platform, bVersion, pVersion);

    expect(result).not.toBeNull();
    expect(result!.capabilities).toHaveLength(3);
    const names = result!.capabilities.map((c) => c.name);
    expect(names).toContain('dev.ucp.shopping.checkout');
    expect(names).toContain('dev.ucp.shopping.discount');
    expect(names).toContain('ai.tryhaggle.negotiation');
  });

  it('prunes transitive extension chains', () => {
    // C extends B, B extends A. Only B and C are in both, not A → prune all
    const business = {
      A: cap(bVersion),
      B: cap(bVersion, 'A'),
      C: cap(bVersion, 'B'),
    };
    const platform = {
      B: cap(pVersion, 'A'),
      C: cap(pVersion, 'B'),
    };

    const result = negotiateCapabilities(business, platform, bVersion, pVersion);

    expect(result).not.toBeNull();
    // B depends on A (missing), C depends on B → both pruned
    expect(result!.capabilities).toHaveLength(0);
  });

  it('keeps transitive chain when root is present', () => {
    const business = {
      A: cap(bVersion),
      B: cap(bVersion, 'A'),
      C: cap(bVersion, 'B'),
    };
    const platform = {
      A: cap(pVersion),
      B: cap(pVersion, 'A'),
      C: cap(pVersion, 'B'),
    };

    const result = negotiateCapabilities(business, platform, bVersion, pVersion);

    expect(result).not.toBeNull();
    expect(result!.capabilities).toHaveLength(3);
  });

  it('returns null when platform version > business version', () => {
    const result = negotiateCapabilities(
      { 'dev.ucp.shopping.checkout': cap('2026-01-23') },
      { 'dev.ucp.shopping.checkout': cap('2026-06-01') },
      '2026-01-23',
      '2026-06-01', // platform newer than business
    );

    expect(result).toBeNull();
  });

  it('returns empty capabilities when no overlap', () => {
    const business = {
      'dev.ucp.shopping.checkout': cap(bVersion),
    };
    const platform = {
      'dev.ucp.shopping.order': cap(pVersion),
    };

    const result = negotiateCapabilities(business, platform, bVersion, pVersion);

    expect(result).not.toBeNull();
    expect(result!.capabilities).toHaveLength(0);
  });

  it('uses conservative version matching', () => {
    const business = {
      'dev.ucp.shopping.checkout': cap('2026-06-01'),
    };
    const platform = {
      'dev.ucp.shopping.checkout': cap('2026-01-23'),
    };

    const result = negotiateCapabilities(business, platform, '2026-06-01', '2026-01-23');

    expect(result).not.toBeNull();
    expect(result!.capabilities[0].version).toBe('2026-01-23');
  });
});
