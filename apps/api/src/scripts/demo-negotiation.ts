/**
 * Haggle Engine Demo — iPhone 15 Pro AI 자동 협상
 *
 * 구매자 AI(Alice)와 판매자 AI(Bob)가 각각의 전략으로 자동 협상합니다.
 * 엔진은 순수 수학 함수 — LLM/DB/API 호출 없이 밀리초 단위로 실행됩니다.
 *
 * Usage:
 *   npx tsx apps/api/src/scripts/demo-negotiation.ts
 */

import { executeRound } from '@haggle/engine-session';
import type {
  MasterStrategy,
  RoundData,
  NegotiationSession,
  HnpMessage,
  RoundResult,
} from '@haggle/engine-session';

// ─── 시나리오 설정 ──────────────────────────────────────────

const ITEM = 'iPhone 15 Pro 256GB Space Black (미개봉)';
const MARKET_PRICE = 1_050; // Swappa 30d median: $1,050

console.log(`
╔══════════════════════════════════════════════════════════════╗
║  🤝  Haggle Engine Demo — AI 자동 협상 시뮬레이션           ║
╠══════════════════════════════════════════════════════════════╣
║  📱 상품: ${ITEM.padEnd(42)}║
║  📊 시장가: $${MARKET_PRICE} (Swappa 30d median)                       ║
╚══════════════════════════════════════════════════════════════╝
`);

// ─── 전략 정의 ──────────────────────────────────────────────

const now = Date.now();

// 구매자: "합리적 절약가" — $880이 목표, $1,000이 한계
const buyerStrategy: MasterStrategy = {
  id: 'strat-buyer-alice',
  user_id: 'buyer-alice',
  weights: { w_p: 0.55, w_t: 0.12, w_r: 0.18, w_s: 0.15 },
  p_target: 880,        // 목표가: $880
  p_limit: 1_000,       // 한계가: $1,000 (이 이상은 안 삼)
  alpha: 0.5,           // 시간 압박 민감도
  beta: 1.0,            // 선형 양보 곡선
  t_deadline: 1800,     // 30분 데드라인
  v_t_floor: 0.08,
  n_threshold: 5,
  v_s_base: 0.5,
  w_rep: 0.6,
  w_info: 0.4,
  u_threshold: 0.55,    // 0.55 이상이면 NEAR_DEAL
  u_aspiration: 0.86,   // 0.86 이상이면 즉시 ACCEPT
  persona: 'value-seeker',
  created_at: now,
  expires_at: now + 86_400_000,
};

// 판매자: "적정 이익 추구" — $1,120이 목표, $900이 한계
const sellerStrategy: MasterStrategy = {
  id: 'strat-seller-bob',
  user_id: 'seller-bob',
  weights: { w_p: 0.55, w_t: 0.12, w_r: 0.18, w_s: 0.15 },
  p_target: 1_120,      // 목표가: $1,120
  p_limit: 900,         // 한계가: $900 (이 아래로는 안 팔음)
  alpha: 0.5,           // 시간 압박 민감도
  beta: 1.0,            // 선형 양보 곡선
  t_deadline: 1800,     // 30분 데드라인
  v_t_floor: 0.1,
  n_threshold: 5,
  v_s_base: 0.6,        // 기존 거래 이력 약간 있음
  w_rep: 0.5,
  w_info: 0.5,
  u_threshold: 0.52,
  u_aspiration: 0.84,   // 0.84 이상이면 즉시 ACCEPT
  persona: 'fair-seller',
  created_at: now,
  expires_at: now + 86_400_000,
};

// ─── 세션 초기화 ────────────────────────────────────────────

let buyerSession: NegotiationSession = {
  session_id: 'sess-iphone15pro-001',
  strategy_id: buyerStrategy.id,
  role: 'BUYER',
  status: 'CREATED',
  counterparty_id: 'seller-bob',
  rounds: [],
  current_round: 0,
  rounds_no_concession: 0,
  last_offer_price: buyerStrategy.p_target, // 구매자 시작 = 목표가 ($880)
  last_utility: null,
  created_at: now,
  updated_at: now,
};

let sellerSession: NegotiationSession = {
  session_id: 'sess-iphone15pro-001',
  strategy_id: sellerStrategy.id,
  role: 'SELLER',
  status: 'CREATED',
  counterparty_id: 'buyer-alice',
  rounds: [],
  current_round: 0,
  rounds_no_concession: 0,
  last_offer_price: sellerStrategy.p_target, // 판매자 시작 = 목표가 ($1,120)
  last_utility: null,
  created_at: now,
  updated_at: now,
};

// ─── 라운드 데이터 (상대방 평판 등) ────────────────────────

const buyerRoundBase: Omit<RoundData, 'p_effective' | 't_elapsed'> = {
  r_score: 0.88,         // 판매자 평판 88%
  i_completeness: 0.92,  // 리스팅 정보 완성도 92%
  n_success: 5,          // 판매자 과거 거래 성공 5건
  n_dispute_losses: 0,
};

const sellerRoundBase: Omit<RoundData, 'p_effective' | 't_elapsed'> = {
  r_score: 0.82,         // 구매자 평판 82%
  i_completeness: 1.0,   // 구매 제안은 항상 완전
  n_success: 2,          // 구매자 과거 거래 2건
  n_dispute_losses: 0,
};

// ─── 가격 추적 (차트용) ─────────────────────────────────────

const priceHistory: Array<{
  round: number;
  role: 'B' | 'S';
  price: number;
  action: string;
  utility: number;
}> = [];

// ─── 협상 루프 ──────────────────────────────────────────────

const MAX_ROUNDS = 10;
let currentPrice = sellerStrategy.p_target; // 판매자가 먼저 제안
let roundNum = 0;
let elapsedSec = 0;
let deal = false;
let dealPrice = 0;
let dealAcceptor = '';

// 판매자 첫 제안
priceHistory.push({ round: 0, role: 'S', price: currentPrice, action: 'OFFER', utility: 1.0 });

console.log('┌─────────────────────────────────────────────────────────────┐');
console.log('│  📋 협상 시작                                               │');
console.log('├─────────────────────────────────────────────────────────────┤');
console.log(`│  🏷️  판매자 초기 호가: $${currentPrice}                           │`);
console.log(`│  💰 구매자 목표: $${buyerStrategy.p_target} / 판매자 목표: $${sellerStrategy.p_target}            │`);
console.log(`│  🚫 구매자 한계: $${buyerStrategy.p_limit} / 판매자 한계: $${sellerStrategy.p_limit}              │`);
console.log(`│  ⏱️  데드라인: ${buyerStrategy.t_deadline / 60}분                                         │`);
console.log('└─────────────────────────────────────────────────────────────┘');
console.log('');

while (roundNum < MAX_ROUNDS && !deal) {
  roundNum++;
  elapsedSec += 120 + Math.floor(Math.random() * 60); // 2~3분 간격

  // ─── 구매자 턴 (판매자 제안에 대한 응답) ───
  const sellerOffer: HnpMessage = {
    session_id: buyerSession.session_id,
    round: roundNum,
    type: roundNum === 1 ? 'OFFER' : 'COUNTER',
    price: currentPrice,
    sender_role: 'SELLER',
    timestamp: now + elapsedSec * 1000,
  };

  const buyerRound: RoundData = {
    ...buyerRoundBase,
    p_effective: currentPrice,
    t_elapsed: elapsedSec,
  };

  const buyerResult: RoundResult = executeRound(
    buyerSession,
    buyerStrategy,
    sellerOffer,
    buyerRound,
  );

  // 핵심: 구매자 세션의 last_offer_price를 '자신의 역제안'으로 덮어쓴다.
  // 엔진은 기본적으로 상대방 가격으로 앵커링하지만,
  // 데모에서는 자신의 이전 포지션에서 점진적으로 양보하는 것이 더 현실적.
  const buyerCounterPrice = Math.round(buyerResult.message.price);
  buyerSession = {
    ...buyerResult.session,
    last_offer_price: buyerCounterPrice,
  };

  const buyerAction = buyerResult.decision;
  const buyerU = buyerResult.utility.u_total;

  printRound(roundNum, 'BUYER', currentPrice, buyerAction, buyerU, buyerCounterPrice, buyerResult);
  priceHistory.push({ round: roundNum, role: 'B', price: buyerCounterPrice, action: buyerAction, utility: buyerU });

  if (buyerAction === 'ACCEPT') {
    deal = true;
    dealPrice = currentPrice;
    dealAcceptor = 'BUYER';
    break;
  }

  if (buyerAction === 'REJECT') {
    printWalkAway('BUYER', roundNum);
    break;
  }

  // ─── 판매자 턴 (구매자 역제안에 대한 응답) ───
  elapsedSec += 120 + Math.floor(Math.random() * 60);

  const buyerOffer: HnpMessage = {
    session_id: sellerSession.session_id,
    round: roundNum,
    type: 'COUNTER',
    price: buyerCounterPrice,
    sender_role: 'BUYER',
    timestamp: now + elapsedSec * 1000,
  };

  const sellerRound: RoundData = {
    ...sellerRoundBase,
    p_effective: buyerCounterPrice,
    t_elapsed: elapsedSec,
  };

  const sellerResult: RoundResult = executeRound(
    sellerSession,
    sellerStrategy,
    buyerOffer,
    sellerRound,
  );

  // 판매자도 마찬가지로 자신의 역제안으로 앵커링
  const sellerCounterPrice = Math.round(sellerResult.message.price);
  sellerSession = {
    ...sellerResult.session,
    last_offer_price: sellerCounterPrice,
  };

  const sellerAction = sellerResult.decision;
  const sellerU = sellerResult.utility.u_total;

  printRound(roundNum, 'SELLER', buyerCounterPrice, sellerAction, sellerU, sellerCounterPrice, sellerResult);
  priceHistory.push({ round: roundNum, role: 'S', price: sellerCounterPrice, action: sellerAction, utility: sellerU });

  if (sellerAction === 'ACCEPT') {
    deal = true;
    dealPrice = buyerCounterPrice;
    dealAcceptor = 'SELLER';
    break;
  }

  if (sellerAction === 'REJECT') {
    printWalkAway('SELLER', roundNum);
    break;
  }

  // 판매자 역제안 → 다음 라운드 구매자 입력
  currentPrice = sellerCounterPrice;
}

if (!deal && roundNum >= MAX_ROUNDS) {
  console.log('\n  ⏰ 최대 라운드 도달 — 협상 종료 (합의 실패)');
}

// ─── 최종 요약 ──────────────────────────────────────────────

if (deal) {
  printDeal(dealPrice, dealAcceptor, roundNum, elapsedSec);
}
printSummary(priceHistory, buyerSession, sellerSession, elapsedSec, deal, dealPrice);

// ─── 출력 헬퍼 함수들 ───────────────────────────────────────

function printRound(
  round: number,
  role: 'BUYER' | 'SELLER',
  incomingPrice: number,
  action: string,
  utility: number,
  responsePrice: number,
  result: RoundResult,
) {
  const icon = role === 'BUYER' ? '🛒' : '🏪';
  const name = role === 'BUYER' ? 'Alice (구매자)' : 'Bob (판매자)';
  const actionIcon = getActionIcon(action);
  const bar = utilityBar(utility);

  console.log(`  ─── Round ${round} ${icon} ${name} ─────────────────────────`);
  console.log(`  │ 받은 제안: $${incomingPrice}`);
  console.log(`  │ 효용값:   ${bar} ${(utility * 100).toFixed(1)}%`);
  console.log(`  │ V_p=${result.utility.v_p.toFixed(3)} V_t=${result.utility.v_t.toFixed(3)} V_r=${result.utility.v_r.toFixed(3)} V_s=${result.utility.v_s.toFixed(3)}`);
  console.log(`  │ 결정:     ${actionIcon} ${action}${action === 'COUNTER' || action === 'NEAR_DEAL' ? ` → $${responsePrice}` : ''}`);
  console.log('');
}

function printDeal(price: number, acceptedBy: string, round: number, elapsed: number) {
  const savings = MARKET_PRICE - price;
  const savingsPct = ((savings / MARKET_PRICE) * 100).toFixed(1);
  const minutes = Math.floor(elapsed / 60);

  console.log('');
  console.log('  ╔═══════════════════════════════════════════════════════════╗');
  console.log('  ║  🎉 거래 성사!                                            ║');
  console.log('  ╠═══════════════════════════════════════════════════════════╣');
  console.log(`  ║  💰 최종 가격: $${price}`.padEnd(60) + '║');
  console.log(`  ║  📊 시장가 대비: ${savings >= 0 ? `-$${savings} (${savingsPct}% 절약)` : `+$${Math.abs(savings)}`}`.padEnd(60) + '║');
  console.log(`  ║  🤝 수락 측: ${acceptedBy === 'BUYER' ? 'Alice (구매자)' : 'Bob (판매자)'}`.padEnd(60) + '║');
  console.log(`  ║  🔄 라운드: ${round}회`.padEnd(60) + '║');
  console.log(`  ║  ⏱️  소요 시간: ${minutes}분`.padEnd(59) + '║');
  console.log('  ╚═══════════════════════════════════════════════════════════╝');
}

function printWalkAway(role: string, round: number) {
  console.log(`\n  ❌ ${role === 'BUYER' ? 'Alice (구매자)' : 'Bob (판매자)'}가 Round ${round}에서 협상을 거부했습니다.`);
}

function printSummary(
  history: typeof priceHistory,
  buyer: NegotiationSession,
  seller: NegotiationSession,
  elapsed: number,
  dealMade: boolean,
  finalPrice: number,
) {
  console.log('\n');
  console.log('┌─────────────────────────────────────────────────────────────┐');
  console.log('│  📈 가격 수렴 차트                                          │');
  console.log('├─────────────────────────────────────────────────────────────┤');

  // 가격 범위 결정 (차트 스케일)
  const allPrices = history.map(h => h.price);
  const minP = Math.min(...allPrices);
  const maxP = Math.max(...allPrices);
  const range = maxP - minP || 1;
  const chartWidth = 40;

  for (const h of history) {
    const pos = Math.round(((h.price - minP) / range) * chartWidth);
    const marker = h.role === 'S' ? '🔴' : '🔵';
    const actionTag = h.action === 'ACCEPT' ? ' ✅' : h.action === 'NEAR_DEAL' ? ' 🤏' : '';
    const label = `R${h.round} ${h.role}`;
    const bar = '·'.repeat(Math.max(0, pos)) + marker;
    console.log(`│  ${label.padEnd(5)} $${h.price.toString().padEnd(5)} ${bar}${actionTag}`);
  }

  // 시장가 위치 표시
  const mktPos = Math.round(((MARKET_PRICE - minP) / range) * chartWidth);
  const mktBar = '─'.repeat(Math.max(0, mktPos)) + '📊 시장가 $' + MARKET_PRICE;
  console.log(`│       ${' '.padEnd(5)} ${mktBar}`);

  console.log('│');
  console.log(`│  구매자 세션: ${buyer.status.padEnd(12)} (${buyer.current_round} rounds)`);
  console.log(`│  판매자 세션: ${seller.status.padEnd(12)} (${seller.current_round} rounds)`);
  console.log(`│  양보 없는 라운드: 구매자 ${buyer.rounds_no_concession}회 / 판매자 ${seller.rounds_no_concession}회`);
  console.log(`│  ⏱️  총 소요: ${Math.floor(elapsed / 60)}분`);
  console.log(`│  🧮 엔진 연산: ${buyer.current_round + seller.current_round}회 (LLM 0회, 순수 수학)`);

  if (dealMade) {
    const buyerSaved = buyerStrategy.p_limit - finalPrice;
    const sellerGained = finalPrice - sellerStrategy.p_limit;
    console.log('│');
    console.log(`│  💡 구매자: 한계가 대비 $${buyerSaved} 절약 (limit $${buyerStrategy.p_limit})`);
    console.log(`│  💡 판매자: 한계가 대비 $${sellerGained} 추가 수익 (limit $${sellerStrategy.p_limit})`);
    console.log(`│  💡 Haggle 수수료 (1.5%): $${(finalPrice * 0.015).toFixed(0)}`);
  }

  console.log('└─────────────────────────────────────────────────────────────┘');
  console.log('');
}

function utilityBar(u: number): string {
  const filled = Math.round(u * 20);
  const empty = 20 - filled;
  const color = u >= 0.7 ? '🟩' : u >= 0.45 ? '🟨' : '🟥';
  return `[${color.repeat(filled)}${'⬜'.repeat(empty)}]`;
}

function getActionIcon(action: string): string {
  switch (action) {
    case 'ACCEPT': return '✅';
    case 'COUNTER': return '↩️';
    case 'NEAR_DEAL': return '🤏';
    case 'REJECT': return '❌';
    case 'ESCALATE': return '🆘';
    default: return '❓';
  }
}
