// ============================================================
// UCP Profile Builder
// Constructs a /.well-known/ucp profile for a Haggle merchant
// ============================================================

import type {
  UcpProfile,
  UcpCapabilityEntry,
  UcpServiceEntry,
  UcpPaymentHandlerEntry,
  UcpSigningKey,
  UcpTransport,
} from './types.js';
import { UCP_SPEC_VERSION } from './types.js';

export interface ProfileBuilderOptions {
  version?: string;
  endpoint: string;
  transport?: UcpTransport;
  schemaBaseUrl?: string;
}

export function createProfileBuilder(options: ProfileBuilderOptions) {
  const {
    version = UCP_SPEC_VERSION,
    endpoint,
    transport = 'rest',
    schemaBaseUrl,
  } = options;

  const services: Record<string, UcpServiceEntry[]> = {};
  const capabilities: Record<string, UcpCapabilityEntry[]> = {};
  const paymentHandlers: Record<string, UcpPaymentHandlerEntry[]> = {};
  const signingKeys: UcpSigningKey[] = [];

  function addService(name: string, entry?: Partial<UcpServiceEntry>) {
    const serviceEntry: UcpServiceEntry = {
      version: entry?.version ?? version,
      transport: entry?.transport ?? transport,
      endpoint: entry?.endpoint ?? endpoint,
      schema: entry?.schema ?? (schemaBaseUrl
        ? `${schemaBaseUrl}/services/${name.split('.').pop()}/rest.openapi.json`
        : undefined),
    };
    if (!services[name]) services[name] = [];
    services[name].push(serviceEntry);
  }

  function addCapability(name: string, entry?: Partial<UcpCapabilityEntry>) {
    const capEntry: UcpCapabilityEntry = {
      version: entry?.version ?? version,
      spec: entry?.spec,
      schema: entry?.schema,
      extends: entry?.extends,
    };
    if (!capabilities[name]) capabilities[name] = [];
    capabilities[name].push(capEntry);
  }

  function addPaymentHandler(
    name: string,
    entry: UcpPaymentHandlerEntry,
  ) {
    if (!paymentHandlers[name]) paymentHandlers[name] = [];
    paymentHandlers[name].push(entry);
  }

  function addSigningKey(key: UcpSigningKey) {
    signingKeys.push(key);
  }

  function build(): UcpProfile {
    const profile: UcpProfile = {
      ucp: {
        version,
        services,
        capabilities,
      },
    };

    if (Object.keys(paymentHandlers).length > 0) {
      profile.ucp.payment_handlers = paymentHandlers;
    }

    if (signingKeys.length > 0) {
      profile.ucp.signing_keys = signingKeys;
    }

    return profile;
  }

  return {
    addService,
    addCapability,
    addPaymentHandler,
    addSigningKey,
    build,
  };
}

/**
 * Creates a default Haggle merchant profile with checkout + negotiation capabilities.
 */
export function buildDefaultHaggleProfile(endpoint: string): UcpProfile {
  const builder = createProfileBuilder({ endpoint });

  builder.addService('dev.ucp.shopping');

  builder.addCapability('dev.ucp.shopping.checkout');
  builder.addCapability('dev.ucp.shopping.discount', {
    extends: 'dev.ucp.shopping.checkout',
  });
  builder.addCapability('ai.tryhaggle.negotiation', {
    version: '2026-03-01',
    extends: 'dev.ucp.shopping.checkout',
    spec: 'https://tryhaggle.ai/ucp/negotiation-spec.json',
    schema: 'https://tryhaggle.ai/ucp/negotiation-schema.json',
  });

  return builder.build();
}
