"use client";

import { useCallback, useState } from "react";
import { api } from "@/lib/api-client";
import { createPaymentDisclosureAck } from "@/lib/payment-disclosure";

/* ── Types ────────────────────────────── */

type PaymentStep =
  | "creating_order"
  | "order_ready"
  | "preparing"
  | "prepared"
  | "quoting"
  | "quoted"
  | "authorizing"
  | "authorized"
  | "settling"
  | "settled";

interface PaymentIntent {
  id: string;
  order_id: string;
  status: string;
  amount: { currency: string; amount_minor: number };
  selected_rail: string;
  seller_id: string;
  buyer_id: string;
}

interface DemoPaymentRealProps {
  agreedPrice: number; // minor units (cents)
  itemTitle: string;
  rounds: number;
  onComplete: (orderId: string, shipmentId: string | null) => void;
}

/* ── Fee Constants ────────────────────── */

const FEE_BPS = 150; // 1.5%
const HAGGLE_FEE_WALLET = "0x7Hag...Fe3c"; // Display address

function splitFee(amountMinor: number) {
  const haggleFee = Math.floor((amountMinor * FEE_BPS) / 10_000);
  return {
    sellerAmount: amountMinor - haggleFee,
    haggleFee,
    feePct: (FEE_BPS / 100).toFixed(1),
  };
}

function fmtUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/* ── Step Labels ──────────────────────── */

const STEP_LABELS: { key: PaymentStep; label: string }[] = [
  { key: "order_ready", label: "주문 생성" },
  { key: "prepared", label: "결제 준비" },
  { key: "quoted", label: "견적" },
  { key: "authorized", label: "승인" },
  { key: "settled", label: "결제 완료" },
];

/* ── Component ────────────────────────── */

export function DemoPaymentReal({
  agreedPrice,
  itemTitle,
  rounds,
  onComplete,
}: DemoPaymentRealProps) {
  const [step, setStep] = useState<PaymentStep>("creating_order");
  const [orderId, setOrderId] = useState<string | null>(null);
  const [intent, setIntent] = useState<PaymentIntent | null>(null);
  const [settlementApprovalId, setSettlementApprovalId] = useState<string | null>(null);
  const [shipmentId, setShipmentId] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Cumulative fee tracking (for "Haggle wallet" display)
  const [haggleWalletBalance, setHaggleWalletBalance] = useState(0);

  const fee = splitFee(agreedPrice);
  const currentStepIdx = STEP_LABELS.findIndex((s) => s.key === step);

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

  // Step 1: Create order
  async function handleCreateOrder() {
    setStep("creating_order");
    const result = await callApi(async () => {
      const res = await api.post<{
        order: { id: string };
        settlement_approval_id: string;
      }>("/demo/e2e/create-order", {
        amount_minor: agreedPrice,
        currency: "USD",
        item_title: itemTitle,
      });
      return res;
    });
    if (result) {
      setOrderId(result.order.id);
      setSettlementApprovalId(result.settlement_approval_id);
      setStep("order_ready");
    }
  }

  // Step 2: Prepare payment intent
  async function handlePrepare() {
    if (!settlementApprovalId) return;
    setStep("preparing");
    const result = await callApi(async () => {
      const res = await api.post<{ intent: PaymentIntent }>("/payments/prepare", {
        settlement_approval_id: settlementApprovalId,
        payment_disclosure_ack: createPaymentDisclosureAck({ stripeFallback: true }),
      });
      return res;
    });
    if (result) {
      setIntent(result.intent);
      setStep("prepared");
    } else {
      setStep("order_ready");
    }
  }

  // Step 3: Quote
  async function handleQuote() {
    if (!intent) return;
    setStep("quoting");
    const result = await callApi(async () => {
      const res = await api.post<{
        intent: PaymentIntent;
        metadata?: Record<string, unknown>;
      }>(`/payments/${intent.id}/quote`);
      return res;
    });
    if (result) {
      setIntent(result.intent);
      setStep("quoted");
    } else {
      setStep("prepared");
    }
  }

  // Step 4: Authorize
  async function handleAuthorize() {
    if (!intent) return;
    setStep("authorizing");
    const result = await callApi(async () => {
      const res = await api.post<{ intent: PaymentIntent }>(`/payments/${intent.id}/authorize`);
      return res;
    });
    if (result) {
      setIntent(result.intent);
      setStep("authorized");
    } else {
      setStep("quoted");
    }
  }

  // Step 5: Settle
  async function handleSettle() {
    if (!intent) return;
    setStep("settling");
    const result = await callApi(async () => {
      const res = await api.post<{
        intent: PaymentIntent;
        shipment?: { id: string };
        settlement_release?: unknown;
        metadata?: Record<string, unknown>;
      }>(`/payments/${intent.id}/settle`);
      return res;
    });
    if (result) {
      setIntent(result.intent);
      if (result.shipment) {
        setShipmentId(result.shipment.id);
      }
      setTxHash((result.metadata?.tx_hash as string) ?? `0x${Date.now().toString(16)}...mock`);
      setHaggleWalletBalance((prev) => prev + fee.haggleFee);
      setStep("settled");
    } else {
      setStep("authorized");
    }
  }

  // Auto-start: create order on mount
  if (step === "creating_order" && !orderId && !isLoading && !error) {
    handleCreateOrder();
  }

  return (
    <div
      className="rounded-xl border border-line bg-surface-raised overflow-hidden"
      style={{ animation: "fadeInUp 0.4s ease-out" }}
    >
      {/* Header */}
      <div className="border-b border-line px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-success-soft border border-success/30">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-success"
                aria-hidden="true"
              >
                <rect width="20" height="14" x="2" y="5" rx="2" />
                <path d="M2 10h20" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink">결제 (Real API)</h3>
              <p className="text-[11px] text-ink-muted">
                실제 API를 호출하여 결제 파이프라인을 실행합니다
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold text-success font-mono">{fmtUsd(agreedPrice)}</p>
            <p className="text-[10px] text-ink-muted">USDC on Base</p>
          </div>
        </div>
      </div>

      {/* Step Indicator */}
      <div className="px-5 pt-4 pb-2">
        <div className="flex items-center gap-1">
          {STEP_LABELS.map((s, i) => (
            <div key={s.key} className="flex items-center">
              <div className="flex flex-col items-center">
                <div
                  className={`flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold transition-all duration-300 ${
                    i < currentStepIdx
                      ? "bg-success text-on-accent"
                      : i === currentStepIdx
                        ? "bg-action-primary text-on-accent ring-2 ring-action-primary/30"
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
                    i === currentStepIdx ? "text-action-primary" : "text-ink-muted"
                  }`}
                >
                  {s.label}
                </span>
              </div>
              {i < STEP_LABELS.length - 1 && (
                <div
                  className={`mx-1 h-px w-4 sm:w-8 transition-colors duration-300 ${
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
            <button
              type="button"
              onClick={() => setError(null)}
              className="ml-2 text-error hover:text-error/80"
            >
              dismiss
            </button>
          </div>
        )}

        {/* Creating Order (loading) */}
        {step === "creating_order" && (
          <LoadingState message="주문 생성 중... (settlement approval + commerce order)" />
        )}

        {/* Order Ready → Prepare */}
        {step === "order_ready" && (
          <div className="space-y-4" style={{ animation: "fadeInUp 0.3s ease-out" }}>
            <InfoCard title="주문 생성 완료">
              <Row label="Order ID" value={orderId?.slice(0, 12) + "..."} mono />
              <Row label="상품" value={itemTitle} />
              <Row label="합의 금액" value={fmtUsd(agreedPrice)} highlight="emerald" />
              <Row label="협상 라운드" value={`${rounds}회`} />
            </InfoCard>

            <FeeSplitCard amount={agreedPrice} fee={fee} />

            <button
              type="button"
              onClick={handlePrepare}
              disabled={isLoading}
              className="w-full rounded-lg bg-cta px-4 py-2.5 text-sm font-medium text-on-cta hover:bg-cta-hover transition-colors disabled:opacity-50 cursor-pointer"
            >
              결제 준비 (Prepare Intent)
            </button>
            <ApiHint method="POST" path="/payments/prepare" />
          </div>
        )}

        {/* Preparing (loading) */}
        {step === "preparing" && <LoadingState message="Payment Intent 생성 중..." />}

        {/* Prepared → Quote */}
        {step === "prepared" && intent && (
          <div className="space-y-4" style={{ animation: "fadeInUp 0.3s ease-out" }}>
            <InfoCard title="Payment Intent 생성됨">
              <Row label="Intent ID" value={intent.id.slice(0, 16) + "..."} mono />
              <Row label="상태" value={intent.status} highlight="cyan" />
              <Row label="Rail" value="x402 (USDC on Base)" />
            </InfoCard>

            <button
              type="button"
              onClick={handleQuote}
              disabled={isLoading}
              className="w-full rounded-lg bg-cta px-4 py-2.5 text-sm font-medium text-on-cta hover:bg-cta-hover transition-colors disabled:opacity-50 cursor-pointer"
            >
              견적 요청 (Quote)
            </button>
            <ApiHint method="POST" path={`/payments/${intent.id}/quote`} />
          </div>
        )}

        {/* Quoting */}
        {step === "quoting" && (
          <LoadingState message="견적 계산 중 (fee split, wallet resolve)..." />
        )}

        {/* Quoted → Authorize */}
        {step === "quoted" && intent && (
          <div className="space-y-4" style={{ animation: "fadeInUp 0.3s ease-out" }}>
            <InfoCard title="견적 완료">
              <Row label="상태" value={intent.status} highlight="cyan" />
              <Row label="금액" value={fmtUsd(intent.amount.amount_minor)} highlight="emerald" />
            </InfoCard>

            <FeeSplitCard amount={agreedPrice} fee={fee} showWallets />

            <div className="rounded-lg bg-surface-sunken border border-line p-3">
              <p className="text-[11px] text-ink-secondary leading-relaxed">
                구매자 지갑에서 USDC 지출 승인이 필요합니다. 에스크로 컨트랙트가{" "}
                <span className="text-success font-mono">{fmtUsd(agreedPrice)}</span>를 사용합니다.
              </p>
            </div>

            <button
              type="button"
              onClick={handleAuthorize}
              disabled={isLoading}
              className="w-full rounded-lg bg-cta px-4 py-2.5 text-sm font-medium text-on-cta hover:bg-cta-hover transition-colors disabled:opacity-50 cursor-pointer"
            >
              결제 승인 (Authorize)
            </button>
            <ApiHint method="POST" path={`/payments/${intent.id}/authorize`} />
          </div>
        )}

        {/* Authorizing */}
        {step === "authorizing" && <LoadingState message="결제 승인 처리 중..." />}

        {/* Authorized → Settle */}
        {step === "authorized" && intent && (
          <div className="space-y-4" style={{ animation: "fadeInUp 0.3s ease-out" }}>
            <InfoCard title="결제 승인 완료">
              <Row label="상태" value="AUTHORIZED" highlight="emerald" />
              <Row label="승인 금액" value={fmtUsd(intent.amount.amount_minor)} />
            </InfoCard>

            <div className="rounded-lg bg-info-soft border border-info/20 p-3">
              <div className="flex items-start gap-2">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="text-info mt-0.5 shrink-0"
                  aria-hidden="true"
                >
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
                <p className="text-[11px] text-info">
                  Settlement Router가 자금을 분배합니다:
                  <br />
                  <span className="text-ink font-medium">{fmtUsd(fee.sellerAmount)}</span> → 판매자
                  지갑
                  <br />
                  <span className="text-action-primary font-medium">{fmtUsd(fee.haggleFee)}</span> →
                  Haggle 수수료 지갑
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleSettle}
              disabled={isLoading}
              className="w-full rounded-lg bg-success px-4 py-2.5 text-sm font-medium text-on-accent hover:bg-success/90 transition-colors disabled:opacity-50 cursor-pointer"
            >
              결제 실행 (Settle)
            </button>
            <ApiHint method="POST" path={`/payments/${intent.id}/settle`} />
          </div>
        )}

        {/* Settling */}
        {step === "settling" && (
          <div
            className="py-8 text-center space-y-4"
            style={{ animation: "fadeInUp 0.3s ease-out" }}
          >
            <div className="relative mx-auto w-16 h-16">
              <div className="absolute inset-0 rounded-full border-2 border-line" />
              <div className="absolute inset-0 rounded-full border-2 border-t-action-primary animate-spin" />
              <div
                className="absolute inset-2 rounded-full border-2 border-t-success animate-spin"
                style={{ animationDirection: "reverse", animationDuration: "1.5s" }}
              />
            </div>
            <div>
              <p className="text-sm font-medium text-ink">Settlement 실행 중...</p>
              <p className="text-xs text-ink-muted mt-1">
                Settlement Router → 판매자 + Haggle 수수료 분배
              </p>
            </div>
          </div>
        )}

        {/* Settled (Complete) */}
        {step === "settled" && intent && (
          <div className="py-4 space-y-4" style={{ animation: "fadeInUp 0.4s ease-out" }}>
            <div className="text-center mb-2">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success-soft border-2 border-success/30 mb-3">
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-success"
                  aria-hidden="true"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <p className="text-lg font-bold text-ink">결제 완료!</p>
            </div>

            {/* Settlement Receipt */}
            <div className="rounded-lg bg-surface-sunken border border-line p-4 space-y-2.5">
              <p className="text-xs font-semibold text-ink-secondary">정산 내역</p>
              <Row label="총 결제액" value={fmtUsd(agreedPrice)} highlight="emerald" />
              <div className="border-t border-line pt-2 space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-ink" />
                    <span className="text-ink-secondary">판매자 수령액</span>
                  </div>
                  <span className="text-ink font-medium font-mono">{fmtUsd(fee.sellerAmount)}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-action-primary" />
                    <span className="text-ink-secondary">Haggle 수수료 ({fee.feePct}%)</span>
                  </div>
                  <span className="text-action-primary font-medium font-mono">
                    {fmtUsd(fee.haggleFee)}
                  </span>
                </div>
              </div>
              <div className="border-t border-line pt-2 space-y-1.5">
                <Row label="Tx Hash" value={txHash?.slice(0, 16) + "..."} mono />
                <Row label="네트워크" value="Base L2" highlight="info" />
                <Row label="Payment ID" value={intent.id.slice(0, 16) + "..."} mono />
              </div>
            </div>

            {/* Haggle Wallet Balance */}
            <div className="rounded-lg bg-action-primary/10 border border-action-primary/20 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-action-primary/20 flex items-center justify-center">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="text-action-primary"
                      aria-hidden="true"
                    >
                      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
                      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
                      <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-ink">Haggle 수수료 지갑</p>
                    <p className="text-[10px] text-ink-muted font-mono">{HAGGLE_FEE_WALLET}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-action-primary font-mono">
                    +{fmtUsd(fee.haggleFee)}
                  </p>
                  <p className="text-[10px] text-ink-muted">이번 거래 수수료</p>
                </div>
              </div>
              {haggleWalletBalance > fee.haggleFee && (
                <div className="mt-2 pt-2 border-t border-action-primary/20 flex justify-between text-xs">
                  <span className="text-ink-muted">누적 잔액</span>
                  <span className="text-action-primary font-mono">
                    {fmtUsd(haggleWalletBalance)}
                  </span>
                </div>
              )}
            </div>

            {/* Auto-created resources */}
            <div className="rounded-lg bg-surface-sunken border border-line p-3 space-y-1.5">
              <p className="text-[10px] text-ink-muted uppercase tracking-wider">자동 생성됨</p>
              <div className="flex items-center gap-2 text-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-success" />
                <span className="text-ink-secondary">Settlement Release</span>
                <span className="text-ink-muted">(상품액 + 무게 버퍼)</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-info" />
                <span className="text-ink-secondary">Shipment Record</span>
                <span className="text-ink-muted">(LABEL_PENDING)</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-warning" />
                <span className="text-ink-secondary">Order Status</span>
                <span className="text-ink-muted">FULFILLMENT_PENDING</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onComplete(orderId!, shipmentId)}
              className="w-full rounded-lg bg-info px-4 py-2.5 text-sm font-medium text-on-accent hover:bg-info/90 transition-colors cursor-pointer"
            >
              배송 단계로 이동 &rarr;
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Sub-components ──────────────────── */

function LoadingState({ message }: { message: string }) {
  return (
    <div className="py-8 text-center space-y-3" style={{ animation: "fadeInUp 0.3s ease-out" }}>
      <div className="relative mx-auto w-10 h-10">
        <div className="absolute inset-0 rounded-full border-2 border-line" />
        <div className="absolute inset-0 rounded-full border-2 border-t-action-primary animate-spin" />
      </div>
      <p className="text-xs text-ink-secondary">{message}</p>
    </div>
  );
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-surface-sunken border border-success/20 p-4 space-y-2">
      <p className="text-xs font-semibold text-success">{title}</p>
      {children}
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  highlight,
}: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: "emerald" | "cyan" | "info" | "amber";
}) {
  const colors: Record<string, string> = {
    emerald: "text-success",
    cyan: "text-action-primary",
    info: "text-info",
    amber: "text-warning",
  };
  return (
    <div className="flex justify-between text-xs">
      <span className="text-ink-muted">{label}</span>
      <span
        className={`${mono ? "font-mono" : ""} ${highlight ? colors[highlight] + " font-medium" : "text-ink-secondary"}`}
      >
        {value}
      </span>
    </div>
  );
}

function FeeSplitCard({
  amount,
  fee,
  showWallets,
}: {
  amount: number;
  fee: { sellerAmount: number; haggleFee: number; feePct: string };
  showWallets?: boolean;
}) {
  const sellerPct = ((fee.sellerAmount / amount) * 100).toFixed(1);
  const hagglePct = fee.feePct;

  return (
    <div className="rounded-lg bg-surface-sunken border border-line p-4 space-y-3">
      <p className="text-xs font-semibold text-ink-secondary">수수료 분배 (Fee Split)</p>

      {/* Visual bar */}
      <div className="relative h-6 rounded-full overflow-hidden bg-surface-sunken">
        <div
          className="absolute inset-y-0 left-0 bg-ink/20 flex items-center justify-center"
          style={{ width: `${sellerPct}%` }}
        >
          <span className="text-[9px] font-bold text-ink">판매자 {sellerPct}%</span>
        </div>
        <div
          className="absolute inset-y-0 right-0 bg-action-primary/40 flex items-center justify-center"
          style={{ width: `${hagglePct}%` }}
        >
          <span className="text-[9px] font-bold text-action-primary">{hagglePct}%</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-surface-overlay p-2.5">
          <p className="text-[10px] text-ink-muted">판매자 수령</p>
          <p className="text-sm font-bold text-ink font-mono">{fmtUsd(fee.sellerAmount)}</p>
          {showWallets && (
            <p className="text-[9px] text-ink-muted font-mono mt-0.5">0xSell...er01</p>
          )}
        </div>
        <div className="rounded-lg bg-action-primary/10 border border-action-primary/20 p-2.5">
          <p className="text-[10px] text-action-primary">Haggle 수수료</p>
          <p className="text-sm font-bold text-action-primary font-mono">{fmtUsd(fee.haggleFee)}</p>
          {showWallets && (
            <p className="text-[9px] text-action-primary font-mono mt-0.5">{HAGGLE_FEE_WALLET}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function ApiHint({ method, path }: { method: string; path: string }) {
  return (
    <p className="text-[10px] text-ink-muted text-center font-mono">
      {method} {path}
    </p>
  );
}
