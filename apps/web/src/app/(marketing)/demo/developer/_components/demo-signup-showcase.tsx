"use client";

import { useState, useEffect, useRef } from "react";

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

  const isSignupPhase = ["typing_email", "google_click", "google_popup", "signup_done"].includes(step);
  const isWalletPhase = ["wallet_prompt", "wallet_creating", "wallet_done"].includes(step);
  const pastSignup = !["idle", "typing_email", "google_click", "google_popup"].includes(step);
  const pastWallet = step === "all_done";

  return (
    <div
      className="rounded-xl border border-slate-700 bg-slate-800/50 overflow-hidden"
      style={{ animation: "fadeInUp 0.4s ease-out" }}
    >
      {/* Header */}
      <div className="border-b border-slate-700 px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-500/15 border border-cyan-500/30">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-cyan-400">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <line x1="19" y1="8" x2="19" y2="14" />
                <line x1="22" y1="11" x2="16" y2="11" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">가입 + 지갑 생성 데모</h3>
              <p className="text-[11px] text-slate-500">
                계정 생성부터 결제 준비까지 전체 온보딩
              </p>
            </div>
          </div>
          {step !== "idle" && (
            <div className="text-right">
              <div className="font-mono text-lg font-bold tabular-nums">
                <span className={step === "all_done" ? "text-emerald-400" : "text-cyan-400"}>
                  {elapsedStr}s
                </span>
              </div>
              <p className="text-[10px] text-slate-500">소요 시간</p>
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
              <div className={`flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold transition-all duration-300 ${
                pastSignup
                  ? "bg-emerald-500 text-white"
                  : isSignupPhase
                    ? "bg-cyan-500 text-white ring-2 ring-cyan-500/30"
                    : "bg-slate-700 text-slate-500"
              }`}>
                {pastSignup ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                ) : "1"}
              </div>
              <span className={`text-[10px] whitespace-nowrap ${isSignupPhase ? "text-cyan-400 font-medium" : pastSignup ? "text-emerald-400" : "text-slate-600"}`}>
                가입 {pastSignup && signupTime > 0 ? `(${signupStr}s)` : ""}
              </span>
            </div>
            <div className={`h-px flex-1 transition-colors duration-500 ${pastSignup ? "bg-emerald-500" : "bg-slate-700"}`} />
            {/* Phase 2: Wallet */}
            <div className="flex items-center gap-1.5">
              <div className={`flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold transition-all duration-300 ${
                pastWallet
                  ? "bg-emerald-500 text-white"
                  : isWalletPhase
                    ? "bg-cyan-500 text-white ring-2 ring-cyan-500/30"
                    : "bg-slate-700 text-slate-500"
              }`}>
                {pastWallet ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                ) : "2"}
              </div>
              <span className={`text-[10px] whitespace-nowrap ${isWalletPhase ? "text-cyan-400 font-medium" : pastWallet ? "text-emerald-400" : "text-slate-600"}`}>
                지갑 생성 {pastWallet && walletTime > 0 ? `(${walletStr}s)` : ""}
              </span>
            </div>
            <div className={`h-px flex-1 transition-colors duration-500 ${pastWallet ? "bg-emerald-500" : "bg-slate-700"}`} />
            {/* Phase 3: Ready */}
            <div className="flex items-center gap-1.5">
              <div className={`flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold transition-all duration-300 ${
                pastWallet
                  ? "bg-emerald-500 text-white"
                  : "bg-slate-700 text-slate-500"
              }`}>
                {pastWallet ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                ) : "3"}
              </div>
              <span className={`text-[10px] whitespace-nowrap ${pastWallet ? "text-emerald-400 font-medium" : "text-slate-600"}`}>
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
              <p className="text-sm text-slate-300">
                가입부터 지갑 생성까지, 거래 준비에 얼마나 걸리는지 확인하세요.
              </p>
              <p className="text-xs text-slate-500">
                Google 가입 + Coinbase Smart Wallet 자동 생성 &mdash; 전체 과정 15초 미만.
              </p>
            </div>
            <button
              onClick={startDemo}
              className="rounded-lg bg-cyan-500 px-6 py-2.5 text-sm font-medium text-white hover:bg-cyan-600 transition-colors cursor-pointer"
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
            <div className="rounded-xl border border-slate-600 bg-slate-900/70 p-5 max-w-sm mx-auto">
              <div className="text-center mb-4">
                <h4 className="text-base font-bold text-white">Haggle</h4>
                <p className="text-xs text-slate-500 mt-0.5">Create your account</p>
              </div>

              {/* Google button */}
              <button
                className={`flex w-full items-center justify-center gap-2.5 rounded-lg border px-4 py-2.5 text-sm font-medium transition-all ${
                  step === "google_click" || step === "google_popup"
                    ? "border-cyan-500 bg-cyan-500/10 text-white scale-[0.98]"
                    : "border-slate-600 bg-slate-800 text-slate-300"
                }`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                </svg>
                Continue with Google
                {(step === "google_click" || step === "google_popup") && (
                  <span className="ml-1 text-cyan-400 text-xs">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="inline animate-pulse">
                      <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                )}
              </button>

              {/* Divider */}
              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-700" />
                </div>
                <div className="relative flex justify-center text-[10px]">
                  <span className="bg-slate-900/70 px-2 text-slate-600">or</span>
                </div>
              </div>

              {/* Email field (typing animation) */}
              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">Email</label>
                  <div className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-mono">
                    <span className="text-slate-300">{typedEmail}</span>
                    {step === "typing_email" && (
                      <span className="animate-pulse text-cyan-400">|</span>
                    )}
                    {!typedEmail && <span className="text-slate-600">you@example.com</span>}
                  </div>
                </div>
                <div className="text-[10px] text-slate-600 text-center">
                  대부분의 사용자는 Google로 바로 가입합니다 ^
                </div>
              </div>
            </div>

            {/* Google popup simulation */}
            {step === "google_popup" && (
              <div
                className="rounded-lg border border-slate-600 bg-slate-900/80 p-4 max-w-xs mx-auto"
                style={{ animation: "fadeInUp 0.2s ease-out" }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <svg width="14" height="14" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                  </svg>
                  <span className="text-xs font-medium text-slate-300">Google 계정 선택</span>
                </div>
                <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-2.5 flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-bold">B</div>
                  <div>
                    <div className="text-xs font-medium text-white">buyer@example.com</div>
                    <div className="text-[10px] text-slate-500">Buyer Demo</div>
                  </div>
                  <div className="ml-auto">
                    <div className="w-3 h-3 border-2 border-slate-600 border-t-cyan-400 rounded-full animate-spin" />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── signup_done (brief) ── */}
        {step === "signup_done" && (
          <div className="text-center space-y-3" style={{ animation: "fadeInUp 0.3s ease-out" }}>
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/15 border border-emerald-500/30">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-bold text-emerald-400">계정 생성 완료!</p>
              <p className="text-xs text-slate-400 mt-1">
                {signupStr}초 만에 완료. 이제 지갑을 만들어봅시다...
              </p>
            </div>
            <div className="flex items-center justify-center gap-2 text-slate-500">
              <div className="w-3 h-3 border-2 border-slate-600 border-t-cyan-400 rounded-full animate-spin" />
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
            <div className="rounded-xl border border-slate-600 bg-slate-900/70 p-5 max-w-md mx-auto">
              <div className="text-center mb-4">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-blue-500/15 border border-blue-500/30 mb-2">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400">
                    <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
                    <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
                    <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
                  </svg>
                </div>
                <h4 className="text-sm font-bold text-white">결제를 위한 지갑이 필요합니다</h4>
                <p className="text-[11px] text-slate-500 mt-1">
                  USDC 결제를 위해 지갑을 연결하거나 새로 만드세요
                </p>
              </div>

              <div className="space-y-2.5">
                {/* Coinbase Smart Wallet - highlighted */}
                <button
                  onClick={() => setStep("wallet_creating")}
                  className="w-full flex items-center gap-3 rounded-lg border border-blue-500/30 bg-blue-500/5 p-3.5 hover:border-blue-500/50 transition-all text-left cursor-pointer group"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-600">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white group-hover:text-blue-300 transition-colors">
                        Coinbase Smart Wallet
                      </span>
                      <span className="text-[9px] font-bold text-blue-400 bg-blue-500/15 px-1.5 py-0.5 rounded">추천</span>
                    </div>
                    <span className="text-[11px] text-slate-500">
                      이메일만으로 즉시 생성 &middot; 시드구문 없음 &middot; ~10초
                    </span>
                  </div>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-600 group-hover:text-blue-400 transition-colors">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </button>

                {/* MetaMask */}
                <button className="w-full flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-800/50 p-3.5 text-left opacity-60">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-500/15">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-orange-400">
                      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <span className="text-sm font-medium text-slate-400">MetaMask / 기존 지갑 연결</span>
                    <div className="text-[11px] text-slate-600">이미 지갑이 있다면 바로 연결 &middot; ~5초</div>
                  </div>
                </button>

                {/* Skip */}
                <div className="text-center pt-1">
                  <span className="text-[10px] text-slate-600">
                    또는 <span className="text-slate-400">카드 결제</span>를 선택하면 지갑 없이도 거래 가능
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── wallet_creating ── */}
        {step === "wallet_creating" && (
          <div className="space-y-4" style={{ animation: "fadeInUp 0.3s ease-out" }}>
            <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-5 max-w-md mx-auto">
              <div className="text-center space-y-4">
                {/* Coinbase header */}
                <div className="flex items-center justify-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z" />
                    </svg>
                  </div>
                  <span className="text-sm font-semibold text-white">Coinbase Smart Wallet</span>
                </div>

                {/* Creating animation */}
                <div className="space-y-3">
                  <WalletCreationStep label="Google 계정 인증 확인" done delay={0} />
                  <WalletCreationStep label="Smart Wallet 컨트랙트 배포 (Base)" done delay={600} />
                  <WalletCreationStep label="키 생성 (Passkey 기반)" done={false} delay={1200} />
                  <WalletCreationStep label="지갑 주소 할당" done={false} delay={1800} />
                </div>

                <div className="pt-2">
                  <div className="h-1 rounded-full bg-slate-700 overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full animate-wallet-progress" />
                  </div>
                  <p className="text-[10px] text-slate-500 mt-2">
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
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/15 border border-emerald-500/30">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-bold text-emerald-400">지갑 생성 완료!</p>
              <p className="text-xs text-slate-400 mt-1">
                추가 {walletStr}초. 지갑 주소: <span className="font-mono text-slate-300">{MOCK_WALLET}</span>
              </p>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════ */}
        {/* ALL DONE                                   */}
        {/* ═══════════════════════════════════════════ */}
        {step === "all_done" && (
          <div className="text-center space-y-5" style={{ animation: "fadeInUp 0.4s ease-out" }}>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 border-2 border-emerald-500/30">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>

            <div>
              <p className="text-lg font-bold text-white">거래 준비 완료!</p>
              <p className="text-xs text-slate-400 mt-1">
                계정 생성 + 지갑 생성, 총 <span className="text-emerald-400 font-bold text-sm">{totalStr}초</span>
              </p>
            </div>

            {/* Breakdown */}
            <div className="rounded-lg bg-slate-900/60 border border-slate-700 p-4 max-w-sm mx-auto text-left space-y-2.5">
              <div className="text-[10px] text-slate-500 font-medium mb-2">소요 시간 분석</div>
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-cyan-400" />
                  <span className="text-slate-400">Google 가입</span>
                </div>
                <span className="font-mono text-cyan-400">{signupStr}s</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-blue-400" />
                  <span className="text-slate-400">Coinbase Smart Wallet 생성</span>
                </div>
                <span className="font-mono text-blue-400">{walletStr}s</span>
              </div>
              <div className="border-t border-slate-700 pt-2 flex items-center justify-between text-xs font-medium">
                <span className="text-slate-300">총 온보딩</span>
                <span className="font-mono text-emerald-400">{totalStr}s</span>
              </div>
            </div>

            {/* What user got */}
            <div className="rounded-lg bg-slate-900/60 border border-slate-700 p-4 max-w-sm mx-auto text-left">
              <div className="text-[10px] text-slate-500 font-medium mb-2">사용자가 얻은 것</div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-emerald-400">&#10003;</span>
                  <span className="text-slate-300">Haggle 계정 (Google SSO)</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-emerald-400">&#10003;</span>
                  <span className="text-slate-300">Base L2 지갑 (<span className="font-mono text-slate-400">{MOCK_WALLET}</span>)</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-emerald-400">&#10003;</span>
                  <span className="text-slate-300">USDC 송수신 가능 상태</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-emerald-400">&#10003;</span>
                  <span className="text-slate-300">시드구문 관리 불필요 (Passkey 기반)</span>
                </div>
              </div>
            </div>

            {/* Comparison */}
            <div className="rounded-lg bg-slate-900/60 border border-slate-700 p-4 max-w-sm mx-auto">
              <div className="text-[10px] text-slate-500 mb-3">온보딩 비교 (가입 + 결제 수단 준비)</div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400 w-16">eBay</span>
                  <div className="flex-1 mx-3">
                    <div className="h-2 rounded-full bg-red-500/50" style={{ width: "100%" }} />
                  </div>
                  <span className="text-slate-500 text-[10px] w-14 text-right">~5분</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400 w-16">Mercari</span>
                  <div className="flex-1 mx-3">
                    <div className="h-2 rounded-full bg-amber-500/50" style={{ width: "70%" }} />
                  </div>
                  <span className="text-slate-500 text-[10px] w-14 text-right">~3분</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400 w-16">OpenSea</span>
                  <div className="flex-1 mx-3">
                    <div className="h-2 rounded-full bg-purple-500/50" style={{ width: "50%" }} />
                  </div>
                  <span className="text-slate-500 text-[10px] w-14 text-right">~2분</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-emerald-400 font-medium w-16">Haggle</span>
                  <div className="flex-1 mx-3">
                    <div className="h-2 rounded-full bg-emerald-500" style={{ width: "5%" }} />
                  </div>
                  <span className="text-emerald-400 text-[10px] font-bold w-14 text-right">~{totalStr}s</span>
                </div>
              </div>
              <p className="text-[10px] text-slate-600 mt-2 text-center">
                eBay: 가입 + 주소 + 카드 등록 | Mercari: 가입 + 본인인증 | OpenSea: 가입 + MetaMask 설치
              </p>
            </div>

            <button
              onClick={resetDemo}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
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

function WalletCreationStep({ label, done, delay }: { label: string; done: boolean; delay: number }) {
  const [visible, setVisible] = useState(false);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setVisible(true), delay);
    const t2 = setTimeout(() => setCompleted(true), delay + 800);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [delay]);

  if (!visible) return null;

  return (
    <div
      className="flex items-center gap-2 text-xs"
      style={{ animation: "fadeInUp 0.2s ease-out" }}
    >
      {completed ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400 shrink-0">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <div className="w-3.5 h-3.5 border-2 border-slate-600 border-t-blue-400 rounded-full animate-spin shrink-0" />
      )}
      <span className={completed ? "text-slate-300" : "text-slate-500"}>{label}</span>
    </div>
  );
}
