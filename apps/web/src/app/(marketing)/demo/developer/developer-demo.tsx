"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import { initDemo, executeRound } from "@/lib/demo-api";
import type { DemoInitResponse, DemoRoundResponse, StageTrace } from "@/lib/demo-types";
import { SessionInitPanel } from "./_components/session-init-panel";
import { PipelineViewer } from "./_components/pipeline-viewer";
import { RoundControl } from "./_components/round-control";
import { StateGauge } from "./_components/utility-bar";
import { DbTableView } from "./_components/db-table-view";
import { CostBadge } from "./_components/cost-badge";

/* ── State Machine ──────────────────────────── */

type DemoState =
  | "IDLE"
  | "INITIALIZING"
  | "READY"
  | "ROUND_RUNNING"
  | "ROUND_DONE"
  | "SESSION_DONE";

/* ── Helpers ────────────────────────────────── */

/** API returns prices in minor units (cents). Convert to dollars for display. */
function minor(v: number): string {
  if (v > 1000) return `$${(v / 100).toFixed(0)}`;
  return `$${v}`;
}

/* ── Main Component ─────────────────────────── */

export function DeveloperDemo() {
  const [demoState, setDemoState] = useState<DemoState>("IDLE");
  const [demoId, setDemoId] = useState<string | null>(null);
  const [initResponse, setInitResponse] = useState<DemoInitResponse | null>(null);
  const [rounds, setRounds] = useState<DemoRoundResponse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

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

  /* ── Auto-scroll ── */
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [rounds, demoState]);

  /* ── Initialize ── */
  const handleInit = useCallback(
    async (params: {
      item: { title: string; condition: string; swappa_median: number };
      seller: { ask_price: number; floor_price: number };
      buyer_budget: { max_budget: number };
      language: string;
    }) => {
      setError(null);
      setDemoState("INITIALIZING");
      try {
        const resp = await initDemo(params);
        setInitResponse(resp);
        setDemoId(resp.demo_id);
        setRounds([]);
        setDemoState("READY");
      } catch (err) {
        setError(err instanceof Error ? err.message : "데모 초기화에 실패했습니다");
        setDemoState("IDLE");
      }
    },
    [],
  );

  /* ── Execute Round ── */
  const handleRound = useCallback(
    async (params: { seller_price: number; seller_message?: string }) => {
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
    setDemoState("IDLE");
    setDemoId(null);
    setInitResponse(null);
    setRounds([]);
    setError(null);
  };

  /* ── Derived ── */
  const latestRound = rounds.length > 0 ? rounds[rounds.length - 1] : null;
  const nextRoundNumber = (latestRound?.round ?? 0) + 1;
  const lastBuyerPrice = latestRound?.final.decision.price ?? 0;

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

        {/* Cost Badge */}
        {demoState !== "IDLE" && (
          <div className="flex justify-end mb-4">
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
                    {minor(initResponse.strategy.target_price)}
                  </span>
                </div>
                <div className="rounded-lg bg-slate-900/60 p-3">
                  <span className="text-slate-500 block mb-1">최대 지불가</span>
                  <span className="text-amber-400 font-mono font-bold text-base">
                    {minor(initResponse.strategy.floor_price)}
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
            {rounds.map((round) => (
              <div key={round.round} className="space-y-4">
                {/* Round Separator */}
                <div className="flex items-center gap-3 pt-6">
                  <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-600 to-transparent" />
                  <span className="text-sm font-bold text-white bg-slate-800 px-4 py-1 rounded-full border border-slate-700">
                    라운드 {round.round}
                  </span>
                  <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-600 to-transparent" />
                </div>

                {/* AI Message Preview */}
                <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4">
                  <div className="flex items-start gap-3">
                    <span className="text-lg mt-0.5">🤖</span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-semibold text-cyan-400">AI 구매자 메시지</span>
                        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                          round.final.decision.action === "ACCEPT"
                            ? "bg-emerald-500/20 text-emerald-300"
                            : round.final.decision.action === "REJECT"
                              ? "bg-red-500/20 text-red-300"
                              : "bg-cyan-500/20 text-cyan-300"
                        }`}>
                          {round.final.decision.action}
                        </span>
                      </div>
                      <p className="text-sm text-white leading-relaxed">
                        {round.final.rendered_message}
                      </p>
                    </div>
                  </div>
                </div>

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
                      검증: HARD {round.final.validation.hard_passed ? "통과" : "실패"}
                      {round.final.validation.violations.length > 0 && (
                        <> | 위반 {round.final.validation.violations.length}건
                          ({round.final.validation.violations.filter(v => v.severity === 'HARD').length} HARD,
                          {" "}{round.final.validation.violations.filter(v => v.severity === 'SOFT').length} SOFT)
                        </>
                      )}
                      {round.final.validation.auto_fix_applied && " | 자동 수정 적용됨"}
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
                    ? `${minor(latestRound.final.decision.price)}에 거래 성사`
                    : `종료: ${latestRound.final.decision.action}`}
                </p>
                <p className="text-sm text-slate-400 mb-4">
                  총 {rounds.length}라운드
                  {" | "}
                  비용: ${totalCost.usd.toFixed(4)}
                  {" | "}
                  {(totalCost.prompt + totalCost.completion).toLocaleString()} 토큰
                </p>
                <button
                  onClick={handleReset}
                  className="rounded-xl border border-slate-700 px-6 py-2.5 text-sm font-medium text-slate-300 hover:border-slate-500 hover:text-white transition-colors cursor-pointer"
                >
                  새 세션 시작
                </button>
              </div>
            )}
          </div>
        )}

        <div ref={bottomRef} />
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
