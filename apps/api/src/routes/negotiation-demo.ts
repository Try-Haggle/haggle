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
 *   Stage 2:  CONTEXT              — 코드가 Briefing + SkillStack + Memo 조립
 *   Stage 3:  DECIDE               — LLM이 전 컨텍스트 → ProtocolDecision 생성
 *   Stage 4:  VALIDATE             — 코드(Referee)가 Math/Protocol Guard 실행
 *   Stage 5:  RESPOND              — 코드가 검증된 결정 → 사용자 메시지 렌더링
 *   Stage 6:  PERSIST+TRANSITION   — 코드가 Memo 갱신 + Phase 전이
 *
 * Zero DB. No auth. In-memory sessions.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { callLLM } from '../negotiation/adapters/xai-client.js';
import { GrokFastAdapter } from '../negotiation/adapters/grok-fast-adapter.js';
import { SkillStack, registerSkill } from '../negotiation/skills/skill-stack.js';
import { ElectronicsKnowledgeSkill } from '../negotiation/skills/electronics-knowledge.js';
import { FaratinCoachingSkill } from '../negotiation/skills/faratin-coaching.js';
import { computeBriefing } from '../negotiation/referee/briefing.js';
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
  ValidationResult,
  ActiveTerm,
} from '../negotiation/types.js';
import type { RefereeBriefing, SkillManifest } from '../negotiation/skills/skill-types.js';
import type { MergedHookResult } from '../negotiation/skills/skill-stack.js';

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

interface RespondResult {
  message: string;
  action: ProtocolDecision['action'];
  amount_minor?: number;
  amount_display?: string;
  currency: 'USD';
  locale: string;
  template: string;
  non_price_terms: Record<string, unknown>;
}

/** Tag Garden item tags — derived from title at init, immutable per session */
interface ItemTag {
  path: string;          // e.g. "electronics/phones/iphone"
  status: 'OFFICIAL' | 'EMERGING' | 'CANDIDATE';
  idf?: number;          // inverse document frequency (optional, from DB)
}

interface DemoSession {
  id: string;
  language: string;
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
  preset: string;
  activeSkills: string[];
  done: boolean;
  totalCost: number;
  totalTokens: { prompt: number; completion: number };
  initTraces: StageTrace[];
  tags: ItemTag[];
}

// ─── In-memory store ────────────────────────────────

const sessions = new Map<string, DemoSession>();
const adapter = new GrokFastAdapter();
const buddyDna = DEFAULT_BUDDY_DNA;

// ─── Preset → Skill config mapping ────
const PRESET_MAP: Record<string, { advisor: string; config: { buddyStyle: string } }> = {
  lowest_price: { advisor: 'faratin-coaching-v1', config: { buddyStyle: 'aggressive' } },
  balanced:     { advisor: 'faratin-coaching-v1', config: { buddyStyle: 'balanced' } },
  safe_first:   { advisor: 'faratin-coaching-v1', config: { buddyStyle: 'defensive' } },
};

// ─── Skill v2 registration (module-level, runs once) ────
registerSkill(new ElectronicsKnowledgeSkill());
registerSkill(new FaratinCoachingSkill({ buddyStyle: 'balanced' }));

// ─── NSV v1 (Negotiation State Vector) ──────────────
// HNP protocol standard for fixed-size negotiation state encoding.
// O(1) regardless of round count — encodes dynamics, not history.
/** Derive Tag Garden tags from item title (demo: rule-based; production: LLM L5 pipeline) */
function deriveItemTags(title: string): ItemTag[] {
  const lower = title.toLowerCase();
  const tags: ItemTag[] = [];

  // ── Phones ──
  if (/iphone/.test(lower)) {
    tags.push({ path: 'electronics/phones/iphone', status: 'OFFICIAL' });
    if (/pro\s*max/.test(lower)) tags.push({ path: 'electronics/phones/iphone/pro-max', status: 'OFFICIAL' });
    else if (/pro/.test(lower)) tags.push({ path: 'electronics/phones/iphone/pro', status: 'OFFICIAL' });
  } else if (/galaxy\s*s|galaxy\s*z|samsung/.test(lower)) {
    tags.push({ path: 'electronics/phones/samsung', status: 'OFFICIAL' });
    if (/ultra/.test(lower)) tags.push({ path: 'electronics/phones/samsung/ultra', status: 'OFFICIAL' });
    if (/fold|flip/.test(lower)) tags.push({ path: 'electronics/phones/samsung/foldable', status: 'EMERGING' });
  } else if (/pixel/.test(lower)) {
    tags.push({ path: 'electronics/phones/pixel', status: 'OFFICIAL' });
  } else if (/oneplus/.test(lower)) {
    tags.push({ path: 'electronics/phones/oneplus', status: 'EMERGING' });

  // ── Tablets ──
  } else if (/ipad/.test(lower)) {
    tags.push({ path: 'electronics/tablets/ipad', status: 'OFFICIAL' });
    if (/pro/.test(lower)) tags.push({ path: 'electronics/tablets/ipad/pro', status: 'OFFICIAL' });
    if (/air/.test(lower)) tags.push({ path: 'electronics/tablets/ipad/air', status: 'OFFICIAL' });
  } else if (/galaxy\s*tab/.test(lower)) {
    tags.push({ path: 'electronics/tablets/samsung', status: 'OFFICIAL' });

  // ── Laptops ──
  } else if (/macbook/.test(lower)) {
    tags.push({ path: 'electronics/laptops/macbook', status: 'OFFICIAL' });
    if (/pro/.test(lower)) tags.push({ path: 'electronics/laptops/macbook/pro', status: 'OFFICIAL' });
    if (/air/.test(lower)) tags.push({ path: 'electronics/laptops/macbook/air', status: 'OFFICIAL' });
  } else if (/thinkpad/.test(lower)) {
    tags.push({ path: 'electronics/laptops/thinkpad', status: 'OFFICIAL' });
  } else if (/xps|dell/.test(lower)) {
    tags.push({ path: 'electronics/laptops/dell', status: 'EMERGING' });

  // ── Wearables ──
  } else if (/apple\s*watch/.test(lower)) {
    tags.push({ path: 'electronics/wearables/apple-watch', status: 'OFFICIAL' });
    if (/ultra/.test(lower)) tags.push({ path: 'electronics/wearables/apple-watch/ultra', status: 'OFFICIAL' });
  } else if (/galaxy\s*watch/.test(lower)) {
    tags.push({ path: 'electronics/wearables/galaxy-watch', status: 'EMERGING' });
  } else if (/airpods/.test(lower)) {
    tags.push({ path: 'electronics/wearables/airpods', status: 'OFFICIAL' });
    if (/pro/.test(lower)) tags.push({ path: 'electronics/wearables/airpods/pro', status: 'OFFICIAL' });
    if (/max/.test(lower)) tags.push({ path: 'electronics/wearables/airpods/max', status: 'OFFICIAL' });

  // ── Audio ──
  } else if (/headphone|earphone|earbud|speaker|soundbar/.test(lower)) {
    tags.push({ path: 'electronics/audio', status: 'OFFICIAL' });
    if (/sony|wh-?1000|wf-?1000/.test(lower)) tags.push({ path: 'electronics/audio/sony', status: 'OFFICIAL' });
    if (/bose/.test(lower)) tags.push({ path: 'electronics/audio/bose', status: 'OFFICIAL' });

  // ── Gaming ──
  } else if (/playstation|ps5|ps4/.test(lower)) {
    tags.push({ path: 'electronics/gaming/playstation', status: 'OFFICIAL' });
  } else if (/xbox/.test(lower)) {
    tags.push({ path: 'electronics/gaming/xbox', status: 'OFFICIAL' });
  } else if (/nintendo|switch/.test(lower)) {
    tags.push({ path: 'electronics/gaming/nintendo', status: 'OFFICIAL' });
  } else if (/gpu|rtx|rx\s?\d|graphics\s*card/.test(lower)) {
    tags.push({ path: 'electronics/components/gpu', status: 'OFFICIAL' });

  // ── Cameras ──
  } else if (/camera|dslr|mirrorless/.test(lower)) {
    tags.push({ path: 'electronics/cameras', status: 'OFFICIAL' });
    if (/sony\s*a[67]|sony\s*alpha/.test(lower)) tags.push({ path: 'electronics/cameras/sony', status: 'OFFICIAL' });
    if (/canon\s*eos|canon\s*r\d/.test(lower)) tags.push({ path: 'electronics/cameras/canon', status: 'OFFICIAL' });
    if (/gopro/.test(lower)) tags.push({ path: 'electronics/cameras/gopro', status: 'OFFICIAL' });
  }

  // ── Attributes (cross-category) ──
  const storageMatch = lower.match(/(\d+)\s*(?:gb|tb)/);
  if (storageMatch) {
    const size = parseInt(storageMatch[1]!, 10);
    const unit = lower.includes('tb') ? 'tb' : 'gb';
    const effectiveGb = unit === 'tb' ? size * 1024 : size;
    if (effectiveGb >= 512) tags.push({ path: 'attributes/storage/high', status: 'OFFICIAL' });
    else if (effectiveGb >= 256) tags.push({ path: 'attributes/storage/mid', status: 'OFFICIAL' });
    else tags.push({ path: 'attributes/storage/base', status: 'OFFICIAL' });
  }

  // Fallback — still electronics, just unrecognized model
  if (tags.length === 0) {
    tags.push({ path: 'electronics/uncategorized', status: 'CANDIDATE' });
  }

  return tags;
}

function encodeSharedMemo(session: DemoSession): string {
  const m = session.memory;
  const b = m.boundaries;

  const lines = [
    '--- NSV v2 SHARED ---',
    `NS:${m.session.phase}|R${m.session.round}/${m.session.max_rounds}|buyer`,
    `PT:${b.current_offer}⇄${b.opponent_offer}|gap:${b.gap}`,
  ];

  // TG: Tag Garden extension — item classification (fixed per session)
  if (session.tags.length > 0) {
    const tagStr = session.tags
      .filter(t => t.status === 'OFFICIAL' || t.status === 'EMERGING')
      .slice(0, 3)  // max 3 tags for token efficiency
      .map(t => `${t.path}(${t.status[0]})`)  // O=OFFICIAL, E=EMERGING
      .join(',');
    lines.push(`TG:${tagStr}`);
  }

  return lines.join('\n');
}

function encodePrivateMemo(session: DemoSession): string {
  const m = session.memory;
  const b = m.boundaries;

  // Room: how much of my range I've used (0%=at target, 100%=at floor)
  const range = Math.abs(b.my_floor - b.my_target);
  const used = Math.abs(b.current_offer - b.my_target);
  const roomPct = range > 0 ? ((used / range) * 100).toFixed(0) : '0';

  const lines = [
    '--- NSV v2 PRIVATE ---',
    `SS:t:${b.my_target}|f:${b.my_floor}|room:${roomPct}%`,
  ];
  if (session.opponentPattern) {
    const op = session.opponentPattern;
    const label = op.aggression > 0.7 ? 'BOULWARE' : op.aggression < 0.3 ? 'CONCEDER' : 'LINEAR';
    lines.push(`OM:${label}|agg:${op.aggression.toFixed(2)}|cr:${op.concession_rate.toFixed(3)}`);
  }
  return lines.join('\n');
}

// ─── Prompts ────────────────────────────────────────

const NSV_LEGEND = `=== NSV v2 (Negotiation State Vector) ===
Shared: NS=State PT=Position(gap) TG=TagGarden(item tags)
Private: SS=Strategy(target,floor,room%) OM=OpponentModel(type,aggression,concession_rate)
Prices in minor units. $700=70000. O=OFFICIAL E=EMERGING`;

function buildUnderstandPrompt(sellerMessage: string): { system: string; user: string } {
  return {
    system: `You are Haggle protocol Stage 1 (UNDERSTAND). Parse seller message into structured intent.
Respond with valid JSON only:
{"price_offer":number(minor units,e.g.$700=70000),"conditions_proposed":[{"term":string,"value":any}],"conditions_claimed":[{"term":string,"value":any,"verified":false}],"sentiment":"cooperative"|"firm"|"aggressive"|"passive","tactic_detected":string,"message_type":"offer"|"counter"|"conditional_offer"|"rejection"|"acceptance"|"question"}`,
    user: `Seller message: "${sellerMessage}"`,
  };
}

function buildDecidePrompt(
  session: DemoSession,
  briefing: RefereeBriefing,
  skillResult: MergedHookResult,
  understood: UnderstandResult,
): { system: string; user: string } {
  const decide = skillResult.decide;
  const categoryBrief = decide?.categoryBrief ?? '';
  const tactics = decide?.tactics?.join(', ') ?? '';
  const valuationRules = decide?.valuationRules?.map(r => `- ${r}`).join('\n') ?? '';

  return {
    system: `You are Haggle protocol Stage 3 (DECIDE) — buyer side.
${NSV_LEGEND}

## Category Knowledge
${categoryBrief}
Tactics: ${tactics}
Valuation Rules:
${valuationRules}

## Rules
1. NEVER exceed floor price (max willingness to pay)
2. Phase-valid actions: OPENING→COUNTER | BARGAINING→COUNTER,ACCEPT,REJECT,HOLD | CLOSING→CONFIRM,HOLD
3. reasoning: internal only, never shown to counterparty

Respond with valid JSON only:
{"action":"COUNTER"|"ACCEPT"|"REJECT"|"HOLD"|"DISCOVER"|"CONFIRM","price":number(minor units),"reasoning":string,"tactic_used":string,"non_price_terms":{},"phase_assessment":"OPENING"|"BARGAINING"|"CLOSING","near_deal":boolean}`,
    user: `## NSV (Negotiation State Vector)
${encodeSharedMemo(session)}
${encodePrivateMemo(session)}

## Briefing (Facts)
opponent:${briefing.opponentPattern} time_pressure:${(briefing.timePressure * 100).toFixed(0)}%
utility:u_total=${briefing.utilitySnapshot.u_total} u_price=${briefing.utilitySnapshot.u_price}
stagnation:${briefing.stagnation} gap_trend:[${briefing.gapTrend.join(',')}]
${briefing.warnings.length > 0 ? 'warnings:' + briefing.warnings.join(';') : ''}

## Advisories (May ignore)
${(decide?.advisories ?? []).map(a =>
  `[${a.skillId}] rec_price:${a.recommendedPrice ?? '-'} tactic:${a.suggestedTactic ?? '-'}${a.acceptableRange ? ` range:${a.acceptableRange.min}-${a.acceptableRange.max}` : ''}${a.observations?.length ? ' obs:' + a.observations.join(';') : ''}`
).join('\n') || 'none'}

## Seller Action (UNDERSTAND)
price:$${understood.price_offer}(${understood.message_type}) sentiment:${understood.sentiment} tactic:${understood.tactic_detected}
${understood.conditions_proposed.length > 0 ? 'conditions:' + JSON.stringify(understood.conditions_proposed) : ''}`,
  };
}

function buildRespondPrompt(decision: ProtocolDecision, phase: NegotiationPhase, recentFacts: RoundFact[], language: string): { system: string; user: string } {
  const langInstruction = language === 'en'
    ? 'Write in natural English.'
    : `Write in ${language}. The message MUST be in ${language}.`;
  return {
    system: `You are Haggle protocol Stage 5 (RESPOND) — buyer side.
Generate a natural, human-like buyer message. Style: polite, professional, no emoji, 1-2 sentences.
Never reveal strategy or floor price.
${langInstruction}
Respond with valid JSON only: {"message":string}`,
    user: `Decision: ${JSON.stringify(decision)}
Phase: ${phase}
${recentFacts.length > 0 ? 'Last exchange: seller offered $' + recentFacts[recentFacts.length - 1]!.seller_offer : ''}`,
  };
}

function formatMoneyMinor(amountMinor: number | undefined): string {
  if (amountMinor === undefined || amountMinor === null) return '';
  const amount = amountMinor > 1000 ? amountMinor / 100 : amountMinor;
  return Number.isInteger(amount) ? `$${amount.toFixed(0)}` : `$${amount.toFixed(2)}`;
}

function hasTerms(terms: Record<string, unknown> | undefined): boolean {
  return Boolean(terms && Object.keys(terms).length > 0);
}

const TERM_LABELS_EN: Record<string, string> = {
  payment_protection: 'payment protection',
  shipping_protection: 'shipping protection',
  payment_method: 'payment method',
  shipping: 'shipping',
  quick_process: 'quick processing',
  confirm_conditions: 'final condition check',
  condition: 'deal condition',
  speed: 'quick processing',
  'move quickly': 'quick processing',
};

function humanizeTermKey(key: string): string {
  return TERM_LABELS_EN[key] ?? key.replace(/_/g, ' ');
}

function humanizeTermValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? '' : 'excluded';
  if (typeof value === 'string') return humanizeTermKey(value);
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(item => humanizeTermValue(item)).filter(Boolean).join(', ');
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => {
        const renderedValue = humanizeTermValue(item);
        return renderedValue ? `${humanizeTermKey(key)} ${renderedValue}` : humanizeTermKey(key);
      })
      .join(', ');
  }
  return '';
}

function formatTerms(terms: Record<string, unknown> | undefined, locale: string): string {
  if (!hasTerms(terms)) return '';

  const rendered = Object.entries(terms!)
    .map(([key, value]) => {
      const label = humanizeTermKey(key);
      const renderedValue = humanizeTermValue(value);
      if (key === 'speed' && renderedValue === 'quick processing') return renderedValue;
      if (typeof value === 'boolean') return value ? label : `${label} ${renderedValue}`;
      if (!renderedValue || renderedValue === label) return label;
      return `${label} ${renderedValue}`;
    })
    .filter(Boolean)
    .join(', ');

  if (!rendered) return '';
  return ` Additional terms: ${rendered}.`;
}

function renderStructuredResponse(
  decision: ProtocolDecision,
  language: string,
): RespondResult {
  const locale = language || 'en';
  const amount = formatMoneyMinor(decision.price);
  const terms = decision.non_price_terms ?? {};
  let message: string;
  let template: string;

  if (locale === 'ko') {
    switch (decision.action) {
      case 'ACCEPT':
        template = 'ko.accept';
        message = `${amount}에 합의하겠습니다. 계약 진행 부탁드립니다.`;
        break;
      case 'COUNTER':
        template = 'ko.counter';
        message = `${amount}으로 제안드립니다. 이 조건이면 서로 진행하기 좋겠습니다.`;
        break;
      case 'CONFIRM':
        template = 'ko.confirm';
        message = `${amount} 조건으로 최종 확인하겠습니다. 결제와 배송 보호를 진행해 주세요.`;
        break;
      case 'REJECT':
        template = 'ko.reject';
        message = '이번 조건으로는 진행하기 어렵겠습니다. 제안 감사합니다.';
        break;
      case 'HOLD':
        template = 'ko.hold';
        message = '조건을 조금 더 확인한 뒤 답변드리겠습니다.';
        break;
      case 'DISCOVER':
        template = 'ko.discover';
        message = '진행 전에 상태, 배송, 보호 조건을 조금 더 확인하고 싶습니다.';
        break;
      default:
        template = 'ko.default';
        message = amount ? `${amount} 조건으로 진행을 검토하겠습니다.` : '조건을 확인하겠습니다.';
    }
  } else {
    switch (decision.action) {
      case 'ACCEPT':
        template = 'en.accept';
        message = `I agree at ${amount}. Please proceed with the transaction.`;
        break;
      case 'COUNTER':
        template = 'en.counter';
        message = `I can offer ${amount}. That should be a fair path forward for both sides.`;
        break;
      case 'CONFIRM':
        template = 'en.confirm';
        message = `I confirm the deal at ${amount}. Please proceed with payment and shipping protection.`;
        break;
      case 'REJECT':
        template = 'en.reject';
        message = 'I cannot move forward on these terms. Thank you for the offer.';
        break;
      case 'HOLD':
        template = 'en.hold';
        message = 'I need to review the details before moving forward.';
        break;
      case 'DISCOVER':
        template = 'en.discover';
        message = 'Before moving forward, I would like to confirm the condition, shipping, and protection terms.';
        break;
      default:
        template = 'en.default';
        message = amount ? `I will review the offer at ${amount}.` : 'I will review the offer.';
    }
  }

  message += formatTerms(terms, locale);

  return {
    message,
    action: decision.action,
    amount_minor: decision.price,
    amount_display: amount || undefined,
    currency: 'USD',
    locale,
    template,
    non_price_terms: terms,
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
  language: z.string().default('en'),
  preset: z.enum(['lowest_price', 'balanced', 'safe_first', 'custom']).default('balanced'),
  custom_skills: z.object({
    advisor: z.string(),
    advisor_config: z.record(z.unknown()).optional(),
  }).optional(),
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
    skill_summary: '',  // populated by SkillStack at runtime
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

    const { item, seller, buyer_budget, language, preset, custom_skills } = parsed.data;
    const traces: StageTrace[] = [];

    // ── Stage 0a: Strategy Generation (LLM) ──
    const strategyTrace = await traceLLMCall<DemoStrategy>(
      '0a_STRATEGY_GENERATION',
      `You are Haggle protocol buying strategy advisor. Analyze item info and market data to generate a purchase strategy.
Respond with valid JSON only:
{
  "target_price": number (minor units/cents, e.g. $750=75000),
  "floor_price": number (minor units — buyer's absolute max),
  "opening_tactic": "anchoring"|"reciprocal_concession"|"bundling",
  "approach": string (1 sentence),
  "key_concerns": [string],
  "negotiation_style": "aggressive"|"balanced"|"defensive"
}`,
      `Item: ${item.title}
Condition: ${item.condition}
Market: Swappa 30d median $${item.swappa_median}
Seller ask: $${seller.ask_price}
My max budget: $${buyer_budget.max_budget}`,
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
      `You are Haggle protocol term analyst. Analyze strategy and available terms to determine important conditions for this deal.
Respond with valid JSON only:
{"priority_terms":[{"id":string,"importance":"critical"|"important"|"nice_to_have","target_value":string,"rationale":string}],"deal_breakers":[{"id":string,"condition":string,"rationale":string}]}`,
      `Strategy: target=$${(strategy.target_price / 100).toFixed(0)}, max=$${(strategy.floor_price / 100).toFixed(0)}, style=${strategy.negotiation_style}
Available terms:
${termsForPrompt}
Item condition: ${item.condition}`,
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

    // Session-level skill stack based on preset
    const advisorConfig = preset === 'custom' && custom_skills
      ? { advisor: custom_skills.advisor, config: custom_skills.advisor_config ?? {} }
      : PRESET_MAP[preset] ?? PRESET_MAP.balanced;

    const sessionBuddyStyle = ((advisorConfig.config as Record<string, unknown>).buddyStyle ?? 'balanced') as 'aggressive' | 'balanced' | 'defensive';
    const sessionSkillStack = SkillStack.of(
      new ElectronicsKnowledgeSkill(),
      new FaratinCoachingSkill({ buddyStyle: sessionBuddyStyle }),
    );

    const session: DemoSession = {
      id,
      language,
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
      preset,
      activeSkills: sessionSkillStack.getManifests().map(m => m.id),
      done: false,
      totalCost: 0,
      totalTokens: { prompt: 0, completion: 0 },
      initTraces: traces,
      tags: deriveItemTags(item.title),
    };

    // Accumulate init costs
    for (const t of traces) {
      if (t.tokens) {
        session.totalTokens.prompt += t.tokens.prompt;
        session.totalTokens.completion += t.tokens.completion;
        // Grok 4 Fast pricing: $0.20/1M input, $0.50/1M output
        session.totalCost += (t.tokens.prompt * 0.0000002) + (t.tokens.completion * 0.0000005);
      }
    }

    sessions.set(id, session);

    return reply.send({
      demo_id: id,
      language,
      preset,
      active_skills: session.activeSkills,
      stages_tested: [
        '0a_STRATEGY_GENERATION — LLM: item+market→buying strategy JSON',
        '0b_TERM_ANALYSIS — LLM: strategy+terms→priority JSON',
      ],
      strategy,
      terms,
      tags: session.tags,
      skills: sessionSkillStack.getManifests(),
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
    const sellerText = seller_message ?? `I can do $${seller_price}. What do you think?`;
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

    // Briefing: facts only (replaces old coaching in LLM prompt)
    const briefing = computeBriefing(
      session.memory,
      session.facts,
      session.opponentPattern,
    );

    // Coaching: still needed for validateMove (internal, not shown to LLM)
    const coaching = computeCoaching(
      session.memory,
      session.facts,
      session.opponentPattern,
      buddyDna,
    );
    session.memory.coaching = coaching;

    // Skill v2: reconstruct session-level SkillStack from preset
    const roundAdvisorConfig = session.preset === 'custom'
      ? PRESET_MAP.balanced
      : PRESET_MAP[session.preset] ?? PRESET_MAP.balanced;
    const roundBuddyStyle = ((roundAdvisorConfig.config as Record<string, unknown>).buddyStyle ?? 'balanced') as 'aggressive' | 'balanced' | 'defensive';
    const skillStack = SkillStack.of(
      new ElectronicsKnowledgeSkill(),
      new FaratinCoachingSkill({ buddyStyle: roundBuddyStyle }),
    );
    const skillDecideResult = await skillStack.dispatchHook({
      stage: 'decide',
      memory: session.memory,
      recentFacts: session.facts,
      opponentPattern: session.opponentPattern,
      phase: session.phase,
    });

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
        nsv_shared: sharedMemo,
        nsv_private: privateMemo,
        briefing,
        advisories: skillDecideResult.decide?.advisories ?? [],
        skills_dispatched: Object.keys(skillDecideResult.bySkill),
        tags: session.tags,
      },
      parsed: {
        nsv_shared: sharedMemo,
        nsv_private: privateMemo,
        briefing,
        advisories: skillDecideResult.decide?.advisories ?? [],
      },
      latency_ms: Date.now() - ctxStart,
      is_llm: false,
    };
    stages.push(contextTrace);

    // ────────────────────────────────────────────────
    // Stage 3: DECIDE (LLM)
    // Test: LLM이 전체 컨텍스트 → ProtocolDecision JSON을 올바르게 생성하는가?
    //       모든 Phase에서 적절한 action을 선택하는가?
    // ────────────────────────────────────────────────
    const decidePrompts = buildDecidePrompt(session, briefing, skillDecideResult, understood);

    // Reasoning mode trigger (Doc 26: code decides, not LLM)
    const gapRatio = session.memory.boundaries.my_floor > 0
      ? session.memory.boundaries.gap / Math.abs(session.memory.boundaries.my_floor - session.memory.boundaries.my_target)
      : 1;
    const useReasoning = gapRatio < 0.10 || briefing.warnings.length >= 2;

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

    // Skill v2: dispatch validate hooks → additional hard/soft rules
    const skillValidateResult = await skillStack.dispatchHook({
      stage: 'validate',
      memory: session.memory,
      recentFacts: session.facts,
      opponentPattern: session.opponentPattern,
      phase: session.phase,
    });

    let validation: ValidationResult = validateMove(
      decision,
      session.memory,
      coaching,
      session.previousMoves,
      session.phase,
    );

    // Merge skill validation rules into result
    if (skillValidateResult.validate) {
      for (const rule of skillValidateResult.validate.hardRules) {
        validation.violations.push({
          rule: `[skill:${rule.skillId}] ${rule.rule}`,
          severity: 'HARD',
          guidance: rule.description,
        });
      }
      for (const rule of skillValidateResult.validate.softRules) {
        validation.violations.push({
          rule: `[skill:${rule.skillId}] ${rule.rule}`,
          severity: 'SOFT',
          guidance: rule.description,
        });
      }
    }

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
      input: {
        original_decision: originalDecision,
        memory_boundaries: session.memory.boundaries,
        skill_rules: skillValidateResult.validate ?? null,
      },
      output: { validation, auto_fix_applied: autoFixApplied, final_decision: decision },
      parsed: validation,
      latency_ms: Date.now() - valStart,
      is_llm: false,
    };
    stages.push(validateTrace);

    // ────────────────────────────────────────────────
    // Stage 5: RESPOND (structured renderer)
    // User-facing text must be rendered from validated ProtocolDecision.
    // LLM decides action/price/terms; code owns formatting, currency, and final message.
    // ────────────────────────────────────────────────
    const respondStart = Date.now();
    const respondResult = renderStructuredResponse(decision, session.language);
    const respondTrace: StageTrace<RespondResult> = {
      stage: '5_RESPOND',
      input: {
        final_decision: decision,
        locale: session.language,
        render_contract: {
          price_source: 'ProtocolDecision.price',
          currency: 'USD',
          unit: 'minor',
          llm_free_text: false,
        },
      },
      output: respondResult,
      parsed: respondResult,
      latency_ms: Date.now() - respondStart,
      is_llm: false,
    };
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
      coaching_given: {
        recommended: skillDecideResult.decide?.advisories?.[0]?.recommendedPrice ?? 0,
        tactic: skillDecideResult.decide?.advisories?.[0]?.suggestedTactic ?? '',
      },
      coaching_followed: decision.price !== undefined &&
        skillDecideResult.decide?.advisories?.[0]?.recommendedPrice !== undefined &&
        Math.abs(decision.price - skillDecideResult.decide.advisories[0].recommendedPrice) < skillDecideResult.decide.advisories[0].recommendedPrice * 0.05,
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
    if (decision.action === 'ACCEPT' || session.phase === 'SETTLEMENT') {
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
        '2_CONTEXT — 코드가 Briefing+SkillStack 조립',
        '3_DECIDE — LLM이 전체 컨텍스트→ProtocolDecision',
        '4_VALIDATE — 코드(Referee)+Skill 규칙 검증',
        '5_RESPOND — 코드가 결정→구조화된 사용자 메시지 렌더링',
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
