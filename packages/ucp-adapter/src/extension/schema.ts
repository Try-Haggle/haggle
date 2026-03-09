// ============================================================
// JSON Schema for ai.tryhaggle.negotiation extension
// Used for UCP capability declaration and validation
// ============================================================

export const NEGOTIATION_EXTENSION_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://tryhaggle.ai/ucp/negotiation-schema.json',
  title: 'Haggle Negotiation Extension',
  description: 'UCP extension for AI-powered price negotiation',
  type: 'object',
  properties: {
    session_id: { type: 'string' },
    status: {
      type: 'string',
      enum: ['pending', 'active', 'agreed', 'rejected', 'expired'],
    },
    original_price: { type: 'integer', minimum: 0 },
    current_offer: { type: ['integer', 'null'], minimum: 0 },
    counter_offer: { type: ['integer', 'null'], minimum: 0 },
    round: { type: 'integer', minimum: 0 },
    role: { type: 'string', enum: ['BUYER', 'SELLER'] },
    utility_score: { type: ['number', 'null'], minimum: 0, maximum: 1 },
    decision: {
      type: ['string', 'null'],
      enum: ['ACCEPT', 'COUNTER', 'REJECT', 'NEAR_DEAL', 'ESCALATE', null],
    },
    constraints: {
      type: 'object',
      properties: {
        price_floor: { type: 'integer', minimum: 0 },
        price_ceiling: { type: 'integer', minimum: 0 },
        deadline: { type: 'string', format: 'date-time' },
      },
      required: ['price_floor', 'price_ceiling', 'deadline'],
    },
  },
  required: ['session_id', 'status', 'original_price', 'round', 'role', 'constraints'],
} as const;
