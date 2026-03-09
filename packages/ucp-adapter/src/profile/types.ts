// ============================================================
// UCP Profile Types — based on UCP Spec v2026-01-23
// Discovery mechanism: /.well-known/ucp
// ============================================================

export const UCP_SPEC_VERSION = '2026-01-23' as const;

// --- Capability ---

export interface UcpCapabilityEntry {
  version: string;
  spec?: string;
  schema?: string;
  extends?: string;
}

// --- Service ---

export type UcpTransport = 'rest' | 'mcp' | 'a2a';

export interface UcpServiceEntry {
  version: string;
  transport: UcpTransport;
  endpoint: string;
  schema?: string;
}

// --- Payment Handler ---

export interface UcpPaymentHandlerEntry {
  id: string;
  version: string;
  config: Record<string, unknown>;
}

// --- Signing Key (JWK subset) ---

export interface UcpSigningKey {
  kty: string;
  kid: string;
  alg: string;
  crv?: string;
  x?: string;
  y?: string;
}

// --- UCP Profile (top-level) ---

export interface UcpProfile {
  ucp: {
    version: string;
    services: Record<string, UcpServiceEntry[]>;
    capabilities: Record<string, UcpCapabilityEntry[]>;
    payment_handlers?: Record<string, UcpPaymentHandlerEntry[]>;
    signing_keys?: UcpSigningKey[];
  };
}

// --- Well-known capability names ---

export const UCP_CAPABILITIES = {
  CHECKOUT: 'dev.ucp.shopping.checkout',
  FULFILLMENT: 'dev.ucp.shopping.fulfillment',
  DISCOUNT: 'dev.ucp.shopping.discount',
  ORDER: 'dev.ucp.shopping.order',
  NEGOTIATION: 'ai.tryhaggle.negotiation',
} as const;

export const UCP_SERVICES = {
  SHOPPING: 'dev.ucp.shopping',
} as const;

export const UCP_PAYMENT_HANDLERS = {
  GOOGLE_PAY: 'com.google.pay',
  HAGGLE_USDC: 'ai.tryhaggle.usdc',
} as const;
