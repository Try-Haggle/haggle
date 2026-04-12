/**
 * routes/negotiation-stages.ts
 *
 * External agent API for individual pipeline stage invocations.
 * Allows external agents to call Stage 2 (Context), Stage 4 (Validate),
 * and Stage 5 (Respond) independently.
 *
 * Auth: Bearer token + x-haggle-actor-id header required.
 * Feature flag: Only available when NEGOTIATION_PIPELINE=staged.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database } from '@haggle/db';
import { requireAuth } from '../middleware/require-auth.js';
import { getPipelineMode } from '../lib/executor-factory.js';

import { assembleStageContext } from '../negotiation/stages/context.js';
import { validateStage } from '../negotiation/stages/validate.js';
import { respond } from '../negotiation/stages/respond.js';

import { DefaultEngineSkill } from '../negotiation/skills/default-engine-skill.js';
import { GrokFastAdapter } from '../negotiation/adapters/grok-fast-adapter.js';

import type {
  CoreMemory,
  RoundFact,
  OpponentPattern,
  NegotiationPhase,
  ProtocolDecision,
  RefereeCoaching,
  L5Signals,
} from '../negotiation/types.js';
import type { UnderstandOutput, DecideOutput, ValidateOutput } from '../negotiation/pipeline/types.js';

// ---------------------------------------------------------------------------
// Singletons (shared across requests)
// ---------------------------------------------------------------------------

const defaultSkill = new DefaultEngineSkill();
const defaultAdapter = new GrokFastAdapter();

// ---------------------------------------------------------------------------
// Request Schemas
// ---------------------------------------------------------------------------

const actorHeaderSchema = z.string().min(1);

const coreMemorySchema = z.object({
  session: z.object({
    session_id: z.string(),
    phase: z.enum(['DISCOVERY', 'OPENING', 'BARGAINING', 'CLOSING', 'SETTLEMENT']),
    round: z.number(),
    rounds_remaining: z.number(),
    role: z.enum(['buyer', 'seller']),
    max_rounds: z.number(),
    intervention_mode: z.enum(['FULL_AUTO', 'APPROVE_ONLY', 'HYBRID', 'MANUAL']),
  }),
  boundaries: z.object({
    my_target: z.number(),
    my_floor: z.number(),
    current_offer: z.number(),
    opponent_offer: z.number(),
    gap: z.number(),
  }),
  terms: z.object({
    active: z.array(z.any()),
    resolved_summary: z.string(),
  }),
  coaching: z.any(),
  buddy_dna: z.any(),
  skill_summary: z.string(),
}).passthrough();

const understoodSchema = z.object({
  price_offer: z.number().optional(),
  action_intent: z.enum(['OFFER', 'COUNTER', 'ACCEPT', 'REJECT', 'QUESTION', 'INFO']),
  conditions: z.record(z.unknown()),
  sentiment: z.enum(['positive', 'neutral', 'negative']),
  raw_text: z.string(),
});

const roundFactSchema = z.object({
  round: z.number(),
  phase: z.enum(['DISCOVERY', 'OPENING', 'BARGAINING', 'CLOSING', 'SETTLEMENT']),
  buyer_offer: z.number(),
  seller_offer: z.number(),
  gap: z.number(),
  buyer_tactic: z.string().optional(),
  seller_tactic: z.string().optional(),
  conditions_changed: z.record(z.string()),
  coaching_given: z.object({ recommended: z.number(), tactic: z.string() }),
  coaching_followed: z.boolean(),
  human_intervened: z.boolean(),
  timestamp: z.number(),
});

const opponentSchema = z.object({
  aggression: z.number(),
  concession_rate: z.number(),
  preferred_tactics: z.array(z.string()),
  condition_flexibility: z.number(),
  pattern_shift_round: z.number().optional(),
  estimated_floor: z.number(),
});

const l5SignalsSchema = z.object({
  market: z.object({
    avg_sold_price_30d: z.number(),
    price_trend: z.enum(['rising', 'stable', 'falling']),
    active_listings_count: z.number(),
    source_prices: z.array(z.object({ platform: z.string(), price: z.number() })),
  }).optional(),
  competition: z.object({
    concurrent_sessions: z.number(),
    best_competing_offer: z.number().optional(),
  }).optional(),
  category: z.object({
    avg_discount_rate: z.number(),
    avg_rounds_to_deal: z.number(),
  }).optional(),
}).optional();

// Stage 2: Context request
const contextRequestSchema = z.object({
  understood: understoodSchema,
  memory: coreMemorySchema,
  facts: z.array(roundFactSchema),
  opponent: opponentSchema,
  skill_id: z.string().min(1),
  l5_signals: l5SignalsSchema,
});

// Stage 4: Validate request
const protocolDecisionSchema = z.object({
  action: z.enum(['COUNTER', 'ACCEPT', 'REJECT', 'HOLD', 'DISCOVER', 'CONFIRM']),
  price: z.number().optional(),
  reasoning: z.string(),
  non_price_terms: z.record(z.unknown()).optional(),
  tactic_used: z.string().optional(),
});

const coachingSchema = z.object({
  recommended_price: z.number(),
  acceptable_range: z.object({ min: z.number(), max: z.number() }),
  suggested_tactic: z.string(),
  hint: z.string(),
  opponent_pattern: z.enum(['BOULWARE', 'CONCEDER', 'LINEAR', 'UNKNOWN']),
  convergence_rate: z.number(),
  time_pressure: z.number(),
  utility_snapshot: z.object({
    u_price: z.number(),
    u_time: z.number(),
    u_risk: z.number(),
    u_quality: z.number(),
    u_total: z.number(),
  }),
  strategic_hints: z.array(z.string()),
  warnings: z.array(z.string()),
});

const validateRequestSchema = z.object({
  decision: z.object({
    decision: protocolDecisionSchema,
    source: z.enum(['llm', 'skill']),
    reasoning_mode: z.boolean(),
    llm_raw: z.string().optional(),
    tokens: z.object({ prompt: z.number(), completion: z.number() }).optional(),
    latency_ms: z.number().optional(),
  }),
  coaching: coachingSchema,
  memory: coreMemorySchema,
  phase: z.enum(['DISCOVERY', 'OPENING', 'BARGAINING', 'CLOSING', 'SETTLEMENT']),
});

// Stage 5: Respond request
const validatedOutputSchema = z.object({
  final_decision: protocolDecisionSchema,
  validation: z.object({
    passed: z.boolean(),
    hardPassed: z.boolean(),
    violations: z.array(z.any()),
  }),
  auto_fix_applied: z.boolean(),
  retry_count: z.number(),
  explainability: z.any(),
});

const respondRequestSchema = z.object({
  validated: validatedOutputSchema,
  memory: coreMemorySchema,
  skill_id: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Route Registration
// ---------------------------------------------------------------------------

export function registerStageRoutes(app: FastifyInstance, _db: Database) {
  // Guard: only available in staged pipeline mode
  const guardStagedPipeline = async (request: any, reply: any) => {
    if (getPipelineMode() !== 'staged') {
      return reply.code(404).send({
        error: 'STAGED_PIPELINE_REQUIRED',
        message: 'Stage API is only available when NEGOTIATION_PIPELINE=staged',
      });
    }
    // Require x-haggle-actor-id header
    const actorId = request.headers['x-haggle-actor-id'];
    const parsed = actorHeaderSchema.safeParse(actorId);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'MISSING_ACTOR_ID',
        message: 'x-haggle-actor-id header is required',
      });
    }
  };

  // POST /negotiations/stages/context — Stage 2
  app.post(
    '/negotiations/stages/context',
    { preHandler: [requireAuth, guardStagedPipeline] },
    async (request, reply) => {
      const parsed = contextRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'INVALID_CONTEXT_REQUEST',
          issues: parsed.error.issues,
        });
      }

      const data = parsed.data;

      const contextOutput = assembleStageContext(
        {
          understood: data.understood as UnderstandOutput,
          memory: data.memory as unknown as CoreMemory,
          facts: data.facts as RoundFact[],
          opponent: data.opponent as OpponentPattern,
          skill: defaultSkill,
          l5_signals: data.l5_signals as L5Signals | undefined,
        },
        defaultAdapter,
        'codec',
      );

      return reply.code(200).send({
        layers: contextOutput.layers,
        coaching: contextOutput.coaching,
        memo_snapshot: contextOutput.memo_snapshot,
      });
    },
  );

  // POST /negotiations/stages/validate — Stage 4
  app.post(
    '/negotiations/stages/validate',
    { preHandler: [requireAuth, guardStagedPipeline] },
    async (request, reply) => {
      const parsed = validateRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'INVALID_VALIDATE_REQUEST',
          issues: parsed.error.issues,
        });
      }

      const data = parsed.data;

      const validateOutput = validateStage(
        {
          decision: data.decision as DecideOutput,
          coaching: data.coaching as RefereeCoaching,
          memory: data.memory as unknown as CoreMemory,
          phase: data.phase as NegotiationPhase,
        },
        [],  // previousMoves: empty for stateless external calls. V6_STAGNATION won't detect stagnation without history — acceptable for single-stage invocation. Full history available via pipeline executor.
      );

      return reply.code(200).send({
        final_decision: validateOutput.final_decision,
        validation: validateOutput.validation,
        auto_fix_applied: validateOutput.auto_fix_applied,
        explainability: validateOutput.explainability,
      });
    },
  );

  // POST /negotiations/stages/respond — Stage 5
  app.post(
    '/negotiations/stages/respond',
    { preHandler: [requireAuth, guardStagedPipeline] },
    async (request, reply) => {
      const parsed = respondRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'INVALID_RESPOND_REQUEST',
          issues: parsed.error.issues,
        });
      }

      const data = parsed.data;

      const respondOutput = respond({
        validated: data.validated as ValidateOutput,
        memory: data.memory as unknown as CoreMemory,
        adapter: defaultAdapter,
        skill: defaultSkill,
        config: {
          adapters: {
            UNDERSTAND: defaultAdapter,
            DECIDE: defaultAdapter,
            RESPOND: defaultAdapter,
          },
          modes: { RESPOND: 'template', VALIDATE: 'full' },
          memoEncoding: 'codec',
          reasoningEnabled: true,
        },
      });

      return reply.code(200).send({
        message: respondOutput.message,
        tone: respondOutput.tone,
      });
    },
  );
}
