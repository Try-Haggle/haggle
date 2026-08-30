import { z } from "zod";

export const hnpIssueValueSchema = z.object({
  issue_id: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean()]),
  unit: z.string().optional(),
  kind: z.enum(["NEGOTIABLE", "INFORMATIONAL"]).optional(),
});

export const hnpOfferEnvelopeSchema = z.object({
  spec_version: z.string().min(1),
  capability: z.string().min(1),
  session_id: z.string().uuid(),
  message_id: z.string().min(1),
  idempotency_key: z.string().min(1),
  correlation_id: z.string().optional(),
  sequence: z.number().int().nonnegative(),
  sent_at_ms: z.number().int().positive(),
  expires_at_ms: z.number().int().positive(),
  sender_agent_id: z.string().min(1),
  sender_role: z.enum(["BUYER", "SELLER"]),
  type: z.enum(["OFFER", "COUNTER"]),
  payload: z.object({
    proposal_id: z.string().min(1),
    issues: z.array(hnpIssueValueSchema).default([]),
    total_price: z.object({
      currency: z.string().length(3).default("USD"),
      units_minor: z.number().int().positive(),
    }),
    proposal_hash: z.string().min(1).optional(),
    rationale_code: z.string().optional(),
    valid_until: z.string().optional(),
    in_reply_to: z.string().optional(),
    settlement_preconditions: z.array(z.string().min(1)).optional(),
  }),
  detached_signature: z.string().optional(),
});

export const hnpAcceptEnvelopeSchema = z.object({
  spec_version: z.string().min(1),
  capability: z.string().min(1),
  session_id: z.string().uuid(),
  message_id: z.string().min(1),
  idempotency_key: z.string().min(1),
  correlation_id: z.string().optional(),
  sequence: z.number().int().nonnegative(),
  sent_at_ms: z.number().int().positive(),
  expires_at_ms: z.number().int().positive(),
  sender_agent_id: z.string().min(1),
  sender_role: z.enum(["BUYER", "SELLER"]),
  type: z.literal("ACCEPT"),
  payload: z.object({
    accepted_message_id: z.string().min(1),
    accepted_proposal_id: z.string().min(1),
    accepted_proposal_hash: z.string().min(1).optional(),
    accepted_issues: z.array(hnpIssueValueSchema).optional(),
  }),
  detached_signature: z.string().optional(),
});

export type HnpOfferEnvelope = z.infer<typeof hnpOfferEnvelopeSchema>;
export type HnpAcceptEnvelope = z.infer<typeof hnpAcceptEnvelopeSchema>;
