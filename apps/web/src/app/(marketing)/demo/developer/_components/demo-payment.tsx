"use client";

import { useCallback, useEffect, useState } from "react";

/* ── Types ────────────────────────────── */

type PaymentStep =
  | "method_select"
  | "connect_wallet"
  | "balance_check"
  | "approve"
  | "sign"
  | "confirming"
  | "complete";

interface DemoPaymentProps {
  agreedPrice: number; // minor units (cents)
  itemTitle: string;
  rounds: number;
  onBack: () => void;
}

/* ── Helpers ──────────────────────────── */

const STEPS: { key: PaymentStep; label: string }[] = [
  { key: "method_select", label: "결제 수단" },
  { key: "connect_wallet", label: "지갑 연결" },
  { key: "balance_check", label: "잔액 확인" },
  { key: "approve", label: "USDC 승인" },
  { key: "sign", label: "서명" },
  { key: "confirming", label: "확인 중" },
  { key: "complete", label: "완료" },
];

function fmtUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/* ── Mock data ────────────────────────── */

const MOCK_WALLET = "0x7a3b...F42d";
const MOCK_USDC_BALANCE = "2,847.32";
const MOCK_TX_HASH = "0x8f2a...b7c1";
const MOCK_ESCROW_ADDR = "0xHagg...1e5c";

/* ── Component ────────────────────────── */

export function DemoPayment({ agreedPrice, itemTitle, rounds, onBack }: DemoPaymentProps) {
  const [step, setStep] = useState<PaymentStep>("method_select");
  const [method, setMethod] = useState<"crypto" | "card" | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);

  const amountUsdc = fmtUsd(agreedPrice);
  const fee = (agreedPrice * 0.015) / 100;
  const total = agreedPrice / 100 + fee;

  const currentStepIdx = STEPS.findIndex((s) => s.key === step);

  const simulateDelay = useCallback((next: PaymentStep, ms = 1200) => {
    setIsAnimating(true);
    const timer = setTimeout(() => {
      setStep(next);
      setIsAnimating(false);
    }, ms);
    return () => clearTimeout(timer);
  }, []);

  // Auto-advance for confirming step
  useEffect(() => {
    if (step === "confirming") {
      const cleanup = simulateDelay("complete", 2000);
      return cleanup;
    }
  }, [step, simulateDelay]);

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
              <h3 className="text-sm font-semibold text-ink">결제 (Demo)</h3>
              <p className="text-[11px] text-ink-muted">실제 결제가 아닌 시뮬레이션입니다</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold text-success font-mono">{amountUsdc}</p>
            <p className="text-[10px] text-ink-muted">USDC on Base</p>
          </div>
        </div>
      </div>

      {/* Step Indicator */}
      <div className="px-5 pt-4 pb-2">
        <div className="flex items-center gap-1 overflow-x-auto">
          {STEPS.map((s, i) => (
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
        {/* ── Method Select ── */}
        {step === "method_select" && (
          <div className="space-y-3" style={{ animation: "fadeInUp 0.3s ease-out" }}>
            <p className="text-xs text-ink-secondary mb-3">결제 수단을 선택하세요:</p>
            <button
              type="button"
              onClick={() => {
                setMethod("crypto");
                setStep("connect_wallet");
              }}
              className="w-full flex items-center gap-3 rounded-lg border border-line bg-surface-sunken p-4 hover:border-action-primary/50 hover:bg-action-primary/5 transition-all text-left cursor-pointer group"
            >
              <span className="text-2xl">
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  className="text-action-primary"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
                  <path
                    d="M12 6v12M8 9.5h5.5a2.5 2.5 0 0 1 0 5H8"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <div className="flex-1">
                <div className="font-medium text-sm text-ink group-hover:text-action-primary transition-colors">
                  USDC로 결제 ({amountUsdc})
                </div>
                <div className="text-[11px] text-ink-muted mt-0.5">
                  Base L2 직접 전송 &middot; 수수료 1.5% &middot; 가스비 Haggle 부담
                </div>
              </div>
              <span className="text-xs text-action-primary font-medium bg-action-primary/10 px-2 py-1 rounded">
                추천
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMethod("card");
                setStep("connect_wallet");
              }}
              className="w-full flex items-center gap-3 rounded-lg border border-line bg-surface-sunken p-4 hover:border-line-strong hover:bg-surface-overlay transition-all text-left cursor-pointer group"
            >
              <span className="text-2xl">
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  className="text-ink-secondary"
                  aria-hidden="true"
                >
                  <rect
                    x="2"
                    y="5"
                    width="20"
                    height="14"
                    rx="2"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                  <path d="M2 10h20" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </span>
              <div className="flex-1">
                <div className="font-medium text-sm text-ink group-hover:text-ink-secondary transition-colors">
                  카드 결제 ({amountUsdc} + Stripe 수수료)
                </div>
                <div className="text-[11px] text-ink-muted mt-0.5">
                  Stripe Onramp &middot; 총 수수료 3% &middot; 지갑 없이도 가능
                </div>
              </div>
            </button>
          </div>
        )}

        {/* ── Connect Wallet (simulated) ── */}
        {step === "connect_wallet" && (
          <div className="space-y-4" style={{ animation: "fadeInUp 0.3s ease-out" }}>
            <div className="rounded-lg bg-surface-sunken border border-line p-4">
              <p className="text-xs text-ink-secondary mb-3">
                {method === "crypto"
                  ? "USDC 결제를 위해 지갑을 연결하세요."
                  : "결제 수령을 위한 지갑을 연결하세요."}
              </p>
              <div className="flex flex-wrap gap-2">
                {["Coinbase Wallet", "MetaMask", "WalletConnect"].map((name) => (
                  <button
                    type="button"
                    key={name}
                    onClick={() => simulateDelay("balance_check", 800)}
                    disabled={isAnimating}
                    className="rounded-lg border border-line bg-surface-overlay px-3 py-2 text-xs text-ink-secondary hover:border-action-primary/50 hover:text-ink transition-all cursor-pointer disabled:opacity-50"
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
            {isAnimating && (
              <div className="flex items-center justify-center gap-2 py-2">
                <div className="w-4 h-4 border-2 border-line border-t-action-primary rounded-full animate-spin" />
                <span className="text-xs text-ink-secondary">지갑 연결 중...</span>
              </div>
            )}
          </div>
        )}

        {/* ── Balance Check ── */}
        {step === "balance_check" && (
          <div className="space-y-4" style={{ animation: "fadeInUp 0.3s ease-out" }}>
            <div className="rounded-lg bg-surface-sunken border border-success/20 p-4 space-y-2.5">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
                <span className="text-xs font-medium text-success">지갑 연결됨</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-ink-muted">주소</span>
                <span className="font-mono text-ink-secondary">{MOCK_WALLET}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-ink-muted">USDC 잔액</span>
                <span className="text-ink font-medium">${MOCK_USDC_BALANCE}</span>
              </div>
              <div className="border-t border-line pt-2 flex justify-between text-xs">
                <span className="text-ink-muted">결제 금액</span>
                <span className="text-success font-bold">{amountUsdc}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-ink-muted">수수료 (1.5%)</span>
                <span className="text-ink-secondary">${fee.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-xs font-medium">
                <span className="text-ink-secondary">총 결제액</span>
                <span className="text-ink">${total.toFixed(2)}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => simulateDelay("approve", 1000)}
              disabled={isAnimating}
              className="w-full rounded-lg bg-action-primary px-4 py-2.5 text-sm font-medium text-on-accent hover:bg-action-primary-hover transition-colors disabled:opacity-50 cursor-pointer"
            >
              {isAnimating ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-on-accent/30 border-t-on-accent rounded-full animate-spin" />
                  확인 중...
                </span>
              ) : (
                "계속"
              )}
            </button>
          </div>
        )}

        {/* ── Approve USDC ── */}
        {step === "approve" && (
          <div className="space-y-4" style={{ animation: "fadeInUp 0.3s ease-out" }}>
            <div className="rounded-lg bg-surface-sunken border border-line p-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-warning-soft border border-warning/30">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-warning"
                    aria-hidden="true"
                  >
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                </div>
                <div>
                  <p className="text-xs font-medium text-ink mb-1">USDC 지출 승인</p>
                  <p className="text-[11px] text-ink-secondary leading-relaxed">
                    Haggle 에스크로 컨트랙트 (
                    <span className="font-mono text-ink-secondary">{MOCK_ESCROW_ADDR}</span>)가
                    <span className="text-success font-medium"> {amountUsdc} USDC</span>를
                    사용하도록 승인합니다.
                  </p>
                  <p className="text-[10px] text-ink-muted mt-2">
                    Non-custodial: Haggle은 절대 당신의 자금 키를 보유하지 않습니다.
                  </p>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => simulateDelay("sign", 1500)}
              disabled={isAnimating}
              className="w-full rounded-lg bg-action-primary px-4 py-2.5 text-sm font-medium text-on-accent hover:bg-action-primary-hover transition-colors disabled:opacity-50 cursor-pointer"
            >
              {isAnimating ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-on-accent/30 border-t-on-accent rounded-full animate-spin" />
                  지갑에서 승인 중...
                </span>
              ) : (
                "USDC 승인"
              )}
            </button>
          </div>
        )}

        {/* ── Sign x402 ── */}
        {step === "sign" && (
          <div className="space-y-4" style={{ animation: "fadeInUp 0.3s ease-out" }}>
            <div className="rounded-lg bg-surface-sunken border border-line p-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-info-soft border border-info/30">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-info"
                    aria-hidden="true"
                  >
                    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                    <polyline points="10 17 15 12 10 7" />
                    <line x1="15" y1="12" x2="3" y2="12" />
                  </svg>
                </div>
                <div>
                  <p className="text-xs font-medium text-ink mb-1">x402 결제 서명</p>
                  <p className="text-[11px] text-ink-secondary leading-relaxed">
                    HTTP 402 표준 기반 결제 승인에 서명합니다. 에스크로에 자금이 잠기고, 배송 완료
                    후 판매자에게 정산됩니다.
                  </p>
                  <div className="mt-2 rounded bg-surface-overlay p-2 font-mono text-[10px] text-ink-muted space-y-0.5">
                    <div>
                      <span className="text-ink-muted">protocol:</span>{" "}
                      <span className="text-action-primary">x402/v1</span>
                    </div>
                    <div>
                      <span className="text-ink-muted">amount:</span>{" "}
                      <span className="text-success">{amountUsdc} USDC</span>
                    </div>
                    <div>
                      <span className="text-ink-muted">network:</span>{" "}
                      <span className="text-info">Base (eip155:8453)</span>
                    </div>
                    <div>
                      <span className="text-ink-muted">escrow:</span>{" "}
                      <span className="text-ink-secondary">{MOCK_ESCROW_ADDR}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setStep("confirming");
              }}
              disabled={isAnimating}
              className="w-full rounded-lg bg-success px-4 py-2.5 text-sm font-medium text-on-accent hover:bg-success/90 transition-colors disabled:opacity-50 cursor-pointer"
            >
              서명 & 결제 실행
            </button>
          </div>
        )}

        {/* ── Confirming ── */}
        {step === "confirming" && (
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
              <p className="text-sm font-medium text-ink">트랜잭션 확인 중...</p>
              <p className="text-xs text-ink-muted mt-1">
                Base L2에서 블록 확인을 기다리고 있습니다
              </p>
            </div>
            <div className="rounded bg-surface-sunken border border-line px-3 py-2 inline-block">
              <span className="text-[10px] font-mono text-ink-muted">tx: {MOCK_TX_HASH}</span>
            </div>
          </div>
        )}

        {/* ── Complete ── */}
        {step === "complete" && (
          <div
            className="py-6 text-center space-y-4"
            style={{ animation: "fadeInUp 0.4s ease-out" }}
          >
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success-soft border-2 border-success/30">
              <svg
                width="32"
                height="32"
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
            <div>
              <p className="text-lg font-bold text-ink">결제 완료!</p>
              <p className="text-sm text-ink-secondary mt-1">
                <span className="text-success font-medium">{amountUsdc} USDC</span>가 에스크로에
                안전하게 보관됩니다
              </p>
            </div>

            {/* Receipt */}
            <div className="rounded-lg bg-surface-sunken border border-line p-4 text-left space-y-2 max-w-sm mx-auto">
              <div className="text-xs font-semibold text-ink-secondary mb-2">영수증</div>
              <div className="flex justify-between text-xs">
                <span className="text-ink-muted">상품</span>
                <span className="text-ink-secondary">{itemTitle}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-ink-muted">협상 라운드</span>
                <span className="text-ink-secondary">{rounds}회</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-ink-muted">합의 가격</span>
                <span className="text-success font-medium">{amountUsdc}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-ink-muted">수수료 (1.5%)</span>
                <span className="text-ink-secondary">${fee.toFixed(2)}</span>
              </div>
              <div className="border-t border-line pt-2 flex justify-between text-xs font-medium">
                <span className="text-ink-secondary">총 결제</span>
                <span className="text-ink">${total.toFixed(2)}</span>
              </div>
              <div className="border-t border-line pt-2 flex justify-between text-xs">
                <span className="text-ink-muted">네트워크</span>
                <span className="text-info">Base L2</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-ink-muted">Tx Hash</span>
                <span className="font-mono text-ink-muted text-[10px]">{MOCK_TX_HASH}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-ink-muted">상태</span>
                <span className="text-success">에스크로 보관 중</span>
              </div>
            </div>

            <div className="pt-2 space-y-2">
              <p className="text-[11px] text-ink-muted">
                배송 완료 + 리뷰 기간(ARP) 후 판매자에게 자동 정산됩니다
              </p>
              <button
                type="button"
                onClick={onBack}
                className="rounded-lg bg-info px-6 py-2.5 text-sm font-medium text-on-accent hover:bg-info/90 transition-colors cursor-pointer"
              >
                배송 단계로 이동 &rarr;
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
