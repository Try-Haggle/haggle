"use client";

import { useState, useEffect, useCallback } from "react";

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

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/* ── Mock data ────────────────────────── */

const MOCK_WALLET = "0x7a3b...F42d";
const MOCK_FULL_ADDR = "0x7a3bC91e4D8fA2b3E6c5D7f0A1B9C3E5F42d";
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

  const simulateDelay = useCallback(
    (next: PaymentStep, ms = 1200) => {
      setIsAnimating(true);
      const timer = setTimeout(() => {
        setStep(next);
        setIsAnimating(false);
      }, ms);
      return () => clearTimeout(timer);
    },
    [],
  );

  // Auto-advance for confirming step
  useEffect(() => {
    if (step === "confirming") {
      const cleanup = simulateDelay("complete", 2000);
      return cleanup;
    }
  }, [step, simulateDelay]);

  return (
    <div
      className="rounded-xl border border-slate-700 bg-slate-800/50 overflow-hidden"
      style={{ animation: "fadeInUp 0.4s ease-out" }}
    >
      {/* Header */}
      <div className="border-b border-slate-700 px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/15 border border-emerald-500/30">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400">
                <rect width="20" height="14" x="2" y="5" rx="2" />
                <path d="M2 10h20" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">결제 (Demo)</h3>
              <p className="text-[11px] text-slate-500">
                실제 결제가 아닌 시뮬레이션입니다
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold text-emerald-400 font-mono">{amountUsdc}</p>
            <p className="text-[10px] text-slate-500">USDC on Base</p>
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
                      ? "bg-emerald-500 text-white"
                      : i === currentStepIdx
                        ? "bg-cyan-500 text-white ring-2 ring-cyan-500/30"
                        : "bg-slate-700 text-slate-500"
                  }`}
                >
                  {i < currentStepIdx ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </div>
                <span className={`mt-1 text-[8px] whitespace-nowrap ${
                  i === currentStepIdx ? "text-cyan-400" : "text-slate-600"
                }`}>
                  {s.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`mx-1 h-px w-4 sm:w-6 transition-colors duration-300 ${
                  i < currentStepIdx ? "bg-emerald-500" : "bg-slate-700"
                }`} />
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
            <p className="text-xs text-slate-400 mb-3">결제 수단을 선택하세요:</p>
            <button
              onClick={() => {
                setMethod("crypto");
                setStep("connect_wallet");
              }}
              className="w-full flex items-center gap-3 rounded-lg border border-slate-600 bg-slate-900/50 p-4 hover:border-cyan-500/50 hover:bg-cyan-500/5 transition-all text-left cursor-pointer group"
            >
              <span className="text-2xl">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" className="text-cyan-400">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M12 6v12M8 9.5h5.5a2.5 2.5 0 0 1 0 5H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <div className="flex-1">
                <div className="font-medium text-sm text-white group-hover:text-cyan-300 transition-colors">
                  USDC로 결제 ({amountUsdc})
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  Base L2 직접 전송 &middot; 수수료 1.5% &middot; 가스비 Haggle 부담
                </div>
              </div>
              <span className="text-xs text-cyan-400 font-medium bg-cyan-500/10 px-2 py-1 rounded">추천</span>
            </button>
            <button
              onClick={() => {
                setMethod("card");
                setStep("connect_wallet");
              }}
              className="w-full flex items-center gap-3 rounded-lg border border-slate-600 bg-slate-900/50 p-4 hover:border-slate-500 hover:bg-slate-800 transition-all text-left cursor-pointer group"
            >
              <span className="text-2xl">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" className="text-slate-400">
                  <rect x="2" y="5" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M2 10h20" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </span>
              <div className="flex-1">
                <div className="font-medium text-sm text-white group-hover:text-slate-200 transition-colors">
                  카드 결제 ({amountUsdc} + Stripe 수수료)
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  Stripe Onramp &middot; 총 수수료 3% &middot; 지갑 없이도 가능
                </div>
              </div>
            </button>
          </div>
        )}

        {/* ── Connect Wallet (simulated) ── */}
        {step === "connect_wallet" && (
          <div className="space-y-4" style={{ animation: "fadeInUp 0.3s ease-out" }}>
            <div className="rounded-lg bg-slate-900/60 border border-slate-700 p-4">
              <p className="text-xs text-slate-400 mb-3">
                {method === "crypto"
                  ? "USDC 결제를 위해 지갑을 연결하세요."
                  : "결제 수령을 위한 지갑을 연결하세요."}
              </p>
              <div className="flex flex-wrap gap-2">
                {["Coinbase Wallet", "MetaMask", "WalletConnect"].map((name) => (
                  <button
                    key={name}
                    onClick={() => simulateDelay("balance_check", 800)}
                    disabled={isAnimating}
                    className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-xs text-slate-300 hover:border-cyan-500/50 hover:text-white transition-all cursor-pointer disabled:opacity-50"
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
            {isAnimating && (
              <div className="flex items-center justify-center gap-2 py-2">
                <div className="w-4 h-4 border-2 border-slate-600 border-t-cyan-400 rounded-full animate-spin" />
                <span className="text-xs text-slate-400">지갑 연결 중...</span>
              </div>
            )}
          </div>
        )}

        {/* ── Balance Check ── */}
        {step === "balance_check" && (
          <div className="space-y-4" style={{ animation: "fadeInUp 0.3s ease-out" }}>
            <div className="rounded-lg bg-slate-900/60 border border-emerald-500/20 p-4 space-y-2.5">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-xs font-medium text-emerald-400">지갑 연결됨</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">주소</span>
                <span className="font-mono text-slate-300">{MOCK_WALLET}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">USDC 잔액</span>
                <span className="text-white font-medium">${MOCK_USDC_BALANCE}</span>
              </div>
              <div className="border-t border-slate-700 pt-2 flex justify-between text-xs">
                <span className="text-slate-500">결제 금액</span>
                <span className="text-emerald-400 font-bold">{amountUsdc}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">수수료 (1.5%)</span>
                <span className="text-slate-400">${fee.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-xs font-medium">
                <span className="text-slate-400">총 결제액</span>
                <span className="text-white">${total.toFixed(2)}</span>
              </div>
            </div>
            <button
              onClick={() => simulateDelay("approve", 1000)}
              disabled={isAnimating}
              className="w-full rounded-lg bg-cyan-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-cyan-600 transition-colors disabled:opacity-50 cursor-pointer"
            >
              {isAnimating ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
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
            <div className="rounded-lg bg-slate-900/60 border border-slate-700 p-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 border border-amber-500/30">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                </div>
                <div>
                  <p className="text-xs font-medium text-white mb-1">USDC 지출 승인</p>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Haggle 에스크로 컨트랙트 (<span className="font-mono text-slate-300">{MOCK_ESCROW_ADDR}</span>)가
                    <span className="text-emerald-400 font-medium"> {amountUsdc} USDC</span>를 사용하도록 승인합니다.
                  </p>
                  <p className="text-[10px] text-slate-500 mt-2">
                    Non-custodial: Haggle은 절대 당신의 자금 키를 보유하지 않습니다.
                  </p>
                </div>
              </div>
            </div>
            <button
              onClick={() => simulateDelay("sign", 1500)}
              disabled={isAnimating}
              className="w-full rounded-lg bg-cyan-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-cyan-600 transition-colors disabled:opacity-50 cursor-pointer"
            >
              {isAnimating ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
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
            <div className="rounded-lg bg-slate-900/60 border border-slate-700 p-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-purple-500/15 border border-purple-500/30">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-purple-400">
                    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                    <polyline points="10 17 15 12 10 7" />
                    <line x1="15" y1="12" x2="3" y2="12" />
                  </svg>
                </div>
                <div>
                  <p className="text-xs font-medium text-white mb-1">x402 결제 서명</p>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    HTTP 402 표준 기반 결제 승인에 서명합니다.
                    에스크로에 자금이 잠기고, 배송 완료 후 판매자에게 정산됩니다.
                  </p>
                  <div className="mt-2 rounded bg-slate-800 p-2 font-mono text-[10px] text-slate-500 space-y-0.5">
                    <div><span className="text-slate-600">protocol:</span> <span className="text-cyan-400">x402/v1</span></div>
                    <div><span className="text-slate-600">amount:</span> <span className="text-emerald-400">{amountUsdc} USDC</span></div>
                    <div><span className="text-slate-600">network:</span> <span className="text-purple-400">Base (eip155:8453)</span></div>
                    <div><span className="text-slate-600">escrow:</span> <span className="text-slate-400">{MOCK_ESCROW_ADDR}</span></div>
                  </div>
                </div>
              </div>
            </div>
            <button
              onClick={() => {
                setStep("confirming");
              }}
              disabled={isAnimating}
              className="w-full rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-600 transition-colors disabled:opacity-50 cursor-pointer"
            >
              서명 & 결제 실행
            </button>
          </div>
        )}

        {/* ── Confirming ── */}
        {step === "confirming" && (
          <div className="py-8 text-center space-y-4" style={{ animation: "fadeInUp 0.3s ease-out" }}>
            <div className="relative mx-auto w-16 h-16">
              <div className="absolute inset-0 rounded-full border-2 border-slate-700" />
              <div className="absolute inset-0 rounded-full border-2 border-t-cyan-400 animate-spin" />
              <div className="absolute inset-2 rounded-full border-2 border-t-emerald-400 animate-spin" style={{ animationDirection: "reverse", animationDuration: "1.5s" }} />
            </div>
            <div>
              <p className="text-sm font-medium text-white">트랜잭션 확인 중...</p>
              <p className="text-xs text-slate-500 mt-1">Base L2에서 블록 확인을 기다리고 있습니다</p>
            </div>
            <div className="rounded bg-slate-900/60 border border-slate-700 px-3 py-2 inline-block">
              <span className="text-[10px] font-mono text-slate-500">tx: {MOCK_TX_HASH}</span>
            </div>
          </div>
        )}

        {/* ── Complete ── */}
        {step === "complete" && (
          <div className="py-6 text-center space-y-4" style={{ animation: "fadeInUp 0.4s ease-out" }}>
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15 border-2 border-emerald-500/30">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div>
              <p className="text-lg font-bold text-white">결제 완료!</p>
              <p className="text-sm text-slate-400 mt-1">
                <span className="text-emerald-400 font-medium">{amountUsdc} USDC</span>가
                에스크로에 안전하게 보관됩니다
              </p>
            </div>

            {/* Receipt */}
            <div className="rounded-lg bg-slate-900/60 border border-slate-700 p-4 text-left space-y-2 max-w-sm mx-auto">
              <div className="text-xs font-semibold text-slate-300 mb-2">영수증</div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">상품</span>
                <span className="text-slate-300">{itemTitle}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">협상 라운드</span>
                <span className="text-slate-300">{rounds}회</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">합의 가격</span>
                <span className="text-emerald-400 font-medium">{amountUsdc}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">수수료 (1.5%)</span>
                <span className="text-slate-400">${fee.toFixed(2)}</span>
              </div>
              <div className="border-t border-slate-700 pt-2 flex justify-between text-xs font-medium">
                <span className="text-slate-400">총 결제</span>
                <span className="text-white">${total.toFixed(2)}</span>
              </div>
              <div className="border-t border-slate-700 pt-2 flex justify-between text-xs">
                <span className="text-slate-500">네트워크</span>
                <span className="text-purple-400">Base L2</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Tx Hash</span>
                <span className="font-mono text-slate-500 text-[10px]">{MOCK_TX_HASH}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">상태</span>
                <span className="text-emerald-400">에스크로 보관 중</span>
              </div>
            </div>

            <div className="pt-2 space-y-2">
              <p className="text-[11px] text-slate-500">
                배송 완료 + 리뷰 기간(ARP) 후 판매자에게 자동 정산됩니다
              </p>
              <button
                onClick={onBack}
                className="rounded-lg border border-slate-700 px-6 py-2 text-sm font-medium text-slate-300 hover:border-slate-500 hover:text-white transition-colors cursor-pointer"
              >
                데모로 돌아가기
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
