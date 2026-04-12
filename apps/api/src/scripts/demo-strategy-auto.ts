/**
 * Haggle 전략 기반 자동 협상 데모
 *
 * 1) 판매자(Bob) 리스팅 + 전략 미리 생성
 * 2) 구매자(Alice) 전략 생성
 * 3) 엔진(executeRound)이 양쪽 자동 협상 — 라운드별 결정
 * 4) Grok 4 Fast가 양쪽 자연어 메시지 생성
 * 5) HTML 대시보드 출력 (전략 시각화 + 라운드별 프로토콜)
 *
 * Usage:
 *   source apps/api/.env && XAI_API_KEY=$XAI_API_KEY npx tsx apps/api/src/scripts/demo-strategy-auto.ts
 *   → docs/demo-strategy-auto.html
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  executeRound,
  type MasterStrategy,
  type RoundData,
  type NegotiationSession,
  type RoundResult,
} from '@haggle/engine-session';

// ─── Config ──────────────────────────────────────────────────

const XAI_API_BASE = 'https://api.x.ai/v1';
const MODEL = process.env.XAI_MODEL ?? 'grok-4-fast';
const PRICE_INPUT_PER_M = 0.20;
const PRICE_OUTPUT_PER_M = 0.50;

const ITEM = 'iPhone 15 Pro 256GB Space Black (미개봉)';
const MARKET_PRICE = 1_050;
const MAX_ROUNDS = 10;

// ─── Types ───────────────────────────────────────────────────

interface RoundLog {
  round: number;
  // Engine results
  buyer_result: RoundResult;
  seller_result: RoundResult;
  // LLM messages
  buyer_message?: string;
  seller_message?: string;
  buyer_llm?: { tokens: { input: number; output: number }; cost: number; latency_ms: number; prompt: string; raw: string };
  seller_llm?: { tokens: { input: number; output: number }; cost: number; latency_ms: number; prompt: string; raw: string };
  // State
  buyer_offer: number;
  seller_offer: number;
  gap: number;
  buyer_utility: number;
  seller_utility: number;
}

// ─── Strategies ──────────────────────────────────────────────

function createBuyerStrategy(): MasterStrategy {
  return {
    id: 'buyer-alice-001',
    user_id: 'alice',
    weights: { w_p: 0.45, w_t: 0.20, w_r: 0.15, w_s: 0.20 },
    p_target: 880,    // 목표가: $880 (시장가 대비 -16%)
    p_limit: 1000,    // 한계가: $1,000 (이 이상 절대 지불 안 함)
    alpha: 0.1,
    beta: 1.0,        // 선형 양보
    t_deadline: 1800,  // 30분
    v_t_floor: 0.05,
    n_threshold: 3,
    v_s_base: 0.5,
    w_rep: 0.6,
    w_info: 0.4,
    // makeDecision 로직: u >= u_aspiration → ACCEPT, u >= u_threshold → NEAR_DEAL
    u_threshold: 0.55,  // NEAR_DEAL 기준
    u_aspiration: 0.78, // ACCEPT 기준 (높을수록 까다로움)
    persona: 'price-sensitive-buyer',
    created_at: Date.now(),
    expires_at: Date.now() + 86400000,
  };
}

function createSellerStrategy(): MasterStrategy {
  return {
    id: 'seller-bob-001',
    user_id: 'bob',
    weights: { w_p: 0.50, w_t: 0.15, w_r: 0.15, w_s: 0.20 },
    p_target: 1120,   // 목표가: $1,120 (프리미엄 가격)
    p_limit: 920,     // 한계가: $920 (이 이하 절대 안 팔음)
    alpha: 0.1,
    beta: 1.0,        // 선형 양보
    t_deadline: 1800,
    v_t_floor: 0.05,
    n_threshold: 3,
    v_s_base: 0.5,
    w_rep: 0.6,
    w_info: 0.4,
    // makeDecision 로직: u >= u_aspiration → ACCEPT, u >= u_threshold → NEAR_DEAL
    u_threshold: 0.50,
    u_aspiration: 0.80, // ACCEPT 기준
    persona: 'firm-but-fair-seller',
    created_at: Date.now(),
    expires_at: Date.now() + 86400000,
  };
}

// ─── Sessions ────────────────────────────────────────────────

function createSession(role: 'BUYER' | 'SELLER', strategyId: string): NegotiationSession {
  return {
    session_id: `sess-${role.toLowerCase()}-001`,
    strategy_id: strategyId,
    role,
    status: 'CREATED',
    counterparty_id: role === 'BUYER' ? 'bob' : 'alice',
    rounds: [],
    current_round: 0,
    rounds_no_concession: 0,
    last_offer_price: null,
    last_utility: null,
    created_at: Date.now(),
    updated_at: Date.now(),
  };
}

// ─── LLM Message Generation ─────────────────────────────────

function getApiKey(): string {
  const key = process.env.XAI_API_KEY;
  if (!key) {
    console.error('❌ XAI_API_KEY 환경변수를 설정해주세요.');
    process.exit(1);
  }
  return key;
}

async function generateMessage(
  role: 'BUYER' | 'SELLER',
  decision: string,
  price: number,
  round: number,
  history: Array<{ round: number; buyer: number; seller: number; gap: number }>,
  reasoning: string,
): Promise<{ message: string; tokens: { input: number; output: number }; cost: number; latency_ms: number; prompt: string; raw: string }> {
  const roleName = role === 'BUYER' ? 'Alice (구매자)' : 'Bob (판매자)';
  const opponent = role === 'BUYER' ? '판매자 Bob' : '구매자 Alice';

  const systemPrompt = `You are ${roleName}, negotiating for: ${ITEM}.
Market price: $${MARKET_PRICE}. You are a real person having a casual conversation.

RULES:
- Write a SHORT Korean message (under 60 characters)
- Be natural, friendly, conversational
- Reference the item naturally (미개봉, 새 제품, 프로 등)
- Decision: ${decision} at $${price}
- Round ${round}/${MAX_ROUNDS}
- Your reasoning: ${reasoning}

Respond ONLY with JSON: {"message":"your Korean message"}`;

  const historyStr = history.length > 0
    ? 'History:\n' + history.map(h => `R${h.round}: B$${h.buyer} / S$${h.seller} (gap $${h.gap})`).join('\n')
    : '(첫 라운드)';

  const userPrompt = `${historyStr}\n\nWrite your message for: ${decision} at $${price}`;

  const start = Date.now();
  const response = await fetch(`${XAI_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.6,
      max_tokens: 150,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`xAI API error ${response.status}: ${text}`);
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const raw = data.choices?.[0]?.message?.content ?? '{}';
  const latency = Date.now() - start;
  const tokens = {
    input: data.usage?.prompt_tokens ?? 0,
    output: data.usage?.completion_tokens ?? 0,
  };
  const cost = (tokens.input * PRICE_INPUT_PER_M + tokens.output * PRICE_OUTPUT_PER_M) / 1_000_000;

  let message: string;
  try {
    message = JSON.parse(raw).message ?? `$${price}에 ${decision === 'ACCEPT' ? '좋습니다!' : '제안합니다.'}`;
  } catch {
    message = `$${price}에 ${decision === 'ACCEPT' ? '좋습니다!' : '제안합니다.'}`;
  }

  return { message, tokens, cost, latency_ms: latency, prompt: systemPrompt + '\n---\n' + userPrompt, raw };
}

// ─── Main Loop ───────────────────────────────────────────────

async function main() {
  const buyerStrategy = createBuyerStrategy();
  const sellerStrategy = createSellerStrategy();

  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  🤖 Haggle 전략 기반 자동 협상 데모                              ║
╠══════════════════════════════════════════════════════════════════╣
║  📱 ${ITEM}                          ║
║  📊 시장가: $${MARKET_PRICE} | 모델: ${MODEL}                             ║
╠══════════════════════════════════════════════════════════════════╣
║  👤 구매자 Alice                                                 ║
║     목표 $${buyerStrategy.p_target} / 한계 $${buyerStrategy.p_limit} / beta ${buyerStrategy.beta} / u_th ${buyerStrategy.u_threshold}     ║
║  👤 판매자 Bob                                                   ║
║     목표 $${sellerStrategy.p_target} / 한계 $${sellerStrategy.p_limit} / beta ${sellerStrategy.beta} / u_th ${sellerStrategy.u_threshold}    ║
╚══════════════════════════════════════════════════════════════════╝
  `);

  let buyerSession = createSession('BUYER', buyerStrategy.id);
  let sellerSession = createSession('SELLER', sellerStrategy.id);

  // Initialize Faratin anchor to target prices (not floor/limit)
  // Without this, seller starts from p_limit (floor) due to executor.ts:81
  buyerSession.last_offer_price = buyerStrategy.p_target;   // $880 — buyer starts low
  sellerSession.last_offer_price = sellerStrategy.p_target;  // $1120 — seller starts high

  const roundLogs: RoundLog[] = [];
  const history: Array<{ round: number; buyer: number; seller: number; gap: number }> = [];

  let deal = false;
  let finalPrice: number | null = null;
  let acceptedBy: string | null = null;
  const startTime = Date.now();

  // Seller opening price
  let sellerCurrentOffer = sellerStrategy.p_target; // $1120
  let buyerCurrentOffer = 0;

  // Time simulation
  const timePerRound = 120; // seconds per round
  let elapsed = 0;

  for (let round = 1; round <= MAX_ROUNDS && !deal; round++) {
    elapsed += timePerRound + Math.floor(Math.random() * 60);

    console.log(`\n  ═══ Round ${round}/${MAX_ROUNDS} ═══════════════════════════════`);

    // ─── BUYER TURN ───
    // Buyer receives seller's offer, engine decides
    const buyerRoundData: RoundData = {
      p_effective: sellerCurrentOffer,
      r_score: 0.8,
      i_completeness: 0.9,
      t_elapsed: elapsed,
      n_success: 0,
      n_dispute_losses: 0,
    };

    const buyerOffer = {
      session_id: buyerSession.session_id,
      round,
      type: 'OFFER' as const,
      price: sellerCurrentOffer,
      sender_role: 'SELLER' as const,
      timestamp: Date.now(),
    };

    const buyerResult = executeRound(buyerSession, buyerStrategy, buyerOffer, buyerRoundData);

    // Override last_offer_price to buyer's own counter (not seller's)
    const buyerCounterPrice = Math.round(buyerResult.message.price);
    buyerSession = { ...buyerResult.session, last_offer_price: buyerCounterPrice };
    buyerCurrentOffer = buyerCounterPrice;

    const buyerDecision = buyerResult.decision;
    const buyerUtility = buyerResult.utility.u_total;

    console.log(`  🛒 Alice (구매자): ${buyerDecision} @ $${buyerCounterPrice}`);
    console.log(`     U=${buyerUtility.toFixed(3)} | V_p=${buyerResult.utility.v_p.toFixed(3)} V_t=${buyerResult.utility.v_t.toFixed(3)}`);
    console.log(`     상태: ${buyerSession.status}`);

    if (buyerDecision === 'ACCEPT') {
      deal = true;
      finalPrice = sellerCurrentOffer;
      acceptedBy = 'BUYER';
    }

    if (buyerDecision === 'REJECT' || buyerDecision === 'ESCALATE') {
      console.log(`  ❌ 구매자 ${buyerDecision} — 협상 종료`);
      // Still log this round
      const buyerLlm = await generateMessage('BUYER', buyerDecision, buyerCounterPrice, round, history, buyerResult.escalation?.context ?? 'rejected');
      roundLogs.push({
        round, buyer_result: buyerResult, seller_result: buyerResult, // placeholder
        buyer_message: buyerLlm.message, buyer_offer: buyerCounterPrice,
        seller_offer: sellerCurrentOffer, gap: Math.abs(sellerCurrentOffer - buyerCounterPrice),
        buyer_utility: buyerUtility, seller_utility: 0, buyer_llm: buyerLlm,
      });
      break;
    }

    // ─── SELLER TURN ───
    const sellerRoundData: RoundData = {
      p_effective: buyerCounterPrice,
      r_score: 0.8,
      i_completeness: 0.9,
      t_elapsed: elapsed + 30,
      n_success: 0,
      n_dispute_losses: 0,
    };

    const sellerOffer = {
      session_id: sellerSession.session_id,
      round,
      type: 'COUNTER' as const,
      price: buyerCounterPrice,
      sender_role: 'BUYER' as const,
      timestamp: Date.now(),
    };

    const sellerResult = executeRound(sellerSession, sellerStrategy, sellerOffer, sellerRoundData);

    const sellerCounterPrice = Math.round(sellerResult.message.price);
    sellerSession = { ...sellerResult.session, last_offer_price: sellerCounterPrice };
    sellerCurrentOffer = sellerCounterPrice;

    const sellerDecision = sellerResult.decision;
    const sellerUtility = sellerResult.utility.u_total;

    console.log(`  📦 Bob   (판매자): ${sellerDecision} @ $${sellerCounterPrice}`);
    console.log(`     U=${sellerUtility.toFixed(3)} | V_p=${sellerResult.utility.v_p.toFixed(3)} V_t=${sellerResult.utility.v_t.toFixed(3)}`);
    console.log(`     상태: ${sellerSession.status}`);

    if (sellerDecision === 'ACCEPT') {
      deal = true;
      finalPrice = buyerCounterPrice;
      acceptedBy = 'SELLER';
    }

    const gap = Math.abs(sellerCounterPrice - buyerCounterPrice);
    console.log(`  📊 Gap: $${gap} | Buyer $${buyerCounterPrice} ↔ Seller $${sellerCounterPrice}`);

    // Cross-detection: buyer willing to pay more than seller asks → deal at midpoint
    if (!deal && buyerCounterPrice >= sellerCounterPrice) {
      deal = true;
      finalPrice = Math.round((buyerCounterPrice + sellerCounterPrice) / 2);
      acceptedBy = 'CROSSED';
      console.log(`  🤝 교차 감지! Buyer $${buyerCounterPrice} ≥ Seller $${sellerCounterPrice} → 중간가 $${finalPrice}`);
    }

    history.push({ round, buyer: buyerCounterPrice, seller: sellerCounterPrice, gap });

    // ─── LLM Messages (parallel) ───
    const [buyerLlm, sellerLlm] = await Promise.all([
      generateMessage('BUYER', buyerDecision, buyerCounterPrice, round, history, buyerResult.utility.u_total.toFixed(2) + ' utility'),
      generateMessage('SELLER', sellerDecision, sellerCounterPrice, round, history, sellerResult.utility.u_total.toFixed(2) + ' utility'),
    ]);

    console.log(`  💬 Alice: "${buyerLlm.message}"`);
    console.log(`  💬 Bob:   "${sellerLlm.message}"`);

    const roundTokens = buyerLlm.tokens.input + buyerLlm.tokens.output + sellerLlm.tokens.input + sellerLlm.tokens.output;
    const roundCost = buyerLlm.cost + sellerLlm.cost;
    console.log(`  💰 토큰: ${roundTokens} | 비용: $${roundCost.toFixed(4)}`);

    roundLogs.push({
      round,
      buyer_result: buyerResult,
      seller_result: sellerResult,
      buyer_message: buyerLlm.message,
      seller_message: sellerLlm.message,
      buyer_llm: buyerLlm,
      seller_llm: sellerLlm,
      buyer_offer: buyerCounterPrice,
      seller_offer: sellerCounterPrice,
      gap,
      buyer_utility: buyerUtility,
      seller_utility: sellerUtility,
    });

    if (sellerDecision === 'REJECT' || sellerDecision === 'ESCALATE') {
      console.log(`  ❌ 판매자 ${sellerDecision} — 협상 종료`);
      break;
    }
  }

  const totalDuration = Date.now() - startTime;
  const totalTokens = roundLogs.reduce((sum, r) => {
    return sum + (r.buyer_llm?.tokens.input ?? 0) + (r.buyer_llm?.tokens.output ?? 0)
              + (r.seller_llm?.tokens.input ?? 0) + (r.seller_llm?.tokens.output ?? 0);
  }, 0);
  const totalCost = roundLogs.reduce((sum, r) => sum + (r.buyer_llm?.cost ?? 0) + (r.seller_llm?.cost ?? 0), 0);

  console.log(`\n  ═══════════════════════════════════════════════════════`);
  if (deal) {
    console.log(`  🎉 거래 성사! $${finalPrice} (${acceptedBy} 수락)`);
    const savings = MARKET_PRICE - (finalPrice ?? 0);
    console.log(`  💰 구매자 절약: $${savings} (${((savings / MARKET_PRICE) * 100).toFixed(1)}%)`);
  } else {
    console.log('  ❌ 거래 불성립');
  }
  console.log(`  📊 ${roundLogs.length}라운드 | ${totalTokens} 토큰 | $${totalCost.toFixed(4)} | ${(totalDuration / 1000).toFixed(1)}초`);

  // ─── Generate HTML Dashboard ─────────────────────────────────
  const html = generateDashboard(buyerStrategy, sellerStrategy, roundLogs, {
    deal, finalPrice, acceptedBy, totalTokens, totalCost, totalDuration,
  });
  const outPath = resolve('docs/demo-strategy-auto.html');
  writeFileSync(outPath, html);
  console.log(`  📄 대시보드: ${outPath}`);
  console.log(`     open docs/demo-strategy-auto.html`);
}

// ─── HTML Dashboard ──────────────────────────────────────────

function generateDashboard(
  buyerStrategy: MasterStrategy,
  sellerStrategy: MasterStrategy,
  rounds: RoundLog[],
  summary: { deal: boolean; finalPrice: number | null; acceptedBy: string | null; totalTokens: number; totalCost: number; totalDuration: number },
): string {
  const strategyCardHtml = (label: string, s: MasterStrategy, color: string) => {
    return `<div class="strategy-card" style="border-left:4px solid ${color}">
      <h3 style="color:${color}">${label}</h3>
      <div class="strategy-grid">
        <div class="s-item"><span class="s-label">목표가</span><span class="s-val">$${s.p_target}</span></div>
        <div class="s-item"><span class="s-label">한계가</span><span class="s-val">$${s.p_limit}</span></div>
        <div class="s-item"><span class="s-label">beta</span><span class="s-val">${s.beta}</span></div>
        <div class="s-item"><span class="s-label">u_threshold</span><span class="s-val">${s.u_threshold}</span></div>
        <div class="s-item"><span class="s-label">u_aspiration</span><span class="s-val">${s.u_aspiration}</span></div>
        <div class="s-item"><span class="s-label">w_p</span><span class="s-val">${s.weights.w_p}</span></div>
        <div class="s-item"><span class="s-label">w_t</span><span class="s-val">${s.weights.w_t}</span></div>
        <div class="s-item"><span class="s-label">w_r</span><span class="s-val">${s.weights.w_r}</span></div>
        <div class="s-item"><span class="s-label">w_s</span><span class="s-val">${s.weights.w_s}</span></div>
        <div class="s-item"><span class="s-label">persona</span><span class="s-val">${s.persona}</span></div>
      </div>
    </div>`;
  };

  const roundCardsHtml = rounds.map(r => {
    const buyerU = r.buyer_result.utility;
    const sellerU = r.seller_result.utility;
    const barWidth = (v: number) => Math.max(2, Math.min(100, v * 100));
    return `<div class="round-card">
      <div class="round-header">
        <span class="round-num">Round ${r.round}</span>
        <span class="round-gap">Gap $${r.gap}</span>
      </div>
      <div class="round-body">
        <div class="party buyer-side">
          <div class="party-label" style="color:#3498db">Alice (구매자)</div>
          <div class="price-tag">$${r.buyer_offer} <span class="decision-badge">${r.buyer_result.decision}</span></div>
          <div class="utility-bars">
            <div class="u-row"><span class="u-label">U_total</span><div class="u-bar"><div style="width:${barWidth(buyerU.u_total)}%;background:#3498db"></div></div><span class="u-val">${buyerU.u_total.toFixed(3)}</span></div>
            <div class="u-row"><span class="u-label">V_p</span><div class="u-bar"><div style="width:${barWidth(buyerU.v_p)}%;background:#2ecc71"></div></div><span class="u-val">${buyerU.v_p.toFixed(3)}</span></div>
            <div class="u-row"><span class="u-label">V_t</span><div class="u-bar"><div style="width:${barWidth(buyerU.v_t)}%;background:#f39c12"></div></div><span class="u-val">${buyerU.v_t.toFixed(3)}</span></div>
          </div>
          ${r.buyer_message ? `<div class="msg-bubble buyer-msg">"${r.buyer_message}"</div>` : ''}
        </div>
        <div class="vs-divider">VS</div>
        <div class="party seller-side">
          <div class="party-label" style="color:#e74c3c">Bob (판매자)</div>
          <div class="price-tag">$${r.seller_offer} <span class="decision-badge">${r.seller_result.decision}</span></div>
          <div class="utility-bars">
            <div class="u-row"><span class="u-label">U_total</span><div class="u-bar"><div style="width:${barWidth(sellerU.u_total)}%;background:#e74c3c"></div></div><span class="u-val">${sellerU.u_total.toFixed(3)}</span></div>
            <div class="u-row"><span class="u-label">V_p</span><div class="u-bar"><div style="width:${barWidth(sellerU.v_p)}%;background:#2ecc71"></div></div><span class="u-val">${sellerU.v_p.toFixed(3)}</span></div>
            <div class="u-row"><span class="u-label">V_t</span><div class="u-bar"><div style="width:${barWidth(sellerU.v_t)}%;background:#f39c12"></div></div><span class="u-val">${sellerU.v_t.toFixed(3)}</span></div>
          </div>
          ${r.seller_message ? `<div class="msg-bubble seller-msg">"${r.seller_message}"</div>` : ''}
        </div>
      </div>
      <div class="round-tokens">
        ${r.buyer_llm ? `Alice: ${r.buyer_llm.tokens.input}+${r.buyer_llm.tokens.output}tok $${r.buyer_llm.cost.toFixed(4)}` : ''}
        ${r.seller_llm ? ` | Bob: ${r.seller_llm.tokens.input}+${r.seller_llm.tokens.output}tok $${r.seller_llm.cost.toFixed(4)}` : ''}
      </div>
    </div>`;
  }).join('\n');

  // Price chart data
  const chartData = rounds.map(r => ({ round: r.round, buyer: r.buyer_offer, seller: r.seller_offer }));
  const allPrices = chartData.flatMap(d => [d.buyer, d.seller]);
  const priceMin = Math.min(...allPrices) - 30;
  const priceMax = Math.max(...allPrices) + 30;
  const chartHeight = 200;
  const chartWidth = 600;

  const toY = (price: number) => chartHeight - ((price - priceMin) / (priceMax - priceMin)) * chartHeight;
  const toX = (i: number) => (i / Math.max(1, chartData.length - 1)) * chartWidth;

  const buyerPath = chartData.map((d, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(0)},${toY(d.buyer).toFixed(0)}`).join(' ');
  const sellerPath = chartData.map((d, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(0)},${toY(d.seller).toFixed(0)}`).join(' ');

  const buyerDots = chartData.map((d, i) => `<circle cx="${toX(i).toFixed(0)}" cy="${toY(d.buyer).toFixed(0)}" r="4" fill="#3498db"/><text x="${toX(i).toFixed(0)}" y="${(toY(d.buyer) - 10).toFixed(0)}" fill="#3498db" text-anchor="middle" font-size="11">$${d.buyer}</text>`).join('');
  const sellerDots = chartData.map((d, i) => `<circle cx="${toX(i).toFixed(0)}" cy="${toY(d.seller).toFixed(0)}" r="4" fill="#e74c3c"/><text x="${toX(i).toFixed(0)}" y="${(toY(d.seller) + 18).toFixed(0)}" fill="#e74c3c" text-anchor="middle" font-size="11">$${d.seller}</text>`).join('');

  const dealLine = summary.deal && summary.finalPrice
    ? `<line x1="0" y1="${toY(summary.finalPrice).toFixed(0)}" x2="${chartWidth}" y2="${toY(summary.finalPrice).toFixed(0)}" stroke="#2ecc71" stroke-width="2" stroke-dasharray="8,4"/><text x="${chartWidth + 5}" y="${(toY(summary.finalPrice) + 4).toFixed(0)}" fill="#2ecc71" font-size="12">Deal $${summary.finalPrice}</text>`
    : '';

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>Haggle 전략 기반 자동 협상 데모</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { background:#0a0b0d; color:#e0e0e0; font-family:-apple-system,'Pretendard',sans-serif; line-height:1.5; padding:20px; }
.header { text-align:center; margin-bottom:24px; }
.header h1 { font-size:24px; background:linear-gradient(135deg,#3498db,#2ecc71); -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
.header .sub { color:#888; font-size:14px; margin-top:4px; }

.summary-cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:12px; margin-bottom:24px; }
.s-card { background:#12131a; border-radius:8px; padding:12px; text-align:center; border:1px solid #1e2130; }
.s-card .s-title { color:#888; font-size:11px; text-transform:uppercase; }
.s-card .s-value { font-size:22px; font-weight:700; margin-top:4px; }
.s-card .s-value.deal { color:#2ecc71; }
.s-card .s-value.nodeal { color:#e74c3c; }

.section { margin-bottom:24px; }
.section h2 { font-size:16px; color:#ccc; margin-bottom:12px; border-bottom:1px solid #1e2130; padding-bottom:8px; }

.strategies { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:24px; }
.strategy-card { background:#12131a; border-radius:8px; padding:16px; }
.strategy-card h3 { font-size:14px; margin-bottom:8px; }
.strategy-grid { display:grid; grid-template-columns:1fr 1fr; gap:4px; }
.s-item { display:flex; justify-content:space-between; font-size:12px; padding:2px 0; }
.s-label { color:#888; }
.s-val { color:#fff; font-weight:600; font-family:'SF Mono',monospace; }

.chart-container { background:#12131a; border-radius:8px; padding:20px; margin-bottom:24px; text-align:center; }
.chart-legend { display:flex; gap:20px; justify-content:center; margin-top:8px; font-size:12px; }
.legend-dot { width:10px; height:10px; border-radius:50%; display:inline-block; margin-right:4px; vertical-align:middle; }

.round-card { background:#12131a; border-radius:8px; padding:16px; margin-bottom:12px; border:1px solid #1e2130; }
.round-header { display:flex; justify-content:space-between; margin-bottom:12px; }
.round-num { font-weight:700; color:#fff; }
.round-gap { color:#f39c12; font-weight:600; font-size:13px; }
.round-body { display:grid; grid-template-columns:1fr 40px 1fr; gap:12px; }
.party-label { font-size:12px; font-weight:600; margin-bottom:4px; }
.price-tag { font-size:18px; font-weight:700; color:#f39c12; margin-bottom:8px; }
.decision-badge { font-size:10px; padding:2px 6px; border-radius:4px; background:#1e2130; color:#888; font-weight:600; vertical-align:middle; }
.vs-divider { display:flex; align-items:center; justify-content:center; color:#555; font-weight:700; font-size:12px; }

.utility-bars { margin-bottom:8px; }
.u-row { display:flex; align-items:center; gap:6px; margin-bottom:3px; }
.u-label { font-size:10px; color:#888; width:45px; text-align:right; }
.u-bar { flex:1; height:8px; background:#1a1b2e; border-radius:4px; overflow:hidden; }
.u-bar > div { height:100%; border-radius:4px; transition:width 0.3s; }
.u-val { font-size:10px; color:#aaa; width:40px; font-family:'SF Mono',monospace; }

.msg-bubble { font-size:12px; padding:6px 10px; border-radius:8px; margin-top:6px; }
.buyer-msg { background:#1a365d; border-left:3px solid #3498db; }
.seller-msg { background:#2d1a1a; border-left:3px solid #e74c3c; }

.round-tokens { font-size:11px; color:#666; margin-top:8px; text-align:center; border-top:1px solid #1e2130; padding-top:6px; }

.cost-table { width:100%; border-collapse:collapse; font-size:12px; }
.cost-table th { text-align:left; color:#888; padding:6px 8px; border-bottom:1px solid #1e2130; }
.cost-table td { padding:6px 8px; border-bottom:1px solid #0e0f15; font-family:'SF Mono',monospace; }
</style>
</head>
<body>
<div class="header">
  <h1>Haggle 전략 기반 자동 협상 데모</h1>
  <div class="sub">${ITEM} | 시장가 $${MARKET_PRICE} | 모델: ${MODEL}</div>
</div>

<div class="summary-cards">
  <div class="s-card"><div class="s-title">결과</div><div class="s-value ${summary.deal ? 'deal' : 'nodeal'}">${summary.deal ? 'DEAL' : 'NO DEAL'}</div></div>
  <div class="s-card"><div class="s-title">최종 가격</div><div class="s-value">${summary.finalPrice ? '$' + summary.finalPrice : '—'}</div></div>
  <div class="s-card"><div class="s-title">절약</div><div class="s-value">${summary.finalPrice ? '$' + (MARKET_PRICE - summary.finalPrice) + ' (' + ((MARKET_PRICE - summary.finalPrice) / MARKET_PRICE * 100).toFixed(1) + '%)' : '—'}</div></div>
  <div class="s-card"><div class="s-title">라운드</div><div class="s-value">${rounds.length}</div></div>
  <div class="s-card"><div class="s-title">토큰</div><div class="s-value">${summary.totalTokens.toLocaleString()}</div></div>
  <div class="s-card"><div class="s-title">LLM 비용</div><div class="s-value">$${summary.totalCost.toFixed(4)}</div></div>
  <div class="s-card"><div class="s-title">소요 시간</div><div class="s-value">${(summary.totalDuration / 1000).toFixed(1)}s</div></div>
  <div class="s-card"><div class="s-title">수락자</div><div class="s-value">${summary.acceptedBy ?? '—'}</div></div>
</div>

<div class="section">
  <h2>전략 비교</h2>
  <div class="strategies">
    ${strategyCardHtml('Alice (구매자)', buyerStrategy, '#3498db')}
    ${strategyCardHtml('Bob (판매자)', sellerStrategy, '#e74c3c')}
  </div>
</div>

<div class="section">
  <h2>가격 수렴 차트</h2>
  <div class="chart-container">
    <svg width="${chartWidth + 80}" height="${chartHeight + 20}" viewBox="-10 -10 ${chartWidth + 100} ${chartHeight + 30}">
      <path d="${buyerPath}" fill="none" stroke="#3498db" stroke-width="2"/>
      <path d="${sellerPath}" fill="none" stroke="#e74c3c" stroke-width="2"/>
      ${dealLine}
      ${buyerDots}
      ${sellerDots}
    </svg>
    <div class="chart-legend">
      <span><span class="legend-dot" style="background:#3498db"></span> Alice (구매자)</span>
      <span><span class="legend-dot" style="background:#e74c3c"></span> Bob (판매자)</span>
      ${summary.deal ? '<span><span class="legend-dot" style="background:#2ecc71"></span> 최종 거래가</span>' : ''}
    </div>
  </div>
</div>

<div class="section">
  <h2>라운드별 상세</h2>
  ${roundCardsHtml}
</div>

<div class="section">
  <h2>LLM 비용 상세</h2>
  <table class="cost-table">
    <thead><tr><th>Round</th><th>Alice 입력</th><th>Alice 출력</th><th>Bob 입력</th><th>Bob 출력</th><th>비용</th></tr></thead>
    <tbody>
    ${rounds.map(r => {
      const bi = r.buyer_llm?.tokens.input ?? 0;
      const bo = r.buyer_llm?.tokens.output ?? 0;
      const si = r.seller_llm?.tokens.input ?? 0;
      const so = r.seller_llm?.tokens.output ?? 0;
      const cost = (r.buyer_llm?.cost ?? 0) + (r.seller_llm?.cost ?? 0);
      return `<tr><td>R${r.round}</td><td>${bi}</td><td>${bo}</td><td>${si}</td><td>${so}</td><td>$${cost.toFixed(4)}</td></tr>`;
    }).join('\n')}
    <tr style="font-weight:700;border-top:2px solid #333"><td>합계</td><td colspan="4">${summary.totalTokens.toLocaleString()} 토큰</td><td>$${summary.totalCost.toFixed(4)}</td></tr>
    </tbody>
  </table>
</div>

<div style="text-align:center;color:#555;font-size:11px;margin-top:20px">
  Generated by Haggle Strategy Auto-Negotiation Demo | ${new Date().toISOString()}
</div>
</body>
</html>`;
}

// ─── Run ─────────────────────────────────────────────────────

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
