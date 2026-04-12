/**
 * negotiation-demo.ts
 *
 * Doc 26 "LLM-Native 6-Stage Pipeline" 검증 데모.
 * 실제 xAI API를 호출하여 각 Stage의 structured output 품질을 검증한다.
 *
 * 테스트 대상 (6-Stage):
 *   Stage 0a: Strategy Generation  — LLM이 아이템+시장 데이터 → 구매 전략 JSON 생성
 *   Stage 0b: Term Analysis        — LLM이 전략+Term 목록 → 우선순위 분석 JSON 생성
 *   Stage 1:  UNDERSTAND           — LLM이 상대 메시지 → 구조화 의도 파싱
 *   Stage 2:  CONTEXT              — 코드가 Living Memo + Skill + Coach 조립
 *   Stage 3:  DECIDE               — LLM이 전 컨텍스�� → ProtocolDecision 생성
 *   Stage 4:  VALIDATE             — 코드(Referee)가 Math/Protocol Guard 실행
 *   Stage 5:  RESPOND              — LLM이 결정 → 자연어 메시지 생성
 *   Stage 6:  PERSIST+TRANSITION   — 코드가 Memo 갱신 + Phase 전이
 *
 * Zero DB. No auth. In-memory sessions.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { callLLM } from '../negotiation/adapters/xai-client.js';
import { GrokFastAdapter } from '../negotiation/adapters/grok-fast-adapter.js';
import { DefaultEngineSkill } from '../negotiation/skills/default-engine-skill.js';
import { computeCoaching } from '../negotiation/referee/coach.js';
import { validateMove } from '../negotiation/referee/validator.js';
import { tryTransition, detectPhaseEvent } from '../negotiation/phase/phase-machine.js';
import { ELECTRONICS_TERMS } from '../negotiation/term/standard-terms.js';
import { DEFAULT_BUDDY_DNA, DEFAULT_MAX_ROUNDS } from '../negotiation/config.js';
import type {
  CoreMemory,
  RoundFact,
  OpponentPattern,
  ProtocolDecision,
  NegotiationPhase,
  RefereeCoaching,
  ValidationResult,
  ActiveTerm,
} from '../negotiation/types.js';

// ─── Types ──────────────────────────────────────────

interface StageTrace<T = unknown> {
  stage: string;
  /** LLM stage: prompt shown / Code stage: inputs */
  input: unknown;
  /** Raw LLM response / Code output */
  output: unknown;
  /** Parsed/structured result */
  parsed: T;
  latency_ms: number;
  tokens?: { prompt: number; completion: number };
  is_llm: boolean;
}

interface DemoStrategy {
  target_price: number;
  floor_price: number;
  opening_tactic: string;
  approach: string;
  key_concerns: string[];
  negotiation_style: 'aggressive' | 'balanced' | 'defensive';
}

interface TermAnalysis {
  priority_terms: Array<{
    id: string;
    importance: 'critical' | 'important' | 'nice_to_have';
    target_value: string;
    rationale: string;
  }>;
  deal_breakers: Array<{
    id: string;
    condition: string;
    rationale: string;
  }>;
}

interface UnderstandResult {
  price_offer: number;
  conditions_proposed: Array<{ term: string; value: unknown }>;
  conditions_claimed: Array<{ term: string; value: unknown; verified: boolean }>;
  sentiment: string;
  tactic_detected: string;
  message_type: string;
}

interface DecideResult extends ProtocolDecision {
  phase_assessment?: string;
  near_deal?: boolean;
}

interface DemoSession {
  id: string;
  item: { title: string; condition: string; swappa_median: number };
  seller: { ask_price: number; floor_price: number };
  buyer_budget: { max_budget: number };
  strategy: DemoStrategy;
  terms: TermAnalysis;
  memory: CoreMemory;
  facts: RoundFact[];
  opponentPattern: OpponentPattern | null;
  previousMoves: ProtocolDecision[];
  round: number;
  phase: NegotiationPhase;
  done: boolean;
  totalCost: number;
  totalTokens: { prompt: number; completion: number };
  initTraces: StageTrace[];
}

// ─── In-memory store ────────────────────────────────

const sessions = new Map<string, DemoSession>();
const skill = new DefaultEngineSkill();
const adapter = new GrokFastAdapter();
const buddyDna = DEFAULT_BUDDY_DNA;

// ─── Codec (Doc 26 §3.2 simplified for demo) ───────

function encodeSharedMemo(session: DemoSession): string {
  const m = session.memory;
  const lines = [
    '--- SHARED ---',
    `NS:demo_${session.id}|${m.session.phase}|R${m.session.round}/${m.session.max_rounds}`,
  ];
  // Price trajectory
  const buyerPrices = session.facts.map(f => f.buyer_offer).join(',');
  const sellerPrices = session.facts.map(f => f.seller_offer).join(',');
  if (buyerPrices) {
    const lastGap = session.facts.length > 0 ? session.facts[session.facts.length - 1]!.gap : 0;
    lines.push(`PT:B${buyerPrices}|S${sellerPrices}|g${lastGap}`);
  }
  // Recent messages (last 3 facts)
  const recent = session.facts.slice(-3);
  if (recent.length > 0) {
    lines.push('RM:');
    for (const f of recent) {
      lines.push(`R${f.round}/S:$${f.seller_offer} B:$${f.buyer_offer}`);
    }
  }
  return lines.join('\n');
}

function encodePrivateMemo(session: DemoSession): string {
  const m = session.memory;
  const b = m.boundaries;
  const lines = [
    '--- PRIVATE ---',
    `SS:buyer|t${b.my_target}|f${b.my_floor}|c${b.current_offer}|o${b.opponent_offer}|g${b.gap}`,
  ];
  if (session.opponentPattern) {
    const op = session.opponentPattern;
    lines.push(`OM:${op.aggression > 0.7 ? 'BOULWARE' : op.aggression < 0.3 ? 'CONCEDER' : 'LINEAR'}|agg${op.aggression.toFixed(2)}|cr${op.concession_rate.toFixed(3)}`);
  }
  return lines.join('\n');
}

// ─── Prompts ────────────────────────────────────────

const CODEC_LEGEND = `=== HNP Memo Codec v1.0 ===
Shared: NS=State, PT=PriceTrajectory(B=buyer,S=seller,g=gap), RM=RecentMessages
Private: SS=Strategy(t=target,f=floor,c=current,o=opponent,g=gap), OM=OpponentModel
Prices in minor units (cents). $700 = 70000`;

function buildUnderstandPrompt(sellerMessage: string): { system: string; user: string } {
  return {
    system: `You are Stage 1 (UNDERSTAND) of the Haggle Negotiation Protocol.
Parse the seller's message into structured intent.
Respond ONLY with valid JSON:
{
  "price_offer": number (minor units, e.g. $700 = 70000),
  "conditions_proposed": [{"term": string, "value": any}],
  "conditions_claimed": [{"term": string, "value": any, "verified": false}],
  "sentiment": "cooperative"|"firm"|"aggressive"|"passive",
  "tactic_detected": string,
  "message_type": "offer"|"counter"|"conditional_offer"|"rejection"|"acceptance"|"question"
}`,
    user: `SELLER MESSAGE: "${sellerMessage}"`,
  };
}

function buildDecidePrompt(session: DemoSession, coaching: RefereeCoaching, understood: UnderstandResult): { system: string; user: string } {
  const skillCtx = skill.getLLMContext();
  const constraints = skill.getConstraints().map(c => `- ${c.rule}: ${c.description}`).join('\n');
  const tactics = skill.getTactics().join(', ');

  return {
    system: `You are Stage 3 (DECIDE) of the Haggle Negotiation Protocol — BUYER side.
${CODEC_LEGEND}

## Category Knowledge
${skillCtx}
Available tactics: ${tactics}
Constraints:
${constraints}

## Rules
1. NEVER exceed your floor price (max you'll pay)
2. Follow phase-appropriate actions:
   - OPENING: COUNTER (initial offer)
   - BARGAINING: COUNTER, ACCEPT, REJECT, HOLD
   - CLOSING: CONFIRM, HOLD
3. Always provide reasoning (internal, not shown to opponent)

Respond ONLY with valid JSON:
{
  "action": "COUNTER"|"ACCEPT"|"REJECT"|"HOLD"|"DISCOVER"|"CONFIRM",
  "price": number (minor units),
  "reasoning": string,
  "tactic_used": string,
  "non_price_terms": {},
  "phase_assessment": "OPENING"|"BARGAINING"|"CLOSING",
  "near_deal": boolean
}`,
    user: `## Living Memo
${encodeSharedMemo(session)}
${encodePrivateMemo(session)}

## Coaching
Recommended price: $${coaching.recommended_price} (minor: ${coaching.recommended_price})
Range: $${coaching.acceptable_range.min}-$${coaching.acceptable_range.max}
Tactic: ${coaching.suggested_tactic}
Opponent: ${coaching.opponent_pattern}
Time pressure: ${(coaching.time_pressure * 100).toFixed(0)}%
${coaching.warnings.length > 0 ? 'Warnings: ' + coaching.warnings.join('; ') : ''}

## Seller's Move (from UNDERSTAND)
Price: $${understood.price_offer} (${understood.message_type})
Sentiment: ${understood.sentiment}
Tactic: ${understood.tactic_detected}
${understood.conditions_proposed.length > 0 ? 'Conditions proposed: ' + JSON.stringify(understood.conditions_proposed) : ''}`,
  };
}

function buildRespondPrompt(decision: ProtocolDecision, phase: NegotiationPhase, recentFacts: RoundFact[]): { system: string; user: string } {
  return {
    system: `You are Stage 5 (RESPOND) of the Haggle Negotiation Protocol — BUYER side.
Generate a natural, human-like buyer message. Style: professional, neutral formality, no emoji.
Keep it 1-2 sentences. Don't reveal strategy or floor price.
Respond ONLY with valid JSON: { "message": string }`,
    user: `DECISION: ${JSON.stringify(decision)}
PHASE: ${phase}
${recentFacts.length > 0 ? 'LAST EXCHANGE: Seller offered $' + recentFacts[recentFacts.length - 1]!.seller_offer : ''}`,
  };
}

// ─── Schema ─────────────────────────────────────────

const initSchema = z.object({
  item: z.object({
    title: z.string().default('iPhone 15 Pro 256GB Natural Titanium'),
    condition: z.string().default('battery 92%, screen mint, T-Mobile unlocked'),
    swappa_median: z.number().default(920),
  }).default({}),
  seller: z.object({
    ask_price: z.number().default(920),
    floor_price: z.number().default(700),
  }).default({}),
  buyer_budget: z.object({
    max_budget: z.number().default(950),
  }).default({}),
});

const roundSchema = z.object({
  seller_price: z.number().positive(),
  seller_message: z.string().optional(),
});

// ─── Helpers ────────────────────────────────────────

function genId(): string {
  return 'demo_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}

function buildInitialMemory(strategy: DemoStrategy, item: { swappa_median: number }, floorPrice: number): CoreMemory {
  return {
    session: {
      session_id: '',
      phase: 'OPENING',
      round: 0,
      rounds_remaining: DEFAULT_MAX_ROUNDS,
      role: 'buyer',
      max_rounds: DEFAULT_MAX_ROUNDS,
      intervention_mode: 'FULL_AUTO',
    },
    boundaries: {
      my_target: strategy.target_price,
      my_floor: strategy.floor_price,
      current_offer: 0,
      opponent_offer: item.swappa_median * 100, // minor units
      gap: Math.abs(item.swappa_median * 100 - strategy.target_price),
    },
    terms: {
      active: [],
      resolved_summary: '',
    },
    coaching: {
      recommended_price: 0,
      acceptable_range: { min: 0, max: 0 },
      suggested_tactic: '',
      hint: '',
      opponent_pattern: 'UNKNOWN',
      convergence_rate: 0,
      time_pressure: 0,
      utility_snapshot: { u_price: 0, u_time: 1, u_risk: 0.5, u_quality: 0.5, u_total: 0.5 },
      strategic_hints: [],
      warnings: [],
    },
    buddy_dna: buddyDna,
    skill_summary: skill.getLLMContext(),
  };
}

async function traceLLMCall<T>(
  stageName: string,
  systemPrompt: string,
  userPrompt: string,
  parser: (raw: string) => T,
  options?: { reasoning?: boolean },
): Promise<StageTrace<T>> {
  const start = Date.now();
  const response = await callLLM(systemPrompt, userPrompt, {
    reasoning: options?.reasoning,
    correlationId: `demo-${stageName}`,
  });
  const latency = Date.now() - start;
  const parsed = parser(response.content);

  return {
    stage: stageName,
    input: { system_prompt: systemPrompt, user_prompt: userPrompt },
    output: response.content,
    parsed,
    latency_ms: latency,
    tokens: {
      prompt: response.usage.prompt_tokens,
      completion: response.usage.completion_tokens,
    },
    is_llm: true,
  };
}

function parseJSON<T>(raw: string): T {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  return JSON.parse(cleaned);
}

// ─── Route Registration ─────────────────────────────

export function registerDemoRoute(app: FastifyInstance) {

  // ━━━ POST /negotiations/demo/init ━━━━━━━━━━━━━━━━
  // Tests: Stage 0a (Strategy Gen) + Stage 0b (Term Analysis)
  app.post('/negotiations/demo/init', async (request, reply) => {
    const parsed = initSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'INVALID_REQUEST', issues: parsed.error.issues });
    }

    const { item, seller, buyer_budget } = parsed.data;
    const traces: StageTrace[] = [];

    // ── Stage 0a: Strategy Generation (LLM) ──
    const strategyTrace = await traceLLMCall<DemoStrategy>(
      '0a_STRATEGY_GENERATION',
      `You are a buyer strategy advisor for the Haggle protocol.
Given an item listing and market data, generate a structured buying strategy.
Respond ONLY with valid JSON:
{
  "target_price": number (minor units — cents, e.g. $750 = 75000),
  "floor_price": number (minor units — absolute max buyer will pay),
  "opening_tactic": "anchoring"|"reciprocal_concession"|"bundling",
  "approach": string (1 sentence),
  "key_concerns": [string],
  "negotiation_style": "aggressive"|"balanced"|"defensive"
}`,
      `ITEM: ${item.title}
CONDITION: ${item.condition}
MARKET: Swappa 30-day median $${item.swappa_median}
SELLER ASK: $${seller.ask_price}
MY MAX BUDGET: $${buyer_budget.max_budget}`,
      parseJSON<DemoStrategy>,
    );
    traces.push(strategyTrace);
    const strategy = strategyTrace.parsed;

    // ── Stage 0b: Term Analysis (LLM) ──
    const termsForPrompt = ELECTRONICS_TERMS.map(t =>
      `${t.id} (${t.parent_category}): ${t.evaluate_hint}`,
    ).join('\n');

    const termTrace = await traceLLMCall<TermAnalysis>(
      '0b_TERM_ANALYSIS',
      `You are a negotiation term analyst for the Haggle protocol.
Given a strategy and available terms, analyze which terms matter most for this deal.
Respond ONLY with valid JSON:
{
  "priority_terms": [{"id": string, "importance": "critical"|"important"|"nice_to_have", "target_value": string, "rationale": string}],
  "deal_breakers": [{"id": string, "condition": string, "rationale": string}]
}`,
      `STRATEGY: target=$${(strategy.target_price / 100).toFixed(0)}, floor=$${(strategy.floor_price / 100).toFixed(0)}, style=${strategy.negotiation_style}
AVAILABLE TERMS:
${termsForPrompt}
ITEM CONDITION: ${item.condition}`,
      parseJSON<TermAnalysis>,
    );
    traces.push(termTrace);
    const terms = termTrace.parsed;

    // ── Build session ──
    const id = genId();
    const memory = buildInitialMemory(strategy, item, seller.floor_price);
    memory.session.session_id = id;

    // Activate terms from LLM analysis
    memory.terms.active = terms.priority_terms.map((t): ActiveTerm => ({
      term_id: t.id,
      category: ELECTRONICS_TERMS.find(et => et.id === t.id)?.parent_category ?? 'CUSTOM',
      display_name: ELECTRONICS_TERMS.find(et => et.id === t.id)?.display_name ?? t.id,
      status: 'not_discussed',
      proposed_by: 'protocol',
      round_introduced: 0,
    }));

    const session: DemoSession = {
      id,
      item,
      seller,
      buyer_budget,
      strategy,
      terms,
      memory,
      facts: [],
      opponentPattern: null,
      previousMoves: [],
      round: 0,
      phase: 'OPENING',
      done: false,
      totalCost: 0,
      totalTokens: { prompt: 0, completion: 0 },
      initTraces: traces,
    };

    // Accumulate init costs
    for (const t of traces) {
      if (t.tokens) {
        session.totalTokens.prompt += t.tokens.prompt;
        session.totalTokens.completion += t.tokens.completion;
        // Grok 4 Fast pricing: $0.05/1K input, $0.15/1K output
        session.totalCost += (t.tokens.prompt * 0.0000002) + (t.tokens.completion * 0.0000005);
      }
    }

    sessions.set(id, session);

    return reply.send({
      demo_id: id,
      stages_tested: [
        '0a_STRATEGY_GENERATION — LLM이 아이템+시장→구매전략 JSON',
        '0b_TERM_ANALYSIS — LLM이 전략+Terms→우선순위 JSON',
      ],
      strategy,
      terms,
      initial_memory: memory,
      pipeline: traces.map(t => ({
        stage: t.stage,
        is_llm: t.is_llm,
        system_prompt: (t.input as { system_prompt: string }).system_prompt,
        user_prompt: (t.input as { user_prompt: string }).user_prompt,
        raw_response: t.output,
        parsed: t.parsed,
        tokens: t.tokens,
        latency_ms: t.latency_ms,
      })),
      cost: {
        total_usd: session.totalCost,
        total_tokens: session.totalTokens,
      },
    });
  });

  // ━━━ POST /negotiations/demo/:id/round ━━━━━━━━━━━
  // Tests: Full 6-Stage Pipeline (Stage 1~6)
  app.post<{ Params: { id: string } }>('/negotiations/demo/:id/round', async (request, reply) => {
    const session = sessions.get(request.params.id);
    if (!session) {
      return reply.code(404).send({ error: 'SESSION_NOT_FOUND' });
    }
    if (session.done) {
      return reply.code(400).send({ error: 'SESSION_DONE', phase: session.phase });
    }

    const parsed = roundSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'INVALID_REQUEST', issues: parsed.error.issues });
    }

    const { seller_price, seller_message } = parsed.data;
    const sellerPriceMinor = Math.round(seller_price * 100);
    const stages: StageTrace[] = [];
    session.round++;

    // ────────────────────────────────────────────────
    // Stage 1: UNDERSTAND (LLM)
    // Test: LLM이 자연어 메시지를 구조화된 의도로 파싱하는가?
    // ────────────────────────────────────────────────
    const sellerText = seller_message ?? `I can do $${seller_price} for this. What do you think?`;
    const understandPrompts = buildUnderstandPrompt(sellerText);

    const understandTrace = await traceLLMCall<UnderstandResult>(
      '1_UNDERSTAND',
      understandPrompts.system,
      understandPrompts.user,
      parseJSON<UnderstandResult>,
    );
    stages.push(understandTrace);
    const understood = understandTrace.parsed;

    // ────────────────────────────────────────────────
    // Stage 2: CONTEXT (순수 코드)
    // Test: Living Memo + Skill + Coach가 올바르게 조립되는가?
    // ────────────────────────────────────────────────
    const ctxStart = Date.now();

    // Update memory with incoming offer
    session.memory.boundaries.opponent_offer = sellerPriceMinor;
    session.memory.boundaries.gap = Math.abs(sellerPriceMinor - session.memory.boundaries.current_offer);
    session.memory.session.round = session.round;
    session.memory.session.rounds_remaining = session.memory.session.max_rounds - session.round;
    session.memory.session.phase = session.phase;

    const coaching = computeCoaching(
      session.memory,
      session.facts,
      session.opponentPattern,
      buddyDna,
    );
    session.memory.coaching = coaching;

    const sharedMemo = encodeSharedMemo(session);
    const privateMemo = encodePrivateMemo(session);

    const contextTrace: StageTrace = {
      stage: '2_CONTEXT',
      input: {
        memory_snapshot: { ...session.memory },
        opponent_pattern: session.opponentPattern,
        recent_facts_count: session.facts.length,
      },
      output: {
        coaching,
        shared_memo_codec: sharedMemo,
        private_memo_codec: privateMemo,
        skill_context: skill.getLLMContext(),
        constraints: skill.getConstraints(),
      },
      parsed: { coaching, memo: sharedMemo + '\n' + privateMemo },
      latency_ms: Date.now() - ctxStart,
      is_llm: false,
    };
    stages.push(contextTrace);

    // ────────────────────────────────────────────────
    // Stage 3: DECIDE (LLM)
    // Test: LLM이 전체 컨텍스트 → ProtocolDecision JSON을 올바르게 생성하는가?
    //       모든 Phase에서 적절한 action을 선택하는가?
    // ────────────────────────────────────────────────
    const decidePrompts = buildDecidePrompt(session, coaching, understood);

    // Reasoning mode trigger (Doc 26: code decides, not LLM)
    const gapRatio = session.memory.boundaries.my_floor > 0
      ? session.memory.boundaries.gap / Math.abs(session.memory.boundaries.my_floor - session.memory.boundaries.my_target)
      : 1;
    const useReasoning = gapRatio < 0.10 || coaching.warnings.length >= 2;

    const decideTrace = await traceLLMCall<DecideResult>(
      '3_DECIDE',
      decidePrompts.system,
      decidePrompts.user,
      parseJSON<DecideResult>,
      { reasoning: useReasoning },
    );
    stages.push(decideTrace);

    let decision: ProtocolDecision = {
      action: decideTrace.parsed.action,
      price: decideTrace.parsed.price,
      reasoning: decideTrace.parsed.reasoning,
      tactic_used: decideTrace.parsed.tactic_used,
      non_price_terms: decideTrace.parsed.non_price_terms,
    };

    // ────────────────────────────────────────────────
    // Stage 4: VALIDATE (순수 코드 — Referee)
    // Test: Math Guard + Protocol Guard가 LLM 출력을 올바르게 검증하는가?
    //       HARD violation 시 auto-fix가 작동하는가?
    // ────────────────────────────────────────────────
    const valStart = Date.now();
    let validation: ValidationResult = validateMove(
      decision,
      session.memory,
      coaching,
      session.previousMoves,
      session.phase,
    );

    let autoFixApplied = false;
    const originalDecision = { ...decision };

    if (!validation.hardPassed) {
      // Auto-fix: apply suggested fixes from HARD violations
      const hardViolations = validation.violations.filter(v => v.severity === 'HARD');
      for (const violation of hardViolations) {
        if (violation.suggested_fix) {
          decision = { ...decision, ...violation.suggested_fix };
        }
      }
      autoFixApplied = true;
      // Re-validate
      validation = validateMove(decision, session.memory, coaching, session.previousMoves, session.phase);
    }

    const validateTrace: StageTrace<ValidationResult> = {
      stage: '4_VALIDATE',
      input: { original_decision: originalDecision, memory_boundaries: session.memory.boundaries },
      output: { validation, auto_fix_applied: autoFixApplied, final_decision: decision },
      parsed: validation,
      latency_ms: Date.now() - valStart,
      is_llm: false,
    };
    stages.push(validateTrace);

    // ────────────────────────────────────────────────
    // Stage 5: RESPOND (LLM)
    // Test: LLM이 ProtocolDecision → 자연어 메시지를 올바르게 생성하는가?
    //       TemplateMessageRenderer를 대체할 수 있는가?
    // ────────────────────────────────────────────────
    const respondPrompts = buildRespondPrompt(decision, session.phase, session.facts);

    const respondTrace = await traceLLMCall<{ message: string }>(
      '5_RESPOND',
      respondPrompts.system,
      respondPrompts.user,
      parseJSON<{ message: string }>,
    );
    stages.push(respondTrace);
    const renderedMessage = respondTrace.parsed.message;

    // ────────────────────────────────────────────────
    // Stage 6: PERSIST + TRANSITION (순수 코드)
    // Test: Phase 전이가 LLM advisory + 코드 규칙으로 올바르게 작동하는가?
    //       Living Memo가 정확하게 갱신되는가?
    // ────────────────────────────────────────────────
    const persistStart = Date.now();

    // Update buyer offer in memory
    if (decision.price) {
      session.memory.boundaries.current_offer = decision.price;
      session.memory.boundaries.gap = Math.abs(sellerPriceMinor - decision.price);
    }

    // Record fact
    const fact: RoundFact = {
      round: session.round,
      phase: session.phase,
      buyer_offer: decision.price ?? session.memory.boundaries.current_offer,
      seller_offer: sellerPriceMinor,
      gap: session.memory.boundaries.gap,
      buyer_tactic: decision.tactic_used,
      conditions_changed: {},
      coaching_given: { recommended: coaching.recommended_price, tactic: coaching.suggested_tactic },
      coaching_followed: decision.price !== undefined && Math.abs(decision.price - coaching.recommended_price) < coaching.recommended_price * 0.05,
      human_intervened: false,
      timestamp: Date.now(),
    };
    session.facts.push(fact);
    session.previousMoves.push(decision);

    // Update opponent pattern (EMA)
    if (session.facts.length >= 2) {
      const prevFact = session.facts[session.facts.length - 2]!;
      const concession = prevFact.seller_offer > 0
        ? (prevFact.seller_offer - sellerPriceMinor) / prevFact.seller_offer
        : 0;
      const prevAgg = session.opponentPattern?.aggression ?? 0.5;
      const newAgg = 0.7 * prevAgg + 0.3 * (1 - concession);
      session.opponentPattern = {
        aggression: newAgg,
        concession_rate: concession,
        preferred_tactics: [],
        condition_flexibility: 0.5,
        estimated_floor: 0,
      };
    }

    // Phase transition: code decides (LLM advisory is input, not authority)
    const isNearDeal = gapRatio < 0.08;
    const bothConfirmed = decision.action === 'CONFIRM' && session.phase === 'CLOSING';
    const phaseEvent = detectPhaseEvent(decision.action, session.phase, isNearDeal, bothConfirmed);
    let phaseTransition = null;
    if (phaseEvent) {
      const result = tryTransition(session.phase, phaseEvent);
      if (result.transitioned) {
        phaseTransition = result;
        session.phase = result.to;
        session.memory.session.phase = result.to;
      }
    }

    // Terminal check
    if (decision.action === 'ACCEPT') {
      session.done = true;
      session.phase = 'SETTLEMENT';
      session.memory.session.phase = 'SETTLEMENT';
    }
    if (decision.action === 'REJECT') {
      session.done = true;
    }
    if (session.round >= session.memory.session.max_rounds) {
      session.done = true;
    }

    const persistTrace: StageTrace = {
      stage: '6_PERSIST_TRANSITION',
      input: {
        decision_action: decision.action,
        phase_event: phaseEvent,
        llm_phase_assessment: decideTrace.parsed.phase_assessment,
        llm_near_deal: decideTrace.parsed.near_deal,
        code_near_deal: isNearDeal,
        code_gap_ratio: gapRatio,
      },
      output: {
        phase_transition: phaseTransition,
        fact_recorded: fact,
        opponent_pattern_updated: session.opponentPattern,
        memo_updated: true,
        session_done: session.done,
      },
      parsed: { phase_transition: phaseTransition, done: session.done },
      latency_ms: Date.now() - persistStart,
      is_llm: false,
    };
    stages.push(persistTrace);

    // ── Accumulate costs ──
    for (const s of stages) {
      if (s.tokens) {
        session.totalTokens.prompt += s.tokens.prompt;
        session.totalTokens.completion += s.tokens.completion;
        session.totalCost += (s.tokens.prompt * 0.0000002) + (s.tokens.completion * 0.0000005);
      }
    }

    // ── Response ──
    return reply.send({
      round: session.round,
      phase: session.phase,
      stages_tested: [
        '1_UNDERSTAND — LLM이 자연어→구조화 의도 파싱',
        '2_CONTEXT — 코드가 Memo+Skill+Coach 조립',
        '3_DECIDE — LLM이 전체 컨텍스트→ProtocolDecision',
        '4_VALIDATE — 코드(Referee)가 Math/Protocol Guard',
        '5_RESPOND — LLM이 결정→자연어 메시지',
        '6_PERSIST_TRANSITION — 코드가 Memo갱신+Phase전이',
      ],
      pipeline: stages.map(s => ({
        stage: s.stage,
        is_llm: s.is_llm,
        ...(s.is_llm ? {
          system_prompt: (s.input as { system_prompt: string }).system_prompt,
          user_prompt: (s.input as { user_prompt: string }).user_prompt,
          raw_response: s.output,
        } : {
          input: s.input,
          output: s.output,
        }),
        parsed: s.parsed,
        tokens: s.tokens ?? null,
        latency_ms: s.latency_ms,
      })),
      final: {
        decision,
        rendered_message: renderedMessage,
        validation: {
          passed: validation.passed,
          hard_passed: validation.hardPassed,
          violations: validation.violations,
          auto_fix_applied: autoFixApplied,
        },
        phase_transition: phaseTransition,
      },
      state: {
        buyer_price: decision.price ?? 0,
        seller_price: sellerPriceMinor,
        gap: session.memory.boundaries.gap,
        gap_pct: (gapRatio * 100).toFixed(1) + '%',
        reasoning_mode: useReasoning,
        done: session.done,
      },
      cost: {
        round_usd: stages.reduce((sum, s) => sum + ((s.tokens?.prompt ?? 0) * 0.0000002 + (s.tokens?.completion ?? 0) * 0.0000005), 0),
        total_usd: session.totalCost,
        round_tokens: stages.reduce((sum, s) => ({ prompt: sum.prompt + (s.tokens?.prompt ?? 0), completion: sum.completion + (s.tokens?.completion ?? 0) }), { prompt: 0, completion: 0 }),
        total_tokens: session.totalTokens,
      },
    });
  });

  // ━━━ GET /negotiations/demo/:id ━━━━━━━━━━━━━━━━━━
  // Current session state
  app.get<{ Params: { id: string } }>('/negotiations/demo/:id', async (request, reply) => {
    const session = sessions.get(request.params.id);
    if (!session) return reply.code(404).send({ error: 'SESSION_NOT_FOUND' });

    return reply.send({
      demo_id: session.id,
      round: session.round,
      phase: session.phase,
      done: session.done,
      strategy: session.strategy,
      terms: session.terms,
      memory: session.memory,
      facts: session.facts,
      cost: { total_usd: session.totalCost, total_tokens: session.totalTokens },
    });
  });
}
