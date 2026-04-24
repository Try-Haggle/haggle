"use client";

import { useMemo, useState } from "react";
import type { DemoInitResponse, DemoRoundResponse } from "@/lib/demo-types";
import {
  ANCIENT_BEINGS,
  type AncientBeing,
  type AncientBeingId,
  type Expression,
} from "./negotiation-avatar-coach";

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

type AutoTradeShowcaseProps = {
  demoState: DemoState;
  initResponse: DemoInitResponse | null;
  rounds: DemoRoundResponse[];
  buyerAncientId: AncientBeingId;
  sellerAncientId: AncientBeingId;
  autoTradeRunning: boolean;
  onRunAutoTrade: () => void;
  onReset: () => void;
};

function price(v: number | undefined): string {
  if (v === undefined) return "-";
  return v > 1000 ? `$${(v / 100).toFixed(0)}` : `$${v}`;
}

function normalizeCurrencyText(message: string): string {
  return message
    .replace(/(\d[\d,]*)원/g, (match) => {
      const minorUnits = Number(match.replace(/[^0-9]/g, ""));
      if (!Number.isFinite(minorUnits) || minorUnits < 1000) return match;
      return `$${Math.round(minorUnits / 100).toLocaleString()}`;
    })
    .replace(/\b([1-9]\d{4,5})\b/g, (match) => {
      const minorUnits = Number(match);
      if (!Number.isFinite(minorUnits)) return match;
      return `$${Math.round(minorUnits / 100).toLocaleString()}`;
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

function getExpressionImage(being: AncientBeing, expression: Expression): string {
  return being.expressions?.[expression] ?? being.image;
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

function getSellerExpression(rounds: DemoRoundResponse[]): Expression {
  const latest = rounds[rounds.length - 1];

  if (!latest) return "calm";
  if (latest.state.done || latest.final.decision.action === "ACCEPT") return "success";
  if (latest.final.decision.action === "REJECT") return "frustrated";
  if (latest.state.gap <= 4000) return "nearDeal";
  if (latest.round >= 2 && latest.state.gap <= 10000) return "confident";
  if (!latest.final.validation.hard_passed) return "alert";

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

function buildSellerMessage(round: DemoRoundResponse): string {
  const sellerPrice = price(round.state.seller_price);

  if (round.final.decision.action === "ACCEPT") {
    return `${sellerPrice}이면 진행하겠습니다. 이 가격으로 확정해 주세요.`;
  }

  if (round.round === 1) {
    return `${sellerPrice}에 올렸습니다. 상태가 좋아서 너무 낮은 가격은 어렵습니다.`;
  }

  if (round.state.gap <= 4000) {
    return `${sellerPrice}까지는 맞춰볼 수 있습니다. 마지막 조건만 확인하고 싶습니다.`;
  }

  return `${sellerPrice}로 다시 제안드립니다. 배송과 기기 상태는 설명드린 내용 그대로입니다.`;
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
): ConversationTurn[] {
  const turns: ConversationTurn[] = [];

  if (initResponse) {
    turns.push({
      id: "listing",
      side: "seller",
      label: "판매자 에이전트",
      agent: sellerAgent,
      avatar: sellerAgent.image,
      price: 920,
      message: "iPhone 15 Pro 256GB를 판매 중입니다. 상태와 가격 조건을 확인해 주세요.",
      detail: {
        type: "listing",
        item: "iPhone 15 Pro 256GB Natural Titanium",
        seller_ask: "$920",
        buyer_target: price(initResponse.strategy.target_price),
        buyer_max_budget: price(initResponse.strategy.floor_price),
        seller_agent: sellerAgent.name,
        seller_agent_type: sellerAgent.kind,
        negotiation_style: initResponse.strategy.negotiation_style,
        opening_tactic: initResponse.strategy.opening_tactic,
        key_concerns: initResponse.strategy.key_concerns,
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
      message: buildSellerMessage(round),
      detail: {
        type: "seller_offer",
        round: round.round,
        phase: getSellerTurnPhase(rounds, index),
        seller_price: price(round.state.seller_price),
        seller_agent: sellerAgent.name,
        seller_agent_type: sellerAgent.kind,
        gap_to_previous_buyer_offer: price(sellerTurnGap),
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
        action: round.final.decision.action,
        counter_price: price(round.final.decision.price),
        tactic_used: round.final.decision.tactic_used,
        buyer_agent: buyerAgent.name,
        buyer_agent_type: buyerAgent.kind,
        reasoning: normalizeCurrencyText(round.final.decision.reasoning),
        non_price_terms: humanizeNonPriceTerms(round.final.decision.non_price_terms),
        safety: buildSafetyDetail(round),
        state: {
          buyer_price: price(round.state.buyer_price),
          seller_price: price(round.state.seller_price),
          gap: price(round.state.gap),
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

function DetailPanel({ turn }: { turn: ConversationTurn | null }) {
  return (
    <div className="min-h-[280px] rounded-xl border border-slate-700 bg-slate-950/70 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-white">구조화된 내용</h3>
        {turn?.round && (
          <span className="rounded-md bg-slate-800 px-2 py-1 text-[10px] font-mono text-slate-400">
            round {turn.round}
          </span>
        )}
      </div>
      {turn ? (
        <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-900/80 p-3 text-[11px] leading-5 text-slate-300">
          {JSON.stringify(turn.detail, null, 2)}
        </pre>
      ) : (
        <div className="flex min-h-[210px] items-center justify-center rounded-lg border border-dashed border-slate-800 text-center text-sm text-slate-500">
          대화 말풍선을 선택하면 가격, 전술, 검증, 파이프라인 출력을 확인할 수 있습니다.
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
          <img src={avatar} alt="" className="h-full w-full object-contain" />
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
  autoTradeRunning,
  onRunAutoTrade,
  onReset,
}: AutoTradeShowcaseProps) {
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(null);
  const buyerAgent = getBeing(buyerAncientId);
  const sellerAgent = getBeing(sellerAncientId);
  const buyerExpression = getBuyerExpression(rounds);
  const sellerExpression = getSellerExpression(rounds);
  const buyerAvatar = getExpressionImage(buyerAgent, buyerExpression);
  const sellerAvatar = getExpressionImage(sellerAgent, sellerExpression);
  const sellerPrice = rounds[rounds.length - 1]?.state.seller_price ?? initResponse?.strategy.floor_price;
  const buyerPrice = rounds[rounds.length - 1]?.final.decision.price ?? initResponse?.strategy.target_price;
  const turns = useMemo(
    () => buildConversation(initResponse, rounds, buyerAgent, sellerAgent),
    [initResponse, rounds, buyerAgent, sellerAgent],
  );
  const selectedTurn = turns.find((turn) => turn.id === selectedTurnId) ?? turns[turns.length - 1] ?? null;
  const running = autoTradeRunning || demoState === "INITIALIZING" || demoState === "ROUND_RUNNING";
  const done = demoState === "SESSION_DONE" || rounds.some((round) => round.state.done);

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
            onClick={onRunAutoTrade}
            disabled={running}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span aria-hidden="true">{running ? "…" : "▶"}</span>
            {running ? "자동 거래 실행 중" : "자동 거래 실행"}
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

      <div className="mb-4 grid gap-3 lg:grid-cols-2">
        <AgentPanel
          label="구매자 에이전트"
          agent={buyerAgent}
          avatar={buyerAvatar}
          priceLabel={price(buyerPrice)}
          tone="cyan"
        />
        <AgentPanel
          label="판매자 에이전트"
          agent={sellerAgent}
          avatar={sellerAvatar}
          priceLabel={price(sellerPrice)}
          tone="amber"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <div className="rounded-xl border border-slate-700 bg-slate-950/50 p-3">
          <div className="mb-3 flex items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div>
              <p className="text-sm font-semibold text-white">
                iPhone 15 Pro 256GB Natural Titanium
              </p>
              <p className="text-xs text-slate-400">
                battery 92%, screen mint, T-Mobile unlocked
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
                자동 거래를 실행하면 판매자와 구매자 에이전트가 번갈아 협상하는 모습을 볼 수 있습니다.
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
                    <img src={turn.avatar} alt="" className="h-full w-full object-contain" />
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
                          {price(turn.price)}
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
