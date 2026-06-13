"use client";

import { useEffect, useRef, useState } from "react";

/* ── Types ────────────────────────────── */

type ShowcaseStep =
  | "idle"
  // Phase 1: Sign-up
  | "typing_email"
  | "google_click"
  | "google_popup"
  | "signup_done"
  // Phase 2: Wallet
  | "wallet_prompt"
  | "wallet_creating"
  | "wallet_done"
  // Final
  | "all_done";

/* ── Component ────────────────────────── */

export function DemoSignupShowcase() {
  const [step, setStep] = useState<ShowcaseStep>("idle");
  const [typedEmail, setTypedEmail] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [signupTime, setSignupTime] = useState(0);
  const [walletTime, setWalletTime] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  const DEMO_EMAIL = "buyer@example.com";
  const MOCK_WALLET = "0x7a3b...F42d";

  /* ── Typing animation ── */
  useEffect(() => {
    if (step !== "typing_email") return;
    let idx = 0;
    const interval = setInterval(() => {
      if (idx < DEMO_EMAIL.length) {
        setTypedEmail(DEMO_EMAIL.slice(0, idx + 1));
        idx++;
      } else {
        clearInterval(interval);
        setTimeout(() => setStep("google_click"), 600);
      }
    }, 60);
    return () => clearInterval(interval);
  }, [step]);

  /* ── Google flow ── */
  useEffect(() => {
    if (step !== "google_click") return;
    const t = setTimeout(() => setStep("google_popup"), 400);
    return () => clearTimeout(t);
  }, [step]);

  useEffect(() => {
    if (step !== "google_popup") return;
    const t = setTimeout(() => {
      setSignupTime(Date.now() - startTimeRef.current);
      setStep("signup_done");
    }, 1500);
    return () => clearTimeout(t);
  }, [step]);

  /* ── signup_done → wallet_prompt auto-advance ── */
  useEffect(() => {
    if (step !== "signup_done") return;
    const t = setTimeout(() => setStep("wallet_prompt"), 1800);
    return () => clearTimeout(t);
  }, [step]);

  /* ── wallet_creating → wallet_done ── */
  useEffect(() => {
    if (step !== "wallet_creating") return;
    const t = setTimeout(() => {
      setWalletTime(Date.now() - startTimeRef.current - signupTime);
      setStep("wallet_done");
    }, 2500);
    return () => clearTimeout(t);
  }, [step, signupTime]);

  /* ── wallet_done → all_done auto-advance ── */
  useEffect(() => {
    if (step !== "wallet_done") return;
    const t = setTimeout(() => setStep("all_done"), 1500);
    return () => clearTimeout(t);
  }, [step]);

  /* ── Stopwatch ── */
  useEffect(() => {
    if (step === "typing_email" && !timerRef.current) {
      startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setElapsed(Date.now() - startTimeRef.current);
      }, 50);
    }
    if (step === "all_done" && timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [step]);

  const startDemo = () => {
    setStep("typing_email");
    setTypedEmail("");
    setElapsed(0);
    setSignupTime(0);
    setWalletTime(0);
  };

  const resetDemo = () => {
    setStep("idle");
    setTypedEmail("");
    setElapsed(0);
    setSignupTime(0);
    setWalletTime(0);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const elapsedStr = (elapsed / 1000).toFixed(1);
  const signupStr = (signupTime / 1000).toFixed(1);
  const walletStr = (walletTime / 1000).toFixed(1);
  const totalStr = ((signupTime + walletTime) / 1000).toFixed(1);

  const isSignupPhase = ["typing_email", "google_click", "google_popup", "signup_done"].includes(
    step,
  );
  const isWalletPhase = ["wallet_prompt", "wallet_creating", "wallet_done"].includes(step);
  const pastSignup = !["idle", "typing_email", "google_click", "google_popup"].includes(step);
  const pastWallet = step === "all_done";

  return (
    <div
      className="rounded-xl border border-line bg-surface-raised overflow-hidden"
      style={{ animation: "fadeInUp 0.4s ease-out" }}
    >
      {/* Header */}
      <div className="border-b border-line px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-action-primary/10 border border-action-primary/30">
              <svg
                aria-hidden="true"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-action-primary"
              >
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <line x1="19" y1="8" x2="19" y2="14" />
                <line x1="22" y1="11" x2="16" y2="11" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink">가입 + 지갑 생성 데모</h3>
              <p className="text-[11px] text-ink-muted">계정 생성부터 결제 준비까지 전체 온보딩</p>
            </div>
          </div>
          {step !== "idle" && (
            <div className="text-right">
              <div className="font-mono text-lg font-bold tabular-nums">
                <span className={step === "all_done" ? "text-success" : "text-action-primary"}>
                  {elapsedStr}s
                </span>
              </div>
              <p className="text-[10px] text-ink-muted">소요 시간</p>
            </div>
          )}
        </div>
      </div>

      {/* Phase Progress Bar */}
      {step !== "idle" && (
        <div className="px-5 pt-4 pb-2">
          <div className="flex items-center gap-2">
            {/* Phase 1: Sign-up */}
            <div className="flex items-center gap-1.5">
              <div
                className={`flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold transition-all duration-300 ${
                  pastSignup
                    ? "bg-success text-on-accent"
                    : isSignupPhase
                      ? "bg-action-primary text-on-accent ring-2 ring-action-primary/30"
                      : "bg-surface-sunken text-ink-muted"
                }`}
              >
                {pastSignup ? (
                  <svg
                    aria-hidden="true"
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  "1"
                )}
              </div>
              <span
                className={`text-[10px] whitespace-nowrap ${isSignupPhase ? "text-action-primary font-medium" : pastSignup ? "text-success" : "text-ink-muted"}`}
              >
                가입 {pastSignup && signupTime > 0 ? `(${signupStr}s)` : ""}
              </span>
            </div>
            <div
              className={`h-px flex-1 transition-colors duration-500 ${pastSignup ? "bg-success" : "bg-surface-sunken"}`}
            />
            {/* Phase 2: Wallet */}
            <div className="flex items-center gap-1.5">
              <div
                className={`flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold transition-all duration-300 ${
                  pastWallet
                    ? "bg-success text-on-accent"
                    : isWalletPhase
                      ? "bg-action-primary text-on-accent ring-2 ring-action-primary/30"
                      : "bg-surface-sunken text-ink-muted"
                }`}
              >
                {pastWallet ? (
                  <svg
                    aria-hidden="true"
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  "2"
                )}
              </div>
              <span
                className={`text-[10px] whitespace-nowrap ${isWalletPhase ? "text-action-primary font-medium" : pastWallet ? "text-success" : "text-ink-muted"}`}
              >
                지갑 생성 {pastWallet && walletTime > 0 ? `(${walletStr}s)` : ""}
              </span>
            </div>
            <div
              className={`h-px flex-1 transition-colors duration-500 ${pastWallet ? "bg-success" : "bg-surface-sunken"}`}
            />
            {/* Phase 3: Ready */}
            <div className="flex items-center gap-1.5">
              <div
                className={`flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold transition-all duration-300 ${
                  pastWallet ? "bg-success text-on-accent" : "bg-surface-sunken text-ink-muted"
                }`}
              >
                {pastWallet ? (
                  <svg
                    aria-hidden="true"
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  "3"
                )}
              </div>
              <span
                className={`text-[10px] whitespace-nowrap ${pastWallet ? "text-success font-medium" : "text-ink-muted"}`}
              >
                거래 준비 완료
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="px-5 py-5">
        {/* ── Idle ── */}
        {step === "idle" && (
          <div className="text-center space-y-4">
            <div className="space-y-2">
              <p className="text-sm text-ink-secondary">
                가입부터 지갑 생성까지, 거래 준비에 얼마나 걸리는지 확인하세요.
              </p>
              <p className="text-xs text-ink-muted">
                Google 가입 + Coinbase Smart Wallet 자동 생성 &mdash; 전체 과정 15초 미만.
              </p>
            </div>
            <button
              type="button"
              onClick={startDemo}
              className="rounded-lg bg-action-primary px-6 py-2.5 text-sm font-medium text-on-accent hover:bg-action-primary-hover transition-colors cursor-pointer"
            >
              데모 시작
            </button>
          </div>
        )}

        {/* ═══════════════════════════════════════════ */}
        {/* PHASE 1: Sign-up                           */}
        {/* ═══════════════════════════════════════════ */}
        {isSignupPhase && (
          <div className="space-y-5">
            {/* Mock sign-up form */}
            <div className="rounded-xl border border-line bg-surface-sunken p-5 max-w-sm mx-auto">
              <div className="text-center mb-4">
                <h4 className="text-base font-bold text-ink">Haggle</h4>
                <p className="text-xs text-ink-muted mt-0.5">Create your account</p>
              </div>

              {/* Google button */}
              <button
                type="button"
                className={`flex w-full items-center justify-center gap-2.5 rounded-lg border px-4 py-2.5 text-sm font-medium transition-all ${
                  step === "google_click" || step === "google_popup"
                    ? "border-action-primary bg-action-primary/10 text-ink scale-[0.98]"
                    : "border-line bg-surface-overlay text-ink-secondary"
                }`}
              >
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24">
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    fill="#EA4335"
                  />
                </svg>
                Continue with Google
                {(step === "google_click" || step === "google_popup") && (
                  <span className="ml-1 text-action-primary text-xs">
                    <svg
                      aria-hidden="true"
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="inline animate-pulse"
                    >
                      <path
                        d="M5 12h14M12 5l7 7-7 7"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                )}
              </button>

              {/* Divider */}
              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-line" />
                </div>
                <div className="relative flex justify-center text-[10px]">
                  <span className="bg-surface-sunken px-2 text-ink-muted">or</span>
                </div>
              </div>

              {/* Email field (typing animation) */}
              <div className="space-y-3">
                <div>
                  <span className="block text-[11px] font-medium text-ink-muted mb-1">Email</span>
                  <div className="w-full rounded-lg border border-line bg-surface-overlay px-3 py-2 text-sm font-mono">
                    <span className="text-ink-secondary">{typedEmail}</span>
                    {step === "typing_email" && (
                      <span className="animate-pulse text-action-primary">|</span>
                    )}
                    {!typedEmail && <span className="text-ink-muted">you@example.com</span>}
                  </div>
                </div>
                <div className="text-[10px] text-ink-muted text-center">
                  대부분의 사용자는 Google로 바로 가입합니다 ^
                </div>
              </div>
            </div>

            {/* Google popup simulation */}
            {step === "google_popup" && (
              <div
                className="rounded-lg border border-line bg-surface-sunken p-4 max-w-xs mx-auto"
                style={{ animation: "fadeInUp 0.2s ease-out" }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24">
                    <path
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                      fill="#4285F4"
                    />
                    <path
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      fill="#34A853"
                    />
                    <path
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      fill="#FBBC05"
                    />
                    <path
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      fill="#EA4335"
                    />
                  </svg>
                  <span className="text-xs font-medium text-ink-secondary">Google 계정 선택</span>
                </div>
                <div className="rounded-lg border border-action-primary/30 bg-action-primary/10 p-2.5 flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-info flex items-center justify-center text-on-accent text-xs font-bold">
                    B
                  </div>
                  <div>
                    <div className="text-xs font-medium text-ink">buyer@example.com</div>
                    <div className="text-[10px] text-ink-muted">Buyer Demo</div>
                  </div>
                  <div className="ml-auto">
                    <div className="w-3 h-3 border-2 border-line border-t-action-primary rounded-full animate-spin" />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── signup_done (brief) ── */}
        {step === "signup_done" && (
          <div className="text-center space-y-3" style={{ animation: "fadeInUp 0.3s ease-out" }}>
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-success-soft border border-success/30">
              <svg
                aria-hidden="true"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-success"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-bold text-success">계정 생성 완료!</p>
              <p className="text-xs text-ink-secondary mt-1">
                {signupStr}초 만에 완료. 이제 지갑을 만들어봅시다...
              </p>
            </div>
            <div className="flex items-center justify-center gap-2 text-ink-muted">
              <div className="w-3 h-3 border-2 border-line border-t-action-primary rounded-full animate-spin" />
              <span className="text-[11px]">지갑 설정으로 이동 중...</span>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════ */}
        {/* PHASE 2: Wallet Creation                   */}
        {/* ═══════════════════════════════════════════ */}

        {/* ── wallet_prompt ── */}
        {step === "wallet_prompt" && (
          <div className="space-y-4" style={{ animation: "fadeInUp 0.3s ease-out" }}>
            <div className="rounded-xl border border-line bg-surface-sunken p-5 max-w-md mx-auto">
              <div className="text-center mb-4">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-info-soft border border-info/30 mb-2">
                  <svg
                    aria-hidden="true"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-info"
                  >
                    <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
                    <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
                    <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
                  </svg>
                </div>
                <h4 className="text-sm font-bold text-ink">결제를 위한 지갑이 필요합니다</h4>
                <p className="text-[11px] text-ink-muted mt-1">
                  USDC 결제를 위해 지갑을 연결하거나 새로 만드세요
                </p>
              </div>

              <div className="space-y-2.5">
                {/* Coinbase Smart Wallet - highlighted */}
                <button
                  type="button"
                  onClick={() => setStep("wallet_creating")}
                  className="w-full flex items-center gap-3 rounded-lg border border-info/30 bg-info-soft p-3.5 hover:border-info/50 transition-all text-left cursor-pointer group"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-info">
                    <svg
                      aria-hidden="true"
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      className="text-on-accent"
                    >
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-ink group-hover:text-info transition-colors">
                        Coinbase Smart Wallet
                      </span>
                      <span className="text-[9px] font-bold text-info bg-info-soft px-1.5 py-0.5 rounded">
                        추천
                      </span>
                    </div>
                    <span className="text-[11px] text-ink-muted">
                      이메일만으로 즉시 생성 &middot; 시드구문 없음 &middot; ~10초
                    </span>
                  </div>
                  <svg
                    aria-hidden="true"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-ink-muted group-hover:text-info transition-colors"
                  >
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </button>

                {/* MetaMask */}
                <button
                  type="button"
                  className="w-full flex items-center gap-3 rounded-lg border border-line bg-surface-raised p-3.5 text-left opacity-60"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-warning-soft">
                    <svg
                      aria-hidden="true"
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      className="text-warning"
                    >
                      <path
                        d="M21 12V7H5a2 2 0 0 1 0-4h14v4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M3 5v14a2 2 0 0 0 2 2h16v-5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <span className="text-sm font-medium text-ink-secondary">
                      MetaMask / 기존 지갑 연결
                    </span>
                    <div className="text-[11px] text-ink-muted">
                      이미 지갑이 있다면 바로 연결 &middot; ~5초
                    </div>
                  </div>
                </button>

                {/* Skip */}
                <div className="text-center pt-1">
                  <span className="text-[10px] text-ink-muted">
                    또는 <span className="text-ink-secondary">카드 결제</span>를 선택하면 지갑
                    없이도 거래 가능
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── wallet_creating ── */}
        {step === "wallet_creating" && (
          <div className="space-y-4" style={{ animation: "fadeInUp 0.3s ease-out" }}>
            <div className="rounded-xl border border-info/30 bg-info-soft p-5 max-w-md mx-auto">
              <div className="text-center space-y-4">
                {/* Coinbase header */}
                <div className="flex items-center justify-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-info">
                    <svg
                      aria-hidden="true"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      className="text-on-accent"
                    >
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z" />
                    </svg>
                  </div>
                  <span className="text-sm font-semibold text-ink">Coinbase Smart Wallet</span>
                </div>

                {/* Creating animation */}
                <div className="space-y-3">
                  <WalletCreationStep label="Google 계정 인증 확인" delay={0} />
                  <WalletCreationStep label="Smart Wallet 컨트랙트 배포 (Base)" delay={600} />
                  <WalletCreationStep label="키 생성 (Passkey 기반)" delay={1200} />
                  <WalletCreationStep label="지갑 주소 할당" delay={1800} />
                </div>

                <div className="pt-2">
                  <div className="h-1 rounded-full bg-surface-sunken overflow-hidden">
                    <div className="h-full bg-info rounded-full animate-wallet-progress" />
                  </div>
                  <p className="text-[10px] text-ink-muted mt-2">
                    시드구문 없음 &middot; 복구는 Google 계정으로 &middot; 가스비 Haggle 부담
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── wallet_done ── */}
        {step === "wallet_done" && (
          <div className="text-center space-y-3" style={{ animation: "fadeInUp 0.3s ease-out" }}>
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-success-soft border border-success/30">
              <svg
                aria-hidden="true"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-success"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-bold text-success">지갑 생성 완료!</p>
              <p className="text-xs text-ink-secondary mt-1">
                추가 {walletStr}초. 지갑 주소:{" "}
                <span className="font-mono text-ink-secondary">{MOCK_WALLET}</span>
              </p>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════ */}
        {/* ALL DONE                                   */}
        {/* ═══════════════════════════════════════════ */}
        {step === "all_done" && (
          <div className="text-center space-y-5" style={{ animation: "fadeInUp 0.4s ease-out" }}>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success-soft border-2 border-success/30">
              <svg
                aria-hidden="true"
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-success"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>

            <div>
              <p className="text-lg font-bold text-ink">거래 준비 완료!</p>
              <p className="text-xs text-ink-secondary mt-1">
                계정 생성 + 지갑 생성, 총{" "}
                <span className="text-success font-bold text-sm">{totalStr}초</span>
              </p>
            </div>

            {/* Breakdown */}
            <div className="rounded-lg bg-surface-sunken border border-line p-4 max-w-sm mx-auto text-left space-y-2.5">
              <div className="text-[10px] text-ink-muted font-medium mb-2">소요 시간 분석</div>
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-action-primary" />
                  <span className="text-ink-secondary">Google 가입</span>
                </div>
                <span className="font-mono text-action-primary">{signupStr}s</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-info" />
                  <span className="text-ink-secondary">Coinbase Smart Wallet 생성</span>
                </div>
                <span className="font-mono text-info">{walletStr}s</span>
              </div>
              <div className="border-t border-line pt-2 flex items-center justify-between text-xs font-medium">
                <span className="text-ink-secondary">총 온보딩</span>
                <span className="font-mono text-success">{totalStr}s</span>
              </div>
            </div>

            {/* What user got */}
            <div className="rounded-lg bg-surface-sunken border border-line p-4 max-w-sm mx-auto text-left">
              <div className="text-[10px] text-ink-muted font-medium mb-2">사용자가 얻은 것</div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-success">&#10003;</span>
                  <span className="text-ink-secondary">Haggle 계정 (Google SSO)</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-success">&#10003;</span>
                  <span className="text-ink-secondary">
                    Base L2 지갑 (
                    <span className="font-mono text-ink-secondary">{MOCK_WALLET}</span>)
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-success">&#10003;</span>
                  <span className="text-ink-secondary">USDC 송수신 가능 상태</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-success">&#10003;</span>
                  <span className="text-ink-secondary">시드구문 관리 불필요 (Passkey 기반)</span>
                </div>
              </div>
            </div>

            {/* Comparison */}
            <div className="rounded-lg bg-surface-sunken border border-line p-4 max-w-sm mx-auto">
              <div className="text-[10px] text-ink-muted mb-3">
                온보딩 비교 (가입 + 결제 수단 준비)
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-ink-secondary w-16">eBay</span>
                  <div className="flex-1 mx-3">
                    <div className="h-2 rounded-full bg-red-500/50" style={{ width: "100%" }} />
                  </div>
                  <span className="text-ink-muted text-[10px] w-14 text-right">~5분</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-ink-secondary w-16">Mercari</span>
                  <div className="flex-1 mx-3">
                    <div className="h-2 rounded-full bg-amber-500/50" style={{ width: "70%" }} />
                  </div>
                  <span className="text-ink-muted text-[10px] w-14 text-right">~3분</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-ink-secondary w-16">OpenSea</span>
                  <div className="flex-1 mx-3">
                    <div className="h-2 rounded-full bg-purple-500/50" style={{ width: "50%" }} />
                  </div>
                  <span className="text-ink-muted text-[10px] w-14 text-right">~2분</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-success font-medium w-16">Haggle</span>
                  <div className="flex-1 mx-3">
                    <div className="h-2 rounded-full bg-success" style={{ width: "5%" }} />
                  </div>
                  <span className="text-success text-[10px] font-bold w-14 text-right">
                    ~{totalStr}s
                  </span>
                </div>
              </div>
              <p className="text-[10px] text-ink-muted mt-2 text-center">
                eBay: 가입 + 주소 + 카드 등록 | Mercari: 가입 + 본인인증 | OpenSea: 가입 + MetaMask
                설치
              </p>
            </div>

            <button
              type="button"
              onClick={resetDemo}
              className="text-xs text-ink-muted hover:text-ink-secondary transition-colors cursor-pointer"
            >
              다시 보기
            </button>
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes walletProgress {
          0% { width: 0%; }
          30% { width: 35%; }
          60% { width: 70%; }
          90% { width: 95%; }
          100% { width: 100%; }
        }
        .animate-wallet-progress {
          animation: walletProgress 2.5s ease-out forwards;
        }
      `}</style>
    </div>
  );
}

/* ── Sub-component: Wallet creation step ── */

function WalletCreationStep({ label, delay }: { label: string; delay: number }) {
  const [visible, setVisible] = useState(false);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setVisible(true), delay);
    const t2 = setTimeout(() => setCompleted(true), delay + 800);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [delay]);

  if (!visible) return null;

  return (
    <div
      className="flex items-center gap-2 text-xs"
      style={{ animation: "fadeInUp 0.2s ease-out" }}
    >
      {completed ? (
        <svg
          aria-hidden="true"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-success shrink-0"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <div className="w-3.5 h-3.5 border-2 border-line border-t-info rounded-full animate-spin shrink-0" />
      )}
      <span className={completed ? "text-ink-secondary" : "text-ink-muted"}>{label}</span>
    </div>
  );
}
