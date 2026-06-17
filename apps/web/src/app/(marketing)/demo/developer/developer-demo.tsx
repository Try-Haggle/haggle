"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { executeRound, initDemo } from "@/lib/demo-api";
import type { DemoInitRequest, DemoInitResponse, DemoRoundResponse } from "@/lib/demo-types";
import type { PresetTuningDraft, StoredMemoryCard } from "@/lib/intelligence-demo-api";
import { recordPresetTuningFeedback, resetDemoMemory } from "@/lib/intelligence-demo-api";
import type {
  AdvisorListing,
  NegotiationAgentBuilderMemory,
} from "@/lib/negotiation-agent-builder-types";
import { AgentProductAdvisor } from "./_components/agent-product-advisor";
import { AutoTradeShowcase, buildSellerVoiceMessage } from "./_components/auto-trade-showcase";
import { CostBadge } from "./_components/cost-badge";
import { DbTableView } from "./_components/db-table-view";
import { DemoSignupShowcase } from "./_components/demo-signup-showcase";
import {
  type AncientBeingId,
  AncientBeingSelector,
  NegotiationAvatarCoach,
} from "./_components/negotiation-avatar-coach";
import { PipelineViewer } from "./_components/pipeline-viewer";
import { RoundControl } from "./_components/round-control";
import { SessionInitPanel } from "./_components/session-init-panel";
import { TagGardenIntelligencePanel } from "./_components/tag-garden-intelligence-panel";
import { StateGauge } from "./_components/utility-bar";

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
  memory: NegotiationAgentBuilderMemory | null,
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
      ? `leverage: ${tuningDraft.leverage
          .filter((item) => item.enabled)
          .map((item) => item.label)
          .join(", ")}`
      : null,
    tuningDraft?.walkAway.filter((item) => item.enabled).length
      ? `walk-away: ${tuningDraft.walkAway
          .filter((item) => item.enabled)
          .map((item) => item.label)
          .join(", ")}`
      : null,
  ]
    .filter(Boolean)
    .join(" | ");

  return {
    user_id: userId,
    item: {
      title: listing.title,
      condition: conditionParts,
      swappa_median_minor: listing.marketMedianMinor,
    },
    seller: { ask_price_minor: listing.askPriceMinor, floor_price_minor: listing.floorPriceMinor },
    buyer_budget: {
      max_budget_minor:
        tuningDraft?.priceCapMinor ??
        (memory?.budgetMax
          ? dollarsToMinor(memory.budgetMax)
          : Math.max(listing.askPriceMinor, listing.marketMedianMinor)),
    },
    language: "ko",
    preset:
      draftPreset ??
      (memory?.riskStyle === "safe_first"
        ? "safe_first"
        : memory?.riskStyle === "lowest_price"
          ? "lowest_price"
          : "balanced"),
    preset_tuning_draft: tuningDraft?.negotiationStartPayload,
  };
}

function mapDraftPresetToDemoPreset(
  presetId: PresetTuningDraft["presetId"],
): DemoInitRequest["preset"] {
  switch (presetId) {
    case "safe_buyer":
      return "safe_first";
    case "lowest_price":
      return "lowest_price";
    case "fast_close":
      return "balanced";
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
    return "border-error/25 bg-error-soft text-error";
  }
  if (/skipped|찾지 못했습니다/i.test(message)) {
    return "border-warning/25 bg-warning-soft text-warning";
  }
  return "border-success/20 bg-success-soft text-success";
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
  const [negotiationAgentBuilderMemory, setNegotiationAgentBuilderMemory] =
    useState<NegotiationAgentBuilderMemory | null>(null);
  const [presetTuningDraft, setPresetTuningDraft] = useState<PresetTuningDraft | null>(null);
  const [negotiationBlockedReason, setNegotiationBlockedReason] = useState<string | null>(null);
  const [demoUserId, setDemoUserId] = useState(DEMO_USER_ID);
  const [autoTradeRunning, setAutoTradeRunning] = useState(false);
  const [endingDemo, setEndingDemo] = useState(false);
  const [presetFeedbackUpdate, setPresetFeedbackUpdate] = useState<PresetFeedbackUpdate | null>(
    null,
  );
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
    [buyerAncientId, demoUserId],
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
  const handleReset = useCallback(() => {
    setAutoTradeRunning(false);
    setDemoState("IDLE");
    setDemoId(null);
    setInitResponse(null);
    setRounds([]);
    setError(null);
    setPresetFeedbackMessage(null);
  }, []);

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
      setNegotiationAgentBuilderMemory(null);
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
  }, [demoUserId, handleReset]);

  const handleStartNegotiationFromAdvisor = (
    listing: AdvisorListing,
    memory: NegotiationAgentBuilderMemory,
    readiness: { ready: boolean; reason: string | null },
  ) => {
    setSelectedListing(listing);
    setNegotiationAgentBuilderMemory(memory);
    setNegotiationBlockedReason(readiness.ready ? null : readiness.reason);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: dependency list intentionally fixed for this demo handler
  const handleRunAutoTrade = useCallback(
    async (listingOverride?: AdvisorListing, memoryOverride?: NegotiationAgentBuilderMemory) => {
      const listing = listingOverride ?? selectedListing;
      const memory = memoryOverride ?? negotiationAgentBuilderMemory;
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
            const message =
              feedback.memory_cards.length > 0
                ? `Preset feedback recorded: ${outcome}, strength ${deltaLabel}`
                : `Preset feedback skipped: ${outcome} 결과를 기록할 저장 후보를 찾지 못했습니다.`;
            setPresetFeedbackUpdate({
              id: `${feedback.memory_key}:${Date.now()}`,
              cards: feedback.memory_cards,
              message,
            });
            setPresetFeedbackMessage(message);
          } catch (feedbackError) {
            setPresetFeedbackMessage(
              feedbackError instanceof Error
                ? `협상은 완료됐지만 preset feedback 저장은 실패했습니다: ${feedbackError.message}`
                : "협상은 완료됐지만 preset feedback 저장은 실패했습니다.",
            );
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "자동 거래 실행에 실패했습니다");
        setDemoState("IDLE");
      } finally {
        setAutoTradeRunning(false);
      }
    },
    [
      negotiationAgentBuilderMemory,
      buyerAncientId,
      demoUserId,
      negotiationBlockedReason,
      presetTuningDraft,
      selectedListing,
      sellerAncientId,
    ],
  );

  /* ── Derived ── */
  const latestRound = rounds.length > 0 ? rounds[rounds.length - 1] : null;
  const nextRoundNumber = (latestRound?.round ?? 0) + 1;
  const lastBuyerPrice = latestRound?.final.decision.price ?? 0;
  const effectiveStartBlockedReason =
    negotiationBlockedReason ??
    engineReviewBlockedReason(
      presetTuningDraft && selectedListing && presetTuningDraft.listing.id === selectedListing.id
        ? presetTuningDraft
        : null,
    );

  return (
    <div className="min-h-screen">
      <section className="mx-auto max-w-5xl px-4 sm:px-6 pt-10 sm:pt-14 pb-20">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-info/30 bg-info-soft px-3 py-1 text-xs text-info mb-4">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-info animate-pulse" />
            Developer Mode
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-ink mb-2">
            6-Stage LLM 파이프라인 X-Ray
          </h1>
          <p className="text-ink-secondary max-w-2xl mx-auto">
            협상 엔진의 각 단계가 실시간으로 실행되는 과정을 확인하세요. 시스템 프롬프트, LLM 응답,
            파싱 결과, DB 상태 변화를 투명하게 보여줍니다.
          </p>
          <div className="mt-3">
            <Link
              href="/demo/try"
              className="text-sm text-ink-muted hover:text-action-primary transition-colors"
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
          <div className="rounded-xl border border-line bg-surface-raised p-4">
            <h3 className="text-sm font-semibold text-ink">판매자 에이전트</h3>
            <p className="mt-1 text-xs leading-5 text-ink-secondary">
              이 상담 데모에서는 판매자 쪽을 기본 에이전트 하나로 고정합니다. 구매자 메모리와 상품
              조건이 협상 모델을 바꾸는지 보는 것이 목적입니다.
            </p>
            <div className="mt-3 rounded-lg border border-badge/20 bg-badge px-3 py-2 text-sm font-semibold text-badge-text">
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
          buyerMemory={negotiationAgentBuilderMemory}
          autoTradeRunning={autoTradeRunning}
          startBlockedReason={effectiveStartBlockedReason}
          onRunAutoTrade={handleRunAutoTrade}
          onReset={handleReset}
        />

        {presetFeedbackMessage && (
          <div
            className={`mt-3 rounded-xl border px-4 py-3 text-xs leading-5 ${presetFeedbackMessageClass(presetFeedbackMessage)}`}
          >
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
          <div className="rounded-xl border border-error/30 bg-error-soft px-4 py-3 mb-4 text-sm text-error">
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
              className="rounded-xl border border-line bg-surface-raised p-5"
              style={{ animation: "fadeInUp 0.3s ease-out" }}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-ink">AI 전략 (LLM 생성)</h3>
                <span className="text-[10px] font-mono text-ink-muted bg-surface-sunken px-2 py-0.5 rounded">
                  세션 {initResponse.demo_id.slice(0, 12)}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="rounded-lg bg-surface-sunken p-3">
                  <span className="text-ink-muted block mb-1">목표가</span>
                  <span className="text-action-primary font-mono font-bold text-base">
                    {formatMinor(initResponse.strategy.target_price)}
                  </span>
                </div>
                <div className="rounded-lg bg-surface-sunken p-3">
                  <span className="text-ink-muted block mb-1">최대 지불가</span>
                  <span className="text-warning font-mono font-bold text-base">
                    {formatMinor(initResponse.strategy.floor_price)}
                  </span>
                </div>
                <div className="rounded-lg bg-surface-sunken p-3">
                  <span className="text-ink-muted block mb-1">협상 스타일</span>
                  <span className="text-ink font-semibold text-base capitalize">
                    {initResponse.strategy.negotiation_style}
                  </span>
                </div>
                <div className="rounded-lg bg-surface-sunken p-3">
                  <span className="text-ink-muted block mb-1">개시 전술</span>
                  <span className="text-ink font-semibold text-base">
                    {initResponse.strategy.opening_tactic}
                  </span>
                </div>
              </div>
              {initResponse.strategy.approach && (
                <p className="mt-3 text-xs text-ink-secondary italic">
                  전략: {initResponse.strategy.approach}
                </p>
              )}
              {initResponse.strategy.key_concerns.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="rounded-md bg-surface-sunken px-2 py-0.5 text-[10px] text-ink-muted">
                    검증/협상 리스크
                  </span>
                  {initResponse.strategy.key_concerns.map((c) => (
                    <span
                      key={c}
                      className="rounded-md bg-surface-sunken px-2 py-0.5 text-[10px] text-ink-secondary"
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
                className="rounded-xl border border-line bg-surface-raised p-5"
                style={{ animation: "fadeInUp 0.3s ease-out 0.1s both" }}
              >
                <h3 className="text-sm font-semibold text-ink mb-3">Skill Stack (로드된 스킬)</h3>
                <div className="flex flex-wrap gap-2">
                  {initResponse.skills.map((sk) => (
                    <div key={sk.id} className="rounded-lg bg-surface-sunken px-3 py-2 text-xs">
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase mr-2 ${
                          sk.type === "knowledge"
                            ? "bg-info-soft text-info"
                            : sk.type === "advisor"
                              ? "bg-warning-soft text-warning"
                              : "bg-surface-overlay text-ink-secondary"
                        }`}
                      >
                        {sk.type}
                      </span>
                      <span className="text-ink font-medium">{sk.name}</span>
                      <span className="text-ink-muted ml-2">hooks: {sk.hooks.join(", ")}</span>
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
                  <div className="h-px flex-1 bg-gradient-to-r from-transparent via-line-strong to-transparent" />
                  <span className="text-sm font-bold text-ink bg-surface-raised px-4 py-1 rounded-full border border-line">
                    라운드 {round.round}
                  </span>
                  <div className="h-px flex-1 bg-gradient-to-r from-transparent via-line-strong to-transparent" />
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
                  <div
                    className={`rounded-lg px-4 py-2.5 text-xs flex items-center gap-2 ${
                      round.final.validation.passed
                        ? "bg-success-soft border border-success/20 text-success"
                        : "bg-warning-soft border border-warning/20 text-warning"
                    }`}
                  >
                    <span>{round.final.validation.passed ? "✓" : "⚠"}</span>
                    <span>
                      안전 확인: 핵심 규칙{" "}
                      {round.final.validation.hard_passed ? "통과" : "확인 필요"}
                      {round.final.validation.violations.length > 0 && (
                        <>
                          {" "}
                          | 점검 {round.final.validation.violations.length}건 (
                          {
                            round.final.validation.violations.filter((v) => v.severity === "HARD")
                              .length
                          }{" "}
                          HARD,{" "}
                          {
                            round.final.validation.violations.filter((v) => v.severity === "SOFT")
                              .length
                          }{" "}
                          SOFT)
                        </>
                      )}
                      {round.final.validation.auto_fix_applied && " | 안전 범위로 정리됨"}
                    </span>
                  </div>
                )}

                {/* Phase Transition */}
                {round.final.phase_transition?.transitioned && (
                  <div className="rounded-lg bg-info-soft border border-info/20 px-4 py-2.5 text-xs text-info flex items-center gap-2">
                    <span>↗</span>
                    <span>
                      Phase 전이: {round.final.phase_transition.from} →{" "}
                      {round.final.phase_transition.to}
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
              <DbTableView demoId={demoId} rounds={rounds} initResponse={initResponse} />
            )}

            {/* ── Round Control ── */}
            {(demoState === "READY" ||
              demoState === "ROUND_DONE" ||
              demoState === "ROUND_RUNNING") && (
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
                className="rounded-xl border border-success/30 bg-success-soft p-6 text-center"
                style={{ animation: "fadeInUp 0.3s ease-out" }}
              >
                <p className="text-success text-sm mb-1">협상 완료</p>
                <p className="text-2xl font-bold text-ink mb-2">
                  {latestRound.final.decision.action === "ACCEPT"
                    ? `${formatMinor(latestRound.final.decision.price)}에 거래 성사`
                    : `종료: ${latestRound.final.decision.action}`}
                </p>
                <p className="text-sm text-ink-secondary mb-4">
                  총 {rounds.length}라운드
                  {" | "}
                  비용: ${totalCost.usd.toFixed(4)}
                  {" | "}
                  {(totalCost.prompt + totalCost.completion).toLocaleString()} 토큰
                </p>
                <div className="flex items-center justify-center gap-3">
                  {latestRound.final.decision.action === "ACCEPT" && (
                    <button
                      type="button"
                      onClick={() => {
                        sessionStorage.setItem(
                          "haggle_checkout",
                          JSON.stringify({
                            price: latestRound.final.decision.price,
                            item: initResponse?.strategy.approach ?? "iPhone 14 Pro 128GB",
                            rounds: rounds.length,
                          }),
                        );
                        window.location.href = "/demo/checkout";
                      }}
                      className="rounded-xl bg-success px-6 py-2.5 text-sm font-medium text-on-accent hover:bg-success transition-colors cursor-pointer"
                    >
                      결제 페이지로 이동 &rarr;
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleReset}
                    className="rounded-xl border border-line px-6 py-2.5 text-sm font-medium text-ink-secondary hover:border-line-strong hover:text-ink transition-colors cursor-pointer"
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
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-action-primary/30 to-transparent" />
              <span className="text-sm font-bold text-ink bg-action-primary/10 px-4 py-1 rounded-full border border-action-primary/30">
                온보딩은 얼마나 쉬운가?
              </span>
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-action-primary/30 to-transparent" />
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
