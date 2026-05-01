"use client";

import { useMemo, useState } from "react";
import type { DemoInitResponse, DemoRoundResponse } from "@/lib/demo-types";
import {
  ANCIENT_BEINGS,
  type AncientBeing,
  type AncientBeingId,
  type Expression,
} from "./negotiation-avatar-coach";
import type { AdvisorListing, AdvisorMemory } from "@/lib/advisor-demo-types";

type DemoState =
  | "IDLE"
  | "INITIALIZING"
  | "READY"
  | "ROUND_RUNNING"
  | "ROUND_DONE"
  | "SESSION_DONE";

type ConversationTurn = {
  id: string;
  side: "buyer" | "seller";
  label: string;
  agent: AncientBeing;
  avatar: string;
  round?: number;
  price?: number;
  message: string;
  detail: Record<string, unknown>;
};

type IntelligenceSignal = {
  type: string;
  value: string;
  confidence: "high" | "medium" | "low";
  destination: string;
};

type IntelligenceSnapshot = {
  signals: IntelligenceSignal[];
  memoryWrites: string[];
  tagTermUpdates: string[];
  marketObservation: string;
  nextContext: string[];
};

type AutoTradeShowcaseProps = {
  demoState: DemoState;
  initResponse: DemoInitResponse | null;
  rounds: DemoRoundResponse[];
  buyerAncientId: AncientBeingId;
  sellerAncientId: AncientBeingId;
  listing: AdvisorListing | null;
  buyerMemory: AdvisorMemory | null;
  autoTradeRunning: boolean;
  startBlockedReason?: string | null;
  onRunAutoTrade: () => void;
  onReset: () => void;
};

function formatMinor(v: number | undefined): string {
  if (v === undefined) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: v % 100 === 0 ? 0 : 2,
  }).format(v / 100);
}

function normalizeCurrencyText(message: string): string {
  return message
    .replace(/(\d[\d,]*)원/g, (match) => {
      const minorUnits = Number(match.replace(/[^0-9]/g, ""));
      if (!Number.isFinite(minorUnits) || minorUnits < 1000) return match;
      return formatMinor(minorUnits);
    })
    .replace(/(?<!\$)\b([1-9]\d{4,5})\b/g, (match) => {
      const minorUnits = Number(match);
      if (!Number.isFinite(minorUnits)) return match;
      return formatMinor(minorUnits);
    });
}

function normalizeStructuredText(value: unknown): unknown {
  if (typeof value === "string") return normalizeCurrencyText(value);

  if (Array.isArray(value)) {
    return value.map((item) => normalizeStructuredText(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeStructuredText(item)]),
    );
  }

  return value;
}

const TERM_LABELS: Record<string, string> = {
  payment_protection: "payment protection",
  shipping_protection: "shipping protection",
  payment_method: "payment method",
  shipping: "shipping",
  quick_process: "quick processing",
  confirm_conditions: "final condition check",
  condition: "deal condition",
};

function humanizeTermLabel(value: string): string {
  return TERM_LABELS[value] ?? value.replaceAll("_", " ");
}

function humanizeNonPriceTerms(value: unknown): unknown {
  if (typeof value === "string") return humanizeTermLabel(value);

  if (Array.isArray(value)) {
    return value.map((item) => humanizeNonPriceTerms(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        humanizeTermLabel(key),
        typeof item === "string" ? humanizeTermLabel(item) : humanizeNonPriceTerms(item),
      ]),
    );
  }

  return value;
}

function buildSafetyDetail(round: DemoRoundResponse) {
  const hardChecks = round.final.validation.violations.filter((check) => check.severity === "HARD");
  const softChecks = round.final.validation.violations.filter((check) => check.severity === "SOFT");

  return {
    status: round.final.validation.hard_passed ? "core_rules_passed" : "needs_review_before_trade",
    can_continue: round.final.validation.hard_passed,
    blocking_checks: round.final.validation.hard_passed ? [] : hardChecks,
    advisory_checks: softChecks,
    adjusted_before_send: round.final.validation.auto_fix_applied,
  };
}

function getBeing(id: AncientBeingId): AncientBeing {
  return ANCIENT_BEINGS.find((being) => being.id === id) ?? ANCIENT_BEINGS[0];
}

function getSelectionImage(being: AncientBeing): string {
  return being.selectionImage ?? being.expressions?.curious ?? being.image;
}

function getExpressionImage(being: AncientBeing, expression: Expression): string {
  return being.expressions?.[expression] ?? getSelectionImage(being);
}

function getBuyerExpression(rounds: DemoRoundResponse[]): Expression {
  const latest = rounds[rounds.length - 1];

  if (!latest) return "calm";
  if (!latest.final.validation.hard_passed) return "alert";
  if (latest.final.decision.action === "ACCEPT") return "success";
  if (latest.final.phase_transition?.transitioned && latest.final.phase_transition.to === "CLOSING") return "nearDeal";
  if (latest.final.decision.action === "REJECT") return "frustrated";
  if (latest.state.gap <= 4000) return "nearDeal";
  if (latest.round >= 2 && latest.state.gap <= 10000) return "confident";

  return "thinking";
}

function getSellerTurnExpression(round: DemoRoundResponse): Expression {
  if (round.state.done || round.final.decision.action === "ACCEPT") return "success";
  if (round.final.decision.action === "REJECT") return "frustrated";
  if (round.state.gap <= 4000) return "nearDeal";
  if (round.round >= 2 && round.state.gap <= 10000) return "confident";
  if (!round.final.validation.hard_passed) return "alert";

  return "thinking";
}

type SellerVoiceMessageInput = {
  priceMinor: number;
  roundIndex: number;
  listingTitle: string;
  baseMessage?: string;
  finalAccept?: boolean;
};

export function buildSellerVoiceMessage(
  agentId: AncientBeingId,
  { priceMinor, roundIndex, listingTitle, baseMessage, finalAccept = false }: SellerVoiceMessageInput,
): string {
  const price = formatMinor(priceMinor);

  if (finalAccept) {
    switch (agentId) {
      case "fab":
        return `${price}. 맞았습니다. 이 구조로 고정하죠.`;
      case "vel":
        return `${price}이면 욕심과 시장가가 만나는 지점이네요. 그 조건으로 넘기겠습니다.`;
      case "judge":
        return `${price}은 허용 범위 안입니다. 이 가격으로 확정하겠습니다.`;
      case "hark":
        return `${price}. 조건 통과. 진행합니다.`;
      case "mia":
        return `${price}이면 서로 편하게 마무리할 수 있겠어요. 진행하겠습니다.`;
      case "dealer_kai":
        return `Okay, ${price}이면 신호가 맞네요. 그 가격으로 진행할게요.`;
      case "dealer_hana":
        return `좋아요, ${price}이면 바로 진행할게요!`;
      case "buddy_fizz":
        return `${price}, 신호 왔어. 진행하자.`;
      default:
        return `${price}이면 진행하겠습니다. 이 가격으로 확정해 주세요.`;
    }
  }

  switch (agentId) {
    case "fab":
      return roundIndex === 0
        ? `${price}에 올렸습니다. ${listingTitle}, 구조는 괜찮고 약한 부분은 크지 않습니다.`
        : `${price}. 더 깎으면 이음새가 벌어집니다. 이 선에서 맞춰보죠.`;
    case "vel":
      return roundIndex === 0
        ? `${listingTitle}는 ${price}에 두고 있습니다. 가격에는 상태와 시간이 같이 얹혀 있어요.`
        : `${price}까지 내려오겠습니다. 더 낮추면 이 물건의 무게가 조금 사라집니다.`;
    case "judge":
      return roundIndex === 0
        ? `등록가는 ${price}입니다. 상태와 현재 기준을 보면 큰 편차는 없습니다.`
        : `${price}로 조정합니다. 이 아래는 제 기준 범위를 벗어납니다.`;
    case "hark":
      return roundIndex === 0
        ? `${price}. 이 가격이 기준입니다. 상태 설명 기준으로 협상합니다.`
        : `${price}. 여기까지입니다. 조건이 맞으면 진행합니다.`;
    case "mia":
      return roundIndex === 0
        ? `${price}에 올려두었습니다. 상태는 설명한 그대로라 천천히 확인해 주세요.`
        : `${price}까지는 맞춰볼게요. 서로 부담 없는 선이면 좋겠습니다.`;
    case "dealer_kai":
      return roundIndex === 0
        ? `Okay, ${price}에 올렸어요. 상태 신호가 좋아서 너무 낮게 리셋하긴 어렵습니다.`
        : `Wait, wait- ${price}까지는 조정할 수 있어요. 그 아래는 신호가 좀 안 맞아요.`;
    case "dealer_hana":
      return roundIndex === 0
        ? `헐, ${price}에 올려뒀어요! 상태 괜찮아서 너무 낮게는 어려워요.`
        : `잠깐 잠깐, ${price}까지는 맞춰볼 수 있어요. 이 정도면 꽤 괜찮지 않나요?`;
    case "buddy_fizz":
      return roundIndex === 0
        ? `${price}! 등록 신호는 여기야.`
        : `${price}까지 내려왔어. 이 신호면 가능해.`;
    default:
      return baseMessage ?? `${price}로 다시 제안드립니다. 배송과 기기 상태는 설명드린 내용 그대로입니다.`;
  }
}

function buildSellerListingIntro(agentId: AncientBeingId, listing: AdvisorListing): string {
  const price = formatMinor(listing.askPriceMinor);

  switch (agentId) {
    case "fab":
      return `${listing.title}. ${price}에 올렸습니다. 먼저 구조와 상태를 보죠.`;
    case "vel":
      return `${listing.title}를 ${price}에 두었습니다. 원하는 지점과 맞는지 천천히 보세요.`;
    case "judge":
      return `${listing.title}. 등록 기준가는 ${price}입니다. 상태와 가격 조건을 확인해 주세요.`;
    case "hark":
      return `${listing.title}. 기준가는 ${price}. 상태와 보호 조건부터 확인합니다.`;
    case "mia":
      return `${listing.title}를 ${price}에 올려두었습니다. 편하게 상태부터 확인해 주세요.`;
    case "dealer_kai":
      return `Okay, ${listing.title}는 ${price}에 올렸어요. 상태 신호부터 같이 볼까요?`;
    case "dealer_hana":
      return `헐, ${listing.title} 찾으셨군요! ${price}에 올려뒀고 상태도 같이 확인해 주세요.`;
    case "buddy_fizz":
      return `${listing.title}, ${price}! 먼저 신호 확인하자.`;
    default:
      return `${listing.title}를 판매 중입니다. 상태와 가격 조건을 확인해 주세요.`;
  }
}

function buildBuyerMessage(round: DemoRoundResponse): string {
  return normalizeCurrencyText(round.final.rendered_message);
}

function getSellerTurnPhase(rounds: DemoRoundResponse[], index: number): string {
  return rounds[index - 1]?.phase ?? "OPENING";
}

function getSellerTurnGap(
  initResponse: DemoInitResponse | null,
  rounds: DemoRoundResponse[],
  index: number,
): number | undefined {
  const previousBuyerPrice = rounds[index - 1]?.final.decision.price ?? initResponse?.strategy.target_price;
  const sellerPrice = rounds[index]?.state.seller_price;

  if (previousBuyerPrice === undefined || sellerPrice === undefined) return undefined;
  return Math.abs(sellerPrice - previousBuyerPrice);
}

function getSellerTurnGapPercent(gap: number | undefined, sellerPrice: number | undefined): string {
  if (gap === undefined || sellerPrice === undefined || sellerPrice === 0) return "-";
  return `${((gap / sellerPrice) * 100).toFixed(1)}%`;
}

function buildConversation(
  initResponse: DemoInitResponse | null,
  rounds: DemoRoundResponse[],
  buyerAgent: AncientBeing,
  sellerAgent: AncientBeing,
  listing: AdvisorListing,
  buyerMemory: AdvisorMemory | null,
): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  const hilMemory = initResponse?.hil_memory;

  if (initResponse) {
    turns.push({
      id: "listing",
      side: "seller",
      label: "판매자 에이전트",
      agent: sellerAgent,
      avatar: getSelectionImage(sellerAgent),
      price: listing.askPriceMinor,
      message: buildSellerListingIntro(sellerAgent.id, listing),
      detail: {
        type: "listing",
        item: listing.title,
        condition: listing.condition,
        seller_ask: formatMinor(listing.askPriceMinor),
        buyer_target: formatMinor(initResponse.strategy.target_price),
        buyer_max_budget: formatMinor(initResponse.strategy.floor_price),
        advisor_memory: buyerMemory
          ? {
              category_interest: buyerMemory.categoryInterest,
              must_have: buyerMemory.mustHave,
              avoid: buyerMemory.avoid,
              risk_style: buyerMemory.riskStyle,
              opening_tactic: buyerMemory.openingTactic,
            }
          : null,
        seller_agent: sellerAgent.name,
        seller_agent_type: sellerAgent.kind,
        negotiation_style: initResponse.strategy.negotiation_style,
        opening_tactic: initResponse.strategy.opening_tactic,
        key_concerns: initResponse.strategy.key_concerns,
        hil_memory_applied: hilMemory?.applied ?? false,
        hil_memory_cards: hilMemory?.cards.map((card) => card.summary) ?? [],
      },
    });
  }

  for (const [index, round] of rounds.entries()) {
    const sellerTurnGap = getSellerTurnGap(initResponse, rounds, index);

    turns.push({
      id: `seller-${round.round}`,
      side: "seller",
      label: "판매자 에이전트",
      agent: sellerAgent,
      avatar: getExpressionImage(sellerAgent, getSellerTurnExpression(round)),
      round: round.round,
      price: round.state.seller_price,
      message: buildSellerVoiceMessage(sellerAgent.id, {
        priceMinor: round.state.seller_price,
        roundIndex: index,
        listingTitle: listing.title,
        baseMessage: listing.sellerTurns[index]?.seller_message,
        finalAccept: round.final.decision.action === "ACCEPT" || round.state.done,
      }),
      detail: {
        type: "seller_offer",
        round: round.round,
        phase: getSellerTurnPhase(rounds, index),
        item: listing.title,
        seller_price: formatMinor(round.state.seller_price),
        seller_agent: sellerAgent.name,
        seller_agent_type: sellerAgent.kind,
        gap_to_previous_buyer_offer: formatMinor(sellerTurnGap),
        gap_percent: getSellerTurnGapPercent(sellerTurnGap, round.state.seller_price),
      },
    });

    const expression = getBuyerExpression(rounds.slice(0, round.round));
    turns.push({
      id: `buyer-${round.round}`,
      side: "buyer",
      label: "구매자 에이전트",
      agent: buyerAgent,
      avatar: getExpressionImage(buyerAgent, expression),
      round: round.round,
      price: round.final.decision.price,
      message: buildBuyerMessage(round),
      detail: {
        type: "buyer_decision",
        round: round.round,
        phase: round.phase,
        item: listing.title,
        action: round.final.decision.action,
        counter_price: formatMinor(round.final.decision.price),
        tactic_used: round.final.decision.tactic_used,
        advisor_memory_used: hilMemory?.applied
          ? {
              source: "user_memory_cards",
              user_id: hilMemory.user_id,
              cards: hilMemory.cards.map((card) => ({
                type: card.card_type,
                key: card.memory_key,
                summary: card.summary,
                strength: card.strength,
              })),
              signals: hilMemory.signals,
            }
          : null,
        buyer_agent: buyerAgent.name,
        buyer_agent_type: buyerAgent.kind,
        reasoning: normalizeCurrencyText(round.final.decision.reasoning),
        non_price_terms: humanizeNonPriceTerms(round.final.decision.non_price_terms),
        safety: buildSafetyDetail(round),
        state: {
          buyer_price: formatMinor(round.state.buyer_price),
          seller_price: formatMinor(round.state.seller_price),
          gap: formatMinor(round.state.gap),
          gap_percent: round.state.gap_pct,
          done: round.state.done,
        },
        phase_transition: round.final.phase_transition,
        pipeline: round.pipeline.map((stage) => ({
          stage: stage.stage,
          kind: stage.is_llm ? "llm" : "code",
          latency_ms: stage.latency_ms,
          tokens: stage.tokens,
        })),
      },
    });
  }

  return turns;
}

function getDetailString(detail: Record<string, unknown>, key: string): string | undefined {
  const value = detail[key];
  return typeof value === "string" ? value : undefined;
}

function hasNonPriceTerms(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0);
}

function buildIntelligenceSnapshot(turn: ConversationTurn): IntelligenceSnapshot {
  const detail = turn.detail;
  const type = getDetailString(detail, "type") ?? "conversation_turn";
  const phase = getDetailString(detail, "phase") ?? "OPENING";
  const item = getDetailString(detail, "item") ?? "selected listing";
  const priceText = turn.price !== undefined ? formatMinor(turn.price) : getDetailString(detail, "seller_ask") ?? "-";
  const signals: IntelligenceSignal[] = [
    {
      type: "product_identity",
      value: item,
      confidence: "high",
      destination: "Tag Garden / HFMI",
    },
  ];

  if (type === "listing") {
    signals.push(
      {
        type: "condition_claim",
        value: getDetailString(detail, "condition") ?? "listing condition available",
        confidence: "high",
        destination: "Term Intelligence",
      },
      {
        type: "price_anchor",
        value: `seller ask ${getDetailString(detail, "seller_ask") ?? "$920"}`,
        confidence: "high",
        destination: "Market Observation",
      },
    );
  }

  if (type === "seller_offer") {
    signals.push(
      {
        type: "price_anchor",
        value: `seller counter ${priceText}`,
        confidence: "high",
        destination: "HFMI offer curve",
      },
      {
        type: "seller_resistance",
        value: `gap to prior buyer offer ${getDetailString(detail, "gap_to_previous_buyer_offer") ?? "-"}`,
        confidence: "medium",
        destination: "Opponent Model",
      },
    );
  }

  if (type === "buyer_decision") {
    const action = getDetailString(detail, "action") ?? "COUNTER";
    const tactic = getDetailString(detail, "tactic_used") ?? "unknown";
    signals.push(
      {
        type: "buyer_intent",
        value: `${action.toLowerCase()} at ${getDetailString(detail, "counter_price") ?? priceText}`,
        confidence: "high",
        destination: "Memory Card",
      },
      {
        type: "negotiation_tactic",
        value: tactic,
        confidence: "high",
        destination: "Strategy Performance",
      },
    );

    if (hasNonPriceTerms(detail.non_price_terms)) {
      signals.push({
        type: "term_preference",
        value: "non-price terms present",
        confidence: "medium",
        destination: "Term Intelligence",
      });
    }

    if (detail.advisor_memory_used || detail.hil_memory_applied) {
      signals.push({
        type: "memory_applied",
        value: "user_memory_cards retrieved for negotiation context",
        confidence: "high",
        destination: "Negotiation Context",
      });
    }
  }

  return {
    signals,
    memoryWrites:
      turn.side === "buyer"
        ? [
            `buyer prefers this category around ${priceText}`,
            `agent voice used: ${turn.agent.name} / ${turn.agent.role}`,
            `phase context saved: ${phase}`,
          ]
        : [
            `seller price posture observed at ${priceText}`,
            `seller communication style: ${turn.agent.name} / ${turn.agent.role}`,
            `phase context saved: ${phase}`,
          ],
    tagTermUpdates: [
      item.toLowerCase().includes("iphone")
        ? "tag match: electronics/phones/iphone"
        : "tag match: electronics/uncategorized",
      "term match: battery_health, carrier_unlock, screen_condition",
      type === "listing" ? "no missing tag candidate" : "append evidence to active negotiation terms",
    ],
    marketObservation:
      type === "buyer_decision"
        ? `Buyer ${getDetailString(detail, "action") ?? "decision"} recorded at ${getDetailString(detail, "counter_price") ?? priceText}.`
        : `${turn.side === "seller" ? "Seller" : "Buyer"} observable price point recorded at ${priceText}.`,
    nextContext: [
      "Stage 2 receives a smaller memory brief next round.",
      "HFMI sees offer/counter/resistance, not just final sale price.",
      "Tag/Term knowledge improves when the same evidence repeats.",
    ],
  };
}

function DetailPanel({ turn }: { turn: ConversationTurn | null }) {
  const intelligence = turn ? buildIntelligenceSnapshot(turn) : null;

  return (
    <div className="min-h-[280px] rounded-xl border border-slate-700 bg-slate-950/70 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-white">Haggle Intelligence Layer</h3>
        {turn?.round && (
          <span className="rounded-md bg-slate-800 px-2 py-1 text-[10px] font-mono text-slate-400">
            round {turn.round}
          </span>
        )}
      </div>
      {turn ? (
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-1 text-center text-[10px] font-semibold text-slate-400">
            <span className="rounded bg-cyan-500/10 px-2 py-1 text-cyan-200">Signal</span>
            <span className="rounded bg-violet-500/10 px-2 py-1 text-violet-200">Memory</span>
            <span className="rounded bg-amber-500/10 px-2 py-1 text-amber-200">Tag/Term</span>
            <span className="rounded bg-emerald-500/10 px-2 py-1 text-emerald-200">Market</span>
          </div>

          <div className="rounded-lg border border-cyan-500/15 bg-cyan-500/5 p-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-cyan-200">
              Extracted Signals
            </p>
            <div className="space-y-2">
              {intelligence?.signals.map((signal) => (
                <div key={`${signal.type}-${signal.value}`} className="rounded-md bg-slate-900/70 p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono text-cyan-200">
                      {signal.type}
                    </span>
                    <span className="text-xs font-medium text-white">{signal.value}</span>
                  </div>
                  <p className="mt-1 text-[10px] text-slate-500">
                    confidence: {signal.confidence} · destination: {signal.destination}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-violet-500/15 bg-violet-500/5 p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-violet-200">
                Memory Writes
              </p>
              <ul className="space-y-1 text-xs text-slate-300">
                {intelligence?.memoryWrites.map((item) => <li key={item}>• {item}</li>)}
              </ul>
            </div>
            <div className="rounded-lg border border-amber-500/15 bg-amber-500/5 p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-200">
                Tag / Term Sync
              </p>
              <ul className="space-y-1 text-xs text-slate-300">
                {intelligence?.tagTermUpdates.map((item) => <li key={item}>• {item}</li>)}
              </ul>
            </div>
          </div>

          <div className="rounded-lg border border-emerald-500/15 bg-emerald-500/5 p-3">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-200">
              Market Observation
            </p>
            <p className="text-xs text-slate-300">{intelligence?.marketObservation}</p>
            <div className="mt-2 border-t border-emerald-500/10 pt-2">
              <p className="mb-1 text-[10px] font-semibold text-slate-500">Next context impact</p>
              <ul className="space-y-1 text-[11px] text-slate-400">
                {intelligence?.nextContext.map((item) => <li key={item}>→ {item}</li>)}
              </ul>
            </div>
          </div>

          <details className="rounded-lg border border-slate-800 bg-slate-900/50">
            <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-300">
              원본 구조화 JSON
            </summary>
            <pre className="max-h-[260px] overflow-auto whitespace-pre-wrap break-words border-t border-slate-800 p-3 text-[11px] leading-5 text-slate-300">
              {JSON.stringify(turn.detail, null, 2)}
            </pre>
          </details>
        </div>
      ) : (
        <div className="flex min-h-[210px] items-center justify-center rounded-lg border border-dashed border-slate-800 text-center text-sm text-slate-500">
          대화 말풍선을 선택하면 Signal, Memory, Tag/Term, Market Observation으로 어떻게 쌓이는지 확인할 수 있습니다.
        </div>
      )}
    </div>
  );
}

function AgentPanel({
  label,
  agent,
  avatar,
  priceLabel,
  tone,
}: {
  label: string;
  agent: AncientBeing;
  avatar: string;
  priceLabel: string;
  tone: "cyan" | "amber";
}) {
  const toneClasses =
    tone === "cyan"
      ? "border-cyan-500/25 bg-cyan-500/5 text-cyan-200"
      : "border-amber-500/25 bg-amber-500/5 text-amber-200";

  return (
    <div className={`rounded-xl border p-3 ${toneClasses}`}>
      <div className="flex items-center gap-3">
        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-slate-950">
          <img src={avatar} alt="" className="h-full w-full object-cover object-top" />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-medium opacity-80">{label}</p>
          <p className="truncate text-sm font-bold text-white">{agent.name}</p>
          <p className="text-xs opacity-80">{agent.kind} · {agent.role}</p>
        </div>
        <div className="ml-auto text-right">
          <p className="text-[10px] opacity-70">현재 기준</p>
          <p className="font-mono text-sm font-bold text-white">{priceLabel}</p>
        </div>
      </div>
    </div>
  );
}

export function AutoTradeShowcase({
  demoState,
  initResponse,
  rounds,
  buyerAncientId,
  sellerAncientId,
  listing,
  buyerMemory,
  autoTradeRunning,
  startBlockedReason,
  onRunAutoTrade,
  onReset,
}: AutoTradeShowcaseProps) {
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(null);
  const buyerAgent = getBeing(buyerAncientId);
  const sellerAgent = getBeing(sellerAncientId);
  const activeListing = listing;
  const buyerAvatar = getSelectionImage(buyerAgent);
  const sellerAvatar = getSelectionImage(sellerAgent);
  const sellerPrice = rounds[rounds.length - 1]?.state.seller_price ?? activeListing?.askPriceMinor;
  const buyerPrice = rounds[rounds.length - 1]?.final.decision.price ?? initResponse?.strategy.target_price;
  const turns = useMemo(
    () => activeListing
      ? buildConversation(initResponse, rounds, buyerAgent, sellerAgent, activeListing, buyerMemory)
      : [],
    [initResponse, rounds, buyerAgent, sellerAgent, activeListing, buyerMemory],
  );
  const selectedTurn = turns.find((turn) => turn.id === selectedTurnId) ?? turns[turns.length - 1] ?? null;
  const running = autoTradeRunning || demoState === "INITIALIZING" || demoState === "ROUND_RUNNING";
  const done = demoState === "SESSION_DONE" || rounds.some((round) => round.state.done);
  const visibleBlockedReason = !activeListing
    ? "등록 상품 카드 하나를 먼저 눌러 협상 대상을 선택하세요."
    : startBlockedReason;
  const startDisabled = running || Boolean(visibleBlockedReason);

  return (
    <section className="mt-5 rounded-2xl border border-slate-700 bg-slate-900/60 p-4 shadow-xl shadow-slate-950/30 sm:p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="mb-1 inline-flex rounded-full border border-cyan-400/25 bg-cyan-400/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-200">
            자동 거래 데모
          </div>
          <h2 className="text-xl font-bold text-white">양쪽 에이전트 자동 거래</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onRunAutoTrade()}
            disabled={startDisabled}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span aria-hidden="true">{running ? "…" : "▶"}</span>
            {running ? "협상 진행 중" : "협상 시작"}
          </button>
          {(initResponse || rounds.length > 0) && (
            <button
              type="button"
              onClick={onReset}
              disabled={running}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 transition-colors hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span aria-hidden="true">↺</span>
              초기화
            </button>
          )}
        </div>
      </div>
      {visibleBlockedReason && !running && (
        <div className="mb-4 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-100">
          {visibleBlockedReason}
        </div>
      )}

      <div className="mb-4 grid gap-3 lg:grid-cols-2">
        <AgentPanel
          label="구매자 에이전트"
          agent={buyerAgent}
          avatar={buyerAvatar}
          priceLabel={formatMinor(buyerPrice)}
          tone="cyan"
        />
        <AgentPanel
          label="판매자 에이전트"
          agent={sellerAgent}
          avatar={sellerAvatar}
          priceLabel={formatMinor(sellerPrice)}
          tone="amber"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <div className="rounded-xl border border-slate-700 bg-slate-950/50 p-3">
          <div className="mb-3 flex items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div>
              <p className="text-sm font-semibold text-white">
                {activeListing?.title ?? "실제 DB 상품을 선택하세요"}
              </p>
              <p className="text-xs text-slate-400">
                {activeListing?.condition ?? "상담 후 등록된 DB 상품을 누르면 이 영역에 협상 대상이 표시됩니다."}
              </p>
            </div>
            <span className={`rounded-md px-2 py-1 text-[10px] font-semibold ${
              done ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-800 text-slate-400"
            }`}>
              {done ? "거래 완료" : demoState === "IDLE" ? "대기 중" : "협상 중"}
            </span>
          </div>

          <div className="space-y-3">
            {turns.length === 0 && (
              <div className="rounded-lg border border-dashed border-slate-800 p-5 text-center text-sm text-slate-500">
                상담에서 만든 메모리와 선택한 상품으로 자동 거래를 실행할 수 있습니다.
              </div>
            )}

            {turns.map((turn) => {
              const isBuyer = turn.side === "buyer";
              const selected = selectedTurn?.id === turn.id;

              return (
                <button
                  key={turn.id}
                  type="button"
                  onClick={() => setSelectedTurnId(turn.id)}
                  className={`flex w-full gap-3 rounded-xl border p-3 text-left transition-colors ${
                    selected
                      ? "border-cyan-400/45 bg-cyan-500/10"
                      : "border-slate-800 bg-slate-900/60 hover:border-slate-600"
                  } ${isBuyer ? "flex-row" : "flex-row-reverse"}`}
                >
                  <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-slate-950">
                    <img src={turn.avatar} alt="" className="h-full w-full object-cover object-top" />
                  </span>
                  <span className={`min-w-0 flex-1 ${isBuyer ? "" : "text-right"}`}>
                    <span className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-white">{turn.label}</span>
                      {turn.round && (
                        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono text-slate-400">
                          R{turn.round}
                        </span>
                      )}
                      {turn.price !== undefined && (
                        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono text-cyan-200">
                          {formatMinor(turn.price)}
                        </span>
                      )}
                    </span>
                    <span className="block text-sm leading-6 text-slate-200">{turn.message}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <DetailPanel turn={selectedTurn} />
      </div>
    </section>
  );
}
