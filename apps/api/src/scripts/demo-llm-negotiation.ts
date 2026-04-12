/**
 * Haggle LLM Demo — Grok 4 Fast 기반 AI 자동 협상
 *
 * 구매자 AI와 판매자 AI가 각각 Grok 4 Fast를 호출하여 협상합니다.
 * 모든 프롬프트, 응답, 토큰 사용량, 비용을 추적하고
 * HTML 대시보드로 출력합니다.
 *
 * Usage:
 *   XAI_API_KEY=xai-xxx npx tsx apps/api/src/scripts/demo-llm-negotiation.ts
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── Config ──────────────────────────────────────────────────

const XAI_API_BASE = 'https://api.x.ai/v1';
const MODEL = process.env.XAI_MODEL ?? 'grok-4-fast';
const PRICE_INPUT_PER_M = 0.20;   // $/M input tokens
const PRICE_OUTPUT_PER_M = 0.50;  // $/M output tokens

const ITEM = 'iPhone 15 Pro 256GB Space Black (미개봉)';
const MARKET_PRICE = 1_050;
const MAX_ROUNDS = 8;

// ─── Types ───────────────────────────────────────────────────

interface LLMResponse {
  action: 'COUNTER' | 'ACCEPT' | 'REJECT';
  price: number;
  reasoning: string;
  message_to_opponent: string;
}

interface RoundLog {
  round: number;
  role: 'BUYER' | 'SELLER';
  incoming_price: number;
  system_prompt: string;
  user_prompt: string;
  raw_response: string;
  parsed: LLMResponse;
  tokens: { input: number; output: number };
  cost_usd: number;
  latency_ms: number;
}

interface NegotiationResult {
  item: string;
  market_price: number;
  model: string;
  rounds: RoundLog[];
  deal: boolean;
  final_price: number | null;
  accepted_by: string | null;
  total_rounds: number;
  total_tokens: { input: number; output: number };
  total_cost_usd: number;
  total_duration_ms: number;
}

// ─── xAI API Call ────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.XAI_API_KEY;
  if (!key) {
    console.error('❌ XAI_API_KEY 환경변수를 설정해주세요.');
    console.error('   XAI_API_KEY=xai-xxx npx tsx apps/api/src/scripts/demo-llm-negotiation.ts');
    process.exit(1);
  }
  return key;
}

async function callGrok(
  systemPrompt: string,
  userPrompt: string,
): Promise<{ content: string; usage: { prompt_tokens: number; completion_tokens: number }; latency_ms: number }> {
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
      temperature: 0.4,
      max_tokens: 500,
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

  return {
    content: data.choices?.[0]?.message?.content ?? '',
    usage: {
      prompt_tokens: data.usage?.prompt_tokens ?? 0,
      completion_tokens: data.usage?.completion_tokens ?? 0,
    },
    latency_ms: Date.now() - start,
  };
}

// ─── Prompts ─────────────────────────────────────────────────

function buyerSystemPrompt(): string {
  return `You are a buyer's AI negotiation agent on Haggle, a P2P marketplace.

ITEM: ${ITEM}
MARKET PRICE (Swappa 30d median): $${MARKET_PRICE}

YOUR CONSTRAINTS:
- Target price: $880 (ideal)
- Maximum price: $1,000 (hard limit — NEVER accept above this)
- You want to save money but also close a fair deal
- Be strategic: start low, concede gradually, justify your offers

STRATEGY GUIDELINES:
- Round 1-2: Offer 15-20% below market. Cite comparable prices.
- Round 3-4: Concede $20-40 per round if seller is reasonable.
- Round 5+: If close to agreement, make final best offer.
- Accept if price ≤ $960 and seller seems firm.

RESPOND IN JSON:
{
  "action": "COUNTER" | "ACCEPT" | "REJECT",
  "price": <your counter-offer price as integer, or accepted price>,
  "reasoning": "<1-2 sentences explaining your internal decision logic>",
  "message_to_opponent": "<what you'd say to the seller — natural, conversational Korean>"
}`;
}

function sellerSystemPrompt(): string {
  return `You are a seller's AI negotiation agent on Haggle, a P2P marketplace.

ITEM: ${ITEM}
MARKET PRICE (Swappa 30d median): $${MARKET_PRICE}

YOUR CONSTRAINTS:
- Target price: $1,100 (ideal)
- Minimum price: $920 (hard limit — NEVER accept below this)
- You want to maximize revenue but also close the deal
- The item is sealed/unopened — premium condition

STRATEGY GUIDELINES:
- Round 1: List at $1,120 (above market, premium condition).
- Round 2-3: Concede $30-50 per round if buyer is reasonable.
- Round 4-5: Show willingness to close, but protect minimum.
- Accept if price ≥ $960 and buyer seems serious.

RESPOND IN JSON:
{
  "action": "COUNTER" | "ACCEPT" | "REJECT",
  "price": <your counter-offer price as integer, or accepted price>,
  "reasoning": "<1-2 sentences explaining your internal decision logic>",
  "message_to_opponent": "<what you'd say to the buyer — natural, conversational Korean>"
}`;
}

function buildUserPrompt(
  role: 'BUYER' | 'SELLER',
  round: number,
  incomingPrice: number,
  history: Array<{ round: number; buyer_price: number; seller_price: number }>,
): string {
  const lines: string[] = [];

  lines.push(`=== Round ${round} ===`);
  lines.push(`You received an ${role === 'BUYER' ? "seller's offer" : "buyer's offer"}: $${incomingPrice}`);
  lines.push('');

  if (history.length > 0) {
    lines.push('NEGOTIATION HISTORY:');
    for (const h of history) {
      lines.push(`  Round ${h.round}: Buyer $${h.buyer_price} ↔ Seller $${h.seller_price}`);
    }
    lines.push('');
  }

  lines.push(`This is round ${round} of maximum ${MAX_ROUNDS}.`);
  if (round >= MAX_ROUNDS - 1) {
    lines.push('⚠️ This is nearly the last round. Consider closing the deal if reasonable.');
  }

  lines.push('');
  lines.push('Decide: COUNTER (with your price), ACCEPT, or REJECT.');

  return lines.join('\n');
}

// ─── Main ────────────────────────────────────────────────────

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  🤖 Haggle LLM Demo — Grok 4 Fast 기반 AI 협상             ║
╠══════════════════════════════════════════════════════════════╣
║  📱 ${ITEM.padEnd(50)}║
║  📊 시장가: $${MARKET_PRICE} | 모델: ${MODEL.padEnd(30)}║
║  💰 가격: $${PRICE_INPUT_PER_M}/M input, $${PRICE_OUTPUT_PER_M}/M output          ║
╚══════════════════════════════════════════════════════════════╝
  `);

  const rounds: RoundLog[] = [];
  const history: Array<{ round: number; buyer_price: number; seller_price: number }> = [];

  let currentPrice = 1_120; // Seller's opening price
  let deal = false;
  let finalPrice: number | null = null;
  let acceptedBy: string | null = null;
  const startTime = Date.now();

  for (let round = 1; round <= MAX_ROUNDS && !deal; round++) {
    // ─── BUYER TURN ───
    console.log(`  ─── Round ${round} 🛒 구매자 AI ─────────────────────`);
    console.log(`  │ 받은 가격: $${currentPrice}`);

    const buyerSys = buyerSystemPrompt();
    const buyerUsr = buildUserPrompt('BUYER', round, currentPrice, history);

    let buyerParsed: LLMResponse;
    let buyerRaw: string;
    let buyerTokens: { input: number; output: number };
    let buyerLatency: number;

    try {
      const resp = await callGrok(buyerSys, buyerUsr);
      buyerRaw = resp.content;
      buyerTokens = { input: resp.usage.prompt_tokens, output: resp.usage.completion_tokens };
      buyerLatency = resp.latency_ms;
      buyerParsed = JSON.parse(buyerRaw) as LLMResponse;
      buyerParsed.price = Math.round(buyerParsed.price);
    } catch (e) {
      console.error(`  ❌ 구매자 API 호출 실패:`, e);
      break;
    }

    const buyerCost = (buyerTokens.input * PRICE_INPUT_PER_M + buyerTokens.output * PRICE_OUTPUT_PER_M) / 1_000_000;

    rounds.push({
      round, role: 'BUYER', incoming_price: currentPrice,
      system_prompt: buyerSys, user_prompt: buyerUsr,
      raw_response: buyerRaw, parsed: buyerParsed,
      tokens: buyerTokens, cost_usd: buyerCost, latency_ms: buyerLatency,
    });

    console.log(`  │ 결정: ${buyerParsed.action}${buyerParsed.action === 'COUNTER' ? ` → $${buyerParsed.price}` : ''}`);
    console.log(`  │ 이유: ${buyerParsed.reasoning}`);
    console.log(`  │ 메시지: "${buyerParsed.message_to_opponent}"`);
    console.log(`  │ 토큰: ${buyerTokens.input}+${buyerTokens.output} = ${buyerTokens.input + buyerTokens.output} | $${buyerCost.toFixed(4)} | ${buyerLatency}ms`);
    console.log('');

    if (buyerParsed.action === 'ACCEPT') {
      deal = true;
      finalPrice = currentPrice;
      acceptedBy = 'BUYER';
      break;
    }
    if (buyerParsed.action === 'REJECT') {
      console.log('  ❌ 구매자가 협상을 거부했습니다.');
      break;
    }

    const buyerCounterPrice = buyerParsed.price;

    // ─── SELLER TURN ───
    console.log(`  ─── Round ${round} 🏪 판매자 AI ─────────────────────`);
    console.log(`  │ 받은 가격: $${buyerCounterPrice}`);

    const sellerSys = sellerSystemPrompt();
    const sellerUsr = buildUserPrompt('SELLER', round, buyerCounterPrice, history);

    let sellerParsed: LLMResponse;
    let sellerRaw: string;
    let sellerTokens: { input: number; output: number };
    let sellerLatency: number;

    try {
      const resp = await callGrok(sellerSys, sellerUsr);
      sellerRaw = resp.content;
      sellerTokens = { input: resp.usage.prompt_tokens, output: resp.usage.completion_tokens };
      sellerLatency = resp.latency_ms;
      sellerParsed = JSON.parse(sellerRaw) as LLMResponse;
      sellerParsed.price = Math.round(sellerParsed.price);
    } catch (e) {
      console.error(`  ❌ 판매자 API 호출 실패:`, e);
      break;
    }

    const sellerCost = (sellerTokens.input * PRICE_INPUT_PER_M + sellerTokens.output * PRICE_OUTPUT_PER_M) / 1_000_000;

    rounds.push({
      round, role: 'SELLER', incoming_price: buyerCounterPrice,
      system_prompt: sellerSys, user_prompt: sellerUsr,
      raw_response: sellerRaw, parsed: sellerParsed,
      tokens: sellerTokens, cost_usd: sellerCost, latency_ms: sellerLatency,
    });

    console.log(`  │ 결정: ${sellerParsed.action}${sellerParsed.action === 'COUNTER' ? ` → $${sellerParsed.price}` : ''}`);
    console.log(`  │ 이유: ${sellerParsed.reasoning}`);
    console.log(`  │ 메시지: "${sellerParsed.message_to_opponent}"`);
    console.log(`  │ 토큰: ${sellerTokens.input}+${sellerTokens.output} = ${sellerTokens.input + sellerTokens.output} | $${sellerCost.toFixed(4)} | ${sellerLatency}ms`);
    console.log('');

    if (sellerParsed.action === 'ACCEPT') {
      deal = true;
      finalPrice = buyerCounterPrice;
      acceptedBy = 'SELLER';
      break;
    }
    if (sellerParsed.action === 'REJECT') {
      console.log('  ❌ 판매자가 협상을 거부했습니다.');
      break;
    }

    // Record history
    history.push({
      round,
      buyer_price: buyerCounterPrice,
      seller_price: sellerParsed.price,
    });

    currentPrice = sellerParsed.price;
  }

  const totalDuration = Date.now() - startTime;
  const totalTokens = rounds.reduce(
    (acc, r) => ({ input: acc.input + r.tokens.input, output: acc.output + r.tokens.output }),
    { input: 0, output: 0 },
  );
  const totalCost = rounds.reduce((acc, r) => acc + r.cost_usd, 0);

  const result: NegotiationResult = {
    item: ITEM,
    market_price: MARKET_PRICE,
    model: MODEL,
    rounds,
    deal,
    final_price: finalPrice,
    accepted_by: acceptedBy,
    total_rounds: Math.max(...rounds.map(r => r.round)),
    total_tokens: totalTokens,
    total_cost_usd: totalCost,
    total_duration_ms: totalDuration,
  };

  // ─── Summary ───
  console.log('');
  if (deal) {
    console.log(`  🎉 거래 성사! $${finalPrice} (${acceptedBy} 수락)`);
  } else {
    console.log('  ❌ 거래 불성사');
  }
  console.log(`  📊 총 ${result.total_rounds}라운드 | ${totalTokens.input + totalTokens.output} tokens | $${totalCost.toFixed(4)} | ${(totalDuration / 1000).toFixed(1)}s`);

  // ─── Generate HTML Dashboard ───
  const htmlPath = resolve(import.meta.dirname, '../../../../docs/demo-llm-negotiation.html');
  writeFileSync(htmlPath, generateDashboard(result), 'utf-8');
  console.log(`  📄 대시보드: ${htmlPath}`);
  console.log('     open docs/demo-llm-negotiation.html');
}

// ─── HTML Dashboard Generator ────────────────────────────────

function renderChartBar(p: { round: number; role: string; price: number }, isDeal: boolean): string {
  const minP = 850;
  const maxP = 1150;
  const pct = ((p.price - minP) / (maxP - minP)) * 100;
  const cls = isDeal ? 'deal' : p.role === 'S' ? 'seller' : 'buyer';
  const label = p.round === 0 ? 'Start' : 'R' + p.round + ' ' + p.role;
  const dealTag = isDeal ? '<span style="color:#2ecc71;font-weight:700"> ✅ DEAL</span>' : '';
  return '<div class="chart-bar">' +
    '<span class="chart-label">' + label + '</span>' +
    '<span class="chart-price">$' + p.price + '</span>' +
    '<div class="chart-fill ' + cls + '" style="width: ' + Math.max(2, pct) + '%"></div>' +
    dealTag + '</div>';
}

function renderPricingRow(r: RoundLog): string {
  const roleLabel = r.role === 'BUYER' ? '🛒 구매자' : '🏪 판매자';
  return '<tr>' +
    '<td>R' + r.round + ' ' + roleLabel + '</td>' +
    '<td>' + r.tokens.input + ' in + ' + r.tokens.output + ' out</td>' +
    '<td>$' + PRICE_INPUT_PER_M + '/M + $' + PRICE_OUTPUT_PER_M + '/M</td>' +
    '<td>$' + r.cost_usd.toFixed(4) + '</td></tr>';
}

function renderRoundCard(r: RoundLog): string {
  const icon = r.role === 'BUYER' ? '🛒' : '🏪';
  const name = r.role === 'BUYER' ? 'Alice (구매자 AI)' : 'Bob (판매자 AI)';
  const actionClass = r.parsed.action === 'ACCEPT' ? 'accept' : r.parsed.action === 'REJECT' ? 'reject' : 'counter';
  const actionLabel = r.parsed.action === 'COUNTER' ? '역제안 → $' + r.parsed.price : r.parsed.action;
  const counterHtml = r.parsed.action === 'COUNTER'
    ? '<span class="arrow">→</span><span class="outgoing">역제안: <strong>$' + r.parsed.price + '</strong></span>'
    : '';

  return '<div class="round-card ' + actionClass + '">' +
    '<div class="round-header">' +
    '<span class="round-badge">R' + r.round + '</span>' +
    '<span class="role-icon">' + icon + '</span>' +
    '<span class="role-name">' + name + '</span>' +
    '<span class="action-badge ' + actionClass + '">' + actionLabel + '</span>' +
    '</div>' +
    '<div class="round-body">' +
    '<div class="price-flow">' +
    '<span class="incoming">받은 제안: <strong>$' + r.incoming_price + '</strong></span>' +
    counterHtml +
    '</div>' +
    '<div class="message-bubble ' + r.role.toLowerCase() + '">' +
    '"' + escHtml(r.parsed.message_to_opponent) + '"' +
    '</div>' +
    '<div class="reasoning">' +
    '<span class="reasoning-label">🧠 내부 추론:</span> ' + escHtml(r.parsed.reasoning) +
    '</div>' +
    '<div class="meta-row">' +
    '<span class="meta-item">📥 ' + r.tokens.input + ' in</span>' +
    '<span class="meta-item">📤 ' + r.tokens.output + ' out</span>' +
    '<span class="meta-item">💰 $' + r.cost_usd.toFixed(4) + '</span>' +
    '<span class="meta-item">⏱️ ' + r.latency_ms + 'ms</span>' +
    '</div>' +
    '<details class="prompt-detail">' +
    '<summary>프롬프트 보기</summary>' +
    '<div class="prompt-section"><div class="prompt-label">System Prompt</div>' +
    '<pre class="prompt-text">' + escHtml(r.system_prompt) + '</pre></div>' +
    '<div class="prompt-section"><div class="prompt-label">User Prompt</div>' +
    '<pre class="prompt-text">' + escHtml(r.user_prompt) + '</pre></div>' +
    '<div class="prompt-section"><div class="prompt-label">Raw Response</div>' +
    '<pre class="prompt-text">' + escHtml(r.raw_response) + '</pre></div>' +
    '</details></div></div>';
}

function generateDashboard(result: NegotiationResult): string {
  const { rounds, deal, final_price, total_rounds, total_tokens, total_cost_usd, total_duration_ms } = result;

  // Price chart data
  const pricePoints: Array<{ round: number; role: string; price: number }> = [{ round: 0, role: 'S', price: 1120 }];
  for (const r of rounds) {
    if (r.parsed.action === 'ACCEPT') {
      pricePoints.push({ round: r.round, role: r.role === 'BUYER' ? 'B' : 'S', price: r.incoming_price });
    } else {
      pricePoints.push({ round: r.round, role: r.role === 'BUYER' ? 'B' : 'S', price: r.parsed.price });
    }
  }

  const chartBarsHtml = pricePoints.map((p, i) => {
    const isDeal = deal && p.price === final_price && i === pricePoints.length - 1;
    return renderChartBar(p, isDeal);
  }).join('\n');

  const roundCardsHtml = rounds.map(renderRoundCard).join('\n');
  const pricingRowsHtml = rounds.map(renderPricingRow).join('\n');

  const savings = deal && final_price ? MARKET_PRICE - final_price : 0;
  const savingsPct = deal && final_price ? ((savings / MARKET_PRICE) * 100).toFixed(1) : '0';

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Haggle LLM 협상 데모 — ${MODEL}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #0a0b0d;
    color: #e0e0e0;
    font-family: -apple-system, 'Pretendard', 'Noto Sans KR', sans-serif;
    line-height: 1.6;
    padding: 24px;
    max-width: 960px;
    margin: 0 auto;
  }
  a { color: #3498db; }

  /* Header */
  .header {
    text-align: center;
    padding: 32px 0;
    border-bottom: 1px solid #1a1d24;
    margin-bottom: 32px;
  }
  .header h1 {
    font-size: 28px;
    font-weight: 700;
    background: linear-gradient(135deg, #3498db, #2ecc71);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    margin-bottom: 8px;
  }
  .header .subtitle {
    color: #888;
    font-size: 14px;
  }

  /* Summary Cards */
  .summary-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
    margin-bottom: 32px;
  }
  .summary-card {
    background: #12141a;
    border: 1px solid #1e2130;
    border-radius: 12px;
    padding: 16px;
    text-align: center;
  }
  .summary-card .label {
    font-size: 12px;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 4px;
  }
  .summary-card .value {
    font-size: 24px;
    font-weight: 700;
    color: #fff;
  }
  .summary-card .sub {
    font-size: 11px;
    color: #666;
    margin-top: 2px;
  }
  .summary-card.deal { border-color: #2ecc7144; }
  .summary-card.deal .value { color: #2ecc71; }
  .summary-card.cost { border-color: #f39c1244; }
  .summary-card.cost .value { color: #f39c12; }

  /* Price Chart */
  .chart-section {
    background: #12141a;
    border: 1px solid #1e2130;
    border-radius: 12px;
    padding: 24px;
    margin-bottom: 32px;
  }
  .chart-section h2 {
    font-size: 16px;
    margin-bottom: 16px;
    color: #ccc;
  }
  .chart-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
    font-size: 13px;
    font-family: 'SF Mono', 'Fira Code', monospace;
  }
  .chart-label { width: 50px; text-align: right; color: #888; }
  .chart-price { width: 50px; text-align: right; }
  .chart-fill { height: 22px; border-radius: 4px; min-width: 4px; transition: width 0.3s; }
  .chart-fill.buyer { background: linear-gradient(90deg, #3498db, #2980b9); }
  .chart-fill.seller { background: linear-gradient(90deg, #e74c3c, #c0392b); }
  .chart-fill.deal { background: linear-gradient(90deg, #2ecc71, #27ae60); }
  .market-line {
    border-top: 2px dashed #f39c1266;
    margin: 8px 0;
    position: relative;
    margin-left: 108px;
  }
  .market-line span {
    position: absolute;
    top: -10px;
    right: 0;
    font-size: 11px;
    color: #f39c12;
    background: #12141a;
    padding: 0 4px;
  }

  /* Round Cards */
  .rounds-section h2 {
    font-size: 16px;
    color: #ccc;
    margin-bottom: 16px;
  }
  .round-card {
    background: #12141a;
    border: 1px solid #1e2130;
    border-radius: 12px;
    margin-bottom: 16px;
    overflow: hidden;
  }
  .round-card.accept { border-color: #2ecc7144; }
  .round-card.reject { border-color: #e74c3c44; }

  .round-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    background: #0e1016;
    border-bottom: 1px solid #1e2130;
  }
  .round-badge {
    background: #1e2130;
    color: #888;
    font-size: 11px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 4px;
    font-family: monospace;
  }
  .role-icon { font-size: 18px; }
  .role-name { font-weight: 600; flex: 1; }
  .action-badge {
    font-size: 12px;
    font-weight: 600;
    padding: 3px 10px;
    border-radius: 6px;
  }
  .action-badge.counter { background: #3498db22; color: #3498db; }
  .action-badge.accept { background: #2ecc7122; color: #2ecc71; }
  .action-badge.reject { background: #e74c3c22; color: #e74c3c; }

  .round-body { padding: 16px; }
  .price-flow {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
    font-size: 15px;
  }
  .price-flow .arrow { color: #666; font-size: 18px; }
  .price-flow strong { color: #fff; }

  .message-bubble {
    background: #1a1d24;
    border-radius: 12px;
    padding: 12px 16px;
    margin-bottom: 12px;
    font-size: 14px;
    line-height: 1.5;
    border-left: 3px solid;
  }
  .message-bubble.buyer { border-color: #3498db; }
  .message-bubble.seller { border-color: #e74c3c; }

  .reasoning {
    font-size: 13px;
    color: #999;
    margin-bottom: 12px;
    padding: 8px 12px;
    background: #0e101688;
    border-radius: 8px;
  }
  .reasoning-label { color: #bbb; font-weight: 600; }

  .meta-row {
    display: flex;
    gap: 16px;
    font-size: 12px;
    color: #666;
  }
  .meta-item { white-space: nowrap; }

  /* Prompt Details */
  .prompt-detail {
    margin-top: 12px;
    border-top: 1px solid #1e2130;
    padding-top: 8px;
  }
  .prompt-detail summary {
    font-size: 12px;
    color: #666;
    cursor: pointer;
    user-select: none;
  }
  .prompt-detail summary:hover { color: #3498db; }
  .prompt-section { margin-top: 8px; }
  .prompt-label {
    font-size: 11px;
    font-weight: 700;
    color: #888;
    text-transform: uppercase;
    margin-bottom: 4px;
  }
  .prompt-text {
    background: #080a0d;
    border: 1px solid #1a1d24;
    border-radius: 8px;
    padding: 12px;
    font-size: 12px;
    line-height: 1.5;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-word;
    color: #aaa;
    max-height: 300px;
    overflow-y: auto;
  }

  /* Pricing Section */
  .pricing-section {
    background: #12141a;
    border: 1px solid #f39c1233;
    border-radius: 12px;
    padding: 24px;
    margin-top: 32px;
  }
  .pricing-section h2 {
    font-size: 16px;
    color: #f39c12;
    margin-bottom: 16px;
  }
  .pricing-table {
    width: 100%;
    border-collapse: collapse;
  }
  .pricing-table th, .pricing-table td {
    text-align: left;
    padding: 8px 12px;
    border-bottom: 1px solid #1e2130;
    font-size: 13px;
  }
  .pricing-table th { color: #888; font-weight: 600; }
  .pricing-table td { color: #ccc; }
  .pricing-table .total-row { font-weight: 700; color: #f39c12; }

  /* Footer */
  .footer {
    text-align: center;
    margin-top: 32px;
    padding-top: 24px;
    border-top: 1px solid #1a1d24;
    font-size: 12px;
    color: #555;
  }
</style>
</head>
<body>

<div class="header">
  <h1>🤖 Haggle LLM 협상 데모</h1>
  <div class="subtitle">
    ${escHtml(result.item)} | 모델: ${escHtml(MODEL)} | ${new Date().toLocaleDateString('ko-KR')}
  </div>
</div>

<!-- Summary -->
<div class="summary-grid">
  <div class="summary-card ${deal ? 'deal' : ''}">
    <div class="label">${deal ? '🎉 최종 가격' : '결과'}</div>
    <div class="value">${deal ? '$' + final_price : '불성사'}</div>
    <div class="sub">${deal ? '시장가 대비 ' + savingsPct + '% 절약' : ''}</div>
  </div>
  <div class="summary-card">
    <div class="label">📊 시장가</div>
    <div class="value">$${MARKET_PRICE}</div>
    <div class="sub">Swappa 30d median</div>
  </div>
  <div class="summary-card">
    <div class="label">🔄 라운드</div>
    <div class="value">${total_rounds}회</div>
    <div class="sub">${rounds.length}회 API 호출</div>
  </div>
  <div class="summary-card cost">
    <div class="label">💰 총 비용</div>
    <div class="value">$${total_cost_usd.toFixed(4)}</div>
    <div class="sub">${(total_tokens.input + total_tokens.output).toLocaleString()} tokens</div>
  </div>
  <div class="summary-card">
    <div class="label">⏱️ 소요 시간</div>
    <div class="value">${(total_duration_ms / 1000).toFixed(1)}s</div>
    <div class="sub">실제 API 응답 시간 포함</div>
  </div>
</div>

<!-- Price Chart -->
<div class="chart-section">
  <h2>📈 가격 수렴 차트</h2>
  ${chartBarsHtml}
  <div class="market-line" style="margin-left: 108px;">
    <span>📊 시장가 $${MARKET_PRICE}</span>
  </div>
</div>

<!-- Rounds -->
<div class="rounds-section">
  <h2>🔄 라운드별 상세</h2>
  ${roundCardsHtml}
</div>

<!-- Pricing Info -->
<div class="pricing-section">
  <h2>💰 Grok 4 Fast 가격 정보</h2>
  <table class="pricing-table">
    <thead>
      <tr><th>항목</th><th>수량</th><th>단가</th><th>비용</th></tr>
    </thead>
    <tbody>
      ${pricingRowsHtml}
      <tr class="total-row">
        <td>합계</td>
        <td>${total_tokens.input.toLocaleString()} in + ${total_tokens.output.toLocaleString()} out</td>
        <td></td>
        <td>$${total_cost_usd.toFixed(4)}</td>
      </tr>
    </tbody>
  </table>
  <div style="margin-top:16px; font-size:13px; color:#888;">
    <p>📋 <strong>Grok 4 Fast 가격표</strong></p>
    <p>• Input: $0.20 / 1M tokens ($0.0002 / 1K tokens)</p>
    <p>• Output: $0.50 / 1M tokens ($0.0005 / 1K tokens)</p>
    <p>• Context window: 2M tokens</p>
    <p>• Reasoning mode 사용 시: 동일 토큰 단가지만 reasoning tokens이 output으로 청구되어 실질 비용 증가</p>
    <p style="margin-top:8px;">📊 <strong>비교</strong>: Claude Sonnet $3/$15 | GPT-4o $2.5/$10 | Grok 4 $2/$10</p>
    <p style="color:#f39c12; margin-top:4px;">→ Grok 4 Fast는 가장 저렴한 Tier. 협상 한 건당 ~$0.001 수준.</p>
  </div>
</div>

<div class="footer">
  Haggle AI Negotiation Protocol — <a href="https://tryhaggle.ai">tryhaggle.ai</a><br>
  Generated: ${new Date().toISOString()}
</div>

</body>
</html>`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Run ─────────────────────────────────────────────────────

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
