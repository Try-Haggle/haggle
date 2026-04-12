/**
 * Haggle 대화형 전략 빌더 + 자동 협상 데모
 *
 * 기존 인프라를 재사용:
 *  - callLLM (negotiation/adapters/xai-client) — Grok 4 Fast 호출
 *  - executeRound (@haggle/engine-session) — 엔진 라운드 실행
 *  - TemplateMessageRenderer — 메시지 렌더링
 *  - negotiation-simulate 패턴 — 인메모리 시뮬레이션
 *
 * Flow:
 *  1) LLM과 자연어 채팅으로 구매 전략 수립
 *  2) LLM이 대화 → MasterStrategy 파라미터 변환
 *  3) 확인 후 simulate 패턴으로 자동 협상
 *  4) 라운드별 결과 + 메시지 표시
 *
 * Usage:
 *   source apps/api/.env && XAI_API_KEY=$XAI_API_KEY npx tsx apps/api/src/scripts/demo-strategy-builder.ts
 *   -> http://localhost:3099
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  executeRound,
  type MasterStrategy,
  type RoundData,
  type NegotiationSession,
  type HnpMessage,
} from '@haggle/engine-session';

// Reuse existing xAI client
import { callLLM, type XAICallOptions } from '../negotiation/adapters/xai-client.js';
// Reuse existing message renderer
import { TemplateMessageRenderer } from '../negotiation/rendering/message-renderer.js';

const PORT = 3099;
const ITEM = 'iPhone 15 Pro 256GB Space Black (미개봉)';
const MARKET_PRICE = 1_050;
const MAX_ROUNDS = 10;

const renderer = new TemplateMessageRenderer();

// ─── Simulate helpers (from negotiation-simulate.ts) ─────────

function emptySession(role: 'BUYER' | 'SELLER', nowMs: number): NegotiationSession {
  return {
    session_id: `sim-${role.toLowerCase()}-${nowMs}`,
    strategy_id: `strat-${role.toLowerCase()}`,
    role,
    status: 'ACTIVE',
    counterparty_id: role === 'BUYER' ? 'seller' : 'buyer',
    rounds: [],
    current_round: 0,
    rounds_no_concession: 0,
    last_offer_price: null,
    last_utility: null,
    created_at: nowMs,
    updated_at: nowMs,
  };
}

function buildMsg(
  sessionId: string, price: number, from: 'BUYER' | 'SELLER', roundNo: number, nowMs: number,
): HnpMessage {
  return { session_id: sessionId, round: roundNo, type: roundNo === 1 ? 'OFFER' : 'COUNTER', price, sender_role: from, timestamp: nowMs };
}

// ─── Strategy Chat (LLM conversation → parameters) ──────────

const STRATEGY_SYSTEM = `당신은 Haggle의 AI 협상 전략 컨설턴트입니다.
사용자가 "${ITEM}"을 구매하려 합니다. 현재 시장가는 $${MARKET_PRICE}입니다.

당신의 역할:
1. 자연스럽게 한국어로 대화하며 사용자의 구매 의도를 파악합니다
2. 다음 정보를 수집합니다:
   - 예산 범위 (얼마까지 쓸 수 있는지)
   - 목표 가격 (얼마에 사고 싶은지)
   - 데드라인 (언제까지 사야 하는지 — 오늘? 이번 주? 여유 있음?)
   - 협상 스타일 (적극적/보통/보수적)
   - 가격 vs 시간 vs 신뢰도 중 우선순위

대화 규칙:
- **첫 메시지에서 3-4개 핵심 질문을 한꺼번에 물어봅니다** (토큰 효율성)
- 최대 2턴 안에 전략을 완성합니다 (1턴: 질문 묶음, 2턴: 전략 확정)
- 사용자 답변이 충분하면 1턴만에도 바로 전략을 제시합니다
- 친근하고 자연스럽게 대화합니다
- 절대 기술 용어(beta, u_aspiration, weights 등)를 사용하지 않습니다

응답 형식 (JSON):
{
  "message": "사용자에게 보낼 한국어 메시지",
  "ready": false,
  "strategy": null
}

충분한 정보가 모이면 (보통 1-2턴):
{
  "message": "전략 요약 메시지 (사용자에게 보여줄 자연어 설명, 데드라인과 스타일 반영)",
  "ready": true,
  "strategy": {
    "p_target": 880,
    "p_limit": 1000,
    "beta": 1.0,
    "t_deadline": 1800,
    "alpha": 0.10,
    "v_t_floor": 0.05,
    "n_threshold": 3,
    "v_s_base": 0.5,
    "w_rep": 0.6,
    "w_info": 0.4,
    "u_threshold": 0.55,
    "u_aspiration": 0.78,
    "w_p": 0.45,
    "w_t": 0.20,
    "w_r": 0.15,
    "w_s": 0.20,
    "persona_desc": "가격 민감형 구매자"
  }
}

전략 파라미터 가이드:
- p_target: 목표 구매가 ($700-$1000). 낮을수록 공격적
- p_limit: 절대 한계가 ($900-$1100). 이 이상은 안 냄
- beta: 양보 곡선 (0.3-3.0). <1 느린양보(Boulware) | 1 선형 | >1 빠른양보(Conceder)
  - 적극적 → 0.5~0.8 / 보통 → 1.0 / 빨리 끝내고 싶은 → 1.5~2.0
  - 데드라인 촉박하면 beta를 높여야 함 (빠른 양보)
- t_deadline: 협상 제한 시간 (초). 데드라인 기반으로 설정
  - 오늘 당장 → 600 (10분) / 이번 주 → 1800 (30분) / 여유 → 3600 (1시간)
  - 급할수록 짧게 → 시간 압박이 양보 곡선에 반영됨
- u_threshold: NEAR_DEAL 기준 (0.3-0.8)
- u_aspiration: ACCEPT 기준 (0.5-0.95). 높을수록 까다로움
  - 적극적 → 0.85-0.90 / 보통 → 0.75-0.80 / 관대 → 0.65-0.70
- w_p/w_t/w_r/w_s: 가격/시간/신뢰/만족 가중치 (합 1.0)
  - 데드라인 촉박하면 w_t를 높여야 함 (시간 가치 증가)

아래 파라미터들은 사용자에게 직접 묻지 말고, 대화 맥락에서 추론하여 설정:
- alpha: 초기 양보 폭 (0.05-0.3). 첫 제안에서 목표가 대비 얼마나 양보할지
  - 적극적/강경 → 0.05~0.08 / 보통 → 0.10~0.15 / 관대/빨리끝내기 → 0.20~0.30
- v_t_floor: 데드라인 도달 시 최소 시간 효용 (0.01-0.20)
  - 여유 있음 → 0.02~0.05 / 이번 주 → 0.08~0.12 / 오늘 당장 → 0.15~0.20
- n_threshold: 교착 판단 기준 (2-7). 상대가 N라운드 연속 양보 안 하면 경고
  - 급함/빨리끝내기 → 2~3 / 보통 → 3~4 / 끈기 있음/적극적 → 5~7
- v_s_base: 기본 만족도 (0.3-0.7). 사용자 기대 수준 반영
  - 까다로운/적극적 → 0.3~0.4 / 보통 → 0.5 / 관대 → 0.6~0.7
- w_rep: 신뢰 점수에서 판매자 평판 비중 (0.3-0.8)
  - 신뢰 중시 → 0.7~0.8 / 보통 → 0.5~0.6 / 가격 우선 → 0.3~0.4
- w_info: 신뢰 점수에서 정보 완결성 비중 (1 - w_rep)
  - w_rep + w_info = 1.0 이어야 함`;

interface ChatMessage { role: 'user' | 'assistant'; content: string }

interface StrategyParams {
  p_target: number; p_limit: number; beta: number;
  t_deadline: number;
  alpha: number; v_t_floor: number; n_threshold: number;
  v_s_base: number; w_rep: number; w_info: number;
  u_threshold: number; u_aspiration: number;
  w_p: number; w_t: number; w_r: number; w_s: number;
  persona_desc: string;
}

// In-memory chat sessions
const sessions = new Map<string, { messages: ChatMessage[]; strategy: StrategyParams | null }>();

async function chatForStrategy(sessionId: string, userMessage: string): Promise<{ reply: string; ready: boolean; strategy: StrategyParams | null }> {
  let session = sessions.get(sessionId);
  if (!session) {
    session = { messages: [], strategy: null };
    sessions.set(sessionId, session);
  }

  session.messages.push({ role: 'user', content: userMessage });

  const historyStr = session.messages.map(m =>
    m.role === 'user' ? `사용자: ${m.content}` : `컨설턴트: ${m.content}`
  ).join('\n');

  // Use existing callLLM from xai-client
  const result = await callLLM(STRATEGY_SYSTEM, historyStr, { correlationId: sessionId });

  let parsed: { message: string; ready: boolean; strategy: StrategyParams | null };
  try {
    parsed = JSON.parse(result.content);
  } catch {
    parsed = { message: result.content, ready: false, strategy: null };
  }

  session.messages.push({ role: 'assistant', content: parsed.message });

  if (parsed.ready && parsed.strategy) {
    session.strategy = parsed.strategy;
  }

  return {
    reply: parsed.message,
    ready: parsed.ready,
    strategy: parsed.strategy,
  };
}

// ─── Negotiation Simulation (reusing negotiate-simulate pattern) ─

function buildBuyerStrategy(params: StrategyParams): MasterStrategy {
  return {
    id: 'buyer-alice-001', user_id: 'alice',
    weights: { w_p: params.w_p, w_t: params.w_t, w_r: params.w_r, w_s: params.w_s },
    p_target: params.p_target, p_limit: params.p_limit,
    alpha: params.alpha ?? 0.1, beta: params.beta, t_deadline: params.t_deadline ?? 1800, v_t_floor: params.v_t_floor ?? 0.05,
    n_threshold: params.n_threshold ?? 3, v_s_base: params.v_s_base ?? 0.5, w_rep: params.w_rep ?? 0.6, w_info: params.w_info ?? 0.4,
    u_threshold: params.u_threshold, u_aspiration: params.u_aspiration,
    persona: 'chat-strategy-buyer',
    created_at: Date.now(), expires_at: Date.now() + 86400000,
  };
}

function createSellerStrategy(): MasterStrategy {
  return {
    id: 'seller-bob-001', user_id: 'bob',
    weights: { w_p: 0.50, w_t: 0.15, w_r: 0.15, w_s: 0.20 },
    p_target: 1120, p_limit: 920,
    alpha: 0.1, beta: 1.0, t_deadline: 1800, v_t_floor: 0.05,
    n_threshold: 3, v_s_base: 0.5, w_rep: 0.6, w_info: 0.4,
    u_threshold: 0.50, u_aspiration: 0.80,
    persona: 'firm-but-fair-seller',
    created_at: Date.now(), expires_at: Date.now() + 86400000,
  };
}

/** Quick template message (no LLM, instant) */
function templateMessage(role: string, decision: string, price: number): string {
  const name = role === 'BUYER' ? 'Alice' : 'Bob';
  switch (decision) {
    case 'ACCEPT': return `$${price}에 동의합니다!`;
    case 'REJECT': return `$${price}는 수용 불가입니다.`;
    case 'ESCALATE': return `$${price} — 검토가 필요합니다.`;
    case 'NEAR_DEAL': return `$${price}로 거의 다 왔네요.`;
    case 'COUNTER': return `$${price}에 제안합니다.`;
    default: return `$${price}`;
  }
}

/** Generate Korean message via existing callLLM */
async function generateKoreanMessage(
  role: string, decision: string, price: number, round: number,
  history: Array<{ round: number; buyer: number; seller: number }>,
): Promise<{ message: string; usage: { prompt_tokens: number; completion_tokens: number } }> {
  const sys = `You are ${role === 'BUYER' ? 'Alice (구매자)' : 'Bob (판매자)'} negotiating for ${ITEM}. Market: $${MARKET_PRICE}.
Write ONE short Korean message (under 50 chars). Be natural. Decision: ${decision} $${price}. Round ${round}/${MAX_ROUNDS}.
Respond JSON: {"message":"한국어 메시지"}`;
  const usr = history.length > 0
    ? history.map(h => `R${h.round}: B$${h.buyer}/S$${h.seller}`).join('; ') + `\n${decision} $${price}`
    : `${decision} $${price}`;

  try {
    const result = await callLLM(sys, usr, { maxTokens: 100 });
    const msg = JSON.parse(result.content).message ?? `$${price}`;
    return { message: msg, usage: result.usage };
  } catch {
    return { message: `$${price}에 ${decision === 'ACCEPT' ? '좋습니다!' : '제안합니다.'}`, usage: { prompt_tokens: 0, completion_tokens: 0 } };
  }
}

interface RoundRecord {
  round: number; buyerPrice: number; sellerPrice: number; gap: number;
  buyerDecision: string; sellerDecision: string;
  buyerUtility: { u_total: number; v_p: number; v_t: number; v_r: number; v_s: number };
  sellerUtility: { u_total: number; v_p: number; v_t: number; v_r: number; v_s: number };
  buyerMessage?: string; sellerMessage?: string;
  tokens: number; cost: number;
}

/**
 * Run negotiation as SSE stream — emit each round as it completes.
 * No more 30s+ wait for all LLM calls to finish.
 */
async function streamNegotiation(params: StrategyParams, res: ServerResponse) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const buyerStrategy = buildBuyerStrategy(params);
  const sellerStrategy = createSellerStrategy();
  const startedAt = Date.now();

  let buyerSession = emptySession('BUYER', startedAt);
  let sellerSession = emptySession('SELLER', startedAt);

  // Pre-initialize last_offer_price to target (Faratin anchoring fix)
  buyerSession.last_offer_price = buyerStrategy.p_target;
  sellerSession.last_offer_price = sellerStrategy.p_target;

  const DEFAULT_RD: RoundData = {
    p_effective: 0, r_score: 0.8, i_completeness: 0.9,
    t_elapsed: 0, n_success: 0, n_dispute_losses: 0,
  };

  // Send strategy info
  send('init', {
    buyerStrategy: { p_target: buyerStrategy.p_target, p_limit: buyerStrategy.p_limit, beta: buyerStrategy.beta, u_threshold: buyerStrategy.u_threshold, u_aspiration: buyerStrategy.u_aspiration, weights: buyerStrategy.weights },
    sellerStrategy: { p_target: sellerStrategy.p_target, p_limit: sellerStrategy.p_limit, beta: sellerStrategy.beta, u_threshold: sellerStrategy.u_threshold, u_aspiration: sellerStrategy.u_aspiration },
  });

  const rounds: RoundRecord[] = [];
  const history: Array<{ round: number; buyer: number; seller: number }> = [];
  let deal = false;
  let finalPrice: number | null = null;
  let acceptedBy: string | null = null;

  let nextFrom: 'BUYER' | 'SELLER' = 'SELLER';
  let nextPrice = sellerStrategy.p_target;

  for (let round = 1; round <= MAX_ROUNDS && !deal; round++) {
    const elapsed = round * 120 + Math.floor(Math.random() * 60); // seconds

    const evalSide: 'BUYER' | 'SELLER' = nextFrom === 'SELLER' ? 'BUYER' : 'SELLER';
    const evalSession = evalSide === 'BUYER' ? buyerSession : sellerSession;
    const evalStrategy = evalSide === 'BUYER' ? buyerStrategy : sellerStrategy;

    const incoming = buildMsg(evalSession.session_id, nextPrice, nextFrom, evalSession.current_round + 1, Date.now());
    const rd: RoundData = { ...DEFAULT_RD, p_effective: nextPrice, t_elapsed: elapsed };
    const evalResult = executeRound(evalSession, evalStrategy, incoming, rd);
    let evalPrice = Math.round(evalResult.message.price);

    // Clamp eval price to role's limit (BUYER can't exceed p_limit, SELLER can't go below p_limit)
    if (evalSide === 'BUYER') {
      evalPrice = Math.min(evalPrice, buyerStrategy.p_limit);
      buyerSession = evalResult.session;
    } else {
      evalPrice = Math.max(evalPrice, sellerStrategy.p_limit);
      sellerSession = evalResult.session;
    }

    if (evalResult.decision === 'ACCEPT') {
      deal = true; finalPrice = nextPrice;
      acceptedBy = evalSide === 'BUYER' ? 'BUYER (Alice)' : 'SELLER (Bob)';
    }

    const respSide: 'BUYER' | 'SELLER' = evalSide === 'BUYER' ? 'SELLER' : 'BUYER';
    const respSession = respSide === 'BUYER' ? buyerSession : sellerSession;
    const respStrategy = respSide === 'BUYER' ? buyerStrategy : sellerStrategy;

    const respIncoming = buildMsg(respSession.session_id, evalPrice, evalSide, respSession.current_round + 1, Date.now());
    const respRd: RoundData = { ...DEFAULT_RD, p_effective: evalPrice, t_elapsed: elapsed + 30 };
    const respResult = executeRound(respSession, respStrategy, respIncoming, respRd);
    let respPrice = Math.round(respResult.message.price);

    // Clamp response price too
    if (respSide === 'BUYER') {
      respPrice = Math.min(respPrice, buyerStrategy.p_limit);
      buyerSession = respResult.session;
    } else {
      respPrice = Math.max(respPrice, sellerStrategy.p_limit);
      sellerSession = respResult.session;
    }

    if (!deal && respResult.decision === 'ACCEPT') {
      deal = true; finalPrice = evalPrice;
      acceptedBy = respSide === 'BUYER' ? 'BUYER (Alice)' : 'SELLER (Bob)';
    }

    const buyerPrice = evalSide === 'BUYER' ? evalPrice : respPrice;
    const sellerPrice = evalSide === 'SELLER' ? evalPrice : respPrice;
    const gap = Math.abs(sellerPrice - buyerPrice);
    history.push({ round, buyer: buyerPrice, seller: sellerPrice });

    if (!deal && buyerPrice >= sellerPrice) {
      deal = true;
      finalPrice = Math.round((buyerPrice + sellerPrice) / 2);
      acceptedBy = '교차 (중간가)';
    }

    const buyerU = evalSide === 'BUYER' ? evalResult.utility : respResult.utility;
    const sellerU = evalSide === 'SELLER' ? evalResult.utility : respResult.utility;
    const buyerDec = evalSide === 'BUYER' ? evalResult.decision : respResult.decision;
    const sellerDec = evalSide === 'SELLER' ? evalResult.decision : respResult.decision;

    // 1) Send engine result immediately (prices, decisions, utility)
    send('round', {
      round, buyerPrice, sellerPrice, gap,
      buyerDecision: buyerDec, sellerDecision: sellerDec,
      buyerUtility: buyerU, sellerUtility: sellerU,
    });

    // 2) Generate LLM messages (parallel) — streamed as they arrive
    const [bMsg, sMsg] = await Promise.all([
      generateKoreanMessage('BUYER', buyerDec, buyerPrice, round, history),
      generateKoreanMessage('SELLER', sellerDec, sellerPrice, round, history),
    ]);

    const PRICE_INPUT = 0.20;
    const PRICE_OUTPUT = 0.50;
    const totalUsage = bMsg.usage.prompt_tokens + bMsg.usage.completion_tokens + sMsg.usage.prompt_tokens + sMsg.usage.completion_tokens;
    const totalCost = (
      (bMsg.usage.prompt_tokens + sMsg.usage.prompt_tokens) * PRICE_INPUT +
      (bMsg.usage.completion_tokens + sMsg.usage.completion_tokens) * PRICE_OUTPUT
    ) / 1e6;

    // 3) Send messages as update event
    send('messages', { round, buyerMessage: bMsg.message, sellerMessage: sMsg.message, tokens: totalUsage, cost: totalCost });

    const roundRecord: RoundRecord = {
      round, buyerPrice, sellerPrice, gap,
      buyerDecision: buyerDec, sellerDecision: sellerDec,
      buyerUtility: buyerU, sellerUtility: sellerU,
      buyerMessage: bMsg.message, sellerMessage: sMsg.message,
      tokens: totalUsage, cost: totalCost,
    };

    rounds.push(roundRecord);

    if (evalResult.decision === 'REJECT' || evalResult.decision === 'ESCALATE') break;
    if (respResult.decision === 'REJECT' || respResult.decision === 'ESCALATE') break;

    nextFrom = respSide;
    nextPrice = respPrice;
  }

  const totalTokens = rounds.reduce((s, r) => s + r.tokens, 0);
  const totalCost = rounds.reduce((s, r) => s + r.cost, 0);
  const savings = finalPrice ? MARKET_PRICE - finalPrice : 0;

  // Explain why no deal if limits don't overlap
  let noMatchReason: string | undefined;
  if (!deal && buyerStrategy.p_limit < sellerStrategy.p_limit) {
    noMatchReason = `구매 한계($${buyerStrategy.p_limit}) < 판매 한계($${sellerStrategy.p_limit}) — 가격대가 겹치지 않아 합의 불가. 한계가를 $${sellerStrategy.p_limit} 이상으로 올려보세요.`;
  }

  send('done', {
    deal, finalPrice, acceptedBy, totalTokens, totalCost, savings,
    savingsPercent: finalPrice ? ((savings / MARKET_PRICE) * 100).toFixed(1) : '0',
    roundCount: rounds.length,
    durationMs: Date.now() - startedAt,
    noMatchReason,
  });

  res.end();
}

// ─── HTTP Server ─────────────────────────────────────────────

function parseBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c: Buffer) => { body += c.toString(); });
    req.on('end', () => resolve(body));
  });
}

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (url.pathname === '/' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getHtml());
    return;
  }

  if (url.pathname === '/api/chat' && req.method === 'POST') {
    try {
      const body = JSON.parse(await parseBody(req)) as { sessionId: string; message: string };
      const result = await chatForStrategy(body.sessionId, body.message);
      json(res, 200, result);
    } catch (err) {
      json(res, 500, { error: String(err) });
    }
    return;
  }

  if (url.pathname === '/api/negotiate' && req.method === 'POST') {
    try {
      const body = JSON.parse(await parseBody(req)) as { strategy: StrategyParams };
      await streamNegotiation(body.strategy, res);
    } catch (err) {
      // If headers already sent (streaming started), just end
      if (res.headersSent) { res.end(); }
      else { json(res, 500, { error: String(err) }); }
    }
    return;
  }

  if (url.pathname === '/api/reset' && req.method === 'POST') {
    try {
      const body = JSON.parse(await parseBody(req)) as { sessionId: string };
      sessions.delete(body.sessionId);
      json(res, 200, { ok: true });
    } catch (err) {
      json(res, 500, { error: String(err) });
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`
  ========================================
  Haggle 대화형 전략 빌더 + 자동 협상
  ========================================
  ${ITEM}
  Model: ${process.env.XAI_MODEL ?? 'grok-4-fast'}
  API Key: ${process.env.XAI_API_KEY ? 'loaded' : 'MISSING'}
  Using: callLLM (xai-client), executeRound (engine-session)
  http://localhost:${PORT}
  `);
});

// ─── HTML ────────────────────────────────────────────────────

function getHtml(): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Haggle 전략 빌더</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { background:#0a0b0d; color:#e0e0e0; font-family:-apple-system,'Pretendard','Noto Sans KR',sans-serif; line-height:1.6; height:100vh; display:flex; flex-direction:column; }

.header { padding:12px 20px; border-bottom:1px solid #1e2130; display:flex; align-items:center; gap:12px; flex-shrink:0; }
.header h1 { font-size:18px; background:linear-gradient(135deg,#3498db,#2ecc71); -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
.header .info { font-size:11px; color:#666; }
.header .phase-badge { font-size:11px; padding:3px 10px; border-radius:12px; font-weight:600; }
.phase-chat { background:#1a365d; color:#3498db; }
.phase-strategy { background:#1a3a2a; color:#2ecc71; }
.phase-negotiate { background:#3a2a1a; color:#f39c12; }

.main { flex:1; display:flex; overflow:hidden; }

.chat-panel { flex:1; display:flex; flex-direction:column; border-right:1px solid #1e2130; }
.chat-messages { flex:1; overflow-y:auto; padding:16px; }
.chat-msg { margin-bottom:12px; display:flex; gap:10px; }
.chat-msg.user { flex-direction:row-reverse; }
.msg-avatar { width:32px; height:32px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:14px; flex-shrink:0; }
.assistant .msg-avatar { background:#1a365d; }
.user .msg-avatar { background:#2d1a2d; }
.msg-body { max-width:75%; }
.msg-bubble { padding:10px 14px; border-radius:12px; font-size:14px; white-space:pre-wrap; word-break:break-word; }
.assistant .msg-bubble { background:#12131a; border:1px solid #1e2130; border-top-left-radius:4px; }
.user .msg-bubble { background:#1a365d; border-top-right-radius:4px; }
.msg-time { font-size:10px; color:#555; margin-top:2px; padding:0 4px; }
.user .msg-time { text-align:right; }

.typing { display:none; padding:8px 16px; font-size:12px; color:#888; }
.typing.show { display:flex; align-items:center; gap:8px; }
.typing-dots { display:flex; gap:3px; }
.typing-dots span { width:6px; height:6px; background:#555; border-radius:50%; animation:blink 1.4s infinite; }
.typing-dots span:nth-child(2) { animation-delay:0.2s; }
.typing-dots span:nth-child(3) { animation-delay:0.4s; }
@keyframes blink { 0%,80%,100%{opacity:0.3;} 40%{opacity:1;} }

.chat-input { padding:12px 16px; border-top:1px solid #1e2130; display:flex; gap:8px; flex-shrink:0; }
.chat-input input { flex:1; background:#12131a; border:1px solid #1e2130; border-radius:8px; padding:10px 14px; color:#e0e0e0; font-size:14px; outline:none; }
.chat-input input:focus { border-color:#3498db; }
.chat-input input::placeholder { color:#555; }
.chat-input button { background:linear-gradient(135deg,#3498db,#2ecc71); color:#fff; border:none; border-radius:8px; padding:10px 20px; font-size:14px; font-weight:600; cursor:pointer; }
.chat-input button:hover { opacity:0.9; }
.chat-input button:disabled { opacity:0.4; cursor:not-allowed; }

.strategy-confirm { display:none; padding:12px 16px; border-top:1px solid #1e2130; flex-shrink:0; }
.strategy-confirm.show { display:block; }
.strategy-params { background:#12131a; border-radius:8px; padding:12px; margin-bottom:10px; display:grid; grid-template-columns:repeat(auto-fill,minmax(120px,1fr)); gap:6px; font-size:12px; }
.sp-item { display:flex; justify-content:space-between; }
.sp-label { color:#888; }
.sp-val { color:#2ecc71; font-weight:600; font-family:'SF Mono',monospace; }
.confirm-btns { display:flex; gap:8px; }
.confirm-btns button { flex:1; padding:10px; border:none; border-radius:8px; font-size:14px; font-weight:600; cursor:pointer; }
.btn-confirm { background:#2ecc71; color:#000; }
.btn-retry { background:#1e2130; color:#e0e0e0; }

.results-panel { flex:1; overflow-y:auto; padding:16px; display:none; }
.results-panel.show { display:block; }

.result-header { text-align:center; margin-bottom:16px; position:sticky; top:0; background:#0a0b0d; z-index:10; padding:12px 0; border-bottom:1px solid #1e2130; }
.result-deal { font-size:32px; font-weight:800; margin:8px 0; }
.result-deal.deal { color:#2ecc71; }
.result-deal.nodeal { color:#e74c3c; }

.result-cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(100px,1fr)); gap:8px; margin-bottom:16px; }
.rc { background:#12131a; border-radius:8px; padding:8px; text-align:center; border:1px solid #1e2130; }
.rc .rc-label { font-size:10px; color:#888; text-transform:uppercase; }
.rc .rc-val { font-size:16px; font-weight:700; margin-top:2px; }

.chart-box { background:#12131a; border-radius:8px; padding:16px; margin-bottom:16px; text-align:center; border:1px solid #1e2130; }
.chart-legend { display:flex; gap:12px; justify-content:center; margin-top:6px; font-size:11px; }
.legend-dot { width:8px; height:8px; border-radius:50%; display:inline-block; margin-right:3px; vertical-align:middle; }

.round-item { background:#12131a; border-radius:8px; padding:12px; margin-bottom:8px; border:1px solid #1e2130; }
.round-top { display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; }
.round-num { font-weight:700; font-size:13px; }
.round-gap { color:#f39c12; font-weight:600; font-size:12px; }
.round-body { display:grid; grid-template-columns:1fr 24px 1fr; gap:8px; }
.party-name { font-size:11px; font-weight:600; margin-bottom:2px; }
.party-name.buyer { color:#3498db; }
.party-name.seller { color:#e74c3c; }
.party-price { font-size:16px; font-weight:700; color:#f39c12; }
.party-decision { font-size:9px; padding:1px 5px; border-radius:3px; background:#1e2130; color:#888; margin-left:4px; }
.party-msg { font-size:12px; padding:5px 8px; border-radius:6px; margin-top:4px; }
.buyer .party-msg { background:#1a365d; }
.seller .party-msg { background:#2d1a1a; }
.vs { display:flex; align-items:center; justify-content:center; color:#444; font-weight:700; font-size:10px; }
.u-bars { margin-top:4px; }
.u-row { display:flex; align-items:center; gap:3px; margin-bottom:2px; }
.u-lbl { font-size:9px; color:#888; width:28px; text-align:right; }
.u-track { flex:1; height:5px; background:#1a1b2e; border-radius:3px; overflow:hidden; }
.u-fill { height:100%; border-radius:3px; }
.u-num { font-size:9px; color:#aaa; width:32px; font-family:'SF Mono',monospace; }
.round-footer { font-size:10px; color:#555; margin-top:6px; text-align:center; }
.empty-results { display:flex; align-items:center; justify-content:center; height:100%; color:#444; font-size:14px; }
.btn-new { display:block; width:100%; margin-top:16px; padding:12px; background:linear-gradient(135deg,#3498db,#2ecc71); color:#fff; border:none; border-radius:8px; font-size:14px; font-weight:700; cursor:pointer; }

@media (max-width:768px) {
  .main { flex-direction:column; }
  .chat-panel { border-right:none; border-bottom:1px solid #1e2130; max-height:50vh; }
}
</style>
</head>
<body>

<div class="header">
  <h1>Haggle</h1>
  <span class="info">${ITEM} | 시장가 $${MARKET_PRICE}</span>
  <span class="phase-badge phase-chat" id="phaseBadge">1/3 전략 수립</span>
</div>

<div class="main">
  <div class="chat-panel">
    <div class="chat-messages" id="chatMessages"></div>
    <div class="typing" id="typing">
      <div class="typing-dots"><span></span><span></span><span></span></div>
      AI가 생각 중...
    </div>

    <div class="strategy-confirm" id="strategyConfirm">
      <div class="strategy-params" id="strategyParams"></div>
      <div class="confirm-btns">
        <button class="btn-retry" onclick="retryStrategy()">다시 상담</button>
        <button class="btn-confirm" onclick="confirmStrategy()">이 전략으로 협상 시작</button>
      </div>
    </div>

    <div class="chat-input" id="chatInput">
      <input type="text" id="msgInput" placeholder="메시지를 입력하세요..." autofocus>
      <button id="sendBtn" onclick="sendMessage()">전송</button>
    </div>
  </div>

  <div class="results-panel" id="resultsPanel">
    <div class="empty-results" id="emptyResults">
      전략을 수립하면 협상 결과가 여기에 표시됩니다
    </div>
    <div id="resultsContent" style="display:none"></div>
  </div>
</div>

<script>
const SESSION_ID = 'sess-' + Date.now();
let currentStrategy = null;

window.addEventListener('DOMContentLoaded', () => {
  addMessage('assistant', '안녕하세요! Haggle 전략 컨설턴트입니다.\\n\\n${ITEM}을 구매하시려는 거군요! 시장가가 $${MARKET_PRICE} 정도입니다.\\n\\n전략을 짜기 위해 몇 가지만 알려주세요:\\n\\n1. 얼마 정도에 사고 싶으세요? (목표가)\\n2. 최대 얼마까지는 괜찮으세요? (한계 예산)\\n3. 언제까지 사야 하나요? (오늘 당장 / 이번 주 / 여유 있음)\\n4. 협상 스타일은? (적극적으로 깎기 / 적당히 / 빨리 끝내기)\\n5. 가격, 거래 속도, 판매자 신뢰도 중 가장 중요한 건?');
  document.getElementById('resultsPanel').classList.add('show');
  document.getElementById('msgInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
});

function addMessage(role, text) {
  const c = document.getElementById('chatMessages');
  const time = new Date().toLocaleTimeString('ko-KR', {hour:'2-digit',minute:'2-digit'});
  c.innerHTML += '<div class="chat-msg '+role+'"><div class="msg-avatar">'+(role==='assistant'?'🤖':'👤')+'</div><div class="msg-body"><div class="msg-bubble">'+esc(text)+'</div><div class="msg-time">'+time+'</div></div></div>';
  c.scrollTop = c.scrollHeight;
}
function esc(t) { return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\\n/g,'<br>'); }

async function sendMessage() {
  const input = document.getElementById('msgInput');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  addMessage('user', msg);

  const btn = document.getElementById('sendBtn');
  btn.disabled = true; input.disabled = true;
  document.getElementById('typing').classList.add('show');

  try {
    const resp = await fetch('/api/chat', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ sessionId: SESSION_ID, message: msg }),
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    addMessage('assistant', data.reply);
    if (data.ready && data.strategy) {
      currentStrategy = data.strategy;
      showStrategyConfirm(data.strategy);
    }
  } catch (err) {
    addMessage('assistant', '오류: ' + err.message);
  } finally {
    btn.disabled = false; input.disabled = false;
    document.getElementById('typing').classList.remove('show');
    input.focus();
  }
}

function showStrategyConfirm(s) {
  document.getElementById('phaseBadge').textContent = '2/3 전략 확인';
  document.getElementById('phaseBadge').className = 'phase-badge phase-strategy';
  document.getElementById('chatInput').style.display = 'none';
  document.getElementById('strategyConfirm').classList.add('show');
  const labels = {p_target:'목표가',p_limit:'한계가',beta:'양보 곡선',t_deadline:'데드라인',alpha:'초기 양보폭',v_t_floor:'데드라인 패닉',n_threshold:'교착 인내',v_s_base:'기본 만족도',w_rep:'평판 비중',w_info:'정보 비중',u_threshold:'근접거래',u_aspiration:'수락 기준',w_p:'가격 비중',w_t:'시간 비중',w_r:'신뢰 비중',w_s:'만족 비중',persona_desc:'전략 유형'};
  document.getElementById('strategyParams').innerHTML = Object.entries(s).map(([k,v]) => {
    const l = labels[k]||k;
    const val = (k==='p_target'||k==='p_limit') ? '$'+v : k==='t_deadline' ? (v>=3600?Math.round(v/3600)+'시간':Math.round(v/60)+'분') : v;
    return '<div class="sp-item"><span class="sp-label">'+l+'</span><span class="sp-val">'+val+'</span></div>';
  }).join('');
}

function retryStrategy() {
  currentStrategy = null;
  document.getElementById('phaseBadge').textContent = '1/3 전략 수립';
  document.getElementById('phaseBadge').className = 'phase-badge phase-chat';
  document.getElementById('chatInput').style.display = 'flex';
  document.getElementById('strategyConfirm').classList.remove('show');
  fetch('/api/reset', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:SESSION_ID})});
  document.getElementById('chatMessages').innerHTML = '';
  addMessage('assistant', '다시 처음부터 상담해볼게요!\\n\\n1. 목표 가격?\\n2. 최대 예산?\\n3. 데드라인? (오늘/이번 주/여유)\\n4. 협상 스타일? (적극/보통/빨리끝내기)\\n5. 가장 중요한 것? (가격/속도/신뢰)');
}

async function confirmStrategy() {
  if (!currentStrategy) return;
  document.getElementById('phaseBadge').textContent = '3/3 협상 진행 중...';
  document.getElementById('phaseBadge').className = 'phase-badge phase-negotiate';
  document.getElementById('strategyConfirm').classList.remove('show');
  addMessage('assistant', '전략이 확정되었습니다! 판매자 Bob과 자동 협상을 시작합니다...');

  // Show results panel with streaming placeholder
  document.getElementById('emptyResults').style.display = 'none';
  const el = document.getElementById('resultsContent');
  el.style.display = 'block';
  el.innerHTML = '<div class="result-header"><h2 style="font-size:16px;color:#ccc">협상 진행 중...</h2><div id="streamStatus" style="font-size:12px;color:#f39c12;margin-top:8px">라운드 대기 중...</div></div><div id="streamRounds"></div>';

  const allRounds = [];

  try {
    // Use fetch + ReadableStream for SSE (POST not supported by EventSource)
    const resp = await fetch('/api/negotiate', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ strategy: currentStrategy }),
    });

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE events from buffer
      const lines = buffer.split('\\n');
      buffer = lines.pop() || '';

      let eventType = '';
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7);
        } else if (line.startsWith('data: ') && eventType) {
          try {
            const data = JSON.parse(line.slice(6));
            handleSSE(eventType, data, allRounds, el);
          } catch {}
          eventType = '';
        }
      }
    }
  } catch (err) {
    addMessage('assistant', '협상 중 오류: ' + err.message);
  }
}

function handleSSE(event, data, allRounds, el) {
  if (event === 'round') {
    allRounds.push(data);
    document.getElementById('streamStatus').textContent = 'Round ' + data.round + ' — AI가 대화 중...';
    addMessage('assistant', 'Round ' + data.round + ': Alice $' + data.buyerPrice + ' vs Bob $' + data.sellerPrice + ' (Gap $' + data.gap + ')');

    // Append round card with placeholder for messages
    const container = document.getElementById('streamRounds');
    const r = data;
    let h = '<div class="round-item" id="round-'+r.round+'"><div class="round-top"><span class="round-num">Round '+r.round+'</span><span class="round-gap">Gap $'+r.gap+'</span></div>';
    h += '<div class="round-body">';
    h += '<div class="party buyer"><div class="party-name buyer">Alice (당신)</div><div><span class="party-price">$'+r.buyerPrice+'</span><span class="party-decision">'+r.buyerDecision+'</span></div>';
    h += uBars(r.buyerUtility,'#3498db');
    h += '<div class="party-msg" id="bmsg-'+r.round+'" style="opacity:0.3">AI 생성 중...</div>';
    h += '</div><div class="vs">VS</div>';
    h += '<div class="party seller"><div class="party-name seller">Bob (판매자)</div><div><span class="party-price">$'+r.sellerPrice+'</span><span class="party-decision">'+r.sellerDecision+'</span></div>';
    h += uBars(r.sellerUtility,'#e74c3c');
    h += '<div class="party-msg" id="smsg-'+r.round+'" style="opacity:0.3">AI 생성 중...</div>';
    h += '</div></div>';
    h += '<div class="round-footer" id="rfooter-'+r.round+'"></div></div>';
    container.innerHTML += h;
    container.scrollTop = container.scrollHeight;
  }

  if (event === 'messages') {
    // Fill in LLM-generated messages for this round
    const bEl = document.getElementById('bmsg-'+data.round);
    const sEl = document.getElementById('smsg-'+data.round);
    const fEl = document.getElementById('rfooter-'+data.round);
    if (bEl) { bEl.textContent = data.buyerMessage; bEl.style.opacity = '1'; }
    if (sEl) { sEl.textContent = data.sellerMessage; sEl.style.opacity = '1'; }
    if (fEl) { fEl.textContent = '토큰: '+data.tokens+' | $'+(data.cost||0).toFixed(4); }
    document.getElementById('streamStatus').textContent = 'Round ' + data.round + ' 완료';
    // Update allRounds with messages
    const r = allRounds.find(r => r.round === data.round);
    if (r) { r.buyerMessage = data.buyerMessage; r.sellerMessage = data.sellerMessage; r.tokens = data.tokens; r.cost = data.cost; }
  }

  if (event === 'done') {
    document.getElementById('phaseBadge').textContent = '완료';
    document.getElementById('phaseBadge').className = 'phase-badge phase-strategy';

    // Update header with final result
    const headerEl = el.querySelector('.result-header');
    let hdr = '<h2 style="font-size:16px;color:#ccc">협상 결과</h2>';
    hdr += '<div class="result-deal '+(data.deal?'deal':'nodeal')+'">'+(data.deal?'DEAL $'+data.finalPrice:'NO DEAL')+'</div>';
    hdr += '<div class="result-cards">';
    hdr += rc('절약',data.deal?'$'+data.savings+' ('+data.savingsPercent+'%)':'-');
    hdr += rc('라운드',data.roundCount);
    hdr += rc('수락자',data.acceptedBy||'-');
    hdr += rc('토큰',data.totalTokens.toLocaleString());
    hdr += rc('LLM 비용','$'+data.totalCost.toFixed(4));
    hdr += rc('소요시간',(data.durationMs/1000).toFixed(1)+'s');
    hdr += '</div>';
    headerEl.innerHTML = hdr;

    // Add chart before rounds
    const chartData = { rounds: allRounds, deal: data.deal, finalPrice: data.finalPrice };
    const chartHtml = renderChart(chartData);
    const roundsEl = document.getElementById('streamRounds');
    roundsEl.insertAdjacentHTML('beforebegin', chartHtml);

    // Add new strategy button
    roundsEl.innerHTML += '<button class="btn-new" onclick="retryStrategy()">새로운 전략으로 다시 협상</button>';

    if (data.deal) {
      addMessage('assistant', '협상 완료! $'+data.finalPrice+'에 거래 성사! $'+data.savings+' ('+data.savingsPercent+'%) 절약! ('+(data.durationMs/1000).toFixed(1)+'초 소요)');
    } else {
      let msg = '아쉽게도 거래가 성사되지 않았어요.';
      if (data.noMatchReason) msg += '\\n\\n원인: ' + data.noMatchReason;
      else msg += ' 전략을 조정해서 다시 시도해볼까요?';
      addMessage('assistant', msg);
    }
  }
}

function renderResults(data) {
  document.getElementById('emptyResults').style.display = 'none';
  const el = document.getElementById('resultsContent');
  el.style.display = 'block';
  let h = '<div class="result-header"><h2 style="font-size:16px;color:#ccc">협상 결과</h2>';
  h += '<div class="result-deal '+(data.deal?'deal':'nodeal')+'">'+(data.deal?'DEAL $'+data.finalPrice:'NO DEAL')+'</div></div>';
  h += '<div class="result-cards">';
  h += rc('절약',data.deal?'$'+data.savings+' ('+data.savingsPercent+'%)':'-');
  h += rc('라운드',data.rounds.length);
  h += rc('수락자',data.acceptedBy||'-');
  h += rc('토큰',data.totalTokens.toLocaleString());
  h += rc('LLM 비용','$'+data.totalCost.toFixed(4));
  h += '</div>';
  h += renderChart(data);
  h += '<h3 style="font-size:14px;color:#888;margin:12px 0 8px">라운드별 상세</h3>';
  data.rounds.forEach(r => {
    h += '<div class="round-item"><div class="round-top"><span class="round-num">Round '+r.round+'</span><span class="round-gap">Gap $'+r.gap+'</span></div>';
    h += '<div class="round-body">';
    h += '<div class="party buyer"><div class="party-name buyer">Alice (당신)</div><div><span class="party-price">$'+r.buyerPrice+'</span><span class="party-decision">'+r.buyerDecision+'</span></div>';
    h += uBars(r.buyerUtility,'#3498db');
    if (r.buyerMessage) h += '<div class="party-msg">'+esc(r.buyerMessage)+'</div>';
    h += '</div><div class="vs">VS</div>';
    h += '<div class="party seller"><div class="party-name seller">Bob (판매자)</div><div><span class="party-price">$'+r.sellerPrice+'</span><span class="party-decision">'+r.sellerDecision+'</span></div>';
    h += uBars(r.sellerUtility,'#e74c3c');
    if (r.sellerMessage) h += '<div class="party-msg">'+esc(r.sellerMessage)+'</div>';
    h += '</div></div>';
    h += '<div class="round-footer">토큰: '+r.tokens+' | $'+r.cost.toFixed(4)+'</div></div>';
  });
  h += '<button class="btn-new" onclick="retryStrategy()">새로운 전략으로 다시 협상</button>';
  el.innerHTML = h;
}
function rc(l,v) { return '<div class="rc"><div class="rc-label">'+l+'</div><div class="rc-val">'+v+'</div></div>'; }
function uBars(u,c) { if (!u||u.u_total===0) return ''; return '<div class="u-bars">'+uRow('U',u.u_total,c)+uRow('Vp',u.v_p,'#2ecc71')+uRow('Vt',u.v_t,'#f39c12')+'</div>'; }
function uRow(l,v,c) { const w=Math.max(2,Math.min(100,v*100)); return '<div class="u-row"><span class="u-lbl">'+l+'</span><div class="u-track"><div class="u-fill" style="width:'+w+'%;background:'+c+'"></div></div><span class="u-num">'+v.toFixed(3)+'</span></div>'; }
function renderChart(data) {
  if (!data.rounds.length) return '';
  const W=400,H=160,prices=data.rounds.flatMap(r=>[r.buyerPrice,r.sellerPrice]);
  const mn=Math.min(...prices)-20,mx=Math.max(...prices)+20;
  const toY=p=>H-((p-mn)/(mx-mn))*H, toX=i=>20+(i/Math.max(1,data.rounds.length-1))*(W-40);
  let bP='',sP='',dots='';
  data.rounds.forEach((r,i) => {
    const x=toX(i).toFixed(0),yb=toY(r.buyerPrice).toFixed(0),ys=toY(r.sellerPrice).toFixed(0);
    bP+=(i===0?'M':'L')+x+','+yb; sP+=(i===0?'M':'L')+x+','+ys;
    dots+='<circle cx="'+x+'" cy="'+yb+'" r="3" fill="#3498db"/><text x="'+x+'" y="'+(+yb-8)+'" fill="#3498db" text-anchor="middle" font-size="10">$'+r.buyerPrice+'</text>';
    dots+='<circle cx="'+x+'" cy="'+ys+'" r="3" fill="#e74c3c"/><text x="'+x+'" y="'+(+ys+14)+'" fill="#e74c3c" text-anchor="middle" font-size="10">$'+r.sellerPrice+'</text>';
  });
  let dl='';
  if (data.deal&&data.finalPrice) { const dy=toY(data.finalPrice).toFixed(0); dl='<line x1="20" y1="'+dy+'" x2="'+(W-20)+'" y2="'+dy+'" stroke="#2ecc71" stroke-width="1.5" stroke-dasharray="5,3"/><text x="'+(W-15)+'" y="'+(+dy+4)+'" fill="#2ecc71" font-size="10">$'+data.finalPrice+'</text>'; }
  return '<div class="chart-box"><svg width="'+W+'" height="'+(H+16)+'" viewBox="0 -8 '+W+' '+(H+24)+'"><path d="'+bP+'" fill="none" stroke="#3498db" stroke-width="2"/><path d="'+sP+'" fill="none" stroke="#e74c3c" stroke-width="2"/>'+dl+dots+'</svg><div class="chart-legend"><span><span class="legend-dot" style="background:#3498db"></span> Alice</span><span><span class="legend-dot" style="background:#e74c3c"></span> Bob</span>'+(data.deal?'<span><span class="legend-dot" style="background:#2ecc71"></span> 거래가</span>':'')+'</div></div>';
}
</script>
</body>
</html>`;
}
