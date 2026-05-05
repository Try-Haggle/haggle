"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { initDemo, executeRound } from "@/lib/demo-api";
import { recordPresetTuningFeedback, resetDemoMemory } from "@/lib/intelligence-demo-api";
import type { PresetTuningDraft, StoredMemoryCard } from "@/lib/intelligence-demo-api";
import type { DemoInitRequest, DemoInitResponse, DemoRoundResponse, StageTrace } from "@/lib/demo-types";
import { SessionInitPanel } from "./_components/session-init-panel";
import { PipelineViewer } from "./_components/pipeline-viewer";
import { RoundControl } from "./_components/round-control";
import { StateGauge } from "./_components/utility-bar";
import { DbTableView } from "./_components/db-table-view";
import { CostBadge } from "./_components/cost-badge";
import { DemoSignupShowcase } from "./_components/demo-signup-showcase";
import { AutoTradeShowcase, buildSellerVoiceMessage } from "./_components/auto-trade-showcase";
import { TagGardenIntelligencePanel } from "./_components/tag-garden-intelligence-panel";
import type { AdvisorListing, AdvisorMemory } from "@/lib/advisor-demo-types";
import { AgentProductAdvisor } from "./_components/agent-product-advisor";
import {
  AncientBeingSelector,
  NegotiationAvatarCoach,
  type AncientBeingId,
} from "./_components/negotiation-avatar-coach";

/* ── State Machine ──────────────────────────── */

type DemoState =
  | "IDLE"
  | "INITIALIZING"
  | "READY"
  | "ROUND_RUNNING"
  | "ROUND_DONE"
  | "SESSION_DONE";

type PresetFeedbackUpdate = {
  id: string;
  cards: StoredMemoryCard[];
  message: string;
};

/* ── Helpers ────────────────────────────────── */

/** Demo engine prices are minor units (cents). User inputs are converted at boundaries. */
function formatMinor(v: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: v % 100 === 0 ? 0 : 2,
  }).format(v / 100);
}

function dollarsToMinor(v: number): number {
  return Math.round(v * 100);
}

const DEFAULT_SELLER_AGENT_ID: AncientBeingId = "dealer_hana";
const DEMO_USER_ID = "11111111-1111-4111-8111-111111111111";
const DEMO_USER_STORAGE_KEY = "haggle.developerDemo.userId";

function createDemoUserId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return "22222222-2222-4222-8222-" + Math.random().toString().slice(2, 14).padEnd(12, "0");
}

function getOrCreateDemoUserId(): string {
  if (typeof window === "undefined") return DEMO_USER_ID;

  const existing = window.localStorage.getItem(DEMO_USER_STORAGE_KEY);
  if (existing) return existing;

  const next = createDemoUserId();
  window.localStorage.setItem(DEMO_USER_STORAGE_KEY, next);
  return next;
}

function buildAutoTradeParams(
  listing: AdvisorListing,
  memory: AdvisorMemory | null,
  userId: string,
  tuningDraft?: PresetTuningDraft | null,
): DemoInitRequest {
  const draftPreset = tuningDraft ? mapDraftPresetToDemoPreset(tuningDraft.presetId) : null;
  const conditionParts = [
    listing.condition,
    listing.tags.length > 0 ? `tags: ${listing.tags.join(", ")}` : null,
    tuningDraft
      ? `approved preset: ${tuningDraft.presetLabel}; opening ${formatMinor(tuningDraft.openingOfferMinor)}; cap ${formatMinor(tuningDraft.priceCapMinor)}`
      : null,
    tuningDraft?.mustVerify.length
      ? `must verify: ${tuningDraft.mustVerify.map((term) => `${term.label}(${term.enforcement})`).join(", ")}`
      : null,
    tuningDraft?.leverage.filter((item) => item.enabled).length
      ? `leverage: ${tuningDraft.leverage.filter((item) => item.enabled).map((item) => item.label).join(", ")}`
      : null,
    tuningDraft?.walkAway.filter((item) => item.enabled).length
      ? `walk-away: ${tuningDraft.walkAway.filter((item) => item.enabled).map((item) => item.label).join(", ")}`
      : null,
  ].filter(Boolean).join(" | ");

  return {
    user_id: userId,
    item: {
      title: listing.title,
      condition: conditionParts,
      swappa_median_minor: listing.marketMedianMinor,
    },
    seller: { ask_price_minor: listing.askPriceMinor, floor_price_minor: listing.floorPriceMinor },
    buyer_budget: {
      max_budget_minor: tuningDraft?.priceCapMinor ?? (memory?.budgetMax
        ? dollarsToMinor(memory.budgetMax)
        : Math.max(listing.askPriceMinor, listing.marketMedianMinor)),
    },
    language: "ko",
    preset: draftPreset ?? (
      memory?.riskStyle === "safe_first"
        ? "safe_first"
        : memory?.riskStyle === "lowest_price"
          ? "lowest_price"
          : "balanced"
    ),
    preset_tuning_draft: tuningDraft?.negotiationStartPayload,
  };
}

function mapDraftPresetToDemoPreset(presetId: PresetTuningDraft["presetId"]): DemoInitRequest["preset"] {
  switch (presetId) {
    case "safe_buyer": return "safe_first";
    case "lowest_price": return "lowest_price";
    case "fast_close": return "balanced";
    case "balanced_closer":
    default:
      return "balanced";
  }
}

function presetFeedbackOutcome(
  round: DemoRoundResponse,
  priceCapMinor: number,
): "accepted" | "rejected" | "abandoned" | "cap_blocked" {
  const action = round.final.decision.action;
  const price = round.final.decision.price;
  if (price > priceCapMinor) return "cap_blocked";
  if (action === "ACCEPT") return "accepted";
  if (action === "REJECT") return "rejected";
  return "abandoned";
}

function presetFeedbackMessageClass(message: string): string {
  if (/실패|failed/i.test(message)) {
    return "border-red-500/25 bg-red-500/10 text-red-100";
  }
  if (/skipped|찾지 못했습니다/i.test(message)) {
    return "border-amber-500/25 bg-amber-500/10 text-amber-100";
  }
  return "border-emerald-500/20 bg-emerald-500/10 text-emerald-100";
}

function engineReviewBlockedReason(draft: PresetTuningDraft | null): string | null {
  const review = draft?.engineReview;
  if (!review || review.status === "ready") return null;
  const nextAction = review.nextActions[0];
  const blocker = review.blockers[0];

  if (review.status === "blocked") {
    return blocker
      ? `Engine gate blocked: ${blocker.label}. ${blocker.reason}`
      : "Engine gate blocked: 상품 scope 또는 필수 조건을 먼저 확인해야 합니다.";
  }

  if (nextAction) {
    return `Engine gate needs input: ${nextAction.question}`;
  }

  return "Engine gate needs input: 필수 조건을 먼저 확인해야 합니다.";
}

function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ── Main Component ─────────────────────────── */

export function DeveloperDemo() {
  const [demoState, setDemoState] = useState<DemoState>("IDLE");
  const [demoId, setDemoId] = useState<string | null>(null);
  const [initResponse, setInitResponse] = useState<DemoInitResponse | null>(null);
  const [rounds, setRounds] = useState<DemoRoundResponse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [buyerAncientId, setBuyerAncientId] = useState<AncientBeingId>("fab");
  const sellerAncientId = DEFAULT_SELLER_AGENT_ID;
  const [selectedListing, setSelectedListing] = useState<AdvisorListing | null>(null);
  const [advisorMemory, setAdvisorMemory] = useState<AdvisorMemory | null>(null);
  const [presetTuningDraft, setPresetTuningDraft] = useState<PresetTuningDraft | null>(null);
  const [negotiationBlockedReason, setNegotiationBlockedReason] = useState<string | null>(null);
  const [demoUserId, setDemoUserId] = useState(DEMO_USER_ID);
  const [autoTradeRunning, setAutoTradeRunning] = useState(false);
  const [endingDemo, setEndingDemo] = useState(false);
  const [presetFeedbackUpdate, setPresetFeedbackUpdate] = useState<PresetFeedbackUpdate | null>(null);
  const [presetFeedbackMessage, setPresetFeedbackMessage] = useState<string | null>(null);

  useEffect(() => {
    setDemoUserId(getOrCreateDemoUserId());
  }, []);

  /* ── Cost Tracking ── */
  const totalCost = (() => {
    let usd = initResponse?.cost.total_usd ?? 0;
    let prompt = initResponse?.cost.total_tokens.prompt ?? 0;
    let completion = initResponse?.cost.total_tokens.completion ?? 0;

    if (rounds.length > 0) {
      const last = rounds[rounds.length - 1];
      usd = last.cost.total_usd;
      prompt = last.cost.total_tokens.prompt;
      completion = last.cost.total_tokens.completion;
    }

    return { usd, prompt, completion };
  })();

  /* ── Initialize ── */
  const handleInit = useCallback(
    async (params: DemoInitRequest) => {
      setError(null);
      setDemoState("INITIALIZING");
      try {
        const resp = await initDemo({
          user_id: demoUserId,
          ...params,
          buyer_agent_id: buyerAncientId,
          seller_agent_id: sellerAncientId,
        });
        setInitResponse(resp);
        setDemoId(resp.demo_id);
        setRounds([]);
        setDemoState("READY");
      } catch (err) {
        setError(err instanceof Error ? err.message : "데모 초기화에 실패했습니다");
        setDemoState("IDLE");
      }
    },
    [buyerAncientId, demoUserId, sellerAncientId],
  );

  /* ── Execute Round ── */
  const handleRound = useCallback(
    async (params: { seller_price_minor: number; seller_message?: string }) => {
      if (!demoId) return;
      setError(null);
      setDemoState("ROUND_RUNNING");
      try {
        const resp = await executeRound(demoId, params);
        setRounds((prev) => [...prev, resp]);
        if (resp.state.done) {
          setDemoState("SESSION_DONE");
        } else {
          setDemoState("ROUND_DONE");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "라운드 실행에 실패했습니다");
        setDemoState("ROUND_DONE");
      }
    },
    [demoId],
  );

  /* ── Reset ── */
  const handleReset = () => {
    setAutoTradeRunning(false);
    setDemoState("IDLE");
    setDemoId(null);
    setInitResponse(null);
    setRounds([]);
    setError(null);
    setPresetFeedbackMessage(null);
  };

  const handleEndDemo = useCallback(async () => {
    setEndingDemo(true);
    setError(null);
    try {
      await resetDemoMemory(demoUserId);
      const nextUserId = createDemoUserId();
      if (typeof window !== "undefined") {
        window.localStorage.setItem(DEMO_USER_STORAGE_KEY, nextUserId);
      }
      setDemoUserId(nextUserId);
      setSelectedListing(null);
      setAdvisorMemory(null);
      setPresetTuningDraft(null);
      setPresetFeedbackUpdate(null);
      setPresetFeedbackMessage(null);
      setNegotiationBlockedReason(null);
      handleReset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "데모 데이터 삭제에 실패했습니다");
    } finally {
      setEndingDemo(false);
    }
  }, [demoUserId]);

  const handleStartNegotiationFromAdvisor = (
    listing: AdvisorListing,
    memory: AdvisorMemory,
    readiness: { ready: boolean; reason: string | null },
  ) => {
    setSelectedListing(listing);
    setAdvisorMemory(memory);
    setNegotiationBlockedReason(readiness.ready ? null : readiness.reason);
  };

  const handleRunAutoTrade = useCallback(async (listingOverride?: AdvisorListing, memoryOverride?: AdvisorMemory) => {
    const listing = listingOverride ?? selectedListing;
    const memory = memoryOverride ?? advisorMemory;
    const draft = listing?.id === selectedListing?.id ? presetTuningDraft : null;
    const startBlockedReason = negotiationBlockedReason ?? engineReviewBlockedReason(draft);

    if (!listing) {
      setError("실제 등록 상품을 먼저 선택해 주세요.");
      return;
    }
    if (startBlockedReason) {
      setError(startBlockedReason);
      return;
    }

    setError(null);
    setPresetFeedbackMessage(null);
    setAutoTradeRunning(true);
    setDemoState("INITIALIZING");
    setDemoId(null);
    setInitResponse(null);
    setRounds([]);

    try {
      const init = await initDemo({
        ...buildAutoTradeParams(listing, memory, demoUserId, draft),
        buyer_agent_id: buyerAncientId,
        seller_agent_id: sellerAncientId,
      });
      setInitResponse(init);
      setDemoId(init.demo_id);
      setDemoState("READY");
      await pause(650);

      let latestRound: DemoRoundResponse | null = null;
      let finalRoundForFeedback: DemoRoundResponse | null = null;
      let sessionDone = false;

      for (const [index, turn] of listing.sellerTurns.entries()) {
        setDemoState("ROUND_RUNNING");
        const round = await executeRound(init.demo_id, {
          ...turn,
          seller_message: buildSellerVoiceMessage(sellerAncientId, {
            priceMinor: turn.seller_price_minor,
            roundIndex: index,
            listingTitle: listing.title,
            baseMessage: turn.seller_message,
          }),
        });
        latestRound = round;
        setRounds((prev) => [...prev, round]);

        if (round.state.done) {
          sessionDone = true;
          finalRoundForFeedback = round;
          setDemoState("SESSION_DONE");
          break;
        }

        setDemoState("ROUND_DONE");
        await pause(850);
      }

      if (!sessionDone && latestRound?.final.decision.price) {
        setDemoState("ROUND_RUNNING");
        const acceptRound = await executeRound(init.demo_id, {
          seller_price_minor: latestRound.final.decision.price,
          seller_message: buildSellerVoiceMessage(sellerAncientId, {
            priceMinor: latestRound.final.decision.price,
            roundIndex: listing.sellerTurns.length,
            listingTitle: listing.title,
            finalAccept: true,
          }),
        });
        setRounds((prev) => [...prev, acceptRound]);
        finalRoundForFeedback = acceptRound;
        setDemoState(acceptRound.state.done ? "SESSION_DONE" : "ROUND_DONE");
      } else if (!sessionDone) {
        finalRoundForFeedback = latestRound;
        setDemoState("ROUND_DONE");
      }

      if (draft?.appliedTunedCandidate && finalRoundForFeedback) {
        const outcome = presetFeedbackOutcome(finalRoundForFeedback, draft.priceCapMinor);
        try {
          const feedback = await recordPresetTuningFeedback({
            userId: demoUserId,
            memoryKey: draft.appliedTunedCandidate.memoryKey,
            outcome,
            finalPriceMinor: finalRoundForFeedback.final.decision.price,
            priceCapMinor: draft.priceCapMinor,
            applicationMode: draft.appliedTunedCandidate.applicationMode,
          });
          const deltaLabel = `${feedback.delta >= 0 ? "+" : ""}${(feedback.delta * 100).toFixed(1)}pp`;
          const message = feedback.memory_cards.length > 0
            ? `Preset feedback recorded: ${outcome}, strength ${deltaLabel}`
            : `Preset feedback skipped: ${outcome} 결과를 기록할 저장 후보를 찾지 못했습니다.`;
          setPresetFeedbackUpdate({
            id: `${feedback.memory_key}:${Date.now()}`,
            cards: feedback.memory_cards,
            message,
          });
          setPresetFeedbackMessage(message);
        } catch (feedbackError) {
          setPresetFeedbackMessage(feedbackError instanceof Error
            ? `협상은 완료됐지만 preset feedback 저장은 실패했습니다: ${feedbackError.message}`
            : "협상은 완료됐지만 preset feedback 저장은 실패했습니다.");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "자동 거래 실행에 실패했습니다");
      setDemoState("IDLE");
    } finally {
      setAutoTradeRunning(false);
    }
  }, [advisorMemory, buyerAncientId, demoUserId, negotiationBlockedReason, presetTuningDraft, selectedListing, sellerAncientId]);

  /* ── Derived ── */
  const latestRound = rounds.length > 0 ? rounds[rounds.length - 1] : null;
  const nextRoundNumber = (latestRound?.round ?? 0) + 1;
  const lastBuyerPrice = latestRound?.final.decision.price ?? 0;
  const effectiveStartBlockedReason = negotiationBlockedReason
    ?? engineReviewBlockedReason(
      presetTuningDraft && selectedListing && presetTuningDraft.listing.id === selectedListing.id
        ? presetTuningDraft
        : null,
    );

  return (
    <div className="min-h-screen">
      <section className="mx-auto max-w-5xl px-4 sm:px-6 pt-10 sm:pt-14 pb-20">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/30 bg-purple-500/10 px-3 py-1 text-xs text-purple-300 mb-4">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
            Developer Mode
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2">
            6-Stage LLM 파이프라인 X-Ray
          </h1>
          <p className="text-slate-400 max-w-2xl mx-auto">
            협상 엔진의 각 단계가 실시간으로 실행되는 과정을 확인하세요.
            시스템 프롬프트, LLM 응답, 파싱 결과, DB 상태 변화를 투명하게 보여줍니다.
          </p>
          <div className="mt-3">
            <Link
              href="/demo/try"
              className="text-sm text-slate-500 hover:text-cyan-400 transition-colors"
            >
              &larr; 사용자 데모로 돌아가기
            </Link>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <AncientBeingSelector
            selectedId={buyerAncientId}
            onSelect={setBuyerAncientId}
            title="구매자 에이전트"
            description="보유한 고대 존재, 딜러, 버디 중 구매자 측 에이전트를 선택하세요."
            defaultLabel="구매자: 팹"
            testId="buyer-agent-selector"
          />
          <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
            <h3 className="text-sm font-semibold text-white">판매자 에이전트</h3>
            <p className="mt-1 text-xs leading-5 text-slate-400">
              이 상담 데모에서는 판매자 쪽을 기본 에이전트 하나로 고정합니다. 구매자 메모리와 상품 조건이 협상 모델을 바꾸는지 보는 것이 목적입니다.
            </p>
            <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-100">
              기본 판매자: 하나
            </div>
          </div>
        </div>

        <AgentProductAdvisor
          key={demoUserId}
          userId={demoUserId}
          selectedAgentId={buyerAncientId}
          selectedListingId={selectedListing?.id}
          onStartNegotiation={handleStartNegotiationFromAdvisor}
          onPresetDraftChange={setPresetTuningDraft}
          presetFeedbackUpdate={presetFeedbackUpdate}
          onEndDemo={handleEndDemo}
          endingDemo={endingDemo}
        />

        <AutoTradeShowcase
          demoState={demoState}
          initResponse={initResponse}
          rounds={rounds}
          buyerAncientId={buyerAncientId}
          sellerAncientId={sellerAncientId}
          listing={selectedListing}
          buyerMemory={advisorMemory}
          autoTradeRunning={autoTradeRunning}
          startBlockedReason={effectiveStartBlockedReason}
          onRunAutoTrade={handleRunAutoTrade}
          onReset={handleReset}
        />

        {presetFeedbackMessage && (
          <div className={`mt-3 rounded-xl border px-4 py-3 text-xs leading-5 ${presetFeedbackMessageClass(presetFeedbackMessage)}`}>
            {presetFeedbackMessage}
          </div>
        )}

        <TagGardenIntelligencePanel />

        {/* Cost Badge */}
        {demoState !== "IDLE" && (
          <div className="mt-4 flex justify-end mb-4">
            <CostBadge
              totalUsd={totalCost.usd}
              promptTokens={totalCost.prompt}
              completionTokens={totalCost.completion}
            />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 mb-4 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* ── IDLE / INITIALIZING: Show Init Form ── */}
        {(demoState === "IDLE" || demoState === "INITIALIZING") && (
          <SessionInitPanel onInitialize={handleInit} loading={demoState === "INITIALIZING"} />
        )}

        {/* ── Post-Init Content ── */}
        {initResponse && demoState !== "IDLE" && demoState !== "INITIALIZING" && (
          <div className="space-y-6">
            {/* Strategy Card */}
            <div
              className="rounded-xl border border-slate-700 bg-slate-800/50 p-5"
              style={{ animation: "fadeInUp 0.3s ease-out" }}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-white">
                  AI 전략 (LLM 생성)
                </h3>
                <span className="text-[10px] font-mono text-slate-500 bg-slate-700/50 px-2 py-0.5 rounded">
                  세션 {initResponse.demo_id.slice(0, 12)}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="rounded-lg bg-slate-900/60 p-3">
                  <span className="text-slate-500 block mb-1">목표가</span>
                  <span className="text-cyan-400 font-mono font-bold text-base">
                    {formatMinor(initResponse.strategy.target_price)}
                  </span>
                </div>
                <div className="rounded-lg bg-slate-900/60 p-3">
                  <span className="text-slate-500 block mb-1">최대 지불가</span>
                  <span className="text-amber-400 font-mono font-bold text-base">
                    {formatMinor(initResponse.strategy.floor_price)}
                  </span>
                </div>
                <div className="rounded-lg bg-slate-900/60 p-3">
                  <span className="text-slate-500 block mb-1">협상 스타일</span>
                  <span className="text-white font-semibold text-base capitalize">
                    {initResponse.strategy.negotiation_style}
                  </span>
                </div>
                <div className="rounded-lg bg-slate-900/60 p-3">
                  <span className="text-slate-500 block mb-1">개시 전술</span>
                  <span className="text-white font-semibold text-base">
                    {initResponse.strategy.opening_tactic}
                  </span>
                </div>
              </div>
              {initResponse.strategy.approach && (
                <p className="mt-3 text-xs text-slate-400 italic">
                  전략: {initResponse.strategy.approach}
                </p>
              )}
              {initResponse.strategy.key_concerns.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="rounded-md bg-slate-700/30 px-2 py-0.5 text-[10px] text-slate-500">
                    검증/협상 리스크
                  </span>
                  {initResponse.strategy.key_concerns.map((c, i) => (
                    <span
                      key={i}
                      className="rounded-md bg-slate-700/50 px-2 py-0.5 text-[10px] text-slate-400"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Loaded Skills */}
            {initResponse.skills && initResponse.skills.length > 0 && (
              <div
                className="rounded-xl border border-slate-700 bg-slate-800/50 p-5"
                style={{ animation: "fadeInUp 0.3s ease-out 0.1s both" }}
              >
                <h3 className="text-sm font-semibold text-white mb-3">
                  Skill Stack (로드된 스킬)
                </h3>
                <div className="flex flex-wrap gap-2">
                  {initResponse.skills.map((sk) => (
                    <div
                      key={sk.id}
                      className="rounded-lg bg-slate-900/60 px-3 py-2 text-xs"
                    >
                      <span className={`inline-block rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase mr-2 ${
                        sk.type === "knowledge"
                          ? "bg-blue-500/20 text-blue-300"
                          : sk.type === "advisor"
                            ? "bg-amber-500/20 text-amber-300"
                            : "bg-slate-500/20 text-slate-300"
                      }`}>
                        {sk.type}
                      </span>
                      <span className="text-white font-medium">{sk.name}</span>
                      <span className="text-slate-500 ml-2">
                        hooks: {sk.hooks.join(", ")}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Init Pipeline */}
            <PipelineViewer
              stages={initResponse.pipeline}
              label="초기화 파이프라인 (Stage 0a~0b)"
            />

            {/* ── Round Results ── */}
            {rounds.map((round, index) => (
              <div key={round.round} className="space-y-4">
                {/* Round Separator */}
                <div className="flex items-center gap-3 pt-6">
                  <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-600 to-transparent" />
                  <span className="text-sm font-bold text-white bg-slate-800 px-4 py-1 rounded-full border border-slate-700">
                    라운드 {round.round}
                  </span>
                  <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-600 to-transparent" />
                </div>

                <NegotiationAvatarCoach
                  round={round}
                  previousRound={rounds[index - 1]}
                  selectedId={buyerAncientId}
                />

                {/* State Gauge */}
                <StateGauge round={round} />

                {/* Validation Summary */}
                {round.final.validation && (
                  <div className={`rounded-lg px-4 py-2.5 text-xs flex items-center gap-2 ${
                    round.final.validation.passed
                      ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-300"
                      : "bg-amber-500/10 border border-amber-500/20 text-amber-300"
                  }`}>
                    <span>{round.final.validation.passed ? "✓" : "⚠"}</span>
                    <span>
                      안전 확인: 핵심 규칙 {round.final.validation.hard_passed ? "통과" : "확인 필요"}
                      {round.final.validation.violations.length > 0 && (
                        <> | 점검 {round.final.validation.violations.length}건
                          ({round.final.validation.violations.filter(v => v.severity === 'HARD').length} HARD,
                          {" "}{round.final.validation.violations.filter(v => v.severity === 'SOFT').length} SOFT)
                        </>
                      )}
                      {round.final.validation.auto_fix_applied && " | 안전 범위로 정리됨"}
                    </span>
                  </div>
                )}

                {/* Phase Transition */}
                {round.final.phase_transition?.transitioned && (
                  <div className="rounded-lg bg-purple-500/10 border border-purple-500/20 px-4 py-2.5 text-xs text-purple-300 flex items-center gap-2">
                    <span>↗</span>
                    <span>
                      Phase 전이: {round.final.phase_transition.from} → {round.final.phase_transition.to}
                    </span>
                  </div>
                )}

                {/* Pipeline Viewer */}
                <PipelineViewer
                  stages={round.pipeline}
                  label={`라운드 ${round.round} 파이프라인 (Stage 1~6)`}
                />
              </div>
            ))}

            {/* DB State - always visible after init */}
            {demoId && initResponse && (
              <DbTableView
                demoId={demoId}
                rounds={rounds}
                initResponse={initResponse}
              />
            )}

            {/* ── Round Control ── */}
            {(demoState === "READY" || demoState === "ROUND_DONE" || demoState === "ROUND_RUNNING") && (
              <RoundControl
                roundNumber={nextRoundNumber}
                lastBuyerPrice={lastBuyerPrice}
                onExecute={handleRound}
                loading={demoState === "ROUND_RUNNING"}
                disabled={demoState === "ROUND_RUNNING"}
              />
            )}

            {/* ── SESSION_DONE ── */}
            {demoState === "SESSION_DONE" && latestRound && (
              <div
                className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-6 text-center"
                style={{ animation: "fadeInUp 0.3s ease-out" }}
              >
                <p className="text-emerald-400 text-sm mb-1">
                  협상 완료
                </p>
                <p className="text-2xl font-bold text-white mb-2">
                  {latestRound.final.decision.action === "ACCEPT"
                    ? `${formatMinor(latestRound.final.decision.price)}에 거래 성사`
                    : `종료: ${latestRound.final.decision.action}`}
                </p>
                <p className="text-sm text-slate-400 mb-4">
                  총 {rounds.length}라운드
                  {" | "}
                  비용: ${totalCost.usd.toFixed(4)}
                  {" | "}
                  {(totalCost.prompt + totalCost.completion).toLocaleString()} 토큰
                </p>
                <div className="flex items-center justify-center gap-3">
                  {latestRound.final.decision.action === "ACCEPT" && (
                    <button
                      onClick={() => {
                        sessionStorage.setItem("haggle_checkout", JSON.stringify({
                          price: latestRound.final.decision.price,
                          item: initResponse?.strategy.approach ?? "iPhone 14 Pro 128GB",
                          rounds: rounds.length,
                        }));
                        window.location.href = "/demo/checkout";
                      }}
                      className="rounded-xl bg-emerald-500 px-6 py-2.5 text-sm font-medium text-white hover:bg-emerald-600 transition-colors cursor-pointer"
                    >
                      결제 페이지로 이동 &rarr;
                    </button>
                  )}
                  <button
                    onClick={handleReset}
                    className="rounded-xl border border-slate-700 px-6 py-2.5 text-sm font-medium text-slate-300 hover:border-slate-500 hover:text-white transition-colors cursor-pointer"
                  >
                    새 세션 시작
                  </button>
                </div>
              </div>
            )}

          </div>
        )}

        {/* ── Sign-up Showcase ── */}
        {demoState !== "IDLE" && demoState !== "INITIALIZING" && (
          <div className="mt-12 space-y-6">
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-cyan-600/30 to-transparent" />
              <span className="text-sm font-bold text-white bg-cyan-500/10 px-4 py-1 rounded-full border border-cyan-500/30">
                온보딩은 얼마나 쉬운가?
              </span>
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-cyan-600/30 to-transparent" />
            </div>
            <DemoSignupShowcase />
          </div>
        )}

      </section>

      <style jsx global>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
