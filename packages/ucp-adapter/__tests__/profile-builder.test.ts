import { describe, it, expect } from 'vitest';
import {
  createProfileBuilder,
  buildDefaultHaggleProfile,
  UCP_SPEC_VERSION,
  UCP_CAPABILITIES,
} from '../src/index.js';

describe('createProfileBuilder', () => {
  it('builds a minimal profile with one service', () => {
    const builder = createProfileBuilder({
      endpoint: 'https://api.tryhaggle.ai/ucp/v1',
    });
    builder.addService('dev.ucp.shopping');
    builder.addCapability('dev.ucp.shopping.checkout');

    const profile = builder.build();

    expect(profile.ucp.version).toBe(UCP_SPEC_VERSION);
    expect(profile.ucp.services['dev.ucp.shopping']).toHaveLength(1);
    expect(profile.ucp.services['dev.ucp.shopping'][0].endpoint).toBe(
      'https://api.tryhaggle.ai/ucp/v1',
    );
    expect(profile.ucp.services['dev.ucp.shopping'][0].transport).toBe('rest');
    expect(profile.ucp.capabilities['dev.ucp.shopping.checkout']).toHaveLength(1);
  });

  it('supports multiple capabilities with extensions', () => {
    const builder = createProfileBuilder({
      endpoint: 'https://api.tryhaggle.ai/ucp/v1',
    });
    builder.addService('dev.ucp.shopping');
    builder.addCapability('dev.ucp.shopping.checkout');
    builder.addCapability('dev.ucp.shopping.discount', {
      extends: 'dev.ucp.shopping.checkout',
    });
    builder.addCapability('ai.tryhaggle.negotiation', {
      version: '2026-03-01',
      extends: 'dev.ucp.shopping.checkout',
    });

    const profile = builder.build();

    expect(Object.keys(profile.ucp.capabilities)).toHaveLength(3);
    expect(
      profile.ucp.capabilities['dev.ucp.shopping.discount'][0].extends,
    ).toBe('dev.ucp.shopping.checkout');
    expect(
      profile.ucp.capabilities['ai.tryhaggle.negotiation'][0].version,
    ).toBe('2026-03-01');
  });

  it('includes payment handlers when added', () => {
    const builder = createProfileBuilder({
      endpoint: 'https://api.tryhaggle.ai/ucp/v1',
    });
    builder.addService('dev.ucp.shopping');
    builder.addCapability('dev.ucp.shopping.checkout');
    builder.addPaymentHandler('ai.tryhaggle.usdc', {
      id: 'usdc',
      version: '2026-03-01',
      config: {
        supported_chains: ['base', 'ethereum'],
        supported_tokens: ['USDC'],
      },
    });

    const profile = builder.build();

    expect(profile.ucp.payment_handlers).toBeDefined();
    expect(profile.ucp.payment_handlers!['ai.tryhaggle.usdc']).toHaveLength(1);
    expect(
      profile.ucp.payment_handlers!['ai.tryhaggle.usdc'][0].config,
    ).toHaveProperty('supported_chains');
  });

  it('omits payment_handlers and signing_keys when empty', () => {
    const builder = createProfileBuilder({
      endpoint: 'https://api.tryhaggle.ai/ucp/v1',
    });
    builder.addService('dev.ucp.shopping');
    builder.addCapability('dev.ucp.shopping.checkout');

    const profile = builder.build();

    expect(profile.ucp.payment_handlers).toBeUndefined();
    expect(profile.ucp.signing_keys).toBeUndefined();
  });

  it('includes signing keys when added', () => {
    const builder = createProfileBuilder({
      endpoint: 'https://api.tryhaggle.ai/ucp/v1',
    });
    builder.addService('dev.ucp.shopping');
    builder.addCapability('dev.ucp.shopping.checkout');
    builder.addSigningKey({
      kty: 'EC',
      kid: 'key-1',
      alg: 'ES256',
      crv: 'P-256',
    });

    const profile = builder.build();

    expect(profile.ucp.signing_keys).toHaveLength(1);
    expect(profile.ucp.signing_keys![0].kid).toBe('key-1');
  });

  it('uses custom transport and version', () => {
    const builder = createProfileBuilder({
      endpoint: 'https://api.tryhaggle.ai/mcp',
      transport: 'mcp',
      version: '2026-03-01',
    });
    builder.addService('dev.ucp.shopping');

    const profile = builder.build();

    expect(profile.ucp.version).toBe('2026-03-01');
    expect(profile.ucp.services['dev.ucp.shopping'][0].transport).toBe('mcp');
  });
});

describe('buildDefaultHaggleProfile', () => {
  it('returns a profile with checkout + discount + negotiation', () => {
    const profile = buildDefaultHaggleProfile(
      'https://api.tryhaggle.ai/ucp/v1',
    );

    expect(profile.ucp.version).toBe(UCP_SPEC_VERSION);
    expect(profile.ucp.services['dev.ucp.shopping']).toBeDefined();
    expect(
      profile.ucp.capabilities[UCP_CAPABILITIES.CHECKOUT],
    ).toBeDefined();
    expect(
      profile.ucp.capabilities[UCP_CAPABILITIES.DISCOUNT],
    ).toBeDefined();
    expect(
      profile.ucp.capabilities[UCP_CAPABILITIES.NEGOTIATION],
    ).toBeDefined();

    // Negotiation extends checkout
    expect(
      profile.ucp.capabilities[UCP_CAPABILITIES.NEGOTIATION][0].extends,
    ).toBe(UCP_CAPABILITIES.CHECKOUT);
  });
});
