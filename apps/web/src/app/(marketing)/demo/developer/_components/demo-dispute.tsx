"use client";

import { useCallback, useState } from "react";
import { api } from "@/lib/api-client";

/* ── Types ────────────────────────────── */

type DisputeStep =
  | "select_reason"
  | "add_evidence"
  | "submitting"
  | "open"
  | "escalating"
  | "escalated"
  | "resolving"
  | "resolved";

interface DisputeData {
  id: string;
  status: string;
  reason_code: string;
  evidence: Array<{ submitted_by: string; type: string; text?: string }>;
}

interface DemoDisputeProps {
  orderId: string;
  onComplete: () => void;
}

/* ── Constants ────────────────────────── */

const REASON_CODES = [
  { value: "ITEM_NOT_AS_DESCRIBED", label: "상품이 설명과 다름", icon: "exclaim" },
  { value: "ITEM_DAMAGED", label: "상품 파손", icon: "broken" },
  { value: "ITEM_NOT_RECEIVED", label: "상품 미수령", icon: "missing" },
  { value: "UNAUTHORIZED_TRANSACTION", label: "비인가 결제", icon: "lock" },
  { value: "OTHER", label: "기타", icon: "other" },
] as const;

const STEPS: { key: DisputeStep; label: string }[] = [
  { key: "select_reason", label: "사유 선택" },
  { key: "add_evidence", label: "증거 제출" },
  { key: "open", label: "분쟁 접수" },
  { key: "escalated", label: "에스컬레이션" },
  { key: "resolved", label: "해결" },
];

/* ── Component ────────────────────────── */

export function DemoDispute({ orderId, onComplete }: DemoDisputeProps) {
  const [step, setStep] = useState<DisputeStep>("select_reason");
  const [showFullPagesLink] = useState(true);
  const [reasonCode, setReasonCode] = useState<string>("");
  const [description, setDescription] = useState(
    "배터리 상태가 85%로 표시되어 있었지만, 실제로는 72%였습니다. 충전 사이클도 800회 이상입니다.",
  );
  const [dispute, setDispute] = useState<DisputeData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolution, setResolution] = useState<{
    outcome: string;
    summary: string;
    refund_amount_minor?: number;
  } | null>(null);

  const currentStepIdx = STEPS.findIndex((s) => s.key === step);

  const callApi = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setIsLoading(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "API 호출 실패");
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  async function handleSubmitDispute() {
    setStep("submitting");
    const result = await callApi(async () => {
      const res = await api.post<{ dispute: DisputeData }>("/disputes", {
        order_id: orderId,
        reason_code: reasonCode,
        opened_by: "buyer",
        evidence: description.trim()
          ? [{ submitted_by: "buyer", type: "text", text: description.trim() }]
          : [],
      });
      return res;
    });
    if (result) {
      setDispute(result.dispute);
      setStep("open");
    } else {
      setStep("add_evidence");
    }
  }

  async function handleEscalate() {
    if (!dispute) return;
    setStep("escalating");
    const result = await callApi(async () => {
      const res = await api.post<{ new_tier: number; cost: unknown }>(
        `/disputes/${dispute.id}/escalate`,
        {
          escalated_by: "buyer",
          reason: "판매자가 응답하지 않습니다",
        },
      );
      return res;
    });
    if (result) {
      setStep("escalated");
    } else {
      setStep("open");
    }
  }

  async function handleResolve(outcome: "buyer_favor" | "partial_refund" | "seller_favor") {
    if (!dispute) return;
    setStep("resolving");

    const summaries: Record<string, string> = {
      buyer_favor: "구매자 유리: 전액 환불 처리됩니다.",
      partial_refund: "부분 환불: 배터리 상태 차이에 대해 부분 환불됩니다.",
      seller_favor: "판매자 유리: 분쟁이 기각되었습니다.",
    };

    const result = await callApi(async () => {
      // Start review first
      await api.post(`/disputes/${dispute.id}/review`);
      // Then resolve
      const res = await api.post<{ dispute: DisputeData; auto_refund: unknown }>(
        `/disputes/${dispute.id}/resolve`,
        {
          outcome,
          summary: summaries[outcome],
          refund_amount_minor: outcome === "partial_refund" ? 5000 : undefined,
        },
      );
      return res;
    });

    if (result) {
      setResolution({
        outcome,
        summary: summaries[outcome],
        refund_amount_minor: outcome === "partial_refund" ? 5000 : undefined,
      });
      setStep("resolved");
    } else {
      setStep("escalated");
    }
  }

  return (
    <div
      className="rounded-xl border border-line bg-surface-raised overflow-hidden"
      style={{ animation: "fadeInUp 0.4s ease-out" }}
    >
      {/* Header */}
      <div className="border-b border-line px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-error-soft border border-error/30">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-error"
              aria-hidden="true"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-ink">분쟁 (Demo)</h3>
            <p className="text-[11px] text-ink-muted">3-tier 분쟁 해결 시스템을 테스트합니다</p>
          </div>
          {showFullPagesLink && (
            <a
              href="/demo/dispute"
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto flex items-center gap-1.5 rounded-lg border border-line bg-surface-sunken px-3 py-1.5 text-[11px] font-medium text-ink-secondary transition-colors hover:border-line-strong hover:text-ink"
            >
              View full dispute resolution pages &rarr;
            </a>
          )}
        </div>
      </div>

      {/* Step Indicator */}
      <div className="px-5 pt-4 pb-2">
        <div className="flex items-center gap-1">
          {STEPS.map((s, i) => (
            <div key={s.key} className="flex items-center">
              <div className="flex flex-col items-center">
                <div
                  className={`flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold transition-all duration-300 ${
                    i < currentStepIdx
                      ? "bg-success text-on-accent"
                      : i === currentStepIdx
                        ? "bg-error text-on-accent ring-2 ring-error/30"
                        : "bg-surface-sunken text-ink-muted"
                  }`}
                >
                  {i < currentStepIdx ? (
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </div>
                <span
                  className={`mt-1 text-[8px] whitespace-nowrap ${
                    i === currentStepIdx ? "text-error" : "text-ink-muted"
                  }`}
                >
                  {s.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={`mx-1 h-px w-4 sm:w-6 transition-colors duration-300 ${
                    i < currentStepIdx ? "bg-success" : "bg-surface-sunken"
                  }`}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="px-5 pb-5 pt-2">
        {error && (
          <div className="rounded-lg border border-error/30 bg-error-soft px-3 py-2 mb-3 text-xs text-error">
            {error}
          </div>
        )}

        {/* Select Reason */}
        {step === "select_reason" && (
          <div className="space-y-3" style={{ animation: "fadeInUp 0.3s ease-out" }}>
            <p className="text-xs text-ink-secondary">분쟁 사유를 선택하세요:</p>
            {REASON_CODES.map((r) => (
              <button
                type="button"
                key={r.value}
                onClick={() => {
                  setReasonCode(r.value);
                  setStep("add_evidence");
                }}
                className={`w-full flex items-center gap-3 rounded-lg border p-3 text-left transition-all cursor-pointer ${
                  reasonCode === r.value
                    ? "border-error/50 bg-error-soft"
                    : "border-line bg-surface-sunken hover:border-line-strong"
                }`}
              >
                <span className="text-sm text-ink-secondary">{r.label}</span>
              </button>
            ))}
          </div>
        )}

        {/* Add Evidence */}
        {step === "add_evidence" && (
          <div className="space-y-4" style={{ animation: "fadeInUp 0.3s ease-out" }}>
            <div className="rounded-lg bg-surface-sunken border border-line p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs text-error font-medium">
                  {REASON_CODES.find((r) => r.value === reasonCode)?.label}
                </span>
              </div>
            </div>

            <div>
              <label
                htmlFor="dispute-description"
                className="block text-xs text-ink-secondary mb-1.5"
              >
                상세 설명 (증거)
              </label>
              <textarea
                id="dispute-description"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-lg border border-line bg-surface-overlay px-3 py-2.5 text-sm text-ink placeholder-ink-muted focus:border-focus focus:outline-none resize-none"
                placeholder="문제에 대해 상세히 설명해주세요..."
              />
            </div>

            <button
              type="button"
              onClick={handleSubmitDispute}
              disabled={isLoading || !description.trim()}
              className="w-full rounded-lg bg-error px-4 py-2.5 text-sm font-medium text-on-accent hover:bg-error/90 transition-colors disabled:opacity-50 cursor-pointer"
            >
              분쟁 제출
            </button>
            <p className="text-[10px] text-ink-muted text-center">
              POST /disputes &rarr; reason_code: &quot;{reasonCode}&quot;
            </p>
          </div>
        )}

        {/* Submitting / Escalating / Resolving */}
        {(step === "submitting" || step === "escalating" || step === "resolving") && (
          <div
            className="py-8 text-center space-y-4"
            style={{ animation: "fadeInUp 0.3s ease-out" }}
          >
            <div className="relative mx-auto w-12 h-12">
              <div className="absolute inset-0 rounded-full border-2 border-line" />
              <div className="absolute inset-0 rounded-full border-2 border-t-error animate-spin" />
            </div>
            <p className="text-sm text-ink-secondary">
              {step === "submitting" && "분쟁 제출 중..."}
              {step === "escalating" && "에스컬레이션 처리 중..."}
              {step === "resolving" && "분쟁 해결 처리 중..."}
            </p>
          </div>
        )}

        {/* Open */}
        {step === "open" && dispute && (
          <div className="space-y-4" style={{ animation: "fadeInUp 0.3s ease-out" }}>
            <div className="rounded-lg bg-surface-sunken border border-error/20 p-4 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-error animate-pulse" />
                <span className="text-xs font-medium text-error">분쟁 접수됨 (T1)</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-ink-muted">Dispute ID</span>
                <span className="font-mono text-ink-secondary">{dispute.id.slice(0, 16)}...</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-ink-muted">사유</span>
                <span className="text-ink-secondary">
                  {REASON_CODES.find((r) => r.value === dispute.reason_code)?.label}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-ink-muted">상태</span>
                <span className="text-error">{dispute.status}</span>
              </div>
              {dispute.evidence.length > 0 && (
                <div className="border-t border-line pt-2 mt-2">
                  <p className="text-[10px] text-ink-muted mb-1">
                    증거 ({dispute.evidence.length}건)
                  </p>
                  {dispute.evidence.map((e) => (
                    <p
                      key={`${e.submitted_by}-${e.type}-${e.text ?? ""}`}
                      className="text-[11px] text-ink-secondary truncate"
                    >
                      [{e.submitted_by}] {e.text ?? e.type}
                    </p>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-lg bg-surface-sunken border border-line p-3">
              <p className="text-[11px] text-ink-secondary">
                T1 (자동 해결) 단계입니다. 판매자 응답 없이 에스컬레이션하거나, 직접 해결할 수
                있습니다.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handleEscalate}
                disabled={isLoading}
                className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5 text-sm font-medium text-warning hover:bg-warning-soft transition-colors disabled:opacity-50 cursor-pointer"
              >
                T2 에스컬레이션
              </button>
              <button
                type="button"
                onClick={() => handleResolve("buyer_favor")}
                disabled={isLoading}
                className="rounded-lg bg-success px-3 py-2.5 text-sm font-medium text-on-accent hover:bg-success/90 transition-colors disabled:opacity-50 cursor-pointer"
              >
                바로 해결하기
              </button>
            </div>
          </div>
        )}

        {/* Escalated */}
        {step === "escalated" && dispute && (
          <div className="space-y-4" style={{ animation: "fadeInUp 0.3s ease-out" }}>
            <div className="rounded-lg bg-surface-sunken border border-warning/20 p-4 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-warning animate-pulse" />
                <span className="text-xs font-medium text-warning">T2 에스컬레이션 완료</span>
              </div>
              <p className="text-[11px] text-ink-secondary">
                DS 패널 리뷰가 시작됩니다. 에스컬레이션 보증금이 요구될 수 있습니다.
              </p>
            </div>

            <p className="text-xs text-ink-secondary text-center">해결 방식을 선택하세요:</p>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => handleResolve("buyer_favor")}
                disabled={isLoading}
                className="rounded-lg bg-success-soft border border-success/30 px-2 py-2.5 text-xs font-medium text-success hover:bg-success-soft transition-colors disabled:opacity-50 cursor-pointer"
              >
                구매자 승
              </button>
              <button
                type="button"
                onClick={() => handleResolve("partial_refund")}
                disabled={isLoading}
                className="rounded-lg bg-warning-soft border border-warning/30 px-2 py-2.5 text-xs font-medium text-warning hover:bg-warning-soft transition-colors disabled:opacity-50 cursor-pointer"
              >
                부분 환불
              </button>
              <button
                type="button"
                onClick={() => handleResolve("seller_favor")}
                disabled={isLoading}
                className="rounded-lg bg-surface-sunken border border-line px-2 py-2.5 text-xs font-medium text-ink-secondary hover:bg-surface-overlay transition-colors disabled:opacity-50 cursor-pointer"
              >
                판매자 승
              </button>
            </div>
          </div>
        )}

        {/* Resolved */}
        {step === "resolved" && resolution && (
          <div
            className="py-6 text-center space-y-4"
            style={{ animation: "fadeInUp 0.4s ease-out" }}
          >
            <div
              className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full border-2 ${
                resolution.outcome === "buyer_favor"
                  ? "bg-success-soft border-success/30"
                  : resolution.outcome === "partial_refund"
                    ? "bg-warning-soft border-warning/30"
                    : "bg-surface-sunken border-line"
              }`}
            >
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className={
                  resolution.outcome === "buyer_favor"
                    ? "text-success"
                    : resolution.outcome === "partial_refund"
                      ? "text-warning"
                      : "text-ink-secondary"
                }
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div>
              <p className="text-lg font-bold text-ink">분쟁 해결 완료</p>
              <p className="text-sm text-ink-secondary mt-1">{resolution.summary}</p>
            </div>

            <div className="rounded-lg bg-surface-sunken border border-line p-4 text-left max-w-sm mx-auto space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-ink-muted">결과</span>
                <span
                  className={`font-medium ${
                    resolution.outcome === "buyer_favor"
                      ? "text-success"
                      : resolution.outcome === "partial_refund"
                        ? "text-warning"
                        : "text-ink-secondary"
                  }`}
                >
                  {resolution.outcome === "buyer_favor" && "구매자 유리"}
                  {resolution.outcome === "partial_refund" && "부분 환불"}
                  {resolution.outcome === "seller_favor" && "판매자 유리"}
                </span>
              </div>
              {resolution.refund_amount_minor && (
                <div className="flex justify-between text-xs">
                  <span className="text-ink-muted">환불액</span>
                  <span className="text-success">
                    ${(resolution.refund_amount_minor / 100).toFixed(2)}
                  </span>
                </div>
              )}
              <div className="flex justify-between text-xs">
                <span className="text-ink-muted">Trust 반영</span>
                <span className="text-action-primary">자동 적용됨</span>
              </div>
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={onComplete}
                className="rounded-lg border border-line px-6 py-2.5 text-sm font-medium text-ink-secondary hover:border-line-strong hover:text-ink transition-colors cursor-pointer"
              >
                데모 완료
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
