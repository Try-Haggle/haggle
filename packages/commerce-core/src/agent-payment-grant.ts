import { z } from "zod";

export const paymentRailSchema = z.enum(["x402", "stripe"]);

export const paymentTermTagSchema = z.discriminatedUnion("type", [
  z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    type: z.literal("boolean"),
    value: z.boolean(),
    required: z.boolean().default(false),
  }),
  z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    type: z.literal("money"),
    value_minor: z.number().int().nonnegative(),
    currency: z.string().min(1).default("USD"),
    required: z.boolean().default(false),
  }),
  z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    type: z.literal("percent"),
    value: z.number().min(0).max(100),
    required: z.boolean().default(false),
  }),
  z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    type: z.literal("number"),
    value: z.number(),
    unit: z.string().optional(),
    required: z.boolean().default(false),
  }),
  z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    type: z.literal("select"),
    value: z.string().min(1),
    options: z.array(z.string().min(1)).min(1),
    required: z.boolean().default(false),
  }),
  z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    type: z.literal("text"),
    value: z.string(),
    required: z.boolean().default(false),
  }),
]);

export type PaymentTermTag = z.infer<typeof paymentTermTagSchema>;

export const paymentLegalAcknowledgementSchema = z.object({
  no_custody: z.boolean().default(false),
  buyer_approved_rules: z.boolean().default(false),
  stripe_fallback: z.boolean().default(false),
  stablecoin_not_investment: z.boolean().default(false),
});

export type PaymentLegalAcknowledgement = z.infer<typeof paymentLegalAcknowledgementSchema>;

export const agentPaymentGrantSchema = z.object({
  grant_id: z.string().min(1),
  buyer_id: z.string().min(1),
  agent_id: z.string().min(1),
  listing_id: z.string().min(1),
  seller_id: z.string().min(1),
  order_id: z.string().min(1).optional(),
  settlement_approval_id: z.string().min(1).optional(),
  max_amount_minor: z.number().int().positive(),
  currency: z.string().min(1).default("USD"),
  asset: z.string().min(1).default("USDC"),
  network: z.string().min(1).default("base"),
  allowed_rails: z.array(paymentRailSchema).min(1).default(["x402", "stripe"]),
  preferred_rail: paymentRailSchema.default("x402"),
  terms: z.array(paymentTermTagSchema).default([]),
  expires_at: z.string().min(1),
  nonce: z.string().min(1),
  human_confirmation_required: z.boolean().default(true),
  legal_acknowledgements: paymentLegalAcknowledgementSchema.default({}),
});

export type AgentPaymentGrant = z.infer<typeof agentPaymentGrantSchema>;

export type AgentPaymentGrantStatus = "ACTIVE" | "USED" | "REVOKED" | "EXPIRED";

export interface AgentPaymentPolicyEnvelope {
  version: "haggle.agent_payment_policy.v1";
  grant: AgentPaymentGrant;
}

export interface AgentPaymentPolicyBinding {
  version: "haggle.agent_payment_binding.v1";
  buyer_id: string;
  agent_id: string;
  listing_id: string;
  seller_id: string;
  order_id?: string;
  settlement_approval_id?: string;
  max_amount_minor: number;
  currency: string;
  asset: string;
  network: string;
  allowed_rails: ("x402" | "stripe")[];
  preferred_rail: "x402" | "stripe";
  terms: PaymentTermTag[];
  expires_at: string;
  human_confirmation_required: boolean;
  legal_acknowledgements: PaymentLegalAcknowledgement;
}

export type LegalTermStatus = "allowed" | "restricted" | "blocked";

export interface LegalTermRule {
  term: string;
  status: LegalTermStatus;
  replacement?: string;
  reason: string;
}

export const PAYMENT_LEGAL_TERM_RULES: LegalTermRule[] = [
  {
    term: "escrow",
    status: "restricted",
    replacement: "conditional settlement",
    reason: "May imply licensed escrow services depending on product structure and jurisdiction.",
  },
  {
    term: "custody",
    status: "blocked",
    replacement: "buyer-approved payment authorization",
    reason: "Haggle should not describe itself as holding customer funds or keys.",
  },
  {
    term: "deposit",
    status: "restricted",
    replacement: "payment authorization",
    reason: "May imply bank-like stored value or custodial funds.",
  },
  {
    term: "guaranteed safe",
    status: "blocked",
    replacement: "rules-limited settlement",
    reason: "Overstates consumer protection and creates avoidable compliance risk.",
  },
  {
    term: "yield",
    status: "blocked",
    replacement: "payment",
    reason: "Stablecoin payments must not be marketed as investment or return-bearing products.",
  },
];

export function createAgentPaymentPolicyEnvelope(
  grant: AgentPaymentGrant,
): AgentPaymentPolicyEnvelope {
  return {
    version: "haggle.agent_payment_policy.v1",
    grant: agentPaymentGrantSchema.parse(grant),
  };
}

export function createAgentPaymentPolicyBinding(
  grant: AgentPaymentGrant,
): AgentPaymentPolicyBinding {
  const parsed = agentPaymentGrantSchema.parse(grant);
  return {
    version: "haggle.agent_payment_binding.v1",
    buyer_id: parsed.buyer_id,
    agent_id: parsed.agent_id,
    listing_id: parsed.listing_id,
    seller_id: parsed.seller_id,
    order_id: parsed.order_id,
    settlement_approval_id: parsed.settlement_approval_id,
    max_amount_minor: parsed.max_amount_minor,
    currency: parsed.currency,
    asset: parsed.asset,
    network: parsed.network,
    allowed_rails: parsed.allowed_rails,
    preferred_rail: parsed.preferred_rail,
    terms: parsed.terms,
    expires_at: parsed.expires_at,
    human_confirmation_required: parsed.human_confirmation_required,
    legal_acknowledgements: parsed.legal_acknowledgements,
  };
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

export function canonicalizeAgentPaymentPolicy(grant: AgentPaymentGrant): string {
  return canonicalJson(createAgentPaymentPolicyBinding(grant));
}

export function findPaymentLegalTermIssues(text: string): LegalTermRule[] {
  const normalized = text.toLowerCase();
  return PAYMENT_LEGAL_TERM_RULES.filter((rule) => normalized.includes(rule.term.toLowerCase()));
}
