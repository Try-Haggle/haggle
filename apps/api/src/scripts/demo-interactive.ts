/**
 * Haggle Interactive Demo — 프로토콜 파이프라인 시각화
 *
 * 사용자가 구매자로 직접 협상하고, 매 라운드마다
 * 메시지가 프로토콜로 어떻게 변환되는지 볼 수 있습니다.
 *
 * Usage:
 *   XAI_API_KEY=xai-xxx npx tsx apps/api/src/scripts/demo-interactive.ts
 *   → http://localhost:3099
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

// ─── Config ──────────────────────────────────────────────────

const PORT = 3099;
const XAI_API_BASE = 'https://api.x.ai/v1';
const MODEL = process.env.XAI_MODEL ?? 'grok-4-fast';
const PRICE_INPUT_PER_M = 0.20;
const PRICE_OUTPUT_PER_M = 0.50;

const ITEM = 'iPhone 15 Pro 256GB Space Black (미개봉)';
const MARKET_PRICE = 1_050;
const MAX_ROUNDS = 10;

// ─── Types ───────────────────────────────────────────────────

type NegotiationPhase = 'DISCOVERY' | 'OPENING' | 'BARGAINING' | 'CLOSING' | 'SETTLEMENT';

interface CoreMemory {
  session: {
    phase: NegotiationPhase;
    round: number;
    max_rounds: number;
    role: string;
    intervention_mode: string;
  };
  boundaries: {
    my_target: number;
    my_floor: number;
    current_offer: number;
    opponent_offer: number;
    gap: number;
  };
  coaching: {
    recommended_price: number;
    suggested_tactic: string;
    opponent_pattern: string;
    convergence_rate: number;
    time_pressure: number;
    utility: { u_price: number; u_time: number; u_total: number };
    warnings: string[];
  };
}

interface RoundFact {
  round: number;
  buyer_offer: number;
  seller_offer: number;
  gap: number;
  buyer_tactic?: string;
  seller_tactic?: string;
}

interface ProtocolDecision {
  action: string;
  price?: number;
  reasoning: string;
  tactic_used?: string;
  non_price_terms?: Record<string, unknown>;
  message?: string;
}

interface PipelineStep {
  id: string;
  label: string;
  icon: string;
  data: unknown;
  encoded?: string;
  duration_ms?: number;
}

interface RoundResponse {
  round: number;
  seller_decision: ProtocolDecision;
  seller_message: string;
  pipeline: PipelineStep[];
  memory: CoreMemory;
  deal: boolean;
  tokens?: { input: number; output: number };
  cost_usd?: number;
  phase: NegotiationPhase;
}

// ─── Session State ───────────────────────────────────────────

interface SessionState {
  round: number;
  phase: NegotiationPhase;
  seller_target: number;
  seller_floor: number;
  buyer_target: number;
  buyer_floor: number;
  history: RoundFact[];
  last_seller_offer: number;
  last_buyer_offer: number;
  opponent_pattern: string;
  convergence_rate: number;
  deal: boolean;
}

let session: SessionState = {
  round: 0,
  phase: 'OPENING',
  seller_target: 1_120,
  seller_floor: 920,
  buyer_target: 880,
  buyer_floor: 1_000,
  history: [],
  last_seller_offer: 1_120,
  last_buyer_offer: 0,
  opponent_pattern: 'UNKNOWN',
  convergence_rate: 0,
  deal: false,
};

function resetSession(): void {
  session = {
    round: 0,
    phase: 'OPENING',
    seller_target: 1_120,
    seller_floor: 920,
    buyer_target: 880,
    buyer_floor: 1_000,
    history: [],
    last_seller_offer: 1_120,
    last_buyer_offer: 0,
    opponent_pattern: 'UNKNOWN',
    convergence_rate: 0,
    deal: false,
  };
}

// ─── Pipeline Functions ──────────────────────────────────────

function reconstructMemory(buyerPrice: number): CoreMemory {
  const s = session;
  const gap = Math.abs(s.last_seller_offer - buyerPrice);
  const range = s.seller_target - s.seller_floor;
  const timePressure = s.round / MAX_ROUNDS;

  // Opponent pattern detection (EMA-based)
  if (s.history.length >= 2) {
    const recent = s.history.slice(-3);
    const concessions = recent.map((h, i) => {
      if (i === 0) return 0;
      return (recent[i - 1]!.buyer_offer - h.buyer_offer) / range;
    }).filter((_, i) => i > 0);
    const avgConcession = concessions.reduce((a, b) => a + b, 0) / concessions.length;
    if (avgConcession > 0.05) s.opponent_pattern = 'CONCEDER';
    else if (avgConcession < 0.005) s.opponent_pattern = 'BOULWARE';
    else s.opponent_pattern = 'LINEAR';
  }

  // Convergence rate
  if (s.history.length >= 2) {
    const prev = s.history[s.history.length - 2]!;
    const curr = s.history[s.history.length - 1]!;
    s.convergence_rate = curr.gap > 0 ? (prev.gap - curr.gap) / prev.gap : 0;
  }

  // Coaching: Faratin curve for recommended price
  const t = s.round / MAX_ROUNDS;
  const beta = s.opponent_pattern === 'BOULWARE' ? 2.0 : s.opponent_pattern === 'CONCEDER' ? 1.5 : 1.0;
  const faratin = s.seller_target + (s.seller_floor - s.seller_target) * Math.pow(t, 1 / beta);
  const recommended = Math.round(Math.max(s.seller_floor, Math.min(s.seller_target, faratin)));

  // Utility
  const u_price = 1 - Math.abs(buyerPrice - s.seller_target) / range;
  const u_time = 1 - timePressure;
  const u_total = u_price * 0.55 + u_time * 0.25 + 0.20; // simplified

  const warnings: string[] = [];
  if (timePressure > 0.7) warnings.push('⏰ 라운드 부족 — 마감 압박');
  if (gap / range < 0.10) warnings.push('🤏 갭 10% 미만 — NEAR_DEAL 영역');
  if (s.convergence_rate < 0.01 && s.history.length >= 3) warnings.push('🔄 정체 감지 — 전략 전환 필요');

  return {
    session: {
      phase: s.phase,
      round: s.round,
      max_rounds: MAX_ROUNDS,
      role: 'seller',
      intervention_mode: 'FULL_AUTO',
    },
    boundaries: {
      my_target: s.seller_target,
      my_floor: s.seller_floor,
      current_offer: s.last_seller_offer,
      opponent_offer: buyerPrice,
      gap,
    },
    coaching: {
      recommended_price: recommended,
      suggested_tactic: gap / range < 0.10 ? 'near_deal_acceptance'
        : timePressure > 0.7 ? 'time_pressure_close'
        : s.opponent_pattern === 'BOULWARE' ? 'nibble'
        : 'reciprocal_concession',
      opponent_pattern: s.opponent_pattern,
      convergence_rate: s.convergence_rate,
      time_pressure: timePressure,
      utility: { u_price: Math.max(0, u_price), u_time, u_total: Math.max(0, u_total) },
      warnings,
    },
  };
}

function encodeCompact(mem: CoreMemory): string {
  const s = mem.session;
  const b = mem.boundaries;
  const c = mem.coaching;
  return [
    `S:${s.phase}|R${s.round}/${s.max_rounds}|${s.role}|${s.intervention_mode}`,
    `B:t${b.my_target}/f${b.my_floor}/c${b.current_offer}/o${b.opponent_offer}/g${b.gap}`,
    `C:rec${c.recommended_price}|${c.suggested_tactic}|opp:${c.opponent_pattern}|conv:${c.convergence_rate.toFixed(2)}|tp:${c.time_pressure.toFixed(2)}`,
  ].join('\n');
}

function encodeHistory(facts: RoundFact[]): string {
  if (facts.length === 0) return '';
  return 'HIST:' + facts.map(f =>
    `R${f.round}:${f.buyer_offer}/${f.seller_offer}|g${f.gap}${f.buyer_tactic ? '|t:' + f.buyer_tactic : ''}`,
  ).join(';');
}

function skillEvaluate(mem: CoreMemory, buyerPrice: number): ProtocolDecision {
  const { boundaries: b, coaching: c } = mem;

  // Auto-accept: buyer offering above target
  if (buyerPrice >= session.seller_target) {
    return { action: 'ACCEPT', price: buyerPrice, reasoning: `Buyer offer $${buyerPrice} >= target $${session.seller_target}. Auto-accept.`, tactic_used: 'auto_accept' };
  }

  // Auto-reject: below floor
  if (buyerPrice < session.seller_floor * 0.9) {
    return { action: 'REJECT', reasoning: `Buyer offer $${buyerPrice} is 10%+ below floor $${session.seller_floor}. Unacceptable.`, tactic_used: 'floor_protection' };
  }

  // Near-deal: gap < 5% of range
  const range = session.seller_target - session.seller_floor;
  const gapRatio = b.gap / range;
  if (gapRatio < 0.05 && buyerPrice >= session.seller_floor) {
    return { action: 'ACCEPT', price: buyerPrice, reasoning: `Gap $${b.gap} is < 5% of range. Near-deal acceptance.`, tactic_used: 'near_deal_acceptance' };
  }

  // Counter with Faratin curve
  return {
    action: 'COUNTER',
    price: c.recommended_price,
    reasoning: `Faratin curve at t=${c.time_pressure.toFixed(2)}, opponent=${c.opponent_pattern}. Counter at $${c.recommended_price}.`,
    tactic_used: c.suggested_tactic,
  };
}

function validateDecision(decision: ProtocolDecision, mem: CoreMemory): Array<{ rule: string; severity: string; passed: boolean; detail: string }> {
  const results: Array<{ rule: string; severity: string; passed: boolean; detail: string }> = [];

  // V1: Price within bounds
  if (decision.price) {
    const withinBounds = decision.price >= session.seller_floor;
    results.push({
      rule: 'V1: Floor Protection',
      severity: 'HARD',
      passed: withinBounds,
      detail: withinBounds
        ? `$${decision.price} >= floor $${session.seller_floor}`
        : `$${decision.price} < floor $${session.seller_floor} — VIOLATION`,
    });
  }

  // V2: Action allowed in phase
  const phaseActions: Record<string, string[]> = {
    OPENING: ['COUNTER', 'REJECT'],
    BARGAINING: ['COUNTER', 'ACCEPT', 'REJECT'],
    CLOSING: ['ACCEPT', 'CONFIRM', 'COUNTER'],
  };
  const allowed = phaseActions[session.phase] ?? ['COUNTER'];
  results.push({
    rule: 'V2: Phase Action',
    severity: 'HARD',
    passed: allowed.includes(decision.action),
    detail: `${decision.action} ${allowed.includes(decision.action) ? 'allowed' : 'NOT allowed'} in ${session.phase}`,
  });

  // V3: Rounds remaining
  const hasRounds = session.round < MAX_ROUNDS;
  results.push({
    rule: 'V3: Rounds Available',
    severity: 'HARD',
    passed: hasRounds,
    detail: `Round ${session.round}/${MAX_ROUNDS} — ${hasRounds ? 'OK' : 'Last round!'}`,
  });

  // V4: Concession direction (SOFT)
  if (decision.action === 'COUNTER' && decision.price && session.history.length > 0) {
    const lastSeller = session.last_seller_offer;
    const conceding = decision.price < lastSeller;
    results.push({
      rule: 'V4: Concession Direction',
      severity: 'SOFT',
      passed: conceding,
      detail: conceding
        ? `$${decision.price} < previous $${lastSeller} — conceding`
        : `$${decision.price} >= previous $${lastSeller} — NOT conceding (reversal)`,
    });
  }

  return results;
}

function renderMessage(decision: ProtocolDecision, phase: NegotiationPhase): string {
  // BuddyTone: seller = professional Korean
  if (decision.action === 'ACCEPT') {
    return `좋습니다, $${decision.price}에 거래하겠습니다! 미개봉 제품이라 만족하실 거예요.`;
  }
  if (decision.action === 'REJECT') {
    return `죄송하지만 그 가격은 어렵습니다. 좀 더 높은 가격으로 제안해주시면 감사하겠습니다.`;
  }

  // COUNTER
  const price = decision.price ?? session.seller_target;
  const tactic = decision.tactic_used ?? 'reciprocal_concession';

  const templates: Record<string, string> = {
    reciprocal_concession: `조금 양보해서 $${price}은 어떠세요? 미개봉 프리미엄 상태 고려하면 합리적인 가격이라고 생각합니다.`,
    near_deal_acceptance: `거의 다 맞춰진 것 같아요! $${price}이면 바로 진행할 수 있습니다.`,
    time_pressure_close: `마감이 가까워지고 있어요. $${price}에 정리하면 어떨까요?`,
    nibble: `$${price}까지 내려올 수 있습니다. 이 가격이면 상태 좋은 미개봉 제품치고 좋은 딜이에요.`,
    anchoring: `미개봉 정품 $${price}입니다. Swappa 시세보다 상태가 좋으니 프리미엄을 고려해주세요.`,
  };

  return templates[tactic] ?? `$${price}에 제안드립니다.`;
}

// ─── LLM Call (Optional Enhancement) ─────────────────────────

async function callLLMIfNeeded(
  mem: CoreMemory,
  skillDecision: ProtocolDecision,
  buyerPrice: number,
  buyerMessage: string,
): Promise<{ decision: ProtocolDecision; llmUsed: boolean; systemPrompt?: string; userPrompt?: string; rawResponse?: string; tokens?: { input: number; output: number }; latency_ms?: number }> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    // No API key → use rule-based only
    return { decision: skillDecision, llmUsed: false };
  }

  // Build prompts — LLM generates seller response for ALL rounds
  const skillContext = [
    `You are a real human seller named Bob, selling: ${ITEM}`,
    `Market price: $${MARKET_PRICE}. Your target: $${session.seller_target}, floor: $${session.seller_floor}.`,
    `Category: Electronics — iPhone Pro. Reference: Swappa 30d median.`,
    `Key factors: sealed/unopened condition, full warranty, storage size.`,
    ``,
    `IMPORTANT RULES:`,
    `- The engine recommends action="${skillDecision.action}" price=$${skillDecision.price ?? '—'} tactic="${skillDecision.tactic_used ?? ''}"`,
    `- You MUST follow the recommended action and stay within $20 of the recommended price`,
    `- If action is ACCEPT, set price to the buyer's offer ($${buyerPrice})`,
    `- Write a natural Korean message as "message" field — be conversational, friendly but firm`,
    `- Reference the item condition, market price, or deal quality naturally`,
    `- Keep message under 80 characters`,
  ].join('\n');

  const systemPrompt = [
    skillContext,
    '',
    'Respond ONLY with valid JSON matching this schema:',
    '{"action":"COUNTER|ACCEPT|REJECT","price":number,"reasoning":"string","tactic_used":"string","message":"string"}',
    'Do NOT include markdown, code blocks, or any text outside the JSON.',
  ].join('\n');

  const compactMemo = encodeCompact(mem);
  const historyEnc = encodeHistory(session.history.slice(-5));
  const userPrompt = [
    compactMemo,
    historyEnc,
    `BUYER_MSG:"${buyerMessage}"`,
    `BUYER_OFFER:$${buyerPrice}`,
  ].filter(Boolean).join('\n');

  try {
    const start = Date.now();
    const resp = await fetch(`${XAI_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.4,
        max_tokens: 300,
      }),
    });

    if (!resp.ok) return { decision: skillDecision, llmUsed: false };

    const data = await resp.json() as {
      choices: Array<{ message: { content: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const raw = data.choices?.[0]?.message?.content ?? '';
    const parsed = JSON.parse(raw) as ProtocolDecision;
    const latency = Date.now() - start;

    // Use LLM decision — validate price is within seller bounds
    const llmPrice = parsed.price ? Math.round(parsed.price) : skillDecision.price;
    const finalPrice = (llmPrice && llmPrice >= session.seller_floor && llmPrice <= session.seller_target)
      ? llmPrice : skillDecision.price;

    return {
      decision: { ...parsed, price: finalPrice, message: parsed.message },
      llmUsed: true,
      systemPrompt,
      userPrompt,
      rawResponse: raw,
      tokens: { input: data.usage?.prompt_tokens ?? 0, output: data.usage?.completion_tokens ?? 0 },
      latency_ms: latency,
    };
  } catch (err) {
    console.error('LLM call failed:', err);
    return { decision: skillDecision, llmUsed: false };
  }
}

// ─── Round Handler ───────────────────────────────────────────

async function handleRound(buyerPrice: number, buyerMessage: string): Promise<RoundResponse> {
  session.round++;
  session.last_buyer_offer = buyerPrice;
  const pipeline: PipelineStep[] = [];

  // Phase transition
  if (session.round === 1) session.phase = 'OPENING';
  else if (session.round >= 2) session.phase = 'BARGAINING';

  const range = session.seller_target - session.seller_floor;
  const gap = Math.abs(session.last_seller_offer - buyerPrice);
  if (gap / range < 0.10 && session.round >= 3) session.phase = 'CLOSING';

  // Step 1: Raw Input
  pipeline.push({
    id: 'raw_input',
    label: '📥 Raw Input (사용자 입력)',
    icon: '📥',
    data: { price: buyerPrice, message: buyerMessage, round: session.round },
  });

  // Step 2: Memory Reconstruction
  const t0 = Date.now();
  const memory = reconstructMemory(buyerPrice);
  pipeline.push({
    id: 'memory',
    label: '🧠 CoreMemory 재구성',
    icon: '🧠',
    data: memory,
    encoded: encodeCompact(memory),
    duration_ms: Date.now() - t0,
  });

  // Step 3: History Encoding
  const historyEnc = encodeHistory(session.history);
  pipeline.push({
    id: 'history',
    label: '📜 History (압축 인코딩)',
    icon: '📜',
    data: session.history,
    encoded: historyEnc || '(첫 라운드 — 히스토리 없음)',
  });

  // Step 4: Coaching
  pipeline.push({
    id: 'coaching',
    label: '📊 Referee Coaching',
    icon: '📊',
    data: memory.coaching,
  });

  // Step 5: Skill Evaluation (Hot Path)
  const t1 = Date.now();
  const skillDecision = skillEvaluate(memory, buyerPrice);
  pipeline.push({
    id: 'skill',
    label: '⚡ Skill 평가 (규칙 기반)',
    icon: '⚡',
    data: skillDecision,
    duration_ms: Date.now() - t1,
  });

  // Step 6: LLM Augmentation (if BARGAINING + COUNTER)
  const llmResult = await callLLMIfNeeded(memory, skillDecision, buyerPrice, buyerMessage);
  const finalDecision = llmResult.decision;

  if (llmResult.llmUsed) {
    pipeline.push({
      id: 'llm',
      label: '🤖 LLM 보강 (Grok 4 Fast)',
      icon: '🤖',
      data: {
        system_prompt: llmResult.systemPrompt,
        user_prompt: llmResult.userPrompt,
        raw_response: llmResult.rawResponse,
        parsed_decision: llmResult.decision,
        tokens: llmResult.tokens,
        cost_usd: llmResult.tokens
          ? (llmResult.tokens.input * PRICE_INPUT_PER_M + llmResult.tokens.output * PRICE_OUTPUT_PER_M) / 1_000_000
          : 0,
        latency_ms: llmResult.latency_ms,
      },
    });
  } else {
    pipeline.push({
      id: 'llm',
      label: '🤖 LLM 보강 (스킵됨)',
      icon: '🤖',
      data: {
        skipped: true,
        reason: session.phase !== 'BARGAINING'
          ? `Phase = ${session.phase} (BARGAINING만 LLM 호출)`
          : skillDecision.action !== 'COUNTER'
            ? `Action = ${skillDecision.action} (COUNTER만 LLM 보강)`
            : 'API key 없음 또는 에러',
      },
    });
  }

  // Step 7: Referee Validation
  const validation = validateDecision(finalDecision, memory);
  pipeline.push({
    id: 'validation',
    label: '✅ Referee 검증',
    icon: '✅',
    data: validation,
  });

  // Step 8: Message Rendering — LLM message preferred, fallback to template
  const templateMessage = renderMessage(finalDecision, session.phase);
  const message = finalDecision.message || templateMessage;
  pipeline.push({
    id: 'render',
    label: '💬 메시지 렌더링 (BuddyTone)',
    icon: '💬',
    data: {
      tone: 'professional',
      tactic: finalDecision.tactic_used,
      source: finalDecision.message ? 'LLM 생성' : '템플릿 (rule-based)',
      rendered: message,
      ...(finalDecision.message ? { template_fallback: templateMessage } : {}),
    },
  });

  // Update session
  const isDeal = finalDecision.action === 'ACCEPT';
  if (finalDecision.action === 'COUNTER' && finalDecision.price) {
    session.last_seller_offer = finalDecision.price;
  }

  session.history.push({
    round: session.round,
    buyer_offer: buyerPrice,
    seller_offer: finalDecision.price ?? session.last_seller_offer,
    gap: Math.abs((finalDecision.price ?? session.last_seller_offer) - buyerPrice),
  });

  if (isDeal) {
    session.deal = true;
    session.phase = 'SETTLEMENT';
  }

  return {
    round: session.round,
    seller_decision: finalDecision,
    seller_message: message,
    pipeline,
    memory,
    deal: isDeal,
    tokens: llmResult.tokens,
    cost_usd: llmResult.tokens
      ? (llmResult.tokens.input * PRICE_INPUT_PER_M + llmResult.tokens.output * PRICE_OUTPUT_PER_M) / 1_000_000
      : 0,
    phase: session.phase,
  };
}

// ─── HTTP Server ─────────────────────────────────────────────

function parseBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
  });
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (url.pathname === '/' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML_PAGE);
    return;
  }

  if (url.pathname === '/api/negotiate' && req.method === 'POST') {
    const body = JSON.parse(await parseBody(req)) as { price: number; message: string };
    const result = await handleRound(body.price, body.message);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  if (url.pathname === '/api/reset' && req.method === 'POST') {
    resetSession();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, seller_opening: session.last_seller_offer }));
    return;
  }

  if (url.pathname === '/api/state' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(session));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n  🤝 Haggle Interactive Demo`);
  console.log(`  📱 ${ITEM}`);
  console.log(`  🤖 Model: ${MODEL}`);
  console.log(`  🌐 http://localhost:${PORT}\n`);
});

// ─── HTML Page ───────────────────────────────────────────────

const HTML_PAGE = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Haggle Interactive Demo</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body {
  background:#0a0b0d; color:#e0e0e0;
  font-family:-apple-system,'Pretendard','Noto Sans KR',sans-serif;
  line-height:1.5; height:100vh; display:flex; flex-direction:column;
}
.header {
  padding:12px 20px; border-bottom:1px solid #1e2130;
  display:flex; align-items:center; gap:16px; flex-shrink:0;
}
.header h1 {
  font-size:18px;
  background:linear-gradient(135deg,#3498db,#2ecc71);
  -webkit-background-clip:text; -webkit-text-fill-color:transparent;
}
.header .info { font-size:12px; color:#888; }
.header .phase-badge {
  padding:2px 10px; border-radius:4px; font-size:11px; font-weight:700;
  background:#1e2130; color:#888;
}
.phase-OPENING { background:#3498db22; color:#3498db; }
.phase-BARGAINING { background:#f39c1222; color:#f39c12; }
.phase-CLOSING { background:#2ecc7122; color:#2ecc71; }
.phase-SETTLEMENT { background:#9b59b622; color:#9b59b6; }

.main { flex:1; display:flex; overflow:hidden; }

/* Chat Panel */
.chat-panel { flex:1; display:flex; flex-direction:column; border-right:1px solid #1e2130; min-width:0; }
.chat-messages { flex:1; overflow-y:auto; padding:16px; }
.msg { margin-bottom:12px; max-width:85%; }
.msg.buyer { margin-left:auto; }
.msg.seller { margin-right:auto; }
.msg.system { margin:0 auto; text-align:center; color:#666; font-size:12px; }
.msg-bubble {
  padding:10px 14px; border-radius:12px; font-size:14px;
  position:relative;
}
.msg.buyer .msg-bubble { background:#1a365d; border-bottom-right-radius:4px; }
.msg.seller .msg-bubble { background:#1a2332; border-bottom-left-radius:4px; border-left:3px solid #e74c3c; }
.msg-meta { font-size:11px; color:#666; margin-top:4px; padding:0 4px; }
.msg.buyer .msg-meta { text-align:right; }
.msg-price { font-weight:700; color:#f39c12; }

.chat-input {
  padding:12px 16px; border-top:1px solid #1e2130;
  display:flex; flex-direction:column; gap:8px; flex-shrink:0;
}
.input-row { display:flex; gap:8px; }
.chat-input input[type=number] {
  width:120px; padding:8px 12px; border-radius:8px;
  background:#12141a; border:1px solid #1e2130; color:#fff;
  font-size:14px; font-weight:700;
}
.chat-input input[type=text] {
  flex:1; padding:8px 12px; border-radius:8px;
  background:#12141a; border:1px solid #1e2130; color:#e0e0e0;
  font-size:14px;
}
.chat-input button {
  padding:8px 20px; border-radius:8px; border:none;
  background:linear-gradient(135deg,#3498db,#2ecc71);
  color:#fff; font-weight:700; font-size:14px; cursor:pointer;
}
.chat-input button:disabled { opacity:0.5; cursor:not-allowed; }
.chat-input button:hover:not(:disabled) { filter:brightness(1.1); }

/* Pipeline Panel */
.pipeline-panel {
  width:480px; flex-shrink:0; display:flex; flex-direction:column;
  overflow:hidden;
}
.pipeline-header {
  padding:10px 16px; border-bottom:1px solid #1e2130;
  font-size:13px; font-weight:700; color:#888;
  display:flex; align-items:center; gap:8px;
}
.pipeline-content { flex:1; overflow-y:auto; padding:12px; }
.pipeline-empty { color:#555; text-align:center; margin-top:60px; font-size:13px; }
.step {
  margin-bottom:10px; border:1px solid #1e2130; border-radius:10px;
  overflow:hidden;
}
.step-header {
  padding:8px 12px; background:#0e1016; display:flex; align-items:center;
  gap:8px; cursor:pointer; user-select:none; font-size:13px;
}
.step-header:hover { background:#12141a; }
.step-icon { font-size:16px; }
.step-label { flex:1; font-weight:600; }
.step-time { font-size:11px; color:#666; }
.step-body { padding:10px 12px; display:none; border-top:1px solid #1e2130; }
.step.open .step-body { display:block; }
.step-encoded {
  background:#080a0d; border:1px solid #1a1d24; border-radius:6px;
  padding:8px 10px; font-size:11px; font-family:'SF Mono','Fira Code',monospace;
  color:#2ecc71; white-space:pre-wrap; word-break:break-all;
  margin-top:6px; max-height:200px; overflow-y:auto;
}
.step-json {
  background:#080a0d; border:1px solid #1a1d24; border-radius:6px;
  padding:8px 10px; font-size:11px; font-family:'SF Mono','Fira Code',monospace;
  color:#aaa; white-space:pre-wrap; word-break:break-word;
  margin-top:6px; max-height:300px; overflow-y:auto;
}
.validation-row { display:flex; align-items:center; gap:8px; font-size:12px; padding:3px 0; }
.v-pass { color:#2ecc71; }
.v-fail { color:#e74c3c; }
.v-severity { font-size:10px; padding:1px 5px; border-radius:3px; }
.v-severity.HARD { background:#e74c3c22; color:#e74c3c; }
.v-severity.SOFT { background:#f39c1222; color:#f39c12; }

/* Deal Overlay */
.deal-overlay {
  display:none; position:fixed; inset:0; background:#0008;
  align-items:center; justify-content:center; z-index:100;
}
.deal-overlay.show { display:flex; }
.deal-card {
  background:#12141a; border:2px solid #2ecc71; border-radius:16px;
  padding:32px 40px; text-align:center; max-width:400px;
}
.deal-card h2 { font-size:24px; color:#2ecc71; margin-bottom:16px; }
.deal-card .price { font-size:48px; font-weight:700; color:#fff; }
.deal-card .detail { font-size:14px; color:#888; margin-top:12px; }
.deal-card button {
  margin-top:20px; padding:10px 24px; border-radius:8px; border:none;
  background:#2ecc71; color:#fff; font-weight:700; cursor:pointer;
}

.stats-bar {
  padding:6px 16px; border-top:1px solid #1e2130; font-size:11px; color:#666;
  display:flex; gap:16px; flex-shrink:0;
}
</style>
</head>
<body>

<div class="header">
  <h1>Haggle Interactive Demo</h1>
  <span class="info">` + ITEM + ` | 시장가 $` + MARKET_PRICE + `</span>
  <span class="phase-badge" id="phase-badge">OPENING</span>
  <span class="info" id="round-info">R0/` + MAX_ROUNDS + `</span>
</div>

<div class="main">
  <div class="chat-panel">
    <div class="chat-messages" id="chat">
      <div class="msg system"><div class="msg-bubble" style="background:transparent;">
        판매자 Bob이 <span class="msg-price">$` + session.seller_target + `</span>에 ` + ITEM + `을 올렸습니다.<br>
        당신은 구매자입니다. 가격과 메시지를 입력하세요.
      </div></div>
    </div>
    <div class="chat-input">
      <div class="input-row">
        <input type="number" id="price-input" placeholder="가격 ($)" min="1" step="10" value="880">
        <input type="text" id="msg-input" placeholder="판매자에게 보낼 메시지..." value="">
        <button id="send-btn" onclick="sendOffer()">제안 →</button>
      </div>
      <div style="font-size:11px;color:#555;">
        💡 Tip: 구매자 목표 $` + session.buyer_target + ` / 한계 $` + session.buyer_floor + ` — 전략적으로 협상해보세요
      </div>
    </div>
  </div>

  <div class="pipeline-panel">
    <div class="pipeline-header">
      🔧 Protocol Pipeline Inspector
      <span style="flex:1"></span>
      <span id="pipeline-round" style="font-size:11px;color:#555;"></span>
    </div>
    <div class="pipeline-content" id="pipeline">
      <div class="pipeline-empty">
        첫 제안을 보내면 여기에<br>프로토콜 변환 과정이 표시됩니다.
        <br><br>
        <strong>파이프라인 단계:</strong><br>
        📥 Raw Input → 🧠 CoreMemory →<br>
        📜 History Encoding → 📊 Coaching →<br>
        ⚡ Skill (규칙 엔진) → 🤖 LLM 보강 →<br>
        ✅ Referee 검증 → 💬 메시지 렌더링
      </div>
    </div>
  </div>
</div>

<div class="stats-bar">
  <span id="stat-tokens">토큰: 0</span>
  <span id="stat-cost">비용: $0.0000</span>
  <span id="stat-rounds">라운드: 0</span>
  <span id="stat-gap">갭: -</span>
</div>

<div class="deal-overlay" id="deal-overlay">
  <div class="deal-card">
    <h2>🎉 거래 성사!</h2>
    <div class="price" id="deal-price"></div>
    <div class="detail" id="deal-detail"></div>
    <button onclick="newGame()">새 게임 시작</button>
  </div>
</div>

<script>
let totalTokens = 0;
let totalCost = 0;

async function sendOffer() {
  const price = parseInt(document.getElementById('price-input').value);
  let message = document.getElementById('msg-input').value.trim();
  if (!price || price < 1) return;
  if (!message) message = '$' + price + '에 구매하고 싶습니다.';

  const btn = document.getElementById('send-btn');
  btn.disabled = true;
  btn.textContent = '⏳';

  // Add buyer message
  addChat('buyer', message, price);

  try {
    const resp = await fetch('/api/negotiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ price, message }),
    });
    const data = await resp.json();

    // Add seller message
    addChat('seller', data.seller_message, data.seller_decision.price || price,
      data.seller_decision.action + (data.seller_decision.tactic_used ? ' / ' + data.seller_decision.tactic_used : ''));

    // Update pipeline
    renderPipeline(data.pipeline, data.round);

    // Update stats
    if (data.tokens) {
      totalTokens += data.tokens.input + data.tokens.output;
      totalCost += data.cost_usd || 0;
    }
    document.getElementById('stat-tokens').textContent = '토큰: ' + totalTokens;
    document.getElementById('stat-cost').textContent = '비용: $' + totalCost.toFixed(4);
    document.getElementById('stat-rounds').textContent = '라운드: ' + data.round;

    const gap = data.memory.boundaries.gap;
    document.getElementById('stat-gap').textContent = '갭: $' + gap;

    // Update phase badge
    const badge = document.getElementById('phase-badge');
    badge.textContent = data.phase;
    badge.className = 'phase-badge phase-' + data.phase;
    document.getElementById('round-info').textContent = 'R' + data.round + '/' + ${MAX_ROUNDS};

    // Deal check
    if (data.deal) {
      const dealPrice = data.seller_decision.price || price;
      document.getElementById('deal-price').textContent = '$' + dealPrice;
      document.getElementById('deal-detail').innerHTML =
        '시장가 $${MARKET_PRICE} 대비 ' + (${MARKET_PRICE} - dealPrice) + '달러 절약 (' +
        ((${MARKET_PRICE} - dealPrice) / ${MARKET_PRICE} * 100).toFixed(1) + '%)<br>' +
        data.round + '라운드 | ' + totalTokens + ' tokens | $' + totalCost.toFixed(4);
      document.getElementById('deal-overlay').classList.add('show');
    }

    // Update suggested price
    if (data.seller_decision.action === 'COUNTER' && data.seller_decision.price) {
      document.getElementById('price-input').value = Math.round(data.seller_decision.price * 0.95);
    }
  } catch (e) {
    addChat('system', '❌ Error: ' + e.message, null);
  }

  btn.disabled = false;
  btn.textContent = '제안 →';
  document.getElementById('msg-input').value = '';
  document.getElementById('msg-input').focus();
}

function addChat(role, text, price, meta) {
  const chat = document.getElementById('chat');
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  let priceHtml = price ? '<span class="msg-price">$' + price + '</span>' : '';
  let metaHtml = meta ? '<div class="msg-meta">' + meta + '</div>' : '';
  if (role === 'buyer') {
    div.innerHTML = '<div class="msg-bubble">' + priceHtml + ' ' + escHtml(text) + '</div>' +
      '<div class="msg-meta">구매자 (나)</div>';
  } else if (role === 'seller') {
    div.innerHTML = '<div class="msg-bubble">' + escHtml(text) + '</div>' + metaHtml;
  } else {
    div.innerHTML = '<div class="msg-bubble" style="background:transparent;">' + text + '</div>';
  }
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

function renderPipeline(steps, round) {
  const el = document.getElementById('pipeline');
  el.innerHTML = '';
  document.getElementById('pipeline-round').textContent = 'Round ' + round;

  for (const step of steps) {
    const div = document.createElement('div');
    div.className = 'step';

    const header = document.createElement('div');
    header.className = 'step-header';
    header.innerHTML = '<span class="step-icon">' + step.icon + '</span>' +
      '<span class="step-label">' + step.label + '</span>' +
      (step.duration_ms ? '<span class="step-time">' + step.duration_ms + 'ms</span>' : '');
    header.onclick = () => div.classList.toggle('open');

    const body = document.createElement('div');
    body.className = 'step-body';

    // Render based on step type
    if (step.id === 'validation') {
      body.innerHTML = renderValidation(step.data);
    } else if (step.id === 'llm' && step.data && step.data.system_prompt) {
      body.innerHTML = renderLLMStep(step.data);
    } else {
      let html = '';
      if (step.encoded) {
        html += '<div class="step-encoded">' + escHtml(step.encoded) + '</div>';
      }
      html += '<div class="step-json">' + escHtml(JSON.stringify(step.data, null, 2)) + '</div>';
      body.innerHTML = html;
    }

    div.appendChild(header);
    div.appendChild(body);
    el.appendChild(div);
  }

  // Auto-open first and last steps
  const allSteps = el.querySelectorAll('.step');
  if (allSteps.length > 0) allSteps[0].classList.add('open');
  if (allSteps.length > 1) allSteps[allSteps.length - 1].classList.add('open');
}

function renderValidation(rules) {
  return rules.map(function(r) {
    const icon = r.passed ? '✅' : '❌';
    const cls = r.passed ? 'v-pass' : 'v-fail';
    return '<div class="validation-row ' + cls + '">' +
      icon + ' <span class="v-severity ' + r.severity + '">' + r.severity + '</span> ' +
      '<strong>' + r.rule + '</strong> — ' + escHtml(r.detail) + '</div>';
  }).join('');
}

function renderLLMStep(data) {
  const cost = data.cost_usd ? '$' + data.cost_usd.toFixed(4) : '-';
  const tokens = data.tokens ? (data.tokens.input + '+' + data.tokens.output) : '-';
  return '<div style="margin-bottom:8px;font-size:12px;color:#f39c12;">' +
    '🤖 LLM 호출됨 | ' + tokens + ' tokens | ' + cost +
    (data.latency_ms ? ' | ' + data.latency_ms + 'ms' : '') + '</div>' +
    '<details><summary style="font-size:11px;color:#666;cursor:pointer;">System Prompt</summary>' +
    '<div class="step-encoded">' + escHtml(data.system_prompt) + '</div></details>' +
    '<details open><summary style="font-size:11px;color:#666;cursor:pointer;">User Prompt (압축 인코딩)</summary>' +
    '<div class="step-encoded">' + escHtml(data.user_prompt) + '</div></details>' +
    '<details><summary style="font-size:11px;color:#666;cursor:pointer;">Raw Response</summary>' +
    '<div class="step-json">' + escHtml(data.raw_response) + '</div></details>' +
    '<div class="step-json">' + escHtml(JSON.stringify(data.parsed_decision, null, 2)) + '</div>';
}

function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function newGame() {
  document.getElementById('deal-overlay').classList.remove('show');
  await fetch('/api/reset', { method: 'POST' });
  document.getElementById('chat').innerHTML =
    '<div class="msg system"><div class="msg-bubble" style="background:transparent;">' +
    '새 게임! 판매자 Bob이 <span class="msg-price">$${session.seller_target}</span>에 ${ITEM}을 올렸습니다.' +
    '</div></div>';
  document.getElementById('pipeline').innerHTML =
    '<div class="pipeline-empty">첫 제안을 보내면 파이프라인이 표시됩니다.</div>';
  document.getElementById('price-input').value = '880';
  totalTokens = 0; totalCost = 0;
  document.getElementById('stat-tokens').textContent = '토큰: 0';
  document.getElementById('stat-cost').textContent = '비용: $0.0000';
  document.getElementById('stat-rounds').textContent = '라운드: 0';
  document.getElementById('stat-gap').textContent = '갭: -';
  document.getElementById('phase-badge').textContent = 'OPENING';
  document.getElementById('phase-badge').className = 'phase-badge';
  document.getElementById('round-info').textContent = 'R0/${MAX_ROUNDS}';
}

document.getElementById('msg-input').addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendOffer(); }
});
document.getElementById('price-input').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') { e.preventDefault(); sendOffer(); }
});
</script>

</body>
</html>`;
